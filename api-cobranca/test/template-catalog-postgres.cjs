'use strict';
// Only a fresh local Docker database; never use DATABASE_URL or DIRECT_URL.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { startDisposablePostgres, migrate, root } = require('./support/disposable-postgres.cjs');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });

const sections = [];
/** Scenarios run in order against one database. */
function section(name, run) { sections.push({ name, run }); }

const WABA_A = '111111111111111';
const WABA_B = '222222222222222';

async function company(prisma, label) {
  return prisma.company.create({ data: { corporateName: label, email: `${label}-${randomUUID()}@example.test`, phoneNumber: '5511999999999', document: randomUUID().replace(/-/g, '').slice(0, 14) } });
}

function imported(overrides = {}) {
  return {
    name: 'cobranca_real', slug: `meta-${randomUUID()}`, content: 'Olá {{1}}', origin: 'META_IMPORTED',
    providerAccountId: WABA_A, metaTemplateId: randomUUID().replace(/\D/g, '').slice(0, 15) || '1',
    metaTemplateName: 'cobranca_real', metaLanguage: 'pt_BR', metaStatus: 'APPROVED', ...overrides,
  };
}

section('catalog identity, uniqueness and foreign keys', async ({ prisma, pool }) => {
  const shared = { metaTemplateId: '900001' };
  await prisma.globalMessageTemplate.create({ data: imported(shared) });
  await assert.rejects(prisma.globalMessageTemplate.create({ data: imported(shared) }), error => error.code === 'P2002', 'same WABA + provider ID is unique');
  await prisma.globalMessageTemplate.create({ data: imported({ ...shared, providerAccountId: WABA_B }) });
  // Same name in another language or WABA coexists with distinct provider IDs.
  await prisma.globalMessageTemplate.create({ data: imported({ metaLanguage: 'en_US', metaTemplateId: '900002' }) });
  await prisma.globalMessageTemplate.create({ data: imported({ providerAccountId: WABA_B, metaTemplateId: '900003' }) });
  assert.equal(await prisma.globalMessageTemplate.count({ where: { metaTemplateName: 'cobranca_real' } }), 4);
  // Legacy rows without identity keep coexisting.
  await prisma.globalMessageTemplate.create({ data: { name: 'Legacy 1', slug: `legacy-${randomUUID()}`, content: 'x' } });
  await prisma.globalMessageTemplate.create({ data: { name: 'Legacy 2', slug: `legacy-${randomUUID()}`, content: 'x' } });
  await assert.rejects(pool.query('INSERT INTO "GlobalMessageTemplate" ("id","name","slug","content","origin","updatedAt") VALUES ($1,\'x\',$2,\'x\',\'META_IMPORTED\',NOW())', [randomUUID(), `bad-${randomUUID()}`]), /imported_identity_check/);

  const template = await prisma.globalMessageTemplate.create({ data: imported({ metaTemplateId: '900010' }) });
  const tenant = await company(prisma, 'Tenant');
  await prisma.companyWhatsappTemplateGrant.create({ data: { companyId: tenant.id, templateId: template.id, enabled: true, version: 1 } });
  await assert.rejects(prisma.companyWhatsappTemplateGrant.create({ data: { companyId: tenant.id, templateId: template.id } }), error => error.code === 'P2002');
  await prisma.companyWhatsappTemplateDefault.create({ data: { companyId: tenant.id, purpose: 'EMISSION', templateId: template.id, version: 1 } });
  await assert.rejects(prisma.companyWhatsappTemplateDefault.create({ data: { companyId: tenant.id, purpose: 'EMISSION' } }), error => error.code === 'P2002');
  const mapping = { templateId: template.id, revision: 1, providerRevision: 1, providerFingerprint: 'f'.repeat(64), components: [], mapping: { body: {} } };
  await prisma.whatsappTemplateMappingRevision.create({ data: mapping });
  await assert.rejects(prisma.whatsappTemplateMappingRevision.create({ data: mapping }), error => error.code === 'P2002');
  await assert.rejects(prisma.globalMessageTemplate.delete({ where: { id: template.id } }), 'grants, defaults and revisions keep the template');
  await assert.rejects(prisma.companyWhatsappTemplateGrant.create({ data: { companyId: randomUUID(), templateId: template.id } }), 'grant needs an existing company');
  await prisma.whatsappTemplateAudit.create({ data: { action: 'CATALOG_IMPORTED', templateId: template.id, details: { providerRevision: 1 } } });
  await prisma.whatsappTemplateSyncState.create({ data: { providerAccountId: WABA_A } });
  await assert.rejects(prisma.whatsappTemplateSyncState.create({ data: { providerAccountId: WABA_A } }), error => error.code === 'P2002');
});

module.exports = { section, imported, company, WABA_A, WABA_B };

if (require.main === module) {
  (async () => {
    const db = await startDisposablePostgres('catalog-test');
    let prisma;
    try {
      const { applied } = await migrate(db.pool);
      prisma = new PrismaClient({ adapter: new PrismaPg(db.pool) });
      for (const { name, run } of sections) {
        await run({ prisma, pool: db.pool, url: db.url });
        console.log(`PASS ${name}`);
      }
      console.log(`PASS template catalog on PostgreSQL 16 with ${applied.length} migrations`);
    } finally {
      if (prisma) await prisma.$disconnect();
      await db.pool.end();
      db.stop();
    }
  })().catch(error => { console.error(error.code ? `${error.code}: ${error.message}` : error.stack); process.exitCode = 1; });
}
