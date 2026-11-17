import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CheckoutRefundExecution,
  CheckoutRefundExecutionOrigin,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { CheckoutPlatformService } from './checkout-platform.service';
import { CheckoutRefundsService } from './checkout-refunds.service';
import { EfiCheckoutCardClient } from './efi-checkout-card.client';
import {
  EfiCheckoutRefundClient,
  type RefundOutcome,
} from './efi-checkout-refund.client';

const AUDIT_RETENTION_MS = 5 * 365.25 * 86_400_000;
// A Pix refund the Efí does not know by its id after this never happened.
const NOT_FOUND_AFTER_MS = 30 * 60_000;
const OPEN = ['SUBMITTING', 'PROCESSING', 'UNCERTAIN'] as const;

export interface ExecutionBy {
  origin: CheckoutRefundExecutionOrigin;
  userId: string | null;
  // ADMIN: where the seller's ok is (a message and its date).
  approvalReference?: string | null;
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Refunds executed by the system in the seller's own Efí account. Each try
 * is saved before the Efí is called; a lost answer is read back, never sent
 * again, and only what the Efí confirms enters the ledger.
 */
@Injectable()
export class CheckoutRefundExecutionsService {
  private readonly logger = new Logger(CheckoutRefundExecutionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: CheckoutPlatformService,
    private readonly refunds: CheckoutRefundsService,
    private readonly client: EfiCheckoutRefundClient,
    private readonly cards: EfiCheckoutCardClient,
    private readonly config: ConfigService,
    private readonly mailer: ResendMailerService,
  ) {}

  /** Executes the open refund request of a sale of this company. */
  async execute(
    companyId: string,
    orderId: string,
    by: ExecutionBy,
    now = new Date(),
  ) {
    const order = await this.prisma.checkoutOrder.findFirst({
      where: { id: orderId, companyId, company: { product: 'CHECKOUT' } },
      include: {
        terms: { select: { accountMode: true } },
        attempt: true,
        cardAttempts: { where: { status: 'PAID' }, take: 1 },
        refundRequests: { where: { status: 'REQUESTED' }, take: 1 },
        ledgerEntries: {
          where: { kind: 'REFUND' },
          select: { amountCents: true },
        },
      },
    });
    // Another company's sale is simply not found.
    if (!order) throw new NotFoundException('Venda não encontrada.');
    if (order.terms.accountMode !== 'SELLER_ACCOUNT')
      conflict(
        'CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED',
        'Esta venda foi recebida pela conta Cifra+: a devolução é feita pela Cifra+.',
      );
    const request = order.refundRequests[0];
    if (!request)
      conflict(
        'CHECKOUT_REFUND_NOT_REQUESTED',
        'Não há pedido de reembolso em aberto nesta venda.',
      );
    if (order.status !== 'PAID')
      conflict(
        'CHECKOUT_REFUND_NOT_ALLOWED',
        'Só uma venda paga pode ser reembolsada.',
      );
    const refunded = -order.ledgerEntries.reduce(
      (sum, entry) => sum + entry.amountCents,
      0,
    );
    const amountCents = request.amountCents ?? order.totalCents - refunded;
    if (amountCents <= 0 || amountCents > order.totalCents - refunded)
      conflict(
        'CHECKOUT_REFUND_TOO_HIGH',
        'O valor passa do que ainda pode ser devolvido nesta venda.',
      );
    const pix = order.paymentMethod === 'PIX' ? order.attempt : null;
    const card = order.paymentMethod === 'CARD' ? order.cardAttempts[0] : null;
    const issuerIdentityId =
      pix?.issuerIdentityId ?? card?.issuerIdentityId ?? null;
    if (
      !issuerIdentityId ||
      (pix && !pix.endToEndId) ||
      (card && !card.efiChargeId)
    )
      conflict(
        'CHECKOUT_REFUND_PAYMENT_UNKNOWN',
        'Não achamos o pagamento desta venda na Efí. Fale com a Cifra+.',
      );

    let execution: CheckoutRefundExecution;
    try {
      execution = await this.prisma.$transaction(async (tx) => {
        const created = await tx.checkoutRefundExecution.create({
          data: {
            companyId,
            refundRequestId: request.id,
            orderId: order.id,
            method: order.paymentMethod,
            amountCents,
            // The Pix refund id: letters and digits, up to 35, chosen here.
            efiRefundId: `ckr${randomUUID().replace(/-/g, '')}`,
            issuerIdentityId,
            origin: by.origin,
            requestedByUserId: by.userId,
            approvalReference: by.approvalReference?.trim() || null,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId,
            userId: by.userId ?? 'system',
            entityType: 'CheckoutRefundExecution',
            entityId: created.id,
            action: 'CHECKOUT_REFUND_EXECUTION_STARTED',
            changes: {
              orderId: order.id,
              amountCents,
              origin: by.origin,
              approvalReference: created.approvalReference,
            },
            retentionExpiresAt: new Date(now.getTime() + AUDIT_RETENTION_MS),
          },
        });
        return created;
      });
    } catch (error) {
      // A double click, or the worker at the same time: one try only.
      if (isUniqueViolation(error)) return this.current(request.id);
      throw error;
    }

    const account = await this.platform.accountOf(issuerIdentityId);
    const outcome: RefundOutcome = !account
      ? { outcome: 'UNCERTAIN' }
      : pix
        ? await this.client.pix(
            account,
            pix.endToEndId!,
            execution.efiRefundId,
            amountCents,
          )
        : await this.client.card(account, card!.efiChargeId!, amountCents);
    await this.apply(execution, outcome, now);
    return this.current(request.id);
  }

  /**
   * Worker: executions without a final answer are read back at the Efí.
   * A partial card refund has no state to read: it is settled on acceptance.
   */
  async reconcileDue(now = new Date()): Promise<void> {
    const due = await this.prisma.checkoutRefundExecution.findMany({
      where: {
        status: { in: [...OPEN] },
        updatedAt: { lt: new Date(now.getTime() - 60_000) },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const execution of due) {
      try {
        await this.reconcile(execution, now);
      } catch {
        this.logger.warn('CHECKOUT_REFUND_RECONCILE_PENDING');
      }
      await this.prisma.checkoutRefundExecution.updateMany({
        where: { id: execution.id, status: { in: [...OPEN] } },
        data: { lastCheckedAt: now },
      });
    }
  }

  private async reconcile(execution: CheckoutRefundExecution, now: Date) {
    const account = await this.platform.accountOf(execution.issuerIdentityId);
    if (!account) return;
    const stale =
      now.getTime() - execution.createdAt.getTime() > NOT_FOUND_AFTER_MS;
    if (execution.method === 'PIX') {
      const attempt = await this.prisma.checkoutPaymentAttempt.findUnique({
        where: { orderId: execution.orderId },
        select: { endToEndId: true },
      });
      if (!attempt?.endToEndId) return;
      const found = await this.client.pixStatus(
        account,
        attempt.endToEndId,
        execution.efiRefundId,
      );
      if (found) return this.apply(execution, found, now);
      // The Efí never received this refund: the request can be tried again.
      if (stale && execution.status !== 'PROCESSING')
        return this.apply(
          execution,
          { outcome: 'REJECTED', code: 'EFI_REFUND_NOT_FOUND' },
          now,
        );
      return;
    }
    const attempt = await this.prisma.checkoutCardAttempt.findFirst({
      where: { orderId: execution.orderId, status: 'PAID' },
      select: { efiChargeId: true },
    });
    if (!attempt?.efiChargeId) return;
    const detail = await this.cards.detail(account, attempt.efiChargeId);
    if (detail?.status === 'refunded')
      return this.apply(execution, { outcome: 'DONE' }, now);
  }

  /** What the Efí said, applied once. */
  private async apply(
    execution: CheckoutRefundExecution,
    outcome: RefundOutcome,
    now: Date,
  ): Promise<void> {
    if (outcome.outcome === 'DONE') return this.complete(execution, now);
    if (outcome.outcome === 'PROCESSING') {
      // A partial card refund has no state of its own to wait for.
      if (execution.method === 'CARD' && (await this.partial(execution)))
        return this.complete(execution, now);
      await this.prisma.checkoutRefundExecution.updateMany({
        where: { id: execution.id, status: { in: [...OPEN] } },
        data: { status: 'PROCESSING' },
      });
      return;
    }
    if (outcome.outcome === 'UNCERTAIN') {
      await this.prisma.checkoutRefundExecution.updateMany({
        where: { id: execution.id, status: 'SUBMITTING' },
        data: { status: 'UNCERTAIN' },
      });
      return;
    }
    const failed = await this.prisma.checkoutRefundExecution.updateMany({
      where: { id: execution.id, status: { in: [...OPEN] } },
      data: { status: 'FAILED', failureCode: outcome.code, completedAt: now },
    });
    if (failed.count === 1) await this.tellSeller(execution, outcome.code);
  }

  /**
   * The ledger first, by a key that never counts twice, then the execution:
   * if anything fails between them, the worker does both again safely.
   */
  private async complete(execution: CheckoutRefundExecution, now: Date) {
    const key =
      execution.method === 'PIX'
        ? await this.pixKey(execution)
        : `card:${execution.id}`;
    // Same key as the Pix refund notice: whichever comes first counts once.
    await this.refunds.record(
      {
        orderId: execution.orderId,
        amountCents: execution.amountCents,
        idempotencyKey: key,
        evidenceReference: execution.efiRefundId,
        createdByUserId: execution.requestedByUserId,
        fromProvider: true,
      },
      now,
    );
    await this.prisma.checkoutRefundExecution.updateMany({
      where: { id: execution.id, status: { in: [...OPEN] } },
      data: { status: 'DONE', completedAt: now },
    });
  }

  private async pixKey(execution: CheckoutRefundExecution): Promise<string> {
    const attempt = await this.prisma.checkoutPaymentAttempt.findUnique({
      where: { orderId: execution.orderId },
      select: { endToEndId: true },
    });
    return `pix:${attempt?.endToEndId ?? 'unknown'}:${execution.efiRefundId}`;
  }

  private async partial(execution: CheckoutRefundExecution): Promise<boolean> {
    const order = await this.prisma.checkoutOrder.findUnique({
      where: { id: execution.orderId },
      select: {
        totalCents: true,
        ledgerEntries: {
          where: { kind: 'REFUND' },
          select: { amountCents: true },
        },
      },
    });
    if (!order) return false;
    const refunded = -order.ledgerEntries.reduce(
      (sum, entry) => sum + entry.amountCents,
      0,
    );
    return execution.amountCents < order.totalCents - refunded;
  }

  /** The latest execution of a refund request, as the screens show it. */
  private async current(refundRequestId: string) {
    const execution = await this.prisma.checkoutRefundExecution.findFirst({
      where: { refundRequestId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        failureCode: true,
        amountCents: true,
        origin: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return execution ? { ...execution, message: messageOf(execution) } : null;
  }

  /** D6: the Efí refused (no balance, deadline): the seller hears it. */
  private async tellSeller(execution: CheckoutRefundExecution, code: string) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM_EMAIL');
    const company = await this.prisma.company.findUnique({
      where: { id: execution.companyId },
      select: { email: true },
    });
    if (!apiKey || !from || !company) return;
    try {
      await this.mailer.sendEmail({
        apiKey,
        from,
        to: [company.email],
        subject: 'Reembolso não realizado pela Efí',
        html: `<p>A Efí não fez a devolução de um pedido de reembolso do seu checkout (${failureText(code)}).</p><p>O pedido continua em aberto e o comprador vê "em processamento". Confira o saldo da sua conta Efí e, em Vendas, clique em "Reembolsar" de novo.</p>`,
        idempotencyKey: `checkout-refund-failed-${execution.id}`,
      });
    } catch {
      this.logger.warn('CHECKOUT_REFUND_FAILED_EMAIL_NOT_SENT');
    }
  }
}

function failureText(code: string): string {
  if (/SALDO/i.test(code)) return 'sem saldo na conta';
  if (code === 'EFI_REFUND_NOT_FOUND') return 'a Efí não recebeu a devolução';
  return 'a Efí recusou a devolução';
}

function messageOf(execution: { status: string; failureCode: string | null }) {
  if (execution.status === 'DONE') return 'Reembolso feito.';
  if (execution.status === 'FAILED')
    return `Reembolso não realizado: ${failureText(execution.failureCode ?? '')}. Tente de novo.`;
  return 'Reembolso em processamento na Efí.';
}
