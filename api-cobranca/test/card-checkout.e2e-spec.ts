import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { CardPaymentService } from '../src/payment/card-payment.service';
import { PublicPaymentLinkService } from '../src/payment/payment-link.service';
import { PaymentFeeService } from '../src/payment-fees/payment-fee.service';
import { PaymentChargeService } from '../src/payment/payment-charge.service';
import { FinancialEligibilityService } from '../src/financial-activation/financial-eligibility.service';
import { CardPayDto } from '../src/payment/dto/card-payment.dto';
import { InvoicesService } from '../src/invoices/invoices.service';
import { PaymentService } from '../src/payment/payment.service';

if (
  !process.env.CIFRAMAIS_DISPOSABLE_E2E ||
  !/^postgresql:\/\/postgres:[a-f0-9]+@127\.0\.0\.1:\d+\/ciframais_e2e$/.test(
    process.env.DATABASE_URL ?? '',
  )
)
  throw new Error('Use node test/e2e-disposable.cjs card-checkout.e2e-spec.ts');
jest.setTimeout(120000);

describe('Card checkout (disposable PostgreSQL, simulated Efí)', () => {
  const config = new ConfigService({
    ...process.env,
    PAYMENT_SECRET_KEY: 'card-e2e-secret-abcdefghijklmnopqrstuvwxyz',
    FRONTEND_URL: 'https://front.example.test',
  });
  const prisma = new PrismaService(config);
  const links = new PublicPaymentLinkService(config, prisma);
  const fees = new PaymentFeeService(prisma);
  const charges = new PaymentChargeService(prisma, fees);
  const eligibility = new FinancialEligibilityService(prisma);
  const client = {
    account: jest.fn(),
    quote: jest.fn(),
    submit: jest.fn(),
    platformPayee: jest.fn().mockReturnValue('platform'),
    notificationUrl: jest
      .fn()
      .mockReturnValue('https://api.example.test/webhooks/efi/cobrancas'),
    cancel: jest.fn(),
    detail: jest.fn(),
    findAttempt: jest.fn(),
  };
  const notifications = {
    notifyPaidInvoice: jest.fn().mockResolvedValue(undefined),
  };
  const cards = new CardPaymentService(
    prisma,
    links,
    client as never,
    eligibility,
    charges,
    notifications as never,
  );
  const payments = new PaymentService(
    {} as never,
    prisma,
    charges,
    eligibility,
    cards,
  );
  const invoices = new InvoicesService(
    prisma,
    {} as never,
    payments,
    fees,
    links,
  );
  let companyId: string,
    debtorId: string,
    identityId: string,
    actorId: string,
    sequence = 70000;
  beforeAll(async () => {
    await prisma.onModuleInit();
    const company = await prisma.company.create({
      data: {
        corporateName: 'Card tenant LTDA',
        document: '11222333000181',
        email: `${randomUUID()}@example.test`,
        phoneNumber: '5511999990000',
        autoDiscountEnabled: true,
        autoDiscountPercentage: 10,
        autoDiscountDaysAfterDue: 30,
        enabledBillingMethods: ['PIX', 'BOLIX'],
      },
    });
    companyId = company.id;
    actorId = (
      await prisma.user.create({
        data: {
          companyId,
          name: 'Admin',
          email: `${randomUUID()}@example.test`,
          password: 'x',
        },
      })
    ).id;
    debtorId = (
      await prisma.debtor.create({
        data: {
          companyId,
          name: 'Maria',
          document: '52998224725',
          phoneNumber: '+5511987654321',
          useGlobalBillingSettings: true,
        },
      })
    ).id;
    const identity = await prisma.efiAccountIdentity.create({
      data: {
        companyId,
        ownership: 'COMPANY',
        environment: 'HOMOLOGATION',
        holderDocument: company.document,
        efiAccountNumber: '7001',
        payeeCode: 'issuer',
        pixKey: 'fake',
        healthStatus: 'HEALTHY',
      },
    });
    identityId = identity.id;
    const credential = await prisma.efiCredentialVersion.create({
      data: {
        identityId,
        version: 1,
        status: 'ACTIVE',
        encryptedClientId: 'fake',
        encryptedClientSecret: 'fake',
        encryptedCertificate: 'fake',
        credentialKeyVersion: 'v1',
        certificateFingerprint: Array.from({ length: 32 }, () => 'AB').join(
          ':',
        ),
        certificateExpiresAt: new Date(Date.now() + 86400000),
      },
    });
    await prisma.$transaction(async (tx) => {
      const profile = await tx.financialProfileVersion.create({
        data: {
          companyId,
          version: 1,
          status: 'ACTIVE',
          origin: 'MANUAL_ADMIN',
          accountMode: 'CUSTOMER_ACCOUNT',
          payoutMode: 'DIRECT_TO_CUSTOMER',
          environment: 'HOMOLOGATION',
          enabledMethods: ['PIX', 'BOLIX'],
          issuerIdentityId: identityId,
          issuerCredentialVersionId: credential.id,
          authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION',
          authorizationReference: 'contract',
          ownershipVerifiedAt: new Date(),
          validatedAt: new Date(),
          validationHash: 'fake',
          creationIdempotencyKey: randomUUID(),
          activationIdempotencyKey: randomUUID(),
          activatedAt: new Date(),
        },
      });
      await tx.company.update({
        where: { id: companyId },
        data: { activeFinancialProfileId: profile.id },
      });
    });
    await prisma.platformIntegrationState.upsert({
      where: { integration: 'EFI_PAYMENTS' },
      create: { integration: 'EFI_PAYMENTS', enabled: true },
      update: { enabled: true },
    });
    client.account.mockResolvedValue({ identity });
    await fees.createVersion(companyId, {
      billingMethod: 'PIX',
      efiFee: { kind: 'FIXED', amountCents: 20 },
      platformFee: { kind: 'PERCENTAGE', basisPoints: 300 },
      effectiveFrom: new Date(0),
    });
    await cards.configure(companyId, actorId, {
      issuerIdentityId: identityId,
      enabled: true,
      expectedVersion: 0,
      onTimeBasisPoints: 200,
      overdueBasisPoints: 500,
      processingRates: (['visa', 'mastercard', 'elo', 'amex'] as const).map(
        (brand) => ({
          brand,
          installments: 1,
          basisPoints: 300,
          fixedCents: 0,
        }),
      ),
      validationReference: 'simulated-validation',
    });
  });
  beforeEach(() => {
    client.submit.mockReset();
    client.detail.mockReset();
    client.findAttempt.mockReset();
    client.cancel.mockReset();
    notifications.notifyPaidInvoice.mockClear();
    client.quote.mockImplementation(
      (_identity: string, _company: string, debt: number) =>
        Promise.resolve([
          {
            installments: 1,
            submissionCents: debt + 300,
            totalCents: debt + 300,
            installmentValueCents: debt + 300,
            efiFeeCents: 300,
          },
          {
            installments: 6,
            submissionCents: debt + 300,
            totalCents: Math.ceil((debt + 900) / 6) * 6,
            installmentValueCents: Math.ceil((debt + 900) / 6),
            efiFeeCents: Math.ceil((debt + 900) / 6) * 6 - debt,
          },
        ]),
    );
    client.submit.mockImplementation(
      (_identity: string, _company: string, attempt: { totalCents: number }) =>
        Promise.resolve({
          chargeId: String(++sequence),
          status: 'approved',
          totalCents: attempt.totalCents,
        }),
    );
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  async function checkout(daysLate = 0) {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const dueDate = new Date(`${today}T00:00:00Z`);
    dueDate.setUTCDate(dueDate.getUTCDate() - daysLate);
    const invoice = await prisma.invoice.create({
      data: {
        companyId,
        debtorId,
        originalAmount: 100,
        dueDate,
        billingType: 'CREDIT_CARD',
        lateFineBasisPoints: 200,
        lateInterestMonthlyBasisPoints: 100,
        paymentDaysAfterDue: 90,
      },
    });
    const link = await cards.prepareCharge(companyId, invoice.id);
    const quote = await cards.quote(link.token, 'visa');
    return {
      invoice,
      link,
      quote,
      body: {
        quoteId: quote.quoteId,
        installments: 1,
        paymentToken: 'fake-single-use-token',
        customer: {
          name: 'Maria Silva',
          cpf: '52998224725',
          email: 'maria@example.test',
          phone_number: '11987654321',
          birth: '1990-01-01',
        },
        billingAddress: {
          street: 'Rua A',
          number: '1',
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
          zipcode: '01001000',
        },
      } satisfies CardPayDto,
    };
  }
  it('rejects brand-dependent tariffs without changing active settings', async () => {
    const current = await prisma.cardPaymentSettings.findUniqueOrThrow({
      where: { issuerIdentityId: identityId },
    });
    await expect(
      cards.configure(companyId, actorId, {
        issuerIdentityId: identityId,
        enabled: true,
        expectedVersion: current.version,
        onTimeBasisPoints: 200,
        overdueBasisPoints: 500,
        processingRates: (['visa', 'mastercard', 'elo', 'amex'] as const).map(
          (brand) => ({
            brand,
            installments: 1,
            basisPoints: brand === 'amex' ? 400 : 300,
            fixedCents: 0,
          }),
        ),
        validationReference: 'invalid-contract',
      }),
    ).rejects.toThrow();
    expect(
      await prisma.cardPaymentSettings.findUnique({
        where: { issuerIdentityId: identityId },
      }),
    ).toMatchObject({ version: current.version });
  });
  it('reserves locally, keeps Pix tariffs, and exposes only the card link', async () => {
    const f = await checkout();
    expect(client.submit).not.toHaveBeenCalled();
    expect(await fees.quote(companyId, 'PIX', 10000)).toMatchObject({
      totalFeeCents: 320,
    });
    expect(await links.getPublicPayment(f.link.token)).toMatchObject({
      billingType: 'CREDIT_CARD',
      state: 'PAYABLE',
      canPay: true,
      pixCopyPaste: null,
      boletoLine: null,
    });
    expect(f.quote.amounts).toMatchObject({
      principalCents: 10000,
      discountCents: 1000,
      platformFeeBaseCents: 9000,
    });
  });
  it('concurrent confirmations make one debit and approval does not mark paid', async () => {
    const f = await checkout();
    const outcomes = await Promise.allSettled([
      cards.pay(f.link.token, f.body, randomUUID()),
      cards.pay(f.link.token, f.body, randomUUID()),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(
      await prisma.invoice.findUnique({ where: { id: f.invoice.id } }),
    ).toMatchObject({ status: 'PENDING' });
    expect(await links.getPublicPayment(f.link.token)).toMatchObject({
      state: 'PROCESSING',
      canPay: false,
    });
  });
  it('same confirmation key reuses the result and refuses different content', async () => {
    const f = await checkout(),
      key = randomUUID();
    const first = await cards.pay(f.link.token, f.body, key);
    expect(await cards.pay(f.link.token, f.body, key)).toEqual(first);
    await expect(
      cards.pay(f.link.token, { ...f.body, installments: 6 }, key),
    ).rejects.toThrow();
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(
        await prisma.cardPaymentAttempt.findUniqueOrThrow({
          where: { id: first.attemptId },
        }),
      ),
    ).not.toContain('fake-single-use-token');
  });
  it('timeout blocks retries and recovers by custom_id on the original account', async () => {
    const f = await checkout();
    client.submit.mockRejectedValueOnce(new Error('timeout'));
    const uncertain = await cards.pay(f.link.token, f.body, randomUUID());
    expect(uncertain).toMatchObject({ state: 'UNCERTAIN', canRetry: false });
    await expect(
      cards.pay(f.link.token, f.body, randomUUID()),
    ).rejects.toThrow();
    client.findAttempt.mockResolvedValue({
      data: [{ charge_id: ++sequence, custom_id: uncertain.attemptId }],
    });
    client.detail.mockResolvedValue({
      data: {
        charge_id: sequence,
        custom_id: uncertain.attemptId,
        status: 'paid',
        payment: {
          method: 'credit_card',
          credit_card: {
            installments: 1,
            installment_value: f.quote.options[0].totalCents,
          },
        },
      },
    });
    expect(
      await cards.reconcileAttempt(uncertain.attemptId, companyId),
    ).toMatchObject({ state: 'PAID', reviewRequired: false });
    expect(client.detail).toHaveBeenCalledWith(
      identityId,
      companyId,
      String(sequence),
    );
    expect(
      await prisma.invoice.findUnique({ where: { id: f.invoice.id } }),
    ).toMatchObject({ status: 'PAID' });
    expect(client.submit).toHaveBeenCalledTimes(1);
  });
  it('uses discounted principal for split, excludes lateness and card costs, and settles once', async () => {
    const f = await checkout(15);
    expect(f.quote.amounts).toMatchObject({
      baseDebtCents: 9250,
      lateFineCents: 200,
      lateInterestCents: 50,
      platformFeeBaseCents: 9000,
    });
    const response = await cards.pay(f.link.token, f.body, randomUUID());
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: response.attemptId },
    });
    expect(attempt.platformFeeCents).toBe(450);
    await Promise.all([
      cards.observe(
        attempt.id,
        attempt.efiChargeId!,
        'paid',
        attempt.totalCents,
      ),
      cards.observe(
        attempt.id,
        attempt.efiChargeId!,
        'paid',
        attempt.totalCents,
      ),
    ]);
    const charge = await prisma.paymentCharge.findUniqueOrThrow({
      where: { id: attempt.paymentChargeId },
    });
    expect(charge).toMatchObject({
      status: 'PAID',
      effectivePlatformFeeCents: 450,
      platformFeeBaseCents: 9000,
    });
    expect(notifications.notifyPaidInvoice).toHaveBeenCalledTimes(1);
    await cards.observe(
      attempt.id,
      attempt.efiChargeId!,
      'unpaid',
      attempt.totalCents,
    );
    expect(
      await prisma.paymentCharge.findUnique({
        where: { id: attempt.paymentChargeId },
      }),
    ).toMatchObject({ status: 'PAID', gatewayStatusRaw: 'paid' });
  });
  it('does not release an approved attempt on a stale refusal response', async () => {
    const f = await checkout();
    const outcome = await cards.pay(f.link.token, f.body, randomUUID());
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: outcome.attemptId },
    });
    await cards.observe(
      attempt.id,
      attempt.efiChargeId!,
      'unpaid',
      attempt.totalCents,
    );
    expect(
      await prisma.cardPaymentAttempt.findUnique({ where: { id: attempt.id } }),
    ).toMatchObject({ status: 'APPROVED' });
    await expect(
      cards.pay(f.link.token, f.body, randomUUID()),
    ).rejects.toThrow();
    expect(client.submit).toHaveBeenCalledTimes(1);
  });
  it('flags a post-payment contest without recording an automatic refund or split receipt', async () => {
    const f = await checkout();
    const outcome = await cards.pay(f.link.token, f.body, randomUUID());
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: outcome.attemptId },
    });
    await cards.observe(
      attempt.id,
      attempt.efiChargeId!,
      'paid',
      attempt.totalCents,
    );
    expect(
      await cards.observe(
        attempt.id,
        attempt.efiChargeId!,
        'contested',
        attempt.totalCents,
      ),
    ).toBe(false);
    expect(
      await prisma.paymentSettlement.findUnique({
        where: { paymentChargeId: attempt.paymentChargeId },
      }),
    ).toMatchObject({ evidenceStatus: 'PENDING' });
    expect(
      await prisma.paymentWebhookAnomaly.findFirst({
        where: {
          source: 'CARD',
          externalReference: attempt.id,
          reasonCode: 'CARD_CONTESTED_REVIEW_REQUIRED',
        },
      }),
    ).not.toBeNull();
    expect(
      await prisma.invoice.findUnique({ where: { id: f.invoice.id } }),
    ).toMatchObject({ status: 'PAID' });
  });
  it('invalidates stale quotes when terms or config change before debit', async () => {
    const f = await checkout();
    await prisma.invoice.update({
      where: { id: f.invoice.id },
      data: { originalAmount: 120 },
    });
    await expect(
      cards.pay(f.link.token, f.body, randomUUID()),
    ).rejects.toThrow();
    const other = await checkout();
    await prisma.cardPaymentSettings.update({
      where: { issuerIdentityId: identityId },
      data: { version: { increment: 1 } },
    });
    await expect(
      cards.pay(other.link.token, other.body, randomUUID()),
    ).rejects.toThrow();
    expect(client.submit).not.toHaveBeenCalled();
  });
  it('a token from another company cannot submit a quote or reconcile an attempt', async () => {
    const f = await checkout();
    const foreign = links.createInvoicePaymentPage({
      companyId: randomUUID(),
      invoiceId: f.invoice.id,
    });
    await expect(
      cards.pay(foreign.token, f.body, randomUUID()),
    ).rejects.toThrow();
    const attempt = await cards.pay(f.link.token, f.body, randomUUID());
    await expect(
      cards.reconcileAttempt(attempt.attemptId, randomUUID()),
    ).rejects.toThrow();
    expect(client.detail).not.toHaveBeenCalled();
  });
  it('amount mismatch stays blocked for review and does not settle', async () => {
    const f = await checkout();
    client.submit.mockImplementationOnce(
      (_identity: string, _company: string, attempt: { totalCents: number }) =>
        Promise.resolve({
          chargeId: String(++sequence),
          status: 'paid',
          totalCents: attempt.totalCents + 1,
        }),
    );
    expect(await cards.pay(f.link.token, f.body, randomUUID())).toMatchObject({
      state: 'UNCERTAIN',
      canRetry: false,
    });
    expect(
      await prisma.invoice.findUnique({ where: { id: f.invoice.id } }),
    ).toMatchObject({ status: 'PENDING' });
  });
  it('canceling a local reservation closes its link and cannot race an approved payment', async () => {
    const f = await checkout();
    await invoices.cancelInvoice(companyId, f.invoice.id);
    expect(await links.getPublicPayment(f.link.token)).toMatchObject({
      state: 'CANCELED',
      canPay: false,
    });
    await expect(
      cards.pay(f.link.token, f.body, randomUUID()),
    ).rejects.toThrow();
    const other = await checkout();
    await cards.pay(other.link.token, other.body, randomUUID());
    await expect(
      invoices.cancelInvoice(companyId, other.invoice.id),
    ).rejects.toThrow();
  });
  it('supports up to six installments and refuses seven without a debit', async () => {
    const f = await checkout();
    await expect(
      cards.pay(f.link.token, { ...f.body, installments: 7 }, randomUUID()),
    ).rejects.toThrow();
    expect(client.submit).not.toHaveBeenCalled();
    expect(
      await cards.pay(
        f.link.token,
        { ...f.body, installments: 6 },
        randomUUID(),
      ),
    ).toMatchObject({ state: 'APPROVED' });
  });
});
