'use strict';
// Invoked only by communications-postgres.cjs with its freshly owned database. Transport is simulated; nothing leaves the host.
const assert = require('node:assert/strict');
const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { ConfigService } = require('@nestjs/config');
const Redis = require('ioredis');
const { OutboundDispatcherService } = require('../src/whatsapp/outbound-dispatcher.service.ts');
const { OutboundIntentService } = require('../src/communications/outbound-intent.service.ts');
const { CommunicationAttributionService } = require('../src/communications/communication-attribution.service.ts');
const { messageRecipient } = require('../src/communications/message-context.ts');
const { RateLimitService } = require('../src/queue/services/rate-limit.service.ts');
const { MessagingLimitService } = require('../src/queue/services/messaging-limit.service.ts');
const { DatafyRateLimitService } = require('../src/whatsapp/transport/datafy-rate-limit.service.ts');
const { WhatsappTransportError } = require('../src/whatsapp/transport/whatsapp-transport.error.ts');
const { DatafyWebhookService } = require('../src/webhooks/datafy-webhook.service.ts');
const { CommunicationTokenService } = require('../src/communications/communication-token.service.ts');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async ({ prisma, crypto, companyA, companyB }) => {
  const runId = randomBytes(8).toString('hex'), name = `ciframais-dispatch-redis-${runId}`;
  const host = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
  const docker = args => {
    const result = spawnSync('docker', ['--host', host, ...args], { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`Local Redis Docker ${args[0]} failed`);
    return result.stdout.trim();
  };
  let started = false;
  const owned = [];
  try {
    docker(['run', '-d', '--name', name, '--label', `ciframais.dispatch-test=${runId}`, '--memory', '128m', '-p', '127.0.0.1::6379', 'redis:7-alpine']); started = true;
    const binding = docker(['port', name, '6379/tcp']); assert.match(binding, /^127\.0\.0\.1:\d+$/);
    const redisPort = Number(binding.split(':').at(-1));
    const probe = new Redis({ host: '127.0.0.1', port: redisPort, lazyConnect: true }); owned.push(probe);
    for (let i = 0; i < 30; i++) { try { await probe.connect(); break; } catch { await sleep(200); } }
    assert.equal(await probe.ping(), 'PONG');

    const retention = new Date(Date.now() + 365 * 86_400_000);
    const phoneOf = n => `55119${String(70_000_000 + n).padStart(8, '0')}`;
    let phoneSeq = 0;
    const nextPhone = () => phoneOf(++phoneSeq);
    const openWindow = async (phone, open = true) => {
      const recipient = messageRecipient({ type: 'PHONE', value: phone });
      const serviceWindowExpiresAt = open ? new Date(Date.now() + 3_600_000) : new Date(Date.now() - 1000);
      await prisma.communicationConversation.upsert({
        where: { channel_recipientHash: { channel: 'WHATSAPP', recipientHash: recipient.hash } },
        create: { channel: 'WHATSAPP', recipientType: 'PHONE', recipientHash: recipient.hash, recipientEncrypted: crypto.encrypt(recipient.value), retentionExpiresAt: retention, serviceWindowExpiresAt },
        update: { serviceWindowExpiresAt },
      });
    };
    const transport = () => {
      const fake = { kind: 'DATAFY', calls: [], behavior: null,
        async sendText(input) { fake.calls.push(input); return fake.behavior ? fake.behavior(input) : { accepted: true, messageId: `wamid.${randomUUID()}`, status: 'accepted' }; },
        async sendTemplate() { throw new Error('templates are not exercised by this harness'); } };
      return fake;
    };
    const build = ({ channel = '222', port = redisPort } = {}) => {
      const config = new ConfigService({ META_PHONE_NUMBER_ID: channel, REDIS_HOST: '127.0.0.1', REDIS_PORT: port });
      const fake = transport();
      const rates = new RateLimitService(config);
      const messaging = new MessagingLimitService(config, prisma, fake);
      owned.push(rates, messaging);
      const intents = new OutboundIntentService(prisma, crypto, new CommunicationAttributionService(prisma));
      const tokens = new CommunicationTokenService(new ConfigService({ JWT_SECRET: 'synthetic-harness-jwt-secret-with-32-plus-chars' }));
      const dispatcher = new OutboundDispatcherService(prisma, config, crypto, intents, fake, { addOutboundIntentJob: async () => undefined }, rates, messaging, tokens, { createInvoicePaymentPage: () => ({ token: 'synthetic', url: '' }) });
      return { dispatcher, intents, fake };
    };
    const text = (phone, extra = {}) => ({ companyId: null, phoneNumber: phone, content: 'Resposta sintetica', messageType: 'text', ...extra });
    const intentOf = id => prisma.communicationOutboundIntent.findUnique({ where: { id } });
    const messageOf = id => prisma.communicationMessage.findUnique({ where: { id } });

    // 1. Concurrent jobs for one intent transmit once.
    {
      const { dispatcher, fake } = build();
      const phone = nextPhone(); await openWindow(phone);
      const reservation = await dispatcher.prepare(text(phone), `harness:concurrent:${runId}`);
      fake.behavior = async () => { await sleep(150); return { accepted: true, messageId: `wamid.concurrent.${runId}`, status: 'accepted' }; };
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => dispatcher.dispatch(reservation.id)));
      assert.equal(fake.calls.length, 1, 'six concurrent jobs produce one transmission');
      assert.ok(results.filter(result => result.status === 'fulfilled').every(result => result.value.messageId === `wamid.concurrent.${runId}`));
      assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.getStatus?.() === 409));
      assert.equal((await intentOf(reservation.id)).state, 'ACCEPTED');
      const message = await messageOf(reservation.messageId);
      assert.equal(message.externalMessageId, `wamid.concurrent.${runId}`); assert.equal(message.status, 'accepted');
      assert.deepEqual(await dispatcher.dispatch(reservation.id), { accepted: true, messageId: `wamid.concurrent.${runId}`, status: 'accepted' });
      assert.equal((await dispatcher.prepare(text(phone), `harness:concurrent:${runId}`)).state, 'ACCEPTED', 'same key never creates a second intent');
      await assert.rejects(dispatcher.prepare(text(phone, { content: 'outro texto' }), `harness:concurrent:${runId}`), error => error.getStatus() === 409);
      assert.equal(fake.calls.length, 1);
      console.log('PASS concurrent jobs claim one intent, transmit once and reuse the accepted result');
    }

    // 2. Timeout after transmission and local failure after provider acceptance are uncertain, never resent.
    {
      const { dispatcher, intents, fake } = build();
      const phone = nextPhone(); await openWindow(phone);
      const timeout = await dispatcher.prepare(text(phone), `harness:timeout:${runId}`);
      fake.behavior = async () => { throw new WhatsappTransportError('timeout', 'UNCERTAIN', 'UNCERTAIN'); };
      await assert.rejects(dispatcher.dispatch(timeout.id), error => error.kind === 'UNCERTAIN');
      assert.equal((await intentOf(timeout.id)).state, 'UNCERTAIN');
      assert.equal((await messageOf(timeout.messageId)).status, 'delivery_uncertain');
      assert.equal((await dispatcher.prepare(text(phone), `harness:timeout:${runId}`)).state, 'UNCERTAIN');
      await assert.rejects(dispatcher.dispatch(timeout.id), error => error.getStatus() === 409);

      // Accepted by the provider, but the external ID collides locally: the acceptance commit can never succeed.
      const accepted = await dispatcher.prepare(text(phone, { content: 'Aceita externamente' }), `harness:after-accept:${runId}`);
      fake.behavior = async () => ({ accepted: true, messageId: `wamid.concurrent.${runId}`, status: 'accepted' });
      await assert.rejects(dispatcher.dispatch(accepted.id), error => error.kind === 'UNCERTAIN');
      const afterAccept = await intentOf(accepted.id);
      assert.equal(afterAccept.state, 'UNCERTAIN'); assert.equal(afterAccept.externalMessageId, null);
      assert.equal((await messageOf(accepted.messageId)).status, 'delivery_uncertain');
      await assert.rejects(dispatcher.dispatch(accepted.id), error => error.getStatus() === 409);

      // Lease expired mid-transmission: recovery marks it uncertain, then the late provider acceptance is still recorded.
      const lost = await dispatcher.prepare(text(phone, { content: 'Worker lento' }), `harness:lost:${runId}`);
      fake.behavior = async () => {
        await prisma.communicationOutboundIntent.update({ where: { id: lost.id }, data: { leaseExpiresAt: new Date(0) } });
        await intents.recover();
        assert.equal((await intentOf(lost.id)).state, 'UNCERTAIN');
        return { accepted: true, messageId: `wamid.lost.${runId}`, status: 'accepted' };
      };
      await dispatcher.dispatch(lost.id);
      const lostIntent = await intentOf(lost.id);
      assert.equal(lostIntent.state, 'ACCEPTED'); assert.equal(lostIntent.externalMessageId, `wamid.lost.${runId}`);
      assert.deepEqual(await messageOf(lost.messageId).then(message => [message.status, message.externalMessageId]), ['accepted', `wamid.lost.${runId}`]);
      const pending = await intents.recover();
      assert.ok(![timeout.id, accepted.id, lost.id].some(id => pending.some(item => item.id === id)), 'recovery never lists uncertain intents');
      assert.equal(fake.calls.length, 3, 'each intent was transmitted at most once');
      console.log('PASS timeout and local failure after acceptance stay uncertain; a late acceptance after lease loss is kept, never resent');
    }

    // 3. Provider status arrives before the HTTP response is committed.
    {
      const { dispatcher, fake } = build();
      const secret = 'whsec_synthetic_dispatch';
      const webhook = new DatafyWebhookService(prisma, new ConfigService({ DATAFY_WEBHOOK_SECRET: secret, META_BUSINESS_ACCOUNT_ID: '111', META_PHONE_NUMBER_ID: '222' }), crypto, { enqueue: async () => undefined });
      const phone = nextPhone(); await openWindow(phone);
      const reservation = await dispatcher.prepare(text(phone), `harness:early-status:${runId}`);
      const wamid = `wamid.early.${runId}`;
      fake.behavior = async () => {
        const now = Math.floor(Date.now() / 1000);
        const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '111', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '222' }, statuses: [{ id: wamid, status: 'delivered', timestamp: String(now), recipient_id: phone }] } }] }] }));
        const deliveryId = randomUUID(), timestamp = String(now);
        await webhook.receive(raw, { deliveryId, timestamp, signature: `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}` });
        const delivery = await prisma.communicationWebhookDelivery.findFirst({ where: { deliveryId } });
        await webhook.processDelivery(delivery.id);
        return { accepted: true, messageId: wamid, status: 'accepted' };
      };
      await dispatcher.dispatch(reservation.id);
      const early = await prisma.communicationMessageStatusEvent.findFirst({ where: { externalMessageId: wamid } });
      assert.equal(early.appliedAt, null, 'status before the send reference stays pending, not lost');
      assert.equal((await messageOf(reservation.messageId)).status, 'accepted');
      await prisma.communicationMessageStatusEvent.update({ where: { id: early.id }, data: { nextAttemptAt: new Date(0) } });
      await webhook.reconcileStatuses();
      assert.equal((await messageOf(reservation.messageId)).status, 'delivered');
      assert.equal((await intentOf(reservation.id)).state, 'ACCEPTED');
      assert.equal(fake.calls.length, 1);
      console.log('PASS webhook status received before the HTTP return reconciles after acceptance');
    }

    // 4. Collection context: eligibility rechecked in the worker, business effects once.
    {
      const { dispatcher, fake } = build();
      const phone = nextPhone(); await openWindow(phone);
      const debtor = await prisma.debtor.create({ data: { companyId: companyA, name: 'Synthetic debtor', phoneNumber: `+${phone}`, whatsappOptIn: true } });
      const invoice = await prisma.invoice.create({ data: { companyId: companyA, debtorId: debtor.id, originalAmount: 100, dueDate: new Date(), status: 'PENDING' } });
      const collection = text(phone, { companyId: companyA, invoiceId: invoice.id, debtorId: debtor.id, content: 'Cobranca sintetica' });
      const reservation = await dispatcher.prepare(collection, `harness:collection:${runId}`);
      fake.behavior = async () => { await sleep(100); return { accepted: true, messageId: `wamid.collection.${runId}`, status: 'accepted' }; };
      const settled = await Promise.allSettled([dispatcher.dispatch(reservation.id), dispatcher.dispatch(reservation.id), dispatcher.dispatch(reservation.id)]);
      assert.equal(fake.calls.length, 1, settled.filter(result => result.status === 'rejected').map(result => result.reason.message).join('; '));
      assert.equal(await prisma.collectionLog.count({ where: { invoiceId: invoice.id, actionType: 'WHATSAPP_SENT', status: 'SENT' } }), 1);
      assert.equal(await prisma.messagingUsage.count({ where: { companyId: companyA, phoneNumber: phone } }), 1);

      const paid = await dispatcher.prepare({ ...collection, content: 'Cobranca paga na fila' }, `harness:collection-paid:${runId}`);
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
      await assert.rejects(dispatcher.dispatch(paid.id), /COLLECTION_NO_LONGER_ELIGIBLE/);
      assert.equal((await intentOf(paid.id)).state, 'FAILED');
      assert.deepEqual(await dispatcher.rejectedCollection(paid.id), { companyId: companyA, invoiceId: invoice.id, ruleStepId: undefined });
      assert.equal(await dispatcher.rejectedCollection(reservation.id), null, 'accepted intents are never reported as failed collections');

      const closedPhone = nextPhone(); await openWindow(closedPhone);
      const queued = await dispatcher.enqueue(text(closedPhone), `harness:window:${runId}`);
      await openWindow(closedPhone, false);
      const queuedIntent = await prisma.communicationOutboundIntent.findUnique({ where: { messageId: queued.id } });
      await assert.rejects(dispatcher.dispatch(queuedIntent.id), /janela/);
      assert.equal((await intentOf(queuedIntent.id)).state, 'FAILED');
      assert.equal((await intentOf(queuedIntent.id)).lastErrorCode, 'SERVICE_WINDOW_CLOSED', 'the admin screen can explain why it was not sent');
      assert.equal((await intentOf(paid.id)).lastErrorCode, 'COLLECTION_NO_LONGER_ELIGIBLE');
      assert.equal(fake.calls.length, 1, 'paid invoice and closed window are rejected before transmission');
      console.log('PASS collection effects once, invoice paid and service window closed while queued');
    }

    // 5. Pause and Redis loss keep intents pending; recovery sends them once afterwards.
    {
      const offline = build({ port: 1 });
      const phone = nextPhone(); await openWindow(phone);
      const reservation = await offline.dispatcher.prepare(text(phone), `harness:redis-down:${runId}`);
      await assert.rejects(offline.dispatcher.dispatch(reservation.id), error => error.kind === 'RATE_LIMIT' || error.kind === 'TEMPORARY');
      assert.equal((await intentOf(reservation.id)).state, 'PENDING');
      assert.equal(offline.fake.calls.length, 0, 'unavailable Redis never authorizes a send');
      const offlineQuota = new DatafyRateLimitService(new ConfigService({ REDIS_HOST: '127.0.0.1', REDIS_PORT: 1 })); owned.push(offlineQuota);
      await assert.rejects(offlineQuota.acquire('synthetic', 'SEND'), error => error.kind === 'TEMPORARY' && error.outcome === 'NOT_SENT');

      const { dispatcher, intents, fake } = build();
      await prisma.platformIntegrationState.upsert({ where: { integration: 'META' }, create: { integration: 'META', enabled: false }, update: { enabled: false } });
      await prisma.communicationOutboundIntent.update({ where: { id: reservation.id }, data: { nextAttemptAt: new Date(0) } });
      await assert.rejects(dispatcher.dispatch(reservation.id), error => error.kind === 'TEMPORARY');
      assert.equal((await intentOf(reservation.id)).state, 'PENDING', 'pausing the channel holds queued intents');
      await prisma.platformIntegrationState.update({ where: { integration: 'META' }, data: { enabled: true } });
      await prisma.communicationOutboundIntent.update({ where: { id: reservation.id }, data: { nextAttemptAt: new Date(0) } });
      assert.ok((await intents.recover()).some(item => item.id === reservation.id));
      await dispatcher.dispatch(reservation.id);
      assert.equal((await intentOf(reservation.id)).state, 'ACCEPTED');
      assert.equal(fake.calls.length, 1);
      console.log('PASS Redis loss and channel pause keep intents pending; recovery sends them once');
    }

    // 6. Datafy quota: one Redis clock, atomic across concurrent callers, hashed token identity.
    {
      const config = new ConfigService({ REDIS_HOST: '127.0.0.1', REDIS_PORT: redisPort });
      // Within a process the client is shared; the second "process" gets its own connection.
      const secondProcess = new Redis({ host: '127.0.0.1', port: redisPort, lazyConnect: true }); owned.push(secondProcess);
      await secondProcess.connect();
      const limiters = [new DatafyRateLimitService(config), new DatafyRateLimitService(config, secondProcess)];
      owned.push(...limiters);
      const token = `synthetic-token-${runId}`;
      const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => limiters[i % 2].acquire(token, 'SEND')));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'two processes share one send slot');
      assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.kind === 'RATE_LIMIT' && result.reason.outcome === 'NOT_SENT'));
      const keys = await probe.keys('ciframais:datafy:quota:*');
      assert.ok(keys.length >= 1 && keys.every(key => !key.includes(token)), 'token never appears in Redis keys');
      await sleep(130);
      await limiters[1].acquire(token, 'SEND');
      await limiters[0].acquire(token, 'OTHER');
      console.log('PASS Datafy quota is atomic across processes and keyed by token hash');
    }

    // 7. Daily unique-recipient quota of the shared number across two companies.
    {
      const { dispatcher, fake } = build({ channel: '333' });
      // Legacy MessagingUsage rows are not channel-scoped; recipients reached earlier today already hold slots.
      const used = (await prisma.messagingUsage.findMany({ where: { sentAt: { gt: new Date(Date.now() - 86_400_000) } }, distinct: ['phoneNumber'], select: { phoneNumber: true } })).length;
      const slots = 50 - used;
      const reservations = [];
      for (let i = 0; i < 52; i++) {
        const phone = nextPhone(); await openWindow(phone);
        reservations.push(await dispatcher.prepare(text(phone, { companyId: i % 2 ? companyB : companyA, content: `Aviso ${i}` }), `harness:quota:${runId}:${i}`));
      }
      for (let i = 0; i < reservations.length; i += 8)
        await Promise.allSettled(reservations.slice(i, i + 8).map(reservation => dispatcher.dispatch(reservation.id)));
      const states = await prisma.communicationOutboundIntent.findMany({ where: { id: { in: reservations.map(reservation => reservation.id) } }, select: { state: true, lastErrorCode: true } });
      assert.equal(fake.calls.length, slots, 'two companies do not multiply the TIER_50 channel quota');
      assert.equal(states.filter(state => state.state === 'ACCEPTED').length, slots);
      assert.equal(states.filter(state => state.state === 'PENDING' && state.lastErrorCode === 'WAITING_FOR_CHANNEL').length, 52 - slots);
      const repeat = await dispatcher.prepare(text(fake.calls[0].to, { companyId: companyA, content: 'Mesmo destinatario' }), `harness:quota:${runId}:known`);
      await dispatcher.dispatch(repeat.id);
      assert.equal(fake.calls.length, slots + 1, 'an already reserved recipient does not consume a new daily slot');
      console.log('PASS daily channel quota is shared across companies and waits instead of failing');
    }
  } finally {
    // Disconnect (not quit): clients pointed at a closed port would otherwise keep reconnecting.
    // Services release the shared client (closing it with the last user); raw clients disconnect.
    for (const item of owned) { try { if (item instanceof Redis) item.disconnect(); else await item.onModuleDestroy?.(); } catch { /* best effort */ } }
    if (started) {
      assert.equal(docker(['inspect', '--format', '{{ index .Config.Labels "ciframais.dispatch-test" }}', name]), runId);
      docker(['rm', '-f', '-v', name]);
    }
  }
};
