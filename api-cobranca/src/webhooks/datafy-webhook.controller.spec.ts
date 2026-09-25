import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DatafyWebhookController } from './datafy-webhook.controller';
import { DatafyWebhookService } from './datafy-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { DatafyWebhookQueue } from '../queue/datafy-webhook.queue';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GlobalExceptionFilter } from '../common/filters/http-exception.filter';

describe('Webhook Datafy HTTP', () => {
  let app: INestApplication<Server>;
  const create = jest.fn(),
    enqueue = jest.fn();
  const list = jest.fn().mockResolvedValue([]),
    replay = jest.fn().mockResolvedValue({ count: 0 });
  const config = new ConfigService({
    DATAFY_WEBHOOK_SECRET: 'whsec_http_test',
    META_BUSINESS_ACCOUNT_ID: '111',
    META_PHONE_NUMBER_ID: '222',
    PAYMENT_SECRET_KEY: 'synthetic_only',
  });
  const raw =
    '{ "object": "whatsapp_business_account", "entry": [{ "id": "111", "changes": [{"field":"future","value":{}}] }] }\n';
  function signed(body: string): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      'Content-Type': 'application/json',
      'x-datafy-delivery-id': randomUUID(),
      'x-datafy-timestamp': timestamp,
      'x-datafy-signature-256': `sha256=${createHmac('sha256', 'whsec_http_test').update(`${timestamp}.${body}`).digest('hex')}`,
    };
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DatafyWebhookController],
      providers: [
        DatafyWebhookService,
        { provide: ConfigService, useValue: config },
        {
          provide: PaymentCryptoService,
          useValue: new PaymentCryptoService(config),
        },
        { provide: DatafyWebhookQueue, useValue: { enqueue } },
        {
          provide: PrismaService,
          useValue: {
            communicationWebhookDelivery: {
              create,
              findMany: list,
              updateMany: replay,
            },
            user: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ role: 'PLATFORM_ADMIN' }),
            },
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext): boolean {
          const req = context
            .switchToHttp()
            .getRequest<
              Request & { user?: { role: string; userId: string } }
            >();
          const role = req.header('x-test-role');
          if (!role) throw new UnauthorizedException();
          req.user = { role, userId: 'admin-test' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>({
      rawBody: true,
    });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: randomUUID(), attempts: 0 });
    enqueue.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await app.close();
  });
  it('responde 200 com corpo original preservado e Redis travado nao retarda o ack', async () => {
    enqueue.mockReturnValue(new Promise<never>(() => {}));
    const started = Date.now();
    await request(app.getHttpServer())
      .post('/webhooks/datafy')
      .set(signed(raw))
      .send(raw)
      .expect(200, { received: true });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('recusa assinatura, timestamp e canal incorretos sem persistir', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/datafy')
      .set({ ...signed(raw), 'x-datafy-signature-256': 'sha256=bad' })
      .send(raw)
      .expect(401);
    const wrong = raw.replace('"111"', '"999"');
    await request(app.getHttpServer())
      .post('/webhooks/datafy')
      .set(signed(wrong))
      .send(wrong)
      .expect(403);
    await request(app.getHttpServer())
      .post('/webhooks/datafy')
      .set({ ...signed(raw), 'x-datafy-timestamp': 'NaN' })
      .send(raw)
      .expect(401);
    expect(create).not.toHaveBeenCalled();
  });
  it('retorna 503 sem revelar erro bruto quando o banco falha', async () => {
    create.mockRejectedValue(new Error('sensitive-private-password'));
    const result = await request(app.getHttpServer())
      .post('/webhooks/datafy')
      .set(signed(raw))
      .send(raw)
      .expect(503);
    expect(result.text).not.toContain('sensitive');
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('protege triagem e replay contra anonimo e empresa', async () => {
    for (const [role, status] of [
      ['', 401],
      ['COMPANY_ADMIN', 403],
    ] as const) {
      await request(app.getHttpServer())
        .get('/webhooks/admin/datafy/deliveries')
        .set('x-test-role', role)
        .expect(status);
      await request(app.getHttpServer())
        .post(`/webhooks/admin/datafy/deliveries/${randomUUID()}/replay`)
        .set('x-test-role', role)
        .expect(status);
    }
    expect(list).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get('/webhooks/admin/datafy/deliveries')
      .set('x-test-role', 'PLATFORM_ADMIN')
      .expect(200);
  });
});
