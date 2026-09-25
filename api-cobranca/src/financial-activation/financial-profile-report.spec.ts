import { buildFinancialProfileReport } from './financial-profile-report';

describe('buildFinancialProfileReport', () => {
  function prismaMock() {
    return {
      company: {
        count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
        findMany: jest.fn().mockResolvedValue([{ id: 'company-b' }]),
      },
      gatewayAccount: { count: jest.fn().mockResolvedValue(2) },
      paymentCharge: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'ACTIVE', _count: { _all: 4 } },
          { status: 'PAID', _count: { _all: 7 } },
        ]),
      },
    };
  }

  it('summarizes companies, gateway accounts and charges without context', async () => {
    const prisma = prismaMock();

    await expect(buildFinancialProfileReport(prisma as never)).resolves.toEqual(
      {
        companies: {
          total: 3,
          withActiveProfile: 1,
          openingActiveWithoutProfile: ['company-b'],
        },
        gatewayAccountsWithoutIdentity: 2,
        chargesWithoutContext: { ACTIVE: 4, PAID: 7 },
      },
    );
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          activeFinancialProfileId: null,
          efiOnboarding: { is: { status: 'ACTIVE' } },
        },
      }),
    );
    expect(prisma.paymentCharge.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { financialProfileId: null } }),
    );
  });
});
