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
import type { IssuanceContext } from '../financial-activation/financial-eligibility.service';
import { resolveChargeDistribution } from '../financial-activation/financial-activation.types';
import {
  recordDuplicatePayment,
  SettlementEvidence,
  syncSettlement,
} from '../settlements/settlement-ledger';
import { IssuanceFailure, issuanceFailureDetails } from './efi-issuance-error';

// Instruments of an issued charge, from the creation response or recovered
// from the provider detail during reconciliation.
export interface IssuanceConfirmation {
  source: 'CREATION' | 'RECONCILIATION';
  billingMethod: 'PIX' | 'BOLETO' | 'BOLIX';
  gatewayId: string;
  txid?: string;
  locId?: string;
  providerChargeId?: string;
  pixCopyPaste?: string;
  boletoCode?: string;
  boletoLink?: string;
  boletoPdf?: string;
  paymentLink: string;
  expiresAt: Date;
  splitConfigId?: string;
  providerStatus?: string;
  discountApplied?: string | null;
}

// Diagnosis of a reconciliation that did not change the charge, or that
// proved the provider never created it.
export interface ReconciliationOutcome {
  reasonCode: string;
  providerStatus?: string | null;
  // Only from DRAFT/PENDING: the provider proved the charge does not exist.
  fail?: boolean;
  gatewayStatusRaw?: string;
}

const OPEN_ISSUANCE: PaymentChargeStatus[] = ['DRAFT', 'PENDING'];

// `distinctPayment`: the reference identifies one payment (Pix endToEndId),
// so another reference on a paid charge is a second payment.
export type PaymentEvidence = SettlementEvidence & {
  distinctPayment?: boolean;
};

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
    financial: IssuanceContext,
    replacesChargeId?: string,
    replacementDueDate?: Date,
  ): Promise<PaymentCharge> {
    if (billingMethod !== 'PIX' && billingMethod !== 'BOLIX')
      throw new HttpException('Novas cobranças devem usar Pix ou Bolix.', 403);
    const feeVersion = await this.fees.resolveActiveVersion(
      companyId,
      billingMethod,
    );
    const quote = this.fees.calculateQuote(grossAmountCents, feeVersion);
    const distribution = resolveChargeDistribution({
      accountMode: financial.accountMode,
      payoutMode: financial.payoutMode,
      method: billingMethod,
      platformFeeCharged:
        (feeVersion.platformFeeAmountCents ?? 0) > 0 ||
        (feeVersion.platformFeeBasisPoints ?? 0) > 0,
    });
    const id = randomUUID();
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<PaymentCharge> => {
        // Activation locks the company FOR UPDATE: the profile read here is
        // the one this charge is issued under, or the issuance is refused.
        const [company] = await tx.$queryRaw<
          Array<{ activeFinancialProfileId: string | null }>
        >(
          Prisma.sql`SELECT "activeFinancialProfileId" FROM "Company" WHERE id=${companyId} FOR SHARE`,
        );
        if (company?.activeFinancialProfileId !== financial.financialProfileId)
          throw new HttpException(
            {
              code: 'FINANCIAL_PROFILE_CHANGED',
              message:
                'A ativação financeira mudou durante a emissão. Tente novamente.',
            },
            409,
          );
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            lateFineBasisPoints: number;
            lateInterestMonthlyBasisPoints: number;
            paymentDaysAfterDue: number;
          }>
        >(
          Prisma.sql`SELECT id, status, "lateFineBasisPoints", "lateInterestMonthlyBasisPoints", "paymentDaysAfterDue" FROM "Invoice" WHERE id=${invoiceId} AND "companyId"=${companyId} FOR UPDATE`,
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
            // Issuance context: account, credential and modes are fixed now,
            // before any provider call, and never change afterwards.
            financialProfileId: financial.financialProfileId,
            issuerIdentityId: financial.issuerIdentityId,
            issuerCredentialVersionId: financial.issuerCredentialVersionId,
            accountMode: financial.accountMode,
            payoutMode: financial.payoutMode,
            financialEnvironment: financial.financialEnvironment,
            distributionSnapshot: {
              ...distribution,
              grossAmountCents,
              estimatedEfiFeeCents: quote.estimatedEfiFeeCents,
              estimatedPlatformFeeCents: quote.estimatedPlatformFeeCents,
            },
            lateFineBasisPoints: lockedInvoice.lateFineBasisPoints,
            lateInterestMonthlyBasisPoints:
              lockedInvoice.lateInterestMonthlyBasisPoints,
            paymentDaysAfterDue: lockedInvoice.paymentDaysAfterDue,
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

  // Charge ACTIVE, invoice instruments and history in one transaction, for a
  // new issuance and for one recovered by reconciliation. A charge already
  // settled or closed (e.g. by a webhook) is never reopened.
  async confirmIssuance(
    companyId: string,
    chargeId: string,
    confirmation: IssuanceConfirmation,
  ): Promise<'ACTIVE' | 'ALREADY_FINALIZED'> {
    const identity = await this.prisma.paymentCharge.findFirst({
      where: { id: chargeId, companyId },
      select: { invoiceId: true },
    });
    if (!identity) throw new HttpException('Cobrança não encontrada.', 404);
    return this.prisma.$transaction(
      async (tx): Promise<'ACTIVE' | 'ALREADY_FINALIZED'> => {
        await this.lockIssuance(tx, identity.invoiceId, chargeId, companyId);
        const current = await tx.paymentCharge.findFirst({
          where: { id: chargeId, companyId },
        });
        if (!current) throw new HttpException('Cobrança não encontrada.', 404);
        if (
          (current.efiChargeId &&
            confirmation.providerChargeId &&
            current.efiChargeId !== confirmation.providerChargeId) ||
          (current.efiTxid &&
            confirmation.txid &&
            current.efiTxid !== confirmation.txid) ||
          current.billingMethod !== confirmation.billingMethod
        )
          throw new HttpException(
            {
              code: 'PROVIDER_REFERENCE_MISMATCH',
              message: 'A emissão confirmada não corresponde a esta cobrança.',
            },
            409,
          );
        if (current.status === 'ACTIVE') return 'ACTIVE';
        if (!OPEN_ISSUANCE.includes(current.status)) return 'ALREADY_FINALIZED';
        const issuedAt = current.issuedAt ?? new Date();
        await tx.paymentCharge.updateMany({
          where: { id: chargeId, companyId, status: current.status },
          data: {
            status: 'ACTIVE',
            gatewayId: confirmation.gatewayId,
            efiTxid: confirmation.txid ?? current.efiTxid,
            efiChargeId: confirmation.providerChargeId ?? current.efiChargeId,
            efiLocId: confirmation.locId ?? current.efiLocId,
            pixPayload: confirmation.pixCopyPaste,
            boletoLine: confirmation.boletoCode,
            paymentUrl: confirmation.paymentLink,
            splitConfigId: confirmation.splitConfigId ?? current.splitConfigId,
            expiresAt: confirmation.expiresAt,
            issuedAt,
          },
        });
        await tx.paymentChargeStatusHistory.create({
          data: {
            paymentChargeId: chargeId,
            previousStatus: current.status,
            status: 'ACTIVE',
            providerStatus: confirmation.providerStatus ?? null,
            sanitizedDetails: {
              event: 'ISSUANCE_CONFIRMED',
              source: confirmation.source,
            },
          },
        });
        const pix = confirmation.billingMethod === 'PIX';
        const updated = await tx.invoice.updateMany({
          where: {
            id: current.invoiceId,
            companyId,
            status: { in: ['DRAFT', 'PENDING'] },
          },
          data: pix
            ? {
                gatewayId: confirmation.gatewayId,
                billingType: 'PIX',
                status: 'PENDING',
                pixPayload: confirmation.pixCopyPaste,
                pixExpiresAt: confirmation.expiresAt,
                efiTxid: confirmation.txid,
                efiLocId: confirmation.locId,
                efiPixCopiaECola: confirmation.pixCopyPaste,
                splitConfigId: confirmation.splitConfigId,
                gatewayStatusRaw: confirmation.providerStatus,
                discountApplied: confirmation.discountApplied ?? null,
              }
            : {
                gatewayId: confirmation.gatewayId,
                billingType: confirmation.billingMethod,
                status: 'PENDING',
                pixExpiresAt: confirmation.expiresAt,
                efiChargeId: confirmation.providerChargeId,
                boletoLinhaDigitavel: confirmation.boletoCode,
                boletoLink: confirmation.boletoLink,
                boletoPdf: confirmation.boletoPdf,
                efiPixCopiaECola: confirmation.pixCopyPaste,
                gatewayStatusRaw: confirmation.providerStatus,
                discountApplied: confirmation.discountApplied ?? null,
              },
        });
        if (updated.count === 1)
          await tx.collectionLog.create({
            data: {
              companyId,
              invoiceId: current.invoiceId,
              ...this.issuanceLog(confirmation),
              status: 'PENDING',
            },
          });
        return 'ACTIVE';
      },
    );
  }

  // Records why an issuance stopped. Only a proven refusal releases the
  // reservation (FAILED); an uncertain outcome keeps it PENDING for
  // reconciliation, with the diagnosis attached.
  async recordIssuanceFailure(
    chargeId: string,
    companyId: string,
    failure: IssuanceFailure,
  ): Promise<PaymentChargeStatus | null> {
    return this.recordDiagnosis(
      chargeId,
      companyId,
      failure.kind === 'REJECTED',
      issuanceFailureDetails(failure),
      null,
    );
  }

  async recordReconciliation(
    chargeId: string,
    companyId: string,
    outcome: ReconciliationOutcome,
  ): Promise<PaymentChargeStatus | null> {
    return this.recordDiagnosis(
      chargeId,
      companyId,
      Boolean(outcome.fail),
      { event: 'RECONCILIATION', reasonCode: outcome.reasonCode },
      outcome.providerStatus ?? null,
      outcome.gatewayStatusRaw,
    );
  }

  // Associates the Efí charge returned by the creation or found by its
  // custom_id. Only an open reservation takes a reference, and the unique
  // index keeps one provider charge from being linked to two local charges.
  async attachProviderReference(
    chargeId: string,
    companyId: string,
    providerChargeId: string,
    gatewayStatusRaw?: string,
  ): Promise<void> {
    const identity = await this.prisma.paymentCharge.findFirst({
      where: { id: chargeId, companyId },
      select: { invoiceId: true },
    });
    if (!identity) throw new HttpException('Cobrança não encontrada.', 404);
    const conflict = () =>
      new HttpException(
        {
          code: 'PROVIDER_REFERENCE_MISMATCH',
          message: 'A referência da Efí já pertence a outra cobrança.',
        },
        409,
      );
    try {
      await this.prisma.$transaction(async (tx): Promise<void> => {
        await this.lockIssuance(tx, identity.invoiceId, chargeId, companyId);
        const current = await tx.paymentCharge.findFirst({
          where: { id: chargeId, companyId },
        });
        if (!current) throw new HttpException('Cobrança não encontrada.', 404);
        if (!OPEN_ISSUANCE.includes(current.status))
          throw new HttpException(
            {
              code: 'ISSUANCE_NOT_OPEN',
              message: 'A tentativa de emissão já foi encerrada.',
            },
            409,
          );
        if (
          current.efiTxid ||
          (current.efiChargeId && current.efiChargeId !== providerChargeId)
        )
          throw conflict();
        await tx.paymentCharge.updateMany({
          where: { id: chargeId, companyId, status: current.status },
          data: {
            efiChargeId: providerChargeId,
            gatewayId: providerChargeId,
            ...(gatewayStatusRaw ? { gatewayStatusRaw } : {}),
          },
        });
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw conflict();
      throw error;
    }
  }

  private async recordDiagnosis(
    chargeId: string,
    companyId: string,
    fail: boolean,
    details: Prisma.InputJsonObject,
    providerStatus: string | null,
    gatewayStatusRaw?: string,
  ): Promise<PaymentChargeStatus | null> {
    const identity = await this.prisma.paymentCharge.findFirst({
      where: { id: chargeId, companyId },
      select: { invoiceId: true },
    });
    if (!identity) return null;
    return this.prisma.$transaction(
      async (tx): Promise<PaymentChargeStatus | null> => {
        await this.lockIssuance(tx, identity.invoiceId, chargeId, companyId);
        const current = await tx.paymentCharge.findFirst({
          where: { id: chargeId, companyId },
        });
        if (!current) return null;
        // A provider reference attached meanwhile means the charge exists.
        const target: PaymentChargeStatus =
          fail && OPEN_ISSUANCE.includes(current.status) && !current.efiChargeId
            ? 'FAILED'
            : current.status;
        if (target !== current.status || gatewayStatusRaw) {
          const changed = await tx.paymentCharge.updateMany({
            where: { id: chargeId, companyId, status: current.status },
            data: {
              status: target,
              ...(gatewayStatusRaw ? { gatewayStatusRaw } : {}),
            },
          });
          if (changed.count !== 1) return current.status;
        }
        // Also written when only the diagnosis changed: no new issuance.
        await tx.paymentChargeStatusHistory.create({
          data: {
            paymentChargeId: chargeId,
            previousStatus: current.status,
            status: target,
            providerStatus,
            sanitizedDetails: details,
          },
        });
        return target;
      },
    );
  }

  // Same lock order as transition(): invoice, then charge.
  private async lockIssuance(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    chargeId: string,
    companyId: string,
  ): Promise<void> {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Invoice" WHERE id=${invoiceId} AND "companyId"=${companyId} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "PaymentCharge" WHERE id=${chargeId} AND "companyId"=${companyId} FOR UPDATE`,
    );
  }

  private issuanceLog(confirmation: IssuanceConfirmation): {
    actionType: string;
    description: string;
  } {
    if (confirmation.source === 'RECONCILIATION')
      return {
        actionType: 'EFI_ISSUANCE_RECOVERED',
        description:
          'Emissão localizada na Efí e confirmada pela conciliação, sem novo envio.',
      };
    if (confirmation.billingMethod === 'PIX')
      return {
        actionType: 'EFI_PIX_CREATED',
        description: 'Pix CobV Efi criado com split automatico',
      };
    return confirmation.billingMethod === 'BOLIX'
      ? {
          actionType: 'EFI_BOLIX_CREATED',
          description: 'Bolix Efi criado com split automatico',
        }
      : {
          actionType: 'EFI_BOLETO_CREATED',
          description: 'Boleto Efi criado com split automatico',
        };
  }

  async recordSettlement(
    charge: SettlementCharge,
    effectiveEfiFeeCents: number | null,
    providerStatus: string,
    // Amount the payer actually paid (with fine and interest), when known.
    paidAmountCents: number | null = null,
    evidence: PaymentEvidence = { source: 'SYSTEM' },
  ): Promise<boolean> {
    if (
      paidAmountCents !== null &&
      (!Number.isSafeInteger(paidAmountCents) || paidAmountCents <= 0)
    ) {
      throw new HttpException('Valor pago inválido.', 400);
    }
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
        if (!current) return false;
        if (
          (current.status === 'PAID' || current.status === 'REFUNDED') &&
          (await this.isAnotherPayment(tx, current.id, evidence))
        ) {
          await recordDuplicatePayment(
            tx,
            current.id,
            current.companyId,
            paidAmountCents ?? current.grossAmountCents,
            { source: evidence.source, reference: evidence.reference ?? '' },
          );
          return false;
        }
        if (current.status === 'REFUNDED') return false;
        const paid = paidAmountCents ?? current.paidAmountCents ?? null;
        // The CifraMais fee is charged on the amount actually paid.
        const effectivePlatformFeeCents =
          current.billingMethod === 'CREDIT_CARD'
            ? current.estimatedPlatformFeeCents
            : paid !== null
              ? this.fees.calculateQuote(
                  paid,
                  await tx.paymentFeeVersion.findUniqueOrThrow({
                    where: { id: current.feeVersionId },
                  }),
                ).estimatedPlatformFeeCents
              : (current.effectivePlatformFeeCents ??
                current.estimatedPlatformFeeCents);
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
            effectivePlatformFeeCents,
            paidAmountCents: paid,
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
        // Less than the charged amount is a partial payment: it settles the
        // charge as reported, but needs an administrative decision.
        if (
          paid !== null &&
          paid < current.grossAmountCents &&
          current.paidAmountCents === null
        )
          await tx.collectionLog.create({
            data: {
              companyId: charge.companyId,
              invoiceId: charge.invoiceId,
              actionType: 'PAYMENT_AMOUNT_DIVERGENCE',
              description:
                'Valor pago menor que o valor da cobrança; requer decisão administrativa.',
              status: 'REVIEW_REQUIRED',
            },
          });
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
        await syncSettlement(tx, current.id, current.companyId, evidence);
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
        // Refunds are limited to what was actually paid (fine/interest included).
        const refundable = current.paidAmountCents ?? current.grossAmountCents;
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
          if (total > refundable)
            throw new HttpException('Devolução excede a cobrança.', 409);
          const status = total === refundable ? 'REFUNDED' : 'PAID';
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
        const status = total === refundable ? 'REFUNDED' : 'PAID';
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
        await syncSettlement(tx, current.id, current.companyId, {
          source: 'PROVIDER_WEBHOOK',
          reference: refunds.at(-1)?.providerRefundId,
        });
        return status;
      },
    );
  }

  // True when the evidence names a payment other than the one already
  // recorded for this charge.
  private async isAnotherPayment(
    tx: Prisma.TransactionClient,
    chargeId: string,
    evidence: PaymentEvidence,
  ): Promise<boolean> {
    if (!evidence.distinctPayment || !evidence.reference) return false;
    const first = await tx.financialLedgerEntry.findUnique({
      where: { idempotencyKey: `PAYMENT:${chargeId}:0` },
      select: { evidenceReference: true },
    });
    return Boolean(
      first?.evidenceReference &&
      first.evidenceReference !== evidence.reference.trim().slice(0, 128),
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
        if (changed.count === 1 && target === 'REFUNDED')
          await syncSettlement(tx, chargeId, companyId, {
            source: 'PROVIDER_WEBHOOK',
            reference: providerStatus,
          });
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
