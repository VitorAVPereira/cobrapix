'use strict';
// Disposable local database only. Never reads DATABASE_URL or production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { PaymentFeeService } = require('../src/payment-fees/payment-fee.service.ts');
const { buildFinancialProfileReport } = require('../src/financial-activation/financial-profile-report.ts');
const name = `financial-activation-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
  return result.stdout.trim();
}
const fingerprint = (seed) => Array.from({ length: 32 }, (_, index) => ((seed + index) % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
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
    const fees = new PaymentFeeService(prisma);
    for (const billingMethod of ['PIX', 'BOLIX']) await fees.createVersion(null, { billingMethod, efiFee: { kind: 'FIXED', amountCents: 100 }, platformFee: { kind: 'PERCENTAGE', basisPoints: 250 }, effectiveFrom: new Date(0) });

    const company = (label, document) => prisma.company.create({ data: { corporateName: `${label} fixture`, email: `${label}@example.test`, phoneNumber: '5511999999999', document } });
    const companyA = await company('a', '12345678000195');
    const companyB = await company('b', '98765432000100');
    const companyC = await company('c', '11222333000181');
    const identity = (data) => prisma.efiAccountIdentity.create({ data: { environment: 'HOMOLOGATION', holderDocument: '12345678000195', ...data } });
    const credential = (identityId, version, status = 'ACTIVE') => prisma.efiCredentialVersion.create({ data: { identityId, version, status, encryptedClientId: 'enc:id', encryptedClientSecret: 'enc:secret', encryptedCertificate: 'enc:cert', credentialKeyVersion: 'v1', certificateFingerprint: fingerprint(version), certificateExpiresAt: new Date(Date.now() + 365 * 86400000) } });
    const identityA = await identity({ ownership: 'COMPANY', companyId: companyA.id, efiAccountNumber: '1001' });
    const identityB = await identity({ ownership: 'COMPANY', companyId: companyB.id, holderDocument: '98765432000100', efiAccountNumber: '2002' });
    const platform = await identity({ ownership: 'PLATFORM', holderDocument: '11222333000181', efiAccountNumber: '9009' });
    const credentialA = await credential(identityA.id, 1);
    const credentialB = await credential(identityB.id, 1);
    const credentialPlatform = await credential(platform.id, 1);

    let versionSeq = 0;
    const draft = (companyId, data = {}) => prisma.financialProfileVersion.create({ data: { companyId, version: ++versionSeq, origin: 'MANUAL_ADMIN', accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', environment: 'HOMOLOGATION', enabledMethods: ['PIX', 'BOLIX'], creationIdempotencyKey: randomUUID(), ...data } });
    const readyFields = (issuerIdentityId, issuerCredentialVersionId, authorizationKind = 'ACCOUNT_INTEGRATION_AUTHORIZATION') => ({ issuerIdentityId, issuerCredentialVersionId, authorizationKind, authorizationReference: 'contrato-123', ownershipVerifiedAt: new Date(), validatedAt: new Date(), validationHash: 'hash' });
    const makeReady = (profile, identityId, credentialId, kind) => prisma.financialProfileVersion.update({ where: { id: profile.id }, data: { status: 'READY', ...readyFields(identityId, credentialId, kind) } });
    // Mirrors the activation transaction: supersede, compare-and-set, move pointer.
    async function activate(companyId, profile, options = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (options.supersede) await client.query(`UPDATE "FinancialProfileVersion" SET "status"='SUPERSEDED', "supersededAt"=now(), "updatedAt"=now() WHERE "companyId"=$1 AND "status"='ACTIVE'`, [companyId]);
        const claimed = await client.query(`UPDATE "FinancialProfileVersion" SET "status"='ACTIVE', "activatedAt"=now(), "activationIdempotencyKey"=$3, "updatedAt"=now() WHERE "id"=$1 AND "status"='READY' AND "revision"=$2`, [profile.id, profile.revision, randomUUID()]);
        if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
        if (claimed.rowCount === 1 && !options.skipPointer) await client.query(`UPDATE "Company" SET "activeFinancialProfileId"=$1 WHERE "id"=$2`, [profile.id, companyId]);
        await client.query('COMMIT');
        return claimed.rowCount;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    // Mode combinations are enforced by the database, not only by the service.
    await assert.rejects(draft(companyA.id, { accountMode: 'PLATFORM_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER' }), /mode_check/);
    await assert.rejects(draft(companyA.id, { origin: 'AUTOMATIC_OPENING', accountMode: 'PLATFORM_ACCOUNT', payoutMode: 'MANUAL', authorizationKind: 'POWER_OF_ATTORNEY' }), /origin_check/);
    await assert.rejects(draft(companyA.id, { enabledMethods: ['BOLETO'] }), /methods_check/);
    await assert.rejects(draft(companyA.id, { enabledMethods: [] }), /methods_check/);
    await assert.rejects(draft(companyA.id, { authorizationKind: 'POWER_OF_ATTORNEY' }), /authorization_check/);
    console.log('PASS invalid mode, origin, method and authorization combinations are rejected');

    // Issuer must belong to the mode: own account for customer mode, shared account for platform mode.
    const candidateA = await draft(companyA.id);
    await assert.rejects(prisma.financialProfileVersion.update({ where: { id: candidateA.id }, data: { issuerIdentityId: identityB.id } }), /must be the company account/);
    await assert.rejects(prisma.financialProfileVersion.update({ where: { id: candidateA.id }, data: { issuerIdentityId: platform.id } }), /must be the company account/);
    await assert.rejects(prisma.financialProfileVersion.update({ where: { id: candidateA.id }, data: { issuerIdentityId: identityA.id, issuerCredentialVersionId: credentialB.id } }), /foreign key/i);
    await assert.rejects(prisma.financialProfileVersion.update({ where: { id: candidateA.id }, data: { environment: 'PRODUCTION', issuerIdentityId: identityA.id } }), /environment differs/);
    const platformDraft = await draft(companyC.id, { accountMode: 'PLATFORM_ACCOUNT', payoutMode: 'MANUAL' });
    await assert.rejects(prisma.financialProfileVersion.update({ where: { id: platformDraft.id }, data: { issuerIdentityId: identityA.id } }), /must be the platform account/);
    await prisma.financialProfileVersion.update({ where: { id: platformDraft.id }, data: { issuerIdentityId: platform.id, issuerCredentialVersionId: credentialPlatform.id } });
    await prisma.financialProfileVersion.update({ where: { id: platformDraft.id }, data: { status: 'CANCELED', canceledAt: new Date() } });
    console.log('PASS issuer identity, credential and environment follow the account mode');

    // A candidate cannot become READY without every recorded verification.
    await assert.rejects(prisma.financialProfileVersion.update({ where: { id: candidateA.id }, data: { status: 'READY', issuerIdentityId: identityA.id, issuerCredentialVersionId: credentialA.id } }), /ready_check/);
    await assert.rejects(draft(companyA.id), /open_candidate_company_key|Unique constraint/);
    const readyA = await makeReady(candidateA, identityA.id, credentialA.id);
    console.log('PASS readiness requires ownership, authorization and validation; one open candidate per company');

    // Activation without the pointer is rolled back entirely at commit.
    await assert.rejects(activate(companyA.id, readyA, { skipPointer: true }), /pointer is inconsistent/);
    assert.equal((await prisma.financialProfileVersion.findUnique({ where: { id: readyA.id } })).status, 'READY');
    assert.equal((await prisma.company.findUnique({ where: { id: companyA.id } })).activeFinancialProfileId, null);
    console.log('PASS partial activation rolls back the whole transaction');

    // Two concurrent confirmations of the same revision publish once.
    const outcomes = await Promise.all([activate(companyA.id, readyA, { delay: 200 }), activate(companyA.id, readyA, { delay: 200 })]);
    assert.deepEqual(outcomes.sort(), [0, 1]);
    assert.equal((await prisma.company.findUnique({ where: { id: companyA.id } })).activeFinancialProfileId, readyA.id);
    assert.equal(await prisma.financialProfileVersion.count({ where: { companyId: companyA.id, status: 'ACTIVE' } }), 1);
    console.log('PASS concurrent activation publishes exactly one version');

    // A second ACTIVE row for the same company is impossible even without the service.
    await assert.rejects(pool.query(`INSERT INTO "FinancialProfileVersion" ("id","companyId","version","status","origin","accountMode","payoutMode","environment","enabledMethods","issuerIdentityId","issuerCredentialVersionId","authorizationKind","authorizationReference","ownershipVerifiedAt","validatedAt","validationHash","creationIdempotencyKey","activationIdempotencyKey","activatedAt","updatedAt") VALUES ($1,$2,99,'ACTIVE','MANUAL_ADMIN','CUSTOMER_ACCOUNT','DIRECT_TO_CUSTOMER','HOMOLOGATION','{PIX}',$3,$4,'ACCOUNT_INTEGRATION_AUTHORIZATION','ref',now(),now(),'h',$5,$6,now(),now())`, [randomUUID(), companyA.id, identityA.id, credentialA.id, randomUUID(), randomUUID()]), /active_company_key/);
    console.log('PASS a company cannot hold two ACTIVE profiles');

    // Published profiles are frozen.
    await assert.rejects(prisma.financialProfileVersion.update({ where: { id: readyA.id }, data: { enabledMethods: ['PIX'] } }), /immutable/);
    await assert.rejects(prisma.financialProfileVersion.delete({ where: { id: readyA.id } }), /cannot be deleted/);
    console.log('PASS published profile cannot be edited or deleted');

    // Charges copy the context of an ACTIVE profile of their own company.
    const debtorA = await prisma.debtor.create({ data: { companyId: companyA.id, name: 'Devedor A', phoneNumber: '5511999999999' } });
    const debtorB = await prisma.debtor.create({ data: { companyId: companyB.id, name: 'Devedor B', phoneNumber: '5511888888888' } });
    const invoiceA = await prisma.invoice.create({ data: { companyId: companyA.id, debtorId: debtorA.id, originalAmount: 100, dueDate: new Date() } });
    const invoiceB = await prisma.invoice.create({ data: { companyId: companyB.id, debtorId: debtorB.id, originalAmount: 100, dueDate: new Date() } });
    const pixFee = await prisma.paymentFeeVersion.findFirst({ where: { billingMethod: 'PIX' } });
    const context = { financialProfileId: readyA.id, issuerIdentityId: identityA.id, issuerCredentialVersionId: credentialA.id, accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', financialEnvironment: 'HOMOLOGATION', distributionSnapshot: { issuer: 'COMPANY', distribution: 'PLATFORM_FEE_SPLIT' } };
    const lateTerms = { lateFineBasisPoints: 200, lateInterestMonthlyBasisPoints: 100, paymentDaysAfterDue: 30 };
    const freshInvoice = async (companyId) => (companyId === companyA.id ? prisma.invoice.create({ data: { companyId, debtorId: debtorA.id, originalAmount: 100, dueDate: new Date() } }) : invoiceB);
    const charge = async (companyId, invoiceId, data) => prisma.paymentCharge.create({ data: { companyId, invoiceId: companyId === companyA.id ? (await freshInvoice(companyId)).id : invoiceId, feeVersionId: pixFee.id, billingMethod: 'PIX', grossAmountCents: 10000, estimatedEfiFeeCents: 100, estimatedPlatformFeeCents: 250, feeSnapshot: {}, ...data } });
    await assert.rejects(charge(companyB.id, invoiceB.id, context), /foreign key|ACTIVE financial profile/i);
    await assert.rejects(charge(companyA.id, invoiceA.id, { ...context, payoutMode: 'EFI_SPLIT' }), /differs from its financial profile/);
    await assert.rejects(charge(companyA.id, invoiceA.id, { ...context, issuerCredentialVersionId: credentialPlatform.id }), /foreign key/i);
    await assert.rejects(charge(companyA.id, invoiceA.id, { financialProfileId: readyA.id }), /financial_context_check|differs from its financial profile/);
    await assert.rejects(charge(companyA.id, invoiceA.id, { lateFineBasisPoints: 200 }), /late_terms_check/);
    const issued = await charge(companyA.id, invoiceA.id, { ...context, ...lateTerms });
    await assert.rejects(prisma.paymentCharge.update({ where: { id: issued.id }, data: { payoutMode: 'MANUAL', accountMode: 'PLATFORM_ACCOUNT' } }), /context is immutable/);
    await assert.rejects(prisma.paymentCharge.update({ where: { id: issued.id }, data: { lateFineBasisPoints: 0 } }), /terms are immutable/);
    await prisma.paymentCharge.update({ where: { id: issued.id }, data: { status: 'PENDING' } });
    const legacy = await charge(companyA.id, invoiceA.id, {});
    await assert.rejects(prisma.paymentCharge.update({ where: { id: legacy.id }, data: context }), /cannot be attached after creation/);
    console.log('PASS charge context is tenant-bound, profile-consistent, complete and immutable');

    // Switching profiles keeps old charges on the old context and blocks new ones on it.
    const credentialA2 = await credential(identityA.id, 2, 'CANDIDATE');
    await assert.rejects(prisma.efiCredentialVersion.update({ where: { id: credentialA2.id }, data: { status: 'ACTIVE' } }), /active_identity_key|Unique constraint/);
    await assert.rejects(prisma.efiCredentialVersion.update({ where: { id: credentialA.id }, data: { certificateFingerprint: fingerprint(77) } }), /immutable/);
    await prisma.efiCredentialVersion.update({ where: { id: credentialA.id }, data: { encryptedClientSecret: 'enc:rotated-key', credentialKeyVersion: 'v2' } });
    const candidateA2 = await draft(companyA.id, { enabledMethods: ['PIX'] });
    const readyA2 = await makeReady(candidateA2, identityA.id, credentialA.id);
    assert.equal(await activate(companyA.id, readyA2, { supersede: true }), 1);
    assert.equal((await prisma.financialProfileVersion.findUnique({ where: { id: readyA.id } })).status, 'SUPERSEDED');
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: issued.id } })).financialProfileId, readyA.id);
    await assert.rejects(charge(companyA.id, invoiceA.id, context), /ACTIVE financial profile/);
    await assert.rejects(prisma.paymentCharge.create({ data: { companyId: companyA.id, invoiceId: (await freshInvoice(companyA.id)).id, feeVersionId: (await prisma.paymentFeeVersion.findFirst({ where: { billingMethod: 'BOLIX' } })).id, billingMethod: 'BOLIX', grossAmountCents: 10000, estimatedEfiFeeCents: 100, estimatedPlatformFeeCents: 250, feeSnapshot: {}, ...context, financialProfileId: readyA2.id } }), /not enabled/);
    console.log('PASS superseding keeps history and restricts new charges to the active version');

    // A company pointer can never reference another tenant's profile, nor a non-ACTIVE one.
    await assert.rejects(prisma.company.update({ where: { id: companyB.id }, data: { activeFinancialProfileId: readyA.id } }), /pointer is inconsistent/);
    await assert.rejects(prisma.company.update({ where: { id: companyA.id }, data: { activeFinancialProfileId: readyA.id } }), /pointer is inconsistent/);
    assert.equal((await prisma.company.findUnique({ where: { id: companyB.id } })).activeFinancialProfileId, null);
    console.log('PASS company pointer is tenant-safe and always targets the ACTIVE profile');

    // Identity invariants.
    await assert.rejects(identity({ ownership: 'PLATFORM', companyId: companyA.id, efiAccountNumber: '3003' }), /ownership_check/);
    await assert.rejects(identity({ ownership: 'PLATFORM', efiAccountNumber: '3004' }), /platform_environment_key|Unique constraint/);
    await assert.rejects(identity({ ownership: 'COMPANY', companyId: companyA.id, efiAccountNumber: '1001' }), /Unique constraint|environment_efiAccountNumber/);
    await assert.rejects(prisma.efiAccountIdentity.update({ where: { id: identityA.id }, data: { holderDocument: '98765432000100' } }), /immutable/);
    console.log('PASS identity ownership, uniqueness and immutability');

    // GatewayAccount can only link the company's own identity, never the shared one.
    const gateway = (companyId, efiAccountIdentityId) => prisma.gatewayAccount.create({ data: { companyId, payeeCode: 'payee', efiAccountNumber: '1001', pixKey: `key-${companyId}`, encryptedClientId: 'x', encryptedClientSecret: 'y', efiAccountIdentityId } });
    await assert.rejects(gateway(companyC.id, platform.id), /foreign key/i);
    await assert.rejects(gateway(companyC.id, identityA.id), /foreign key/i);
    await gateway(companyA.id, identityA.id);
    console.log('PASS legacy gateway account never references the shared identity');

    // Late-payment terms have database bounds.
    await assert.rejects(prisma.invoice.create({ data: { companyId: companyA.id, debtorId: debtorA.id, originalAmount: 100, dueDate: new Date(), lateFineBasisPoints: 1001 } }), /late_terms_check/);
    await assert.rejects(prisma.company.update({ where: { id: companyA.id }, data: { defaultPaymentDaysAfterDue: -1 } }), /late_terms_check/);
    console.log('PASS late-payment terms are bounded');

    // The migration report reads only and is repeatable.
    await prisma.efiOnboarding.create({ data: { companyId: companyC.id, status: 'ACTIVE' } });
    const tables = ['Company', 'FinancialProfileVersion', 'PaymentCharge', 'GatewayAccount', 'EfiAccountIdentity'];
    const snapshot = async () => Promise.all(tables.map(async table => (await pool.query(`SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM "${table}" t`)).rows[0].h));
    const before = await snapshot();
    const first = await buildFinancialProfileReport(prisma);
    const second = await buildFinancialProfileReport(prisma);
    assert.deepEqual(first, second);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(first.companies, { total: 3, withActiveProfile: 1, openingActiveWithoutProfile: [companyC.id] });
    assert.equal(first.gatewayAccountsWithoutIdentity, 0);
    assert.deepEqual(first.chargesWithoutContext, { DRAFT: 1 });
    console.log('PASS migration report is read-only and idempotent');

    console.log(`PASS financial activation schema on ${migrations.length} migrations in PostgreSQL 16`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'unknown failure');
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    if (containerStarted) spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  }
})();
