import { ConfigService } from '@nestjs/config';
import { EfiService } from './efi.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { PaymentNotificationsService } from './payment-notifications.service';
import { PrismaService } from '../prisma/prisma.service';

interface SplitResolver {
  resolveSplitSettings(input: {
    dueDate: Date;
    company: {
      onTimeSplitPercentageBps: number;
      overdueSplitPercentageBps: number;
    };
  }): { percentageBps: number; category: 'ON_TIME' | 'OVERDUE' };
}

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

describe('EfiService split settings', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-12T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createService(): SplitResolver {
    return new EfiService(
      {} as ConfigService,
      {} as PrismaService,
      {} as PaymentCryptoService,
      {} as PaymentNotificationsService,
    ) as unknown as SplitResolver;
  }

  it('usa taxa no prazo quando a cobranca e emitida no vencimento', () => {
    const service = createService();

    expect(
      service.resolveSplitSettings({
        dueDate: new Date('2026-05-12T00:00:00.000Z'),
        company: {
          onTimeSplitPercentageBps: 350,
          overdueSplitPercentageBps: 1200,
        },
      }),
    ).toEqual({ percentageBps: 350, category: 'ON_TIME' });
  });

  it('usa taxa recuperada quando a cobranca e emitida depois do vencimento', () => {
    const service = createService();

    expect(
      service.resolveSplitSettings({
        dueDate: new Date('2026-05-11T23:59:59.000Z'),
        company: {
          onTimeSplitPercentageBps: 350,
          overdueSplitPercentageBps: 1200,
        },
      }),
    ).toEqual({ percentageBps: 1200, category: 'OVERDUE' });
  });
});

describe('EfiService Pix CobV debtor payload', () => {
  function createService(): EfiPayloadBuilder {
    return new EfiService(
      {} as ConfigService,
      {} as PrismaService,
      {} as PaymentCryptoService,
      {} as PaymentNotificationsService,
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
