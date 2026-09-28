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

section('preparation: one intent per communication, defaults resolved in the company, holds otherwise', async ({ prisma }) => {
  const fixture = await fx.tenant(prisma, 'Prepare');
  const template = await fx.readyTemplate(prisma);
  const other = await fx.readyTemplate(prisma);
  const sender = fx.preparer(prisma);
  const request = (step = randomUUID()) => ({
    logicalKey: `collection:${fixture.company.id}:${fixture.invoice.id}:${step}:WHATSAPP`, origin: 'COLLECTION',
    context: { companyId: fixture.company.id, invoiceId: fixture.invoice.id, debtorId: fixture.debtor.id },
    selection: { mode: 'DEFAULT', purpose: 'DUE_TODAY' },
  });
  const invoiceBefore = await prisma.invoice.findUnique({ where: { id: fixture.invoice.id } });
  const missing = await sender.prepare(request());
  assert.equal(missing.status, 'BLOCKED');
  assert.equal(missing.code, 'DEFAULT_MISSING');
  assert.deepEqual(await prisma.invoice.findUnique({ where: { id: fixture.invoice.id } }), invoiceBefore, 'the charge itself is untouched');

  const { access } = fx.services(prisma);
  await fx.grant(prisma, fixture.company.id, template.id);
  await fx.grant(prisma, fixture.company.id, other.id);
  await access.setDefault(fixture.company.id, 'DUE_TODAY', template.id, 0, randomUUID());
  const first = request();
  const results = await Promise.all([1, 2, 3].map(() => sender.prepare(first)));
  assert.equal(new Set(results.map(result => result.intentId)).size, 1, 'repeated producers return the same intent');
  const intent = await prisma.communicationOutboundIntent.findUnique({ where: { id: results[0].intentId } });
  assert.equal(intent.logicalKey, first.logicalKey);
  assert.equal(intent.templateSnapshot.templateId, template.id);
  assert.match(intent.templateContextFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(intent.templateContext).includes(fixture.phone), false, 'stored context has identifiers only');

  // A later default applies to new preparations; the prepared message keeps its template.
  await access.setDefault(fixture.company.id, 'DUE_TODAY', other.id, 1, randomUUID());
  assert.equal((await sender.prepare(first)).intentId, intent.id);
  const second = await sender.prepare(request());
  assert.equal((await prisma.communicationOutboundIntent.findUnique({ where: { id: second.intentId } })).templateSnapshot.templateId, other.id);

  // The prepared intent is sent once through the real final authorization.
  const { service, transport } = fx.dispatcher(prisma);
  await service.dispatch(intent.id);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].name, template.metaTemplateName);
  assert.deepEqual(transport.calls[0].components[0].parameters.map(parameter => parameter.text), ['Devedor Prepare', 'R$ 150,00']);
});

section('preparation: activation notices use their own default and renew only after a definitive rejection', async ({ prisma, pool }) => {
  const fixture = await fx.tenant(prisma, 'Activation');
  const activation = await prisma.efiOnboarding.create({ data: { companyId: fixture.company.id, representativeNameEncrypted: fx.crypto.encrypt('Ana Representante'), representativePhoneEncrypted: fx.crypto.encrypt('+55 11 97777-6666'), sensitiveDataExpiresAt: new Date(Date.now() + 86_400_000) } });
  const template = await prisma.globalMessageTemplate.update({ where: { id: (await fx.readyTemplate(prisma)).id }, data: {} });
  const { access, mappings } = fx.services(prisma);
  // Activation mapping: representative and company name, no invoice data.
  const withoutButton = [{ type: 'BODY', text: 'Olá {{1}}, a ativação de {{2}} está pendente.' }];
  const { templateFingerprint } = require('../src/templates/template-components.ts');
  await prisma.globalMessageTemplate.update({ where: { id: template.id }, data: { metaComponents: withoutButton, providerRevision: 2, providerFingerprint: templateFingerprint({ components: withoutButton, parameterFormat: 'POSITIONAL', language: 'pt_BR', category: 'UTILITY' }) } });
  await mappings.save(template.id, 2, 1, { body: { '1': { kind: 'SOURCE', source: 'REPRESENTATIVE_NAME' }, '2': { kind: 'SOURCE', source: 'COMPANY_NAME' } } }, randomUUID());
  await fx.grant(prisma, fixture.company.id, template.id);
  const sender = fx.preparer(prisma);
  const request = { logicalKey: `efi-onboarding-notice:${fixture.company.id}:day`, origin: 'ACTIVATION', context: { companyId: fixture.company.id, activationId: activation.id }, selection: { mode: 'DEFAULT', purpose: 'ACTIVATION_NOTICE' } };
  // A collection default is never reused for activation notices.
  await access.setDefault(fixture.company.id, 'EMISSION', template.id, 0, randomUUID());
  assert.equal((await sender.prepare(request, { renewAfterRejection: true })).code, 'DEFAULT_MISSING');
  await pool.query('DELETE FROM "WhatsappTemplatePendingSend" WHERE "logicalKey" = $1', [request.logicalKey]);
  await access.setDefault(fixture.company.id, 'ACTIVATION_NOTICE', template.id, 0, randomUUID());
  const queued = await sender.prepare(request, { renewAfterRejection: true });
  assert.equal(queued.status, 'QUEUED');
  const payload = JSON.parse(fx.crypto.decrypt((await prisma.communicationOutboundIntent.findUnique({ where: { id: queued.intentId } })).payloadEncrypted));
  assert.deepEqual(payload.bodyParameters, ['Ana Representante', 'Activation']);
  assert.equal(payload.phoneNumber, '5511977776666', 'recipient is the validated representative');
  assert.equal((await sender.prepare(request, { renewAfterRejection: true })).intentId, queued.intentId, 'pending intent is reused');
  await prisma.communicationOutboundIntent.update({ where: { id: queued.intentId }, data: { state: 'FAILED', transmission: 'NOT_SENT' } });
  const renewed = await sender.prepare(request, { renewAfterRejection: true });
  assert.notEqual(renewed.intentId, queued.intentId);
  assert.equal((await prisma.communicationOutboundIntent.findUnique({ where: { id: renewed.intentId } })).generation, 1);
  await prisma.communicationOutboundIntent.update({ where: { id: renewed.intentId }, data: { state: 'UNCERTAIN', transmission: 'UNCERTAIN' } });
  assert.equal((await sender.prepare(request, { renewAfterRejection: true })).intentId, renewed.intentId, 'an uncertain result is never renewed');
});

/** A prepared collection message held at dispatch by a revocation. */
async function heldSend(prisma, label) {
  const fixture = await fx.tenant(prisma, label);
  const template = await fx.readyTemplate(prisma);
  await fx.grant(prisma, fixture.company.id, template.id);
  const prepared = await fx.templateIntent(prisma, { fixture, template });
  await fx.grant(prisma, fixture.company.id, template.id, false);
  const { service } = fx.dispatcher(prisma);
  await assert.rejects(service.dispatch(prepared.id), error => error.code === 'NOT_GRANTED');
  const hold = await prisma.whatsappTemplatePendingSend.findUnique({ where: { logicalKey: prepared.request.logicalKey } });
  return { fixture, template, prepared, hold };
}

section('resume: fixing the template never releases holds by itself; one confirmed successor is sent once', async ({ prisma }) => {
  const { fixture, template, prepared, hold } = await heldSend(prisma, 'Resume');
  const admin = randomUUID();
  await fx.grant(prisma, fixture.company.id, template.id, true);
  const { intents, pending } = fx.services(prisma);
  await pending.reconcileInvalidSnapshots(100);
  assert.equal((await intents.recover()).some(row => row.id === prepared.id), false, 'correction alone releases nothing');
  assert.equal((await prisma.whatsappTemplatePendingSend.findUnique({ where: { id: hold.id } })).state, 'BLOCKED');

  const resume = fx.resumer(prisma);
  const review = await resume.preview([{ pendingId: hold.id }], admin);
  assert.equal(review.items[0].action, 'RESUME');
  assert.match(review.items[0].previewBody, /R\$ 150,00/);
  const stored = await prisma.whatsappTemplateResumeReview.findUnique({ where: { id: review.id } });
  assert.equal(JSON.stringify(stored.items).includes('R$'), false, 'no rendered text persisted in the review');
  assert.equal(JSON.stringify(stored.items).includes(fixture.phone), false);

  const key = randomUUID();
  const concurrentResults = await Promise.all([1, 2, 3].map(() => resume.confirm(review.id, key, admin)));
  assert.equal(new Set(concurrentResults.flatMap(result => result.intentIds)).size, 1, 'one effective authorization and successor');
  const firstResult = concurrentResults[0];
  const repeatedResult = await resume.confirm(review.id, key, admin);
  assert.deepEqual(repeatedResult, firstResult, 'a repeated confirmation returns the persisted result');
  await assert.rejects(resume.confirm(review.id, randomUUID(), admin), error => error.getStatus() === 409);

  const successorId = firstResult.intentIds[0];
  const successor = await prisma.communicationOutboundIntent.findUnique({ where: { id: successorId } });
  assert.equal(successor.state, 'PENDING');
  assert.equal(successor.generation, 1);
  assert.equal(successor.resumeReviewId, review.id);
  assert.equal(await intentState(prisma, prepared.id), 'BLOCKED', 'the original attempt stays as history');
  const resumedHold = await prisma.whatsappTemplatePendingSend.findUnique({ where: { id: hold.id } });
  assert.equal(resumedHold.state, 'RESUMED');
  assert.equal(resumedHold.currentIntentId, successorId);
  assert.equal(await prisma.whatsappTemplateAudit.count({ where: { action: 'PENDING_RESUMED', details: { path: ['pendingId'], equals: hold.id } } }), 1);

  // redis_loss_after_commit_recovers_once: nothing was enqueued; recovery sends it once.
  const { service, transport } = fx.dispatcher(prisma);
  const recovered = (await intents.recover()).filter(row => row.id === successorId);
  assert.equal(recovered.length, 1);
  await service.dispatch(successorId);
  // A repeated job for the accepted successor returns the known result, never a resend.
  await service.dispatch(successorId);
  assert.equal(transport.calls.length, 1);
  const datafySendCallsAfterRecovery = transport.calls.length;
  assert.equal((await intents.recover()).some(row => row.id === successorId), false);
  assert.equal(datafySendCallsAfterRecovery, 1);
  // Producers see the resumed communication, not a new generation 0.
  const again = await fx.preparer(prisma).prepare(prepared.request);
  assert.deepEqual(again, { status: 'QUEUED', intentId: successorId });
});

section('resume: paid invoices close without sending; uncertain results are never resumable', async ({ prisma, pool }) => {
  const admin = randomUUID();
  const paid = await heldSend(prisma, 'Paid');
  await fx.grant(prisma, paid.fixture.company.id, paid.template.id, true);
  await prisma.invoice.update({ where: { id: paid.fixture.invoice.id }, data: { status: 'PAID' } });
  const resume = fx.resumer(prisma);
  const review = await resume.preview([{ pendingId: paid.hold.id }], admin);
  assert.deepEqual([review.items[0].action, review.items[0].reason, review.items[0].previewBody], ['CLOSE', 'INVOICE_NOT_PENDING', null]);
  const result = await resume.confirm(review.id, randomUUID(), admin);
  assert.deepEqual(result.intentIds, []);
  assert.deepEqual(result.closedPendingIds, [paid.hold.id]);
  assert.equal((await prisma.whatsappTemplatePendingSend.findUnique({ where: { id: paid.hold.id } })).closedReason, 'INVOICE_NOT_PENDING');

  const uncertain = await heldSend(prisma, 'Uncertain resume');
  await fx.grant(prisma, uncertain.fixture.company.id, uncertain.template.id, true);
  // A later generation of the same communication ended with an unknown provider result.
  await pool.query('UPDATE "CommunicationOutboundIntent" SET "state"=\'UNCERTAIN\', "transmission"=\'UNCERTAIN\' WHERE "id"=$1', [uncertain.prepared.id]);
  const uncertainReview = await resume.preview([{ pendingId: uncertain.hold.id }], admin);
  assert.deepEqual([uncertainReview.items[0].action, uncertainReview.items[0].reason], ['KEEP_BLOCKED', 'TRANSMISSION_UNKNOWN']);
  const kept = await resume.confirm(uncertainReview.id, randomUUID(), admin);
  assert.deepEqual(kept.intentIds, []);
  const acceptedOrUncertainSuccessors = await prisma.communicationOutboundIntent.findMany({ where: { logicalKey: uncertain.prepared.request.logicalKey, generation: { gt: 0 } } });
  assert.equal(acceptedOrUncertainSuccessors.length, 0);
});

section('resume: a change since the preview (mapping, grant, hold) requires a new review, without partial effects', async ({ prisma }) => {
  const admin = randomUUID();
  const first = await heldSend(prisma, 'Stale A');
  const second = await heldSend(prisma, 'Stale B');
  for (const held of [first, second]) await fx.grant(prisma, held.fixture.company.id, held.template.id, true);
  const resume = fx.resumer(prisma);
  const review = await resume.preview([{ pendingId: first.hold.id }, { pendingId: second.hold.id }], admin);
  assert.deepEqual(review.items.map(item => item.action), ['RESUME', 'RESUME']);
  // changed_mapping_requires_new_preview: the second template gets a new mapping revision.
  const template = await prisma.globalMessageTemplate.findUnique({ where: { id: second.template.id } });
  await fx.services(prisma).mappings.save(template.id, template.providerRevision, template.mappingRevision, fx.MAPPING, admin);
  await assert.rejects(resume.confirm(review.id, randomUUID(), admin), error => error.getStatus() === 409 && error.getResponse().code === 'VERSION_CHANGED');
  for (const held of [first, second]) {
    const hold = await prisma.whatsappTemplatePendingSend.findUnique({ where: { id: held.hold.id } });
    assert.equal(hold.state, 'BLOCKED', 'no partial effect');
    assert.equal(hold.version, held.hold.version);
  }
  assert.equal(await prisma.communicationOutboundIntent.count({ where: { resumeReviewId: review.id } }), 0);
  // A replacement must be granted to the same company.
  const foreign = await fx.readyTemplate(prisma);
  const replacement = await resume.preview([{ pendingId: first.hold.id, replacementTemplateId: foreign.id }], admin);
  assert.deepEqual([replacement.items[0].action, replacement.items[0].reason], ['KEEP_BLOCKED', 'NOT_GRANTED']);
  // An expired preview cannot be confirmed.
  const fresh = await resume.preview([{ pendingId: first.hold.id }], admin);
  await prisma.whatsappTemplateResumeReview.update({ where: { id: fresh.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(resume.confirm(fresh.id, randomUUID(), admin), error => error.getResponse().code === 'REVIEW_EXPIRED');
  await assert.rejects(resume.preview(Array.from({ length: 51 }, () => ({ pendingId: randomUUID() })), admin), error => error.getStatus() === 400);
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
