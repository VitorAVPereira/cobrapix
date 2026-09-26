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
const { TemplatesService } = require('../src/templates/templates.service.ts');
const { CollectionProfileService } = require('../src/billing/collection-profile.service.ts');
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
      assert.equal((await pool.query('SELECT "templateId" FROM "CollectionRuleStep" WHERE "id"=$1', [legacy.stepId])).rows[0].templateId, legacy.globalId);
      assert.deepEqual((await pool.query('SELECT * FROM "CollectionAttempt" WHERE "id"=$1', [legacy.attemptId])).rows, beforeAttempt);
      assert.equal((await pool.query('SELECT "content" FROM "GlobalMessageTemplate" WHERE "id"=$1', [legacy.globalId])).rows[0].content, 'Shared text');
      console.log('PASS migration maps legacy IDs by slug, preserves history and never publishes private tenant text');
    }

    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    // No provider clients or queues: seeding the catalog only constructs a name.
    const templates = new TemplatesService(prisma, { buildMetaTemplateName: slug => `fixture_${slug}` });
    const service = new CollectionProfileService(prisma, templates);
    const company = await prisma.company.create({ data: { corporateName: 'Fresh tenant', email: 'fresh@example.test', phoneNumber: '5511888888888', document: '98765432000190' } });
    const concurrentReads = await Promise.all(Array.from({ length: 3 }, () => service.listProfiles(company.id)));
    const profiles = concurrentReads[0];
    assert.ok(concurrentReads.every(result => result.length === 4), 'concurrent first page loads share the same default profiles');
    assert.equal(profiles.length, 4);
    assert.equal(await prisma.collectionProfile.count({ where: { companyId: company.id } }), 4);
    assert.equal(profiles.flatMap(profile => profile.steps).length, 44);
    const catalog = await templates.findAll(company.id);
    assert.equal(catalog.find(template => template.id === legacy.globalId).content, 'Shared text', 'catalog initialization preserves existing content');
    const catalogIds = new Set(catalog.map(template => template.id));
    assert.ok(profiles.every(profile => profile.companyId === company.id && profile.steps.every(step => catalogIds.has(step.templateId))));
    assert.equal(await prisma.messageTemplate.count({ where: { companyId: company.id } }), 0);
    assert.deepEqual((await service.listProfiles(company.id)).map(profile => profile.id), profiles.map(profile => profile.id));
    console.log('PASS concurrent GET /billing/rules service calls persist and reload four default profiles using global templates');

    const profileId = profiles[0].id;
    const selected = catalog.find(template => template.slug === 'pre-vencimento');
    const steps = [{ stepOrder: 0, channel: 'WHATSAPP', delayDays: -2, templateId: selected.id }];
    const saved = await service.setSteps(company.id, profileId, steps);
    assert.equal(saved[0].templateId, selected.id);
    await assert.rejects(service.setSteps(legacy.companyId, profileId, steps), error => error.getStatus() === 404);
    for (const templateId of [legacy.templateId, randomUUID()]) {
      await assert.rejects(service.setSteps(company.id, profileId, [{ ...steps[0], templateId }]), error => error.getStatus() === 400);
    }
    await templates.update(company.id, selected.id, { isActive: false });
    await assert.rejects(service.setSteps(company.id, profileId, steps), error => error.getStatus() === 400);
    await templates.update(company.id, selected.id, { isActive: true });
    await prisma.globalMessageTemplate.update({ where: { id: selected.id }, data: { isActive: false } });
    await assert.rejects(service.setSteps(company.id, profileId, steps), error => error.getStatus() === 400);
    assert.deepEqual(await prisma.collectionRuleStep.findMany({ where: { profileId } }), saved, 'rejected edits preserve existing steps');
    console.log('PASS edits accept global IDs, reject legacy/inactive/unknown IDs and prevent cross-tenant changes');
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
