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
    const service = new CollectionProfileService(prisma, policy, emailTemplates);
    const company = await prisma.company.create({ data: { corporateName: 'Fresh tenant', email: 'fresh@example.test', phoneNumber: '5511888888888', document: '98765432000190' } });
    const templateCountBefore = await prisma.globalMessageTemplate.count();
    const concurrentReads = await Promise.all(Array.from({ length: 3 }, () => service.listProfiles(company.id)));
    const profiles = concurrentReads[0];
    assert.ok(concurrentReads.every(result => result.length === 4), 'concurrent first page loads share the same default profiles');
    assert.equal(await prisma.collectionProfile.count({ where: { companyId: company.id } }), 4);
    assert.equal(profiles.flatMap(profile => profile.steps).length, 44);
    assert.equal(await prisma.globalMessageTemplate.count(), templateCountBefore, 'no internal WhatsApp template is seeded');
    const emailIds = new Set((await emailTemplates.findAll(company.id)).map(template => template.id));
    assert.ok(profiles.every(profile => profile.steps.every(step => step.channel === 'WHATSAPP'
      ? step.templateId === null && step.emailTemplateId === null && step.whatsappSelectionMode === 'DEFAULT' && step.whatsappSelection.mode === 'DEFAULT' && step.whatsappStatus.code === 'DEFAULT_MISSING'
      : emailIds.has(step.emailTemplateId) && step.templateId === null && step.whatsappSelection === null)), 'WhatsApp steps wait for the company purpose default; email keeps its catalog');
    assert.equal(await prisma.messageTemplate.count({ where: { companyId: company.id } }), 0);
    assert.deepEqual((await service.listProfiles(company.id)).map(profile => profile.id), profiles.map(profile => profile.id));
    console.log('PASS default profiles use purpose defaults for WhatsApp and the email catalog for EMAIL');

    const profileId = profiles[0].id;
    const readyTemplate = await fx.readyTemplate(prisma);
    const explicit = { mode: 'EXPLICIT', templateId: readyTemplate.id };
    await assert.rejects(service.setSteps(company.id, profileId, [{ stepOrder: 0, channel: 'WHATSAPP', delayDays: -2, whatsappSelection: explicit }]), error => error.getStatus() === 400, 'a template not granted to the company is refused');
    await fx.grant(prisma, company.id, readyTemplate.id);
    const saved = await service.setSteps(company.id, profileId, [
      { stepOrder: 0, channel: 'WHATSAPP', delayDays: 0, whatsappSelection: explicit },
      { stepOrder: 1, channel: 'EMAIL', delayDays: 2 },
    ]);
    assert.equal(saved[0].templateId, readyTemplate.id);
    assert.deepEqual(saved[0].whatsappStatus, { ready: true, code: null });
    await assert.rejects(service.setSteps(randomUUID(), profileId, [{ stepOrder: 0, channel: 'WHATSAPP', delayDays: 0, whatsappSelection: explicit }]), error => error.getStatus() === 404);
    await assert.rejects(service.setSteps(company.id, profileId, [{ stepOrder: 0, channel: 'WHATSAPP', delayDays: 0, whatsappSelection: { mode: 'UNCONFIGURED' } }]), error => error.getStatus() === 400, 'new steps need a valid choice');
    await assert.rejects(service.setSteps(company.id, profileId, [{ stepOrder: 0, channel: 'EMAIL', delayDays: 0, whatsappSelection: explicit }]), error => error.getStatus() === 400);
    await assert.rejects(pool.query('UPDATE "CollectionRuleStep" SET "whatsappSelectionMode"=\'DEFAULT\', "whatsappPurpose"=NULL WHERE "id"=$1', [saved[0].id]), /whatsapp_selection_check/);
    // Without attempts, steps sent back with their ID keep it, also when reordered or
    // switching channel; new steps get new IDs and omitted ones are removed.
    const reordered = await service.setSteps(company.id, profileId, [
      { id: saved[1].id, stepOrder: 0, channel: 'EMAIL', delayDays: -1 },
      { id: saved[0].id, stepOrder: 1, channel: 'WHATSAPP', delayDays: 1, whatsappSelection: explicit },
    ]);
    assert.deepEqual(reordered.map(step => step.id), [saved[1].id, saved[0].id]);
    const switched = await service.setSteps(company.id, profileId, [
      { id: saved[1].id, stepOrder: 0, channel: 'WHATSAPP', delayDays: -1, whatsappSelection: { mode: 'DEFAULT', purpose: 'BEFORE_DUE' } },
      { id: saved[0].id, stepOrder: 1, channel: 'EMAIL', delayDays: 1 },
      { stepOrder: 2, channel: 'EMAIL', delayDays: 2 },
    ]);
    assert.deepEqual(switched.slice(0, 2).map(step => [step.id, step.channel, step.templateId]), [[saved[1].id, 'WHATSAPP', null], [saved[0].id, 'EMAIL', null]]);
    assert.ok(![saved[0].id, saved[1].id].includes(switched[2].id));
    const restored = await service.setSteps(company.id, profileId, [
      { id: saved[0].id, stepOrder: 0, channel: 'WHATSAPP', delayDays: 0, whatsappSelection: explicit },
      { id: saved[1].id, stepOrder: 1, channel: 'EMAIL', delayDays: 2 },
    ]);
    assert.deepEqual(restored.map(step => step.id), [saved[0].id, saved[1].id]);
    assert.equal(await prisma.collectionRuleStep.count({ where: { profileId } }), 2);
    console.log('PASS edits accept only templates granted to the company, per channel, keeping step IDs, without cross-tenant access');

    // blocked_step_preserves_next_due_day: a held WhatsApp step counts as attempted and
    // the next step keeps its own cumulative day.
    const debtor = await prisma.debtor.create({ data: { companyId: company.id, name: 'Calendar', phoneNumber: '5511977777777', whatsappOptIn: true, collectionProfileId: profileId } });
    const engine = new CollectionRuleEngine(prisma);
    const load = async dueDate => prisma.invoice.findFirstOrThrow({ where: { id: (await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 10, dueDate, status: 'PENDING' } })).id }, include: { debtor: { include: { collectionProfile: { include: { steps: { where: { isActive: true }, orderBy: { stepOrder: 'asc' } } } } } } } });
    const today = new Date();
    const dueToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12));
    const nextEmailDueDay = async status => {
      const invoice = await load(dueToday);
      const first = await engine.getNextStep(invoice);
      assert.equal(first.channel, 'WHATSAPP');
      await prisma.collectionAttempt.create({ data: { companyId: company.id, invoiceId: invoice.id, ruleStepId: first.ruleStepId, channel: 'WHATSAPP', status } });
      assert.equal(await engine.getNextStep(invoice), null, 'the email step is not anticipated');
      const twoDaysLater = await load(new Date(dueToday.getTime() - 2 * 86_400_000));
      await prisma.collectionAttempt.create({ data: { companyId: company.id, invoiceId: twoDaysLater.id, ruleStepId: first.ruleStepId, channel: 'WHATSAPP', status } });
      const next = await engine.getNextStep(twoDaysLater);
      return next && { channel: next.channel, delayDays: next.delayDays };
    };
    const nextEmailDueDayBefore = await nextEmailDueDay('SENT');
    const nextEmailDueDayAfter = await nextEmailDueDay('BLOCKED');
    assert.deepEqual(nextEmailDueDayBefore, { channel: 'EMAIL', delayDays: 2 });
    assert.deepEqual(nextEmailDueDayAfter, nextEmailDueDayBefore);
    console.log('PASS a blocked WhatsApp step keeps the calendar of the following steps');

    // Attempted steps keep IDs and schedule: only the template choice may change.
    const current = await prisma.collectionRuleStep.findMany({ where: { profileId }, orderBy: { stepOrder: 'asc' } });
    const unchanged = current.map(step => ({ id: step.id, stepOrder: step.stepOrder, channel: step.channel, delayDays: step.delayDays, ...(step.channel === 'WHATSAPP' ? { whatsappSelection: { mode: 'DEFAULT', purpose: 'DUE_TODAY' } } : {}) }));
    const updated = await service.setSteps(company.id, profileId, unchanged);
    assert.deepEqual(updated.map(step => step.id), current.map(step => step.id));
    assert.deepEqual(updated[0].whatsappSelection, { mode: 'DEFAULT', purpose: 'DUE_TODAY' });
    assert.equal(updated[0].templateId, null);
    await assert.rejects(service.setSteps(company.id, profileId, unchanged.map((step, index) => index === 1 ? { ...step, delayDays: 3 } : step)), error => error.getStatus() === 400);
    assert.ok(await prisma.collectionAttempt.count({ where: { ruleStepId: current[0].id } }) > 0, 'attempt history kept');
    console.log('PASS attempted steps change only their template choice, by stable ID');

    // Templates per billing method: granted and compatible only, changeable on attempted
    // steps, kept by clients that do not send the field, never on e-mail steps.
    const boletoTemplate = await fx.readyTemplate(prisma);
    await fx.services(prisma).mappings.save(boletoTemplate.id, 1, 1, { ...fx.MAPPING, body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' }, '2': { kind: 'SOURCE', source: 'BOLETO_LINE' } } }, randomUUID());
    const withMethod = methods => unchanged.map(step => step.channel === 'WHATSAPP' ? { ...step, whatsappMethodTemplates: methods } : step);
    await assert.rejects(service.setSteps(company.id, profileId, withMethod({ BOLETO: boletoTemplate.id })), error => error.getStatus() === 400, 'a template not granted is refused');
    await fx.grant(prisma, company.id, boletoTemplate.id);
    const byMethod = await service.setSteps(company.id, profileId, withMethod({ BOLETO: boletoTemplate.id }));
    assert.equal(byMethod[0].boletoTemplateId, boletoTemplate.id);
    assert.deepEqual(byMethod[0].whatsappMethodStatus, { BOLETO: { ready: true, code: null } });
    await assert.rejects(service.setSteps(company.id, profileId, withMethod({ PIX: boletoTemplate.id })), error => error.getStatus() === 400, 'a boleto template never serves Pix charges');
    assert.equal((await service.setSteps(company.id, profileId, unchanged))[0].boletoTemplateId, boletoTemplate.id, 'an older client keeps the choice');
    assert.equal((await service.setSteps(company.id, profileId, withMethod({ BOLETO: null })))[0].boletoTemplateId, null);
    await assert.rejects(pool.query('UPDATE "CollectionRuleStep" SET "pixTemplateId"=$1 WHERE "id"=$2', [readyTemplate.id, current[1].id]), /method_templates_check/);
    await assert.rejects(pool.query('UPDATE "CollectionRuleStep" SET "bolixTemplateId"=$1 WHERE "id"=$2', [randomUUID(), current[0].id]), /bolixTemplateId_fkey/);
    console.log('PASS templates per billing method: granted, compatible, kept by older clients, WhatsApp steps only');
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
