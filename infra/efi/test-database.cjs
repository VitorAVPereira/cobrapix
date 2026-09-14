'use strict';
// Creates and destroys only its own local PostgreSQL container. Never reads DATABASE_URL.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '../../api-cobranca');
const { Pool } = require(path.join(root, 'node_modules/pg'));
const { PrismaClient } = require(path.join(root, 'node_modules/@prisma/client'));
const { PrismaPg } = require(path.join(root, 'node_modules/@prisma/adapter-pg'));
const name = `efi-db-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
  return result.stdout.trim();
}
let pool;
let prisma;
(async () => {
  try {
    docker(['run', '-d', '--name', name, '--memory', '256m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=efi_test', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
    const port = Number(docker(['port', name, '5432/tcp']).split(':').at(-1));
    pool = new Pool({ host: '127.0.0.1', port, database: 'efi_test', user: 'postgres', password, connectionTimeoutMillis: 1000 });
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await pool.query('SELECT 1'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    assert.ok(ready, 'local database must start');
    const migrations = fs.readdirSync(path.join(root, 'prisma/migrations')).filter(name => fs.existsSync(path.join(root, 'prisma/migrations', name, 'migration.sql'))).sort();
    for (const migration of migrations) await pool.query(fs.readFileSync(path.join(root, 'prisma/migrations', migration, 'migration.sql'), 'utf8'));
    console.log(`PASS ${migrations.length} migrations on clean PostgreSQL 16`);
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
    const { seedMinimumProduction } = require(path.join(root, 'src/scripts/minimum-production-seed.ts'));
    const seedInput = { corporateName: 'Platform Fixture', document: '11111111000191', companyEmail: 'platform@example.test', phoneNumber: '5511777777777', adminEmail: 'root@example.test', adminPassword: 'Strong-Fixture-Only-123456' };
    await seedMinimumProduction(prisma, seedInput, true);
    await assert.rejects(seedMinimumProduction(prisma, seedInput, true));
    const administrator = await prisma.user.findUnique({ where: { email: seedInput.adminEmail } });
    assert.equal(administrator.role, 'PLATFORM_ADMIN');
    assert.equal(administrator.mustChangePassword, true);
    assert.notEqual(administrator.password, seedInput.adminPassword);
    assert.equal(await prisma.platformIntegrationState.count({ where: { enabled: true } }), 0);
    assert.equal(await prisma.paymentFeeVersion.count(), 0);
    console.log('PASS minimum seed: one administrator, hashed temporary password, paused channels, no fees, no overwrite');
    const company = await prisma.company.create({ data: { corporateName: 'Fixture A', email:'a@example.test', phoneNumber:'5511999999999', document: '12345678000195' } });
    const other = await prisma.company.create({ data: { corporateName: 'Fixture B', email:'b@example.test', phoneNumber:'5511888888888', document: '98765432000100' } });
    const debtor = await prisma.debtor.create({ data: { companyId: company.id, name: 'Fixture', phoneNumber: '5511999999999' } });
    const invoice = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate: new Date() } });
    assert.equal(invoice.status, 'DRAFT');
    assert.equal(company.preferredBillingMethod, 'BOLIX');
    assert.deepEqual(company.enabledBillingMethods, ['PIX', 'BOLIX']);
    const fee = await prisma.paymentFeeVersion.create({ data: { scopeKey: 'GLOBAL', billingMethod: 'PIX', version: 1, efiFeeKind: 'FIXED', efiFeeAmountCents: 100, platformFeeKind: 'PERCENTAGE', platformFeeBasisPoints: 100, effectiveFrom: new Date() } });
    await assert.rejects(prisma.paymentFeeVersion.update({ where: { id: fee.id }, data: { efiFeeAmountCents: 150 } }));
    console.log('PASS draft default and immutable fee version');
    const chargeData = { companyId: company.id, invoiceId: invoice.id, feeVersionId: fee.id, billingMethod: 'PIX', status: 'PENDING', grossAmountCents: 10000, estimatedEfiFeeCents: 100, estimatedPlatformFeeCents: 100, feeSnapshot: {} };
    const results = await Promise.allSettled([prisma.paymentCharge.create({ data: chargeData }), prisma.paymentCharge.create({ data: { ...chargeData, billingMethod: 'BOLETO' } })]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    await assert.rejects(prisma.paymentCharge.create({ data: { ...chargeData, companyId: other.id } }));
    console.log('PASS concurrent issuance exclusion and cross-tenant rejection');
    const template = await prisma.globalMessageTemplate.create({ data: { name: 'Fixture', slug: 'fixture', content: 'Approved fixture', metaStatus: 'APPROVED' } });
    await prisma.companyTemplatePreference.create({ data: { companyId: company.id, channel: 'WHATSAPP', slug: template.slug, globalMessageTemplateId: template.id, greeting: 'Olá' } });
    await assert.rejects(prisma.companyTemplatePreference.create({ data: { companyId: company.id, channel: 'WHATSAPP', slug: template.slug, globalMessageTemplateId: template.id } }));
    console.log('PASS global catalog and unique tenant preference');
    require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
    const { OnboardingRetention } = require(path.join(root, 'src/efi-onboarding/onboarding-retention.ts'));
    const expired = new Date(Date.now() - 31 * 86400000);
    await prisma.efiOnboarding.create({ data: { companyId: company.id, status: 'DRAFT', lastProgressAt: expired, representativeCpfEncrypted: 'ciphertext' } });
    const conversation = await prisma.communicationConversation.create({ data: { channel: 'EMAIL', recipientHash: 'fixture-hash', recipientEncrypted: 'ciphertext', lastMessagePreview: 'old content', retentionExpiresAt: expired } });
    await prisma.communicationMessage.create({ data: { conversationId: conversation.id, companyId: company.id, direction: 'OUTBOUND', content: 'old content', externalMessageId: 'fixture-message', retentionExpiresAt: expired } });
    await new OnboardingRetention(prisma).purge();
    const purged = await prisma.efiOnboarding.findUnique({ where: { companyId: company.id } });
    assert.equal(purged.representativeCpfEncrypted, null);
    const anonymized = await prisma.communicationConversation.findUnique({ where: { id: conversation.id } });
    assert.equal(anonymized.recipientEncrypted, null);
    assert.match(anonymized.recipientHash, /^anonymized:/);
    const message = await prisma.communicationMessage.findFirst({ where: { conversationId: conversation.id } });
    assert.equal(message.externalMessageId, null);
    assert.ok(message.anonymizedAt);
    console.log('PASS real database retention and recipient anonymization');
    const inventoryDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'efi-inventory-'));
    const inventoryPath = path.join(inventoryDir, 'manifest.json');
    try {
      const inventory = spawnSync(process.execPath, [path.join(__dirname, 'cutover-inventory.cjs'), '--companies=' + company.id, '--out=' + inventoryPath], { encoding: 'utf8', env: { ...process.env, CUTOVER_DATABASE_URL: 'postgresql://postgres:' + password + '@127.0.0.1:' + port + '/efi_test' } });
      assert.equal(inventory.status, 0, inventory.stderr);
      const manifest = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      assert.equal(manifest.mode, 'read-only');
      assert.equal(manifest.companies.length, 1);
      assert.equal(manifest.counts.Invoice, 1);
      assert.ok(!JSON.stringify(manifest).includes(company.document));
      assert.equal(await prisma.invoice.count({ where: { companyId: company.id } }), 1);
      console.log('PASS cutover inventory: explicit tenant allowlist, dependency counts, no raw CNPJ, no database writes');
    } finally {
      if (fs.existsSync(inventoryPath)) fs.unlinkSync(inventoryPath);
      fs.rmdirSync(inventoryDir);
    }
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    docker(['rm', '-f', name]);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
