/**
 * Resume of held template sends over real HTTP, JWT, PostgreSQL and the app's own BullMQ
 * worker: paid invoices close without a message, one confirmation yields one successor
 * (also when repeated or concurrent), a changed mapping invalidates the preview, a lost
 * queue job is recovered once, and accepted/uncertain sends are never resumed.
 */
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TemplatePendingService } from '../src/communications/template-pending.service';
import { TemplateSendPreparerService } from '../src/templates/template-send-preparer.service';
import type { TemplateSendRequest } from '../src/templates/template-contracts';
import { collectionLogicalKey } from '../src/templates/template-selection';
import { OutboundDispatcherService } from '../src/whatsapp/outbound-dispatcher.service';
import {
  MAPPING,
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
assertDisposable('template-resume.e2e-spec.ts');

const PHONE_A = '5511976622002';
const { provider, restore } = fakeDatafy();

type Review = {
  id: string;
  items: Array<{
    pendingId: string;
    invoiceId: string | null;
    action: string;
    reason: string | null;
  }>;
};
type Result = { intentIds: string[]; closedPendingIds: string[] };

describe('Template resume (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Server;
  let admin = '';
  let companyA = '';
  let debtorA = '';
  let template = '';

  const grant = (enabled: boolean) =>
    setGrant(app, admin, companyA, template, enabled);

  async function invoice(): Promise<string> {
    return (
      await prisma.invoice.create({
        data: {
          companyId: companyA,
          debtorId: debtorA,
          originalAmount: 150,
          dueDate: new Date(Date.now() + 3 * 86_400_000),
          status: 'PENDING',
        },
      })
    ).id;
  }

  function sendRequest(invoiceId: string): TemplateSendRequest {
    return {
      logicalKey: collectionLogicalKey({ companyId: companyA, invoiceId }),
      origin: 'COLLECTION',
      context: { companyId: companyA, invoiceId, debtorId: debtorA },
      selection: { mode: 'EXPLICIT', templateId: template },
    };
  }

  /** A send prepared while the template is not granted: held, never queued. */
  async function heldFor(invoiceId: string): Promise<string> {
    const prepared = await app
      .get(TemplateSendPreparerService, { strict: false })
      .prepare(sendRequest(invoiceId));
    expect(prepared).toMatchObject({ status: 'BLOCKED', code: 'NOT_GRANTED' });
    return (
      await prisma.whatsappTemplatePendingSend.findUniqueOrThrow({
        where: { logicalKey: sendRequest(invoiceId).logicalKey },
      })
    ).id;
  }

  const preview = (pendingIds: string[]) =>
    request(http)
      .post('/communications/admin/template-pending/reviews')
      .set(auth(admin))
      .send({ items: pendingIds.map((pendingId) => ({ pendingId })) });

  const confirm = (reviewId: string, key: string) =>
    request(http)
      .post(
        `/communications/admin/template-pending/reviews/${reviewId}/confirm`,
      )
      .set(auth(admin))
      .send({ idempotencyId: key });

  beforeAll(async () => {
    app = await createTemplateApp();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as Server;
    const tenants = await seedTenants(app, PHONE_A);
    admin = tenants.tokens.admin;
    companyA = tenants.a;
    debtorA = tenants.debtorA;
    template = await importAndMap(app, admin);
  });

  afterAll(async () => {
    await app?.close();
    restore();
  });

  it('paid_invoice_closes_without_send and same_confirmation_returns_same_successor', async () => {
    const eligible = await invoice();
    const paid = await invoice();
    const holds = [await heldFor(eligible), await heldFor(paid)];
    await grant(true);
    await prisma.invoice.update({
      where: { id: paid },
      data: { status: 'PAID' },
    });
    const review = (await preview(holds)).body as Review;
    expect(
      Object.fromEntries(
        review.items.map((item) => [
          item.invoiceId,
          [item.action, item.reason],
        ]),
      ),
    ).toEqual({
      [eligible]: ['RESUME', null],
      [paid]: ['CLOSE', 'INVOICE_NOT_PENDING'],
    });

    const key = randomUUID();
    const concurrentResults = (
      await Promise.all([1, 2, 3].map(() => confirm(review.id, key)))
    )
      .filter((response) => response.status === 201)
      .map((response) => response.body as Result);
    expect(concurrentResults.length).toBeGreaterThanOrEqual(1);
    expect(new Set(concurrentResults.flatMap((r) => r.intentIds)).size).toBe(1);
    const firstResult = concurrentResults[0]!;
    const repeatedResult = (await confirm(review.id, key)).body as Result;
    expect(firstResult).toEqual(repeatedResult);
    expect(firstResult.closedPendingIds).toEqual([holds[1]]);

    const before = provider.sends.length;
    await app.get(OutboundDispatcherService).recover();
    await untilState(prisma, firstResult.intentIds[0]!, 'ACCEPTED');
    await app.get(OutboundDispatcherService).recover();
    await sleep(800);
    expect(provider.sends.length - before).toBe(1);
    expect(
      await prisma.communicationOutboundIntent.count({
        where: { invoiceId: paid },
      }),
    ).toBe(0);
  });

  it('changed_mapping_requires_new_preview', async () => {
    await grant(false);
    const hold = await heldFor(await invoice());
    await grant(true);
    const stale = (await preview([hold])).body as Review;
    const current = await prisma.globalMessageTemplate.findUniqueOrThrow({
      where: { id: template },
    });
    await request(http)
      .put(`/admin/whatsapp-templates/${template}/mapping`)
      .set(auth(admin))
      .send({
        expectedProviderRevision: current.providerRevision,
        expectedMappingRevision: current.mappingRevision,
        mapping: {
          ...MAPPING,
          body: {
            ...MAPPING.body,
            '1': { kind: 'SOURCE', source: 'COMPANY_NAME' },
          },
        },
      })
      .expect(200);
    const confirmStaleReview = async () => {
      const response = await confirm(stale.id, randomUUID());
      return {
        status: response.status,
        code: (response.body as { code?: string }).code,
      };
    };
    expect(await confirmStaleReview()).toMatchObject({ status: 409 });
    expect(
      await prisma.whatsappTemplatePendingSend.findUniqueOrThrow({
        where: { id: hold },
      }),
    ).toMatchObject({ state: 'BLOCKED', currentIntentId: null });

    const fresh = (await preview([hold])).body as Review;
    const result = (await confirm(fresh.id, randomUUID())).body as Result;
    expect(result.intentIds).toHaveLength(1);
    await app.get(OutboundDispatcherService).recover();
    await untilState(prisma, result.intentIds[0]!, 'ACCEPTED');
  });

  it('redis_loss_after_commit_recovers_once', async () => {
    await grant(false);
    const hold = await heldFor(await invoice());
    await grant(true);
    const review = (await preview([hold])).body as Review;
    const result = (await confirm(review.id, randomUUID())).body as Result;
    const [successor] = result.intentIds;
    const before = provider.sends.length;
    // Only the queue this test's app owns loses its waiting jobs.
    const queue = app.get<Queue>(getQueueToken('whatsapp-messages'), {
      strict: false,
    });
    await app.get(OutboundDispatcherService).recover();
    await queue.drain(true);
    await app.get(OutboundDispatcherService).recover();
    await untilState(prisma, successor!, 'ACCEPTED');
    await app.get(OutboundDispatcherService).recover();
    await sleep(800);
    const datafySendCallsAfterRecovery = provider.sends.length - before;
    expect(datafySendCallsAfterRecovery).toBe(1);
  });

  it('uncertain_cannot_resume', async () => {
    const invoiceId = await invoice();
    const request_ = sendRequest(invoiceId);
    const prepared = await app
      .get(TemplateSendPreparerService, { strict: false })
      .prepare(request_);
    expect(prepared.status).toBe('QUEUED');
    const intent = await prisma.communicationOutboundIntent.findFirstOrThrow({
      where: { logicalKey: request_.logicalKey },
    });
    // The provider may have accepted it: never resent.
    await prisma.communicationOutboundIntent.update({
      where: { id: intent.id },
      data: { state: 'UNCERTAIN', transmission: 'UNCERTAIN' },
    });
    await prisma.$transaction((tx) =>
      app.get(TemplatePendingService, { strict: false }).block(tx, {
        request: request_,
        code: 'NOT_GRANTED',
        intentId: intent.id,
      }),
    );
    const hold = await prisma.whatsappTemplatePendingSend.findUniqueOrThrow({
      where: { logicalKey: request_.logicalKey },
    });
    const review = (await preview([hold.id])).body as Review;
    expect(review.items[0]).toMatchObject({
      action: 'KEEP_BLOCKED',
      reason: 'TRANSMISSION_UNKNOWN',
    });
    const before = provider.sends.length;
    const result = (await confirm(review.id, randomUUID())).body as Result;
    expect(result.intentIds).toEqual([]);
    await app.get(OutboundDispatcherService).recover();
    await sleep(800);
    const acceptedOrUncertainSuccessors = () =>
      prisma.communicationOutboundIntent.findMany({
        where: { logicalKey: request_.logicalKey, generation: { gt: 0 } },
      });
    expect(await acceptedOrUncertainSuccessors()).toHaveLength(0);
    expect(provider.sends.length).toBe(before);
    expect(
      (
        await prisma.communicationOutboundIntent.findUniqueOrThrow({
          where: { id: intent.id },
        })
      ).state,
    ).toBe('UNCERTAIN');
  });
});
