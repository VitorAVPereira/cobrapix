/**
 * Template catalog access over real HTTP and JWT: admin imports, maps and grants; each
 * company sees only what was granted to it. Disposable PostgreSQL/Redis
 * (test/e2e-disposable.cjs); the Datafy catalog is simulated at `fetch`.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { CommunicationsModule } from '../src/communications/communications.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { validateEnv } from '../src/config/env.validation';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BullInfrastructureModule } from '../src/queue/bull-infrastructure.module';
import { TemplatesModule } from '../src/templates/templates.module';
import { messageRecipient } from '../src/communications/message-context';
import { PaymentCryptoService } from '../src/payment/payment-crypto.service';
import { OutboundDispatcherService } from '../src/whatsapp/outbound-dispatcher.service';

jest.setTimeout(180_000);

if (
  !process.env.CIFRAMAIS_DISPOSABLE_E2E ||
  !/^postgresql:\/\/postgres:[a-f0-9]+@127\.0\.0\.1:\d+\/ciframais_e2e$/.test(
    process.env.DATABASE_URL ?? '',
  )
)
  throw new Error(
    'Execute com: node test/e2e-disposable.cjs template-access.e2e-spec.ts',
  );

const CHANNEL = '222';
const WABA = '111';
const FRONTEND = 'https://app.e2e.test';
const PASSWORD = 'senha-e2e-segura';

const catalog = [
  {
    id: '555001',
    name: 'cobranca_real',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'UTILITY',
    parameter_format: 'POSITIONAL',
    components: [
      {
        type: 'BODY',
        text: 'Olá {{1}}, sua cobrança de {{2}} está disponível.',
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Pagar', url: `${FRONTEND}/pagar/{{1}}` },
        ],
      },
    ],
  },
  {
    id: '555002',
    name: 'com_imagem',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Veja {{1}}' },
    ],
  },
];
const provider = {
  posts: [] as string[],
  sends: [] as Array<Record<string, unknown>>,
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
    if (url.origin !== 'https://cloud.datafyapi.com.br')
      return Promise.reject(new Error(`Unexpected external call: ${url.href}`));
    if (init?.method === 'POST' && url.pathname === `/v1/${CHANNEL}/messages`) {
      provider.sends.push(
        JSON.parse(init.body as string) as Record<string, unknown>,
      );
      return Promise.resolve(
        Response.json({
          messages: [{ id: `wamid.access.${randomUUID()}` }],
        }),
      );
    }
    if (init?.method === 'POST') {
      provider.posts.push(url.pathname);
      return Promise.reject(new Error('No provider write expected'));
    }
    if (url.pathname === '/me')
      return Promise.resolve(
        Response.json({ phone_number_id: CHANNEL, waba_id: WABA }),
      );
    if (url.pathname === `/v1/${WABA}/message_templates`)
      return Promise.resolve(Response.json({ data: catalog }));
    return Promise.reject(new Error(`Unexpected external call: ${url.href}`));
  });

async function createApp(): Promise<INestApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'e2e_jwt_secret_with_at_least_32_characters',
    PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: 'c'.repeat(64) }),
    PAYMENT_ACTIVE_KEY_VERSION: 'v1',
    EFI_WEBHOOK_SECRET: 'e2e_efi_webhook_secret_with_32_characters',
    EFI_WEBHOOK_BASE_URL: 'https://webhooks.e2e.test',
    FRONTEND_URL: FRONTEND,
    META_PHONE_NUMBER_ID: CHANNEL,
    META_BUSINESS_ACCOUNT_ID: WABA,
    DATAFY_API_TOKEN: 'sk_live_e2e_token',
    DATAFY_WEBHOOK_SECRET: 'whsec_e2e_current',
    DATAFY_WEBHOOK_BASE_URL: 'https://api.e2e.test/webhooks/datafy',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        validate: validateEnv,
        cache: false,
        ignoreEnvFile: true,
      }),
      BullInfrastructureModule,
      PrismaModule,
      AuthModule,
      TemplatesModule,
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
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('Template catalog access (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Server;
  const tokens = { admin: '', a: '', b: '' };
  const ids = {
    a: '',
    b: '',
    templateOnlyA: '',
    unsupported: '',
    invoiceA: '',
    invoiceB: '',
    conversation: '',
  };
  const PHONE = '5511976600011';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string): Promise<string> {
    const response = await request(http)
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    return (response.body as { access_token: string }).access_token;
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
    const platform = await company(
      'plataforma',
      `44${Date.now()}`.slice(0, 14),
    );
    const a = await company('empresa-a', `55${Date.now()}`.slice(0, 14));
    const b = await company('empresa-b', `66${Date.now()}`.slice(0, 14));
    ids.a = a.id;
    ids.b = b.id;
    for (const [email, companyId, role] of [
      [`admin-${suffix}@e2e.test`, platform.id, 'PLATFORM_ADMIN'],
      [`a-${suffix}@e2e.test`, a.id, 'COMPANY_ADMIN'],
      [`b-${suffix}@e2e.test`, b.id, 'COMPANY_ADMIN'],
    ] as const)
      await prisma.user.create({
        data: { email, password: hash, companyId, role },
      });
    const debtor = await prisma.debtor.create({
      data: {
        companyId: a.id,
        name: 'Pagador A',
        phoneNumber: '+5511976600011',
      },
    });
    ids.invoiceA = (
      await prisma.invoice.create({
        data: {
          companyId: a.id,
          debtorId: debtor.id,
          originalAmount: 150,
          dueDate: new Date(),
          status: 'PENDING',
        },
      })
    ).id;
    // Company B charges the same person: one shared chat, two company contexts.
    const debtorB = await prisma.debtor.create({
      data: { companyId: b.id, name: 'Pagador B', phoneNumber: `+${PHONE}` },
    });
    ids.invoiceB = (
      await prisma.invoice.create({
        data: {
          companyId: b.id,
          debtorId: debtorB.id,
          originalAmount: 99,
          dueDate: new Date(),
          status: 'PENDING',
        },
      })
    ).id;
    const crypto = app.get(PaymentCryptoService, { strict: false });
    ids.conversation = (
      await prisma.communicationConversation.create({
        data: {
          channel: 'WHATSAPP',
          recipientType: 'PHONE',
          recipientHash: messageRecipient({ type: 'PHONE', value: PHONE }).hash,
          recipientEncrypted: crypto.encrypt(PHONE),
          serviceWindowExpiresAt: new Date(Date.now() - 1000),
          retentionExpiresAt: new Date(Date.now() + 365 * 86_400_000),
        },
      })
    ).id;
    tokens.admin = await login(`admin-${suffix}@e2e.test`);
    tokens.a = await login(`a-${suffix}@e2e.test`);
    tokens.b = await login(`b-${suffix}@e2e.test`);
  });

  afterAll(async () => {
    await app?.close();
    external.mockRestore();
  });

  it('admin imports approved templates from Datafy without granting them', async () => {
    const sync = await request(http)
      .post('/admin/whatsapp-templates/sync')
      .set(auth(tokens.admin));
    expect(sync.status).toBe(201);
    expect(sync.body).toMatchObject({ imported: 2, completed: true });
    const list = await request(http)
      .get('/admin/whatsapp-templates')
      .set(auth(tokens.admin));
    const items = (list.body as { items: Array<Record<string, unknown>> })
      .items;
    const supported = items.find((item) => item.name === 'cobranca_real')!;
    const unsupported = items.find((item) => item.name === 'com_imagem')!;
    expect(supported).toMatchObject({
      supported: true,
      grantedCompanies: 0,
      positions: [1, 2],
    });
    expect(unsupported).toMatchObject({ supported: false });
    expect(String(unsupported.supportReason)).toMatch(/HEADER/);
    ids.templateOnlyA = supported.id as string;
    ids.unsupported = unsupported.id as string;
    const listA = await request(http).get('/templates').set(auth(tokens.a));
    expect(listA.body).toEqual({ items: [], nextCursor: null });
  });

  it('admin maps and grants only to A; B cannot list, preview or read it', async () => {
    const preview = await request(http)
      .post(`/admin/whatsapp-templates/${ids.templateOnlyA}/preview`)
      .set(auth(tokens.admin))
      .send({
        mapping: {
          body: {
            '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' },
            '2': { kind: 'SOURCE', source: 'AMOUNT' },
          },
          paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
        },
      });
    expect(preview.body).toMatchObject({
      ok: true,
      body: 'Olá Maria Exemplo, sua cobrança de R$ 150,00 está disponível.',
    });
    const saved = await request(http)
      .put(`/admin/whatsapp-templates/${ids.templateOnlyA}/mapping`)
      .set(auth(tokens.admin))
      .send({
        expectedProviderRevision: 1,
        expectedMappingRevision: 0,
        mapping: {
          body: {
            '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' },
            '2': { kind: 'SOURCE', source: 'AMOUNT' },
          },
          paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
        },
      });
    expect(saved.body).toEqual({ mappingRevision: 1 });
    const grant = await request(http)
      .put(
        `/admin/whatsapp-templates/companies/${ids.a}/grants/${ids.templateOnlyA}`,
      )
      .set(auth(tokens.admin))
      .send({ enabled: true, expectedVersion: 0 });
    expect(grant.body).toEqual({ version: 1 });
    const stale = await request(http)
      .put(
        `/admin/whatsapp-templates/companies/${ids.a}/grants/${ids.templateOnlyA}`,
      )
      .set(auth(tokens.admin))
      .send({ enabled: false, expectedVersion: 0 });
    expect(stale.status).toBe(409);
    const unsupportedGrant = await request(http)
      .put(
        `/admin/whatsapp-templates/companies/${ids.a}/grants/${ids.unsupported}`,
      )
      .set(auth(tokens.admin))
      .send({ enabled: true, expectedVersion: 0 });
    expect(unsupportedGrant.status).toBe(422);

    const listA = await request(http).get('/templates').set(auth(tokens.a));
    const itemsA = (listA.body as { items: Array<Record<string, unknown>> })
      .items;
    expect(itemsA.map((item) => item.id)).toEqual([ids.templateOnlyA]);
    expect(itemsA[0]).not.toHaveProperty('mapping');
    const listB = await request(http).get('/templates').set(auth(tokens.b));
    expect(
      (listB.body as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === ids.templateOnlyA,
      ),
    ).toBe(false);
    const statusOfForeignPreview = (
      await request(http)
        .get(`/templates/${ids.templateOnlyA}/preview`)
        .set(auth(tokens.b))
    ).status;
    expect(statusOfForeignPreview).toBe(404);
    expect(
      (
        await request(http)
          .get(`/templates/${ids.templateOnlyA}`)
          .set(auth(tokens.b))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(http)
          .get(`/templates/${ids.templateOnlyA}/preview`)
          .set(auth(tokens.a))
      ).body,
    ).toMatchObject({ ok: true });
  });

  it('a company cannot grant, map, read the admin catalog or pick another company', async () => {
    const statusOfGrantAsCompany = (
      await request(http)
        .put(
          `/admin/whatsapp-templates/companies/${ids.b}/grants/${ids.templateOnlyA}`,
        )
        .set(auth(tokens.b))
        .send({ enabled: true, expectedVersion: 0 })
    ).status;
    expect(statusOfGrantAsCompany).toBe(403);
    for (const call of [
      () => request(http).get('/admin/whatsapp-templates').set(auth(tokens.a)),
      () =>
        request(http)
          .put(`/admin/whatsapp-templates/${ids.templateOnlyA}/mapping`)
          .set(auth(tokens.a))
          .send({
            expectedProviderRevision: 1,
            expectedMappingRevision: 1,
            mapping: { body: {} },
          }),
      () =>
        request(http)
          .get(`/admin/whatsapp-templates/companies/${ids.a}`)
          .set(auth(tokens.b)),
      () =>
        request(http)
          .post('/admin/whatsapp-templates/sync')
          .set(auth(tokens.a)),
    ])
      expect((await call()).status).toBe(403);
    // The company is always the session's: a companyId query is refused.
    expect(
      (
        await request(http)
          .get(`/templates?companyId=${ids.a}`)
          .set(auth(tokens.b))
      ).status,
    ).toBe(400);
    // The actor is always the session's.
    expect(
      (
        await request(http)
          .put(
            `/admin/whatsapp-templates/companies/${ids.b}/defaults/BEFORE_DUE`,
          )
          .set(auth(tokens.admin))
          .send({
            templateId: null,
            expectedVersion: 0,
            actorUserId: randomUUID(),
          })
      ).status,
    ).toBe(400);
  });

  it('admin sees grants and defaults per company without leaking across companies', async () => {
    const accessA = await request(http)
      .get(`/admin/whatsapp-templates/companies/${ids.a}`)
      .set(auth(tokens.admin));
    expect((accessA.body as { grants: unknown[] }).grants).toEqual([
      expect.objectContaining({
        templateId: ids.templateOnlyA,
        enabled: true,
        version: 1,
        available: { ready: true, code: null },
      }),
    ]);
    const defaultA = await request(http)
      .put(`/admin/whatsapp-templates/companies/${ids.a}/defaults/EMISSION`)
      .set(auth(tokens.admin))
      .send({ templateId: ids.templateOnlyA, expectedVersion: 0 });
    expect(defaultA.body).toEqual({ version: 1 });
    const defaultB = await request(http)
      .put(`/admin/whatsapp-templates/companies/${ids.b}/defaults/EMISSION`)
      .set(auth(tokens.admin))
      .send({ templateId: ids.templateOnlyA, expectedVersion: 0 });
    expect(defaultB.status).toBe(422);
    const accessB = await request(http)
      .get(`/admin/whatsapp-templates/companies/${ids.b}`)
      .set(auth(tokens.admin));
    expect((accessB.body as { grants: unknown[] }).grants).toEqual([]);
    expect(
      (
        (accessB.body as { defaults: unknown[] }).defaults as Array<{
          purpose: string;
          templateId: string | null;
        }>
      ).find((row) => row.purpose === 'EMISSION'),
    ).toMatchObject({ templateId: null, version: 0 });
  });

  it('legacy WhatsApp authoring routes answer 410 and never reach the provider', async () => {
    const statusOfLegacyCreateAsAdmin = (
      await request(http)
        .post('/templates')
        .set(auth(tokens.admin))
        .send({ name: 'x' })
    ).status;
    expect(statusOfLegacyCreateAsAdmin).toBe(410);
    for (const path of [
      `/templates/${ids.templateOnlyA}/submit-meta`,
      `/templates/${ids.templateOnlyA}/review`,
    ])
      expect(
        (await request(http).post(path).set(auth(tokens.admin))).status,
      ).toBe(410);
    expect(
      (
        await request(http)
          .put(`/templates/${ids.templateOnlyA}`)
          .set(auth(tokens.a))
          .send({ greeting: 'Oi' })
      ).status,
    ).toBe(410);
    expect(provider.posts).toEqual([]);
  });

  it('inbox: options follow the selected company; templates never take client parameters', async () => {
    const options = (companyId: string, invoiceId?: string) =>
      request(http)
        .get(
          `/communications/admin/conversations/${ids.conversation}/template-options?companyId=${companyId}${invoiceId ? `&invoiceId=${invoiceId}` : ''}`,
        )
        .set(auth(tokens.admin));
    const optionsForB = (await options(ids.b)).body as {
      templates: Array<{ id: string }>;
      serviceWindow: { open: boolean };
    };
    expect(optionsForB.serviceWindow.open).toBe(false);
    expect(optionsForB.templates.some((t) => t.id === ids.templateOnlyA)).toBe(
      false,
    );
    const optionsForA = (await options(ids.a)).body as {
      templates: Array<{ id: string; usable: boolean; reason: string | null }>;
    };
    // Invoice values are needed: the option is listed but not usable without the invoice.
    expect(optionsForA.templates).toEqual([
      expect.objectContaining({
        id: ids.templateOnlyA,
        usable: false,
        reason: 'VALUE_MISSING',
      }),
    ]);
    const withInvoice = (await options(ids.a, ids.invoiceA)).body as {
      templates: Array<{ usable: boolean; previewBody: string }>;
    };
    expect(withInvoice.templates[0]).toMatchObject({
      usable: true,
      previewBody: 'Olá Pagador A, sua cobrança de R$ 150,00 está disponível.',
    });
    // A's context with B's invoice is refused.
    expect((await options(ids.a, ids.invoiceB)).status).toBe(400);

    const reply = (body: Record<string, unknown>) =>
      request(http)
        .post(
          `/communications/admin/conversations/${ids.conversation}/template-replies`,
        )
        .set(auth(tokens.admin))
        .send(body);
    const base = {
      idempotencyId: randomUUID(),
      templateId: ids.templateOnlyA,
      context: { companyId: ids.a, invoiceId: ids.invoiceA },
    };
    const replyWithClientParameters = await reply({
      ...base,
      parameters: ['Outro nome', 'R$ 1,00'],
    });
    expect(replyWithClientParameters.status).toBe(400);
    const replyWithoutCompany = await reply({
      idempotencyId: randomUUID(),
      templateId: ids.templateOnlyA,
    });
    expect(replyWithoutCompany.status).toBe(400);
    const replyForB = await reply({
      ...base,
      idempotencyId: randomUUID(),
      context: { companyId: ids.b, invoiceId: ids.invoiceB },
    });
    expect(replyForB.status).toBe(422);
    expect(provider.sends).toHaveLength(0);

    // Outside the window a granted template is sent once; the window stays closed.
    const queued = await reply(base);
    expect(queued.status).toBe(201);
    // The application's own BullMQ worker transmits it.
    for (let i = 0; i < 200; i++) {
      const intent = await prisma.communicationOutboundIntent.findFirstOrThrow({
        where: { messageId: (queued.body as { id: string }).id },
      });
      if (intent.state === 'ACCEPTED') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const templateReplyAfterWindow = { providerCalls: provider.sends.length };
    expect(templateReplyAfterWindow.providerCalls).toBe(1);
    expect(provider.sends[0]).toMatchObject({ type: 'template', to: PHONE });
    const again = await reply(base);
    expect((again.body as { id: string }).id).toBe(
      (queued.body as { id: string }).id,
    );
    const conversation =
      await prisma.communicationConversation.findUniqueOrThrow({
        where: { id: ids.conversation },
      });
    expect(conversation.serviceWindowExpiresAt!.getTime()).toBeLessThan(
      Date.now(),
    );
  });

  it('inbox: free text needs the window, also when it closes while queued', async () => {
    const sendsBefore = provider.sends.length;
    const closed = await request(http)
      .post(`/communications/admin/conversations/${ids.conversation}/replies`)
      .set(auth(tokens.admin))
      .send({ idempotencyId: randomUUID(), content: 'Olá' });
    expect(closed.status).toBe(422);
    await prisma.communicationConversation.update({
      where: { id: ids.conversation },
      data: { serviceWindowExpiresAt: new Date(Date.now() + 60_000) },
    });
    // Reserved while open and still waiting in the queue when the window closes.
    const dispatcher = app.get(OutboundDispatcherService, { strict: false });
    const reservation = await dispatcher.prepare(
      {
        companyId: null,
        phoneNumber: PHONE,
        content: 'Olá',
        messageType: 'text',
        origin: 'ADMIN_REPLY',
      },
      `admin-reply:${randomUUID()}`,
    );
    await prisma.communicationConversation.update({
      where: { id: ids.conversation },
      data: { serviceWindowExpiresAt: new Date(Date.now() - 1000) },
    });
    await expect(dispatcher.dispatch(reservation.id)).rejects.toThrow(/janela/);
    const freeTextAfterWindow = {
      providerCalls: provider.sends.length - sendsBefore,
    };
    expect(freeTextAfterWindow.providerCalls).toBe(0);
  });

  it('holds are listed per company; resuming stays with the platform admin', async () => {
    const hold = (companyId: string, invoiceId: string | null) =>
      prisma.whatsappTemplatePendingSend.create({
        data: {
          logicalKey: `collection:${companyId}:${randomUUID()}:WHATSAPP`,
          companyId,
          origin: 'COLLECTION',
          invoiceId,
          templateId: ids.templateOnlyA,
          request: { selection: { mode: 'UNCONFIGURED' } },
          code: 'SELECTION_MISSING',
        },
      });
    const ownHold = await hold(ids.a, ids.invoiceA);
    const foreignHold = await hold(ids.b, null);
    const listA = await request(http)
      .get('/communications/template-pending')
      .set(auth(tokens.a));
    const itemsA = (listA.body as { items: Array<Record<string, unknown>> })
      .items;
    expect(itemsA.map((item) => item.id)).toEqual([ownHold.id]);
    expect(itemsA[0]).not.toHaveProperty('templateId');
    expect(JSON.stringify(listA.body)).not.toContain(foreignHold.id);
    expect(
      (
        await request(http)
          .post('/communications/admin/template-pending/reviews')
          .set(auth(tokens.a))
          .send({ items: [{ pendingId: ownHold.id }] })
      ).status,
    ).toBe(403);
    const adminList = await request(http)
      .get(`/communications/admin/template-pending?companyId=${ids.b}`)
      .set(auth(tokens.admin));
    expect(
      (adminList.body as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      ),
    ).toEqual([foreignHold.id]);
    const summary = await request(http)
      .get('/communications/admin/template-pending/summary')
      .set(auth(tokens.admin));
    expect(summary.body).toEqual(
      expect.arrayContaining([
        {
          companyId: ids.a,
          templateId: ids.templateOnlyA,
          code: 'SELECTION_MISSING',
          count: 1,
        },
      ]),
    );
    const review = await request(http)
      .post('/communications/admin/template-pending/reviews')
      .set(auth(tokens.admin))
      .send({ items: [{ pendingId: ownHold.id }] });
    expect(review.status).toBe(201);
    expect((review.body as { items: unknown[] }).items[0]).toMatchObject({
      pendingId: ownHold.id,
      action: 'KEEP_BLOCKED',
      reason: 'SELECTION_MISSING',
    });
  });
});
