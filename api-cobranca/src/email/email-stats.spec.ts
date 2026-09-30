import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { ResendMailerService } from '../common/resend-mailer.service';

type CountArgs = [{ where: { companyId: string } }];
const counter = (value: number) =>
  jest.fn<Promise<number>, CountArgs>().mockResolvedValue(value);

describe('EmailService.getStats', () => {
  afterEach(() => jest.useRealTimers());

  function service() {
    const collectionAttempt = { count: counter(2) };
    const emailEvent = { count: counter(1) };
    return {
      stats: new EmailService(
        { get: jest.fn() } as unknown as ConfigService,
        { collectionAttempt, emailEvent } as unknown as PrismaService,
        {} as PaymentCryptoService,
        {} as ResendMailerService,
      ),
      collectionAttempt,
      emailEvent,
    };
  }

  it('counts only the company results and states where the period starts', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T15:00:00.000Z'));
    const { stats, collectionAttempt, emailEvent } = service();
    await expect(stats.getStats('company-a', '30d')).resolves.toEqual({
      periodStart: '2026-08-30T15:00:00.000Z',
      sent: 2,
      delivered: 1,
      opened: 1,
      clicked: 1,
      bounced: 1,
      complained: 1,
      failed: 2,
    });
    for (const call of [
      ...collectionAttempt.count.mock.calls,
      ...emailEvent.count.mock.calls,
    ])
      expect(call[0].where.companyId).toBe('company-a');
  });

  it('starts "today" at midnight in Brasília, not at the server midnight', async () => {
    // 23:00 on 28/09 in Brasília.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T02:00:00.000Z'));
    const { stats } = service();
    await expect(stats.getStats('company-a', 'today')).resolves.toMatchObject({
      periodStart: '2026-09-28T03:00:00.000Z',
    });
  });
});
