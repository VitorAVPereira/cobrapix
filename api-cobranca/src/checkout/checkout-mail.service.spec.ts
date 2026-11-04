import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { CheckoutMailProcessor } from './checkout-mail.service';

interface MailArg {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
  idempotencyKey?: string;
}

describe('CheckoutMailProcessor', () => {
  const prisma = {
    checkoutOrder: { findUnique: jest.fn(), updateMany: jest.fn() },
    checkoutRefundRequest: { findUnique: jest.fn() },
  };
  const mailer = { sendEmail: jest.fn() };
  const env: Record<string, string> = {
    RESEND_API_KEY: 're_test',
    RESEND_FROM_EMAIL: 'Cifra+ <nao-responda@ciframais.test>',
    FRONTEND_URL: 'https://app.ciframais.test/',
  };
  const processor = new CheckoutMailProcessor(
    prisma as unknown as PrismaService,
    { get: (key: string) => env[key] } as unknown as ConfigService,
    mailer as unknown as ResendMailerService,
  );
  const job = { data: { orderId: 'order-1' } } as Job<{ orderId: string }>;
  const paid = {
    id: 'order-1',
    status: 'PAID',
    publicToken: 'tok',
    accessEmailSentAt: null,
    buyerName: 'Maria Souza',
    buyerEmail: 'maria@exemplo.test',
    items: [
      {
        kind: 'MAIN',
        name: 'Porquim Anual',
        deliveryMode: 'ACCESS_LINK',
        accessUrl: 'https://acesso.test/porquim',
        accessInstructions: null,
      },
      {
        kind: 'BUMP',
        name: 'Acesso Extra <b>',
        deliveryMode: 'WEBHOOK',
        accessUrl: 'https://nao-mostrar.test',
        accessInstructions: 'Chega no seu WhatsApp.',
      },
    ],
    company: {
      checkoutSettings: {
        displayName: 'Porquim',
        supportEmail: 'suporte@porquim.test',
        supportWhatsapp: '11999999999',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutOrder.findUnique.mockResolvedValue(paid);
  });

  describe('reembolso', () => {
    const refundJob = (data: object) =>
      ({ name: 'refund', data: { orderId: 'order-1', ...data } }) as Job<{
        orderId: string;
      }>;
    const request = {
      id: 'r1',
      status: 'REQUESTED',
      itemIndexes: [1],
      amountCents: 1508,
      holdUntil: new Date('2026-11-17T15:00:00Z'),
    };

    it('recebido: valor, itens, prazo do vendedor e o link para desistir, sem o motivo', async () => {
      prisma.checkoutRefundRequest.findUnique.mockResolvedValue({
        ...request,
        reason: 'Motivo interno do vendedor',
      });
      await processor.process(
        refundJob({ step: 'RECEIVED', requestId: 'r1', ref: 'r1' }),
      );

      const mail = (mailer.sendEmail.mock.calls as [MailArg][])[0]?.[0];
      expect(mail?.subject).toBe(
        'Recebemos seu pedido de reembolso: Porquim Anual',
      );
      expect(mail?.html).toContain('Acesso Extra &lt;b&gt;');
      expect(mail?.html).toContain('R$ 15,08');
      expect(mail?.html).toContain('17/11/2026');
      expect(mail?.html).toContain(
        'href="https://app.ciframais.test/c/pedido/tok/reembolso"',
      );
      expect(mail?.html).not.toContain('Motivo interno');
      expect(mail?.idempotencyKey).toBe('checkout-refund-RECEIVED-r1');
    });

    it('lembrete de um pedido já resolvido não sai', async () => {
      prisma.checkoutRefundRequest.findUnique.mockResolvedValue({
        ...request,
        status: 'WITHDRAWN',
      });
      await processor.process(
        refundJob({ step: 'RECEIVED', requestId: 'r1', ref: 'r1-1' }),
      );
      expect(mailer.sendEmail).not.toHaveBeenCalled();
    });

    it('concluído: valor devolvido e o caminho do dinheiro no Pix', async () => {
      await processor.process(
        refundJob({ step: 'DONE', amountCents: 7611, ref: 'pix:E1:D1' }),
      );
      const mail = (mailer.sendEmail.mock.calls as [MailArg][])[0]?.[0];
      expect(mail?.subject).toBe('Reembolso concluído: Porquim Anual');
      expect(mail?.html).toContain('Devolvemos R$ 76,11');
      expect(mail?.html).toContain(
        'No Pix, o valor volta para a conta que fez o pagamento.',
      );
    });
  });

  it('manda o link de cada item por link e as instruções dos itens por webhook', async () => {
    await processor.process(job);

    const mail = (mailer.sendEmail.mock.calls as [MailArg][])[0]?.[0];
    expect(mail?.to).toEqual(['maria@exemplo.test']);
    expect(mail?.subject).toBe('Seu acesso a Porquim Anual');
    expect(mail?.replyTo).toBe('suporte@porquim.test');
    expect(mail?.idempotencyKey).toBe('checkout-access-order-1');
    expect(mail?.html).toContain('href="https://acesso.test/porquim"');
    expect(mail?.html).not.toContain('nao-mostrar.test');
    expect(mail?.html).toContain('Chega no seu WhatsApp.');
    expect(mail?.html).toContain('Acesso Extra &lt;b&gt;');
    expect(mail?.html).toContain('Pagamento processado pela Cifra+.');
    expect(mail?.html).toContain(
      'href="https://app.ciframais.test/c/pedido/tok/reembolso"',
    );
    expect(prisma.checkoutOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', accessEmailSentAt: null },
      data: { accessEmailSentAt: expect.any(Date) as Date },
    });
  });

  it('não manda de novo nem para pedido não pago', async () => {
    prisma.checkoutOrder.findUnique.mockResolvedValueOnce({
      ...paid,
      accessEmailSentAt: new Date(),
    });
    await processor.process(job);
    prisma.checkoutOrder.findUnique.mockResolvedValueOnce({
      ...paid,
      status: 'PENDING',
    });
    await processor.process(job);

    expect(mailer.sendEmail).not.toHaveBeenCalled();
  });

  it('falha do provedor volta para a fila sem marcar como enviado', async () => {
    mailer.sendEmail.mockRejectedValueOnce(new Error('resend down'));
    await expect(processor.process(job)).rejects.toThrow('resend down');
    expect(prisma.checkoutOrder.updateMany).not.toHaveBeenCalled();
  });
});
