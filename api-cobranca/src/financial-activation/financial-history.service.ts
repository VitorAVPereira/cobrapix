import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mask } from './financial-activation.service';

// Audit entities that make up the financial history of a company.
const FINANCIAL_ENTITIES = [
  'FinancialProfileVersion',
  'EfiCredentialVersion',
  'FinancialValidationAttempt',
  'EfiOnboarding',
  'PlatformFeeEvidence',
  'SettlementDivergence',
];
const COMPANY_ACTIONS = ['SETTLEMENT_OPTIONS_UPDATED'];

// Only these change keys are shown; anything else (personal data, secrets,
// raw provider payloads) is dropped rather than masked.
const SAFE_KEYS = new Set([
  'accountMode',
  'payoutMode',
  'environment',
  'enabledMethods',
  'version',
  'credentialVersion',
  'efiAccountNumber',
  'reason',
  'retentionDays',
  'unverifiedStepsAcknowledged',
  'decision',
  'code',
  'reference',
  'matched',
  'outcome',
  'status',
  'refundPlatformFeeOnRefund',
  'from',
  'to',
]);

type Safe = string | number | boolean | null | Safe[] | { [key: string]: Safe };

export function redactChanges(value: unknown, depth = 0): Safe | undefined {
  if (value === null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 200);
  if (depth > 2) return undefined;
  if (Array.isArray(value))
    return value
      .slice(0, 20)
      .map((item) => redactChanges(item, depth + 1))
      .filter((item): item is Safe => item !== undefined);
  if (typeof value === 'object') {
    const result: Record<string, Safe> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (!SAFE_KEYS.has(key)) continue;
      const safe = redactChanges(item, depth + 1);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  }
  return undefined;
}

export interface FinancialHistory {
  versions: Array<{
    id: string;
    version: number;
    status: string;
    origin: string;
    accountMode: string;
    payoutMode: string;
    environment: string;
    enabledMethods: string[];
    issuerAccount: string | null;
    credentialVersion: number | null;
    certificateExpiresAt: Date | null;
    authorizationKind: string | null;
    authorizationReference: string | null;
    activatedAt: Date | null;
    activatedBy: string | null;
    supersededAt: Date | null;
    canceledAt: Date | null;
    cancelReason: string | null;
    createdAt: Date;
  }>;
  events: Array<{
    id: string;
    action: string;
    entityType: string;
    actor: string | null;
    createdAt: Date;
    details: Safe | undefined;
  }>;
}

@Injectable()
export class FinancialHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  // Versions and audit trail of one company only.
  async get(companyId: string): Promise<FinancialHistory> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company)
      throw new HttpException(
        { code: 'COMPANY_NOT_FOUND', message: 'Empresa não encontrada.' },
        404,
      );
    const [versions, events] = await Promise.all([
      this.prisma.financialProfileVersion.findMany({
        where: { companyId },
        orderBy: { version: 'desc' },
        include: {
          issuerIdentity: { select: { efiAccountNumber: true } },
          issuerCredentialVersion: {
            select: { version: true, certificateExpiresAt: true },
          },
          activatedByUser: { select: { name: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          companyId,
          OR: [
            { entityType: { in: FINANCIAL_ENTITIES } },
            { entityType: 'Company', action: { in: COMPANY_ACTIONS } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { user: { select: { name: true } } },
      }),
    ]);
    return {
      versions: versions.map((row) => ({
        id: row.id,
        version: row.version,
        status: row.status,
        origin: row.origin,
        accountMode: row.accountMode,
        payoutMode: row.payoutMode,
        environment: row.environment,
        enabledMethods: row.enabledMethods,
        issuerAccount: row.issuerIdentity
          ? mask(row.issuerIdentity.efiAccountNumber)
          : null,
        credentialVersion: row.issuerCredentialVersion?.version ?? null,
        certificateExpiresAt:
          row.issuerCredentialVersion?.certificateExpiresAt ?? null,
        authorizationKind: row.authorizationKind,
        authorizationReference: row.authorizationReference,
        activatedAt: row.activatedAt,
        activatedBy: row.activatedByUser?.name ?? null,
        supersededAt: row.supersededAt,
        canceledAt: row.canceledAt,
        cancelReason: row.cancelReason,
        createdAt: row.createdAt,
      })),
      events: events.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        actor: row.user?.name ?? null,
        createdAt: row.createdAt,
        details: redactChanges(row.changes),
      })),
    };
  }
}
