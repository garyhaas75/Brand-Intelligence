'use strict';
// Offline proof for scrapers/marketplace_jp.js. Fixtures are trimmed copies of live pages
// (Rakuten toy category JSON-LD, Amazon.co.jp toy best sellers, an Amazon product page's
// on-page reviews, a Rakuten review page) plus a Rakuten overload page and a synthetic
// Amazon robot-check page. Nothing here touches the network.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mp = require('../scrapers/marketplace_jp');

const FX = path.join(__dirname, 'fixtures', 'marketplace');
const fx = name => fs.readFileSync(path.join(FX, name), 'utf8');
const ITEM_KEYS = ['rank', 'title', 'brand', 'priceJPY', 'reviewCount', 'rating', 'url'];
const REVIEW_KEYS = ['source', 'productTitle', 'rating', 'text', 'lang'];
// Additive, honest-provenance field: the country an Amazon review was written in, when shown.
const OPTIONAL_REVIEW_KEYS = ['reviewedIn'];
const contractKeys = r => Object.keys(r).filter(k => !OPTIONAL_REVIEW_KEYS.includes(k)).sort();

test('Rakuten JSON-LD ItemList parses into ranked topItems with JPY price and ratings', () => {
  const items = mp.parseRakutenJsonLd(fx('rakuten_category.html'));
  assert.strictEqual(items.length, 4);
  assert.deepStrictEqual(items.map(i => i.rank), [1, 2, 3, 4]);
  const first = items[0];
  assert.deepStrictEqual(Object.keys(first).sort(), [...ITEM_KEYS].sort());
  assert.strictEqual(first.priceJPY, 5890);
  assert.strictEqual(first.reviewCount, 1150);
  assert.strictEqual(first.rating, 4.63);
  assert.match(first.url, /^https:\/\/item\.rakuten\.co\.jp\//);
  assert.ok(first.title.includes('バランスストーン'));
});

test('Amazon best sellers fixture parses titles, ASIN urls, JPY prices, ratings, review counts', () => {
  const items = mp.parseAmazonListHtml(fx('amazon_bestsellers.html'));
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(items.map(i => i.rank), [1, 2, 4]);
  for (const it of items) {
    assert.match(it.url, /^https:\/\/www\.amazon\.co\.jp\/dp\/[A-Z0-9]{10}$/);
    assert.ok(it.title.length > 5);
  }
  assert.strictEqual(items[0].priceJPY, 5782);
  assert.strictEqual(items[0].brand, 'バンダイ(BANDAI)');
  const rated = items.find(i => i.rank === 4);
  assert.strictEqual(rated.rating, 4.7);
  assert.strictEqual(rated.reviewCount, 925);
  assert.strictEqual(rated.priceJPY, 7216);
});

test('captcha, overload and error statuses are detected as blocked; normal pages are not', () => {
  assert.deepStrictEqual(mp.detectBlock({ html: fx('amazon_captcha.html'), status: 200 }), { blocked: true, reason: 'captcha' });
  assert.deepStrictEqual(mp.detectBlock({ html: fx('rakuten_busy_403.html'), status: 403 }), { blocked: true, reason: 'overload_page' });
  assert.strictEqual(mp.detectBlock({ html: '<html>ok</html>', status: 429 }).reason, 'http_429');
  assert.strictEqual(mp.detectBlock({ html: '<html>ok</html>', status: 200, url: 'https://www.amazon.co.jp/ap/signin?x' }).reason, 'login_required');
  assert.strictEqual(mp.detectBlock({ html: fx('amazon_bestsellers.html'), status: 200 }), null);
  assert.strictEqual(mp.detectBlock({ html: fx('rakuten_category.html'), status: 200 }), null);
  assert.strictEqual(mp.parseAmazonListHtml(fx('amazon_captcha.html')).length, 0);
});

test('reviews parse from Amazon on-page reviews and Rakuten review JSON-LD, capped at 600 chars', () => {
  const amz = mp.parseAmazonReviews(fx('amazon_product_reviews.html'));
  assert.ok(amz.length >= 2, `expected >=2 amazon reviews, got ${amz.length}`);
  for (const r of amz) {
    assert.deepStrictEqual(contractKeys(r), [...REVIEW_KEYS].sort());
    assert.strictEqual(r.reviewedIn, '日本');
    assert.strictEqual(r.source, 'amazon_jp');
    assert.strictEqual(r.rating, 5);
    assert.ok(r.text.length > 0 && r.text.length <= 600);
    assert.ok(!/続きを読む|報告する|</.test(r.text), 'no UI chrome or markup in review text');
  }
  assert.ok(amz[0].productTitle.includes('ポケモンカードゲーム'));

  const rak = mp.parseJsonLdReviews(fx('rakuten_review.html'), 'rakuten', 'X');
  assert.strictEqual(rak.length, 3);
  assert.strictEqual(rak[0].lang, 'ja');
  assert.strictEqual(rak[0].rating, 4);
  assert.strictEqual(rak[0].productTitle, 'X');

  const long = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'p', review: [{ description: 'あ'.repeat(900), reviewRating: { ratingValue: '3' } }] })}</script>`;
  assert.strictEqual(mp.parseJsonLdReviews(long, 'rakuten')[0].text.length, 600);

  const itemPage = '<a href="https://review.rakuten.co.jp/item/1/1_2/1.1/?l-id=rk_shop">x</a><a href="https://review.rakuten.co.jp/item/1/9_8/1.1/?l2-id=item_review">r</a>';
  assert.strictEqual(mp.findRakutenReviewUrl(itemPage), 'https://review.rakuten.co.jp/item/1/9_8/1.1/');
  assert.strictEqual(mp.findRakutenReviewUrl('<p>none</p>'), null);
});

test('brandMix is derived from title tokens, generic words stopped, maker(LATIN) kept whole', () => {
  const items = [
    { title: 'タカラトミー(TAKARA TOMY) BEYBLADE X ベイブレードX スターター 6歳以上', brand: 'タカラトミー(TAKARA TOMY)' },
    { title: 'タカラトミー(TAKARA TOMY) BEYBLADE X ベイブレードX ランダムブースター Vol.12', brand: 'タカラトミー(TAKARA TOMY)' },
    { title: '【送料無料】 ポケモンカードゲーム 拡張パック BOX おもちゃ プレゼント' },
    { title: 'ポケモンカードゲーム MEGA 拡張パック BOX 男の子 プレゼント' },
  ];
  const mix = mp.deriveBrandMix(items);
  const get = b => (mix.find(x => x.brand === b) || {}).count;
  assert.strictEqual(get('タカラトミー(TAKARA TOMY)'), 2);
  assert.strictEqual(get('ベイブレードX'), 2);
  assert.strictEqual(get('ポケモンカードゲーム'), 2);
  assert.strictEqual(get('BEYBLADE X'), 2);
  for (const generic of ['プレゼント', 'おもちゃ', 'BOX', '拡張パック', '6歳以上', 'TOMY)']) {
    assert.strictEqual(get(generic), undefined, `${generic} should not be a brand`);
  }
  assert.ok(mix.every(x => x.count >= 2));
  assert.strictEqual(mp.guessBrandFromTitle('【公式】 バンダイ(BANDAI) ガンプラ'), 'バンダイ(BANDAI)');
  assert.strictEqual(mp.guessBrandFromTitle('ノーブランド 積み木'), null);
});

test('dryRun makes no network call, launches no browser and writes nothing', async () => {
  const fetcher = { fetchPage: async () => { throw new Error('network called on dry run'); }, close: async () => {} };
  const fetchImpl = async () => { throw new Error('fetch called on dry run'); };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpjp-'));
  const logs = [];
  const out = await mp.collectMarketplace({
    slug: 'dry', dryRun: true, fetcher, fetchImpl, dataDir, log: m => logs.push(m),
    env: { RAKUTEN_APP_ID: 'x', APIFY_API_TOKEN: 'y' },
  });
  assert.strictEqual(out.dryRun, true);
  assert.strictEqual(out.market, 'JP');
  assert.ok(logs.some(l => l.includes('[dry-run]')));
  assert.ok(logs.some(l => l.includes('apify')));
  assert.ok(!fs.existsSync(path.join(dataDir, 'brands', 'dry')));
  fs.rmSync(dataDir, { recursive: true, force: true });

  let calls = 0;
  const factory = () => { calls++; throw new Error('apify called'); };
  const r = await mp.apifyFetchHtml({ url: 'https://example.jp', env: { APIFY_API_TOKEN: 't' }, dryRun: true, clientFactory: factory });
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(calls, 0);
});

test('missing keys degrade softly with a stated reason', async () => {
  const a = await mp.apifyFetchHtml({ url: 'https://example.jp', env: {}, clientFactory: () => { throw new Error('no'); } });
  assert.deepStrictEqual([a.skipped, a.reason], [true, 'APIFY_API_TOKEN not set']);
  const r = await mp.fetchRakutenRankingApi({ env: {}, fetchImpl: () => { throw new Error('no'); } });
  assert.deepStrictEqual(r, { skipped: true, reason: 'RAKUTEN_APP_ID not set' });
  const api = mp.parseRakutenApi({ Items: [{ Item: { rank: 1, itemName: 'n', itemPrice: 1200, reviewCount: 3, reviewAverage: '4.5', itemUrl: 'u' } }] });
  assert.deepStrictEqual(api[0], { rank: 1, title: 'n', brand: null, priceJPY: 1200, reviewCount: 3, rating: 4.5, url: 'u' });
});

test('full offline run matches the contract shape, records blocks, and writes marketplace.json', async () => {
  const pages = {
    'https://r.test/cat': { status: 200, html: fx('rakuten_category.html') },
    'https://r.test/rank': { status: 403, html: fx('rakuten_busy_403.html') },
    'https://a.test/bs': { status: 200, html: fx('amazon_bestsellers.html') },
    'https://a.test/browse': { status: 200, html: fx('amazon_captcha.html') },
  };
  const visited = [];
  const fetcher = {
    async fetchPage(url) {
      visited.push(url);
      if (pages[url]) return { url, finalUrl: url, ...pages[url] };
      if (url.includes('amazon.co.jp/dp/')) return { url, finalUrl: url, status: 200, html: fx('amazon_product_reviews.html') };
      if (url.includes('item.rakuten.co.jp')) return { url, finalUrl: url, status: 200, html: '<a href="https://review.rakuten.co.jp/item/1/1_1/1.1/?l2-id=item_review">r</a>' };
      if (url.includes('review.rakuten.co.jp')) return { url, finalUrl: url, status: 200, html: fx('rakuten_review.html') };
      return { url, status: 404, html: '' };
    },
    async close() {},
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpjp-'));
  const out = await mp.collectMarketplace({
    slug: '_jp_fixture', dataDir, fetcher, env: {}, log: () => {}, retryDelayMs: 0,
    categories: [
      { source: 'rakuten', category: 'toys', url: 'https://r.test/cat' },
      { source: 'rakuten', category: 'rank', url: 'https://r.test/rank' },
      { source: 'amazon_jp', category: 'bs', url: 'https://a.test/bs' },
      { source: 'amazon_jp', category: 'browse', url: 'https://a.test/browse' },
    ],
  });
  // Contract shape
  assert.ok(!Number.isNaN(Date.parse(out.generatedAt)));
  assert.strictEqual(out.market, 'JP');
  assert.deepStrictEqual(out.sources.sort(), ['amazon_jp', 'rakuten']);
  for (const c of out.categories) {
    for (const k of ['source', 'category', 'url', 'topItems']) assert.ok(k in c, `category missing ${k}`);
    for (const it of c.topItems) assert.deepStrictEqual(Object.keys(it).sort(), [...ITEM_KEYS].sort());
  }
  for (const b of out.brandMix) assert.deepStrictEqual(Object.keys(b).sort(), ['brand', 'count']);
  assert.ok(out.reviews.length > 0 && out.reviews.length <= 200);
  for (const r of out.reviews) {
    assert.deepStrictEqual(contractKeys(r), [...REVIEW_KEYS].sort());
    assert.ok(r.text.length <= 600);
  }
  // Blocks recorded. The overload page gets exactly one delayed retry, the captcha none.
  const blockedUrls = out.blocked.map(b => b.url).sort();
  assert.deepStrictEqual(blockedUrls, ['https://a.test/browse', 'https://r.test/rank']);
  assert.strictEqual(visited.filter(u => u === 'https://r.test/rank').length, 2);
  const rank = out.blocked.find(b => b.url === 'https://r.test/rank');
  assert.strictEqual(rank.status, 'retryable_block');
  assert.deepStrictEqual(rank.retry, { firstReason: 'overload_page', result: 'blocked' });
  assert.ok(!fs.existsSync(path.join(dataDir, 'brands', '_jp_fixture', '_checkpoints', 'marketplace.json')), 'checkpoint cleared after write');
  assert.strictEqual(visited.filter(u => u === 'https://a.test/browse').length, 1);
  // Items and reviews from both sources
  assert.strictEqual(out.categories.find(c => c.category === 'toys').topItems.length, 4);
  assert.strictEqual(out.categories.find(c => c.category === 'bs').topItems.length, 3);
  assert.ok(out.reviews.some(r => r.source === 'rakuten'));
  assert.ok(out.reviews.some(r => r.source === 'amazon_jp'));
  // Written to disk, then cleaned up
  const fp = path.join(dataDir, 'brands', '_jp_fixture', 'marketplace.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(fp, 'utf8')).market, 'JP');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Japan gating: market mentions japan or the url is a .jp host', () => {
  assert.strictEqual(mp.isJapanMarket({ market: 'Japan', url: 'https://www.toysrus.com' }), true);
  assert.strictEqual(mp.isJapanMarket({ market: 'JAPAN (Tokyo)' }), true);
  assert.strictEqual(mp.isJapanMarket({ url: 'https://www.toysrus.co.jp/' }), true);
  assert.strictEqual(mp.isJapanMarket({ market: 'US', url: 'https://www.toysrus.com' }), false);
  assert.strictEqual(mp.isJapanMarket(null), false);
});
