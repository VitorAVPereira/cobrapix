'use strict';
// Invoked only by communications-postgres.cjs with its freshly owned database.
const assert = require('node:assert/strict');
const { createHmac, randomUUID, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { ConfigService } = require('@nestjs/config');
const { Queue } = require('bullmq');
const { DatafyWebhookService } = require('../src/webhooks/datafy-webhook.service.ts');
const { DatafyWebhookQueue, DATAFY_WEBHOOK_QUEUE, datafyRedisConnection } = require('../src/queue/datafy-webhook.queue.ts');
const { DatafyWebhookWorker } = require('../src/queue/workers/datafy-webhook.worker.ts');
const { messageRecipient } = require('../src/communications/message-context.ts');

module.exports = async ({ prisma, pool, crypto, companyA, companyB, adminId, userId }) => {
  const secret = 'whsec_synthetic_test';
  const config = new ConfigService({ DATAFY_WEBHOOK_SECRET: secret, META_BUSINESS_ACCOUNT_ID: '111', META_PHONE_NUMBER_ID: '222' });
  const failedQueue = { enqueue: async () => { throw new Error('synthetic offline Redis'); } };
  const service = new DatafyWebhookService(prisma, config, crypto, failedQueue);
  const base = Math.floor(Date.now() / 1000) - 10;
  const phone = '5511987654321';
  const wrap = changes => ({ object: 'whatsapp_business_account', entry: [{ id: '111', changes }] });
  const messages = items => ({ field: 'messages', value: { metadata: { phone_number_id: '222' }, messages: items } });
  const message = (id, timestamp = base, body = 'Olá') => ({ id, from: phone, type: 'text', text: { body }, timestamp: String(timestamp) });
  const status = (id, state, timestamp, recipient = phone) => ({ field: 'messages', value: { metadata: { phone_number_id: '222' }, statuses: [{ id, status: state, timestamp: String(timestamp), recipient_id: recipient, ...(state === 'failed' ? { errors: [{ code: 131047, message: 'private provider text' }] } : {}) }] } });
  const headers = (raw, deliveryId = randomUUID()) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return { deliveryId, timestamp, signature: `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}` };
  };
  async function receive(changes, deliveryId = randomUUID()) {
    const raw = Buffer.from(JSON.stringify(wrap(changes)));
    const result = await service.receive(raw, headers(raw, deliveryId));
    assert.deepEqual(result, { received: true });
    const row = await prisma.communicationWebhookDelivery.findUnique({ where: { transport_transportChannelId_deliveryId: { transport: 'DATAFY', transportChannelId: '222', deliveryId } } });
    assert.ok(row.payloadEncrypted && !row.payloadEncrypted.includes('Olá'));
    return row;
  }
  const first = await receive([messages([message('wamid.live.1'), message('wamid.live.2', base - 3600)])]);
  assert.equal(first.state, 'PENDING', 'commit before failed enqueue is durable');
  const duplicate = await receive([messages([message('wamid.live.1'), message('wamid.live.2', base - 3600)])], first.deliveryId);
  assert.equal(duplicate.id, first.id);
  const secondDelivery = await receive([messages([message('wamid.live.1'), message('wamid.live.2', base - 3600)])]);
  await Promise.all([service.processDelivery(first.id), service.processDelivery(first.id), service.processDelivery(secondDelivery.id)]);
  const conversation = await prisma.communicationConversation.findUnique({ where: { channel_recipientHash: { channel: 'WHATSAPP', recipientHash: messageRecipient({ type: 'PHONE', value: phone }).hash } } });
  assert.equal(conversation.unreadCount, 2);
  assert.equal(conversation.lastInboundAt.getTime(), base * 1000);
  assert.equal(conversation.serviceWindowExpiresAt.getTime(), (base + 86400) * 1000);
  assert.equal(await prisma.communicationMessage.count({ where: { conversationId: conversation.id } }), 2);
  assert.equal(await prisma.communicationMessage.count({ where: { conversationId: conversation.id, companyId: { not: null } } }), 0);
  assert.equal((await prisma.communicationWebhookDelivery.findUnique({ where: { id: first.id } })).state, 'PROCESSED');
  // A provider retry arrives under a new delivery id: dedup is by message id, not delivery.
  const redelivered = await receive([messages([message('wamid.live.1')])]);
  await service.processDelivery(redelivered.id);
  assert.equal((await prisma.communicationConversation.findUnique({ where: { id: conversation.id } })).unreadCount, 2, 'redelivered message does not duplicate the live effect');
  const changed = Buffer.from(JSON.stringify(wrap([messages([message('wamid.changed')])])));
  await assert.rejects(service.receive(changed, headers(changed, first.deliveryId)), error => error.getStatus() === 409);
  console.log('PASS Datafy commit-before-ack, duplicate deliveries/messages, concurrent claims and live window ordering');

  const mixed = await receive([messages([{ ...message('wamid.media'), type: 'document', document: { id: '1234', mime_type: 'application/pdf', caption: 'Comprovante', url: 'https://private.invalid' } }]),
    { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'test' } },
    { field: 'history', value: { metadata: { phone_number_id: '222' }, history: [{ threads: [{ messages: [message('wamid.history', base - 86400)] }] }] } },
    { field: 'user_id_update', value: {} }, { field: 'future_event', value: {} }]);
  await service.processDelivery(mixed.id);
  assert.equal((await prisma.communicationWebhookDelivery.findUnique({ where: { id: mixed.id } })).reviewRequired, true);
  assert.equal(await prisma.communicationMessage.count({ where: { externalMessageId: 'wamid.history' } }), 0);
  assert.equal((await prisma.communicationConversation.findUnique({ where: { id: conversation.id } })).unreadCount, 3);
  const media = await prisma.communicationMessage.findUnique({ where: { externalMessageId: 'wamid.media' }, include: { attachments: true } });
  assert.equal(media.attachments.length, 1); assert.equal(media.attachments[0].state, 'PENDING');
  assert.equal(media.attachments[0].retentionExpiresAt.getTime(), media.retentionExpiresAt.getTime());
  assert.equal(media.attachments[0].storageKey, null);
  console.log('PASS mixed batches, template without phone metadata, history/identity triage and private attachment metadata');

  const early = await receive([status('wamid.outgoing', 'read', base + 3)]);
  await service.processDelivery(early.id);
  assert.equal((await prisma.communicationMessageStatusEvent.findFirst({ where: { externalMessageId: 'wamid.outgoing' } })).appliedAt, null);
  const outbound = await prisma.communicationMessage.create({ data: { conversationId: conversation.id, companyId: companyA, direction: 'OUTBOUND', content: 'Synthetic outbound, never transmitted', externalMessageId: 'wamid.outgoing', transportChannelId: '222', retentionExpiresAt: conversation.retentionExpiresAt, status: 'sent' } });
  await prisma.communicationMessageStatusEvent.updateMany({ where: { externalMessageId: 'wamid.outgoing' }, data: { nextAttemptAt: new Date(0) } });
  await service.reconcileStatuses();
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: outbound.id } })).status, 'read');
  const late = await receive([status('wamid.outgoing', 'sent', base + 1)]);
  await service.processDelivery(late.id);
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: outbound.id } })).status, 'read', 'late sent event cannot regress read status');
  const delayed = await receive([status('wamid.outgoing', 'sent', base + 1), status('wamid.outgoing', 'failed', base + 4)]);
  await service.processDelivery(delayed.id);
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: outbound.id } })).status, 'read');
  assert.deepEqual((await prisma.communicationMessageStatusEvent.findFirst({ where: { externalMessageId: 'wamid.outgoing', status: 'failed' } })).errorCodes, ['131047']);
  const wrongRecipient = await receive([status('wamid.outgoing', 'delivered', base + 5, '5511999999988')]);
  await service.processDelivery(wrongRecipient.id);
  assert.equal((await prisma.communicationWebhookDelivery.findUnique({ where: { id: wrongRecipient.id } })).reviewRequired, true);
  console.log('PASS durable early statuses, chronological reconciliation, no read regression, sanitized failures and recipient binding');

  const unresolved = await receive([status('wamid.context-eventually-available', 'delivered', base + 2)]);
  await service.processDelivery(unresolved.id);
  await prisma.communicationMessageStatusEvent.updateMany({ where: { externalMessageId: 'wamid.context-eventually-available' }, data: { retentionExpiresAt: new Date(0), nextAttemptAt: new Date(0) } });
  await service.reconcileStatuses();
  assert.equal((await prisma.communicationMessageStatusEvent.findFirst({ where: { externalMessageId: 'wamid.context-eventually-available' } })).resolutionCode, 'CONTEXT_NOT_FOUND');
  const laterOutbound = await prisma.communicationMessage.create({ data: { conversationId: conversation.id, companyId: companyB, direction: 'OUTBOUND', content: 'Recovered send reference', externalMessageId: 'wamid.context-eventually-available', transportChannelId: '222', retentionExpiresAt: conversation.retentionExpiresAt } });
  await service.replayForAdmin(unresolved.id, adminId);
  await service.processDelivery(unresolved.id);
  assert.equal((await prisma.communicationMessage.findUnique({ where: { id: laterOutbound.id } })).status, 'delivered', 'explicit replay reconciles context that became available after triage');
  assert.equal(await prisma.communicationMessageStatusEvent.count({ where: { externalMessageId: 'wamid.context-eventually-available' } }), 1);

  // A failed effect rolls back message and counter, then consumes five local attempts.
  const poison = await receive([messages([message('wamid.rollback', base, 'force-rollback')])]);
  await pool.query(`ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "test_datafy_failure" CHECK ("content" <> 'force-rollback')`);
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await prisma.communicationWebhookDelivery.update({ where: { id: poison.id }, data: { nextAttemptAt: new Date(0) } });
      if (attempt < 5) await assert.rejects(service.processDelivery(poison.id), /DATAFY_PROCESSING_RETRY/);
      else await service.processDelivery(poison.id);
    }
    const failed = await prisma.communicationWebhookDelivery.findUnique({ where: { id: poison.id } });
    assert.equal(failed.state, 'FAILED'); assert.equal(failed.attempts, 5);
    assert.equal(await prisma.communicationMessage.count({ where: { externalMessageId: 'wamid.rollback' } }), 0);
    assert.equal((await prisma.communicationConversation.findUnique({ where: { id: conversation.id } })).unreadCount, 3);
    await assert.rejects(service.replayForAdmin(poison.id, userId), error => error.getStatus() === 403);
  } finally { await pool.query('ALTER TABLE "CommunicationMessage" DROP CONSTRAINT "test_datafy_failure"'); }
  await service.replayForAdmin(poison.id, adminId);
  await service.processDelivery(poison.id);
  const replayed = await prisma.communicationWebhookDelivery.findUnique({ where: { id: poison.id } });
  assert.equal(replayed.state, 'PROCESSED'); assert.equal(replayed.replayCount, 1);
  assert.equal(replayed.reviewRequired, false, 'successful replay clears resolved processing failure');
  const adminList = await service.listForAdmin(adminId);
  assert.ok(!JSON.stringify(adminList).includes('payloadEncrypted'));
  assert.ok(!JSON.stringify(adminList).includes('private provider text'));
  const firstAdminPage = await service.listForAdmin(adminId, { limit: 1 });
  assert.equal(firstAdminPage.items.length, 1); assert.ok(firstAdminPage.nextCursor);
  const secondAdminPage = await service.listForAdmin(adminId, { limit: 1, cursor: firstAdminPage.nextCursor });
  assert.equal(secondAdminPage.items.length, 1);
  assert.notEqual(firstAdminPage.items[0].id, secondAdminPage.items[0].id, 'all triage entries remain reachable through pagination');
  console.log('PASS atomic rollback, five local attempts, safe admin triage and replay without removing deduplication');

  const optOut = await receive([messages([message('wamid.stop', base, 'SAIR')])]);
  await service.processDelivery(optOut.id);
  const { assertRecipientNotSuppressed } = require('../src/communications/recipient-suppression.ts');
  await assert.rejects(assertRecipientNotSuppressed(prisma, phone), error => error.getStatus() === 409);
  assert.equal((await prisma.communicationMessage.findUnique({ where: { externalMessageId: 'wamid.stop' } })).companyId, null);
  const beforeCleanup = await prisma.communicationWebhookDelivery.findUnique({ where: { id: first.id } });
  await prisma.communicationWebhookDelivery.update({ where: { id: first.id }, data: { retentionExpiresAt: new Date(0) } });
  await service.purgeProcessedPayloads();
  const purged = await prisma.communicationWebhookDelivery.findUnique({ where: { id: first.id } });
  assert.equal(purged.payloadEncrypted, null); assert.equal(purged.bodyHash, beforeCleanup.bodyHash);
  assert.ok((await prisma.communicationWebhookDelivery.findUnique({ where: { id: mixed.id } })).payloadEncrypted);
  console.log('PASS global opt-out suppression, no tenant inference and purge preserving deduplication/triage');

  for (const [kind, contact] of [['expired', '5511876543210'], ['legacy', '5511876543211'], ['anonymized', '5511876543212']]) {
    const contactIdentity = messageRecipient({ type: 'PHONE', value: contact });
    const prior = await prisma.communicationConversation.create({ data: { channel: 'WHATSAPP', recipientHash: contactIdentity.hash, recipientType: 'PHONE', recipientEncrypted: kind === 'anonymized' ? null : crypto.encrypt(contact), recipientAnonymizedAt: kind === 'anonymized' ? new Date() : null, retentionExpiresAt: kind === 'expired' ? new Date(0) : new Date(Date.now() + 86400000) } });
    if (kind === 'legacy') await prisma.communicationMessage.create({ data: { conversationId: prior.id, direction: 'INBOUND', content: 'SAIR', externalMessageId: `wamid.stop.${kind}`, retentionExpiresAt: prior.retentionExpiresAt } });
    const cancellation = await receive([messages([{ ...message(`wamid.stop.${kind}`, base, 'SAIR'), from: contact }])]);
    await service.processDelivery(cancellation.id);
    await assert.rejects(assertRecipientNotSuppressed(prisma, contact), error => error.getStatus() === 409, `opt-out blocks ${kind} contact independently of history retention/deduplication`);
    assert.equal((await prisma.communicationConversation.findUnique({ where: { id: prior.id } })).unreadCount, 0);
  }
  console.log('PASS opt-out survives expired/anonymized conversation and legacy duplicate message');

  // Real Redis recovery: discard its state, recover from PostgreSQL, run the real worker.
  const runId = randomBytes(8).toString('hex'), name = `ciframais-datafy-redis-${runId}`;
  const host = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
  const docker = args => {
    const result = spawnSync('docker', ['--host', host, ...args], { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`Local Redis Docker ${args[0]} failed`);
    return result.stdout.trim();
  };
  let started = false, queue, worker;
  const waitUntil = async condition => {
    for (let i = 0; i < 150; i++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Local Datafy worker recovery timed out');
  };
  try {
    docker(['run', '-d', '--name', name, '--label', `ciframais.datafy-test=${runId}`, '--memory', '128m', '-p', '127.0.0.1::6379', 'redis:7-alpine']); started = true;
    const binding = docker(['port', name, '6379/tcp']); assert.match(binding, /^127\.0\.0\.1:\d+$/);
    const redisConfig = new ConfigService({ REDIS_HOST: '127.0.0.1', REDIS_PORT: Number(binding.split(':').at(-1)) });
    queue = new Queue(DATAFY_WEBHOOK_QUEUE, { connection: datafyRedisConnection(redisConfig) });
    await queue.waitUntilReady();
    const queueService = new DatafyWebhookQueue(queue);
    const recovering = new DatafyWebhookService(prisma, config, crypto, queueService);
    const waiting = await receive([messages([message('wamid.recovered')])]);
    await prisma.communicationWebhookDelivery.update({ where: { id: waiting.id }, data: { state: 'PROCESSING', leaseToken: randomUUID(), leaseExpiresAt: new Date(0), attempts: 1 } });
    const client = await queue.client; await client.flushdb(); // owned, fresh, isolated DB 0 only
    await recovering.recover();
    const replayWaiting = await receive([messages([message('wamid.replayed-with-retained-job')])]);
    await queueService.enqueue(replayWaiting.id, 0);
    await prisma.communicationWebhookDelivery.update({ where: { id: replayWaiting.id }, data: { state: 'FAILED', attempts: 5 } });
    await recovering.replayForAdmin(replayWaiting.id, adminId);
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    assert.ok(jobs.some(job => job.data.deliveryId === waiting.id));
    assert.ok(jobs.every(job => Object.keys(job.data).join() === 'deliveryId'));
    assert.equal(jobs.filter(job => job.data.deliveryId === replayWaiting.id).length, 2, 'replay is not swallowed by an existing job from its previous generation');
    worker = new DatafyWebhookWorker(redisConfig, recovering); worker.onModuleInit();
    await waitUntil(async () => (await prisma.communicationWebhookDelivery.findUnique({ where: { id: waiting.id } })).state === 'PROCESSED');
    assert.equal(await prisma.communicationMessage.count({ where: { externalMessageId: 'wamid.recovered' } }), 1);
    await waitUntil(async () => (await prisma.communicationWebhookDelivery.findUnique({ where: { id: replayWaiting.id } })).state === 'PROCESSED');
    assert.equal(await prisma.communicationMessage.count({ where: { externalMessageId: 'wamid.replayed-with-retained-job' } }), 1);
    console.log('PASS real Redis loss, expired lease recovery, small jobs and worker restart');
  } finally {
    if (worker) await worker.onModuleDestroy();
    if (queue) await queue.close();
    if (started) {
      assert.equal(docker(['inspect', '--format', '{{ index .Config.Labels "ciframais.datafy-test" }}', name]), runId);
      docker(['rm', '-f', '-v', name]);
    }
  }
};
