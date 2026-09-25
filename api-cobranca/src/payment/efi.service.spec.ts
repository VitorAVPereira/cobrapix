import { PaymentChargeService } from './payment-charge.service';
import { ConfigService } from '@nestjs/config';
import { EfiService } from './efi.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsService } from './payment-notifications.service';
import { PrismaService } from '../prisma/prisma.service';

interface EfiPayloadBuilder {
  buildPixDebtorPayload(invoice: {
    debtor: {
      name: string;
      document: string | null;
    };
    company: {
      addressPostalCode: string | null;
      addressStreet: string | null;
      addressCity: string | null;
      addressState: string | null;
    };
  }): Record<string, string>;
  buildBoletoCustomer(invoice: {
    debtor: {
      name: string;
      document: string | null;
      email: string | null;
      phoneNumber: string;
    };
    company: {
      addressStreet: string | null;
      addressNumber: string | null;
      addressDistrict: string | null;
      addressPostalCode: string | null;
      addressCity: string | null;
      addressState: string | null;
    };
  }): Record<string, unknown>;
  formatEfiError(error: unknown): string;
}

describe('EfiService Pix CobV debtor payload', () => {
  function createService(): EfiPayloadBuilder {
    return new EfiService(
      {} as ConfigService,
      {} as PrismaService,
      {} as PaymentCryptoService,
      {} as PaymentNotificationsService,
      null,
      {} as PaymentChargeService,
    ) as unknown as EfiPayloadBuilder;
  }

  it('recusa Pix CobV sem CPF ou CNPJ do devedor', () => {
    const service = createService();

    expect(() =>
      service.buildPixDebtorPayload({
        debtor: {
          name: 'Maria Silva',
          document: null,
        },
        company: {
          addressPostalCode: null,
          addressStreet: null,
          addressCity: null,
          addressState: 'SP',
        },
      }),
    ).toThrow('CPF/CNPJ do devedor');
  });

  it('nao envia endereco Pix CobV quando os dados da empresa estao incompletos', () => {
    const service = createService();

    expect(
      service.buildPixDebtorPayload({
        debtor: {
          name: 'Maria Silva',
          document: '123.456.789-09',
        },
        company: {
          addressPostalCode: null,
          addressStreet: null,
          addressCity: null,
          addressState: 'SP',
        },
      }),
    ).toEqual({
      nome: 'Maria Silva',
      cpf: '12345678909',
    });
  });

  it('recusa Pix CobV com CPF fake', () => {
    const service = createService();

    expect(() =>
      service.buildPixDebtorPayload({
        debtor: {
          name: 'Maria Silva',
          document: '000.000.000-00',
        },
        company: {
          addressPostalCode: null,
          addressStreet: null,
          addressCity: null,
          addressState: 'SP',
        },
      }),
    ).toThrow('CPF/CNPJ do devedor');
  });

  it('monta cliente boleto pessoa juridica com CNPJ', () => {
    const service = createService();

    expect(
      service.buildBoletoCustomer({
        debtor: {
          name: 'Escola Modelo Ltda',
          document: '11.222.333/0001-81',
          email: 'financeiro@escola.com',
          phoneNumber: '+5511999999999',
        },
        company: {
          addressStreet: 'Rua A',
          addressNumber: '100',
          addressDistrict: 'Centro',
          addressPostalCode: '01001-000',
          addressCity: 'Sao Paulo',
          addressState: 'SP',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        juridical_person: {
          corporate_name: 'Escola Modelo Ltda',
          cnpj: '11222333000181',
        },
        email: 'financeiro@escola.com',
      }),
    );
  });

  it('inclui violacoes da Efi no erro formatado', () => {
    const service = createService();

    expect(
      service.formatEfiError({
        detail:
          'A requisição que busca alterar ou criar uma cobrança com vencimento não respeita o schema ou está semanticamente errada.',
        violacoes: [
          {
            razao: 'O objeto cobv.devedor não respeita o schema.',
            propriedade: 'cobv.devedor',
          },
        ],
      }),
    ).toContain('cobv.devedor: O objeto cobv.devedor');
  });
});

describe('Efí notification ordering', () => {
  function fixture(providerStatus: string, previousStatus = 'ACTIVE') {
    const invoice = {
      id: 'invoice-1',
      companyId: 'company-1',
      status: 'PENDING',
      paidAt: null,
    };
    const prisma = {
      gatewayAccount: {
        findFirst: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
      },
      paymentCharge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'charge-1',
          companyId: 'company-1',
          invoiceId: 'invoice-1',
          status: previousStatus,
          estimatedEfiFeeCents: 100,
        }),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      collectionLog: { create: jest.fn() },
      efiAccountIdentity: {
        findUnique: jest.fn().mockResolvedValue({
          companyId: 'company-1',
          pixKey: 'issuer-key',
        }),
      },
      paymentWebhookAnomaly: { upsert: jest.fn() },
    };
    const charges = {
      recordSettlement: jest.fn(),
      transition: jest.fn(),
      recordPixRefunds: jest.fn().mockResolvedValue('REFUNDED'),
    };
    const service = new EfiService(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      {} as PaymentCryptoService,
      {
        notifyPaidInvoice: jest.fn(),
      } as unknown as PaymentNotificationsService,
      null,
      charges as unknown as PaymentChargeService,
    );
    const sdk = {
      getNotification: jest.fn().mockResolvedValue({
        data: [{ custom_id: 'charge-1', status: { current: providerStatus } }],
      }),
    };
    jest
      .spyOn(
        service as unknown as { createSdkClient(): typeof sdk },
        'createSdkClient',
      )
      .mockReturnValue(sdk);
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
      });
    return { service, charges, prisma, sdk };
  }
  it('queries and scopes a charge notification by the issuing account', async () => {
    const { service, charges, prisma, sdk } = fixture('paid');
    sdk.getNotification.mockResolvedValue({
      data: [
        { custom_id: 'charge-1', status: { current: 'paid' }, value: 10650 },
      ],
    });
    await service.handleChargesWebhook(
      { notification: 'token' },
      undefined,
      'identity-1',
    );
    expect(prisma.paymentCharge.findFirst).toHaveBeenCalledWith({
      where: { id: 'charge-1', issuerIdentityId: 'identity-1' },
    });
    expect(prisma.gatewayAccount.findFirst).not.toHaveBeenCalled();
    expect(charges.recordSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'charge-1' }),
      null,
      'paid',
      10650,
    );
  });
  it('records an unknown issuing account without querying Efí', async () => {
    const { service, prisma, sdk } = fixture('paid');
    prisma.efiAccountIdentity.findUnique.mockResolvedValue(null);
    await expect(
      service.handleChargesWebhook(
        { notification: 'token' },
        undefined,
        'forged',
      ),
    ).resolves.toEqual({ processed: false });
    expect(sdk.getNotification).not.toHaveBeenCalled();
    expect(prisma.paymentWebhookAnomaly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: 'CHARGES',
          reasonCode: 'UNKNOWN_ACCOUNT',
          externalReference: 'forged',
        }) as unknown,
      }),
    );
  });
  it('does not apply a notification for a charge of another account', async () => {
    const { service, charges, prisma } = fixture('paid');
    prisma.paymentCharge.findFirst.mockResolvedValue(null);
    await expect(
      service.handleChargesWebhook(
        { notification: 'token' },
        undefined,
        'identity-1',
      ),
    ).resolves.toEqual({ processed: false });
    expect(charges.recordSettlement).not.toHaveBeenCalled();
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentWebhookAnomaly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reasonCode: 'UNKNOWN_CHARGE',
        }) as unknown,
      }),
    );
  });
  it('settles Pix with the paid amount when the receiving key is the issuer key', async () => {
    const { service, charges, prisma } = fixture('paid');
    prisma.paymentCharge.findFirst.mockResolvedValue({
      id: 'charge-1',
      companyId: 'company-1',
      invoiceId: 'invoice-1',
      status: 'ACTIVE',
      issuerIdentityId: 'identity-1',
    });
    await service.handlePixWebhook({
      pix: [{ txid: 'txid', chave: 'issuer-key', valor: '106.50' }],
    });
    expect(charges.recordSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'charge-1' }),
      null,
      'CONCLUIDA',
      10650,
    );
  });
  it('ignores and records a Pix event received by another key', async () => {
    const { service, charges, prisma } = fixture('paid');
    prisma.paymentCharge.findFirst.mockResolvedValue({
      id: 'charge-1',
      companyId: 'company-1',
      invoiceId: 'invoice-1',
      status: 'ACTIVE',
      issuerIdentityId: 'identity-1',
    });
    await service.handlePixWebhook({
      pix: [{ txid: 'txid', chave: 'other-key', valor: '100.00' }],
    });
    expect(charges.recordSettlement).not.toHaveBeenCalled();
    expect(prisma.paymentWebhookAnomaly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: 'PIX',
          reasonCode: 'RECEIVER_MISMATCH',
          companyId: 'company-1',
        }) as unknown,
      }),
    );
  });
  it('records a Pix event with an unknown txid', async () => {
    const { service, charges, prisma } = fixture('paid');
    prisma.paymentCharge.findFirst.mockResolvedValue(null);
    prisma.invoice.findFirst.mockResolvedValue(null);
    await service.handlePixWebhook({ pix: [{ txid: 'unknown' }] });
    expect(charges.recordSettlement).not.toHaveBeenCalled();
    expect(prisma.paymentWebhookAnomaly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reasonCode: 'UNKNOWN_TXID',
        }) as unknown,
      }),
    );
  });
  it('does not treat canceled boleto as paid', async () => {
    const { service, charges } = fixture('canceled');
    await service.handleChargesWebhook({ notification: 'token' }, 'company-1');
    expect(charges.recordSettlement).not.toHaveBeenCalled();
    expect(charges.transition).toHaveBeenCalledWith(
      'charge-1',
      'company-1',
      'CANCELED',
      expect.anything(),
      'canceled',
    );
  });
  it('does not independently settle the invoice after an old charge payment', async () => {
    const { service, charges, prisma } = fixture('paid', 'REPLACED');
    charges.recordSettlement.mockResolvedValue(false);
    await service.handleChargesWebhook({ notification: 'token' }, 'company-1');
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
  it('does not independently cancel the invoice after a charge refund', async () => {
    const { service, prisma } = fixture('refunded', 'PAID');
    await service.handleChargesWebhook({ notification: 'token' }, 'company-1');
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
  it('does not replace refunded invoice metadata with a delayed waiting event', async () => {
    const { service, prisma } = fixture('waiting', 'REFUNDED');
    await service.handleChargesWebhook({ notification: 'token' }, 'company-1');
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
  it('does not independently settle the invoice after an old Pix payment', async () => {
    const { service, charges, prisma } = fixture('paid', 'REPLACED');
    charges.recordSettlement.mockResolvedValue(false);
    await service.handlePixWebhook({ pix: [{ txid: 'txid' }] });
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
  it('processes confirmed Pix refunds instead of treating them as a new payment', async () => {
    const { service, charges } = fixture('paid', 'PAID');
    await service.handlePixWebhook({
      pix: [
        {
          txid: 'txid',
          endToEndId: 'e2e',
          devolucoes: [{ id: 'refund', valor: '100.00', status: 'DEVOLVIDO' }],
        },
      ],
    });
    expect(charges.recordPixRefunds).toHaveBeenCalledWith(expect.anything(), [
      { providerRefundId: 'e2e:refund', amountCents: 10000 },
    ]);
    expect(charges.recordSettlement).not.toHaveBeenCalled();
  });
  it('ignores a late payment callback after a Pix refund', async () => {
    const { service, charges, prisma } = fixture('paid', 'REFUNDED');
    await service.handlePixWebhook({ pix: [{ txid: 'txid' }] });
    expect(charges.recordSettlement).not.toHaveBeenCalled();
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
  it('does not cancel the replacement invoice on a late original cancellation', async () => {
    const { service, prisma } = fixture('canceled', 'REPLACED');
    await service.handleChargesWebhook({ notification: 'token' }, 'company-1');
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
  it('reflects provider refunds without exposing a refund operation', async () => {
    const { service, charges } = fixture('refunded', 'PAID');
    await service.handleChargesWebhook({ notification: 'token' }, 'company-1');
    expect(charges.transition).toHaveBeenCalledWith(
      'charge-1',
      'company-1',
      'REFUNDED',
      expect.anything(),
      'refunded',
    );
    expect(charges.recordSettlement).not.toHaveBeenCalled();
  });
});
