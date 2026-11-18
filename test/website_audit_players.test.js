// The website audit benchmarks competitors only: the partner (Don Quijote) is never scraped
// as a competitor, and a player with no website is skipped instead of becoming "https://null".
// Pure: buildBrandsToScrape does no network.
const test = require('node:test');
const assert = require('node:assert');

const { buildBrandsToScrape, competitorUrl } = require('../analysis/website_audit');

function jpProfile() {
  const list = [];
  for (let i = 0; i < 8; i++) list.push({ name: `Comp ${i}`, url: `https://c${i}.example.jp/`, tier: 'mass' });
  // Index 8, as in the live profile after the boot migration.
  list.push({ name: 'Don Quijote', url: 'https://www.donki.com/', tier: 'mass', relationship: 'partner' });
  list.push({ name: 'Niche No Site', url: null, tier: 'niche' });
  list.push({ name: 'Bare Host', url: 'bare.example.jp', tier: 'specialty' });
  for (let i = 8; i < 14; i++) list.push({ name: `Comp ${i}`, url: `https://c${i}.example.jp/`, tier: 'specialty' });
  return { name: 'Toys R Us Japan', url: 'https://www.toysrus.co.jp/', market: 'Japan', identifiedCompetitors: list };
}

test('partner at index 8 is not benchmarked; the cap of 12 is filled by competitors', () => {
  const brands = buildBrandsToScrape(jpProfile(), 'toysrus-jp');
  const comps = brands.filter(b => b.role === 'competitor');
  assert.strictEqual(brands[0].role, 'target');
  assert.ok(!comps.some(b => b.name === 'Don Quijote'), 'partner excluded');
  assert.strictEqual(comps.length, 12);
  assert.deepStrictEqual(comps.map(b => b.name).slice(8, 10), ['Bare Host', 'Comp 8']);
});

test('a player with url null is skipped and no URL is ever built from null', () => {
  const brands = buildBrandsToScrape(jpProfile(), 'toysrus-jp');
  assert.ok(!brands.some(b => b.name === 'Niche No Site'));
  assert.ok(brands.every(b => !/null|undefined/.test(String(b.url))), 'no https://null');
  assert.strictEqual(brands.find(b => b.name === 'Bare Host').url, 'https://bare.example.jp');
});

test('competitorUrl rejects null, empty and the literal string null', () => {
  for (const v of [null, undefined, '', '  ', 'null', 'undefined', 42]) assert.strictEqual(competitorUrl(v), null);
  assert.strictEqual(competitorUrl('https://a.example/'), 'https://a.example/');
  assert.strictEqual(competitorUrl('a.example'), 'https://a.example');
});

test('non-Japan profiles keep the cap of 6', () => {
  const p = jpProfile();
  p.market = 'US'; p.url = 'https://brand.example.com/';
  assert.strictEqual(buildBrandsToScrape(p, 'x').filter(b => b.role === 'competitor').length, 6);
});
