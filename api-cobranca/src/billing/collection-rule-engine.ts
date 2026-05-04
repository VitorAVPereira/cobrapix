import { Injectable, Logger } from '@nestjs/common';
import { CollectionChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface IncomingInvoice {
  id: string;
  companyId: string;
  dueDate: Date;
  debtor: {
    id: string;
    collectionProfileId: string | null;
    collectionProfile?: {
      id: string;
      steps: Array<{
        id: string;
        stepOrder: number;
        channel: CollectionChannel;
        templateId: string | null;
        delayDays: number;
        sendTimeStart: string | null;
        sendTimeEnd: string | null;
        isActive: boolean;
      }>;
    } | null;
  };
}

interface ResolvedStep {
  ruleStepId: string;
  channel: CollectionChannel;
  templateId: string | null;
  delayDays: number;
}

@Injectable()
export class CollectionRuleEngine {
  private readonly logger = new Logger(CollectionRuleEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  async getNextStep(invoice: IncomingInvoice): Promise<ResolvedStep | null> {
    const profile = invoice.debtor.collectionProfile;
    if (!profile) return null;

    const steps = profile.steps
      .filter((s) => s.isActive)
      .sort((a, b) => a.stepOrder - b.stepOrder);

    if (steps.length === 0) return null;

    const today = this.startOfDay(new Date());
    const dueDate = this.startOfDay(invoice.dueDate);
    const daysOverdue = Math.floor(
      (today.getTime() - dueDate.getTime()) / (24 * 3600 * 1000),
    );

    let cumulativeDelayDays = 0;

    for (const step of steps) {
      cumulativeDelayDays += step.delayDays;

      if (daysOverdue < cumulativeDelayDays) {
        return null;
      }

      if (step.sendTimeStart && step.sendTimeEnd) {
        const currentTime = this.getCurrentLocalTime();

        if (
          currentTime < step.sendTimeStart ||
          currentTime > step.sendTimeEnd
        ) {
          this.logger.debug(
            `Etapa ${step.stepOrder} fora da janela de envio (${step.sendTimeStart}-${step.sendTimeEnd}), hora atual: ${currentTime}`,
          );
          return null;
        }
      }

      const alreadyAttempted = await this.prisma.collectionAttempt.findFirst({
        where: {
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          ruleStepId: step.id,
          channel: step.channel,
        },
      });

      if (alreadyAttempted) continue;

      return {
        ruleStepId: step.id,
        channel: step.channel,
        templateId: step.templateId,
        delayDays: cumulativeDelayDays,
      };
    }

    return null;
  }

  private startOfDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private getCurrentLocalTime(): string {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';

    return `${hour}:${minute}`;
  }
}
