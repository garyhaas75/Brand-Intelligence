// Japanese parsing: sitemap slugs, nav chrome filters, competitor seeds.
// Offline only: fixtures are inline and fetch is stubbed where a network path runs.
const test = require('node:test');
const assert = require('node:assert/strict');

const sitemap = require('../scrapers/sitemap_categories');
const { isFeaturedCategory, APIFY_PAGE_FUNCTION } = require('../scrapers/site_scraper');
const { JP_COMPETITORS, JP_UNVERIFIED, jpCompetitorsFor } = require('../scrapers/jp_competitors');
const { seedCompetitorsFor, mergeCompetitorLists } = require('../analysis/brand_discovery');

const enc = s => encodeURIComponent(s);

function withStubbedSitemap(xml, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async u => {
    if (String(u).endsWith('/robots.txt')) {
      const host = new URL(String(u)).hostname.replace(/^www\./, '');
      return { ok: true, headers: { get: () => null }, text: async () => `Sitemap: https://${host}/sitemap.xml` };
    }
    const ok = String(u).endsWith('/sitemap.xml');
    return { ok, headers: { get: () => null }, text: async () => (ok ? xml : '') };
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = real; });
}
const urlset = urls => '<?xml version="1.0"?><urlset>' + urls.map(u => `<url><loc>${u}</loc></url>`).join('') + '</urlset>';

test('percent-encoded Japanese slugs decode to real names', () => {
  const locs = [
    `https://www.toys.example.jp/category/${enc('おもちゃ')}`,
    `https://toys.example.jp/category/${enc('おもちゃ')}/${enc('ブロック')}`,
    `https://toys.example.jp/category/${enc('ベビー用品')}/${enc('ベビーカー')}`,
    `https://toys.example.jp/ja/${enc('ぬいぐるみ・人形')}.html`,
    `https://toys.example.jp/c/${enc('本')}`,
  ];
  const r = sitemap.categoriesFromLocs(locs, 'https://www.toys.example.jp');
  for (const name of ['おもちゃ', 'ブロック', 'ベビー用品', 'ベビーカー', 'ぬいぐるみ・人形', '本']) {
    assert.ok(r.featuredCategories.includes(name), `missing ${name}: ${JSON.stringify(r.featuredCategories)}`);
  }
  assert.ok(!r.featuredCategories.some(n => n.includes('%')), 'no raw escapes left');
});

test('slugToName: NFKC, no CJK breakage, malformed escapes survive', () => {
  assert.equal(sitemap.slugToName('ﾌﾞﾛｯｸ'), 'ブロック');
  assert.equal(sitemap.slugToName(enc('知育玩具_幼児向け')), '知育玩具 幼児向け');
  assert.equal(sitemap.slugToName('%E3%81'), '%e3%81');
  assert.equal(sitemap.slugToName('Action-Figures.html'), 'action figures');
});

test('a 12 character Japanese name is not too long, one ideograph is not too short', () => {
  const twelve = 'ベビー用品・マタニティ用品';
  assert.ok([...twelve].length >= 12);
  const r = sitemap.categoriesFromLocs([
    `https://s.example.jp/category/${enc('おもちゃ')}/${enc(twelve)}`,
    `https://s.example.jp/category/${enc('靴')}`,
  ], 'https://s.example.jp');
  assert.ok(r.featuredCategories.includes(twelve));
  assert.ok(r.featuredCategories.includes('靴'));
});

test('numeric-ID Japanese sitemap keeps categories and flags idSlugs', async () => {
  const ids = ['1001', '1002', '1002/2005', '3001'].map(p => `https://shop.example.jp/category/${p}`);
  const r = sitemap.categoriesFromLocs(ids, 'https://shop.example.jp');
  assert.ok(r, 'not discarded');
  assert.equal(r.idSlugs, true);
  assert.deepEqual([...r.featuredCategories].sort(), ['1001', '1002', '2005', '3001']);

  const full = sitemap.fullTaxonomyFromLocs(ids, 'https://shop.example.jp');
  assert.equal(full.idSlugs, true);
  assert.equal(full.leaves.length, 4);

  // A CJK site keeps its mixed ID slugs too.
  const mixed = sitemap.categoriesFromLocs([
    `https://m.example.jp/category/${enc('おもちゃ')}/50123`,
  ], 'https://m.example.jp');
  assert.equal(mixed.idSlugs, true);
  assert.ok(mixed.featuredCategories.includes('50123'));

  // Through the network path with a stubbed fetch.
  await withStubbedSitemap(urlset(ids), async () => {
    const viaNet = await sitemap.fetchCategoriesFromSitemap('https://shop.example.jp');
    assert.equal(viaNet.idSlugs, true);
    assert.equal(viaNet.sitemapUrl, 'https://shop.example.jp/sitemap.xml');
  });
});

test('Japanese chrome terms are filtered from sitemap categories', () => {
  const chrome = ['カート', 'ログイン', '会員登録', 'お気に入り', 'お問い合わせ', '会社概要', 'プライバシーポリシー', '利用規約', 'サイトマップ', '特定商取引法に基づく表記', 'ヘルプ', 'よくある質問', '店舗検索', '店舗一覧'];
  const locs = chrome.map(t => `https://j.example.jp/${enc(t)}`).concat(`https://j.example.jp/${enc('おもちゃ')}`);
  const r = sitemap.categoriesFromLocs(locs, 'https://j.example.jp');
  assert.deepEqual(r.featuredCategories, ['おもちゃ']);
  for (const t of chrome) assert.ok(sitemap.isNonCategory(t), t);
  assert.ok(!sitemap.isNonCategory('おもちゃ'));
});

test('English sitemap output is unchanged (regression)', async () => {
  const urls = [
    'https://www.shop.example.com/', 'https://shop.example.com/c/toys', 'https://shop.example.com/c/toys/action-figures',
    'https://shop.example.com/c/toys/lego', 'https://shop.example.com/c/baby/strollers', 'https://shop.example.com/c/baby',
    'https://shop.example.com/en/collections/outdoor-play/trampolines', 'https://shop.example.com/cart', 'https://shop.example.com/help',
    'https://shop.example.com/c/toys/w1045680', 'https://shop.example.com/c/games/board-games.html',
  ];
  // Captured from the module before the Japanese changes.
  const before = {
    a: { featuredCategories: ['toys', 'baby', 'outdoor play', 'games', 'action figures', 'board games', 'lego', 'strollers', 'trampolines'], topLevelSections: ['toys', 'baby', 'outdoor play', 'games'], categoryUrlCount: 11, sitemapUrl: 'https://shop.example.com/sitemap.xml', source: 'sitemap' },
    b: { paths: [['c', 'toys'], ['c', 'toys', 'action-figures'], ['c', 'toys', 'lego'], ['c', 'baby', 'strollers'], ['c', 'baby'], ['en', 'collections', 'outdoor-play', 'trampolines'], ['cart'], ['help'], ['c', 'toys', 'w1045680'], ['c', 'games', 'board-games.html']], leaves: ['toys', 'action figures', 'lego', 'strollers', 'baby', 'trampolines', 'board games'], urlCount: 10 },
  };
  await withStubbedSitemap(urlset(urls), async () => {
    const a = await sitemap.fetchCategoriesFromSitemap('https://www.shop.example.com');
    const b = await sitemap.fetchFullTaxonomy('https://www.shop.example.com');
    assert.equal(a.idSlugs, false);
    assert.equal(b.idSlugs, false);
    const { idSlugs: _a, ...aRest } = a;
    const { idSlugs: _b, ...bRest } = b;
    assert.equal(JSON.stringify(aRest), JSON.stringify(before.a));
    assert.equal(JSON.stringify(bRest), JSON.stringify(before.b));
  });
});

test('nav filter drops Japanese chrome and corporate noise, keeps categories', () => {
  const drop = ['カート', 'ログイン', 'キーワード検索', '会員登録', 'お気に入り', 'マイページ', 'ヘルプ', '店舗検索', '採用情報', '会社概要', 'IR情報', 'IR', 'ニュースリリース', 'お問い合わせ', 'Sign In', 'Cart', 'x'];
  const keep = ['おもちゃ', '本', 'ベビー用品', 'Toys', 'LEGO', 'Hair Accessories'];
  for (const t of drop) assert.equal(isFeaturedCategory(t), false, t);
  for (const t of keep) assert.equal(isFeaturedCategory(t), true, t);
});

test('Apify page function compiles with the injected filter', () => {
  const fn = new Function(`return (${APIFY_PAGE_FUNCTION})`)();
  assert.equal(typeof fn, 'function');
  assert.match(APIFY_PAGE_FUNCTION, /function isFeaturedCategory/);
});

test('jp competitor list: verified entries carry a status, target removed', () => {
  assert.ok(JP_COMPETITORS.length > 0);
  for (const c of JP_COMPETITORS) {
    assert.ok(c.name && c.nameJa && /^https:\/\//.test(c.url) && c.type, c.name);
    assert.equal(typeof c.verifiedAt.status, 'number', c.name);
    assert.match(c.verifiedAt.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.ok(Array.isArray(JP_UNVERIFIED));
  const verifiedHosts = new Set(JP_COMPETITORS.map(c => new URL(c.url).hostname));
  for (const u of JP_UNVERIFIED) if (u.url) assert.ok(!verifiedHosts.has(new URL(u.url).hostname), u.name);

  const forTru = jpCompetitorsFor('https://toysrus.co.jp/some/path');
  assert.ok(!forTru.some(c => /toysrus\.co\.jp$/.test(new URL(c.url).hostname)));
  assert.equal(forTru.length, JP_COMPETITORS.length - 1);
  // The toysrus.co.jp entry (type target) is never offered to ANY other brand: that host must not be requested
  // (utils/no_contact.js), so it is not a competitor anyone can scan.
  assert.ok(!jpCompetitorsFor('https://www.kiddyland.co.jp/').some(c => /toysrus\.co\.jp/.test(c.url)));
  assert.equal(jpCompetitorsFor('https://www.kiddyland.co.jp/').length, JP_COMPETITORS.length - 2 + (JP_COMPETITORS.some(c => /kiddyland\.co\.jp/.test(c.url)) ? 0 : 1));
});

test('brand discovery seeds JP toy competitors only for a matching market and industry', () => {
  const seeded = seedCompetitorsFor('Japan', 'おもちゃ, ベビー用品', 'https://www.toysrus.co.jp/');
  assert.ok(seeded.length > 0 && seeded.every(c => c.seeded));
  assert.ok(!seeded.some(c => /toysrus/.test(c.url)));
  assert.equal(seedCompetitorsFor('Japan', 'Women\'s Apparel', 'https://x.jp').length, 0);
  assert.equal(seedCompetitorsFor('Australia', 'toys', 'https://x.com.au').length, 0);

  const merged = mergeCompetitorLists(seeded, [
    { name: 'Dup', url: 'https://kiddyland.co.jp/' },
    { name: 'New', url: 'https://new-toys.example.jp/' },
  ]);
  assert.equal(merged.length, seeded.length + 1);
  assert.equal(merged[merged.length - 1].name, 'New');
});
