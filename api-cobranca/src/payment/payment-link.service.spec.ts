import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PublicPaymentLinkService } from './payment-link.service';
import { PrismaService } from '../prisma/prisma.service';

const TEST_SECRET = 'payment-secret-with-more-than-thirty-two-characters';
const DAY = 86_400_000;

type Charge = {
  id: string;
  status: string;
  billingMethod: string;
  gatewayId: string | null;
  efiTxid: string | null;
  efiChargeId: string | null;
  expiresAt: Date | null;
};

const activeBolix: Charge = {
  id: 'charge-2',
  status: 'ACTIVE',
  billingMethod: 'BOLIX',
  gatewayId: '555',
  efiTxid: null,
  efiChargeId: '555',
  expiresAt: new Date(Date.now() + 10 * DAY),
};

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    originalAmount: { toNumber: () => 150.5 },
    dueDate: new Date('2026-05-30T12:00:00.000Z'),
    billingType: 'BOLIX',
    status: 'PENDING',
    paidAt: null,
    gatewayStatusRaw: 'waiting',
    gatewayId: '555',
    efiTxid: null,
    efiChargeId: '555',
    efiPixCopiaECola: '000201bolix',
    pixPayload: null,
    pixExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    boletoLinhaDigitavel: '00190000000',
    boletoLink: 'https://boleto.example/1',
    boletoPdf: 'https://boleto.example/1.pdf',
    debtor: { name: 'Maria Silva' },
    company: { corporateName: 'Empresa Teste' },
    paymentCharges: [activeBolix],
    ...overrides,
  };
}

function createService(row: unknown = invoiceRow()) {
  // Only the invoice is readable: the public page must not depend on the
  // company's current account, activation or paused issuance.
  const prisma = {
    invoice: { findFirst: jest.fn().mockResolvedValue(row) },
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'PAYMENT_SECRET_KEY') return TEST_SECRET;
      if (key === 'FRONTEND_URL') return 'https://app.cobrapix.test';
      return fallback;
    }),
  } as unknown as ConfigService;
  const service = new PublicPaymentLinkService(
    config,
    prisma as unknown as PrismaService,
  );
  const token = service.createInvoicePaymentPage({
    companyId: 'company-1',
    invoiceId: 'invoice-1',
  }).token;
  return { service, prisma, token };
}

function sign(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', TEST_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

const validPayload = () => ({
  purpose: 'invoice-payment',
  companyId: 'company-1',
  invoiceId: 'invoice-1',
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const CLOSED = {
  canPay: false,
  pixCopyPaste: null,
  boletoLine: null,
  boletoLink: null,
  boletoPdf: null,
  expiresAt: null,
};

describe('PublicPaymentLinkService', () => {
  it('gera token assinado e resolve dados minimos da cobranca', async () => {
    const { service, prisma, token } = createService();

    expect(
      service.createInvoicePaymentPage({
        companyId: 'company-1',
        invoiceId: 'invoice-1',
      }).url,
    ).toMatch(/^https:\/\/app\.cobrapix\.test\/pagar\/[\w-]+\.[\w-]+$/);

    const result = await service.getPublicPayment(token);

    // Any invoice state is read, but only inside the signed company.
    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'invoice-1', companyId: 'company-1' },
      }),
    );
    expect(result).toEqual({
      invoiceId: 'invoice-1',
      companyName: 'Empresa Teste',
      debtorName: 'Maria Silva',
      amount: 150.5,
      dueDate: '2026-05-30T12:00:00.000Z',
      billingType: 'BOLIX',
      state: 'PAYABLE',
      canPay: true,
      paidAt: null,
      pixCopyPaste: '000201bolix',
      boletoLine: '00190000000',
      boletoLink: 'https://boleto.example/1',
      boletoPdf: 'https://boleto.example/1.pdf',
      expiresAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('keeps an overdue boleto payable while its issuance is active', async () => {
    const { service, token } = createService(
      invoiceRow({
        dueDate: new Date(Date.now() - 20 * DAY),
        paymentCharges: [
          { ...activeBolix, expiresAt: new Date(Date.now() - 19 * DAY) },
        ],
      }),
    );
    await expect(service.getPublicPayment(token)).resolves.toMatchObject({
      state: 'PAYABLE',
      canPay: true,
      boletoLine: '00190000000',
    });
  });

  describe('Pix CobV', () => {
    const pixInvoice = (expiresAt: Date) =>
      invoiceRow({
        billingType: 'PIX',
        gatewayId: 'txid1',
        efiTxid: 'txid1',
        efiChargeId: null,
        efiPixCopiaECola: '000201pix',
        boletoLinhaDigitavel: null,
        boletoLink: null,
        boletoPdf: null,
        dueDate: new Date(Date.now() - 3 * DAY),
        paymentCharges: [
          {
            ...activeBolix,
            billingMethod: 'PIX',
            gatewayId: 'txid1',
            efiTxid: 'txid1',
            efiChargeId: null,
            expiresAt,
          },
        ],
      });

    it('stays payable after the due date within its validity', async () => {
      const { service, token } = createService(
        pixInvoice(new Date(Date.now() + 2 * DAY)),
      );
      await expect(service.getPublicPayment(token)).resolves.toMatchObject({
        state: 'PAYABLE',
        pixCopyPaste: '000201pix',
      });
    });

    it('closes after the last payable day in Brasília', async () => {
      const { service, token } = createService(
        pixInvoice(new Date(Date.now() - 2 * DAY)),
      );
      await expect(service.getPublicPayment(token)).resolves.toMatchObject({
        state: 'EXPIRED',
        ...CLOSED,
      });
    });

    it('counts the last payable day until midnight in Brasília', () => {
      const { service } = createService();
      const deadline = (
        service as unknown as { pixDeadline(expiresAt: Date): Date }
      ).pixDeadline(new Date('2026-10-11T00:00:00.000Z'));
      // Payable through 10/10 in Brasília: until 11/10 00:00 BRT.
      expect(deadline.toISOString()).toBe('2026-10-11T03:00:00.000Z');
    });
  });

  it.each([
    [
      'paid',
      { status: 'PAID', paidAt: new Date('2026-05-29T15:00:00.000Z') },
      { state: 'PAID', paidAt: '2026-05-29T15:00:00.000Z' },
    ],
    [
      'canceled',
      {
        status: 'CANCELED',
        gatewayStatusRaw: 'canceled',
        paymentCharges: [{ ...activeBolix, status: 'CANCELED' }],
      },
      { state: 'CANCELED', paidAt: null },
    ],
    [
      'written off by Efí',
      {
        status: 'CANCELED',
        gatewayStatusRaw: 'expired',
        paymentCharges: [{ ...activeBolix, status: 'EXPIRED' }],
      },
      { state: 'EXPIRED', paidAt: null },
    ],
    [
      'a draft never issued',
      {
        status: 'DRAFT',
        gatewayId: null,
        efiChargeId: null,
        efiPixCopiaECola: null,
        boletoLinhaDigitavel: null,
        boletoLink: null,
        boletoPdf: null,
        paymentCharges: [],
      },
      { state: 'UNAVAILABLE' },
    ],
    [
      'an uncertain issuance',
      { paymentCharges: [{ ...activeBolix, status: 'PENDING' }] },
      { state: 'UNAVAILABLE' },
    ],
    [
      'a legacy link without a confirmed issuance',
      { paymentCharges: [] },
      { state: 'UNAVAILABLE' },
    ],
    [
      'invoice instruments of a replaced issuance',
      {
        gatewayId: '444',
        efiChargeId: '444',
        paymentCharges: [
          activeBolix,
          {
            ...activeBolix,
            id: 'charge-1',
            status: 'REPLACED',
            gatewayId: '444',
            efiChargeId: '444',
          },
        ],
      },
      { state: 'UNAVAILABLE' },
    ],
    [
      'an active issuance without instruments',
      {
        efiPixCopiaECola: null,
        boletoLinhaDigitavel: null,
        boletoLink: null,
        boletoPdf: null,
      },
      { state: 'UNAVAILABLE' },
    ],
  ])('shows only the status for %s', async (_name, overrides, expected) => {
    const { service, token } = createService(invoiceRow(overrides));
    const result = await service.getPublicPayment(token);
    expect(result).toMatchObject({ ...CLOSED, ...expected });
    const json = JSON.stringify(result);
    for (const instrument of ['000201bolix', '00190000000', 'boleto.example'])
      expect(json).not.toContain(instrument);
  });

  it('serves the replacing issuance, never the replaced one', async () => {
    const { service, token } = createService(
      invoiceRow({
        paymentCharges: [
          activeBolix,
          {
            ...activeBolix,
            id: 'charge-1',
            status: 'REPLACED',
            gatewayId: '444',
            efiChargeId: '444',
          },
        ],
      }),
    );
    await expect(service.getPublicPayment(token)).resolves.toMatchObject({
      state: 'PAYABLE',
      boletoLine: '00190000000',
    });
  });

  it('answers a missing invoice with the same generic error', async () => {
    const { service, token } = createService(null);
    await expect(service.getPublicPayment(token)).rejects.toThrow(
      'Cobranca nao encontrada ou indisponivel.',
    );
  });

  describe('token', () => {
    const tampered = (token: string, change: Record<string, unknown>) => {
      const [payload, signature] = token.split('.');
      const decoded = JSON.parse(
        Buffer.from(payload!, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      return `${Buffer.from(JSON.stringify({ ...decoded, ...change })).toString('base64url')}.${signature}`;
    };

    it.each([
      ['a random string', () => 'token-invalido'],
      ['an empty token', () => ''],
      ['an extra segment', (token: string) => `${token}.extra`],
      ['a missing signature', (token: string) => `${token.split('.')[0]}.`],
      [
        'another company',
        (token: string) => tampered(token, { companyId: 'company-2' }),
      ],
      [
        'another invoice',
        (token: string) => tampered(token, { invoiceId: 'invoice-2' }),
      ],
      [
        'a forged signature',
        (token: string) => `${token.split('.')[0]}.${'A'.repeat(43)}`,
      ],
      ['non base64url characters', (token: string) => `${token}!`],
      ['an oversized token', () => `${'a'.repeat(600)}.${'b'.repeat(43)}`],
      [
        'an expiration equal to now',
        () => sign({ ...validPayload(), exp: Math.floor(Date.now() / 1000) }),
      ],
      ['a past expiration', () => sign({ ...validPayload(), exp: 1 })],
      [
        'a non-finite expiration',
        () => sign({ ...validPayload(), exp: 'never' }),
      ],
      [
        'a fractional expiration',
        () => sign({ ...validPayload(), exp: Date.now() / 1000 + 3600.5 }),
      ],
      ['another purpose', () => sign({ ...validPayload(), purpose: 'login' })],
      ['an empty company', () => sign({ ...validPayload(), companyId: '' })],
      ['an empty invoice', () => sign({ ...validPayload(), invoiceId: '' })],
      [
        'an unexpected field',
        () => sign({ ...validPayload(), userId: 'admin' }),
      ],
    ])('rejects %s before reading the database', async (_name, build) => {
      const { service, prisma, token } = createService();
      await expect(service.getPublicPayment(build(token))).rejects.toThrow(
        'Link de pagamento invalido ou expirado.',
      );
      expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
    });

    it('never echoes the token in the error', async () => {
      const { service, token } = createService();
      const forged = tampered(token, { companyId: 'company-2' });
      const error = (await service
        .getPublicPayment(forged)
        .catch((caught: unknown) => caught)) as Error;
      expect(JSON.stringify(error)).not.toContain(forged.slice(0, 20));
      expect(error.message).not.toContain(forged.slice(0, 20));
    });

    it('keeps links signed before this change valid', async () => {
      const { service, prisma } = createService();
      await expect(
        service.getPublicPayment(sign(validPayload())),
      ).resolves.toMatchObject({ state: 'PAYABLE' });
      expect(prisma.invoice.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
