/**
 * Integrated Datafy scenario: two companies, one phone, real HTTP, real BullMQ workers,
 * disposable PostgreSQL/Redis (test/e2e-disposable.cjs). The provider is simulated at
 * `fetch`; any other external call fails the test.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuthModule } from '../src/auth/auth.module';
import { BillingModule } from '../src/billing/billing.module';
import { CommunicationMediaService } from '../src/communications/communication-media.service';
import { CommunicationsModule } from '../src/communications/communications.module';
import { messageRecipient } from '../src/communications/message-context';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { validateEnv } from '../src/config/env.validation';
import { EfiOnboardingModule } from '../src/efi-onboarding/efi-onboarding.module';
import { EmailModule } from '../src/email/email.module';
import { HealthModule } from '../src/health/health.module';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { PaymentModule } from '../src/payment/payment.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BullInfrastructureModule } from '../src/queue/bull-infrastructure.module';
import { DATAFY_WEBHOOK_QUEUE } from '../src/queue/datafy-webhook.queue';
import { MessageQueueService } from '../src/queue/message.queue';
import { DatafyWebhookWorker } from '../src/queue/workers/datafy-webhook.worker';
import { TemplatesModule } from '../src/templates/templates.module';
import { DatafyWebhookService } from '../src/webhooks/datafy-webhook.service';
import { datafyBodyParser } from '../src/webhooks/datafy-body-parser';
import { WebhooksModule } from '../src/webhooks/webhooks.module';
import { OutboundDispatcherService } from '../src/whatsapp/outbound-dispatcher.service';
import { WhatsappModule } from '../src/whatsapp/whatsapp.module';

jest.setTimeout(240_000);

const disposableRun = process.env.CIFRAMAIS_DISPOSABLE_E2E;
const databaseUrl = process.env.DATABASE_URL ?? '';
// Refuse anything but the infrastructure created by test/e2e-disposable.cjs.
if (
  !disposableRun ||
  !/^postgresql:\/\/postgres:[a-f0-9]+@127\.0\.0\.1:\d+\/ciframais_e2e$/.test(
    databaseUrl,
  ) ||
  process.env.REDIS_HOST !== '127.0.0.1'
)
  throw new Error(
    'Execute com: node test/e2e-disposable.cjs datafy-communications.e2e-spec.ts',
  );

const CHANNEL = '222';
const WABA = '111';
const SECRET = 'whsec_e2e_current';
const PREVIOUS_SECRET = 'whsec_e2e_previous';
const PHONE = '5511976600001';
const PASSWORD = 'senha-e2e-segura';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic receipt'),
]);
const mediaDir = mkdtempSync(join(tmpdir(), 'ciframais-e2e-media-'));

const baseEnv: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_SECRET: 'e2e_jwt_secret_with_at_least_32_characters',
  PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: 'c'.repeat(64) }),
  PAYMENT_ACTIVE_KEY_VERSION: 'v1',
  EFI_WEBHOOK_SECRET: 'e2e_efi_webhook_secret_with_32_characters',
  EFI_WEBHOOK_BASE_URL: 'https://webhooks.e2e.test',
  FRONTEND_URL: 'https://app.e2e.test',
  META_PHONE_NUMBER_ID: CHANNEL,
  META_BUSINESS_ACCOUNT_ID: WABA,
  DATAFY_API_TOKEN: 'sk_live_e2e_token',
  DATAFY_WEBHOOK_SECRET: SECRET,
  DATAFY_WEBHOOK_SECRET_PREVIOUS: PREVIOUS_SECRET,
  DATAFY_WEBHOOK_BASE_URL: 'https://api.e2e.test/webhooks/datafy',
  COMMUNICATION_MEDIA_DIR: mediaDir,
};

interface ProviderCall {
  origin: string;
  path: string;
  body: Record<string, unknown>;
}
const provider = {
  sends: [] as ProviderCall[],
  nextSend: [] as Array<() => Response>,
  sequence: 0,
};
const external = jest
  .spyOn(globalThis, 'fetch')
  .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (
      url.origin === 'https://cloud.datafyapi.com.br' &&
      init?.method === 'POST' &&
      url.pathname.endsWith(`/${CHANNEL}/messages`)
    ) {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      provider.sends.push({ origin: url.origin, path: url.pathname, body });
      const override = provider.nextSend.shift();
      if (override) return Promise.resolve(override());
      return Promise.resolve(
        Response.json({
          messaging_product: 'whatsapp',
          contacts: [{ wa_id: body.to }],
          messages: [{ id: `wamid.e2e.${++provider.sequence}` }],
        }),
      );
    }
    if (
      url.origin === 'https://cloud.datafyapi.com.br' &&
      url.pathname === '/media/9001/download'
    )
      return Promise.resolve(
        new Response(PNG, { headers: { 'content-type': 'image/png' } }),
      );
    return Promise.reject(
      new Error(`Unexpected external call: ${url.origin}${url.pathname}`),
    );
  });

async function createApp(): Promise<INestApplication> {
  Object.assign(process.env, baseEnv);
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        validate: validateEnv,
        cache: false,
        ignoreEnvFile: true,
      }),
      // No ScheduleModule: recovery, media and purge run when this test calls them.
      BullInfrastructureModule,
      PrismaModule,
      HealthModule,
      AuthModule,
      WhatsappModule,
      InvoicesModule,
      BillingModule,
      WebhooksModule,
      PaymentModule,
      TemplatesModule,
      EmailModule,
      AdminModule,
      EfiOnboardingModule,
      CommunicationsModule,
    ],
    providers: [
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      {
        provide: APP_PIPE,
        useFactory: () =>
          new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
          }),
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  // Exactly the middleware src/main.ts installs before init.
  app.use('/webhooks/datafy', datafyBodyParser());
  await app.init();
  return app;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(
  read: () => Promise<T | null | undefined | false>,
  label: string,
  timeoutMs = 45_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
    await sleep(250);
  }
}

function envelope(changes: unknown[]): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: WABA, changes }],
  });
}
const inbound = (
  id: string,
  body: string,
  extra: Record<string, unknown> = {},
): unknown => ({
  field: 'messages',
  value: {
    metadata: { phone_number_id: CHANNEL },
    messages: [
      {
        id,
        from: PHONE,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body },
        ...extra,
      },
    ],
  },
});
const statusChange = (
  id: string,
  status: string,
  secondsAgo: number,
): unknown => ({
  field: 'messages',
  value: {
    metadata: { phone_number_id: CHANNEL },
    statuses: [
      {
        id,
        status,
        timestamp: String(Math.floor(Date.now() / 1000) - secondsAgo),
        recipient_id: PHONE,
      },
    ],
  },
});

function postDatafy(
  app: INestApplication,
  raw: string,
  secret = SECRET,
  deliveryId: string = randomUUID(),
): request.Test {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`;
  return request(app.getHttpServer() as Server)
    .post('/webhooks/datafy')
    .set('Content-Type', 'application/json')
    .set('x-datafy-delivery-id', deliveryId)
    .set('x-datafy-timestamp', timestamp)
    .set('x-datafy-signature-256', signature)
    .send(raw);
}

describe('Datafy communications, two companies, one phone (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Server;
  const ids = {
    companyA: '',
    companyB: '',
    debtorA: '',
    debtorB: '',
    invoiceA: '',
    invoiceB: '',
    conversation: '',
  };
  const tokens = { admin: '', a: '', b: '' };
  const wamid = { collectionA: '', collectionB: '' };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function login(email: string): Promise<string> {
    const response = await request(http)
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    if (response.status !== 200)
      throw new Error(
        `login ${response.status}: ${JSON.stringify(response.body)}`,
      );
    return (response.body as { access_token: string }).access_token;
  }
  async function accepted(
    key: string,
  ): Promise<{ externalMessageId: string; messageId: string }> {
    const dispatcher = app.get(OutboundDispatcherService, { strict: false });
    return until(async () => {
      const intent = await prisma.communicationOutboundIntent.findUnique({
        where: { idempotencyKey: key },
      });
      if (intent?.state === 'PENDING' && intent.nextAttemptAt <= new Date())
        await dispatcher.recover(); // what the 10 s interval does in production
      return intent?.state === 'ACCEPTED' && intent.externalMessageId
        ? {
            externalMessageId: intent.externalMessageId,
            messageId: intent.messageId,
          }
        : null;
    }, `intent ${key} accepted`);
  }
  async function processed(externalMessageId: string) {
    return until(
      () =>
        prisma.communicationMessage.findUnique({
          where: { externalMessageId },
        }),
      `message ${externalMessageId} processed`,
    );
  }
  async function collect(
    companyId: string,
    invoiceId: string,
    debtorId: string,
  ): Promise<string> {
    await app.get(MessageQueueService, { strict: false }).addSendMessageJob({
      invoiceId,
      companyId,
      debtorId,
      phoneNumber: `+${PHONE}`,
      senderKey: CHANNEL,
      templateName: 'ciframais_e2e_aviso',
      templateLanguage: 'pt_BR',
      templateParameters: ['Pagador'],
      message: 'Cobranca E2E',
      debtorName: 'Pagador',
    });
    return (
      await accepted(`collection:${companyId}:${invoiceId}:initial:WHATSAPP`)
    ).externalMessageId;
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as Server;
    const hash = await bcrypt.hash(PASSWORD, 4);
    const suffix = randomUUID().slice(0, 8);
    const company = (name: string, document: string) =>
      prisma.company.create({
        data: {
          corporateName: name,
          email: `${name}-${suffix}@e2e.test`,
          phoneNumber: '5511900000000',
          document,
        },
      });
    const [platform, a, b] = [
      await company('plataforma', `11${Date.now()}`.slice(0, 14)),
      await company('empresa-a', `22${Date.now()}`.slice(0, 14)),
      await company('empresa-b', `33${Date.now()}`.slice(0, 14)),
    ];
    ids.companyA = a.id;
    ids.companyB = b.id;
    for (const [email, companyId, role] of [
      [`admin-${suffix}@e2e.test`, platform.id, 'PLATFORM_ADMIN'],
      [`a-${suffix}@e2e.test`, a.id, 'COMPANY_ADMIN'],
      [`b-${suffix}@e2e.test`, b.id, 'COMPANY_ADMIN'],
    ] as const)
      await prisma.user.create({
        data: { email, password: hash, companyId, role },
      });
    for (const [key, companyId] of [
      ['A', a.id],
      ['B', b.id],
    ] as const) {
      const debtor = await prisma.debtor.create({
        data: {
          companyId,
          name: `Pagador ${key}`,
          phoneNumber: `+${PHONE}`,
          whatsappOptIn: true,
        },
      });
      const invoice = await prisma.invoice.create({
        data: {
          companyId,
          debtorId: debtor.id,
          originalAmount: 150,
          dueDate: new Date(Date.now() + 5 * 86_400_000),
          status: 'PENDING',
        },
      });
      ids[`debtor${key}`] = debtor.id;
      ids[`invoice${key}`] = invoice.id;
    }
    await prisma.globalMessageTemplate.create({
      data: {
        name: 'Aviso E2E',
        slug: `e2e-aviso-${suffix}`,
        content:
          'Olá {{nome_devedor}}, há uma cobrança pendente via CifraMais.',
        paymentButtonEnabled: false,
        metaTemplateName: 'ciframais_e2e_aviso',
        metaLanguage: 'pt_BR',
        metaStatus: 'APPROVED',
        category: 'UTILITY',
      },
    });
    tokens.admin = await login(`admin-${suffix}@e2e.test`);
    tokens.a = await login(`a-${suffix}@e2e.test`);
    tokens.b = await login(`b-${suffix}@e2e.test`);
  });

  afterAll(async () => {
    await app?.close();
    external.mockRestore();
    rmSync(mediaDir, { recursive: true, force: true });
  });

  it('sends each company collection through the queue, Datafy transport and one intent', async () => {
    wamid.collectionA = await collect(ids.companyA, ids.invoiceA, ids.debtorA);
    wamid.collectionB = await collect(ids.companyB, ids.invoiceB, ids.debtorB);
    expect(provider.sends.map((call) => call.origin)).toEqual([
      'https://cloud.datafyapi.com.br',
      'https://cloud.datafyapi.com.br',
    ]);
    expect(provider.sends[0]?.body).toMatchObject({
      to: PHONE,
      type: 'template',
    });
    const conversation =
      await prisma.communicationConversation.findUniqueOrThrow({
        where: {
          channel_recipientHash: {
            channel: 'WHATSAPP',
            recipientHash: messageRecipient({ type: 'PHONE', value: PHONE })
              .hash,
          },
        },
      });
    ids.conversation = conversation.id;
    expect(
      await prisma.collectionLog.count({
        where: {
          invoiceId: ids.invoiceA,
          actionType: 'WHATSAPP_SENT',
          status: 'SENT',
        },
      }),
    ).toBe(1);
  });

  it('ingests quoted, ambiguous and media replies, with the current or the previous secret', async () => {
    await postDatafy(
      app,
      envelope([
        inbound('wamid.in.reply-a', 'Paguei a cobrança A', {
          context: { id: wamid.collectionA },
        }),
      ]),
    ).expect(200);
    await postDatafy(
      app,
      envelope([
        inbound('wamid.in.reply-b', 'Dúvida sobre a cobrança B', {
          context: { id: wamid.collectionB },
        }),
      ]),
      PREVIOUS_SECRET,
    ).expect(200);
    await postDatafy(
      app,
      envelope([inbound('wamid.in.plain', 'Olá, quem é?')]),
    ).expect(200);
    await postDatafy(
      app,
      envelope([
        inbound('wamid.in.image', 'Comprovante', {
          type: 'image',
          text: undefined,
          image: { id: '9001', mime_type: 'image/png', caption: 'Comprovante' },
          context: { id: wamid.collectionA },
        }),
      ]),
    ).expect(200);
    const forged = await postDatafy(
      app,
      envelope([inbound('wamid.in.forged', 'forjada')]),
      'whsec_attacker',
    );
    expect(forged.status).toBe(401);
    const [replyA, replyB, plain, image] = await Promise.all([
      processed('wamid.in.reply-a'),
      processed('wamid.in.reply-b'),
      processed('wamid.in.plain'),
      processed('wamid.in.image'),
    ]);
    expect([replyA.companyId, replyA.attributionMethod]).toEqual([
      ids.companyA,
      'REPLY_CONTEXT',
    ]);
    expect([replyB.companyId, replyB.invoiceId]).toEqual([
      ids.companyB,
      ids.invoiceB,
    ]);
    expect([plain.companyId, plain.attributionMethod]).toEqual([
      null,
      'UNASSIGNED',
    ]);
    expect(image.companyId).toBe(ids.companyA);
    expect(
      await prisma.communicationMessage.count({
        where: { externalMessageId: 'wamid.in.forged' },
      }),
    ).toBe(0);
  });

  it('keeps one effect for repeated events and never regresses a read status', async () => {
    const before = await prisma.communicationConversation.findUniqueOrThrow({
      where: { id: ids.conversation },
    });
    await postDatafy(
      app,
      envelope([
        inbound('wamid.in.reply-a', 'Paguei a cobrança A', {
          context: { id: wamid.collectionA },
        }),
      ]),
    ).expect(200);
    // Provider retry of the same message under a new delivery id.
    await postDatafy(
      app,
      envelope([
        inbound('wamid.in.reply-a', 'Paguei a cobrança A', {
          context: { id: wamid.collectionA },
        }),
      ]),
    ).expect(200);
    await postDatafy(
      app,
      envelope([statusChange(wamid.collectionA, 'read', 5)]),
    ).expect(200);
    await postDatafy(
      app,
      envelope([statusChange(wamid.collectionA, 'delivered', 30)]),
    ).expect(200);
    await until(async () => {
      const pending = await prisma.communicationWebhookDelivery.count({
        where: { state: { in: ['PENDING', 'PROCESSING'] } },
      });
      return pending === 0;
    }, 'deliveries processed');
    await app.get(DatafyWebhookService, { strict: false }).reconcileStatuses();
    expect(
      await prisma.communicationMessage.count({
        where: { externalMessageId: 'wamid.in.reply-a' },
      }),
    ).toBe(1);
    const after = await prisma.communicationConversation.findUniqueOrThrow({
      where: { id: ids.conversation },
    });
    expect(after.unreadCount).toBe(before.unreadCount);
    expect(
      (
        await prisma.communicationMessage.findUniqueOrThrow({
          where: { externalMessageId: wamid.collectionA },
        })
      ).status,
    ).toBe('read');
  });

  it('recovers a delivery committed while the worker was down and Redis lost its job', async () => {
    const worker = app.get(DatafyWebhookWorker, { strict: false });
    await worker.onModuleDestroy();
    await postDatafy(
      app,
      envelope([inbound('wamid.in.recovered', 'Enviado durante a queda')]),
    ).expect(200);
    const redis = new Redis({
      host: '127.0.0.1',
      port: Number(process.env.REDIS_PORT),
    });
    try {
      const keys = await redis.keys(`bull:${DATAFY_WEBHOOK_QUEUE}:*`);
      if (keys.length) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
    worker.onModuleInit();
    await app.get(DatafyWebhookService, { strict: false }).recover();
    expect((await processed('wamid.in.recovered')).direction).toBe('INBOUND');
  });

  it('lets only the admin classify, with revision control and audit', async () => {
    const plain = await prisma.communicationMessage.findUniqueOrThrow({
      where: { externalMessageId: 'wamid.in.plain' },
    });
    const body = {
      expectedRevision: plain.attributionRevision,
      context: { companyId: ids.companyA, debtorId: ids.debtorA },
      reason: 'Contato confirmou a cobrança A',
    };
    await request(http)
      .patch(`/communications/admin/messages/${plain.id}/attribution`)
      .set(auth(tokens.a))
      .send(body)
      .expect(403);
    await request(http)
      .patch(`/communications/admin/messages/${plain.id}/attribution`)
      .set(auth(tokens.admin))
      .send(body)
      .expect(200);
    await request(http)
      .patch(`/communications/admin/messages/${plain.id}/attribution`)
      .set(auth(tokens.admin))
      .send(body)
      .expect(409);
    const audit = await prisma.communicationAttributionAudit.findFirstOrThrow({
      where: { messageId: plain.id },
    });
    expect([audit.actorType, audit.method]).toEqual([
      'PLATFORM_ADMIN',
      'MANUAL',
    ]);
  });

  it('queues an admin reply with company context and quote, idempotent on retry', async () => {
    const replyA = await prisma.communicationMessage.findUniqueOrThrow({
      where: { externalMessageId: 'wamid.in.reply-a' },
    });
    const idempotencyId = randomUUID();
    const body = {
      idempotencyId,
      content: 'Recebemos seu pagamento, obrigado!',
      context: { companyId: ids.companyA, invoiceId: ids.invoiceA },
      replyToMessageId: replyA.id,
    };
    await request(http)
      .post(`/communications/admin/conversations/${ids.conversation}/replies`)
      .set(auth(tokens.b))
      .send(body)
      .expect(403);
    await request(http)
      .post(`/communications/admin/conversations/${ids.conversation}/replies`)
      .set(auth(tokens.admin))
      .send(body)
      .expect(201);
    const sent = await accepted(`admin-reply:${idempotencyId}`);
    const sends = provider.sends.length;
    await request(http)
      .post(`/communications/admin/conversations/${ids.conversation}/replies`)
      .set(auth(tokens.admin))
      .send(body)
      .expect(201);
    await request(http)
      .post(`/communications/admin/conversations/${ids.conversation}/replies`)
      .set(auth(tokens.admin))
      .send({ ...body, content: 'outro texto' })
      .expect(409);
    expect(provider.sends.length).toBe(sends);
    expect(provider.sends.at(-1)?.body).toMatchObject({
      type: 'text',
      context: { message_id: 'wamid.in.reply-a' },
    });
    expect(
      (
        await prisma.communicationMessage.findUniqueOrThrow({
          where: { id: sent.messageId },
        })
      ).companyId,
    ).toBe(ids.companyA);
  });

  it('never resends when the provider accepted but the response was unusable', async () => {
    provider.nextSend.push(() => new Response('{}', { status: 200 }));
    const idempotencyId = randomUUID();
    const sends = provider.sends.length;
    await request(http)
      .post(`/communications/admin/conversations/${ids.conversation}/replies`)
      .set(auth(tokens.admin))
      .send({ idempotencyId, content: 'Resposta com resultado incerto' })
      .expect(201);
    const key = `admin-reply:${idempotencyId}`;
    await until(
      async () =>
        (
          await prisma.communicationOutboundIntent.findUnique({
            where: { idempotencyKey: key },
          })
        )?.state === 'UNCERTAIN',
      'intent uncertain',
    );
    await app.get(OutboundDispatcherService, { strict: false }).recover();
    await sleep(1500);
    expect(provider.sends.length).toBe(sends + 1);
    const detail = await request(http)
      .get(`/communications/admin/conversations/${ids.conversation}`)
      .set(auth(tokens.admin))
      .expect(200);
    const messages = (
      detail.body as {
        messages: Array<{
          content: string;
          outboundIntent: { state: string } | null;
        }>;
      }
    ).messages;
    expect(
      messages.find(
        (message) => message.content === 'Resposta com resultado incerto',
      )?.outboundIntent?.state,
    ).toBe('UNCERTAIN');
  });

  it('shows each company only its own messages over HTTP', async () => {
    const read = async (token: string) => {
      const list = await request(http)
        .get('/communications/conversations')
        .set(auth(token))
        .expect(200);
      expect(
        (list.body as { items: Array<{ id: string }> }).items.map(
          (item) => item.id,
        ),
      ).toContain(ids.conversation);
      const page = await request(http)
        .get(
          `/communications/conversations/${ids.conversation}/messages?limit=100`,
        )
        .set(auth(token))
        .expect(200);
      return page.body as {
        items: Array<{ content: string }>;
        nextCursor: string | null;
      };
    };
    const a = await read(tokens.a);
    const b = await read(tokens.b);
    const textA = JSON.stringify(a);
    const textB = JSON.stringify(b);
    expect(textA).toContain('Paguei a cobrança A');
    expect(textA).toContain('Recebemos seu pagamento');
    expect(textA).toContain('Olá, quem é?');
    expect(textA).not.toMatch(
      /cobrança B|Resposta com resultado incerto|Enviado durante a queda|wamid/,
    );
    expect(textB).toContain('Dúvida sobre a cobrança B');
    expect(textB).not.toMatch(
      /cobrança A|Recebemos seu pagamento|Olá, quem é|Comprovante|wamid/,
    );
    await request(http)
      .get(
        `/communications/conversations/${ids.conversation}/messages?companyId=${ids.companyA}`,
      )
      .set(auth(tokens.b))
      .expect(400);
    const first = await request(http)
      .get(`/communications/conversations/${ids.conversation}/messages?limit=1`)
      .set(auth(tokens.a))
      .expect(200);
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    await request(http)
      .get(
        `/communications/conversations/${ids.conversation}/messages?limit=1&cursor=${encodeURIComponent(cursor)}`,
      )
      .set(auth(tokens.b))
      .expect(400);
    await request(http)
      .get('/communications/admin/conversations')
      .set(auth(tokens.a))
      .expect(403);
  });

  it('serves the protected attachment only to its company and the admin', async () => {
    await app
      .get(CommunicationMediaService, { strict: false })
      .processPending();
    const image = await prisma.communicationMessage.findUniqueOrThrow({
      where: { externalMessageId: 'wamid.in.image' },
      include: { attachments: true },
    });
    const attachment = image.attachments[0]!;
    expect(attachment.state).toBe('READY');
    const path = `/communications/messages/${image.id}/attachments/${attachment.id}`;
    const ok = await request(http)
      .get(path)
      .set(auth(tokens.a))
      .buffer(true)
      .expect(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(ok.body as Buffer).equals(PNG)).toBe(true);
    await request(http).get(path).set(auth(tokens.b)).expect(404);
    await request(http).get(path).set(auth(tokens.admin)).expect(200);
    await request(http)
      .get(
        `/communications/messages/${randomUUID()}/attachments/${attachment.id}`,
      )
      .set(auth(tokens.a))
      .expect(404);
  });

  it('reports health with attachment storage and no external call', async () => {
    const health = await request(http).get('/health').expect(200);
    expect(JSON.stringify(health.body)).toContain('Anexos de comunicação');
    expect(
      external.mock.calls.every(([input]) => {
        const url = String(input instanceof Request ? input.url : input);
        return url.startsWith('https://cloud.datafyapi.com.br');
      }),
    ).toBe(true);
  });

  it('has no direct Meta integration: webhook gone and every send via Datafy', async () => {
    await request(http)
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.challenge': '1' })
      .expect(404);
    await request(http)
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .send(envelope([inbound('wamid.in.meta', 'via Meta')]))
      .expect(404);
    expect(
      await prisma.communicationMessage.count({
        where: { externalMessageId: 'wamid.in.meta' },
      }),
    ).toBe(0);
    expect(provider.sends.length).toBeGreaterThan(0);
    expect(
      provider.sends.every(
        (call) => call.origin === 'https://cloud.datafyapi.com.br',
      ),
    ).toBe(true);
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { transport: { not: 'DATAFY' } },
      }),
    ).toBe(0);
  });
});
