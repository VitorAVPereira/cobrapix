import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingMethod, CardPaymentAttempt, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { validateDebtorDocument } from '../common/debtor-document';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import { PublicPaymentLinkService } from './payment-link.service';
import {
  EfiCardClient,
  CardBrand,
  CardProcessingRate,
} from './efi-card.client';
import {
  calculateCardDebt,
  CardInstallmentQuote,
  cardCivilDate,
  cardDaysBetween,
  resolveCardDiscount,
} from './card-amounts';
import { CardPayDto, CardSettingsDto } from './dto/card-payment.dto';
import { PaymentChargeService } from './payment-charge.service';
import { PaymentNotificationsService } from './payment-notifications.service';

const chargeInclude = {
  invoice: { include: { company: true, debtor: true } },
} satisfies Prisma.PaymentChargeInclude;
type CheckoutCharge = Prisma.PaymentChargeGetPayload<{
  include: typeof chargeInclude;
}>;
function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function result(attempt: CardPaymentAttempt) {
  return {
    attemptId: attempt.id,
    state: attempt.status,
    canRetry: attempt.status === 'DECLINED' || attempt.status === 'CANCELED',
  };
}
@Injectable()
export class CardPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: PublicPaymentLinkService,
    private readonly client: EfiCardClient,
    private readonly eligibility: FinancialEligibilityService,
    private readonly charges: PaymentChargeService,
    private readonly notifications: PaymentNotificationsService,
  ) {}

  async assertCancelable(companyId: string, invoiceId: string) {
    const open = await this.prisma.cardPaymentAttempt.findFirst({
      where: {
        companyId,
        invoiceId,
        status: { in: ['SUBMITTING', 'UNCERTAIN', 'APPROVED', 'PAID'] },
      },
    });
    if (open)
      conflict(
        'CARD_PAYMENT_PROCESSING',
        'O pagamento por cartão precisa ser conciliado antes do cancelamento.',
      );
  }
  async configure(companyId: string, userId: string, dto: CardSettingsDto) {
    const duplicate = new Set(
      dto.processingRates.map((r) => `${r.brand}:${r.installments}`),
    );
    if (duplicate.size !== dto.processingRates.length)
      throw new BadRequestException('Tarifas duplicadas.');
    // The opaque Efí token cannot prove its brand before debit. A processing
    // tariff varying by brand could undercharge the payer. Enable only a
    // contractual tariff verified to be uniform across all accepted brands.
    const installments = new Set(
      dto.processingRates.map((r) => r.installments),
    );
    for (const installment of installments) {
      const rows = dto.processingRates.filter(
        (r) => r.installments === installment,
      );
      if (
        rows.length !== 4 ||
        new Set(rows.map((r) => `${r.basisPoints}:${r.fixedCents}`)).size !== 1
      )
        conflict(
          'CARD_BRAND_TARIFF_UNSUPPORTED',
          'Informe a mesma tarifa contratual para todas as bandeiras de cada parcelamento. Tarifas diferentes por bandeira precisam de validação da Efí antes da habilitação.',
        );
    }
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: { id: dto.issuerIdentityId, companyId, ownership: 'COMPANY' },
    });
    if (!identity)
      throw new NotFoundException('Conta emissora não encontrada.');
    if (dto.enabled) {
      const profile = await this.eligibility.resolveIssuance(companyId);
      if (
        profile.issuerIdentityId !== dto.issuerIdentityId ||
        profile.accountMode !== 'CUSTOMER_ACCOUNT' ||
        profile.payoutMode !== 'DIRECT_TO_CUSTOMER'
      )
        conflict('CARD_ACCOUNT_NOT_ACTIVE', 'Use a conta ativa da empresa.');
      await this.client.account(identity.id, companyId);
      this.client.platformPayee(identity.payeeCode ?? '');
      this.client.notificationUrl(identity.id);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`;
      const current = await tx.cardPaymentSettings.findUnique({
        where: { issuerIdentityId: identity.id },
      });
      if ((current?.version ?? 0) !== dto.expectedVersion)
        conflict(
          'VERSION_CHANGED',
          'Configuração alterada. Recarregue os dados.',
        );
      const data = {
        enabled: dto.enabled,
        onTimeBasisPoints: dto.onTimeBasisPoints,
        overdueBasisPoints: dto.overdueBasisPoints,
        processingRates: dto.processingRates.map((r) => ({ ...r })),
        validationReference: dto.validationReference,
        validatedByUserId: userId,
      };
      const settings = current
        ? await tx.cardPaymentSettings.update({
            where: { id: current.id },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.cardPaymentSettings.create({
            data: { ...data, companyId, issuerIdentityId: identity.id },
          });
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        include: { activeFinancialProfile: true },
      });
      const activeProfile = company.activeFinancialProfile;
      if (
        dto.enabled &&
        (!activeProfile ||
          activeProfile.status !== 'ACTIVE' ||
          activeProfile.issuerIdentityId !== identity.id)
      )
        conflict(
          'FINANCIAL_PROFILE_CHANGED',
          'A conta ativa mudou. Recarregue a configuração.',
        );
      if (
        activeProfile &&
        activeProfile.issuerIdentityId === identity.id &&
        activeProfile.enabledMethods.includes('CREDIT_CARD') !== dto.enabled
      ) {
        const last = await tx.financialProfileVersion.findFirst({
          where: { companyId },
          orderBy: { version: 'desc' },
        });
        const enabledMethods: BillingMethod[] =
          activeProfile.enabledMethods.filter((m) => m !== 'CREDIT_CARD');
        if (dto.enabled) enabledMethods.push('CREDIT_CARD');
        if (!enabledMethods.length)
          conflict(
            'PAYMENT_METHOD_REQUIRED',
            'Mantenha ao menos um meio ativo.',
          );
        await tx.financialProfileVersion.update({
          where: { id: activeProfile.id },
          data: { status: 'SUPERSEDED', supersededAt: new Date() },
        });
        // Published financial profiles stay immutable. Card validation creates
        // a successor on the same account without changing Pix/Bolix evidence.
        const successor = await tx.financialProfileVersion.create({
          data: {
            companyId,
            version: (last?.version ?? 0) + 1,
            status: 'ACTIVE',
            origin: 'MANUAL_ADMIN',
            accountMode: activeProfile.accountMode,
            payoutMode: activeProfile.payoutMode,
            environment: activeProfile.environment,
            enabledMethods,
            issuerIdentityId: identity.id,
            issuerCredentialVersionId: activeProfile.issuerCredentialVersionId,
            authorizationKind: activeProfile.authorizationKind,
            authorizationReference: activeProfile.authorizationReference,
            authorizationValidUntil: activeProfile.authorizationValidUntil,
            ownershipVerifiedAt: activeProfile.ownershipVerifiedAt,
            ownershipVerifiedByUserId: activeProfile.ownershipVerifiedByUserId,
            ownershipEvidenceReference:
              activeProfile.ownershipEvidenceReference,
            validatedAt: new Date(),
            validationHash: hash({
              previousValidation: activeProfile.validationHash,
              cardSettingsId: settings.id,
              cardSettingsVersion: settings.version,
              reference: dto.validationReference,
            }),
            creationIdempotencyKey: randomUUID(),
            activationIdempotencyKey: randomUUID(),
            activatedAt: new Date(),
            activatedByUserId: userId,
            createdByUserId: userId,
          },
        });
        await tx.company.update({
          where: { id: companyId },
          data: { activeFinancialProfileId: successor.id },
        });
      }
      const methods: BillingMethod[] = company.enabledBillingMethods.filter(
        (m) => m !== 'CREDIT_CARD',
      );
      const otherEnabled = await tx.cardPaymentSettings.count({
        where: { companyId, enabled: true },
      });
      if (otherEnabled) methods.push('CREDIT_CARD');
      await tx.company.update({
        where: { id: companyId },
        data: { enabledBillingMethods: methods },
      });
      const scopeKey = companyId;
      const lastFee = await tx.paymentFeeVersion.findFirst({
        where: { scopeKey, billingMethod: 'CREDIT_CARD' },
        orderBy: { version: 'desc' },
      });
      const now = new Date();
      await tx.paymentFeeVersion.updateMany({
        where: {
          companyId,
          billingMethod: 'CREDIT_CARD',
          effectiveUntil: null,
        },
        data: { effectiveUntil: now },
      });
      await tx.paymentFeeVersion.create({
        data: {
          companyId,
          scopeKey,
          billingMethod: 'CREDIT_CARD',
          version: (lastFee?.version ?? 0) + 1,
          efiFeeKind: 'FIXED',
          efiFeeAmountCents: 0,
          platformFeeKind: 'PERCENTAGE',
          platformFeeBasisPoints: dto.onTimeBasisPoints,
          effectiveFrom: now,
          createdByUserId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'CARD_SETTINGS_CHANGED',
          entityType: 'CardPaymentSettings',
          entityId: settings.id,
          changes: { version: settings.version, enabled: settings.enabled },
          retentionExpiresAt: new Date(Date.now() + 5 * 365.25 * 86400000),
        },
      });
      return settings;
    });
  }

  async prepareCharge(companyId: string, invoiceId: string) {
    const existing = await this.prisma.paymentCharge.findFirst({
      where: {
        companyId,
        invoiceId,
        status: { in: ['DRAFT', 'PENDING', 'ACTIVE'] },
      },
      include: chargeInclude,
    });
    if (existing) {
      if (
        existing.billingMethod !== 'CREDIT_CARD' ||
        existing.status !== 'ACTIVE' ||
        existing.invoice.status === 'PAID' ||
        existing.invoice.status === 'CANCELED'
      )
        conflict(
          'CARD_CHARGE_CONFLICT',
          'Já existe cobrança em andamento para esta fatura.',
        );
      return this.links.createInvoicePaymentPage({ companyId, invoiceId });
    }
    const financial = await this.eligibility.resolveIssuance(
      companyId,
      'CREDIT_CARD',
    );
    if (
      financial.accountMode !== 'CUSTOMER_ACCOUNT' ||
      financial.payoutMode !== 'DIRECT_TO_CUSTOMER'
    )
      conflict(
        'FINANCIAL_MODE_NOT_SUPPORTED',
        'Modo financeiro indisponível para cartão.',
      );
    await this.settings(financial.issuerIdentityId, companyId);
    await this.client.account(financial.issuerIdentityId, companyId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${invoiceId} AND "companyId"=${companyId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, companyId },
      });
      if (!invoice) throw new NotFoundException('Fatura não encontrada.');
      if (invoice.status === 'PAID' || invoice.status === 'CANCELED')
        conflict('CARD_INVOICE_CLOSED', 'Esta fatura está encerrada.');
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
      });
      if (
        company.activeFinancialProfileId !== financial.financialProfileId ||
        !company.enabledBillingMethods.includes('CREDIT_CARD')
      )
        conflict(
          'FINANCIAL_PROFILE_CHANGED',
          'Ativação ou habilitação alterada.',
        );
      const pending = await tx.paymentCharge.findFirst({
        where: {
          companyId,
          invoiceId,
          status: { in: ['DRAFT', 'PENDING', 'ACTIVE'] },
        },
      });
      if (pending) {
        if (
          pending.billingMethod !== 'CREDIT_CARD' ||
          pending.status !== 'ACTIVE'
        )
          conflict('CARD_CHARGE_CONFLICT', 'Existe cobrança em andamento.');
        return;
      }
      const settings = await tx.cardPaymentSettings.findFirst({
        where: {
          issuerIdentityId: financial.issuerIdentityId,
          companyId,
          enabled: true,
        },
      });
      if (!settings)
        conflict('CARD_NOT_ENABLED', 'Cartão não habilitado para esta conta.');
      const fee = await tx.paymentFeeVersion.findFirst({
        where: {
          companyId,
          billingMethod: 'CREDIT_CARD',
          effectiveUntil: null,
        },
        orderBy: { version: 'desc' },
      });
      if (!fee)
        conflict(
          'FEE_CONFIGURATION_MISSING',
          'Tarifa de cartão não configurada.',
        );
      const principal = Math.round(Number(invoice.originalAmount) * 100);
      const charge = await tx.paymentCharge.create({
        data: {
          companyId,
          invoiceId,
          billingMethod: 'CREDIT_CARD',
          status: 'ACTIVE',
          ...financial,
          feeVersionId: fee.id,
          grossAmountCents: principal,
          estimatedEfiFeeCents: 0,
          estimatedPlatformFeeCents: Math.round(
            (principal * settings.onTimeBasisPoints) / 10000,
          ),
          feeSnapshot: {
            settingsId: settings.id,
            settingsVersion: settings.version,
          },
          distributionSnapshot: {
            issuer: 'CUSTOMER',
            distribution: 'PLATFORM_FEE_SPLIT',
            splitMechanism: 'MARKETPLACE',
          },
          lateFineBasisPoints: invoice.lateFineBasisPoints,
          lateInterestMonthlyBasisPoints:
            invoice.lateInterestMonthlyBasisPoints,
          paymentDaysAfterDue: invoice.paymentDaysAfterDue,
          gatewayStatusRaw: 'CARD_READY',
          issuedAt: new Date(),
        },
      });
      await tx.paymentChargeStatusHistory.create({
        data: {
          paymentChargeId: charge.id,
          status: 'ACTIVE',
          providerStatus: 'CARD_READY',
        },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          billingType: 'CREDIT_CARD',
          status: 'PENDING',
          gatewayStatusRaw: 'CARD_READY',
          gatewayId: null,
          efiChargeId: null,
          efiTxid: null,
          pixPayload: null,
          efiPixCopiaECola: null,
          boletoLinhaDigitavel: null,
          boletoLink: null,
          boletoPdf: null,
        },
      });
    });
    return this.links.createInvoicePaymentPage({ companyId, invoiceId });
  }

  private async assertSubmissionAvailable(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    const integration = await this.prisma.platformIntegrationState.findUnique({
      where: { integration: 'EFI_PAYMENTS' },
      select: { enabled: true },
    });
    if (company?.status !== 'ACTIVE' || !integration?.enabled)
      conflict(
        'CARD_SUBMISSION_PAUSED',
        'Pagamento por cartão temporariamente indisponível.',
      );
  }
  private async settings(identityId: string, companyId: string) {
    const settings = await this.prisma.cardPaymentSettings.findFirst({
      where: { issuerIdentityId: identityId, companyId, enabled: true },
    });
    if (!settings)
      conflict(
        'CARD_NOT_ENABLED',
        'Pagamento por cartão indisponível para esta conta.',
      );
    return settings;
  }
  private async load(token: string): Promise<CheckoutCharge> {
    const scope = this.links.verifyToken(token);
    const charge = await this.prisma.paymentCharge.findFirst({
      where: scopeKeys(scope),
      orderBy: { createdAt: 'desc' },
      include: chargeInclude,
    });
    if (!charge) throw new NotFoundException('Cobrança não encontrada.');
    if (
      charge.billingMethod !== 'CREDIT_CARD' ||
      charge.status !== 'ACTIVE' ||
      ['PAID', 'CANCELED'].includes(charge.invoice.status)
    )
      conflict(
        'CARD_INVOICE_CLOSED',
        'Pagamento por cartão indisponível para esta cobrança.',
      );
    return charge;
  }
  private amounts(charge: CheckoutCharge, now = new Date()) {
    const invoice = charge.invoice;
    const today = cardCivilDate(now);
    // Commercial due dates are represented as YYYY-MM-DD in existing issuance.
    const dueDate = invoice.dueDate.toISOString().slice(0, 10);
    const days = cardDaysBetween(dueDate, today);
    if (days > (charge.paymentDaysAfterDue ?? invoice.paymentDaysAfterDue))
      conflict('CARD_PAYMENT_EXPIRED', 'Prazo de pagamento encerrado.');
    const principalCents = Math.round(Number(invoice.originalAmount) * 100);
    const discountCents = resolveCardDiscount(
      principalCents,
      days,
      invoice.debtor,
      invoice.company,
    );
    return calculateCardDebt({
      principalCents,
      discountCents,
      dueDate,
      today,
      lateFineBasisPoints: charge.lateFineBasisPoints ?? 0,
      lateInterestMonthlyBasisPoints:
        charge.lateInterestMonthlyBasisPoints ?? 0,
    });
  }
  private fingerprint(charge: CheckoutCharge) {
    return hash({
      amounts: this.amounts(charge),
      dueDate: charge.invoice.dueDate.toISOString(),
      updatedAt: charge.invoice.updatedAt.toISOString(),
      issuer: charge.issuerIdentityId,
      day: cardCivilDate(),
    });
  }
  async quote(token: string, brand: CardBrand) {
    const charge = await this.load(token);
    const settings = await this.settings(
      charge.issuerIdentityId!,
      charge.companyId,
    );
    const open = await this.prisma.cardPaymentAttempt.findFirst({
      where: {
        paymentChargeId: charge.id,
        status: { in: ['SUBMITTING', 'UNCERTAIN', 'APPROVED', 'PAID'] },
      },
    });
    if (open)
      conflict(
        'CARD_PAYMENT_PROCESSING',
        'Um pagamento já está em processamento.',
      );
    await this.assertSubmissionAvailable(charge.companyId);
    const quotedAt = new Date();
    const fingerprint = this.fingerprint(charge);
    const amounts = this.amounts(charge, quotedAt);
    const options = await this.client.quote(
      charge.issuerIdentityId!,
      charge.companyId,
      amounts.baseDebtCents,
      brand,
      settings.processingRates as unknown as CardProcessingRate[],
    );
    if (
      fingerprint !== this.fingerprint(charge) ||
      cardCivilDate(quotedAt) !== cardCivilDate()
    )
      conflict('CARD_QUOTE_EXPIRED', 'O dia mudou. Faça uma nova simulação.');
    // Brasilia currently has a fixed UTC-03 offset; avoid a quote crossing the civil day.
    const nextDay =
      new Date(`${cardCivilDate()}T03:00:00Z`).getTime() + 86400000;
    const validUntil = new Date(Math.min(Date.now() + 600000, nextDay));
    const basisPoints =
      amounts.daysLate > 0
        ? settings.overdueBasisPoints
        : settings.onTimeBasisPoints;
    const platformFeeCents = Math.round(
      (amounts.platformFeeBaseCents * basisPoints) / 10000,
    );
    if (platformFeeCents >= amounts.baseDebtCents)
      conflict(
        'NON_POSITIVE_NET_AMOUNT',
        'Tarifa maior que o valor da dívida.',
      );
    const quote = await this.prisma.cardPaymentQuote.create({
      data: {
        companyId: charge.companyId,
        invoiceId: charge.invoiceId,
        paymentChargeId: charge.id,
        settingsId: settings.id,
        settingsVersion: settings.version,
        brand,
        fingerprint,
        amounts: {
          ...amounts,
          platformFeeBasisPoints: basisPoints,
          platformFeeCents,
        },
        options: options.map((o) => ({ ...o })),
        validUntil,
      },
    });
    return {
      quoteId: quote.id,
      validUntil: validUntil.toISOString(),
      amounts,
      options,
      payeeCode: (
        await this.client.account(charge.issuerIdentityId!, charge.companyId)
      ).identity.payeeCode,
      environment:
        charge.financialEnvironment === 'PRODUCTION' ? 'production' : 'sandbox',
    };
  }

  async pay(token: string, dto: CardPayDto, idempotencyKey: string) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey ?? ''))
      throw new BadRequestException('Chave de confirmação inválida.');
    const scope = this.links.verifyToken(token);
    if (
      !dto.customer ||
      !dto.billingAddress ||
      !validateDebtorDocument(dto.customer.cpf).valid ||
      (dto.customer.juridical_person &&
        !validateDebtorDocument(dto.customer.juridical_person.cnpj).valid)
    )
      throw new BadRequestException('Documento do pagador inválido.');
    const requestHash = hash(dto);
    const previously = await this.prisma.cardPaymentAttempt.findFirst({
      where: {
        companyId: scope.companyId,
        invoiceId: scope.invoiceId,
        idempotencyKey,
      },
    });
    if (previously) {
      if (previously.requestHash !== requestHash)
        conflict(
          'IDEMPOTENCY_CONFLICT',
          'Confirmação já utilizada com outros dados.',
        );
      return result(previously);
    }
    const charge = await this.load(token);
    await this.assertSubmissionAvailable(charge.companyId);
    // Perform all local/account validation before reserving a provider attempt.
    const { identity } = await this.client.account(
      charge.issuerIdentityId!,
      charge.companyId,
    );
    this.client.platformPayee(identity.payeeCode!);
    this.client.notificationUrl(identity.id);
    const reserved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${scope.invoiceId} AND "companyId"=${scope.companyId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PaymentCharge" WHERE id=${charge.id} FOR UPDATE`;
      const current = await tx.paymentCharge.findFirst({
        where: { id: charge.id, companyId: scope.companyId },
        include: chargeInclude,
      });
      if (
        !current ||
        current.status !== 'ACTIVE' ||
        ['PAID', 'CANCELED'].includes(current.invoice.status)
      )
        conflict('CARD_INVOICE_CLOSED', 'Cobrança encerrada.');
      const quote = await tx.cardPaymentQuote.findFirst({
        where: {
          id: dto.quoteId,
          paymentChargeId: current.id,
          companyId: scope.companyId,
        },
        include: { settings: true },
      });
      if (
        !quote ||
        quote.validUntil <= new Date() ||
        quote.fingerprint !== this.fingerprint(current) ||
        !quote.settings.enabled ||
        quote.settingsVersion !== quote.settings.version
      )
        conflict(
          'CARD_QUOTE_EXPIRED',
          'Valores atualizados. Confira uma nova simulação antes de pagar.',
        );
      await tx.$queryRaw`SELECT id FROM "CardPaymentSettings" WHERE id=${quote.settingsId} FOR SHARE`;
      const settings = await tx.cardPaymentSettings.findUniqueOrThrow({
        where: { id: quote.settingsId },
      });
      if (!settings.enabled || settings.version !== quote.settingsVersion)
        conflict(
          'CARD_QUOTE_EXPIRED',
          'Configuração atualizada. Faça nova simulação.',
        );
      const repeated = await tx.cardPaymentAttempt.findUnique({
        where: {
          paymentChargeId_idempotencyKey: {
            paymentChargeId: charge.id,
            idempotencyKey,
          },
        },
      });
      if (repeated) {
        if (repeated.requestHash !== requestHash)
          conflict('IDEMPOTENCY_CONFLICT', 'Confirmação já utilizada.');
        return { attempt: repeated, shouldSubmit: false, previous: null };
      }
      const active = await tx.cardPaymentAttempt.findFirst({
        where: {
          paymentChargeId: charge.id,
          status: { in: ['SUBMITTING', 'UNCERTAIN', 'APPROVED', 'PAID'] },
        },
      });
      if (active)
        conflict(
          'CARD_PAYMENT_PROCESSING',
          'Pagamento já está em processamento.',
        );
      const count = await tx.cardPaymentAttempt.count({
        where: {
          paymentChargeId: charge.id,
          createdAt: { gte: new Date(Date.now() - 900000) },
        },
      });
      if (count >= 5)
        conflict('CARD_ATTEMPT_LIMIT', 'Aguarde antes de tentar novamente.');
      const option = (quote.options as unknown as CardInstallmentQuote[]).find(
        (o) => o.installments === dto.installments,
      );
      if (!option)
        throw new BadRequestException('Parcelamento não disponível.');
      const amounts = quote.amounts as unknown as {
        platformFeeBaseCents: number;
        platformFeeCents: number;
        platformFeeBasisPoints: number;
        discountCents: number;
      };
      const previous = await tx.cardPaymentAttempt.findFirst({
        where: {
          paymentChargeId: charge.id,
          efiChargeId: { not: null },
          status: 'DECLINED',
        },
        orderBy: { createdAt: 'desc' },
      });
      const attempt = await tx.cardPaymentAttempt.create({
        data: {
          id: randomUUID(),
          companyId: charge.companyId,
          invoiceId: charge.invoiceId,
          paymentChargeId: charge.id,
          quoteId: quote.id,
          idempotencyKey,
          requestHash,
          installments: option.installments,
          submissionCents: option.submissionCents,
          totalCents: option.totalCents,
          efiFeeCents: option.efiFeeCents,
          platformFeeBaseCents: amounts.platformFeeBaseCents,
          platformFeeCents: amounts.platformFeeCents,
          platformFeeBasisPoints: amounts.platformFeeBasisPoints,
        },
      });
      await tx.paymentCharge.update({
        where: { id: charge.id },
        data: {
          gatewayStatusRaw: 'CARD_SUBMITTING',
          grossAmountCents: option.totalCents,
          estimatedEfiFeeCents: option.efiFeeCents,
          estimatedPlatformFeeCents: amounts.platformFeeCents,
          platformFeeBaseCents: amounts.platformFeeBaseCents,
          feeSnapshot: {
            settingsId: quote.settingsId,
            settingsVersion: quote.settingsVersion,
            brand: quote.brand,
            installments: option.installments,
            amounts: quote.amounts,
            efiFeeCents: option.efiFeeCents,
            totalCents: option.totalCents,
          },
        },
      });
      return { attempt, shouldSubmit: true, previous };
    });
    if (!reserved.shouldSubmit) return result(reserved.attempt);
    try {
      if (reserved.previous?.efiChargeId) {
        await this.client.cancel(
          charge.issuerIdentityId!,
          charge.companyId,
          reserved.previous.efiChargeId,
        );
        await this.prisma.cardPaymentAttempt.updateMany({
          where: { id: reserved.previous.id, status: 'DECLINED' },
          data: { status: 'CANCELED' },
        });
      }
      const response = await this.client.submit(
        charge.issuerIdentityId!,
        charge.companyId,
        reserved.attempt,
        dto.paymentToken,
        dto.customer,
        dto.billingAddress,
      );
      await this.observe(
        reserved.attempt.id,
        response.chargeId,
        response.status,
        response.totalCents,
        response.installments,
      );
    } catch {
      // Even a persistence failure after provider success leaves a recoverable
      // deterministic custom_id. Never release this reservation on a timeout.
      await this.prisma.cardPaymentAttempt.updateMany({
        where: { id: reserved.attempt.id, status: 'SUBMITTING' },
        data: { status: 'UNCERTAIN' },
      });
      return {
        attemptId: reserved.attempt.id,
        state: 'UNCERTAIN',
        canRetry: false,
      };
    }
    return result(
      await this.prisma.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: reserved.attempt.id },
      }),
    );
  }

  async observe(
    attemptId: string,
    providerId: string,
    status: string,
    totalCents: number,
    installments?: number,
  ) {
    const scope = await this.prisma.cardPaymentAttempt.findUnique({
      where: { id: attemptId },
      select: { companyId: true, invoiceId: true, paymentChargeId: true },
    });
    if (!scope) return false;
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${scope.invoiceId} AND "companyId"=${scope.companyId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PaymentCharge" WHERE id=${scope.paymentChargeId} FOR UPDATE`;
      const attempt = await tx.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      const latest = await tx.cardPaymentAttempt.findFirst({
        where: { paymentChargeId: attempt.paymentChargeId },
        orderBy: { createdAt: 'desc' },
      });
      let anomaly: string | null = null;
      const mapped =
        status === 'paid'
          ? 'PAID'
          : ['approved', 'waiting', 'identified'].includes(status)
            ? 'APPROVED'
            : status === 'unpaid'
              ? 'DECLINED'
              : ['canceled', 'expired'].includes(status)
                ? 'CANCELED'
                : null;
      if (
        attempt.totalCents !== totalCents ||
        (installments !== undefined && installments !== attempt.installments) ||
        (attempt.efiChargeId && attempt.efiChargeId !== providerId)
      )
        anomaly = 'CARD_AMOUNT_OR_REFERENCE_MISMATCH';
      else if (['contested', 'refunded', 'settled'].includes(status))
        anomaly = `CARD_${status.toUpperCase()}_REVIEW_REQUIRED`;
      else if (!mapped) anomaly = 'CARD_STATUS_UNKNOWN';
      else if (
        latest?.id !== attempt.id &&
        (mapped === 'PAID' || mapped === 'APPROVED')
      )
        anomaly = 'CARD_OLD_ATTEMPT_PAYMENT';
      if (anomaly) {
        await tx.cardPaymentAttempt.updateMany({
          where: { id: attempt.id, status: 'SUBMITTING' },
          data: {
            status: 'UNCERTAIN',
            efiChargeId: attempt.efiChargeId ?? providerId,
          },
        });
        return { attempt, anomaly, settle: false };
      }
      // A late submission response cannot undo provider approval or settlement.
      if (
        (attempt.status === 'PAID' && mapped !== 'PAID') ||
        (attempt.status === 'APPROVED' && mapped === 'DECLINED') ||
        latest?.id !== attempt.id
      )
        return { attempt, anomaly: null, settle: false };
      await tx.cardPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: mapped!,
          efiChargeId: providerId,
          providerStatus: status,
        },
      });
      await tx.paymentCharge.updateMany({
        where: { id: attempt.paymentChargeId, status: { not: 'PAID' } },
        data: {
          efiChargeId: providerId,
          gatewayId: providerId,
          gatewayStatusRaw: status,
        },
      });
      return { attempt, anomaly: null, settle: mapped === 'PAID' };
    });
    if (outcome.anomaly) await this.anomaly(outcome.attempt, outcome.anomaly);
    if (outcome.settle) {
      const current = await this.prisma.paymentCharge.findUniqueOrThrow({
        where: { id: scope.paymentChargeId },
      });
      if (
        await this.charges.recordSettlement(current, null, 'paid', totalCents, {
          source: 'PROVIDER_RECONCILIATION',
          reference: `efi-card:${providerId}`,
        })
      )
        await this.notifications.notifyPaidInvoice(
          scope.companyId,
          scope.invoiceId,
        );
    }
    return !outcome.anomaly;
  }
  private async anomaly(
    attempt: Pick<CardPaymentAttempt, 'id' | 'companyId' | 'invoiceId'>,
    code: string,
  ) {
    await this.prisma.paymentWebhookAnomaly.upsert({
      where: {
        source_externalReference_reasonCode: {
          source: 'CARD',
          externalReference: attempt.id,
          reasonCode: code,
        },
      },
      create: {
        source: 'CARD',
        externalReference: attempt.id,
        reasonCode: code,
        companyId: attempt.companyId,
      },
      update: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
    });
  }
  async reconcileAttempt(
    attemptId: string,
    companyId: string,
    providerHint?: string,
  ) {
    const attempt = await this.prisma.cardPaymentAttempt.findFirst({
      where: { id: attemptId, companyId },
      include: { paymentCharge: true },
    });
    if (!attempt) throw new NotFoundException('Tentativa não encontrada.');
    const identityId = attempt.paymentCharge.issuerIdentityId!;
    let id = attempt.efiChargeId ?? providerHint;
    if (!id) {
      const listing = (await this.client.findAttempt(
        identityId,
        companyId,
        attempt.id,
        attempt.createdAt,
      )) as {
        data?: Array<{ id?: number; charge_id?: number; custom_id?: string }>;
      };
      const matches =
        listing.data?.filter((r) => r.custom_id === attempt.id) ?? [];
      if (matches.length !== 1)
        return { state: attempt.status, reviewRequired: true };
      id = String(matches[0]!.id ?? matches[0]!.charge_id);
    }
    const raw = (await this.client.detail(identityId, companyId, id)) as {
      data?: {
        charge_id?: number;
        custom_id?: string;
        status?: string;
        total?: number;
        payment?: {
          method?: string;
          credit_card?: { installments?: number; installment_value?: number };
        };
      };
    };
    const data = raw.data;
    if (
      !data ||
      String(data.charge_id) !== id ||
      data.custom_id !== attempt.id ||
      data.payment?.method !== 'credit_card'
    ) {
      await this.anomaly(attempt, 'CARD_DETAIL_MISMATCH');
      return { state: attempt.status, reviewRequired: true };
    }
    const card = data.payment.credit_card;
    if (
      card?.installments !== undefined &&
      card.installments !== attempt.installments
    ) {
      await this.anomaly(attempt, 'CARD_INSTALLMENTS_MISMATCH');
      return { state: attempt.status, reviewRequired: true };
    }
    const total =
      card &&
      Number.isSafeInteger(card.installments) &&
      Number.isSafeInteger(card.installment_value)
        ? card.installments! * card.installment_value!
        : data.total;
    if (!Number.isSafeInteger(total)) {
      await this.anomaly(attempt, 'CARD_AMOUNT_MISSING');
      return { state: attempt.status, reviewRequired: true };
    }
    const verified = await this.observe(
      attempt.id,
      id,
      data.status ?? '',
      total!,
    );
    const updated = await this.prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    return {
      ...result(updated),
      reviewRequired:
        !verified ||
        ![
          'paid',
          'waiting',
          'approved',
          'identified',
          'unpaid',
          'canceled',
          'expired',
        ].includes(data.status ?? ''),
    };
  }
  async handleEvent(
    identityId: string,
    customId: string | undefined,
    providerId: string | undefined,
  ) {
    const attempt = await this.prisma.cardPaymentAttempt.findFirst({
      where: {
        ...(customId ? { id: customId } : { efiChargeId: providerId ?? '' }),
        paymentCharge: { issuerIdentityId: identityId },
      },
    });
    if (!attempt) return false;
    if (
      providerId &&
      attempt.efiChargeId &&
      providerId !== attempt.efiChargeId
    ) {
      await this.anomaly(attempt, 'CARD_WEBHOOK_ACCOUNT_MISMATCH');
      return true;
    }
    // Read back the canonical current state; an event's status may be stale.
    await this.reconcileAttempt(attempt.id, attempt.companyId, providerId);
    return true;
  }
}
function scopeKeys(scope: { companyId: string; invoiceId: string }) {
  return { companyId: scope.companyId, invoiceId: scope.invoiceId };
}
