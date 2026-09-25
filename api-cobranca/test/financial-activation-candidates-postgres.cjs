'use strict';
// Disposable local database only. Never reads DATABASE_URL or production credentials.
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
const { EfiAccountRegistryService } = require('../src/financial-activation/efi-account-registry.service.ts');
const { FinancialActivationService } = require('../src/financial-activation/financial-activation.service.ts');
const { inspectEfiCertificate } = require('../src/payment/efi-certificate.ts');
const name = `financial-candidates-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
  return result.stdout.trim();
}
function p12({ passphrase = '', notAfter = new Date(Date.now() + 365 * 86400000) } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 2 * 365 * 86400000);
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: 'commonName', value: 'fixture' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}
async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.getStatus?.(), status, `expected ${status} ${code}, got ${error.message}`);
    assert.equal(error.getResponse().code, code);
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
    const crypto = new PaymentCryptoService(new ConfigService({ PAYMENT_SECRET_KEY: randomBytes(32).toString('hex') }));
    const registry = new EfiAccountRegistryService(crypto);
    // Validation is covered by financial-activation-validation-postgres.cjs.
    const service = new FinancialActivationService(prisma, registry, { latestAttempt: async () => null });

    const companyA = await prisma.company.create({ data: { corporateName: 'A fixture', email: 'a@example.test', phoneNumber: '5511999999999', document: '12345678000195' } });
    const companyB = await prisma.company.create({ data: { corporateName: 'B fixture', email: 'b@example.test', phoneNumber: '5511888888888', document: '98765432000100' } });
    const admin = await prisma.user.create({ data: { email: 'admin@example.test', name: 'Admin', password: 'hash', role: 'PLATFORM_ADMIN', companyId: companyA.id } });
    const legacyGateway = await prisma.gatewayAccount.create({ data: { companyId: companyA.id, status: 'ACTIVE', payeeCode: 'legacy', efiAccountNumber: '777', pixKey: 'legacy-key', encryptedClientId: 'legacy-id', encryptedClientSecret: 'legacy-secret' } });
    const secrets = { clientId: `Client_Id_${randomBytes(8).toString('hex')}`, clientSecret: `Client_Secret_${randomBytes(12).toString('hex')}` };
    const account = { holderDocument: companyA.document, efiAccountNumber: '123456', efiAccountDigit: '7', payeeCode: 'payeeA1', pixKey: 'chave-a@example.test' };
    const certificate = p12();
    const create = (companyId, data = {}) => service.createCandidate(companyId, admin.id, { idempotencyKey: randomUUID(), accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', environment: 'HOMOLOGATION', enabledMethods: ['PIX', 'BOLIX'], ...data });
    const upload = (candidate, data = {}, file = certificate) => service.uploadCredentials(candidate.id, admin.id, { expectedRevision: candidate.revision, ...secrets, ...account, ...data }, { buffer: Buffer.from(file), size: file.length });

    // Creation: phase A mode only, idempotent, one open candidate per company.
    await rejectsWith(create(companyA.id, { accountMode: 'PLATFORM_ACCOUNT', payoutMode: 'MANUAL' }), 422, 'FINANCIAL_MODE_NOT_AVAILABLE');
    await rejectsWith(create(companyA.id, { payoutMode: 'EFI_SPLIT' }), 422, 'FINANCIAL_MODE_INVALID');
    await rejectsWith(create(randomUUID()), 404, 'COMPANY_NOT_FOUND');
    const key = randomUUID();
    const [first, replay] = await Promise.all([create(companyA.id, { idempotencyKey: key }), create(companyA.id, { idempotencyKey: key, enabledMethods: ['BOLIX', 'PIX'] })]);
    assert.equal(first.id, replay.id);
    assert.equal(first.version, 1);
    assert.equal(first.status, 'DRAFT');
    await rejectsWith(create(companyA.id, { idempotencyKey: key, enabledMethods: ['PIX'] }), 409, 'IDEMPOTENCY_KEY_REUSED');
    await rejectsWith(create(companyA.id), 409, 'CANDIDATE_ALREADY_OPEN');
    console.log('PASS candidate creation is phase-A only, idempotent and single per company');

    // Certificates are checked by content, never by extension.
    await rejectsWith(upload(first, {}, Buffer.from('not a pkcs12')), 422, 'CERTIFICATE_INVALID');
    await rejectsWith(upload(first, {}, p12({ notAfter: new Date(Date.now() - 86400000) })), 422, 'CERTIFICATE_INVALID');
    const protectedCert = p12({ passphrase: 's3nha' });
    await rejectsWith(upload(first, { certificatePassword: 'errada' }, protectedCert), 422, 'CERTIFICATE_INVALID');
    await rejectsWith(upload(first, {}, Buffer.alloc(1024 * 1024 + 1, 1)), 422, 'CERTIFICATE_INVALID');
    await rejectsWith(upload(first, { holderDocument: companyB.document }), 422, 'ACCOUNT_OWNERSHIP_UNVERIFIED');
    assert.equal(await prisma.efiCredentialVersion.count(), 0);
    console.log('PASS invalid, expired, wrong-password, oversized and foreign-holder certificates are refused');

    // Successful upload: encrypted at rest, masked in responses, absent from audit.
    const uploaded = await upload(first, { certificatePassword: 's3nha' }, protectedCert);
    assert.equal(uploaded.revision, 2);
    assert.equal(uploaded.issuer.efiAccountNumber, '••••3456');
    assert.equal(uploaded.issuer.holderDocument, '••••0195');
    assert.equal(uploaded.credential.version, 1);
    assert.equal(uploaded.credential.certificateFingerprint, inspectEfiCertificate(protectedCert.toString('base64'), 's3nha').fingerprint);
    const stored = await prisma.efiCredentialVersion.findFirstOrThrow();
    assert.equal(crypto.decrypt(stored.encryptedClientSecret), secrets.clientSecret);
    assert.equal(crypto.decrypt(stored.encryptedClientId), secrets.clientId);
    const forbidden = [secrets.clientSecret, secrets.clientId, 's3nha', protectedCert.toString('base64').slice(0, 40)];
    const audits = await prisma.auditLog.findMany();
    const surfaces = [JSON.stringify(uploaded), JSON.stringify(await service.getOverview(companyA.id)), JSON.stringify(audits), JSON.stringify(await prisma.financialProfileVersion.findMany())];
    for (const surface of surfaces) for (const secret of forbidden) assert.ok(!surface.includes(secret), 'secret leaked');
    for (const column of ['encryptedClientId', 'encryptedClientSecret', 'encryptedCertificate']) for (const secret of forbidden) assert.ok(!stored[column].includes(secret));
    console.log('PASS credentials are encrypted at rest and never echoed in responses, audit or profile rows');

    // Revisions protect every edit and void validation.
    await rejectsWith(service.updateConfiguration(first.id, admin.id, { expectedRevision: 1, authorizationReference: 'contrato-1' }), 409, 'REVISION_CONFLICT');
    await pool.query(`UPDATE "FinancialProfileVersion" SET "status"='VALIDATION_FAILED', "validatedAt"=now(), "validationHash"='h' WHERE "id"=$1`, [first.id]);
    await rejectsWith(service.updateConfiguration(first.id, admin.id, { expectedRevision: 2, ownershipVerifiedDocument: companyA.document }), 422, 'OWNERSHIP_EVIDENCE_REQUIRED');
    await rejectsWith(service.updateConfiguration(first.id, admin.id, { expectedRevision: 2, ownershipVerifiedDocument: companyB.document, ownershipEvidenceReference: 'chamado-1' }), 422, 'ACCOUNT_OWNERSHIP_UNVERIFIED');
    await rejectsWith(service.updateConfiguration(first.id, admin.id, { expectedRevision: 2, authorizationValidUntil: '2020-01-01T00:00:00.000Z' }), 422, 'AUTHORIZATION_EXPIRED');
    const configured = await service.updateConfiguration(first.id, admin.id, { expectedRevision: 2, authorizationReference: 'contrato-1', ownershipVerifiedDocument: companyA.document, ownershipEvidenceReference: 'chamado-1', enabledMethods: ['PIX'] });
    assert.equal(configured.revision, 3);
    assert.equal(configured.status, 'DRAFT');
    assert.equal(configured.validatedAt, null);
    assert.ok(configured.ownership.verifiedAt);
    assert.deepEqual(configured.enabledMethods, ['PIX']);
    const concurrent = await Promise.allSettled([1, 2].map(n => service.updateConfiguration(first.id, admin.id, { expectedRevision: 3, authorizationReference: `contrato-${n + 1}` })));
    assert.deepEqual(concurrent.map(r => r.status).sort(), ['fulfilled', 'rejected']);
    console.log('PASS revisions reject stale and concurrent edits and every edit voids validation');

    // Re-upload for the same account keeps the identity, adds a version and wipes the old one.
    let current = await service.getActivation(first.id);
    const reuploaded = await upload(current);
    assert.equal(reuploaded.issuer.id, uploaded.issuer.id);
    assert.equal(reuploaded.credential.version, 2);
    assert.ok(reuploaded.ownership.verifiedAt, 'same account keeps the ownership attestation');
    const old = await prisma.efiCredentialVersion.findFirstOrThrow({ where: { version: 1 } });
    assert.equal(old.status, 'REJECTED');
    assert.equal(old.encryptedClientSecret, '');
    assert.equal(old.encryptedCertificate, '');
    // A different account resets the attestation.
    const switched = await upload(reuploaded, { efiAccountNumber: '654321', payeeCode: 'payeeA2' });
    assert.notEqual(switched.issuer.id, uploaded.issuer.id);
    assert.equal(switched.ownership.verifiedAt, null);
    await rejectsWith(upload(switched, { payeeCode: 'other' }), 409, 'ACCOUNT_DATA_MISMATCH');
    console.log('PASS re-upload rotates the credential, keeps the identity and resets ownership on account change');

    // Rotation through the registry keeps the identity of the account.
    const rotated = await prisma.$transaction(tx => registry.addCredentialVersion(tx, switched.issuer.id, { ...secrets, certificate: inspectEfiCertificate(certificate.toString('base64')), userId: admin.id }));
    assert.equal(rotated.identityId, switched.issuer.id);
    assert.equal(rotated.version, 2);
    console.log('PASS registry rotation adds a version to the same identity');

    // Another company cannot claim an account already registered.
    const candidateB = await create(companyB.id);
    await rejectsWith(upload(candidateB, { holderDocument: companyB.document }), 409, 'ACCOUNT_ALREADY_REGISTERED');
    console.log('PASS an account registered to one company cannot be claimed by another');

    // Cancel closes the candidate and wipes its secrets.
    current = await service.getActivation(first.id);
    const canceled = await service.cancel(first.id, admin.id, { expectedRevision: current.revision, reason: 'Cliente trocou de conta' });
    assert.equal(canceled.status, 'CANCELED');
    const canceledCredential = await prisma.efiCredentialVersion.findFirstOrThrow({ where: { identityId: switched.issuer.id, version: 1 } });
    assert.equal(canceledCredential.status, 'REJECTED');
    assert.equal(canceledCredential.encryptedClientSecret, '');
    await rejectsWith(service.updateConfiguration(first.id, admin.id, { expectedRevision: canceled.revision, authorizationReference: 'x-1' }), 409, 'FINANCIAL_ACTIVATION_CLOSED');
    console.log('PASS cancel closes the candidate and wipes its credential');

    // Abandoned candidates expire after the retention period.
    const candidateA2 = await create(companyA.id);
    const withCredential = await upload(candidateA2);
    await pool.query(`UPDATE "FinancialProfileVersion" SET "updatedAt"=now() - interval '8 days' WHERE "id" = ANY($1)`, [[withCredential.id, candidateB.id]]);
    assert.equal(await service.expireAbandonedCandidates(), 2);
    assert.equal((await service.getActivation(withCredential.id)).status, 'EXPIRED');
    const expiredCredential = await prisma.efiCredentialVersion.findFirstOrThrow({ where: { identityId: withCredential.issuer.id, version: withCredential.credential.version } });
    assert.equal(expiredCredential.encryptedClientSecret, '');
    assert.equal(await service.expireAbandonedCandidates(), 0);
    assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCIAL_ACTIVATION_EXPIRED' } }), 2);
    console.log('PASS abandoned candidates expire once and lose their secrets');

    // Preparing a candidate never activates, never issues and never touches the working integration.
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: companyA.id } })).activeFinancialProfileId, null);
    assert.equal(await prisma.financialProfileVersion.count({ where: { status: 'ACTIVE' } }), 0);
    assert.equal(await prisma.paymentCharge.count(), 0);
    assert.deepEqual(await prisma.gatewayAccount.findUniqueOrThrow({ where: { id: legacyGateway.id } }), legacyGateway);
    assert.equal(await prisma.efiCredentialVersion.count({ where: { status: 'ACTIVE' } }), 0);
    console.log('PASS preparation leaves activation, charges and the legacy gateway account untouched');

    console.log(`PASS financial activation candidates on ${migrations.length} migrations in PostgreSQL 16`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : 'unknown failure');
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    if (containerStarted) spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  }
})();
