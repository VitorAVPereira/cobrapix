import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  BillingMethod,
  FinancialValidationAttempt,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import {
  EfiAccountOperations,
  EfiGatewayClient,
} from '../payment/efi-gateway.client';
import { PaymentFeeService } from '../payment-fees/payment-fee.service';
import { FinancialValidationJobs } from './financial-validation.jobs';
import {
  classifyEfiError,
  ValidationStep,
  ValidationStepCode,
  ValidationStepEffect,
} from './financial-validation.types';

export const VALIDATION_VALIDITY_MS = 15 * 60_000;
export const VALIDATION_MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 60_000;
const AUDIT_RETENTION_MS = 5 * 365.25 * 86400_000;
const CERTIFICATE_MIN_REMAINING_MS = 86400_000;

export interface RequestValidationInput {
  expectedRevision: number;
  idempotencyKey: string;
}

export interface ValidationAttemptView {
  id: string;
  profileId: string;
  profileRevision: number;
  status: string;
  steps: ValidationStep[];
  attempts: number;
  errorCode: string | null;
  validUntil: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
}

type Db = Prisma.TransactionClient | PrismaService;

class StepFailure extends Error {
  constructor(
    readonly errorCode: string,
    readonly transient: boolean,
  ) {
    super(errorCode);
  }
}

@Injectable()
export class FinancialValidationService {
  private readonly logger = new Logger(FinancialValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly gateway: EfiGatewayClient,
    private readonly fees: PaymentFeeService,
    private readonly jobs: FinancialValidationJobs,
    private readonly config: ConfigService,
  ) {}

  async requestValidation(
    profileId: string,
    userId: string,
    input: RequestValidationInput,
  ): Promise<ValidationAttemptView> {
    await this.assertManualActivationReleased(this.prisma);
    const attempt = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "FinancialProfileVersion" WHERE id=${profileId} FOR UPDATE`,
      );
      if (locked.length === 0) this.fail(404, 'FINANCIAL_ACTIVATION_NOT_FOUND');
      const replay = await tx.financialValidationAttempt.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay) {
        if (
          replay.profileId !== profileId ||
          replay.profileRevision !== input.expectedRevision
        )
          this.fail(409, 'IDEMPOTENCY_KEY_REUSED');
        return { attempt: replay, created: false };
      }
      const profile = await tx.financialProfileVersion.findUniqueOrThrow({
        where: { id: profileId },
        include: {
          issuerIdentity: true,
          issuerCredentialVersion: {
            select: { id: true, status: true, certificateExpiresAt: true },
          },
        },
      });
      if (profile.status === 'VALIDATING')
        this.fail(409, 'VALIDATION_IN_PROGRESS');
      if (!['DRAFT', 'READY', 'VALIDATION_FAILED'].includes(profile.status))
        this.fail(409, 'FINANCIAL_ACTIVATION_CLOSED');
      if (profile.revision !== input.expectedRevision)
        this.fail(409, 'REVISION_CONFLICT');
      const missing = [
        !profile.issuerIdentityId && 'ISSUER_ACCOUNT',
        (!profile.issuerCredentialVersion ||
          !['CANDIDATE', 'ACTIVE'].includes(
            profile.issuerCredentialVersion.status,
          )) &&
          'CREDENTIALS',
        !profile.ownershipVerifiedAt && 'OWNERSHIP_VERIFICATION',
        !profile.authorizationReference && 'AUTHORIZATION',
        profile.enabledMethods.includes('PIX') &&
          !profile.issuerIdentity?.pixKey &&
          'PIX_KEY',
      ].filter((item): item is string => Boolean(item));
      if (missing.length > 0)
        throw new HttpException(
          {
            code: 'FINANCIAL_PROFILE_NOT_READY',
            message: `Complete antes de validar: ${missing.join(', ')}.`,
          },
          422,
        );
      const moved = await tx.financialProfileVersion.updateMany({
        where: { id: profileId, revision: profile.revision },
        data: { status: 'VALIDATING', validatedAt: null, validationHash: null },
      });
      if (moved.count !== 1) this.fail(409, 'REVISION_CONFLICT');
      const created = await tx.financialValidationAttempt.create({
        data: {
          companyId: profile.companyId,
          profileId,
          profileRevision: profile.revision,
          credentialVersionId: profile.issuerCredentialVersionId,
          idempotencyKey: input.idempotencyKey,
          steps: this.plannedSteps(
            profile.enabledMethods,
          ) as unknown as Prisma.InputJsonValue,
          nextRunAt: new Date(),
          requestedByUserId: userId,
        },
      });
      await this.audit(tx, profile.companyId, userId, created.id, {
        action: 'FINANCIAL_VALIDATION_REQUESTED',
        profileId,
        revision: profile.revision,
      });
      return { attempt: created, created: true };
    });
    if (attempt.created) await this.jobs.enqueue(attempt.attempt.id, 0);
    return this.toView(attempt.attempt);
  }

  async latestAttempt(
    profileId: string,
  ): Promise<ValidationAttemptView | null> {
    const attempt = await this.prisma.financialValidationAttempt.findFirst({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
    });
    return attempt ? this.toView(attempt) : null;
  }

  // Runs one claim of an attempt. Safe to call from the queue worker and the
  // recovery routine at the same time: the lease decides who works.
  async runAttempt(attemptId: string): Promise<void> {
    const owner = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.financialValidationAttempt.updateMany({
      where: {
        id: attemptId,
        OR: [
          { status: 'PENDING', nextRunAt: { lte: now } },
          { status: 'RUNNING', leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: 'RUNNING',
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return;
    const attempt =
      await this.prisma.financialValidationAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
    if (!attempt.startedAt)
      await this.prisma.financialValidationAttempt.updateMany({
        where: { id: attemptId, leaseOwner: owner },
        data: { startedAt: now },
      });
    const profile = await this.prisma.financialProfileVersion.findUniqueOrThrow(
      {
        where: { id: attempt.profileId },
        include: {
          issuerIdentity: true,
          issuerCredentialVersion: true,
          company: { select: { document: true } },
        },
      },
    );
    // Any edit moves the profile out of VALIDATING or bumps its revision.
    if (
      profile.status !== 'VALIDATING' ||
      profile.revision !== attempt.profileRevision ||
      profile.issuerCredentialVersionId !== attempt.credentialVersionId
    )
      return this.finish(attempt, owner, 'CANCELED', 'PROFILE_CHANGED');

    const steps = this.readSteps(attempt.steps, profile.enabledMethods);
    const persist = async (): Promise<boolean> =>
      (
        await this.prisma.financialValidationAttempt.updateMany({
          where: { id: attemptId, leaseOwner: owner, status: 'RUNNING' },
          data: { steps: steps as unknown as Prisma.InputJsonValue },
        })
      ).count === 1;

    let feeCharged: Partial<Record<BillingMethod, boolean>> = {};
    let operations: EfiAccountOperations | undefined;
    const ops = (): EfiAccountOperations => {
      if (operations) return operations;
      const credential = profile.issuerCredentialVersion;
      if (!credential) throw new StepFailure('CREDENTIALS_MISSING', false);
      try {
        operations = this.gateway.operations({
          environment: profile.environment,
          clientId: this.crypto.decrypt(credential.encryptedClientId),
          clientSecret: this.crypto.decrypt(credential.encryptedClientSecret),
          certificateBase64: this.crypto.decrypt(
            credential.encryptedCertificate,
          ),
        });
      } catch {
        throw new StepFailure('CREDENTIALS_UNREADABLE', false);
      }
      return operations;
    };
    const identity = profile.issuerIdentity;
    type Outcome = 'PASSED' | 'SKIPPED' | 'NOT_VERIFIABLE';
    const runners: Record<
      ValidationStepCode,
      () => Outcome | Promise<Outcome>
    > = {
      CERTIFICATE: () => {
        const credential = profile.issuerCredentialVersion;
        if (
          !credential ||
          credential.certificateExpiresAt.getTime() - Date.now() <
            CERTIFICATE_MIN_REMAINING_MS
        )
          throw new StepFailure('CERTIFICATE_EXPIRED', false);
        ops();
        return 'PASSED';
      },
      FEE_VERSIONS: async (): Promise<Outcome> => {
        feeCharged = await this.feeCharges(
          profile.companyId,
          profile.enabledMethods,
        );
        return 'PASSED';
      },
      PLATFORM_RECIPIENT: () => {
        if (!feeCharged.PIX && !feeCharged.BOLIX) return 'SKIPPED';
        const account = this.config.get<string>('EFI_PLATFORM_ACCOUNT_NUMBER');
        const cnpj = this.config.get<string>('EFI_PLATFORM_CNPJ');
        const payee = this.config.get<string>('EFI_PLATFORM_PAYEE_CODE');
        if (
          !account ||
          account === identity?.efiAccountNumber ||
          (feeCharged.PIX && !cnpj) ||
          (feeCharged.BOLIX && (!payee || payee === identity?.payeeCode))
        )
          throw new StepFailure('PLATFORM_RECIPIENT_INVALID', false);
        return 'PASSED';
      },
      PIX_AUTH: async (): Promise<Outcome> => {
        await this.external(() => ops().listRecentDueCharges());
        return 'PASSED';
      },
      PIX_WEBHOOK: async (): Promise<Outcome> => {
        const key = identity?.pixKey;
        if (!key) throw new StepFailure('PIX_KEY_MISSING', false);
        await this.external(() => ops().configurePixWebhook(key));
        const url = await this.external(() => ops().pixWebhookUrl(key));
        if (url !== this.gateway.pixWebhookTarget())
          throw new StepFailure('PIX_WEBHOOK_MISMATCH', false);
        return 'PASSED';
      },
      PIX_SPLIT: async (): Promise<Outcome> => {
        if (!feeCharged.PIX) return 'SKIPPED';
        await this.external(() =>
          ops().upsertValidationSplit(validationSplitId(identity?.id ?? '')),
        );
        return 'PASSED';
      },
      CHARGES_AUTH: async (): Promise<Outcome> => {
        await this.external(() => ops().listChargePlans());
        return 'PASSED';
      },
      CHARGES_WEBHOOK_URL: () => {
        try {
          this.gateway.chargesWebhookUrl(profile.companyId);
        } catch {
          throw new StepFailure('CHARGES_WEBHOOK_URL_INVALID', false);
        }
        return 'PASSED';
      },
      BOLIX_ISSUANCE: () => 'NOT_VERIFIABLE',
      BOLIX_SPLIT: () => (feeCharged.BOLIX ? 'NOT_VERIFIABLE' : 'SKIPPED'),
    };

    for (const step of steps) {
      // FEE_VERSIONS feeds later steps, so it always runs again.
      if (step.status === 'PASSED' && step.code !== 'FEE_VERSIONS') continue;
      try {
        step.status = await runners[step.code]();
        delete step.errorCode;
      } catch (error: unknown) {
        const failure =
          error instanceof StepFailure
            ? error
            : error instanceof HttpException
              ? new StepFailure(this.httpCode(error), false)
              : new StepFailure('VALIDATION_INTERNAL_ERROR', false);
        step.status = 'FAILED';
        step.errorCode = failure.errorCode;
        step.checkedAt = new Date().toISOString();
        if (!(await persist())) return;
        // `attempts` already counts this run (incremented by the claim).
        if (failure.transient && attempt.attempts < VALIDATION_MAX_ATTEMPTS)
          return this.retryLater(attempt, owner, steps);
        return this.finish(attempt, owner, 'FAILED', failure.errorCode);
      }
      step.checkedAt = new Date().toISOString();
      if (!(await persist())) return;
    }

    const hash = await this.computeValidationHash(this.prisma, profile.id);
    await this.prisma.$transaction(async (tx) => {
      const promoted = await tx.financialProfileVersion.updateMany({
        where: {
          id: profile.id,
          status: 'VALIDATING',
          revision: attempt.profileRevision,
        },
        data: {
          status: 'READY',
          validatedAt: new Date(),
          validationHash: hash,
        },
      });
      const finished = await tx.financialValidationAttempt.updateMany({
        where: { id: attemptId, leaseOwner: owner, status: 'RUNNING' },
        data:
          promoted.count === 1
            ? {
                status: 'SUCCEEDED',
                validationHash: hash,
                validUntil: new Date(Date.now() + VALIDATION_VALIDITY_MS),
                finishedAt: new Date(),
                leaseOwner: null,
                leaseExpiresAt: null,
              }
            : {
                status: 'CANCELED',
                sanitizedErrorCode: 'PROFILE_CHANGED',
                finishedAt: new Date(),
                leaseOwner: null,
                leaseExpiresAt: null,
              },
      });
      if (finished.count !== 1)
        throw new Error('FINANCIAL_VALIDATION_LEASE_LOST');
      await this.audit(tx, attempt.companyId, null, attemptId, {
        action:
          promoted.count === 1
            ? 'FINANCIAL_VALIDATION_SUCCEEDED'
            : 'FINANCIAL_VALIDATION_CANCELED',
        steps: steps.map(({ code, status }) => ({ code, status })),
      });
    });
  }

  // Recovers attempts whose job was lost (Redis restart) or whose worker died.
  @Cron('0 * * * * *')
  async recoverDueAttempts(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.financialValidationAttempt.findMany({
      where: {
        OR: [
          { status: 'PENDING', nextRunAt: { lte: now } },
          { status: 'RUNNING', leaseExpiresAt: { lt: now } },
        ],
      },
      select: { id: true },
      orderBy: { nextRunAt: 'asc' },
      take: 20,
    });
    for (const { id } of due) {
      try {
        await this.runAttempt(id);
      } catch {
        this.logger.error('FINANCIAL_VALIDATION_RECOVERY_FAILED');
      }
    }
    return due.length;
  }

  // Everything validation depends on. Any change — account, credential,
  // company document, methods, fee versions, platform recipient or webhook
  // targets — produces a different hash and makes the validation stale.
  async computeValidationHash(db: Db, profileId: string): Promise<string> {
    const profile = await db.financialProfileVersion.findUniqueOrThrow({
      where: { id: profileId },
      include: {
        issuerIdentity: true,
        issuerCredentialVersion: {
          select: { id: true, version: true, certificateFingerprint: true },
        },
        company: { select: { document: true } },
      },
    });
    const methods = [...profile.enabledMethods].sort();
    const feeVersions: Record<string, string | null> = {};
    for (const method of methods) {
      try {
        feeVersions[method] = (
          await this.fees.resolveActiveVersion(profile.companyId, method)
        ).id;
      } catch {
        feeVersions[method] = null;
      }
    }
    let chargesWebhook: string | null = null;
    try {
      chargesWebhook = this.gateway.chargesWebhookUrl(profile.companyId);
    } catch {
      chargesWebhook = null;
    }
    let pixWebhook: string | null = null;
    try {
      pixWebhook = this.gateway.pixWebhookTarget();
    } catch {
      pixWebhook = null;
    }
    const identity = profile.issuerIdentity;
    const canonical = JSON.stringify({
      profileId: profile.id,
      revision: profile.revision,
      companyId: profile.companyId,
      companyDocument: profile.company.document,
      mode: [profile.origin, profile.accountMode, profile.payoutMode],
      environment: profile.environment,
      methods,
      identity: identity && {
        id: identity.id,
        holderDocument: identity.holderDocument,
        efiAccountNumber: identity.efiAccountNumber,
        payeeCode: identity.payeeCode,
        pixKey: identity.pixKey,
      },
      credential: profile.issuerCredentialVersion,
      feeVersions,
      platform: [
        this.config.get<string>('EFI_PLATFORM_ACCOUNT_NUMBER') ?? null,
        this.config.get<string>('EFI_PLATFORM_CNPJ') ?? null,
        this.config.get<string>('EFI_PLATFORM_PAYEE_CODE') ?? null,
      ],
      webhooks: [pixWebhook, chargesWebhook],
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  async assertManualActivationReleased(db: Db): Promise<void> {
    const state = await db.platformIntegrationState.findUnique({
      where: { integration: 'FINANCIAL_MANUAL_ACTIVATION' },
      select: { enabled: true },
    });
    if (!state?.enabled) this.fail(409, 'MANUAL_ACTIVATION_PAUSED');
  }

  plannedSteps(methods: BillingMethod[]): ValidationStep[] {
    const pix = methods.includes('PIX');
    const bolix = methods.includes('BOLIX');
    const plan: Array<[ValidationStepCode, boolean, ValidationStepEffect]> = [
      ['CERTIFICATE', true, 'NONE'],
      ['FEE_VERSIONS', true, 'NONE'],
      ['PLATFORM_RECIPIENT', true, 'NONE'],
      ['PIX_AUTH', pix, 'NONE'],
      ['PIX_WEBHOOK', pix, 'PIX_WEBHOOK_CONFIGURED'],
      ['PIX_SPLIT', pix, 'VALIDATION_SPLIT_CONFIGURED'],
      ['CHARGES_AUTH', bolix, 'NONE'],
      ['CHARGES_WEBHOOK_URL', bolix, 'NONE'],
      ['BOLIX_ISSUANCE', bolix, 'NONE'],
      ['BOLIX_SPLIT', bolix, 'NONE'],
    ];
    return plan
      .filter(([, applies]) => applies)
      .map(([code, , effect]) => ({ code, status: 'PENDING', effect }));
  }

  toView(attempt: FinancialValidationAttempt): ValidationAttemptView {
    return {
      id: attempt.id,
      profileId: attempt.profileId,
      profileRevision: attempt.profileRevision,
      status: attempt.status,
      steps: Array.isArray(attempt.steps)
        ? (attempt.steps as unknown as ValidationStep[])
        : [],
      attempts: attempt.attempts,
      errorCode: attempt.sanitizedErrorCode,
      validUntil: attempt.validUntil,
      createdAt: attempt.createdAt,
      finishedAt: attempt.finishedAt,
    };
  }

  private readSteps(
    value: Prisma.JsonValue,
    methods: BillingMethod[],
  ): ValidationStep[] {
    return Array.isArray(value) && value.length > 0
      ? (value as unknown as ValidationStep[])
      : this.plannedSteps(methods);
  }

  private async feeCharges(
    companyId: string,
    methods: BillingMethod[],
  ): Promise<Partial<Record<BillingMethod, boolean>>> {
    const charged: Partial<Record<BillingMethod, boolean>> = {};
    for (const method of methods) {
      let version;
      try {
        version = await this.fees.resolveActiveVersion(companyId, method);
      } catch {
        throw new StepFailure('FEE_CONFIGURATION_MISSING', false);
      }
      charged[method] =
        (version.platformFeeAmountCents ?? 0) > 0 ||
        (version.platformFeeBasisPoints ?? 0) > 0;
    }
    return charged;
  }

  private async external<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error: unknown) {
      if (error instanceof StepFailure) throw error;
      const classified = classifyEfiError(error);
      throw new StepFailure(classified.code, classified.transient);
    }
  }

  private async retryLater(
    attempt: FinancialValidationAttempt,
    owner: string,
    steps: ValidationStep[],
  ): Promise<void> {
    const run = attempt.attempts;
    const delay = RETRY_BASE_MS * 2 ** (run - 1);
    const released = await this.prisma.financialValidationAttempt.updateMany({
      where: { id: attempt.id, leaseOwner: owner, status: 'RUNNING' },
      data: {
        status: 'PENDING',
        nextRunAt: new Date(Date.now() + delay),
        leaseOwner: null,
        leaseExpiresAt: null,
        steps: steps as unknown as Prisma.InputJsonValue,
      },
    });
    if (released.count === 1) await this.jobs.enqueue(attempt.id, run, delay);
  }

  private async finish(
    attempt: FinancialValidationAttempt,
    owner: string,
    status: 'FAILED' | 'CANCELED',
    errorCode: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const finished = await tx.financialValidationAttempt.updateMany({
        where: { id: attempt.id, leaseOwner: owner, status: 'RUNNING' },
        data: {
          status,
          sanitizedErrorCode: errorCode,
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (finished.count !== 1) return;
      if (status === 'FAILED')
        await tx.financialProfileVersion.updateMany({
          where: {
            id: attempt.profileId,
            status: 'VALIDATING',
            revision: attempt.profileRevision,
          },
          data: { status: 'VALIDATION_FAILED' },
        });
      await this.audit(tx, attempt.companyId, null, attempt.id, {
        action:
          status === 'FAILED'
            ? 'FINANCIAL_VALIDATION_FAILED'
            : 'FINANCIAL_VALIDATION_CANCELED',
        errorCode,
      });
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string | null,
    attemptId: string,
    changes: { action: string } & Record<string, unknown>,
  ): Promise<void> {
    const { action, ...rest } = changes;
    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        entityType: 'FinancialValidationAttempt',
        entityId: attemptId,
        action,
        changes: rest as Prisma.InputJsonValue,
        retentionExpiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
      },
    });
  }

  private httpCode(error: HttpException): string {
    const response = error.getResponse();
    return typeof response === 'object' &&
      response !== null &&
      typeof (response as Record<string, unknown>).code === 'string'
      ? String((response as Record<string, unknown>).code)
      : 'VALIDATION_INTERNAL_ERROR';
  }

  private fail(status: number, code: string): never {
    throw new HttpException({ code, message: MESSAGES[code] ?? code }, status);
  }
}

// Stable per account, so repeated validations overwrite the same split
// configuration instead of accumulating new ones.
export function validationSplitId(identityId: string): string {
  return createHash('sha256')
    .update(`financial-validation-${identityId}`)
    .digest('hex')
    .slice(0, 32);
}

const MESSAGES: Record<string, string> = {
  FINANCIAL_ACTIVATION_NOT_FOUND: 'Ativação financeira não encontrada.',
  IDEMPOTENCY_KEY_REUSED:
    'Esta chave de requisição já foi usada com outros dados.',
  VALIDATION_IN_PROGRESS: 'Já existe uma validação em andamento.',
  FINANCIAL_ACTIVATION_CLOSED: 'Esta ativação não pode mais ser alterada.',
  REVISION_CONFLICT:
    'A ativação foi alterada por outra pessoa. Recarregue antes de continuar.',
  MANUAL_ACTIVATION_PAUSED:
    'Novas ativações financeiras manuais estão pausadas.',
};
