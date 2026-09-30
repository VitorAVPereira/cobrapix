import { Injectable, Logger } from '@nestjs/common';
import {
  CollectionChannel,
  WhatsappSelectionMode,
  WhatsappTemplatePurpose,
} from '@prisma/client';
import type { TemplateSelection } from '../templates/template-contracts';
import {
  EMISSION_SCHEDULE_DAY,
  MethodTemplates,
  collectionLogicalKey,
  ruleStepSelection,
  stepMethodTemplates,
} from '../templates/template-selection';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The rule's "Inicial" step of a channel: the first active one at the emission day. It
 * is the first message of the charge; without it the company's emission default applies.
 */
export function initialRuleStep<
  T extends {
    stepOrder: number;
    channel: CollectionChannel;
    delayDays: number;
    isActive: boolean;
  },
>(steps: readonly T[], channel: CollectionChannel): T | null {
  let day = 0;
  for (const step of steps
    .filter((item) => item.isActive)
    .sort((a, b) => a.stepOrder - b.stepOrder)) {
    day += step.delayDays;
    if (day > EMISSION_SCHEDULE_DAY) return null;
    if (step.channel === channel) return step;
  }
  return null;
}

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
        emailTemplateId?: string | null;
        whatsappSelectionMode?: WhatsappSelectionMode | null;
        whatsappPurpose?: WhatsappTemplatePurpose | null;
        pixTemplateId?: string | null;
        boletoTemplateId?: string | null;
        bolixTemplateId?: string | null;
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
  emailTemplateId: string | null;
  /** Meaningful for WHATSAPP steps only. */
  whatsappSelection: TemplateSelection;
  /** WHATSAPP only: templates by billing method, applied once the charge is known. */
  whatsappMethodTemplates: MethodTemplates;
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
      if (
        cumulativeDelayDays <= EMISSION_SCHEDULE_DAY &&
        (await this.firstMessageSent(invoice, step.channel))
      )
        continue;

      return {
        ruleStepId: step.id,
        channel: step.channel,
        templateId: step.templateId,
        emailTemplateId: step.emailTemplateId ?? null,
        whatsappSelection: ruleStepSelection({
          whatsappSelectionMode: step.whatsappSelectionMode ?? null,
          whatsappPurpose: step.whatsappPurpose ?? null,
          templateId: step.templateId,
        }),
        whatsappMethodTemplates: stepMethodTemplates(step),
        delayDays: cumulativeDelayDays,
      };
    }

    return null;
  }

  /**
   * The first message of the charge already fulfilled the "Inicial" step. Charges issued
   * before the first message claimed the step have no attempt: their first WhatsApp is
   * an intent or hold under the initial keys, their first e-mail an EMAIL_QUEUED log
   * (written only by the first charge).
   */
  private async firstMessageSent(
    invoice: IncomingInvoice,
    channel: CollectionChannel,
  ): Promise<boolean> {
    const { companyId, id: invoiceId } = invoice;
    if (channel === 'EMAIL')
      return Boolean(
        await this.prisma.collectionLog.findFirst({
          where: { companyId, invoiceId, actionType: 'EMAIL_QUEUED' },
          select: { id: true },
        }),
      );
    const keys = {
      OR: [
        { logicalKey: collectionLogicalKey({ companyId, invoiceId }) },
        {
          logicalKey: {
            startsWith: `collection:${companyId}:${invoiceId}:selected-`,
          },
        },
      ],
    };
    const [intent, hold] = await Promise.all([
      this.prisma.communicationOutboundIntent.findFirst({
        where: { companyId, invoiceId, ...keys },
        select: { id: true },
      }),
      this.prisma.whatsappTemplatePendingSend.findFirst({
        where: { companyId, invoiceId, ...keys },
        select: { id: true },
      }),
    ]);
    return Boolean(intent || hold);
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
