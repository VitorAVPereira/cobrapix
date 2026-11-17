import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutPlatformService } from './checkout-platform.service';
import type { CheckoutWebhooksService } from './checkout-webhooks.service';
import type { EfiCheckoutSubscriptionClient } from './efi-checkout-subscription.client';
import { CheckoutSubscriptionsService } from './checkout-subscriptions.service';
import { subscriptionTokenHash, subscriptionTokenOf } from './checkout-rules';

const now = new Date('2026-12-01T12:00:00Z');
const periodEnd = new Date('2027-03-01T12:00:00Z');

describe('CheckoutSubscriptionsService', () => {
  const tx = {
    checkoutSubscription: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutOrder: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    checkoutSubscription: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const platform = { accountOf: jest.fn() };
  const client = { cancel: jest.fn() };
  const webhooks = { emit: jest.fn() };
  const service = new CheckoutSubscriptionsService(
    prisma as unknown as PrismaService,
    platform as unknown as CheckoutPlatformService,
    client as unknown as EfiCheckoutSubscriptionClient,
    webhooks as unknown as CheckoutWebhooksService,
  );
  const account = { identity: { id: 'identity-1' } };
  const active = (change: object = {}) => ({
    id: 'sub-1',
    companyId: 'company-a',
    status: 'ACTIVE',
    planId: 'plan-3m',
    intervalMonths: 3,
    cycleCents: 2990,
    issuerIdentityId: 'identity-1',
    efiSubscriptionId: '5001',
    currentPeriodEnd: periodEnd,
    cancelRequestedAt: null,
    canceledAt: null,
    cancelReason: null,
    accessEndsAt: null,
    // What the buyer's page reads.
    product: { name: 'Porquim' },
    plan: { name: 'Trimestral' },
    company: { checkoutSettings: { displayName: 'Porquim' } },
    orders: [{ totalCents: 2990 }],
    ...change,
  });
  const emitted = () =>
    (webhooks.emit.mock.calls as unknown[][]).map((call) => call[2]);

  beforeEach(() => {
    jest.clearAllMocks();
    client.cancel.mockReset().mockResolvedValue(undefined);
    platform.accountOf.mockResolvedValue(account);
    prisma.checkoutSubscription.findFirst.mockResolvedValue(active());
    prisma.checkoutSubscription.findUnique.mockResolvedValue(active());
    tx.checkoutSubscription.updateMany.mockResolvedValue({ count: 1 });
    tx.checkoutSubscription.findUnique.mockResolvedValue(
      active({
        status: 'CANCELED',
        cancelRequestedAt: now,
        canceledAt: now,
        cancelReason: 'BUYER',
        accessEndsAt: periodEnd,
      }),
    );
    tx.checkoutOrder.findFirst.mockResolvedValue({ id: 'order-1' });
  });

  it('o primeiro pagamento ativa a assinatura, uma vez, e avisa o vendedor', async () => {
    tx.checkoutSubscription.findUnique.mockResolvedValue(
      active({ status: 'ACTIVE', currentPeriodEnd: periodEnd }),
    );
    await service.activate(
      tx as never,
      { id: 'order-1', companyId: 'company-a', subscriptionId: 'sub-1' },
      now,
    );

    expect(tx.checkoutSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: 'PENDING' },
      data: { status: 'ACTIVE', currentPeriodEnd: periodEnd },
    });
    expect(webhooks.emit).toHaveBeenCalledWith(
      tx,
      'company-a',
      'subscription.activated',
      'order-1',
      {
        subscription: expect.objectContaining({
          id: 'sub-1',
          status: 'ACTIVE',
          currentPeriodEnd: periodEnd.toISOString(),
        }) as unknown,
      },
      now,
    );

    // A repeated confirmation finds it active: nothing more.
    jest.clearAllMocks();
    tx.checkoutSubscription.updateMany.mockResolvedValue({ count: 0 });
    await service.activate(
      tx as never,
      { id: 'order-1', companyId: 'company-a', subscriptionId: 'sub-1' },
      now,
    );
    expect(webhooks.emit).not.toHaveBeenCalled();
  });

  it('comprador cancela pelo token: para na Efí primeiro, o acesso vai até o fim do período e o vendedor é avisado da data', async () => {
    const calls: string[] = [];
    client.cancel.mockImplementation(() => {
      calls.push('efi');
      return undefined;
    });
    tx.checkoutSubscription.updateMany.mockImplementation(() => {
      calls.push('db');
      return { count: 1 };
    });
    const token = subscriptionTokenOf('order-public-token');

    await service.cancelByToken(token, now);

    expect(prisma.checkoutSubscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: subscriptionTokenHash(token) },
      }),
    );
    expect(calls).toEqual(['efi', 'db']);
    expect(client.cancel).toHaveBeenCalledWith(account, '5001');
    expect(tx.checkoutSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: { in: ['ACTIVE', 'PAST_DUE'] } },
      data: {
        status: 'CANCELED',
        cancelRequestedAt: now,
        canceledAt: now,
        cancelReason: 'BUYER',
        accessEndsAt: periodEnd,
        efiCanceledAt: now,
      },
    });
    // The access is still valid: only the notice with the date goes now.
    expect(emitted()).toEqual(['subscription.renewal_disabled']);
  });

  it('a Efí não confirmou o cancelamento: nada muda aqui e o erro pede nova tentativa', async () => {
    client.cancel.mockRejectedValue(new Error('efi down'));
    await expect(
      service.cancel('company-a', 'sub-1', 'SELLER', 'user-1', now),
    ).rejects.toMatchObject({ response: { code: 'EFI_UNAVAILABLE' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(webhooks.emit).not.toHaveBeenCalled();
  });

  it('cancelar de novo não avisa de novo; assinatura de outra empresa responde 404', async () => {
    tx.checkoutSubscription.updateMany.mockResolvedValue({ count: 0 });
    await service.cancel('company-a', 'sub-1', 'SELLER', 'user-1', now);
    expect(webhooks.emit).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();

    prisma.checkoutSubscription.findFirst.mockResolvedValue(null);
    await expect(
      service.cancel('company-b', 'sub-1', 'SELLER', 'user-2', now),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.checkoutSubscription.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1', companyId: 'company-b' },
      }),
    );
  });

  it('vendedor ou admin cancelando fica na auditoria', async () => {
    await service.cancel('company-a', 'sub-1', 'ADMIN', 'admin-1', now);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        userId: 'admin-1',
        action: 'CHECKOUT_SUBSCRIPTION_CANCELED',
        entityId: 'sub-1',
      }) as unknown,
    });
  });

  it('fim do acesso: subscription.canceled sai uma única vez, no dia', async () => {
    prisma.checkoutSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', companyId: 'company-a' },
    ]);
    await service.notifyEnded(now);
    expect(prisma.checkoutSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'CANCELED',
          accessEndsAt: { lte: now },
          accessEndedNotifiedAt: null,
        },
      }),
    );
    expect(tx.checkoutSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', accessEndedNotifiedAt: null },
      data: { accessEndedNotifiedAt: now },
    });
    expect(emitted()).toEqual(['subscription.canceled']);

    // Another instance got there first: no second notice.
    jest.clearAllMocks();
    tx.checkoutSubscription.updateMany.mockResolvedValue({ count: 0 });
    await service.notifyEnded(now);
    expect(webhooks.emit).not.toHaveBeenCalled();
  });

  it('fim na hora (reembolso ou chargeback): cancela na Efí depois e avisa o fim do acesso de uma vez', async () => {
    tx.checkoutSubscription.findUnique.mockResolvedValue(
      active({
        status: 'CANCELED',
        canceledAt: now,
        cancelReason: 'CHARGEBACK',
        accessEndsAt: now,
      }),
    );
    await service.endNow(
      tx as never,
      { id: 'order-1', companyId: 'company-a', subscriptionId: 'sub-1' },
      'CHARGEBACK',
      now,
    );
    expect(tx.checkoutSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: { in: ['ACTIVE', 'PAST_DUE'] } },
      data: {
        status: 'CANCELED',
        cancelRequestedAt: now,
        canceledAt: now,
        cancelReason: 'CHARGEBACK',
        accessEndsAt: now,
        accessEndedNotifiedAt: now,
      },
    });
    expect(emitted()).toEqual(['subscription.canceled']);
    // The Efí is called outside the money transaction, by the worker.
    expect(client.cancel).not.toHaveBeenCalled();
  });

  it('worker: assinatura que nunca foi paga ou que acabou aqui é cancelada na Efí, e repete se falhar', async () => {
    prisma.checkoutSubscription.findMany.mockResolvedValue([
      active({ id: 'sub-9', status: 'PENDING', efiSubscriptionId: '7001' }),
      active({ id: 'sub-8', status: 'CANCELED', efiSubscriptionId: '7002' }),
    ]);
    client.cancel
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('efi down'));

    await service.stopAtEfi(now);

    expect(client.cancel).toHaveBeenCalledWith(account, '7001');
    expect(client.cancel).toHaveBeenCalledWith(account, '7002');
    // Only the one the Efí confirmed is marked as stopped.
    expect(prisma.checkoutSubscription.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.checkoutSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-9' },
      data: expect.objectContaining({
        efiCanceledAt: now,
        status: 'CANCELED',
        cancelReason: 'PAYMENT_FAILED',
      }) as unknown,
    });
  });
});
