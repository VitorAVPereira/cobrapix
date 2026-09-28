/**
 * Shared harness of the template e2e specs: the Nest app with the real HTTP pipeline and
 * BullMQ worker, a Datafy fake at `fetch`, and a platform admin plus companies A and B.
 * Only for test/e2e-disposable.cjs, which provides fresh PostgreSQL and Redis.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AdminModule } from '../../src/admin/admin.module';
import { AuthModule } from '../../src/auth/auth.module';
import { BillingModule } from '../../src/billing/billing.module';
import { CommunicationsModule } from '../../src/communications/communications.module';
import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { validateEnv } from '../../src/config/env.validation';
import { EfiOnboardingModule } from '../../src/efi-onboarding/efi-onboarding.module';
import { EmailModule } from '../../src/email/email.module';
import { InvoicesModule } from '../../src/invoices/invoices.module';
import { PaymentModule } from '../../src/payment/payment.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { BullInfrastructureModule } from '../../src/queue/bull-infrastructure.module';
import { TemplatesModule } from '../../src/templates/templates.module';
import { TemplateSendModule } from '../../src/templates/template-send.module';
import { WhatsappModule } from '../../src/whatsapp/whatsapp.module';

// Own channel: the per-channel sender limit (60/h) lives in the Redis shared by the
// specs of one run, so specs on another channel never consume this one's budget.
export const CHANNEL = '444';
export const WABA = '111';
export const FRONTEND = 'https://app.e2e.test';
const PASSWORD = 'senha-e2e-segura';

export const MAPPING = {
  body: {
    '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' },
    '2': { kind: 'SOURCE', source: 'AMOUNT' },
  },
  paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
};

export const CATALOG = [
  {
    id: '777001',
    name: 'lembrete_real',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'UTILITY',
    parameter_format: 'POSITIONAL',
    components: [
      {
        type: 'BODY',
        text: 'Olá {{1}}, sua cobrança de {{2}} vence em breve.',
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Pagar', url: `${FRONTEND}/pagar/{{1}}` },
        ],
      },
    ],
  },
  // Same shape as templates written with names in the WhatsApp Manager.
  {
    id: '777002',
    name: 'emissao_nomeada',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    components: [
      {
        type: 'BODY',
        text: 'Olá, {{nome_devedor}}. Sua cobrança da empresa {{nome_empresa}}, no valor de {{valor}}, vence em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}',
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Link do pagamento',
            url: `${FRONTEND}/pagar/{{1}}`,
          },
          { type: 'QUICK_REPLY', text: 'Preciso de ajuda' },
        ],
      },
    ],
  },
];

export function assertDisposable(spec: string): void {
  if (
    !process.env.CIFRAMAIS_DISPOSABLE_E2E ||
    !/^postgresql:\/\/postgres:[a-f0-9]+@127\.0\.0\.1:\d+\/ciframais_e2e$/.test(
      process.env.DATABASE_URL ?? '',
    )
  )
    throw new Error(`Execute com: node test/e2e-disposable.cjs ${spec}`);
}

/** Datafy fake: `/me`, the catalog and message sends; anything else is refused. */
export function fakeDatafy() {
  const provider = { sends: [] as Array<Record<string, unknown>> };
  const spy = jest
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
        return Promise.reject(
          new Error(`Unexpected external call: ${url.href}`),
        );
      if (
        init?.method === 'POST' &&
        url.pathname === `/v1/${CHANNEL}/messages`
      ) {
        provider.sends.push(
          JSON.parse(init.body as string) as Record<string, unknown>,
        );
        return Promise.resolve(
          Response.json({
            messages: [{ id: `wamid.e2e.${randomUUID()}` }],
          }),
        );
      }
      if (init?.method === 'POST')
        return Promise.reject(new Error('No provider write expected'));
      if (url.pathname === '/me')
        return Promise.resolve(
          Response.json({ phone_number_id: CHANNEL, waba_id: WABA }),
        );
      if (url.pathname === `/v1/${WABA}/message_templates`)
        return Promise.resolve(Response.json({ data: CATALOG }));
      return Promise.reject(new Error(`Unexpected external call: ${url.href}`));
    });
  return { provider, restore: () => spy.mockRestore() };
}

export async function createTemplateApp(): Promise<INestApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'e2e_jwt_secret_with_at_least_32_characters',
    PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: 'd'.repeat(64) }),
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
      // No ScheduleModule: recovery runs when the test calls it.
      BullInfrastructureModule,
      PrismaModule,
      AuthModule,
      WhatsappModule,
      InvoicesModule,
      BillingModule,
      PaymentModule,
      TemplatesModule,
      TemplateSendModule,
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
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

export interface Tenants {
  tokens: { admin: string; a: string; b: string };
  a: string;
  b: string;
  debtorA: string;
}

/** Platform admin and two companies, each with its own admin user and JWT. */
export async function seedTenants(
  app: INestApplication,
  phoneA: string,
): Promise<Tenants> {
  const prisma = app.get(PrismaService);
  const http = app.getHttpServer() as Server;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const suffix = randomUUID().slice(0, 8);
  const company = (name: string) =>
    prisma.company.create({
      data: {
        corporateName: name,
        email: `${name}-${suffix}@e2e.test`,
        phoneNumber: '5511900000000',
        document: randomUUID().replace(/-/g, '').slice(0, 14),
      },
    });
  const platform = await company('plataforma');
  const a = await company('empresa-a');
  const b = await company('empresa-b');
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
      phoneNumber: `+${phoneA}`,
      whatsappOptIn: true,
    },
  });
  const login = async (email: string) =>
    (
      (
        await request(http)
          .post('/auth/login')
          .send({ email, password: PASSWORD })
      ).body as { access_token: string }
    ).access_token;
  return {
    tokens: {
      admin: await login(`admin-${suffix}@e2e.test`),
      a: await login(`a-${suffix}@e2e.test`),
      b: await login(`b-${suffix}@e2e.test`),
    },
    a: a.id,
    b: b.id,
    debtorA: debtor.id,
  };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Admin imports the catalog and maps the real template; nothing is granted. */
export async function importAndMap(
  app: INestApplication,
  adminToken: string,
): Promise<string> {
  const http = app.getHttpServer() as Server;
  await request(http)
    .post('/admin/whatsapp-templates/sync')
    .set(auth(adminToken))
    .expect(201);
  const list = await request(http)
    .get('/admin/whatsapp-templates')
    .set(auth(adminToken));
  // Specs of one run share the database: map against the revisions seen now.
  const item = (
    list.body as {
      items: Array<{
        id: string;
        name: string;
        providerRevision: number;
        mappingRevision: number;
      }>;
    }
  ).items.find((row) => row.name === CATALOG[0]!.name)!;
  await request(http)
    .put(`/admin/whatsapp-templates/${item.id}/mapping`)
    .set(auth(adminToken))
    .send({
      expectedProviderRevision: item.providerRevision,
      expectedMappingRevision: item.mappingRevision,
      mapping: MAPPING,
    })
    .expect(200);
  return item.id;
}

export async function setGrant(
  app: INestApplication,
  adminToken: string,
  companyId: string,
  templateId: string,
  enabled: boolean,
): Promise<void> {
  const prisma = app.get(PrismaService);
  const current = await prisma.companyWhatsappTemplateGrant.findUnique({
    where: { companyId_templateId: { companyId, templateId } },
  });
  await request(app.getHttpServer() as Server)
    .put(
      `/admin/whatsapp-templates/companies/${companyId}/grants/${templateId}`,
    )
    .set(auth(adminToken))
    .send({ enabled, expectedVersion: current?.version ?? 0 })
    .expect(200);
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for a state written by the app's own worker. */
export async function untilState(
  prisma: PrismaService,
  intentId: string,
  state: string,
): Promise<void> {
  for (let i = 0; i < 300; i++) {
    const intent = await prisma.communicationOutboundIntent.findUniqueOrThrow({
      where: { id: intentId },
    });
    if (intent.state === state) return;
    await sleep(100);
  }
  throw new Error(`intent ${intentId} did not reach ${state}`);
}
