'use strict';
// Transition rehearsal on a fresh local Docker database; never uses DATABASE_URL or DIRECT_URL.
// Prior schema → preflight (read-only) → migrations → apply → verify → repeat, and the same
// apply on a copy taken before it (restore) gives the same result.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { startDisposablePostgres, migrations, migrationSql } = require('./support/disposable-postgres.cjs');
const fx = require('./support/template-fixtures.cjs');
const { TemplateTransitionService, BASE_MIGRATION } = require('../src/templates/template-transition.service.ts');

const RECORD = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`;

/** Applies migrations as `prisma migrate deploy` would, recording each one. */
async function deploy(pool, { through, after } = {}) {
  await pool.query(RECORD);
  const all = migrations();
  const start = after ? all.indexOf(after) + 1 : 0;
  const end = through ? all.indexOf(through) + 1 : all.length;
  for (const file of all.slice(start, end)) {
    await pool.query(migrationSql(file));
    await pool.query('INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","applied_steps_count") VALUES ($1,$2,now(),$3,1)', [randomUUID(), 'x'.repeat(64), file]);
  }
}

/** Digest of every table: proves a read-only step wrote nothing. */
async function digest(pool) {
  const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map(row => row.table_name);
  const out = {};
  for (const table of tables)
    out[table] = (await pool.query(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM "${table}" t`)).rows[0].digest;
  return out;
}

async function financialRows(pool) {
  const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND (table_name ~ '^(Invoice|Payment|Settlement|PlatformFee)' ) ORDER BY table_name`)).rows.map(row => row.table_name);
  const out = {};
  for (const table of tables) out[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY t::text`)).rows;
  return out;
}

async function seedPriorSchema(pool) {
  const ids = {
    companyId: randomUUID(), ptId: randomUUID(), enId: randomUUID(), orphanId: randomUUID(), emailId: randomUUID(),
    profileId: randomUUID(), emailStepId: randomUUID(), whatsappStepId: randomUUID(), orphanStepId: randomUUID(),
    debtorId: randomUUID(), invoiceId: randomUUID(), attemptId: randomUUID(),
  };
  await pool.query('INSERT INTO "Company" ("id","corporateName","email","phoneNumber","document","updatedAt") VALUES ($1,\'Tenant\',\'tenant@example.test\',\'5511999999999\',\'12345678000190\',NOW())', [ids.companyId]);
  // Internal catalog in two languages, plus one without an email counterpart.
  await pool.query('INSERT INTO "GlobalMessageTemplate" ("id","name","slug","content","metaLanguage","metaStatus","metaTemplateName","updatedAt") VALUES ($1,\'Vencimento\',\'pre-vencimento\',\'Texto\',\'pt_BR\',\'APPROVED\',\'cobrapix_pre_vencimento\',NOW()),($2,\'Due\',\'pre-vencimento-en\',\'Text\',\'en_US\',\'APPROVED\',\'cobrapix_pre_vencimento_en\',NOW()),($3,\'Orphan\',\'tenant-only\',\'Orphan\',\'pt_BR\',\'LOCAL\',NULL,NOW())', [ids.ptId, ids.enId, ids.orphanId]);
  await pool.query('INSERT INTO "GlobalEmailTemplate" ("id","name","slug","subject","content","updatedAt") VALUES ($1,\'Mail\',\'pre-vencimento\',\'Lembrete\',\'Conteudo\',NOW())', [ids.emailId]);
  await pool.query('INSERT INTO "CollectionProfile" ("id","companyId","name","profileType","updatedAt") VALUES ($1,$2,\'Custom\',\'NEW\',NOW())', [ids.profileId, ids.companyId]);
  const step = 'INSERT INTO "CollectionRuleStep" ("id","profileId","stepOrder","channel","templateId","delayDays","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())';
  await pool.query(step, [ids.emailStepId, ids.profileId, 0, 'EMAIL', ids.ptId, -30]);
  await pool.query(step, [ids.whatsappStepId, ids.profileId, 1, 'WHATSAPP', ids.ptId, 28]);
  await pool.query(step, [ids.orphanStepId, ids.profileId, 2, 'EMAIL', ids.orphanId, 5]);
  await pool.query('INSERT INTO "Debtor" ("id","companyId","name","phoneNumber","whatsappOptIn","collectionProfileId","updatedAt") VALUES ($1,$2,\'Maria\',\'5511988887777\',true,$3,NOW())', [ids.debtorId, ids.companyId, ids.profileId]);
  await pool.query('INSERT INTO "Invoice" ("id","companyId","debtorId","originalAmount","dueDate","updatedAt") VALUES ($1,$2,$3,150,NOW(),NOW())', [ids.invoiceId, ids.companyId, ids.debtorId]);
  // The attempted WhatsApp step keeps its history.
  await pool.query('INSERT INTO "CollectionAttempt" ("id","companyId","invoiceId","ruleStepId","channel","status") VALUES ($1,$2,$3,$4,\'WHATSAPP\',\'SENT\')', [ids.attemptId, ids.companyId, ids.invoiceId, ids.whatsappStepId]);
  return ids;
}

/** Intents prepared by the old code: template payloads without any snapshot. */
async function legacyIntents(prisma, ids) {
  const { intents } = fx.services(prisma);
  const conversation = await fx.conversationFor(prisma, '5511988887777');
  const context = { companyId: ids.companyId, invoiceId: ids.invoiceId, debtorId: ids.debtorId };
  const reserve = (key, payload, messageType = 'template') => intents.reserve({
    idempotencyKey: key, conversationId: conversation.id, transport: 'DATAFY', transportChannelId: '222',
    recipient: { type: 'PHONE', value: '5511988887777' }, context, content: 'legado', messageType,
    payload: { ...context, phoneNumber: '5511988887777', messageType, ...payload },
    retentionExpiresAt: new Date(Date.now() + 86_400_000),
  });
  const template = { templateName: 'cobrapix_pre_vencimento', languageCode: 'pt_BR', bodyParameters: ['Maria'] };
  const pending = await reserve(`collection:${ids.companyId}:${ids.invoiceId}:${ids.whatsappStepId}:WHATSAPP`, { ...template, ruleStepId: ids.whatsappStepId });
  const accepted = await reserve(`collection:${ids.companyId}:${ids.invoiceId}:initial:WHATSAPP`, template);
  const uncertain = await reserve(`legacy-uncertain:${randomUUID()}`, template);
  const sending = await reserve(`legacy-sending:${randomUUID()}`, template);
  const text = await reserve(`admin-reply:${randomUUID()}`, { content: 'Recebemos' }, 'text');
  await prisma.communicationOutboundIntent.update({ where: { id: accepted.id }, data: { state: 'ACCEPTED', transmission: 'ACCEPTED', externalMessageId: `wamid.${randomUUID()}` } });
  await prisma.communicationOutboundIntent.update({ where: { id: uncertain.id }, data: { state: 'UNCERTAIN', transmission: 'UNCERTAIN' } });
  await prisma.communicationOutboundIntent.update({ where: { id: sending.id }, data: { state: 'SENDING', leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) } });
  return { pending: pending.id, accepted: accepted.id, uncertain: uncertain.id, sending: sending.id, text: text.id };
}

const settled = (prisma, ids) => prisma.communicationOutboundIntent.findMany({
  where: { id: { in: ids } }, orderBy: { id: 'asc' },
  select: { id: true, state: true, transmission: true, externalMessageId: true, lastErrorCode: true, updatedAt: true },
});

function transition(prisma) {
  return new TemplateTransitionService(prisma, fx.crypto, fx.services(prisma).pending);
}

(async () => {
  const db = await startDisposablePostgres('transition-test');
  const pools = [db.pool];
  const clients = [];
  const connect = database => {
    const pool = new Pool({ connectionString: db.url.replace(/\/disposable$/, `/${database}`), max: 8 });
    pools.push(pool);
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    clients.push(prisma);
    return { pool, prisma };
  };
  try {
    const all = migrations();
    await deploy(db.pool, { through: all.find(file => file.endsWith(BASE_MIGRATION)) });
    const ids = await seedPriorSchema(db.pool);
    let prisma = new PrismaClient({ adapter: new PrismaPg(db.pool) });
    clients.push(prisma);

    // Preflight on the prior schema: diagnostic only, blocking on the unmapped EMAIL step.
    const beforePreflight = await digest(db.pool);
    const blocked = await transition(prisma).preflight();
    assert.equal(blocked.canApply, false);
    assert.equal(blocked.blockers.length, 1);
    assert.match(blocked.blockers[0], /Etapas EMAIL sem template de e-mail correspondente/);
    assert.ok(blocked.blockers[0].includes(ids.orphanStepId));
    assert.equal(blocked.counts.pendingMigrations, 4);
    assert.equal(blocked.counts.legacyWhatsappTemplatesActive, 3);
    assert.equal(blocked.counts.emailStepsToConvert, 2);
    assert.deepEqual(await digest(db.pool), beforePreflight, 'preflight wrote nothing');
    assert.equal(JSON.stringify(blocked).includes('5511988887777'), false);
    console.log('PASS preflight on the prior schema is read-only and names the blocking step');

    await db.pool.query('UPDATE "CollectionRuleStep" SET "templateId"=$2 WHERE "id"=$1', [ids.orphanStepId, ids.ptId]);
    assert.equal((await transition(prisma).preflight()).canApply, true);
    await assert.rejects(transition(prisma).apply(), /Aplique as migrations/);

    await deploy(db.pool, { after: all.find(file => file.endsWith(BASE_MIGRATION)) });
    await prisma.$disconnect();
    ({ prisma } = connect('disposable'));
    // A legacy explicit choice left by an earlier build also stops sending.
    const explicitStepId = randomUUID();
    await db.pool.query('INSERT INTO "CollectionRuleStep" ("id","profileId","stepOrder","channel","templateId","whatsappSelectionMode","delayDays","updatedAt") VALUES ($1,$2,3,\'WHATSAPP\',$3,\'EXPLICIT\',3,NOW())', [explicitStepId, ids.profileId, ids.enId]);
    const intentIds = await legacyIntents(prisma, ids);
    const postMigration = await transition(prisma).preflight();
    assert.equal(postMigration.counts.pendingMigrations, 0);
    assert.equal(postMigration.counts.grants, 0);

    // Refusals: channel not paused, then an in-flight send.
    await assert.rejects(transition(prisma).apply(), /Pause o canal/);
    await prisma.platformIntegrationState.create({ data: { integration: 'META', enabled: false, pausedAt: new Date(), pauseReason: 'transition' } });
    await assert.rejects(transition(prisma).apply(), /1 envio\(s\) em andamento/);
    assert.equal((await prisma.communicationOutboundIntent.findUnique({ where: { id: intentIds.sending } })).state, 'SENDING', 'in-flight send untouched');
    // The lease/triage cycle settles it as uncertain; the transition then proceeds.
    await prisma.communicationOutboundIntent.update({ where: { id: intentIds.sending }, data: { state: 'UNCERTAIN', transmission: 'UNCERTAIN', leaseToken: null, leaseExpiresAt: null } });
    console.log('PASS apply refuses without migrations, with the channel active or with a send in flight');

    // Backup taken right before apply (a template copy needs no open connection to it),
    // restored later into its own database.
    for (const client of clients.splice(0)) await client.$disconnect();
    for (const open of pools.splice(0)) await open.end();
    const admin = new Pool({ connectionString: db.url.replace(/\/disposable$/, '/postgres'), max: 1 });
    pools.push(admin);
    await admin.query('CREATE DATABASE restored TEMPLATE disposable');
    const main = connect('disposable');
    prisma = main.prisma;
    const pool = main.pool;

    const preserved = [intentIds.accepted, intentIds.uncertain, intentIds.sending];
    const before = {
      financialRows: await financialRows(pool),
      acceptedAndUncertain: await settled(prisma, preserved),
      steps: (await pool.query('SELECT "id","stepOrder","channel","delayDays","emailTemplateId" FROM "CollectionRuleStep" ORDER BY "id"')).rows,
      attempts: (await pool.query('SELECT * FROM "CollectionAttempt" WHERE "status" = \'SENT\' ORDER BY "id"')).rows,
    };
    const first = await transition(prisma).apply();
    assert.deepEqual(first, {
      archivedTemplates: 3, unconfiguredSteps: 1, blockedSends: 1, failedWithoutCompany: 0,
      preservedUncertain: 2, preservedAccepted: 1, unreadablePayloads: 0,
    });
    const verified = await transition(prisma).verify();
    assert.deepEqual(verified.violations, []);
    assert.equal(verified.ok, true);
    const after = {
      activeLegacyWhatsappTemplates: verified.counts.activeLegacyWhatsappTemplates,
      automaticGrants: verified.counts.automaticGrants,
      financialRows: await financialRows(pool),
      acceptedAndUncertain: await settled(prisma, preserved),
    };
    assert.equal(after.activeLegacyWhatsappTemplates, 0);
    assert.equal(after.automaticGrants, 0);
    assert.equal(await prisma.companyWhatsappTemplateGrant.count(), 0);
    assert.equal(await prisma.companyWhatsappTemplateDefault.count(), 0);
    assert.deepEqual(after.financialRows, before.financialRows);
    assert.deepEqual(after.acceptedAndUncertain, before.acceptedAndUncertain);
    assert.deepEqual((await pool.query('SELECT "id","stepOrder","channel","delayDays","emailTemplateId" FROM "CollectionRuleStep" ORDER BY "id"')).rows, before.steps, 'step IDs, order, delays and email links kept');
    assert.deepEqual((await pool.query('SELECT * FROM "CollectionAttempt" WHERE "status" = \'SENT\' ORDER BY "id"')).rows, before.attempts);
    const explicit = await prisma.collectionRuleStep.findUnique({ where: { id: explicitStepId } });
    assert.equal(explicit.whatsappSelectionMode, 'UNCONFIGURED');
    assert.equal(explicit.templateId, ids.enId, 'historical reference kept');
    const held = await prisma.communicationOutboundIntent.findUnique({ where: { id: intentIds.pending } });
    assert.equal(held.state, 'BLOCKED');
    const hold = await prisma.whatsappTemplatePendingSend.findFirst({ where: { currentIntentId: intentIds.pending } });
    assert.equal(hold.code, 'LEGACY_PAYLOAD');
    assert.equal(hold.ruleStepId, ids.whatsappStepId);
    assert.deepEqual(hold.request.selection, { mode: 'UNCONFIGURED' });
    assert.equal((await prisma.communicationOutboundIntent.findUnique({ where: { id: intentIds.text } })).state, 'PENDING', 'free text replies are not template sends');
    assert.equal((await fx.services(prisma).intents.recover()).some(row => row.id === intentIds.pending), false, 'held intent is not recovered');
    const templates = await prisma.globalMessageTemplate.findMany({ where: { id: { in: [ids.ptId, ids.enId, ids.orphanId] } } });
    assert.ok(templates.every(row => !row.isActive && row.archivedAt));
    assert.equal(await prisma.globalEmailTemplate.count({ where: { id: ids.emailId, isActive: true } }), 1, 'email catalog intact');
    console.log('PASS apply archives the internal catalog, holds unsent legacy intents and keeps history, email and finance');

    const secondApply = await transition(prisma).apply();
    assert.equal(secondApply.archivedTemplates, 0);
    assert.equal(secondApply.blockedSends, 0);
    assert.equal(secondApply.unconfiguredSteps, 0);
    assert.equal((await transition(prisma).verify()).ok, true);
    assert.equal(await prisma.whatsappTemplatePendingSend.count(), 1);
    console.log('PASS apply is idempotent');

    // Restoring the pre-apply backup and repeating the transition gives the same outcome.
    const restored = connect('restored').prisma;
    assert.equal((await transition(restored).verify()).ok, false, 'restored backup predates apply');
    assert.deepEqual(await transition(restored).apply(), first);
    assert.equal((await transition(restored).verify()).ok, true);
    console.log('PASS restore of the pre-apply backup and repeated transition');
    console.log('PASS template transition rehearsal on PostgreSQL 16');
  } finally {
    for (const client of clients) await client.$disconnect().catch(() => undefined);
    for (const pool of pools) await pool.end().catch(() => undefined);
    db.stop();
  }
})().catch(error => { console.error(error.code ? `${error.code}: ${error.message}` : error.stack); process.exitCode = 1; });
