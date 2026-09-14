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
const { InvoicesService } = require('../src/invoices/invoices.service.ts');
const name = `efi-payment-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
  return result.stdout.trim();
}
let pool;
let prisma;
let containerStarted = false;
(async () => {
  try {
    docker(['run', '-d', '--name', name, '--memory', '256m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=payments', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
    containerStarted = true;
    pool = new Pool({ host: '127.0.0.1', port: Number(docker(['port', name, '5432/tcp']).split(':').at(-1)), database: 'payments', user: 'postgres', password, connectionTimeoutMillis: 1000 });
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
    const invoices = new InvoicesService(prisma, {}, { cancelPaymentForInvoice: async () => ({ providerAction: 'PIX_COBV_REMOVED', gatewayStatusRaw: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }) }, fees);
    const company = await prisma.company.create({ data: { corporateName: 'Payments fixture', email: 'payments@example.test', phoneNumber: '5511999999999', document: '12345678000195' } });
    const other = await prisma.company.create({ data: { corporateName: 'Other fixture', email: 'other@example.test', phoneNumber: '5511888888888', document: '98765432000100' } });
    const debtor = await prisma.debtor.create({ data: { companyId: company.id, name: 'Fixture', phoneNumber: '5511999999999' } });
    const feeInput = { billingMethod: 'PIX', efiFee: { kind: 'FIXED', amountCents: 100 }, platformFee: { kind: 'PERCENTAGE', basisPoints: 250 }, effectiveFrom: new Date(0) };
    await fees.createVersion(null, feeInput);
    async function fixture() {
      const invoice = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate: new Date(Date.now() - 86400000) } });
      const charge = await charges.createDraft(company.id, invoice.id, 'PIX', 10000);
      await charges.markIssued(charge.id, company.id, { gatewayId: charge.efiTxid, txid: charge.efiTxid, paymentLink: 'https://example.test/pay', expiresAt: invoice.dueDate });
      await prisma.invoice.update({ where: { id: invoice.id, companyId: company.id }, data: { gatewayId: charge.efiTxid, efiTxid: charge.efiTxid, status: 'PENDING' } });
      return { invoice, charge };
    }
    const { invoice, charge } = await fixture();
    const results = await Promise.all([charges.recordSettlement(charge, 120, 'CONCLUIDA'), charges.recordSettlement(charge, 120, 'CONCLUIDA')]);
    assert.equal(results.filter(Boolean).length, 1, 'settlement changes invoice exactly once');
    assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).status, 'PAID');
    assert.equal(await prisma.collectionLog.count({ where: { companyId: company.id, invoiceId: invoice.id, actionType: 'EFI_FEE_DIVERGENCE' } }), 1);
    assert.equal((await fees.listDivergences(1)).total, 1);
    await Promise.all([1, 2].map(() => charges.recordPixRefunds(charge, [{ providerRefundId: 'first', amountCents: 4000 }])));
    assert.equal(await prisma.paymentChargeStatusHistory.count({ where: { paymentChargeId: charge.id, providerStatus: 'DEVOLVIDO' } }), 1);
    await charges.recordSettlement(charge, 121, 'CONCLUIDA');
    let current = await prisma.paymentCharge.findUnique({ where: { id: charge.id } });
    assert.equal(current.gatewayStatusRaw, 'partially_refunded');
    assert.equal(current.effectiveEfiFeeCents, 121);
    const listed = (await invoices.findAll(company.id)).find(row => row.invoiceId === invoice.id);
    assert.deepEqual(listed.payment.financialSummary, { grossAmountCents: 10000, totalFeeCents: 371, netAmountCents: 9629, estimated: false, status: 'PAID' });
    await assert.rejects(charges.recordPixRefunds(charge, [{ providerRefundId: 'too-large', amountCents: 6001 }]));
    assert.equal(await prisma.paymentChargeStatusHistory.count({ where: { paymentChargeId: charge.id, providerStatus: 'DEVOLVIDO' } }), 1, 'invalid refund transaction rolled back');
    await charges.recordPixRefunds(charge, [{ providerRefundId: 'first', amountCents: 4000 }, { providerRefundId: 'last', amountCents: 6000 }]);
    await charges.recordSettlement(charge, null, 'CONCLUIDA');
    current = await prisma.paymentCharge.findUnique({ where: { id: charge.id } });
    assert.equal(current.status, 'REFUNDED');
    assert.equal(current.effectiveEfiFeeCents, 121);
    assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).status, 'CANCELED');
    console.log('PASS concurrent settlement, actual fee divergence, partial/full duplicate refunds, rollback and late settlement');

    const original = await fixture();
    const replacement = await charges.createDraft(company.id, original.invoice.id, 'PIX', 10000, original.charge.id, new Date(Date.now() + 86400000));
    await charges.transition(original.charge.id, company.id, 'REPLACED', {});
    await charges.markIssued(replacement.id, company.id, { gatewayId: replacement.efiTxid, txid: replacement.efiTxid, paymentLink: 'https://example.test/new', expiresAt: new Date(Date.now() + 86400000) });
    await prisma.invoice.update({ where: { id: original.invoice.id, companyId: company.id }, data: { gatewayId: replacement.efiTxid, efiTxid: replacement.efiTxid } });
    await charges.recordSettlement(original.charge, 120, 'CONCLUIDA');
    await charges.recordPixRefunds(original.charge, [{ providerRefundId: 'old-refund', amountCents: 10000 }]);
    assert.equal((await prisma.invoice.findUnique({ where: { id: original.invoice.id } })).status, 'PENDING', 'old payment/refund cannot mutate replacement invoice');
    await charges.recordSettlement(replacement, null, 'CONCLUIDA');
    await charges.transition(original.charge.id, company.id, 'REFUNDED', { gatewayStatusRaw: 'refunded' }, 'refunded');
    assert.equal((await prisma.invoice.findUnique({ where: { id: original.invoice.id } })).status, 'PAID');
    await assert.rejects(charges.recordPixRefunds({ ...replacement, companyId: other.id }, [{ providerRefundId: 'wrong-tenant', amountCents: 10000 }]));
    console.log('PASS replaced charge ownership and cross-tenant refund rejection');

    const racing = await fixture();
    await charges.createDraft(company.id, racing.invoice.id, 'PIX', 10000, racing.charge.id, new Date(Date.now() + 86400000));
    await charges.recordSettlement(racing.charge, null, 'CONCLUIDA');
    assert.equal((await prisma.invoice.findUnique({ where: { id: racing.invoice.id } })).status, 'PAID', 'payment during replacement cancellation still belongs to current charge');
    console.log('PASS payment during replacement reservation stops the invoice from being reissued');

    const fresh = await fixture();
    const oldVersion = fresh.charge.feeVersionId;
    await fees.createVersion(company.id, { ...feeInput, efiFee: { kind: 'FIXED', amountCents: 200 } });
    const next = await charges.createDraft(company.id, fresh.invoice.id, 'PIX', 10000, fresh.charge.id, new Date(Date.now() + 86400000));
    assert.notEqual(next.feeVersionId, oldVersion);
    assert.equal(next.estimatedEfiFeeCents, 200);
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: fresh.charge.id } })).estimatedEfiFeeCents, 100);
    console.log('PASS replacement snapshots current override while preserving old fees');
    const canceling = await fixture();
    await invoices.cancelInvoice(company.id, canceling.invoice.id);
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: canceling.charge.id } })).status, 'CANCELED', 'manual cancellation closes charge and invoice together');
    console.log('PASS manual cancellation synchronizes charge lifecycle');
    console.log(`PASS payment lifecycle on ${migrations.length} migrations in PostgreSQL 16`);
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    if (containerStarted) docker(['rm', '-f', name]);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
