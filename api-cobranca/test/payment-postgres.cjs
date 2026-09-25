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
const { FinancialEligibilityService } = require('../src/financial-activation/financial-eligibility.service.ts');
const { EfiService } = require('../src/payment/efi.service.ts');
const { PaymentService } = require('../src/payment/payment.service.ts');
const { BillingService } = require('../src/billing/billing.service.ts');
const { PaymentAdminController } = require('../src/payment/payment-admin.controller.ts');
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
    const eligibility = new FinancialEligibilityService(prisma);
    await prisma.platformIntegrationState.upsert({ where: { integration: 'EFI_PAYMENTS' }, create: { integration: 'EFI_PAYMENTS', enabled: true }, update: { enabled: true } });
    // Publishes a manual profile on its own Efí account, superseding the current one.
    let profileSeq = 0;
    async function activate(companyId, account) {
      const target = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      const identity = await prisma.efiAccountIdentity.create({ data: { ownership: 'COMPANY', companyId, environment: 'HOMOLOGATION', holderDocument: target.document, efiAccountNumber: account, payeeCode: `payee${account}`, pixKey: `chave-${account}`, healthStatus: 'HEALTHY' } });
      const credential = await prisma.efiCredentialVersion.create({ data: { identityId: identity.id, version: 1, status: 'ACTIVE', encryptedClientId: 'c', encryptedClientSecret: 's', encryptedCertificate: 'p12', credentialKeyVersion: 'v1', certificateFingerprint: Array.from(randomBytes(32), (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':'), certificateExpiresAt: new Date(Date.now() + 90 * 86400000) } });
      await prisma.$transaction(async (tx) => {
        await tx.financialProfileVersion.updateMany({ where: { companyId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
        const profile = await tx.financialProfileVersion.create({ data: { companyId, version: ++profileSeq, status: 'ACTIVE', origin: 'MANUAL_ADMIN', accountMode: 'CUSTOMER_ACCOUNT', payoutMode: 'DIRECT_TO_CUSTOMER', environment: 'HOMOLOGATION', enabledMethods: ['PIX', 'BOLIX'], issuerIdentityId: identity.id, issuerCredentialVersionId: credential.id, authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION', authorizationReference: 'contrato', ownershipVerifiedAt: new Date(), validatedAt: new Date(), validationHash: 'h', creationIdempotencyKey: randomBytes(8).toString('hex'), activationIdempotencyKey: randomBytes(8).toString('hex'), activatedAt: new Date() } });
        await tx.company.update({ where: { id: companyId }, data: { activeFinancialProfileId: profile.id } });
      });
      return identity;
    }
    const identityA = await activate(company.id, '1001');
    const issuance = () => eligibility.resolveIssuance(company.id, 'PIX');
    async function fixture() {
      const invoice = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate: new Date(Date.now() - 86400000) } });
      const charge = await charges.createDraft(company.id, invoice.id, 'PIX', 10000, await issuance());
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
    const replacement = await charges.createDraft(company.id, original.invoice.id, 'PIX', 10000, await issuance(), original.charge.id, new Date(Date.now() + 86400000));
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
    await charges.createDraft(company.id, racing.invoice.id, 'PIX', 10000, await issuance(), racing.charge.id, new Date(Date.now() + 86400000));
    await charges.recordSettlement(racing.charge, null, 'CONCLUIDA');
    assert.equal((await prisma.invoice.findUnique({ where: { id: racing.invoice.id } })).status, 'PAID', 'payment during replacement cancellation still belongs to current charge');
    console.log('PASS payment during replacement reservation stops the invoice from being reissued');

    const fresh = await fixture();
    const oldVersion = fresh.charge.feeVersionId;
    await fees.createVersion(company.id, { ...feeInput, efiFee: { kind: 'FIXED', amountCents: 200 } });
    const next = await charges.createDraft(company.id, fresh.invoice.id, 'PIX', 10000, await issuance(), fresh.charge.id, new Date(Date.now() + 86400000));
    assert.notEqual(next.feeVersionId, oldVersion);
    assert.equal(next.estimatedEfiFeeCents, 200);
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: fresh.charge.id } })).estimatedEfiFeeCents, 100);
    console.log('PASS replacement snapshots current override while preserving old fees');
    const canceling = await fixture();
    await invoices.cancelInvoice(company.id, canceling.invoice.id);
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: canceling.charge.id } })).status, 'CANCELED', 'manual cancellation closes charge and invoice together');
    console.log('PASS manual cancellation synchronizes charge lifecycle');

    // Etapa 6: the charge carries its issuing account for its whole life.
    const efiSdkAccounts = [];
    let notification = null;
    const efi = new EfiService({ get: () => undefined, getOrThrow: () => 'x' }, prisma, { decrypt: (value) => value }, { notifyPaidInvoice: async () => undefined }, null, charges);
    efi.createSdkClient = (account) => {
      efiSdkAccounts.push(account);
      return {
        pixUpdateDueCharge: async () => ({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }),
        getNotification: async () => notification,
      };
    };
    const onA = await fixture();
    assert.equal(onA.charge.issuerIdentityId, identityA.id);
    assert.equal(onA.charge.financialEnvironment, 'HOMOLOGATION');
    assert.equal(onA.charge.distributionSnapshot.grossAmountCents, 10000);
    await assert.rejects(prisma.paymentCharge.update({ where: { id: onA.charge.id }, data: { issuerIdentityId: null } }), 'the issuing account of a charge cannot change');
    const staleContext = await issuance();
    const identityB = await activate(company.id, '2002');
    const stale = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate: new Date() } });
    await assert.rejects(charges.createDraft(company.id, stale.id, 'PIX', 10000, staleContext), (error) => error.response?.code === 'FINANCIAL_PROFILE_CHANGED');
    assert.equal(await prisma.paymentCharge.count({ where: { invoiceId: stale.id } }), 0, 'no reservation under a superseded profile');
    const onB = await fixture();
    assert.equal(onB.charge.issuerIdentityId, identityB.id);
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: onA.charge.id } })).issuerIdentityId, identityA.id);
    await efi.cancelPixDueCharge(company.id, onA.charge.efiTxid);
    assert.equal(efiSdkAccounts.at(-1).efiAccountNumber, '1001', 'an old charge is canceled on the account that issued it');
    await efi.cancelPixDueCharge(company.id, onB.charge.efiTxid);
    assert.equal(efiSdkAccounts.at(-1).efiAccountNumber, '2002');
    console.log('PASS charge context fixed at reservation, stale profile refused, old charge operated on its own account after a switch');

    // Pix: only the issuing key settles; unknown txids are recorded without payload.
    await efi.handlePixWebhook({ pix: [{ txid: onB.charge.efiTxid, chave: 'chave-1001', valor: '100.00' }] });
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: onB.charge.id } })).status, 'ACTIVE', 'a receipt on another key does not settle');
    const mismatch = await prisma.paymentWebhookAnomaly.findFirst({ where: { reasonCode: 'RECEIVER_MISMATCH' } });
    assert.equal(mismatch.externalReference, onB.charge.efiTxid);
    assert.equal(mismatch.companyId, company.id);
    await efi.handlePixWebhook({ pix: [{ txid: 'nao-existe', chave: 'x', valor: '1.00' }] });
    await efi.handlePixWebhook({ pix: [{ txid: 'nao-existe', chave: 'x', valor: '1.00' }] });
    assert.equal((await prisma.paymentWebhookAnomaly.findFirst({ where: { reasonCode: 'UNKNOWN_TXID', externalReference: 'nao-existe' } })).occurrences, 2);
    // Paid with fine and interest: the CifraMais fee follows the amount actually paid.
    await efi.handlePixWebhook({ pix: [{ txid: onB.charge.efiTxid, chave: 'chave-2002', valor: '106.50', endToEndId: 'E1' }] });
    const paidB = await prisma.paymentCharge.findUnique({ where: { id: onB.charge.id } });
    assert.equal(paidB.status, 'PAID');
    assert.equal(paidB.paidAmountCents, 10650);
    const feeVersion = await prisma.paymentFeeVersion.findUnique({ where: { id: paidB.feeVersionId } });
    assert.equal(paidB.effectivePlatformFeeCents, fees.calculateQuote(10650, feeVersion).estimatedPlatformFeeCents);
    assert.ok(paidB.effectivePlatformFeeCents > paidB.estimatedPlatformFeeCents);
    console.log('PASS Pix receiver check, anomaly counting and platform fee on the paid amount');

    // Charges webhook: the account in the URL picks credentials and scopes the lookup.
    const partial = await fixture();
    notification = { data: [{ custom_id: partial.charge.id, status: { current: 'paid' }, value: 9000 }] };
    await efi.handleChargesWebhook({ notification: 'n1' }, undefined, identityA.id);
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: partial.charge.id } })).status, 'ACTIVE', 'account A cannot settle a charge issued on B');
    assert.equal(await prisma.paymentWebhookAnomaly.count({ where: { source: 'CHARGES', reasonCode: 'UNKNOWN_CHARGE', externalReference: partial.charge.id } }), 1);
    await efi.handleChargesWebhook({ notification: 'n1' }, undefined, randomBytes(16).toString('hex'));
    assert.equal(await prisma.paymentWebhookAnomaly.count({ where: { source: 'CHARGES', reasonCode: 'UNKNOWN_ACCOUNT' } }), 1);
    await efi.handleChargesWebhook({ notification: 'n1' }, undefined, identityB.id);
    assert.equal(efiSdkAccounts.at(-1).efiAccountNumber, '2002');
    const paidPartial = await prisma.paymentCharge.findUnique({ where: { id: partial.charge.id } });
    assert.equal(paidPartial.status, 'PAID');
    assert.equal(paidPartial.paidAmountCents, 9000);
    assert.equal(await prisma.collectionLog.count({ where: { invoiceId: partial.invoice.id, actionType: 'PAYMENT_AMOUNT_DIVERGENCE' } }), 1, 'a payment below the charge needs review');
    await assert.rejects(pool.query(`INSERT INTO "PaymentWebhookAnomaly" (id, source, "reasonCode", "externalReference", "lastSeenAt") VALUES ('x', 'EMAIL', 'A', 'r', now())`));
    console.log('PASS account-scoped charges webhook, unknown account/charge anomalies and partial payment review');

    // Late terms travel from the invoice to the charge and into the Efí payloads.
    await fees.createVersion(null, { ...feeInput, billingMethod: 'BOLIX' });
    const sent = [];
    const settings = { EFI_PLATFORM_ACCOUNT_NUMBER: '9999', EFI_PLATFORM_CNPJ: '11222333000181', EFI_PLATFORM_PAYEE_CODE: 'platformpayee', EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.test', EFI_WEBHOOK_SECRET: 'hook-secret' };
    const config = { get: (key) => settings[key], getOrThrow: (key) => settings[key] };
    const issuer = new EfiService(config, prisma, { decrypt: (value) => value }, { notifyPaidInvoice: async () => undefined }, { assertIssuable: (companyId, method) => eligibility.resolveIssuance(companyId, method) }, charges);
    issuer.createSdkClient = (account) => ({
      pixSplitConfigId: async () => ({ id: 'split-1' }),
      pixCreateDueCharge: async (params, body) => { sent.push({ kind: 'PIX', account: account.efiAccountNumber, body }); return {}; },
      pixDetailDueCharge: async () => ({ loc: { id: 7, location: 'https://pix.example.test/7' }, status: 'ATIVA' }),
      pixSplitLinkDueCharge: async () => { if (failSplitLink) throw { nome: 'split_rejeitado' }; return {}; },
      getNotification: async () => chargesNotification,
      pixGenerateQRCode: async () => ({ qrcode: '000201pix' }),
      createOneStepCharge: async (params, body) => { sent.push({ kind: 'BOLIX', account: account.efiAccountNumber, body }); return { data: { charge_id: 555, status: 'waiting', barcode: '0019', billet_link: 'https://boleto.example.test', pix: { qrcode: '000201bolix' } } }; },
    });
    let failSplitLink = false;
    let chargesNotification = null;
    const payments = new PaymentService(issuer, prisma, charges, eligibility);
    await prisma.debtor.update({ where: { id: debtor.id }, data: { document: '52998224725', email: 'fixture@example.test' } });
    await prisma.company.update({ where: { id: company.id }, data: { addressStreet: 'Rua A', addressNumber: '1', addressDistrict: 'Centro', addressPostalCode: '01001000', addressCity: 'São Paulo', addressState: 'SP' } });
    const dueDate = new Date(Date.UTC(2030, 0, 10));
    const withTerms = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate, lateFineBasisPoints: 200, lateInterestMonthlyBasisPoints: 150, paymentDaysAfterDue: 10 } });
    await payments.createPayment(withTerms.id, company.id, 'PIX');
    const pixSent = sent.at(-1);
    assert.equal(pixSent.account, '2002', 'issued on the account of the active profile');
    assert.equal(pixSent.body.calendario.validadeAposVencimento, 10);
    assert.deepEqual(pixSent.body.valor.multa, { modalidade: 2, valorPerc: '2.00' });
    assert.deepEqual(pixSent.body.valor.juros, { modalidade: 3, valorPerc: '1.50' });
    const pixCharge = await prisma.paymentCharge.findFirst({ where: { invoiceId: withTerms.id } });
    assert.equal(pixCharge.status, 'ACTIVE');
    assert.equal(pixCharge.lateFineBasisPoints, 200);
    assert.equal(pixCharge.paymentDaysAfterDue, 10);
    assert.equal(pixCharge.expiresAt.toISOString(), new Date(Date.UTC(2030, 0, 21)).toISOString(), 'payable until the last day after due');
    const noTerms = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 80, dueDate, lateFineBasisPoints: 0, lateInterestMonthlyBasisPoints: 0, paymentDaysAfterDue: 0 } });
    await payments.createPayment(noTerms.id, company.id, 'PIX');
    assert.equal(sent.at(-1).body.calendario.validadeAposVencimento, 0);
    assert.equal(sent.at(-1).body.valor.multa, undefined);
    assert.equal(sent.at(-1).body.valor.juros, undefined);
    const bolix = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate, lateFineBasisPoints: 200, lateInterestMonthlyBasisPoints: 100, paymentDaysAfterDue: 30 } });
    await payments.createPayment(bolix.id, company.id, 'BOLIX');
    const bolixSent = sent.at(-1);
    assert.deepEqual(bolixSent.body.payment.banking_billet.configurations, { fine: 200, interest: { value: 100, type: 'monthly' }, days_to_write_off: 30 });
    const notificationUrl = new URL(bolixSent.body.metadata.notification_url);
    assert.equal(notificationUrl.searchParams.get('account'), identityB.id, 'boleto notifications name the issuing account');
    assert.equal(notificationUrl.searchParams.get('companyId'), null);
    console.log('PASS late terms from invoice to charge and Efí payloads (Pix CobV and BOLIX), issued on the active account');

    // Company defaults (Configurações → Cobrança) fill what a new charge leaves empty.
    const billing = new BillingService(prisma, {}, {}, {}, {}, {}, {}, {}, {}, undefined, undefined, fees);
    const saved = await billing.updateSettings(company.id, { preferredBillingMethod: 'PIX', collectionReminderDays: [0], autoGenerateFirstCharge: false, autoDiscountEnabled: false, lateFinePercentage: 2, lateInterestMonthlyPercentage: 1, paymentDaysAfterDue: 15 });
    assert.deepEqual([saved.lateFinePercentage, saved.lateInterestMonthlyPercentage, saved.paymentDaysAfterDue], [2, 1, 15]);
    const kept = await billing.updateSettings(company.id, { preferredBillingMethod: 'PIX', collectionReminderDays: [0], autoGenerateFirstCharge: false, autoDiscountEnabled: false });
    assert.equal(kept.paymentDaysAfterDue, 15, 'absent fields keep the saved default');
    const creator = new InvoicesService(prisma, {}, { hasActiveFinancialProfile: async () => false }, fees);
    const byDefault = await creator.createInvoice(company.id, { debtorId: debtor.id, original_amount: 50, due_date: '2030-02-10', billing_type: 'PIX' });
    assert.deepEqual(byDefault.lateTerms, { late_fine_percentage: 2, late_interest_monthly_percentage: 1, payment_days_after_due: 15 });
    const overridden = await creator.createInvoice(company.id, { debtorId: debtor.id, original_amount: 50, due_date: '2030-02-10', billing_type: 'PIX', late_fine_percentage: 0, late_interest_monthly_percentage: null, payment_days_after_due: 5 });
    assert.deepEqual(overridden.lateTerms, { late_fine_percentage: 0, late_interest_monthly_percentage: 1, payment_days_after_due: 5 });
    await creator.createInvoice(company.id, { debtorId: debtor.id, original_amount: 70, billing_type: 'PIX', recurring: true, due_day: 5, late_interest_monthly_percentage: 0.5 });
    const recurrence = await prisma.recurringInvoice.findFirst({ where: { companyId: company.id }, include: { invoices: true } });
    assert.deepEqual([recurrence.lateFineBasisPoints, recurrence.lateInterestMonthlyBasisPoints, recurrence.paymentDaysAfterDue], [200, 50, 15]);
    assert.ok(recurrence.invoices.length >= 1);
    for (const generated of recurrence.invoices) assert.deepEqual([generated.lateFineBasisPoints, generated.lateInterestMonthlyBasisPoints, generated.paymentDaysAfterDue], [200, 50, 15], 'the recurrence copies its terms to each invoice');
    console.log('PASS company defaults, per-invoice override (zero = none) and recurrence copying its late terms');

    // Operation: stale or uncertain issuances are listed per company for reconciliation.
    const stuckInvoice = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 30, dueDate } });
    const stuck = await charges.createDraft(company.id, stuckInvoice.id, 'PIX', 3000, await issuance());
    await charges.transition(stuck.id, company.id, 'PENDING', { gatewayStatusRaw: 'SUBMITTING' });
    const adminCharges = new PaymentAdminController(issuer, prisma);
    assert.equal((await adminCharges.attention(company.id)).some((row) => row.id === stuck.id), false, 'a fresh submission is not flagged yet');
    await pool.query(`UPDATE "PaymentCharge" SET "updatedAt" = now() - interval '1 hour' WHERE id = $1`, [stuck.id]);
    const attention = await adminCharges.attention(company.id);
    assert.ok(attention.some((row) => row.id === stuck.id && row.gatewayStatusRaw === 'SUBMITTING'));
    assert.equal((await adminCharges.attention(other.id)).length, 0, 'other tenants see nothing');
    console.log('PASS uncertain issuances listed per company for reconciliation');

    // Acceptance matrix (Phase A) — remaining rows.
    // Split link rejected: the QR/link is never published; the charge waits for reconciliation.
    failSplitLink = true;
    const splitFail = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 40, dueDate } });
    await assert.rejects(payments.createPayment(splitFail.id, company.id, 'PIX'));
    failSplitLink = false;
    const splitFailInvoice = await prisma.invoice.findUnique({ where: { id: splitFail.id } });
    assert.equal(splitFailInvoice.efiPixCopiaECola, null, 'no Pix code exposed without the mandatory split');
    assert.equal(splitFailInvoice.status, 'DRAFT');
    const splitFailCharge = await prisma.paymentCharge.findFirst({ where: { invoiceId: splitFail.id } });
    assert.equal(splitFailCharge.status, 'PENDING', 'kept for reconciliation, not failed');
    await assert.rejects(payments.createPayment(splitFail.id, company.id, 'PIX'), (error) => error.response?.code === 'EFI_SUBMISSION_UNCERTAIN', 'never reissued automatically');
    console.log('PASS mandatory split failure: no QR exposed, no duplicate issuance');

    // Payments paused: nothing new is issued, but webhooks and reconciliation keep working.
    const openCharge = await prisma.paymentCharge.findFirst({ where: { invoiceId: withTerms.id } });
    await prisma.platformIntegrationState.update({ where: { integration: 'EFI_PAYMENTS' }, data: { enabled: false } });
    const paused = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 50, dueDate } });
    await assert.rejects(payments.createPayment(paused.id, company.id, 'PIX'), (error) => error.response?.code === 'EFI_PAYMENTS_PAUSED');
    await issuer.handlePixWebhook({ pix: [{ txid: openCharge.efiTxid, chave: 'chave-2002', valor: '102.00', endToEndId: 'E2E-PAUSED' }] });
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: openCharge.id } })).status, 'PAID', 'webhook applied while paused');
    assert.ok(await prisma.paymentSettlement.findUnique({ where: { paymentChargeId: openCharge.id } }));
    await prisma.platformIntegrationState.update({ where: { integration: 'EFI_PAYMENTS' }, data: { enabled: true } });
    console.log('PASS paused payments block issuance only; webhooks and settlement continue');

    // Tampered companyId in the charges webhook URL cannot settle a charge issued with a profile.
    const bolixCharge = await prisma.paymentCharge.findFirst({ where: { invoiceId: bolix.id } });
    await prisma.gatewayAccount.create({ data: { companyId: company.id, status: 'ACTIVE', payeeCode: 'legacy', efiAccountNumber: '9001', pixKey: 'legacy', encryptedClientId: 'c', encryptedClientSecret: 's' } });
    chargesNotification = { data: [{ custom_id: bolixCharge.id, status: { current: 'paid' }, value: 10000 }] };
    await issuer.handleChargesWebhook({ notification: 'tampered' }, company.id);
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: bolixCharge.id } })).status, 'ACTIVE', 'companyId in the URL does not reach profile charges');
    await issuer.handleChargesWebhook({ notification: 'genuine' }, undefined, identityB.id);
    assert.equal((await prisma.paymentCharge.findUnique({ where: { id: bolixCharge.id } })).status, 'PAID');
    console.log('PASS tampered companyId ignored; only the issuing account settles the charge');

    // No active credential for the issuing account: blocked, never the CifraMais credentials.
    await prisma.efiCredentialVersion.updateMany({ where: { identityId: identityA.id, status: 'ACTIVE' }, data: { status: 'RETIRED', retiredAt: new Date() } });
    const oldOnA = await prisma.paymentCharge.findFirst({ where: { issuerIdentityId: identityA.id, status: 'ACTIVE' } });
    if (oldOnA) await assert.rejects(issuer.cancelPixDueCharge(company.id, oldOnA.efiTxid), (error) => error.response?.code === 'EFI_CREDENTIALS_UNAVAILABLE');
    else await assert.rejects(issuer.accountForIdentity(identityA.id, company.id), (error) => error.response?.code === 'EFI_CREDENTIALS_UNAVAILABLE');
    console.log('PASS missing credential blocks the operation without falling back to platform credentials');
    console.log(`PASS payment lifecycle on ${migrations.length} migrations in PostgreSQL 16`);
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    if (containerStarted) docker(['rm', '-f', name]);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
