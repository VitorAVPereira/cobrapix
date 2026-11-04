import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutCatalogService } from './checkout-catalog.service';
import type { CheckoutPlatformService } from './checkout-platform.service';
import type { CheckoutPaymentsService } from './checkout-payments.service';
import type { EfiCheckoutPixClient } from './efi-checkout-pix.client';
import { CheckoutOrdersService, checkoutTxid } from './checkout-orders.service';

const KEY = '0b4f7c2e-8a6d-4f1b-9c3e-2d5a7b8c9e01';
const now = new Date('2026-11-04T15:00:00Z');

const items = [
  {
    kind: 'MAIN',
    productId: 'main',
    bumpId: null,
    name: 'Porquim Anual',
    unitPriceCents: 6700,
    discountCents: 0,
    deliveryMode: 'ACCESS_LINK',
    accessUrl: 'https://acesso.test/porquim',
    accessInstructions: null,
    accessPeriodMonths: 12,
  },
];

function order(change: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    companyId: 'company-a',
    publicToken: 'token',
    status: 'PENDING',
    items,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    subtotalCents: 6700,
    discountCents: 0,
    surchargeCents: 0,
    totalCents: 6700,
    product: { slug: 'porquim-anual-ab12' },
    attempt: {
      id: 'attempt-1',
      status: 'ACTIVE',
      efiTxid: 'ckt1',
      pixCopyPaste: '000201pix',
      pixQrCodeImage: 'data:image/png;base64,AA',
    },
    ...change,
  };
}

describe('checkoutTxid', () => {
  it('começa com ckt e tem 32 caracteres alfanuméricos', () => {
    expect(checkoutTxid()).toMatch(/^ckt[a-z0-9]{29}$/);
    expect(checkoutTxid()).not.toBe(checkoutTxid());
  });
});

describe('CheckoutOrdersService', () => {
  const tx = {
    checkoutOrder: { create: jest.fn() },
    checkoutPaymentAttempt: { create: jest.fn() },
  };
  const prisma = {
    checkoutOrder: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutPaymentAttempt: {
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    checkoutSettings: { findUnique: jest.fn() },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (client: typeof tx) => unknown)(tx)
        : arg,
    ),
  };
  const platformAccount = {
    settings: { id: 'settings-1', pixFeeBasisPoints: 119 },
    identity: { id: 'identity-1', pixKey: 'pix@ciframais.test' },
  };
  const catalog = {
    prepare: jest.fn(),
  };
  const platform = { ready: jest.fn() };
  const pix = { create: jest.fn(), status: jest.fn() };
  const payments = { confirm: jest.fn() };
  const service = new CheckoutOrdersService(
    prisma as unknown as PrismaService,
    catalog as unknown as CheckoutCatalogService,
    platform as unknown as CheckoutPlatformService,
    pix as unknown as EfiCheckoutPixClient,
    payments as unknown as CheckoutPaymentsService,
  );
  const dto = {
    bumpIds: [],
    method: 'PIX' as const,
    buyer: {
      name: 'Maria Souza',
      email: 'Maria@Exemplo.test',
      document: '529.982.247-25',
      phone: '11999999999',
    },
    utm: { utm_source: 'LINK_PADRAO' },
    idempotencyKey: KEY,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutOrder.findUnique
      .mockResolvedValueOnce(null) // idempotency lookup
      .mockResolvedValue(order());
    catalog.prepare.mockResolvedValue({
      companyId: 'company-a',
      productId: 'main',
      productName: 'Porquim Anual',
      settings: { displayName: 'Porquim' },
      terms: { id: 'terms-1' },
      platform: platformAccount,
      quote: {
        items,
        couponId: null,
        couponCode: null,
        discountCents: 0,
        subtotalCents: 6700,
        surchargeCents: 0,
        totalCents: 6700,
        efiFeeBasisPoints: 119,
        efiFeeCents: 80,
        platformFeeBasisPoints: 250,
        platformFeeCents: 168,
        feePayer: 'SELLER',
      },
    });
    tx.checkoutOrder.create.mockImplementation(
      ({ data }: { data: object }) => ({
        id: 'order-1',
        ...data,
      }),
    );
    pix.create.mockResolvedValue({
      outcome: 'CREATED',
      pixCopyPaste: '000201pix',
      qrCodeImage: 'data:image/png;base64,AA',
    });
    prisma.checkoutSettings.findUnique.mockResolvedValue({
      displayName: 'Porquim',
      primaryColor: '#0F766E',
      logoAssetId: null,
      supportEmail: null,
      supportWhatsapp: null,
    });
    platform.ready.mockResolvedValue(platformAccount);
  });

  it('cria o pedido com os valores fotografados e um único Pix', async () => {
    const view = await service.create('porquim-anual-ab12', dto, now);

    const data = (
      tx.checkoutOrder.create.mock.calls as [
        { data: Record<string, unknown> },
      ][]
    )[0]?.[0].data;
    expect(data).toMatchObject({
      buyerEmail: 'maria@exemplo.test',
      buyerDocument: '52998224725',
      totalCents: 6700,
      platformFeeCents: 168,
      termsId: 'terms-1',
      platformSettingsId: 'settings-1',
      utm: { utm_source: 'LINK_PADRAO' },
      expiresAt: new Date(now.getTime() + 30 * 60_000),
    });
    expect(pix.create).toHaveBeenCalledTimes(1);
    expect(pix.create).toHaveBeenCalledWith(
      platformAccount,
      expect.objectContaining({
        amountCents: 6700,
        description: 'Porquim Anual — Porquim via Cifra+',
      }),
    );
    expect(view.pix).toEqual({
      copyPaste: '000201pix',
      qrCodeImage: 'data:image/png;base64,AA',
    });
  });

  it('a mesma chave idempotente devolve o mesmo pedido sem novo Pix', async () => {
    prisma.checkoutOrder.findUnique.mockReset().mockResolvedValue(order());

    await service.create('porquim-anual-ab12', dto, now);

    expect(tx.checkoutOrder.create).not.toHaveBeenCalled();
    expect(pix.create).not.toHaveBeenCalled();
  });

  it('resposta perdida da Efí fica incerta, sem segundo Pix', async () => {
    pix.create.mockResolvedValue({ outcome: 'UNCERTAIN' });

    await service.create('porquim-anual-ab12', dto, now);

    expect(prisma.checkoutPaymentAttempt.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', status: 'CREATING' },
      data: { status: 'UNCERTAIN' },
    });
    expect(pix.create).toHaveBeenCalledTimes(1);
  });

  it('recusa da Efí falha o pedido', async () => {
    pix.create.mockResolvedValue({
      outcome: 'REJECTED',
      code: 'EFI_REJECTED_X',
    });
    prisma.checkoutPaymentAttempt.findUniqueOrThrow.mockResolvedValue({
      id: 'attempt-1',
    });

    await service.create('porquim-anual-ab12', dto, now);

    expect(prisma.checkoutOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });

  it('CPF inválido é recusado antes de qualquer gravação', async () => {
    await expect(
      service.create(
        'porquim-anual-ab12',
        { ...dto, buyer: { ...dto.buyer, document: '111.111.111-11' } },
        now,
      ),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_INVALID_BUYER' } });
    expect(tx.checkoutOrder.create).not.toHaveBeenCalled();
  });

  it('o link de acesso só aparece depois de pago', async () => {
    prisma.checkoutOrder.findUnique.mockReset().mockResolvedValue(order());
    const pending = await service.view('token', now);
    expect(pending.redirectUrl).toBeNull();
    expect(pending.items[0]?.accessUrl).toBeNull();

    prisma.checkoutOrder.findUnique.mockResolvedValue(
      order({ status: 'PAID' }),
    );
    const paid = await service.view('token', now);
    expect(paid.redirectUrl).toBe('https://acesso.test/porquim');
    expect(paid.pix).toBeNull();
  });

  it('pedido vencido aparece expirado mesmo antes do worker', async () => {
    prisma.checkoutOrder.findUnique
      .mockReset()
      .mockResolvedValue(order({ expiresAt: new Date(now.getTime() - 1000) }));
    const view = await service.view('token', now);
    expect(view.status).toBe('EXPIRED');
    expect(view.pix).toBeNull();
  });

  it('token inexistente responde 404', async () => {
    prisma.checkoutOrder.findUnique.mockReset().mockResolvedValue(null);
    await expect(service.view('nada', now)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('antes de expirar, um Pix pago na Efí é confirmado', async () => {
    prisma.checkoutOrder.findMany.mockResolvedValue([
      order({ expiresAt: new Date(now.getTime() - 20 * 60_000) }),
    ]);
    pix.status.mockResolvedValue({
      status: 'CONCLUIDA',
      paidAmountCents: 6700,
      endToEndId: 'E1',
    });

    await service.expireOverdue(now);

    expect(payments.confirm).toHaveBeenCalledWith('attempt-1', {
      paidAmountCents: 6700,
      endToEndId: 'E1',
      providerFeeCents: null,
    });
    expect(prisma.checkoutOrder.updateMany).not.toHaveBeenCalled();
  });

  it('Pix não pago expira o pedido', async () => {
    prisma.checkoutOrder.findMany.mockResolvedValue([
      order({ expiresAt: new Date(now.getTime() - 20 * 60_000) }),
    ]);
    pix.status.mockResolvedValue({
      status: 'ATIVA',
      paidAmountCents: null,
      endToEndId: null,
    });

    await service.expireOverdue(now);

    expect(prisma.checkoutOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
  });

  it('incerto que não existe na Efí falha depois de 10 minutos', async () => {
    prisma.checkoutPaymentAttempt.findMany.mockResolvedValue([
      {
        id: 'attempt-1',
        orderId: 'order-1',
        efiTxid: 'ckt1',
        createdAt: new Date(now.getTime() - 11 * 60_000),
      },
    ]);
    pix.status.mockResolvedValue(null);

    await service.reconcileUncertain(now);

    expect(prisma.checkoutPaymentAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: 'UNCERTAIN' },
      data: { status: 'FAILED' },
    });
  });
});
