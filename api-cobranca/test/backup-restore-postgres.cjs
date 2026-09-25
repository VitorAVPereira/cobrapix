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
const { PaymentChargeService } = require('../src/payment/payment-charge.service.ts');
const { PaymentFeeService } = require('../src/payment-fees/payment-fee.service.ts');
const { FinancialEligibilityService } = require('../src/financial-activation/financial-eligibility.service.ts');

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

    // Financial data: customer credentials cifradas no banco e um pagamento conciliado.
    const fees = new PaymentFeeService(prismaSource);
    await fees.createVersion(null, { billingMethod: 'PIX', efiFee: { kind: 'FIXED', amountCents: 100 }, platformFee: { kind: 'PERCENTAGE', basisPoints: 250 }, effectiveFrom: new Date(0) });
    await prismaSource.platformIntegrationState.create({ data: { integration: 'EFI_PAYMENTS', enabled: true } });
    const identity = await prismaSource.efiAccountIdentity.create({ data: { ownership: 'COMPANY', companyId: company.id, environment: 'HOMOLOGATION', holderDocument: company.document, efiAccountNumber: '4001', payeeCode: 'payee4001', pixKey: 'chave-4001', healthStatus: 'HEALTHY' } });
    const credential = await prismaSource.efiCredentialVersion.create({ data: { identityId: identity.id, version: 1, status: 'ACTIVE', encryptedClientId: crypto.encrypt('client-id-backup'), encryptedClientSecret: crypto.encrypt('client-secret-backup'), encryptedCertificate: crypto.encrypt('p12-backup'), credentialKeyVersion: 'v1', certificateFingerprint: Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':'), certificateExpiresAt: new Date(Date.now() + 90 * 86_400_000) } });
    await prismaSource.$transaction(async (tx) => {
      const profile = await tx.financialProfileVersion.create({ data: { companyId: company.id, version: 1, status: 'ACTIVE', origin: 'MANUAL_ADMIN', accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', environment: 'HOMOLOGATION', enabledMethods: ['PIX'], issuerIdentityId: identity.id, issuerCredentialVersionId: credential.id, authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION', authorizationReference: 'contrato', ownershipVerifiedAt: new Date(), validatedAt: new Date(), validationHash: 'h', creationIdempotencyKey: randomUUID(), activationIdempotencyKey: randomUUID(), activatedAt: new Date() } });
      await tx.company.update({ where: { id: company.id }, data: { activeFinancialProfileId: profile.id } });
    });
    const debtor = await prismaSource.debtor.create({ data: { companyId: company.id, name: 'Pagador', phoneNumber: '5511911111111', document: '52998224725' } });
    const invoice = await prismaSource.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate: new Date() } });
    const charges = new PaymentChargeService(prismaSource, fees);
    const charge = await charges.createDraft(company.id, invoice.id, 'PIX', 10000, await new FinancialEligibilityService(prismaSource).resolveIssuance(company.id, 'PIX'));
    await charges.markIssued(charge.id, company.id, { gatewayId: charge.efiTxid, txid: charge.efiTxid, paymentLink: 'https://example.test', expiresAt: new Date(Date.now() + 86_400_000) });
    await charges.recordSettlement(charge, 120, 'CONCLUIDA', 10000, { source: 'PROVIDER_WEBHOOK', reference: 'E2E-BACKUP', distinctPayment: true });
    const ledgerBefore = (await source.query('SELECT kind, "amountCents", "idempotencyKey" FROM "FinancialLedgerEntry" ORDER BY "idempotencyKey"')).rows;
    assert.equal(ledgerBefore.length, 3);
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
    // Financial data after restore: same ledger, credentials readable only with the same keys, rules still enforced.
    assert.deepEqual((await target.query('SELECT kind, "amountCents", "idempotencyKey" FROM "FinancialLedgerEntry" ORDER BY "idempotencyKey"')).rows, ledgerBefore);
    const restoredCredential = await prismaTarget.efiCredentialVersion.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    assert.equal(crypto.decrypt(restoredCredential.encryptedClientSecret), 'client-secret-backup');
    assert.throws(() => otherKeys.decrypt(restoredCredential.encryptedClientSecret));
    await assert.rejects(target.query('UPDATE "FinancialLedgerEntry" SET "amountCents" = 1'), /LEDGER_APPEND_ONLY/);
    const restoredSettlement = await prismaTarget.paymentSettlement.findFirstOrThrow();
    assert.equal(restoredSettlement.status, 'AWAITING_EVIDENCE');
    await prismaTarget.$disconnect();
    console.log('PASS backup restore of financial data: ledger identical, customer credentials decrypt only with the original keys, append-only rule restored');
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
