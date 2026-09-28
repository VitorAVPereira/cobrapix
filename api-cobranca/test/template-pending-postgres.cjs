'use strict';
// Only a fresh local Docker database; never use DATABASE_URL or DIRECT_URL.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { startDisposablePostgres, migrate } = require('./support/disposable-postgres.cjs');
const fx = require('./support/template-fixtures.cjs');
const { TemplatePendingService } = require('../src/communications/template-pending.service.ts');

const sections = [];
const section = (name, run) => sections.push({ name, run });

function pendingRequest(fixture, templateId, overrides = {}) {
  return {
    logicalKey: `collection:${fixture.company.id}:${fixture.invoice.id}:${randomUUID()}:WHATSAPP`,
    origin: 'COLLECTION',
    context: { companyId: fixture.company.id, invoiceId: fixture.invoice.id, debtorId: fixture.debtor.id },
    selection: templateId ? { mode: 'EXPLICIT', templateId } : { mode: 'DEFAULT', purpose: 'BEFORE_DUE' },
    ...overrides,
  };
}

section('holds before any intent, deduplicate and roll back with the caller', async ({ prisma, pending, fixture }) => {
  const request = pendingRequest(fixture, null);
  const concurrentBlocks = await Promise.all([1, 2, 3, 4].map(() => prisma.$transaction(tx => pending.block(tx, { request, code: 'DEFAULT_MISSING' }))));
  assert.equal(new Set(concurrentBlocks.map(row => row.id)).size, 1);
  const row = await prisma.whatsappTemplatePendingSend.findUnique({ where: { logicalKey: request.logicalKey } });
  assert.equal(row.state, 'BLOCKED');
  assert.equal(row.version, 1, 'repeated evaluation with the same diagnosis keeps the version');
  assert.equal(row.occurrences, 4);
  assert.equal(row.currentIntentId, null);
  assert.equal(JSON.stringify(row.request).includes(fixture.phone), false, 'request stores identifiers only');
  assert.equal(await prisma.whatsappTemplateAudit.count({ where: { action: 'PENDING_BLOCKED', details: { path: ['pendingId'], equals: row.id } } }), 1);
  // A new diagnosis moves the version once.
  await prisma.$transaction(tx => pending.block(tx, { request, code: 'NOT_GRANTED' }));
  assert.equal((await prisma.whatsappTemplatePendingSend.findUnique({ where: { id: row.id } })).version, 2);

  const rolledBack = pendingRequest(fixture, null);
  await assert.rejects(prisma.$transaction(async tx => {
    await pending.block(tx, { request: rolledBack, code: 'DEFAULT_MISSING' });
    throw new Error('CALLER_FAILED');
  }), /CALLER_FAILED/);
  const countPendingAfterRollback = () => prisma.whatsappTemplatePendingSend.count({ where: { logicalKey: rolledBack.logicalKey } });
  const countAuditsAfterRollback = () => prisma.whatsappTemplateAudit.count({ where: { companyId: fixture.company.id, action: 'PENDING_BLOCKED', createdAt: { gte: new Date(Date.now() - 60_000) }, details: { path: ['code'], equals: 'DEFAULT_MISSING' } } });
  assert.equal(await countPendingAfterRollback(), 0);
  assert.equal(await countAuditsAfterRollback(), 1, 'only the committed hold was audited');

  assert.deepEqual(await prisma.$transaction(tx => pending.findByLogicalKey(tx, request.logicalKey)), { id: row.id, version: 2, state: 'BLOCKED', currentIntentId: null });
});

section('only never-transmitted intents become BLOCKED; recovery ignores them', async ({ prisma, pending, fixture, template, intents }) => {
  const blocked = await fx.templateIntent(prisma, { fixture, template });
  await prisma.$transaction(tx => pending.block(tx, { request: blocked.request, code: 'NOT_GRANTED', intentId: blocked.id, snapshot: blocked.snapshot }));
  const blockedIntent = await prisma.communicationOutboundIntent.findUnique({ where: { id: blocked.id }, include: { message: true } });
  assert.equal(blockedIntent.state, 'BLOCKED');
  assert.equal(blockedIntent.message.status, 'blocked');
  assert.equal((await intents.recover()).some(row => row.id === blocked.id), false);

  for (const state of ['ACCEPTED', 'UNCERTAIN', 'SENDING']) {
    const kept = await fx.templateIntent(prisma, { fixture, template, state });
    const before = await prisma.communicationOutboundIntent.findUnique({ where: { id: kept.id } });
    const ref = await prisma.$transaction(tx => pending.block(tx, { request: kept.request, code: 'VERSION_CHANGED', intentId: kept.id }));
    assert.deepEqual(await prisma.communicationOutboundIntent.findUnique({ where: { id: kept.id } }), before, `${state} intent is never rewritten`);
    assert.equal(ref.currentIntentId, null);
  }
});

section('one live generation per logical key; failed generations stay as history', async ({ prisma, fixture, template }) => {
  const first = await fx.templateIntent(prisma, { fixture, template });
  await assert.rejects(fx.templateIntent(prisma, { fixture, template, logicalKey: first.request.logicalKey, generation: 1 }), error => error.code === 'P2002');
  await prisma.communicationOutboundIntent.update({ where: { id: first.id }, data: { state: 'FAILED' } });
  const successor = await fx.templateIntent(prisma, { fixture, template, logicalKey: first.request.logicalKey, generation: 1 });
  assert.ok(successor.id);
  const again = await fx.templateIntent(prisma, { fixture, template, logicalKey: first.request.logicalKey, generation: 1 });
  assert.equal(again.id, successor.id, 'the same reservation is idempotent');
  const unrelated = await fx.templateIntent(prisma, { fixture, template });
  await assert.rejects(prisma.communicationOutboundIntent.update({ where: { id: unrelated.id }, data: { logicalKey: first.request.logicalKey, generation: 1, state: 'FAILED' } }), error => error.code === 'P2002', 'generation numbers never repeat');
});

section('reconciliation holds invalid snapshots in pages without stalling on valid ones', async ({ prisma, pending, fixture, template }) => {
  await prisma.communicationOutboundIntent.updateMany({ where: { state: 'PENDING' }, data: { state: 'FAILED' } });
  const other = await fx.tenant(prisma, 'Reconcile');
  await fx.grant(prisma, other.company.id, template.id);
  const valid = [];
  for (let i = 0; i < 3; i++) valid.push(await fx.templateIntent(prisma, { fixture: other, template }));
  const invalid = await fx.templateIntent(prisma, { fixture, template });
  await fx.grant(prisma, fixture.company.id, template.id, false);
  let blocked = 0;
  for (let call = 0; call < 6; call++) blocked += await pending.reconcileInvalidSnapshots(1);
  assert.equal(blocked, 1);
  assert.equal((await prisma.communicationOutboundIntent.findUnique({ where: { id: invalid.id } })).state, 'BLOCKED');
  const hold = await prisma.whatsappTemplatePendingSend.findUnique({ where: { logicalKey: invalid.request.logicalKey } });
  assert.equal(hold.code, 'NOT_GRANTED');
  assert.equal(hold.currentIntentId, invalid.id);
  for (const row of valid) assert.equal((await prisma.communicationOutboundIntent.findUnique({ where: { id: row.id } })).state, 'PENDING');
  // Re-granting later does not release the hold silently.
  await fx.grant(prisma, fixture.company.id, template.id, true);
  await pending.reconcileInvalidSnapshots(100);
  assert.equal((await prisma.communicationOutboundIntent.findUnique({ where: { id: invalid.id } })).state, 'BLOCKED');
});

const { WhatsappTransportError } = require('../src/whatsapp/transport/whatsapp-transport.error.ts');

/** Waits until some backend is blocked on a row lock: a barrier, not an arbitrary sleep. */
async function waitForLockWaiter(pool) {
  for (let i = 0; i < 200; i++) {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock'");
    if (rows[0].n > 0) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('dispatch never waited on the revocation lock');
}

section('final authorization: revocation committed before the claim blocks the send', async ({ prisma, pool }) => {
  const fixture = await fx.tenant(prisma, 'Revoke');
  const template = await fx.readyTemplate(prisma);
  await fx.grant(prisma, fixture.company.id, template.id);
  const prepared = await fx.templateIntent(prisma, { fixture, template });
  const { service, transport } = fx.dispatcher(prisma);
  const revoker = await pool.connect();
  try {
    await revoker.query('BEGIN');
    await revoker.query('UPDATE "CompanyWhatsappTemplateGrant" SET "enabled" = false, "version" = "version" + 1 WHERE "companyId" = $1 AND "templateId" = $2', [fixture.company.id, template.id]);
    const dispatching = service.dispatch(prepared.id).then(() => 'sent', error => error);
    await waitForLockWaiter(pool);
    await revoker.query('COMMIT');
    const outcome = await dispatching;
    assert.equal(outcome.code, 'NOT_GRANTED');
  } finally {
    revoker.release();
  }
  assert.equal(transport.calls.length, 0, 'no Datafy call after a committed revocation');
  assert.equal(await intentState(prisma, prepared.id), 'BLOCKED');
  const hold = await prisma.whatsappTemplatePendingSend.findUnique({ where: { logicalKey: prepared.request.logicalKey } });
  assert.equal(hold.code, 'NOT_GRANTED');
  // A job retried later finds the hold: still no transmission.
  await assert.rejects(service.dispatch(prepared.id), error => error.getResponse?.().code === 'OUTBOUND_BLOCKED');
  assert.equal(transport.calls.length, 0);
});

section('final authorization: re-grant never releases an old snapshot', async ({ prisma }) => {
  const fixture = await fx.tenant(prisma, 'Regrant');
  const template = await fx.readyTemplate(prisma);
  await fx.grant(prisma, fixture.company.id, template.id);
  const oldIntent = await fx.templateIntent(prisma, { fixture, template });
  await fx.grant(prisma, fixture.company.id, template.id, false);
  await fx.grant(prisma, fixture.company.id, template.id, true);
  const { service, transport } = fx.dispatcher(prisma);
  await assert.rejects(service.dispatch(oldIntent.id), error => error.code === 'VERSION_CHANGED');
  assert.equal(transport.calls.length, 0);
  assert.equal(await intentState(prisma, oldIntent.id), 'BLOCKED');
  // A fresh preparation under the new grant version is allowed and sent once.
  const fresh = await fx.templateIntent(prisma, { fixture, template });
  await service.dispatch(fresh.id);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].components.at(-1).sub_type, 'url', 'payment button built at transmission');
  assert.equal(await intentState(prisma, fresh.id), 'ACCEPTED');
});

section('final authorization: amount or phone changed since preparation holds the send', async ({ prisma }) => {
  const fixture = await fx.tenant(prisma, 'Context');
  const template = await fx.readyTemplate(prisma);
  await fx.grant(prisma, fixture.company.id, template.id);
  const { service, transport } = fx.dispatcher(prisma);
  const amount = await fx.templateIntent(prisma, { fixture, template });
  await prisma.invoice.update({ where: { id: fixture.invoice.id }, data: { originalAmount: 151 } });
  await assert.rejects(service.dispatch(amount.id), error => error.code === 'CONTEXT_CHANGED');
  await prisma.invoice.update({ where: { id: fixture.invoice.id }, data: { originalAmount: 150 } });
  const phone = await fx.templateIntent(prisma, { fixture, template });
  await prisma.debtor.update({ where: { id: fixture.debtor.id }, data: { phoneNumber: '5511912345678' } });
  await assert.rejects(service.dispatch(phone.id), error => error.code === 'CONTEXT_CHANGED');
  assert.equal(transport.calls.length, 0);
  assert.equal((await prisma.whatsappTemplatePendingSend.findUnique({ where: { logicalKey: phone.request.logicalKey } })).code, 'CONTEXT_CHANGED');
});

section('final authorization: uncertain or late-accepted results are never retried', async ({ prisma }) => {
  const fixture = await fx.tenant(prisma, 'Uncertain');
  const template = await fx.readyTemplate(prisma);
  await fx.grant(prisma, fixture.company.id, template.id);
  const prepared = await fx.templateIntent(prisma, { fixture, template });
  const { service, transport } = fx.dispatcher(prisma, () => { throw new WhatsappTransportError('timeout', 'UNCERTAIN', 'UNCERTAIN'); });
  await assert.rejects(service.dispatch(prepared.id), error => error.kind === 'UNCERTAIN');
  const row = await prisma.communicationOutboundIntent.findUnique({ where: { id: prepared.id } });
  assert.equal(row.state, 'UNCERTAIN');
  assert.equal(row.transmission, 'UNCERTAIN');
  await assert.rejects(service.dispatch(prepared.id));
  assert.equal(transport.calls.length, 1, 'one call, never a second one');
  assert.equal(await prisma.whatsappTemplatePendingSend.count({ where: { logicalKey: prepared.request.logicalKey } }), 0, 'uncertain results never become a resumable hold');
  // A hold attempt on it later leaves it untouched.
  await prisma.$transaction(tx => fx.services(prisma).pending.block(tx, { request: prepared.request, code: 'VERSION_CHANGED', intentId: prepared.id }));
  assert.equal(await intentState(prisma, prepared.id), 'UNCERTAIN');
});

section('final authorization: legacy template payloads are held, never sent', async ({ prisma }) => {
  const fixture = await fx.tenant(prisma, 'Legacy');
  const conversation = await fx.conversationFor(prisma, fixture.phone);
  const { service, transport, intents } = fx.dispatcher(prisma);
  const legacy = await intents.reserve({
    idempotencyKey: `collection:${fixture.company.id}:${fixture.invoice.id}:initial:WHATSAPP`, conversationId: conversation.id, transport: 'DATAFY', transportChannelId: '222',
    recipient: { type: 'PHONE', value: fixture.phone }, context: { companyId: fixture.company.id, invoiceId: fixture.invoice.id, debtorId: fixture.debtor.id },
    content: 'Template: cobrapix_vencimento_hoje', messageType: 'template',
    payload: { companyId: fixture.company.id, invoiceId: fixture.invoice.id, debtorId: fixture.debtor.id, phoneNumber: fixture.phone, messageType: 'template', templateName: 'cobrapix_vencimento_hoje', languageCode: 'pt_BR', bodyParameters: ['x'] },
    retentionExpiresAt: new Date(Date.now() + 86_400_000),
  });
  await assert.rejects(service.dispatch(legacy.id), error => error.code === 'LEGACY_PAYLOAD');
  assert.equal(transport.calls.length, 0);
  assert.equal(await intentState(prisma, legacy.id), 'BLOCKED');
  const hold = await prisma.whatsappTemplatePendingSend.findUnique({ where: { logicalKey: `collection:${fixture.company.id}:${fixture.invoice.id}:initial:WHATSAPP` } });
  assert.equal(hold.code, 'LEGACY_PAYLOAD');
  assert.deepEqual(hold.request.selection, { mode: 'UNCONFIGURED' });
});

function intentState(prisma, id) {
  return prisma.communicationOutboundIntent.findUnique({ where: { id }, select: { state: true } }).then(row => row.state);
}

module.exports = { section, pendingRequest };

if (require.main === module) {
  (async () => {
    const db = await startDisposablePostgres('pending-test');
    let prisma;
    try {
      const { applied } = await migrate(db.pool);
      prisma = new PrismaClient({ adapter: new PrismaPg(db.pool) });
      const { policy, intents } = fx.services(prisma);
      const pending = new TemplatePendingService(prisma, policy);
      const fixture = await fx.tenant(prisma, 'A');
      const template = await fx.readyTemplate(prisma);
      await fx.grant(prisma, fixture.company.id, template.id);
      for (const { name, run } of sections) {
        await run({ prisma, pool: db.pool, pending, policy, intents, fixture, template });
        console.log(`PASS ${name}`);
      }
      console.log(`PASS template holds on PostgreSQL 16 with ${applied.length} migrations`);
    } finally {
      if (prisma) await prisma.$disconnect();
      await db.pool.end();
      db.stop();
    }
  })().catch(error => { console.error(error.code ? `${error.code}: ${error.message}` : error.stack); process.exitCode = 1; });
}
