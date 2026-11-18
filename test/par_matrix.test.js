const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pm = require('../analysis/par_matrix');
const ts = require('../analysis/tech_stack');

const targetHtml = fs.readFileSync(path.join(__dirname, 'fixtures/tech_stack/toysrus-jp-home.trim.html'), 'utf8');
const TARGET_URL = 'https://www.toysrus.co.jp/';
const targetPages = [{ url: TARGET_URL, kind: 'home', digest: ts.htmlToDigest(targetHtml) }];
const targetStack = { observed: true, ...ts.analyzePages([{ url: TARGET_URL, html: targetHtml }], TARGET_URL) };
const quiet = () => {};

test('capabilities carry English and Japanese labels', () => {
  assert.deepEqual(pm.KEYS, ['online_checkout', 'store_pickup', 'store_stock_check', 'same_or_next_day_delivery', 'free_shipping_threshold', 'gift_wrap', 'special_packaging', 'exclusives', 'app', 'line_account', 'loyalty_points', 'local_payments', 'product_reviews', 'instore_events', 'store_finder', 'gift_or_age_finder', 'low_price_guarantee', 'easy_returns', 'english_site']);
  for (const c of pm.CAPABILITIES) assert.ok(c.key && c.label && c.labelJa, c.key);
  assert.equal(pm.CAPABILITIES.find(c => c.key === 'store_pickup').labelJa, '店舗受け取り');
});

test('keyword detection on the target fixture: store pickup, low price guarantee, free shipping 5,500 yen', () => {
  const kw = pm.keywordDetect(targetPages, targetStack);
  assert.ok(kw.hits.store_pickup.positive.length > 0);
  assert.match(kw.hits.store_pickup.positive[0].snippet, /受け?取/);
  assert.equal(kw.hits.store_pickup.positive[0].url, TARGET_URL);
  assert.ok(kw.hits.low_price_guarantee.positive.some(h => /低価格保証/.test(h.snippet)));
  assert.ok(kw.hits.store_stock_check.positive.length > 0);
  assert.equal(kw.details.freeShippingYen, 5500);
  assert.ok(kw.details.sharedPoints.includes('d Point'));
  assert.ok(kw.details.localPayments.includes('PayPay'));
  // the PayPay gift card text alone is not counted as a page payment hit
  assert.ok(!kw.hits.local_payments.positive.some(h => h.source === 'page' && /ギフトカード/.test(h.match)));
});

test('no evidence means unknown, never no', () => {
  const kw = pm.keywordDetect(targetPages, targetStack);
  const cells = pm.keywordCells(kw);
  assert.equal(cells.gift_wrap.status, 'unknown');
  assert.equal(cells.gift_wrap.evidence, null);
  assert.equal(cells.store_pickup.status, 'yes');
  const empty = pm.keywordCells(pm.keywordDetect([{ url: 'https://x.jp/', digest: 'こんにちは' }], null));
  assert.ok(Object.values(empty).every(c => c.status === 'unknown'));
  // only an explicit statement makes "no"
  const neg = pm.keywordCells(pm.keywordDetect([{ url: 'https://x.jp/', digest: '店舗受け取りサービスは行っておりません' }], null));
  assert.equal(neg.store_pickup.status, 'no');
  assert.match(neg.store_pickup.evidence, /行っておりません/);
});

test('model cells are checked against the evidence', () => {
  const kw = pm.keywordDetect(targetPages, targetStack);
  const raw = { cells: {
    store_pickup: { status: 'yes', evidence: '店舗受け取りサービス', url: TARGET_URL, detail: 'pickup at store' },
    gift_wrap: { status: 'yes', evidence: '無料ギフトラッピング承ります', url: TARGET_URL },
    easy_returns: { status: 'no', evidence: null },
    exclusives: { status: 'maybe' },
  } };
  const cells = pm.normalizeCells(raw, kw, [TARGET_URL]);
  assert.equal(cells.store_pickup.status, 'yes');
  assert.equal(cells.gift_wrap.status, 'unknown', 'invented snippet is rejected');
  assert.equal(cells.easy_returns.status, 'unknown', 'a no without a snippet is unknown');
  assert.equal(cells.exclusives.status, 'unknown');
  assert.equal(cells.app.status, 'unknown', 'missing keys default to unknown');
  assert.deepEqual(Object.keys(cells).sort(), [...pm.KEYS].sort());
});

const yesCells = (keys) => Object.fromEntries(pm.KEYS.map(k => [k, { status: keys.includes(k) ? 'yes' : 'unknown' }]));

test('gap rule: par share >= 50% or >= 2 in the leading tier, target not yes; partners excluded from par', () => {
  const players = [
    { name: 'T', role: 'target', observed: true, cells: yesCells(['store_pickup']) },
    { name: 'A', role: 'player', tier: 'specialty', observed: true, relationship: 'competitor', cells: yesCells(['gift_wrap', 'store_pickup', 'app']) },
    { name: 'B', role: 'player', tier: 'specialty', observed: true, relationship: 'competitor', cells: yesCells(['gift_wrap', 'app']) },
    { name: 'C', role: 'player', tier: 'mass', observed: true, relationship: 'competitor', cells: yesCells(['gift_wrap']) },
    { name: 'D', role: 'player', tier: 'mass', observed: true, relationship: 'competitor', cells: yesCells([]) },
    { name: 'E', role: 'player', tier: 'mass', observed: true, relationship: 'competitor', cells: yesCells([]) },
    { name: 'P', role: 'player', tier: 'mass', observed: true, relationship: 'partner', cells: yesCells(['line_account', 'english_site']) },
    { name: 'X', role: 'player', tier: 'niche', observed: false, relationship: 'competitor', cells: yesCells([]) },
  ];
  const isPartner = p => p.relationship === 'partner';
  const { par, scoredCount } = pm.computePar(players, isPartner);
  assert.equal(scoredCount, 5);
  assert.equal(par.gift_wrap.yesShare, 0.6);
  assert.deepEqual(par.gift_wrap.leaders, ['A', 'B', 'C']);
  assert.equal(par.gift_wrap.byTier.specialty, 1);
  assert.equal(par.line_account.yes, 0, 'partner does not count toward par');
  const gaps = pm.computeGaps(par);
  const keys = gaps.map(g => g.key);
  assert.ok(keys.includes('gift_wrap'), 'share 60%');
  assert.ok(keys.includes('app'), 'share 40% but 2 of the leading tier');
  assert.ok(!keys.includes('store_pickup'), 'target already yes');
  assert.ok(!keys.includes('line_account'), 'partner only');
  assert.match(gaps.find(g => g.key === 'gift_wrap').note, /3 of 5/);
});

test('run with a stubbed model: target confirm flags, partner column, unobserved stays unknown', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-par-'));
  const dir = path.join(dataDir, 'brands', 'tru');
  fs.mkdirSync(dir, { recursive: true });
  const shopDigest = 'TITLE: Shop A\n店舗受け取り可能。ギフトラッピング承ります。3,980円以上で送料無料';
  fs.writeFileSync(path.join(dir, 'tech_stack.json'), JSON.stringify({ generatedAt: '2026-11-18T00:00:00Z', players: [
    { name: 'Toys R Us Japan', url: TARGET_URL, role: 'target', relationship: 'self', observed: true, categories: targetStack.categories, app: targetStack.app },
    { name: 'Shop A', url: 'https://a.example.jp/', role: 'player', tier: 'specialty', relationship: 'competitor', observed: true, categories: {}, app: {} },
    { name: 'Partner D', url: 'https://d.example.jp/', role: 'player', tier: 'mass', relationship: 'partner', observed: true, categories: {}, app: {} },
    { name: 'Blocked B', url: 'https://b.example.jp/', role: 'player', tier: 'mass', relationship: 'competitor', observed: false, reason: 'HTTP 403' },
  ] }));
  fs.writeFileSync(path.join(dir, 'tech_stack_pages.json'), JSON.stringify({ players: {
    'Toys R Us Japan': targetPages,
    'Shop A': [{ url: 'https://a.example.jp/', kind: 'home', digest: shopDigest }],
    'Partner D': [{ url: 'https://d.example.jp/', kind: 'home', digest: 'ラッピング' }],
    'Blocked B': [],
  } }));
  const calls = [];
  const client = { messages: { create: async (req) => {
    calls.push(req);
    const isShop = /Shop A/.test(req.messages[0].content);
    const isTarget = /Toys R Us Japan/.test(req.messages[0].content);
    const cells = {};
    if (isShop) { cells.store_pickup = { status: 'yes', evidence: '店舗受け取り可能', url: 'https://a.example.jp/' }; cells.gift_wrap = { status: 'yes', evidence: 'ギフトラッピング承ります', url: 'https://a.example.jp/' }; cells.free_shipping_threshold = { status: 'yes', evidence: '3,980円以上で送料無料', detail: '3,980 yen' }; }
    if (isTarget) { cells.store_pickup = { status: 'yes', evidence: '店舗受け取りサービス', url: TARGET_URL }; cells.low_price_guarantee = { status: 'yes', evidence: '低価格保証', url: TARGET_URL }; }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ cells }) }] };
  } } };
  const { output } = await pm.run({ slug: 'tru', dataDir, client, log: quiet });
  assert.equal(calls.length, 3, 'one call per observed player, none for the unobserved one');
  assert.ok(calls.every(c => /<<<EVIDENCE/.test(c.messages[0].content) && /untrusted/i.test(c.system)));
  const t = output.players.find(p => p.role === 'target');
  assert.equal(t.cells.store_pickup.status, 'yes');
  assert.equal(t.cells.store_pickup.confirm, undefined);
  assert.equal(t.cells.gift_wrap.status, 'unknown');
  assert.equal(t.cells.gift_wrap.confirm, true);
  assert.equal(t.cells.free_shipping_threshold.amountYen, 5500);
  const a = output.players.find(p => p.name === 'Shop A');
  assert.equal(a.cells.free_shipping_threshold.amountYen, 3980);
  assert.equal(output.players.find(p => p.name === 'Partner D').relationship, 'partner');
  const b = output.players.find(p => p.name === 'Blocked B');
  assert.ok(Object.values(b.cells).every(c => c.status === 'unknown'));
  assert.equal(output.par.gift_wrap.observed, 1, 'only Shop A is scored (partner, target, unobserved excluded)');
  assert.equal(output.par.gift_wrap.targetStatus, 'unknown');
  assert.equal(output.par.free_shipping_threshold.medianYen, 3980);
  assert.deepEqual(output.capabilities[0], { key: 'online_checkout', label: 'Online checkout', labelJa: 'オンライン購入' });
  assert.ok(fs.existsSync(path.join(dir, 'par_matrix.json')));
});

test('a model snippet with a real opening and an invented tail is not accepted as yes evidence', () => {
  const pages = [{ url: 'https://s.example.jp/', kind: 'home', digest: 'Welcome to our store. We sell many toys for children of all ages here.' }];
  const kw = pm.keywordDetect(pages, { observed: true, categories: {}, app: {} });
  const raw = { cells: { free_shipping_threshold: { status: 'yes', evidence: 'Welcome to our store. We sell many toys for children. FREE SHIPPING ON ALL ORDERS OVER 3000 YEN', url: 'https://s.example.jp/' } } };
  const cells = pm.normalizeCells(raw, kw, ['https://s.example.jp/']);
  assert.notEqual(cells.free_shipping_threshold.status, 'yes');
  assert.equal(cells.free_shipping_threshold.status, 'unknown');
  assert.equal(cells.free_shipping_threshold.evidence, null);
  // The whole snippet, case and whitespace aside, still verifies.
  const ok = pm.normalizeCells({ cells: { online_checkout: { status: 'yes', evidence: '  we SELL many   toys for children ', url: 'https://s.example.jp/' } } }, kw, ['https://s.example.jp/']);
  assert.equal(ok.online_checkout.status, 'yes');
});

test('a resumed checkpoint takes tier and relationship from the current profile', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-par-resume-'));
  try {
    const dir = path.join(dataDir, 'brands', 'tru');
    fs.mkdirSync(dir, { recursive: true });
    const write = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o));
    write('tech_stack.json', { players: [
      { name: 'Shop A', url: 'https://a.example.jp/', role: 'player', tier: 'specialty', relationship: 'competitor', observed: true, categories: {}, app: {} },
      { name: 'Shop C', url: 'https://c.example.jp/', role: 'player', tier: 'mass', relationship: 'competitor', observed: true, categories: {}, app: {} },
    ] });
    write('tech_stack_pages.json', { players: {
      'Shop A': [{ url: 'https://a.example.jp/', kind: 'home', digest: 'ギフトラッピング承ります' }],
      'Shop C': [{ url: 'https://c.example.jp/', kind: 'home', digest: 'ギフトラッピング承ります' }],
    } });
    write('profile.json', { identifiedCompetitors: [{ name: 'Shop A', url: 'https://a.example.jp/', tier: 'specialty' }, { name: 'Shop C', url: 'https://c.example.jp/', tier: 'mass' }] });
    const first = await pm.run({ slug: 'tru', dataDir, keywordOnly: true, log: quiet });
    assert.equal(first.output.par.gift_wrap.observed, 2);
    // A finished run clears its checkpoint, so put the saved records back to simulate an
    // interrupted run, then change the profile: Shop C becomes the partner and Shop A moves tier.
    const cp = require('../utils/checkpoint');
    for (const p of first.output.players) cp.put('tru', 'par_matrix', p.url, p, { dataDir });
    write('profile.json', { identifiedCompetitors: [{ name: 'Shop A', url: 'https://a.example.jp', tier: 'niche' }, { name: 'Shop C', url: 'https://c.example.jp/', tier: 'mass', relationship: 'partner' }] });
    const logs = [];
    const second = await pm.run({ slug: 'tru', dataDir, keywordOnly: true, log: m => logs.push(m) });
    assert.ok(logs.some(m => /resumed from checkpoint/.test(m)), 'the second run resumed');
    const c = second.output.players.find(p => p.name === 'Shop C');
    assert.equal(c.relationship, 'partner');
    assert.equal(second.output.players.find(p => p.name === 'Shop A').tier, 'niche');
    assert.equal(second.output.par.gift_wrap.observed, 1, 'the new partner is no longer scored');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
