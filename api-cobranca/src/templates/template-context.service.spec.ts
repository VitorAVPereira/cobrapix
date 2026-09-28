import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TemplateContextService } from './template-context.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { PublicPaymentLinkService } from '../payment/payment-link.service';
import type { TemplateMapping } from './template-contracts';

const mapping: TemplateMapping = {
  body: {
    '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' },
    '2': { kind: 'SOURCE', source: 'AMOUNT' },
    '3': { kind: 'SOURCE', source: 'DUE_DATE' },
    '4': { kind: 'SOURCE', source: 'COMPANY_NAME' },
  },
  paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
};

function setup() {
  const invoice = {
    id: 'invoice-a',
    debtorId: 'debtor-a',
    originalAmount: 150,
    dueDate: new Date('2026-10-05T12:00:00.000Z'),
    efiPixCopiaECola: null,
    pixPayload: null,
    boletoLinhaDigitavel: null,
    boletoLink: null,
    boletoPdf: null,
  };
  const debtor = {
    id: 'debtor-a',
    name: 'Maria Exemplo',
    phoneNumber: '(11) 99999-9999',
  };
  const prisma = {
    company: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'company-a',
        corporateName: 'Empresa A Ltda',
        tradeName: 'Empresa A',
      }),
    },
    invoice: {
      findFirst: jest.fn(({ where }: { where: { companyId: string } }) =>
        Promise.resolve(where.companyId === 'company-a' ? invoice : null),
      ),
    },
    debtor: {
      findFirst: jest.fn(({ where }: { where: { companyId: string } }) =>
        Promise.resolve(where.companyId === 'company-a' ? debtor : null),
      ),
    },
    efiOnboarding: { findFirst: jest.fn() },
  };
  let token = 0;
  const links = {
    createInvoicePaymentPage: jest.fn(() => ({
      token: `token-${++token}`,
      url: `https://app.test/pagar/token-${token}`,
    })),
  };
  const service = new TemplateContextService(
    prisma as unknown as PrismaService,
    { decrypt: (value: string) => value } as unknown as PaymentCryptoService,
    links as unknown as PublicPaymentLinkService,
  );
  return { service, prisma, invoice, debtor, links };
}

describe('TemplateContextService', () => {
  it('loads values of the authorized context with Brazilian formatting', async () => {
    const { service, links } = setup();
    const loaded = await service.load(
      { companyId: 'company-a', invoiceId: 'invoice-a' },
      'COLLECTION',
      mapping,
    );
    expect(loaded.values).toEqual({
      DEBTOR_NAME: 'Maria Exemplo',
      AMOUNT: 'R$ 150,00',
      DUE_DATE: '05/10/2026',
      COMPANY_NAME: 'Empresa A',
    });
    expect(loaded.recipient).toBe('5511999999999');
    // The link comes from the server for this invoice, never from the browser.
    expect(links.createInvoicePaymentPage).toHaveBeenCalledWith({
      companyId: 'company-a',
      invoiceId: 'invoice-a',
    });
    expect(loaded.paymentUrl).toMatch(/^https:\/\/app\.test\/pagar\/token-/);
  });

  it('never resolves an invoice or debtor of another company', async () => {
    const { service, prisma } = setup();
    prisma.company.findUnique.mockResolvedValue({
      id: 'company-b',
      corporateName: 'B',
      tradeName: null,
    });
    const wrongInvoiceCompany = await service
      .load(
        { companyId: 'company-b', invoiceId: 'invoice-a' },
        'ADMIN_REPLY',
        mapping,
      )
      .catch((error: unknown) => error);
    expect(wrongInvoiceCompany).toBeInstanceOf(NotFoundException);
    await expect(
      service.load(
        { companyId: 'company-a', invoiceId: 'invoice-a', debtorId: 'other' },
        'ADMIN_REPLY',
        mapping,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires the invoice only when a value or the button depends on it', async () => {
    const { service } = setup();
    await expect(
      service.load({ companyId: 'company-a' }, 'ADMIN_REPLY', mapping),
    ).rejects.toBeInstanceOf(BadRequestException);
    const general = await service.load(
      { companyId: 'company-a' },
      'ADMIN_REPLY',
      {
        body: { '1': { kind: 'SOURCE', source: 'COMPANY_NAME' } },
      },
    );
    expect(general.values).toEqual({ COMPANY_NAME: 'Empresa A' });
    expect(general.recipient).toBeNull();
  });

  it('fingerprint ignores the expiring token but changes with amount or phone', async () => {
    const { service, invoice, debtor } = setup();
    const context = { companyId: 'company-a', invoiceId: 'invoice-a' };
    const first = await service.load(context, 'COLLECTION', mapping);
    const second = await service.load(context, 'COLLECTION', mapping);
    expect(second.paymentUrl).not.toBe(first.paymentUrl);
    expect(second.contextFingerprint).toBe(first.contextFingerprint);
    invoice.originalAmount = 151;
    const amountChanged = await service.load(context, 'COLLECTION', mapping);
    expect(amountChanged.contextFingerprint).not.toBe(first.contextFingerprint);
    invoice.originalAmount = 150;
    debtor.phoneNumber = '(11) 98888-7777';
    const phoneChanged = await service.load(context, 'COLLECTION', mapping);
    expect(phoneChanged.contextFingerprint).not.toBe(first.contextFingerprint);
  });

  it('activation messages use the validated representative of the same company', async () => {
    const { service, prisma } = setup();
    prisma.efiOnboarding.findFirst.mockResolvedValue({
      id: 'activation-a',
      representativeNameEncrypted: 'Ana Representante',
      representativePhoneEncrypted: '+55 11 97777-6666',
      sensitiveDataDeletedAt: null,
      sensitiveDataExpiresAt: new Date(Date.now() + 60_000),
    });
    const loaded = await service.load(
      { companyId: 'company-a', activationId: 'activation-a' },
      'ACTIVATION',
      {
        body: {
          '1': { kind: 'SOURCE', source: 'REPRESENTATIVE_NAME' },
          '2': { kind: 'SOURCE', source: 'COMPANY_NAME' },
        },
      },
    );
    expect(loaded.values.REPRESENTATIVE_NAME).toBe('Ana Representante');
    expect(loaded.recipient).toBe('5511977776666');
    expect(prisma.efiOnboarding.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'activation-a', companyId: 'company-a' },
      }),
    );
  });
});
