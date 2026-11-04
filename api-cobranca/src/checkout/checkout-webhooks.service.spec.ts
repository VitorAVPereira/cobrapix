import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import type { CheckoutWebhookSender } from './checkout-webhook.sender';
import {
  CheckoutWebhooksService,
  DISABLE_AFTER_MS,
  RETRY_WINDOW_MS,
} from './checkout-webhooks.service';

const now = new Date('2026-11-06T12:00:00Z');

interface CreateArg {
  data: {
    status: string;
    eventType: string;
    payload: {
      id: string;
      type: string;
      data: {
        order?: {
          items: Array<{ kind: string; accessExpiresAt: string | null }>;
        };
        refund?: unknown;
      };
    };
    retryUntil: Date;
  };
}
interface UpdateArg {
  data: { status: string; nextAttemptAt: Date | null; attempts: number };
}

describe('CheckoutWebhooksService', () => {
  const prisma = {
    checkoutSettings: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    checkoutOrder: { findUnique: jest.fn() },
    checkoutWebhookDelivery: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    company: { findUnique: jest.fn() },
  };
  const sender = { send: jest.fn() };
  const mailer = { sendEmail: jest.fn() };
  const env: Record<string, string> = {
    RESEND_API_KEY: 're_test',
    RESEND_FROM_EMAIL: 'Cifra+ <x@y.test>',
  };
  const service = new CheckoutWebhooksService(
    prisma as unknown as PrismaService,
    sender as unknown as CheckoutWebhookSender,
    {
      encrypt: (value: string) => `enc:${value}`,
      decrypt: (value: string) => value.replace(/^enc:/, ''),
    } as unknown as PaymentCryptoService,
    { get: (key: string) => env[key] } as unknown as ConfigService,
    mailer as unknown as ResendMailerService,
  );
  const delivery = {
    id: 'd1',
    companyId: 'c1',
    orderId: 'o1',
    eventId: 'evt_1',
    eventType: 'order.paid',
    payload: { id: 'evt_1' },
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: now,
    retryUntil: new Date(now.getTime() + RETRY_WINDOW_MS),
  };
  const created = () =>
    (prisma.checkoutWebhookDelivery.create.mock.calls as [CreateArg][])[0]?.[0];
  const updated = () =>
    (prisma.checkoutWebhookDelivery.update.mock.calls as [UpdateArg][])[0]?.[0];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      webhookUrl: 'https://api.porquim.test/hook',
      webhookSecretEncrypted: 'enc:whsec_x',
      webhookDisabledAt: null,
      webhookFailingSince: null,
      version: 3,
    });
    prisma.checkoutOrder.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'PAID',
      paidAt: new Date('2026-11-06T12:00:00Z'),
      totalCents: 8190,
      subtotalCents: 8190,
      discountCents: 0,
      surchargeCents: 0,
      couponCode: null,
      utm: { utm_source: 'LINK_PADRAO' },
      buyerName: 'Maria',
      buyerEmail: 'maria@exemplo.test',
      buyerDocument: '52998224725',
      buyerPhone: '11999999999',
      items: [
        {
          kind: 'MAIN',
          productId: 'p1',
          name: 'Porquim Anual',
          unitPriceCents: 6700,
          discountCents: 0,
          accessPeriodMonths: 12,
        },
        {
          kind: 'BUMP',
          productId: 'p2',
          name: 'Guia',
          unitPriceCents: 1490,
          discountCents: 0,
          accessPeriodMonths: null,
        },
      ],
    });
    prisma.checkoutSettings.updateMany.mockResolvedValue({ count: 0 });
    prisma.checkoutWebhookDelivery.update.mockImplementation(
      ({ data }: UpdateArg) => ({ ...delivery, ...data }),
    );
  });

  it('um aviso por venda, com principal e bump marcados e o fim do acesso', async () => {
    await service.emit(
      prisma as unknown as PrismaService,
      'c1',
      'order.paid',
      'o1',
      {},
      now,
    );

    const arg = created();
    expect(arg?.data.status).toBe('PENDING');
    expect(arg?.data.payload.id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(arg?.data.payload.data.order?.items).toEqual([
      expect.objectContaining({
        kind: 'MAIN',
        accessExpiresAt: '2027-11-06T12:00:00.000Z',
      }),
      expect.objectContaining({ kind: 'BUMP', accessExpiresAt: null }),
    ]);
    expect(arg?.data.retryUntil).toEqual(
      new Date(now.getTime() + RETRY_WINDOW_MS),
    );
  });

  it('sem URL não registra nada; desligado registra como pulado', async () => {
    prisma.checkoutSettings.findUnique.mockResolvedValueOnce({
      webhookUrl: null,
    });
    await expect(
      service.emit(
        prisma as unknown as PrismaService,
        'c1',
        'order.paid',
        'o1',
      ),
    ).resolves.toBeNull();
    expect(prisma.checkoutWebhookDelivery.create).not.toHaveBeenCalled();

    prisma.checkoutSettings.findUnique.mockResolvedValueOnce({
      webhookUrl: 'https://x.test',
      webhookDisabledAt: now,
    });
    await service.emit(
      prisma as unknown as PrismaService,
      'c1',
      'order.paid',
      'o1',
    );
    expect(created()?.data.status).toBe('SKIPPED');
  });

  it('entrega com sucesso limpa a contagem de falhas', async () => {
    sender.send.mockResolvedValue({ ok: true, statusCode: 200 });
    await service.attempt(delivery as never, now);

    expect(sender.send).toHaveBeenCalledWith(
      { url: 'https://api.porquim.test/hook', secret: 'whsec_x' },
      { id: 'evt_1', type: 'order.paid' },
      JSON.stringify({ id: 'evt_1' }),
      now,
    );
    expect(updated()?.data.status).toBe('DELIVERED');
    expect(prisma.checkoutSettings.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', webhookFailingSince: { not: null } },
      data: { webhookFailingSince: null },
    });
  });

  it('falha agenda a próxima tentativa e, depois da janela, desiste', async () => {
    sender.send.mockResolvedValue({
      ok: false,
      statusCode: 500,
      error: 'HTTP_STATUS',
    });
    await service.attempt(delivery as never, now);
    expect(updated()?.data).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + 60_000),
    });

    jest.clearAllMocks();
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      webhookUrl: 'https://x.test',
      webhookSecretEncrypted: 'enc:s',
    });
    prisma.checkoutSettings.updateMany.mockResolvedValue({ count: 0 });
    prisma.checkoutWebhookDelivery.update.mockImplementation(
      ({ data }: UpdateArg) => ({ ...delivery, ...data }),
    );
    sender.send.mockResolvedValue({
      ok: false,
      statusCode: null,
      error: 'TIMEOUT',
    });
    await service.attempt(
      {
        ...delivery,
        attempts: 8,
        retryUntil: new Date(now.getTime() + 1000),
      } as never,
      now,
    );
    expect(updated()?.data).toMatchObject({
      status: 'FAILED',
      nextAttemptAt: null,
    });
  });

  it('3 dias seguidos falhando desliga, pula os pendentes e avisa o vendedor', async () => {
    sender.send.mockResolvedValue({
      ok: false,
      statusCode: 503,
      error: 'HTTP_STATUS',
    });
    prisma.checkoutSettings.updateMany
      .mockResolvedValueOnce({ count: 0 }) // failing since already set
      .mockResolvedValueOnce({ count: 1 }); // disabled now
    prisma.company.findUnique.mockResolvedValue({
      email: 'contato@porquim.test',
    });

    await service.attempt(delivery as never, now);

    expect(prisma.checkoutSettings.updateMany).toHaveBeenLastCalledWith({
      where: {
        companyId: 'c1',
        webhookDisabledAt: null,
        webhookFailingSince: {
          lte: new Date(now.getTime() - DISABLE_AFTER_MS),
        },
      },
      data: { webhookDisabledAt: now },
    });
    expect(prisma.checkoutWebhookDelivery.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', status: 'PENDING' },
      data: { status: 'SKIPPED', nextAttemptAt: null },
    });
    expect(mailer.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['contato@porquim.test'] }),
    );
  });

  it('a primeira URL gera o segredo, mostrado só nessa resposta', async () => {
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      webhookUrl: null,
      webhookSecretEncrypted: null,
      version: 3,
    });

    const result = await service.setUrl('c1', 'https://api.porquim.test/hook');

    expect(result.secret).toMatch(/^whsec_/);
    expect(prisma.checkoutSettings.update).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      data: {
        webhookUrl: 'https://api.porquim.test/hook',
        webhookSecretEncrypted: `enc:${result.secret}`,
        webhookFailingSince: null,
      },
    });
  });

  it('URL insegura é recusada e nada é gravado', async () => {
    await expect(
      service.setUrl('c1', 'http://inseguro.test'),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_WEBHOOK_URL' } });
    expect(prisma.checkoutSettings.update).not.toHaveBeenCalled();
  });

  it('reenviar com o webhook desligado é recusado', async () => {
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      webhookUrl: 'https://x.test',
      webhookDisabledAt: now,
    });
    await expect(service.resend('c1', 'd1', now)).rejects.toMatchObject({
      response: { code: 'CHECKOUT_WEBHOOK_DISABLED' },
    });
  });
});
