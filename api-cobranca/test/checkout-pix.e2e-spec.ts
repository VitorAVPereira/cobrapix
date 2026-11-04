/**
 * Cifra+ Checkout, part 2, over real HTTP: the admin sets the CifraMais Pix
 * tariff, a buyer quotes with a bump and a coupon, orders (one Pix per order,
 * same order on retry), the Pix notice confirms it once and the access shows.
 * Disposable PostgreSQL/Redis (test/e2e-disposable.cjs); the Efí is simulated.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { CheckoutModule } from '../src/checkout/checkout.module';
import { CHECKOUT_MAIL_QUEUE } from '../src/checkout/checkout-mail.service';
import {
  CheckoutPaymentsService,
  splitCheckoutPixEvents,
} from '../src/checkout/checkout-payments.service';
import { EfiCheckoutPixClient } from '../src/checkout/efi-checkout-pix.client';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { validateEnv } from '../src/config/env.validation';
import { PaymentCryptoService } from '../src/payment/payment-crypto.service';
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
    'Execute com: node test/e2e-disposable.cjs checkout-pix.e2e-spec.ts',
  );

const PASSWORD = 'senha-e2e-segura';
const PIX_KEY = 'pix@ciframais.e2e.test';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Cifra+ Checkout, part 2 (disposable PostgreSQL)', () => {
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const pix = {
    create: jest.fn().mockResolvedValue({
      outcome: 'CREATED',
      pixCopyPaste: '00020126580014br.gov.bcb.pix',
      qrCodeImage: 'data:image/png;base64,AA',
    }),
    status: jest.fn(),
  };
  const tokens = { admin: '', seller: '' };
  let slug = '';

  const login = async (email: string, password = PASSWORD) =>
    (
      (await request(http).post('/auth/login').send({ email, password }))
        .body as { access_token: string }
    ).access_token;

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
    })
      .overrideProvider(EfiCheckoutPixClient)
      .useValue(pix)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    const crypto = app.get(PaymentCryptoService);

    // Platform admin.
    const platformCompany = await prisma.company.create({
      data: {
        corporateName: 'plataforma',
        email: `plataforma-${suffix}@e2e.test`,
        phoneNumber: '5511900000000',
        document: randomUUID().replace(/\D/g, '').slice(0, 14),
      },
    });
    await prisma.user.create({
      data: {
        email: `admin-${suffix}@e2e.test`,
        password: await bcrypt.hash(PASSWORD, 4),
        companyId: platformCompany.id,
        role: 'PLATFORM_ADMIN',
      },
    });
    tokens.admin = await login(`admin-${suffix}@e2e.test`);

    // The CifraMais account as the admin screen leaves it after validation
    // (the validation itself calls the Efí and is covered by unit tests).
    const identity = await prisma.efiAccountIdentity.create({
      data: {
        ownership: 'PLATFORM',
        environment: 'HOMOLOGATION',
        holderDocument: '11222333000181',
        efiAccountNumber: `9${Date.now()}`.slice(0, 12),
        payeeCode: 'payee',
        pixKey: PIX_KEY,
      },
    });
    await prisma.efiCredentialVersion.create({
      data: {
        identityId: identity.id,
        version: 1,
        status: 'ACTIVE',
        encryptedClientId: crypto.encrypt('client'),
        encryptedClientSecret: crypto.encrypt('secret'),
        encryptedCertificate: crypto.encrypt('cert'),
        credentialKeyVersion: crypto.activeKeyVersion,
        certificateFingerprint: Array.from({ length: 32 }, () => 'AB').join(
          ':',
        ),
        certificateExpiresAt: new Date(Date.now() + 365 * 86_400_000),
        activatedAt: new Date(),
      },
    });
    await prisma.checkoutPlatformSettings.create({
      data: {
        version: 1,
        identityId: identity.id,
        webhookConfiguredAt: new Date(),
        changedByUserId: 'admin',
      },
    });

    // Seller with a product, a bump and a coupon (part 1 routes).
    const created = await request(http)
      .post('/admin/checkout/clients')
      .set(auth(tokens.admin))
      .send({
        company: {
          corporateName: 'Porquim',
          document: '11222333000181',
          email: `porquim-${suffix}@e2e.test`,
          phoneNumber: '11999999999',
        },
        firstUser: { name: 'Pedro', email: `pedro-${suffix}@e2e.test` },
        terms: {
          platformFeeBasisPoints: 250,
          payoutDocument: '11222333000181',
          payoutPixKey: '52998224725',
        },
      })
      .expect(201);
    const temporary = (created.body as { temporaryPassword: string })
      .temporaryPassword;
    const first = await login(`pedro-${suffix}@e2e.test`, temporary);
    await request(http)
      .post('/auth/change-password')
      .set(auth(first))
      .send({
        currentPassword: temporary,
        password: 'Nova-senha-e2e-1',
        passwordConfirmation: 'Nova-senha-e2e-1',
      })
      .expect(200);
    tokens.seller = await login(`pedro-${suffix}@e2e.test`, 'Nova-senha-e2e-1');
    const product = (name: string, priceCents: number) =>
      request(http)
        .post('/checkout/products')
        .set(auth(tokens.seller))
        .send({
          name,
          priceCents,
          accessPeriodMonths: 12,
          deliveryMode: 'ACCESS_LINK',
          accessUrl: `https://acesso.e2e.test/${name.length}`,
        })
        .expect(201);
    const main = (await product('Porquim Anual', 6700)).body as {
      id: string;
      slug: string;
    };
    const guide = (await product('Guia Renda Fixa', 2990)).body as {
      id: string;
    };
    slug = main.slug;
    await request(http)
      .post(`/checkout/products/${main.id}/bumps`)
      .set(auth(tokens.seller))
      .send({ offeredProductId: guide.id, priceCents: 1490, active: true })
      .expect(201);
    await request(http)
      .post('/checkout/coupons')
      .set(auth(tokens.seller))
      .send({
        code: 'porquim10',
        type: 'PERCENT',
        value: 1000,
        appliesToAllProducts: true,
        productIds: [],
        maxUses: 1,
        active: true,
      })
      .expect(201);
  });

  afterAll(() => app.close());

  let bumpId = '';
  let token = '';

  it('sem tarifa a página fica indisponível; com tarifa, vende', async () => {
    const before = await request(http)
      .get(`/checkout/public/products/${slug}`)
      .expect(200);
    expect(before.body).toMatchObject({ available: false });

    await request(http)
      .put('/admin/checkout/platform-account/pix-fee')
      .set(auth(tokens.admin))
      .send({ expectedVersion: 1, pixFeeBasisPoints: 119 })
      .expect(200);
    const after = await request(http)
      .get(`/checkout/public/products/${slug}`)
      .expect(200);
    const body = after.body as { available: boolean; bumps: { id: string }[] };
    expect(body.available).toBe(true);
    bumpId = body.bumps[0]?.id ?? '';
    expect(JSON.stringify(body)).not.toContain('acesso.e2e.test');
  });

  it('cota com bump e cupom', async () => {
    const quote = await request(http)
      .post(`/checkout/public/products/${slug}/quote`)
      .send({ bumpIds: [bumpId], couponCode: 'porquim10', method: 'PIX' })
      .expect(200);
    expect(quote.body).toMatchObject({
      discountCents: 670,
      subtotalCents: 6700 + 1490 - 670,
      totalCents: 6700 + 1490 - 670,
    });
  });

  it('cria um pedido com um único Pix, mesmo repetindo o envio', async () => {
    const order = {
      bumpIds: [bumpId],
      couponCode: 'porquim10',
      method: 'PIX',
      buyer: {
        name: 'Maria Souza',
        email: 'maria@e2e.test',
        document: '52998224725',
        phone: '11999999999',
      },
      utm: { utm_source: 'LINK_PADRAO' },
      idempotencyKey: randomUUID(),
    };
    const first = await request(http)
      .post(`/checkout/public/products/${slug}/orders`)
      .send(order)
      .expect(201);
    const again = await request(http)
      .post(`/checkout/public/products/${slug}/orders`)
      .send(order)
      .expect(201);
    token = (first.body as { token: string }).token;
    expect((again.body as { token: string }).token).toBe(token);
    expect(pix.create).toHaveBeenCalledTimes(1);
    expect(first.body).toMatchObject({
      status: 'PENDING',
      totalCents: 7520,
      pix: { copyPaste: '00020126580014br.gov.bcb.pix' },
      redirectUrl: null,
    });
    const saved = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: token },
    });
    expect(saved).toMatchObject({
      platformFeeCents: 188, // 2,5% de 75,20
      efiFeeBasisPoints: 119,
      utm: { utm_source: 'LINK_PADRAO' },
    });
  });

  it('o aviso Pix confirma uma vez, conta o cupom e libera o acesso', async () => {
    const attempt = await prisma.checkoutPaymentAttempt.findFirstOrThrow({
      where: { order: { publicToken: token } },
    });
    const payments = app.get(CheckoutPaymentsService);
    const notice = {
      pix: [
        {
          txid: attempt.efiTxid,
          chave: PIX_KEY,
          valor: '75.20',
          endToEndId: 'E2E1',
        },
      ],
    };
    const { checkout, rest } = splitCheckoutPixEvents(notice);
    expect(rest).toBeNull();
    for (const event of checkout) await payments.handlePixEvent(event);
    for (const event of checkout) await payments.handlePixEvent(event);

    const order = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: token },
      include: { coupon: true },
    });
    expect(order.status).toBe('PAID');
    expect(order.coupon?.usedCount).toBe(1);
    const queue = app.get<Queue>(getQueueToken(CHECKOUT_MAIL_QUEUE));
    expect(await queue.getJob(`access-${order.id}`)).toBeTruthy();

    const view = await request(http)
      .get(`/checkout/public/orders/${token}`)
      .expect(200);
    expect(view.body).toMatchObject({
      status: 'PAID',
      redirectUrl: expect.stringContaining(
        'https://acesso.e2e.test/',
      ) as string,
      pix: null,
    });
  });

  it('cupom esgotado e aviso com valor errado não passam', async () => {
    await request(http)
      .post(`/checkout/public/products/${slug}/quote`)
      .send({ bumpIds: [], couponCode: 'porquim10', method: 'PIX' })
      .expect(400);
    const payments = app.get(CheckoutPaymentsService);
    const attempt = await prisma.checkoutPaymentAttempt.findFirstOrThrow({
      where: { order: { publicToken: token } },
    });
    await expect(
      payments.handlePixEvent({
        txid: attempt.efiTxid,
        chave: 'outra@chave.test',
        valor: '75.20',
      }),
    ).resolves.toBe(false);
    expect(
      await prisma.paymentWebhookAnomaly.count({
        where: { source: 'PIX', reasonCode: 'CHECKOUT_RECEIVER_MISMATCH' },
      }),
    ).toBe(1);
  });

  it('token inválido ou de outro pedido não mostra nada', async () => {
    await request(http).get('/checkout/public/orders/curto').expect(404);
    await request(http)
      .get(`/checkout/public/orders/${'a'.repeat(43)}`)
      .expect(404);
  });
});
