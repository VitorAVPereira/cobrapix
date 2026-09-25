'use strict';
// Only a fresh, locally owned Docker PostgreSQL. Never consume DATABASE_URL/DIRECT_URL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { ConfigService } = require('@nestjs/config');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { PaymentCryptoService } = require('../src/payment/payment-crypto.service.ts');
const runId = randomBytes(8).toString('hex');
const name = `ciframais-communications-test-${runId}`;
const password = randomBytes(24).toString('hex');
const dockerHost = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
const migrationSuffix = '_datafy_communication_context';
const crypto = new PaymentCryptoService(new ConfigService({ PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ test: randomBytes(32).toString('hex') }), PAYMENT_ACTIVE_KEY_VERSION: 'test' }));
function docker(args) {
  const result = spawnSync('docker', ['--host', dockerHost, ...args], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed; check local Docker Desktop access.`);
  return result.stdout.trim();
}
let pool;
let prisma;
let started = false;
const companyA = randomUUID(), companyB = randomUUID(), adminId = randomUUID(), userId = randomUUID();
const debtorA = randomUUID(), debtorB = randomUUID(), invoiceA = randomUUID(), invoiceB = randomUUID();
const conversationId = randomUUID(), oldA = randomUUID(), oldB = randomUUID(), oldUnknown = randomUUID();
const phone = '5511999999999';
const expiry = new Date('2030-01-01T00:00:00.000Z');
async function seedLegacy() {
  for (const [id, email, document] of [[companyA, 'a@example.test', '12345678000190'], [companyB, 'b@example.test', '98765432000190']]) {
    await pool.query('INSERT INTO "Company" ("id","corporateName","email","phoneNumber","document","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())', [id, 'Fixture', email, phone, document]);
  }
  for (const [id, role] of [[adminId, 'PLATFORM_ADMIN'], [userId, 'COMPANY_ADMIN']]) {
    await pool.query('INSERT INTO "User" ("id","email","password","companyId","role","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())', [id, `${id}@example.test`, 'unused-fixture-hash', companyA, role]);
  }
  for (const [company, debtor, invoice] of [[companyA, debtorA, invoiceA], [companyB, debtorB, invoiceB]]) {
    await pool.query('INSERT INTO "Debtor" ("id","companyId","name","phoneNumber","updatedAt") VALUES ($1,$2,$3,$4,NOW())', [debtor, company, 'Fixture', `+${phone}`]);
    await pool.query('INSERT INTO "Invoice" ("id","companyId","debtorId","originalAmount","dueDate","updatedAt") VALUES ($1,$2,$3,100,NOW(),NOW())', [invoice, company, debtor]);
  }
  // Timestamp columns are UTC without time zone; avoid pg serializing Date in the host timezone.
  await pool.query('INSERT INTO "CommunicationConversation" ("id","channel","recipientHash","recipientEncrypted","retentionExpiresAt","updatedAt") VALUES ($1,\'WHATSAPP\',$2,$3,$4,NOW())', [conversationId, createHash('sha256').update(phone).digest('hex'), crypto.encrypt(phone), expiry.toISOString()]);
  for (const [id, company, invoice, debtor] of [[oldA, companyA, invoiceA, debtorA], [oldB, companyB, invoiceB, debtorB], [oldUnknown, null, null, null]]) {
    await pool.query('INSERT INTO "CommunicationMessage" ("id","conversationId","companyId","invoiceId","debtorId","direction","content","externalMessageId","retentionExpiresAt","createdAt") VALUES ($1,$2,$3,$4,$5,\'INBOUND\',$6,$7,$8,$9)', [id, conversationId, company, invoice, debtor, 'Legacy fixture', `wamid.${id}`, expiry.toISOString(), '2026-09-20T00:00:00.000Z']);
  }
}
const oldSnapshotSql = 'SELECT "id","companyId","invoiceId","debtorId","content","externalMessageId","retentionExpiresAt","createdAt" FROM "CommunicationMessage" ORDER BY "id"';
(async () => {
  try {
    docker(['run', '-d', '--name', name, '--label', `ciframais.communications-test=${runId}`, '--memory', '384m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=communications_test', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
    started = true;
    const binding = docker(['port', name, '5432/tcp']);
    assert.match(binding, /^127\.0\.0\.1:\d+$/);
    pool = new Pool({ host: '127.0.0.1', port: Number(binding.split(':').at(-1)), database: 'communications_test', user: 'postgres', password, connectionTimeoutMillis: 1000, max: 12 });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try { await pool.query('SELECT 1'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.ok(ready, 'disposable local database starts');
    const migrations = fs.readdirSync(path.join(root, 'prisma/migrations')).filter(file => fs.existsSync(path.join(root, 'prisma/migrations', file, 'migration.sql'))).sort();
    const target = migrations.find(file => file.endsWith(migrationSuffix));
    const previous = target ? migrations.filter(file => file < target) : migrations;
    for (const file of previous) await pool.query(fs.readFileSync(path.join(root, 'prisma/migrations', file, 'migration.sql'), 'utf8'));
    await seedLegacy();
    const before = (await pool.query(oldSnapshotSql)).rows;
    if (target) await pool.query(fs.readFileSync(path.join(root, 'prisma/migrations', target, 'migration.sql'), 'utf8'));
    for (const file of migrations.filter(file => target && file > target)) await pool.query(fs.readFileSync(path.join(root, 'prisma/migrations', file, 'migration.sql'), 'utf8'));
    const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map(row => row.tablename);
    for (const table of ['CommunicationWebhookDelivery', 'CommunicationOutboundIntent', 'CommunicationAttributionAudit', 'CommunicationAttachment']) assert.ok(tables.includes(table), `${table} must exist after stage 2`);
    assert.deepEqual((await pool.query(oldSnapshotSql)).rows, before, 'migration preserves content, tenant bindings and retention');
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const legacy = await prisma.communicationMessage.findMany({ orderBy: { id: 'asc' } });
    assert.ok(legacy.every(message => message.source === 'LEGACY' && message.attributionMethod === null && message.transportChannelId === null));
    assert.equal((await prisma.communicationMessage.findUnique({ where: { id: oldUnknown } })).companyId, null);
    console.log('PASS migration over existing shared conversation preserves all legacy data');

    const { OutboundIntentService } = require('../src/communications/outbound-intent.service.ts');
    const { CommunicationAttributionService } = require('../src/communications/communication-attribution.service.ts');
    const { messageRecipient } = require('../src/communications/message-context.ts');
    const attribution = new CommunicationAttributionService(prisma);
    const intents = new OutboundIntentService(prisma, crypto, attribution);
    const contextA = { companyId: companyA, invoiceId: invoiceA, debtorId: debtorA };
    const contextB = { companyId: companyB, invoiceId: invoiceB, debtorId: debtorB };
    const input = { idempotencyKey: `charge:${invoiceA}`, conversationId, transport: 'DATAFY', transportChannelId: '123456', recipient: { type: 'PHONE', value: phone }, context: contextA, content: 'Sua cobranca A', messageType: 'template', payload: { template: 'notice', parameters: ['100,00'] }, retentionExpiresAt: expiry };
    const race = await Promise.all(Array.from({ length: 8 }, () => intents.reserve(input)));
    assert.equal(new Set(race.map(item => item.id)).size, 1);
    assert.equal(await prisma.communicationOutboundIntent.count(), 1);
    assert.equal(await prisma.communicationMessage.count(), 4, 'no orphan messages from concurrent reservations');
    const intent = await prisma.communicationOutboundIntent.findUnique({ where: { id: race[0].id } });
    assert.equal(intent.state, 'PENDING');
    assert.ok(!intent.payloadEncrypted.includes('notice'));
    assert.deepEqual(JSON.parse(crypto.decrypt(intent.payloadEncrypted)), input.payload);
    await assert.rejects(intents.reserve({ ...input, content: 'outra cobranca' }), error => error.getStatus() === 409);
    await assert.rejects(intents.reserve({ ...input, context: contextB }), error => error.getStatus() === 409);
    await assert.rejects(intents.reserve({ ...input, transport: 'META_DIRECT' }), error => error.getStatus() === 409);
    await intents.reserve({ ...input, payload: { parameters: ['100,00'], template: 'notice' }, retentionExpiresAt: new Date('2099-01-01') });
    assert.equal((await prisma.communicationMessage.findUnique({ where: { id: intent.messageId } })).retentionExpiresAt.toISOString(), expiry.toISOString());
    assert.equal(await prisma.communicationConversation.count(), 1, 'transport change does not split the recipient conversation');
    console.log('PASS concurrent reservations are idempotent, immutable and encrypted');

    await assert.rejects(intents.reserve({ ...input, idempotencyKey: 'invalid-context', context: { ...contextA, invoiceId: invoiceB } }), error => error.getStatus() === 400);
    await assert.rejects(intents.reserve({ ...input, idempotencyKey: 'invalid-recipient', recipient: { type: 'BSUID', value: `US.${phone}` } }), error => error.getStatus() === 400);
    await assert.rejects(prisma.communicationMessage.create({ data: { conversationId, companyId: companyA, invoiceId: invoiceB, direction: 'INBOUND', content: 'invalid', retentionExpiresAt: expiry } }));
    await assert.rejects(prisma.communicationMessage.create({ data: { conversationId, invoiceId: invoiceA, direction: 'INBOUND', content: 'invalid', retentionExpiresAt: expiry } }));
    console.log('PASS cross-tenant and untyped recipient bindings are rejected');

    const deliveryData = { channel: 'WHATSAPP', transport: 'DATAFY', transportChannelId: '123456', deliveryId: randomUUID(), bodyHash: createHash('sha256').update('fixture').digest('hex'), payloadEncrypted: crypto.encrypt('{"fixture":true}'), retentionExpiresAt: expiry };
    const deliveries = await Promise.allSettled(Array.from({ length: 5 }, () => prisma.communicationWebhookDelivery.create({ data: deliveryData })));
    assert.equal(deliveries.filter(item => item.status === 'fulfilled').length, 1);
    assert.ok(deliveries.filter(item => item.status === 'rejected').every(item => item.reason.code === 'P2002'));
    assert.equal(await prisma.communicationWebhookDelivery.count(), 1);
    await prisma.communicationWebhookDelivery.create({ data: { ...deliveryData, transport: 'META_DIRECT' } });
    await prisma.communicationWebhookDelivery.create({ data: { ...deliveryData, transportChannelId: '654321' } });
    await assert.rejects(prisma.communicationMessage.create({ data: { conversationId, direction: 'INBOUND', content: 'duplicate', externalMessageId: `wamid.${oldA}`, transportChannelId: '123456', retentionExpiresAt: expiry } }), error => error.code === 'P2002');
    console.log('PASS delivery uniqueness is atomic and message IDs survive transport changes');

    const assign = { messageId: oldUnknown, expectedRevision: 0, expectedCompanyId: null, context: contextA, method: 'MANUAL', actor: { type: 'PLATFORM_ADMIN', userId: adminId }, reason: 'Cobranca identificada pelo administrador' };
    await assert.rejects(attribution.assignKnownContext({ ...assign, actor: { type: 'PLATFORM_ADMIN', userId } }), error => error.getStatus() === 403);
    const assignments = await Promise.allSettled([attribution.assignKnownContext(assign), attribution.assignKnownContext(assign)]);
    assert.equal(assignments.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(assignments.filter(item => item.status === 'rejected' && item.reason.getStatus() === 409).length, 1);
    assert.equal(await prisma.communicationAttributionAudit.count({ where: { messageId: oldUnknown } }), 1);
    await attribution.assignKnownContext({ ...assign, expectedRevision: 1, expectedCompanyId: companyA, context: {}, reason: 'Referencia ambigua; voltar para atendimento central' });
    const audit = await prisma.communicationAttributionAudit.findFirst({ where: { messageId: oldUnknown, revision: 2 } });
    assert.equal(audit.newContext.companyId, null);
    assert.equal(audit.oldContext.companyId, companyA);
    assert.equal(audit.actorUserId, adminId);
    assert.equal((await prisma.communicationMessage.findUnique({ where: { id: oldUnknown } })).retentionExpiresAt.toISOString(), expiry.toISOString());
    console.log('PASS attribution revision and audit are atomic, including null tenant context');

    const attachment = await prisma.communicationAttachment.create({ data: { messageId: oldA, externalMediaId: '123', contentType: 'application/pdf', retentionExpiresAt: expiry } });
    assert.equal(attachment.state, 'PENDING');
    await assert.rejects(prisma.communicationAttachment.create({ data: { messageId: randomUUID(), externalMediaId: '999', retentionExpiresAt: expiry } }));
    await assert.rejects(prisma.communicationAttachment.update({ where: { id: attachment.id }, data: { sizeBytes: -1 } }));
    const readPage = (cursor) => prisma.communicationMessage.findMany({ where: { companyId: companyA, conversationId, ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1 });
    const page1 = await readPage();
    const page2 = await readPage(page1[0]);
    assert.equal(page1.length, 1); assert.equal(page2.length, 1);
    assert.notEqual(page1[0].id, page2[0].id);
    assert.ok([...page1, ...page2].every(message => message.companyId === companyA));
    assert.equal((await readPage(page2[0])).length, 0);
    assert.notEqual(messageRecipient({ type: 'BSUID', value: `US.${phone}` }).hash, messageRecipient({ type: 'PHONE', value: phone }).hash);
    console.log('PASS attachment constraints and tenant-scoped pagination');

    // Failing audit insertion must roll back the already attempted context update.
    await pool.query(`ALTER TABLE "CommunicationAttributionAudit" ADD CONSTRAINT "test_audit_failure" CHECK ("reason" <> 'simulate-error')`);
    try {
      await assert.rejects(attribution.assignKnownContext({ ...assign, expectedRevision: 2, reason: 'simulate-error' }));
      const unchanged = await prisma.communicationMessage.findUnique({ where: { id: oldUnknown } });
      assert.equal(unchanged.companyId, null);
      assert.equal(unchanged.attributionRevision, 2);
      assert.equal(await prisma.communicationAttributionAudit.count({ where: { messageId: oldUnknown } }), 2);
    } finally {
      await pool.query('ALTER TABLE "CommunicationAttributionAudit" DROP CONSTRAINT "test_audit_failure"');
    }
    await assert.rejects(attribution.assignKnownContext({ ...assign, messageId: intent.messageId, expectedCompanyId: companyA, context: contextB }), error => error.getStatus() === 409);
    await assert.rejects(attribution.assignKnownContext({ ...assign, expectedRevision: 2, actor: { type: 'SYSTEM' } }), error => error.getStatus() === 403);
    const otherDebtor = await prisma.debtor.create({ data: { companyId: companyA, name: 'Another debtor', phoneNumber: '+5511888888888' } });
    await assert.rejects(intents.reserve({ ...input, idempotencyKey: 'wrong-debtor', context: { companyId: companyA, debtorId: otherDebtor.id } }), error => error.getStatus() === 400);
    await assert.rejects(intents.reserve({ ...input, idempotencyKey: 'wrong-invoice-debtor', context: { ...contextA, debtorId: otherDebtor.id } }), error => error.getStatus() === 400);
    await assert.rejects(intents.reserve({ ...input, retentionExpiresAt: new Date('2000-01-01') }), error => error.getStatus() === 400);
    await prisma.communicationOutboundIntent.update({ where: { id: intent.id }, data: { state: 'UNCERTAIN' } });
    assert.equal((await intents.reserve(input)).state, 'UNCERTAIN', 'reservation never resets uncertain sends to pending');
    await prisma.communicationConversation.update({ where: { id: conversationId }, data: { recipientAnonymizedAt: new Date() } });
    await assert.rejects(intents.reserve({ ...input, idempotencyKey: 'anonymized-contact' }), error => error.getStatus() === 409);
    await assert.rejects(attribution.assignKnownContext({ ...assign, expectedRevision: 2 }), error => error.getStatus() === 409);
    await prisma.communicationConversation.update({ where: { id: conversationId }, data: { recipientAnonymizedAt: null } });
    const bounded = await intents.reserve({ ...input, idempotencyKey: 'bounded-retention', retentionExpiresAt: new Date('2099-01-01') });
    assert.equal(bounded.retentionExpiresAt.toISOString(), expiry.toISOString(), 'new message cannot prolong existing conversation retention');
    console.log('PASS rollback, recipient validation, anonymization and retention boundaries');

    const bsuid = messageRecipient({ type: 'BSUID', value: `US.${phone}` });
    const opaqueConversation = await prisma.communicationConversation.create({ data: { channel: 'WHATSAPP', recipientType: 'BSUID', recipientHash: bsuid.hash, recipientEncrypted: crypto.encrypt(bsuid.value), retentionExpiresAt: expiry } });
    const opaqueInput = { ...input, conversationId: opaqueConversation.id, recipient: { type: 'BSUID', value: bsuid.value }, context: {}, idempotencyKey: 'opaque-recipient' };
    const opaqueIntent = await intents.reserve(opaqueInput);
    assert.equal((await prisma.communicationMessage.findUnique({ where: { id: opaqueIntent.messageId } })).companyId, null);
    await assert.rejects(intents.reserve({ ...opaqueInput, idempotencyKey: 'opaque-no-inference', context: contextA }), error => error.getStatus() === 400);
    assert.equal((await prisma.communicationConversation.findUnique({ where: { id: conversationId } })).retentionExpiresAt.toISOString(), expiry.toISOString());
    console.log('PASS opaque recipients remain distinct and unassigned without reconciled identity');
    await require('./datafy-webhook-postgres.cjs')({ prisma, pool, crypto, companyA, companyB, adminId, userId });
    await require('./outbound-dispatch-postgres.cjs')({ prisma, crypto, companyA, companyB });
    await require('./tenant-conversations-postgres.cjs')({ prisma, crypto, companyA, companyB, adminId, userId });
    await require('./communication-media-postgres.cjs')({ prisma, crypto, companyA, companyB, adminId });
    console.log(`PASS communications persistence over ${migrations.length} migrations on PostgreSQL 16`);
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    if (started) {
      const owner = docker(['inspect', '--format', '{{ index .Config.Labels "ciframais.communications-test" }}', name]);
      assert.equal(owner, runId, 'cleanup only the container created by this invocation');
      docker(['rm', '-f', '-v', name]);
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
