'use strict';
// Disposable local database only. Never reads DATABASE_URL or production credentials.
// The Efí gateway is simulated; no provider is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const forge = require('node-forge');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { ConfigService } = require('@nestjs/config');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { PaymentCryptoService } = require('../src/payment/payment-crypto.service.ts');
const { PaymentFeeService } = require('../src/payment-fees/payment-fee.service.ts');
const { EfiAccountRegistryService } = require('../src/financial-activation/efi-account-registry.service.ts');
const { FinancialActivationService } = require('../src/financial-activation/financial-activation.service.ts');
const { FinancialValidationService, validationSplitId } = require('../src/financial-activation/financial-validation.service.ts');
const { FinancialEligibilityService } = require('../src/financial-activation/financial-eligibility.service.ts');
const { EfiOpeningClient } = require('../src/efi-onboarding/efi-opening.client.ts');
const name = `financial-validation-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
  return result.stdout.trim();
}
function p12() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: 'fixture' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], '', { algorithm: '3des' })).getBytes(), 'binary');
}
async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.getStatus?.(), status, `expected ${status} ${code}, got ${error.message}`);
    assert.equal(error.getResponse().code, code);
    return true;
  });
}
// Acceptance criterion of the plan: the account-opening client must never run.
const openingCalls = [];
for (const method of Object.getOwnPropertyNames(EfiOpeningClient.prototype).filter(m => m !== 'constructor'))
  EfiOpeningClient.prototype[method] = function blocked() { openingCalls.push(method); throw new Error('OPENING_CALLED'); };

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

    const config = new ConfigService({ PAYMENT_SECRET_KEY: randomBytes(32).toString('hex'), EFI_PLATFORM_ACCOUNT_NUMBER: '900900', EFI_PLATFORM_CNPJ: '11222333000181', EFI_PLATFORM_PAYEE_CODE: 'platformPayee' });
    const crypto = new PaymentCryptoService(config);
    const fees = new PaymentFeeService(prisma);
    for (const billingMethod of ['PIX', 'BOLIX']) await fees.createVersion(null, { billingMethod, efiFee: { kind: 'FIXED', amountCents: 100 }, platformFee: { kind: 'PERCENTAGE', basisPoints: 300 }, effectiveFrom: new Date(0) });

    // Simulated Efí: records calls and material, fails on demand.
    const gatewayCalls = [];
    const materials = [];
    let failNext = null;
    const PIX_TARGET = 'https://efi-webhooks.example.test/webhooks/efi/pix?ignorar=';
    const call = async (name, ...args) => {
      gatewayCalls.push([name, ...args]);
      if (failNext && failNext.step === name) {
        const error = failNext.error;
        if (!failNext.sticky) failNext = null;
        throw error;
      }
    };
    const gateway = {
      pixWebhookTarget: () => PIX_TARGET,
      chargesWebhookUrl: (companyId) => `https://efi-webhooks.example.test/webhooks/efi/cobrancas?companyId=${companyId}`,
      operations(material) {
        materials.push(material);
        return {
          listRecentDueCharges: () => call('listRecentDueCharges'),
          configurePixWebhook: (key) => call('configurePixWebhook', key),
          pixWebhookUrl: async (key) => { await call('pixWebhookUrl', key); return PIX_TARGET; },
          upsertValidationSplit: (id) => call('upsertValidationSplit', id),
          listChargePlans: () => call('listChargePlans'),
        };
      },
    };
    const enqueued = [];
    let redisDown = false;
    const jobs = { enqueue: async (attemptId, run, delay = 0) => { if (!redisDown) enqueued.push({ data: { attemptId }, run, delay }); } };
    const validation = new FinancialValidationService(prisma, crypto, gateway, fees, jobs, config);
    const registry = new EfiAccountRegistryService(crypto);
    const service = new FinancialActivationService(prisma, registry, validation);
    const eligibility = new FinancialEligibilityService(prisma);

    const company = (label, document) => prisma.company.create({ data: { corporateName: `${label} fixture`, email: `${label}@example.test`, phoneNumber: '5511999999999', document } });
    const companyA = await company('a', '12345678000195');
    const companyB = await company('b', '98765432000100');
    const admin = await prisma.user.create({ data: { email: 'admin@example.test', name: 'Admin', password: 'hash', role: 'PLATFORM_ADMIN', companyId: companyA.id } });
    const secrets = { clientId: `Client_Id_${randomBytes(6).toString('hex')}`, clientSecret: `Client_Secret_${randomBytes(10).toString('hex')}` };
    const certificate = p12();
    async function prepared(target, account) {
      let profile = await service.createCandidate(target.id, admin.id, { idempotencyKey: randomUUID(), accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', environment: 'HOMOLOGATION', enabledMethods: ['PIX', 'BOLIX'] });
      profile = await service.uploadCredentials(profile.id, admin.id, { expectedRevision: profile.revision, ...secrets, holderDocument: target.document, efiAccountNumber: account, payeeCode: `payee${account}`, pixKey: `chave-${account}@example.test` }, { buffer: Buffer.from(certificate), size: certificate.length });
      return service.updateConfiguration(profile.id, admin.id, { expectedRevision: profile.revision, authorizationReference: `contrato-${account}`, ownershipVerifiedDocument: target.document, ownershipEvidenceReference: `chamado-${account}` });
    }
    const validate = (profile, key = randomUUID()) => validation.requestValidation(profile.id, admin.id, { expectedRevision: profile.revision, idempotencyKey: key });
    const activate = (profile, attemptId, extra = {}) => service.activate(profile.id, admin.id, { expectedRevision: profile.revision, validationAttemptId: attemptId, idempotencyKey: randomUUID(), confirmEffects: true, acknowledgeUnverifiedSteps: true, ...extra });
    const setSwitch = (integration, enabled) => prisma.platformIntegrationState.upsert({ where: { integration }, create: { integration, enabled }, update: { enabled } });

    // Manual activation stays closed until released; opening being paused is irrelevant.
    let candidate = await prepared(companyA, '100001');
    await rejectsWith(validate(candidate), 409, 'MANUAL_ACTIVATION_PAUSED');
    await service.setManualActivationReleased(true);
    await setSwitch('EFI_ONBOARDING', false);
    console.log('PASS manual activation has its own release switch, independent from account opening');

    // Local preconditions are checked before anything reaches Efí.
    const incomplete = await service.createCandidate(companyB.id, admin.id, { idempotencyKey: randomUUID(), accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', environment: 'HOMOLOGATION', enabledMethods: ['PIX'] });
    await rejectsWith(validate(incomplete), 422, 'FINANCIAL_PROFILE_NOT_READY');
    assert.equal(gatewayCalls.length, 0);
    console.log('PASS incomplete candidates are refused before any provider call');

    // Request: durable attempt, job carries only the id, idempotent, revision-bound.
    const key = randomUUID();
    const requested = await validate(candidate, key);
    assert.equal(requested.status, 'PENDING');
    assert.deepEqual(requested.steps.map(s => [s.code, s.effect]), [['CERTIFICATE', 'NONE'], ['FEE_VERSIONS', 'NONE'], ['PLATFORM_RECIPIENT', 'NONE'], ['PIX_AUTH', 'NONE'], ['PIX_WEBHOOK', 'PIX_WEBHOOK_CONFIGURED'], ['PIX_SPLIT', 'VALIDATION_SPLIT_CONFIGURED'], ['CHARGES_AUTH', 'NONE'], ['CHARGES_WEBHOOK_URL', 'NONE'], ['BOLIX_ISSUANCE', 'NONE'], ['BOLIX_SPLIT', 'NONE']]);
    assert.deepEqual(Object.keys(enqueued[0].data), ['attemptId']);
    assert.equal((await validate(candidate, key)).id, requested.id);
    await rejectsWith(validate({ ...candidate, revision: candidate.revision + 1 }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
    await rejectsWith(validate(candidate), 409, 'VALIDATION_IN_PROGRESS');
    assert.equal((await service.getActivation(candidate.id)).status, 'VALIDATING');
    console.log('PASS validation request is durable, idempotent and queues identifiers only');

    // Two runners at once: the lease lets exactly one work.
    await Promise.all([validation.runAttempt(requested.id), validation.runAttempt(requested.id)]);
    assert.equal(gatewayCalls.filter(c => c[0] === 'configurePixWebhook').length, 1);
    let attempt = await validation.latestAttempt(candidate.id);
    assert.equal(attempt.status, 'SUCCEEDED');
    assert.ok(attempt.validUntil.getTime() - Date.now() > 14 * 60000 && attempt.validUntil.getTime() - Date.now() <= 15 * 60000);
    const byCode = Object.fromEntries(attempt.steps.map(s => [s.code, s.status]));
    assert.deepEqual(byCode, { CERTIFICATE: 'PASSED', FEE_VERSIONS: 'PASSED', PLATFORM_RECIPIENT: 'PASSED', PIX_AUTH: 'PASSED', PIX_WEBHOOK: 'PASSED', PIX_SPLIT: 'PASSED', CHARGES_AUTH: 'PASSED', CHARGES_WEBHOOK_URL: 'PASSED', BOLIX_ISSUANCE: 'NOT_VERIFIABLE', BOLIX_SPLIT: 'NOT_VERIFIABLE' });
    const identityA = (await service.getActivation(candidate.id)).issuer.id;
    assert.deepEqual(gatewayCalls.find(c => c[0] === 'upsertValidationSplit'), ['upsertValidationSplit', validationSplitId(identityA)]);
    assert.deepEqual(gatewayCalls.find(c => c[0] === 'configurePixWebhook'), ['configurePixWebhook', 'chave-100001@example.test']);
    assert.equal(materials[0].clientSecret, secrets.clientSecret, 'decrypted only in memory for the provider call');
    candidate = await service.getActivation(candidate.id);
    assert.equal(candidate.status, 'READY');
    console.log('PASS validation runs once under concurrency, checks each method and declares effects');

    // Activation: acknowledgement, revision and validation freshness.
    await rejectsWith(activate(candidate, attempt.id, { acknowledgeUnverifiedSteps: false }), 422, 'UNVERIFIED_STEPS_NOT_ACKNOWLEDGED');
    await rejectsWith(activate({ ...candidate, revision: candidate.revision - 1 }, attempt.id), 409, 'REVISION_CONFLICT');
    const opening = await prisma.efiOnboarding.create({ data: { companyId: companyA.id, status: 'EFI_PROCESSING' } });
    await rejectsWith(activate(candidate, attempt.id), 409, 'OPENING_RECONCILIATION_REQUIRED');
    await prisma.efiOnboarding.delete({ where: { id: opening.id } });
    const activationKey = randomUUID();
    const active = await activate(candidate, attempt.id, { idempotencyKey: activationKey });
    assert.equal(active.status, 'ACTIVE');
    const replay = await activate(candidate, attempt.id, { idempotencyKey: activationKey });
    assert.equal(replay.id, active.id);
    assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCIAL_ACTIVATION_ACTIVATED' } }), 1);
    const companyAfter = await prisma.company.findUniqueOrThrow({ where: { id: companyA.id } });
    assert.equal(companyAfter.activeFinancialProfileId, active.id);
    const credential = await prisma.efiCredentialVersion.findFirstOrThrow({ where: { identityId: identityA, status: 'ACTIVE' } });
    const bridge = await prisma.gatewayAccount.findUniqueOrThrow({ where: { companyId: companyA.id } });
    assert.equal(bridge.efiAccountIdentityId, identityA);
    assert.equal(bridge.status, 'ACTIVE');
    assert.equal(bridge.encryptedClientSecret, credential.encryptedClientSecret);
    assert.equal(bridge.pixKey, 'chave-100001@example.test');
    assert.equal(await prisma.efiOnboarding.count({ where: { companyId: companyA.id } }), 0, 'no fabricated opening');
    assert.equal(await prisma.paymentCharge.count(), 0, 'activation issues nothing');
    console.log('PASS activation is atomic, idempotent, needs acknowledgement and fabricates no opening');

    // Eligibility follows the published profile, not the opening status.
    await rejectsWith(eligibility.resolveIssuance(companyA.id, 'PIX'), 409, 'EFI_PAYMENTS_PAUSED');
    await setSwitch('EFI_PAYMENTS', true);
    const context = await eligibility.resolveIssuance(companyA.id, 'PIX');
    assert.deepEqual(context, { financialProfileId: active.id, issuerIdentityId: identityA, issuerCredentialVersionId: credential.id, accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', financialEnvironment: 'HOMOLOGATION' });
    await service.setManualActivationReleased(false);
    assert.equal((await eligibility.resolveIssuance(companyA.id, 'BOLIX')).financialProfileId, active.id, 'pausing new activations keeps active companies');
    await rejectsWith(eligibility.resolveIssuance(companyB.id, 'PIX'), 409, 'FINANCIAL_PROFILE_NOT_READY');
    await service.setManualActivationReleased(true);
    console.log('PASS eligibility uses the active profile; payments pause blocks, activation pause does not');

    // Stale validation: expiry and any change in validated inputs.
    await service.cancel(incomplete.id, admin.id, { expectedRevision: incomplete.revision, reason: 'Fixture incompleta' });
    let second = await prepared(companyB, '200002');
    let secondAttempt = await validate(second);
    await validation.runAttempt(secondAttempt.id);
    second = await service.getActivation(second.id);
    await pool.query(`UPDATE "FinancialValidationAttempt" SET "validUntil"=now() - interval '1 second' WHERE "id"=$1`, [secondAttempt.id]);
    await rejectsWith(activate(second, secondAttempt.id), 409, 'VALIDATION_STALE');
    secondAttempt = await validate(second);
    await validation.runAttempt(secondAttempt.id);
    second = await service.getActivation(second.id);
    await fees.createVersion(companyB.id, { billingMethod: 'PIX', efiFee: { kind: 'FIXED', amountCents: 100 }, platformFee: { kind: 'PERCENTAGE', basisPoints: 500 }, effectiveFrom: new Date(Date.now() - 1000) });
    await rejectsWith(activate(second, secondAttempt.id), 409, 'VALIDATION_STALE');
    console.log('PASS expired validation or a changed fee policy makes activation stale');

    // An edit during validation cancels the run without calling Efí.
    secondAttempt = await validate(second);
    const before = gatewayCalls.length;
    second = await service.updateConfiguration(second.id, admin.id, { expectedRevision: second.revision, authorizationReference: 'contrato-novo' });
    await validation.runAttempt(secondAttempt.id);
    assert.equal((await validation.latestAttempt(second.id)).status, 'CANCELED');
    assert.equal(gatewayCalls.length, before);
    console.log('PASS editing during validation cancels the stale run');

    // Transient failures retry with backoff, then fail; permanent failures stop at once.
    secondAttempt = await validate(second);
    failNext = { step: 'listRecentDueCharges', error: new TypeError("Cannot read properties of undefined (reading 'res')"), sticky: true };
    await validation.runAttempt(secondAttempt.id);
    attempt = await validation.latestAttempt(second.id);
    assert.equal(attempt.status, 'PENDING');
    assert.equal(attempt.attempts, 1);
    assert.equal((await service.getActivation(second.id)).status, 'VALIDATING');
    assert.deepEqual(enqueued.at(-1), { data: { attemptId: attempt.id }, run: 1, delay: 60000 });
    const callsBefore = gatewayCalls.length;
    await validation.runAttempt(attempt.id);
    assert.equal(gatewayCalls.length, callsBefore, 'not due yet');
    for (let run = 2; run <= 3; run++) {
      await pool.query(`UPDATE "FinancialValidationAttempt" SET "nextRunAt"=now() WHERE "id"=$1`, [attempt.id]);
      await validation.runAttempt(attempt.id);
    }
    attempt = await validation.latestAttempt(second.id);
    assert.equal(attempt.status, 'FAILED');
    assert.equal(attempt.errorCode, 'EFI_UNAVAILABLE');
    assert.equal(attempt.attempts, 3);
    assert.equal((await service.getActivation(second.id)).status, 'VALIDATION_FAILED');
    second = await service.getActivation(second.id);
    secondAttempt = await validate(second);
    failNext = { step: 'listRecentDueCharges', error: { error: 'invalid_client', error_description: 'Invalid or inactive credentials' } };
    await validation.runAttempt(secondAttempt.id);
    attempt = await validation.latestAttempt(second.id);
    assert.equal(attempt.status, 'FAILED');
    assert.equal(attempt.errorCode, 'EFI_REJECTED_INVALID_CLIENT');
    assert.equal(attempt.attempts, 1);
    console.log('PASS transient failures back off and give up; credential rejections fail immediately');

    // Redis lost after persisting: the recovery routine runs the original attempt.
    failNext = null;
    second = await service.getActivation(second.id);
    redisDown = true;
    const orphan = await validate(second);
    redisDown = false;
    assert.ok(!enqueued.some(job => job.data.attemptId === orphan.id));
    assert.equal(await validation.recoverDueAttempts(), 1);
    assert.equal((await validation.latestAttempt(second.id)).id, orphan.id);
    assert.equal((await validation.latestAttempt(second.id)).status, 'SUCCEEDED');
    assert.equal(await validation.recoverDueAttempts(), 0);
    console.log('PASS recovery resumes a persisted attempt with its original id');

    // Nothing sensitive in attempts, audit or queued jobs; the opening API was never used.
    const surfaces = JSON.stringify([await prisma.financialValidationAttempt.findMany(), await prisma.auditLog.findMany(), enqueued]);
    for (const secret of [secrets.clientId, secrets.clientSecret, certificate.toString('base64').slice(0, 40)]) assert.ok(!surfaces.includes(secret), 'secret leaked');
    assert.deepEqual(openingCalls, []);
    console.log('PASS no secret in attempts, audit or jobs; account-opening client never called');

    console.log(`PASS financial validation and activation on ${migrations.length} migrations in PostgreSQL 16`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    if (containerStarted) spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  }
})();
