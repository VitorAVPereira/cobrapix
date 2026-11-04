import { PrismaService } from '../prisma/prisma.service';
import type { CheckoutMailJobs } from './checkout-mail.service';
import type { CheckoutLedgerService } from './checkout-ledger.service';
import type { CheckoutRefundsService } from './checkout-refunds.service';
import type { CheckoutWebhooksService } from './checkout-webhooks.service';
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
  const ledger = { recordSale: jest.fn() };
  const refunds = { record: jest.fn() };
  const webhooks = { emit: jest.fn() };
  const service = new CheckoutPaymentsService(
    prisma as unknown as PrismaService,
    mail as unknown as CheckoutMailJobs,
    ledger as unknown as CheckoutLedgerService,
    refunds as unknown as CheckoutRefundsService,
    webhooks as unknown as CheckoutWebhooksService,
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
      orderId: 'order-1',
      amountCents: 8289,
      issuerIdentity: { pixKey: 'pix@ciframais.test' },
    });
    tx.checkoutPaymentAttempt.findUnique.mockResolvedValue({
      orderId: 'order-1',
    });
    tx.checkoutPaymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    tx.checkoutOrder.update.mockResolvedValue({
      id: 'order-1',
      companyId: 'company-a',
      couponId: 'coupon-1',
      totalCents: 8289,
      efiFeeCents: 99,
      platformFeeCents: 205,
    });
    refunds.record.mockResolvedValue(true);
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
    expect(ledger.recordSale).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: 'order-1', totalCents: 8289 }),
      99,
    );
  });

  it('devolução concluída vira reembolso; em processamento não mexe no saldo', async () => {
    await service.handlePixEvent({
      ...event,
      devolucoes: [
        { id: 'D1', valor: '10.00', status: 'DEVOLVIDO' },
        { id: 'D2', valor: '5.00', status: 'EM_PROCESSAMENTO' },
      ],
    });

    expect(refunds.record).toHaveBeenCalledTimes(1);
    expect(refunds.record).toHaveBeenCalledWith({
      orderId: 'order-1',
      amountCents: 1000,
      idempotencyKey: 'pix:E123:D1',
      evidenceReference: 'E123:D1',
      fromProvider: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
