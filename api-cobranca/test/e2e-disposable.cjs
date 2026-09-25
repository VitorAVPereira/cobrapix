'use strict';
// Runs e2e specs against a freshly created, locally owned PostgreSQL + Redis. Never reads
// DATABASE_URL/DIRECT_URL/REDIS_* from the environment: they are replaced for the child run.
// Usage: node test/e2e-disposable.cjs <spec> [<spec>...]
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');

const root = path.resolve(__dirname, '..');
const runId = randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
const host = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
const names = { postgres: `ciframais-e2e-pg-${runId}`, redis: `ciframais-e2e-redis-${runId}` };
const specs = process.argv.slice(2);
if (!specs.length || specs.some(spec => !/^[\w.-]+\.e2e-spec\.ts$/.test(spec))) {
  console.error('Informe os arquivos *.e2e-spec.ts a executar.');
  process.exit(2);
}

function docker(args) {
  const result = spawnSync('docker', ['--host', host, ...args], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed; check local Docker Desktop access.`);
  return result.stdout.trim();
}
const started = [];
function cleanup() {
  let failed = false;
  for (const name of started.splice(0)) {
    try {
      if (docker(['inspect', '--format', '{{ index .Config.Labels "ciframais.e2e" }}', name]) === runId)
        docker(['rm', '-f', '-v', name]);
    } catch { console.error(`Cleanup failed for ${name}`); failed = true; }
  }
  return failed;
}
// An interrupted run still removes what it created.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(130); });

(async () => {
  let code = 1;
  try {
    docker(['run', '-d', '--name', names.postgres, '--label', `ciframais.e2e=${runId}`, '--memory', '512m', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=ciframais_e2e', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
    started.push(names.postgres);
    docker(['run', '-d', '--name', names.redis, '--label', `ciframais.e2e=${runId}`, '--memory', '128m', '-p', '127.0.0.1::6379', 'redis:7-alpine']);
    started.push(names.redis);
    const pgPort = Number(docker(['port', names.postgres, '5432/tcp']).split(':').at(-1));
    const redisPort = Number(docker(['port', names.redis, '6379/tcp']).split(':').at(-1));
    const pool = new Pool({ host: '127.0.0.1', port: pgPort, database: 'ciframais_e2e', user: 'postgres', password, connectionTimeoutMillis: 1000 });
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      try { await pool.query('SELECT 1'); ready = true; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not start.');
    const migrations = fs.readdirSync(path.join(root, 'prisma/migrations')).filter(file => fs.existsSync(path.join(root, 'prisma/migrations', file, 'migration.sql'))).sort();
    for (const file of migrations) await pool.query(fs.readFileSync(path.join(root, 'prisma/migrations', file, 'migration.sql'), 'utf8'));
    await pool.end();
    console.log(`E2E disposable infra ready: ${migrations.length} migrations, PostgreSQL :${pgPort}, Redis :${redisPort}`);
    const url = `postgresql://postgres:${password}@127.0.0.1:${pgPort}/ciframais_e2e`;
    const jest = spawnSync(process.execPath, [path.join(root, 'node_modules/jest/bin/jest.js'), '--config', './test/jest-e2e.json', '--runInBand', '--forceExit', ...specs], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: url,
        DIRECT_URL: url,
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: String(redisPort),
        REDIS_PASSWORD: '',
        CIFRAMAIS_DISPOSABLE_E2E: runId,
      },
    });
    code = jest.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  } finally {
    if (cleanup()) code ||= 1;
  }
  process.exit(code);
})();
