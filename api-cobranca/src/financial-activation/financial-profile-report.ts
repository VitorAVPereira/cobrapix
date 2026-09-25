import type { PrismaClient } from '@prisma/client';

type ReportClient = Pick<
  PrismaClient,
  'company' | 'gatewayAccount' | 'paymentCharge'
>;

export interface FinancialProfileReport {
  companies: {
    total: number;
    withActiveProfile: number;
    // Automatic opening finished but no profile was published: needs review,
    // never an automatic conversion.
    openingActiveWithoutProfile: string[];
  };
  gatewayAccountsWithoutIdentity: number;
  // Charges issued before financial profiles existed, by status. They keep
  // the legacy path and must never receive a context by assumption.
  chargesWithoutContext: Record<string, number>;
}

// Read-only diagnosis of the migration to financial profiles. Production holds
// test data only (plan section 8.1), so there is no apply mode.
export async function buildFinancialProfileReport(
  prisma: ReportClient,
): Promise<FinancialProfileReport> {
  const [total, withActiveProfile, openingActive, gatewayAccounts, charges] =
    await Promise.all([
      prisma.company.count(),
      prisma.company.count({
        where: { activeFinancialProfileId: { not: null } },
      }),
      prisma.company.findMany({
        where: {
          activeFinancialProfileId: null,
          efiOnboarding: { is: { status: 'ACTIVE' } },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      prisma.gatewayAccount.count({ where: { efiAccountIdentityId: null } }),
      prisma.paymentCharge.groupBy({
        by: ['status'],
        where: { financialProfileId: null },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);

  return {
    companies: {
      total,
      withActiveProfile,
      openingActiveWithoutProfile: openingActive.map(({ id }) => id),
    },
    gatewayAccountsWithoutIdentity: gatewayAccounts,
    chargesWithoutContext: Object.fromEntries(
      charges.map((row) => [row.status, row._count._all]),
    ),
  };
}
