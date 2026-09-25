import { HttpException, Injectable } from '@nestjs/common';
import { PaymentSettlementStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DIVERGENCE,
  lockSettlement,
  openDivergence,
  refreshSettlement,
} from './settlement-ledger';
import type {
  DivergenceDecision,
  RecordPlatformFeeEvidenceDto,
  ResolveDivergenceDto,
} from './settlements.dto';

const AUDIT_RETENTION_MS = 5 * 365.25 * 86_400_000;

type Requirement = 'reference' | 'note' | 'dueDate';

// Decisions accepted for each divergence and what each one must carry.
const DECISIONS: Record<
  string,
  Partial<Record<DivergenceDecision, Requirement>>
> = {
  [DIVERGENCE.PAYMENT_BELOW_CHARGE]: {
    ACCEPT_AS_SETTLEMENT: 'note',
    ISSUE_COMPLEMENTARY: 'dueDate',
  },
  [DIVERGENCE.PAYMENT_ABOVE_EXPECTED]: {
    ACCEPT_AS_SETTLEMENT: 'note',
    REFUND_REGISTERED: 'reference',
  },
  [DIVERGENCE.DUPLICATE_PAYMENT]: {
    REFUND_REGISTERED: 'reference',
    KEEP_AS_CREDIT: 'note',
  },
  [DIVERGENCE.PLATFORM_FEE_EVIDENCE_MISMATCH]: {
    ACCEPT_DIFFERENCE: 'note',
    ADJUSTMENT_SETTLED: 'reference',
  },
  [DIVERGENCE.PLATFORM_FEE_CHANGED_AFTER_EVIDENCE]: {
    ACCEPT_DIFFERENCE: 'note',
    ADJUSTMENT_SETTLED: 'reference',
  },
  [DIVERGENCE.PLATFORM_FEE_REVERSAL_DUE]: {
    REVERSAL_PAID: 'reference',
    REVERSAL_WAIVED: 'note',
  },
};

export interface SettlementListFilters {
  companyId?: string;
  status?: PaymentSettlementStatus;
  page: number;
  pageSize: number;
}

@Injectable()
export class SettlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: SettlementListFilters) {
    const where: Prisma.PaymentSettlementWhereInput = {
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.paymentSettlement.count({ where }),
      this.prisma.paymentSettlement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: {
          paymentCharge: {
            select: {
              billingMethod: true,
              grossAmountCents: true,
              paidAmountCents: true,
              paidAt: true,
              company: { select: { corporateName: true } },
            },
          },
          divergences: {
            where: { status: 'OPEN' },
            select: { id: true, code: true, amountCents: true },
          },
          ledgerEntries: { select: { kind: true, amountCents: true } },
        },
      }),
    ]);
    return {
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      data: rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        companyName: row.paymentCharge.company.corporateName,
        invoiceId: row.invoiceId,
        paymentChargeId: row.paymentChargeId,
        billingMethod: row.paymentCharge.billingMethod,
        accountMode: row.accountMode,
        environment: row.financialEnvironment,
        status: row.status,
        evidenceStatus: row.evidenceStatus,
        grossAmountCents: row.paymentCharge.grossAmountCents,
        paidAmountCents: row.paymentCharge.paidAmountCents,
        paidAt: row.paymentCharge.paidAt,
        platformFeeDueCents: row.platformFeeDueCents,
        totals: this.totals(row.ledgerEntries),
        openDivergences: row.divergences,
      })),
    };
  }

  async detail(settlementId: string) {
    const settlement = await this.prisma.paymentSettlement.findUnique({
      where: { id: settlementId },
      include: {
        paymentCharge: {
          select: {
            billingMethod: true,
            grossAmountCents: true,
            paidAmountCents: true,
            paidAt: true,
            status: true,
            estimatedEfiFeeCents: true,
            effectiveEfiFeeCents: true,
            effectivePlatformFeeCents: true,
            company: { select: { corporateName: true } },
          },
        },
        ledgerEntries: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
        divergences: { orderBy: { detectedAt: 'asc' } },
        platformFeeEvidence: {
          select: {
            id: true,
            reference: true,
            receivedAmountCents: true,
            expectedAmountCents: true,
            matched: true,
            createdAt: true,
          },
        },
      },
    });
    if (!settlement)
      throw new HttpException(
        {
          code: 'SETTLEMENT_NOT_FOUND',
          message: 'Conciliação não encontrada.',
        },
        404,
      );
    return {
      ...settlement,
      totals: this.totals(settlement.ledgerEntries),
    };
  }

  // What CifraMais has to reconcile. With the customer's own account nothing
  // is held or paid out by CifraMais: there is no "available for payout".
  async summary(companyId?: string) {
    const where = companyId ? { companyId } : {};
    const [byStatus, byKind, estimatedEfi, awaiting, confirmed, divergences] =
      await Promise.all([
        this.prisma.paymentSettlement.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        this.prisma.financialLedgerEntry.groupBy({
          by: ['kind'],
          where,
          _sum: { amountCents: true },
        }),
        this.prisma.financialLedgerEntry.aggregate({
          where: { ...where, kind: 'EFI_FEE', estimated: true },
          _sum: { amountCents: true },
        }),
        this.prisma.paymentSettlement.aggregate({
          where: { ...where, evidenceStatus: 'PENDING' },
          _sum: { platformFeeDueCents: true },
        }),
        this.prisma.paymentSettlement.aggregate({
          where: { ...where, evidenceStatus: 'CONFIRMED' },
          _sum: { platformFeeDueCents: true },
        }),
        this.prisma.settlementDivergence.groupBy({
          by: ['code'],
          where: { ...where, status: 'OPEN' },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
      ]);
    const sum = (kind: string) =>
      byKind.find((row) => row.kind === kind)?._sum.amountCents ?? 0;
    const options = companyId
      ? await this.prisma.company.findUnique({
          where: { id: companyId },
          select: { refundPlatformFeeOnRefund: true },
        })
      : null;
    return {
      ...(options ? { options } : {}),
      settlements: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
      receivedCents: sum('PAYMENT'),
      efiFeeCents: -sum('EFI_FEE'),
      efiFeeEstimatedCents: -(estimatedEfi._sum.amountCents ?? 0),
      platformFeeCents: -sum('PLATFORM_FEE'),
      refundedCents: -sum('REFUND'),
      platformFeeReversalCents: sum('PLATFORM_FEE_REVERSAL'),
      duplicatePaymentsCents: sum('DUPLICATE_PAYMENT'),
      // "Saldo a conciliar": fees expected through split, not yet evidenced.
      platformFeeAwaitingEvidenceCents: awaiting._sum.platformFeeDueCents ?? 0,
      platformFeeEvidencedCents: confirmed._sum.platformFeeDueCents ?? 0,
      openDivergences: divergences.map((row) => ({
        code: row.code,
        count: row._count._all,
        amountCents: row._sum.amountCents ?? 0,
      })),
    };
  }

  // The company's own receipts: read-only, without evidence or decision
  // details. A charge under administrative review shows as such.
  async companyOverview(companyId: string, page: number, pageSize: number) {
    const where = { companyId };
    const [byKind, total, rows] = await Promise.all([
      this.prisma.financialLedgerEntry.groupBy({
        by: ['kind'],
        where,
        _sum: { amountCents: true },
      }),
      this.prisma.paymentSettlement.count({ where }),
      this.prisma.paymentSettlement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          paymentCharge: {
            select: {
              status: true,
              billingMethod: true,
              grossAmountCents: true,
              paidAt: true,
              invoice: {
                select: { id: true, debtor: { select: { name: true } } },
              },
            },
          },
          ledgerEntries: {
            select: { kind: true, amountCents: true, estimated: true },
          },
        },
      }),
    ]);
    const sum = (kind: string) =>
      byKind.find((row) => row.kind === kind)?._sum.amountCents ?? 0;
    return {
      totals: {
        receivedCents: sum('PAYMENT'),
        efiFeeCents: -sum('EFI_FEE'),
        platformFeeCents: -sum('PLATFORM_FEE'),
        refundedCents: -sum('REFUND'),
        platformFeeReversalCents: sum('PLATFORM_FEE_REVERSAL'),
        netCents:
          sum('PAYMENT') +
          sum('EFI_FEE') +
          sum('PLATFORM_FEE') +
          sum('REFUND') +
          sum('PLATFORM_FEE_REVERSAL'),
      },
      total,
      page,
      pageSize,
      data: rows.map((row) => {
        const totals = this.totals(row.ledgerEntries);
        const charge = row.paymentCharge;
        return {
          invoiceId: charge.invoice.id,
          debtorName: charge.invoice.debtor.name,
          billingMethod: charge.billingMethod,
          paidAt: charge.paidAt,
          grossAmountCents: charge.grossAmountCents,
          paidAmountCents: totals.paymentCents,
          efiFeeCents: totals.efiFeeCents,
          efiFeeEstimated: row.ledgerEntries.some(
            (entry) => entry.kind === 'EFI_FEE' && entry.estimated,
          ),
          platformFeeCents: totals.platformFeeCents,
          refundedCents: totals.refundedCents,
          netCents: totals.customerNetCents,
          situation:
            row.status === 'DIVERGENT'
              ? 'IN_REVIEW'
              : charge.status === 'REFUNDED'
                ? 'REFUNDED'
                : totals.refundedCents > 0
                  ? 'PARTIALLY_REFUNDED'
                  : 'RECEIVED',
        };
      }),
    };
  }

  // Confirms, against a statement entry, the CifraMais fees of the selected
  // settlements. The expected total is computed here, never taken from the
  // request. Same reference and same selection is a replay; a reference is
  // never reused for anything else.
  async recordPlatformFeeEvidence(
    userId: string,
    dto: RecordPlatformFeeEvidenceDto,
  ) {
    const reference = dto.reference.trim();
    if (!reference)
      throw new HttpException(
        {
          code: 'EVIDENCE_REFERENCE_REQUIRED',
          message: 'Informe a referência.',
        },
        400,
      );
    const ids = [...dto.settlementIds].sort();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "PaymentSettlement" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
      );
      const settlements = await tx.paymentSettlement.findMany({
        where: { id: { in: ids } },
      });
      if (settlements.length !== ids.length)
        throw new HttpException(
          {
            code: 'SETTLEMENT_NOT_FOUND',
            message: 'Há conciliações inexistentes na seleção.',
          },
          404,
        );
      const scopes = new Set(
        settlements.map((row) => row.financialEnvironment ?? 'LEGACY'),
      );
      if (scopes.size !== 1)
        throw new HttpException(
          {
            code: 'EVIDENCE_SCOPE_MIXED',
            message: 'Selecione cobranças de um único ambiente.',
          },
          400,
        );
      const [scope] = [...scopes] as [string];

      const existing = await tx.platformFeeEvidence.findUnique({
        where: { scope_reference: { scope, reference } },
        include: { settlements: { select: { id: true } } },
      });
      if (existing) {
        const linked = existing.settlements.map((row) => row.id).sort();
        if (
          existing.receivedAmountCents === dto.receivedAmountCents &&
          linked.join() === ids.join()
        )
          return this.evidenceView(existing, linked);
        throw new HttpException(
          {
            code: 'EVIDENCE_REFERENCE_REUSED',
            message: 'Esta referência já foi usada em outra conferência.',
          },
          409,
        );
      }

      const notPending = settlements.filter(
        (row) => row.evidenceStatus !== 'PENDING',
      );
      if (notPending.length > 0)
        throw new HttpException(
          {
            code: 'SETTLEMENT_NOT_AWAITING_EVIDENCE',
            message: 'Há cobranças que não aguardam conferência.',
            settlementIds: notPending.map((row) => row.id),
          },
          409,
        );

      const expected = settlements.reduce(
        (sum, row) => sum + row.platformFeeDueCents,
        0,
      );
      const matched = expected === dto.receivedAmountCents;
      const evidence = await tx.platformFeeEvidence.create({
        data: {
          scope,
          reference,
          receivedAmountCents: dto.receivedAmountCents,
          expectedAmountCents: expected,
          matched,
          note: dto.note?.trim() || null,
          recordedByUserId: userId,
        },
      });
      for (const settlement of settlements) {
        const changed = await tx.paymentSettlement.updateMany({
          where: {
            id: settlement.id,
            version: settlement.version,
            evidenceStatus: 'PENDING',
          },
          data: {
            platformFeeEvidenceId: evidence.id,
            evidenceStatus: matched ? 'CONFIRMED' : 'MISMATCH',
          },
        });
        if (changed.count !== 1)
          throw new HttpException(
            {
              code: 'SETTLEMENT_CHANGED',
              message: 'A conciliação mudou durante a conferência.',
            },
            409,
          );
        if (!matched)
          await openDivergence(
            tx,
            settlement,
            DIVERGENCE.PLATFORM_FEE_EVIDENCE_MISMATCH,
            { reference: evidence.id },
          );
        await refreshSettlement(tx, settlement.id, {});
      }
      for (const companyId of new Set(settlements.map((row) => row.companyId)))
        await tx.auditLog.create({
          data: {
            companyId,
            userId,
            entityType: 'PlatformFeeEvidence',
            entityId: evidence.id,
            action: 'PLATFORM_FEE_EVIDENCE_RECORDED',
            changes: {
              reference,
              matched,
              settlementIds: settlements
                .filter((row) => row.companyId === companyId)
                .map((row) => row.id),
            },
            retentionExpiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
          },
        });
      return this.evidenceView(evidence, ids);
    });
  }

  async resolveDivergence(
    userId: string,
    divergenceId: string,
    dto: ResolveDivergenceDto,
  ) {
    const found = await this.prisma.settlementDivergence.findUnique({
      where: { id: divergenceId },
      select: { settlementId: true },
    });
    if (!found)
      throw new HttpException(
        {
          code: 'DIVERGENCE_NOT_FOUND',
          message: 'Divergência não encontrada.',
        },
        404,
      );
    return this.prisma.$transaction(async (tx) => {
      const settlement = await lockSettlement(tx, found.settlementId);
      const divergence = await tx.settlementDivergence.findUniqueOrThrow({
        where: { id: divergenceId },
      });
      if (divergence.status === 'RESOLVED') {
        if (divergence.decision === dto.decision) return divergence;
        throw new HttpException(
          {
            code: 'DIVERGENCE_ALREADY_RESOLVED',
            message: 'Esta divergência já foi decidida.',
          },
          409,
        );
      }
      const requirement = DECISIONS[divergence.code]?.[dto.decision];
      if (!requirement)
        throw new HttpException(
          {
            code: 'DECISION_NOT_ALLOWED',
            message: 'Decisão não aplicável a esta divergência.',
          },
          400,
        );
      const reference = dto.reference?.trim() || null;
      const note = dto.note?.trim() || null;
      if (requirement === 'reference' && !reference)
        this.missing('Informe a referência do comprovante.');
      if (requirement === 'note' && !note)
        this.missing('Descreva o motivo da decisão.');

      let complementaryInvoiceId: string | null = null;
      if (dto.decision === 'ISSUE_COMPLEMENTARY')
        complementaryInvoiceId = await this.createComplementaryInvoice(
          tx,
          settlement,
          divergence.amountCents,
          dto.dueDate,
        );

      const resolved = await tx.settlementDivergence.update({
        where: { id: divergence.id },
        data: {
          status: 'RESOLVED',
          decision: dto.decision,
          decisionReference: reference,
          decisionNote: note,
          complementaryInvoiceId,
          resolvedByUserId: userId,
          resolvedAt: new Date(),
        },
      });
      await refreshSettlement(tx, settlement.id, {});
      await tx.auditLog.create({
        data: {
          companyId: settlement.companyId,
          userId,
          entityType: 'SettlementDivergence',
          entityId: divergence.id,
          action: 'SETTLEMENT_DIVERGENCE_RESOLVED',
          changes: {
            code: divergence.code,
            decision: dto.decision,
            reference,
            complementaryInvoiceId,
          },
          retentionExpiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
        },
      });
      return resolved;
    });
  }

  async updateOptions(
    userId: string,
    companyId: string,
    refundPlatformFeeOnRefund: boolean,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, refundPlatformFeeOnRefund: true },
    });
    if (!company)
      throw new HttpException(
        { code: 'COMPANY_NOT_FOUND', message: 'Empresa não encontrada.' },
        404,
      );
    await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id: companyId },
        data: { refundPlatformFeeOnRefund },
      }),
      this.prisma.auditLog.create({
        data: {
          companyId,
          userId,
          entityType: 'Company',
          entityId: companyId,
          action: 'SETTLEMENT_OPTIONS_UPDATED',
          changes: {
            refundPlatformFeeOnRefund: {
              from: company.refundPlatformFeeOnRefund,
              to: refundPlatformFeeOnRefund,
            },
          },
          retentionExpiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
        },
      }),
    ]);
    return { companyId, refundPlatformFeeOnRefund };
  }

  // The unpaid balance becomes a separate invoice linked to the original one,
  // with the same debtor, method and late terms. It is issued as usual.
  private async createComplementaryInvoice(
    tx: Prisma.TransactionClient,
    settlement: { companyId: string; invoiceId: string },
    amountCents: number | null,
    dueDate: string | undefined,
  ): Promise<string> {
    const due = dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (!due || Number.isNaN(due.getTime()) || due < today)
      this.missing('Informe um vencimento a partir de hoje.');
    if (!amountCents || amountCents <= 0)
      this.missing('Divergência sem saldo a cobrar.');
    const original = await tx.invoice.findFirstOrThrow({
      where: { id: settlement.invoiceId, companyId: settlement.companyId },
    });
    const existing = await tx.invoice.findUnique({
      where: { complementsInvoiceId: original.id },
      select: { id: true },
    });
    if (existing)
      throw new HttpException(
        {
          code: 'COMPLEMENT_ALREADY_EXISTS',
          message: 'Esta fatura já tem uma fatura complementar.',
        },
        409,
      );
    const complement = await tx.invoice.create({
      data: {
        companyId: original.companyId,
        debtorId: original.debtorId,
        originalAmount: new Prisma.Decimal(amountCents).div(100),
        dueDate: due,
        billingType: original.billingType,
        lateFineBasisPoints: original.lateFineBasisPoints,
        lateInterestMonthlyBasisPoints: original.lateInterestMonthlyBasisPoints,
        paymentDaysAfterDue: original.paymentDaysAfterDue,
        studentName: original.studentName,
        studentEnrollment: original.studentEnrollment,
        studentGroup: original.studentGroup,
        complementsInvoiceId: original.id,
      },
    });
    return complement.id;
  }

  private totals(entries: Array<{ kind: string; amountCents: number }>) {
    const sum = (kind: string) =>
      entries
        .filter((entry) => entry.kind === kind)
        .reduce((total, entry) => total + entry.amountCents, 0);
    const payment = sum('PAYMENT');
    const efiFee = -sum('EFI_FEE');
    const platformFee = -sum('PLATFORM_FEE');
    const refunded = -sum('REFUND');
    const reversal = sum('PLATFORM_FEE_REVERSAL');
    return {
      paymentCents: payment,
      efiFeeCents: efiFee,
      platformFeeCents: platformFee,
      refundedCents: refunded,
      platformFeeReversalCents: reversal,
      duplicatePaymentsCents: sum('DUPLICATE_PAYMENT'),
      // What stayed with the customer for this charge (duplicates aside).
      customerNetCents: payment - efiFee - platformFee - refunded + reversal,
    };
  }

  private evidenceView(
    evidence: {
      id: string;
      scope: string;
      reference: string;
      receivedAmountCents: number;
      expectedAmountCents: number;
      matched: boolean;
      createdAt: Date;
    },
    settlementIds: string[],
  ) {
    return {
      id: evidence.id,
      scope: evidence.scope,
      reference: evidence.reference,
      receivedAmountCents: evidence.receivedAmountCents,
      expectedAmountCents: evidence.expectedAmountCents,
      matched: evidence.matched,
      createdAt: evidence.createdAt,
      settlementIds,
    };
  }

  private missing(message: string): never {
    throw new HttpException({ code: 'DECISION_INCOMPLETE', message }, 400);
  }
}
