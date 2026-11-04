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
  };
  const mailer = { sendEmail: jest.fn() };
  const env: Record<string, string> = {
    RESEND_API_KEY: 're_test',
    RESEND_FROM_EMAIL: 'Cifra+ <nao-responda@ciframais.test>',
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
