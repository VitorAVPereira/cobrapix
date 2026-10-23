'use strict';
// Only a fresh local Docker database; never use DATABASE_URL or DIRECT_URL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const fx = require('./support/template-fixtures.cjs');
const { CollectionRuleEngine } = require('../src/billing/collection-rule-engine.ts');
const { CollectionProfileService } = require('../src/billing/collection-profile.service.ts');
const { EmailTemplatesService } = require('../src/email/email-templates.service.ts');
const runId = randomBytes(8).toString('hex');
const name = `ciframais-rules-test-${runId}`;
const password = randomBytes(24).toString('hex');
const dockerHost = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
const migrationSuffix = '_collection_rules_global_templates';
function docker(args) {
  const result = spawnSync('docker', ['--host', dockerHost, ...args], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed; check local Docker Desktop access.`);
  return result.stdout.trim();
}
let pool;
let prisma;
let started = false;

async function seedLegacy() {
  const companyId = randomUUID();
  const templateId = randomUUID();
  const globalId = randomUUID();
  const profileId = randomUUID();
  const stepId = randomUUID();
  const debtorId = randomUUID();
  const invoiceId = randomUUID();
  const attemptId = randomUUID();
  await pool.query('INSERT INTO "Company" ("id","corporateName","email","phoneNumber","document","updatedAt") VALUES ($1,\'Legacy\',\'legacy@example.test\',\'5511999999999\',\'12345678000190\',NOW())', [companyId]);
  await pool.query('INSERT INTO "MessageTemplate" ("id","companyId","name","slug","content","updatedAt") VALUES ($1,$2,\'Legacy\',\'pre-vencimento\',\'Private tenant text\',NOW())', [templateId, companyId]);
  await pool.query('INSERT INTO "GlobalMessageTemplate" ("id","name","slug","content","updatedAt") VALUES ($1,\'Shared\',\'pre-vencimento\',\'Shared text\',NOW())', [globalId]);
  await pool.query('INSERT INTO "CollectionProfile" ("id","companyId","name","profileType","updatedAt") VALUES ($1,$2,\'Custom legacy profile\',\'NEW\',NOW())', [profileId, companyId]);
  await pool.query('INSERT INTO "CollectionRuleStep" ("id","profileId","stepOrder","channel","templateId","delayDays","updatedAt") VALUES ($1,$2,0,\'WHATSAPP\',$3,-2,NOW())', [stepId, profileId, templateId]);
  await pool.query('INSERT INTO "Debtor" ("id","companyId","name","phoneNumber","collectionProfileId","updatedAt") VALUES ($1,$2,\'Fixture\',\'5511999999999\',$3,NOW())', [debtorId, companyId, profileId]);
  await pool.query('INSERT INTO "Invoice" ("id","companyId","debtorId","originalAmount","dueDate","updatedAt") VALUES ($1,$2,$3,100,NOW(),NOW())', [invoiceId, companyId, debtorId]);
  await pool.query('INSERT INTO "CollectionAttempt" ("id","companyId","invoiceId","ruleStepId","channel","status") VALUES ($1,$2,$3,$4,\'WHATSAPP\',\'SENT\')', [attemptId, companyId, invoiceId, stepId]);
  return { companyId, templateId, globalId, profileId, stepId, attemptId };
}

(async () => {
  try {
    docker(['run', '-d', '--name', name, '--label', `ciframais.rules-test=${runId}`, '--memory', '384m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=rules_test', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
    started = true;
    const binding = docker(['port', name, '5432/tcp']);
    assert.match(binding, /^127\.0\.0\.1:\d+$/);
    pool = new Pool({ host: '127.0.0.1', port: Number(binding.split(':').at(-1)), database: 'rules_test', user: 'postgres', password, connectionTimeoutMillis: 1000, max: 4 });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try { await pool.query('SELECT 1'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.ok(ready, 'disposable local database starts');
    const migrationDir = path.join(root, 'prisma/migrations');
    const migrations = fs.readdirSync(migrationDir).filter(file => fs.existsSync(path.join(migrationDir, file, 'migration.sql'))).sort();
    const target = migrations.find(file => file.endsWith(migrationSuffix));
    for (const file of migrations.filter(file => !target || file < target)) {
      await pool.query(fs.readFileSync(path.join(migrationDir, file, 'migration.sql'), 'utf8'));
    }
    const legacy = await seedLegacy();
    const beforeAttempt = (await pool.query('SELECT * FROM "CollectionAttempt" WHERE "id"=$1', [legacy.attemptId])).rows;
    if (target) {
      const sql = fs.readFileSync(path.join(migrationDir, target, 'migration.sql'), 'utf8');
      // An unmapped custom template must stop the migration, without losing data.
      await pool.query('UPDATE "MessageTemplate" SET "slug"=\'tenant-custom-only\' WHERE "id"=$1', [legacy.templateId]);
      const client = await pool.connect();
      try {
        await assert.rejects(client.query(sql), /sem correspondencia no catalogo global/);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      assert.equal((await pool.query('SELECT "templateId" FROM "CollectionRuleStep" WHERE "id"=$1', [legacy.stepId])).rows[0].templateId, legacy.templateId);
      await pool.query('UPDATE "MessageTemplate" SET "slug"=\'pre-vencimento\' WHERE "id"=$1', [legacy.templateId]);
      await pool.query(sql);
      for (const file of migrations.filter(file => file > target)) {
        await pool.query(fs.readFileSync(path.join(migrationDir, file, 'migration.sql'), 'utf8'));
      }
      const migratedStep = (await pool.query('SELECT "templateId","whatsappSelectionMode","whatsappPurpose","delayDays","stepOrder" FROM "CollectionRuleStep" WHERE "id"=$1', [legacy.stepId])).rows[0];
      // The old reference stays for history; the step needs an explicit new choice.
      assert.deepEqual(migratedStep, { templateId: legacy.globalId, whatsappSelectionMode: 'UNCONFIGURED', whatsappPurpose: 'BEFORE_DUE', delayDays: -2, stepOrder: 0 });
      assert.deepEqual((await pool.query('SELECT * FROM "CollectionAttempt" WHERE "id"=$1', [legacy.attemptId])).rows, beforeAttempt);
      assert.equal((await pool.query('SELECT "content" FROM "GlobalMessageTemplate" WHERE "id"=$1', [legacy.globalId])).rows[0].content, 'Shared text');
      assert.equal(await pool.query('SELECT 1 FROM "CompanyWhatsappTemplateGrant"').then(result => result.rowCount), 0, 'migrations grant nothing');
      console.log('PASS migration maps legacy IDs by slug, preserves history and never publishes private tenant text');
    }

    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const { policy } = fx.services(prisma);
    const emailTemplates = new EmailTemplatesService(prisma, {}, { get: () => undefined });
    const service = new CollectionProfileService(prisma, emailTemplates);
    const company = await prisma.company.create({ data: { corporateName: 'Fresh tenant', email: 'fresh@example.test', phoneNumber: '5511888888888', document: '98765432000190' } });
    const templateCountBefore = await prisma.globalMessageTemplate.count();
    const concurrentReads = await Promise.all(Array.from({ length: 3 }, () => service.listProfiles(company.id)));
    const profiles = concurrentReads[0];
    assert.ok(concurrentReads.every(result => result.length === 4), 'concurrent first page loads share the same default profiles');
    assert.equal(await prisma.collectionProfile.count({ where: { companyId: company.id } }), 4);
    assert.equal(profiles.flatMap(profile => profile.steps).length, 27, 'no "Inicial" steps: the emission is asked for at registration');
    assert.ok(profiles.every(profile => profile.steps.every(step => step.scheduleDay > -30 && step.attempted === false)));
    assert.equal(await prisma.globalMessageTemplate.count(), templateCountBefore, 'no internal WhatsApp template is seeded');
    assert.ok(profiles.every(profile => profile.steps.every(step => step.templateId === null && step.pixTemplateId === null)), 'no template is chosen per step');
    assert.deepEqual((await service.listProfiles(company.id)).map(profile => profile.id), profiles.map(profile => profile.id));
    console.log('PASS default profiles: no "Inicial" step and no template chosen per step');

    const profileId = profiles[0].id;
    const readyTemplate = await fx.readyTemplate(prisma);
    // Template choices sent by older screens are ignored; IDs are kept on reorder and channel switch.
    const saved = await service.setSteps(company.id, profileId, [
      { stepOrder: 0, channel: 'WHATSAPP', delayDays: 0, whatsappSelection: { mode: 'EXPLICIT', templateId: readyTemplate.id } },
      { stepOrder: 1, channel: 'EMAIL', delayDays: 2 },
    ]);
    assert.deepEqual(saved.map(step => [step.templateId, step.whatsappSelectionMode, step.whatsappPurpose, step.scheduleDay]), [[null, 'DEFAULT', 'DUE_TODAY', 0], [null, null, null, 2]]);
    await assert.rejects(service.setSteps(randomUUID(), profileId, [{ stepOrder: 0, channel: 'WHATSAPP', delayDays: 0 }]), error => error.getStatus() === 404);
    await assert.rejects(pool.query('UPDATE "CollectionRuleStep" SET "whatsappSelectionMode"=\'DEFAULT\', "whatsappPurpose"=NULL WHERE "id"=$1', [saved[0].id]), /whatsapp_selection_check/);
    const reordered = await service.setSteps(company.id, profileId, [
      { id: saved[1].id, stepOrder: 0, channel: 'EMAIL', delayDays: -1 },
      { id: saved[0].id, stepOrder: 1, channel: 'WHATSAPP', delayDays: 1 },
    ]);
    assert.deepEqual(reordered.map(step => step.id), [saved[1].id, saved[0].id]);
    const switched = await service.setSteps(company.id, profileId, [
      { id: saved[1].id, stepOrder: 0, channel: 'WHATSAPP', delayDays: -1 },
      { id: saved[0].id, stepOrder: 1, channel: 'EMAIL', delayDays: 1 },
      { stepOrder: 2, channel: 'EMAIL', delayDays: 2 },
    ]);
    assert.deepEqual(switched.slice(0, 2).map(step => [step.id, step.channel, step.whatsappSelectionMode]), [[saved[1].id, 'WHATSAPP', 'DEFAULT'], [saved[0].id, 'EMAIL', null]]);
    const restored = await service.setSteps(company.id, profileId, [
      { id: saved[0].id, stepOrder: 0, channel: 'WHATSAPP', delayDays: 0 },
      { id: saved[1].id, stepOrder: 1, channel: 'EMAIL', delayDays: 0 },
      { stepOrder: 2, channel: 'WHATSAPP', delayDays: 2 },
    ]);
    assert.deepEqual(restored.slice(0, 2).map(step => step.id), [saved[0].id, saved[1].id]);
    assert.equal(await prisma.collectionRuleStep.count({ where: { profileId } }), 3);
    console.log('PASS schedule edits keep step IDs, ignore template choices and stay inside the company');

    // Contacts on real dates: the day-0 WhatsApp and e-mail go together; a later run on day 2
    // sends the day-2 contact; a missed contact is recorded as SKIPPED, never sent later.
    const debtor = await prisma.debtor.create({ data: { companyId: company.id, name: 'Calendar', phoneNumber: '5511977777777', whatsappOptIn: true, collectionProfileId: profileId } });
    const engine = new CollectionRuleEngine(prisma);
    const load = async (dueDate, createdAt) => prisma.invoice.findFirstOrThrow({ where: { id: (await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 10, dueDate, status: 'PENDING', createdAt } })).id }, include: { debtor: { include: { collectionProfile: { include: { steps: { where: { isActive: true }, orderBy: { stepOrder: 'asc' } } } } } } } });
    const at = (date, time) => new Date(`${date}T${time}:00-03:00`);
    const due = new Date('2026-10-23T00:00:00Z');
    const invoice = await load(due, at('2026-10-10', '10:00'));
    const plan = await engine.planContact(invoice, at('2026-10-23', '09:00'));
    assert.equal(plan.kind, 'SEND');
    assert.deepEqual(plan.contact.steps.map(step => step.channel), ['WHATSAPP', 'EMAIL']);
    assert.equal(plan.moment, 'DUE_TODAY');
    const claims = plan.contact.steps.map(step => ({ ...step, status: 'QUEUED' }));
    // Two runs claiming at once (scheduled and "Executar agora"): exactly one wins.
    const concurrent = await Promise.all([1, 2, 3].map(() => engine.claimContact(invoice, claims, at('2026-10-23', '09:00'))));
    assert.equal(concurrent.filter(Boolean).length, 1);
    assert.equal(await prisma.collectionAttempt.count({ where: { invoiceId: invoice.id } }), 2);
    // Same day, 8 h later: nothing (24 h). Two days later: the day-2 contact, first overdue.
    assert.deepEqual(await engine.planContact(invoice, at('2026-10-23', '17:00')), { kind: 'NONE' });
    const late = await engine.planContact(invoice, at('2026-10-25', '09:00'));
    assert.deepEqual([late.kind, late.contact.day, late.moment], ['SEND', 2, 'FIRST_OVERDUE']);
    // An invoice whose day-0 contact never ran: on day 2 only the day-2 contact goes.
    const missed = await load(due, at('2026-10-10', '10:00'));
    const skippedPlan = await engine.planContact(missed, at('2026-10-25', '09:00'));
    assert.equal(skippedPlan.contact.day, 2);
    assert.deepEqual((await prisma.collectionAttempt.findMany({ where: { invoiceId: missed.id }, orderBy: { channel: 'asc' } })).map(attempt => [attempt.channel, attempt.status]), [['EMAIL', 'SKIPPED'], ['WHATSAPP', 'SKIPPED']]);
    console.log('PASS contacts: channels together, one claim wins, 24 h between messages, missed contacts skipped');

    // A step already sent keeps its day and channel; removing it retires it with its history.
    const current = await service.getProfile(company.id, profileId);
    const unchanged = current.steps.map(step => ({ id: step.id, stepOrder: step.stepOrder, channel: step.channel, delayDays: step.delayDays }));
    assert.ok(current.steps[0].attempted);
    await assert.rejects(service.setSteps(company.id, profileId, unchanged.map((step, index) => index === 0 ? { ...step, delayDays: 1 } : step)), error => error.getStatus() === 400);
    const retired = await service.setSteps(company.id, profileId, unchanged.slice(1).map((step, index) => ({ ...step, stepOrder: index })));
    assert.equal(retired.length, 2);
    const kept = await prisma.collectionRuleStep.findUnique({ where: { id: current.steps[0].id } });
    assert.equal(kept.isActive, false, 'the sent step is retired, not deleted');
    assert.ok(await prisma.collectionAttempt.count({ where: { ruleStepId: kept.id } }) > 0, 'attempt history kept');
    console.log('PASS steps already sent keep day and channel; removing one retires it');

    // Custom template of a step comes before the global one; it goes away with the step.
    const ruleStepId = retired.find(step => step.channel === 'WHATSAPP').id;
    const { CollectionStepTemplateService } = require('../src/templates/collection-step-template.service.ts');
    const { CollectionTemplateSlotService } = require('../src/templates/collection-template-slot.service.ts');
    const custom = await fx.readyTemplate(prisma);
    await new CollectionTemplateSlotService(prisma, policy).set('DUE_TODAY', 'PIX', readyTemplate.id, 0, randomUUID());
    const resolve = (companyId, selection) => prisma.$transaction(tx => policy.resolve(tx, companyId, selection));
    const automatic = { mode: 'AUTOMATIC', purpose: 'DUE_TODAY', billingMethod: 'PIX', ruleStepId };
    assert.equal((await resolve(company.id, automatic)).template.snapshot.templateId, readyTemplate.id, 'global template, no grant needed');
    const steps = new CollectionStepTemplateService(prisma, policy);
    await assert.rejects(steps.set(randomUUID(), ruleStepId, 'PIX', custom.id, randomUUID()), error => error.getStatus() === 404, 'a step of another company');
    await steps.set(company.id, ruleStepId, 'PIX', custom.id, randomUUID());
    assert.equal((await resolve(company.id, automatic)).template.snapshot.templateId, custom.id);
    assert.equal((await resolve(randomUUID(), automatic)).template.snapshot.templateId, readyTemplate.id, 'another company never gets this custom template');
    await assert.rejects(pool.query('INSERT INTO "CollectionStepTemplateOverride" ("id","companyId","ruleStepId","billingMethod","templateId","updatedAt") VALUES ($1,$2,$3,\'BOLETO\',$4,NOW())', [randomUUID(), company.id, ruleStepId, custom.id]), /method_check/);
    await service.setSteps(company.id, profileId, []);
    assert.equal(await prisma.collectionStepTemplateOverride.count({ where: { ruleStepId } }), 0, 'deleted with its step');
    console.log('PASS custom templates of a step: before the global one, inside the company, deleted with the step');
    // Standard schedules of existing companies: preview writes nothing; apply moves only the
    // first profile of each type; a sent step on a kept day and channel keeps its ID; idempotent.
    const older = await prisma.company.create({ data: { corporateName: 'Older tenant', email: 'older@example.test', phoneNumber: '5511866666666', document: '11222333000181' } });
    await service.listProfiles(older.id);
    const olderNew = await prisma.collectionProfile.findFirstOrThrow({ where: { companyId: older.id, profileType: 'NEW' } });
    const oldSchedule = await service.setSteps(older.id, olderNew.id, [{ stepOrder: 0, channel: 'EMAIL', delayDays: -2 }, { stepOrder: 1, channel: 'WHATSAPP', delayDays: 2 }]);
    const olderDebtor = await prisma.debtor.create({ data: { companyId: older.id, name: 'Older', phoneNumber: '5511955555555', collectionProfileId: olderNew.id } });
    const olderInvoice = await prisma.invoice.create({ data: { companyId: older.id, debtorId: olderDebtor.id, originalAmount: 10, dueDate: due, status: 'PENDING' } });
    for (const step of oldSchedule) await prisma.collectionAttempt.create({ data: { companyId: older.id, invoiceId: olderInvoice.id, ruleStepId: step.id, channel: step.channel, status: 'SENT' } });
    const vip = await service.createProfile(older.id, { name: 'Clientes VIP', profileType: 'NEW' });
    await service.setSteps(older.id, vip.id, [{ stepOrder: 0, channel: 'EMAIL', delayDays: 1 }]);
    const forOlder = changes => changes.filter(change => change.companyId === older.id).map(change => [change.profileType, change.action, change.before]);
    assert.deepEqual(forOlder(await service.syncStandardSchedules(false)), [['NEW', 'WOULD_REPLACE', '-2:E 0:W'], ['GOOD', 'UNCHANGED', '-3:E 0:W 3:E+W'], ['DOUBTFUL', 'UNCHANGED', '-5:E -2:W 0:E+W 3:W 7:E+W 15:W 30:E'], ['BAD', 'UNCHANGED', '-5:W -2:E 0:E+W 7:E+W 20:E']]);
    assert.equal(await prisma.collectionRuleStep.count({ where: { profileId: olderNew.id, isActive: true } }), 2, 'preview writes nothing');
    assert.deepEqual(forOlder(await service.syncStandardSchedules(true)).map(([type, action]) => [type, action]), [['NEW', 'REPLACED'], ['GOOD', 'UNCHANGED'], ['DOUBTFUL', 'UNCHANGED'], ['BAD', 'UNCHANGED']]);
    const moved = await service.getProfile(older.id, olderNew.id);
    assert.deepEqual(moved.steps.map(step => [step.scheduleDay, step.channel]), [[-3, 'WHATSAPP'], [0, 'WHATSAPP'], [0, 'EMAIL'], [2, 'WHATSAPP'], [7, 'WHATSAPP'], [7, 'EMAIL'], [15, 'EMAIL']]);
    assert.equal(moved.steps[1].id, oldSchedule[1].id, 'the sent day-0 WhatsApp keeps its ID and history');
    assert.equal((await prisma.collectionRuleStep.findUnique({ where: { id: oldSchedule[0].id } })).isActive, false, 'the sent -2 e-mail is retired');
    assert.deepEqual((await service.getProfile(older.id, vip.id)).steps.map(step => [step.scheduleDay, step.channel]), [[1, 'EMAIL']], 'a profile the company created is not touched');
    assert.ok(forOlder(await service.syncStandardSchedules(true)).every(([, action]) => action === 'UNCHANGED'), 'idempotent');
    console.log('PASS standard schedules of existing companies: preview, apply on standard profiles only, sent steps kept, idempotent');
    // Invoices of one recurrence share the 24 h: a payer with overdue weekly invoices gets
    // one rule message a day, not one per invoice; a one-off invoice keeps its own count.
    const weeklyTenant = await prisma.company.create({ data: { corporateName: 'Weekly tenant', email: 'weekly@example.test', phoneNumber: '5511844444444', document: '33444555000181' } });
    await service.listProfiles(weeklyTenant.id);
    const weeklyProfile = await prisma.collectionProfile.findFirstOrThrow({ where: { companyId: weeklyTenant.id, profileType: 'NEW' } });
    await service.setSteps(weeklyTenant.id, weeklyProfile.id, [{ stepOrder: 0, channel: 'WHATSAPP', delayDays: 0 }]);
    const weeklyDebtor = await prisma.debtor.create({ data: { companyId: weeklyTenant.id, name: 'Weekly', phoneNumber: '5511944444444', whatsappOptIn: true, collectionProfileId: weeklyProfile.id } });
    const weekly = await prisma.recurringInvoice.create({ data: { companyId: weeklyTenant.id, debtorId: weeklyDebtor.id, amount: 10, billingType: 'PIX', dueDay: 16, frequency: 'WEEKLY' } });
    const loadWeekly = async (dueDate, recurrencePeriod) => prisma.invoice.findFirstOrThrow({ where: { id: (await prisma.invoice.create({ data: { companyId: weeklyTenant.id, debtorId: weeklyDebtor.id, originalAmount: 10, dueDate, status: 'PENDING', createdAt: at('2026-10-01', '10:00'), ...(recurrencePeriod ? { recurringInvoiceId: weekly.id, recurrencePeriod } : {}) } })).id }, include: { debtor: { include: { collectionProfile: { include: { steps: { where: { isActive: true }, orderBy: { stepOrder: 'asc' } } } } } } } });
    const firstWeek = await loadWeekly(new Date('2026-10-16T00:00:00Z'), '2026-10-16');
    const secondWeek = await loadWeekly(due, '2026-10-23');
    const oneOff = await loadWeekly(due, null);
    const weekPlan = await engine.planContact(firstWeek, at('2026-10-23', '09:00'));
    assert.equal(weekPlan.kind, 'SEND');
    assert.equal(await engine.claimContact(firstWeek, weekPlan.contact.steps.map(step => ({ ...step, status: 'QUEUED' })), at('2026-10-23', '09:00')), true);
    assert.deepEqual(await engine.planContact(secondWeek, at('2026-10-23', '09:00')), { kind: 'WAIT', reason: 'MIN_INTERVAL' });
    assert.equal(await engine.claimContact(secondWeek, weekPlan.contact.steps.map(step => ({ ...step, status: 'QUEUED' })), at('2026-10-23', '09:00')), false, 'the claim re-checks the recurrence');
    assert.equal((await engine.planContact(oneOff, at('2026-10-23', '09:00'))).kind, 'SEND', 'a one-off invoice of the same payer is not held');
    assert.equal((await engine.planContact(secondWeek, at('2026-10-24', '09:00'))).kind, 'SEND', 'the next day it goes');
    console.log('PASS invoices of one recurrence share the 24 h between messages');
    console.log(`PASS collection rules on PostgreSQL 16 with ${migrations.length} migrations`);
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    if (started) {
      const owner = docker(['inspect', '--format', '{{ index .Config.Labels "ciframais.rules-test" }}', name]);
      assert.equal(owner, runId, 'cleanup only the container created by this invocation');
      docker(['rm', '-f', '-v', name]);
    }
  }
})().catch(error => { console.error(error.code ? `${error.code}: ${error.message}` : error.message); process.exitCode = 1; });
