'use strict';
// Disposable local database only. Never reads DATABASE_URL or production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { PaymentChargeService } = require('../src/payment/payment-charge.service.ts');
const { PaymentFeeService } = require('../src/payment-fees/payment-fee.service.ts');
const { FinancialEligibilityService } = require('../src/financial-activation/financial-eligibility.service.ts');
const { SettlementsService } = require('../src/settlements/settlements.service.ts');
const { FinancialHistoryService } = require('../src/financial-activation/financial-history.service.ts');
const name = `settlements-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
  return result.stdout.trim();
}
const fingerprint = () => Array.from(randomBytes(32), (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
const code = (error) => error?.response?.code;
let pool;
let prisma;
let containerStarted = false;
(async () => {
  try {
    docker(['run', '-d', '--name', name, '--memory', '256m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=settlements', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
    containerStarted = true;
    pool = new Pool({ host: '127.0.0.1', port: Number(docker(['port', name, '5432/tcp']).split(':').at(-1)), database: 'settlements', user: 'postgres', password, connectionTimeoutMillis: 1000, max: 12 });
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await pool.query('SELECT 1'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    assert.ok(ready, 'local database must start');
    const migrations = fs.readdirSync(path.join(root, 'prisma/migrations')).filter(file => fs.existsSync(path.join(root, 'prisma/migrations', file, 'migration.sql'))).sort();
    for (const migration of migrations) await pool.query(fs.readFileSync(path.join(root, 'prisma/migrations', migration, 'migration.sql'), 'utf8'));
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const fees = new PaymentFeeService(prisma);
    const charges = new PaymentChargeService(prisma, fees);
    const eligibility = new FinancialEligibilityService(prisma);
    const settlements = new SettlementsService(prisma);
    await prisma.platformIntegrationState.upsert({ where: { integration: 'EFI_PAYMENTS' }, create: { integration: 'EFI_PAYMENTS', enabled: true }, update: { enabled: true } });
    await fees.createVersion(null, { billingMethod: 'PIX', efiFee: { kind: 'FIXED', amountCents: 100 }, platformFee: { kind: 'PERCENTAGE', basisPoints: 250 }, effectiveFrom: new Date(0) });

    let accountSeq = 3000;
    async function tenant(label, document) {
      const company = await prisma.company.create({ data: { corporateName: label, email: `${label}@example.test`, phoneNumber: `55119${accountSeq}0000`, document } });
      const account = String(++accountSeq);
      const identity = await prisma.efiAccountIdentity.create({ data: { ownership: 'COMPANY', companyId: company.id, environment: 'HOMOLOGATION', holderDocument: document, efiAccountNumber: account, payeeCode: `payee${account}`, pixKey: `chave-${account}`, healthStatus: 'HEALTHY' } });
      const credential = await prisma.efiCredentialVersion.create({ data: { identityId: identity.id, version: 1, status: 'ACTIVE', encryptedClientId: 'c', encryptedClientSecret: 's', encryptedCertificate: 'p12', credentialKeyVersion: 'v1', certificateFingerprint: fingerprint(), certificateExpiresAt: new Date(Date.now() + 90 * 86400000) } });
      await prisma.$transaction(async (tx) => {
        const profile = await tx.financialProfileVersion.create({ data: { companyId: company.id, version: 1, status: 'ACTIVE', origin: 'MANUAL_ADMIN', accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', environment: 'HOMOLOGATION', enabledMethods: ['PIX', 'BOLIX'], issuerIdentityId: identity.id, issuerCredentialVersionId: credential.id, authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION', authorizationReference: 'contrato', ownershipVerifiedAt: new Date(), validatedAt: new Date(), validationHash: 'h', creationIdempotencyKey: randomBytes(8).toString('hex'), activationIdempotencyKey: randomBytes(8).toString('hex'), activatedAt: new Date() } });
        await tx.company.update({ where: { id: company.id }, data: { activeFinancialProfileId: profile.id } });
      });
      const debtor = await prisma.debtor.create({ data: { companyId: company.id, name: 'Pagador', phoneNumber: `55119${accountSeq}1111`, document: '52998224725' } });
      return { company, debtor };
    }
    async function issued({ company, debtor }, terms = {}, daysOverdue = 1) {
      const dueDate = new Date(Date.now() - daysOverdue * 86400000);
      dueDate.setUTCHours(0, 0, 0, 0);
      const invoice = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate, lateFineBasisPoints: 0, lateInterestMonthlyBasisPoints: 0, paymentDaysAfterDue: 30, ...terms } });
      const charge = await charges.createDraft(company.id, invoice.id, 'PIX', 10000, await eligibility.resolveIssuance(company.id, 'PIX'));
      await charges.markIssued(charge.id, company.id, { gatewayId: charge.efiTxid, txid: charge.efiTxid, paymentLink: 'https://example.test', expiresAt: new Date(Date.now() + 86400000) });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { gatewayId: charge.efiTxid, efiTxid: charge.efiTxid, status: 'PENDING' } });
      return { invoice, charge: await prisma.paymentCharge.findUnique({ where: { id: charge.id } }) };
    }
    const settlementOf = (chargeId) => prisma.paymentSettlement.findUnique({ where: { paymentChargeId: chargeId }, include: { divergences: true } });
    const ledger = (chargeId) => prisma.financialLedgerEntry.findMany({ where: { paymentChargeId: chargeId }, orderBy: { idempotencyKey: 'asc' } });
    const sumOf = (entries, kind) => entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry.amountCents, 0);
    const pix = (reference) => ({ source: 'PROVIDER_WEBHOOK', reference, distinctPayment: true });

    const alpha = await tenant('alpha', '11222333000181');
    const beta = await tenant('beta', '45723174000110');
    const admin = await prisma.user.create({ data: { email: 'admin@example.test', name: 'Admin', password: 'hash', role: 'PLATFORM_ADMIN', companyId: alpha.company.id } });

    // 1. Payment → idempotent ledger; concurrent identical notifications settle once.
    const a1 = await issued(alpha);
    const settled = await Promise.all([1, 2, 3].map(() => charges.recordSettlement(a1.charge, null, 'CONCLUIDA', 10000, pix('E2E-A1'))));
    assert.equal(settled.filter(Boolean).length, 1, 'one settlement');
    let entries = await ledger(a1.charge.id);
    assert.deepEqual(entries.map((entry) => [entry.kind, entry.amountCents, entry.estimated]).sort(), [['EFI_FEE', -100, true], ['PAYMENT', 10000, false], ['PLATFORM_FEE', -250, false]]);
    assert.equal(entries.find((entry) => entry.kind === 'PAYMENT').evidenceReference, 'E2E-A1');
    let s1 = await settlementOf(a1.charge.id);
    assert.equal(s1.status, 'AWAITING_EVIDENCE');
    assert.equal(s1.evidenceStatus, 'PENDING');
    assert.equal(s1.platformFeeDueCents, 250);
    // The effective Efí fee arrives later: one confirmed difference, never an update.
    await charges.recordSettlement(a1.charge, 130, 'CONCLUIDA', 10000, pix('E2E-A1'));
    await charges.recordSettlement(a1.charge, 130, 'CONCLUIDA', 10000, pix('E2E-A1'));
    entries = await ledger(a1.charge.id);
    assert.equal(entries.length, 4);
    assert.equal(sumOf(entries, 'EFI_FEE'), -130);
    assert.deepEqual(entries.filter((entry) => entry.kind === 'EFI_FEE').map((entry) => [entry.amountCents, entry.estimated]), [[-100, true], [-30, false]]);
    await assert.rejects(pool.query(`UPDATE "FinancialLedgerEntry" SET "amountCents" = 1 WHERE id = $1`, [entries[0].id]), /LEDGER_APPEND_ONLY/);
    await assert.rejects(pool.query(`DELETE FROM "FinancialLedgerEntry" WHERE id = $1`, [entries[0].id]), /LEDGER_APPEND_ONLY/);
    console.log('PASS verified payment becomes an idempotent, append-only ledger; late effective fee is a difference entry');

    // 2. A second Pix on a paid charge is money to return, not a second settlement.
    await Promise.all([1, 2].map(() => charges.recordSettlement(a1.charge, null, 'CONCLUIDA', 10000, pix('E2E-A1-BIS'))));
    entries = await ledger(a1.charge.id);
    assert.equal(sumOf(entries, 'DUPLICATE_PAYMENT'), 10000);
    assert.equal(sumOf(entries, 'PAYMENT'), 10000, 'charge figures unchanged');
    s1 = await settlementOf(a1.charge.id);
    assert.equal(s1.status, 'DIVERGENT');
    const duplicate = s1.divergences.find((row) => row.code === 'DUPLICATE_PAYMENT');
    assert.equal(duplicate.reference, 'E2E-A1-BIS');
    await assert.rejects(settlements.resolveDivergence(admin.id, duplicate.id, { decision: 'REFUND_REGISTERED' }), (error) => code(error) === 'DECISION_INCOMPLETE');
    await assert.rejects(settlements.resolveDivergence(admin.id, duplicate.id, { decision: 'ACCEPT_AS_SETTLEMENT', note: 'x' }), (error) => code(error) === 'DECISION_NOT_ALLOWED');
    await settlements.resolveDivergence(admin.id, duplicate.id, { decision: 'REFUND_REGISTERED', reference: 'devolucao-123' });
    await settlements.resolveDivergence(admin.id, duplicate.id, { decision: 'REFUND_REGISTERED', reference: 'devolucao-123' });
    await assert.rejects(settlements.resolveDivergence(admin.id, duplicate.id, { decision: 'KEEP_AS_CREDIT', note: 'x' }), (error) => code(error) === 'DIVERGENCE_ALREADY_RESOLVED');
    await assert.rejects(pool.query(`UPDATE "SettlementDivergence" SET "decision" = 'KEEP_AS_CREDIT' WHERE id = $1`, [duplicate.id]), /DIVERGENCE_RESOLVED/);
    assert.equal((await settlementOf(a1.charge.id)).status, 'AWAITING_EVIDENCE');
    console.log('PASS duplicate payment kept outside the charge figures and decided once, with a reference');

    // 3. Paid amount divergences.
    const under = await issued(alpha);
    await charges.recordSettlement(under.charge, null, 'CONCLUIDA', 9000, pix('E2E-UNDER'));
    const underSettlement = await settlementOf(under.charge.id);
    const below = underSettlement.divergences.find((row) => row.code === 'PAYMENT_BELOW_CHARGE');
    assert.equal(below.amountCents, 1000);
    const due = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await assert.rejects(settlements.resolveDivergence(admin.id, below.id, { decision: 'ISSUE_COMPLEMENTARY', dueDate: '2000-01-01' }), (error) => code(error) === 'DECISION_INCOMPLETE');
    const resolvedBelow = await settlements.resolveDivergence(admin.id, below.id, { decision: 'ISSUE_COMPLEMENTARY', dueDate: due });
    const complement = await prisma.invoice.findUnique({ where: { id: resolvedBelow.complementaryInvoiceId } });
    assert.equal(Number(complement.originalAmount), 10);
    assert.equal(complement.complementsInvoiceId, under.invoice.id);
    assert.equal(complement.status, 'DRAFT');
    assert.equal(complement.debtorId, under.invoice.debtorId);
    const within = await issued(alpha, { lateFineBasisPoints: 200, lateInterestMonthlyBasisPoints: 100 }, 10);
    await charges.recordSettlement(within.charge, null, 'CONCLUIDA', 10220, pix('E2E-WITHIN'));
    assert.equal((await settlementOf(within.charge.id)).divergences.length, 0, 'fine and interest within the terms');
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: within.charge.id } })).effectivePlatformFeeCents, 256);
    const over = await issued(alpha);
    await charges.recordSettlement(over.charge, null, 'CONCLUIDA', 10300, pix('E2E-OVER'));
    assert.equal((await settlementOf(over.charge.id)).divergences.find((row) => row.code === 'PAYMENT_ABOVE_EXPECTED').amountCents, 300);
    console.log('PASS underpayment → complementary invoice, fine/interest within terms accepted, unexplained overpayment flagged');

    // 4. CifraMais fee evidence: server-side totals, one use per reference, concurrent requests.
    const b1 = await issued(beta);
    const b2 = await issued(beta);
    await charges.recordSettlement(b1.charge, null, 'CONCLUIDA', 10000, pix('E2E-B1'));
    await charges.recordSettlement(b2.charge, null, 'CONCLUIDA', 10000, pix('E2E-B2'));
    const ids = [(await settlementOf(b1.charge.id)).id, (await settlementOf(b2.charge.id)).id, s1.id];
    const racing = await Promise.allSettled([
      settlements.recordPlatformFeeEvidence(admin.id, { settlementIds: ids, reference: 'extrato-01', receivedAmountCents: 750 }),
      settlements.recordPlatformFeeEvidence(admin.id, { settlementIds: ids, reference: 'extrato-01', receivedAmountCents: 750 }),
      settlements.recordPlatformFeeEvidence(admin.id, { settlementIds: [ids[0]], reference: 'extrato-02', receivedAmountCents: 250 }),
    ]);
    const fulfilled = racing.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    const evidenceIds = new Set(fulfilled.map((value) => value.id));
    assert.equal(await prisma.platformFeeEvidence.count(), 1, 'only one evidence covers a settlement');
    assert.equal(evidenceIds.size, 1);
    if (fulfilled[0].reference === 'extrato-01') {
      assert.equal(fulfilled[0].expectedAmountCents, 750);
      assert.equal(fulfilled[0].matched, true);
      for (const id of ids) assert.equal((await prisma.paymentSettlement.findUnique({ where: { id } })).status, 'RECONCILED');
    }
    await assert.rejects(settlements.recordPlatformFeeEvidence(admin.id, { settlementIds: [ids[0]], reference: fulfilled[0].reference, receivedAmountCents: 1 }), (error) => code(error) === 'EVIDENCE_REFERENCE_REUSED');
    await assert.rejects(pool.query(`UPDATE "PlatformFeeEvidence" SET "receivedAmountCents" = 1`), /EVIDENCE_IMMUTABLE/);
    const b3 = await issued(beta);
    await charges.recordSettlement(b3.charge, null, 'CONCLUIDA', 10000, pix('E2E-B3'));
    const s3 = await settlementOf(b3.charge.id);
    const mismatch = await settlements.recordPlatformFeeEvidence(admin.id, { settlementIds: [s3.id], reference: 'extrato-03', receivedAmountCents: 240 });
    assert.equal(mismatch.matched, false);
    const s3After = await settlementOf(b3.charge.id);
    assert.equal(s3After.evidenceStatus, 'MISMATCH');
    assert.equal(s3After.status, 'DIVERGENT');
    await settlements.resolveDivergence(admin.id, s3After.divergences.find((row) => row.code === 'PLATFORM_FEE_EVIDENCE_MISMATCH').id, { decision: 'ADJUSTMENT_SETTLED', reference: 'ajuste-10c' });
    assert.equal((await settlementOf(b3.charge.id)).status, 'RECONCILED');
    await assert.rejects(settlements.recordPlatformFeeEvidence(admin.id, { settlementIds: [s3.id], reference: 'extrato-04', receivedAmountCents: 250 }), (error) => code(error) === 'SETTLEMENT_NOT_AWAITING_EVIDENCE');
    console.log('PASS fee evidence: expected total computed by the server, concurrent requests cannot cover the same fee twice, mismatch goes to review');

    // 5. Refunds keep the trail; the optional fee reversal is proportional and owed back.
    await settlements.updateOptions(admin.id, alpha.company.id, true);
    const refunded = await issued(alpha, { lateFineBasisPoints: 200, lateInterestMonthlyBasisPoints: 100 }, 10);
    await charges.recordSettlement(refunded.charge, null, 'CONCLUIDA', 10200, pix('E2E-R'));
    await charges.recordPixRefunds(refunded.charge, [{ providerRefundId: 'E2E-R:d1', amountCents: 5100 }]);
    await charges.recordPixRefunds(refunded.charge, [{ providerRefundId: 'E2E-R:d1', amountCents: 5100 }]);
    entries = await ledger(refunded.charge.id);
    assert.equal(sumOf(entries, 'REFUND'), -5100);
    assert.equal(sumOf(entries, 'PLATFORM_FEE_REVERSAL'), 128, 'half of the 255 fee, rounded');
    await charges.recordPixRefunds(refunded.charge, [{ providerRefundId: 'E2E-R:d2', amountCents: 5100 }]);
    const refundedCharge = await prisma.paymentCharge.findUnique({ where: { id: refunded.charge.id } });
    assert.equal(refundedCharge.status, 'REFUNDED', 'refund limit is the amount paid');
    entries = await ledger(refunded.charge.id);
    assert.equal(sumOf(entries, 'REFUND'), -10200);
    assert.equal(sumOf(entries, 'PLATFORM_FEE_REVERSAL'), 255);
    assert.equal(sumOf(entries, 'PAYMENT'), 10200, 'the payment entry is never removed');
    const reversals = (await settlementOf(refunded.charge.id)).divergences.filter((row) => row.code === 'PLATFORM_FEE_REVERSAL_DUE');
    assert.deepEqual(reversals.map((row) => row.amountCents).sort((a, b) => a - b), [128, 255]);
    await settlements.updateOptions(admin.id, alpha.company.id, false);
    const plain = await issued(alpha);
    await charges.recordSettlement(plain.charge, null, 'CONCLUIDA', 10000, pix('E2E-P'));
    await charges.transition(plain.charge.id, alpha.company.id, 'REFUNDED', { gatewayStatusRaw: 'refunded' }, 'refunded');
    entries = await ledger(plain.charge.id);
    assert.equal(sumOf(entries, 'REFUND'), -10000);
    assert.equal(sumOf(entries, 'PLATFORM_FEE_REVERSAL'), 0, 'no reversal by default');
    console.log('PASS refunds add compensating entries; fee reversal only with the company option, proportional and owed back');

    // 6. Tenant rules in the database; a charge without CifraMais fee needs no evidence.
    const otherCharge = await prisma.paymentCharge.findUnique({ where: { id: b1.charge.id } });
    await assert.rejects(pool.query(`INSERT INTO "PaymentSettlement" (id, "companyId", "paymentChargeId", "invoiceId", status, "evidenceStatus", "platformFeeDueCents", "updatedAt") VALUES ('x', $1, $2, $3, 'RECONCILED', 'NOT_REQUIRED', 0, now())`, [alpha.company.id, otherCharge.id, otherCharge.invoiceId]), /SETTLEMENT_CHARGE_MISMATCH/);
    await assert.rejects(pool.query(`INSERT INTO "FinancialLedgerEntry" (id, "companyId", "paymentChargeId", "settlementId", kind, "amountCents", source, "idempotencyKey") VALUES ('x', $1, $2, $3, 'PAYMENT', 1, 'ADMIN', 'forged')`, [alpha.company.id, otherCharge.id, ids[0]]), /LEDGER_SETTLEMENT_MISMATCH/);
    const gamma = await tenant('gamma', '19131243000197');
    await fees.createVersion(gamma.company.id, { billingMethod: 'PIX', efiFee: { kind: 'FIXED', amountCents: 100 }, platformFee: { kind: 'PERCENTAGE', basisPoints: 0 }, effectiveFrom: new Date(0) });
    const free = await issued(gamma);
    await charges.recordSettlement(free.charge, null, 'CONCLUIDA', 10000, pix('E2E-G'));
    const freeSettlement = await settlementOf(free.charge.id);
    assert.equal(freeSettlement.evidenceStatus, 'NOT_REQUIRED');
    assert.equal(freeSettlement.status, 'RECONCILED');
    console.log('PASS settlements and ledger entries cannot cross tenants; no fee means nothing to evidence');

    // 7. Summary and list reflect the ledger.
    const summary = await settlements.summary(beta.company.id);
    assert.equal(summary.receivedCents, 30000);
    assert.equal(summary.platformFeeCents, 750);
    assert.equal(summary.efiFeeEstimatedCents, 300);
    const listed = await settlements.list({ companyId: alpha.company.id, status: 'DIVERGENT', page: 1, pageSize: 50 });
    assert.ok(listed.data.every((row) => row.companyId === alpha.company.id && row.status === 'DIVERGENT'));
    assert.ok(listed.data.some((row) => row.paymentChargeId === over.charge.id));
    const detail = await settlements.detail(s1.id);
    assert.equal(detail.totals.customerNetCents, 10000 - 130 - 250);
    const audits = await prisma.auditLog.count({ where: { action: { in: ['PLATFORM_FEE_EVIDENCE_RECORDED', 'SETTLEMENT_DIVERGENCE_RESOLVED', 'SETTLEMENT_OPTIONS_UPDATED'] } } });
    assert.ok(audits >= 6);
    console.log('PASS summary, filtered list, detail totals and audit trail');

    // 8. Company view and financial history show only the tenant's own data.
    const betaView = await settlements.companyOverview(beta.company.id, 1, 50);
    assert.equal(betaView.total, 3);
    assert.equal(betaView.totals.receivedCents, 30000);
    assert.equal(betaView.totals.netCents, 30000 - 300 - 750);
    assert.ok(betaView.data.every((row) => row.debtorName === 'Pagador'));
    assert.equal(JSON.stringify(betaView).includes('extrato'), false, 'no evidence details for the company');
    const alphaView = await settlements.companyOverview(alpha.company.id, 1, 50);
    assert.ok(alphaView.data.some((row) => row.situation === 'IN_REVIEW'));
    assert.ok(alphaView.data.some((row) => row.situation === 'REFUNDED'));
    const history = new FinancialHistoryService(prisma);
    const alphaHistory = await history.get(alpha.company.id);
    assert.equal(alphaHistory.versions.length, 1);
    assert.match(alphaHistory.versions[0].issuerAccount, /^••••/);
    assert.ok(alphaHistory.events.some((event) => event.action === 'SETTLEMENT_DIVERGENCE_RESOLVED'));
    assert.ok(alphaHistory.events.some((event) => event.action === 'SETTLEMENT_OPTIONS_UPDATED'));
    const betaIds = new Set((await prisma.paymentSettlement.findMany({ where: { companyId: beta.company.id } })).map((row) => row.id));
    assert.equal(JSON.stringify(alphaHistory).split('"').some((token) => betaIds.has(token)), false, 'no other tenant in the history');
    const gammaHistory = await history.get(gamma.company.id);
    assert.equal(gammaHistory.events.length, 0);
    console.log('PASS company receipts and financial history are tenant-scoped and redacted');
    console.log(`PASS settlements on ${migrations.length} migrations in PostgreSQL 16`);
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    if (containerStarted) docker(['rm', '-f', name]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
