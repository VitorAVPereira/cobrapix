/**
 * Cifra+ Checkout, part 1, over real HTTP and JWT: the admin creates checkout clients,
 * a seller sets up the page, products, order bumps and coupons, and each company stays
 * inside its own product and data. Disposable PostgreSQL/Redis (test/e2e-disposable.cjs).
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
import { CheckoutModule } from '../src/checkout/checkout.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { validateEnv } from '../src/config/env.validation';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BullInfrastructureModule } from '../src/queue/bull-infrastructure.module';

jest.setTimeout(180_000);

if (
  !process.env.CIFRAMAIS_DISPOSABLE_E2E ||
  !/^postgresql:\/\/postgres:[a-f0-9]+@127\.0\.0\.1:\d+\/ciframais_e2e$/.test(
    process.env.DATABASE_URL ?? '',
  )
)
  throw new Error(
    'Execute com: node test/e2e-disposable.cjs checkout-base.e2e-spec.ts',
  );

const PASSWORD = 'senha-e2e-segura';
const NEW_PASSWORD = 'Nova-senha-e2e-1';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Cifra+ Checkout, part 1 (disposable PostgreSQL)', () => {
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  const tokens = { admin: '', billing: '', seller: '', other: '' };
  const suffix = randomUUID().slice(0, 8);

  const login = async (email: string, password = PASSWORD) =>
    (
      (await request(http).post('/auth/login').send({ email, password }))
        .body as { access_token: string }
    ).access_token;

  /** Admin creates a checkout client; its user changes the temporary password. */
  async function checkoutClient(name: string, document: string) {
    const created = await request(http)
      .post('/admin/checkout/clients')
      .set(auth(tokens.admin))
      .send({
        company: {
          corporateName: name,
          document,
          email: `${name}-${suffix}@e2e.test`,
          phoneNumber: '11999999999',
        },
        firstUser: { name, email: `user-${name}-${suffix}@e2e.test` },
        terms: {
          platformFeeBasisPoints: 250,
          payoutDocument: document,
          payoutPixKey: '52998224725',
        },
      })
      .expect(201);
    const body = created.body as {
      client: { id: string };
      temporaryPassword: string;
    };
    const email = `user-${name}-${suffix}@e2e.test`;
    const first = await login(email, body.temporaryPassword);
    await request(http)
      .post('/auth/change-password')
      .set(auth(first))
      .send({
        currentPassword: body.temporaryPassword,
        password: NEW_PASSWORD,
        passwordConfirmation: NEW_PASSWORD,
      })
      .expect(200);
    return { id: body.client.id, token: await login(email, NEW_PASSWORD) };
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      JWT_SECRET: 'e2e_jwt_secret_with_at_least_32_characters',
      PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: 'd'.repeat(64) }),
      PAYMENT_ACTIVE_KEY_VERSION: 'v1',
      EFI_WEBHOOK_SECRET: 'e2e_efi_webhook_secret_with_32_characters',
      EFI_WEBHOOK_BASE_URL: 'https://webhooks.e2e.test',
      FRONTEND_URL: 'https://app.e2e.test',
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
        InvoicesModule,
        CheckoutModule,
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
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    const hash = await bcrypt.hash(PASSWORD, 4);
    for (const [name, role] of [
      ['plataforma', 'PLATFORM_ADMIN'],
      ['cobranca', 'COMPANY_ADMIN'],
    ] as const) {
      const company = await prisma.company.create({
        data: {
          corporateName: name,
          email: `${name}-${suffix}@e2e.test`,
          phoneNumber: '5511900000000',
          document: randomUUID().replace(/\D/g, '').slice(0, 14),
        },
      });
      await prisma.user.create({
        data: {
          email: `${name}-${suffix}@e2e.test`,
          password: hash,
          companyId: company.id,
          role,
        },
      });
    }
    tokens.admin = await login(`plataforma-${suffix}@e2e.test`);
    tokens.billing = await login(`cobranca-${suffix}@e2e.test`);
  });

  afterAll(() => app.close());

  let seller: { id: string; token: string };
  let other: { id: string; token: string };
  let mainId = '';
  let offeredId = '';

  it('admin cria clientes de checkout; a lista de cobrança não os mostra', async () => {
    seller = await checkoutClient('treze', '11222333000181');
    other = await checkoutClient('outra', '52998224725');
    tokens.seller = seller.token;
    tokens.other = other.token;

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: seller.id },
      select: { product: true, checkoutSettings: true },
    });
    expect(company.product).toBe('CHECKOUT');
    expect(company.checkoutSettings?.displayName).toBe('treze');

    const session = await request(http)
      .post('/auth/session')
      .set(auth(tokens.seller))
      .expect(200);
    expect(session.body).toMatchObject({
      user: { companyProduct: 'CHECKOUT' },
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: seller.id, action: 'CHECKOUT_CLIENT_CREATED' },
    });
    expect(JSON.stringify(audit.changes)).not.toContain('11222333000181');
  });

  it('cada empresa fica no próprio produto (404 no outro)', async () => {
    await request(http)
      .get('/checkout/settings')
      .set(auth(tokens.billing))
      .expect(404);
    await request(http).get('/invoices').set(auth(tokens.seller)).expect(404);
    await request(http).get('/invoices').set(auth(tokens.billing)).expect(200);
  });

  it('o vendedor configura a página com imagem própria; cartão continua bloqueado', async () => {
    const upload = await request(http)
      .post('/checkout/assets')
      .set(auth(tokens.seller))
      .field('kind', 'LOGO')
      .attach('file', PNG, 'logo.png')
      .expect(201);
    const logo = upload.body as { id: string };
    const publicImage = await request(http)
      .get(`/checkout/public/assets/${logo.id}`)
      .expect(200);
    expect(publicImage.headers['content-type']).toBe('image/png');

    await request(http)
      .post('/checkout/assets')
      .set(auth(tokens.seller))
      .field('kind', 'LOGO')
      .attach('file', Buffer.from('<svg/>'), 'logo.png')
      .expect(400);

    const settings = {
      expectedVersion: 1,
      displayName: 'Porquim',
      logoAssetId: logo.id,
      bannerAssetId: null,
      primaryColor: '#0f766e',
      supportEmail: 'suporte@porquim.test',
      supportWhatsapp: '11999999999',
      whatsappButtonPhone: null,
      pixEnabled: true,
      cardEnabled: false,
      maxInstallments: 12,
      pixFeePayer: 'SELLER',
      cardFeePayer: 'BUYER',
    };
    await request(http)
      .put('/checkout/settings')
      .set(auth(tokens.seller))
      .send(settings)
      .expect(200);
    const stale = await request(http)
      .put('/checkout/settings')
      .set(auth(tokens.seller))
      .send(settings)
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CHANGED' });
    await request(http)
      .put('/checkout/settings')
      .set(auth(tokens.seller))
      .send({ ...settings, expectedVersion: 2, cardEnabled: true })
      .expect(409);
    // Another company's image cannot be used.
    await request(http)
      .put('/checkout/settings')
      .set(auth(tokens.other))
      .send({ ...settings, expectedVersion: 1 })
      .expect(404);
  });

  it('produtos, order bump e cupom ficam presos à empresa', async () => {
    const product = (name: string) => ({
      name,
      priceCents: 6700,
      compareAtPriceCents: 9700,
      accessPeriodMonths: 12,
      deliveryMode: 'ACCESS_LINK',
      accessUrl: 'https://porquim.test/acesso',
    });
    mainId = (
      (
        await request(http)
          .post('/checkout/products')
          .set(auth(tokens.seller))
          .send(product('Porquim Anual'))
          .expect(201)
      ).body as { id: string }
    ).id;
    offeredId = (
      (
        await request(http)
          .post('/checkout/products')
          .set(auth(tokens.seller))
          .send(product('Guia Renda Fixa'))
          .expect(201)
      ).body as { id: string }
    ).id;

    const withBump = await request(http)
      .post(`/checkout/products/${mainId}/bumps`)
      .set(auth(tokens.seller))
      .send({
        offeredProductId: offeredId,
        priceCents: 1490,
        compareAtPriceCents: 2990,
        headline: 'GUIA COM 50% OFF',
        active: true,
      })
      .expect(201);
    expect(
      (withBump.body as { bumps: Array<{ position: number }> }).bumps,
    ).toHaveLength(1);

    await request(http)
      .post('/checkout/coupons')
      .set(auth(tokens.seller))
      .send({
        code: 'porquim10',
        type: 'PERCENT',
        value: 1000,
        appliesToAllProducts: false,
        productIds: [mainId],
        active: true,
      })
      .expect(201);

    // The other checkout company sees nothing and cannot point at these records.
    await request(http)
      .get(`/checkout/products/${mainId}`)
      .set(auth(tokens.other))
      .expect(404);
    const otherList = await request(http)
      .get('/checkout/products')
      .set(auth(tokens.other))
      .expect(200);
    expect(otherList.body).toEqual([]);
    const otherProduct = (
      (
        await request(http)
          .post('/checkout/products')
          .set(auth(tokens.other))
          .send(product('Outro'))
          .expect(201)
      ).body as { id: string }
    ).id;
    await request(http)
      .post(`/checkout/products/${otherProduct}/bumps`)
      .set(auth(tokens.other))
      .send({ offeredProductId: offeredId, priceCents: 1000, active: true })
      .expect(404);
    await request(http)
      .post('/checkout/coupons')
      .set(auth(tokens.other))
      .send({
        code: 'porquim10',
        type: 'FIXED',
        value: 500,
        appliesToAllProducts: false,
        productIds: [mainId],
        active: true,
      })
      .expect(404);
    // The same code is free in another company.
    await request(http)
      .post('/checkout/coupons')
      .set(auth(tokens.other))
      .send({
        code: 'porquim10',
        type: 'FIXED',
        value: 500,
        appliesToAllProducts: true,
        productIds: [],
        active: true,
      })
      .expect(201);
  });

  it('nome novo não muda o link e versão antiga responde 409', async () => {
    const before = await prisma.checkoutProduct.findUniqueOrThrow({
      where: { id: mainId },
    });
    await request(http)
      .put(`/checkout/products/${mainId}`)
      .set(auth(tokens.seller))
      .send({
        name: 'Porquim Anual Promo',
        priceCents: 6700,
        deliveryMode: 'ACCESS_LINK',
        accessUrl: 'https://porquim.test/acesso',
        expectedVersion: before.version,
      })
      .expect(200);
    const stale = await request(http)
      .put(`/checkout/products/${mainId}`)
      .set(auth(tokens.seller))
      .send({
        name: 'Outro nome',
        priceCents: 6700,
        deliveryMode: 'ACCESS_LINK',
        accessUrl: 'https://porquim.test/acesso',
        expectedVersion: before.version,
      })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CHANGED' });
    const after = await prisma.checkoutProduct.findUniqueOrThrow({
      where: { id: mainId },
    });
    expect(after.slug).toBe(before.slug);
    expect(after.name).toBe('Porquim Anual Promo');
  });

  it('os termos ganham versão nova; versão antiga responde 409', async () => {
    const terms = {
      platformFeeBasisPoints: 300,
      payoutDocument: '11222333000181',
      payoutPixKey: 'financeiro@treze.test',
    };
    await request(http)
      .put(`/admin/checkout/clients/${seller.id}/terms`)
      .set(auth(tokens.admin))
      .send({ ...terms, expectedVersion: 1 })
      .expect(200);
    await request(http)
      .put(`/admin/checkout/clients/${seller.id}/terms`)
      .set(auth(tokens.admin))
      .send({ ...terms, expectedVersion: 1 })
      .expect(409);
    const versions = await prisma.checkoutSellerTerms.findMany({
      where: { companyId: seller.id },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((row) => row.platformFeeBasisPoints)).toEqual([
      250, 300,
    ]);
    // A seller cannot reach the admin routes.
    await request(http)
      .get('/admin/checkout/clients')
      .set(auth(tokens.seller))
      .expect(404);
  });
});
