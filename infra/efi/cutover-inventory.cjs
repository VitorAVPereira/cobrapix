'use strict';
// Read-only inventory for an explicitly reviewed tenant allowlist. No delete/apply mode.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Pool } = require(path.resolve(__dirname, '../../api-cobranca/node_modules/pg'));
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !args[0].startsWith('--companies=') || !args[1].startsWith('--out='))
    throw new Error('Usage: node cutover-inventory.cjs --companies=uuid,uuid --out=manifest.json');
  const ids = [...new Set(args[0].slice(12).split(','))];
  if (!ids.length || ids.some(id => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))) throw new Error('Explicit UUID allowlist required.');
  if (!process.env.CUTOVER_DATABASE_URL) throw new Error('Set CUTOVER_DATABASE_URL explicitly; application DATABASE_URL is never read.');
  const pool = new Pool({ connectionString: process.env.CUTOVER_DATABASE_URL, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const companies = await client.query('SELECT id, document FROM "Company" WHERE id = ANY($1::text[]) ORDER BY id', [ids]);
    if (companies.rowCount !== ids.length) throw new Error('Allowlist contains unknown companies.');
    const columns = await client.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='companyId' ORDER BY table_name");
    const counts = {};
    for (const { table_name: table } of columns.rows) {
      const quoted = '"' + table.replaceAll('"', '""') + '"';
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoted} WHERE "companyId" = ANY($1::text[])`, [ids]);
      counts[table] = result.rows[0].count;
    }
    const dependencies = await client.query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent,
      pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY 1,2`);
    const pending = await client.query(`SELECT status, COUNT(*)::int AS count FROM "PaymentCharge"
      WHERE "companyId" = ANY($1::text[]) AND status IN ('DRAFT','PENDING','ACTIVE') GROUP BY status`, [ids]);
    const manifest = {
      mode: 'read-only', createdAt: new Date().toISOString(),
      companies: companies.rows.map(company => ({ id: company.id, documentSha256: createHash('sha256').update(company.document).digest('hex') })),
      counts, pendingCharges: pending.rows, dependencies: dependencies.rows,
      requirements: ['identified encrypted backup with restore evidence', 'provider reconciliation of active or uncertain charges', 'review exact dependent-row deletion SQL', 'preserve global templates and retained communications', 'remove legacy source references before any DROP COLUMN'],
    };
    fs.writeFileSync(args[1].slice(6), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await client.query('COMMIT');
    console.log(`Read-only inventory written for ${ids.length} explicitly selected companies. No data changed.`);
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); await pool.end(); }
}
main().catch(() => { console.error('Inventory failed. Check explicit URL, UUIDs and unused output path; no database write was performed.'); process.exitCode = 1; });
