import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { BillingMethod, PaymentChargeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PAYMENT_TOKEN_PURPOSE = 'invoice-payment';
const PAYMENT_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
const PAYMENT_TOKEN_MAX_LENGTH = 512;
const PAYMENT_TOKEN_KEYS = ['companyId', 'exp', 'invoiceId', 'purpose'];
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TOKEN_ID = /^[A-Za-z0-9-]{1,64}$/;
const INVALID_LINK = 'Link de pagamento invalido ou expirado.';

export type PublicPaymentState =
  | 'PAYABLE'
  | 'PAID'
  | 'CANCELED'
  | 'EXPIRED'
  | 'UNAVAILABLE';

interface PublicCharge {
  status: PaymentChargeStatus;
  billingMethod: BillingMethod;
  gatewayId: string | null;
  efiTxid: string | null;
  efiChargeId: string | null;
  expiresAt: Date | null;
}

interface PaymentTokenPayload {
  purpose: typeof PAYMENT_TOKEN_PURPOSE;
  companyId: string;
  invoiceId: string;
  exp: number;
}

interface CreateInvoicePaymentPageInput {
  companyId: string;
  invoiceId: string;
}

export interface InvoicePaymentPage {
  token: string;
  url: string;
}

// Instruments are only filled when state is PAYABLE (canPay).
export interface PublicPaymentResponse {
  invoiceId: string;
  companyName: string;
  debtorName: string;
  amount: number;
  dueDate: string;
  billingType: BillingMethod;
  state: PublicPaymentState;
  canPay: boolean;
  paidAt: string | null;
  pixCopyPaste: string | null;
  boletoLine: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
  expiresAt: string | null;
}

@Injectable()
export class PublicPaymentLinkService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  createInvoicePaymentPage(
    input: CreateInvoicePaymentPageInput,
  ): InvoicePaymentPage {
    const payload: PaymentTokenPayload = {
      purpose: PAYMENT_TOKEN_PURPOSE,
      companyId: input.companyId,
      invoiceId: input.invoiceId,
      exp: Math.floor(Date.now() / 1000) + PAYMENT_TOKEN_TTL_SECONDS,
    };
    const token = this.signPayload(payload);

    return {
      token,
      url: `${this.getFrontendUrl()}/pagar/${token}`,
    };
  }

  // Read-only: never issues, renews or cancels anything. The signed company
  // and invoice are the only lookup keys; the company's current account,
  // activation or paused issuance do not affect charges already issued.
  async getPublicPayment(token: string): Promise<PublicPaymentResponse> {
    const payload = this.verifyToken(token);
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: payload.invoiceId,
        companyId: payload.companyId,
      },
      select: {
        id: true,
        originalAmount: true,
        dueDate: true,
        billingType: true,
        status: true,
        paidAt: true,
        gatewayStatusRaw: true,
        gatewayId: true,
        efiTxid: true,
        efiChargeId: true,
        efiPixCopiaECola: true,
        pixPayload: true,
        pixExpiresAt: true,
        boletoLinhaDigitavel: true,
        boletoLink: true,
        boletoPdf: true,
        debtor: { select: { name: true } },
        company: { select: { corporateName: true } },
        paymentCharges: {
          where: { companyId: payload.companyId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            status: true,
            billingMethod: true,
            gatewayId: true,
            efiTxid: true,
            efiChargeId: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Cobranca nao encontrada ou indisponivel.');
    }

    const summary = {
      invoiceId: invoice.id,
      companyName: invoice.company.corporateName,
      debtorName: invoice.debtor.name,
      amount: this.toNumber(invoice.originalAmount),
      dueDate: invoice.dueDate.toISOString(),
    };
    const closed = (
      state: Exclude<PublicPaymentState, 'PAYABLE'>,
      charge?: PublicCharge,
    ): PublicPaymentResponse => ({
      ...summary,
      billingType: this.normalizeBillingMethod(
        charge?.billingMethod ?? invoice.billingType,
      ),
      state,
      canPay: false,
      paidAt: state === 'PAID' ? (invoice.paidAt?.toISOString() ?? null) : null,
      pixCopyPaste: null,
      boletoLine: null,
      boletoLink: null,
      boletoPdf: null,
      expiresAt: null,
    });

    const [latest] = invoice.paymentCharges;
    if (invoice.status === 'PAID') return closed('PAID', latest);
    // A write-off by Efí also closes the invoice; it is shown as expired.
    if (invoice.status === 'CANCELED')
      return closed(
        latest?.status === 'EXPIRED' || invoice.gatewayStatusRaw === 'expired'
          ? 'EXPIRED'
          : 'CANCELED',
        latest,
      );

    // Only a confirmed issuance (ACTIVE) is payable; a pending or uncertain
    // one exposes nothing, even if the invoice already carries data.
    const active = invoice.paymentCharges.find(
      (charge) => charge.status === 'ACTIVE',
    );
    if (!active)
      return closed(latest?.status === 'EXPIRED' ? 'EXPIRED' : 'UNAVAILABLE');
    // The invoice instruments must be those of this issuance, never those of
    // a replaced one or an inconsistent legacy link.
    if (
      !active.gatewayId ||
      invoice.gatewayId !== active.gatewayId ||
      (active.efiTxid !== null && invoice.efiTxid !== active.efiTxid) ||
      (active.efiChargeId !== null &&
        invoice.efiChargeId !== active.efiChargeId)
    )
      return closed('UNAVAILABLE', active);
    if (this.isPastPaymentWindow(active)) return closed('EXPIRED', active);

    const instruments = {
      pixCopyPaste: invoice.efiPixCopiaECola ?? invoice.pixPayload,
      boletoLine: invoice.boletoLinhaDigitavel,
      boletoLink: invoice.boletoLink,
      boletoPdf: invoice.boletoPdf,
    };
    if (!Object.values(instruments).some(Boolean))
      return closed('UNAVAILABLE', active);
    return {
      ...summary,
      billingType: this.normalizeBillingMethod(active.billingMethod),
      state: 'PAYABLE',
      canPay: true,
      paidAt: null,
      ...instruments,
      expiresAt: invoice.pixExpiresAt?.toISOString() ?? null,
    };
  }

  // A boleto/Bolix stays payable after its due date until Efí writes it off
  // (reported as EXPIRED); a Pix CobV has a fixed validity after the due date.
  private isPastPaymentWindow(charge: PublicCharge): boolean {
    if (charge.billingMethod !== 'PIX' || !charge.expiresAt) return false;
    return Date.now() >= this.pixDeadline(charge.expiresAt).getTime();
  }

  // expiresAt is the day after the last payable day; that day ends at
  // midnight in Brasília (UTC-3), whatever time the date was stored with.
  private pixDeadline(expiresAt: Date): Date {
    return new Date(`${expiresAt.toISOString().slice(0, 10)}T03:00:00.000Z`);
  }

  private signPayload(payload: PaymentTokenPayload): string {
    const encodedPayload = this.toBase64Url(JSON.stringify(payload));
    const signature = this.createSignature(encodedPayload);

    return `${encodedPayload}.${signature}`;
  }

  // Exactly "<payload>.<signature>" in base64url, signed for this purpose,
  // with non-empty ids and an expiration still in the future. The error never
  // carries the token.
  private verifyToken(token: string): PaymentTokenPayload {
    const parts =
      typeof token === 'string' && token.length <= PAYMENT_TOKEN_MAX_LENGTH
        ? token.split('.')
        : [];
    const [encodedPayload, signature] = parts;

    if (
      parts.length !== 2 ||
      !encodedPayload ||
      !signature ||
      !BASE64URL.test(encodedPayload) ||
      !BASE64URL.test(signature)
    ) {
      throw new BadRequestException(INVALID_LINK);
    }

    const expectedSignature = this.createSignature(encodedPayload);
    if (!this.safeEqual(signature, expectedSignature)) {
      throw new BadRequestException(INVALID_LINK);
    }

    const payload = this.parsePayload(encodedPayload);
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException(INVALID_LINK);
    }

    return payload;
  }

  private parsePayload(encodedPayload: string): PaymentTokenPayload {
    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as unknown;

      if (!this.isPaymentTokenPayload(parsed)) {
        throw new Error('invalid payload');
      }

      return parsed;
    } catch {
      throw new BadRequestException(INVALID_LINK);
    }
  }

  private createSignature(encodedPayload: string): string {
    return createHmac('sha256', this.getSecret())
      .update(encodedPayload)
      .digest('base64url');
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private toBase64Url(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  private getSecret(): string {
    const secret =
      this.config.get<string>('PAYMENT_SECRET_KEY') ??
      this.config.get<string>('JWT_SECRET');

    if (!secret || secret.length < 32) {
      throw new Error('PAYMENT_SECRET_KEY nao configurada');
    }

    return secret;
  }

  private getFrontendUrl(): string {
    return this.config
      .get<string>('FRONTEND_URL', 'http://localhost:3000')
      .replace(/\/$/, '');
  }

  private toNumber(value: unknown): number {
    if (
      typeof value === 'object' &&
      value !== null &&
      'toNumber' in value &&
      typeof value.toNumber === 'function'
    ) {
      return Number((value as { toNumber: () => number }).toNumber());
    }

    return Number(value);
  }

  private normalizeBillingMethod(value: unknown): BillingMethod {
    if (value === 'PIX' || value === 'BOLETO' || value === 'BOLIX') {
      return value;
    }

    return 'PIX';
  }

  private isPaymentTokenPayload(value: unknown): value is PaymentTokenPayload {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    // Exactly the fields this service signs (links already sent keep working).
    return (
      Object.keys(candidate).sort().join() === PAYMENT_TOKEN_KEYS.join() &&
      candidate.purpose === PAYMENT_TOKEN_PURPOSE &&
      typeof candidate.companyId === 'string' &&
      TOKEN_ID.test(candidate.companyId) &&
      typeof candidate.invoiceId === 'string' &&
      TOKEN_ID.test(candidate.invoiceId) &&
      Number.isSafeInteger(candidate.exp) &&
      (candidate.exp as number) > 0
    );
  }
}
