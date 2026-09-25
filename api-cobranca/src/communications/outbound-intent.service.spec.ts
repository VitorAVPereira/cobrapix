import { OutboundIntentService } from './outbound-intent.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { CommunicationAttributionService } from './communication-attribution.service';
import { WhatsappTransportError } from '../whatsapp/transport/whatsapp-transport.error';

function setup() {
  const record = {
    id: 'intent',
    messageId: 'message',
    state: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date(0),
    leaseToken: null as string | null,
    retentionExpiresAt: new Date(Date.now() + 86_400_000),
    externalMessageId: null as string | null,
    transport: 'DATAFY',
    transportChannelId: '123',
    payloadEncrypted: 'payload',
    recipientEncrypted: 'recipient',
    lastErrorCode: null as string | null,
  };
  const matches = (where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'id') return true;
      if (key === 'OR')
        return (value as Record<string, unknown>[]).some(matches);
      const current = (record as Record<string, unknown>)[key];
      if (value instanceof Object && 'lte' in value)
        return (current as Date) <= (value as { lte: Date }).lte;
      return current === value;
    });
  const updateMany = jest.fn(
    ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (!matches(where)) return Promise.resolve({ count: 0 });
      Object.assign(record, data);
      return Promise.resolve({ count: 1 });
    },
  );
  const prisma = {
    communicationOutboundIntent: {
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ ...record })),
      updateMany,
    },
    communicationMessage: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  );
  const service = new OutboundIntentService(
    prisma as unknown as PrismaService,
    {} as PaymentCryptoService,
    {} as CommunicationAttributionService,
  );
  return { service, record, prisma };
}

describe('OutboundIntentService dispatch', () => {
  it('claims before transmitting, accepts once and never sends again', async () => {
    const { service, record } = setup();
    const transmit = jest.fn().mockImplementation(() => {
      expect(record.state).toBe('SENDING');
      return Promise.resolve({
        accepted: true,
        messageId: 'wamid-1',
        status: 'accepted',
      });
    });
    await service.execute('intent', () => Promise.resolve(), transmit);
    expect(record.state).toBe('ACCEPTED');
    await service.execute('intent', () => Promise.resolve(), transmit);
    expect(transmit).toHaveBeenCalledTimes(1);
  });
  it('blocks retries after timeout with possible provider acceptance', async () => {
    const { service, record } = setup();
    const transmit = jest
      .fn()
      .mockRejectedValue(
        new WhatsappTransportError('uncertain', 'UNCERTAIN', 'UNCERTAIN'),
      );
    await expect(
      service.execute('intent', () => Promise.resolve(), transmit),
    ).rejects.toThrow();
    expect(record.state).toBe('UNCERTAIN');
    await expect(
      service.execute('intent', () => Promise.resolve(), transmit),
    ).rejects.toThrow();
    expect(transmit).toHaveBeenCalledTimes(1);
  });
  it('retries a transient acceptance commit without transmitting again', async () => {
    const { service, record, prisma } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('transient'));
    const transmit = jest.fn().mockResolvedValue({
      accepted: true,
      messageId: 'wamid-2',
      status: 'accepted',
    });
    await service.execute('intent', () => Promise.resolve(), transmit);
    expect(record).toMatchObject({
      state: 'ACCEPTED',
      externalMessageId: 'wamid-2',
    });
    expect(transmit).toHaveBeenCalledTimes(1);
  });
  it('marks a persistent local failure after provider acceptance as uncertain', async () => {
    const { service, record, prisma } = setup();
    for (let i = 0; i < 3; i++)
      prisma.$transaction.mockRejectedValueOnce(new Error('database down'));
    const transmit = jest.fn().mockResolvedValue({
      accepted: true,
      messageId: 'wamid-3',
      status: 'accepted',
    });
    await expect(
      service.execute('intent', () => Promise.resolve(), transmit),
    ).rejects.toMatchObject({ kind: 'UNCERTAIN' });
    expect(record.state).toBe('UNCERTAIN');
    await expect(
      service.execute('intent', () => Promise.resolve(), transmit),
    ).rejects.toThrow();
    expect(transmit).toHaveBeenCalledTimes(1);
  });
  it('keeps proof of acceptance when the lease expired during a slow transmission', async () => {
    const { service, record } = setup();
    const transmit = jest.fn().mockImplementation(() => {
      Object.assign(record, {
        state: 'UNCERTAIN',
        lastErrorCode: 'WORKER_LOST_AFTER_CLAIM',
        leaseToken: null,
      });
      return Promise.resolve({
        accepted: true,
        messageId: 'wamid-late',
        status: 'accepted',
      });
    });
    await service.execute('intent', () => Promise.resolve(), transmit);
    expect(record).toMatchObject({
      state: 'ACCEPTED',
      externalMessageId: 'wamid-late',
    });
  });
  it('never finalizes an uncertain intent from another cause', async () => {
    const { service, record } = setup();
    const transmit = jest.fn().mockImplementation(() => {
      Object.assign(record, {
        state: 'UNCERTAIN',
        lastErrorCode: 'DELIVERY_UNCERTAIN',
        leaseToken: null,
      });
      return Promise.resolve({
        accepted: true,
        messageId: 'wamid-other',
        status: 'accepted',
      });
    });
    await expect(
      service.execute('intent', () => Promise.resolve(), transmit),
    ).rejects.toMatchObject({ kind: 'UNCERTAIN' });
    expect(record).toMatchObject({
      state: 'UNCERTAIN',
      externalMessageId: null,
    });
  });
  it('keeps a safe 429 pending until Retry-After', async () => {
    const { service, record } = setup();
    const before = Date.now();
    const transmit = jest
      .fn()
      .mockRejectedValue(
        new WhatsappTransportError(
          'wait',
          'RATE_LIMIT',
          'REJECTED',
          429,
          undefined,
          90,
        ),
      );
    await expect(
      service.execute('intent', () => Promise.resolve(), transmit),
    ).rejects.toThrow();
    expect(record.state).toBe('PENDING');
    expect(record.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + 90_000,
    );
  });
  it.each([
    [
      new WhatsappTransportError(
        'janela',
        'REJECTED',
        'NOT_SENT',
        undefined,
        undefined,
        undefined,
        'SERVICE_WINDOW_CLOSED',
      ),
      'SERVICE_WINDOW_CLOSED',
    ],
    [
      new Error('COLLECTION_NO_LONGER_ELIGIBLE'),
      'COLLECTION_NO_LONGER_ELIGIBLE',
    ],
    [new Error('free text with provider details'), 'DISPATCH_REJECTED'],
  ])(
    'stores only a stable local reason for a rejection',
    async (error, code) => {
      const { service, record } = setup();
      await expect(
        service.execute('intent', () => Promise.reject(error), jest.fn()),
      ).rejects.toThrow();
      expect(record).toMatchObject({ state: 'FAILED', lastErrorCode: code });
    },
  );
  it('rejects a closed service window before transmission', async () => {
    const { service, record } = setup();
    const transmit = jest.fn();
    await expect(
      service.execute(
        'intent',
        () => Promise.reject(new Error('window closed')),
        transmit,
      ),
    ).rejects.toThrow();
    expect(transmit).not.toHaveBeenCalled();
    expect(record.state).toBe('FAILED');
  });
});
