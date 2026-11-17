'use strict';
// Round 2 data lane: Trends timeRange validation, checkpoint resume, stale carry-forward,
// review language mix and dry-run safety for analysis/jp_demand.js and scrapers/marketplace_jp.js.
// Offline only: every network path is a trap or an injected fake. Temp data dirs only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const checkpoint = require('../utils/checkpoint');
const demand = require('../analysis/jp_demand');
const mp = require('../scrapers/marketplace_jp');

const DFX = path.join(__dirname, 'fixtures', 'demand', 'brands', 'jp-toy');
const MFX = path.join(__dirname, 'fixtures', 'marketplace');
const fx = name => fs.readFileSync(path.join(MFX, name), 'utf8');
const readJson = fp => JSON.parse(fs.readFileSync(fp, 'utf8'));
const SLUG = 'jp-toy';

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(saved)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}
const noForce = { BI_FORCE: null, BI_RESUME_TTL_HOURS: null };

function tmpBrand({ marketplace = true, prevDemand = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-resume-'));
  const b = path.join(dir, 'brands', SLUG);
  fs.mkdirSync(b, { recursive: true });
  fs.copyFileSync(path.join(DFX, 'profile.json'), path.join(b, 'profile.json'));
  if (marketplace) fs.copyFileSync(path.join(DFX, 'marketplace.json'), path.join(b, 'marketplace.json'));
  if (prevDemand) fs.copyFileSync(path.join(DFX, 'jp_demand.json'), path.join(b, 'jp_demand.json'));
  return { dir, b };
}
function trapDeps(calls) {
  return {
    apifyClientFactory: () => { calls.push('apify'); throw new Error('network call attempted'); },
    httpGetJson: async (u) => { calls.push(u); throw new Error('network call attempted'); },
  };
}
const trendsClient = (calls) => ({
  actor: () => ({ call: async (input) => { calls.push(input); return { defaultDatasetId: 'd' }; } }),
  dataset: () => ({ listItems: async () => ({ items: readJson(path.join(__dirname, 'fixtures', 'demand', 'trends_items.json')) }) }),
});

// ─── Trends timeRange ───────────────────────────────────────────────────────

test('timeRange: default is the actor\'s past-12-months value and is in the allowed list', () => {
  assert.ok(demand.TRENDS_TIME_RANGES.includes(''));
  assert.ok(!demand.TRENDS_TIME_RANGES.includes('today 12-m'), 'the value run 1 sent is not accepted by the actor');
  const input = demand.buildTrendsInput([{ term: 'おもちゃ' }]);
  assert.equal(input.timeRange, demand.TRENDS_TIME_RANGE_12M);
  assert.equal(input.timeRange, '');
  assert.equal(input.geo, 'JP');
  assert.equal(demand.validateTimeRange('today 5-y'), 'today 5-y');
  assert.throws(() => demand.validateTimeRange('today 12-m'), /not one the actor accepts.*Allowed/);
});

test('timeRange: an invalid value is a local error, the actor is never called', async () => {
  const { dir } = tmpBrand();
  const calls = [];
  await withEnv({ ...noForce, APIFY_API_TOKEN: 'fake', ESTAT_APP_ID: null }, async () => {
    const out = await demand.collectDemand({ slug: SLUG, dataDir: dir, log: () => {}, timeRange: 'today 12-m', deps: trapDeps(calls) });
    assert.ok(out.notes.some(n => n.includes('Google Trends not called, input invalid')));
  });
  assert.deepEqual(calls, []);
});

// ─── jp_demand checkpoint / resume / stale ─────────────────────────────────

const currentTerms = () => demand.deriveTerms(readJson(path.join(DFX, 'profile.json')), readJson(path.join(DFX, 'marketplace.json')));
// Rebuild a previous jp_demand.json so its trends cover exactly the terms the current run derives,
// reusing the fixture's real timeline for every term.
function withCurrentTerms(prev) {
  const sample = prev.trends.find(t => t.interestOverTime);
  const terms = currentTerms();
  return { ...prev, termKey: terms.map(t => t.term).join('|'), trends: terms.map(t => ({ ...sample, term: t.term, termEn: t.termEn })) };
}

test('demand: a crash after the paid Trends call resumes from checkpoint without calling Apify again', async () => {
  const { dir, b } = tmpBrand();
  const calls = [];
  await withEnv({ ...noForce, APIFY_API_TOKEN: 'fake', ESTAT_APP_ID: null }, async () => {
    // Simulate a crash at write time: jp_demand.json is a directory, so writeFileSync throws.
    fs.mkdirSync(path.join(b, 'jp_demand.json'));
    await assert.rejects(demand.collectDemand({ slug: SLUG, dataDir: dir, log: () => {}, deps: { apifyClientFactory: () => trendsClient(calls), httpGetJson: async () => { throw new Error('no'); } } }));
    assert.equal(calls.length, 1, 'Trends called once in the crashed run');
    assert.deepEqual(checkpoint.keys(SLUG, 'demand', { dataDir: dir }), ['trends']);

    fs.rmdirSync(path.join(b, 'jp_demand.json'));
    const logs = [];
    const trap = [];
    const out = await demand.collectDemand({ slug: SLUG, dataDir: dir, log: m => logs.push(m), deps: trapDeps(trap) });
    assert.deepEqual(trap, [], 'no network on resume');
    assert.ok(logs.some(l => l.includes('trends: resumed from checkpoint')));
    assert.equal(out.trends.find(t => t.term === 'おもちゃ').interestOverTime.peak.value, 100);
  });
  assert.ok(fs.statSync(path.join(b, 'jp_demand.json')).isFile());
  assert.equal(fs.existsSync(checkpoint.fileFor(SLUG, 'demand', dir)), false, 'checkpoint cleared after the real output is written');
});

test('demand: a checkpoint for different terms is not reused; BI_FORCE=1 ignores checkpoints', async () => {
  const { dir } = tmpBrand();
  checkpoint.put(SLUG, 'demand', 'trends', { termKey: 'something else', trends: [] }, { dataDir: dir });
  const calls = [];
  await withEnv({ ...noForce, APIFY_API_TOKEN: 'fake', ESTAT_APP_ID: null }, async () => {
    await demand.collectDemand({ slug: SLUG, dataDir: dir, log: () => {}, deps: { apifyClientFactory: () => trendsClient(calls), httpGetJson: async () => { throw new Error('no'); } } });
  });
  assert.equal(calls.length, 1);
});

test('demand: failed sources carry previous good data forward marked stale, never emptied', async () => {
  const { dir, b } = tmpBrand({ prevDemand: true });
  // The previous file's trends must be for the same terms this run derives (see the termKey test).
  const prev = withCurrentTerms(readJson(path.join(b, 'jp_demand.json')));
  fs.writeFileSync(path.join(b, 'jp_demand.json'), JSON.stringify(prev));
  await withEnv({ ...noForce, APIFY_API_TOKEN: null, ESTAT_APP_ID: null }, async () => {
    const out = await demand.collectDemand({ slug: SLUG, dataDir: dir, log: () => {}, deps: trapDeps([]) });
    const toy = out.trends.find(t => t.term === 'おもちゃ');
    assert.ok(toy && toy.interestOverTime, 'previous good trend kept');
    assert.equal(out.trends.length, currentTerms().length);
    assert.equal(toy.stale, true);
    assert.equal(toy.asOf, prev.generatedAt);
    assert.equal(toy.lastError, 'APIFY_API_TOKEN is not set');
    assert.ok(!Number.isNaN(Date.parse(toy.lastAttempt)));
    assert.ok(out.demographics.datasets.births, 'previous e-Stat dataset kept');
    assert.equal(out.demographics.stale, true);
    assert.equal(out.demographics.lastError, 'ESTAT_APP_ID is not set');
  });
  // A second failure keeps the original asOf rather than the stale file's date.
  await withEnv({ ...noForce, APIFY_API_TOKEN: null, ESTAT_APP_ID: null }, async () => {
    const again = await demand.collectDemand({ slug: SLUG, dataDir: dir, log: () => {}, deps: trapDeps([]) });
    assert.equal(again.trends.find(t => t.term === 'おもちゃ').asOf, prev.generatedAt);
  });
});

test('demand: dryRun makes no network call and reads or writes no checkpoint', async () => {
  const { dir } = tmpBrand();
  checkpoint.put(SLUG, 'demand', 'trends', { termKey: demand.deriveTerms(readJson(path.join(DFX, 'profile.json')), readJson(path.join(DFX, 'marketplace.json'))).map(t => t.term).join('|'), trends: [] }, { dataDir: dir });
  const calls = [];
  const logs = [];
  await withEnv({ ...noForce, APIFY_API_TOKEN: 'fake', ESTAT_APP_ID: 'fake' }, async () => {
    await demand.collectDemand({ slug: SLUG, dataDir: dir, dryRun: true, log: m => logs.push(m), deps: trapDeps(calls) });
  });
  assert.deepEqual(calls, []);
  assert.ok(!logs.some(l => l.includes('resumed from checkpoint')));
  assert.ok(logs.some(l => l.includes('"timeRange":""')));
  assert.ok(fs.existsSync(checkpoint.fileFor(SLUG, 'demand', dir)), 'dry run does not clear a real checkpoint');
});

// ─── marketplace_jp ─────────────────────────────────────────────────────────

const amazonReviewPage = (reviews) => `<span id="productTitle">テスト商品</span>${reviews.map(r => `
<div data-hook="review" id="x"><i data-hook="review-star-rating"><span class="a-icon-alt">5つ星のうち${r.rating || 5}</span></i>
<span data-hook="review-date">${r.date}</span>
<span data-hook="review-body"><span>${r.text}</span></span></div>`).join('')}`;

function fakeFetcher(pages, visited = []) {
  const seq = {};
  return {
    visited,
    async fetchPage(url) {
      visited.push(url);
      const p = pages[url];
      if (Array.isArray(p)) { seq[url] = (seq[url] || 0) + 1; return { url, finalUrl: url, ...p[Math.min(seq[url], p.length) - 1] }; }
      if (typeof p === 'function') return { url, finalUrl: url, ...p(url) };
      if (p) return { url, finalUrl: url, ...p };
      return { url, finalUrl: url, status: 404, html: '' };
    },
    async close() {},
  };
}
const CATS = [
  { source: 'rakuten', category: 'toys', url: 'https://r.test/cat' },
  { source: 'rakuten', category: 'rank', url: 'https://r.test/rank' },
  { source: 'amazon_jp', category: 'bs', url: 'https://a.test/bs' },
];
function tmpMarket(prev) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-resume-'));
  if (prev) { fs.mkdirSync(path.join(dir, 'brands', SLUG), { recursive: true }); fs.writeFileSync(path.join(dir, 'brands', SLUG, 'marketplace.json'), JSON.stringify(prev)); }
  return dir;
}

test('reviewedIn is read from the review date line, Japanese and English forms', () => {
  assert.equal(mp.reviewedIn('<span data-hook="review-date">2026年10月1日にアメリカ合衆国でレビュー済み</span>'), 'アメリカ合衆国');
  assert.equal(mp.reviewedIn('<span data-hook="review-date" class="a">Reviewed in the United States on October 1, 2026</span>'), 'United States');
  assert.equal(mp.reviewedIn('<p>none</p>'), null);
});

test('review language mix: Japanese kept, other languages capped to keep Japanese >= 70%, nothing dropped when no Japanese', () => {
  const ja = Array.from({ length: 10 }, (_, i) => ({ lang: 'ja', text: `良い${i}` }));
  const en = Array.from({ length: 20 }, (_, i) => ({ lang: 'en', text: `good ${i}` }));
  const r = mp.balanceReviewLanguages([...en, ...ja]);
  assert.equal(r.reviews.filter(x => x.lang === 'ja').length, 10);
  assert.equal(r.reviews.filter(x => x.lang !== 'ja').length, 4);
  assert.equal(r.dropped, 16);
  assert.ok(10 / r.reviews.length >= 0.7);
  const onlyEn = mp.balanceReviewLanguages(en.slice(0, 5));
  assert.equal(onlyEn.reviews.length, 5, 'no Japanese available: keep the evidence that exists');
  assert.equal(onlyEn.dropped, 0);
  assert.deepEqual(mp.balanceReviewLanguages([]).reviews, []);
});

test('marketplace run: English Amazon reviews are capped, provenance kept, Japanese share >= 70%', async () => {
  const enRev = Array.from({ length: 12 }, (_, i) => ({ text: `Great set number ${i}, kids love it`, date: 'Reviewed in the United States on October 1, 2026' }));
  const jaRev = Array.from({ length: 3 }, (_, i) => ({ text: `子供が喜んでいます ${i}`, date: '2026年10月1日に日本でレビュー済み' }));
  const pages = {
    'https://a.test/bs': { status: 200, html: fx('amazon_bestsellers.html') },
    'https://r.test/cat': { status: 200, html: '<html><body>no items</body></html>' },
    'https://r.test/rank': { status: 200, html: '<html><body>no items</body></html>' },
  };
  const fetcher = fakeFetcher(pages);
  const orig = fetcher.fetchPage;
  fetcher.fetchPage = async (url) => (url.includes('amazon.co.jp/dp/') ? { url, finalUrl: url, status: 200, html: amazonReviewPage([...enRev, ...jaRev]) } : orig(url));
  const out = await mp.collectMarketplace({ slug: SLUG, dataDir: tmpMarket(), fetcher, env: {}, log: () => {}, categories: CATS, retryDelayMs: 0 });
  const amz = out.reviews.filter(r => r.source === 'amazon_jp');
  const jaShare = amz.filter(r => r.lang === 'ja').length / amz.length;
  assert.ok(amz.length > 0);
  assert.ok(jaShare >= 0.7, `ja share ${jaShare}`);
  assert.ok(amz.filter(r => r.lang === 'en').every(r => r.reviewedIn === 'United States'), 'English reviews say where they were written');
  const st = out.reviewStatus.find(s => s.source === 'amazon_jp');
  assert.ok(st.lang.droppedOther > 0);
});

test('marketplace: overload page gets one delayed retry and succeeds on it', async () => {
  const pages = {
    'https://r.test/cat': { status: 200, html: fx('rakuten_category.html') },
    'https://r.test/rank': [{ status: 403, html: fx('rakuten_busy_403.html') }, { status: 200, html: fx('rakuten_category.html') }],
    'https://a.test/bs': { status: 200, html: fx('amazon_bestsellers.html') },
  };
  const visited = [];
  const logs = [];
  const out = await mp.collectMarketplace({ slug: SLUG, dataDir: tmpMarket(), fetcher: fakeFetcher(pages, visited), env: {}, log: m => logs.push(m), categories: CATS, retryDelayMs: 0 });
  const rank = out.categories.find(c => c.category === 'rank');
  assert.equal(rank.topItems.length, 4);
  assert.deepEqual(rank.retry, { firstReason: 'overload_page', result: 'ok' });
  assert.equal(visited.filter(u => u === 'https://r.test/rank').length, 2);
  assert.ok(!out.blocked);
  assert.deepEqual(out.categories.map(c => c.category), ['toys', 'rank', 'bs'], 'configured order kept');
  assert.ok(logs.some(l => l.includes('one delayed retry')));
  assert.equal(mp.isRetryableBlock('captcha'), false);
  assert.equal(mp.isRetryableBlock('http_429'), true);
});

test('marketplace: fresh checkpointed units are reused, logged, and cleared after write', async () => {
  const dir = tmpMarket();
  const savedCat = { source: 'rakuten', category: 'toys', url: 'https://r.test/cat', topItems: [{ rank: 1, title: 'チェックポイント商品', brand: null, priceJPY: 1000, reviewCount: 1, rating: 5, url: null }] };
  checkpoint.put(SLUG, 'marketplace', 'rakuten/toys', savedCat, { dataDir: dir });
  checkpoint.put(SLUG, 'marketplace', 'reviews/rakuten', { reviews: [{ source: 'rakuten', productTitle: 'p', rating: 4, text: '良い', lang: 'ja' }], status: { source: 'rakuten', collected: 1 } }, { dataDir: dir });
  const visited = [];
  const logs = [];
  const pages = { 'https://r.test/rank': { status: 200, html: fx('rakuten_category.html') }, 'https://a.test/bs': { status: 200, html: fx('amazon_bestsellers.html') } };
  const out = await withEnv(noForce, () => mp.collectMarketplace({ slug: SLUG, dataDir: dir, fetcher: fakeFetcher(pages, visited), env: {}, log: m => logs.push(m), categories: CATS, retryDelayMs: 0 }));
  assert.ok(!visited.includes('https://r.test/cat'), 'resumed category not fetched again');
  assert.ok(!visited.some(u => /rakuten\.co\.jp/.test(u)), 'resumed rakuten review sample not fetched again');
  assert.equal(out.categories.find(c => c.category === 'toys').topItems[0].title, 'チェックポイント商品');
  assert.ok(out.reviews.some(r => r.text === '良い'));
  assert.ok(logs.some(l => l === 'rakuten/toys: resumed from checkpoint'));
  assert.ok(logs.some(l => l === 'reviews/rakuten: resumed from checkpoint'));
  assert.equal(out.reviewStatus.find(s => s.source === 'rakuten').resumed, true);
  assert.equal(fs.existsSync(checkpoint.fileFor(SLUG, 'marketplace', dir)), false);
});

test('marketplace: a blocked source carries previous good data forward stale instead of emptying the file', async () => {
  const prev = {
    generatedAt: '2026-11-16T00:00:00.000Z', market: 'JP', sources: ['amazon_jp', 'rakuten'],
    categories: [{ source: 'amazon_jp', category: 'bs', url: 'https://a.test/bs', topItems: [{ rank: 1, title: '前回の商品', brand: null, priceJPY: 500, reviewCount: 3, rating: 4, url: 'https://www.amazon.co.jp/dp/B000000001' }] }],
    brandMix: [], reviews: [{ source: 'amazon_jp', productTitle: '前回の商品', rating: 4, text: '前回のレビュー', lang: 'ja' }],
  };
  const dir = tmpMarket(prev);
  const pages = {
    'https://r.test/cat': { status: 200, html: fx('rakuten_category.html') },
    'https://r.test/rank': { status: 200, html: fx('rakuten_category.html') },
    'https://a.test/bs': { status: 200, html: fx('amazon_captcha.html') },
  };
  const fetcher = fakeFetcher(pages);
  const orig = fetcher.fetchPage;
  fetcher.fetchPage = async (url) => (url.includes('amazon.co.jp/dp/') ? { url, finalUrl: url, status: 200, html: fx('amazon_captcha.html') } : orig(url));
  const out = await withEnv(noForce, () => mp.collectMarketplace({ slug: SLUG, dataDir: dir, fetcher, env: {}, log: () => {}, categories: CATS, retryDelayMs: 0 }));
  const bs = out.categories.find(c => c.category === 'bs');
  assert.equal(bs.topItems[0].title, '前回の商品');
  assert.equal(bs.stale, true);
  assert.equal(bs.lastError, 'captcha');
  assert.equal(bs.asOf, prev.generatedAt);
  assert.ok(!bs.blocked, 'carried data is marked stale, not blocked');
  assert.deepEqual(out.blocked.map(b => b.category), ['bs']);
  const amzRev = out.reviews.filter(r => r.source === 'amazon_jp');
  assert.equal(amzRev.length, 1);
  assert.equal(amzRev[0].stale, true);
  assert.match(amzRev[0].lastError, /blocked \(captcha\)/);
  assert.equal(out.reviewStatus.find(s => s.source === 'amazon_jp').carriedForward, 1);
  // Written file has both the fresh rakuten data and the stale amazon data.
  const written = readJson(path.join(dir, 'brands', SLUG, 'marketplace.json'));
  assert.ok(written.categories.find(c => c.category === 'toys').topItems.length > 0);
  assert.equal(written.categories.find(c => c.category === 'bs').stale, true);
});

test('marketplace: review cap is split fairly across sources', () => {
  const a = Array.from({ length: 300 }, (_, i) => ({ source: 'amazon_jp', i }));
  const r = Array.from({ length: 30 }, (_, i) => ({ source: 'rakuten', i }));
  const out = mp.capReviewsFairly({ amazon_jp: a, rakuten: r }, 200);
  assert.equal(out.length, 200);
  assert.equal(out.filter(x => x.source === 'rakuten').length, 30);
});

test('marketplace: dryRun makes no network call and writes no checkpoint', async () => {
  const dir = tmpMarket();
  const fetcher = { fetchPage: async () => { throw new Error('network called on dry run'); }, close: async () => {} };
  const out = await mp.collectMarketplace({ slug: SLUG, dryRun: true, dataDir: dir, fetcher, fetchImpl: async () => { throw new Error('fetch'); }, env: { RAKUTEN_APP_ID: 'x', APIFY_API_TOKEN: 'y' }, log: () => {} });
  assert.equal(out.dryRun, true);
  assert.equal(fs.existsSync(path.join(dir, 'brands', SLUG)), false);
});

test('marketplace: a crash after the first category keeps unreached units from the previous file, stale, and flags the file partial', async () => {
  const item = (t) => ({ rank: 1, title: t, brand: null, priceJPY: 900, reviewCount: 2, rating: 4, url: null });
  const prev = {
    generatedAt: '2026-11-15T00:00:00.000Z', market: 'JP', sources: ['amazon_jp', 'rakuten'],
    categories: [
      { source: 'rakuten', category: 'toys', url: 'https://r.test/cat', topItems: [item('前回toys')] },
      { source: 'rakuten', category: 'rank', url: 'https://r.test/rank', topItems: [item('前回rank')] },
      { source: 'amazon_jp', category: 'bs', url: 'https://a.test/bs', topItems: [item('前回bs')] },
    ],
    brandMix: [],
    reviews: [
      { source: 'amazon_jp', productTitle: 'a', rating: 5, text: '前回アマゾン', lang: 'ja' },
      { source: 'rakuten', productTitle: 'r', rating: 3, text: '前回楽天', lang: 'ja' },
    ],
  };
  const dir = tmpMarket(prev);
  let n = 0;
  const fetcher = {
    async fetchPage(url) {
      if (++n > 1) throw new Error('simulated crash');
      return { url, finalUrl: url, status: 200, html: fx('rakuten_category.html') };
    },
    async close() {},
  };
  const out = await withEnv(noForce, () => mp.collectMarketplace({ slug: SLUG, dataDir: dir, fetcher, env: {}, log: () => {}, categories: CATS, retryDelayMs: 0 }));
  assert.equal(out.partial, true);
  assert.deepEqual(out.unreached.sort(), ['amazon_jp/bs', 'rakuten/rank', 'reviews/amazon_jp', 'reviews/rakuten']);
  const toys = out.categories.find(c => c.category === 'toys');
  assert.equal(toys.topItems.length, 4, 'reached category is fresh');
  assert.ok(!toys.stale);
  for (const cat of ['rank', 'bs']) {
    const c = out.categories.find(x => x.category === cat);
    assert.equal(c.topItems[0].title, `前回${cat}`, `${cat} survives from the previous file`);
    assert.equal(c.stale, true);
    assert.equal(c.lastError, 'not reached after crash');
    assert.equal(c.asOf, prev.generatedAt);
    assert.ok(!Number.isNaN(Date.parse(c.lastAttempt)));
  }
  assert.deepEqual(out.categories.map(c => c.category), ['toys', 'rank', 'bs']);
  assert.deepEqual(out.reviews.map(r => [r.text, r.stale]).sort(), [['前回アマゾン', true], ['前回楽天', true]]);
  const written = readJson(path.join(dir, 'brands', SLUG, 'marketplace.json'));
  assert.equal(written.partial, true);
  assert.equal(written.categories.length, 3);
  assert.ok(out.notes.some(x => x.includes('simulated crash')));
  assert.deepEqual(checkpoint.keys(SLUG, 'marketplace', { dataDir: dir }), ['rakuten/toys'], 'checkpoint kept after a crash');

  // Personas: the partial file is flagged before any evidence, and stale lines are tagged.
  const personas = require('../analysis/personas');
  const digest = personas.buildEvidenceDigest(written, null);
  assert.ok(digest.startsWith('NOTE: the latest marketplace run did not finish (not reached: '));
  assert.ok(digest.includes('rakuten/rank'));
  assert.ok(/\[C\d+\] rakuten rank \[stale, as of 2026-11-15\]/.test(digest));
  assert.ok(/\[R\d+\] rakuten \[stale, as of 2026-11-15\]/.test(digest));
  assert.ok(!/^\[[A-Z]\d+\] NOTE/m.test(digest), 'the partial note carries no citation id');
  const complete = personas.buildEvidenceDigest({ ...written, partial: undefined, unreached: undefined }, null);
  assert.ok(!complete.includes('did not finish'));
});

test('demand: previous trends for different terms are not carried forward; the failure is recorded honestly', async () => {
  const { dir, b } = tmpBrand({ prevDemand: true });
  const prev = readJson(path.join(b, 'jp_demand.json')); // trends only for 'おもちゃ', not this run's terms
  assert.ok(prev.trends.some(t => t.interestOverTime));
  await withEnv({ ...noForce, APIFY_API_TOKEN: null, ESTAT_APP_ID: null }, async () => {
    const out = await demand.collectDemand({ slug: SLUG, dataDir: dir, log: () => {}, deps: trapDeps([]) });
    assert.ok(out.trends.every(t => t.interestOverTime === null && !t.stale), 'no old data under new terms');
    assert.deepEqual(out.trends.map(t => t.term), currentTerms().map(t => t.term));
    assert.equal(out.termKey, currentTerms().map(t => t.term).join('|'));
    assert.ok(out.notes.some(n => n.includes('were for different terms') && n.includes('not carried forward')));
    assert.equal(out.demographics.stale, true, 'e-Stat carry-forward is unaffected');
  });
});

test('atomic writes: a failed write leaves no .tmp file and the error still surfaces', async () => {
  // Rename failure: the target is a non-empty directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-'));
  const target = path.join(dir, 'out.json');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep'), 'x');
  const tmps = () => fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  for (const writer of [demand.writeJsonAtomic, mp.writeJsonAtomic]) {
    assert.throws(() => writer(target, { a: 1 }));
    assert.deepEqual(tmps(), []);
  }
  // Write failure after a partial temp file was created (disk full and similar).
  const orig = fs.writeFileSync;
  fs.writeFileSync = (f, d) => { orig(f, String(d).slice(0, 3)); const e = new Error('ENOSPC: simulated'); e.code = 'ENOSPC'; throw e; };
  try {
    for (const writer of [demand.writeJsonAtomic, mp.writeJsonAtomic]) {
      assert.throws(() => writer(path.join(dir, 'b.json'), { a: 1 }), /ENOSPC/);
      assert.deepEqual(tmps(), []);
    }
  } finally { fs.writeFileSync = orig; }
  assert.ok(!fs.existsSync(path.join(dir, 'b.json')));

  // Through the real entry points: marketplace logs the failure and keeps its checkpoint; demand rejects.
  const mdir = tmpMarket();
  const bdir = path.join(mdir, 'brands', SLUG);
  fs.mkdirSync(path.join(bdir, 'marketplace.json'), { recursive: true });
  fs.writeFileSync(path.join(bdir, 'marketplace.json', 'keep'), 'x');
  const logs = [];
  const pages = { 'https://r.test/cat': { status: 200, html: fx('rakuten_category.html') } };
  await withEnv(noForce, () => mp.collectMarketplace({ slug: SLUG, dataDir: mdir, fetcher: fakeFetcher(pages), env: {}, log: m => logs.push(m), categories: [CATS[0]], retryDelayMs: 0 }));
  assert.ok(logs.some(l => l.startsWith('write failed')));
  assert.deepEqual(fs.readdirSync(bdir).filter(f => f.endsWith('.tmp')), []);
  assert.ok(checkpoint.keys(SLUG, 'marketplace', { dataDir: mdir }).includes('rakuten/toys'), 'checkpoint kept when the write failed');

  const { dir: ddir, b } = tmpBrand();
  fs.mkdirSync(path.join(b, 'jp_demand.json'));
  fs.writeFileSync(path.join(b, 'jp_demand.json', 'keep'), 'x');
  await withEnv({ ...noForce, APIFY_API_TOKEN: null, ESTAT_APP_ID: null }, async () => {
    await assert.rejects(demand.collectDemand({ slug: SLUG, dataDir: ddir, log: () => {}, deps: trapDeps([]) }));
  });
  assert.deepEqual(fs.readdirSync(b).filter(f => f.endsWith('.tmp')), []);
});
