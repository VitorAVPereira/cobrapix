'use strict';
// Fresh local Docker PostgreSQL owned by this invocation. Never reads DATABASE_URL/DIRECT_URL.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');

const root = path.resolve(__dirname, '../..');
const migrationDir = path.join(root, 'prisma/migrations');
const dockerHost = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';

function docker(args) {
  const result = spawnSync('docker', ['--host', dockerHost, ...args], { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed; check local Docker access.`);
  return result.stdout.trim();
}

function migrations() {
  return fs.readdirSync(migrationDir).filter(file => fs.existsSync(path.join(migrationDir, file, 'migration.sql'))).sort();
}

function migrationSql(file) {
  return fs.readFileSync(path.join(migrationDir, file, 'migration.sql'), 'utf8');
}

/** Starts a labelled container; `stop()` removes only the container this call created. */
async function startDisposablePostgres(label) {
  const runId = randomBytes(8).toString('hex');
  const name = `ciframais-${label}-${runId}`;
  const password = randomBytes(24).toString('hex');
  docker(['run', '-d', '--name', name, '--label', `ciframais.${label}=${runId}`, '--memory', '384m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=disposable', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  const stop = () => {
    const owner = docker(['inspect', '--format', `{{ index .Config.Labels "ciframais.${label}" }}`, name]);
    if (owner !== runId) throw new Error('Refusing to remove a container this run did not create.');
    docker(['rm', '-f', '-v', name]);
  };
  try {
    const binding = docker(['port', name, '5432/tcp']);
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Unexpected port binding.');
    const config = { host: '127.0.0.1', port: Number(binding.split(':').at(-1)), database: 'disposable', user: 'postgres', password };
    const pool = new Pool({ ...config, connectionTimeoutMillis: 1000, max: 8 });
    for (let i = 0; ; i++) {
      try { await pool.query('SELECT 1'); break; } catch (error) {
        if (i >= 40) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    const url = `postgresql://postgres:${password}@${config.host}:${config.port}/disposable`;
    return { pool, url, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

/** Applies migrations in order; `until` stops before the first migration whose name ends with it. */
async function migrate(pool, { until, after } = {}) {
  const all = migrations();
  const target = until ? all.find(file => file.endsWith(until)) : undefined;
  if (until && !target) throw new Error(`Migration ${until} not found.`);
  const start = after ? all.findIndex(file => file.endsWith(after)) + 1 : 0;
  const applied = [];
  for (const file of all.slice(start)) {
    if (target && file >= target) break;
    await pool.query(migrationSql(file));
    applied.push(file);
  }
  return { target, applied, all };
}

module.exports = { startDisposablePostgres, migrate, migrations, migrationSql, root };
