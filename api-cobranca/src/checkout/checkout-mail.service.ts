import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import type { OrderItem } from './checkout-pricing';

export const CHECKOUT_MAIL_QUEUE = 'checkout-mail';

interface AccessMailJob {
  orderId: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class CheckoutMailJobs {
  constructor(
    @InjectQueue(CHECKOUT_MAIL_QUEUE)
    private readonly queue: Queue<AccessMailJob>,
  ) {}

  /** One job per order: a repeated confirmation does not queue a second e-mail. */
  async accessEmail(orderId: string): Promise<void> {
    await this.queue.add(
      'access',
      { orderId },
      {
        jobId: `access-${orderId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}

/** The buyer's access e-mail, sent by Cifra+ once the payment is confirmed. */
@Processor(CHECKOUT_MAIL_QUEUE)
export class CheckoutMailProcessor extends WorkerHost {
  private readonly logger = new Logger(CheckoutMailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: ResendMailerService,
  ) {
    super();
  }

  async process(job: Job<AccessMailJob>): Promise<void> {
    const order = await this.prisma.checkoutOrder.findUnique({
      where: { id: job.data.orderId },
      include: { company: { select: { checkoutSettings: true } } },
    });
    if (!order || order.status !== 'PAID' || order.accessEmailSentAt) return;
    const settings = order.company.checkoutSettings;
    const seller = settings?.displayName ?? 'o vendedor';
    const items = order.items as unknown as OrderItem[];
    const main = items.find((line) => line.kind === 'MAIN') ?? items[0];
    const lines = items.map((line) => {
      const access =
        line.deliveryMode !== 'WEBHOOK' && line.accessUrl
          ? `<a href="${escapeHtml(line.accessUrl)}">Acessar ${escapeHtml(line.name)}</a>`
          : escapeHtml(line.name);
      const instructions = line.accessInstructions
        ? `<br>${escapeHtml(line.accessInstructions).replace(/\n/g, '<br>')}`
        : '';
      return `<li>${access}${instructions}</li>`;
    });
    const support = [settings?.supportEmail, settings?.supportWhatsapp]
      .filter(Boolean)
      .map((value) => escapeHtml(value as string))
      .join(' · ');
    try {
      await this.mailer.sendEmail({
        apiKey: this.required('RESEND_API_KEY'),
        from: this.required('RESEND_FROM_EMAIL'),
        to: [order.buyerEmail],
        ...(settings?.supportEmail ? { replyTo: settings.supportEmail } : {}),
        subject: `Seu acesso a ${(main?.name ?? 'sua compra').replace(/[\r\n]+/g, ' ')}`,
        html: [
          `<p>Olá, ${escapeHtml(order.buyerName.split(' ')[0] ?? order.buyerName)}!</p>`,
          `<p>Seu pagamento para ${escapeHtml(seller)} foi confirmado. Veja como acessar:</p>`,
          `<ul>${lines.join('')}</ul>`,
          support ? `<p>Dúvidas sobre o produto: ${support}</p>` : '',
          // Consumer law: 7 days to change one's mind; the link says so.
          `<p>Se mudar de ideia, você pode <a href="${escapeHtml(this.refundUrl(order.publicToken))}">pedir reembolso</a> em até 7 dias.</p>`,
          '<p>Pagamento processado pela Cifra+.</p>',
        ].join(''),
        idempotencyKey: `checkout-access-${order.id}`,
      });
    } catch (error) {
      // Provider errors repeat through the queue; no buyer data in the log.
      this.logger.warn('CHECKOUT_ACCESS_EMAIL_FAILED');
      throw error;
    }
    await this.prisma.checkoutOrder.updateMany({
      where: { id: order.id, accessEmailSentAt: null },
      data: { accessEmailSentAt: new Date() },
    });
  }

  private refundUrl(token: string): string {
    const base = this.required('FRONTEND_URL').replace(/\/+$/, '');
    return `${base}/c/pedido/${token}/reembolso`;
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) throw new Error(`${key} ausente`);
    return value;
  }
}
