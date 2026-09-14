import { assertNewBillingMethod } from '../payment/billing-method-policy';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PaymentCharge } from '@prisma/client';
import {
  EfiIssuanceContext,
  EfiPaymentResult,
  EfiService,
} from './efi.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentChargeService } from './payment-charge.service';

type BillingType = 'PIX' | 'BOLETO' | 'BOLIX';

interface CancelablePaymentInvoice {
  id: string;
  companyId: string;
  efiTxid: string | null;
  efiChargeId: string | null;
}

export interface CancelPaymentResult {
  providerAction: 'LOCAL_ONLY' | 'PIX_COBV_REMOVED' | 'CHARGE_CANCELED';
  gatewayStatusRaw: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly efiService: EfiService,
    private readonly prisma: PrismaService,
    @Inject(PaymentChargeService)
    private readonly charges: PaymentChargeService | null,
  ) {}

  async createPayment(
    invoiceId: string,
    companyId: string,
    billingType: BillingType = 'BOLIX',
  ): Promise<EfiPaymentResult> {
    if (
      billingType !== 'PIX' &&
      billingType !== 'BOLETO' &&
      billingType !== 'BOLIX'
    ) {
      throw new HttpException(
        'Tipo de cobranca invalido.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.ensureInvoiceCanGeneratePayment(invoiceId, companyId);
    await this.ensureBillingMethodEnabled(companyId, billingType);

    if (!this.charges) {
      throw new HttpException(
        {
          code: 'FEE_CONFIGURATION_MISSING',
          message: 'Serviço de emissão indisponível.',
        },
        503,
      );
    }

    const reusable = await this.charges.findReusable(
      companyId,
      invoiceId,
      billingType,
    );
    if (
      reusable?.status === 'ACTIVE' &&
      reusable.gatewayId &&
      (!reusable.expiresAt || reusable.expiresAt > new Date())
    )
      return this.toPaymentResult(reusable);
    if (reusable) {
      throw new HttpException(
        {
          code: 'EFI_SUBMISSION_UNCERTAIN',
          message:
            'A emissão anterior aguarda conciliação e não será reenviada.',
        },
        HttpStatus.CONFLICT,
      );
    }

    // Reject paused or unhealthy integrations before creating an issuance reservation.
    await this.efiService.assertIssuable(companyId);

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { originalAmount: true },
    });
    if (!invoice)
      throw new HttpException('Fatura nao encontrada.', HttpStatus.NOT_FOUND);
    const grossAmountCents = Math.round(Number(invoice.originalAmount) * 100);
    const charge = await this.charges.createDraft(
      companyId,
      invoiceId,
      billingType,
      grossAmountCents,
    );
    const context = this.buildIssuanceContext(charge);
    await this.charges.transition(charge.id, companyId, 'PENDING', {});
    try {
      const result = await this.efiService.createPayment(
        invoiceId,
        companyId,
        billingType,
        context,
      );
      await this.charges.markIssued(charge.id, companyId, result);
      return result;
    } catch (error: unknown) {
      if (
        error instanceof HttpException &&
        error.getStatus() < 500 &&
        !this.isUncertainSubmission(error)
      ) {
        await this.charges.markFailed(charge.id, companyId);
      }
      throw error;
    }
  }

  async cancelPaymentForInvoice(
    invoice: CancelablePaymentInvoice,
  ): Promise<CancelPaymentResult> {
    if (invoice.efiTxid) {
      const gatewayStatusRaw = await this.efiService.cancelPixDueCharge(
        invoice.companyId,
        invoice.efiTxid,
      );

      return {
        providerAction: 'PIX_COBV_REMOVED',
        gatewayStatusRaw,
      };
    }

    if (invoice.efiChargeId) {
      const gatewayStatusRaw = await this.efiService.cancelCharge(
        invoice.companyId,
        invoice.efiChargeId,
      );

      return {
        providerAction: 'CHARGE_CANCELED',
        gatewayStatusRaw,
      };
    }

    return {
      providerAction: 'LOCAL_ONLY',
      gatewayStatusRaw: 'CANCELED_BY_USER',
    };
  }

  async createPaymentBatch(
    invoiceIds: string[],
    companyId: string,
    billingType: BillingType = 'BOLIX',
  ): Promise<{
    success: number;
    failed: number;
    results: Array<{
      invoiceId: string;
      gatewayId: string;
      paymentLink: string;
    }>;
  }> {
    await this.efiService.assertIssuable(companyId);
    await this.ensureBillingMethodEnabled(companyId, billingType);
    const results: Array<{
      invoiceId: string;
      gatewayId: string;
      paymentLink: string;
    }> = [];
    let success = 0;
    let failed = 0;

    const CHUNK_SIZE = 10;
    for (let i = 0; i < invoiceIds.length; i += CHUNK_SIZE) {
      const chunk = invoiceIds.slice(i, i + CHUNK_SIZE);
      const settled = await Promise.allSettled(
        chunk.map((invoiceId) =>
          this.createPayment(invoiceId, companyId, billingType).then(
            (result) => ({
              invoiceId,
              gatewayId: result.gatewayId,
              paymentLink: result.paymentLink,
            }),
          ),
        ),
      );

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
          success++;
        } else {
          this.logger.error('Falha ao emitir cobrança do lote.');
          failed++;
        }
      }
    }

    return { success, failed, results };
  }

  async createPixPayment(
    invoiceId: string,
    companyId: string,
  ): Promise<EfiPaymentResult> {
    return this.createPayment(invoiceId, companyId, 'PIX');
  }

  async createBoletoPayment(
    invoiceId: string,
    companyId: string,
  ): Promise<EfiPaymentResult> {
    return this.createPayment(invoiceId, companyId, 'BOLETO');
  }

  async createBolixPayment(
    invoiceId: string,
    companyId: string,
  ): Promise<EfiPaymentResult> {
    return this.createPayment(invoiceId, companyId, 'BOLIX');
  }

  async createBoletoPaymentBatch(
    invoiceIds: string[],
    companyId: string,
  ): Promise<{
    success: number;
    failed: number;
    results: Array<{
      invoiceId: string;
      gatewayId: string;
      paymentLink: string;
    }>;
  }> {
    return this.createPaymentBatch(invoiceIds, companyId, 'BOLETO');
  }

  isConfigured(): boolean {
    return this.efiService.isConfigured();
  }

  async replaceExpiredCharge(
    invoiceId: string,
    companyId: string,
    newDueDate: Date,
  ): Promise<EfiPaymentResult> {
    if (
      !this.charges ||
      Number.isNaN(newDueDate.getTime()) ||
      newDueDate <= new Date()
    ) {
      throw new HttpException(
        'Nova data de vencimento inválida.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.efiService.assertIssuable(companyId);
    let replacement = await this.prisma.paymentCharge.findFirst({
      where: {
        invoiceId,
        companyId,
        status: 'PENDING',
        replacesChargeId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    const previous = await this.prisma.paymentCharge.findFirst({
      where: replacement?.replacesChargeId
        ? { id: replacement.replacesChargeId, invoiceId, companyId }
        : {
            invoiceId,
            companyId,
            status: { in: ['EXPIRED', 'ACTIVE'] },
            expiresAt: { lte: new Date() },
          },
      orderBy: { createdAt: 'desc' },
    });
    if (!previous)
      throw new HttpException('Cobrança vencida não encontrada.', 409);
    await this.ensureBillingMethodEnabled(companyId, previous.billingMethod);
    if (!replacement) {
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: invoiceId, companyId },
        select: { originalAmount: true, status: true },
      });
      if (!invoice || invoice.status === 'PAID')
        throw new HttpException('Fatura não pode ser substituída.', 409);
      replacement = await this.charges.createDraft(
        companyId,
        invoiceId,
        previous.billingMethod,
        Math.round(Number(invoice.originalAmount) * 100),
        previous.id,
        newDueDate,
      );
    }
    if (replacement.gatewayStatusRaw !== 'REPLACEMENT_CANCEL_PENDING')
      throw new HttpException(
        {
          code: 'EFI_SUBMISSION_UNCERTAIN',
          message: 'A substituição anterior aguarda conciliação.',
        },
        409,
      );
    const claimed = await this.prisma.paymentCharge.updateMany({
      where: {
        id: replacement.id,
        companyId,
        gatewayStatusRaw: 'REPLACEMENT_CANCEL_PENDING',
      },
      data: { gatewayStatusRaw: 'REPLACEMENT_CANCELING' },
    });
    if (claimed.count !== 1)
      throw new HttpException(
        {
          code: 'EFI_SUBMISSION_UNCERTAIN',
          message: 'Substituição em andamento.',
        },
        409,
      );
    await this.cancelPaymentForInvoice({
      id: invoiceId,
      companyId,
      efiTxid: previous.efiTxid,
      efiChargeId: previous.efiChargeId,
    });
    await this.charges.transition(previous.id, companyId, 'REPLACED', {
      canceledAt: new Date(),
    });
    const changed = await this.prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        companyId,
        status: { in: ['DRAFT', 'PENDING', 'CANCELED'] },
      },
      data: {
        dueDate: replacement.expiresAt ?? newDueDate,
        status: 'DRAFT',
        gatewayId: null,
        efiTxid: null,
        efiChargeId: null,
        pixPayload: null,
        efiPixCopiaECola: null,
        boletoLinhaDigitavel: null,
        boletoLink: null,
        boletoPdf: null,
        pixExpiresAt: null,
        splitConfigId: null,
      },
    });
    if (changed.count !== 1) {
      await this.charges.markFailed(replacement.id, companyId);
      throw new HttpException(
        'A fatura foi liquidada durante a substituição.',
        409,
      );
    }
    await this.charges.transition(replacement.id, companyId, 'PENDING', {
      gatewayStatusRaw: 'SUBMITTING',
    });
    try {
      const result = await this.efiService.createPayment(
        invoiceId,
        companyId,
        previous.billingMethod,
        this.buildIssuanceContext(replacement),
      );
      await this.charges.markIssued(replacement.id, companyId, result);
      return result;
    } catch (error: unknown) {
      if (
        error instanceof HttpException &&
        error.getStatus() < 500 &&
        !this.isUncertainSubmission(error)
      )
        await this.charges.markFailed(replacement.id, companyId);
      throw error;
    }
  }

  private buildIssuanceContext(charge: PaymentCharge): EfiIssuanceContext {
    const snapshot = this.asRecord(charge.feeSnapshot);
    const platformFee = this.asRecord(snapshot.platformFee);
    const kind = platformFee.kind === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    return {
      chargeId: charge.id,
      platformFeeKind: kind,
      platformFeeAmountCents:
        kind === 'FIXED' && typeof platformFee.amountCents === 'number'
          ? platformFee.amountCents
          : 0,
      platformFeeBasisPoints:
        kind === 'PERCENTAGE' && typeof platformFee.basisPoints === 'number'
          ? platformFee.basisPoints
          : 0,
      grossAmountCents: charge.grossAmountCents,
    };
  }

  private toPaymentResult(charge: PaymentCharge): EfiPaymentResult {
    return {
      gatewayId: charge.gatewayId ?? '',
      txid: charge.efiTxid ?? undefined,
      chargeId: charge.efiChargeId ?? undefined,
      pixCopyPaste: charge.pixPayload ?? undefined,
      boletoCode: charge.boletoLine ?? undefined,
      paymentLink: charge.paymentUrl ?? '',
      expiresAt: charge.expiresAt ?? new Date(),
      splitConfigId: charge.splitConfigId ?? undefined,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private isUncertainSubmission(error: unknown): boolean {
    if (!(error instanceof HttpException)) return false;
    return (
      this.asRecord(error.getResponse()).code === 'EFI_SUBMISSION_UNCERTAIN'
    );
  }

  private async ensureInvoiceCanGeneratePayment(
    invoiceId: string,
    companyId: string,
  ): Promise<void> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { status: true },
    });

    if (!invoice) {
      throw new HttpException('Fatura nao encontrada.', HttpStatus.NOT_FOUND);
    }

    if (!['PENDING', 'DRAFT'].includes(invoice.status)) {
      throw new HttpException(
        'Apenas faturas pendentes podem gerar cobranca.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async ensureBillingMethodEnabled(
    companyId: string,
    billingType: BillingType,
  ): Promise<void> {
    assertNewBillingMethod(billingType);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { enabledBillingMethods: true },
    });

    if (!company) {
      throw new HttpException('Empresa nao encontrada.', HttpStatus.NOT_FOUND);
    }

    if (!company.enabledBillingMethods.includes(billingType)) {
      throw new HttpException(
        {
          code: 'PAYMENT_METHOD_DISABLED',
          message: 'Método de cobrança não habilitado para esta empresa.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
