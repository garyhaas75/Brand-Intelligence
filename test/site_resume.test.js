// Resume and carry-forward for the website and competitive scrape steps. No network:
// scrapeBrands takes a scrapeOne test seam, so Chromium is never launched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const site = require('../scrapers/site_scraper');
const checkpoint = require('../utils/checkpoint');
const audit = require('../analysis/website_audit');
const competitive = require('../analysis/competitive_analysis');

const SLUG = 'zz-site-resume';
const STEP = 'website-scrape';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'bi-site-resume-')); }
const brands = [
  { id: 'a', name: 'A', url: 'https://a.example/', role: 'target' },
  { id: 'b', name: 'B', url: 'https://b.example/', role: 'competitor' },
  { id: 'c', name: 'C', url: 'https://c.example/', role: 'competitor' },
];
const good = (b) => ({ id: b.id, name: b.name, url: b.url, role: b.role, scrapedAt: new Date().toISOString(), featuredCategories: ['x', 'y'], botBlocked: false, error: null });

function withEnv(key, val, fn) {
  const prev = process.env[key];
  if (val === undefined) delete process.env[key]; else process.env[key] = val;
  return Promise.resolve().then(fn).finally(() => { if (prev === undefined) delete process.env[key]; else process.env[key] = prev; });
}

test('second call reuses checkpointed brands and only scrapes the missing one', () => withEnv('BI_FORCE', undefined, async () => {
  const dataDir = tmpDir();
  try {
    // First run: B throws, A and C succeed.
    const calls1 = [];
    await site.scrapeBrands(brands, { slug: SLUG, checkpointStep: STEP, checkpointDataDir: dataDir, scrapeOne: async (b) => { calls1.push(b.id); if (b.id === 'b') throw new Error('ECONNRESET'); return good(b); } });
    assert.deepStrictEqual(calls1, ['a', 'b', 'c']);
    assert.deepStrictEqual(checkpoint.keys(SLUG, STEP, { dataDir }).sort(), ['a', 'b', 'c']);

    const calls2 = [];
    const res = await site.scrapeBrands(brands, { slug: SLUG, checkpointStep: STEP, checkpointDataDir: dataDir, scrapeOne: async (b) => { calls2.push(b.id); return good(b); } });
    assert.deepStrictEqual(calls2, ['b'], 'only the failed brand is scraped again');
    assert.deepStrictEqual(res.map(r => r.id), ['a', 'b', 'c']);
    assert.ok(res.every(r => !r.error));
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}));

test('a failed brand keeps previous good data and is marked stale', () => withEnv('BI_FORCE', undefined, async () => {
  const prior = { ...good(brands[1]), scrapedAt: '2026-11-01T00:00:00.000Z', featuredCategories: ['old-good'] };
  const res = await site.scrapeBrands(brands.slice(1, 2), { existingData: { b: prior }, scrapeOne: async (b) => ({ id: b.id, name: b.name, role: b.role, botBlocked: true, featuredCategories: [], error: null }) });
  assert.strictEqual(res.length, 1);
  assert.deepStrictEqual(res[0].featuredCategories, ['old-good']);
  assert.strictEqual(res[0].stale, true);
  assert.strictEqual(res[0].lastError, 'bot-blocked');
  assert.ok(res[0].lastAttempt);

  const errored = await site.scrapeBrands(brands.slice(1, 2), { existingData: { b: prior }, scrapeOne: async () => { throw new Error('timeout'); } });
  assert.strictEqual(errored[0].lastError, 'timeout');
  assert.deepStrictEqual(errored[0].featuredCategories, ['old-good']);

  // No prior good data: the failure is reported as is.
  const bare = await site.scrapeBrands(brands.slice(1, 2), { existingData: { b: { ...prior, error: 'old error' } }, scrapeOne: async () => { throw new Error('timeout'); } });
  assert.strictEqual(bare[0].error, 'timeout');
  assert.notStrictEqual(bare[0].stale, true);
}));

test('a stale carried-forward brand is checkpointed but retried on resume', () => withEnv('BI_FORCE', undefined, async () => {
  const dataDir = tmpDir();
  try {
    const prior = good(brands[1]);
    await site.scrapeBrands([brands[1]], { slug: SLUG, checkpointStep: STEP, checkpointDataDir: dataDir, existingData: { b: prior }, scrapeOne: async () => { throw new Error('down'); } });
    let calls = 0;
    await site.scrapeBrands([brands[1]], { slug: SLUG, checkpointStep: STEP, checkpointDataDir: dataDir, scrapeOne: async (b) => { calls++; return good(b); } });
    assert.strictEqual(calls, 1);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}));

test('BI_FORCE=1 re-scrapes everything', () => withEnv('BI_FORCE', undefined, async () => {
  const dataDir = tmpDir();
  try {
    await site.scrapeBrands(brands, { slug: SLUG, checkpointStep: STEP, checkpointDataDir: dataDir, scrapeOne: async (b) => good(b) });
    const calls = [];
    await withEnv('BI_FORCE', '1', () => site.scrapeBrands(brands, { slug: SLUG, checkpointStep: STEP, checkpointDataDir: dataDir, scrapeOne: async (b) => { calls.push(b.id); return good(b); } }));
    assert.deepStrictEqual(calls, ['a', 'b', 'c']);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}));

test('checkpoint is cleared after the output is written, kept when incomplete', () => withEnv('BI_FORCE', undefined, async () => {
  const dataDir = tmpDir();
  try {
    await site.scrapeBrands(brands, { slug: SLUG, checkpointStep: audit.CHECKPOINT_STEP, checkpointDataDir: dataDir, scrapeOne: async (b) => good(b) });
    const cpFile = checkpoint.fileFor(SLUG, audit.CHECKPOINT_STEP, dataDir);
    assert.ok(fs.existsSync(cpFile));

    audit.persistOutput(SLUG, { brands: [] }, { complete: false, dataDir });
    assert.ok(fs.existsSync(cpFile), 'incomplete run keeps the checkpoint');
    audit.persistOutput(SLUG, { brands: [1] }, { complete: true, dataDir });
    assert.ok(!fs.existsSync(cpFile), 'complete run clears the checkpoint');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'brands', SLUG, 'site_intelligence.json'), 'utf8')).brands, [1]);
    assert.strictEqual(fs.readdirSync(path.join(dataDir, 'brands', SLUG, 'history')).length, 1, 'previous output archived');

    const calls = [];
    await site.scrapeBrands(brands, { slug: SLUG, checkpointStep: audit.CHECKPOINT_STEP, checkpointDataDir: dataDir, scrapeOne: async (b) => { calls.push(b.id); return good(b); } });
    assert.deepStrictEqual(calls, ['a', 'b', 'c'], 'after clear the next run starts fresh');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}));

test('checkpoint copy drops only a large screenshot', () => {
  const small = { id: 'a', screenshotBase64: 'x'.repeat(1000) };
  assert.strictEqual(site.checkpointCopy(small).screenshotBase64.length, 1000);
  const big = { id: 'a', screenshotBase64: 'x'.repeat(site.CHECKPOINT_SCREENSHOT_MAX_BYTES + 1) };
  const c = site.checkpointCopy(big);
  assert.strictEqual(c.screenshotBase64, undefined);
  assert.strictEqual(c.screenshotDroppedFromCheckpoint, true);
  assert.ok(big.screenshotBase64, 'original result keeps its screenshot');
});

test('timeout fill carries unfinished brands forward as stale', () => {
  const existing = audit.existingBrandsById({ brands: [good(brands[0]), good(brands[1]), { ...good(brands[2]), botBlocked: true }] });
  const out = audit.fillUnfinished(brands, [good(brands[0])], existing, 'scrape budget exceeded');
  assert.deepStrictEqual(out.map(b => b.id), ['a', 'b']);
  assert.strictEqual(out[1].stale, true);
  assert.strictEqual(out[1].lastError, 'scrape budget exceeded');
});

test('Lighthouse is skipped with a reason for blocked or manually captured targets', () => {
  assert.match(audit.lighthouseSkipReason({}, { manualCapture: { htmlPath: 'x' } }, {}), /manual capture/);
  assert.match(audit.lighthouseSkipReason({ scrape: { skipApifyRetry: true } }, {}, {}), /blocks automated access/);
  assert.match(audit.lighthouseSkipReason({}, {}, { botBlocked: true }), /bot challenge/);
  assert.strictEqual(audit.lighthouseSkipReason({}, {}, { botBlocked: false }), null);
});

test('competitive analyses are checkpointed per competitor and not re-paid', () => withEnv('BI_FORCE', undefined, async () => {
  const dataDir = tmpDir();
  try {
    const scraped = brands.slice(1).map(good);
    const analysis = { pricingTier: 'mid', positioningStatement: 'p', strengths: ['s'], opportunities: ['o'], assortmentHighlights: [] };
    const calls1 = [];
    const r1 = await competitive.analyzeAll(scraped, { slug: SLUG, dataDir, analyze: async (s) => { calls1.push(s.id); if (s.id === 'c') throw new Error('overloaded'); return analysis; } });
    assert.deepStrictEqual(calls1, ['b', 'c']);
    assert.strictEqual(r1[1].analysisError, true);

    const calls2 = [];
    const r2 = await competitive.analyzeAll(scraped, { slug: SLUG, dataDir, analyze: async (s) => { calls2.push(s.id); return analysis; } });
    assert.deepStrictEqual(calls2, ['c'], 'finished analysis is reused');
    assert.deepStrictEqual(r2.map(r => r.strengths), [['s'], ['s']]);

    // A new scrape (different scrapedAt) invalidates the saved analysis.
    const calls3 = [];
    await competitive.analyzeAll([{ ...scraped[0], scrapedAt: '2030-01-01T00:00:00.000Z' }], { slug: SLUG, dataDir, analyze: async (s) => { calls3.push(s.id); return analysis; } });
    assert.deepStrictEqual(calls3, ['b']);

    // Failure with a previous good analysis keeps it, marked stale.
    const prev = [{ name: 'C', strengths: ['old'], opportunities: [] }];
    checkpoint.clear(SLUG, competitive.ANALYZE_STEP, { dataDir });
    const r4 = await competitive.analyzeAll([scraped[1]], { slug: SLUG, dataDir, prevCompetitors: prev, analyze: async () => { throw new Error('overloaded'); } });
    assert.deepStrictEqual(r4[0].strengths, ['old']);
    assert.strictEqual(r4[0].stale, true);
    assert.match(r4[0].lastError, /overloaded/);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}));

// ---- Round 3: no direct request to blocked hosts, empty-category failure, abort ----

function stubFetch() {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); throw new Error('network disabled in test'); };
  return { calls, restore: () => { globalThis.fetch = prev; } };
}

test('fetch stub is effective: the sitemap lookup goes through global fetch', async () => {
  const { fetchCategoriesFromSitemap } = require('../scrapers/sitemap_categories');
  const f = stubFetch();
  try {
    await fetchCategoriesFromSitemap('https://open.example/', () => {}).catch(() => {});
    assert.ok(f.calls.length > 0, 'control: an unblocked brand would fetch');
  } finally { f.restore(); }
});

test('skipApifyRetry brand with no manual capture gets no request at all and keeps prior data', () => withEnv('BI_FORCE', undefined, async () => {
  const f = stubFetch();
  try {
    const brand = { id: 'blocked', name: 'Blocked', url: 'https://blocked.invalid/', role: 'target', skipApifyRetry: true };
    const prior = { ...good(brand), featuredCategories: ['kept'] };
    const [r] = await site.scrapeBrands([brand], { existingData: { blocked: prior } });
    assert.deepStrictEqual(f.calls, []);
    assert.deepStrictEqual(r.featuredCategories, ['kept']);
    assert.strictEqual(r.stale, true);
    const [bare] = await site.scrapeBrands([brand]);
    assert.strictEqual(bare.skippedNoDirectRequest, true);
    assert.strictEqual(bare.botBlocked, true);
    assert.deepStrictEqual(f.calls, []);
  } finally { f.restore(); }
}));

test('manual capture with thin categories makes no sitemap fetch', async () => {
  const root = path.join(__dirname, '..');
  const dir = path.join(root, 'data/brands/_manual_probe_r3/manual_capture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mc.html'), '<html><body><nav><a href="/c/1">おもちゃ</a><a href="/c/2">ぬいぐるみ</a></nav><h1>セール</h1></body></html>');
  const f = stubFetch();
  try {
    const mc = site.manualCaptureFor('_manual_probe_r3', 'mc');
    const [r] = await site.scrapeBrands([{ id: 'mc', name: 'MC', url: 'https://blocked.invalid/', role: 'target', manualCapture: mc }]);
    assert.strictEqual(r.manualCapture, true);
    assert.deepStrictEqual(f.calls, [], 'no sitemap GET to a manually captured host');
  } finally { f.restore(); fs.rmSync(path.join(root, 'data/brands/_manual_probe_r3'), { recursive: true, force: true }); }
});

test('nav links all filtered as chrome plus no sitemap counts as failed: prior survives, stale', () => withEnv('BI_FORCE', undefined, async () => {
  const dataDir = tmpDir();
  try {
    const prior = { ...good(brands[1]), featuredCategories: ['good-cat'] };
    const attempt = { id: 'b', name: 'B', role: 'competitor', scrapedAt: new Date().toISOString(), navigation: [{ text: 'Cart' }, { text: 'Login' }], featuredCategories: [], botBlocked: false, error: null };
    assert.strictEqual(site.isFailedResult(attempt), true);
    const [r] = await site.scrapeBrands([brands[1]], { existingData: { b: prior }, slug: SLUG, checkpointStep: STEP, checkpointDataDir: dataDir, scrapeOne: async () => attempt });
    assert.deepStrictEqual(r.featuredCategories, ['good-cat']);
    assert.strictEqual(r.stale, true);
    assert.strictEqual(r.lastError, 'no categories');
    // And an empty-category checkpoint is never reused.
    assert.strictEqual(site.reusableCheckpoint(attempt), undefined);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}));

test('an aborted scrape starts no new brand and writes no checkpoint after the abort', () => withEnv('BI_FORCE', undefined, async () => {
  const dataDir = tmpDir();
  try {
    const ac = new AbortController();
    const calls = [];
    // Abort while brand a is in flight: a must not be checkpointed, b and c never start.
    await site.scrapeBrands(brands, { slug: SLUG, checkpointStep: STEP, checkpointDataDir: dataDir, signal: ac.signal, scrapeOne: async (b) => { calls.push(b.id); ac.abort(); return good(b); } });
    assert.deepStrictEqual(calls, ['a']);
    assert.ok(!fs.existsSync(checkpoint.fileFor(SLUG, STEP, dataDir)), 'no checkpoint written after abort');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}));

// ---- Round 4: stale data is labelled as stale in every prompt and in the output ----

const staleRecord = () => site.carryForward(
  { id: 'b', name: 'B', role: 'competitor', navigation: [{ text: 'Cart' }], featuredCategories: [], botBlocked: false, error: null },
  { ...good(brands[1]), scrapedAt: '2026-10-01T00:00:00.000Z', featuredCategories: ['old-cat'], heroContent: { headline: 'Old sale' } },
  '2026-11-17T00:00:00.000Z');

test('stale record keeps stale, asOf and lastError for readers', () => {
  const r = staleRecord();
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.asOf, '2026-10-01T00:00:00.000Z');
  assert.strictEqual(r.lastError, 'no categories');
  assert.strictEqual(r.lastAttempt, '2026-11-17T00:00:00.000Z');
});

test('competitor prompt for a stale entry says STALE with the date and never success', () => {
  const p = competitive.buildCompetitorPrompt('Target', 'toys', staleRecord());
  const statusLine = p.split('\n').find(l => l.startsWith('SCRAPE STATUS:'));
  assert.match(statusLine, /STALE/);
  assert.match(statusLine, /2026-10-01/);
  assert.match(statusLine, /no categories/);
  assert.doesNotMatch(statusLine, /success/);
  assert.match(p, /do not describe it as the competitor's current site/);
  // Fresh entries still read as success.
  assert.match(competitive.buildCompetitorPrompt('Target', 'toys', good(brands[1])), /SCRAPE STATUS: success/);
});

test('positioning map line marks stale and no-data competitors', () => {
  const stale = { name: 'B', positioningStatement: 'value toys', pricingTier: 'budget', strengths: ['x'], stale: true, asOf: '2026-10-01T00:00:00.000Z', lastError: 'bot-blocked' };
  assert.match(competitive.competitorSummaryLine(stale), /STALE: data from 2026-10-01.*bot-blocked/);
  assert.match(competitive.competitorSummaryLine({ name: 'C', strengths: [], error: 'overloaded' }), /^C: NO DATA/);
});

test('website audit competitor block labels stale and lists brands with no data', () => {
  const toScrape = [...brands, { id: 'd', name: 'D', url: 'https://d.example/', role: 'competitor' }];
  const block = audit.competitorContextBlock(toScrape, [good(brands[0]), staleRecord(), good(brands[2])]);
  const bPart = block.split('\n\n').find(s => s.startsWith('B:'));
  assert.match(bPart, /Status: STALE \(data from 2026-10-01/);
  assert.doesNotMatch(bPart, /success/);
  assert.match(block.split('\n\n').find(s => s.startsWith('C:')), /Status: success/);
  assert.match(block.split('\n\n').find(s => s.startsWith('D:')), /Status: NO DATA/);
  assert.ok(!block.includes('A:'), 'target is not listed as a competitor');
});

test('status line covers target stale, blocked-with-no-request and missing', () => {
  assert.match(site.scrapeStatusLine(undefined), /^NO DATA/);
  assert.match(site.scrapeStatusLine({ botBlocked: true, skippedNoDirectRequest: true, featuredCategories: [] }), /blocks automated access/);
  assert.match(site.scrapeStatusLine({ featuredCategories: [], botBlocked: false }), /no categories/);
  const filled = audit.fillUnfinished([brands[1]], [], { b: good(brands[1]) }, 'scrape budget exceeded');
  assert.match(site.scrapeStatusLine(filled[0]), /^STALE \(data from .*scrape budget exceeded/);
});

// ---- Round 4b: manual capture URL matching is normalised, still refuses everything else ----

test('manual capture matcher: no trailing slash, uppercase host, query kept, other paths refused', () => {
  const noSlash = site.manualCaptureMatcher('http://127.0.0.1:8123');
  assert.strictEqual(noSlash('http://127.0.0.1:8123/'), true);
  assert.strictEqual(noSlash('http://127.0.0.1:8123/#top'), true);
  const upper = site.manualCaptureMatcher('https://WWW.Example.CO.JP');
  assert.strictEqual(upper('https://www.example.co.jp/'), true);
  const q = site.manualCaptureMatcher('https://shop.example/?lang=ja');
  assert.strictEqual(q('https://shop.example/?lang=ja'), true);
  assert.strictEqual(q('https://shop.example/'), false, 'query is part of the identity');
  assert.strictEqual(q('https://shop.example/?lang=en'), false);
  const m = site.manualCaptureMatcher('https://shop.example');
  assert.strictEqual(m('https://shop.example/other'), false);
  assert.strictEqual(m('https://shop.example/app.js'), false);
  assert.strictEqual(m('https://cdn.example/'), false);
  assert.strictEqual(m('not a url'), false);
  assert.strictEqual(site.manualCaptureMatcher('garbage')('garbage'), false);
});

test('manual capture is served for an uppercase host with no trailing slash, no fetch', async () => {
  const root = path.join(__dirname, '..');
  const dir = path.join(root, 'data/brands/_manual_probe_r4/manual_capture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mc.html'), '<html><body><nav><a href="/c/1">おもちゃ</a><a href="/c/2">ぬいぐるみ</a><a href="/c/3">ブロック</a></nav><h1>セール</h1><img src="/x.png"></body></html>');
  const f = stubFetch();
  try {
    const mc = site.manualCaptureFor('_manual_probe_r4', 'mc');
    const [r] = await site.scrapeBrands([{ id: 'mc', name: 'MC', url: 'https://BLOCKED.invalid', role: 'target', manualCapture: mc }]);
    assert.ok(!r.error, String(r.error));
    assert.ok(r.navigation.length >= 3, JSON.stringify(r.navigation));
    assert.strictEqual(r.heroContent.headline, 'セール');
    assert.deepStrictEqual(f.calls, []);
  } finally { f.restore(); fs.rmSync(path.join(root, 'data/brands/_manual_probe_r4'), { recursive: true, force: true }); }
});
