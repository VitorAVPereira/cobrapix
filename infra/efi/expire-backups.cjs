'use strict';
const { spawnSync } = require('node:child_process');
const PREFIX = 'ciframais/database/';
// Daily deletion at 29 days leaves one day of margin for the 30-day maximum.
function expiredKeys(objects, now = new Date()) {
  return objects.filter(item =>
    /^ciframais\/database\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.dump\.age$/.test(item.Key) &&
    Number.isFinite(Date.parse(item.LastModified)) &&
    now.getTime() - Date.parse(item.LastModified) >= 29 * 86400000
  ).map(item => item.Key);
}
function run() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Use --apply or no argument for dry-run.');
  const bucket = process.env.BACKUP_BUCKET;
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Dedicated BACKUP_BUCKET required.');
  const aws = (parameters) => {
    const result = spawnSync('aws', parameters, { encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('Backup storage operation failed.');
    return result.stdout ? JSON.parse(result.stdout) : {};
  };
  if (aws(['s3api', 'get-bucket-versioning', '--bucket', bucket, '--output', 'json']).Status)
    throw new Error('Dedicated backup bucket must be unversioned.');
  const listed = aws(['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', PREFIX, '--output', 'json']);
  const keys = expiredKeys(listed.Contents ?? []);
  if (args.includes('--apply')) {
    for (const key of keys) aws(['s3api', 'delete-object', '--bucket', bucket, '--key', key, '--output', 'json']);
  }
  console.log(JSON.stringify({ apply: args.includes('--apply'), expiredCount: keys.length }));
}
module.exports = { expiredKeys };
if (require.main === module) { try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
