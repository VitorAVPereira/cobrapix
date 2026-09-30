import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { EfiService, ReconcileChargeResult } from './efi.service';

// A reservation or submission older than this without a confirmed result is
// shown for reconciliation; it is never resubmitted automatically.
const STALE_ISSUANCE_MS = 10 * 60_000;
// Diagnosed refusals stay visible for this long; open issuances never expire.
const RECENT_REJECTIONS_MS = 30 * 86_400_000;

type AttentionClassification =
  | 'REJECTED'
  | 'CONFIRMATION_PENDING'
  | 'MISSING_REFERENCE'
  | 'MODE_MISMATCH'
  | 'ISSUED';

const ATTENTION_SELECT = {
  id: true,
  invoiceId: true,
  billingMethod: true,
  status: true,
  gatewayStatusRaw: true,
  grossAmountCents: true,
  createdAt: true,
  updatedAt: true,
  efiTxid: true,
  efiChargeId: true,
  statusHistory: {
    orderBy: { occurredAt: 'desc' },
    take: 20,
    select: { occurredAt: true, sanitizedDetails: true },
  },
} satisfies Prisma.PaymentChargeSelect;

type AttentionRow = Prisma.PaymentChargeGetPayload<{
  select: typeof ATTENTION_SELECT;
}>;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

@Controller('admin/payment-charges')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PaymentAdminController {
  constructor(
    private readonly efi: EfiService,
    private readonly prisma: PrismaService,
  ) {}

  // Charges of one company whose issuance needs an administrative look:
  // uncertain or stuck submissions, provider mode mismatches and recently
  // diagnosed refusals. Payout (split) reconciliation is elsewhere.
  @Get(':companyId/attention')
  async attention(@Param('companyId', ParseUUIDPipe) companyId: string) {
    const [open, rejected] = await Promise.all([
      this.prisma.paymentCharge.findMany({
        where: {
          companyId,
          OR: [
            {
              status: { in: ['DRAFT', 'PENDING'] },
              updatedAt: { lte: new Date(Date.now() - STALE_ISSUANCE_MS) },
            },
            { gatewayStatusRaw: 'EFI_BILLING_MODE_MISMATCH' },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: ATTENTION_SELECT,
      }),
      this.prisma.paymentCharge.findMany({
        where: {
          companyId,
          status: 'FAILED',
          updatedAt: { gte: new Date(Date.now() - RECENT_REJECTIONS_MS) },
          statusHistory: {
            some: {
              status: 'FAILED',
              OR: [
                {
                  sanitizedDetails: {
                    path: ['event'],
                    equals: 'ISSUANCE_FAILURE',
                  },
                },
                {
                  sanitizedDetails: {
                    path: ['event'],
                    equals: 'RECONCILIATION',
                  },
                },
              ],
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: ATTENTION_SELECT,
      }),
    ]);
    const listed = new Set(open.map((row) => row.id));
    return [...open, ...rejected.filter((row) => !listed.has(row.id))].map(
      (row) => this.describe(row),
    );
  }

  @Post(':companyId/:chargeId/reconcile')
  reconcile(
    @GetUser() user: AuthenticatedUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
  ): Promise<ReconcileChargeResult> {
    return this.efi.reconcileCharge(companyId, chargeId, user.userId);
  }

  // Only codes and local messages already sanitized when recorded.
  private describe(row: AttentionRow) {
    const events = row.statusHistory.map((entry) => ({
      at: entry.occurredAt,
      details:
        entry.sanitizedDetails &&
        typeof entry.sanitizedDetails === 'object' &&
        !Array.isArray(entry.sanitizedDetails)
          ? (entry.sanitizedDetails as Record<string, unknown>)
          : {},
    }));
    const failure = events.find(
      (entry) => entry.details.event === 'ISSUANCE_FAILURE',
    );
    const reconciliation = events.find(
      (entry) => entry.details.event === 'RECONCILIATION',
    );
    const hasProviderReference = Boolean(row.efiTxid || row.efiChargeId);
    const classification: AttentionClassification =
      row.gatewayStatusRaw === 'EFI_BILLING_MODE_MISMATCH'
        ? 'MODE_MISMATCH'
        : row.status === 'FAILED'
          ? 'REJECTED'
          : row.status === 'ACTIVE'
            ? 'ISSUED'
            : hasProviderReference
              ? 'CONFIRMATION_PENDING'
              : 'MISSING_REFERENCE';
    return {
      id: row.id,
      invoiceId: row.invoiceId,
      billingMethod: row.billingMethod,
      status: row.status,
      gatewayStatusRaw: row.gatewayStatusRaw,
      grossAmountCents: row.grossAmountCents,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      classification,
      hasProviderReference,
      diagnosis: failure
        ? {
            at: failure.at,
            kind: text(failure.details.kind),
            code: text(failure.details.code),
            stage: text(failure.details.stage),
            field: text(failure.details.field),
            message: text(failure.details.message),
          }
        : null,
      lastReconciliation: reconciliation
        ? {
            at: reconciliation.at,
            reasonCode: text(reconciliation.details.reasonCode),
          }
        : null,
      // A refused issuance is issued again from the invoice, never from here.
      actions: classification === 'REJECTED' ? [] : ['RECONCILE'],
    };
  }
}
