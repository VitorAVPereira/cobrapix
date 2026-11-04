import { PrismaService } from '../prisma/prisma.service';
import {
  ANONYMIZE_AFTER_MS,
  CheckoutRecoveryService,
  LEAD_ABANDON_MS,
} from './checkout-recovery.service';
import type { CheckoutWebhooksService } from './checkout-webhooks.service';

const now = new Date('2026-11-07T12:00:00Z');

interface UpsertArg {
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}
interface AuditArg {
  data: { action: string; changes: Record<string, unknown> };
}

describe('CheckoutRecoveryService', () => {
  const prisma = {
    checkoutProduct: { findFirst: jest.fn() },
    checkoutLead: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    checkoutOrder: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    checkoutWebhookDelivery: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const webhooks = { emit: jest.fn() };
  const service = new CheckoutRecoveryService(
    prisma as unknown as PrismaService,
    webhooks as unknown as CheckoutWebhooksService,
  );
  const upserted = () =>
    (prisma.checkoutLead.upsert.mock.calls as [UpsertArg][])[0]?.[0];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutProduct.findFirst.mockResolvedValue({
      id: 'p1',
      companyId: 'c1',
    });
    prisma.checkoutOrder.count.mockResolvedValue(0);
    prisma.checkoutLead.count.mockResolvedValue(0);
    prisma.checkoutOrder.findMany.mockResolvedValue([]);
    prisma.checkoutLead.findMany.mockResolvedValue([]);
  });

  it('lead só é gravado com e-mail ou celular válidos, e só o que foi digitado certo', async () => {
    await expect(
      service.captureLead('porquim', {
        sessionKey: 's1',
        name: 'Maria',
        email: 'invalido',
        phone: '123',
      }),
    ).resolves.toEqual({ saved: false });
    expect(prisma.checkoutLead.upsert).not.toHaveBeenCalled();

    await service.captureLead(
      'porquim',
      {
        sessionKey: 's1',
        name: ' Maria ',
        email: 'Maria@Exemplo.test',
        phone: '(11) 99999-9999',
        document: '111.111.111-11',
      },
      now,
    );
    const arg = upserted();
    expect(arg?.create).toMatchObject({
      companyId: 'c1',
      productId: 'p1',
      name: 'Maria',
      email: 'maria@exemplo.test',
      phone: '11999999999',
      lastSeenAt: now,
    });
    // An invalid CPF is not kept, and does not erase one typed before.
    expect(arg?.create).not.toHaveProperty('document');
    expect(arg?.update).not.toHaveProperty('document');
  });

  it('produto de outra empresa, inativo ou de cobrança responde 404', async () => {
    prisma.checkoutProduct.findFirst.mockResolvedValue(null);
    await expect(
      service.captureLead('outro', { sessionKey: 's1', email: 'a@b.test' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('abandono: um aviso por lead, só depois de 30 minutos sem pedido', async () => {
    prisma.checkoutLead.findMany.mockResolvedValue([
      {
        id: 'l1',
        companyId: 'c1',
        productId: 'p1',
        product: { name: 'Porquim Anual' },
        name: 'Maria',
        email: 'maria@exemplo.test',
        phone: '11999999999',
        document: null,
        utm: null,
        lastSeenAt: new Date(now.getTime() - LEAD_ABANDON_MS - 1000),
      },
      { id: 'l2', companyId: 'c1' },
    ]);
    prisma.checkoutLead.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }); // another instance got it first

    await service.notifyAbandoned(now);

    const findArg = (
      prisma.checkoutLead.findMany.mock.calls as [
        { where: { lastSeenAt: { lt: Date } } },
      ][]
    )[0]?.[0];
    expect(findArg?.where.lastSeenAt.lt).toEqual(
      new Date(now.getTime() - LEAD_ABANDON_MS),
    );
    expect(webhooks.emit).toHaveBeenCalledTimes(1);
    expect(webhooks.emit).toHaveBeenCalledWith(
      prisma,
      'c1',
      'lead.abandoned',
      null,
      {
        lead: expect.objectContaining({
          id: 'l1',
          productName: 'Porquim Anual',
        }) as unknown,
      },
      now,
    );
  });

  it('lista junta Pix não pago e leads, mais recentes primeiro, só da empresa', async () => {
    prisma.checkoutOrder.count.mockResolvedValue(1);
    prisma.checkoutLead.count.mockResolvedValue(1);
    prisma.checkoutOrder.findMany.mockResolvedValue([
      {
        id: 'o1',
        status: 'EXPIRED',
        paymentMethod: 'PIX',
        productId: 'p1',
        product: { name: 'Porquim' },
        buyerName: 'Ana',
        buyerEmail: 'ana@x.test',
        buyerPhone: '11988887777',
        buyerDocument: '52998224725',
        totalCents: 6700,
        createdAt: new Date('2026-11-05T10:00:00Z'),
        recoveredByOrderId: null,
      },
    ]);
    prisma.checkoutLead.findMany.mockResolvedValue([
      {
        id: 'l1',
        productId: 'p1',
        product: { name: 'Porquim' },
        name: 'Bia',
        email: 'bia@x.test',
        phone: null,
        document: null,
        createdAt: new Date('2026-11-06T10:00:00Z'),
        recoveredByOrderId: null,
      },
    ]);

    const result = await service.list(
      'c1',
      { state: 'OPEN', page: 1, pageSize: 20 },
      now,
    );

    expect(result.total).toBe(2);
    expect(result.items.map((item) => [item.kind, item.reason])).toEqual([
      ['LEAD', 'Saiu antes de gerar o Pix'],
      ['PIX', 'Pix não pago'],
    ]);
    const orderWhere = (
      prisma.checkoutOrder.findMany.mock.calls as [
        { where: Record<string, unknown> },
      ][]
    )[0]?.[0].where;
    expect(orderWhere).toMatchObject({
      companyId: 'c1',
      status: { in: ['EXPIRED', 'FAILED', 'DECLINED'] },
      recoveredByOrderId: null,
      anonymizedAt: null,
    });
  });

  it('CSV neutraliza fórmulas e a auditoria guarda filtros e quantidade, sem dados pessoais', async () => {
    prisma.checkoutOrder.count.mockResolvedValue(1);
    prisma.checkoutOrder.findMany.mockResolvedValue([
      {
        id: 'o1',
        status: 'EXPIRED',
        paymentMethod: 'PIX',
        productId: 'p1',
        product: { name: 'Porquim' },
        buyerName: '=HYPERLINK("http://mal.test")',
        buyerEmail: 'ana@x.test',
        buyerPhone: '11988887777',
        buyerDocument: '52998224725',
        totalCents: 6700,
        createdAt: new Date('2026-11-05T10:00:00Z'),
        recoveredByOrderId: null,
      },
    ]);

    const csv = await service.csv(
      'c1',
      'u1',
      { kind: 'PIX', state: 'OPEN' },
      now,
    );

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"'=HYPERLINK(""http://mal.test"")"`);
    expect(csv).toContain('67.00');
    const audit = (prisma.auditLog.create.mock.calls as [AuditArg][])[0]?.[0];
    expect(audit?.data.action).toBe('CHECKOUT_RECOVERY_EXPORTED');
    expect(audit?.data.changes).toMatchObject({ rows: 1, kind: 'PIX' });
    expect(JSON.stringify(audit)).not.toContain('ana@x.test');
  });

  it('anonimização: só pedidos não pagos e leads com mais de 12 meses', async () => {
    prisma.checkoutOrder.findMany
      .mockResolvedValueOnce([{ id: 'o-old' }])
      .mockResolvedValueOnce([]);
    prisma.checkoutLead.findMany
      .mockResolvedValueOnce([{ id: 'l-old' }])
      .mockResolvedValueOnce([]);

    await service.anonymize(now);

    const cutoff = new Date(now.getTime() - ANONYMIZE_AFTER_MS);
    expect(prisma.checkoutOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['EXPIRED', 'FAILED', 'DECLINED'] },
          anonymizedAt: null,
          createdAt: { lt: cutoff },
        },
      }),
    );
    expect(prisma.checkoutOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['o-old'] }, anonymizedAt: null },
        data: expect.objectContaining({
          buyerEmail: '',
          buyerDocument: '',
          anonymizedAt: now,
        }) as unknown,
      }),
    );
    expect(prisma.checkoutWebhookDelivery.updateMany).toHaveBeenCalledWith({
      where: { orderId: { in: ['o-old'] } },
      data: { payload: { anonymized: true } },
    });
    expect(prisma.checkoutLead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { anonymizedAt: null, createdAt: { lt: cutoff } },
      }),
    );
    expect(prisma.checkoutLead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['l-old'] }, anonymizedAt: null },
      }),
    );
    // The lead notice is found by the lead id in its body.
    expect(prisma.checkoutWebhookDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        eventType: 'lead.abandoned',
        OR: [{ payload: { path: ['data', 'lead', 'id'], equals: 'l-old' } }],
      },
      data: { payload: { anonymized: true } },
    });
  });
});
