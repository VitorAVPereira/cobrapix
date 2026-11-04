import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import type { CheckoutWebhookSender } from './checkout-webhook.sender';
import {
  CheckoutWebhooksService,
  DISABLE_AFTER_MS,
  MAX_WEBHOOK_RULES,
  RETRY_WINDOW_MS,
} from './checkout-webhooks.service';

const now = new Date('2026-11-06T12:00:00Z');

interface DeliveryRow {
  ruleId: string;
  eventId: string;
  status: string;
  eventType: string;
  payload: {
    id: string;
    type: string;
    data: {
      order?: {
        items: Array<{ kind: string; accessExpiresAt: string | null }>;
      };
    };
  };
  retryUntil: Date;
}
interface CreateManyArg {
  data: DeliveryRow[];
}
interface UpdateArg {
  data: { status: string; nextAttemptAt: Date | null; attempts: number };
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    companyId: 'c1',
    name: 'Área de membros',
    url: 'https://api.porquim.test/hook',
    events: [] as string[],
    productIds: [] as string[],
    secretEncrypted: 'enc:whsec_x',
    failingSince: null,
    disabledAt: null,
    deletedAt: null,
    version: 2,
    createdAt: now,
    ...overrides,
  };
}

describe('CheckoutWebhooksService', () => {
  const prisma = {
    checkoutOrder: { findUnique: jest.fn() },
    checkoutProduct: { count: jest.fn() },
    checkoutWebhookRule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutWebhookDelivery: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
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
  const client = prisma as unknown as PrismaService;
  const delivery = {
    id: 'd1',
    companyId: 'c1',
    ruleId: 'r1',
    orderId: 'o1',
    eventId: 'evt_1',
    eventType: 'order.paid',
    payload: { id: 'evt_1' },
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: now,
    retryUntil: new Date(now.getTime() + RETRY_WINDOW_MS),
  };
  const rows = () =>
    (
      prisma.checkoutWebhookDelivery.createMany.mock.calls as [CreateManyArg][]
    )[0]?.[0].data ?? [];
  const updated = () =>
    (prisma.checkoutWebhookDelivery.update.mock.calls as [UpdateArg][])[0]?.[0];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutWebhookRule.findMany.mockResolvedValue([rule()]);
    prisma.checkoutWebhookRule.findUnique.mockResolvedValue(rule());
    prisma.checkoutWebhookRule.findFirst.mockResolvedValue(rule());
    prisma.checkoutWebhookRule.updateMany.mockResolvedValue({ count: 0 });
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
      parentOrderId: null,
      offer: null,
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
    prisma.checkoutWebhookDelivery.update.mockImplementation(
      ({ data }: UpdateArg) => ({ ...delivery, ...data }),
    );
  });

  it('um aviso por venda, com principal e bump marcados e o fim do acesso', async () => {
    await service.emit(client, 'c1', 'order.paid', 'o1', {}, now);

    const [row] = rows();
    expect(row?.status).toBe('PENDING');
    expect(row?.ruleId).toBe('r1');
    expect(row?.payload.id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(row?.payload.data.order?.items).toEqual([
      expect.objectContaining({
        kind: 'MAIN',
        accessExpiresAt: '2027-11-06T12:00:00.000Z',
      }),
      expect.objectContaining({ kind: 'BUMP', accessExpiresAt: null }),
    ]);
    expect(row?.retryUntil).toEqual(new Date(now.getTime() + RETRY_WINDOW_MS));
  });

  it('cada regra que quer o evento recebe uma entrega, com o mesmo id de evento', async () => {
    prisma.checkoutWebhookRule.findMany.mockResolvedValue([
      rule({ id: 'all' }),
      rule({ id: 'paid-only', events: ['order.paid'] }),
      rule({ id: 'refunds', events: ['order.refunded'] }),
      // The bump p2 is in the order: its rule receives the whole order.
      rule({ id: 'bump-product', productIds: ['p2'] }),
      rule({ id: 'other-product', productIds: ['p9'] }),
      rule({ id: 'off', disabledAt: now }),
    ]);

    const eventId = await service.emit(
      client,
      'c1',
      'order.paid',
      'o1',
      {},
      now,
    );

    expect(rows().map((row) => [row.ruleId, row.status])).toEqual([
      ['all', 'PENDING'],
      ['paid-only', 'PENDING'],
      ['bump-product', 'PENDING'],
      ['off', 'SKIPPED'],
    ]);
    expect(new Set(rows().map((row) => row.eventId))).toEqual(
      new Set([eventId]),
    );
  });

  it('lead usa o produto do lead; regra de produto não recebe evento sem produto', async () => {
    prisma.checkoutWebhookRule.findMany.mockResolvedValue([
      rule({ id: 'p1-rule', productIds: ['p1'] }),
      rule({ id: 'p2-rule', productIds: ['p2'] }),
    ]);
    await service.emit(client, 'c1', 'lead.abandoned', null, {
      lead: { id: 'l1', productId: 'p1' },
    });
    expect(rows().map((row) => row.ruleId)).toEqual(['p1-rule']);

    jest.clearAllMocks();
    prisma.checkoutWebhookRule.findMany.mockResolvedValue([
      rule({ id: 'p1-rule', productIds: ['p1'] }),
    ]);
    await expect(
      service.emit(client, 'c1', 'refund.withdrawn', null, {}),
    ).resolves.toBeNull();
    expect(prisma.checkoutWebhookDelivery.createMany).not.toHaveBeenCalled();
  });

  it('sem regras não registra nada', async () => {
    prisma.checkoutWebhookRule.findMany.mockResolvedValue([]);
    await expect(
      service.emit(client, 'c1', 'order.paid', 'o1'),
    ).resolves.toBeNull();
    expect(prisma.checkoutWebhookDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.checkoutOrder.findUnique).not.toHaveBeenCalled();
  });

  it('entrega com sucesso usa a URL e o segredo da regra e limpa as falhas dela', async () => {
    sender.send.mockResolvedValue({ ok: true, statusCode: 200 });
    await service.attempt(delivery as never, now);

    expect(sender.send).toHaveBeenCalledWith(
      { url: 'https://api.porquim.test/hook', secret: 'whsec_x' },
      { id: 'evt_1', type: 'order.paid' },
      JSON.stringify({ id: 'evt_1' }),
      now,
    );
    expect(updated()?.data.status).toBe('DELIVERED');
    expect(prisma.checkoutWebhookRule.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', failingSince: { not: null } },
      data: { failingSince: null },
    });
  });

  it('aviso antigo, sem regra, vai para a primeira regra da empresa', async () => {
    sender.send.mockResolvedValue({ ok: true, statusCode: 200 });
    await service.attempt({ ...delivery, ruleId: null } as never, now);

    expect(prisma.checkoutWebhookRule.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'c1', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(updated()?.data).toMatchObject({
      ruleId: 'r1',
      status: 'DELIVERED',
    });
  });

  it('regra excluída ou desligada pula o aviso sem enviar', async () => {
    prisma.checkoutWebhookRule.findUnique.mockResolvedValue(
      rule({ deletedAt: now }),
    );
    await service.attempt(delivery as never, now);
    expect(sender.send).not.toHaveBeenCalled();
    expect(updated()?.data.status).toBe('SKIPPED');
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

    prisma.checkoutWebhookDelivery.update.mockClear();
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

  it('3 dias seguidos falhando desligam só a regra, pulam os pendentes dela e avisam o vendedor', async () => {
    sender.send.mockResolvedValue({
      ok: false,
      statusCode: 503,
      error: 'HTTP_STATUS',
    });
    prisma.checkoutWebhookRule.updateMany
      .mockResolvedValueOnce({ count: 0 }) // failing since already set
      .mockResolvedValueOnce({ count: 1 }); // disabled now
    prisma.company.findUnique.mockResolvedValue({
      email: 'contato@porquim.test',
    });

    await service.attempt(delivery as never, now);

    expect(prisma.checkoutWebhookRule.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'r1',
        disabledAt: null,
        failingSince: { lte: new Date(now.getTime() - DISABLE_AFTER_MS) },
      },
      data: { disabledAt: now },
    });
    expect(prisma.checkoutWebhookDelivery.updateMany).toHaveBeenCalledWith({
      where: { ruleId: 'r1', status: 'PENDING' },
      data: { status: 'SKIPPED', nextAttemptAt: null },
    });
    const [mail] = mailer.sendEmail.mock.calls[0] as [
      { to: string[]; html: string },
    ];
    expect(mail.to).toEqual(['contato@porquim.test']);
    expect(mail.html).toContain('Área de membros');
  });

  it('nova regra ganha o segredo, mostrado só nessa resposta', async () => {
    prisma.checkoutWebhookRule.count.mockResolvedValue(0);
    prisma.checkoutProduct.count.mockResolvedValue(1);
    prisma.checkoutWebhookRule.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => rule(data),
    );

    const result = await service.create('c1', {
      name: ' Área de membros ',
      url: 'https://api.porquim.test/hook',
      events: ['order.paid', 'order.paid'],
      productIds: ['p1'],
    });

    expect(result.secret).toMatch(/^whsec_/);
    expect(prisma.checkoutWebhookRule.create).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        name: 'Área de membros',
        url: 'https://api.porquim.test/hook',
        events: ['order.paid'],
        productIds: ['p1'],
        secretEncrypted: `enc:${result.secret}`,
      },
    });
    expect(result).not.toHaveProperty('secretEncrypted');
  });

  it('URL insegura, produto de outra empresa e a 11ª regra são recusados', async () => {
    await expect(
      service.create('c1', { name: 'X', url: 'http://inseguro.test' }),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_WEBHOOK_URL' } });

    prisma.checkoutProduct.count.mockResolvedValue(0);
    await expect(
      service.create('c1', {
        name: 'X',
        url: 'https://x.test',
        productIds: ['p-de-outra-empresa'],
      }),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_WEBHOOK_PRODUCT' } });
    expect(prisma.checkoutProduct.count).toHaveBeenCalledWith({
      where: { companyId: 'c1', id: { in: ['p-de-outra-empresa'] } },
    });

    prisma.checkoutWebhookRule.count.mockResolvedValue(MAX_WEBHOOK_RULES);
    await expect(
      service.create('c1', { name: 'X', url: 'https://x.test' }),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_WEBHOOK_RULE_LIMIT' },
    });
    expect(prisma.checkoutWebhookRule.create).not.toHaveBeenCalled();
  });

  it('editar com versão antiga responde VERSION_CHANGED; de outra empresa, 404', async () => {
    prisma.checkoutWebhookRule.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.update('c1', 'r1', {
        name: 'X',
        url: 'https://x.test',
        version: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });

    prisma.checkoutWebhookRule.findFirst.mockResolvedValue(null);
    await expect(
      service.update('c2', 'r1', {
        name: 'X',
        url: 'https://x.test',
        version: 2,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('excluir pula a fila da regra e mantém o histórico', async () => {
    prisma.checkoutWebhookRule.updateMany.mockResolvedValue({ count: 1 });
    await service.remove('c1', 'r1', now);
    expect(prisma.checkoutWebhookRule.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', companyId: 'c1', deletedAt: null },
      data: { deletedAt: now },
    });
    expect(prisma.checkoutWebhookDelivery.updateMany).toHaveBeenCalledWith({
      where: { ruleId: 'r1', status: 'PENDING' },
      data: { status: 'SKIPPED', nextAttemptAt: null },
    });
  });

  it('reenviar com a regra desligada é recusado', async () => {
    prisma.checkoutWebhookDelivery.findFirst.mockResolvedValue({
      rule: { disabledAt: now, deletedAt: null },
    });
    await expect(service.resend('c1', 'd1', now)).rejects.toMatchObject({
      response: { code: 'CHECKOUT_WEBHOOK_DISABLED' },
    });
    expect(prisma.checkoutWebhookDelivery.updateMany).not.toHaveBeenCalled();
  });
});
