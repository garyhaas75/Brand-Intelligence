// Lane A wiring: modules that fetch the target or competitor sites follow utils/site_access.js, and
// every Apify actor call asks utils/apify_budget.js first. Stubs only: no network, no Apify.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const siteAccess = require('../utils/site_access');
const { scrapeBrands, scrapeWithApifyFallback } = require('../scrapers/site_scraper');
const seo = require('../analysis/search_seo');
const { fetchTrends, collectDemand } = require('../analysis/jp_demand');
const { apifyFetchHtml } = require('../scrapers/marketplace_jp');

const TARGET = 'https://www.toysrus.co.jp/';
const JP_ACCESS = { mode: 'jp_proxy', maxPages: 8, authorization: { by: 'WHP', at: '2026-11-18', reason: 'test' } };
const PROXY = { server: 'http://proxy.apify.com:8000', username: 'groups-RESIDENTIAL,country-JP', password: 'pw-test' };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** A fake Playwright browser. pageFor(contextOptions) returns the page behaviour for that context. */
function fakeBrowser(pageFor) {
  const calls = { contexts: [], gotos: [], routes: [], contextRoutes: [] };
  const browser = {
    calls,
    newContext: async (o = {}) => {
      calls.contexts.push(o);
      const spec = pageFor(o);
      return {
        route: async (pattern) => { calls.contextRoutes.push({ pattern, proxy: o.proxy || null, beforeGoto: calls.gotos.length }); },
        newPage: async () => ({
          goto: async (url) => { calls.gotos.push({ url, proxy: o.proxy || null }); if (spec.gotoError) throw new Error(spec.gotoError); },
          waitForTimeout: async () => {},
          route: async (pattern) => { calls.routes.push({ pattern, proxy: o.proxy || null }); },
          $$eval: async (sel) => (sel === 'nav a' ? spec.nav || [] : sel === 'h1' ? spec.h1 || [] : []),
          evaluate: async () => ({ titleTag: spec.title || '', names: [], social: [], types: [], hasNextData: false }),
          screenshot: async () => Buffer.from('jpg'),
        }),
        close: async () => {},
      };
    },
    close: async () => {},
  };
  return browser;
}

const NAV = [
  { text: 'おもちゃ', href: 'https://www.toysrus.co.jp/ja-jp/c/toys/' },
  { text: 'ベビー用品', href: 'https://www.toysrus.co.jp/ja-jp/c/baby/' },
  { text: 'ゲーム', href: 'https://www.toysrus.co.jp/ja-jp/c/games/' },
];

test('jp_proxy target: one live load, only in a proxied browser context, labelled via jp_proxy, with the authorization logged', async () => {
  siteAccess._resetForTests();
  const browser = fakeBrowser(() => ({ nav: NAV, h1: ['トイザらス'], title: 'トイザらス・ベビーザらス オンラインストア' }));
  const logFile = path.join(tmp('bi-wiring-log-'), 'scrape.log');
  const out = await scrapeBrands([{ id: 'toysrus-jp', name: 'Toys R Us Japan', url: TARGET, role: 'target', skipApifyRetry: true }], {
    logFile, accessFor: () => JP_ACCESS, launchBrowser: async () => browser, proxyFor: async () => PROXY,
  });
  assert.equal(out.length, 1);
  const r = out[0];
  assert.equal(r.via, 'jp_proxy');
  assert.equal(r.botBlocked, false);
  assert.ok(r.featuredCategories.length >= 3);
  assert.equal(browser.calls.contexts.length, 1, 'exactly one browser context');
  assert.equal(browser.calls.contexts[0].proxy.username, 'groups-RESIDENTIAL,country-JP', 'the context goes through the JP proxy');
  assert.ok(browser.calls.gotos.length === 1 && browser.calls.gotos.every(g => g.proxy && g.proxy.username === PROXY.username), 'no unproxied load');
  assert.match(fs.readFileSync(logFile, 'utf8'), /via Japanese proxy \(authorized WHP 2026-11-18\)/);
  assert.match(require('../scrapers/site_scraper').scrapeStatusLine(r), /via Japanese proxy/);
  assert.equal(require('../utils/observed').targetObservation(r).observed, true);
});

test('jp_proxy target: a blocked proxied load falls back to the manual capture, which makes no request at all', async () => {
  siteAccess._resetForTests();
  const dir = tmp('bi-wiring-mc-');
  const htmlPath = path.join(dir, 'toysrus-jp.html');
  fs.writeFileSync(htmlPath, '<html><nav><a href="/c/toys">おもちゃ</a></nav></html>');
  // proxied context: a block page with no nav. manual-capture context (no proxy): nav parses.
  const browser = fakeBrowser(o => (o.proxy ? { nav: [], title: 'Attention Required! | Cloudflare' } : { nav: NAV }));
  const out = await scrapeBrands([{ id: 'toysrus-jp', name: 'Toys R Us Japan', url: TARGET, role: 'target', skipApifyRetry: true, manualCapture: { htmlPath, screenshotPath: null, capturedAt: '2026-11-17T00:00:00.000Z' } }], {
    accessFor: () => JP_ACCESS, launchBrowser: async () => browser, proxyFor: async () => PROXY,
  });
  const r = out[0];
  assert.equal(r.manualCapture, true);
  assert.ok(r.proxyAttempt && r.proxyAttempt.botBlocked, 'the failed proxy attempt is recorded');
  assert.equal(browser.calls.contexts.length, 2);
  assert.ok(browser.calls.contexts[0].proxy, 'first attempt proxied');
  assert.ok(!browser.calls.contexts[1].proxy, 'manual capture context has no proxy');
  assert.ok(browser.calls.routes.some(x => x.pattern === '**/*' && !x.proxy), 'manual capture routes every request (fulfil or abort)');
});

test('jp_proxy target: page budget exhausted means no load and a failed (not invented) result', async () => {
  siteAccess._resetForTests();
  const browser = fakeBrowser(() => { throw new Error('must not open a context'); });
  const out = await scrapeBrands([{ id: 't', name: 'T', url: TARGET, role: 'target', skipApifyRetry: true }], {
    accessFor: () => ({ ...JP_ACCESS, maxPages: 0 }), launchBrowser: async () => browser, proxyFor: async () => PROXY,
  });
  assert.match(out[0].error, /Page budget/);
  assert.equal(browser.calls.contexts.length, 0);
});

test('denied host: zero requests (no browser, no sitemap, no Apify)', async () => {
  siteAccess._resetForTests();
  let launched = 0;
  const out = await scrapeBrands([{ id: 'x', name: 'Blocked competitor', url: 'https://blocked.example/', role: 'competitor' }], {
    accessFor: () => ({ mode: 'denied', reason: 'no' }), launchBrowser: async () => { launched++; return fakeBrowser(() => ({})); },
  });
  assert.equal(launched, 0);
  assert.equal(out[0].skippedNoDirectRequest, true);
  assert.equal(out[0].botBlocked, true);
});

test('search_seo: proxied homepage, robots, sitemap and category pages all go through fetchPage, within the budget', async () => {
  const seen = [];
  const pages = {
    [TARGET]: '<html><head><title>トイザらス 公式</title><meta name="description" content="おもちゃ通販"><link rel="canonical" href="https://www.toysrus.co.jp/ja-jp/"><script type="application/ld+json">{"@type":"Organization"}</script></head><body><h1>トイザらス</h1><h2>おすすめ</h2></body></html>',
    'https://www.toysrus.co.jp/robots.txt': 'User-agent: *\nSitemap: https://www.toysrus.co.jp/sitemap_index.xml\n',
    'https://www.toysrus.co.jp/sitemap_index.xml': '<sitemapindex><sitemap><loc>https://www.toysrus.co.jp/s1.xml</loc></sitemap><sitemap><loc>https://www.toysrus.co.jp/s2.xml</loc></sitemap><sitemap><loc>https://www.toysrus.co.jp/s3.xml</loc></sitemap></sitemapindex>',
    'https://www.toysrus.co.jp/s1.xml': '<urlset><url><loc>https://www.toysrus.co.jp/ja-jp/c/toys/</loc></url></urlset>',
    'https://www.toysrus.co.jp/s2.xml': '<urlset><url><loc>https://www.toysrus.co.jp/ja-jp/p/123/</loc></url></urlset>',
  };
  const fetchPage = async (url) => {
    seen.push(url);
    const text = pages[url];
    return text ? { ok: true, status: 200, url, text, via: 'jp_proxy' } : { ok: true, status: 200, url, text: `<title>カテゴリ</title><h1>${url}</h1>`, via: 'jp_proxy' };
  };
  const siteIntel = { brands: [{ role: 'target', navigation: NAV }] };
  const r = await seo.auditTargetViaProxy({ name: 'Toys R Us Japan', url: TARGET }, siteIntel, { access: JP_ACCESS, fetchPage });
  assert.equal(r.onPageSeo.skipped, undefined, 'observed: not the skipped shape');
  assert.equal(r.onPageSeo.blocked, false);
  assert.equal(r.onPageSeo.via, 'jp_proxy');
  assert.equal(r.onPageSeo.titleTag, 'トイザらス 公式');
  assert.equal(r.onPageSeo.metaDescription, 'おもちゃ通販');
  assert.deepEqual(r.onPageSeo.schemaMarkup, ['Organization']);
  assert.equal(r.sitemapAnalysis.found, true);
  assert.equal(r.sitemapAnalysis.childSitemapsRead, 2, 'only 2 child sitemaps on the proxy route');
  assert.equal(r.pageAnalyses.length, 3);
  assert.ok(seen.length <= JP_ACCESS.maxPages, `${seen.length} pages within the budget`);
  assert.ok(seen.every(u => u.startsWith('https://www.toysrus.co.jp/')));
});

test('search_seo: a blocked proxied homepage keeps the not-observed shape and requests nothing else', async () => {
  const seen = [];
  const fetchPage = async (url) => { seen.push(url); return { ok: false, status: 403, url, text: 'Sorry, you have been blocked', blocked: true, via: 'jp_proxy' }; };
  const r = await seo.auditTargetViaProxy({ name: 'T', url: TARGET }, null, { access: JP_ACCESS, fetchPage });
  assert.equal(r.onPageSeo.skipped, true);
  assert.equal(r.sitemapAnalysis.skipped, true);
  assert.deepEqual(seen, [TARGET]);
});

test('site scrape Apify fallback: a budget refusal makes no actor call and is marked budgetSkipped', async () => {
  let called = 0;
  const client = { actor: () => ({ call: async () => { called++; return {}; } }) };
  const budget = { reserve: () => ({ ok: false, reason: 'Apify budget cap reached ($15 per run)' }), callOptions: () => ({}), record: () => {} };
  await assert.rejects(scrapeWithApifyFallback({ name: 'C', url: 'https://c.example/' }, null, { slug: 's', client, budget }), e => e.budgetSkipped === true);
  assert.equal(called, 0);
  const out = await scrapeBrands([{ id: 'c', name: 'C', url: 'https://c.example/', useApify: true }], { slug: 's', apifyClient: client, budget, accessFor: () => ({ mode: 'direct' }) });
  assert.equal(out[0].budgetSkipped, true);
  assert.match(out[0].budgetReason, /cap reached/);
  assert.equal(called, 0);
});

test('site scrape Apify fallback: a granted call passes the charge ceiling and records the run, also when it throws', async () => {
  const recorded = [];
  let opts = null;
  const budget = { reserve: () => ({ ok: true, id: 'g', reservedUsd: 0.1, remainingUsd: 5 }), callOptions: (g, x) => ({ maxTotalChargeUsd: 0.15, ...x }), record: (s, g, run) => recorded.push(run) };
  const client = { actor: () => ({ call: async (input, o) => { opts = o; throw new Error('boom'); } }) };
  await assert.rejects(scrapeWithApifyFallback({ name: 'C', url: 'https://c.example/' }, null, { slug: 's', client, budget }), /boom/);
  assert.equal(opts.maxTotalChargeUsd, 0.15);
  assert.ok(opts.waitSecs > 0);
  assert.deepEqual(recorded, [null]);
});

test('marketplace Apify page: budget refusal skips the call with budgetSkipped', async () => {
  let made = 0;
  const r = await apifyFetchHtml({ url: 'https://www.amazon.co.jp/x', env: { APIFY_API_TOKEN: 't' }, slug: 's', clientFactory: () => { made++; return {}; }, budget: { reserve: () => ({ ok: false, reason: 'Apify budget cap reached' }), callOptions: () => ({}), record: () => {} } });
  assert.equal(r.skipped, true);
  assert.equal(r.budgetSkipped, true);
  assert.equal(made, 0);
});

test('jp_demand Trends: budget refusal (real ledger, tiny cap) skips the actor and the output says so', async () => {
  const dataDir = tmp('bi-wiring-demand-');
  fs.mkdirSync(path.join(dataDir, 'brands', 'jp'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'brands', 'jp', 'profile.json'), JSON.stringify({ name: 'T', industry: 'toys', market: 'Japan', url: TARGET, scrape: { apifyCapUsd: 0.01 } }));
  const prevToken = process.env.APIFY_API_TOKEN;
  process.env.APIFY_API_TOKEN = 'test-token';
  process.env.BI_RUN_ID = 'lane-a-wiring-test';
  let factoryCalls = 0;
  try {
    const terms = [{ term: 'おもちゃ', termEn: 'toys' }];
    const tr = await fetchTrends(terms, { log: () => {}, dryRun: false, deps: { apifyClientFactory: () => { factoryCalls++; return {}; } }, slug: 'jp', dataDir });
    assert.equal(tr.budgetSkipped, true);
    assert.match(tr.budgetReason, /cap reached/);
    assert.equal(factoryCalls, 0);
    const out = await collectDemand({ slug: 'jp', dataDir, log: () => {}, deps: { apifyClientFactory: () => { factoryCalls++; return {}; }, httpGetJson: async () => { throw new Error('offline'); } } });
    assert.equal(out.budgetSkipped, true);
    assert.deepEqual(out.budgetSkippedUnits, ['trends']);
    assert.equal(factoryCalls, 0);
  } finally {
    if (prevToken === undefined) delete process.env.APIFY_API_TOKEN; else process.env.APIFY_API_TOKEN = prevToken;
    delete process.env.BI_RUN_ID;
  }
});

test('guardContext is installed on the proxied and the direct browser contexts before any load; the proxied load is paced', async () => {
  siteAccess._resetForTests();
  const NAV6 = ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => ({ text: ['おもちゃ', 'ベビー用品', 'ゲーム', 'ホビー', '知育玩具', 'アウトドア'][i], href: `https://shop.example.jp/c/${x}/` }));
  const browser = fakeBrowser(o => (o.proxy ? { nav: NAV, h1: ['t'], title: 'トイザらス' } : { nav: NAV6, h1: ['s'], title: 'Shop' }));
  const paced = [];
  const out = await scrapeBrands([
    { id: 'toysrus-jp', name: 'Toys R Us Japan', url: TARGET, role: 'target', skipApifyRetry: true },
    { id: 'shop', name: 'Shop', url: 'https://shop.example.jp/', role: 'competitor' },
  ], {
    accessFor: (u) => (/toysrus/.test(u) ? JP_ACCESS : { mode: 'direct' }),
    launchBrowser: async () => browser, proxyFor: async () => PROXY,
    pace: async (u) => { paced.push({ u, gotosSoFar: browser.calls.gotos.length }); },
  });
  assert.equal(out.length, 2);
  assert.equal(browser.calls.contexts.length, 2);
  const routes = browser.calls.contextRoutes;
  assert.equal(routes.length, 2, 'one guard per context');
  assert.ok(routes.every(r => r.pattern === '**/*'));
  assert.ok(routes.find(r => r.proxy) && routes.find(r => !r.proxy), 'both the proxied and the direct context are guarded');
  assert.ok(routes.every(r => r.beforeGoto < browser.calls.gotos.length && browser.calls.gotos[r.beforeGoto]), 'guard installed before the load');
  assert.deepEqual(paced, [{ u: TARGET, gotosSoFar: 0 }], 'the proxied load waits for the pace first');
});

test('a player with no website: noWebsite result, no browser, no sitemap, no budget, no Apify', async () => {
  const boom = () => { throw new Error('must not be called'); };
  const out = await scrapeBrands([
    { id: 'n', name: 'Niche', url: null, role: 'competitor' },
    { id: 'm', name: 'Niche 2', role: 'competitor', useApify: true },
  ], {
    slug: 's', accessFor: boom, launchBrowser: async () => boom(), proxyFor: async () => boom(),
    apifyClient: { actor: boom }, budget: { reserve: boom, record: boom, callOptions: boom },
  });
  assert.equal(out.length, 2);
  for (const r of out) {
    assert.equal(r.noWebsite, true);
    assert.equal(r.error, null);
    assert.equal(r.budgetSkipped, undefined);
  }
});

test('search_seo fetchText: the first URL and every redirect hop must be direct', async () => {
  const http = require('http');
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    if (req.url === '/to-proxy-host') { res.writeHead(302, { Location: 'https://www.toysrus.co.jp/sitemap.xml' }); return res.end(); }
    if (req.url === '/to-local') { res.writeHead(301, { Location: '/final' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('final body');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await seo.fetchText(`${base}/to-local`, 3000), 'final body', 'a relative redirect on a direct host is followed');
    const before = hits;
    await assert.rejects(seo.fetchText(`${base}/to-proxy-host`, 3000), /Not requested/);
    assert.equal(hits - before, 1, 'the proxy-only hop is not requested directly');
    await assert.rejects(seo.fetchText('https://www.toysrus.co.jp/sitemap.xml', 3000), /Not requested/);
    await assert.rejects(seo.fetchText('https://www.toysrus.co.jp/robots.txt', 3000), /Not requested/);
  } finally { server.close(); }
});

test('search_seo: competitor slices skip partners and players without a website', async () => {
  const profile = { name: 'T', url: TARGET, market: 'Japan', identifiedCompetitors: [
    { name: 'Partner P', url: 'https://partner.example.jp/', relationship: 'partner' },
    { name: 'No Site', url: null },
    { name: 'Rival R', url: 'https://rival.example.jp/' },
  ] };
  assert.deepEqual(seo.scoredCompetitors(profile).map(c => c.name), ['Rival R']);
  const prev = process.env.SERP_API_KEY;
  process.env.SERP_API_KEY = 'secret';
  try {
    const fetchJson = async () => ({ organic_results: [{ position: 1, link: 'https://partner.example.jp/x' }, { position: 2, link: 'https://rival.example.jp/y' }] });
    const r = await seo.runSerpRankCheck(profile, { categoryTerms: ['おもちゃ'] }, { fetchJson });
    assert.deepEqual(r.results[0].competitorPositions, { 'Rival R': 2 }, 'the partner is never ranked');
  } finally { if (prev === undefined) delete process.env.SERP_API_KEY; else process.env.SERP_API_KEY = prev; }
});
