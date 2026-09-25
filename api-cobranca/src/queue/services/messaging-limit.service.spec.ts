import { DatafyRateLimitService } from '../../whatsapp/transport/datafy-rate-limit.service';
const testQuota = {
  acquire: jest.fn().mockResolvedValue(undefined),
} as unknown as DatafyRateLimitService;
import { ConfigService } from '@nestjs/config';
import { MessagingLimitService } from './messaging-limit.service';
import { DatafyTransport } from '../../whatsapp/transport/datafy.transport';
import type { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { WhatsappTransportError } from '../../whatsapp/transport/whatsapp-transport.error';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    status: 'ready',
    on: jest.fn(),
    quit: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
  })),
}));

describe('Consulta do tier do canal compartilhado', () => {
  afterEach(() => jest.restoreAllMocks());

  it('consulta pelo Datafy sem alterar a quota comercial da empresa', async () => {
    const config = new ConfigService({
      DATAFY_API_TOKEN: 'sk_live_test',
      META_PHONE_NUMBER_ID: '123',
      META_BUSINESS_ACCOUNT_ID: '456',
    });
    const update = jest.fn();
    const prisma = {
      company: {
        update,
        findUnique: jest.fn().mockResolvedValue({
          metaPhoneNumberId: null,
          metaAccessTokenEncrypted: null,
          messagingLimitTier: 'TIER_50',
        }),
      },
    } as unknown as PrismaService;
    const http = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ phone_number_id: '123', waba_id: '456' }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: '123', messaging_limit_tier: 'TIER_1K' }),
        ),
      );
    const limits = new MessagingLimitService(
      config,
      prisma,
      new DatafyTransport(config, testQuota),
    );
    await expect(limits.syncTierFromMeta('company-1')).resolves.toBe('TIER_1K');
    expect(update).not.toHaveBeenCalled();
    expect(http).toHaveBeenLastCalledWith(
      'https://cloud.datafyapi.com.br/v1/123?fields=id,messaging_limit_tier',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('Reserva da cota diaria do canal', () => {
  const limits = (error: unknown): MessagingLimitService =>
    new MessagingLimitService(
      new ConfigService({}),
      {
        $transaction: jest.fn().mockRejectedValue(error),
      } as unknown as PrismaService,
      {} as DatafyTransport,
    );

  it('keeps the intent pending on a transient database failure', async () => {
    await expect(
      limits(new Error('connection reset')).reserveDispatchQuota(
        'intent',
        '123',
      ),
    ).rejects.toMatchObject({ kind: 'TEMPORARY', outcome: 'NOT_SENT' });
  });

  it('rejects instead of looping when the intent or company no longer exists', async () => {
    const missing = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    const error: unknown = await limits(missing)
      .reserveDispatchQuota('intent', '123')
      .catch((reason: unknown) => reason);
    expect(error).not.toBeInstanceOf(WhatsappTransportError);
    expect(error).toMatchObject({ message: 'DISPATCH_CONTEXT_NOT_FOUND' });
  });
});

describe('Consumo das ultimas 24 h', () => {
  it('conta status Datafy das mensagens da empresa no canal WhatsApp', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { status: 'pending', _count: { _all: 4 } },
      { status: 'sent', _count: { _all: 3 } },
      { status: 'delivered', _count: { _all: 2 } },
      { status: 'read', _count: { _all: 5 } },
      { status: 'failed', _count: { _all: 1 } },
      { status: 'delivery_uncertain', _count: { _all: 1 } },
      { status: null, _count: { _all: 6 } },
    ]);
    const count = jest.fn().mockResolvedValue(7);
    const config = new ConfigService({});
    const limits = new MessagingLimitService(
      config,
      { communicationMessage: { groupBy, count } } as unknown as PrismaService,
      new DatafyTransport(config, testQuota),
    );
    await expect(limits.getInteractionStats('company-1')).resolves.toEqual({
      outbound: 10,
      delivered: 7,
      read: 5,
      inbound: 7,
      failed: 1,
    });
    const scope = {
      companyId: 'company-1',
      conversation: { channel: 'WHATSAPP' },
      createdAt: { gte: expect.any(Date) as unknown },
    };
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['status'],
        where: { ...scope, direction: 'OUTBOUND' },
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { ...scope, direction: 'INBOUND' },
    });
  });
});
