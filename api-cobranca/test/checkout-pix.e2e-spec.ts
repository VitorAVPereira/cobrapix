/**
 * Cifra+ Checkout, part 2, over real HTTP: the admin sets the CifraMais Pix
 * tariff, a buyer quotes with a bump and a coupon, orders (one Pix per order,
 * same order on retry), the Pix notice confirms it once and the access shows.
 * Disposable PostgreSQL/Redis (test/e2e-disposable.cjs); the Efí is simulated.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { CheckoutWebhookSender } from '../src/checkout/checkout-webhook.sender';
import { CheckoutOrdersService } from '../src/checkout/checkout-orders.service';
import { CheckoutRecoveryService } from '../src/checkout/checkout-recovery.service';
import { CheckoutCardService } from '../src/checkout/checkout-card.service';
import { EfiCheckoutCardClient } from '../src/checkout/efi-checkout-card.client';
import { itemShares, type OrderItem } from '../src/checkout/checkout-pricing';
import { CheckoutWebhooksService } from '../src/checkout/checkout-webhooks.service';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ThrottleGuard } from '../src/common/guards/throttle.guard';
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
  // The Efí card API: no interest, the total split in equal installments.
  const cardClient = {
    installmentCounts: jest.fn().mockResolvedValue([1, 2, 3, 4]),
    installmentValue: jest.fn(
      (_account: unknown, total: number, _brand: string, count: number) =>
        Promise.resolve(Math.ceil(total / count)),
    ),
    submit: jest.fn(),
    detail: jest.fn(),
    findByAttempt: jest.fn().mockResolvedValue([]),
    notification: jest.fn(),
  };
  const tokens = { admin: '', seller: '' };
  // The real limits, with a handle to start a scenario fresh (one IP here).
  const throttle = new ThrottleGuard(new ConfigService({ NODE_ENV: 'test' }));
  // The seller system: always answers 200 unless a test says otherwise.
  const webhookSender = {
    send: jest.fn().mockResolvedValue({ ok: true, statusCode: 200 }),
  };
  let webhookSecret = '';
  let webhookRuleId = '';
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
      EFI_CHARGES_WEBHOOK_BASE_URL: 'https://webhooks.e2e.test',
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
      .overrideProvider(CheckoutWebhookSender)
      .useValue(webhookSender)
      .overrideProvider(EfiCheckoutCardClient)
      .useValue(cardClient)
      .overrideGuard(ThrottleGuard)
      .useValue(throttle)
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
    // This seller sells through the CifraMais account, like the ones that
    // started before the seller's own account existed. The admin can no
    // longer create one this way, so the terms are written directly.
    await prisma.checkoutSellerTerms.updateMany({
      where: {
        companyId: (created.body as { client: { id: string } }).client.id,
      },
      data: {
        accountMode: 'PLATFORM_ACCOUNT',
        payoutDocument: '11222333000181',
        payoutPixKey: '52998224725',
      },
    });
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
    const hook = await request(http)
      .post('/checkout/webhooks')
      .set(auth(tokens.seller))
      .send({
        name: 'Área de membros',
        url: 'https://hooks.porquim.e2e.test/cifra',
      })
      .expect(201);
    webhookSecret = (hook.body as { secret: string }).secret;
    webhookRuleId = (hook.body as { id: string }).id;
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

  // Part 3: balance, refunds, payouts and adjustments on the same sale.
  it('a venda paga entra no saldo a liberar, com tarifa e % Cifra+', async () => {
    const balance = await request(http)
      .get('/checkout/balance')
      .set(auth(tokens.seller))
      .expect(200);
    // 75,20 − tarifa estimada (1,19% = 0,89) − 2,5% de 75,20 (1,88)
    expect(balance.body).toMatchObject({
      pendingCents: 7520 - 89 - 188,
      releasedCents: 0,
    });
    const sales = await request(http)
      .get('/checkout/sales')
      .set(auth(tokens.seller))
      .expect(200);
    expect(sales.body).toMatchObject({
      total: 1,
      items: [{ totalCents: 7520, netCents: 7520 - 89 - 188, status: 'PAID' }],
    });
  });

  it('comprador pede reembolso e o aviso de devolução da Efí fecha o pedido', async () => {
    await request(http)
      .post(`/checkout/public/orders/${token}/refund-request`)
      .send({ reason: 'Não era o que eu esperava' })
      .expect(201);
    await request(http)
      .post(`/checkout/public/orders/${token}/refund-request`)
      .send({ reason: 'De novo, por favor' })
      .expect(409);

    const attempt = await prisma.checkoutPaymentAttempt.findFirstOrThrow({
      where: { order: { publicToken: token } },
    });
    const payments = app.get(CheckoutPaymentsService);
    const devolucao = {
      txid: attempt.efiTxid,
      chave: PIX_KEY,
      valor: '75.20',
      endToEndId: 'E2E1',
      devolucoes: [{ id: 'D1', valor: '75.20', status: 'DEVOLVIDO' }],
    };
    await payments.handlePixEvent(devolucao);
    await payments.handlePixEvent(devolucao);

    const order = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: token },
      include: { refundRequests: true, ledgerEntries: true },
    });
    expect(order.status).toBe('REFUNDED');
    expect(order.refundRequests[0]?.status).toBe('DONE');
    expect(
      order.ledgerEntries.filter((entry) => entry.kind === 'REFUND'),
    ).toHaveLength(1);
    // The seller keeps only the Efí tariff as cost: the Cifra+ % came back.
    const balance = await request(http)
      .get('/checkout/balance')
      .set(auth(tokens.seller))
      .expect(200);
    expect(balance.body).toMatchObject({
      releasedCents: -7520 + 188,
      pendingCents: 7520 - 89 - 188,
    });
  });

  it('o admin registra repasse e ajuste uma vez só; o vendedor não vê o financeiro do admin', async () => {
    const company = await prisma.company.findFirstOrThrow({
      where: { email: `porquim-${suffix}@e2e.test` },
    });
    const payout = {
      idempotencyKey: randomUUID(),
      amountCents: 1000,
      paidOn: '2026-11-05',
      reference: 'comprovante-1',
    };
    const first = await request(http)
      .post(`/admin/checkout/clients/${company.id}/payouts`)
      .set(auth(tokens.admin))
      .send(payout)
      .expect(201);
    expect((first.body as { warning: string | null }).warning).toMatch(
      /negativo/,
    );
    await request(http)
      .post(`/admin/checkout/clients/${company.id}/payouts`)
      .set(auth(tokens.admin))
      .send(payout)
      .expect(201);
    await request(http)
      .post(`/admin/checkout/clients/${company.id}/adjustments`)
      .set(auth(tokens.admin))
      .send({
        idempotencyKey: randomUUID(),
        amountCents: 500,
        note: 'Crédito de cortesia',
      })
      .expect(201);

    const finance = await request(http)
      .get(`/admin/checkout/clients/${company.id}/finance`)
      .set(auth(tokens.admin))
      .expect(200);
    const body = finance.body as {
      balance: { paidOutCents: number };
      entries: { kind: string }[];
      refundRequests: { status: string }[];
    };
    expect(body.balance.paidOutCents).toBe(1000);
    expect(body.entries.map((entry) => entry.kind).sort()).toEqual([
      'ADJUSTMENT',
      'PAYOUT',
    ]);
    expect(body.refundRequests[0]?.status).toBe('DONE');

    await request(http)
      .get(`/admin/checkout/clients/${company.id}/finance`)
      .set(auth(tokens.seller))
      .expect(404);
  });
  // Part 4: every event above went to the seller webhook, once each.
  it('o sistema do vendedor recebe cada evento da venda, uma vez', async () => {
    const webhooks = app.get(CheckoutWebhooksService);
    await webhooks.deliverDue(new Date(Date.now() + 60_000));

    const history = await request(http)
      .get(`/checkout/webhooks/${webhookRuleId}/deliveries`)
      .set(auth(tokens.seller))
      .expect(200);
    const items = (
      history.body as { items: { eventType: string; status: string }[] }
    ).items;
    expect(items.map((item) => item.eventType).sort()).toEqual([
      'order.created',
      'order.paid',
      'order.refunded',
      'refund.requested',
    ]);
    expect(items.every((item) => item.status === 'DELIVERED')).toBe(true);
    // History never carries the body (buyer data).
    expect(JSON.stringify(history.body)).not.toContain('52998224725');

    const paid = webhookSender.send.mock.calls
      .map((call) => call as unknown[])
      .find((call) => (call[1] as { type: string }).type === 'order.paid');
    const body = JSON.parse(String(paid?.[2])) as {
      data: {
        order: { items: { kind: string; accessExpiresAt: string | null }[] };
      };
    };
    expect(body.data.order.items.map((line) => line.kind)).toEqual([
      'MAIN',
      'BUMP',
    ]);
    expect(body.data.order.items[0]?.accessExpiresAt).toEqual(
      expect.any(String),
    );
    expect(paid?.[0]).toEqual({
      url: 'https://hooks.porquim.e2e.test/cifra',
      secret: webhookSecret,
    });

    // A second worker pass sends nothing again.
    const sent = webhookSender.send.mock.calls.length;
    await webhooks.deliverDue(new Date(Date.now() + 120_000));
    expect(webhookSender.send.mock.calls.length).toBe(sent);
  });

  it('falha volta para a fila e o reenvio manual repete o mesmo evento', async () => {
    const webhooks = app.get(CheckoutWebhooksService);
    webhookSender.send.mockResolvedValueOnce({
      ok: false,
      statusCode: 500,
      error: 'HTTP_STATUS',
    });
    const test = await request(http)
      .post(`/checkout/webhooks/${webhookRuleId}/test`)
      .set(auth(tokens.seller))
      .expect(201);
    const delivery = test.body as {
      id: string;
      eventId: string;
      status: string;
    };
    expect(delivery.status).toBe('PENDING');

    await webhooks.deliverDue(new Date(Date.now() + 2 * 60_000));
    const history = await request(http)
      .get(`/checkout/webhooks/${webhookRuleId}/deliveries`)
      .set(auth(tokens.seller))
      .expect(200);
    const after = (
      history.body as {
        items: { id: string; status: string; eventId: string }[];
      }
    ).items.find((item) => item.id === delivery.id);
    expect(after).toMatchObject({
      status: 'DELIVERED',
      eventId: delivery.eventId,
    });

    // The other checkout company sees none of these notices.
    const other = await prisma.checkoutWebhookDelivery.count({
      where: { company: { email: { not: `porquim-${suffix}@e2e.test` } } },
    });
    expect(other).toBe(0);
  });

  // Part 5: recovery of people who did not buy.
  const ana = {
    name: 'Ana Lima',
    email: 'ana@e2e.test',
    document: '11144477735',
    phone: '11988887777',
  };
  const leadSession = randomUUID();
  let expiredToken = '';

  it('lead abandonado entra na Recuperação e avisa o sistema do vendedor uma vez', async () => {
    const without = await request(http)
      .post(`/checkout/public/products/${slug}/lead`)
      .send({ sessionKey: randomUUID(), name: 'Sem Contato' })
      .expect(200);
    expect(without.body).toEqual({ saved: false });
    await request(http)
      .post('/checkout/public/products/nao-existe/lead')
      .send({ sessionKey: randomUUID(), email: ana.email })
      .expect(404);

    await request(http)
      .post(`/checkout/public/products/${slug}/lead`)
      .send({ sessionKey: leadSession, email: ana.email })
      .expect(200);
    await request(http)
      .post(`/checkout/public/products/${slug}/lead`)
      .send({
        sessionKey: leadSession,
        name: ana.name,
        email: ana.email,
        phone: ana.phone,
        utm: { utm_source: 'INSTAGRAM' },
      })
      .expect(200);
    expect(
      await prisma.checkoutLead.count({ where: { sessionKey: leadSession } }),
    ).toBe(1);

    // 31 minutes without activity (the worker runs every minute).
    await prisma.checkoutLead.updateMany({
      where: { sessionKey: leadSession },
      data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
    });
    const recovery = app.get(CheckoutRecoveryService);
    await recovery.notifyAbandoned();
    await recovery.notifyAbandoned();
    const notices = await prisma.checkoutWebhookDelivery.findMany({
      where: { eventType: 'lead.abandoned' },
    });
    expect(notices).toHaveLength(1);
    expect(JSON.stringify(notices[0]?.payload)).toContain(ana.email);

    const list = await request(http)
      .get('/checkout/recovery?kind=LEAD')
      .set(auth(tokens.seller))
      .expect(200);
    expect(
      (list.body as { items: { name: string; reason: string }[] }).items,
    ).toEqual([
      expect.objectContaining({
        name: ana.name,
        reason: 'Saiu antes de gerar o Pix',
      }),
    ]);
  });

  it('Pix expirado aparece na lista e a compra depois marca os dois como recuperados', async () => {
    const order = (sessionKey?: string) =>
      request(http)
        .post(`/checkout/public/products/${slug}/orders`)
        .send({
          bumpIds: [],
          method: 'PIX',
          buyer: ana,
          idempotencyKey: randomUUID(),
          ...(sessionKey ? { sessionKey } : {}),
        })
        .expect(201);
    expiredToken = ((await order()).body as { token: string }).token;
    await app
      .get(CheckoutOrdersService)
      .expireOverdue(new Date(Date.now() + 45 * 60_000));

    const open = await request(http)
      .get('/checkout/recovery')
      .set(auth(tokens.seller))
      .expect(200);
    const openItems = (
      open.body as { items: { kind: string; name: string; reason: string }[] }
    ).items.filter((item) => item.name === ana.name);
    expect(openItems.map((item) => [item.kind, item.reason]).sort()).toEqual([
      ['LEAD', 'Saiu antes de gerar o Pix'],
      ['PIX', 'Pix não pago'],
    ]);

    // Ana comes back days later, in a new visit, and pays.
    const visit = randomUUID();
    await request(http)
      .post(`/checkout/public/products/${slug}/lead`)
      .send({ sessionKey: visit, email: ana.email })
      .expect(200);
    const paidToken = ((await order(visit)).body as { token: string }).token;
    const attempt = await prisma.checkoutPaymentAttempt.findFirstOrThrow({
      where: { order: { publicToken: paidToken } },
    });
    await app.get(CheckoutPaymentsService).handlePixEvent({
      txid: attempt.efiTxid,
      chave: PIX_KEY,
      valor: (attempt.amountCents / 100).toFixed(2),
      endToEndId: 'E2E-RECOVERY',
    });
    const paid = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: paidToken },
    });
    expect(paid.status).toBe('PAID');
    // The visit that bought is converted, not "recovered".
    expect(
      await prisma.checkoutLead.findFirstOrThrow({
        where: { sessionKey: visit },
      }),
    ).toMatchObject({ convertedOrderId: paid.id, recoveredByOrderId: null });

    const stillOpen = await request(http)
      .get('/checkout/recovery')
      .set(auth(tokens.seller))
      .expect(200);
    expect(JSON.stringify(stillOpen.body)).not.toContain(ana.email);
    const recovered = await request(http)
      .get('/checkout/recovery?state=RECOVERED')
      .set(auth(tokens.seller))
      .expect(200);
    const recoveredItems = (
      recovered.body as { items: { kind: string; recovered: boolean }[] }
    ).items;
    expect(recoveredItems.map((item) => item.kind).sort()).toEqual([
      'LEAD',
      'PIX',
    ]);
    expect(recoveredItems.every((item) => item.recovered)).toBe(true);
  });

  it('CSV segue os filtros e fica na auditoria, sem os dados pessoais', async () => {
    const csv = await request(http)
      .get('/checkout/recovery.csv?state=RECOVERED&kind=PIX')
      .set(auth(tokens.seller))
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toContain('tipo;motivo;produto;nome;email');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(ana.name);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'CHECKOUT_RECOVERY_EXPORTED' },
    });
    expect(audit.changes).toMatchObject({
      rows: 1,
      kind: 'PIX',
      state: 'RECOVERED',
    });
    expect(JSON.stringify(audit.changes)).not.toContain(ana.email);
  });

  it('outra empresa de checkout não vê a recuperação deste vendedor', async () => {
    const created = await request(http)
      .post('/admin/checkout/clients')
      .set(auth(tokens.admin))
      .send({
        company: {
          corporateName: 'Outra Loja',
          document: '45723174000110',
          email: `outra-${suffix}@e2e.test`,
          phoneNumber: '11988880000',
        },
        firstUser: { name: 'Olga', email: `olga-${suffix}@e2e.test` },
        terms: {
          platformFeeBasisPoints: 250,
          payoutDocument: '45723174000110',
          payoutPixKey: '11144477735',
        },
      })
      .expect(201);
    const temporary = (created.body as { temporaryPassword: string })
      .temporaryPassword;
    const first = await login(`olga-${suffix}@e2e.test`, temporary);
    await request(http)
      .post('/auth/change-password')
      .set(auth(first))
      .send({
        currentPassword: temporary,
        password: 'Nova-senha-e2e-2',
        passwordConfirmation: 'Nova-senha-e2e-2',
      })
      .expect(200);
    const other = await login(`olga-${suffix}@e2e.test`, 'Nova-senha-e2e-2');

    for (const state of ['OPEN', 'RECOVERED']) {
      const list = await request(http)
        .get(`/checkout/recovery?state=${state}&from=2000-01-01T00:00:00.000Z`)
        .set(auth(other))
        .expect(200);
      expect(list.body).toMatchObject({ total: 0, items: [] });
    }
  });

  it('depois de 12 meses, quem não comprou perde os dados pessoais; vendas pagas ficam', async () => {
    const old = new Date(Date.now() - 400 * 86_400_000);
    const expired = await prisma.checkoutOrder.update({
      where: { publicToken: expiredToken },
      data: { createdAt: old },
    });
    await prisma.checkoutLead.updateMany({
      where: { sessionKey: leadSession },
      data: { createdAt: old },
    });
    const paidBefore = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: token },
    });
    await prisma.checkoutOrder.update({
      where: { id: paidBefore.id },
      data: { createdAt: old },
    });

    await app.get(CheckoutRecoveryService).anonymize();

    const forgotten = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { id: expired.id },
    });
    expect(forgotten).toMatchObject({
      buyerName: 'Anonimizado',
      buyerEmail: '',
      buyerDocument: '',
      buyerPhone: '',
      utm: null,
      totalCents: expired.totalCents,
    });
    expect(forgotten.anonymizedAt).toBeInstanceOf(Date);
    const lead = await prisma.checkoutLead.findFirstOrThrow({
      where: { sessionKey: leadSession },
    });
    expect(lead).toMatchObject({ name: null, email: null, phone: null });
    const bodies = await prisma.checkoutWebhookDelivery.findMany({
      where: {
        OR: [{ orderId: expired.id }, { eventType: 'lead.abandoned' }],
      },
    });
    expect(bodies.length).toBeGreaterThan(0);
    expect(JSON.stringify(bodies.map((row) => row.payload))).not.toContain(
      ana.email,
    );

    const paidAfter = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { id: paidBefore.id },
    });
    expect(paidAfter).toMatchObject({
      buyerEmail: paidBefore.buyerEmail,
      buyerDocument: paidBefore.buyerDocument,
      anonymizedAt: null,
    });
  });

  // Part 6: card on the CifraMais account (Efí card API simulated).
  const holder = (document: string, name: string) => ({
    name,
    email: `${document}@e2e.test`,
    document,
    phone: '11977776666',
  });
  const cardAddress = {
    street: 'Praça da Sé',
    number: '10',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'SP',
    zipcode: '01001000',
  };
  const cardQuote = async () => {
    const response = await request(http)
      .post(`/checkout/public/products/${slug}/card/quote`)
      .send({ bumpIds: [], couponCode: null, brand: 'visa' })
      .expect(200);
    return response.body as {
      quoteId: string;
      payeeCode: string;
      options: { installments: number; totalCents: number }[];
    };
  };
  const charge = (quoteId: string, document: string, installments = 1) => ({
    quoteId,
    installments,
    paymentToken: `tok${randomUUID().replace(/-/g, '')}`,
    holderDocument: document,
    address: cardAddress,
    idempotencyKey: randomUUID(),
  });
  let declinedToken = '';

  it('o admin liga o cartão da conta Cifra+ e o vendedor liga o dele', async () => {
    const before = await request(http)
      .get('/admin/checkout/platform-account')
      .set(auth(tokens.admin))
      .expect(200);
    const version = (before.body as { current: { version: number } }).current
      .version;
    await request(http)
      .put('/admin/checkout/platform-account/card')
      .set(auth(tokens.admin))
      .send({
        expectedVersion: version,
        cardEnabled: true,
        cashBasisPoints: 300,
        anticipationBasisPoints: 100,
        cardCreditDays: 30,
      })
      .expect(200);

    const settings = (
      await request(http)
        .get('/checkout/settings')
        .set(auth(tokens.seller))
        .expect(200)
    ).body as Record<string, unknown> & { version: number };
    await request(http)
      .put('/checkout/settings')
      .set(auth(tokens.seller))
      .send({
        expectedVersion: settings.version,
        displayName: settings.displayName,
        primaryColor: settings.primaryColor,
        pixEnabled: true,
        cardEnabled: true,
        maxInstallments: 3,
        pixFeePayer: settings.pixFeePayer,
        cardFeePayer: 'BUYER',
      })
      .expect(200);

    const page = await request(http)
      .get(`/checkout/public/products/${slug}`)
      .expect(200);
    expect((page.body as { payment: unknown }).payment).toEqual({
      pixEnabled: true,
      cardEnabled: true,
      maxInstallments: 3,
      cardReuse: false,
    });
  });

  it('cartão aprovado só vira venda pelo aviso da Efí, e o saldo libera em 30 dias', async () => {
    const quote = await cardQuote();
    expect(quote.payeeCode).toBe('payee');
    expect(quote.options.map((option) => option.installments)).toEqual([
      1, 2, 3,
    ]);
    const three = quote.options[2]!;
    cardClient.submit.mockResolvedValueOnce({
      chargeId: '7001',
      status: 'waiting',
      totalCents: three.totalCents,
      installments: 3,
    });
    const created = await request(http)
      .post(`/checkout/public/products/${slug}/card/orders`)
      .send({
        bumpIds: [],
        couponCode: null,
        buyer: holder('39053344705', 'Bruno Lima'),
        ...charge(quote.quoteId, '39053344705', 3),
      })
      .expect(201);
    const view = created.body as { token: string; processing: boolean };
    expect(view.processing).toBe(true);
    // The card never reaches the API: only the token was sent to the Efí.
    const sent = (cardClient.submit.mock.calls as unknown[][]).at(-1)?.[1] as {
      attemptId: string;
      submissionCents: number;
    };

    cardClient.notification.mockResolvedValueOnce({
      customId: sent.attemptId,
      chargeId: '7001',
    });
    cardClient.detail.mockResolvedValueOnce({
      chargeId: '7001',
      customId: sent.attemptId,
      status: 'paid',
      method: 'credit_card',
      installments: 3,
      totalCents: three.totalCents,
    });
    const identity = await prisma.efiAccountIdentity.findFirstOrThrow({
      where: { ownership: 'PLATFORM' },
    });
    await expect(
      app.get(CheckoutCardService).handleNotification(identity.id, 'notif-1'),
    ).resolves.toBe(true);

    const order = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: view.token },
      include: { ledgerEntries: true },
    });
    expect(order).toMatchObject({
      status: 'PAID',
      paymentMethod: 'CARD',
      installments: 3,
      totalCents: three.totalCents,
      surchargeCents: three.totalCents - 6700,
    });
    const sale = order.ledgerEntries.find((entry) => entry.kind === 'SALE');
    expect(
      Math.round(
        (sale!.availableAt.getTime() - order.paidAt!.getTime()) / 86_400_000,
      ),
    ).toBe(30);
    // The buyer pays the card cost: the seller keeps P − % Cifra+.
    const net = order.ledgerEntries.reduce(
      (sum, entry) => sum + entry.amountCents,
      0,
    );
    expect(net).toBe(6700 - order.platformFeeCents);
  });

  it('recusa: até 3 tentativas no mesmo pedido, depois só Pix', async () => {
    const quote = await cardQuote();
    let charges = 8000;
    cardClient.submit.mockImplementation(() => ({
      chargeId: String(charges++),
      status: 'unpaid',
      totalCents: quote.options[0]!.totalCents,
      installments: 1,
    }));
    const first = await request(http)
      .post(`/checkout/public/products/${slug}/card/orders`)
      .send({
        bumpIds: [],
        couponCode: null,
        buyer: holder('15350946056', 'Carla Dias'),
        ...charge(quote.quoteId, '15350946056'),
      })
      .expect(201);
    const view = first.body as {
      token: string;
      card: { declined: boolean; canRetry: boolean };
    };
    expect(view.card).toEqual({ declined: true, canRetry: true });
    declinedToken = view.token;

    for (let i = 0; i < 2; i++)
      await request(http)
        .post(`/checkout/public/orders/${declinedToken}/card/pay`)
        .send(charge(quote.quoteId, '15350946056'))
        .expect(200);
    const blocked = await request(http)
      .post(`/checkout/public/orders/${declinedToken}/card/pay`)
      .send(charge(quote.quoteId, '15350946056'))
      .expect(409);
    expect(blocked.body).toMatchObject({ code: 'CARD_ATTEMPT_LIMIT' });
    expect(
      await prisma.checkoutCardAttempt.count({
        where: { order: { publicToken: declinedToken } },
      }),
    ).toBe(3);
    cardClient.submit.mockReset();
  });

  it('resposta perdida fica em análise e a conciliação pelo custom_id confirma', async () => {
    const quote = await cardQuote();
    cardClient.submit.mockRejectedValueOnce(new Error('socket hang up'));
    const created = await request(http)
      .post(`/checkout/public/products/${slug}/card/orders`)
      .send({
        bumpIds: [],
        couponCode: null,
        buyer: holder('98765432100', 'Davi Rocha'),
        ...charge(quote.quoteId, '98765432100'),
      })
      .expect(201);
    const token = (created.body as { token: string; processing: boolean })
      .token;
    expect((created.body as { processing: boolean }).processing).toBe(true);
    const attempt = await prisma.checkoutCardAttempt.findFirstOrThrow({
      where: { order: { publicToken: token } },
    });
    expect(attempt.status).toBe('UNCERTAIN');

    cardClient.findByAttempt.mockResolvedValueOnce(['7003']);
    cardClient.detail.mockResolvedValueOnce({
      chargeId: '7003',
      customId: attempt.id,
      status: 'paid',
      method: 'credit_card',
      installments: 1,
      totalCents: attempt.totalCents,
    });
    await app.get(CheckoutCardService).reconcileDue();
    expect(cardClient.submit).toHaveBeenCalledTimes(1);
    expect(
      (
        await prisma.checkoutOrder.findUniqueOrThrow({
          where: { publicToken: token },
        })
      ).status,
    ).toBe('PAID');
  });

  it('pedido recusado fecha, avisa o vendedor e entra na Recuperação', async () => {
    await app
      .get(CheckoutCardService)
      .closeOverdue(new Date(Date.now() + 45 * 60_000));
    const order = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: declinedToken },
    });
    expect(order.status).toBe('DECLINED');
    expect(
      await prisma.checkoutWebhookDelivery.count({
        where: { orderId: order.id, eventType: 'order.card_declined' },
      }),
    ).toBe(1);

    const list = await request(http)
      .get('/checkout/recovery?kind=CARD')
      .set(auth(tokens.seller))
      .expect(200);
    expect(
      (list.body as { items: { name: string; reason: string }[] }).items,
    ).toEqual([
      expect.objectContaining({
        name: 'Carla Dias',
        reason: 'Cartão recusado',
      }),
    ]);
  });

  // Part 7: one-click offers after the purchase.
  const offer = {
    mainId: '',
    mainSlug: '',
    upsellId: '',
    downsellId: '',
    upsellProductId: '',
  };
  const payPix = async (orderToken: string) => {
    const attempt = await prisma.checkoutPaymentAttempt.findFirstOrThrow({
      where: { order: { publicToken: orderToken } },
    });
    await app.get(CheckoutPaymentsService).handlePixEvent({
      txid: attempt.efiTxid,
      chave: PIX_KEY,
      valor: (attempt.amountCents / 100).toFixed(2),
      endToEndId: `E2E${attempt.efiTxid.slice(-8)}`,
    });
  };
  const buyPix = async (document: string, name: string) => {
    const created = await request(http)
      .post(`/checkout/public/products/${offer.mainSlug}/orders`)
      .send({
        bumpIds: [],
        couponCode: null,
        method: 'PIX',
        buyer: holder(document, name),
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const orderToken = (created.body as { token: string }).token;
    await payPix(orderToken);
    const view = await request(http)
      .get(`/checkout/public/orders/${orderToken}`)
      .expect(200);
    return {
      orderToken,
      view: view.body as { redirectUrl: string; redirectKind: string },
    };
  };
  const offerTokenFrom = (url: string) => url.split('/c/oferta/')[1] ?? '';

  it('o vendedor cria upsell e downsell e liga a oferta depois da compra', async () => {
    // The whole suite comes from one IP: the offer scenarios start with fresh
    // per-IP limits (card payments are 10 per hour).
    (throttle as unknown as { useMemoryLimiters(): void }).useMemoryLimiters();
    const product = async (name: string, priceCents: number) =>
      (
        await request(http)
          .post('/checkout/products')
          .set(auth(tokens.seller))
          .send({
            name,
            priceCents,
            accessPeriodMonths: 12,
            deliveryMode: 'ACCESS_LINK',
            accessUrl: `https://acesso.e2e.test/${encodeURIComponent(name)}`,
          })
          .expect(201)
      ).body as { id: string; slug: string; version: number };
    const main = await product('Porquim Premium', 9700);
    const upsellProduct = await product('Mentoria Porquim', 19700);
    const downsellProduct = await product('Planilha Porquim', 2900);
    offer.mainId = main.id;
    offer.mainSlug = main.slug;
    offer.upsellProductId = upsellProduct.id;

    // A downsell only exists after an upsell.
    await request(http)
      .post(`/checkout/products/${main.id}/offers`)
      .set(auth(tokens.seller))
      .send({
        kind: 'DOWNSELL',
        offeredProductId: downsellProduct.id,
        priceCents: 1900,
        active: true,
      })
      .expect(400);
    const withUpsell = await request(http)
      .post(`/checkout/products/${main.id}/offers`)
      .set(auth(tokens.seller))
      .send({
        kind: 'UPSELL',
        offeredProductId: upsellProduct.id,
        priceCents: 9700,
        compareAtPriceCents: 19700,
        headline: 'Só agora: a mentoria pela metade',
        active: true,
      })
      .expect(201);
    const withDownsell = await request(http)
      .post(`/checkout/products/${main.id}/offers`)
      .set(auth(tokens.seller))
      .send({
        kind: 'DOWNSELL',
        offeredProductId: downsellProduct.id,
        priceCents: 1900,
        active: true,
      })
      .expect(201);
    const offers = (
      withDownsell.body as { offers: { id: string; kind: string }[] }
    ).offers;
    offer.upsellId = offers.find((row) => row.kind === 'UPSELL')!.id;
    offer.downsellId = offers.find((row) => row.kind === 'DOWNSELL')!.id;
    expect((withUpsell.body as { offers: unknown[] }).offers).toHaveLength(1);

    const current = (
      await request(http)
        .get(`/checkout/products/${main.id}`)
        .set(auth(tokens.seller))
        .expect(200)
    ).body as { version: number };
    await request(http)
      .put(`/checkout/products/${main.id}`)
      .set(auth(tokens.seller))
      .send({
        expectedVersion: current.version,
        name: 'Porquim Premium',
        priceCents: 9700,
        accessPeriodMonths: 12,
        deliveryMode: 'ACCESS_LINK',
        accessUrl: 'https://acesso.e2e.test/premium',
        afterPurchase: 'OFFER',
        offerWindowMinutes: 30,
      })
      .expect(200);
    const page = await request(http)
      .get(`/checkout/public/products/${main.slug}`)
      .expect(200);
    expect(
      (page.body as { payment: { cardReuse: boolean } }).payment.cardReuse,
    ).toBe(true);
  });

  it('upsell no Pix aceito vira venda separada, ligada à compra, uma vez só', async () => {
    const { orderToken, view } = await buyPix('12345678062', 'Ester Nunes');
    expect(view.redirectKind).toBe('OFFER');
    const offerToken = offerTokenFrom(view.redirectUrl);
    expect(offerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(offerToken).not.toBe(orderToken);

    const shown = await request(http)
      .get(`/checkout/public/offers/${offerToken}`)
      .expect(200);
    expect(shown.body).toMatchObject({
      state: 'OFFER',
      offer: { id: offer.upsellId, kind: 'UPSELL', priceCents: 9700 },
      payment: { pixEnabled: true, card: null },
    });
    // The offer page never shows the purchase token.
    expect(JSON.stringify(shown.body)).not.toContain(orderToken);

    const accept = {
      offerId: offer.upsellId,
      method: 'PIX',
      idempotencyKey: randomUUID(),
    };
    const pixCalls = pix.create.mock.calls.length;
    const first = await request(http)
      .post(`/checkout/public/offers/${offerToken}/accept`)
      .send(accept)
      .expect(200);
    const again = await request(http)
      .post(`/checkout/public/offers/${offerToken}/accept`)
      .send(accept)
      .expect(200);
    const offerOrder = (first.body as { token: string }).token;
    expect((again.body as { token: string }).token).toBe(offerOrder);
    expect(pix.create.mock.calls.length).toBe(pixCalls + 1);
    // Another click with a new key while the Pix is open: no second order.
    await request(http)
      .post(`/checkout/public/offers/${offerToken}/accept`)
      .send({ ...accept, idempotencyKey: randomUUID() })
      .expect(409);

    await payPix(offerOrder);
    const origin = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: orderToken },
    });
    const sold = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: offerOrder },
      include: { ledgerEntries: true },
    });
    expect(sold).toMatchObject({
      status: 'PAID',
      parentOrderId: origin.id,
      offerId: offer.upsellId,
      buyerDocument: '12345678062',
      totalCents: 9700,
      couponId: null,
      offerTokenHash: null,
    });
    expect(sold.ledgerEntries.some((entry) => entry.kind === 'SALE')).toBe(
      true,
    );
    const paidEvent = await prisma.checkoutWebhookDelivery.findFirstOrThrow({
      where: { orderId: sold.id, eventType: 'order.paid' },
    });
    expect(paidEvent.payload).toMatchObject({
      data: {
        order: {
          parentOrderId: origin.id,
          offer: { id: offer.upsellId, kind: 'UPSELL' },
        },
      },
    });
    const sales = await request(http)
      .get('/checkout/sales')
      .set(auth(tokens.seller))
      .expect(200);
    expect(
      (sales.body as { items: { orderId: string; offerKind: string | null }[] })
        .items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: sold.id, offerKind: 'UPSELL' }),
      ]),
    );
    // Bought: the page moves on to the access.
    const after = await request(http)
      .get(`/checkout/public/offers/${offerToken}`)
      .expect(200);
    expect(after.body).toMatchObject({
      state: 'DONE',
      accessUrl: 'https://acesso.e2e.test/premium',
    });
  });

  it('quem já tem o produto não vê a oferta de novo', async () => {
    const { view } = await buyPix('12345678062', 'Ester Nunes');
    const shown = await request(http)
      .get(`/checkout/public/offers/${offerTokenFrom(view.redirectUrl)}`)
      .expect(200);
    expect(shown.body).toMatchObject({ state: 'DONE' });
  });

  it('recusa leva ao downsell e depois ao acesso; link vencido ou desconhecido não vende', async () => {
    const { orderToken, view } = await buyPix('23456789173', 'Fabio Reis');
    const offerToken = offerTokenFrom(view.redirectUrl);
    const next = await request(http)
      .post(`/checkout/public/offers/${offerToken}/decline`)
      .send({ offerId: offer.upsellId })
      .expect(200);
    expect(next.body).toMatchObject({
      state: 'OFFER',
      offer: { id: offer.downsellId, kind: 'DOWNSELL', priceCents: 1900 },
    });
    await request(http)
      .post(`/checkout/public/offers/${offerToken}/accept`)
      .send({
        offerId: offer.upsellId,
        method: 'PIX',
        idempotencyKey: randomUUID(),
      })
      .expect(409);
    const done = await request(http)
      .post(`/checkout/public/offers/${offerToken}/decline`)
      .send({ offerId: offer.downsellId })
      .expect(200);
    expect(done.body).toMatchObject({
      state: 'DONE',
      accessUrl: 'https://acesso.e2e.test/premium',
    });

    await request(http)
      .get(`/checkout/public/offers/${'x'.repeat(43)}`)
      .expect(404);
    // The order token is not an offer key.
    await request(http)
      .get(`/checkout/public/offers/${orderToken}`)
      .expect(404);

    const late = await buyPix('34567891228', 'Gabi Prado');
    const lateToken = offerTokenFrom(late.view.redirectUrl);
    await prisma.checkoutOrder.update({
      where: { publicToken: late.orderToken },
      data: { offerExpiresAt: new Date(Date.now() - 1000) },
    });
    const closedView = await request(http)
      .get(`/checkout/public/offers/${lateToken}`)
      .expect(200);
    expect(closedView.body).toMatchObject({ state: 'CLOSED' });
    const closed = await request(http)
      .post(`/checkout/public/offers/${lateToken}/accept`)
      .send({
        offerId: offer.upsellId,
        method: 'PIX',
        idempotencyKey: randomUUID(),
      })
      .expect(409);
    expect(closed.body).toMatchObject({ code: 'CHECKOUT_OFFER_CLOSED' });
    const order = await request(http)
      .get(`/checkout/public/orders/${late.orderToken}`)
      .expect(200);
    expect(order.body).toMatchObject({
      redirectKind: 'ACCESS',
      redirectUrl: 'https://acesso.e2e.test/premium',
    });
  });

  it('upsell no cartão cobra o cartão guardado da compra, e os dados somem depois da janela', async () => {
    const quote = (
      await request(http)
        .post(`/checkout/public/products/${offer.mainSlug}/card/quote`)
        .send({ bumpIds: [], couponCode: null, brand: 'visa' })
        .expect(200)
    ).body as { quoteId: string; options: { totalCents: number }[] };
    let chargeId = 9100;
    const paid = (installments: number, totalCents: number) => () => ({
      chargeId: String(chargeId++),
      status: 'paid',
      totalCents,
      installments,
    });
    cardClient.submit.mockImplementationOnce(
      paid(1, quote.options[0]!.totalCents),
    );
    const body = charge(quote.quoteId, '45678912364');
    const created = await request(http)
      .post(`/checkout/public/products/${offer.mainSlug}/card/orders`)
      .send({
        bumpIds: [],
        couponCode: null,
        buyer: holder('45678912364', 'Helena Paz'),
        ...body,
      })
      .expect(201);
    const view = created.body as {
      token: string;
      status: string;
      redirectUrl: string;
    };
    expect(view.status).toBe('PAID');
    const offerToken = offerTokenFrom(view.redirectUrl);
    const kept = await prisma.checkoutCardAttempt.findFirstOrThrow({
      where: { order: { publicToken: view.token } },
    });
    expect(kept.reuseEncrypted).toBeTruthy();
    expect(kept.reuseEncrypted).not.toContain(body.paymentToken);

    const shown = await request(http)
      .get(`/checkout/public/offers/${offerToken}`)
      .expect(200);
    expect(shown.body).toMatchObject({
      state: 'OFFER',
      payment: { card: { brand: 'visa', maxInstallments: 3 } },
    });
    const offerQuote = (
      await request(http)
        .post(`/checkout/public/offers/${offerToken}/card/quote`)
        .send({ offerId: offer.upsellId })
        .expect(200)
    ).body as {
      quoteId: string;
      options: { installments: number; totalCents: number }[];
    };
    const two = offerQuote.options.find((option) => option.installments === 2)!;
    cardClient.submit.mockImplementationOnce(paid(2, two.totalCents));
    const accepted = await request(http)
      .post(`/checkout/public/offers/${offerToken}/accept`)
      .send({
        offerId: offer.upsellId,
        method: 'CARD',
        quoteId: offerQuote.quoteId,
        installments: 2,
        idempotencyKey: randomUUID(),
      })
      .expect(200);
    expect(accepted.body).toMatchObject({ status: 'PAID', installments: 2 });
    // Charged again with the kept token, without the card being typed.
    const sent = (cardClient.submit.mock.calls as unknown[][]).at(-1)?.[1] as {
      paymentToken: string;
      customer: { cpf: string };
    };
    expect(sent.paymentToken).toBe(body.paymentToken);
    expect(sent.customer.cpf).toBe('45678912364');
    const upsellOrder = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: (accepted.body as { token: string }).token },
      include: { cardAttempts: true },
    });
    expect(upsellOrder).toMatchObject({
      paymentMethod: 'CARD',
      parentOrderId: kept.orderId,
      offerId: offer.upsellId,
    });
    expect(upsellOrder.cardAttempts[0]?.reuseEncrypted).toBeNull();

    await app
      .get(CheckoutCardService)
      .wipeKeptCards(new Date(Date.now() + 31 * 60_000));
    const wiped = await prisma.checkoutCardAttempt.findUniqueOrThrow({
      where: { id: kept.id },
    });
    expect(wiped.reuseEncrypted).toBeNull();
    expect(wiped.reuseWipedAt).toBeTruthy();
  });

  it('outra empresa não vê nem altera as ofertas deste vendedor', async () => {
    const other = await login(`olga-${suffix}@e2e.test`, 'Nova-senha-e2e-2');
    await request(http)
      .get(`/checkout/products/${offer.mainId}`)
      .set(auth(other))
      .expect(404);
    await request(http)
      .put(`/checkout/products/${offer.mainId}/offers/${offer.upsellId}`)
      .set(auth(other))
      .send({
        kind: 'UPSELL',
        offeredProductId: offer.upsellProductId,
        priceCents: 500,
        active: true,
        expectedVersion: 1,
      })
      .expect(404);
    const unchanged = await prisma.checkoutOffer.findUniqueOrThrow({
      where: { id: offer.upsellId },
    });
    expect(unchanged.priceCents).toBe(9700);
  });

  it('cartão pausado pelo admin some da página e o Pix continua', async () => {
    const company = await prisma.company.findFirstOrThrow({
      where: { email: `porquim-${suffix}@e2e.test` },
    });
    await request(http)
      .put(`/admin/checkout/clients/${company.id}/card-pause`)
      .set(auth(tokens.admin))
      .send({ paused: true, reason: 'Chargeback acima de 1%' })
      .expect(200);
    const page = await request(http)
      .get(`/checkout/public/products/${slug}`)
      .expect(200);
    expect(
      (page.body as { payment: { cardEnabled: boolean } }).payment.cardEnabled,
    ).toBe(false);
    const refused = await request(http)
      .post(`/checkout/public/products/${slug}/card/quote`)
      .send({ bumpIds: [], couponCode: null, brand: 'visa' })
      .expect(400);
    expect(refused.body).toMatchObject({ code: 'CARD_NOT_AVAILABLE' });
    await request(http)
      .post(`/checkout/public/products/${slug}/quote`)
      .send({ bumpIds: [], couponCode: null, method: 'PIX' })
      .expect(200);
    // The seller is not an admin: admin routes do not exist for a seller.
    await request(http)
      .put(`/admin/checkout/clients/${company.id}/card-pause`)
      .set(auth(tokens.seller))
      .send({ paused: false, reason: 'Tentativa do vendedor' })
      .expect(404);
  });

  // Part 8: refund hold, buyer-only withdrawal, item refunds and buyer e-mails.
  const refund = { orderToken: '', orderId: '', companyId: '', bumpShare: 0 };
  const mailQueue = () => app.get<Queue>(getQueueToken(CHECKOUT_MAIL_QUEUE));

  it('reembolso de um item pelo comprador fica 7 dias em retenção, com e-mail e aviso ao vendedor', async () => {
    (throttle as unknown as { useMemoryLimiters(): void }).useMemoryLimiters();
    const created = await request(http)
      .post(`/checkout/public/products/${slug}/orders`)
      .send({
        bumpIds: [bumpId],
        couponCode: null,
        method: 'PIX',
        buyer: holder('39053344705', 'Iara Lopes'),
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    refund.orderToken = (created.body as { token: string }).token;
    await payPix(refund.orderToken);
    const order = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: refund.orderToken },
    });
    refund.orderId = order.id;
    refund.companyId = order.companyId;
    refund.bumpShare = itemShares(
      order.items as unknown as OrderItem[],
      order.totalCents,
    )[1]!;

    const view = await request(http)
      .get(`/checkout/public/orders/${refund.orderToken}`)
      .expect(200);
    expect(
      (view.body as { items: { refundCents: number }[] }).items.map(
        (line) => line.refundCents,
      ),
    ).toEqual(
      itemShares(order.items as unknown as OrderItem[], order.totalCents),
    );

    const asked = await request(http)
      .post(`/checkout/public/orders/${refund.orderToken}/refund-request`)
      .send({ reason: 'Não usei o guia', itemIndexes: [1] })
      .expect(201);
    const requestId = (asked.body as { id: string }).id;
    const saved = await prisma.checkoutRefundRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(saved).toMatchObject({
      origin: 'BUYER',
      itemIndexes: [1],
      amountCents: refund.bumpShare,
    });
    expect(
      Math.round(
        (saved.holdUntil!.getTime() - saved.createdAt.getTime()) / 86_400_000,
      ),
    ).toBe(7);
    expect(
      await mailQueue().getJob(`refund-RECEIVED-${requestId}`),
    ).toBeTruthy();
    const event = await prisma.checkoutWebhookDelivery.findFirstOrThrow({
      where: { orderId: order.id, eventType: 'refund.requested' },
    });
    expect(event.payload).toMatchObject({
      data: {
        refundRequest: {
          items: ['Guia Renda Fixa'],
          amountCents: refund.bumpShare,
        },
      },
    });
  });

  it('na retenção o admin não executa e o repasse sugerido desconta o pedido aberto', async () => {
    const blocked = await request(http)
      .post(`/admin/checkout/clients/${refund.companyId}/refunds`)
      .set(auth(tokens.admin))
      .send({
        idempotencyKey: randomUUID(),
        orderId: refund.orderId,
        amountCents: refund.bumpShare,
      })
      .expect(409);
    expect(blocked.body).toMatchObject({ code: 'CHECKOUT_REFUND_ON_HOLD' });

    const finance = await request(http)
      .get(`/admin/checkout/clients/${refund.companyId}/finance`)
      .set(auth(tokens.admin))
      .expect(200);
    const balance = (
      finance.body as {
        balance: { releasedCents: number; suggestedPayoutCents: number };
      }
    ).balance;
    expect(balance.suggestedPayoutCents).toBe(
      Math.max(0, balance.releasedCents - refund.bumpShare),
    );
  });

  it('o vendedor só pede o reenvio do e-mail (uma vez por dia); a desistência é do comprador', async () => {
    await request(http)
      .post(`/checkout/sales/${refund.orderId}/refund-request/remind`)
      .set(auth(tokens.seller))
      .expect(201);
    const again = await request(http)
      .post(`/checkout/sales/${refund.orderId}/refund-request/remind`)
      .set(auth(tokens.seller))
      .expect(409);
    expect(again.body).toMatchObject({ code: 'CHECKOUT_REFUND_REMIND_LIMIT' });
    // Another seller does not even see the sale.
    const other = await login(`olga-${suffix}@e2e.test`, 'Nova-senha-e2e-2');
    await request(http)
      .post(`/checkout/sales/${refund.orderId}/refund-request/remind`)
      .set(auth(other))
      .expect(404);

    await request(http)
      .post(
        `/checkout/public/orders/${refund.orderToken}/refund-request/withdraw`,
      )
      .expect(200);
    expect(
      await prisma.checkoutRefundRequest.findFirstOrThrow({
        where: { orderId: refund.orderId },
      }),
    ).toMatchObject({ status: 'WITHDRAWN' });
    expect(
      await prisma.checkoutWebhookDelivery.count({
        where: { orderId: refund.orderId, eventType: 'refund.withdrawn' },
      }),
    ).toBe(1);
    await request(http)
      .post(
        `/checkout/public/orders/${refund.orderToken}/refund-request/withdraw`,
      )
      .expect(409);
  });

  it('depois da retenção, o reembolso do item devolve só a parte dele e a % Cifra+ proporcional', async () => {
    const asked = await request(http)
      .post(`/checkout/sales/${refund.orderId}/refund-request`)
      .set(auth(tokens.seller))
      .send({ reason: 'O comprador pediu de novo', itemIndexes: [1] })
      .expect(201);
    // A seller's request has no hold: the admin executes at once.
    expect((asked.body as { holdUntil: string | null }).holdUntil).toBeNull();
    const before = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { id: refund.orderId },
    });
    await request(http)
      .post(`/admin/checkout/clients/${refund.companyId}/refunds`)
      .set(auth(tokens.admin))
      .send({
        idempotencyKey: randomUUID(),
        orderId: refund.orderId,
        amountCents: refund.bumpShare,
      })
      .expect(201);

    const after = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { id: refund.orderId },
      include: { ledgerEntries: true, refundRequests: true },
    });
    expect(after.status).toBe('PAID');
    const kinds = (kind: string) =>
      after.ledgerEntries
        .filter((entry) => entry.kind === kind)
        .reduce((sum, entry) => sum + entry.amountCents, 0);
    expect(kinds('REFUND')).toBe(-refund.bumpShare);
    expect(kinds('PLATFORM_FEE_REVERSAL')).toBe(
      Math.round(
        (before.platformFeeCents * refund.bumpShare) / before.totalCents,
      ),
    );
    const paidEvent = await prisma.checkoutWebhookDelivery.findFirstOrThrow({
      where: { orderId: refund.orderId, eventType: 'order.refunded' },
    });
    expect(paidEvent.payload).toMatchObject({
      data: { refund: { items: ['Guia Renda Fixa'] } },
    });
    expect(
      after.refundRequests.find((row) => row.status === 'DONE')?.itemIndexes,
    ).toEqual([1]);

    // The bump is gone: asking for it again is refused; the rest is the main item.
    await request(http)
      .post(`/checkout/public/orders/${refund.orderToken}/refund-request`)
      .send({ reason: 'De novo o guia', itemIndexes: [1] })
      .expect(409);
    const jobs = await mailQueue().getJobs(['waiting', 'delayed', 'active']);
    expect(
      jobs.some(
        (job) =>
          job.name === 'refund' &&
          (job.data as { step: string; orderId: string }).step === 'DONE' &&
          (job.data as { orderId: string }).orderId === refund.orderId,
      ),
    ).toBe(true);
  });

  // Part 9: several webhook rules and the read-only API.
  const part9 = { bumpProductId: '', mainProductId: '', ruleId: '' };

  it('regras por evento e produto: a regra do bump recebe o pedido inteiro, a de outro produto não', async () => {
    const order = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { id: refund.orderId },
    });
    const items = order.items as unknown as OrderItem[];
    part9.mainProductId = items[0]!.productId;
    part9.bumpProductId = items[1]!.productId;
    const created = await request(http)
      .post('/checkout/webhooks')
      .set(auth(tokens.seller))
      .send({
        name: 'Sistema do guia',
        url: 'https://guia.porquim.e2e.test/hook',
        events: ['order.paid'],
        productIds: [part9.bumpProductId],
      })
      .expect(201);
    const bumpRule = created.body as {
      id: string;
      secret: string;
      version: number;
    };
    part9.ruleId = bumpRule.id;
    const otherRule = (
      await request(http)
        .post('/checkout/webhooks')
        .set(auth(tokens.seller))
        .send({
          name: 'Outro produto',
          url: 'https://outro.porquim.e2e.test/hook',
          productIds: [offer.upsellProductId],
        })
        .expect(201)
    ).body as { id: string };

    (throttle as unknown as { useMemoryLimiters(): void }).useMemoryLimiters();
    const sale = await request(http)
      .post(`/checkout/public/products/${slug}/orders`)
      .send({
        bumpIds: [bumpId],
        couponCode: null,
        method: 'PIX',
        buyer: holder('39053344705', 'Iara Lopes'),
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const saleToken = (sale.body as { token: string }).token;
    await payPix(saleToken);
    const paid = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: saleToken },
    });
    const notices = await prisma.checkoutWebhookDelivery.findMany({
      where: { orderId: paid.id, eventType: 'order.paid' },
    });
    expect(notices.map((row) => row.ruleId).sort()).toEqual(
      [webhookRuleId, bumpRule.id].sort(),
    );
    expect(new Set(notices.map((row) => row.eventId)).size).toBe(1);

    webhookSender.send.mockClear();
    // The worker takes 20 at a time; earlier scenarios left notices in the queue.
    for (let pass = 0; pass < 5; pass++)
      await app
        .get(CheckoutWebhooksService)
        .deliverDue(new Date(Date.now() + 60_000));
    const toGuide = webhookSender.send.mock.calls
      .map((call) => call as unknown[])
      .find((call) => (call[0] as { url: string }).url.includes('guia.'));
    expect(toGuide?.[0]).toEqual({
      url: 'https://guia.porquim.e2e.test/hook',
      secret: bumpRule.secret,
    });
    const body = JSON.parse(String(toGuide?.[2])) as {
      data: { order: { items: { kind: string }[] } };
    };
    expect(body.data.order.items.map((line) => line.kind)).toEqual([
      'MAIN',
      'BUMP',
    ]);

    // Each rule has its own history.
    const guideHistory = await request(http)
      .get(`/checkout/webhooks/${bumpRule.id}/deliveries`)
      .set(auth(tokens.seller))
      .expect(200);
    expect(
      (guideHistory.body as { items: { eventType: string }[] }).items.map(
        (item) => item.eventType,
      ),
    ).toEqual(['order.paid']);

    // An old version is refused; another company sees nothing.
    await request(http)
      .put(`/checkout/webhooks/${bumpRule.id}`)
      .set(auth(tokens.seller))
      .send({
        name: 'Guia',
        url: 'https://guia.porquim.e2e.test/hook',
        version: bumpRule.version + 1,
      })
      .expect(409);
    const other = await login(`olga-${suffix}@e2e.test`, 'Nova-senha-e2e-2');
    await request(http)
      .get(`/checkout/webhooks/${bumpRule.id}/deliveries`)
      .set(auth(other))
      .expect(404);
    await request(http)
      .delete(`/checkout/webhooks/${bumpRule.id}`)
      .set(auth(other))
      .expect(404);
    const olgaRules = await request(http)
      .get('/checkout/webhooks')
      .set(auth(other))
      .expect(200);
    expect(olgaRules.body).toEqual([]);

    await request(http)
      .delete(`/checkout/webhooks/${otherRule.id}`)
      .set(auth(tokens.seller))
      .expect(204);
  });

  it('3 dias de falha desligam só a regra que falha; as outras seguem', async () => {
    await prisma.checkoutWebhookRule.update({
      where: { id: part9.ruleId },
      data: { failingSince: new Date(Date.now() - 3 * 86_400_000 - 60_000) },
    });
    webhookSender.send.mockResolvedValueOnce({
      ok: false,
      statusCode: 503,
      error: 'HTTP_STATUS',
    });
    await request(http)
      .post(`/checkout/webhooks/${part9.ruleId}/test`)
      .set(auth(tokens.seller))
      .expect(201);

    const rules = (
      await request(http)
        .get('/checkout/webhooks')
        .set(auth(tokens.seller))
        .expect(200)
    ).body as { id: string; disabledAt: string | null }[];
    expect(rules.find((row) => row.id === part9.ruleId)?.disabledAt).toEqual(
      expect.any(String),
    );
    expect(
      rules.find((row) => row.id === webhookRuleId)?.disabledAt,
    ).toBeNull();

    await request(http)
      .post(`/checkout/webhooks/${part9.ruleId}/enable`)
      .set(auth(tokens.seller))
      .expect(201);
    await request(http)
      .delete(`/checkout/webhooks/${part9.ruleId}`)
      .set(auth(tokens.seller))
      .expect(204);
    const left = (
      await request(http)
        .get('/checkout/webhooks')
        .set(auth(tokens.seller))
        .expect(200)
    ).body as { id: string }[];
    expect(left.map((row) => row.id)).toEqual([webhookRuleId]);
  });

  it('API de consulta: a chave lê os pedidos e produtos da própria empresa, com limite e revogação', async () => {
    (throttle as unknown as { useMemoryLimiters(): void }).useMemoryLimiters();
    const created = await request(http)
      .post('/checkout/api-keys')
      .set(auth(tokens.seller))
      .send({ name: 'ERP' })
      .expect(201);
    const { key, id: keyId } = created.body as { key: string; id: string };
    expect(key).toMatch(/^ckapi_/);
    const listed = await request(http)
      .get('/checkout/api-keys')
      .set(auth(tokens.seller))
      .expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(key);

    const one = await request(http)
      .get(`/checkout/api/v1/orders/${refund.orderId}`)
      .set(auth(key))
      .expect(200);
    expect(one.body).toMatchObject({
      id: refund.orderId,
      buyer: { document: '39053344705' },
      items: [{ kind: 'MAIN' }, { kind: 'BUMP' }],
    });
    // The bump product finds the order too.
    const byBump = await request(http)
      .get('/checkout/api/v1/orders')
      .query({ productId: part9.bumpProductId, status: 'PAID' })
      .set(auth(key))
      .expect(200);
    expect(
      (byBump.body as { items: { id: string }[] }).items.map((item) => item.id),
    ).toContain(refund.orderId);
    const products = await request(http)
      .get('/checkout/api/v1/products')
      .set(auth(key))
      .expect(200);
    expect(
      (products.body as { items: { id: string }[] }).items.map(
        (item) => item.id,
      ),
    ).toEqual(
      expect.arrayContaining([part9.mainProductId, part9.bumpProductId]),
    );

    // Another company's key: 404 for this order, and its list is its own.
    const other = await login(`olga-${suffix}@e2e.test`, 'Nova-senha-e2e-2');
    const otherKey = (
      (
        await request(http)
          .post('/checkout/api-keys')
          .set(auth(other))
          .send({ name: 'Outro' })
          .expect(201)
      ).body as { key: string }
    ).key;
    await request(http)
      .get(`/checkout/api/v1/orders/${refund.orderId}`)
      .set(auth(otherKey))
      .expect(404);
    await request(http)
      .get(`/checkout/api/v1/products/${part9.mainProductId}`)
      .set(auth(otherKey))
      .expect(404);
    const otherOrders = await request(http)
      .get('/checkout/api/v1/orders')
      .set(auth(otherKey))
      .expect(200);
    expect(JSON.stringify(otherOrders.body)).not.toContain(refund.orderId);
    // A login token is not a key, and a key is not a login.
    await request(http)
      .get('/checkout/api/v1/orders')
      .set(auth(tokens.seller))
      .expect(401);
    await request(http).get('/checkout/sales').set(auth(key)).expect(401);
    await request(http).get('/checkout/api/v1/orders').expect(401);

    // 60 a minute per key.
    (throttle as unknown as { useMemoryLimiters(): void }).useMemoryLimiters();
    for (let call = 0; call < 60; call++)
      await request(http)
        .get('/checkout/api/v1/products')
        .set(auth(key))
        .expect(200);
    await request(http)
      .get('/checkout/api/v1/products')
      .set(auth(key))
      .expect(429);

    (throttle as unknown as { useMemoryLimiters(): void }).useMemoryLimiters();
    await request(http)
      .delete(`/checkout/api-keys/${keyId}`)
      .set(auth(tokens.seller))
      .expect(204);
    await request(http)
      .get('/checkout/api/v1/products')
      .set(auth(key))
      .expect(401);
    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'CheckoutApiKey', entityId: keyId },
    });
    expect(audit.map((row) => row.action).sort()).toEqual([
      'CHECKOUT_API_KEY_CREATED',
      'CHECKOUT_API_KEY_REVOKED',
    ]);
    expect(JSON.stringify(audit)).not.toContain(key);
  });

  it('planos: a página vende pelo plano, o líquido previsto é o do pedido e outra empresa não alcança', async () => {
    (throttle as unknown as { useMemoryLimiters(): void }).useMemoryLimiters();
    const product = await prisma.checkoutProduct.findUniqueOrThrow({
      where: { slug },
    });
    const plan = {
      productId: product.id,
      name: 'Anual',
      intervalMonths: 12,
      billing: 'INSTALLMENT',
      priceCents: 9900,
      maxInstallments: 3,
      pixFeePayer: 'BUYER',
      active: true,
    };
    const created = await request(http)
      .post('/checkout/plans')
      .set(auth(tokens.seller))
      .send(plan)
      .expect(201);
    const planId = (created.body as { id: string }).id;
    // A recurring plan exists but only joins the page with the renewal flow.
    await request(http)
      .post('/checkout/plans')
      .set(auth(tokens.seller))
      .send({
        productId: product.id,
        name: 'Trimestral',
        intervalMonths: 3,
        billing: 'RECURRING',
        priceCents: 2990,
        active: true,
      })
      .expect(201);

    const page = await request(http)
      .get(`/checkout/public/products/${slug}`)
      .expect(200);
    expect((page.body as { plans: unknown[] }).plans).toEqual([
      expect.objectContaining({ id: planId, priceCents: 9900 }),
    ]);
    const noPlan = await request(http)
      .post(`/checkout/public/products/${slug}/quote`)
      .send({ bumpIds: [], method: 'PIX' })
      .expect(400);
    expect(noPlan.body).toMatchObject({ code: 'CHECKOUT_PLAN_REQUIRED' });

    const preview = await request(http)
      .post('/checkout/plans/preview')
      .set(auth(tokens.seller))
      .send({ billing: 'INSTALLMENT', priceCents: 9900, maxInstallments: 3 })
      .expect(200);
    const ordered = await request(http)
      .post(`/checkout/public/products/${slug}/orders`)
      .send({
        bumpIds: [],
        planId,
        method: 'PIX',
        buyer: {
          name: 'Paula Planos',
          email: 'paula@e2e.test',
          document: '39053344705',
          phone: '11977776666',
        },
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const saved = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: (ordered.body as { token: string }).token },
    });
    expect(saved).toMatchObject({
      planId,
      subtotalCents: 9900,
      feePayer: 'BUYER',
    });
    expect((saved.items as unknown as OrderItem[])[0]).toMatchObject({
      unitPriceCents: 9900,
      accessPeriodMonths: 12,
    });
    const line = (
      preview.body as {
        pix: { buyer: { buyerTotalCents: number; netCents: number }[] };
      }
    ).pix.buyer[0];
    expect(line).toMatchObject({
      buyerTotalCents: saved.totalCents,
      netCents: saved.totalCents - saved.efiFeeCents - saved.platformFeeCents,
    });

    const other = await request(http)
      .post('/admin/checkout/clients')
      .set(auth(tokens.admin))
      .send({
        company: {
          corporateName: 'Loja dos Planos',
          document: '06990590000123',
          email: `planos-${suffix}@e2e.test`,
          phoneNumber: '11988881111',
        },
        firstUser: { name: 'Paulo', email: `paulo-${suffix}@e2e.test` },
        terms: {
          platformFeeBasisPoints: 250,
          payoutDocument: '06990590000123',
          payoutPixKey: '11144477735',
        },
      })
      .expect(201);
    const temporary = (other.body as { temporaryPassword: string })
      .temporaryPassword;
    const first = await login(`paulo-${suffix}@e2e.test`, temporary);
    await request(http)
      .post('/auth/change-password')
      .set(auth(first))
      .send({
        currentPassword: temporary,
        password: 'Nova-senha-e2e-3',
        passwordConfirmation: 'Nova-senha-e2e-3',
      })
      .expect(200);
    const stranger = await login(
      `paulo-${suffix}@e2e.test`,
      'Nova-senha-e2e-3',
    );
    const theirs = await request(http)
      .get('/checkout/plans')
      .set(auth(stranger))
      .expect(200);
    expect(theirs.body).toEqual([]);
    await request(http)
      .post('/checkout/plans')
      .set(auth(stranger))
      .send(plan)
      .expect(404);
    await request(http)
      .put(`/checkout/plans/${planId}`)
      .set(auth(stranger))
      .send({ ...plan, productId: undefined, expectedVersion: 1 })
      .expect(404);
    await request(http)
      .patch(`/checkout/plans/${planId}/active`)
      .set(auth(stranger))
      .send({ active: false, expectedVersion: 1 })
      .expect(404);

    // The plan sold: its period and way of charging no longer change.
    const locked = await request(http)
      .put(`/checkout/plans/${planId}`)
      .set(auth(tokens.seller))
      .send({
        ...plan,
        productId: undefined,
        intervalMonths: 6,
        expectedVersion: 1,
      })
      .expect(409);
    expect(locked.body).toMatchObject({ code: 'CHECKOUT_PLAN_LOCKED' });
  });

  it('vendedor na conta própria vende pela conta dele; o da conta Cifra+ não muda', async () => {
    const SELLER_PIX_KEY = 'pix@outra-loja.e2e.test';
    const crypto = app.get(PaymentCryptoService);
    const payments = app.get(CheckoutPaymentsService);
    const other = await login(`olga-${suffix}@e2e.test`, 'Nova-senha-e2e-2');
    const company = await prisma.company.findFirstOrThrow({
      where: { email: `outra-${suffix}@e2e.test` },
    });
    const own = (
      await request(http)
        .post('/checkout/products')
        .set(auth(other))
        .send({
          name: 'Curso da Outra Loja',
          priceCents: 10000,
          accessPeriodMonths: 12,
          deliveryMode: 'ACCESS_LINK',
          accessUrl: 'https://acesso.e2e.test/outra',
        })
        .expect(201)
    ).body as { slug: string };
    const settings = (
      await request(http).get('/checkout/settings').set(auth(other)).expect(200)
    ).body as Record<string, unknown> & { version: number };
    const turnCardOn = (status: number) =>
      request(http)
        .put('/checkout/settings')
        .set(auth(other))
        .send({
          expectedVersion: settings.version,
          displayName: settings.displayName,
          primaryColor: settings.primaryColor,
          pixEnabled: true,
          cardEnabled: true,
          maxInstallments: 3,
          pixFeePayer: 'SELLER',
          cardFeePayer: 'BUYER',
        })
        .expect(status);
    const account = `/admin/checkout/clients/${company.id}/account`;
    const order = () => ({
      bumpIds: [],
      method: 'PIX',
      buyer: {
        name: 'Bruna Lima',
        email: 'bruna@e2e.test',
        document: '52998224725',
        phone: '11977776666',
      },
      idempotencyKey: randomUUID(),
    });
    const sell = (to: string, status: number) =>
      request(http)
        .post(`/checkout/public/products/${to}/orders`)
        .send(order())
        .expect(status);
    const page = async (of: string) =>
      (await request(http).get(`/checkout/public/products/${of}`).expect(200))
        .body as { available: boolean; payment: { cardEnabled: boolean } };

    // A client created by the admin sells through its own account, and no
    // payout data is kept even though the request still sent it.
    expect(
      await prisma.checkoutSellerTerms.findFirstOrThrow({
        where: { companyId: company.id },
      }),
    ).toMatchObject({
      version: 1,
      accountMode: 'SELLER_ACCOUNT',
      payoutDocument: '',
      payoutPixKey: '',
      authorizationReference: null,
    });

    // No account of its own yet: nothing sells, even with the CifraMais
    // account ready, and its card cannot be turned on.
    expect(await page(own.slug)).toMatchObject({ available: false });
    expect((await sell(own.slug, 400)).body).toMatchObject({
      code: 'CHECKOUT_UNAVAILABLE',
    });
    expect((await turnCardOn(409)).body).toMatchObject({
      code: 'CARD_NOT_AVAILABLE',
    });

    // The admin sees the empty account, but saves nothing before the seller's
    // signed authorization is on the terms.
    const empty = await request(http)
      .get(account)
      .set(auth(tokens.admin))
      .expect(200);
    expect(empty.body).toMatchObject({
      current: null,
      identity: null,
      ready: false,
    });
    const unauthorized = await request(http)
      .put(`${account}/pix-fee`)
      .set(auth(tokens.admin))
      .send({ expectedVersion: 1, pixFeeBasisPoints: 100 })
      .expect(409);
    expect(unauthorized.body).toMatchObject({
      code: 'CHECKOUT_AUTHORIZATION_REQUIRED',
    });
    await request(http)
      .put(`/admin/checkout/clients/${company.id}/terms`)
      .set(auth(tokens.admin))
      .send({
        platformFeeBasisPoints: 150,
        authorizationReference: 'Termo e2e de 16/11',
        expectedVersion: 1,
      })
      .expect(200);

    // The seller's account as the admin leaves it after validation.
    const identity = await prisma.efiAccountIdentity.create({
      data: {
        ownership: 'COMPANY',
        companyId: company.id,
        environment: 'HOMOLOGATION',
        holderDocument: '45723174000110',
        efiAccountNumber: `8${Date.now()}`.slice(0, 12),
        payeeCode: 'payee-outra',
        pixKey: SELLER_PIX_KEY,
      },
    });
    await prisma.efiCredentialVersion.create({
      data: {
        identityId: identity.id,
        version: 1,
        status: 'ACTIVE',
        encryptedClientId: crypto.encrypt('client-outra'),
        encryptedClientSecret: crypto.encrypt('secret-outra'),
        encryptedCertificate: crypto.encrypt('cert-outra'),
        credentialKeyVersion: crypto.activeKeyVersion,
        certificateFingerprint: Array.from({ length: 32 }, () => 'CD').join(
          ':',
        ),
        certificateExpiresAt: new Date(Date.now() + 365 * 86_400_000),
        activatedAt: new Date(),
      },
    });
    // (The validation calls the Efí and is covered by unit tests.) A version
    // above every CifraMais one: versions are counted per owner.
    await prisma.checkoutPlatformSettings.create({
      data: {
        companyId: company.id,
        version: 999,
        identityId: identity.id,
        webhookConfiguredAt: new Date(),
        changedByUserId: 'admin',
      },
    });

    // The admin sets this seller's tariffs and turns its card on.
    await request(http)
      .put(`${account}/pix-fee`)
      .set(auth(tokens.admin))
      .send({ expectedVersion: 999, pixFeeBasisPoints: 100 })
      .expect(200);
    await request(http)
      .put(`${account}/pix-fee`)
      .set(auth(tokens.admin))
      .send({ expectedVersion: 999, pixFeeBasisPoints: 100 })
      .expect(409);
    const withCard = await request(http)
      .put(`${account}/card`)
      .set(auth(tokens.admin))
      .send({
        expectedVersion: 1000,
        cardEnabled: true,
        cashBasisPoints: 349,
        anticipationBasisPoints: 100,
        cardCreditDays: 30,
      })
      .expect(200);
    expect(withCard.body).toMatchObject({
      current: { version: 1001, pixFeeBasisPoints: 100, cardEnabled: true },
      identity: { id: identity.id, payeeCode: 'payee-outra' },
      ready: true,
    });
    // No credential leaves the API, in any form.
    const shown = JSON.stringify(withCard.body);
    for (const secret of ['client-outra', 'secret-outra', 'cert-outra'])
      expect(shown).not.toContain(secret);
    expect(shown).not.toMatch(/encrypted/i);
    expect(
      await prisma.auditLog.count({
        where: {
          companyId: company.id,
          action: {
            in: [
              'CHECKOUT_SELLER_PIX_FEE_CHANGED',
              'CHECKOUT_SELLER_CARD_CHANGED',
            ],
          },
        },
      }),
    ).toBe(2);
    const ownSettings = await prisma.checkoutPlatformSettings.findFirstOrThrow({
      where: { companyId: company.id },
      orderBy: { version: 'desc' },
    });
    await turnCardOn(200);

    // Only the admin, only for a checkout client that sells through its own
    // account: the seller of the CifraMais account has none.
    await request(http).get(account).set(auth(other)).expect(404);
    await request(http)
      .get(`/admin/checkout/clients/${randomUUID()}/account`)
      .set(auth(tokens.admin))
      .expect(404);
    const main = await prisma.checkoutProduct.findUniqueOrThrow({
      where: { slug },
      select: { companyId: true },
    });
    const refused = await request(http)
      .get(`/admin/checkout/clients/${main.companyId}/account`)
      .set(auth(tokens.admin))
      .expect(409);
    expect(refused.body).toMatchObject({
      code: 'CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED',
    });

    expect(await page(own.slug)).toMatchObject({
      available: true,
      payment: { cardEnabled: true },
    });
    pix.create.mockClear();
    const sold = (await sell(own.slug, 201)).body as { token: string };
    const saved = await prisma.checkoutOrder.findUniqueOrThrow({
      where: { publicToken: sold.token },
      include: { attempt: true },
    });
    expect(saved).toMatchObject({
      companyId: company.id,
      platformSettingsId: ownSettings.id,
      efiFeeBasisPoints: 100,
      platformFeeBasisPoints: 150,
      attempt: { issuerIdentityId: identity.id },
    });
    expect(pix.create).toHaveBeenCalledTimes(1);
    expect(pix.create.mock.calls[0]).toMatchObject([
      {
        identity: { id: identity.id },
        credential: { identityId: identity.id },
      },
      { pixKey: SELLER_PIX_KEY },
    ]);

    // The card is tokenized and charged with the seller's payee code.
    const quote = await request(http)
      .post(`/checkout/public/products/${own.slug}/card/quote`)
      .send({ bumpIds: [], couponCode: null, brand: 'visa' })
      .expect(200);
    expect(quote.body).toMatchObject({ payeeCode: 'payee-outra' });

    // A notice for the CifraMais key does not settle a sale of this account.
    const notice = (chave: string) => ({
      txid: saved.attempt!.efiTxid,
      chave,
      valor: '100.00',
      endToEndId: 'E2EOUTRA',
    });
    expect(await payments.handlePixEvent(notice(PIX_KEY))).toBe(false);
    expect(await payments.handlePixEvent(notice(SELLER_PIX_KEY))).toBe(true);
    expect(
      (
        await prisma.checkoutOrder.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).status,
    ).toBe('PAID');

    // A lost answer is checked at the account that issued the Pix.
    const lost = (await sell(own.slug, 201)).body as { token: string };
    const lostAttempt = await prisma.checkoutPaymentAttempt.findFirstOrThrow({
      where: { order: { publicToken: lost.token } },
    });
    await prisma.checkoutPaymentAttempt.update({
      where: { id: lostAttempt.id },
      data: { status: 'UNCERTAIN' },
    });
    pix.status.mockClear();
    pix.status.mockResolvedValue({
      status: 'CONCLUIDA',
      paidAmountCents: 10000,
      endToEndId: 'E2EOUTRA2',
    });
    await app.get(CheckoutOrdersService).reconcileUncertain();
    const asked = (
      pix.status.mock.calls as [{ identity: { id: string } }, string][]
    ).find(([, txid]) => txid === lostAttempt.efiTxid);
    pix.status.mockReset();
    expect(asked?.[0].identity.id).toBe(identity.id);
    expect(
      (
        await prisma.checkoutOrder.findUniqueOrThrow({
          where: { publicToken: lost.token },
        })
      ).status,
    ).toBe('PAID');

    // The money of both sales is already in the seller's account: its balance
    // is only the Cifra+ % it owes (1,5% of 100,00 each), with nothing to pay out.
    const balance = async () =>
      (
        await request(http)
          .get('/checkout/balance')
          .set(auth(other))
          .expect(200)
      ).body as Record<string, unknown>;
    expect(await balance()).toMatchObject({
      accountMode: 'SELLER_ACCOUNT',
      feeOwedCents: 300,
      releasedCents: 0,
      pendingCents: 0,
      suggestedPayoutCents: 0,
    });
    const ownSales = await request(http)
      .get('/checkout/sales')
      .set(auth(other))
      .expect(200);
    // What each sale leaves the seller: 100,00 less 1,00 of Efí and 1,50 of Cifra+.
    expect(
      (ownSales.body as { items: { netCents: number }[] }).items.map(
        (sale) => sale.netCents,
      ),
    ).toEqual([9750, 9750]);
    const payout = await request(http)
      .post(`/admin/checkout/clients/${company.id}/payouts`)
      .set(auth(tokens.admin))
      .send({
        idempotencyKey: randomUUID(),
        amountCents: 100,
        paidOn: '2026-11-17',
      })
      .expect(409);
    expect(payout.body).toMatchObject({
      code: 'CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED',
    });

    // A refund leaves the seller's account, and its Cifra+ % is no longer owed.
    const refund = {
      ...notice(SELLER_PIX_KEY),
      devolucoes: [{ id: 'DOUTRA', valor: '100.00', status: 'DEVOLVIDO' }],
    };
    await payments.handlePixEvent(refund);
    await payments.handlePixEvent(refund);
    expect(await balance()).toMatchObject({ feeOwedCents: 150 });
    const entries = await prisma.checkoutLedgerEntry.findMany({
      where: { orderId: saved.id },
      select: { kind: true, amountCents: true },
    });
    expect(Object.fromEntries(entries.map((entry) => [entry.kind, 0]))).toEqual(
      {
        SALE: 0,
        EFI_FEE: 0,
        PLATFORM_FEE: 0,
        REFUND: 0,
        PLATFORM_FEE_REVERSAL: 0,
        DIRECT_SETTLEMENT: 0,
      },
    );
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);

    // The seller of the CifraMais account keeps selling through it.
    const platformAccount = await request(http)
      .get('/admin/checkout/platform-account')
      .set(auth(tokens.admin))
      .expect(200);
    expect(platformAccount.body).toMatchObject({ ready: true });
    expect(
      (platformAccount.body as { current: { version: number } }).current
        .version,
    ).toBeLessThan(999);
    expect(JSON.stringify(platformAccount.body)).not.toContain(identity.id);
    expect(await page(slug)).toMatchObject({ available: true });
  });

  it('cartão na conta do vendedor: só o aviso da conta dele confirma, uma vez', async () => {
    const company = await prisma.company.findFirstOrThrow({
      where: { email: `outra-${suffix}@e2e.test` },
    });
    const product = await prisma.checkoutProduct.findFirstOrThrow({
      where: { companyId: company.id },
      select: { slug: true },
    });
    const sellerIdentity = await prisma.efiAccountIdentity.findFirstOrThrow({
      where: { companyId: company.id },
    });
    const platformIdentity = await prisma.efiAccountIdentity.findFirstOrThrow({
      where: { ownership: 'PLATFORM' },
    });
    const cards = app.get(CheckoutCardService);
    const accountOf = (mock: jest.Mock) =>
      (
        (mock.mock.calls as unknown[][]).at(-1)?.[0] as {
          identity: { id: string };
        }
      ).identity.id;

    const quote = (
      await request(http)
        .post(`/checkout/public/products/${product.slug}/card/quote`)
        .send({ bumpIds: [], couponCode: null, brand: 'visa' })
        .expect(200)
    ).body as { quoteId: string; options: { totalCents: number }[] };
    const one = quote.options[0]!;
    cardClient.submit.mockResolvedValueOnce({
      chargeId: '9901',
      status: 'waiting',
      totalCents: one.totalCents,
      installments: 1,
    });
    const created = await request(http)
      .post(`/checkout/public/products/${product.slug}/card/orders`)
      .send({
        bumpIds: [],
        couponCode: null,
        buyer: holder('86288366757', 'Lia Prado'),
        ...charge(quote.quoteId, '86288366757'),
      })
      .expect(201);
    const token = (created.body as { token: string }).token;
    // The charge left with the seller's credentials, not the CifraMais ones.
    expect(accountOf(cardClient.submit)).toBe(sellerIdentity.id);
    const sent = (cardClient.submit.mock.calls as unknown[][]).at(-1)?.[1] as {
      attemptId: string;
    };
    const status = async () =>
      (
        await prisma.checkoutOrder.findUniqueOrThrow({
          where: { publicToken: token },
        })
      ).status;

    // A notice that names another account never reaches this sale.
    cardClient.notification.mockResolvedValueOnce({
      customId: sent.attemptId,
      chargeId: '9901',
    });
    await expect(
      cards.handleNotification(platformIdentity.id, 'notif-outra-conta'),
    ).resolves.toBe(false);
    expect(await status()).toBe('PENDING');
    expect(
      await prisma.paymentWebhookAnomaly.count({
        where: {
          reasonCode: 'CHECKOUT_CARD_UNKNOWN_CHARGE',
          externalReference: sent.attemptId,
        },
      }),
    ).toBe(1);

    // The notice of its own account confirms it, read back at that account.
    cardClient.notification.mockResolvedValue({
      customId: sent.attemptId,
      chargeId: '9901',
    });
    cardClient.detail.mockResolvedValue({
      chargeId: '9901',
      customId: sent.attemptId,
      status: 'paid',
      method: 'credit_card',
      installments: 1,
      totalCents: one.totalCents,
    });
    for (const again of [1, 2])
      await expect(
        cards.handleNotification(sellerIdentity.id, `notif-9901-${again}`),
      ).resolves.toBe(true);
    expect(accountOf(cardClient.notification)).toBe(sellerIdentity.id);
    expect(accountOf(cardClient.detail)).toBe(sellerIdentity.id);
    cardClient.notification.mockReset();
    cardClient.detail.mockReset();

    expect(await status()).toBe('PAID');
    // Paid once: the repeated notice added nothing to the seller's ledger.
    expect(
      await prisma.checkoutLedgerEntry.count({
        where: { order: { publicToken: token }, kind: 'SALE' },
      }),
    ).toBe(1);
  });
});
