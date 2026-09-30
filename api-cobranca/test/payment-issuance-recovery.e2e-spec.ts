/**
 * Bolix issuance recovery on a disposable PostgreSQL (node test/e2e-disposable.cjs
 * payment-issuance-recovery.e2e-spec.ts). The Efí SDK is simulated; no credentials.
 * Covers: one reservation and one provider call under concurrent issuance, a proven
 * refusal released with its diagnosis, rollback of a failed confirmation keeping the
 * provider reference, recovery on the original account, reconciliation racing a
 * payment webhook, concurrent reference association and proof of absence.
 */
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentFeeService } from '../src/payment-fees/payment-fee.service';
import { PaymentChargeService } from '../src/payment/payment-charge.service';
import { FinancialEligibilityService } from '../src/financial-activation/financial-eligibility.service';
import { EfiService } from '../src/payment/efi.service';
import { PaymentService } from '../src/payment/payment.service';
import { PaymentAdminController } from '../src/payment/payment-admin.controller';
import type { GatewayHealthService } from '../src/payment/gateway-health.service';
import type { PaymentCryptoService } from '../src/payment/payment-crypto.service';
import type { PaymentNotificationsService } from '../src/payment/payment-notifications.service';
jest.setTimeout(120_000);
// Same guard as the other disposable specs: never a shared or remote database.
if (
  !process.env.CIFRAMAIS_DISPOSABLE_E2E ||
  !/^postgresql:\/\/postgres:[a-f0-9]+@127\.0\.0\.1:\d+\/ciframais_e2e$/.test(
    process.env.DATABASE_URL ?? '',
  )
)
  throw new Error(
    'Execute com: node test/e2e-disposable.cjs payment-issuance-recovery.e2e-spec.ts',
  );

const HOUR = 3_600_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Body = {
  payment: { banking_billet: { customer: Record<string, unknown> } };
  metadata: { custom_id: string };
};
type Sdk = {
  createOneStepCharge: jest.Mock<Promise<unknown>, [unknown, Body]>;
  detailCharge: jest.Mock<Promise<unknown>, [{ id: string }]>;
  listCharges: jest.Mock<Promise<unknown>, [{ custom_id: string }]>;
  getNotification: jest.Mock<Promise<unknown>, [{ token: string }]>;
};

describe('Bolix issuance recovery (PostgreSQL)', () => {
  const prisma = new PrismaService({
    get: (key: string) => process.env[key],
  } as unknown as ConfigService);
  const fees = new PaymentFeeService(prisma);
  const charges = new PaymentChargeService(prisma, fees);
  const eligibility = new FinancialEligibilityService(prisma);
  const settings: Record<string, string> = {
    EFI_PLATFORM_PAYEE_CODE: 'platformpayee',
    EFI_PLATFORM_ACCOUNT_NUMBER: '9999',
    EFI_PLATFORM_CNPJ: '11222333000181',
    EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.test',
    EFI_WEBHOOK_SECRET: 'hook-secret',
  };
  const efi = new EfiService(
    {
      get: (key: string) => settings[key],
      getOrThrow: (key: string) => settings[key],
    } as unknown as ConfigService,
    prisma,
    { decrypt: (value: string) => value } as unknown as PaymentCryptoService,
    {
      notifyPaidInvoice: () => Promise.resolve(),
    } as unknown as PaymentNotificationsService,
    {
      assertIssuable: (companyId: string, method?: 'PIX' | 'BOLIX') =>
        eligibility.resolveIssuance(companyId, method),
    } as unknown as GatewayHealthService,
    charges,
  );
  const payments = new PaymentService(efi, prisma, charges, eligibility);
  const admin = new PaymentAdminController(efi, prisma);
  const accounts: string[] = [];
  const sdk: Sdk = {
    createOneStepCharge: jest.fn<Promise<unknown>, [unknown, Body]>(),
    detailCharge: jest.fn<Promise<unknown>, [{ id: string }]>(),
    listCharges: jest.fn<Promise<unknown>, [{ custom_id: string }]>(),
    getNotification: jest.fn<Promise<unknown>, [{ token: string }]>(),
  };
  jest
    .spyOn(
      efi as unknown as {
        createSdkClient(account: { efiAccountNumber: string }): Sdk;
      },
      'createSdkClient',
    )
    .mockImplementation((account) => {
      accounts.push(account.efiAccountNumber);
      return sdk;
    });

  let companyId = '';
  let debtorId = '';
  let identityId = '';
  let actorId = '';
  let seq = 0;

  const bolixResponse = (chargeId: number) => ({
    code: 200,
    data: {
      charge_id: chargeId,
      status: 'waiting',
      barcode: `0019-${chargeId}`,
      billet_link: `https://boleto.example.test/${chargeId}`,
      pdf: { charge: `https://boleto.example.test/${chargeId}.pdf` },
      pix: { qrcode: `000201bolix${chargeId}` },
    },
  });
  const bolixDetail = (chargeId: number, customId: string, total: number) => ({
    code: 200,
    data: {
      charge_id: chargeId,
      custom_id: customId,
      total,
      status: 'waiting',
      payment: {
        method: 'banking_billet',
        banking_billet: {
          barcode: `0019-${chargeId}`,
          link: `https://boleto.example.test/${chargeId}`,
          pdf: { charge: `https://boleto.example.test/${chargeId}.pdf` },
          pix: { qrcode: `000201bolix${chargeId}` },
        },
      },
    },
  });

  async function activate(account: string): Promise<string> {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    const identity = await prisma.efiAccountIdentity.create({
      data: {
        ownership: 'COMPANY',
        companyId,
        environment: 'HOMOLOGATION',
        holderDocument: company.document,
        efiAccountNumber: account,
        payeeCode: `payee${account}`,
        pixKey: `chave-${account}`,
        healthStatus: 'HEALTHY',
      },
    });
    const credential = await prisma.efiCredentialVersion.create({
      data: {
        identityId: identity.id,
        version: 1,
        status: 'ACTIVE',
        encryptedClientId: 'c',
        encryptedClientSecret: 's',
        encryptedCertificate: 'p12',
        credentialKeyVersion: 'v1',
        certificateFingerprint: Array.from(randomBytes(32), (byte) =>
          byte.toString(16).padStart(2, '0').toUpperCase(),
        ).join(':'),
        certificateExpiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.financialProfileVersion.updateMany({
        where: { companyId, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      const profile = await tx.financialProfileVersion.create({
        data: {
          companyId,
          version: ++seq,
          status: 'ACTIVE',
          origin: 'MANUAL_ADMIN',
          accountMode: 'CUSTOMER_ACCOUNT',
          payoutMode: 'DIRECT_TO_CUSTOMER',
          environment: 'HOMOLOGATION',
          enabledMethods: ['PIX', 'BOLIX'],
          issuerIdentityId: identity.id,
          issuerCredentialVersionId: credential.id,
          authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION',
          authorizationReference: 'contrato',
          ownershipVerifiedAt: new Date(),
          validatedAt: new Date(),
          validationHash: 'h',
          creationIdempotencyKey: randomBytes(8).toString('hex'),
          activationIdempotencyKey: randomBytes(8).toString('hex'),
          activatedAt: new Date(),
        },
      });
      await tx.company.update({
        where: { id: companyId },
        data: { activeFinancialProfileId: profile.id },
      });
    });
    return identity.id;
  }

  const newInvoice = (amount: number) =>
    prisma.invoice.create({
      data: {
        companyId,
        debtorId,
        originalAmount: amount,
        dueDate: new Date(Date.now() + 10 * 86_400_000),
      },
    });

  // A reservation left open by an issuance whose outcome was lost.
  async function openReservation(amount: number, ageMs = 2 * HOUR) {
    const invoice = await newInvoice(amount);
    const charge = await charges.createDraft(
      companyId,
      invoice.id,
      'BOLIX',
      amount * 100,
      await eligibility.resolveIssuance(companyId, 'BOLIX'),
    );
    await prisma.$executeRaw`UPDATE "PaymentCharge" SET "createdAt" = now() - make_interval(secs => ${ageMs / 1000}) WHERE id = ${charge.id}`;
    return { invoice, charge };
  }

  beforeAll(async () => {
    await prisma.$connect();
    const company = await prisma.company.create({
      data: {
        corporateName: 'Bolix fixture',
        email: 'bolix@example.test',
        phoneNumber: '5511999990000',
        document: '12345678000195',
        addressStreet: 'Rua A',
        addressNumber: '1',
        addressDistrict: 'Centro',
        addressPostalCode: '01001000',
        addressCity: 'São Paulo',
        addressState: 'SP',
      },
    });
    companyId = company.id;
    actorId = (
      await prisma.user.create({
        data: {
          companyId,
          name: 'Admin',
          email: `admin-${randomBytes(4).toString('hex')}@example.test`,
          password: 'x',
        },
      })
    ).id;
    debtorId = (
      await prisma.debtor.create({
        data: {
          companyId,
          name: 'Maria Silva',
          document: '52998224725',
          phoneNumber: '+5511987654321',
        },
      })
    ).id;
    await fees.createVersion(null, {
      billingMethod: 'BOLIX',
      efiFee: { kind: 'FIXED', amountCents: 100 },
      platformFee: { kind: 'PERCENTAGE', basisPoints: 250 },
      effectiveFrom: new Date(0),
    });
    await prisma.platformIntegrationState.upsert({
      where: { integration: 'EFI_PAYMENTS' },
      create: { integration: 'EFI_PAYMENTS', enabled: true },
      update: { enabled: true },
    });
    identityId = await activate('1001');
  });

  beforeEach(() => {
    accounts.length = 0;
    for (const mock of Object.values(sdk)) mock.mockReset();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('makes one reservation and one provider call for concurrent issuances', async () => {
    const invoice = await newInvoice(5);
    sdk.createOneStepCharge.mockImplementation(async () => {
      await sleep(300);
      return bolixResponse(101);
    });
    const outcomes = await Promise.allSettled([
      payments.createPayment(invoice.id, companyId, 'BOLIX'),
      payments.createPayment(invoice.id, companyId, 'BOLIX'),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(sdk.createOneStepCharge).toHaveBeenCalledTimes(1);
    const body = sdk.createOneStepCharge.mock.calls[0]![1];
    expect(body.payment.banking_billet.customer.phone_number).toBe(
      '11987654321',
    );
    const rows = await prisma.paymentCharge.findMany({
      where: { invoiceId: invoice.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', efiChargeId: '101' });
    expect(body.metadata.custom_id).toBe(rows[0]!.id);
    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(stored).toMatchObject({
      status: 'PENDING',
      billingType: 'BOLIX',
      efiChargeId: '101',
      boletoLinhaDigitavel: '0019-101',
      efiPixCopiaECola: '000201bolix101',
    });
  });

  it('releases a refused issuance with its diagnosis and lets it be issued again', async () => {
    const invoice = await newInvoice(3);
    sdk.createOneStepCharge.mockRejectedValueOnce({
      code: 3500034,
      error: 'validation_error',
      error_description: {
        property: '/payment/banking_billet/customer/phone_number',
        message: 'Propriedade com formato inválido',
      },
    });
    await expect(
      payments.createPayment(invoice.id, companyId, 'BOLIX'),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'EFI_ISSUANCE_REJECTED' },
    });
    const refused = await prisma.paymentCharge.findFirstOrThrow({
      where: { invoiceId: invoice.id },
      include: { statusHistory: true },
    });
    expect(refused.status).toBe('FAILED');
    const details = refused.statusHistory.map((h) => h.sanitizedDetails);
    expect(details).toContainEqual(
      expect.objectContaining({
        event: 'ISSUANCE_FAILURE',
        code: 'EFI_VALIDATION_REJECTED',
        field: '/payment/banking_billet/customer/phone_number',
      }),
    );
    expect(JSON.stringify(details)).not.toContain('Propriedade');
    const listed = await admin.attention(companyId);
    expect(listed.find((row) => row.id === refused.id)).toMatchObject({
      classification: 'REJECTED',
      actions: [],
      diagnosis: expect.objectContaining({
        code: 'EFI_VALIDATION_REJECTED',
      }) as unknown,
    });
    sdk.createOneStepCharge.mockResolvedValueOnce(bolixResponse(102));
    await expect(
      payments.createPayment(invoice.id, companyId, 'BOLIX'),
    ).resolves.toMatchObject({ chargeId: '102' });
  });

  it('rolls a failed confirmation back, keeps the reference and recovers it on the original account', async () => {
    const invoice = await newInvoice(7);
    sdk.createOneStepCharge.mockResolvedValueOnce(bolixResponse(103));
    // Fails inside the confirmation transaction, after charge and invoice writes.
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION e2e_fail_issuance_log() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER e2e_fail_issuance_log BEFORE INSERT ON "CollectionLog" FOR EACH ROW WHEN (NEW."actionType" = 'EFI_BOLIX_CREATED') EXECUTE FUNCTION e2e_fail_issuance_log()`,
    );
    try {
      await expect(
        payments.createPayment(invoice.id, companyId, 'BOLIX'),
      ).rejects.toMatchObject({
        response: {
          code: 'EFI_SUBMISSION_UNCERTAIN',
          reasonCode: 'LOCAL_PERSISTENCE_FAILED',
        },
      });
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER e2e_fail_issuance_log ON "CollectionLog"`,
      );
    }
    const pending = await prisma.paymentCharge.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(pending).toMatchObject({ status: 'PENDING', efiChargeId: '103' });
    expect(
      await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).toMatchObject({ efiChargeId: null, boletoLinhaDigitavel: null });

    // The company moves to another account after the issuance.
    const original = identityId;
    identityId = await activate('2002');
    accounts.length = 0;
    sdk.createOneStepCharge.mockClear();
    sdk.detailCharge.mockResolvedValueOnce(bolixDetail(103, pending.id, 700));
    await expect(
      efi.reconcileCharge(companyId, pending.id, actorId),
    ).resolves.toMatchObject({
      status: 'ACTIVE',
      reasonCode: 'ISSUANCE_RECOVERED',
    });
    expect(accounts).toEqual(['1001']);
    expect(sdk.createOneStepCharge).not.toHaveBeenCalled();
    expect(
      await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).toMatchObject({
      efiChargeId: '103',
      boletoLinhaDigitavel: '0019-103',
      efiPixCopiaECola: '000201bolix103',
    });
    expect(
      (
        await prisma.paymentCharge.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).issuerIdentityId,
    ).toBe(original);
  });

  it('ends paid, with one settlement, when a webhook races the reconciliation', async () => {
    const { invoice, charge } = await openReservation(9);
    await charges.attachProviderReference(charge.id, companyId, '104');
    sdk.detailCharge.mockImplementation(async () => {
      await sleep(100);
      return bolixDetail(104, charge.id, 900);
    });
    sdk.getNotification.mockResolvedValue({
      data: [
        {
          id: 1,
          custom_id: charge.id,
          identifiers: { charge_id: 104 },
          status: { current: 'paid' },
          value: 900,
        },
      ],
    });
    await Promise.all([
      efi.reconcileCharge(companyId, charge.id, actorId),
      efi.handleChargesWebhook(
        { notification: 'token' },
        undefined,
        identityId,
      ),
    ]);
    // Reconciling again after payment never reverts it.
    await efi.reconcileCharge(companyId, charge.id, actorId);
    const final = await prisma.paymentCharge.findUniqueOrThrow({
      where: { id: charge.id },
    });
    expect(final.status).toBe('PAID');
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
        .status,
    ).toBe('PAID');
    expect(
      await prisma.paymentSettlement.count({
        where: { paymentChargeId: charge.id },
      }),
    ).toBe(1);
    expect(
      await prisma.financialLedgerEntry.count({
        where: {
          paymentChargeId: charge.id,
          idempotencyKey: { startsWith: 'PAYMENT:' },
        },
      }),
    ).toBe(1);
  });

  it('links one provider charge once, never to two charges', async () => {
    const first = await openReservation(11);
    const second = await openReservation(11);
    // The listing answers 105 for any custom id; its detail names the first.
    sdk.listCharges.mockImplementation((params) =>
      Promise.resolve({
        code: 200,
        data: [{ id: 105, custom_id: params.custom_id, total: 1100 }],
      }),
    );
    sdk.detailCharge.mockImplementation(async () => {
      await sleep(50);
      return bolixDetail(105, first.charge.id, 1100);
    });
    const outcomes = await Promise.all([
      efi.reconcileCharge(companyId, first.charge.id, actorId),
      efi.reconcileCharge(companyId, first.charge.id, actorId),
      efi.reconcileCharge(companyId, second.charge.id, actorId),
    ]);
    expect(outcomes[0]).toMatchObject({ status: 'ACTIVE' });
    expect(outcomes[1]).toMatchObject({ status: 'ACTIVE' });
    expect(outcomes[2]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'PROVIDER_REFERENCE_MISMATCH',
    });
    const linked = await prisma.paymentCharge.findMany({
      where: { efiChargeId: '105' },
    });
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      id: first.charge.id,
      status: 'ACTIVE',
    });
    expect(
      await prisma.paymentCharge.findUniqueOrThrow({
        where: { id: second.charge.id },
      }),
    ).toMatchObject({ status: 'PENDING', efiChargeId: null });
    const confirmations = await prisma.paymentChargeStatusHistory.findMany({
      where: { paymentChargeId: first.charge.id, status: 'ACTIVE' },
    });
    expect(confirmations).toHaveLength(1);

    // Concurrent associations of one provider charge: the unique index keeps one.
    const third = await openReservation(13);
    const fourth = await openReservation(13);
    const attached = await Promise.allSettled([
      charges.attachProviderReference(third.charge.id, companyId, '107'),
      charges.attachProviderReference(fourth.charge.id, companyId, '107'),
    ]);
    expect(attached.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.paymentCharge.count({ where: { efiChargeId: '107' } }),
    ).toBe(1);
  });

  it('releases an old reservation Efí does not have and keeps an unanswered one', async () => {
    const absent = await openReservation(3);
    sdk.listCharges.mockResolvedValueOnce({ code: 200, data: [] });
    await expect(
      efi.reconcileCharge(companyId, absent.charge.id, actorId),
    ).resolves.toEqual({
      status: 'FAILED',
      reasonCode: 'PROVIDER_NOT_FOUND',
      recommendedAction: 'REISSUE',
    });
    const unanswered = await openReservation(5);
    sdk.listCharges.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
    );
    await expect(
      efi.reconcileCharge(companyId, unanswered.charge.id, actorId),
    ).rejects.toMatchObject({ status: 502 });
    expect(
      await prisma.paymentCharge.findUniqueOrThrow({
        where: { id: unanswered.charge.id },
      }),
    ).toMatchObject({ status: 'PENDING' });
    const recent = await openReservation(5, 60_000);
    sdk.listCharges.mockResolvedValueOnce({ code: 200, data: [] });
    await expect(
      efi.reconcileCharge(companyId, recent.charge.id, actorId),
    ).resolves.toMatchObject({ reasonCode: 'ISSUANCE_TOO_RECENT' });
    sdk.createOneStepCharge.mockResolvedValueOnce(bolixResponse(106));
    await expect(
      payments.createPayment(absent.invoice.id, companyId, 'BOLIX'),
    ).resolves.toMatchObject({ chargeId: '106' });
  });
});
