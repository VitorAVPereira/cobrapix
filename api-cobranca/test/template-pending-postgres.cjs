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
