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
