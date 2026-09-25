import {
  LedgerEntryKind,
  LedgerEntrySource,
  PaymentSettlementStatus,
  PlatformFeeEvidenceStatus,
  Prisma,
} from '@prisma/client';

// Where the fact behind a ledger entry came from, and its external
// identifier (Pix endToEndId, Efí notification event, statement line).
export interface SettlementEvidence {
  source: LedgerEntrySource;
  reference?: string | null;
}

export const DIVERGENCE = {
  PAYMENT_BELOW_CHARGE: 'PAYMENT_BELOW_CHARGE',
  PAYMENT_ABOVE_EXPECTED: 'PAYMENT_ABOVE_EXPECTED',
  DUPLICATE_PAYMENT: 'DUPLICATE_PAYMENT',
  PLATFORM_FEE_EVIDENCE_MISMATCH: 'PLATFORM_FEE_EVIDENCE_MISMATCH',
  PLATFORM_FEE_CHANGED_AFTER_EVIDENCE: 'PLATFORM_FEE_CHANGED_AFTER_EVIDENCE',
  PLATFORM_FEE_REVERSAL_DUE: 'PLATFORM_FEE_REVERSAL_DUE',
} as const;

const DAY_MS = 86_400_000;
const SYNCED_KINDS = [
  'PAYMENT',
  'EFI_FEE',
  'PLATFORM_FEE',
  'REFUND',
  'PLATFORM_FEE_REVERSAL',
] as const satisfies readonly LedgerEntryKind[];

function reference(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 128) : null;
}

// Proportional reversal without floating point; never above the fee.
export function proportionalReversal(
  platformFeeCents: number,
  refundedCents: number,
  paidCents: number,
): number {
  if (platformFeeCents <= 0 || refundedCents <= 0 || paidCents <= 0) return 0;
  if (refundedCents >= paidCents) return platformFeeCents;
  const numerator = BigInt(platformFeeCents) * BigInt(refundedCents);
  const denominator = BigInt(paidCents);
  // Round half up.
  const rounded = (numerator * 2n + denominator) / (2n * denominator);
  return Math.min(Number(rounded), platformFeeCents);
}

// Upper bound for a payment with fine and interest: gross + fine + interest
// per calendar day of delay (monthly rate / 30), rounded up.
export function maxExpectedPaymentCents(input: {
  grossAmountCents: number;
  dueDate: Date;
  paidAt: Date;
  lateFineBasisPoints: number;
  lateInterestMonthlyBasisPoints: number;
}): number {
  const lateDays = Math.max(
    0,
    Math.ceil((input.paidAt.getTime() - input.dueDate.getTime()) / DAY_MS) - 1,
  );
  if (lateDays === 0) return input.grossAmountCents;
  const fine = Math.ceil(
    (input.grossAmountCents * input.lateFineBasisPoints) / 10_000,
  );
  const interest = Math.ceil(
    (input.grossAmountCents * input.lateInterestMonthlyBasisPoints * lateDays) /
      (10_000 * 30),
  );
  return input.grossAmountCents + fine + interest;
}

// Brings the append-only ledger and the settlement of a paid charge in line
// with the charge's current state. Callers hold the charge row lock, so the
// sequence numbers in the idempotency keys cannot race.
export async function syncSettlement(
  tx: Prisma.TransactionClient,
  chargeId: string,
  companyId: string,
  evidence: SettlementEvidence,
): Promise<void> {
  const charge = await tx.paymentCharge.findFirst({
    where: { id: chargeId, companyId },
    include: {
      invoice: { select: { dueDate: true } },
      company: { select: { refundPlatformFeeOnRefund: true } },
    },
  });
  if (!charge || (charge.status !== 'PAID' && charge.status !== 'REFUNDED'))
    return;

  const paidKnown = charge.paidAmountCents !== null;
  const paid = charge.paidAmountCents ?? charge.grossAmountCents;
  const platformFee =
    charge.effectivePlatformFeeCents ?? charge.estimatedPlatformFeeCents;
  const refunds = await refundedCents(tx, charge.id, charge.status, paid);
  const reversal = charge.company.refundPlatformFeeOnRefund
    ? proportionalReversal(platformFee, refunds, paid)
    : 0;
  const targets: Record<
    (typeof SYNCED_KINDS)[number],
    { amount: number; estimated: boolean }
  > = {
    PAYMENT: { amount: paid, estimated: !paidKnown },
    EFI_FEE: {
      amount: -(charge.effectiveEfiFeeCents ?? charge.estimatedEfiFeeCents),
      estimated: charge.effectiveEfiFeeCents === null,
    },
    PLATFORM_FEE: { amount: -platformFee, estimated: false },
    REFUND: { amount: -refunds, estimated: false },
    PLATFORM_FEE_REVERSAL: { amount: reversal, estimated: false },
  };

  let settlement = await tx.paymentSettlement.findUnique({
    where: { paymentChargeId: charge.id },
  });
  settlement ??= await tx.paymentSettlement.create({
    data: {
      companyId: charge.companyId,
      paymentChargeId: charge.id,
      invoiceId: charge.invoiceId,
      accountMode: charge.accountMode,
      financialEnvironment: charge.financialEnvironment,
      status: 'AWAITING_EVIDENCE',
      evidenceStatus: platformFee > 0 ? 'PENDING' : 'NOT_REQUIRED',
      platformFeeDueCents: platformFee,
    },
  });
  // Evidence and decisions lock the settlement too; read it under the lock.
  settlement = await lockSettlement(tx, settlement.id);

  const entries = await tx.financialLedgerEntry.groupBy({
    by: ['kind'],
    where: { settlementId: settlement.id },
    _sum: { amountCents: true },
    _count: { _all: true },
  });
  for (const kind of SYNCED_KINDS) {
    const current = entries.find((row) => row.kind === kind);
    const delta = targets[kind].amount - (current?._sum.amountCents ?? 0);
    if (delta === 0) continue;
    await tx.financialLedgerEntry.create({
      data: {
        companyId: charge.companyId,
        paymentChargeId: charge.id,
        settlementId: settlement.id,
        kind,
        amountCents: delta,
        estimated: targets[kind].estimated,
        source: evidence.source,
        evidenceReference: reference(evidence.reference),
        idempotencyKey: `${kind}:${charge.id}:${current?._count._all ?? 0}`,
      },
    });
  }

  // Divergences needing an administrative decision.
  if (paidKnown && paid < charge.grossAmountCents)
    await openDivergence(tx, settlement, DIVERGENCE.PAYMENT_BELOW_CHARGE, {
      amountCents: charge.grossAmountCents - paid,
    });
  if (paidKnown && charge.paidAt) {
    const max = maxExpectedPaymentCents({
      grossAmountCents: charge.grossAmountCents,
      dueDate: charge.invoice.dueDate,
      paidAt: charge.paidAt,
      lateFineBasisPoints: charge.lateFineBasisPoints ?? 0,
      lateInterestMonthlyBasisPoints:
        charge.lateInterestMonthlyBasisPoints ?? 0,
    });
    if (paid > max)
      await openDivergence(tx, settlement, DIVERGENCE.PAYMENT_ABOVE_EXPECTED, {
        amountCents: paid - max,
      });
  }
  if (reversal > 0)
    // CifraMais received its fee through split and must return this part.
    await openDivergence(tx, settlement, DIVERGENCE.PLATFORM_FEE_REVERSAL_DUE, {
      amountCents: reversal,
      reference: String(reversal),
    });

  let evidenceStatus: PlatformFeeEvidenceStatus = settlement.evidenceStatus;
  if (platformFee !== settlement.platformFeeDueCents) {
    if (evidenceStatus === 'CONFIRMED' || evidenceStatus === 'MISMATCH')
      await openDivergence(
        tx,
        settlement,
        DIVERGENCE.PLATFORM_FEE_CHANGED_AFTER_EVIDENCE,
        {
          amountCents: platformFee - settlement.platformFeeDueCents,
          reference: String(platformFee),
        },
      );
    else evidenceStatus = platformFee > 0 ? 'PENDING' : 'NOT_REQUIRED';
  }
  await refreshSettlement(tx, settlement.id, {
    platformFeeDueCents: platformFee,
    evidenceStatus,
  });
}

// A second payment of an already paid charge (e.g. a Pix with another
// endToEndId): recorded as money to return, outside the charge's figures.
export async function recordDuplicatePayment(
  tx: Prisma.TransactionClient,
  chargeId: string,
  companyId: string,
  amountCents: number,
  evidence: SettlementEvidence & { reference: string },
): Promise<void> {
  const settlement = await tx.paymentSettlement.findUnique({
    where: { paymentChargeId: chargeId },
  });
  if (!settlement || settlement.companyId !== companyId) return;
  await lockSettlement(tx, settlement.id);
  const ref = reference(evidence.reference) ?? 'unknown';
  const existing = await tx.financialLedgerEntry.findUnique({
    where: { idempotencyKey: `DUPLICATE_PAYMENT:${chargeId}:${ref}` },
  });
  if (!existing)
    await tx.financialLedgerEntry.create({
      data: {
        companyId,
        paymentChargeId: chargeId,
        settlementId: settlement.id,
        kind: 'DUPLICATE_PAYMENT',
        amountCents,
        source: evidence.source,
        evidenceReference: ref,
        idempotencyKey: `DUPLICATE_PAYMENT:${chargeId}:${ref}`,
      },
    });
  await openDivergence(tx, settlement, DIVERGENCE.DUPLICATE_PAYMENT, {
    amountCents,
    reference: ref,
  });
  await refreshSettlement(tx, settlement.id, {});
}

export async function lockSettlement(
  tx: Prisma.TransactionClient,
  settlementId: string,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "PaymentSettlement" WHERE id=${settlementId} FOR UPDATE`,
  );
  return tx.paymentSettlement.findUniqueOrThrow({
    where: { id: settlementId },
  });
}

async function refundedCents(
  tx: Prisma.TransactionClient,
  chargeId: string,
  status: string,
  paid: number,
): Promise<number> {
  const history = await tx.paymentChargeStatusHistory.findMany({
    where: { paymentChargeId: chargeId, providerStatus: 'DEVOLVIDO' },
    select: { sanitizedDetails: true },
  });
  const total = history.reduce((sum, event) => {
    const data = event.sanitizedDetails as { amountCents?: unknown } | null;
    return typeof data?.amountCents === 'number' ? sum + data.amountCents : sum;
  }, 0);
  // Boleto refunds arrive as a full "refunded" status without amounts.
  return status === 'REFUNDED' && total === 0 ? paid : total;
}

export async function openDivergence(
  tx: Prisma.TransactionClient,
  settlement: { id: string; companyId: string },
  code: string,
  data: { amountCents?: number; reference?: string },
): Promise<void> {
  const key = {
    settlementId: settlement.id,
    code,
    reference: data.reference ?? '',
  };
  const existing = await tx.settlementDivergence.findUnique({
    where: { settlementId_code_reference: key },
    select: { id: true },
  });
  if (existing) return;
  await tx.settlementDivergence.create({
    data: {
      ...key,
      companyId: settlement.companyId,
      amountCents: data.amountCents ?? null,
    },
  });
}

// Status: any open divergence → DIVERGENT; fee not yet evidenced →
// AWAITING_EVIDENCE; otherwise RECONCILED.
export async function refreshSettlement(
  tx: Prisma.TransactionClient,
  settlementId: string,
  data: Omit<Prisma.PaymentSettlementUpdateInput, 'status' | 'version'>,
): Promise<void> {
  const current = await tx.paymentSettlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: { evidenceStatus: true },
  });
  const open = await tx.settlementDivergence.count({
    where: { settlementId, status: 'OPEN' },
  });
  const evidenceStatus =
    (data.evidenceStatus as PlatformFeeEvidenceStatus | undefined) ??
    current.evidenceStatus;
  const status: PaymentSettlementStatus =
    open > 0
      ? 'DIVERGENT'
      : evidenceStatus === 'PENDING'
        ? 'AWAITING_EVIDENCE'
        : 'RECONCILED';
  await tx.paymentSettlement.update({
    where: { id: settlementId },
    data: { ...data, status, version: { increment: 1 } },
  });
}
