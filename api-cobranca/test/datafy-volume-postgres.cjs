'use strict';
// Measurement only, on a disposable PostgreSQL configured like infra/interserver/compose.yaml.
// Synthetic data; no external calls. Usage: node test/datafy-volume-postgres.cjs [conversations]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { ConfigService } = require('@nestjs/config');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { PaymentCryptoService } = require('../src/payment/payment-crypto.service.ts');
const { CommunicationTokenService } = require('../src/communications/communication-token.service.ts');
const { CommunicationsTenantService } = require('../src/communications/communications-tenant.service.ts');
const { CommunicationsService } = require('../src/communications/communications.service.ts');
const { CommunicationAttributionService } = require('../src/communications/communication-attribution.service.ts');
const { DatafyWebhookService } = require('../src/webhooks/datafy-webhook.service.ts');

const CONVERSATIONS = Number(process.argv[2] ?? 50_000);
const MESSAGES_PER_CONVERSATION = 8;
const runId = randomBytes(8).toString('hex');
const name = `ciframais-volume-${runId}`;
const password = randomBytes(24).toString('hex');
const host = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
const docker = args => {
  const result = spawnSync('docker', ['--host', host, ...args], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
  return result.stdout.trim();
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function timed(fn, runs = 7) {
  const samples = [];
  for (let i = 0; i < runs; i++) { const start = process.hrtime.bigint(); await fn(); samples.push(Number(process.hrtime.bigint() - start) / 1e6); }
  return { medianMs: Number(median(samples).toFixed(1)), maxMs: Number(Math.max(...samples).toFixed(1)) };
}
function scans(plan, found = []) {
  if (plan['Node Type']) found.push(`${plan['Node Type']}${plan['Relation Name'] ? ` ${plan['Relation Name']}` : ''}${plan['Index Name'] ? ` [${plan['Index Name']}]` : ''}`);
  for (const child of plan.Plans ?? []) scans(child, found);
  return found;
}

(async () => {
  let pool, prisma, started = false;
  const report = { conversations: CONVERSATIONS, messagesPerConversation: MESSAGES_PER_CONVERSATION, plans: {}, timings: {}, ingestion: {}, resources: {} };
  try {
    docker(['run', '-d', '--name', name, '--label', `ciframais.volume=${runId}`, '--memory', '1536m', '--shm-size', '256m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=volume', '-p', '127.0.0.1::5432', 'postgres:16-alpine', 'postgres', '-c', 'shared_buffers=256MB', '-c', 'max_connections=50']);
    started = true;
    const port = Number(docker(['port', name, '5432/tcp']).split(':').at(-1));
    pool = new Pool({ host: '127.0.0.1', port, database: 'volume', user: 'postgres', password, max: 10 });
    for (let i = 0; i < 60; i++) { try { await pool.query('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
    for (const file of fs.readdirSync(path.join(root, 'prisma/migrations')).filter(f => fs.existsSync(path.join(root, 'prisma/migrations', f, 'migration.sql'))).sort())
      await pool.query(fs.readFileSync(path.join(root, 'prisma/migrations', file, 'migration.sql'), 'utf8'));

    const seedStart = Date.now();
    await pool.query(`INSERT INTO "Company" ("id","corporateName","email","phoneNumber","document","updatedAt")
      SELECT gen_random_uuid(), 'Empresa ' || g, 'empresa' || g || '@volume.test', '5511900000000', lpad(g::text, 14, '0'), now() FROM generate_series(1, 20) g`);
    await pool.query(`INSERT INTO "CommunicationConversation" ("id","channel","recipientHash","recipientType","retentionExpiresAt","updatedAt","lastInboundAt","serviceWindowExpiresAt","unreadCount")
      SELECT gen_random_uuid(), 'WHATSAPP', md5('a' || g) || md5('b' || g), 'PHONE', now() + interval '5 years', now() - (g % 180) * interval '1 day', now() - (g % 180) * interval '1 day', now() - (g % 180) * interval '1 day' + interval '1 day', g % 3
      FROM generate_series(1, ${CONVERSATIONS}) g`);
    // Each contact mostly belongs to one company; 10% of messages come from a second one; 15% of inbound stay unassigned.
    await pool.query(`WITH co AS (SELECT array_agg("id" ORDER BY "id") AS ids FROM "Company"),
      conv AS (SELECT "id", row_number() OVER (ORDER BY "id") AS rn FROM "CommunicationConversation")
      INSERT INTO "CommunicationMessage" ("id","conversationId","companyId","direction","content","externalMessageId","retentionExpiresAt","createdAt","transportChannelId","source","attributionMethod","status","messageType")
      SELECT gen_random_uuid(), conv.id,
        CASE WHEN n % 2 = 1 AND (conv.rn + n) % 7 = 0 THEN NULL
             WHEN n = 7 THEN co.ids[1 + ((conv.rn + 3) % 20)]
             ELSE co.ids[1 + (conv.rn % 20)] END,
        CASE WHEN n % 2 = 1 THEN 'INBOUND'::"MessageDirection" ELSE 'OUTBOUND'::"MessageDirection" END,
        'Mensagem sintética ' || n || ' da conversa ' || conv.rn,
        'wamid.volume.' || conv.rn || '.' || n,
        now() + interval '5 years',
        now() - ((conv.rn % 180) * interval '1 day') + n * interval '1 minute',
        '222', 'LIVE',
        CASE WHEN n % 2 = 1 AND (conv.rn + n) % 7 = 0 THEN 'UNASSIGNED'::"CommunicationAttributionMethod"
             WHEN n % 2 = 1 THEN 'REPLY_CONTEXT'::"CommunicationAttributionMethod"
             ELSE 'OUTBOUND_CONTEXT'::"CommunicationAttributionMethod" END,
        CASE WHEN n % 2 = 1 THEN 'received' ELSE 'delivered' END, 'text'
      FROM conv CROSS JOIN co CROSS JOIN generate_series(0, ${MESSAGES_PER_CONVERSATION - 1}) n`);
    await pool.query(`INSERT INTO "CommunicationAttachment" ("id","messageId","externalMediaId","contentType","sizeBytes","state","retentionExpiresAt","updatedAt")
      SELECT gen_random_uuid(), m."id", 'media-' || row_number() OVER (), 'image/jpeg', 150000,
        CASE WHEN random() < 0.05 THEN 'PENDING'::"CommunicationAttachmentState" ELSE 'READY'::"CommunicationAttachmentState" END,
        m."retentionExpiresAt", now()
      FROM "CommunicationMessage" m WHERE m."direction" = 'INBOUND' AND m."createdAt" < now() - interval '170 days'`);
    await pool.query('ANALYZE');
    const counts = (await pool.query(`SELECT (SELECT count(*) FROM "CommunicationMessage")::int AS messages, (SELECT count(*) FROM "CommunicationAttachment")::int AS attachments`)).rows[0];
    report.seed = { ...counts, seconds: Number(((Date.now() - seedStart) / 1000).toFixed(1)) };
    const companyA = (await pool.query(`SELECT "companyId", count(*)::int AS messages, count(DISTINCT "conversationId")::int AS conversations FROM "CommunicationMessage" WHERE "companyId" IS NOT NULL GROUP BY "companyId" ORDER BY messages DESC LIMIT 1`)).rows[0];
    report.companyA = companyA;
    const sampleConversation = (await pool.query(`SELECT "conversationId" FROM "CommunicationMessage" WHERE "companyId" = $1 LIMIT 1`, [companyA.companyId])).rows[0].conversationId;

    const explain = async (label, sql, params = []) => {
      const plan = (await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)).rows[0]['QUERY PLAN'][0];
      const nodes = scans(plan.Plan);
      report.plans[label] = { executionMs: Number(plan['Execution Time'].toFixed(2)), nodes: [...new Set(nodes)].filter(node => /Scan/.test(node)) };
      return report.plans[label];
    };
    await explain('tenant conversations page', `SELECT m."conversationId", max(m."createdAt"), count(*) FROM "CommunicationMessage" m JOIN "CommunicationConversation" c ON c."id" = m."conversationId" WHERE m."companyId" = $1 AND m."retentionExpiresAt" > now() GROUP BY m."conversationId", c."channel" ORDER BY max(m."createdAt") DESC, m."conversationId" DESC LIMIT 26`, [companyA.companyId]);
    await explain('tenant messages page', `SELECT "id" FROM "CommunicationMessage" WHERE "conversationId" = $1 AND "companyId" = $2 AND "retentionExpiresAt" > now() ORDER BY "createdAt" DESC, "id" DESC LIMIT 26`, [sampleConversation, companyA.companyId]);
    await explain('admin pending classification', `SELECT c."id" FROM "CommunicationConversation" c WHERE EXISTS (SELECT 1 FROM "CommunicationMessage" m WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."companyId" IS NULL AND (m."attributionMethod" = 'UNASSIGNED' OR m."attributionMethod" IS NULL)) ORDER BY c."updatedAt" DESC, c."id" DESC LIMIT 25`);
    await explain('retention candidates', `SELECT "id" FROM "CommunicationMessage" WHERE "retentionExpiresAt" <= now() AND "anonymizedAt" IS NULL LIMIT 1000`);
    await explain('attachment purge', `SELECT "id" FROM "CommunicationAttachment" WHERE "retentionExpiresAt" <= now() AND "state" <> 'EXPIRED' ORDER BY "id" LIMIT 200`);
    await explain('media claim', `SELECT "id" FROM "CommunicationAttachment" WHERE "state" = 'PENDING' AND "nextAttemptAt" <= now() AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now()) ORDER BY "nextAttemptAt", "id" LIMIT 1`);
    await explain('reply by provider id', `SELECT "id" FROM "CommunicationMessage" WHERE "externalMessageId" = $1`, ['wamid.volume.100.2']);
    await explain('dependent replies', `SELECT "id" FROM "CommunicationMessage" WHERE "conversationId" = $1 AND "transportChannelId" = '222' AND "replyToExternalMessageId" = 'wamid.volume.1.0' AND "attributionMethod" IN ('UNASSIGNED','REPLY_CONTEXT') ORDER BY "id" LIMIT 100`, [sampleConversation]);
    await explain('media usage', `SELECT sum("sizeBytes") FROM "CommunicationAttachment" WHERE "state" = 'READY'`);

    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const crypto = new PaymentCryptoService(new ConfigService({ PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('hex') }), PAYMENT_ACTIVE_KEY_VERSION: 'v1' }));
    const tokens = new CommunicationTokenService(new ConfigService({ JWT_SECRET: 'volume-jwt-secret-with-at-least-32-chars' }));
    const tenant = new CommunicationsTenantService(prisma, crypto, tokens);
    const admin = new CommunicationsService(prisma, crypto, {}, {}, new ConfigService({ META_PHONE_NUMBER_ID: '222' }), new CommunicationAttributionService(prisma), tokens);
    const viewer = { userId: randomUUID(), companyId: companyA.companyId };
    const first = await tenant.listConversations(viewer, { limit: 25 });
    let fifthCursor = first.nextCursor;
    for (let i = 0; i < 3 && fifthCursor; i++) fifthCursor = (await tenant.listConversations(viewer, { limit: 25, cursor: fifthCursor })).nextCursor;
    report.timings['company conversations, first page'] = await timed(() => tenant.listConversations(viewer, { limit: 25 }));
    report.timings['company conversations, 5th page'] = await timed(() => tenant.listConversations(viewer, { limit: 25, cursor: fifthCursor }));
    report.timings['company messages page'] = await timed(() => tenant.listMessages(viewer, sampleConversation, { limit: 25 }));
    report.timings['admin list, pending classification'] = await timed(() => admin.listAdminConversations({ page: 1, pageSize: 25, pendingClassification: true }));
    report.timings['admin conversation detail'] = await timed(() => admin.getAdminConversation(sampleConversation, randomUUID(), { limit: 50 }));
    assert.equal(first.items.length, 25);

    // Webhook ingestion: signed batches of 20 inbound messages, processed with worker concurrency 4.
    const secret = 'whsec_volume';
    const webhook = new DatafyWebhookService(prisma, new ConfigService({ DATAFY_WEBHOOK_SECRET: secret, META_BUSINESS_ACCOUNT_ID: '111', META_PHONE_NUMBER_ID: '222' }), crypto, { enqueue: async () => undefined });
    const phones = Array.from({ length: 500 }, (_, i) => `55119${String(80_000_000 + i).padStart(8, '0')}`);
    const batches = 100, perBatch = 20;
    const rssBefore = process.memoryUsage().rss;
    const receiveStart = Date.now();
    const deliveries = [];
    for (let b = 0; b < batches; b++) {
      const now = Math.floor(Date.now() / 1000);
      const messages = Array.from({ length: perBatch }, (_, i) => ({ id: `wamid.ingest.${b}.${i}`, from: phones[(b * perBatch + i) % phones.length], timestamp: String(now), type: 'text', text: { body: `Resposta ${b}.${i}` }, context: { id: `wamid.volume.${1 + ((b * perBatch + i) % CONVERSATIONS)}.0` } }));
      const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '111', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '222' }, messages } }] }] }));
      const deliveryId = randomUUID(), timestamp = String(now);
      await webhook.receive(raw, { deliveryId, timestamp, signature: `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}` });
      deliveries.push(deliveryId);
    }
    const receiveMs = Date.now() - receiveStart;
    const rows = await prisma.communicationWebhookDelivery.findMany({ where: { deliveryId: { in: deliveries } }, select: { id: true } });
    const processStart = Date.now();
    for (let i = 0; i < rows.length; i += 4) await Promise.all(rows.slice(i, i + 4).map(row => webhook.processDelivery(row.id)));
    const processMs = Date.now() - processStart;
    const ingested = await prisma.communicationMessage.count({ where: { externalMessageId: { startsWith: 'wamid.ingest.' } } });
    assert.equal(ingested, batches * perBatch);
    report.ingestion = {
      deliveries: batches, messages: ingested,
      receiveAndPersistMsPerDelivery: Number((receiveMs / batches).toFixed(1)),
      processMessagesPerSecond: Number((ingested / (processMs / 1000)).toFixed(0)),
      apiProcessRssDeltaMb: Number(((process.memoryUsage().rss - rssBefore) / 1024 / 1024).toFixed(1)),
    };
    report.resources = {
      postgresMemory: docker(['stats', '--no-stream', '--format', '{{.MemUsage}}', name]),
      databaseSize: (await pool.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS size')).rows[0].size,
      messagesTableSize: (await pool.query(`SELECT pg_size_pretty(pg_total_relation_size('"CommunicationMessage"')) AS size`)).rows[0].size,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end().catch(() => undefined);
    if (started && docker(['inspect', '--format', '{{ index .Config.Labels "ciframais.volume" }}', name]) === runId)
      docker(['rm', '-f', '-v', name]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
