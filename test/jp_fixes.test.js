// Regression tests for the critic findings on the Japan upgrade.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isJapanMarket } = require('../utils/market');
const sm = require('../scrapers/sitemap_categories');
const demand = require('../analysis/jp_demand');

test('one Japan test everywhere: market text, bare code, .jp host', () => {
  assert.strictEqual(isJapanMarket({ market: 'Japan (Kanto)', url: 'https://x.com' }), true);
  assert.strictEqual(isJapanMarket({ market: 'JP', url: 'https://x.com' }), true);
  assert.strictEqual(isJapanMarket({ market: '', url: 'https://www.toys.co.jp/' }), true);
  assert.strictEqual(isJapanMarket({ market: 'Lebanon', url: 'https://toysrus.com.lb' }), false);
  assert.strictEqual(isJapanMarket(null), false);
});

test('fullTaxonomy drops numeric-ID leaves on an English site (12345.html is not a category)', () => {
  const locs = ['https://shop.com/toys/12345.html', 'https://shop.com/toys/lego', 'https://shop.com/games/board-games', 'https://shop.com/games/puzzles'];
  const t = sm.fullTaxonomyFromLocs(locs, 'https://shop.com');
  assert.ok(!t.leaves.includes('12345'), JSON.stringify(t.leaves));
  assert.ok(t.leaves.includes('lego'));
});

test('jp_demand uses Japanese brandMix terms from the marketplace file', () => {
  const terms = demand.deriveTerms
    ? demand.deriveTerms({ industry: 'Toys' }, { categories: [{ category: 'toys' }], brandMix: [{ brand: 'アンパンマン', count: 9 }, { brand: 'lego', count: 8 }] }, 5)
    : null;
  assert.ok(terms, 'deriveTerms must be exported');
  assert.ok(terms.some(t => t.term === 'アンパンマン'), JSON.stringify(terms));
});

test('social_audit --dry-run writes nothing and makes no network or AI call', () => {
  const root = path.join(__dirname, '..');
  const dir = path.join(root, 'data/brands/_dryrun_probe');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({ slug: '_dryrun_probe', name: 'Probe', url: 'https://example.jp', market: 'Japan', identifiedCompetitors: [{ name: 'A', url: 'https://a.example.jp' }, null, {}] }));
  try {
    const before = fs.readdirSync(dir).sort();
    const r = spawnSync('node', ['analysis/social_audit.js', '--slug=_dryrun_probe', '--dry-run'], { cwd: root, encoding: 'utf8', env: { ...process.env, APIFY_API_TOKEN: 'x', ANTHROPIC_API_KEY: 'x' }, timeout: 60000 });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), before);
    assert.match(r.stdout, /would audit 2 brands/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('manual capture feeds the same extractors, never touches the network, and is marked', async () => {
  const { scrapeBrands, manualCaptureFor } = require('../scrapers/site_scraper');
  const root = path.join(__dirname, '..');
  const dir = path.join(root, 'data/brands/_manual_probe/manual_capture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'blocked-site.html'), '<html><head><title>Toys</title></head><body><nav><a href="/c/1">おもちゃ</a><a href="/c/2">ぬいぐるみ</a><a href="/c/3">ブロック</a></nav><h1>夏のセール</h1></body></html>');
  try {
    const mc = manualCaptureFor('_manual_probe', 'blocked-site');
    assert.ok(mc && mc.capturedAt);
    // URL that cannot resolve: if the capture were not served locally this would error
    const [r] = await scrapeBrands([{ id: 'blocked-site', name: 'Blocked', url: 'https://blocked.invalid/', role: 'target', manualCapture: mc, skipApifyRetry: true }]);
    assert.strictEqual(r.manualCapture, true);
    assert.strictEqual(r.botBlocked, false);
    assert.ok(r.navigation.length >= 3, JSON.stringify(r.navigation));
    assert.strictEqual(r.heroContent.headline, '夏のセール');
    assert.strictEqual(manualCaptureFor('_manual_probe', 'nope'), undefined);
  } finally { fs.rmSync(path.join(root, 'data/brands/_manual_probe'), { recursive: true, force: true }); }
});

test('skipApifyRetry brand is never sent to Apify', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../scrapers/site_scraper.js'), 'utf8');
  assert.match(src, /&& !brand\.skipApifyRetry/);
});
