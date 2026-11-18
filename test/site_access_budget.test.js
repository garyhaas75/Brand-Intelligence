const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const access = require('../utils/site_access');
const budget = require('../utils/apify_budget');

function tmpBrands(profiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-access-'));
  for (const [slug, p] of Object.entries(profiles)) {
    fs.mkdirSync(path.join(dir, slug), { recursive: true });
    fs.writeFileSync(path.join(dir, slug, 'profile.json'), JSON.stringify(p));
  }
  return dir;
}

test('toysrus.co.jp is denied without an authorization, proxy-only with one', () => {
  access._resetForTests();
  const none = tmpBrands({ a: { url: 'https://example.com/' } });
  assert.equal(access.accessFor('https://www.toysrus.co.jp/ja-jp/', [none]).mode, 'denied');
  access._resetForTests();
  const auth = tmpBrands({ 'toysrus-jp': { url: 'https://www.toysrus.co.jp/', scrape: { skipApifyRetry: true, access: { mode: 'jp_proxy', authorizedBy: 'WHP', authorizedAt: '2026-11-18', maxPagesPerModule: 3 } } } });
  const a = access.accessFor('https://www.toysrus.co.jp/ja-jp/', [auth]);
  assert.equal(a.mode, 'jp_proxy');
  assert.equal(a.maxPages, 3);
  assert.equal(access.accessFor('https://www.kiddyland.co.jp/', [auth]).mode, 'direct');
});

test('jp_proxy needs the code allow-list AND the live profile switch; who and when come from code', () => {
  access._resetForTests();
  // live profile switch on, allow-listed host: proxied, authorization text from the code allow-list
  const on = tmpBrands({ t: { url: 'https://www.toysrus.co.jp/', scrape: { access: { mode: 'jp_proxy' } } } });
  const a = access.accessFor('https://www.toysrus.co.jp/', [on]);
  assert.equal(a.mode, 'jp_proxy');
  assert.equal(a.authorization.by, access.PROXY_ALLOWED_HOSTS['toysrus.co.jp'].authorizedBy);
  assert.equal(a.authorization.at, '2026-11-18');
  // (b) a profile cannot grant proxy access to a host that is not in the code allow-list
  access._resetForTests();
  const other = tmpBrands({ x: { url: 'https://www.other-shop.example/', scrape: { skipApifyRetry: true, access: { mode: 'jp_proxy', authorizedBy: 'anyone', authorizedAt: '2026-11-18' } } } });
  assert.equal(access.accessFor('https://www.other-shop.example/', [other]).mode, 'denied');
  access._resetForTests();
  const other2 = tmpBrands({ x: { url: 'https://www.other-shop.example/', scrape: { access: { mode: 'jp_proxy', authorizedBy: 'anyone', authorizedAt: '2026-11-18' } } } });
  assert.equal(access.accessFor('https://www.other-shop.example/', [other2]).mode, 'direct', 'never jp_proxy');
  // (a) removing scrape.access from the live profile revokes, whatever the seed says
  access._resetForTests();
  const revoked = tmpBrands({ t: { url: 'https://www.toysrus.co.jp/', scrape: { skipApifyRetry: true } } });
  assert.equal(access.accessFor('https://www.toysrus.co.jp/', [revoked]).mode, 'denied');
  assert.ok(access._LIVE_DIRS.length === 1 && /data[\\/]brands$/.test(access._LIVE_DIRS[0]) && !access._LIVE_DIRS.some(d => /seed_data/.test(d)), 'the default reads only live profiles, never the seed');
  // the profile cannot raise the page budget above the default
  access._resetForTests();
  const greedy = tmpBrands({ t: { url: 'https://www.toysrus.co.jp/', scrape: { access: { mode: 'jp_proxy', maxPagesPerModule: 500 } } } });
  assert.equal(access.accessFor('https://www.toysrus.co.jp/', [greedy]).maxPages, access.DEFAULT_MAX_PAGES);
});

test('BI_PROXY_OFF=1 denies the proxy route', () => {
  access._resetForTests();
  const on = tmpBrands({ t: { url: 'https://www.toysrus.co.jp/', scrape: { access: { mode: 'jp_proxy' } } } });
  process.env.BI_PROXY_OFF = '1';
  try { assert.equal(access.accessFor('https://www.toysrus.co.jp/', [on]).mode, 'denied'); } finally { delete process.env.BI_PROXY_OFF; }
  access._resetForTests();
  assert.equal(access.accessFor('https://www.toysrus.co.jp/', [on]).mode, 'jp_proxy');
});

test('accessFor of a missing or unparseable URL is denied', () => {
  for (const u of [null, undefined, '', 'not a url', 'mailto:a@b.c']) {
    assert.deepEqual(access.accessFor(u), { mode: 'denied', reason: 'no valid URL' }, String(u));
  }
});

test('the proxy password fetch has a 15s timeout signal', async () => {
  access._resetForTests();
  const saved = { fetch: globalThis.fetch, pw: process.env.APIFY_PROXY_PASSWORD, tok: process.env.APIFY_TOKEN };
  delete process.env.APIFY_PROXY_PASSWORD;
  process.env.APIFY_TOKEN = 'tok-test';
  let seen = null;
  globalThis.fetch = async (url, o) => { seen = o; return { json: async () => ({ data: { proxy: { password: 'pw' } } }) }; };
  try {
    assert.equal(await access.proxyPassword(), 'pw');
    assert.ok(seen && seen.signal instanceof AbortSignal, 'fetch gets an AbortSignal');
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.tok === undefined) delete process.env.APIFY_TOKEN; else process.env.APIFY_TOKEN = saved.tok;
    if (saved.pw !== undefined) process.env.APIFY_PROXY_PASSWORD = saved.pw;
    access._resetForTests();
  }
});

/** A request context whose responses come from a map url -> { status, location?, text? }. */
function redirectFactory(map, log) {
  return async (px) => ({
    get: async (url, o) => {
      log.push({ url, proxy: !!px, maxRedirects: o && o.maxRedirects });
      const r = map[url] || { status: 404 };
      return { status: () => r.status, url: () => url, headers: () => (r.location ? { location: r.location } : {}), text: async () => r.text || '' };
    },
    dispose: async () => {},
  });
}

test('fetchPage follows redirects by hand and re-checks the route on every hop', async () => {
  access._resetForTests();
  process.env.APIFY_PROXY_PASSWORD = 'pw-test';
  const dir = tmpBrands({
    t: { url: 'https://www.toysrus.co.jp/', scrape: { access: { mode: 'jp_proxy', maxPagesPerModule: 4 } } },
    b: { url: 'https://blocked-shop.example/', scrape: { skipApifyRetry: true } },
  });
  const noSleep = async () => {};
  try {
    // direct -> direct: followed, never with automatic redirects
    let log = [];
    let r = await access.fetchPage('https://a.example/', { dirs: [dir], sleep: noSleep, requestFactory: redirectFactory({
      'https://a.example/': { status: 301, location: '/home' }, 'https://a.example/home': { status: 200, text: 'ok' } }, log) });
    assert.equal(r.ok, true);
    assert.equal(r.url, 'https://a.example/home');
    assert.deepEqual(log.map(l => l.maxRedirects), [0, 0]);
    // direct -> denied: stops before the denied hop
    log = [];
    r = await access.fetchPage('https://a.example/', { dirs: [dir], sleep: noSleep, requestFactory: redirectFactory({
      'https://a.example/': { status: 302, location: 'https://blocked-shop.example/x' } }, log) });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'redirected to a host this route may not request');
    assert.equal(log.length, 1);
    // direct -> jp_proxy: never switches to the proxy mid-chain, never loads it directly
    log = [];
    r = await access.fetchPage('https://a.example/', { dirs: [dir], sleep: noSleep, requestFactory: redirectFactory({
      'https://a.example/': { status: 302, location: 'https://www.toysrus.co.jp/' } }, log) });
    assert.equal(r.skipped, true);
    assert.equal(log.length, 1);
    assert.equal(access.pagesUsedFor('https://www.toysrus.co.jp/'), 0);
    // jp_proxy -> jp_proxy on the same host: each hop costs a page of the budget
    log = [];
    r = await access.fetchPage('https://www.toysrus.co.jp/', { dirs: [dir], sleep: noSleep, requestFactory: redirectFactory({
      'https://www.toysrus.co.jp/': { status: 301, location: '/ja-jp/' }, 'https://www.toysrus.co.jp/ja-jp/': { status: 200, text: '<title>t</title>' } }, log) });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'jp_proxy');
    assert.equal(access.pagesUsedFor('https://www.toysrus.co.jp/'), 2);
    assert.ok(log.every(l => l.proxy));
    // jp_proxy -> direct: stops
    log = [];
    r = await access.fetchPage('https://www.toysrus.co.jp/a', { dirs: [dir], sleep: noSleep, requestFactory: redirectFactory({
      'https://www.toysrus.co.jp/a': { status: 302, location: 'https://a.example/' } }, log) });
    assert.equal(r.skipped, true);
    assert.equal(log.length, 1);
    // budget exhausted mid-chain: the hop is not requested
    log = [];
    r = await access.fetchPage('https://www.toysrus.co.jp/b', { dirs: [dir], sleep: noSleep, requestFactory: redirectFactory({
      'https://www.toysrus.co.jp/b': { status: 302, location: '/c' } }, log) });
    assert.equal(r.skipped, true);
    assert.match(r.reason, /Page budget/);
    assert.equal(log.length, 1);
    // more than 5 hops: stops
    access._resetForTests();
    log = [];
    const loop = {}; for (let i = 0; i < 10; i++) loop[`https://a.example/${i}`] = { status: 302, location: `/${i + 1}` };
    r = await access.fetchPage('https://a.example/0', { dirs: [dir], sleep: noSleep, requestFactory: redirectFactory(loop, log) });
    assert.equal(r.ok, false);
    assert.equal(log.length, 6);
  } finally { delete process.env.APIFY_PROXY_PASSWORD; }
});

test('guardContext aborts requests a direct context may not make; a proxied context aborts denied hosts only', async () => {
  access._resetForTests();
  const dir = tmpBrands({
    t: { url: 'https://www.toysrus.co.jp/', scrape: { skipApifyRetry: true, access: { mode: 'jp_proxy' } } },
    b: { url: 'https://blocked-shop.example/', scrape: { skipApifyRetry: true } },
  });
  const fakeContext = () => { const c = { handler: null, pattern: null, route: async (p, h) => { c.pattern = p; c.handler = h; } }; return c; };
  const run = async (ctx, url) => { let out = null; await ctx.handler({ request: () => ({ url: () => url }), continue: async () => { out = 'continue'; }, abort: async () => { out = 'abort'; } }); return out; };
  const direct = fakeContext();
  assert.equal(await access.guardContext(direct, 'direct', { dirs: [dir] }), true);
  assert.equal(direct.pattern, '**/*');
  assert.equal(await run(direct, 'https://ok.example/a.js'), 'continue');
  assert.equal(await run(direct, 'https://www.toysrus.co.jp/ja-jp/'), 'abort', 'proxy-only host never loaded directly');
  assert.equal(await run(direct, 'https://blocked-shop.example/'), 'abort');
  assert.equal(await run(direct, 'data:image/png;base64,AA=='), 'continue');
  const proxied = fakeContext();
  await access.guardContext(proxied, 'jp_proxy', { dirs: [dir] });
  assert.equal(await run(proxied, 'https://www.toysrus.co.jp/ja-jp/'), 'continue');
  assert.equal(await run(proxied, 'https://cdn.example/app.js'), 'continue');
  assert.equal(await run(proxied, 'https://blocked-shop.example/'), 'abort');
  assert.equal(await access.guardContext({}), false, 'no route(): nothing installed');
});

test('the old direct-request rule stays false for a proxy-only host', () => {
  access._resetForTests();
  const dir = tmpBrands({ t: { url: 'https://www.toysrus.co.jp/', scrape: { skipApifyRetry: true, access: { mode: 'jp_proxy', authorizedBy: 'WHP', authorizedAt: '2026-11-18' } } } });
  assert.equal(require('../utils/no_contact').hostAllowed('https://www.toysrus.co.jp/', [dir]), false);
});

test('fetchPage: denied makes no request, proxy route uses the JP proxy and stops at the page budget', async () => {
  access._resetForTests();
  process.env.APIFY_PROXY_PASSWORD = 'pw-test';
  const denyDir = tmpBrands({ a: { url: 'https://example.com/' } });
  let made = 0;
  const factory = async (px) => ({ proxyUsed: px, get: async (url) => { made++; return { status: () => 200, url: () => url, text: async () => '<title>ok</title>' }; }, dispose: async () => {} });
  const d = await access.fetchPage('https://www.toysrus.co.jp/', { dirs: [denyDir], requestFactory: factory });
  assert.equal(d.skipped, true);
  assert.equal(made, 0);

  access._resetForTests();
  const dir = tmpBrands({ t: { url: 'https://www.toysrus.co.jp/', scrape: { access: { mode: 'jp_proxy', authorizedBy: 'WHP', authorizedAt: '2026-11-18', maxPagesPerModule: 2 } } } });
  let seenProxy = null;
  const f2 = async (px) => { seenProxy = px; return factory(px); };
  const noSleep = async () => {};
  const r1 = await access.fetchPage('https://www.toysrus.co.jp/', { dirs: [dir], requestFactory: f2, sleep: noSleep });
  assert.equal(r1.ok, true);
  assert.equal(r1.via, 'jp_proxy');
  assert.equal(seenProxy.username, 'groups-RESIDENTIAL,country-JP');
  await access.fetchPage('https://www.toysrus.co.jp/a', { dirs: [dir], requestFactory: f2, sleep: noSleep });
  const r3 = await access.fetchPage('https://www.toysrus.co.jp/b', { dirs: [dir], requestFactory: f2, sleep: noSleep });
  assert.equal(r3.skipped, true);
  assert.equal(made, 2);
  delete process.env.APIFY_PROXY_PASSWORD;
});

test('fetchPage flags a block page as not ok', async () => {
  access._resetForTests();
  const dir = tmpBrands({ a: { url: 'https://example.com/' } });
  const factory = async () => ({ get: async (url) => ({ status: () => 200, url: () => url, text: async () => 'Sorry, you have been blocked' }), dispose: async () => {} });
  const r = await access.fetchPage('https://example.org/', { dirs: [dir], requestFactory: factory });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
});

test('budget: reservations count until recorded, the cap refuses, actual cost replaces the estimate', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-budget-'));
  fs.mkdirSync(path.join(dataDir, 'brands', 's'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'brands', 's', 'profile.json'), JSON.stringify({ scrape: { apifyCapUsd: 1 } }));
  process.env.BI_RUN_ID = 'run-test-1';
  const o = { dataDir };
  const g1 = budget.reserve('s', 0.6, 'a', o);
  assert.equal(g1.ok, true);
  const g2 = budget.reserve('s', 0.6, 'b', o);
  assert.equal(g2.ok, false);
  assert.match(g2.reason, /cap reached/);
  budget.record('s', g1, { id: 'r1', usageTotalUsd: 0.1 }, o);
  const g3 = budget.reserve('s', 0.6, 'c', o);
  assert.equal(g3.ok, true);
  assert.ok(budget.callOptions(g3).maxTotalChargeUsd <= 0.9 + 1e-9);
  budget.record('s', g3, null, o); // threw: reservation stands as the cost
  const sum = budget.summary('s', o);
  assert.equal(sum.capUsd, 1);
  assert.equal(sum.spentUsd, 0.7);
  assert.equal(sum.refused, 1);
  delete process.env.BI_RUN_ID;
});

test('budget: an existing ledger that does not parse refuses the reservation and is left untouched', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-budget-bad-'));
  fs.mkdirSync(path.join(dataDir, 'brands', 's'), { recursive: true });
  const file = path.join(dataDir, 'brands', 's', '_apify_spend.json');
  fs.writeFileSync(file, '{"runs": {"r": {"capUsd": 15, "entries": [ TRUNCATED');
  process.env.BI_RUN_ID = 'run-bad';
  try {
    const g = budget.reserve('s', 0.1, 'x', { dataDir });
    assert.equal(g.ok, false);
    assert.equal(g.reason, 'spend ledger unreadable');
    assert.match(fs.readFileSync(file, 'utf8'), /TRUNCATED/, 'spend not reset');
    budget.record('s', { ok: true, id: 'nope', reservedUsd: 0.1 }, { usageTotalUsd: 0.1 }, { dataDir });
    assert.match(fs.readFileSync(file, 'utf8'), /TRUNCATED/, 'record does not overwrite it either');
  } finally { delete process.env.BI_RUN_ID; }
});

test('budget: the ledger is written atomically (no temp file left) and a stale lock is stolen by rename', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-budget-atomic-'));
  const dir = path.join(dataDir, 'brands', 's');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '_apify_spend.json.lock');
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  process.env.BI_RUN_ID = 'run-atomic';
  const realRename = fs.renameSync;
  const renames = [];
  fs.renameSync = (a, b) => { renames.push([path.basename(a), path.basename(b)]); return realRename(a, b); };
  try {
    const g = budget.reserve('s', 0.2, 'x', { dataDir });
    assert.equal(g.ok, true);
    assert.ok(renames.some(([a, b]) => a === '_apify_spend.json.lock' && /^_apify_spend\.json\.lock\.stale-/.test(b)), 'stale lock renamed to a unique name');
    assert.ok(renames.some(([a, b]) => /^_apify_spend\.json\.tmp-/.test(a) && b === '_apify_spend.json'), 'ledger written via temp + rename');
  } finally { fs.renameSync = realRename; delete process.env.BI_RUN_ID; }
  assert.deepEqual(fs.readdirSync(dir).filter(f => f !== '_apify_spend.json').sort(), [], 'no lock, temp or stale file left');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '_apify_spend.json'), 'utf8')).runs['run-atomic'].entries.length, 1);
});

test('budget: a fresh lock is not stolen', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-budget-fresh-'));
  const dir = path.join(dataDir, 'brands', 's');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '_apify_spend.json.lock');
  fs.writeFileSync(lock, '');
  let ran = false;
  // 200 tries x 25ms: the fresh lock holds, so the call gives up rather than stealing it
  assert.throws(() => budget._withLock('s', { dataDir }, () => { ran = true; }), /Could not lock/);
  assert.equal(ran, false);
  assert.ok(fs.existsSync(lock));
});
