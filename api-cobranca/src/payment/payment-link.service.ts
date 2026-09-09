import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { BillingMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PAYMENT_TOKEN_PURPOSE = 'invoice-payment';
const PAYMENT_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

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

export interface PublicPaymentResponse {
  invoiceId: string;
  companyName: string;
  debtorName: string;
  amount: number;
  dueDate: string;
  billingType: BillingMethod;
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

  async getPublicPayment(token: string): Promise<PublicPaymentResponse> {
    const payload = this.verifyToken(token);
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: payload.invoiceId,
        companyId: payload.companyId,
        status: 'PENDING',
      },
      select: {
        id: true,
        companyId: true,
        originalAmount: true,
        dueDate: true,
        billingType: true,
        efiPixCopiaECola: true,
        pixPayload: true,
        pixExpiresAt: true,
        boletoLinhaDigitavel: true,
        boletoLink: true,
        boletoPdf: true,
        debtor: { select: { name: true } },
        company: { select: { corporateName: true } },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Cobranca nao encontrada ou indisponivel.');
    }

    return {
      invoiceId: invoice.id,
      companyName: invoice.company.corporateName,
      debtorName: invoice.debtor.name,
      amount: this.toNumber(invoice.originalAmount),
      dueDate: invoice.dueDate.toISOString(),
      billingType: this.normalizeBillingMethod(invoice.billingType),
      pixCopyPaste: invoice.efiPixCopiaECola ?? invoice.pixPayload,
      boletoLine: invoice.boletoLinhaDigitavel,
      boletoLink: invoice.boletoLink,
      boletoPdf: invoice.boletoPdf,
      expiresAt: invoice.pixExpiresAt?.toISOString() ?? null,
    };
  }

  private signPayload(payload: PaymentTokenPayload): string {
    const encodedPayload = this.toBase64Url(JSON.stringify(payload));
    const signature = this.createSignature(encodedPayload);

    return `${encodedPayload}.${signature}`;
  }

  private verifyToken(token: string): PaymentTokenPayload {
    const [encodedPayload, signature] = token.split('.');

    if (!encodedPayload || !signature) {
      throw new BadRequestException('Link de pagamento invalido ou expirado.');
    }

    const expectedSignature = this.createSignature(encodedPayload);
    if (!this.safeEqual(signature, expectedSignature)) {
      throw new BadRequestException('Link de pagamento invalido ou expirado.');
    }

    const payload = this.parsePayload(encodedPayload);
    if (
      payload.purpose !== PAYMENT_TOKEN_PURPOSE ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      throw new BadRequestException('Link de pagamento invalido ou expirado.');
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
      throw new BadRequestException('Link de pagamento invalido ou expirado.');
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
      return Number(value.toNumber());
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

    return (
      candidate.purpose === PAYMENT_TOKEN_PURPOSE &&
      typeof candidate.companyId === 'string' &&
      typeof candidate.invoiceId === 'string' &&
      typeof candidate.exp === 'number'
    );
  }
}
