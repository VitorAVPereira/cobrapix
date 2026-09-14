'use strict';
// Production-image bootstrap with isolated PostgreSQL/Redis and no internet route.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const prefix = `efi-runtime-${randomBytes(5).toString('hex')}`;
const db = `${prefix}-db`, redis = `${prefix}-redis`, api = `${prefix}-api`;
const password = randomBytes(24).toString('hex');
function docker(args, input, required = true) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 30000 });
  if (required && result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${result.stderr}`);
  return ((result.stdout ?? '') + (args[0] === 'logs' ? result.stderr : '')).trim();
}
(async () => {
  try {
    docker(['network', 'create', '--internal', prefix]);
    docker(['run', '-d', '--name', db, '--network', prefix, '--network-alias', 'db', '--memory', '256m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=efi_test', 'postgres:16-alpine']);
    docker(['run', '-d', '--name', redis, '--network', prefix, '--network-alias', 'redis', '--memory', '128m', 'redis:7-alpine']);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = docker(['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], undefined, false);
      if (response.includes('accepting connections')) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'PostgreSQL must start');
    const migrations = path.resolve(__dirname, '../../api-cobranca/prisma/migrations');
    for (const entry of fs.readdirSync(migrations).sort()) {
      const file = path.join(migrations, entry, 'migration.sql');
      if (fs.existsSync(file)) docker(['exec', '-i', db, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'efi_test', '-v', 'ON_ERROR_STOP=1'], fs.readFileSync(file));
    }
    const env = {
      NODE_ENV: 'production', PORT: '3001', DATABASE_URL: `postgresql://postgres:${password}@db:5432/efi_test`, REDIS_HOST: 'redis', REDIS_PORT: '6379',
      JWT_SECRET: randomBytes(32).toString('hex'), EFI_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
      PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ local: randomBytes(32).toString('hex') }), PAYMENT_ACTIVE_KEY_VERSION: 'local',
      FRONTEND_URL: 'https://frontend.example.test', META_ACCESS_TOKEN: 'local-test', META_PHONE_NUMBER_ID: '123', META_BUSINESS_ACCOUNT_ID: '123',
      META_APP_SECRET: 'local-test', META_WEBHOOK_VERIFY_TOKEN: 'local-test', META_WEBHOOK_BASE_URL: 'https://api.example.test',
      RESEND_API_KEY: 're_local_test', RESEND_FROM_EMAIL: 'central@example.test', RESEND_REPLY_TO: 'central@example.test', RESEND_WEBHOOK_SECRET: 'whsec_bG9jYWw=',
      AUTH_RESEND_API_KEY: 're_local_test', AUTH_EMAIL_FROM: 'auth@example.test', EFI_OPENING_CLIENT_ID: 'local-test', EFI_OPENING_CLIENT_SECRET: 'local-test',
      EFI_OPENING_CERT_PATH: '/not-used.p12', EFI_PLATFORM_CLIENT_ID: 'local-test', EFI_PLATFORM_CLIENT_SECRET: 'local-test', EFI_PLATFORM_CERT_PATH: '/not-used.p12',
      EFI_PLATFORM_PAYEE_CODE: 'local-test', EFI_PLATFORM_ACCOUNT_NUMBER: '123', EFI_PLATFORM_CNPJ: '12345678000195', EFI_WEBHOOK_BASE_URL: 'https://efi.example.test',
      EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.test', EFI_LEGAL_APPROVED: 'false',
    };
    docker(['run', '-d', '--name', api, '--network', prefix, '--memory', '1280m', '--read-only', '--tmpfs', '/tmp', ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), 'ciframais-efi-local:verification']);
    const probe = (route, options = {}) => Number(docker(['exec', api, 'node', '-e', 'fetch('+JSON.stringify('http://127.0.0.1:3001'+route)+','+JSON.stringify(options)+').then(r=>console.log(r.status)).catch(()=>process.exit(1))'], undefined, false));
    let healthy = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      try { if (probe('/health') === 200) { healthy = true; break; } } catch {}
      if (docker(['inspect', '-f', '{{.State.Running}}', api]) !== 'true') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!healthy) throw new Error(`Runtime did not become healthy: ${docker(['logs', '--tail', '60', api], undefined, false)}`);
    console.log('PASS production image boots full Nest module graph with PostgreSQL and Redis');
    for (const route of ['/onboarding/efi', '/admin/efi-onboarding', '/communications/admin/conversations', '/payments/fees?billingMethod=PIX&amountCents=10000']) {
      assert.equal(probe(route), 401, `${route} requires authentication`);
    }
    console.log('PASS protected financial and communications routes reject anonymous access');
    const callback = probe('/webhooks/efi/account-opening', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Efi-Client-Verify': 'SUCCESS' }, body: '{}' });
    assert.equal(callback, 403);
    console.log('PASS direct spoofed mTLS header rejected by full application');
    console.log(docker(['exec', '-i', api, 'node'], fs.readFileSync(path.join(__dirname, 'runtime-customer-flow.cjs'))));
  } finally {
    docker(['rm', '-f', api, redis, db], undefined, false);
    docker(['network', 'rm', prefix], undefined, false);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
