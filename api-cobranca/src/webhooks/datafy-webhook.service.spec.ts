import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { DatafyWebhookService } from './datafy-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { DatafyWebhookQueue } from '../queue/datafy-webhook.queue';

type CreatedDelivery = { id: string; attempts: number };
type CreateDeliveryMock = jest.Mock<Promise<CreatedDelivery>, [unknown]>;

describe('Recebimento duravel Datafy', () => {
  const config = new ConfigService({
    DATAFY_WEBHOOK_SECRET: 'whsec_fixture',
    META_BUSINESS_ACCOUNT_ID: '111',
    META_PHONE_NUMBER_ID: '222',
    PAYMENT_SECRET_KEY: 'fixture-encryption',
  });
  const crypto = new PaymentCryptoService(config);
  const raw = Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '111', changes: [{ field: 'future_event', value: {} }] }],
    }),
  );
  const headers = (): {
    deliveryId: string;
    timestamp: string;
    signature: string;
  } => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      deliveryId: randomUUID(),
      timestamp,
      signature: `sha256=${createHmac('sha256', 'whsec_fixture').update(`${timestamp}.`).update(raw).digest('hex')}`,
    };
  };
  function fixture(): {
    service: DatafyWebhookService;
    create: CreateDeliveryMock;
    enqueue: jest.Mock;
  } {
    const create = jest
      .fn<Promise<CreatedDelivery>, [unknown]>()
      .mockResolvedValue({ id: randomUUID(), attempts: 0 });
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      communicationWebhookDelivery: { create, findUnique: jest.fn() },
    } as unknown as PrismaService;
    const queue = { enqueue } as unknown as DatafyWebhookQueue;
    return {
      service: new DatafyWebhookService(prisma, config, crypto, queue),
      create,
      enqueue,
    };
  }
  it('aceita o segredo anterior somente enquanto ele estiver configurado', async () => {
    const signed = (secret: string) => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      return {
        deliveryId: randomUUID(),
        timestamp,
        signature: `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`,
      };
    };
    const build = (previous?: string) =>
      new DatafyWebhookService(
        {
          communicationWebhookDelivery: {
            create: jest
              .fn()
              .mockResolvedValue({ id: randomUUID(), attempts: 0 }),
            findUnique: jest.fn(),
          },
        } as unknown as PrismaService,
        new ConfigService({
          DATAFY_WEBHOOK_SECRET: 'whsec_new',
          ...(previous ? { DATAFY_WEBHOOK_SECRET_PREVIOUS: previous } : {}),
          META_BUSINESS_ACCOUNT_ID: '111',
          META_PHONE_NUMBER_ID: '222',
        }),
        crypto,
        {
          enqueue: jest.fn().mockResolvedValue(undefined),
        } as unknown as DatafyWebhookQueue,
      );
    const rotating = build('whsec_old');
    await expect(rotating.receive(raw, signed('whsec_new'))).resolves.toEqual({
      received: true,
    });
    await expect(rotating.receive(raw, signed('whsec_old'))).resolves.toEqual({
      received: true,
    });
    await expect(
      rotating.receive(raw, signed('whsec_other')),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      build().receive(raw, signed('whsec_old')),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('aguarda o commit antes de confirmar ou publicar job', async () => {
    const { service, create, enqueue } = fixture();
    let finish!: (record: { id: string; attempts: number }) => void;
    create.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let acknowledged = false;
    const receiving = service.receive(raw, headers()).then(() => {
      acknowledged = true;
    });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    finish({ id: 'persisted', attempts: 0 });
    await receiving;
    expect(enqueue).toHaveBeenCalledWith('persisted', 0, 0);
  });
  it('confirma entrega persistida mesmo com Redis indisponivel', async () => {
    const { service, create, enqueue } = fixture();
    enqueue.mockRejectedValue(new Error('private redis details'));
    await expect(service.receive(raw, headers())).resolves.toEqual({
      received: true,
    });
    const data: unknown = create.mock.calls[0]?.[0];
    expect(JSON.stringify(data)).not.toContain('future_event');
    expect(JSON.stringify(data)).toContain('reviewRequired');
  });
  it('nao confirma quando o banco falha e nao publica', async () => {
    const { service, create, enqueue } = fixture();
    create.mockRejectedValue(new Error('private database details'));
    await expect(service.receive(raw, headers())).rejects.toThrow(
      'Recebimento Datafy indisponivel',
    );
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('recusa autenticacao e identidade invalidas antes de persistir', async () => {
    const { service, create } = fixture();
    await expect(
      service.receive(raw, { ...headers(), signature: 'invalid' }),
    ).rejects.toThrow();
    await expect(
      service.receive(raw, { ...headers(), deliveryId: 'not-a-uuid' }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
