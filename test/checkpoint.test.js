const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('../utils/checkpoint');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));

test('put then get returns the value; absent key is undefined', () => {
  const d = tmp();
  assert.strictEqual(cp.get('s', 'social', 'a', { dataDir: d }), undefined);
  cp.put('s', 'social', 'a', { n: 1 }, { dataDir: d });
  assert.deepStrictEqual(cp.get('s', 'social', 'a', { dataDir: d }), { n: 1 });
  assert.deepStrictEqual(cp.keys('s', 'social', { dataDir: d }), ['a']);
});

test('a second put keeps the first unit (progress accumulates)', () => {
  const d = tmp();
  cp.put('s', 'x', 'a', 1, { dataDir: d }); cp.put('s', 'x', 'b', 2, { dataDir: d });
  assert.deepStrictEqual(cp.keys('s', 'x', { dataDir: d }).sort(), ['a', 'b']);
});

test('stale entries are ignored', () => {
  const d = tmp();
  cp.put('s', 'x', 'a', 1, { dataDir: d });
  const f = cp.fileFor('s', 'x', d);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.items['k:a'].savedAt = new Date(Date.now() - 48 * 3600000).toISOString();
  fs.writeFileSync(f, JSON.stringify(j));
  assert.strictEqual(cp.get('s', 'x', 'a', { dataDir: d }), undefined);
  assert.strictEqual(cp.get('s', 'x', 'a', { dataDir: d, maxAgeHours: 72 }), 1);
});

test('BI_FORCE=1 ignores checkpoints; clear removes them', () => {
  const d = tmp();
  cp.put('s', 'x', 'a', 1, { dataDir: d });
  process.env.BI_FORCE = '1';
  try { assert.strictEqual(cp.get('s', 'x', 'a', { dataDir: d }), undefined); } finally { delete process.env.BI_FORCE; }
  assert.strictEqual(cp.get('s', 'x', 'a', { dataDir: d }), 1);
  cp.clear('s', 'x', { dataDir: d });
  assert.strictEqual(cp.get('s', 'x', 'a', { dataDir: d }), undefined);
});

test('a corrupt checkpoint file reads as empty and does not throw', () => {
  const d = tmp();
  cp.put('s', 'x', 'a', 1, { dataDir: d });
  fs.writeFileSync(cp.fileFor('s', 'x', d), '{not json');
  assert.strictEqual(cp.get('s', 'x', 'a', { dataDir: d }), undefined);
  assert.strictEqual(cp.put('s', 'x', 'b', 2, { dataDir: d }), true);
});

test('ids such as __proto__ and constructor are ordinary keys', () => {
  const d = tmp();
  assert.strictEqual(cp.put('s', 'x', '__proto__', { ok: 1 }, { dataDir: d }), true);
  assert.strictEqual(cp.put('s', 'x', 'constructor', 2, { dataDir: d }), true);
  assert.deepStrictEqual(cp.get('s', 'x', '__proto__', { dataDir: d }), { ok: 1 });
  assert.deepStrictEqual(cp.keys('s', 'x', { dataDir: d }).sort(), ['__proto__', 'constructor']);
  assert.strictEqual(({}).ok, undefined);
});

test('two processes saving at once keep every unit (lock prevents lost updates)', () => {
  const { spawnSync, spawn } = require('child_process');
  const d = tmp();
  const script = `const cp=require(${JSON.stringify(path.join(__dirname, '../utils/checkpoint.js'))});for(let i=0;i<40;i++)cp.put('s','x',process.argv[1]+i,i,{dataDir:${JSON.stringify(d)}});`;
  const kids = ['a', 'b', 'c'].map(p => spawn('node', ['-e', script, p]));
  return Promise.all(kids.map(k => new Promise(r => k.on('exit', r)))).then(() => {
    assert.strictEqual(cp.keys('s', 'x', { dataDir: d }).length, 120);
    assert.ok(!fs.readdirSync(path.join(d, 'brands/s/_checkpoints')).some(f => f.endsWith('.tmp') || f.endsWith('.lock')));
  });
});

test('a failed save leaves no temp file and does not throw', () => {
  const d = tmp();
  cp.put('s', 'x', 'a', 1, { dataDir: d });
  const circular = {}; circular.self = circular;
  assert.strictEqual(cp.put('s', 'x', 'bad', circular, { dataDir: d }), false);
  assert.ok(!fs.readdirSync(path.join(d, 'brands/s/_checkpoints')).some(f => f.endsWith('.tmp')));
  assert.strictEqual(cp.get('s', 'x', 'a', { dataDir: d }), 1);
});

test('a lock left by a dead process is broken, and a live lock makes put skip instead of writing unlocked', () => {
  const d = tmp();
  cp.put('s', 'x', 'a', 1, { dataDir: d });
  const lock = cp.fileFor('s', 'x', d) + '.lock';
  // dead holder: a pid that is not running
  fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), '999999');
  assert.strictEqual(cp.put('s', 'x', 'b', 2, { dataDir: d }), true);
  assert.deepStrictEqual(cp.keys('s', 'x', { dataDir: d }).sort(), ['a', 'b']);
  assert.ok(!fs.existsSync(lock));
  // live holder (this process) that never releases: put must give up, not write unlocked
  fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  const t0 = Date.now();
  assert.strictEqual(cp.put('s', 'x', 'c', 3, { dataDir: d }), false);
  assert.ok(Date.now() - t0 >= 2500, 'waited for the lock');
  assert.strictEqual(cp.get('s', 'x', 'c', { dataDir: d }), undefined);
  fs.rmSync(lock, { recursive: true, force: true });
});
