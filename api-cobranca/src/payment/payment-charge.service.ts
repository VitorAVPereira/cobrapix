import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BillingMethod,
  PaymentCharge,
  PaymentChargeStatus,
  Prisma,
} from '@prisma/client';
import { PaymentFeeService } from '../payment-fees/payment-fee.service';
import { PrismaService } from '../prisma/prisma.service';
import { EfiPaymentResult } from './efi.service';

type SettlementCharge = Pick<
  PaymentCharge,
  'id' | 'companyId' | 'invoiceId' | 'estimatedEfiFeeCents'
>;

export interface ConfirmedPixRefund {
  providerRefundId: string;
  amountCents: number;
}

@Injectable()
export class PaymentChargeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: PaymentFeeService,
  ) {}

  async findReusable(
    companyId: string,
    invoiceId: string,
    billingMethod: BillingMethod,
  ): Promise<PaymentCharge | null> {
    return this.prisma.paymentCharge.findFirst({
      where: {
        companyId,
        invoiceId,
        billingMethod,
        status: { in: ['DRAFT', 'PENDING', 'ACTIVE'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDraft(
    companyId: string,
    invoiceId: string,
    billingMethod: BillingMethod,
    grossAmountCents: number,
    replacesChargeId?: string,
    replacementDueDate?: Date,
  ): Promise<PaymentCharge> {
    const feeVersion = await this.fees.resolveActiveVersion(
      companyId,
      billingMethod,
    );
    const quote = this.fees.calculateQuote(grossAmountCents, feeVersion);
    const id = randomUUID();
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<PaymentCharge> => {
        const locked = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >(
          Prisma.sql`SELECT id, status FROM "Invoice" WHERE id=${invoiceId} AND "companyId"=${companyId} FOR UPDATE`,
        );
        const lockedInvoice = locked[0];
        if (!lockedInvoice || locked.length !== 1)
          throw new HttpException('Fatura não encontrada.', 404);
        const allowedStatuses = replacesChargeId
          ? ['DRAFT', 'PENDING', 'CANCELED']
          : ['DRAFT', 'PENDING'];
        if (!allowedStatuses.includes(lockedInvoice.status))
          throw new HttpException(
            'A situação da fatura não permite uma nova emissão.',
            409,
          );
        if (replacesChargeId) {
          const previous = await tx.paymentCharge.findFirst({
            where: {
              id: replacesChargeId,
              companyId,
              invoiceId,
              status: { in: ['ACTIVE', 'EXPIRED'] },
              expiresAt: { lte: new Date() },
            },
          });
          if (!previous || !replacementDueDate)
            throw new HttpException('Cobrança vencida não encontrada.', 409);
          await tx.paymentCharge.updateMany({
            where: { id: previous.id, companyId, status: previous.status },
            data: { status: 'EXPIRED' },
          });
          if (previous.status !== 'EXPIRED')
            await tx.paymentChargeStatusHistory.create({
              data: {
                paymentChargeId: previous.id,
                previousStatus: previous.status,
                status: 'EXPIRED',
              },
            });
        }
        const pending = await tx.paymentCharge.findFirst({
          where: {
            companyId,
            invoiceId,
            status: { in: ['DRAFT', 'PENDING', 'ACTIVE'] },
          },
        });
        if (pending)
          throw new HttpException(
            {
              code: 'EFI_SUBMISSION_UNCERTAIN',
              message:
                'Já existe uma emissão em andamento ou ativa para esta fatura.',
            },
            409,
          );
        return tx.paymentCharge.create({
          data: {
            id,
            efiTxid: billingMethod === 'PIX' ? id.replace(/-/g, '') : null,
            companyId,
            invoiceId,
            billingMethod,
            feeVersionId: feeVersion.id,
            replacesChargeId,
            expiresAt: replacementDueDate,
            gatewayStatusRaw: replacesChargeId
              ? 'REPLACEMENT_CANCEL_PENDING'
              : null,
            grossAmountCents,
            estimatedEfiFeeCents: quote.estimatedEfiFeeCents,
            estimatedPlatformFeeCents: quote.estimatedPlatformFeeCents,
            feeSnapshot: this.fees.toSnapshot(feeVersion),
            status: 'PENDING',
          },
        });
      },
    );
  }

  async markIssued(
    chargeId: string,
    companyId: string,
    result: EfiPaymentResult,
  ): Promise<void> {
    await this.transition(chargeId, companyId, 'ACTIVE', {
      gatewayId: result.gatewayId,
      efiTxid: result.txid,
      efiChargeId: result.chargeId,
      pixPayload: result.pixCopyPaste,
      boletoLine: result.boletoCode,
      paymentUrl: result.paymentLink,
      splitConfigId: result.splitConfigId,
      expiresAt: result.expiresAt,
      issuedAt: new Date(),
    });
  }

  async markFailed(chargeId: string, companyId: string): Promise<void> {
    await this.transition(chargeId, companyId, 'FAILED', {});
  }

  async recordSettlement(
    charge: SettlementCharge,
    effectiveEfiFeeCents: number | null,
    providerStatus: string,
  ): Promise<boolean> {
    if (
      effectiveEfiFeeCents !== null &&
      (!Number.isSafeInteger(effectiveEfiFeeCents) || effectiveEfiFeeCents < 0)
    ) {
      throw new HttpException('Tarifa efetiva inválida.', 400);
    }
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<boolean> => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Invoice" WHERE id=${charge.invoiceId} AND "companyId"=${charge.companyId} FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "PaymentCharge" WHERE id=${charge.id} AND "companyId"=${charge.companyId} FOR UPDATE`,
        );
        const current = await tx.paymentCharge.findFirst({
          where: { id: charge.id, companyId: charge.companyId },
        });
        if (!current || current.status === 'REFUNDED') return false;
        const gatewayStatusRaw =
          current.gatewayStatusRaw === 'partially_refunded'
            ? current.gatewayStatusRaw
            : providerStatus;
        await tx.paymentCharge.updateMany({
          where: { id: charge.id, companyId: charge.companyId },
          data: {
            status: 'PAID',
            effectiveEfiFeeCents:
              effectiveEfiFeeCents ?? current.effectiveEfiFeeCents,
            effectivePlatformFeeCents:
              current.effectivePlatformFeeCents ??
              current.estimatedPlatformFeeCents,
            paidAt: current.paidAt ?? new Date(),
            gatewayStatusRaw,
          },
        });
        if (current.status !== 'PAID')
          await tx.paymentChargeStatusHistory.create({
            data: {
              paymentChargeId: charge.id,
              previousStatus: current.status,
              status: 'PAID',
              providerStatus,
            },
          });
        if (
          effectiveEfiFeeCents !== null &&
          effectiveEfiFeeCents !== current.effectiveEfiFeeCents &&
          this.fees.hasEffectiveFeeDivergence(
            current.estimatedEfiFeeCents,
            effectiveEfiFeeCents,
          )
        ) {
          await tx.collectionLog.create({
            data: {
              companyId: charge.companyId,
              invoiceId: charge.invoiceId,
              actionType: 'EFI_FEE_DIVERGENCE',
              description:
                'Tarifa Efí efetiva divergiu da estimativa da emissão.',
              status: 'REVIEW_REQUIRED',
            },
          });
        }
        const updated = await tx.invoice.updateMany({
          where: {
            ...this.currentInvoiceWhere(current),
            status: { not: 'PAID' },
          },
          data: {
            status: 'PAID',
            paidAt: current.paidAt ?? new Date(),
            gatewayStatusRaw,
          },
        });
        return updated.count === 1;
      },
    );
  }

  async recordPixRefunds(
    charge: Pick<PaymentCharge, 'id' | 'companyId' | 'invoiceId'>,
    refunds: ConfirmedPixRefund[],
  ): Promise<'PAID' | 'REFUNDED'> {
    return this.prisma.$transaction(
      async (tx): Promise<'PAID' | 'REFUNDED'> => {
        // Match the invoice-before-charge lock order used by replacement reservations.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Invoice" WHERE id=${charge.invoiceId} AND "companyId"=${charge.companyId} FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "PaymentCharge" WHERE id=${charge.id} AND "companyId"=${charge.companyId} FOR UPDATE`,
        );
        const current = await tx.paymentCharge.findFirst({
          where: { id: charge.id, companyId: charge.companyId },
        });
        if (!current) throw new HttpException('Cobrança não encontrada.', 404);
        if (current.status === 'REFUNDED') return 'REFUNDED';
        const history = await tx.paymentChargeStatusHistory.findMany({
          where: {
            paymentChargeId: charge.id,
            paymentCharge: { companyId: charge.companyId },
            providerStatus: 'DEVOLVIDO',
          },
          select: { sanitizedDetails: true },
        });
        const known = new Map<string, number>();
        for (const event of history) {
          const data = event.sanitizedDetails;
          if (
            data &&
            typeof data === 'object' &&
            !Array.isArray(data) &&
            typeof data.providerRefundId === 'string' &&
            typeof data.amountCents === 'number'
          )
            known.set(data.providerRefundId, data.amountCents);
        }
        let total = [...known.values()].reduce((sum, value) => sum + value, 0);
        let previousStatus: PaymentChargeStatus = current.status;
        for (const refund of refunds) {
          if (
            !refund.providerRefundId ||
            !Number.isSafeInteger(refund.amountCents) ||
            refund.amountCents <= 0
          )
            throw new HttpException('Devolução inválida.', 400);
          const priorAmount = known.get(refund.providerRefundId);
          if (priorAmount !== undefined) {
            if (priorAmount !== refund.amountCents)
              throw new HttpException('Devolução divergente.', 409);
            continue;
          }
          total += refund.amountCents;
          if (total > current.grossAmountCents)
            throw new HttpException('Devolução excede a cobrança.', 409);
          const status =
            total === current.grossAmountCents ? 'REFUNDED' : 'PAID';
          await tx.paymentChargeStatusHistory.create({
            data: {
              paymentChargeId: charge.id,
              previousStatus,
              status,
              providerStatus: 'DEVOLVIDO',
              sanitizedDetails: {
                providerRefundId: refund.providerRefundId,
                amountCents: refund.amountCents,
              },
            },
          });
          known.set(refund.providerRefundId, refund.amountCents);
          previousStatus = status;
        }
        const status = total === current.grossAmountCents ? 'REFUNDED' : 'PAID';
        const gatewayStatusRaw =
          status === 'REFUNDED' ? 'refunded' : 'partially_refunded';
        await tx.paymentCharge.updateMany({
          where: { id: charge.id, companyId: charge.companyId },
          data: { status, gatewayStatusRaw },
        });
        await tx.invoice.updateMany({
          where: this.currentInvoiceWhere(current),
          data: {
            status: status === 'REFUNDED' ? 'CANCELED' : 'PAID',
            gatewayStatusRaw,
          },
        });
        return status;
      },
    );
  }

  private currentInvoiceWhere(charge: PaymentCharge): Prisma.InvoiceWhereInput {
    const identifiers: Prisma.InvoiceWhereInput[] = [];
    if (charge.gatewayId) identifiers.push({ gatewayId: charge.gatewayId });
    if (charge.efiTxid) identifiers.push({ efiTxid: charge.efiTxid });
    if (charge.efiChargeId)
      identifiers.push({ efiChargeId: charge.efiChargeId });
    identifiers.push({
      gatewayId: null,
      efiTxid: null,
      efiChargeId: null,
      paymentCharges: {
        none: {
          id: { not: charge.id },
          status: { in: ['PENDING', 'ACTIVE', 'PAID'] },
        },
      },
    });
    return {
      id: charge.invoiceId,
      companyId: charge.companyId,
      OR: identifiers,
    };
  }

  async transition(
    chargeId: string,
    companyId: string,
    status: PaymentChargeStatus,
    data: Prisma.PaymentChargeUpdateManyMutationInput,
    providerStatus?: string,
  ): Promise<void> {
    const identity = await this.prisma.paymentCharge.findFirst({
      where: { id: chargeId, companyId },
      select: { invoiceId: true },
    });
    if (!identity) return;
    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<void> => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Invoice" WHERE id=${identity.invoiceId} AND "companyId"=${companyId} FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "PaymentCharge" WHERE id=${chargeId} AND "companyId"=${companyId} FOR UPDATE`,
        );
        const current = await tx.paymentCharge.findFirst({
          where: { id: chargeId, companyId },
        });
        if (!current) return;
        const target =
          current.status === 'REFUNDED'
            ? 'REFUNDED'
            : current.status === 'PAID' && status !== 'REFUNDED'
              ? 'PAID'
              : current.status === 'REPLACED' &&
                  ['CANCELED', 'EXPIRED'].includes(status)
                ? 'REPLACED'
                : status;
        const changed = await tx.paymentCharge.updateMany({
          where: { id: chargeId, companyId, status: current.status },
          data: {
            ...data,
            status: target,
            ...(target !== status
              ? { gatewayStatusRaw: current.gatewayStatusRaw }
              : {}),
          },
        });
        if (
          changed.count === 1 &&
          providerStatus &&
          target === status &&
          ['REFUNDED', 'CANCELED', 'EXPIRED'].includes(target)
        ) {
          await tx.invoice.updateMany({
            where: {
              ...this.currentInvoiceWhere(current),
              ...(target !== 'REFUNDED'
                ? { status: { not: 'PAID' as const } }
                : {}),
            },
            data: { status: 'CANCELED', gatewayStatusRaw: providerStatus },
          });
        }
        if (changed.count !== 1 || current.status === target) return;
        await tx.paymentChargeStatusHistory.create({
          data: {
            paymentChargeId: chargeId,
            previousStatus: current.status,
            status: target,
            providerStatus,
          },
        });
      },
    );
  }
}
