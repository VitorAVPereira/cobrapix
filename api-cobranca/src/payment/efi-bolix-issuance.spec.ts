import { ConfigService } from '@nestjs/config';
import { EfiService } from './efi.service';
import { EfiIssuanceError } from './efi-issuance-error';
import { GatewayHealthService } from './gateway-health.service';
import { PaymentChargeService } from './payment-charge.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsService } from './payment-notifications.service';
import { PrismaService } from '../prisma/prisma.service';

type Body = {
  items: Array<Record<string, unknown>>;
  payment: { banking_billet: { customer: Record<string, unknown> } };
  metadata: { custom_id: string };
};

const issuance = {
  chargeId: 'charge-1',
  issuerIdentityId: 'identity-1',
  platformFeeKind: 'FIXED' as const,
  platformFeeAmountCents: 100,
  platformFeeBasisPoints: 0,
  grossAmountCents: 500,
  lateFineBasisPoints: 0,
  lateInterestMonthlyBasisPoints: 0,
  paymentDaysAfterDue: 0,
};

function fixture(
  providerCall: (params: unknown, body: Body) => Promise<unknown>,
  settings: Record<string, string | undefined> = {},
) {
  const invoice = {
    id: 'dfcfed91-0000-4000-8000-000000000000',
    companyId: 'company-1',
    originalAmount: 5,
    dueDate: new Date('2026-10-10T03:00:00.000Z'),
    debtor: {
      name: 'Maria Silva',
      document: '529.982.247-25',
      email: '  ',
      // Stored for WhatsApp, with the country code.
      phoneNumber: '+5511987654321',
    },
    company: {
      addressStreet: 'Rua A',
      addressNumber: null,
      addressDistrict: null,
      addressPostalCode: '01001-000',
      addressCity: 'São Paulo',
      addressState: 'SP',
    },
  };
  const values: Record<string, string | undefined> = {
    EFI_PLATFORM_PAYEE_CODE: 'platform-payee',
    EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.test',
    EFI_WEBHOOK_SECRET: 'hook-secret',
    ...settings,
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!values[key])
        throw new Error(`Configuration key "${key}" does not exist`);
      return values[key];
    },
  };
  const prisma = {
    invoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
    collectionLog: { create: jest.fn() },
  };
  const charges = { attachProviderReference: jest.fn() };
  const service = new EfiService(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
    {} as PaymentCryptoService,
    {} as PaymentNotificationsService,
    { assertIssuable: jest.fn() } as unknown as GatewayHealthService,
    charges as unknown as PaymentChargeService,
  );
  jest
    .spyOn(
      service as unknown as {
        accountForIdentity(): Promise<Record<string, unknown>>;
      },
      'accountForIdentity',
    )
    .mockResolvedValue({
      companyId: 'company-1',
      issuerIdentityId: 'identity-1',
      payeeCode: 'customer-payee',
      efiAccountNumber: '1001',
    });
  const sdk = { createOneStepCharge: jest.fn(providerCall) };
  jest
    .spyOn(
      service as unknown as { createSdkClient(): typeof sdk },
      'createSdkClient',
    )
    .mockReturnValue(sdk);
  const issue = () =>
    service.createPayment(invoice.id, 'company-1', 'BOLIX', issuance);
  return { issue, sdk, charges, prisma };
}

const bolixResponse = {
  code: 200,
  data: {
    charge_id: 555,
    status: 'waiting',
    barcode: '0019',
    billet_link: 'https://boleto.example.test',
    pdf: { charge: 'https://boleto.example.test/pdf' },
    pix: { qrcode: '000201bolix', qrcode_image: 'data:image/png' },
  },
};

describe('Efí BOLIX issuance', () => {
  it('sends the debtor phone as DDD + number and omits what Efí would refuse', async () => {
    const { issue, sdk, charges } = fixture(() =>
      Promise.resolve(bolixResponse),
    );
    const issued = await issue();
    const body = sdk.createOneStepCharge.mock.calls[0]![1];
    const customer = body.payment.banking_billet.customer;
    expect(customer.phone_number).toBe('11987654321');
    expect(customer).not.toHaveProperty('email');
    // Incomplete address (no district): omitted instead of placeholders.
    expect(customer).not.toHaveProperty('address');
    expect(customer).toMatchObject({ name: 'Maria Silva', cpf: '52998224725' });
    expect(body.metadata.custom_id).toBe('charge-1');
    expect(body.items[0]).toMatchObject({
      value: 500,
      marketplace: {
        mode: 1,
        repasses: [{ payee_code: 'platform-payee', fixed: 100 }],
      },
    });
    expect(charges.attachProviderReference).toHaveBeenCalledWith(
      'charge-1',
      'company-1',
      '555',
      undefined,
    );
    expect(issued.result).toMatchObject({
      chargeId: '555',
      boletoCode: '0019',
      pixCopyPaste: '000201bolix',
    });
    expect(issued.confirmation).toMatchObject({
      source: 'CREATION',
      billingMethod: 'BOLIX',
      providerChargeId: '555',
      boletoPdf: 'https://boleto.example.test/pdf',
    });
  });

  it('turns a provider validation refusal into a diagnosed rejection', async () => {
    const { issue, charges, sdk } = fixture(() =>
      Promise.resolve(bolixResponse),
    );
    // The SDK rejects with the response body, not an Error.
    sdk.createOneStepCharge.mockRejectedValue({
      code: 3500034,
      error: 'validation_error',
      error_description: {
        property: '/payment/banking_billet/customer/phone_number',
        message: 'A string não corresponde ao modelo',
      },
    });
    const error = (await issue().catch(
      (caught: unknown) => caught,
    )) as EfiIssuanceError;
    expect(error).toBeInstanceOf(EfiIssuanceError);
    expect(error.failure).toMatchObject({
      kind: 'REJECTED',
      code: 'EFI_VALIDATION_REJECTED',
      stage: 'PROVIDER_REQUEST',
      field: '/payment/banking_billet/customer/phone_number',
    });
    expect(error.getStatus()).toBe(422);
    expect(charges.attachProviderReference).not.toHaveBeenCalled();
  });

  it('keeps a lost connection uncertain', async () => {
    const { issue } = fixture(() =>
      Promise.reject(
        Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      ),
    );
    await expect(issue()).rejects.toMatchObject({
      failure: { kind: 'UNCERTAIN', providerCode: 'net:ECONNRESET' },
      response: { code: 'EFI_SUBMISSION_UNCERTAIN' },
    });
  });

  it('keeps an accepted request without charge_id uncertain', async () => {
    const { issue, charges } = fixture(() => Promise.resolve({ code: 200 }));
    await expect(issue()).rejects.toMatchObject({
      failure: {
        kind: 'UNCERTAIN',
        code: 'EFI_RESPONSE_INCOMPLETE',
        stage: 'PROVIDER_RESPONSE',
      },
    });
    expect(charges.attachProviderReference).not.toHaveBeenCalled();
  });

  it('keeps a boleto without Pix for review, preserving its reference', async () => {
    const { issue, charges, prisma } = fixture(() =>
      Promise.resolve({
        data: { ...bolixResponse.data, pix: undefined },
      }),
    );
    await expect(issue()).rejects.toMatchObject({
      status: 503,
      failure: { kind: 'UNCERTAIN', code: 'EFI_BILLING_MODE_MISMATCH' },
      response: { code: 'EFI_BILLING_MODE_MISMATCH' },
    });
    expect(charges.attachProviderReference).toHaveBeenCalledWith(
      'charge-1',
      'company-1',
      '555',
      'EFI_BILLING_MODE_MISMATCH',
    );
    expect(prisma.collectionLog.create).toHaveBeenCalled();
  });

  it('rejects before sending when the platform payee is not configured', async () => {
    const { issue, sdk } = fixture(() => Promise.resolve(bolixResponse), {
      EFI_PLATFORM_PAYEE_CODE: undefined,
    });
    await expect(issue()).rejects.toMatchObject({
      status: 503,
      failure: {
        kind: 'REJECTED',
        stage: 'PRE_SUBMISSION',
        message: 'Recebedor da plataforma inválido para split.',
      },
    });
    expect(sdk.createOneStepCharge).not.toHaveBeenCalled();
  });

  it('rejects before sending when the webhook secret is missing', async () => {
    const { issue, sdk } = fixture(() => Promise.resolve(bolixResponse), {
      EFI_WEBHOOK_SECRET: undefined,
    });
    await expect(issue()).rejects.toMatchObject({
      failure: { kind: 'REJECTED', code: 'ISSUANCE_PRECONDITION_FAILED' },
    });
    expect(sdk.createOneStepCharge).not.toHaveBeenCalled();
  });
});

describe('Efí boleto customer', () => {
  const service = new EfiService(
    {} as ConfigService,
    {} as PrismaService,
    {} as PaymentCryptoService,
    {} as PaymentNotificationsService,
    null,
    {} as PaymentChargeService,
  ) as unknown as {
    buildBoletoCustomer(invoice: object): Record<string, unknown>;
  };
  const invoice = (phoneNumber: string, email: string | null = null) => ({
    debtor: {
      name: 'Maria Silva',
      document: '52998224725',
      email,
      phoneNumber,
    },
    company: {
      addressStreet: 'Rua A',
      addressNumber: '100',
      addressDistrict: 'Centro',
      addressPostalCode: '01001-000',
      addressCity: 'São Paulo',
      addressState: 'sp',
    },
  });

  it.each([
    ['+5511987654321', '11987654321'],
    ['+551133334444', '1133334444'],
    ['11987654321', '11987654321'],
  ])('sends %s as %s', (stored, sent) => {
    expect(service.buildBoletoCustomer(invoice(stored)).phone_number).toBe(
      sent,
    );
  });

  it.each(['+14155552671', '', '+550987654321'])(
    'omits the optional phone %p that Efí would refuse',
    (stored) => {
      expect(service.buildBoletoCustomer(invoice(stored))).not.toHaveProperty(
        'phone_number',
      );
    },
  );

  it('keeps a complete address and a filled e-mail', () => {
    expect(
      service.buildBoletoCustomer(invoice('+5511987654321', ' a@b.test ')),
    ).toMatchObject({
      email: 'a@b.test',
      address: {
        street: 'Rua A',
        number: '100',
        neighborhood: 'Centro',
        zipcode: '01001000',
        city: 'São Paulo',
        state: 'SP',
      },
    });
  });
});
