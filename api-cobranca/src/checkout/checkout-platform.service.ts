import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CheckoutPlatformSettings,
  CheckoutSellerTerms,
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
import { cardProcessingBasisPoints } from '../payment/efi-card.client';
import { checkoutCardNotificationUrl } from './efi-checkout-card.client';
import { conflict, versionChanged } from './checkout-rules';
import {
  SetPlatformCardDto,
  SetPlatformPixFeeDto,
  UploadPlatformCredentialsDto,
  ValidatePlatformAccountDto,
} from './dto/checkout-platform.dto';

/** Card rates of the CifraMais account: anticipated receipt only. */
export interface CheckoutCardRates {
  receipt: 'ANTICIPATED';
  cashBasisPoints: number;
  anticipationBasisPoints: number;
}

/** Everything a card sale needs; null while the card is off or incomplete. */
export interface CheckoutCardAccount {
  account: CheckoutPlatformAccount;
  rates: CheckoutCardRates;
  creditDays: number;
  payeeCode: string;
}

// A new version keeps what it does not change.
function carriedCard(previous: CheckoutPlatformSettings | null) {
  return {
    cardEnabled: previous?.cardEnabled ?? false,
    cardRates: (previous?.cardRates ?? Prisma.DbNull) as
      | Prisma.InputJsonValue
      | typeof Prisma.DbNull,
    cardCreditDays: previous?.cardCreditDays ?? null,
  };
}

export interface UploadedCertificate {
  buffer: Buffer;
  size: number;
}

/** An issuing account as the Efí clients use it: who it is and how to sign in. */
export interface CheckoutIssuerAccount {
  identity: EfiAccountIdentity;
  credential: EfiCredentialVersion;
}

/** What the checkout needs to issue a Pix: all present, or the checkout does not sell. */
export interface CheckoutPlatformAccount extends CheckoutIssuerAccount {
  settings: CheckoutPlatformSettings & { pixFeeBasisPoints: number };
  identity: EfiAccountIdentity & { pixKey: string };
}

/**
 * Whose account a sale under these terms is issued from: the seller's own
 * company, or null for the CifraMais account.
 */
export function accountOwner(
  terms: Pick<CheckoutSellerTerms, 'accountMode' | 'companyId'> | null,
): string | null {
  return terms?.accountMode === 'SELLER_ACCOUNT' ? terms.companyId : null;
}

const AUDIT_RETENTION_MS = 5 * 365.25 * 86_400_000;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * The accounts of an owner: a seller never reads or issues from an account
 * that is not its own, and the CifraMais side never from a seller's.
 */
function owned(owner: string | null) {
  return owner
    ? ({ ownership: 'COMPANY', companyId: owner } as const)
    : ({ ownership: 'PLATFORM' } as const);
}

// Audit actions say whose account changed.
const scope = (owner: string | null) => (owner ? 'SELLER' : 'PLATFORM');

@Injectable()
export class CheckoutPlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: PaymentCryptoService,
    private readonly gateway: EfiGatewayClient,
    private readonly registry: EfiAccountRegistryService,
  ) {}

  /** The current settings of the CifraMais account or, with an owner, of that seller's. */
  current(
    owner: string | null = null,
  ): Promise<CheckoutPlatformSettings | null> {
    return this.prisma.checkoutPlatformSettings.findFirst({
      where: { companyId: owner },
      orderBy: { version: 'desc' },
    });
  }

  /** Whose account the seller sells through now, by its current terms. */
  async ownerFor(companyId: string): Promise<string | null> {
    return accountOwner(
      await this.prisma.checkoutSellerTerms.findFirst({
        where: { companyId },
        orderBy: { version: 'desc' },
        select: { accountMode: true, companyId: true },
      }),
    );
  }

  /**
   * The account screen of the CifraMais or, with an owner, of that seller.
   * Never returns client id, secret or certificate.
   */
  async view(owner: string | null = null) {
    if (owner) await this.seller(owner, false);
    const history = await this.prisma.checkoutPlatformSettings.findMany({
      where: { companyId: owner },
      orderBy: { version: 'desc' },
      take: 20,
      select: {
        id: true,
        version: true,
        pixFeeBasisPoints: true,
        cardEnabled: true,
        cardRates: true,
        cardCreditDays: true,
        webhookConfiguredAt: true,
        createdAt: true,
        identityId: true,
      },
    });
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: owned(owner),
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
      ready: Boolean(await this.ready(owner)),
    };
  }

  async uploadCredentials(
    userId: string,
    auditCompanyId: string,
    dto: UploadPlatformCredentialsDto,
    file: UploadedCertificate | undefined,
    owner: string | null = null,
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
    // The holder of a seller's account is not compared with its registration
    // (decided on 17/11/2026): the signed authorization is what ties them.
    if (owner) await this.seller(owner);
    // In production the checkout must receive in the CifraMais account itself.
    else if (dto.environment === 'PRODUCTION') {
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
        const input = {
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
        };
        const created = owner
          ? await this.registry.registerCompanyCredential(tx, {
              ...input,
              companyId: owner,
            })
          : await this.registry.registerPlatformCredential(tx, input);
        await this.audit(tx, auditCompanyId, userId, created.identity.id, {
          action: `CHECKOUT_${scope(owner)}_CREDENTIAL_UPLOADED`,
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
      if (!owner && isUniqueViolation(error))
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
    owner: string | null = null,
  ) {
    // Before any call with the seller's credentials.
    if (owner) await this.seller(owner);
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: owned(owner),
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
      throw new NotFoundException('Cadastre as credenciais da conta.');
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
        where: { companyId: owner },
        orderBy: { version: 'desc' },
      });
      await tx.checkoutPlatformSettings.create({
        data: {
          companyId: owner,
          version: (previous?.version ?? 0) + 1,
          identityId: identity.id,
          pixFeeBasisPoints: previous?.pixFeeBasisPoints ?? null,
          ...carriedCard(previous),
          // The Efí card approval is per account: another account starts off.
          ...(previous && previous.identityId !== identity.id
            ? { cardEnabled: false }
            : {}),
          webhookConfiguredAt: now,
          changedByUserId: userId,
        },
      });
      await this.audit(tx, auditCompanyId, userId, identity.id, {
        action: `CHECKOUT_${scope(owner)}_ACCOUNT_VALIDATED`,
        changes: {
          credentialVersion: credential.version,
          webhookReplaced: Boolean(currentUrl && currentUrl !== target),
        },
      });
    });
    return this.view(owner);
  }

  async setPixFee(
    userId: string,
    auditCompanyId: string,
    dto: SetPlatformPixFeeDto,
    owner: string | null = null,
  ) {
    if (owner) await this.seller(owner);
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.checkoutPlatformSettings.findFirst({
          where: { companyId: owner },
          orderBy: { version: 'desc' },
        });
        if (!current)
          throw new NotFoundException('Valide a conta antes da tarifa.');
        if (current.version !== dto.expectedVersion) versionChanged();
        await tx.checkoutPlatformSettings.create({
          data: {
            companyId: owner,
            version: current.version + 1,
            identityId: current.identityId,
            pixFeeBasisPoints: dto.pixFeeBasisPoints,
            ...carriedCard(current),
            webhookConfiguredAt: current.webhookConfiguredAt,
            changedByUserId: userId,
          },
        });
        await this.audit(tx, auditCompanyId, userId, current.identityId, {
          action: `CHECKOUT_${scope(owner)}_PIX_FEE_CHANGED`,
          changes: { pixFeeBasisPoints: dto.pixFeeBasisPoints },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) versionChanged();
      throw error;
    }
    return this.view(owner);
  }

  /**
   * Card rates, days until the Efí credit and on/off. Turning it on needs the
   * Pix side ready, the payee code (browser tokenization) and the notice URL.
   */
  async setCard(
    userId: string,
    auditCompanyId: string,
    dto: SetPlatformCardDto,
    owner: string | null = null,
  ) {
    if (owner) await this.seller(owner);
    const rates: CheckoutCardRates = {
      receipt: 'ANTICIPATED',
      cashBasisPoints: dto.cashBasisPoints,
      anticipationBasisPoints: dto.anticipationBasisPoints,
    };
    if (cardProcessingBasisPoints(rates, 12) >= 10000)
      throw new BadRequestException({
        code: 'CHECKOUT_INVALID',
        message: 'Tarifa de cartão inválida: em 12x ela passaria de 100%.',
      });
    if (dto.cardEnabled) {
      const ready = await this.ready(owner);
      if (
        !ready?.identity.payeeCode ||
        !checkoutCardNotificationUrl(this.config, ready.identity.id)
      )
        throw this.unprocessable(
          'CARD_ACCOUNT_NOT_READY',
          'Valide a conta, defina a tarifa do Pix e confira o código do recebedor e a URL de notificações antes de ligar o cartão.',
        );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.checkoutPlatformSettings.findFirst({
          where: { companyId: owner },
          orderBy: { version: 'desc' },
        });
        if (!current)
          throw new NotFoundException('Valide a conta antes do cartão.');
        if (current.version !== dto.expectedVersion) versionChanged();
        await tx.checkoutPlatformSettings.create({
          data: {
            companyId: owner,
            version: current.version + 1,
            identityId: current.identityId,
            pixFeeBasisPoints: current.pixFeeBasisPoints,
            webhookConfiguredAt: current.webhookConfiguredAt,
            cardEnabled: dto.cardEnabled,
            cardRates: rates as unknown as Prisma.InputJsonValue,
            cardCreditDays: dto.cardCreditDays,
            changedByUserId: userId,
          },
        });
        await this.audit(tx, auditCompanyId, userId, current.identityId, {
          action: `CHECKOUT_${scope(owner)}_CARD_CHANGED`,
          changes: {
            cardEnabled: dto.cardEnabled,
            cashBasisPoints: dto.cashBasisPoints,
            anticipationBasisPoints: dto.anticipationBasisPoints,
            cardCreditDays: dto.cardCreditDays,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) versionChanged();
      throw error;
    }
    return this.view(owner);
  }

  /** The card side of the current account, or null while it does not sell. */
  async cardReady(
    owner: string | null = null,
  ): Promise<CheckoutCardAccount | null> {
    const account = await this.ready(owner);
    const settings = account?.settings;
    const rates = settings?.cardRates as CheckoutCardRates | null | undefined;
    if (
      !account ||
      !settings?.cardEnabled ||
      rates?.receipt !== 'ANTICIPATED' ||
      !settings.cardCreditDays ||
      !account.identity.payeeCode ||
      !checkoutCardNotificationUrl(this.config, account.identity.id)
    )
      return null;
    return {
      account,
      rates,
      creditDays: settings.cardCreditDays,
      payeeCode: account.identity.payeeCode,
    };
  }

  /**
   * The current account of the CifraMais or, with an owner, of that seller;
   * null while anything the Pix needs is missing.
   */
  async ready(
    owner: string | null = null,
  ): Promise<CheckoutPlatformAccount | null> {
    const settings = await this.current(owner);
    if (!settings?.webhookConfiguredAt || settings.pixFeeBasisPoints == null)
      return null;
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: { id: settings.identityId, ...owned(owner) },
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

  /**
   * The account that issued a charge, for everything after the issue (query,
   * reconciliation, refund): never the current one, which may have changed.
   */
  async accountOf(identityId: string): Promise<CheckoutIssuerAccount | null> {
    const identity = await this.prisma.efiAccountIdentity.findUnique({
      where: { id: identityId },
      include: {
        credentialVersions: { where: { status: 'ACTIVE' }, take: 1 },
      },
    });
    const credential = identity?.credentialVersions[0];
    return identity && credential ? { identity, credential } : null;
  }

  /**
   * The checkout client an own account is managed for. Its credentials are
   * only stored or used with the seller's signed authorization on file.
   */
  private async seller(owner: string, authorized = true) {
    const company = await this.prisma.company.findFirst({
      where: { id: owner, product: 'CHECKOUT' },
      select: {
        checkoutSellerTerms: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { accountMode: true, authorizationReference: true },
        },
      },
    });
    if (!company)
      throw new NotFoundException('Cliente de checkout não encontrado.');
    const terms = company.checkoutSellerTerms[0];
    if (terms?.accountMode !== 'SELLER_ACCOUNT')
      conflict(
        'CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED',
        'Este cliente vende pela conta Cifra+ e não tem conta Efí própria.',
      );
    if (authorized && !terms.authorizationReference)
      conflict(
        'CHECKOUT_AUTHORIZATION_REQUIRED',
        'Informe nos termos do cliente a referência da autorização assinada por ele antes de cadastrar a conta Efí.',
      );
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
