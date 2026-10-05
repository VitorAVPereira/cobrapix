/**
 * Whole catalog flow over real HTTP and JWT with two companies: the admin imports, maps
 * and grants only to A; A picks the template in its rule; B is refused; revoking holds
 * the send; fixing the grant alone sends nothing; the admin reviews; a paid invoice is
 * closed without a message and the eligible one produces exactly one transmission.
 * Disposable PostgreSQL/Redis (test/e2e-disposable.cjs); Datafy is simulated at `fetch`.
 */
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TemplateSendPreparerService } from '../src/templates/template-send-preparer.service';
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

jest.setTimeout(240_000);
assertDisposable('template-catalog-flow.e2e-spec.ts');

const PHONE_A = '5511976611001';
const { provider, restore } = fakeDatafy();

type PresentedStep = {
  id: string;
  stepOrder: number;
  channel: 'EMAIL' | 'WHATSAPP';
  delayDays: number;
  sendTimeStart: string | null;
  sendTimeEnd: string | null;
  emailTemplateId: string | null;
  whatsappSelection: Record<string, unknown> | null;
  whatsappStatus: { ready: boolean; code: string | null } | null;
};
type Profile = { id: string; profileType: string; steps: PresentedStep[] };

/** Same steps (IDs, order, delays) with one WhatsApp step switched to the given choice. */
function stepsWith(
  steps: PresentedStep[],
  stepId: string,
  selection: Record<string, unknown>,
) {
  return steps.map((step) => ({
    id: step.id,
    stepOrder: step.stepOrder,
    channel: step.channel,
    delayDays: step.delayDays,
    ...(step.sendTimeStart ? { sendTimeStart: step.sendTimeStart } : {}),
    ...(step.sendTimeEnd ? { sendTimeEnd: step.sendTimeEnd } : {}),
    ...(step.channel === 'EMAIL'
      ? step.emailTemplateId
        ? { emailTemplateId: step.emailTemplateId }
        : {}
      : {
          whatsappSelection:
            step.id === stepId ? selection : step.whatsappSelection,
        }),
  }));
}

describe('Template catalog flow with two companies (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Server;
  const tokens = { admin: '', a: '', b: '' };
  const ids = {
    a: '',
    b: '',
    template: '',
    profileA: '',
    stepA: '',
    eligible: '',
    paid: '',
    debtorA: '',
  };
  async function rules(token: string): Promise<Profile[]> {
    const response = await request(http).get('/billing/rules').set(auth(token));
    expect(response.status).toBe(200);
    return response.body as Profile[];
  }

  const grant = (enabled: boolean) =>
    setGrant(app, tokens.admin, ids.a, ids.template, enabled);

  function prepareFor(invoiceId: string) {
    return app.get(TemplateSendPreparerService, { strict: false }).prepare({
      logicalKey: collectionLogicalKey({
        companyId: ids.a,
        invoiceId,
        ruleStepId: ids.stepA,
      }),
      origin: 'COLLECTION',
      context: { companyId: ids.a, invoiceId, debtorId: ids.debtorA },
      selection: { mode: 'EXPLICIT', templateId: ids.template },
      ruleStepId: ids.stepA,
    });
  }

  beforeAll(async () => {
    app = await createTemplateApp();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as Server;
    const tenants = await seedTenants(app, PHONE_A);
    Object.assign(tokens, tenants.tokens);
    ids.a = tenants.a;
    ids.b = tenants.b;
    ids.debtorA = tenants.debtorA;
    const invoice = () =>
      prisma.invoice.create({
        data: {
          companyId: ids.a,
          debtorId: ids.debtorA,
          originalAmount: 150,
          dueDate: new Date(Date.now() + 3 * 86_400_000),
          status: 'PENDING',
        },
      });
    ids.eligible = (await invoice()).id;
    ids.paid = (await invoice()).id;
  });

  afterAll(async () => {
    await app?.close();
    restore();
  });

  it('admin imports and maps; nothing is granted by the import', async () => {
    ids.template = await importAndMap(app, tokens.admin);
    for (const companyId of [ids.a, ids.b]) {
      expect(
        await prisma.companyWhatsappTemplateGrant.count({
          where: { companyId },
        }),
      ).toBe(0);
      expect(
        await prisma.companyWhatsappTemplateDefault.count({
          where: { companyId },
        }),
      ).toBe(0);
    }
  });

  it('only A is granted; A picks it in its rule and B is refused', async () => {
    await grant(true);
    const listB = await request(http).get('/templates').set(auth(tokens.b));
    expect(listB.body).toEqual({ items: [], nextCursor: null, total: 0 });

    const profileA = (await rules(tokens.a))[0]!;
    const stepA = profileA.steps.find((step) => step.channel === 'WHATSAPP')!;
    ids.profileA = profileA.id;
    ids.stepA = stepA.id;
    const choose = await request(http)
      .put(`/billing/rules/${profileA.id}/steps`)
      .set(auth(tokens.a))
      .send({
        steps: stepsWith(profileA.steps, stepA.id, {
          mode: 'EXPLICIT',
          templateId: ids.template,
        }),
      });
    expect(choose.status).toBe(200);
    const saved = (choose.body as PresentedStep[]).find(
      (step) => step.id === stepA.id,
    )!;
    expect(saved).toMatchObject({
      whatsappSelection: { mode: 'EXPLICIT', templateId: ids.template },
      whatsappStatus: { ready: true, code: null },
      stepOrder: stepA.stepOrder,
      delayDays: stepA.delayDays,
    });

    const profileB = (await rules(tokens.b))[0]!;
    const stepB = profileB.steps.find((step) => step.channel === 'WHATSAPP')!;
    const refused = await request(http)
      .put(`/billing/rules/${profileB.id}/steps`)
      .set(auth(tokens.b))
      .send({
        steps: stepsWith(profileB.steps, stepB.id, {
          mode: 'EXPLICIT',
          templateId: ids.template,
        }),
      });
    expect(refused.status).toBe(400);
    const previewB = await request(http)
      .get(`/templates/${ids.template}/preview`)
      .set(auth(tokens.b));
    expect(previewB.status).toBe(404);
  });

  it('revoking holds the sends; fixing the grant alone sends nothing', async () => {
    await grant(false);
    const stepAfterRevoke = (await rules(tokens.a))
      .find((profile) => profile.id === ids.profileA)!
      .steps.find((step) => step.id === ids.stepA)!;
    expect(stepAfterRevoke.whatsappStatus).toEqual({
      ready: false,
      code: 'NOT_GRANTED',
    });
    await expect(prepareFor(ids.eligible)).resolves.toMatchObject({
      status: 'BLOCKED',
      code: 'NOT_GRANTED',
    });
    await expect(prepareFor(ids.paid)).resolves.toMatchObject({
      status: 'BLOCKED',
      code: 'NOT_GRANTED',
    });
    const companyView = await request(http)
      .get('/communications/template-pending')
      .set(auth(tokens.a));
    const items = (
      companyView.body as { items: Array<Record<string, unknown>> }
    ).items;
    expect(items).toHaveLength(2);
    expect(items[0]).not.toHaveProperty('templateId');
    const otherCompany = await request(http)
      .get('/communications/template-pending')
      .set(auth(tokens.b));
    expect(otherCompany.body).toEqual({ items: [], nextCursor: null });

    await grant(true);
    await app.get(OutboundDispatcherService).recover();
    await sleep(1500);
    expect(provider.sends).toHaveLength(0);
    expect(
      await prisma.whatsappTemplatePendingSend.count({
        where: { companyId: ids.a, state: 'BLOCKED' },
      }),
    ).toBe(2);
  });

  it('admin reviews: the paid invoice closes silently, the eligible one sends once', async () => {
    await prisma.invoice.update({
      where: { id: ids.paid },
      data: { status: 'PAID' },
    });
    const listed = await request(http)
      .get(`/communications/admin/template-pending?companyId=${ids.a}`)
      .set(auth(tokens.admin));
    const pendingIds = (
      listed.body as { items: Array<{ id: string; invoiceId: string }> }
    ).items;
    expect(pendingIds).toHaveLength(2);
    const asCompany = await request(http)
      .post('/communications/admin/template-pending/reviews')
      .set(auth(tokens.a))
      .send({ items: pendingIds.map((item) => ({ pendingId: item.id })) });
    expect(asCompany.status).toBe(403);

    const review = await request(http)
      .post('/communications/admin/template-pending/reviews')
      .set(auth(tokens.admin))
      .send({ items: pendingIds.map((item) => ({ pendingId: item.id })) });
    expect(review.status).toBe(201);
    const byInvoice = new Map(
      (
        review.body as {
          items: Array<{
            invoiceId: string;
            action: string;
            reason: string | null;
          }>;
        }
      ).items.map((item) => [item.invoiceId, item]),
    );
    expect(byInvoice.get(ids.eligible)).toMatchObject({ action: 'RESUME' });
    expect(byInvoice.get(ids.paid)).toMatchObject({
      action: 'CLOSE',
      reason: 'INVOICE_NOT_PENDING',
    });
    expect(provider.sends).toHaveLength(0);

    const key = randomUUID();
    const reviewId = (review.body as { id: string }).id;
    const confirm = () =>
      request(http)
        .post(
          `/communications/admin/template-pending/reviews/${reviewId}/confirm`,
        )
        .set(auth(tokens.admin))
        .send({ idempotencyId: key });
    const [first, second] = await Promise.all([confirm(), confirm()]);
    const results = [first, second].filter((res) => res.status === 201);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const result = results[0]!.body as {
      intentIds: string[];
      closedPendingIds: string[];
    };
    expect(result.intentIds).toHaveLength(1);
    expect(result.closedPendingIds).toHaveLength(1);
    const repeated = await confirm();
    expect(repeated.body).toEqual(result);

    // Delivery follows the persistent intent recovery and the app's own worker.
    await app.get(OutboundDispatcherService).recover();
    await untilState(prisma, result.intentIds[0]!, 'ACCEPTED');
    await app.get(OutboundDispatcherService).recover();
    await sleep(1000);
    expect(provider.sends).toHaveLength(1);
    expect(provider.sends[0]).toMatchObject({ type: 'template', to: PHONE_A });
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { invoiceId: ids.paid, state: { in: ['ACCEPTED', 'SENDING'] } },
      }),
    ).toBe(0);
    const holds = await prisma.whatsappTemplatePendingSend.findMany({
      where: { companyId: ids.a },
      orderBy: { invoiceId: 'asc' },
    });
    expect(
      Object.fromEntries(holds.map((hold) => [hold.invoiceId, hold.state])),
    ).toEqual({ [ids.eligible]: 'RESUMED', [ids.paid]: 'CLOSED' });
  });

  it('a named template is mapped by variable name and sent with parameter_name', async () => {
    const list = await request(http)
      .get('/admin/whatsapp-templates')
      .set(auth(tokens.admin));
    const named = (
      list.body as {
        items: Array<{
          id: string;
          name: string;
          supported: boolean;
          parameterFormat: string;
          variables: string[];
          providerRevision: number;
          mappingRevision: number;
        }>;
      }
    ).items.find((item) => item.name === 'emissao_nomeada')!;
    expect(named).toMatchObject({
      supported: true,
      parameterFormat: 'NAMED',
      variables: [
        'nome_devedor',
        'nome_empresa',
        'valor',
        'data_vencimento',
        'metodo_pagamento',
      ],
      content: {
        button: { label: 'Link do pagamento', index: 0 },
        quickReplies: ['Preciso de ajuda'],
      },
    });
    const mapping = {
      body: {
        nome_devedor: { kind: 'SOURCE', source: 'DEBTOR_NAME' },
        nome_empresa: { kind: 'SOURCE', source: 'COMPANY_NAME' },
        valor: { kind: 'SOURCE', source: 'AMOUNT' },
        data_vencimento: { kind: 'SOURCE', source: 'DUE_DATE' },
        metodo_pagamento: { kind: 'LITERAL', value: 'Boleto' },
      },
      paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
    };
    // Positional keys are refused for a named template.
    const wrong = await request(http)
      .put(`/admin/whatsapp-templates/${named.id}/mapping`)
      .set(auth(tokens.admin))
      .send({
        expectedProviderRevision: named.providerRevision,
        expectedMappingRevision: named.mappingRevision,
        mapping: {
          body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' } },
        },
      });
    expect(wrong.status).toBe(400);
    await request(http)
      .put(`/admin/whatsapp-templates/${named.id}/mapping`)
      .set(auth(tokens.admin))
      .send({
        expectedProviderRevision: named.providerRevision,
        expectedMappingRevision: named.mappingRevision,
        mapping,
      })
      .expect(200);
    await setGrant(app, tokens.admin, ids.a, named.id, true);

    const invoiceId = (
      await prisma.invoice.create({
        data: {
          companyId: ids.a,
          debtorId: ids.debtorA,
          originalAmount: 150,
          dueDate: new Date('2026-10-05T12:00:00.000Z'),
          status: 'PENDING',
        },
      })
    ).id;
    const prepared = await app
      .get(TemplateSendPreparerService, { strict: false })
      .prepare({
        logicalKey: collectionLogicalKey({ companyId: ids.a, invoiceId }),
        origin: 'COLLECTION',
        context: { companyId: ids.a, invoiceId, debtorId: ids.debtorA },
        selection: { mode: 'EXPLICIT', templateId: named.id },
      });
    expect(prepared.status).toBe('QUEUED');
    const before = provider.sends.length;
    await app.get(OutboundDispatcherService).recover();
    await untilState(
      prisma,
      (prepared as { intentId: string }).intentId,
      'ACCEPTED',
    );
    expect(provider.sends.length - before).toBe(1);
    expect(provider.sends.at(-1)).toMatchObject({
      type: 'template',
      template: {
        name: 'emissao_nomeada',
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'nome_devedor',
                text: 'Pagador A',
              },
              {
                type: 'text',
                parameter_name: 'nome_empresa',
                text: expect.any(String) as string,
              },
              { type: 'text', parameter_name: 'valor', text: 'R$ 150,00' },
              {
                type: 'text',
                parameter_name: 'data_vencimento',
                text: '05/10/2026',
              },
              {
                type: 'text',
                parameter_name: 'metodo_pagamento',
                text: 'Boleto',
              },
            ],
          },
          // Quick reply "Preciso de ajuda" is sent as approved, without parameters.
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: expect.any(String) as string }],
          },
        ],
      },
    });
  });

  it('a "Copy Pix code" template carries the invoice Pix code; without one the send waits', async () => {
    const list = await request(http)
      .get('/admin/whatsapp-templates')
      .set(auth(tokens.admin));
    const pix = (
      list.body as {
        items: Array<{
          id: string;
          name: string;
          providerRevision: number;
          mappingRevision: number;
        }>;
      }
    ).items.find((item) => item.name === 'emissao_pix')!;
    expect(pix).toMatchObject({
      supported: true,
      supportReason: null,
      content: {
        button: null,
        pixButton: { label: 'Copiar código Pix', index: 0 },
        quickReplies: ['Preciso de ajuda'],
      },
    });
    const body = {
      nome_devedor: { kind: 'SOURCE', source: 'DEBTOR_NAME' },
      valor: { kind: 'SOURCE', source: 'AMOUNT' },
      data_vencimento: { kind: 'SOURCE', source: 'DUE_DATE' },
    };
    const save = (mapping: Record<string, unknown>) =>
      request(http)
        .put(`/admin/whatsapp-templates/${pix.id}/mapping`)
        .set(auth(tokens.admin))
        .send({
          expectedProviderRevision: pix.providerRevision,
          expectedMappingRevision: pix.mappingRevision,
          mapping,
        });
    // The button is bound to the invoice's own code, never left implicit.
    expect((await save({ body })).status).toBe(400);
    await save({
      body,
      pixButton: { index: 0, source: 'PIX_COPY_PASTE' },
    }).expect(200);
    await setGrant(app, tokens.admin, ids.a, pix.id, true);

    const invoice = (efiPixCopiaECola: string | null) =>
      prisma.invoice.create({
        data: {
          companyId: ids.a,
          debtorId: ids.debtorA,
          originalAmount: 150,
          dueDate: new Date('2026-10-05T12:00:00.000Z'),
          status: 'PENDING',
          efiPixCopiaECola,
        },
      });
    const code = '00020101021226860014br.gov.bcb.pix2564cobranca-e2e6304ABCD';
    const withPix = (await invoice(code)).id;
    const boletoOnly = (await invoice(null)).id;
    const prepare = (invoiceId: string) =>
      app.get(TemplateSendPreparerService, { strict: false }).prepare({
        logicalKey: collectionLogicalKey({ companyId: ids.a, invoiceId }),
        origin: 'COLLECTION',
        context: { companyId: ids.a, invoiceId, debtorId: ids.debtorA },
        selection: { mode: 'EXPLICIT', templateId: pix.id },
      });
    await expect(prepare(boletoOnly)).resolves.toMatchObject({
      status: 'BLOCKED',
      code: 'VALUE_MISSING',
    });
    const prepared = await prepare(withPix);
    expect(prepared.status).toBe('QUEUED');
    const before = provider.sends.length;
    await app.get(OutboundDispatcherService).recover();
    await untilState(
      prisma,
      (prepared as { intentId: string }).intentId,
      'ACCEPTED',
    );
    expect(provider.sends.length - before).toBe(1);
    expect(provider.sends.at(-1)).toMatchObject({
      type: 'template',
      template: {
        name: 'emissao_pix',
        components: [
          { type: 'body' },
          {
            type: 'button',
            sub_type: 'payment_request',
            index: '0',
            parameters: [
              {
                type: 'action',
                action: {
                  payment_request: {
                    payment_setting: {
                      type: 'pix_dynamic_code',
                      pix_dynamic_code: { code },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    });
  });
});
