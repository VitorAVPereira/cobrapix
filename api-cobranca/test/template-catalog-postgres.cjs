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

const { TemplateCatalogSyncService } = require('../src/templates/template-catalog-sync.service.ts');
const { applyTemplateEvent } = require('../src/templates/template-provider-state.ts');

const FRONTEND = 'https://app.ciframais.test';
const settings = { FRONTEND_URL: FRONTEND, META_BUSINESS_ACCOUNT_ID: WABA_A, DATAFY_API_TOKEN: 'sk_test' };
const config = { get: key => settings[key] };

function providerTemplate(id, overrides = {}) {
  return {
    id, name: `cobranca_${id}`, language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', parameter_format: 'POSITIONAL',
    components: [
      { type: 'BODY', text: 'Olá {{1}}, sua cobrança de {{2}} vence em {{3}}.' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Pagar', url: `${FRONTEND}/pagar/{{1}}` }] },
    ],
    ...overrides,
  };
}

/** Datafy stand-in: numbered cursor pages; an Error entry fails that page. */
function fakeTransport(pages, { onPage } = {}) {
  return {
    kind: 'DATAFY',
    getChannelInfo: async () => ({ phoneNumberId: '1', businessAccountId: WABA_A }),
    listTemplates: async after => {
      const index = after ? Number(after) : 0;
      if (onPage) await onPage(index);
      const page = pages[index];
      if (page instanceof Error) throw page;
      return { data: page, ...(index + 1 < pages.length ? { after: String(index + 1) } : {}) };
    },
  };
}

section('catalog sync imports, reconciles and follows events', async ({ prisma }) => {
  const byProviderId = id => prisma.globalMessageTemplate.findUnique({ where: { providerAccountId_metaTemplateId: { providerAccountId: WABA_A, metaTemplateId: id } } });
  const sync = (pages, options) => new TemplateCatalogSyncService(prisma, config, fakeTransport(pages, options)).sync('MANUAL');

  // imports_unknown_approved_without_grant
  const first = await sync([[providerTemplate('700001'), providerTemplate('700002', { status: 'REJECTED' }), { name: 'sem_id', language: 'pt_BR', status: 'APPROVED' }]]);
  assert.equal(first.imported, 1);
  assert.equal(first.incomplete, 1, 'an item without provider ID is reported, never imported');
  assert.equal(first.completed, true);
  const imported = await byProviderId('700001');
  assert.equal(imported.origin, 'META_IMPORTED');
  assert.equal(imported.supportReason, null);
  assert.equal(imported.providerRevision, 1);
  assert.equal(imported.mappingRevision, 0);
  assert.equal(await byProviderId('700002'), null, 'a template never approved is not imported');
  assert.equal(await prisma.companyWhatsappTemplateGrant.count({ where: { templateId: imported.id } }), 0);
  assert.equal(await prisma.companyWhatsappTemplateDefault.count({ where: { templateId: imported.id } }), 0);

  // Repeated and concurrent syncs never duplicate the local template.
  const concurrent = await Promise.allSettled([1, 2, 3].map(() => sync([[providerTemplate('700001'), providerTemplate('700003', { components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Imagem {{1}}' }] })]])));
  assert.ok(concurrent.some(result => result.status === 'fulfilled'));
  assert.ok(concurrent.every(result => result.status === 'fulfilled' || result.reason.getStatus() === 409), 'a sync in progress answers 409');
  assert.equal(await prisma.globalMessageTemplate.count({ where: { metaTemplateId: '700001' } }), 1);
  const unsupported = await byProviderId('700003');
  assert.match(unsupported.supportReason, /HEADER/, 'approved but unsupported templates stay visible with the reason');

  // partial_scan_never_removes
  const partial = await sync([[providerTemplate('700004')], new Error('TIMEOUT')]);
  assert.equal(partial.completed, false);
  assert.equal(partial.unavailable, 0);
  const afterFailedSecondPage = await byProviderId('700001');
  assert.equal(afterFailedSecondPage.archivedAt, null);
  assert.equal(afterFailedSecondPage.metaStatus, 'APPROVED');
  const state = await prisma.whatsappTemplateSyncState.findUnique({ where: { providerAccountId: WABA_A } });
  assert.equal(state.leaseToken, null, 'a failed scan releases the lease');
  assert.ok(state.lastErrorCode);

  // late_poll_cannot_restore_after_rejection
  await prisma.globalMessageTemplate.update({ where: { id: imported.id }, data: { mappingRevision: 1 } });
  const late = await sync([[providerTemplate('700001'), providerTemplate('700003'), providerTemplate('700004')]], {
    onPage: () => prisma.$transaction(tx => applyTemplateEvent(tx, 'message_template_status_update', { event: 'REJECTED', message_template_id: '700001' }, new Date(), WABA_A)),
  });
  assert.ok(late.conflicts >= 1);
  const afterConcurrentWebhook = await byProviderId('700001');
  assert.equal(afterConcurrentWebhook.metaStatus, 'REJECTED');
  assert.ok((await prisma.whatsappTemplateSyncState.findUnique({ where: { providerAccountId: WABA_A } })).syncRequestedAt, 'conflict schedules a re-read');

  // Content change needs a new review; a later APPROVED event does not conclude it.
  const changed = providerTemplate('700001', { components: [{ type: 'BODY', text: 'Texto novo {{1}}.' }] });
  await sync([[changed, providerTemplate('700003'), providerTemplate('700004')]]);
  const revised = await byProviderId('700001');
  assert.equal(revised.providerRevision, 2);
  assert.equal(revised.metaReviewRequired, true);
  assert.ok(revised.policyVersion > afterConcurrentWebhook.policyVersion);
  await prisma.$transaction(tx => applyTemplateEvent(tx, 'message_template_status_update', { event: 'APPROVED', message_template_id: '700001' }, new Date(Date.now() + 1000), WABA_A));
  const afterApprovedEvent = await byProviderId('700001');
  assert.equal(afterApprovedEvent.metaStatus, 'APPROVED');
  assert.equal(afterApprovedEvent.metaReviewRequired, true);

  // Another WABA never touches this template, even with the same provider ID.
  await prisma.$transaction(tx => applyTemplateEvent(tx, 'message_template_status_update', { event: 'DISABLED', message_template_id: '700001' }, new Date(Date.now() + 2000), WABA_B));
  assert.equal((await byProviderId('700001')).metaStatus, 'APPROVED');

  // deleted_template_is_unavailable: only a complete scan concludes absence.
  const complete = await sync([[changed, providerTemplate('700004')]]);
  assert.equal(complete.unavailable, 1);
  const deleted = await byProviderId('700003');
  assert.ok(deleted.archivedAt);
  assert.equal(deleted.metaStatus, 'DELETED');
  assert.ok(await prisma.whatsappTemplateAudit.count({ where: { templateId: deleted.id, action: 'PROVIDER_ABSENT' } }));

  // unknown_event_requests_sync: nothing sendable is created from a partial payload.
  await prisma.whatsappTemplateSyncState.update({ where: { providerAccountId: WABA_A }, data: { syncRequestedAt: null } });
  const review = await prisma.$transaction(tx => applyTemplateEvent(tx, 'message_template_status_update', { event: 'APPROVED', message_template_id: '799999', message_template_name: 'novo', message_template_language: 'pt_BR' }, new Date(), WABA_A));
  assert.equal(review, false);
  assert.equal(await byProviderId('799999'), null);
  assert.ok((await prisma.whatsappTemplateSyncState.findUnique({ where: { providerAccountId: WABA_A } })).syncRequestedAt);
  // The durable request is served by the 10s timer and cleared after a complete scan.
  const service = new TemplateCatalogSyncService(prisma, config, fakeTransport([[changed, providerTemplate('700004'), providerTemplate('799999')]]));
  await service.requested();
  assert.ok(await byProviderId('799999'));
  assert.equal((await prisma.whatsappTemplateSyncState.findUnique({ where: { providerAccountId: WABA_A } })).syncRequestedAt, null);
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
