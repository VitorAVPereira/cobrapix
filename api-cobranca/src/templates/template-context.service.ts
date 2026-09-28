import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { normalizeWhatsAppNumberForTransport } from '../common/whatsapp-number';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PublicPaymentLinkService } from '../payment/payment-link.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  INVOICE_SOURCES,
  RenderValues,
  TemplateContext,
  TemplateMapping,
  TemplateSendOrigin,
  TemplateSource,
} from './template-contracts';
import {
  formatAmount,
  formatCivilDate,
  mappingSources,
} from './template-renderer';

export interface LoadedTemplateContext {
  values: RenderValues;
  /** Transport-ready phone of the context's person (debtor or representative), if any. */
  recipient: string | null;
  paymentUrl?: string;
  /** Identity, links and values used; excludes query time and the expiring link token. */
  contextFingerprint: string;
}

type Client = PrismaService | Prisma.TransactionClient;

/**
 * Loads the data a mapping reads, always scoped to the context company. A debtor, invoice
 * or activation of another company is not found, never silently used.
 */
@Injectable()
export class TemplateContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly paymentLinks: PublicPaymentLinkService,
  ) {}

  async load(
    context: TemplateContext,
    origin: TemplateSendOrigin,
    mapping: TemplateMapping,
    client: Client = this.prisma,
  ): Promise<LoadedTemplateContext> {
    const sources = mappingSources(mapping);
    const needsInvoice =
      Boolean(mapping.paymentButton) ||
      sources.some((source) => INVOICE_SOURCES.includes(source));
    if (needsInvoice && !context.invoiceId)
      throw new BadRequestException({
        code: 'VALUE_MISSING',
        message: 'O template exige a cobrança de contexto.',
      });
    const company = await client.company.findUnique({
      where: { id: context.companyId },
      select: { id: true, corporateName: true, tradeName: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const invoice = context.invoiceId
      ? await client.invoice.findFirst({
          where: { id: context.invoiceId, companyId: company.id },
          select: {
            id: true,
            debtorId: true,
            originalAmount: true,
            dueDate: true,
            efiPixCopiaECola: true,
            pixPayload: true,
            boletoLinhaDigitavel: true,
            boletoLink: true,
            boletoPdf: true,
          },
        })
      : null;
    if (context.invoiceId && !invoice)
      throw new NotFoundException('Cobrança não encontrada para a empresa.');
    if (invoice && context.debtorId && invoice.debtorId !== context.debtorId)
      throw new NotFoundException(
        'Cobrança não pertence ao devedor informado.',
      );
    const debtorId = context.debtorId ?? invoice?.debtorId;
    const debtor = debtorId
      ? await client.debtor.findFirst({
          where: { id: debtorId, companyId: company.id },
          select: { id: true, name: true, phoneNumber: true },
        })
      : null;
    if (debtorId && !debtor)
      throw new NotFoundException('Devedor não encontrado para a empresa.');

    const activation =
      origin === 'ACTIVATION' || sources.includes('REPRESENTATIVE_NAME')
        ? await this.activation(client, context)
        : null;

    const values: RenderValues = {};
    const set = (source: TemplateSource, value: string | null | undefined) => {
      if (sources.includes(source) && value?.trim()) values[source] = value;
    };
    set('COMPANY_NAME', company.tradeName ?? company.corporateName);
    set('DEBTOR_NAME', debtor?.name);
    set('REPRESENTATIVE_NAME', activation?.name);
    let paymentUrl: string | undefined;
    if (invoice) {
      set('AMOUNT', formatAmount(Number(invoice.originalAmount)));
      set('DUE_DATE', formatCivilDate(invoice.dueDate));
      set('PIX_COPY_PASTE', invoice.efiPixCopiaECola ?? invoice.pixPayload);
      set('BOLETO_LINE', invoice.boletoLinhaDigitavel);
      set('BOLETO_LINK', invoice.boletoLink);
      set('BOLETO_PDF', invoice.boletoPdf);
      if (mapping.paymentButton || sources.includes('PAYMENT_LINK')) {
        // A signed link to this invoice's page; resolving it never issues a charge.
        paymentUrl = this.paymentLinks.createInvoicePaymentPage({
          companyId: company.id,
          invoiceId: invoice.id,
        }).url;
        set('PAYMENT_LINK', paymentUrl);
      }
    }
    const recipient =
      origin === 'ACTIVATION'
        ? (activation?.phone ?? null)
        : debtor
          ? this.phone(debtor.phoneNumber)
          : null;
    const stableValues = {
      ...values,
      ...(values.PAYMENT_LINK
        ? { PAYMENT_LINK: `invoice:${invoice?.id}` }
        : {}),
    };
    const contextFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          origin,
          companyId: company.id,
          debtorId: debtor?.id ?? null,
          invoiceId: invoice?.id ?? null,
          activationId: activation?.id ?? null,
          recipient: recipient
            ? createHash('sha256').update(recipient).digest('hex')
            : null,
          paymentButton: Boolean(mapping.paymentButton),
          values: Object.fromEntries(
            Object.entries(stableValues).sort(([a], [b]) => a.localeCompare(b)),
          ),
        }),
      )
      .digest('hex');
    return {
      values,
      recipient,
      ...(paymentUrl ? { paymentUrl } : {}),
      contextFingerprint,
    };
  }

  private async activation(
    client: Client,
    context: TemplateContext,
  ): Promise<{ id: string; name: string | null; phone: string | null }> {
    const row = context.activationId
      ? await client.efiOnboarding.findFirst({
          where: { id: context.activationId, companyId: context.companyId },
          select: {
            id: true,
            representativeNameEncrypted: true,
            representativePhoneEncrypted: true,
            sensitiveDataDeletedAt: true,
            sensitiveDataExpiresAt: true,
          },
        })
      : null;
    if (!row)
      throw new NotFoundException('Ativação não encontrada para a empresa.');
    // Only validated, still-retained activation data may fill a message.
    const retained =
      !row.sensitiveDataDeletedAt &&
      (!row.sensitiveDataExpiresAt || row.sensitiveDataExpiresAt > new Date());
    const decrypt = (value: string | null) =>
      retained && value ? this.crypto.decrypt(value) : null;
    const phone = decrypt(row.representativePhoneEncrypted);
    return {
      id: row.id,
      name: decrypt(row.representativeNameEncrypted),
      phone: phone ? this.phone(phone) : null,
    };
  }

  private phone(value: string): string | null {
    try {
      return normalizeWhatsAppNumberForTransport(value);
    } catch {
      return null;
    }
  }
}
