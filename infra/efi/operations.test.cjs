'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { expiredKeys } = require('./expire-backups.cjs');
test('retention selects only this task backup prefix and leaves recent/unknown objects untouched', () => {
  const now = new Date('2026-09-12T00:00:00Z');
  const old = '2026-08-01T00:00:00Z';
  const key = 'ciframais/database/2026-08-01T00-00-00Z.dump.age';
  assert.deepEqual(expiredKeys([
    { Key: key, LastModified: old },
    { Key: 'other/' + key, LastModified: old },
    { Key: 'ciframais/database/unrelated.txt', LastModified: old },
    { Key: 'ciframais/database/2026-09-11T00-00-00Z.dump.age', LastModified: '2026-09-11T00:00:00Z' },
    { Key: 'ciframais/database/2026-08-02T00-00-00Z.dump.age', LastModified: 'invalid' },
  ], now), [key]);
});
test('retention starts at exactly 29 days', () => {
  const key = 'ciframais/database/2026-08-14T00-00-00Z.dump.age';
  const item = { Key: key, LastModified: '2026-08-14T00:00:00Z' };
  assert.deepEqual(expiredKeys([item], new Date('2026-09-11T23:59:59Z')), []);
  assert.deepEqual(expiredKeys([item], new Date('2026-09-12T00:00:00Z')), [key]);
});
