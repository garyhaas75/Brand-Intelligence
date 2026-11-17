const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lock = require('../utils/run_lock');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));

test('second acquire fails while held, succeeds after release', () => {
  const d = tmp();
  assert.strictEqual(lock.acquire('s', 'phased', { dataDir: d }), true);
  assert.strictEqual(lock.status('s', { dataDir: d }).held, true);
  assert.strictEqual(lock.acquire('s', 'phased', { dataDir: d }), false);
  lock.release('s', { dataDir: d });
  assert.strictEqual(lock.status('s', { dataDir: d }).held, false);
  assert.strictEqual(lock.acquire('s', 'phased', { dataDir: d }), true);
});

test('a lock owned by a dead pid is stale and is taken over', () => {
  const d = tmp();
  const dir = path.join(d, 'brands/s/_run.lock');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: 999999, startedAt: new Date().toISOString(), kind: 'phased' }));
  assert.strictEqual(lock.status('s', { dataDir: d }).held, false);
  assert.strictEqual(lock.acquire('s', 'phased', { dataDir: d }), true);
});

test('release never removes a lock owned by another process', () => {
  const d = tmp();
  const dir = path.join(d, 'brands/s/_run.lock');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString() }));
  lock.release('s', { dataDir: d });
  assert.ok(fs.existsSync(dir));
});

test('locks are per slug', () => {
  const d = tmp();
  assert.strictEqual(lock.acquire('a', 'phased', { dataDir: d }), true);
  assert.strictEqual(lock.acquire('b', 'phased', { dataDir: d }), true);
});
