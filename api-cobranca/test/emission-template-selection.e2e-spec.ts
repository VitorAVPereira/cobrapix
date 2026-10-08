/**
 * First message of a charge chosen by the rule's "Inicial" step and by the billing method,
 * over real HTTP, the initial-charge queue and the dispatcher: the company picks a Pix
 * template and a BOLIX one on the same step; each charge sends its own; the scheduler
 * does not send the step again. Disposable PostgreSQL/Redis; Datafy simulated at `fetch`.
 */
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BillingService } from '../src/billing/billing.service';
import { PaymentService } from '../src/payment/payment.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MessageQueueService } from '../src/queue/message.queue';
import { collectionLogicalKey } from '../src/templates/template-selection';
import { OutboundDispatcherService } from '../src/whatsapp/outbound-dispatcher.service';
import {
  assertDisposable,
  auth,
  createTemplateApp,
  fakeDatafy,
  seedTenants,
  setGrant,
  sleep,
  untilState,
} from './support/template-e2e';

jest.setTimeout(240_000);
assertDisposable('emission-template-selection.e2e-spec.ts');

const PHONE_A = '5511976611002';
const { provider, restore } = fakeDatafy();

type AdminTemplate = {
  id: string;
  name: string;
  supported: boolean;
  providerRevision: number;
  mappingRevision: number;
  content: Record<string, unknown>;
};

describe('First message by the rule "Inicial" step and billing method (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Server;
  const tokens = { admin: '', a: '', b: '' };
  const ids = {
    a: '',
    debtorA: '',
    profile: '',
    inicial: '',
    pix: '',
    bolix: '',
  };

  const body = {
    nome_devedor: { kind: 'SOURCE', source: 'DEBTOR_NAME' },
    valor: { kind: 'SOURCE', source: 'AMOUNT' },
    data_vencimento: { kind: 'SOURCE', source: 'DUE_DATE' },
  };

  async function mapAndGrant(
    name: string,
    buttons: Record<string, unknown>,
  ): Promise<AdminTemplate> {
    const list = await request(http)
      .get('/admin/whatsapp-templates')
      .set(auth(tokens.admin));
    const template = (list.body as { items: AdminTemplate[] }).items.find(
      (item) => item.name === name,
    )!;
    await request(http)
      .put(`/admin/whatsapp-templates/${template.id}/mapping`)
      .set(auth(tokens.admin))
      .send({
        expectedProviderRevision: template.providerRevision,
        expectedMappingRevision: template.mappingRevision,
        mapping: { body, ...buttons },
      })
      .expect(200);
    await setGrant(app, tokens.admin, ids.a, template.id, true);
    return template;
  }

  /** Issued charge data the first charge reuses: no Efí call in this test. */
  function invoice(billingType: 'PIX' | 'BOLIX') {
    const gatewayId = `e2e-${randomUUID()}`;
    return prisma.invoice.create({
      data: {
        companyId: ids.a,
        debtorId: ids.debtorA,
        originalAmount: 150,
        dueDate: new Date(Date.now() + 10 * 86_400_000),
        status: 'PENDING',
        billingType,
        gatewayId,
        efiPixCopiaECola: `00020101021226860014br.gov.bcb.pix${gatewayId}`,
        ...(billingType === 'PIX'
          ? { efiTxid: gatewayId }
          : {
              efiChargeId: gatewayId,
              boletoLinhaDigitavel:
                '00190.00009 01234.567004 00000.001234 1 98760000015000',
              boletoLink: 'https://boleto.e2e.test/bolix',
            }),
      },
    });
  }

  /** Queues the first charge and waits for its message to be accepted. */
  async function firstCharge(invoiceId: string) {
    await app
      .get(MessageQueueService, { strict: false })
      .addInitialChargeJobs([
        { invoiceId, companyId: ids.a, source: 'MANUAL' },
      ]);
    const logicalKey = collectionLogicalKey({ companyId: ids.a, invoiceId });
    for (let i = 0; i < 300; i++) {
      const intent = await prisma.communicationOutboundIntent.findFirst({
        where: { logicalKey },
      });
      if (intent) {
        await app.get(OutboundDispatcherService).recover();
        await untilState(prisma, intent.id, 'ACCEPTED');
        return;
      }
      await sleep(100);
    }
    throw new Error(`no first message for ${invoiceId}`);
  }

  beforeAll(async () => {
    app = await createTemplateApp();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as Server;
    // Financial activation is covered elsewhere; here only the messages matter.
    jest
      .spyOn(
        app.get(PaymentService, { strict: false }),
        'hasActiveFinancialProfile',
      )
      .mockResolvedValue(true);
    const tenants = await seedTenants(app, PHONE_A);
    Object.assign(tokens, tenants.tokens);
    ids.a = tenants.a;
    ids.debtorA = tenants.debtorA;
    await request(http)
      .post('/admin/whatsapp-templates/sync')
      .set(auth(tokens.admin))
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
    restore();
  });

  it('the BOLIX template with Pix, boleto and link buttons is supported and mapped', async () => {
    const pix = await mapAndGrant('emissao_pix', {
      pixButton: { index: 0, source: 'PIX_COPY_PASTE' },
    });
    // The boleto button is bound to the invoice line, never left implicit.
    const list = await request(http)
      .get('/admin/whatsapp-templates')
      .set(auth(tokens.admin));
    const bolixView = (list.body as { items: AdminTemplate[] }).items.find(
      (item) => item.name === 'emissao_bolix',
    )!;
    expect(bolixView).toMatchObject({
      supported: true,
      content: {
        button: { label: 'Abrir link de pagamento', index: 2 },
        pixButton: { label: 'Copiar código Pix', index: 0 },
        boletoButton: { label: 'Copiar código do boleto', index: 1 },
      },
    });
    const refused = await request(http)
      .put(`/admin/whatsapp-templates/${bolixView.id}/mapping`)
      .set(auth(tokens.admin))
      .send({
        expectedProviderRevision: bolixView.providerRevision,
        expectedMappingRevision: bolixView.mappingRevision,
        mapping: {
          body,
          pixButton: { index: 0, source: 'PIX_COPY_PASTE' },
          paymentButton: { index: 2, source: 'PAYMENT_URL_SUFFIX' },
        },
      });
    expect(refused.status).toBe(400);
    const bolix = await mapAndGrant('emissao_bolix', {
      pixButton: { index: 0, source: 'PIX_COPY_PASTE' },
      boletoButton: { index: 1, source: 'BOLETO_LINE' },
      paymentButton: { index: 2, source: 'PAYMENT_URL_SUFFIX' },
    });
    ids.pix = pix.id;
    ids.bolix = bolix.id;
  });

  it('the company picks one template per billing method on the Inicial step', async () => {
    const created = await request(http)
      .post('/billing/rules')
      .set(auth(tokens.a))
      .send({ name: 'Emissao por forma de pagamento', profileType: 'NEW' });
    expect(created.status).toBe(201);
    ids.profile = (created.body as { id: string }).id;
    const steps = (bolix: string | null, pix?: string) => ({
      steps: [
        {
          stepOrder: 0,
          channel: 'WHATSAPP',
          delayDays: -30,
          whatsappSelection: { mode: 'EXPLICIT', templateId: ids.pix },
          whatsappMethodTemplates: {
            BOLIX: bolix,
            ...(pix ? { PIX: pix } : {}),
          },
        },
        {
          stepOrder: 1,
          channel: 'WHATSAPP',
          delayDays: 60,
          whatsappSelection: { mode: 'DEFAULT', purpose: 'CRITICAL_OVERDUE' },
        },
      ],
    });
    // A template reading the boleto never serves Pix charges.
    const incompatible = await request(http)
      .put(`/billing/rules/${ids.profile}/steps`)
      .set(auth(tokens.a))
      .send(steps(null, ids.bolix));
    expect(incompatible.status).toBe(400);
    const saved = await request(http)
      .put(`/billing/rules/${ids.profile}/steps`)
      .set(auth(tokens.a))
      .send(steps(ids.bolix));
    expect(saved.status).toBe(200);
    const inicial = (saved.body as Array<Record<string, unknown>>)[0]!;
    expect(inicial).toMatchObject({
      whatsappSelection: { mode: 'EXPLICIT', templateId: ids.pix },
      whatsappStatus: { ready: true, code: null },
      whatsappMethodTemplates: { PIX: null, BOLETO: null, BOLIX: ids.bolix },
      whatsappMethodStatus: { BOLIX: { ready: true, code: null } },
      // A Pix button cannot serve pure boleto or card charges.
      whatsappIncompatibleMethods: ['BOLETO', 'CREDIT_CARD'],
    });
    ids.inicial = inicial.id as string;
    await prisma.debtor.update({
      where: { id: ids.debtorA },
      data: { collectionProfileId: ids.profile },
    });
  });

  it('each charge sends the template of its billing method, once', async () => {
    const bolixCharge = await invoice('BOLIX');
    const before = provider.sends.length;
    await firstCharge(bolixCharge.id);
    expect(provider.sends.length - before).toBe(1);
    expect(provider.sends.at(-1)).toMatchObject({
      type: 'template',
      template: {
        name: 'emissao_bolix',
        components: [
          { type: 'body' },
          { type: 'button', sub_type: 'url', index: '2' },
          {
            sub_type: 'payment_request',
            index: '0',
            parameters: [
              {
                action: {
                  payment_request: {
                    payment_setting: {
                      type: 'pix_dynamic_code',
                      pix_dynamic_code: {
                        code: bolixCharge.efiPixCopiaECola,
                      },
                    },
                  },
                },
              },
            ],
          },
          {
            sub_type: 'payment_request',
            index: '1',
            parameters: [
              {
                action: {
                  payment_request: {
                    payment_setting: {
                      type: 'boleto',
                      boleto: {
                        digitable_line:
                          '00190000090123456700400000001234198760000015000',
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    });
    // The first message fulfilled the Inicial step.
    await expect(
      prisma.collectionAttempt.findFirst({
        where: { invoiceId: bolixCharge.id, ruleStepId: ids.inicial },
      }),
    ).resolves.toMatchObject({ channel: 'WHATSAPP', status: 'SENT' });

    const pixCharge = await invoice('PIX');
    await firstCharge(pixCharge.id);
    expect(provider.sends.at(-1)).toMatchObject({
      template: {
        name: 'emissao_pix',
        components: [
          { type: 'body' },
          {
            sub_type: 'payment_request',
            index: '0',
            parameters: [
              {
                action: {
                  payment_request: {
                    payment_setting: {
                      pix_dynamic_code: { code: pixCharge.efiPixCopiaECola },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    // The scheduler finds both Inicial steps fulfilled: no second emission message.
    const sent = provider.sends.length;
    await app.get(BillingService).executeBilling(ids.a);
    await app.get(OutboundDispatcherService).recover();
    await sleep(1500);
    expect(provider.sends.length).toBe(sent);
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { companyId: ids.a, logicalKey: { contains: ids.inicial } },
      }),
    ).toBe(0);
  });
});
