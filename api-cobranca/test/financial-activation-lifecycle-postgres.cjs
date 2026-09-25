'use strict';
// Disposable local database only. Never reads DATABASE_URL or production credentials.
// Etapa 5: opening publishes a profile, eligibility replaces the opening gates,
// manual accounts are protected, renewals and key rotation keep credentials usable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { ConfigService } = require('@nestjs/config');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { PaymentCryptoService } = require('../src/payment/payment-crypto.service.ts');
const { PaymentService } = require('../src/payment/payment.service.ts');
const { GatewayHealthService } = require('../src/payment/gateway-health.service.ts');
const { rotatePaymentSecrets } = require('../src/payment/rotate-payment-secrets.ts');
const { FinancialEligibilityService } = require('../src/financial-activation/financial-eligibility.service.ts');
const { FinancialCertificateMonitor } = require('../src/financial-activation/financial-certificate-monitor.ts');
const { publishOpeningProfile, syncOpeningCredential, hasActiveManualProfile, OpeningProfileConflict } = require('../src/financial-activation/opening-profile.ts');
const { OnboardingAdminService } = require('../src/efi-onboarding/onboarding-admin.service.ts');
const name = `financial-lifecycle-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
  return result.stdout.trim();
}
const fingerprint = (seed) => Array.from({ length: 32 }, (_, index) => ((seed + index) % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.getResponse?.().code ?? error.code, code, error.message);
    return true;
  });
}
let pool;
let prisma;
let containerStarted = false;
(async () => {
  try {
    docker(['run', '-d', '--name', name, '--memory', '256m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=financial', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
    containerStarted = true;
    pool = new Pool({ host: '127.0.0.1', port: Number(docker(['port', name, '5432/tcp']).split(':').at(-1)), database: 'financial', user: 'postgres', password, connectionTimeoutMillis: 1000 });
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await pool.query('SELECT 1'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    assert.ok(ready, 'local database must start');
    const migrations = fs.readdirSync(path.join(root, 'prisma/migrations')).filter(file => fs.existsSync(path.join(root, 'prisma/migrations', file, 'migration.sql'))).sort();
    for (const migration of migrations) await pool.query(fs.readFileSync(path.join(root, 'prisma/migrations', migration, 'migration.sql'), 'utf8'));
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const keys = JSON.stringify({ v1: '11'.repeat(32), v2: '22'.repeat(32) });
    const cryptoV1 = new PaymentCryptoService(new ConfigService({ PAYMENT_ENCRYPTION_KEYS: keys, PAYMENT_ACTIVE_KEY_VERSION: 'v1' }));
    const cryptoV2 = new PaymentCryptoService(new ConfigService({ PAYMENT_ENCRYPTION_KEYS: keys, PAYMENT_ACTIVE_KEY_VERSION: 'v2' }));
    const eligibility = new FinancialEligibilityService(prisma);
    const payments = new PaymentService({}, prisma, null, eligibility);
    const health = new GatewayHealthService(prisma, {}, eligibility);

    const company = (label, document) => prisma.company.create({ data: { corporateName: `${label} fixture`, email: `${label}@example.test`, phoneNumber: '5511999999999', document, enabledBillingMethods: ['PIX', 'BOLIX'] } });
    const opening = await company('opening', '12345678000195');
    const manual = await company('manual', '98765432000100');
    const admin = await prisma.user.create({ data: { email: 'admin@example.test', name: 'Admin', password: 'hash', role: 'PLATFORM_ADMIN', companyId: opening.id } });
    const expires = new Date(Date.now() + 200 * 86400000);
    const gatewayFor = (companyId, account, seed) => prisma.gatewayAccount.create({ data: { companyId, status: 'PENDING', environment: 'homologation', payeeCode: `payee${account}`, efiAccountNumber: account, pixKey: `chave-${account}`, encryptedClientId: cryptoV1.encrypt('client'), encryptedClientSecret: cryptoV1.encrypt('secret'), encryptedCertificate: cryptoV1.encrypt('p12'), credentialKeyVersion: 'v1', certificateExpiresAt: expires, certificateFingerprint: fingerprint(seed) } });
    // Mirrors the provisioner's final transaction: opening ACTIVE, account ACTIVE, profile published.
    async function completeOpening(companyId, onboarding) {
      return prisma.$transaction(async (tx) => {
        const moved = await tx.efiOnboarding.updateMany({ where: { id: onboarding.id, status: 'PROVISIONING' }, data: { status: 'ACTIVE', activatedAt: new Date() } });
        assert.equal(moved.count, 1);
        const account = await tx.gatewayAccount.update({ where: { companyId }, data: { status: 'ACTIVE', healthStatus: 'HEALTHY' } });
        return publishOpeningProfile(tx, { companyId, onboardingId: onboarding.id, draftRevision: onboarding.draftRevision, requestId: 'request-1', account });
      });
    }

    // Before any activation: every gate is closed, whatever the opening says.
    assert.equal(await payments.hasActiveFinancialProfile(opening.id), false);
    await rejectsWith(health.assertIssuable(opening.id, 'PIX'), 'FINANCIAL_PROFILE_NOT_READY');
    console.log('PASS without a published profile, issuance, collection rule and first charge stay closed');

    // Completed opening publishes AUTOMATIC_OPENING + CUSTOMER_ACCOUNT atomically.
    const onboardingA = await prisma.efiOnboarding.create({ data: { companyId: opening.id, status: 'PROVISIONING', draftRevision: 1, simplifiedAccountRequestId: 'request-1', submittedCompanyDocument: opening.document } });
    const gatewayA = await gatewayFor(opening.id, '1001', 1);
    const profileId = await completeOpening(opening.id, onboardingA);
    const published = await prisma.financialProfileVersion.findUniqueOrThrow({ where: { id: profileId }, include: { issuerCredentialVersion: true, issuerIdentity: true } });
    assert.equal(published.origin, 'AUTOMATIC_OPENING');
    assert.equal(published.status, 'ACTIVE');
    assert.equal(published.authorizationKind, 'ACCOUNT_OPENING_CONSENT');
    assert.deepEqual(published.enabledMethods, ['PIX', 'BOLIX']);
    assert.equal(published.issuerCredentialVersion.encryptedClientSecret, gatewayA.encryptedClientSecret);
    assert.equal(published.issuerCredentialVersion.status, 'ACTIVE');
    assert.equal(published.issuerIdentity.holderDocument, opening.document);
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: opening.id } })).activeFinancialProfileId, profileId);
    assert.equal((await prisma.gatewayAccount.findUniqueOrThrow({ where: { companyId: opening.id } })).efiAccountIdentityId, published.issuerIdentityId);
    assert.equal(await payments.hasActiveFinancialProfile(opening.id), true);
    assert.equal(await hasActiveManualProfile(prisma, opening.id), false);
    console.log('PASS a completed opening publishes its profile in the same transaction');

    // Issuance goes through the published profile; payments pause still blocks.
    await rejectsWith(health.assertIssuable(opening.id, 'PIX'), 'EFI_PAYMENTS_PAUSED');
    await prisma.platformIntegrationState.create({ data: { integration: 'EFI_PAYMENTS', enabled: true } });
    await health.assertIssuable(opening.id, 'PIX');
    await health.assertIssuable(opening.id);
    await prisma.company.update({ where: { id: opening.id }, data: { status: 'SUSPENDED' } });
    await rejectsWith(health.assertIssuable(opening.id, 'PIX'), 'COMPANY_NOT_ACTIVE');
    await prisma.company.update({ where: { id: opening.id }, data: { status: 'ACTIVE' } });
    console.log('PASS issuance gate follows the profile, payments pause and company suspension');

    // Health failures reach the identity used by eligibility.
    const failingHealth = new GatewayHealthService(prisma, { validate: async () => { throw new Error('down'); } }, eligibility);
    await failingHealth.validate(opening.id);
    await failingHealth.validate(opening.id);
    assert.equal((await prisma.efiAccountIdentity.findUniqueOrThrow({ where: { id: published.issuerIdentityId } })).healthStatus, 'UNAVAILABLE');
    await rejectsWith(health.assertIssuable(opening.id, 'PIX'), 'EFI_INTEGRATION_UNHEALTHY');
    await new GatewayHealthService(prisma, { validate: async () => undefined }, eligibility).validate(opening.id);
    await health.assertIssuable(opening.id, 'PIX');
    console.log('PASS scheduled health checks mark the shared identity and recover it');

    // A renewal by the opening API becomes a new credential version of the same identity.
    await prisma.gatewayAccount.update({ where: { companyId: opening.id }, data: { encryptedCertificate: cryptoV1.encrypt('p12-renewed'), certificateFingerprint: fingerprint(40), certificateExpiresAt: new Date(Date.now() + 400 * 86400000) } });
    await syncOpeningCredential(prisma, opening.id);
    await syncOpeningCredential(prisma, opening.id);
    const versions = await prisma.efiCredentialVersion.findMany({ where: { identityId: published.issuerIdentityId }, orderBy: { version: 'asc' } });
    assert.deepEqual(versions.map(v => [v.version, v.status]), [[1, 'RETIRED'], [2, 'ACTIVE']]);
    assert.equal(cryptoV1.decrypt(versions[1].encryptedCertificate), 'p12-renewed');
    assert.equal((await eligibility.resolveIssuance(opening.id, 'PIX')).issuerCredentialVersionId, versions[1].id);
    console.log('PASS certificate renewal by opening adds a version, idempotently, used by new charges');

    // A manual activation is never overwritten by a late opening: the whole transaction rolls back.
    const identityM = await prisma.efiAccountIdentity.create({ data: { ownership: 'COMPANY', companyId: manual.id, environment: 'HOMOLOGATION', holderDocument: manual.document, efiAccountNumber: '2002', payeeCode: 'payee2002', pixKey: 'chave-2002' } });
    const credentialM = await prisma.efiCredentialVersion.create({ data: { identityId: identityM.id, version: 1, status: 'ACTIVE', encryptedClientId: cryptoV1.encrypt('manual-client'), encryptedClientSecret: cryptoV1.encrypt('manual-secret'), encryptedCertificate: cryptoV1.encrypt('manual-p12'), credentialKeyVersion: 'v1', certificateFingerprint: fingerprint(80), certificateExpiresAt: new Date(Date.now() + 10 * 86400000) } });
    const manualProfile = await prisma.$transaction(async (tx) => {
      const created = await tx.financialProfileVersion.create({ data: { companyId: manual.id, version: 1, status: 'ACTIVE', origin: 'MANUAL_ADMIN', accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', environment: 'HOMOLOGATION', enabledMethods: ['PIX'], issuerIdentityId: identityM.id, issuerCredentialVersionId: credentialM.id, authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION', authorizationReference: 'contrato', ownershipVerifiedAt: new Date(), validatedAt: new Date(), validationHash: 'h', creationIdempotencyKey: randomUUID(), activationIdempotencyKey: randomUUID(), activatedAt: new Date() } });
      await tx.company.update({ where: { id: manual.id }, data: { activeFinancialProfileId: created.id } });
      return created;
    });
    const bridgeBefore = await prisma.gatewayAccount.create({ data: { companyId: manual.id, status: 'ACTIVE', environment: 'homologation', payeeCode: 'payee2002', efiAccountNumber: '2002', pixKey: 'chave-2002', encryptedClientId: credentialM.encryptedClientId, encryptedClientSecret: credentialM.encryptedClientSecret, encryptedCertificate: credentialM.encryptedCertificate, certificateExpiresAt: credentialM.certificateExpiresAt, certificateFingerprint: credentialM.certificateFingerprint, credentialKeyVersion: 'v1', efiAccountIdentityId: identityM.id } });
    assert.equal(await hasActiveManualProfile(prisma, manual.id), true);
    const lateOnboarding = await prisma.efiOnboarding.create({ data: { companyId: manual.id, status: 'PROVISIONING', draftRevision: 1, simplifiedAccountRequestId: 'late', submittedCompanyDocument: manual.document } });
    await assert.rejects(completeOpening(manual.id, lateOnboarding), (error) => error instanceof OpeningProfileConflict && error.code === 'FINANCIAL_MANUAL_ACTIVE');
    assert.equal((await prisma.efiOnboarding.findUniqueOrThrow({ where: { id: lateOnboarding.id } })).status, 'PROVISIONING');
    assert.deepEqual(await prisma.gatewayAccount.findUniqueOrThrow({ where: { companyId: manual.id } }), bridgeBefore);
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: manual.id } })).activeFinancialProfileId, manualProfile.id);
    console.log('PASS a late opening cannot replace a manual activation; nothing is committed');

    // Explicit reconciliation closes the in-flight opening with evidence, without calling Efí.
    const onboardingAdmin = new OnboardingAdminService(prisma, {}, new ConfigService({ EFI_OPENING_ENABLED: 'false' }), {}, {}, {});
    await onboardingAdmin.closeForManual(manual.id, admin.id, { outcome: 'NO_ACCOUNT_OPENED', evidenceReference: 'chamado-77' });
    const closed = await prisma.efiOnboarding.findUniqueOrThrow({ where: { id: lateOnboarding.id } });
    assert.equal(closed.status, 'DISCONNECTED');
    assert.equal(closed.sanitizedErrorCode, 'CLOSED_FOR_MANUAL_ACTIVATION');
    const closeAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'EFI_OPENING_CLOSED_FOR_MANUAL' } });
    assert.deepEqual({ outcome: closeAudit.changes.outcome, evidence: closeAudit.changes.evidenceReference, previous: closeAudit.changes.previousStatus }, { outcome: 'NO_ACCOUNT_OPENED', evidence: 'chamado-77', previous: 'PROVISIONING' });
    await assert.rejects(onboardingAdmin.closeForManual(manual.id, admin.id, { outcome: 'NO_ACCOUNT_OPENED', evidenceReference: 'chamado-78' }), (error) => error.getResponse().code === 'EFI_OPENING_NOT_IN_FLIGHT');
    console.log('PASS in-flight opening is reconciled explicitly with evidence, once');

    // Manual certificates are watched: one alert per threshold, retried if the channel fails.
    const sent = [];
    let channelDown = true;
    const mailer = { sendEmail: async (input) => { if (channelDown) throw new Error('down'); sent.push(input); return { id: 'mail' }; } };
    const monitorConfig = new ConfigService({ RESEND_API_KEY: 're_test', RESEND_FROM_EMAIL: 'CifraMais <no-reply@example.test>', RESEND_REPLY_TO: 'suporte@example.test', PLATFORM_ALERT_EMAIL: 'ops@example.test' });
    const monitor = new FinancialCertificateMonitor(prisma, monitorConfig, mailer);
    assert.equal(await monitor.check(), 0);
    channelDown = false;
    assert.equal(await monitor.check(), 1);
    assert.equal(await monitor.check(), 0);
    assert.ok(sent[0].html.includes('FINANCIAL_CERTIFICATE_EXPIRES_15_DAYS'));
    assert.equal(await monitor.check(new Date(Date.now() + 4 * 86400000)), 1);
    assert.ok(sent[1].html.includes('FINANCIAL_CERTIFICATE_EXPIRES_7_DAYS'));
    assert.equal(await monitor.check(new Date(Date.now() + 11 * 86400000)), 1);
    assert.ok(sent[2].html.includes('FINANCIAL_CERTIFICATE_EXPIRED'));
    assert.ok(!JSON.stringify(sent).includes('manual-secret'));
    console.log('PASS manual certificates alert at 15/7 days and on expiry, once each, retrying on failure');

    // Key rotation also re-encrypts credential versions; wiped ones are skipped.
    await prisma.efiCredentialVersion.create({ data: { identityId: identityM.id, version: 2, status: 'REJECTED', encryptedClientId: '', encryptedClientSecret: '', encryptedCertificate: '', credentialKeyVersion: 'v1', certificateFingerprint: fingerprint(90), certificateExpiresAt: expires } });
    const dry = await rotatePaymentSecrets(prisma, cryptoV2);
    assert.equal(dry.apply, false);
    assert.equal(cryptoV2.getEnvelopeKeyVersion((await prisma.efiCredentialVersion.findUniqueOrThrow({ where: { id: credentialM.id } })).encryptedClientSecret), 'v1');
    await rotatePaymentSecrets(prisma, cryptoV2, { apply: true });
    const rotated = await prisma.efiCredentialVersion.findUniqueOrThrow({ where: { id: credentialM.id } });
    assert.equal(rotated.credentialKeyVersion, 'v2');
    assert.equal(cryptoV2.getEnvelopeKeyVersion(rotated.encryptedClientSecret), 'v2');
    assert.equal(cryptoV2.decrypt(rotated.encryptedClientSecret), 'manual-secret');
    assert.equal((await prisma.efiCredentialVersion.findFirstOrThrow({ where: { identityId: identityM.id, version: 2 } })).encryptedClientSecret, '');
    assert.equal(cryptoV2.decrypt((await prisma.gatewayAccount.findUniqueOrThrow({ where: { companyId: manual.id } })).encryptedClientSecret), 'manual-secret');
    console.log('PASS key rotation covers credential versions and skips wiped ones');

    console.log(`PASS financial activation lifecycle on ${migrations.length} migrations in PostgreSQL 16`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    if (containerStarted) spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  }
})();
