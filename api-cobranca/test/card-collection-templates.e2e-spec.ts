/** Real HTTP, financial snapshots, BullMQ and dispatch; external providers simulated. */
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { BillingService } from '../src/billing/billing.service';
import type { SendResendEmailInput } from '../src/common/resend-mailer.service';
import { EfiCardClient } from '../src/payment/efi-card.client';
import { FinancialEligibilityService } from '../src/financial-activation/financial-eligibility.service';
import { PaymentChargeService } from '../src/payment/payment-charge.service';
import { PaymentFeeService } from '../src/payment-fees/payment-fee.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MessageQueueService } from '../src/queue/message.queue';
import { collectionLogicalKey } from '../src/templates/template-selection';
import { OutboundDispatcherService } from '../src/whatsapp/outbound-dispatcher.service';
import {
  assertDisposable,
  auth,
  createTemplateApp,
  fakeDatafy,
  importAndMap,
  seedTenants,
  setGrant,
  sleep,
  untilState,
} from './support/template-e2e';

assertDisposable('card-collection-templates.e2e-spec.ts');
jest.setTimeout(90_000);
const { provider, restore } = fakeDatafy();

describe('Card collection rules and templates (disposable infrastructure)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Server;
  let companyId: string,
    companyToken: string,
    otherToken: string,
    admin: string;
  let cardTemplate: string, pixTemplate: string, issuerId: string;
  let submit: jest.SpyInstance;
  const emails: Array<Pick<SendResendEmailInput, 'to' | 'subject' | 'html'>> =
    [];
  let phoneSequence = 3302;
  let providerChargeSequence = 770001;

  async function eventually<T>(read: () => Promise<T | null>): Promise<T> {
    for (let i = 0; i < 150; i++) {
      const value = await read();
      if (value) return value;
      await sleep(100);
    }
    throw new Error(
      'Expected collection effect was not persisted within 15 seconds',
    );
  }

  async function fixture(
    steps: Array<Record<string, unknown>>,
    billingType: 'CREDIT_CARD' | 'PIX' | 'BOLIX' = 'CREDIT_CARD',
  ) {
    const created = await request(http)
      .post('/billing/rules')
      .set(auth(companyToken))
      .send({ name: `Regua ${randomUUID()}`, profileType: 'NEW' })
      .expect(201);
    const profileId = (created.body as { id: string }).id;
    const saved = await request(http)
      .put(`/billing/rules/${profileId}/steps`)
      .set(auth(companyToken))
      .send({ steps })
      .expect(200);
    const ruleSteps = saved.body as Array<{
      id: string;
      whatsappMethodTemplates: Record<string, string | null>;
    }>;
    const debtor = await prisma.debtor.create({
      data: {
        companyId,
        name: 'Pagador Cartao',
        document: '52998224725',
        phoneNumber: `551197660${phoneSequence++}`,
        email: `${randomUUID()}@e2e.test`,
        whatsappOptIn: true,
        collectionProfileId: profileId,
      },
    });
    let invoice = await prisma.invoice.create({
      data: {
        companyId,
        debtorId: debtor.id,
        originalAmount: 150,
        billingType,
        dueDate: new Date(Date.now() + 10 * 86_400_000),
        status: 'PENDING',
      },
    });
    if (billingType !== 'CREDIT_CARD') {
      // Persist a confirmed issuance with the real financial snapshot and a simulated
      // provider response. Collection must reuse it and send a genuinely payable link.
      const charges = app.get(PaymentChargeService);
      const financial = await app
        .get(FinancialEligibilityService)
        .resolveIssuance(companyId, billingType);
      const charge = await charges.createDraft(
        companyId,
        invoice.id,
        billingType,
        15000,
        financial,
      );
      const providerId = String(providerChargeSequence++);
      await charges.confirmIssuance(companyId, charge.id, {
        source: 'CREATION',
        billingMethod: billingType,
        gatewayId: billingType === 'PIX' ? charge.efiTxid! : providerId,
        ...(billingType === 'PIX'
          ? { txid: charge.efiTxid! }
          : {
              providerChargeId: providerId,
              boletoCode:
                '00190.00009 01234.567004 00000.001234 1 98760000015000',
              boletoLink: 'https://boleto.e2e.test/bolix',
            }),
        pixCopyPaste: '00020101021226700014br.gov.bcb.pix-e2e',
        paymentLink: 'https://app.e2e.test/pagar/provider-fixture',
        expiresAt: new Date(Date.now() + 40 * 86_400_000),
      });
      invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
    }
    return { invoice, debtor, profileId, ruleSteps };
  }

  const whatsappStep = (
    delayDays: number,
    override: string | null = cardTemplate,
  ) => ({
    stepOrder: 0,
    channel: 'WHATSAPP',
    delayDays,
    whatsappSelection: { mode: 'EXPLICIT', templateId: pixTemplate },
    whatsappMethodTemplates: { CREDIT_CARD: override },
  });

  async function initial(
    invoiceId: string,
    channels: Array<'WHATSAPP' | 'EMAIL'> = ['WHATSAPP'],
  ) {
    await app
      .get(MessageQueueService)
      .addInitialChargeJobs([
        { invoiceId, companyId, source: 'MANUAL', channels },
      ]);
    const queue = app.get<Queue>(getQueueToken('whatsapp-messages'));
    const jobId = `initial-charge_${companyId}_${invoiceId}`;
    await eventually(async () => {
      const job = await queue.getJob(jobId);
      const state = await job?.getState();
      if (state === 'delayed' && job?.failedReason)
        throw new Error(job.failedReason);
      if (state === 'failed') throw new Error(job?.failedReason);
      return state === 'completed' ? true : null;
    });
  }

  async function accepted(invoiceId: string, ruleStepId?: string) {
    const intent = await eventually(() =>
      prisma.communicationOutboundIntent.findFirst({
        where: {
          logicalKey: collectionLogicalKey({
            companyId,
            invoiceId,
            ruleStepId,
          }),
        },
      }),
    );
    await app.get(OutboundDispatcherService).recover();
    await untilState(prisma, intent.id, 'ACCEPTED');
    return intent;
  }

  async function assertCardLink(invoiceId: string, token: string) {
    const response = await request(http)
      .get(`/payments/public/${token}`)
      .expect(200);
    expect(response.body).toMatchObject({
      invoiceId,
      billingType: 'CREDIT_CARD',
      state: 'PAYABLE',
      canPay: true,
      pixCopyPaste: null,
      boletoLine: null,
      boletoLink: null,
      boletoPdf: null,
    });
    const charges = await prisma.paymentCharge.findMany({
      where: { companyId, invoiceId },
    });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      billingMethod: 'CREDIT_CARD',
      issuerIdentityId: issuerId,
      status: 'ACTIVE',
    });
    expect(
      await prisma.cardPaymentAttempt.count({ where: { invoiceId } }),
    ).toBe(0);
    expect(submit).not.toHaveBeenCalled();
  }

  beforeAll(async () => {
    const fetchFake = jest.mocked(globalThis.fetch);
    const sendDatafy = fetchFake.getMockImplementation()!;
    fetchFake.mockImplementation((input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (
        url.origin === 'https://api.resend.com' &&
        url.pathname === '/emails' &&
        init?.method === 'POST'
      ) {
        emails.push(JSON.parse(init.body as string) as (typeof emails)[number]);
        return Promise.resolve(Response.json({ id: `email-${randomUUID()}` }));
      }
      return sendDatafy(input, init);
    });
    app = await createTemplateApp();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as Server;
    const tenants = await seedTenants(app, '5511976633001');
    companyId = tenants.a;
    companyToken = tenants.tokens.a;
    otherToken = tenants.tokens.b;
    admin = tenants.tokens.admin;
    cardTemplate = await importAndMap(app, admin);
    await setGrant(app, admin, companyId, cardTemplate, true);
    const list = await request(http)
      .get('/admin/whatsapp-templates')
      .set(auth(admin))
      .expect(200);
    const pix = (
      list.body as {
        items: Array<{
          id: string;
          name: string;
          providerRevision: number;
          mappingRevision: number;
        }>;
      }
    ).items.find((t) => t.name === 'emissao_pix')!;
    pixTemplate = pix.id;
    await request(http)
      .put(`/admin/whatsapp-templates/${pix.id}/mapping`)
      .set(auth(admin))
      .send({
        expectedProviderRevision: pix.providerRevision,
        expectedMappingRevision: pix.mappingRevision,
        mapping: {
          body: {
            nome_devedor: { kind: 'SOURCE', source: 'DEBTOR_NAME' },
            valor: { kind: 'SOURCE', source: 'AMOUNT' },
            data_vencimento: { kind: 'SOURCE', source: 'DUE_DATE' },
          },
          pixButton: { index: 0, source: 'PIX_COPY_PASTE' },
        },
      })
      .expect(200);
    await setGrant(app, admin, companyId, pix.id, true);

    const company = await prisma.company.update({
      where: { id: companyId },
      data: { document: '11444777000161' },
    });
    const identity = await prisma.efiAccountIdentity.create({
      data: {
        companyId,
        ownership: 'COMPANY',
        environment: 'HOMOLOGATION',
        holderDocument: company.document,
        efiAccountNumber: '76633001',
        payeeCode: 'issuer',
        pixKey: 'fake',
        healthStatus: 'HEALTHY',
      },
    });
    issuerId = identity.id;
    const credential = await prisma.efiCredentialVersion.create({
      data: {
        identityId: issuerId,
        version: 1,
        status: 'ACTIVE',
        encryptedClientId: 'fake',
        encryptedClientSecret: 'fake',
        encryptedCertificate: 'fake',
        credentialKeyVersion: 'v1',
        certificateFingerprint: Array.from({ length: 32 }, () => 'AB').join(
          ':',
        ),
        certificateExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.$transaction(async (tx) => {
      const profile = await tx.financialProfileVersion.create({
        data: {
          companyId,
          version: 1,
          status: 'ACTIVE',
          origin: 'MANUAL_ADMIN',
          accountMode: 'CUSTOMER_ACCOUNT',
          payoutMode: 'DIRECT_TO_CUSTOMER',
          environment: 'HOMOLOGATION',
          enabledMethods: ['PIX', 'BOLIX'],
          issuerIdentityId: issuerId,
          issuerCredentialVersionId: credential.id,
          authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION',
          authorizationReference: 'simulated-contract',
          ownershipVerifiedAt: new Date(),
          validatedAt: new Date(),
          validationHash: 'fake',
          creationIdempotencyKey: randomUUID(),
          activationIdempotencyKey: randomUUID(),
          activatedAt: new Date(),
        },
      });
      await tx.company.update({
        where: { id: companyId },
        data: { activeFinancialProfileId: profile.id },
      });
    });
    await prisma.platformIntegrationState.upsert({
      where: { integration: 'EFI_PAYMENTS' },
      create: { integration: 'EFI_PAYMENTS', enabled: true },
      update: { enabled: true },
    });
    const client = app.get(EfiCardClient);
    jest.spyOn(client, 'account').mockResolvedValue({ identity } as never);
    jest.spyOn(client, 'platformPayee').mockReturnValue('platform');
    jest
      .spyOn(client, 'notificationUrl')
      .mockReturnValue('https://api.e2e.test/webhooks/efi/cobrancas');
    submit = jest
      .spyOn(client, 'submit')
      .mockRejectedValue(new Error('Collection must never debit a card'));
    await request(http)
      .post(`/admin/card-payments/${companyId}/settings`)
      .set(auth(admin))
      .send({
        issuerIdentityId: issuerId,
        enabled: true,
        expectedVersion: 0,
        onTimeBasisPoints: 200,
        overdueBasisPoints: 500,
        processingRates: ['visa', 'mastercard', 'elo', 'amex'].map((brand) => ({
          brand,
          installments: 1,
          basisPoints: 300,
          fixedCents: 0,
        })),
        validationReference: 'simulated-contract-validation',
      })
      .expect(201);

    for (const billingMethod of ['PIX', 'BOLIX'] as const) {
      await app.get(PaymentFeeService).createVersion(companyId, {
        billingMethod,
        effectiveFrom: new Date(0),
        efiFee: { kind: 'FIXED', amountCents: 100 },
        platformFee: { kind: 'PERCENTAGE', basisPoints: 250 },
      });
    }

    // Keep the worker, EmailService and Resend SDK real; fetch simulates the provider.
    const config = app.get(ConfigService);
    config.set('RESEND_API_KEY', 're_e2e_fake');
    config.set('RESEND_FROM_EMAIL', 'Cifra <collection@e2e.test>');
    config.set('RESEND_REPLY_TO', 'support@e2e.test');
  });

  afterAll(async () => {
    await app?.close();
    restore();
  });

  it('saves the card override, sends the Inicial template and a usable signed link once', async () => {
    const { invoice, profileId, ruleSteps } = await fixture([
      whatsappStep(-30),
    ]);
    expect(ruleSteps[0].whatsappMethodTemplates.CREDIT_CARD).toBe(cardTemplate);
    const profiles = await request(http)
      .get('/billing/rules')
      .set(auth(companyToken))
      .expect(200);
    expect(
      (profiles.body as Array<{ id: string; steps: unknown[] }>).find(
        (p) => p.id === profileId,
      )?.steps,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cardTemplateId: cardTemplate }),
      ]),
    );
    await request(http)
      .put(`/billing/rules/${profileId}/steps`)
      .set(auth(otherToken))
      .send({ steps: [whatsappStep(-30)] })
      .expect(404);
    await request(http)
      .put(`/billing/rules/${profileId}/steps`)
      .set(auth(companyToken))
      .send({
        steps: [
          {
            ...whatsappStep(-30),
            whatsappMethodTemplates: { CREDIT_CARD: pixTemplate },
          },
        ],
      })
      .expect(400);
    const before = provider.sends.length;
    await initial(invoice.id);
    expect(
      await prisma.whatsappTemplatePendingSend.findFirst({
        where: { invoiceId: invoice.id },
      }),
    ).toBeNull();
    await accepted(invoice.id);
    expect(provider.sends.length - before).toBe(1);
    const payload = provider.sends.at(-1) as {
      template: {
        name: string;
        components: Array<{
          sub_type?: string;
          parameters: Array<{ text?: string }>;
        }>;
      };
    };
    expect(payload.template.name).toBe('lembrete_real');
    expect(
      payload.template.components.some((c) => c.sub_type === 'payment_request'),
    ).toBe(false);
    const token = payload.template.components.find((c) => c.sub_type === 'url')!
      .parameters[0].text!;
    await assertCardLink(invoice.id, token);
    expect(
      await prisma.collectionAttempt.findFirst({
        where: { invoiceId: invoice.id, ruleStepId: ruleSteps[0].id },
      }),
    ).toMatchObject({ channel: 'WHATSAPP', status: 'SENT' });
    await initial(invoice.id);
    await app.get(BillingService).executeBilling(companyId);
    await app.get(OutboundDispatcherService).recover();
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentCharge.count({ where: { invoiceId: invoice.id } }),
    ).toBe(1);
    expect(provider.sends.length - before).toBe(1);
  });

  it('scheduled concurrent runs select the card override and reserve only one charge and message', async () => {
    const { invoice, ruleSteps } = await fixture([whatsappStep(0)]);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { dueDate: new Date(Date.now() - 86_400_000) },
    });
    const before = provider.sends.length;
    await Promise.all(
      [1, 2, 3].map(() => app.get(BillingService).executeBilling(companyId)),
    );
    await accepted(invoice.id, ruleSteps[0].id);
    expect(provider.sends.length - before).toBe(1);
    expect(provider.sends.at(-1)).toMatchObject({
      template: { name: 'lembrete_real' },
    });
    expect(
      await prisma.paymentCharge.count({ where: { invoiceId: invoice.id } }),
    ).toBe(1);
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(1);
    expect(
      await prisma.collectionAttempt.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('a card charge with a Pix-only base template is held without fallback or automatic resume', async () => {
    const { invoice } = await fixture([whatsappStep(-30, null)]);
    const before = provider.sends.length;
    await initial(invoice.id);
    expect(
      await prisma.whatsappTemplatePendingSend.findFirst({
        where: { invoiceId: invoice.id },
      }),
    ).toMatchObject({ state: 'BLOCKED', code: 'VALUE_MISSING' });
    await setGrant(app, admin, companyId, cardTemplate, true);
    await app.get(BillingService).executeBilling(companyId);
    await app.get(OutboundDispatcherService).recover();
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(0);
    expect(
      await prisma.paymentCharge.count({ where: { invoiceId: invoice.id } }),
    ).toBe(1);
    expect(provider.sends.length).toBe(before);
  });

  it('does not send an initial WhatsApp without opt-in', async () => {
    const { invoice, debtor } = await fixture([whatsappStep(-30)]);
    await prisma.debtor.update({
      where: { id: debtor.id },
      data: { whatsappOptIn: false },
    });
    const before = provider.sends.length;
    await initial(invoice.id);
    expect(
      await prisma.collectionLog.findFirst({
        where: {
          invoiceId: invoice.id,
          actionType: 'WHATSAPP_OPT_IN_REQUIRED',
        },
      }),
    ).not.toBeNull();
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(0);
    expect(provider.sends.length).toBe(before);
  });

  it.each(['PAID', 'CANCELED'] as const)(
    'does not issue or send when the invoice becomes %s before the initial worker',
    async (status) => {
      const { invoice } = await fixture([whatsappStep(-30)]);
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status },
      });
      const before = provider.sends.length;
      await initial(invoice.id);
      expect(
        await prisma.communicationOutboundIntent.count({
          where: { invoiceId: invoice.id },
        }),
      ).toBe(0);
      expect(
        await prisma.paymentCharge.count({ where: { invoiceId: invoice.id } }),
      ).toBe(0);
      expect(provider.sends.length).toBe(before);
    },
  );

  it.each([
    { method: 'CREDIT_CARD' as const, label: 'Cartão de crédito', day: -30 },
    { method: 'CREDIT_CARD' as const, label: 'Cartão de crédito', day: 0 },
    { method: 'PIX' as const, label: 'PIX', day: -30 },
    { method: 'PIX' as const, label: 'PIX', day: 0 },
    { method: 'BOLIX' as const, label: 'Bolix', day: -30 },
    { method: 'BOLIX' as const, label: 'Bolix', day: 0 },
  ])(
    'sends the $method email template at day $day, counting the step once',
    async ({ method, label, day }) => {
      const template = await prisma.globalEmailTemplate.create({
        data: {
          name: 'Email da regua',
          slug: `card-email-${randomUUID()}`,
          subject: 'Aviso da regua {{nome_devedor}}',
          content:
            'Texto exclusivo da regua {{metodo_pagamento}} {{payment_link}} {{nome_devedor}} {{valor}}',
        },
      });
      const { invoice, debtor, ruleSteps } = await fixture(
        [
          {
            stepOrder: 0,
            channel: 'EMAIL',
            delayDays: day,
            emailTemplateId: template.id,
          },
        ],
        method,
      );
      const before = emails.length;
      if (day === -30) await initial(invoice.id, ['EMAIL']);
      else {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { dueDate: new Date(Date.now() - 86_400_000) },
        });
        await Promise.all(
          [1, 2, 3].map(() =>
            app.get(BillingService).executeBilling(companyId),
          ),
        );
      }
      await eventually(() =>
        prisma.collectionAttempt.findFirst({
          where: {
            invoiceId: invoice.id,
            ruleStepId: ruleSteps[0].id,
            status: 'SENT',
          },
        }),
      );
      const sent = emails
        .slice(before)
        .find((e) => e.to.includes(debtor.email!))!;
      expect(sent).toMatchObject({ subject: 'Aviso da regua Pagador Cartao' });
      expect(sent.html).toContain(`Texto exclusivo da regua ${label}`);
      expect(sent.html).not.toContain('{{');
      const token = sent.html.match(
        /https:\/\/app\.e2e\.test\/pagar\/([A-Za-z0-9_.-]+)/,
      )![1];
      if (method === 'CREDIT_CARD') await assertCardLink(invoice.id, token);
      else {
        const page = await request(http)
          .get(`/payments/public/${token}`)
          .expect(200);
        expect(page.body).toMatchObject({
          invoiceId: invoice.id,
          billingType: method,
          canPay: true,
        });
        expect(page.body).toMatchObject({
          pixCopyPaste: invoice.efiPixCopiaECola,
        });
        if (method === 'PIX')
          expect(sent.html).toContain(invoice.efiPixCopiaECola!);
        if (method === 'BOLIX')
          expect(sent.html).toContain(invoice.boletoLinhaDigitavel!);
      }
      await app.get(BillingService).executeBilling(companyId);
      expect(
        await prisma.collectionAttempt.count({
          where: { invoiceId: invoice.id },
        }),
      ).toBe(1);
      expect(emails.filter((e) => e.to.includes(debtor.email!))).toHaveLength(
        1,
      );
    },
  );

  it('uses the company EMISSION default when there is no Inicial WhatsApp step', async () => {
    await request(http)
      .put(`/admin/whatsapp-templates/companies/${companyId}/defaults/EMISSION`)
      .set(auth(admin))
      .send({ templateId: cardTemplate, expectedVersion: 0 })
      .expect(200);
    const { invoice } = await fixture([whatsappStep(0)]);
    const before = provider.sends.length;
    await initial(invoice.id);
    await accepted(invoice.id);
    expect(provider.sends.length - before).toBe(1);
    expect(provider.sends.at(-1)).toMatchObject({
      template: { name: 'lembrete_real' },
    });
    expect(
      await prisma.collectionAttempt.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(0);
    await app.get(BillingService).executeBilling(companyId);
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(1);
  });

  it('fulfills both Inicial channels with distinct templates and reuses the same card charge', async () => {
    const template = await prisma.globalEmailTemplate.create({
      data: {
        name: 'Email dos dois canais',
        slug: `dual-email-${randomUUID()}`,
        subject: 'Email exclusivo {{nome_devedor}}',
        content: '{{payment_link}}',
      },
    });
    const { invoice, debtor } = await fixture([
      whatsappStep(-30),
      {
        stepOrder: 1,
        channel: 'EMAIL',
        delayDays: 0,
        emailTemplateId: template.id,
      },
    ]);
    const before = provider.sends.length;
    await initial(invoice.id, ['WHATSAPP', 'EMAIL']);
    await accepted(invoice.id);
    await eventually(() =>
      prisma.collectionAttempt.findFirst({
        where: { invoiceId: invoice.id, channel: 'EMAIL', status: 'SENT' },
      }),
    );
    expect(
      await prisma.collectionAttempt.count({
        where: { invoiceId: invoice.id, status: 'SENT' },
      }),
    ).toBe(2);
    expect(emails.filter((e) => e.to.includes(debtor.email!))).toHaveLength(1);
    expect(emails.find((e) => e.to.includes(debtor.email!))!.subject).toBe(
      'Email exclusivo Pagador Cartao',
    );
    await app.get(BillingService).executeBilling(companyId);
    expect(
      await prisma.paymentCharge.count({ where: { invoiceId: invoice.id } }),
    ).toBe(1);
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { invoiceId: invoice.id },
      }),
    ).toBe(1);
    expect(provider.sends.length - before).toBe(1);
  });

  it.each([-30, 0])(
    'does not send a rule email disabled by the company at day %s',
    async (day) => {
      const template = await prisma.globalEmailTemplate.create({
        data: {
          name: 'Email desativado',
          slug: `disabled-email-${randomUUID()}`,
          subject: 'Nao enviar',
          content: '{{payment_link}}',
        },
      });
      const { invoice, debtor } = await fixture([
        {
          stepOrder: 0,
          channel: 'EMAIL',
          delayDays: day,
          emailTemplateId: template.id,
        },
      ]);
      // Same HTTP operation as unchecking "Usar este modelo" in the company editor.
      const disabled = await request(http)
        .patch(`/email/templates/${template.id}`)
        .set(auth(companyToken))
        .send({ isActive: false })
        .expect(200);
      expect(disabled.body).toMatchObject({ isActive: false });
      if (day === -30) await initial(invoice.id, ['EMAIL']);
      else {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { dueDate: new Date(Date.now() - 86_400_000) },
        });
        await app.get(BillingService).executeBilling(companyId);
      }
      expect(
        await prisma.collectionAttempt.count({
          where: { invoiceId: invoice.id },
        }),
      ).toBe(0);
      expect(emails.filter((e) => e.to.includes(debtor.email!))).toHaveLength(
        0,
      );
    },
  );
});
