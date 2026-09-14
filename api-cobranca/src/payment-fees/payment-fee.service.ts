import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  BillingMethod,
  PaymentFeeKind,
  PaymentFeeVersion,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validatePaymentFeeComponent } from './payment-fee.types';

export type FeeVersionForQuote = Pick<
  PaymentFeeVersion,
  | 'id'
  | 'billingMethod'
  | 'version'
  | 'efiFeeKind'
  | 'efiFeeAmountCents'
  | 'efiFeeBasisPoints'
  | 'platformFeeKind'
  | 'platformFeeAmountCents'
  | 'platformFeeBasisPoints'
>;

export interface PaymentFeeQuote {
  billingMethod: BillingMethod;
  grossAmountCents: number;
  totalFeeCents: number;
  netAmountCents: number;
  feeLabel: string;
  feeVersionId: string;
  feeVersion: number;
  estimatedEfiFeeCents: number;
  estimatedPlatformFeeCents: number;
}

export interface CreateFeeVersionInput {
  billingMethod: BillingMethod;
  efiFee: unknown;
  platformFee: unknown;
  effectiveFrom: Date;
  createdByUserId?: string;
}

@Injectable()
export class PaymentFeeService {
  constructor(private readonly prisma: PrismaService) {}

  async listDivergences(page: number): Promise<unknown> {
    const where = {
      actionType: 'EFI_FEE_DIVERGENCE',
      status: 'REVIEW_REQUIRED',
    };
    const [items, total] = await Promise.all([
      this.prisma.collectionLog.findMany({
        where,
        select: {
          id: true,
          companyId: true,
          invoiceId: true,
          createdAt: true,
          description: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.collectionLog.count({ where }),
    ]);
    return { items, total, page, pageSize: 50 };
  }

  async quote(
    companyId: string,
    billingMethod: BillingMethod,
    amountCents: number,
  ): Promise<PaymentFeeQuote> {
    const feeVersion = await this.resolveActiveVersion(
      companyId,
      billingMethod,
    );
    return this.calculateQuote(amountCents, feeVersion);
  }

  async resolveActiveVersion(
    companyId: string,
    billingMethod: BillingMethod,
    at: Date = new Date(),
  ): Promise<PaymentFeeVersion> {
    const activeWindow = {
      billingMethod,
      effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
    };
    const override = await this.prisma.paymentFeeVersion.findFirst({
      where: { ...activeWindow, companyId },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    if (override) return override;

    const global = await this.prisma.paymentFeeVersion.findFirst({
      where: { ...activeWindow, companyId: null },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    if (global) return global;

    throw new HttpException(
      {
        code: 'FEE_CONFIGURATION_MISSING',
        message: 'Não existe tarifa vigente para este meio de pagamento.',
      },
      HttpStatus.CONFLICT,
    );
  }

  calculateQuote(
    grossAmountCents: number,
    version: FeeVersionForQuote,
  ): PaymentFeeQuote {
    if (
      !Number.isSafeInteger(grossAmountCents) ||
      grossAmountCents <= 0 ||
      grossAmountCents > 2147483647
    ) {
      throw new HttpException('Valor bruto inválido.', HttpStatus.BAD_REQUEST);
    }
    const efiFee = this.componentAmount(
      grossAmountCents,
      version.efiFeeKind,
      version.efiFeeAmountCents,
      version.efiFeeBasisPoints,
    );
    const platformFee = this.componentAmount(
      grossAmountCents,
      version.platformFeeKind,
      version.platformFeeAmountCents,
      version.platformFeeBasisPoints,
    );
    const totalFeeCents = efiFee + platformFee;
    if (grossAmountCents <= totalFeeCents) {
      throw new HttpException(
        {
          code: 'NON_POSITIVE_NET_AMOUNT',
          message: 'O valor bruto deve ser maior que a taxa total.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return {
      billingMethod: version.billingMethod,
      grossAmountCents,
      totalFeeCents,
      netAmountCents: grossAmountCents - totalFeeCents,
      feeLabel: this.formatCombinedLabel(version),
      feeVersionId: version.id,
      feeVersion: version.version,
      estimatedEfiFeeCents: efiFee,
      estimatedPlatformFeeCents: platformFee,
    };
  }

  async createVersion(
    companyId: string | null,
    input: CreateFeeVersionInput,
  ): Promise<PaymentFeeVersion> {
    if (
      !validatePaymentFeeComponent(input.efiFee) ||
      !validatePaymentFeeComponent(input.platformFee)
    ) {
      throw new HttpException(
        'Componentes de tarifa inválidos.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const scopeKey = companyId ?? 'GLOBAL';
    const efiFee = input.efiFee;
    const platformFee = input.platformFee;
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<PaymentFeeVersion> => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey + ':' + input.billingMethod}, 0))::text`,
        );
        const latest = await tx.paymentFeeVersion.findFirst({
          where: { scopeKey, billingMethod: input.billingMethod },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        return tx.paymentFeeVersion.create({
          data: {
            companyId,
            scopeKey,
            billingMethod: input.billingMethod,
            version: (latest?.version ?? 0) + 1,
            efiFeeKind: efiFee.kind,
            efiFeeAmountCents:
              efiFee.kind === 'FIXED' ? efiFee.amountCents : null,
            efiFeeBasisPoints:
              efiFee.kind === 'PERCENTAGE' ? efiFee.basisPoints : null,
            platformFeeKind: platformFee.kind,
            platformFeeAmountCents:
              platformFee.kind === 'FIXED' ? platformFee.amountCents : null,
            platformFeeBasisPoints:
              platformFee.kind === 'PERCENTAGE'
                ? platformFee.basisPoints
                : null,
            effectiveFrom: input.effectiveFrom,
            createdByUserId: input.createdByUserId,
          },
        });
      },
    );
  }

  async listVersions(companyId?: string): Promise<PaymentFeeVersion[]> {
    return this.prisma.paymentFeeVersion.findMany({
      where: companyId
        ? { OR: [{ companyId }, { companyId: null }] }
        : { companyId: null },
      orderBy: [{ billingMethod: 'asc' }, { effectiveFrom: 'desc' }],
      take: 500,
    });
  }

  toSnapshot(version: FeeVersionForQuote): Prisma.InputJsonObject {
    return {
      billingMethod: version.billingMethod,
      version: version.version,
      efiFee: this.componentSnapshot(
        version.efiFeeKind,
        version.efiFeeAmountCents,
        version.efiFeeBasisPoints,
      ),
      platformFee: this.componentSnapshot(
        version.platformFeeKind,
        version.platformFeeAmountCents,
        version.platformFeeBasisPoints,
      ),
    };
  }

  hasEffectiveFeeDivergence(
    estimatedCents: number,
    effectiveCents: number,
  ): boolean {
    return (
      Math.abs(effectiveCents - estimatedCents) * 100 >
      Math.max(1000, estimatedCents * 5)
    );
  }

  private componentAmount(
    gross: number,
    kind: PaymentFeeKind,
    fixed: number | null,
    bps: number | null,
  ): number {
    if (kind === 'FIXED' && fixed !== null) return fixed;
    if (kind === 'PERCENTAGE' && bps !== null)
      return Number((BigInt(gross) * BigInt(bps) + 5000n) / 10000n);
    throw new HttpException(
      {
        code: 'FEE_CONFIGURATION_MISSING',
        message: 'Configuração de tarifa incompleta.',
      },
      HttpStatus.CONFLICT,
    );
  }

  formatCombinedLabel(version: FeeVersionForQuote): string {
    const efiFixed = version.efiFeeKind === 'FIXED';
    const platformFixed = version.platformFeeKind === 'FIXED';
    if (efiFixed && platformFixed)
      return this.money(
        (version.efiFeeAmountCents ?? 0) +
          (version.platformFeeAmountCents ?? 0),
      );
    if (!efiFixed && !platformFixed)
      return this.percent(
        (version.efiFeeBasisPoints ?? 0) +
          (version.platformFeeBasisPoints ?? 0),
      );
    const fixed = efiFixed
      ? (version.efiFeeAmountCents ?? 0)
      : (version.platformFeeAmountCents ?? 0);
    const bps = efiFixed
      ? (version.platformFeeBasisPoints ?? 0)
      : (version.efiFeeBasisPoints ?? 0);
    return `${this.money(fixed)} + ${this.percent(bps)}`;
  }

  private money(cents: number): string {
    return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
  }

  private percent(bps: number): string {
    return `${(bps / 100).toFixed(2).replace('.', ',')}%`;
  }

  private componentSnapshot(
    kind: PaymentFeeKind,
    fixed: number | null,
    bps: number | null,
  ): Prisma.InputJsonObject {
    return kind === 'FIXED'
      ? { kind, amountCents: fixed ?? 0 }
      : { kind, basisPoints: bps ?? 0 };
  }
}
