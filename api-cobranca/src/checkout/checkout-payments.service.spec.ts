import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutMailJobs } from './checkout-mail.service';
import {
  CheckoutPaymentsService,
  splitCheckoutPixEvents,
} from './checkout-payments.service';

const TXID = 'cktabcdefghijklmnopqrstuvwxyz012';

describe('splitCheckoutPixEvents', () => {
  it('separa os Pix do checkout dos Pix de cobrança', () => {
    const payload = {
      pix: [
        { txid: TXID, valor: '10.00' },
        { txid: 'cobranca123', valor: '20.00' },
        { endToEndId: 'enviado-sem-txid' },
      ],
    };
    const { checkout, rest } = splitCheckoutPixEvents(payload);

    expect(checkout).toEqual([{ txid: TXID, valor: '10.00' }]);
    expect(rest).toEqual({
      pix: [
        { txid: 'cobranca123', valor: '20.00' },
        { endToEndId: 'enviado-sem-txid' },
      ],
    });
  });

  it('aviso só do checkout não chega à cobrança', () => {
    expect(splitCheckoutPixEvents({ pix: [{ txid: TXID }] }).rest).toBeNull();
    expect(splitCheckoutPixEvents({ txid: TXID }).rest).toBeNull();
    expect(splitCheckoutPixEvents({ txid: 'outro' }).checkout).toEqual([]);
  });
});

describe('CheckoutPaymentsService', () => {
  const tx = {
    checkoutPaymentAttempt: { findUnique: jest.fn(), updateMany: jest.fn() },
    checkoutOrder: { update: jest.fn() },
    checkoutCoupon: { update: jest.fn() },
  };
  const prisma = {
    checkoutPaymentAttempt: { findUnique: jest.fn() },
    paymentWebhookAnomaly: { upsert: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const mail = { accessEmail: jest.fn() };
  const service = new CheckoutPaymentsService(
    prisma as unknown as PrismaService,
    mail as unknown as CheckoutMailJobs,
  );
  const event = {
    txid: TXID,
    chave: 'pix@ciframais.test',
    valor: '82.89',
    endToEndId: 'E123',
    gnExtras: { tarifa: '0.99' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.checkoutPaymentAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
      companyId: 'company-a',
      amountCents: 8289,
      issuerIdentity: { pixKey: 'pix@ciframais.test' },
    });
    tx.checkoutPaymentAttempt.findUnique.mockResolvedValue({
      orderId: 'order-1',
    });
    tx.checkoutPaymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    tx.checkoutOrder.update.mockResolvedValue({
      id: 'order-1',
      couponId: 'coupon-1',
    });
  });

  it('dá baixa, conta o cupom e enfileira o e-mail', async () => {
    await expect(service.handlePixEvent(event)).resolves.toBe(true);

    expect(tx.checkoutPaymentAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: { not: 'PAID' } },
      data: {
        status: 'PAID',
        paidAmountCents: 8289,
        endToEndId: 'E123',
        providerFeeCents: 99,
      },
    });
    expect(tx.checkoutCoupon.update).toHaveBeenCalledWith({
      where: { id: 'coupon-1' },
      data: { usedCount: { increment: 1 } },
    });
    expect(mail.accessEmail).toHaveBeenCalledWith('order-1');
  });

  it('webhook repetido não repete a baixa nem o cupom', async () => {
    tx.checkoutPaymentAttempt.updateMany.mockResolvedValue({ count: 0 });

    await service.handlePixEvent(event);

    expect(tx.checkoutOrder.update).not.toHaveBeenCalled();
    expect(tx.checkoutCoupon.update).not.toHaveBeenCalled();
    expect(mail.accessEmail).not.toHaveBeenCalled();
  });

  it.each([
    [
      'chave de outra conta',
      { chave: 'outra@chave.test' },
      'CHECKOUT_RECEIVER_MISMATCH',
    ],
    ['valor diferente', { valor: '1.00' }, 'CHECKOUT_AMOUNT_MISMATCH'],
    ['devolução', { devolucoes: [{ id: 'd1' }] }, 'CHECKOUT_REFUND_PENDING'],
  ])('%s vira anomalia sem baixa', async (_label, change, reasonCode) => {
    await expect(service.handlePixEvent({ ...event, ...change })).resolves.toBe(
      false,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.paymentWebhookAnomaly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: 'PIX',
          reasonCode,
        }) as unknown,
      }),
    );
  });

  it('txid desconhecido vira anomalia', async () => {
    prisma.checkoutPaymentAttempt.findUnique.mockResolvedValue(null);
    await expect(service.handlePixEvent(event)).resolves.toBe(false);
    expect(prisma.paymentWebhookAnomaly.upsert).toHaveBeenCalled();
  });

  it('falha ao enfileirar o e-mail não desfaz o pagamento', async () => {
    mail.accessEmail.mockRejectedValueOnce(new Error('redis'));
    await expect(service.handlePixEvent(event)).resolves.toBe(true);
  });
});
