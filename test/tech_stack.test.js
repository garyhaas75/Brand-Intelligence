const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ts = require('../analysis/tech_stack');

const FIXTURE = path.join(__dirname, 'fixtures/tech_stack/toysrus-jp-home.trim.html');
const targetHtml = fs.readFileSync(FIXTURE, 'utf8');
const quiet = () => {};

test('target homepage fixture: Salesforce Commerce Cloud, GTM, PayPay, Amazon Pay, no JSON-LD', () => {
  const a = ts.analyzePages([{ url: 'https://www.toysrus.co.jp/', kind: 'home', html: targetHtml }], 'https://www.toysrus.co.jp/');
  assert.equal(a.platform.name, 'Salesforce Commerce Cloud');
  assert.equal(a.platform.confidence, 'high');
  assert.match(a.platform.evidence, /demandware/i);
  const names = c => a.categories[c].map(x => x.name);
  assert.ok(names('analytics').includes('Google Tag Manager'));
  assert.ok(names('payments').includes('PayPay'));
  assert.ok(names('payments').includes('Amazon Pay'));
  assert.ok(names('chat').includes('LINE official account'));
  assert.ok(names('loyalty').includes('d Point'));
  assert.deepEqual(a.structuredData.jsonLdTypes, []);
  assert.equal(a.structuredData.jsonLdBlocks, 0);
  // every detection carries its evidence
  for (const c of ts.CATEGORIES) for (const x of a.categories[c]) assert.ok(x.evidence && x.evidence.length > 5);
});

test('a Shopify page is detected as Shopify', () => {
  const html = '<html><head><link rel="stylesheet" href="//cdn.shopify.com/s/files/1/0001/theme.css"><script>window.Shopify = {}; Shopify.theme = {"name":"Dawn"};</script></head><body><div id="shopify-section-header"></div></body></html>';
  const a = ts.analyzePages([{ url: 'https://shop.example.jp/', html }], 'https://shop.example.jp/');
  assert.equal(a.platform.name, 'Shopify');
});

test('no signature means custom or unidentified, never a guess; marketplaces by host', () => {
  assert.equal(ts.analyzePages([{ url: 'https://x.jp/', html: '<html><body>hello</body></html>' }], 'https://x.jp/').platform.name, 'Custom or unidentified');
  assert.match(ts.decidePlatform('https://www.amazon.co.jp/toys/', []).name, /Amazon/);
  const wp = ts.analyzePages([{ url: 'https://k.jp/', html: '<link href="/wp-content/themes/a.css"><a href="https://store.shopping.yahoo.co.jp/kshop/">store</a>' }], 'https://k.jp/');
  assert.match(wp.platform.name, /Marketplace storefront \(Yahoo! Shopping\)/);
  assert.equal(wp.cms, 'WordPress');
});

test('JSON-LD types are read, including @graph', () => {
  const html = '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["Organization","Store"]}]}</script><script type="application/ld+json">{"@type":"Product"}</script><script type="application/ld+json">{broken</script>';
  const j = ts.jsonLdTypes(html);
  assert.deepEqual(j.types.sort(), ['Organization', 'Product', 'Store', 'WebSite']);
  assert.equal(j.blocks, 3);
  assert.equal(j.unparsed, 1);
});

test('app banner and store links are found', () => {
  const app = ts.detectApp('<meta name="apple-itunes-app" content="app-id=123456"><a href="https://play.google.com/store/apps/details?id=jp.example.app">Android</a>');
  assert.equal(app.smartBanner, true);
  assert.match(app.ios, /app-id=123456/);
  assert.match(app.android, /jp\.example\.app/);
});

test('digest keeps alt text and footer services, drops scripts', () => {
  const d = ts.htmlToDigest(targetHtml);
  assert.match(d, /^TITLE: /);
  assert.match(d, /店舗受け取りサービス/);
  assert.match(d, /低価格保証/);
  assert.match(d, /大会/);
  assert.doesNotMatch(d, /dataLayer/);
});

test('follow-up pages: one product or category page and one payment or delivery help page, same host only', () => {
  const html = '<a href="/ja-jp/foo-10162895.html">商品</a><a href="https://help.example.jp/hc/ja/categories/1">ヘルプ</a><a href="/guide/payment.html">お支払い方法について</a><a href="https://other.jp/p/1/">x</a><a href="/cart">カート</a>';
  const picks = ts.pickExtraPages(ts.extractLinks(html, 'https://www.example.jp/'), 'https://www.example.jp/');
  assert.equal(picks.length, 2);
  assert.deepEqual(picks.map(p => p.kind), ['product_or_category', 'help']);
  assert.equal(picks[0].url, 'https://www.example.jp/ja-jp/foo-10162895.html');
  assert.equal(picks[1].url, 'https://www.example.jp/guide/payment.html');
});

function tmpData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-tech-'));
  const b = path.join(dir, 'brands', 'tru');
  fs.mkdirSync(path.join(b, 'manual_capture'), { recursive: true });
  fs.writeFileSync(path.join(b, 'profile.json'), JSON.stringify({
    name: 'Toys R Us Japan', url: 'https://www.toysrus.co.jp/', market: 'Japan',
    identifiedCompetitors: [
      { name: 'Shop A', url: 'https://a.example.jp/', tier: 'specialty' },
      { name: 'Blocked B', url: 'https://b.example.jp/', tier: 'mass' },
      { name: 'Partner D', url: 'https://d.example.jp/', tier: 'mass', relationship: 'partner' },
    ],
  }));
  fs.copyFileSync(FIXTURE, path.join(b, 'manual_capture', 'tru.html'));
  return dir;
}

test('run: target falls back to the manual capture, 403 is not observed, partner kept, digests saved', async () => {
  const dataDir = tmpData();
  const requested = [];
  const fetchPage = async (url) => {
    requested.push(url);
    if (/toysrus\.co\.jp/.test(url)) return { ok: false, skipped: true, reason: 'no contact', via: 'none' };
    if (/b\.example/.test(url)) return { ok: false, status: 403, url, text: 'Forbidden', via: 'direct' };
    return { ok: true, status: 200, url, via: 'direct', text: '<html><script src="https://cdn.shopify.com/x.js"></script><body>送料無料</body></html>' };
  };
  const { output } = await ts.run({ slug: 'tru', dataDir, fetchPage, log: quiet });
  const by = n => output.players.find(p => p.name === n);
  const t = output.players.find(p => p.role === 'target');
  assert.equal(t.observed, true);
  assert.equal(t.via, 'manual_capture');
  assert.equal(t.platform.name, 'Salesforce Commerce Cloud');
  assert.equal(by('Shop A').platform.name, 'Shopify');
  assert.equal(by('Blocked B').observed, false);
  assert.match(by('Blocked B').reason, /403/);
  assert.equal(by('Blocked B').platform.name, 'Not observed');
  assert.equal(by('Partner D').relationship, 'partner');
  assert.equal(output.summary.platformShare.Shopify, 2);
  const pages = JSON.parse(fs.readFileSync(path.join(dataDir, 'brands', 'tru', 'tech_stack_pages.json'), 'utf8'));
  assert.ok(pages.players['Toys R Us Japan'][0].digest.includes('低価格保証'));
  assert.equal(pages.players['Blocked B'].length, 0);
  assert.equal(requested.filter(u => /toysrus/.test(u)).length, 1, 'target homepage asked once, through fetchPage only');
  assert.equal(fs.existsSync(path.join(dataDir, 'brands', 'tru', '_checkpoints', 'tech_stack.json')), false, 'checkpoint cleared after a full run');

  // second run: Shop A now fails, so its previous good data is carried forward marked stale
  const failing = async (url) => (/a\.example/.test(url) ? { ok: false, status: 500, url, text: '', via: 'direct' } : fetchPage(url));
  process.env.BI_FORCE = '1';
  try {
    const { output: o2 } = await ts.run({ slug: 'tru', dataDir, fetchPage: failing, log: quiet });
    const a2 = o2.players.find(p => p.name === 'Shop A');
    assert.equal(a2.stale, true);
    assert.equal(a2.platform.name, 'Shopify');
    assert.match(a2.staleReason, /500/);
  } finally { delete process.env.BI_FORCE; }
});

test('a jp_proxy read logs the authorization line, a direct read does not', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-ts-proxylog-'));
  fs.mkdirSync(path.join(dataDir, 'brands', 'tru'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'brands', 'tru', 'profile.json'), JSON.stringify({
    name: 'Toys R Us Japan', url: 'https://www.toysrus.co.jp/',
    identifiedCompetitors: [{ name: 'Shop A', url: 'https://shop-a.example.jp/' }],
  }));
  const accessFor = (u) => (/toysrus\.co\.jp/.test(u)
    ? { mode: 'jp_proxy', maxPages: 8, authorization: { by: 'WHP (test)', at: '2026-11-18', reason: 't' } }
    : { mode: 'direct' });
  const fetchPage = async (u) => ({ ok: true, status: 200, url: u, text: '<html><body>hi</body></html>', via: /toysrus/.test(u) ? 'jp_proxy' : 'direct' });
  const lines = [];
  await ts.run({ slug: 'tru', dataDir, fetchPage, accessFor, log: (m) => lines.push(m) });
  const proxied = lines.filter(l => /via Japanese proxy/.test(l));
  assert.ok(proxied.length >= 1, 'the proxied read is logged');
  assert.ok(proxied.every(l => /^Requesting https:\/\/www\.toysrus\.co\.jp\/\S* via Japanese proxy \(authorized WHP \(test\) 2026-11-18\)$/.test(l)), proxied.join('\n'));
  assert.ok(!lines.some(l => /shop-a\.example\.jp.*via Japanese proxy/.test(l)), 'direct reads are not labelled proxied');
});
