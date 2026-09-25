'use strict';
// Proves the backup procedure of infra/interserver/backup.sh on disposable containers:
// pg_dump --format=custom, tar of the attachment directory, restore into a new database
// and directory, and decryption with the same keys (and failure without them).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { ConfigService } = require('@nestjs/config');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { PaymentCryptoService } = require('../src/payment/payment-crypto.service.ts');
const { CommunicationMediaService } = require('../src/communications/communication-media.service.ts');

const runId = randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
const host = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
const names = [`ciframais-backup-src-${runId}`, `ciframais-backup-dst-${runId}`];
const docker = (args, options = {}) => {
  const result = spawnSync('docker', ['--host', host, ...args], { timeout: 120_000, maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${String(result.stderr).slice(0, 200)}`);
  return result.stdout;
};
const keys = { PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('hex') }), PAYMENT_ACTIVE_KEY_VERSION: 'v1' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('backup fixture')]);

async function database(name) {
  docker(['run', '-d', '--name', name, '--label', `ciframais.backup=${runId}`, '--memory', '384m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=ciframais', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  const port = Number(String(docker(['port', name, '5432/tcp'])).trim().split(':').at(-1));
  const pool = new Pool({ host: '127.0.0.1', port, database: 'ciframais', user: 'postgres', password, max: 4 });
  for (let i = 0; i < 60; i++) { try { await pool.query('SELECT 1'); return pool; } catch { await new Promise(r => setTimeout(r, 500)); } }
  throw new Error('database did not start');
}

(async () => {
  const work = fs.mkdtempSync(path.join(tmpdir(), 'ciframais-backup-'));
  const pools = [];
  try {
    const source = await database(names[0]); pools.push(source);
    for (const file of fs.readdirSync(path.join(root, 'prisma/migrations')).filter(f => fs.existsSync(path.join(root, 'prisma/migrations', f, 'migration.sql'))).sort())
      await source.query(fs.readFileSync(path.join(root, 'prisma/migrations', file, 'migration.sql'), 'utf8'));
    const prismaSource = new PrismaClient({ adapter: new PrismaPg(source) });
    const company = await prismaSource.company.create({ data: { corporateName: 'Backup', email: 'backup@example.test', phoneNumber: '5511900000000', document: '12345678000199' } });
    const conversation = await prismaSource.communicationConversation.create({ data: { channel: 'WHATSAPP', recipientHash: randomUUID().replace(/-/g, ''), retentionExpiresAt: new Date(Date.now() + 86_400_000 * 365) } });
    const message = await prismaSource.communicationMessage.create({ data: { conversationId: conversation.id, companyId: company.id, direction: 'INBOUND', content: 'Comprovante', retentionExpiresAt: conversation.retentionExpiresAt, source: 'LIVE' } });
    const attachment = await prismaSource.communicationAttachment.create({ data: { messageId: message.id, externalMediaId: '9001', contentType: 'image/png', retentionExpiresAt: conversation.retentionExpiresAt } });
    const sourceMedia = path.join(work, 'source', 'communication-media');
    const transport = { downloadMedia: async () => ({ bytes: PNG, contentType: 'image/png' }) };
    const crypto = new PaymentCryptoService(new ConfigService(keys));
    await new CommunicationMediaService(prismaSource, new ConfigService({ COMMUNICATION_MEDIA_DIR: sourceMedia }), crypto, transport).processPending();
    await prismaSource.$disconnect();

    // Same commands as backup.sh.
    const dump = docker(['exec', names[0], 'pg_dump', '-U', 'postgres', '-d', 'ciframais', '--format=custom', '--no-owner']);
    fs.writeFileSync(path.join(work, 'ciframais.dump'), dump);
    // Relative paths: GNU tar on Windows would read 'C:' as a remote host.
    const tar = spawnSync('tar', ['-C', 'source', '-czf', 'communication-media.tgz', 'communication-media'], { cwd: work });
    assert.equal(tar.status, 0, 'tar archive');

    // Restore into a brand-new database and directory.
    const target = await database(names[1]); pools.push(target);
    docker(['exec', '-i', names[1], 'pg_restore', '-U', 'postgres', '-d', 'ciframais', '--no-owner', '--exit-on-error'], { input: fs.readFileSync(path.join(work, 'ciframais.dump')) });
    fs.mkdirSync(path.join(work, 'restored'));
    assert.equal(spawnSync('tar', ['-C', 'restored', '-xzf', 'communication-media.tgz'], { cwd: work }).status, 0);
    const prismaTarget = new PrismaClient({ adapter: new PrismaPg(target) });
    const restoredMedia = path.join(work, 'restored', 'communication-media');
    const viewer = { companyId: company.id, role: 'COMPANY_ADMIN' };
    const restored = await new CommunicationMediaService(prismaTarget, new ConfigService({ COMMUNICATION_MEDIA_DIR: restoredMedia }), crypto, transport).openForViewer(viewer, message.id, attachment.id);
    assert.ok(restored.bytes.equals(PNG), 'attachment decrypts after restore with the same api.env keys');
    const migrations = (await target.query('SELECT count(*)::int AS n FROM "_prisma_migrations"').catch(() => ({ rows: [{ n: null }] }))).rows[0].n;
    const otherKeys = new PaymentCryptoService(new ConfigService({ PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('hex') }), PAYMENT_ACTIVE_KEY_VERSION: 'v1' }));
    await assert.rejects(new CommunicationMediaService(prismaTarget, new ConfigService({ COMMUNICATION_MEDIA_DIR: restoredMedia }), otherKeys, transport).openForViewer(viewer, message.id, attachment.id), error => error.getStatus() === 422, 'without the original keys the file is unreadable');
    await prismaTarget.$disconnect();
    console.log(`PASS backup restore: dump ${dump.length} bytes, attachment decrypted with original keys and refused with others (migration table: ${migrations ?? 'n/a'})`);
  } finally {
    for (const pool of pools) await pool.end().catch(() => undefined);
    for (const name of names) {
      try {
        if (String(docker(['inspect', '--format', '{{ index .Config.Labels "ciframais.backup" }}', name])).trim() === runId) docker(['rm', '-f', '-v', name]);
      } catch { /* not created */ }
    }
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
