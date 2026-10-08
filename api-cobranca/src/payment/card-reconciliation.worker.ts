import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CardPaymentService } from './card-payment.service';

@Injectable()
export class CardReconciliationWorker {
  private readonly logger = new Logger(CardReconciliationWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: CardPaymentService,
  ) {}
  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async reconcile() {
    const attempts = await this.prisma.cardPaymentAttempt.findMany({
      where: {
        OR: [
          { status: { in: ['UNCERTAIN', 'APPROVED'] } },
          {
            status: 'SUBMITTING',
            createdAt: { lt: new Date(Date.now() - 120000) },
          },
          {
            status: 'PAID',
            paymentCharge: { invoice: { status: { not: 'PAID' } } },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      select: { id: true, companyId: true },
    });
    for (const attempt of attempts) {
      try {
        await this.cards.reconcileAttempt(attempt.id, attempt.companyId);
      } catch {
        this.logger.warn(`Conciliação de cartão pendente: ${attempt.id}`);
      }
      // Rotate unresolved cases; no provider errors or payment tokens in logs.
      await this.prisma.cardPaymentAttempt.updateMany({
        where: { id: attempt.id },
        data: { updatedAt: new Date() },
      });
    }
  }
}
