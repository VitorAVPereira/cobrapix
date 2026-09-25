import { assertNewBillingMethod } from '../payment/billing-method-policy';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayAccount, InvoiceStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import EfiPay from 'sdk-node-apis-efi';
import { validateDebtorDocument } from '../common/debtor-document';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGatewayAccountDto } from './dto/gateway-account.dto';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsService } from './payment-notifications.service';
import { GatewayHealthService } from './gateway-health.service';
import { PaymentChargeService } from './payment-charge.service';
import { matchesBoletoMode } from './efi-boleto-mode';
import type { IssuanceContext } from '../financial-activation/financial-eligibility.service';

type EfiEnvironment = 'homologation' | 'production';
type BillingType = 'PIX' | 'BOLETO' | 'BOLIX';
type PixCreateDueChargeBody = Parameters<EfiPay['pixCreateDueCharge']>[1];

interface EfiCredentials {
  clientId: string;
  clientSecret: string;
  certificate?: string;
  certificateIsBase64: boolean;
}

interface EfiPixCobvResponse {
  txid?: string;
  loc?: {
    id?: number;
    location?: string;
  };
  location?: string;
  pixCopiaECola?: string;
  status?: string;
}

interface EfiPixQrCodeResponse {
  qrcode?: string;
  imagemQrcode?: string;
}

interface EfiSplitConfigResponse {
  id?: string;
  splitConfigId?: string;
}

interface EfiChargeResponse {
  code?: number;
  data?: {
    charge_id?: number;
    status?: string;
    barcode?: string;
    link?: string;
    billet_link?: string;
    pdf?: {
      charge?: string;
    };
    pix?: {
      qrcode?: string;
      qrcode_image?: string;
    };
  };
}

interface EfiNotificationResponse {
  data?: Array<{
    custom_id?: string | null;
    identifiers?: {
      charge_id?: number;
    };
    status?: {
      current?: string;
    };
    // Amount paid, in cents, on "paid" events (includes fine and interest).
    value?: number;
  }>;
}

interface EfiErrorResponse {
  nome?: string;
  mensagem?: string;
  message?: string;
  error?: string;
  error_description?: string;
  title?: string;
  detail?: string;
  violacoes?: Array<{
    razao?: string;
    propriedade?: string;
  }>;
}

interface PixCobvDebtorAddress {
  logradouro: string;
  cidade: string;
  uf: string;
  cep: string;
}

interface PixCobvDebtorPayload {
  nome: string;
  cpf?: string;
  cnpj?: string;
  logradouro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

interface PaymentInvoice {
  id: string;
  companyId: string;
  originalAmount: unknown;
  dueDate: Date;
  gatewayId: string | null;
  efiTxid: string | null;
  efiChargeId: string | null;
  efiPixCopiaECola: string | null;
  boletoLinhaDigitavel: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
  pixExpiresAt: Date | null;
  debtor: {
    name: string;
    document: string | null;
    email: string | null;
    phoneNumber: string;
    useGlobalBillingSettings: boolean;
    collectionReminderDays: number[];
    autoDiscountEnabled: boolean | null;
    autoDiscountDaysAfterDue: number | null;
    autoDiscountPercentage: { toNumber(): number } | null;
  };
  company: {
    addressPostalCode: string | null;
    addressStreet: string | null;
    addressNumber: string | null;
    addressDistrict: string | null;
    addressCity: string | null;
    addressState: string | null;
    collectionReminderDays: number[];
    autoDiscountEnabled: boolean;
    autoDiscountDaysAfterDue: number | null;
    autoDiscountPercentage: { toNumber(): number } | null;
  };
}

interface ResolvedDiscountSettings {
  enabled: boolean;
  daysAfterDue: number | null;
  percentage: number | null;
}

export interface EfiPaymentResult {
  gatewayId: string;
  txid?: string;
  chargeId?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  boletoCode?: string;
  boletoLink?: string;
  boletoPdf?: string;
  expiresAt: Date;
  paymentLink: string;
  splitConfigId?: string;
}

export interface EfiIssuanceContext {
  chargeId: string;
  platformFeeKind: 'FIXED' | 'PERCENTAGE';
  platformFeeAmountCents: number;
  platformFeeBasisPoints: number;
  grossAmountCents: number;
  // Account recorded on the charge before any provider call.
  issuerIdentityId: string;
}

// Account an Efí operation runs with: the charge's issuer identity and its
// current ACTIVE credential, or, for charges issued before financial
// profiles existed, the company's gateway account.
type EfiAccountRef = Pick<
  GatewayAccount,
  | 'companyId'
  | 'environment'
  | 'pixKey'
  | 'efiAccountNumber'
  | 'payeeCode'
  | 'encryptedClientId'
  | 'encryptedClientSecret'
  | 'encryptedCertificate'
  | 'encryptedCertificatePassword'
  | 'certificatePath'
> & { issuerIdentityId: string | null };

@Injectable()
export class EfiService {
  private readonly logger = new Logger(EfiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly paymentNotifications: PaymentNotificationsService,
    @Inject(GatewayHealthService)
    private readonly gatewayHealth: GatewayHealthService | null,
    private readonly charges: PaymentChargeService,
  ) {}

  async upsertManualGatewayAccount(
    companyId: string,
    dto: CreateGatewayAccountDto,
  ): Promise<void> {
    void companyId;
    void dto;
    await Promise.resolve();
    throw new HttpException(
      {
        code: 'EFI_ONBOARDING_REQUIRED',
        message:
          'Utilize a ativação automática ou a recuperação administrativa validada.',
      },
      403,
    );
  }
  async assertIssuable(
    companyId: string,
    method?: BillingType,
  ): Promise<IssuanceContext> {
    if (!this.gatewayHealth)
      throw new HttpException(
        {
          code: 'EFI_ONBOARDING_REQUIRED',
          message: 'Ativação financeira necessária.',
        },
        409,
      );
    return this.gatewayHealth.assertIssuable(companyId, method);
  }

  async createPayment(
    invoiceId: string,
    companyId: string,
    billingType: BillingType,
    issuance?: EfiIssuanceContext,
  ): Promise<EfiPaymentResult> {
    assertNewBillingMethod(billingType);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { debtor: true, company: true },
    });

    if (!invoice) {
      throw new HttpException('Fatura não encontrada', HttpStatus.NOT_FOUND);
    }

    if (!this.gatewayHealth || !issuance)
      throw new HttpException(
        {
          code: 'EFI_ONBOARDING_REQUIRED',
          message: 'A emissão exige ativação e uma tarifa fotografada.',
        },
        409,
      );
    await this.gatewayHealth.assertIssuable(companyId, billingType);
    // Never the company's "current" account: the one recorded on the charge.
    const account = await this.accountForIdentity(
      issuance.issuerIdentityId,
      companyId,
    );

    if (billingType === 'BOLETO' || billingType === 'BOLIX') {
      return this.createBoleto(invoice, account, billingType, issuance);
    }

    return this.createPixCobv(invoice, account, issuance);
  }

  async cancelPixDueCharge(companyId: string, txid: string): Promise<string> {
    const account = await this.accountForCharge({ companyId, efiTxid: txid });
    this.ensurePixCertificate(account);

    const client = this.createSdkClient(account);
    const response = await this.runEfiRequest(
      () =>
        client.pixUpdateDueCharge(
          { txid },
          { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' },
        ),
      'cancelar Pix CobV',
    );

    return response.status ?? 'REMOVIDA_PELO_USUARIO_RECEBEDOR';
  }

  async cancelCharge(companyId: string, chargeId: string): Promise<string> {
    const account = await this.accountForCharge({
      companyId,
      efiChargeId: chargeId,
    });
    const client = this.createSdkClient(account);

    await this.runEfiRequest(
      () => client.cancelCharge({ id: chargeId }),
      'cancelar boleto/Bolix',
    );

    return 'canceled';
  }

  async reconcileCharge(
    companyId: string,
    chargeId: string,
    actorId: string,
  ): Promise<{ status: string }> {
    const charge = await this.prisma.paymentCharge.findFirst({
      where: { id: chargeId, companyId },
    });
    if (!charge) throw new HttpException('Cobrança não encontrada.', 404);
    // Persist intent before the provider read so failures are audited too.
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: actorId,
        entityType: 'PaymentCharge',
        entityId: chargeId,
        action: 'EFI_ADMIN_RECONCILE_CHARGE',
        retentionExpiresAt: new Date(Date.now() + 5 * 365.25 * 86400_000),
      },
    });
    if (!charge.efiTxid && !charge.efiChargeId)
      return { status: 'REVIEW_REQUIRED' };
    const account = charge.issuerIdentityId
      ? await this.accountForIdentity(charge.issuerIdentityId, companyId)
      : await this.legacyAccount(companyId, false);
    const client = this.createSdkClient(account);
    const response: unknown = await this.runEfiRequest(
      () =>
        charge.efiTxid
          ? client.pixDetailDueCharge({ txid: charge.efiTxid })
          : (
              client as EfiPay & {
                detailCharge(params: { id: string }): Promise<unknown>;
              }
            ).detailCharge({ id: charge.efiChargeId! }),
      'conciliar cobrança',
    );
    const data = this.isRecord(response)
      ? charge.efiTxid
        ? response
        : response.data
      : null;
    if (
      !this.isRecord(data) ||
      (charge.efiTxid
        ? data.txid !== charge.efiTxid
        : String(data.charge_id) !== charge.efiChargeId)
    )
      throw new HttpException('Resposta de conciliação inválida.', 502);
    const providerStatus = typeof data.status === 'string' ? data.status : '';
    // Pix detail may include refund events; inspect those before interpreting CONCLUIDA.
    const receipts = Array.isArray(data.pix)
      ? data.pix.filter((entry: unknown) => this.isRecord(entry))
      : [];
    const hasRefund = receipts.some(
      (entry) => Array.isArray(entry.devolucoes) && entry.devolucoes.length > 0,
    );
    if (hasRefund) {
      const refunds = receipts.flatMap((entry) =>
        Array.isArray(entry.devolucoes)
          ? entry.devolucoes.flatMap((refund: unknown) => {
              if (!this.isRecord(refund) || refund.status !== 'DEVOLVIDO')
                return [];
              const amountCents = this.providerAmountCents(refund.valor);
              if (
                typeof entry.endToEndId !== 'string' ||
                typeof refund.id !== 'string' ||
                amountCents === null
              )
                throw new HttpException('Devolução Pix inválida.', 502);
              return [
                {
                  providerRefundId: entry.endToEndId + ':' + refund.id,
                  amountCents,
                },
              ];
            })
          : [],
      );
      return refunds.length
        ? { status: await this.charges.recordPixRefunds(charge, refunds) }
        : { status: 'REVIEW_REQUIRED' };
    }
    if (
      providerStatus === 'CONCLUIDA' ||
      providerStatus === 'paid' ||
      providerStatus === 'settled'
    ) {
      const paidCents = receipts.reduce<number | null>((total, entry) => {
        const amount = this.providerAmountCents(entry.valor);
        return amount === null ? total : (total ?? 0) + amount;
      }, null);
      const newlyPaid = await this.charges.recordSettlement(
        charge,
        null,
        providerStatus,
        paidCents,
      );
      if (newlyPaid)
        await this.paymentNotifications.notifyPaidInvoice(
          companyId,
          charge.invoiceId,
        );
      return { status: 'PAID' };
    }
    const target =
      providerStatus === 'refunded'
        ? 'REFUNDED'
        : providerStatus === 'expired'
          ? 'EXPIRED'
          : [
                'canceled',
                'expired',
                'unpaid',
                'REMOVIDA_PELO_USUARIO_RECEBEDOR',
                'REMOVIDA_PELO_PSP',
              ].includes(providerStatus)
            ? 'CANCELED'
            : null;
    if (!target) return { status: 'REVIEW_REQUIRED' };
    await this.charges.transition(
      charge.id,
      companyId,
      target,
      { gatewayStatusRaw: providerStatus, canceledAt: new Date() },
      providerStatus,
    );
    return { status: target };
  }

  async handlePixWebhook(payload: unknown): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: InvoiceStatus;
  }> {
    const events = this.extractPixEvents(payload);

    if (events.length === 0) {
      this.logger.warn('Webhook Efi Pix sem txid processavel');
      return { processed: false };
    }

    let processed = false;
    let lastInvoiceId: string | undefined;
    let lastStatus: InvoiceStatus | undefined;

    for (const event of events) {
      const txid = event.txid;
      const paymentCharge = await this.prisma.paymentCharge?.findFirst({
        where: { efiTxid: txid },
      });
      const invoice = paymentCharge
        ? await this.prisma.invoice.findFirst({
            where: {
              id: paymentCharge.invoiceId,
              companyId: paymentCharge.companyId,
            },
          })
        : await this.prisma.invoice.findFirst({ where: { efiTxid: txid } });

      if (!invoice) {
        this.logger.warn('Webhook Efi Pix sem fatura para o txid');
        await this.recordWebhookAnomaly('PIX', 'UNKNOWN_TXID', txid);
        continue;
      }
      // The notification must come from the key of the account that issued it.
      if (
        paymentCharge?.issuerIdentityId &&
        !(await this.pixReceiverMatches(paymentCharge.issuerIdentityId, event))
      ) {
        await this.recordWebhookAnomaly(
          'PIX',
          'RECEIVER_MISMATCH',
          txid,
          paymentCharge.companyId,
        );
        continue;
      }

      if (paymentCharge?.status === 'REFUNDED') continue;
      const refunds = Array.isArray(event.devolucoes)
        ? event.devolucoes.flatMap((refund: unknown) => {
            if (!this.isRecord(refund) || refund.status !== 'DEVOLVIDO')
              return [];
            const amountCents = this.providerAmountCents(refund.valor);
            if (
              typeof refund.id !== 'string' ||
              typeof event.endToEndId !== 'string' ||
              amountCents === null
            )
              throw new HttpException('Devolução Pix inválida.', 400);
            return [
              {
                providerRefundId: event.endToEndId + ':' + refund.id,
                amountCents,
              },
            ];
          })
        : [];
      if (paymentCharge && refunds.length) {
        const status = await this.charges.recordPixRefunds(
          paymentCharge,
          refunds,
        );
        processed = true;
        lastInvoiceId = invoice.id;
        lastStatus = status === 'REFUNDED' ? 'CANCELED' : 'PAID';
        continue;
      }
      // A refund notification is not a second receipt, including rejected/pending refunds.
      if (Array.isArray(event.devolucoes) && event.devolucoes.length) continue;
      if (paymentCharge) {
        const effectiveFee = this.isRecord(event.gnExtras)
          ? this.providerAmountCents(event.gnExtras.tarifa)
          : null;
        const newlyPaid = await this.charges.recordSettlement(
          paymentCharge,
          effectiveFee,
          'CONCLUIDA',
          this.providerAmountCents(event.valor),
        );
        if (newlyPaid)
          await this.paymentNotifications.notifyPaidInvoice(
            invoice.companyId,
            invoice.id,
          );
        processed = true;
        lastInvoiceId = invoice.id;
        lastStatus = newlyPaid ? 'PAID' : invoice.status;
        continue;
      }
      await this.markInvoice(invoice.id, invoice.companyId, 'PAID', {
        actionType: 'EFI_PIX_WEBHOOK',
        description: `Pix Efi confirmado para txid ${txid}`,
        gatewayStatusRaw: 'CONCLUIDA',
      });
      processed = true;
      lastInvoiceId = invoice.id;
      lastStatus = 'PAID';
    }

    return { processed, invoiceId: lastInvoiceId, status: lastStatus };
  }

  async handleChargesWebhook(
    payload: unknown,
    companyId?: string,
    accountId?: string,
  ): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: InvoiceStatus;
  }> {
    const notification = this.extractNotificationToken(payload);

    if (!notification) {
      this.logger.warn('Webhook Efi Cobrancas sem notification');
      return { processed: false };
    }

    // New charges name their issuing account in the notification URL; it only
    // selects whose credentials query Efí. Legacy charges keep the old path.
    let account: EfiAccountRef;
    let legacyCompanyId: string | null = null;
    if (accountId) {
      const identity = await this.prisma.efiAccountIdentity.findUnique({
        where: { id: accountId },
        select: { companyId: true },
      });
      if (!identity?.companyId) {
        await this.recordWebhookAnomaly(
          'CHARGES',
          'UNKNOWN_ACCOUNT',
          accountId,
        );
        return { processed: false };
      }
      account = await this.accountForIdentity(accountId, identity.companyId);
    } else {
      const gatewayAccount = companyId
        ? await this.prisma.gatewayAccount.findFirst({
            where: { companyId, provider: 'EFI' },
          })
        : await this.findGatewayAccountByNotification(notification);
      if (!gatewayAccount) {
        this.logger.warn('Webhook Efi Cobrancas sem conta Efi relacionada');
        return { processed: false };
      }
      account = { ...gatewayAccount, issuerIdentityId: null };
      legacyCompanyId = gatewayAccount.companyId;
    }

    const client = this.createSdkClient(account);
    const response = await this.runEfiRequest(
      () => client.getNotification({ token: notification }),
      'consultar notificacao de cobranca',
    );
    const data = response as EfiNotificationResponse;
    const event = data.data?.at(-1);

    if (!event || (!event.custom_id && !event.identifiers?.charge_id)) {
      return { processed: false };
    }

    // The charge must have been issued by the account that was queried.
    const scope = account.issuerIdentityId
      ? { issuerIdentityId: account.issuerIdentityId }
      : { companyId: legacyCompanyId ?? '', financialProfileId: null };
    const paymentCharge = event.custom_id
      ? await this.prisma.paymentCharge.findFirst({
          where: { id: event.custom_id, ...scope },
        })
      : await this.prisma.paymentCharge.findFirst({
          where: {
            efiChargeId: event.identifiers?.charge_id?.toString(),
            ...scope,
          },
        });
    if (!paymentCharge && account.issuerIdentityId) {
      await this.recordWebhookAnomaly(
        'CHARGES',
        'UNKNOWN_CHARGE',
        String(event.custom_id ?? event.identifiers?.charge_id),
        account.companyId,
      );
      return { processed: false };
    }
    const ownerCompanyId = paymentCharge?.companyId ?? legacyCompanyId ?? '';
    const invoice = paymentCharge
      ? await this.prisma.invoice.findFirst({
          where: { id: paymentCharge.invoiceId, companyId: ownerCompanyId },
        })
      : event.custom_id
        ? await this.prisma.invoice.findFirst({
            where: { id: event.custom_id, companyId: ownerCompanyId },
          })
        : await this.prisma.invoice.findFirst({
            where: {
              efiChargeId: event.identifiers?.charge_id?.toString(),
              companyId: ownerCompanyId,
            },
          });

    if (!invoice) {
      return { processed: false };
    }

    const mappedStatus = this.mapChargeStatus(event.status?.current);

    if (!mappedStatus) {
      if (paymentCharge) return { processed: true, invoiceId: invoice.id };
      await this.prisma.invoice.updateMany({
        where: { id: invoice.id, companyId: ownerCompanyId },
        data: {
          notificationToken: notification,
          gatewayStatusRaw: event.status?.current,
        },
      });
      return { processed: true, invoiceId: invoice.id };
    }

    if (paymentCharge) {
      const providerStatus = event.status?.current ?? '';
      if (paymentCharge.status === 'REFUNDED' && providerStatus !== 'refunded')
        return { processed: true, invoiceId: invoice.id };
      if (mappedStatus === 'PAID') {
        const newlyPaid = await this.charges.recordSettlement(
          paymentCharge,
          null,
          providerStatus,
          Number.isSafeInteger(event.value) && event.value! > 0
            ? event.value!
            : null,
        );
        if (newlyPaid)
          await this.paymentNotifications.notifyPaidInvoice(
            invoice.companyId,
            invoice.id,
          );
        return {
          processed: true,
          invoiceId: invoice.id,
          status: newlyPaid ? 'PAID' : invoice.status,
        };
      } else
        await this.charges.transition(
          paymentCharge.id,
          paymentCharge.companyId,
          providerStatus === 'refunded'
            ? 'REFUNDED'
            : providerStatus === 'expired'
              ? 'EXPIRED'
              : 'CANCELED',
          {
            gatewayStatusRaw: providerStatus,
            canceledAt: paymentCharge.canceledAt ?? new Date(),
          },
          providerStatus,
        );
      return { processed: true, invoiceId: invoice.id };
    }
    await this.markInvoice(invoice.id, invoice.companyId, mappedStatus, {
      actionType: 'EFI_CHARGES_WEBHOOK',
      description: `Boleto/Bolix Efi atualizado para ${event.status?.current}`,
      gatewayStatusRaw: event.status?.current,
      notificationToken: notification,
    });

    return { processed: true, invoiceId: invoice.id, status: mappedStatus };
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('PAYMENT_ENCRYPTION_KEYS') ||
      this.config.get<string>('PAYMENT_SECRET_KEY'),
    );
  }

  getEnvironment(value?: string): EfiEnvironment {
    return value === 'production' ? 'production' : 'homologation';
  }

  private async createPixCobv(
    invoice: PaymentInvoice,
    gatewayAccount: EfiAccountRef,
    issuance?: EfiIssuanceContext,
  ): Promise<EfiPaymentResult> {
    const existing = issuance ? null : this.buildExistingPixResult(invoice);
    if (existing) {
      return existing;
    }

    this.ensurePixCertificate(gatewayAccount);

    const client = this.createSdkClient(gatewayAccount);
    const txid = this.generateTxid(issuance?.chargeId ?? invoice.id);
    const dueDate = this.formatDate(invoice.dueDate);
    const amount = this.formatAmount(invoice.originalAmount);
    const discountSettings: ResolvedDiscountSettings = {
      enabled: false,
      daysAfterDue: null,
      percentage: null,
    };
    const cobvPayload = {
      calendario: {
        dataDeVencimento: dueDate,
        validadeAposVencimento: 0,
      },
      devedor: this.buildPixDebtorPayload(invoice),
      valor: {
        original: amount,
        ...(discountSettings.enabled
          ? {
              desconto: {
                modalidade: 3,
                valorPerc: this.formatPercentage(discountSettings.percentage),
              },
            }
          : {}),
      },
      chave: gatewayAccount.pixKey,
      solicitacaoPagador: `Cobranca ${invoice.id.slice(0, 8)}`,
    };

    const splitConfigId = await this.createPixSplitConfig(
      client,
      gatewayAccount,
      txid,
      issuance,
    );

    await this.runIssuanceRequest(
      () =>
        client.pixCreateDueCharge(
          { txid },
          cobvPayload as unknown as PixCreateDueChargeBody,
        ),
      'criar Pix CobV',
    );

    const detail = (await this.runEfiRequest(
      () => client.pixDetailDueCharge({ txid }),
      'consultar Pix CobV',
    )) as EfiPixCobvResponse;

    if (splitConfigId) {
      await this.runEfiRequest(
        () => client.pixSplitLinkDueCharge({ txid, splitConfigId }),
        'vincular split Pix CobV',
      );
    }

    const locId = detail.loc?.id;
    const qrCode = locId
      ? ((await this.runEfiRequest(
          () => client.pixGenerateQRCode({ id: locId }),
          'gerar QR Code Pix CobV',
        )) as EfiPixQrCodeResponse)
      : null;
    const pixCopyPaste = qrCode?.qrcode ?? detail.pixCopiaECola ?? '';
    const expiresAt = new Date(invoice.dueDate);
    expiresAt.setDate(expiresAt.getDate() + 1);

    await this.prisma.invoice.updateMany({
      where: {
        id: invoice.id,
        companyId: invoice.companyId,
        status: { in: ['DRAFT', 'PENDING'] },
      },
      data: {
        gatewayId: txid,
        billingType: 'PIX',
        status: 'PENDING',
        pixPayload: pixCopyPaste,
        pixExpiresAt: expiresAt,
        efiTxid: txid,
        efiLocId: detail.loc?.id?.toString(),
        efiPixCopiaECola: pixCopyPaste,
        splitConfigId,
        gatewayStatusRaw: detail.status,
        discountApplied: this.calculateDiscountAmount(
          invoice.originalAmount,
          discountSettings.percentage,
        ),
      },
    });

    await this.createLog(
      invoice.companyId,
      invoice.id,
      'EFI_PIX_CREATED',
      'Pix CobV Efi criado com split automatico',
      'PENDING',
    );

    return {
      gatewayId: txid,
      txid,
      pixCopyPaste,
      pixQrCode: qrCode?.imagemQrcode,
      expiresAt,
      paymentLink: detail.loc?.location ?? detail.location ?? '',
      splitConfigId: splitConfigId ?? undefined,
    };
  }

  private async createBoleto(
    invoice: PaymentInvoice,
    gatewayAccount: EfiAccountRef,
    billingType: 'BOLETO' | 'BOLIX',
    issuance?: EfiIssuanceContext,
  ): Promise<EfiPaymentResult> {
    const existing = issuance ? null : this.buildExistingBoletoResult(invoice);
    if (existing) {
      return existing;
    }

    const client = this.createSdkClient(gatewayAccount);
    // The notification names the issuing account; the company comes from the
    // charge linked to it, never from the URL.
    const webhookUrl = this.buildWebhookUrl(
      '/webhooks/efi/cobrancas',
      gatewayAccount.issuerIdentityId
        ? { account: gatewayAccount.issuerIdentityId }
        : { companyId: invoice.companyId },
    );
    const customer = this.buildBoletoCustomer(invoice);
    const marketplaceRepasses = this.buildBoletoMarketplaceRepasses(
      gatewayAccount,
      issuance,
    );
    const discountSettings: ResolvedDiscountSettings = {
      enabled: false,
      daysAfterDue: null,
      percentage: null,
    };
    const boletoDiscount =
      discountSettings.enabled && discountSettings.percentage !== null
        ? {
            conditional_discount: {
              type: 'percentage' as const,
              value: discountSettings.percentage,
              until_date: this.formatDate(
                this.addDays(
                  invoice.dueDate,
                  discountSettings.daysAfterDue ?? 0,
                ),
              ),
            },
          }
        : {};
    const payload = {
      items: [
        {
          name: `Cobranca ${invoice.id.slice(0, 8)}`,
          value: Math.round(Number(invoice.originalAmount) * 100),
          amount: 1,
          ...(marketplaceRepasses.length > 0
            ? {
                marketplace: {
                  mode: 1 as const,
                  repasses: marketplaceRepasses,
                },
              }
            : {}),
        },
      ],
      payment: {
        banking_billet: {
          expire_at: this.formatDate(invoice.dueDate),
          customer,
          ...boletoDiscount,
        },
      },
      metadata: {
        custom_id: issuance?.chargeId ?? invoice.id,
        notification_url: webhookUrl,
      },
    };

    const charge = (await this.runIssuanceRequest(
      () => client.createOneStepCharge({}, payload),
      'criar boleto',
    )) as EfiChargeResponse;

    const chargeData = charge.data;
    const chargeId = chargeData?.charge_id?.toString();
    if (!chargeId) {
      throw new HttpException(
        'Efi nao retornou charge_id para o boleto.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const boletoLink = chargeData?.billet_link ?? chargeData?.link ?? '';
    const boletoPdf = chargeData?.pdf?.charge ?? '';
    const boletoCode = chargeData?.barcode ?? '';

    if (issuance)
      await this.charges.transition(
        issuance.chargeId,
        invoice.companyId,
        'PENDING',
        {
          gatewayId: chargeId,
          efiChargeId: chargeId,
        },
      );
    if (!matchesBoletoMode(billingType, chargeData?.pix?.qrcode)) {
      if (issuance)
        await this.charges.transition(
          issuance.chargeId,
          invoice.companyId,
          'PENDING',
          { gatewayStatusRaw: 'EFI_BILLING_MODE_MISMATCH' },
        );
      await this.createLog(
        invoice.companyId,
        invoice.id,
        'EFI_BILLING_MODE_MISMATCH',
        'A modalidade retornada pela Efí não corresponde à tarifa solicitada. Revisar a configuração da conta e a emissão no painel Efí.',
        'REVIEW_REQUIRED',
      );
      throw new HttpException(
        {
          code: 'EFI_BILLING_MODE_MISMATCH',
          message:
            'A modalidade da conta Efí precisa de revisão. A emissão foi preservada para conciliação e não será repetida.',
        },
        503,
      );
    }

    await this.prisma.invoice.updateMany({
      where: {
        id: invoice.id,
        companyId: invoice.companyId,
        status: { in: ['DRAFT', 'PENDING'] },
      },
      data: {
        gatewayId: chargeId,
        billingType,
        status: 'PENDING',
        pixExpiresAt: invoice.dueDate,
        efiChargeId: chargeId,
        boletoLinhaDigitavel: boletoCode,
        boletoLink,
        boletoPdf,
        efiPixCopiaECola: chargeData?.pix?.qrcode,
        gatewayStatusRaw: chargeData?.status,
        discountApplied: this.calculateDiscountAmount(
          invoice.originalAmount,
          discountSettings.percentage,
        ),
      },
    });

    await this.createLog(
      invoice.companyId,
      invoice.id,
      billingType === 'BOLIX' ? 'EFI_BOLIX_CREATED' : 'EFI_BOLETO_CREATED',
      billingType === 'BOLIX'
        ? 'Bolix Efi criado com split automatico'
        : 'Boleto Efi criado com split automatico',
      'PENDING',
    );

    return {
      gatewayId: chargeId,
      chargeId,
      boletoCode,
      boletoLink,
      boletoPdf,
      pixCopyPaste: chargeData?.pix?.qrcode,
      pixQrCode: chargeData?.pix?.qrcode_image,
      expiresAt: invoice.dueDate,
      paymentLink: boletoLink,
    };
  }

  private async createPixSplitConfig(
    client: EfiPay,
    gatewayAccount: EfiAccountRef,
    txid: string,
    issuance?: EfiIssuanceContext,
  ): Promise<string | null> {
    if (
      !issuance ||
      (issuance.platformFeeAmountCents === 0 &&
        issuance.platformFeeBasisPoints === 0)
    ) {
      return null;
    }
    const platformAccount = this.config.get<string>(
      'EFI_PLATFORM_ACCOUNT_NUMBER',
    );
    const platformCnpj = this.config.get<string>('EFI_PLATFORM_CNPJ');
    if (
      !platformAccount ||
      !platformCnpj ||
      platformAccount === gatewayAccount.efiAccountNumber
    ) {
      throw new HttpException(
        'Conta e CNPJ da plataforma não configurados para split Pix.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const fixed = issuance.platformFeeKind === 'FIXED';
    const clientValue = fixed
      ? this.formatCents(
          issuance.grossAmountCents - issuance.platformFeeAmountCents,
        )
      : this.formatBasisPointsAsPercent(
          10_000 - issuance.platformFeeBasisPoints,
        );
    const platformValue = fixed
      ? this.formatCents(issuance.platformFeeAmountCents)
      : this.formatBasisPointsAsPercent(issuance.platformFeeBasisPoints);

    const response = (await this.runEfiRequest(
      () =>
        client.pixSplitConfigId(
          { id: issuance.chargeId.replace(/-/g, '').slice(0, 32) },
          {
            descricao: `Split invoice ${txid}`,
            lancamento: {
              imediato: true,
            },
            split: {
              divisaoTarifa: 'assumir_total',
              minhaParte: {
                tipo: fixed ? 'fixo' : 'porcentagem',
                valor: clientValue,
              },
              repasses: [
                {
                  tipo: fixed ? 'fixo' : 'porcentagem',
                  valor: platformValue,
                  favorecido: {
                    conta: platformAccount,
                    cnpj: platformCnpj.replace(/\D/g, ''),
                  },
                },
              ],
            },
          },
        ),
      'criar configuracao de split Pix',
    )) as EfiSplitConfigResponse;

    const splitConfigId = response.id ?? response.splitConfigId;
    if (!splitConfigId) {
      throw new HttpException(
        'Efi nao retornou splitConfigId.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return splitConfigId;
  }

  private buildBoletoMarketplaceRepasses(
    gatewayAccount: EfiAccountRef,
    issuance?: EfiIssuanceContext,
  ): Array<{ payee_code: string; percentage?: number; fixed?: number }> {
    const platformPayeeCode = this.config.get<string>(
      'EFI_PLATFORM_PAYEE_CODE',
    );
    if (
      !issuance ||
      (issuance.platformFeeAmountCents === 0 &&
        issuance.platformFeeBasisPoints === 0)
    ) {
      return [];
    }
    if (!platformPayeeCode || platformPayeeCode === gatewayAccount.payeeCode)
      throw new HttpException(
        'Recebedor da plataforma inválido para split.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );

    return [
      {
        payee_code: platformPayeeCode,
        ...(issuance.platformFeeKind === 'FIXED'
          ? { fixed: issuance.platformFeeAmountCents }
          : { percentage: issuance.platformFeeBasisPoints }),
      },
    ];
  }

  private buildExistingPixResult(
    invoice: PaymentInvoice,
  ): EfiPaymentResult | null {
    if (!invoice.efiTxid || !invoice.efiPixCopiaECola) {
      return null;
    }

    if (this.isPixExpired(invoice.pixExpiresAt)) {
      return null;
    }

    return {
      gatewayId: invoice.efiTxid,
      txid: invoice.efiTxid,
      pixCopyPaste: invoice.efiPixCopiaECola,
      expiresAt: invoice.pixExpiresAt ?? invoice.dueDate,
      paymentLink: '',
    };
  }

  private buildExistingBoletoResult(
    invoice: PaymentInvoice,
  ): EfiPaymentResult | null {
    if (!invoice.efiChargeId) {
      return null;
    }

    if (this.isPixExpired(invoice.pixExpiresAt)) {
      return null;
    }

    return {
      gatewayId: invoice.efiChargeId,
      chargeId: invoice.efiChargeId,
      boletoCode: invoice.boletoLinhaDigitavel ?? undefined,
      boletoLink: invoice.boletoLink ?? undefined,
      boletoPdf: invoice.boletoPdf ?? undefined,
      expiresAt: invoice.pixExpiresAt ?? invoice.dueDate,
      paymentLink: invoice.boletoLink ?? '',
    };
  }

  private isPixExpired(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;
    return new Date() > expiresAt;
  }

  private resolveDiscountSettings(
    invoice: PaymentInvoice,
  ): ResolvedDiscountSettings {
    if (!invoice.debtor.useGlobalBillingSettings) {
      const debtorEnabled = invoice.debtor.autoDiscountEnabled;

      if (!debtorEnabled) {
        return {
          enabled: false,
          daysAfterDue: null,
          percentage: null,
        };
      }

      return this.normalizeDiscountSettings({
        enabled: true,
        daysAfterDue: invoice.debtor.autoDiscountDaysAfterDue,
        percentage: invoice.debtor.autoDiscountPercentage?.toNumber(),
      });
    }

    return this.normalizeDiscountSettings({
      enabled: invoice.company.autoDiscountEnabled,
      daysAfterDue: invoice.company.autoDiscountDaysAfterDue,
      percentage: invoice.company.autoDiscountPercentage?.toNumber(),
    });
  }

  private normalizeDiscountSettings(input: {
    enabled: boolean | null | undefined;
    daysAfterDue: number | null | undefined;
    percentage: number | null | undefined;
  }): ResolvedDiscountSettings {
    if (!input.enabled) {
      return {
        enabled: false,
        daysAfterDue: null,
        percentage: null,
      };
    }

    const daysAfterDue = this.normalizeDiscountDays(input.daysAfterDue);
    const percentage = this.normalizeDiscountPercentage(input.percentage);

    if (percentage === null) {
      return {
        enabled: false,
        daysAfterDue: null,
        percentage: null,
      };
    }

    return {
      enabled: true,
      daysAfterDue,
      percentage,
    };
  }

  private async accountForIdentity(
    identityId: string,
    companyId: string,
  ): Promise<EfiAccountRef> {
    const identity = await this.prisma.efiAccountIdentity.findUnique({
      where: { id: identityId },
      include: {
        // Later operations may use a newer credential of the same account.
        credentialVersions: { where: { status: 'ACTIVE' }, take: 1 },
      },
    });
    if (
      !identity ||
      (identity.ownership === 'COMPANY' && identity.companyId !== companyId)
    )
      throw new HttpException(
        {
          code: 'EFI_ACCOUNT_MISMATCH',
          message: 'Conta Efí da cobrança indisponível.',
        },
        HttpStatus.CONFLICT,
      );
    const credential = identity.credentialVersions[0];
    if (!credential)
      throw new HttpException(
        {
          code: 'EFI_CREDENTIALS_UNAVAILABLE',
          message:
            'Não há credencial ativa para a conta da cobrança. Renove as credenciais.',
        },
        HttpStatus.CONFLICT,
      );
    return {
      companyId,
      environment:
        identity.environment === 'PRODUCTION' ? 'production' : 'homologation',
      pixKey: identity.pixKey ?? '',
      efiAccountNumber: identity.efiAccountNumber,
      payeeCode: identity.payeeCode ?? '',
      encryptedClientId: credential.encryptedClientId,
      encryptedClientSecret: credential.encryptedClientSecret,
      encryptedCertificate: credential.encryptedCertificate,
      encryptedCertificatePassword: credential.encryptedCertificatePassword,
      certificatePath: null,
      issuerIdentityId: identity.id,
    };
  }

  // Operations on an existing charge use the account recorded on it.
  private async accountForCharge(where: {
    companyId: string;
    efiTxid?: string;
    efiChargeId?: string;
  }): Promise<EfiAccountRef> {
    const charge = await this.prisma.paymentCharge.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      select: { issuerIdentityId: true },
    });
    return charge?.issuerIdentityId
      ? this.accountForIdentity(charge.issuerIdentityId, where.companyId)
      : this.legacyAccount(where.companyId);
  }

  // Charges from before financial profiles: the company's gateway account.
  // Charges issued before financial profiles. Reads (reconciliation) do not
  // require the account to still be ACTIVE; cancellations do.
  private async legacyAccount(
    companyId: string,
    requireActive = true,
  ): Promise<EfiAccountRef> {
    const gatewayAccount = requireActive
      ? await this.getActiveGatewayAccount(companyId)
      : await this.prisma.gatewayAccount.findFirst({
          where: { companyId, provider: 'EFI' },
        });
    if (!gatewayAccount)
      throw new HttpException('Conta Efí não configurada.', 409);
    return { ...gatewayAccount, issuerIdentityId: null };
  }

  private async getActiveGatewayAccount(
    companyId: string,
  ): Promise<GatewayAccount> {
    const gatewayAccount = await this.prisma.gatewayAccount.findFirst({
      where: { companyId, provider: 'EFI' },
    });

    if (!gatewayAccount) {
      throw new HttpException(
        'Conta Efi nao cadastrada para esta empresa.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (gatewayAccount.status !== 'ACTIVE') {
      throw new HttpException(
        'Conta Efi precisa estar ACTIVE para emitir cobrancas.',
        HttpStatus.CONFLICT,
      );
    }

    return gatewayAccount;
  }

  private async findGatewayAccountByNotification(
    notification: string,
  ): Promise<GatewayAccount | null> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { notificationToken: notification },
    });

    if (invoice) {
      return this.prisma.gatewayAccount.findFirst({
        where: { companyId: invoice.companyId, provider: 'EFI' },
      });
    }

    return null;
  }

  private createSdkClient(gatewayAccount: EfiAccountRef): EfiPay {
    const credentials = this.getCredentials(gatewayAccount);

    if (!credentials.clientId || !credentials.clientSecret) {
      throw new HttpException(
        'Credenciais Efi nao configuradas.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return new EfiPay({
      sandbox:
        this.getEnvironment(gatewayAccount.environment) === 'homologation',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      certificate: credentials.certificate,
      cert_base64: credentials.certificateIsBase64,
      cache: true,
    });
  }

  // Only the account's own material. There is no fallback to the platform
  // credentials: a company without credentials cannot operate on Efí.
  private getCredentials(gatewayAccount: EfiAccountRef): EfiCredentials {
    const certificateBase64 = gatewayAccount.encryptedCertificate
      ? this.crypto.decrypt(gatewayAccount.encryptedCertificate)
      : undefined;

    return {
      clientId: gatewayAccount.encryptedClientId
        ? this.crypto.decrypt(gatewayAccount.encryptedClientId)
        : '',
      clientSecret: gatewayAccount.encryptedClientSecret
        ? this.crypto.decrypt(gatewayAccount.encryptedClientSecret)
        : '',
      certificate:
        certificateBase64 ?? gatewayAccount.certificatePath ?? undefined,
      certificateIsBase64: Boolean(certificateBase64),
    };
  }

  private ensurePixCertificate(gatewayAccount: EfiAccountRef): void {
    if (!this.getCredentials(gatewayAccount).certificate) {
      throw new HttpException(
        'Certificado Efi nao configurado para Pix.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async runEfiRequest<T>(
    request: () => Promise<T>,
    action: string,
  ): Promise<T> {
    try {
      return await request();
    } catch {
      this.logger.error(`Erro Efi ao ${action}`);
      throw new HttpException(
        'Falha ao processar cobranca na Efi.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private async runIssuanceRequest<T>(
    request: () => Promise<T>,
    action: string,
  ): Promise<T> {
    try {
      return await request();
    } catch {
      this.logger.error(`Falha ambígua da Efí ao ${action}`);
      throw new HttpException(
        {
          code: 'EFI_SUBMISSION_UNCERTAIN',
          message: 'A confirmação da emissão está incerta e exige conciliação.',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private formatEfiError(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }

    if (this.isRecord(error)) {
      const efiError = error as EfiErrorResponse;
      const message =
        efiError.error_description ??
        efiError.detail ??
        efiError.mensagem ??
        efiError.message ??
        efiError.error ??
        efiError.title ??
        'erro desconhecido';
      const violations = this.formatEfiViolations(efiError.violacoes);

      return violations ? `${message} ${violations}` : message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'erro desconhecido';
  }

  private formatEfiViolations(
    violations: EfiErrorResponse['violacoes'],
  ): string {
    if (!violations || violations.length === 0) {
      return '';
    }

    const details = violations
      .map((violation) => {
        const property = violation.propriedade?.trim();
        const reason = violation.razao?.trim();

        if (property && reason) {
          return `${property}: ${reason}`;
        }

        return reason ?? property ?? null;
      })
      .filter((violation): violation is string => violation !== null);

    return details.length > 0 ? `Violacoes: ${details.join(' | ')}` : '';
  }

  private buildPixDebtorAddress(
    invoice: PaymentInvoice,
  ): PixCobvDebtorAddress | null {
    const logradouro = invoice.company.addressStreet?.trim();
    const cidade = invoice.company.addressCity?.trim();
    const uf = invoice.company.addressState?.trim().toUpperCase();
    const cep = this.onlyDigits(invoice.company.addressPostalCode ?? '');

    if (!logradouro || !cidade || !uf || cep.length !== 8) {
      return null;
    }

    return {
      logradouro,
      cidade,
      uf,
      cep,
    };
  }

  private buildPixDebtorPayload(invoice: PaymentInvoice): PixCobvDebtorPayload {
    const debtorDocument = this.normalizeRequiredDebtorDocument(
      invoice.debtor.document,
    );

    const address = this.buildPixDebtorAddress(invoice);

    return {
      ...(address ?? {}),
      nome: invoice.debtor.name,
      ...(debtorDocument.length === 14
        ? { cnpj: debtorDocument }
        : { cpf: debtorDocument }),
    };
  }

  private buildBoletoCustomer(invoice: PaymentInvoice): {
    name?: string;
    cpf?: string;
    juridical_person?: {
      corporate_name: string;
      cnpj: string;
    };
    email?: string;
    phone_number?: string;
    address: {
      street: string;
      number: string;
      neighborhood: string;
      zipcode: string;
      city: string;
      state: string;
    };
  } {
    const debtorDocument = this.normalizeRequiredDebtorDocument(
      invoice.debtor.document,
    );
    const customer = {
      email: invoice.debtor.email ?? undefined,
      phone_number: this.onlyDigits(invoice.debtor.phoneNumber),
      address: {
        street: invoice.company.addressStreet ?? 'Nao informado',
        number: invoice.company.addressNumber ?? '0',
        neighborhood: invoice.company.addressDistrict ?? 'Nao informado',
        zipcode: this.onlyDigits(
          invoice.company.addressPostalCode ?? '00000000',
        ),
        city: invoice.company.addressCity ?? 'Sao Paulo',
        state: invoice.company.addressState ?? 'SP',
      },
    };

    if (debtorDocument.length === 14) {
      return {
        ...customer,
        juridical_person: {
          corporate_name: invoice.debtor.name,
          cnpj: debtorDocument,
        },
      };
    }

    return {
      ...customer,
      name: invoice.debtor.name,
      cpf: debtorDocument,
    };
  }

  private async pixReceiverMatches(
    identityId: string,
    event: Record<string, unknown>,
  ): Promise<boolean> {
    // Efí includes the receiving key; an event without it cannot be checked
    // against the account and is not applied.
    if (typeof event.chave !== 'string') return false;
    const identity = await this.prisma.efiAccountIdentity.findUnique({
      where: { id: identityId },
      select: { pixKey: true },
    });
    return Boolean(identity?.pixKey) && identity?.pixKey === event.chave;
  }

  // Kept for diagnosis without the payload, which may carry payer data.
  private async recordWebhookAnomaly(
    source: 'PIX' | 'CHARGES',
    reasonCode: string,
    externalReference: string,
    companyId?: string,
  ): Promise<void> {
    const reference = externalReference.slice(0, 128) || 'unknown';
    try {
      await this.prisma.paymentWebhookAnomaly.upsert({
        where: {
          source_externalReference_reasonCode: {
            source,
            externalReference: reference,
            reasonCode,
          },
        },
        create: {
          source,
          reasonCode,
          externalReference: reference,
          companyId: companyId ?? null,
        },
        update: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
      });
    } catch {
      this.logger.error('PAYMENT_WEBHOOK_ANOMALY_NOT_RECORDED');
    }
  }

  private extractPixEvents(
    payload: unknown,
  ): Array<Record<string, unknown> & { txid: string }> {
    if (!this.isRecord(payload)) return [];
    const entries: unknown[] = Array.isArray(payload.pix)
      ? payload.pix
      : [payload];
    return entries.filter(
      (event): event is Record<string, unknown> & { txid: string } =>
        this.isRecord(event) &&
        typeof event.txid === 'string' &&
        event.txid.length > 0,
    );
  }

  private providerAmountCents(value: unknown): number | null {
    if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) return null;
    const cents = Number(value.replace('.', ''));
    return Number.isSafeInteger(cents) && cents <= 2147483647 ? cents : null;
  }

  private extractNotificationToken(payload: unknown): string | null {
    if (!this.isRecord(payload)) {
      return null;
    }

    if (typeof payload.notification === 'string') {
      return payload.notification;
    }

    if (typeof payload.token === 'string') {
      return payload.token;
    }

    return null;
  }

  private mapChargeStatus(status?: string): InvoiceStatus | null {
    if (status === 'paid' || status === 'settled') {
      return 'PAID';
    }

    if (
      status === 'canceled' ||
      status === 'expired' ||
      status === 'unpaid' ||
      status === 'refunded'
    ) {
      return 'CANCELED';
    }

    return null;
  }

  private async markInvoice(
    invoiceId: string,
    companyId: string,
    status: InvoiceStatus,
    context: {
      actionType: string;
      description: string;
      gatewayStatusRaw?: string;
      notificationToken?: string;
    },
  ): Promise<void> {
    const currentInvoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { id: true, paidAt: true, status: true, gatewayStatusRaw: true },
    });

    if (
      !currentInvoice ||
      (currentInvoice.gatewayStatusRaw === 'refunded' && status === 'PAID') ||
      (currentInvoice.status === 'PAID' &&
        status !== 'PAID' &&
        context.gatewayStatusRaw !== 'refunded')
    ) {
      return;
    }

    const data: Prisma.InvoiceUpdateManyMutationInput = {
      status,
      gatewayStatusRaw: context.gatewayStatusRaw,
      notificationToken: context.notificationToken,
    };

    if (status === 'PAID') {
      data.paidAt = currentInvoice.paidAt ?? new Date();
    }

    const updated = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, companyId, status: currentInvoice.status },
      data,
    });
    if (updated.count !== 1) return;

    await this.createLog(
      companyId,
      invoiceId,
      context.actionType,
      context.description,
      status,
    );

    if (status === 'PAID') {
      await this.paymentNotifications.notifyPaidInvoice(companyId, invoiceId);
    }
  }

  private async createLog(
    companyId: string,
    invoiceId: string,
    actionType: string,
    description: string,
    status: string,
  ): Promise<void> {
    await this.prisma.collectionLog.create({
      data: {
        companyId,
        invoiceId,
        actionType,
        description,
        status,
      },
    });
  }

  private buildWebhookUrl(
    path: string,
    target: { account: string } | { companyId: string },
  ): string {
    const chargesBaseUrl = this.config.get<string>(
      'EFI_CHARGES_WEBHOOK_BASE_URL',
    );
    const baseUrl =
      chargesBaseUrl ??
      (this.config.get<string>('NODE_ENV') === 'production'
        ? this.config.getOrThrow<string>('EFI_CHARGES_WEBHOOK_BASE_URL')
        : (this.config.get<string>('EFI_WEBHOOK_BASE_URL') ?? ''));
    const url = new URL(
      path.replace(/^\//, ''),
      `${baseUrl.replace(/\/$/, '')}/`,
    );
    url.searchParams.set(
      'token',
      this.config.getOrThrow<string>('EFI_WEBHOOK_SECRET'),
    );
    if ('account' in target) url.searchParams.set('account', target.account);
    else url.searchParams.set('companyId', target.companyId);

    return url.toString();
  }

  private generateTxid(invoiceId: string): string {
    return invoiceId.replace(/-/g, '').slice(0, 32);
  }

  private generateRenewedTxid(invoiceId: string): string {
    return `${invoiceId.replace(/-/g, '').slice(0, 24)}${randomBytes(4).toString('hex')}`;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0] as string;
  }

  private formatAmount(value: unknown): string {
    return Number(value).toFixed(2);
  }

  private formatPercentage(value: number | null): string {
    return (value ?? 0).toFixed(2);
  }

  private normalizeDiscountDays(value: number | null | undefined): number {
    if (!Number.isInteger(value) || value === undefined || value === null) {
      return 0;
    }

    if (value < 0) {
      return 0;
    }

    if (value > 365) {
      return 365;
    }

    return value;
  }

  private normalizeDiscountPercentage(
    value: number | null | undefined,
  ): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    if (value <= 0) {
      return null;
    }

    if (value > 100) {
      return 100;
    }

    return Number(value.toFixed(2));
  }

  private calculateDiscountAmount(
    originalAmount: unknown,
    percentage: number | null,
  ): string | null {
    if (percentage === null) {
      return null;
    }

    const total = Number(originalAmount);
    const discountAmount = (total * percentage) / 100;
    return discountAmount.toFixed(2);
  }

  private addDays(date: Date, days: number): Date {
    const target = new Date(date);
    target.setDate(target.getDate() + days);
    return target;
  }

  private formatBasisPointsAsPercent(value: number): string {
    return (value / 100).toFixed(2);
  }

  private formatCents(value: number): string {
    return (value / 100).toFixed(2);
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private normalizeRequiredDebtorDocument(value: string | null): string {
    const result = validateDebtorDocument(value);

    if (!result.valid) {
      throw new HttpException(
        'CPF/CNPJ do devedor obrigatorio para emitir cobrancas Efi.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return result.normalized;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
