'use strict';
// Invoked only by communications-postgres.cjs with its freshly owned database. Transport is simulated; nothing leaves the host.
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { OutboundDispatcherService } = require('../src/whatsapp/outbound-dispatcher.service.ts');
const { OutboundIntentService } = require('../src/communications/outbound-intent.service.ts');
const { CommunicationAttributionService } = require('../src/communications/communication-attribution.service.ts');
const { CommunicationTokenService, interactiveTokenHash } = require('../src/communications/communication-token.service.ts');
const { CommunicationsTenantService } = require('../src/communications/communications-tenant.service.ts');
const { CommunicationsService } = require('../src/communications/communications.service.ts');
const { messageRecipient } = require('../src/communications/message-context.ts');
const { DatafyWebhookService } = require('../src/webhooks/datafy-webhook.service.ts');

module.exports = async ({ prisma, crypto, companyA, companyB, adminId, userId }) => {
  const channel = '222';
  const secret = 'whsec_synthetic_tenant';
  const config = new ConfigService({ META_PHONE_NUMBER_ID: channel, META_BUSINESS_ACCOUNT_ID: '111', DATAFY_WEBHOOK_SECRET: secret });
  const tokens = new CommunicationTokenService(new ConfigService({ JWT_SECRET: 'synthetic-harness-jwt-secret-with-32-plus-chars' }));
  const attribution = new CommunicationAttributionService(prisma);
  const intents = new OutboundIntentService(prisma, crypto, attribution);
  const fake = { kind: 'DATAFY', calls: [], behavior: null,
    async sendText(input) { fake.calls.push(input); return fake.behavior ? fake.behavior(input) : { accepted: true, messageId: `wamid.${randomUUID()}`, status: 'accepted' }; },
    async sendTemplate() { throw new Error('templates are not exercised by this harness'); } };
  // Quotas are covered by the stage 4 harness; here they always allow.
  const dispatcher = new OutboundDispatcherService(prisma, config, crypto, intents, fake, { addOutboundIntentJob: async () => undefined },
    { checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }, { reserveDispatchQuota: async () => undefined },
    tokens, { createInvoicePaymentPage: () => ({ token: 'synthetic', url: '' }) });
  const webhook = new DatafyWebhookService(prisma, config, crypto, { enqueue: async () => undefined });
  const tenant = new CommunicationsTenantService(prisma, crypto, tokens);
  const admin = new CommunicationsService(prisma, crypto, {}, {}, config, attribution, tokens);
  const viewerA = { userId, companyId: companyA };
  const viewerB = { userId: randomUUID(), companyId: companyB };

  const phone = '5511976543210', otherPhone = '5511976543299';
  const hash = messageRecipient({ type: 'PHONE', value: phone }).hash;
  const retention = new Date(Date.now() + 365 * 86_400_000);
  for (const [value, recipientHash] of [[phone, hash], [otherPhone, messageRecipient({ type: 'PHONE', value: otherPhone }).hash]])
    await prisma.communicationConversation.create({ data: { channel: 'WHATSAPP', recipientType: 'PHONE', recipientHash, recipientEncrypted: crypto.encrypt(value), retentionExpiresAt: retention, serviceWindowExpiresAt: new Date(Date.now() + 3_600_000) } });
  const conversation = await prisma.communicationConversation.findUnique({ where: { channel_recipientHash: { channel: 'WHATSAPP', recipientHash: hash } } });
  const debtorA = await prisma.debtor.create({ data: { companyId: companyA, name: 'Pagador visto por A', phoneNumber: `+${phone}`, whatsappOptIn: true } });
  const debtorB = await prisma.debtor.create({ data: { companyId: companyB, name: 'Pagador visto por B', phoneNumber: `+${phone}`, whatsappOptIn: true } });
  const invoiceA = await prisma.invoice.create({ data: { companyId: companyA, debtorId: debtorA.id, originalAmount: 100, dueDate: new Date(), status: 'PENDING' } });
  const invoiceB = await prisma.invoice.create({ data: { companyId: companyB, debtorId: debtorB.id, originalAmount: 200, dueDate: new Date(), status: 'PENDING' } });
  const contextA = { companyId: companyA, invoiceId: invoiceA.id, debtorId: debtorA.id };
  const contextB = { companyId: companyB, invoiceId: invoiceB.id, debtorId: debtorB.id };

  const send = async (key, extra, wamid) => {
    fake.behavior = async () => ({ accepted: true, messageId: wamid, status: 'accepted' });
    const reservation = await dispatcher.prepare({ companyId: null, phoneNumber: phone, messageType: 'text', ...extra }, key);
    await dispatcher.dispatch(reservation.id);
    fake.behavior = null;
    return reservation.messageId;
  };
  const inbound = async (id, body, extra = {}, from = phone) => {
    const now = Math.floor(Date.now() / 1000);
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '111', changes: [{ field: 'messages', value: { metadata: { phone_number_id: channel }, messages: [{ id, from, type: 'text', text: { body }, timestamp: String(now), ...extra }] } }] }] }));
    const deliveryId = randomUUID(), timestamp = String(now);
    await webhook.receive(raw, { deliveryId, timestamp, signature: `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}` });
    const delivery = await prisma.communicationWebhookDelivery.findFirst({ where: { deliveryId } });
    await webhook.processDelivery(delivery.id);
    return prisma.communicationMessage.findUnique({ where: { externalMessageId: id } });
  };
  const contents = page => page.items.map(item => item.content).sort();
  const allPages = async (viewer, limit) => {
    const seen = []; let cursor;
    do {
      const page = await tenant.listMessages(viewer, conversation.id, { limit, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    return seen;
  };

  // Fixture from the plan: contact P has outbound A, outbound B, reply citing A, reply citing B, reply without reference.
  const outA = await send('tenant:out-a', { ...contextA, content: 'Cobranca da empresa A' }, 'wamid.tenant.out-a');
  const outB = await send('tenant:out-b', { ...contextB, content: 'Cobranca da empresa B' }, 'wamid.tenant.out-b');
  const replyA = await inbound('wamid.tenant.reply-a', 'Resposta sobre A', { context: { id: 'wamid.tenant.out-a' } });
  const replyB = await inbound('wamid.tenant.reply-b', 'Resposta sobre B', { context: { id: 'wamid.tenant.out-b' } });
  const plain = await inbound('wamid.tenant.plain', 'Mensagem sem referencia');
  assert.deepEqual([replyA.companyId, replyA.attributionMethod, replyA.invoiceId], [companyA, 'REPLY_CONTEXT', invoiceA.id]);
  assert.deepEqual([replyB.companyId, replyB.attributionMethod, replyB.invoiceId], [companyB, 'REPLY_CONTEXT', invoiceB.id]);
  assert.deepEqual([plain.companyId, plain.attributionMethod], [null, 'UNASSIGNED'], 'the phone alone never selects a company');
  const before = await prisma.communicationConversation.findUnique({ where: { id: conversation.id } });

  const pageA = await tenant.listMessages(viewerA, conversation.id, { limit: 25 });
  const pageB = await tenant.listMessages(viewerB, conversation.id, { limit: 25 });
  assert.deepEqual(contents(pageA), ['Cobranca da empresa A', 'Resposta sobre A']);
  assert.deepEqual(contents(pageB), ['Cobranca da empresa B', 'Resposta sobre B']);
  for (const [page, foreign] of [[pageA, /empresa B|sobre B|sem referencia|Pagador visto por B|wamid/], [pageB, /empresa A|sobre A|sem referencia|Pagador visto por A|wamid/]])
    assert.doesNotMatch(JSON.stringify(page), foreign);
  assert.equal(pageA.items.find(item => item.id === replyA.id).replyTo.id, outA);
  assert.equal(pageA.conversation.contact.name, 'Pagador visto por A');
  const adminView = await admin.getAdminConversation(conversation.id, adminId);
  assert.equal(adminView.messages.length, 5, 'admin sees all five messages');
  assert.equal(adminView.messages.find(message => message.id === replyB.id).replyToMessageId, outB);
  const listA = await tenant.listConversations(viewerA, { limit: 25 });
  const itemA = listA.items.find(item => item.id === conversation.id);
  assert.equal(itemA.messageCount, 2);
  assert.match(itemA.lastMessage.preview, /A$/);
  assert.doesNotMatch(JSON.stringify(listA), /empresa B|sobre B|sem referencia|unreadCount|IN_PROGRESS/);
  console.log('PASS fixture A/B: each company sees only its pair, admin sees five, quotes and contact from the projection');

  const { options } = await admin.listContextOptions(conversation.id);
  const optionA = options.find(option => option.debtor?.id === debtorA.id);
  const optionB = options.find(option => option.debtor?.id === debtorB.id);
  assert.deepEqual([optionA?.company.id, optionB?.company.id], [companyA, companyB], 'debtors of both companies with this exact phone are suggested');
  assert.ok(optionA.invoices.some(invoice => invoice.id === invoiceA.id) && !optionA.invoices.some(invoice => invoice.id === invoiceB.id));
  const otherContact = await prisma.communicationConversation.findUnique({ where: { channel_recipientHash: { channel: 'WHATSAPP', recipientHash: messageRecipient({ type: 'PHONE', value: otherPhone }).hash } } });
  const otherOptions = await admin.listContextOptions(otherContact.id);
  assert.ok(!otherOptions.options.some(option => [debtorA.id, debtorB.id].includes(option.debtor?.id)), 'another phone gets no suggestions from this contact');
  console.log('PASS admin context options list same-phone debtors of every company with their invoices');

  // Pagination, cursor binding and ID manipulation.
  const pagedA = await allPages(viewerA, 1);
  assert.deepEqual(pagedA.map(item => item.content).sort(), contents(pageA), 'cursor pages are complete, without duplicates');
  const firstA = await tenant.listMessages(viewerA, conversation.id, { limit: 1 });
  await assert.rejects(tenant.listMessages(viewerB, conversation.id, { limit: 1, cursor: firstA.nextCursor }), error => error.getStatus() === 400);
  await assert.rejects(tenant.listMessages({ ...viewerA, userId: randomUUID() }, conversation.id, { limit: 1, cursor: firstA.nextCursor }), error => error.getStatus() === 400);
  const otherConversation = await prisma.communicationConversation.findUnique({ where: { channel_recipientHash: { channel: 'WHATSAPP', recipientHash: messageRecipient({ type: 'PHONE', value: otherPhone }).hash } } });
  await assert.rejects(tenant.listMessages(viewerA, otherConversation.id, { limit: 1 }), error => error.getStatus() === 404);
  await assert.rejects(tenant.listMessages({ userId, companyId: randomUUID() }, conversation.id, { limit: 25 }), error => error.getStatus() === 404);
  await assert.rejects(tenant.listMessages(viewerA, randomUUID(), { limit: 25 }), error => error.getStatus() === 404);
  const everyConversation = (await tenant.listConversations(viewerA, { limit: 100 })).items;
  assert.ok(everyConversation.length >= 3, 'company A has several conversations from the earlier harness stages');
  const paged = []; let listCursor;
  do {
    const page = await tenant.listConversations(viewerA, { limit: 1, ...(listCursor ? { cursor: listCursor } : {}) });
    paged.push(...page.items); listCursor = page.nextCursor;
  } while (listCursor);
  assert.deepEqual(paged.map(item => item.id), everyConversation.map(item => item.id), 'conversation pages cover every conversation once, in order');
  assert.ok(paged.every((item, index) => index === 0 || paged[index - 1].lastMessageAt >= item.lastMessageAt));
  assert.ok(paged.every(item => item.lastMessageAt instanceof Date && !Number.isNaN(item.lastMessageAt.getTime())));
  const newest = await prisma.communicationMessage.aggregate({ where: { conversationId: conversation.id, companyId: companyA }, _max: { createdAt: true } });
  assert.equal(paged.find(item => item.id === conversation.id).lastMessageAt.toISOString(), newest._max.createdAt.toISOString(), 'no timezone shift in the cursor timestamp');
  const firstList = await tenant.listConversations(viewerA, { limit: 1 });
  await assert.rejects(tenant.listConversations(viewerA, { limit: 1, cursor: firstList.nextCursor ?? tokens.encodeCursor({ route: 'company-conversations', userId, companyId: companyA, filters: { channel: null } }, { at: new Date(), id: conversation.id }), channel: 'EMAIL' }), error => error.getStatus() === 400);
  const after = await prisma.communicationConversation.findUnique({ where: { id: conversation.id } });
  assert.deepEqual([after.status, after.unreadCount, after.lastMessagePreview], [before.status, before.unreadCount, before.lastMessagePreview], 'company reads never change global state');
  console.log('PASS cursor pagination, cursor bound to user/company/filters and 404 for foreign or unknown conversations');

  // Server-issued button reference.
  const token = tokens.interactiveToken(outB, 0);
  await prisma.communicationInteractiveReference.create({ data: { tokenHash: interactiveTokenHash(token), messageId: outB, buttonIndex: 0 } });
  const tapped = await inbound('wamid.tenant.tap', 'Ja paguei', { type: 'button', text: undefined, button: { text: 'Ja paguei', payload: token } });
  assert.deepEqual([tapped.companyId, tapped.attributionMethod, tapped.invoiceId], [companyB, 'INTERACTIVE_CONTEXT', invoiceB.id]);
  const forged = await inbound('wamid.tenant.tap-other', 'Ja paguei', { type: 'button', text: undefined, button: { text: 'Ja paguei', payload: token } }, otherPhone);
  assert.deepEqual([forged.companyId, forged.attributionMethod], [null, 'UNASSIGNED'], 'a reference replayed by another contact is ignored');
  const spoofed = await inbound('wamid.tenant.spoof', 'Ja paguei', { type: 'button', text: undefined, button: { text: 'Ja paguei', payload: JSON.stringify({ companyId: companyA }) } });
  assert.equal(spoofed.companyId, null, 'payload company fields are never trusted');
  console.log('PASS opaque button reference resolves only for its contact; forged payloads stay unassigned');

  // Reply that arrives before the provider ID of its message is committed.
  fake.behavior = async () => {
    const early = await inbound('wamid.tenant.early-reply', 'Resposta antes da confirmacao', { context: { id: 'wamid.tenant.out-a2' } });
    assert.equal(early.companyId, null);
    return { accepted: true, messageId: 'wamid.tenant.out-a2', status: 'accepted' };
  };
  const a2 = await dispatcher.prepare({ ...contextA, phoneNumber: phone, messageType: 'text', content: 'Segunda cobranca A' }, 'tenant:out-a2');
  await dispatcher.dispatch(a2.id);
  fake.behavior = null;
  const early = await prisma.communicationMessage.findUnique({ where: { externalMessageId: 'wamid.tenant.early-reply' } });
  assert.deepEqual([early.companyId, early.attributionMethod], [companyA, 'REPLY_CONTEXT']);
  assert.equal((await prisma.communicationAttributionAudit.findFirst({ where: { messageId: early.id } })).actorType, 'SYSTEM');
  console.log('PASS reply received before acceptance is attributed once the provider ID is committed');

  // Manual attribution: audit, validation, concurrency and dependent replies.
  await assert.rejects(attribution.assignKnownContext({ messageId: plain.id, expectedRevision: 0, expectedCompanyId: null, context: { companyId: companyA, invoiceId: invoiceB.id }, method: 'MANUAL', actor: { type: 'PLATFORM_ADMIN', userId: adminId }, reason: 'errado' }), error => error.getStatus() === 400);
  await assert.rejects(attribution.assignKnownContext({ messageId: plain.id, expectedRevision: 0, expectedCompanyId: null, context: { companyId: companyA }, method: 'MANUAL', actor: { type: 'PLATFORM_ADMIN', userId }, reason: 'usuario comum' }), error => error.getStatus() === 403);
  await assert.rejects(admin.attributeMessage(outA, adminId, { expectedRevision: 0, context: { companyId: companyB }, reason: 'saida validada' }), error => error.getStatus() === 409);
  const race = await Promise.allSettled([
    admin.attributeMessage(plain.id, adminId, { expectedRevision: 0, context: { companyId: companyA, debtorId: debtorA.id }, reason: 'cliente confirmou empresa A' }),
    admin.attributeMessage(plain.id, adminId, { expectedRevision: 0, context: { companyId: companyB }, reason: 'classificacao concorrente' }),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.getStatus(), 409);
  const classified = await prisma.communicationMessage.findUnique({ where: { id: plain.id } });
  assert.equal(classified.attributionRevision, 1);
  const audit = await prisma.communicationAttributionAudit.findFirst({ where: { messageId: plain.id } });
  assert.deepEqual([audit.actorType, audit.actorUserId, audit.method, audit.revision], ['PLATFORM_ADMIN', adminId, 'MANUAL', 1]);
  const dependent = await inbound('wamid.tenant.quote-plain', 'Cita a mensagem classificada', { context: { id: 'wamid.tenant.plain' } });
  assert.equal(dependent.companyId, classified.companyId, 'a reply follows the classified message');
  const pinned = await inbound('wamid.tenant.quote-plain-2', 'Outra citacao', { context: { id: 'wamid.tenant.plain' } });
  await admin.attributeMessage(pinned.id, adminId, { expectedRevision: pinned.attributionRevision, context: { companyId: companyB }, reason: 'decisao manual' });
  await admin.attributeMessage(plain.id, adminId, { expectedRevision: 1, context: { companyId: null }, reason: 'classificacao revertida' });
  assert.deepEqual(await prisma.communicationMessage.findUnique({ where: { id: dependent.id } }).then(message => [message.companyId, message.attributionMethod]), [null, 'UNASSIGNED'], 'dependent reply is re-evaluated');
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: pinned.id } })).companyId, companyB, 'manual dependent is never overwritten');
  const quotedByMany = await inbound('wamid.tenant.quoted-by-many', 'Mensagem citada por muitas respostas');
  await prisma.communicationMessage.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
    conversationId: conversation.id, direction: 'INBOUND', content: `Citacao ${index}`, externalMessageId: `wamid.tenant.batch-${index}`,
    transportChannelId: channel, replyToExternalMessageId: 'wamid.tenant.quoted-by-many', source: 'LIVE', attributionMethod: 'UNASSIGNED', retentionExpiresAt: retention,
  })) });
  await admin.attributeMessage(quotedByMany.id, adminId, { expectedRevision: 0, context: { companyId: companyA }, reason: 'lote de citacoes' });
  assert.equal(await prisma.communicationMessage.count({ where: { replyToExternalMessageId: 'wamid.tenant.quoted-by-many', companyId: companyA, attributionMethod: 'REPLY_CONTEXT' } }), 105, 'every dependent beyond one batch follows');
  await admin.attributeMessage(quotedByMany.id, adminId, { expectedRevision: 1, context: { companyId: null }, reason: 'lote revertido' });
  const pending = await admin.listAdminConversations({ page: 1, pageSize: 50, pendingClassification: true });
  assert.ok(pending.items.some(item => item.id === conversation.id && item.unclassifiedCount >= 2));
  const byCompany = await admin.listAdminConversations({ page: 1, pageSize: 50, companyId: companyB });
  assert.ok(byCompany.items.some(item => item.id === conversation.id));
  console.log('PASS manual attribution: validation, admin-only, 409 on concurrency, audit and dependent re-evaluation');

  // Platform replies: context validated before persistence, visible only to that company, quote preserved.
  const quoted = await dispatcher.enqueue({ ...contextA, phoneNumber: phone, messageType: 'text', content: 'Recebemos seu comprovante', origin: 'ADMIN_REPLY', replyToExternalMessageId: 'wamid.tenant.reply-a' }, 'admin-reply:tenant-1');
  const internal = await dispatcher.enqueue({ companyId: null, phoneNumber: phone, messageType: 'text', content: 'Nota interna ao contato', origin: 'ADMIN_REPLY' }, 'admin-reply:tenant-2');
  await assert.rejects(dispatcher.enqueue({ ...contextA, phoneNumber: phone, messageType: 'text', content: 'Recebemos seu comprovante', origin: 'ADMIN_REPLY', debtorId: debtorB.id }, 'admin-reply:tenant-1'), error => [400, 409].includes(error.getStatus()));
  await assert.rejects(dispatcher.enqueue({ companyId: companyA, invoiceId: invoiceB.id, phoneNumber: phone, messageType: 'text', content: 'Contexto cruzado', origin: 'ADMIN_REPLY' }, 'admin-reply:tenant-3'), error => error.getStatus() === 400);
  assert.equal(await prisma.communicationMessage.count({ where: { content: 'Contexto cruzado' } }), 0, 'invalid context never persists an intent');
  await prisma.invoice.update({ where: { id: invoiceA.id }, data: { status: 'PAID' } });
  const logs = await prisma.collectionLog.count({ where: { invoiceId: invoiceA.id, actionType: 'WHATSAPP_SENT' } });
  for (const message of [quoted, internal]) {
    const intent = await prisma.communicationOutboundIntent.findUnique({ where: { messageId: message.id } });
    await dispatcher.dispatch(intent.id);
  }
  assert.deepEqual(fake.calls.at(-2), { to: phone, text: 'Recebemos seu comprovante', replyTo: 'wamid.tenant.reply-a' }, 'a paid invoice can still be answered by the platform');
  const viewA = await allPages(viewerA, 100), viewB = await allPages(viewerB, 100);
  assert.ok(viewA.some(item => item.content === 'Recebemos seu comprovante' && item.replyTo?.id === replyA.id));
  assert.ok(!viewA.concat(viewB).some(item => item.content === 'Nota interna ao contato'));
  assert.ok(!viewB.some(item => item.content === 'Recebemos seu comprovante'));
  assert.equal(await prisma.collectionLog.count({ where: { invoiceId: invoiceA.id, actionType: 'WHATSAPP_SENT' } }), logs, 'platform replies do not create collection logs');
  console.log('PASS platform replies: context validated before persistence, visible only to that company, internal replies stay admin-only');

  // Attempt series: only a definitive rejection frees a new key; uncertain/accepted keep theirs.
  const series = `efi-onboarding-notice:${companyA}:2026-09-24:abc`;
  const first = await dispatcher.attemptKey(series);
  assert.equal(first, `${series}#0`);
  const attempt0 = await dispatcher.prepare({ companyId: companyA, phoneNumber: phone, messageType: 'text', content: 'Aviso Efi', origin: 'ADMIN_REPLY' }, first);
  assert.equal(await dispatcher.attemptKey(series), first, 'a pending attempt keeps its key');
  await prisma.communicationOutboundIntent.update({ where: { id: attempt0.id }, data: { state: 'FAILED' } });
  const second = await dispatcher.attemptKey(series);
  assert.equal(second, `${series}#1`, 'a definitive rejection frees the next key');
  const attempt1 = await dispatcher.prepare({ companyId: companyA, phoneNumber: phone, messageType: 'text', content: 'Aviso Efi', origin: 'ADMIN_REPLY' }, second);
  await prisma.communicationOutboundIntent.update({ where: { id: attempt1.id }, data: { state: 'UNCERTAIN' } });
  assert.equal(await dispatcher.attemptKey(series), second, 'an uncertain attempt is never replaced');
  assert.equal(await dispatcher.attemptKey(`${series}x`), `${series}x#0`, 'series are isolated by prefix');
  console.log('PASS attempt series renew only after a definitive rejection, never after an uncertain send');
};
