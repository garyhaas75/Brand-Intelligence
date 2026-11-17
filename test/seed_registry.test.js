const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerSeedBrands } = require('../modules/seed_registry');

function seedDir(entries) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  for (const [slug, reg] of Object.entries(entries)) {
    fs.mkdirSync(path.join(d, slug), { recursive: true });
    if (reg !== null) fs.writeFileSync(path.join(d, slug, '_registry.json'), typeof reg === 'string' ? reg : JSON.stringify(reg));
  }
  return d;
}

test('a seed with _registry.json is registered once and never duplicated or overwritten', () => {
  const d = seedDir({ jp: { slug: 'jp', name: 'JP', url: 'https://x.jp', industry: 'Toys' } });
  const reg = { brands: [] };
  assert.deepStrictEqual(registerSeedBrands(reg, d), ['jp']);
  assert.strictEqual(reg.brands[0].discoveryStatus, 'complete');
  reg.brands[0].name = 'Edited by operator';
  assert.deepStrictEqual(registerSeedBrands(reg, d), []);
  assert.strictEqual(reg.brands.length, 1);
  assert.strictEqual(reg.brands[0].name, 'Edited by operator');
});

test('seed dirs without _registry.json (the demo brand), bad json or a slug mismatch are ignored', () => {
  const d = seedDir({ demo: null, bad: '{nope', mismatch: { slug: 'other', name: 'x', url: 'https://x' }, nourl: { slug: 'nourl', name: 'x' } });
  const reg = { brands: [] };
  assert.deepStrictEqual(registerSeedBrands(reg, d), []);
  assert.strictEqual(reg.brands.length, 0);
});

test('missing seed dir or malformed registry does not throw', () => {
  assert.deepStrictEqual(registerSeedBrands({ brands: [] }, '/nonexistent/path'), []);
  assert.deepStrictEqual(registerSeedBrands(null, os.tmpdir()), []);
});

test('the shipped toysrus-jp seed is valid and registers', () => {
  const reg = { brands: [] };
  const added = registerSeedBrands(reg, path.join(__dirname, '../seed_data/brands'));
  assert.ok(added.includes('toysrus-jp'));
  const prof = require('../seed_data/brands/toysrus-jp/profile.json');
  assert.strictEqual(prof.scrape.skipApifyRetry, true);
  assert.ok(prof.identifiedCompetitors.length >= 10);
});

test('the Japan seed is registered as unscheduled so no cron job runs it unasked', () => {
  const reg = { brands: [] };
  registerSeedBrands(reg, path.join(__dirname, '../seed_data/brands'));
  const jp = reg.brands.find(b => b.slug === 'toysrus-jp');
  assert.strictEqual(jp.scheduled, false);
});

test('the scheduler skips scheduled:false brands', () => {
  const src = fs.readFileSync(path.join(__dirname, '../scheduler/index.js'), 'utf8');
  assert.match(src, /b\.scheduled !== false/);
});

test('a seeded brand that was deleted on purpose is not re-registered on the next boot', () => {
  const d = seedDir({ jp: { slug: 'jp', name: 'JP', url: 'https://x.jp' } });
  const reg = { brands: [], deletedSeeds: ['jp'] };
  assert.deepStrictEqual(registerSeedBrands(reg, d), []);
  assert.strictEqual(reg.brands.length, 0);
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /deletedSeeds/);
});
