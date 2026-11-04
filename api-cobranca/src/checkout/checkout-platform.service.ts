import {
  BadGatewayException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CheckoutPlatformSettings,
  EfiAccountIdentity,
  EfiCredentialVersion,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiGatewayClient } from '../payment/efi-gateway.client';
import { inspectEfiCertificate } from '../payment/efi-certificate';
import type { EfiCertificate } from '../payment/efi-certificate';
import { EfiAccountRegistryService } from '../financial-activation/efi-account-registry.service';
import { CERTIFICATE_MAX_BYTES } from '../financial-activation/financial-activation.service';
import { classifyEfiError } from '../financial-activation/financial-validation.types';
import { conflict, versionChanged } from './checkout-rules';
import {
  SetPlatformPixFeeDto,
  UploadPlatformCredentialsDto,
  ValidatePlatformAccountDto,
} from './dto/checkout-platform.dto';

export interface UploadedCertificate {
  buffer: Buffer;
  size: number;
}

/** What the checkout needs to issue a Pix: all present, or the checkout does not sell. */
export interface CheckoutPlatformAccount {
  settings: CheckoutPlatformSettings & { pixFeeBasisPoints: number };
  identity: EfiAccountIdentity & { pixKey: string };
  credential: EfiCredentialVersion;
}

const AUDIT_RETENTION_MS = 5 * 365.25 * 86_400_000;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class CheckoutPlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: PaymentCryptoService,
    private readonly gateway: EfiGatewayClient,
    private readonly registry: EfiAccountRegistryService,
  ) {}

  current(): Promise<CheckoutPlatformSettings | null> {
    return this.prisma.checkoutPlatformSettings.findFirst({
      orderBy: { version: 'desc' },
    });
  }

  /** Never returns client id, secret or certificate. */
  async view() {
    const history = await this.prisma.checkoutPlatformSettings.findMany({
      orderBy: { version: 'desc' },
      take: 20,
      select: {
        id: true,
        version: true,
        pixFeeBasisPoints: true,
        webhookConfiguredAt: true,
        createdAt: true,
        identityId: true,
      },
    });
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: { ownership: 'PLATFORM' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        environment: true,
        holderDocument: true,
        efiAccountNumber: true,
        efiAccountDigit: true,
        payeeCode: true,
        pixKey: true,
        credentialVersions: {
          orderBy: { version: 'desc' },
          take: 5,
          select: {
            id: true,
            version: true,
            status: true,
            certificateExpiresAt: true,
            activatedAt: true,
            createdAt: true,
          },
        },
      },
    });
    return {
      current: history[0] ?? null,
      history,
      identity,
      webhookTarget: this.gateway.pixWebhookTarget(),
      ready: Boolean(await this.ready()),
    };
  }

  async uploadCredentials(
    userId: string,
    auditCompanyId: string,
    dto: UploadPlatformCredentialsDto,
    file: UploadedCertificate | undefined,
  ) {
    if (!file || file.size === 0)
      throw this.unprocessable(
        'CERTIFICATE_REQUIRED',
        'Envie o certificado .p12.',
      );
    let certificate: EfiCertificate;
    try {
      if (file.size > CERTIFICATE_MAX_BYTES) throw new Error();
      certificate = inspectEfiCertificate(
        file.buffer.toString('base64'),
        dto.certificatePassword ?? '',
      );
    } catch {
      throw this.unprocessable(
        'CERTIFICATE_INVALID',
        'Certificado inválido, vencido ou com senha errada.',
      );
    } finally {
      file.buffer.fill(0);
    }
    // In production the checkout must receive in the CifraMais account itself.
    if (dto.environment === 'PRODUCTION') {
      const account = this.config.get<string>('EFI_PLATFORM_ACCOUNT_NUMBER');
      const cnpj = this.config.get<string>('EFI_PLATFORM_CNPJ');
      if (
        !account ||
        !cnpj ||
        account !== dto.efiAccountNumber ||
        cnpj.replace(/\D/g, '') !== dto.holderDocument
      )
        conflict(
          'PLATFORM_ACCOUNT_MISMATCH',
          'A conta ou o CNPJ não são os da Cifra+ configurados no servidor.',
        );
    }
    let registered: Awaited<
      ReturnType<EfiAccountRegistryService['registerPlatformCredential']>
    >;
    try {
      registered = await this.prisma.$transaction(async (tx) => {
        const created = await this.registry.registerPlatformCredential(tx, {
          environment: dto.environment,
          holderDocument: dto.holderDocument,
          efiAccountNumber: dto.efiAccountNumber,
          efiAccountDigit: dto.efiAccountDigit,
          payeeCode: dto.payeeCode,
          pixKey: dto.pixKey.trim(),
          clientId: dto.clientId,
          clientSecret: dto.clientSecret,
          certificate,
          userId,
        });
        await this.audit(tx, auditCompanyId, userId, created.identity.id, {
          action: 'CHECKOUT_PLATFORM_CREDENTIAL_UPLOADED',
          changes: {
            environment: dto.environment,
            credentialVersion: created.credential.version,
            certificateExpiresAt: certificate.expiresAt.toISOString(),
          },
        });
        // The account whose credential was sent last is the one the screen shows and validates.
        await tx.efiAccountIdentity.update({
          where: { id: created.identity.id },
          data: { updatedAt: new Date() },
        });
        return created;
      });
    } catch (error) {
      // One CifraMais account per environment (database rule).
      if (isUniqueViolation(error))
        conflict(
          'PLATFORM_ACCOUNT_EXISTS',
          'Já existe outra conta Cifra+ neste ambiente. Use a mesma conta.',
        );
      throw error;
    }
    const { credential } = registered;
    return { credentialId: credential.id, version: credential.version };
  }

  /**
   * Checks the newest credential at the Efí, points the Pix key webhook to
   * this API and, only then, makes it the account the checkout issues from.
   */
  async validate(
    userId: string,
    auditCompanyId: string,
    dto: ValidatePlatformAccountDto,
  ) {
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: { ownership: 'PLATFORM' },
      orderBy: { updatedAt: 'desc' },
      include: {
        credentialVersions: {
          where: { status: { in: ['CANDIDATE', 'ACTIVE'] } },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    const credential = identity?.credentialVersions[0];
    if (!identity || !credential)
      throw new NotFoundException('Cadastre as credenciais da conta Cifra+.');
    if (!identity.pixKey)
      throw this.unprocessable(
        'PIX_KEY_MISSING',
        'Informe a chave Pix da conta.',
      );
    const pixKey = identity.pixKey;
    const operations = this.gateway.operations({
      environment: identity.environment,
      clientId: this.crypto.decrypt(credential.encryptedClientId),
      clientSecret: this.crypto.decrypt(credential.encryptedClientSecret),
      certificateBase64: this.crypto.decrypt(credential.encryptedCertificate),
    });
    const target = this.gateway.pixWebhookTarget();

    await this.efi(() => operations.listRecentDueCharges());
    let currentUrl: string | undefined;
    try {
      currentUrl = await operations.pixWebhookUrl(pixKey);
    } catch {
      currentUrl = undefined; // The Efí answers 404 when the key has no webhook.
    }
    if (currentUrl && currentUrl !== target && !dto.confirmOverwrite)
      throw new HttpException(
        {
          code: 'PIX_WEBHOOK_IN_USE',
          message:
            'A chave Pix já avisa outro endereço. Confirme para trocar pelo da Cifra+.',
          currentUrl,
        },
        409,
      );
    if (currentUrl !== target) {
      await this.efi(() => operations.configurePixWebhook(pixKey));
      if ((await this.efi(() => operations.pixWebhookUrl(pixKey))) !== target)
        throw new BadGatewayException({
          code: 'PIX_WEBHOOK_MISMATCH',
          message: 'A Efí não confirmou o webhook da chave Pix.',
        });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (credential.status === 'CANDIDATE') {
        await tx.efiCredentialVersion.updateMany({
          where: {
            identityId: identity.id,
            status: 'ACTIVE',
            id: { not: credential.id },
          },
          data: { status: 'RETIRED', retiredAt: now },
        });
        await tx.efiCredentialVersion.update({
          where: { id: credential.id },
          data: { status: 'ACTIVE', activatedAt: now },
        });
      }
      const previous = await tx.checkoutPlatformSettings.findFirst({
        orderBy: { version: 'desc' },
      });
      await tx.checkoutPlatformSettings.create({
        data: {
          version: (previous?.version ?? 0) + 1,
          identityId: identity.id,
          pixFeeBasisPoints: previous?.pixFeeBasisPoints ?? null,
          webhookConfiguredAt: now,
          changedByUserId: userId,
        },
      });
      await this.audit(tx, auditCompanyId, userId, identity.id, {
        action: 'CHECKOUT_PLATFORM_ACCOUNT_VALIDATED',
        changes: {
          credentialVersion: credential.version,
          webhookReplaced: Boolean(currentUrl && currentUrl !== target),
        },
      });
    });
    return this.view();
  }

  async setPixFee(
    userId: string,
    auditCompanyId: string,
    dto: SetPlatformPixFeeDto,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.checkoutPlatformSettings.findFirst({
          orderBy: { version: 'desc' },
        });
        if (!current)
          throw new NotFoundException('Valide a conta Cifra+ antes da tarifa.');
        if (current.version !== dto.expectedVersion) versionChanged();
        await tx.checkoutPlatformSettings.create({
          data: {
            version: current.version + 1,
            identityId: current.identityId,
            pixFeeBasisPoints: dto.pixFeeBasisPoints,
            webhookConfiguredAt: current.webhookConfiguredAt,
            changedByUserId: userId,
          },
        });
        await this.audit(tx, auditCompanyId, userId, current.identityId, {
          action: 'CHECKOUT_PLATFORM_PIX_FEE_CHANGED',
          changes: { pixFeeBasisPoints: dto.pixFeeBasisPoints },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) versionChanged();
      throw error;
    }
    return this.view();
  }

  /** The current account, or null while anything the Pix needs is missing. */
  async ready(): Promise<CheckoutPlatformAccount | null> {
    const settings = await this.current();
    if (!settings?.webhookConfiguredAt || settings.pixFeeBasisPoints == null)
      return null;
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: { id: settings.identityId, ownership: 'PLATFORM' },
      include: {
        credentialVersions: { where: { status: 'ACTIVE' }, take: 1 },
      },
    });
    const credential = identity?.credentialVersions[0];
    if (!identity?.pixKey || !credential) return null;
    return {
      settings: { ...settings, pixFeeBasisPoints: settings.pixFeeBasisPoints },
      identity: { ...identity, pixKey: identity.pixKey },
      credential,
    };
  }

  private async efi<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      const { code } = classifyEfiError(error);
      throw new BadGatewayException({
        code,
        message:
          'A Efí recusou ou não respondeu. Confira as credenciais e tente de novo.',
      });
    }
  }

  private audit(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    identityId: string,
    entry: { action: string; changes: Prisma.InputJsonValue },
  ) {
    return tx.auditLog.create({
      data: {
        companyId,
        userId,
        entityType: 'EfiAccountIdentity',
        entityId: identityId,
        action: entry.action,
        changes: entry.changes,
        retentionExpiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
      },
    });
  }

  private unprocessable(code: string, message: string) {
    return new UnprocessableEntityException({ code, message });
  }
}
