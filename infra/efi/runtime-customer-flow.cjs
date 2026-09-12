'use strict';
// Sent on stdin to `docker exec -i <isolated-test-api> node`; never run on a host database.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { hash } = require('bcryptjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
async function request(route, token, method = 'GET', body) {
  const response = await fetch('http://127.0.0.1:3001' + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
(async () => {
  try {
    assert.equal(new URL(process.env.DATABASE_URL).hostname, 'db', 'isolated Docker fixture only');
    const temporary = 'Temporary-Fixture-123';
    const password = 'Changed-Fixture-456';
    const company = await prisma.company.create({ data: { corporateName: 'Runtime Company', document: '11222333000181', email: 'company@example.test', phoneNumber: '5511999999999' } });
    await prisma.user.create({ data: { companyId: company.id, email: 'operator@example.test', password: await hash(temporary, 10), role: 'COMPANY_ADMIN', mustChangePassword: true } });
    let login = await request('/auth/login', null, 'POST', { email: 'operator@example.test', password: temporary });
    assert.equal(login.status, 200);
    const oldToken = login.body.access_token;
    assert.equal((await request('/onboarding/efi', oldToken)).status, 403);
    assert.equal((await request('/auth/change-password', oldToken, 'POST', { currentPassword: temporary, password, passwordConfirmation: password })).status, 200);
    assert.equal((await request('/onboarding/efi', oldToken)).status, 401);
    login = await request('/auth/login', null, 'POST', { email: 'operator@example.test', password });
    assert.equal(login.status, 200);
    const token = login.body.access_token;
    const initial = await request('/onboarding/efi', token);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.status, 'DRAFT');
    const draft = await request('/onboarding/efi/draft', token, 'PUT', {
      revision: initial.body.revision, tradeName: 'Runtime Store',
      representative: { name: 'Synthetic Representative', cpf: '52998224725', birthDate: '1980-01-01', motherName: 'Synthetic Mother', email: 'representative@example.test', phone: '11999999999' },
    });
    assert.equal(draft.status, 200);
    const resumed = await request('/onboarding/efi', token);
    assert.equal(resumed.body.company.tradeName, 'Runtime Store');
    assert.equal(resumed.body.representativeProvided, true);
    assert.ok(resumed.body.revision > initial.body.revision);
    const serialized = JSON.stringify(resumed.body);
    for (const secret of ['52998224725', 'Synthetic Mother', 'representative@example.test', 'Encrypted', 'clientSecret']) assert.ok(!serialized.includes(secret));
    const saved = await prisma.efiOnboarding.findUnique({ where: { companyId: company.id } });
    assert.ok(saved.representativeCpfEncrypted && !saved.representativeCpfEncrypted.includes('52998224725'));
    assert.equal((await request('/onboarding/efi/draft', token, 'PUT', { revision: initial.body.revision, tradeName: 'Stale edit' })).status, 409);
    assert.equal((await request('/onboarding/efi/submit', token, 'POST', {})).status, 409);
    assert.equal((await prisma.efiOnboarding.findUnique({ where: { companyId: company.id } })).status, 'DRAFT');
    for (const path of ['/communications/admin/conversations', '/admin/efi-onboarding', '/admin/payment-fees']) assert.equal((await request(path, token)).status, 403);
    assert.equal((await request('/communications/outbound', token)).status, 200);
    const debtor = await prisma.debtor.create({ data: { companyId: company.id, name: 'Fixture', phoneNumber: '5511888888888' } });
    const invoice = await prisma.invoice.create({ data: { companyId: company.id, debtorId: debtor.id, originalAmount: 100, dueDate: new Date(Date.now() + 86400000), billingType: 'BOLIX' } });
    assert.equal(invoice.status, 'DRAFT');
    const issuance = await request('/payments/create', token, 'POST', { invoiceId: invoice.id, billingType: 'BOLIX' });
    assert.ok([403, 409, 503].includes(issuance.status));
    assert.equal(await prisma.paymentCharge.count({ where: { companyId: company.id } }), 0);
    console.log('PASS customer HTTP flow: temporary password, invalidated session, draft/resume, encrypted representative, stale revision, consent gate, admin isolation and blocked issuance');
  } finally { await prisma.$disconnect(); await pool.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
