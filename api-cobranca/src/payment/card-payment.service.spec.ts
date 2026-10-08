import { CardPaymentService } from './card-payment.service';

describe('card checkout boundaries', () => {
  const token = { companyId: 'company', invoiceId: 'invoice' };
  function fixture() {
    const prisma = {
      paymentCharge: { findFirst: jest.fn() },
      cardPaymentSettings: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const links = {
      verifyToken: jest.fn().mockReturnValue(token),
      createInvoicePaymentPage: jest.fn().mockReturnValue({
        token: 'signed',
        url: 'https://front/pagar/signed',
      }),
    };
    const client = { submit: jest.fn(), quote: jest.fn(), account: jest.fn() };
    const eligibility = { resolveIssuance: jest.fn() };
    return {
      prisma,
      links,
      client,
      eligibility,
      service: new CardPaymentService(
        prisma as never,
        links as never,
        client as never,
        eligibility as never,
        {} as never,
        {} as never,
      ),
    };
  }
  it('validates signed scope before looking up any invoice', async () => {
    const f = fixture();
    f.links.verifyToken.mockImplementation(() => {
      throw new Error('invalid');
    });
    await expect(f.service.quote('bad', 'visa')).rejects.toThrow('invalid');
    expect(f.prisma.paymentCharge.findFirst).not.toHaveBeenCalled();
    expect(f.client.quote).not.toHaveBeenCalled();
  });
  it('does not allow paying a Pix or Bolix charge by card', async () => {
    const f = fixture();
    f.prisma.paymentCharge.findFirst.mockResolvedValue({
      billingMethod: 'BOLIX',
      invoice: { status: 'PENDING' },
    });
    await expect(f.service.quote('signed', 'visa')).rejects.toThrow();
    expect(f.client.quote).not.toHaveBeenCalled();
  });
  it('closed invoices cannot request a card quote', async () => {
    const f = fixture();
    f.prisma.paymentCharge.findFirst.mockResolvedValue({
      billingMethod: 'CREDIT_CARD',
      status: 'ACTIVE',
      invoice: { status: 'PAID' },
    });
    await expect(f.service.quote('signed', 'visa')).rejects.toThrow();
    expect(f.client.quote).not.toHaveBeenCalled();
  });
  it('no configured/enabled card account means no provider submission', async () => {
    const f = fixture();
    f.prisma.paymentCharge.findFirst.mockResolvedValue({
      id: 'charge',
      billingMethod: 'CREDIT_CARD',
      status: 'ACTIVE',
      issuerIdentityId: 'issuer',
      invoice: { status: 'PENDING' },
    });
    f.prisma.cardPaymentSettings.findFirst.mockResolvedValue(null);
    await expect(f.service.quote('signed', 'visa')).rejects.toThrow();
    expect(f.client.quote).not.toHaveBeenCalled();
  });
  it('reuses a local reservation without calling provider', async () => {
    const f = fixture();
    f.prisma.paymentCharge.findFirst.mockResolvedValue({
      id: 'charge',
      billingMethod: 'CREDIT_CARD',
      status: 'ACTIVE',
      invoice: { status: 'PENDING' },
    });
    await expect(
      f.service.prepareCharge('company', 'invoice'),
    ).resolves.toMatchObject({ url: 'https://front/pagar/signed' });
    expect(f.client.submit).not.toHaveBeenCalled();
    expect(f.links.createInvoicePaymentPage).toHaveBeenCalledWith(token);
  });
  it('never replaces an existing open charge with another method', async () => {
    const f = fixture();
    f.prisma.paymentCharge.findFirst.mockResolvedValue({
      billingMethod: 'PIX',
      status: 'ACTIVE',
      invoice: { status: 'PENDING' },
    });
    await expect(
      f.service.prepareCharge('company', 'invoice'),
    ).rejects.toThrow();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('card quote civil day', () => {
  it('rejects a quote when provider latency crosses midnight in Brasilia', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-07T02:59:59Z'));
    const create = jest.fn();
    const prisma = {
      paymentCharge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'charge',
          companyId: 'company',
          invoiceId: 'invoice',
          issuerIdentityId: 'issuer',
          billingMethod: 'CREDIT_CARD',
          status: 'ACTIVE',
          paymentDaysAfterDue: 30,
          lateFineBasisPoints: 0,
          lateInterestMonthlyBasisPoints: 0,
          invoice: {
            status: 'PENDING',
            dueDate: new Date('2026-10-06T00:00:00Z'),
            updatedAt: new Date('2026-10-06T10:00:00Z'),
            originalAmount: 100,
            debtor: { useGlobalBillingSettings: true },
            company: { autoDiscountEnabled: false },
          },
        }),
      },
      cardPaymentSettings: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'settings',
          enabled: true,
          version: 1,
          processingRates: [],
        }),
      },
      cardPaymentAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
      company: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      platformIntegrationState: {
        findUnique: jest.fn().mockResolvedValue({ enabled: true }),
      },
      cardPaymentQuote: { create },
    };
    const links = {
      verifyToken: () => ({ companyId: 'company', invoiceId: 'invoice' }),
    };
    const client = {
      quote: () => {
        jest.setSystemTime(new Date('2026-10-07T03:00:00Z'));
        return Promise.resolve([]);
      },
    };
    const service = new CardPaymentService(
      prisma as never,
      links as never,
      client as never,
      {} as never,
      {} as never,
      {} as never,
    );
    try {
      await expect(service.quote('signed', 'visa')).rejects.toThrow(
        'O dia mudou',
      );
      expect(create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
