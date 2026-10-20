import { Injectable } from '@nestjs/common';
import { CollectionChannel, Prisma } from '@prisma/client';
import type { TemplatePurpose } from '../templates/template-contracts';
import {
  EMISSION_SCHEDULE_DAY,
  collectionLogicalKey,
  collectionMoment,
} from '../templates/template-selection';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDays,
  daysBetween,
  saoPauloDate,
  saoPauloStart,
} from './dashboard-period';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

/**
 * Minimum time between two messages of the same invoice, whatever their channel: a day,
 * with 1 h of slack so the next day's round always counts even if yesterday's message
 * left a few minutes later in the round.
 */
export const MIN_CONTACT_INTERVAL_MS = 23 * 3_600_000;

/** Attempts that never reached the payer: they neither count as a contact nor as received. */
const NOT_DELIVERED = ['FAILED', 'BLOCKED', 'SKIPPED'] as const;

interface RuleStep {
  id: string;
  stepOrder: number;
  channel: CollectionChannel;
  delayDays: number;
  sendTimeStart: string | null;
  sendTimeEnd: string | null;
  isActive: boolean;
}

export interface ContactInvoice {
  id: string;
  companyId: string;
  dueDate: Date;
  createdAt: Date;
  recurringInvoiceId: string | null;
  debtor: {
    collectionProfile?: { steps: RuleStep[] } | null;
  };
}

/** Steps of the rule sharing a cumulative day: one contact, sent together. */
export interface Contact {
  day: number;
  steps: Array<{ ruleStepId: string; channel: CollectionChannel }>;
}

export type ContactPlan =
  | { kind: 'NONE' }
  | { kind: 'WAIT'; reason: 'SEND_WINDOW' | 'MIN_INTERVAL' }
  | { kind: 'SEND'; contact: Contact; moment: TemplatePurpose };

export interface ContactClaim {
  ruleStepId: string;
  channel: CollectionChannel;
  status: 'QUEUED' | 'FAILED';
  errorDetails?: string;
}

/**
 * Decides which contact of the collection rule an invoice gets now:
 * - steps of the same cumulative day form one contact (WhatsApp and e-mail together);
 * - of the contacts already due and never sent, only the most recent one is sent; older
 *   ones are recorded as SKIPPED and never sent;
 * - a reminder dated before the day the invoice was registered is skipped too;
 * - a contact dated on or before the day the invoice got its last rule message is skipped:
 *   editing the rule or moving the payer to another profile never goes back in time;
 * - at least 24 h between two messages of the invoice, emission included;
 * - the moment (template) follows the day the message is actually sent.
 * "Inicial" steps (day <= -30) are history: the emission message is requested when the
 * invoice is registered, not by the rule.
 */
@Injectable()
export class CollectionRuleEngine {
  constructor(private readonly prisma: PrismaService) {}

  async planContact(
    invoice: ContactInvoice,
    now = new Date(),
  ): Promise<ContactPlan> {
    const contacts = ruleContacts(
      invoice.debtor.collectionProfile?.steps ?? [],
    );
    if (contacts.length === 0) return { kind: 'NONE' };

    const dueDate = invoice.dueDate.toISOString().slice(0, 10);
    const daysFromDue = daysBetween(dueDate, saoPauloDate(now));
    const registeredDay = daysBetween(dueDate, saoPauloDate(invoice.createdAt));

    const attempted = new Set(
      (
        await this.prisma.collectionAttempt.findMany({
          where: {
            companyId: invoice.companyId,
            invoiceId: invoice.id,
            ruleStepId: {
              in: contacts.flatMap((contact) =>
                contact.steps.map((step) => step.ruleStepId),
              ),
            },
          },
          select: { ruleStepId: true },
        })
      ).map((attempt) => attempt.ruleStepId),
    );
    const due = contacts.filter(
      (contact) =>
        contact.day <= daysFromDue &&
        !contact.steps.some((step) => attempted.has(step.ruleStepId)),
    );
    const lastSentDay = due.length
      ? await this.lastRuleContactDay(invoice, dueDate)
      : null;
    const reason = (contact: Contact): SkipReason | null =>
      contact.day < 0 && contact.day < registeredDay
        ? 'BEFORE_REGISTRATION'
        : lastSentDay !== null && contact.day <= lastSentDay
          ? 'ALREADY_PASSED'
          : null;
    const chosen = due.filter((contact) => !reason(contact)).at(-1);
    const skipped = due.filter((contact) => contact !== chosen);
    if (skipped.length) await this.skip(invoice, skipped, reason);
    if (!chosen) return { kind: 'NONE' };

    const steps = invoice.debtor.collectionProfile!.steps;
    const currentTime = saoPauloTime(now);
    const outsideWindow = chosen.steps.some((item) => {
      const step = steps.find((row) => row.id === item.ruleStepId);
      return (
        step?.sendTimeStart &&
        step.sendTimeEnd &&
        (currentTime < step.sendTimeStart || currentTime > step.sendTimeEnd)
      );
    });
    if (outsideWindow) return { kind: 'WAIT', reason: 'SEND_WINDOW' };

    const last = await this.lastContactAt(this.prisma, invoice);
    if (last && now.getTime() - last.getTime() < MIN_CONTACT_INTERVAL_MS)
      return { kind: 'WAIT', reason: 'MIN_INTERVAL' };

    return {
      kind: 'SEND',
      contact: chosen,
      moment: collectionMoment({
        daysFromDue,
        recurring: Boolean(invoice.recurringInvoiceId),
        overdueReceived: await this.overdueReceived(invoice, dueDate),
      }),
    };
  }

  /**
   * Records the contact's attempts once, serialized per invoice: a concurrent run (the
   * scheduled one and "Executar agora") that already claimed this or another contact
   * inside the last 24 h makes this claim return false and nothing is sent.
   */
  async claimContact(
    invoice: Pick<ContactInvoice, 'id' | 'companyId'>,
    claims: ContactClaim[],
    now = new Date(),
  ): Promise<boolean> {
    if (claims.length === 0) return false;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`collection-contact:${invoice.id}`}, 0))`;
      const existing = await tx.collectionAttempt.count({
        where: {
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          ruleStepId: { in: claims.map((claim) => claim.ruleStepId) },
        },
      });
      if (existing > 0) return false;
      const last = await this.lastContactAt(tx, invoice);
      if (last && now.getTime() - last.getTime() < MIN_CONTACT_INTERVAL_MS)
        return false;
      await tx.collectionAttempt.createMany({
        data: claims.map((claim) => ({
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          ruleStepId: claim.ruleStepId,
          channel: claim.channel,
          status: claim.status,
          ...(claim.errorDetails ? { errorDetails: claim.errorDetails } : {}),
        })),
      });
      return true;
    });
  }

  /**
   * Last message of the invoice that may have reached the payer: a rule attempt, the
   * emission WhatsApp (initial or requested) or the emission e-mail.
   */
  async lastContactAt(
    db: Db,
    invoice: Pick<ContactInvoice, 'id' | 'companyId'>,
  ): Promise<Date | null> {
    const { companyId, id: invoiceId } = invoice;
    const [attempt, intent, email] = await Promise.all([
      db.collectionAttempt.findFirst({
        where: { companyId, invoiceId, status: { notIn: [...NOT_DELIVERED] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      db.communicationOutboundIntent.findFirst({
        where: {
          companyId,
          invoiceId,
          state: { notIn: ['FAILED', 'BLOCKED'] },
          OR: [
            { logicalKey: collectionLogicalKey({ companyId, invoiceId }) },
            {
              logicalKey: {
                startsWith: `collection:${companyId}:${invoiceId}:selected-`,
              },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      db.collectionLog.findFirst({
        where: { companyId, invoiceId, actionType: 'EMAIL_QUEUED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    const times = [attempt, intent, email]
      .map((row) => row?.createdAt.getTime())
      .filter((time): time is number => time !== undefined);
    return times.length ? new Date(Math.max(...times)) : null;
  }

  /** Day (from the due date) of the last rule message that may have reached the payer. */
  private async lastRuleContactDay(
    invoice: ContactInvoice,
    dueDate: string,
  ): Promise<number | null> {
    const attempt = await this.prisma.collectionAttempt.findFirst({
      where: {
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        status: { notIn: [...NOT_DELIVERED] },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return attempt
      ? daysBetween(dueDate, saoPauloDate(attempt.createdAt))
      : null;
  }

  /** A rule message after the due date reached the payer (not failed, held or skipped). */
  private async overdueReceived(
    invoice: ContactInvoice,
    dueDate: string,
  ): Promise<boolean> {
    return Boolean(
      await this.prisma.collectionAttempt.findFirst({
        where: {
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          status: { notIn: [...NOT_DELIVERED] },
          createdAt: { gte: saoPauloStart(addDays(dueDate, 1)) },
        },
        select: { id: true },
      }),
    );
  }

  private async skip(
    invoice: ContactInvoice,
    contacts: Contact[],
    reason: (contact: Contact) => SkipReason | null,
  ): Promise<void> {
    await this.prisma.collectionAttempt.createMany({
      data: contacts.flatMap((contact) =>
        contact.steps.map((step) => ({
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          ruleStepId: step.ruleStepId,
          channel: step.channel,
          status: 'SKIPPED' as const,
          errorDetails: SKIP_TEXT[reason(contact) ?? 'REPLACED'].attempt,
        })),
      ),
      skipDuplicates: true,
    });
    await this.prisma.collectionLog.createMany({
      data: contacts.map((contact) => ({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        actionType: 'RULE_CONTACT_SKIPPED',
        description: `Etapa do dia ${contact.day} ${SKIP_TEXT[reason(contact) ?? 'REPLACED'].log}.`,
        status: 'SKIPPED',
      })),
    });
  }
}

type SkipReason = 'BEFORE_REGISTRATION' | 'ALREADY_PASSED' | 'REPLACED';

const SKIP_TEXT: Record<SkipReason, { attempt: string; log: string }> = {
  BEFORE_REGISTRATION: {
    attempt: 'Data anterior ao cadastro da fatura.',
    log: 'ignorada: data anterior ao cadastro da fatura',
  },
  ALREADY_PASSED: {
    attempt: 'A fatura já recebeu uma mensagem da régua nesse dia ou depois.',
    log: 'não enviada: a fatura já recebeu uma mensagem da régua nesse dia ou depois',
  },
  REPLACED: {
    attempt: 'Substituída por uma etapa mais recente.',
    log: 'não enviada: uma etapa mais recente já venceu',
  },
};

/** Active rule steps grouped by cumulative day, without the "Inicial" ones. */
export function ruleContacts(steps: readonly RuleStep[]): Contact[] {
  const contacts: Contact[] = [];
  let day = 0;
  for (const step of steps
    .filter((item) => item.isActive)
    .sort((a, b) => a.stepOrder - b.stepOrder)) {
    day += step.delayDays;
    if (day <= EMISSION_SCHEDULE_DAY) continue;
    const contact = contacts.find((item) => item.day === day);
    const entry = { ruleStepId: step.id, channel: step.channel };
    if (contact) contact.steps.push(entry);
    else contacts.push({ day, steps: [entry] });
  }
  return contacts.sort((a, b) => a.day - b.day);
}

function saoPauloTime(now: Date): string {
  return new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(11, 16);
}
