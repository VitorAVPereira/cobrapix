import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import type { Server } from 'http';
import * as bcrypt from 'bcryptjs';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ThrottleGuard } from '../src/common/guards/throttle.guard';
import { validateEnv } from '../src/config/env.validation';
import { InvoicesController } from '../src/invoices/invoices.controller';
import { InvoicesService } from '../src/invoices/invoices.service';
import { PaymentCryptoService } from '../src/payment/payment-crypto.service';
import { PaymentModule } from '../src/payment/payment.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  InitialChargeJob,
  MessageQueueService,
} from '../src/queue/message.queue';
import { MessagingLimitService } from '../src/queue/services/messaging-limit.service';
import { WebhooksController } from '../src/webhooks/webhooks.controller';
import { EfiWebhookGuard } from '../src/webhooks/efi-webhook.guard';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { WhatsAppConversationService } from '../src/whatsapp/conversation.service';

jest.mock('sdk-node-apis-efi', () => {
  const client = {
    pixCreateDueCharge: jest.fn(
      (): Promise<Record<string, never>> => Promise.resolve({}),
    ),
    pixDetailDueCharge: jest.fn(
      (params: { txid: string }): Promise<unknown> =>
        Promise.resolve({
          txid: params.txid,
          loc: {
            id: 321,
            location: `https://efi-smoke.test/pix/${params.txid}`,
          },
          status: 'ATIVA',
        }),
    ),
    pixGenerateQRCode: jest.fn(
      (): Promise<unknown> =>
        Promise.resolve({
          qrcode: 'pix-copy-paste-smoke',
          imagemQrcode: 'pix-qrcode-image-smoke',
        }),
    ),
    pixSplitConfig: jest.fn(
      (): Promise<unknown> => Promise.resolve({ id: 'split-smoke' }),
    ),
    pixSplitLinkDueCharge: jest.fn(
      (): Promise<Record<string, never>> => Promise.resolve({}),
    ),
    createOneStepCharge: jest.fn((): Promise<unknown> => Promise.resolve({})),
    getNotification: jest.fn((): Promise<unknown> => Promise.resolve({})),
  };

  return {
    __esModule: true,
    default: jest.fn(() => client),
  };
});

jest.setTimeout(60_000);

interface LoginResponse {
  access_token: string;
  user: {
    companyId: string;
  };
}

interface InvoiceResponse {
  invoiceId: string;
  status: string;
  billing_type: string;
  payment: {
    generated: boolean;
  };
}

interface InvoiceListResponse {
  data: InvoiceResponse[];
  total: number;
}

interface PaymentResponse {
  success: boolean;
  invoiceId: string;
  gatewayId: string;
  txid: string;
  pixCopyPaste: string;
  paymentLink: string;
}

interface PaymentStatusResponse {
  invoiceId: string;
  status: string;
  gatewayId: string | null;
  txid: string | null;
  pixCopyPaste: string | null;
  paidAt: string | null;
}

interface WebhookResponse {
  processed: boolean;
  invoiceId: string;
  status: string;
}

interface PaymentNotificationResponse {
  data: Array<{
    invoiceId: string;
    status: string;
    recipientEmails: string[];
    amount: number;
    billingType: string;
    paidAt: string | null;
    studentName: string | null;
    summary: {
      invoiceId: string;
      amount: number;
      debtorName: string;
      studentName: string | null;
    };
  }>;
  unreadCount: number;
}

interface NoopMessageQueue {
  addInitialChargeJobs(jobs: InitialChargeJob[]): Promise<void>;
}

interface NoopGuard {
  canActivate(): boolean;
}

function responseBody<T>(response: Response): T {
  return response.body as T;
}

function ensureTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ??= 'test_jwt_secret_with_at_least_32_characters';
  process.env.PAYMENT_SECRET_KEY ??=
    'test_payment_secret_with_at_least_32_characters';
  process.env.EFI_WEBHOOK_SECRET ??=
    'test_webhook_secret_with_at_least_32_characters';
  process.env.EFI_PLATFORM_SPLIT_PERCENTAGE = '0';
  process.env.EFI_WEBHOOK_BASE_URL ??= 'https://webhooks.cobrapix.test';
}

describe('CobraPix main flow smoke (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let paymentCrypto: PaymentCryptoService;
  let companyId: string | undefined;

  const password = 'senha123';
  const runId = randomUUID().slice(0, 8);
  const companyEmail = `smoke-company-${runId}@cobrapix.test`;
  const userEmail = `smoke-user-${runId}@cobrapix.test`;
  const notificationEmail = `baixa-${runId}@cobrapix.test`;
  const debtorEmail = `responsavel-${runId}@cobrapix.test`;
  const document = `99${randomInt(10_000_000_000, 99_999_999_999)}`;

  beforeAll(async () => {
    ensureTestEnv();

    const noopMessageQueue: NoopMessageQueue = {
      addInitialChargeJobs(): Promise<void> {
        return Promise.resolve();
      },
    };
    const noopGuard: NoopGuard = {
      canActivate: () => true,
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: validateEnv,
          cache: false,
        }),
        AuthModule,
        PaymentModule,
      ],
      controllers: [InvoicesController, WebhooksController],
      providers: [
        InvoicesService,
        WebhooksService,
        EfiWebhookGuard,
        {
          provide: ThrottleGuard,
          useValue: noopGuard,
        },
        {
          provide: MessageQueueService,
          useValue: noopMessageQueue,
        },
        {
          provide: MessagingLimitService,
          useValue: {},
        },
        {
          provide: WhatsAppConversationService,
          useValue: {},
        },
        {
          provide: APP_FILTER,
          useClass: GlobalExceptionFilter,
        },
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

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    paymentCrypto = app.get(PaymentCryptoService);
    httpServer = app.getHttpServer() as Server;
    await cleanStaleSmokeData();
  });

  afterAll(async () => {
    await cleanSmokeData();
    await app?.close();
  });

  it('creates an invoice, generates an Efi Pix charge, processes payment webhook, and creates baixa notification', async () => {
    const accessToken = await createCompanyAndLogin();

    const createdInvoice = await createInvoice(accessToken);
    const selectedInvoice = await selectPendingInvoice(
      accessToken,
      createdInvoice.invoiceId,
    );

    expect(selectedInvoice).toMatchObject({
      invoiceId: createdInvoice.invoiceId,
      status: 'PENDING',
      billing_type: 'PIX',
      payment: {
        generated: false,
      },
    });

    const payment = await generateEfiCharge(
      accessToken,
      selectedInvoice.invoiceId,
    );

    expect(payment).toMatchObject({
      success: true,
      invoiceId: selectedInvoice.invoiceId,
      gatewayId: payment.txid,
      pixCopyPaste: 'pix-copy-paste-smoke',
      paymentLink: `https://efi-smoke.test/pix/${payment.txid}`,
    });

    const pendingPayment = await getPaymentStatus(
      accessToken,
      selectedInvoice.invoiceId,
    );

    expect(pendingPayment).toMatchObject({
      invoiceId: selectedInvoice.invoiceId,
      status: 'PENDING',
      gatewayId: payment.txid,
      txid: payment.txid,
      pixCopyPaste: 'pix-copy-paste-smoke',
      paidAt: null,
    });

    const webhook = await processPixWebhook(payment.txid);

    expect(webhook).toEqual({
      processed: true,
      invoiceId: selectedInvoice.invoiceId,
      status: 'PAID',
    });

    const paidPayment = await getPaymentStatus(
      accessToken,
      selectedInvoice.invoiceId,
    );

    expect(paidPayment.status).toBe('PAID');
    expect(paidPayment.paidAt).toEqual(expect.any(String));

    const notification = await getNotificationForInvoice(
      accessToken,
      selectedInvoice.invoiceId,
    );

    expect(notification).toMatchObject({
      invoiceId: selectedInvoice.invoiceId,
      status: 'PENDING',
      recipientEmails: [notificationEmail],
      amount: 123.45,
      billingType: 'PIX',
      studentName: 'Aluno Smoke',
      summary: {
        invoiceId: selectedInvoice.invoiceId,
        amount: 123.45,
        debtorName: 'Responsavel Smoke',
        studentName: 'Aluno Smoke',
      },
    });
    expect(notification.paidAt).toEqual(expect.any(String));
  });

  async function createCompanyAndLogin(): Promise<string> {
    const company = await prisma.company.create({
      data: {
        corporateName: `CobraPix Smoke ${runId}`,
        document,
        email: companyEmail,
        phoneNumber: '11999999999',
        gatewayProvider: 'EFI',
        gatewayStatus: 'PENDING',
        paymentNotificationEnabled: false,
        paymentNotificationEmails: [notificationEmail],
        addressPostalCode: '01311000',
        addressStreet: 'Avenida Paulista',
        addressNumber: '1000',
        addressDistrict: 'Bela Vista',
        addressCity: 'Sao Paulo',
        addressState: 'SP',
      },
      select: {
        id: true,
      },
    });

    companyId = company.id;

    await prisma.user.create({
      data: {
        email: userEmail,
        password: await bcrypt.hash(password, 10),
        name: 'Smoke Tester',
        companyId: company.id,
      },
    });

    await prisma.gatewayAccount.create({
      data: {
        companyId: company.id,
        provider: 'EFI',
        environment: 'homologation',
        status: 'ACTIVE',
        payeeCode: 'payee-smoke',
        efiAccountNumber: '123456',
        efiAccountDigit: '7',
        pixKey: 'pix-smoke-key',
        encryptedClientId: paymentCrypto.encrypt('efi-client-smoke'),
        encryptedClientSecret: paymentCrypto.encrypt('efi-secret-smoke'),
        encryptedCertificate: paymentCrypto.encrypt(
          Buffer.from('certificate-smoke').toString('base64'),
        ),
      },
    });

    const response = await request(httpServer)
      .post('/auth/login')
      .send({ email: userEmail, password })
      .expect(200);

    const body = responseBody<LoginResponse>(response);
    expect(body.user.companyId).toBe(company.id);

    return body.access_token;
  }

  async function createInvoice(accessToken: string): Promise<InvoiceResponse> {
    const response = await request(httpServer)
      .post('/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Responsavel Smoke',
        phone_number: '+55 11 99999-0000',
        email: debtorEmail,
        whatsappOptIn: true,
        original_amount: 123.45,
        due_date: '2026-05-20',
        billing_type: 'PIX',
        studentName: 'Aluno Smoke',
        studentEnrollment: 'MAT-001',
        studentGroup: 'Turma A',
      })
      .expect(201);

    const body = responseBody<InvoiceResponse>(response);
    expect(body.invoiceId).toEqual(expect.any(String));

    return body;
  }

  async function selectPendingInvoice(
    accessToken: string,
    invoiceId: string,
  ): Promise<InvoiceResponse> {
    const response = await request(httpServer)
      .get('/invoices')
      .query({ status: 'PENDING', search: 'Aluno Smoke' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = responseBody<InvoiceListResponse>(response);
    expect(body.total).toBeGreaterThanOrEqual(1);

    const invoice = body.data.find((item) => item.invoiceId === invoiceId);
    expect(invoice).toBeDefined();

    return invoice as InvoiceResponse;
  }

  async function generateEfiCharge(
    accessToken: string,
    invoiceId: string,
  ): Promise<PaymentResponse> {
    const response = await request(httpServer)
      .post('/payments/create')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ invoiceId, billingType: 'PIX' })
      .expect(201);

    return responseBody<PaymentResponse>(response);
  }

  async function getPaymentStatus(
    accessToken: string,
    invoiceId: string,
  ): Promise<PaymentStatusResponse> {
    const response = await request(httpServer)
      .get(`/payments/invoice/${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    return responseBody<PaymentStatusResponse>(response);
  }

  async function processPixWebhook(txid: string): Promise<WebhookResponse> {
    const response = await request(httpServer)
      .post('/webhooks/efi/pix')
      .set('x-api-key', process.env.EFI_WEBHOOK_SECRET ?? '')
      .send({
        pix: [
          {
            txid,
            valor: '123.45',
            horario: '2026-05-20T12:00:00Z',
          },
        ],
      })
      .expect(201);

    return responseBody<WebhookResponse>(response);
  }

  async function getNotificationForInvoice(
    accessToken: string,
    invoiceId: string,
  ): Promise<PaymentNotificationResponse['data'][number]> {
    const response = await request(httpServer)
      .get('/payment-notifications')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = responseBody<PaymentNotificationResponse>(response);
    expect(body.unreadCount).toBeGreaterThanOrEqual(1);

    const notification = body.data.find((item) => item.invoiceId === invoiceId);
    expect(notification).toBeDefined();

    return notification as PaymentNotificationResponse['data'][number];
  }

  async function cleanSmokeData(): Promise<void> {
    if (!companyId || !prisma) {
      return;
    }

    await deleteCompanyData(companyId);
  }

  async function cleanStaleSmokeData(): Promise<void> {
    const companies = await prisma.company.findMany({
      where: {
        email: {
          startsWith: 'smoke-company-',
          endsWith: '@cobrapix.test',
        },
      },
      select: {
        id: true,
      },
    });

    for (const company of companies) {
      await deleteCompanyData(company.id);
    }
  }

  async function deleteCompanyData(targetCompanyId: string): Promise<void> {
    await prisma.paymentNotification.deleteMany({
      where: { companyId: targetCompanyId },
    });
    await prisma.collectionLog.deleteMany({
      where: { companyId: targetCompanyId },
    });
    await prisma.invoice.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma.debtor.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma.originalBankAccount.deleteMany({
      where: { companyId: targetCompanyId },
    });
    await prisma.gatewayAccount.deleteMany({
      where: { companyId: targetCompanyId },
    });
    await prisma.user.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma.company.deleteMany({ where: { id: targetCompanyId } });
  }
});
