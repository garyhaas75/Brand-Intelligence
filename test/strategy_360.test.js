const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const s360 = require('../analysis/strategy_360');

function fixtureDir() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-s360-'));
  const b = path.join(dataDir, 'brands', 'x');
  fs.mkdirSync(b, { recursive: true });
  const w = (f, o) => fs.writeFileSync(path.join(b, f), JSON.stringify(o));
  w('profile.json', { name: 'Toys R Us Japan', identifiedCompetitors: [{ name: 'Don Quijote', tier: 'mass', relationship: 'partner' }, { name: 'Kiddy Land', tier: 'specialty' }] });
  w('tech_stack.json', { players: [{ name: 'Toys R Us Japan', role: 'target', observed: true, platform: { name: 'Salesforce Commerce Cloud' }, categories: { payments: ['PayPay'] } }] });
  w('par_matrix.json', { par: { store_pickup: { yesShare: 0.5, leaders: ['Yodobashi'], targetStatus: 'yes' } }, gaps: [{ key: 'gift_wrap', label: 'Gift wrap', targetStatus: 'unknown', parShare: 0.7 }], players: [{ observed: true }] });
  return dataDir;
}

const good = {
  executiveSummary: ['a', 'b', 'c'],
  positioningByTier: [{ tier: 'Marketplace', whoWins: 'Amazon', howTheyWin: 'speed \u2014 price', evidence: ['x'] }, { tier: 'niche', whoWins: 'n' }, { tier: 'bogus' }],
  channelMap: [{ channel: 'LINE', role: 'retain' }, { channel: 'own site', role: 'convert' }, { channel: 'Instagram', role: 'acquire' }, { channel: 'Don Quijote shop-in-shop', role: 'drive to store' }],
  onlineToStore: [{ tactic: 't1', impact: 'HIGH' }, { tactic: 't2' }, { tactic: 't3' }],
  roadmap: [{ phase: '0-90 days', actions: ['x'] }, { phase: '3-6 months', actions: ['y'] }],
};

test('evidence carries the partner label, the target tech and the par gaps', () => {
  const ev = s360.buildEvidence(s360.loadInputs('x', fixtureDir()));
  assert.match(ev.text, /Don Quijote \| tier mass \| partner/);
  assert.match(ev.text, /Toys R Us Japan \(TARGET\): platform Salesforce Commerce Cloud/);
  assert.match(ev.text, /GAP Gift wrap/);
  assert.equal(ev.observed, true);
});

test('normalize coerces enums, drops unknown tiers and removes em dashes', () => {
  const n = s360.normalizeStrategy(good);
  assert.deepEqual(n.positioningByTier.map(t => t.tier), ['marketplace', 'niche']);
  assert.ok(!/\u2014/.test(JSON.stringify(n)));
  assert.equal(n.onlineToStore[0].impact, 'high');
  assert.equal(s360.isUsable(n), true);
  assert.equal(s360.isUsable(s360.normalizeStrategy({})), false);
});

test('prompt marks partner as channel, unseen capabilities as confirm, evidence as untrusted', () => {
  const { system } = s360.buildPrompt('Toys R Us Japan', { text: 'x', observed: false });
  assert.match(system, /never a competitor/);
  assert.match(system, /"confirm"/);
  assert.match(system, /untrusted data/);
});

test('run writes the strategy, and a failed run keeps the previous file marked stale', async () => {
  const dataDir = fixtureDir();
  const reply = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
  const ok = { messages: { create: async () => reply(JSON.stringify(good)) } };
  const r = await s360.run({ slug: 'x', dataDir, client: ok, log: () => {} });
  assert.equal(r.output.channelMap.length, 4);
  const bad = { messages: { create: async () => reply('not json') } };
  await assert.rejects(s360.run({ slug: 'x', dataDir, client: bad, log: () => {} }));
  const kept = JSON.parse(fs.readFileSync(path.join(dataDir, 'brands', 'x', 'strategy_360.json'), 'utf8'));
  assert.equal(kept.stale, true);
  assert.equal(kept.channelMap.length, 4);
});

test('links and handles the evidence does not contain are removed, ones it contains are kept', () => {
  const ev = 'Kiddy Land sells via https://store.shopping.yahoo.co.jp/kiddyland/ and posts as @kiddyland_official';
  const out = s360.scrubUnsupported({ a: 'See https://invented.example.com/page for details', b: ['Copy @madeup_handle now', 'Like https://store.shopping.yahoo.co.jp/kiddyland/ does'], c: 'Follow @kiddyland_official and visit fake-toys.jp today' }, ev);
  assert.ok(!/invented\.example/.test(out.a));
  assert.ok(!/madeup_handle/.test(out.b[0]));
  assert.match(out.b[1], /store\.shopping\.yahoo\.co\.jp\/kiddyland\//);
  assert.match(out.c, /@kiddyland_official/);
  assert.ok(!/fake-toys\.jp/.test(out.c));
});

test('scrub: a prefix of a real handle, unlisted domains and look-alike hosts are removed', () => {
  const ev = 'posts as @kiddyland_official; site https://www.kiddyland.co.jp/ ; Amazon.co.jp Toys';
  const out = s360.scrubUnsupported('Follow @kiddy and @kiddyland_official, visit madeup.io and https://kiddyland.co.jp.evil.com/x, like Amazon.co.jp does', ev);
  assert.ok(!/@kiddy\b(?!land)/.test(out), out);
  assert.match(out, /@kiddyland_official/);
  assert.ok(!/madeup\.io/.test(out), out);
  assert.ok(!/evil\.com/.test(out), out);
  assert.match(out, /Amazon\.co\.jp/);
});

test('engagement rate is printed as the stored percent, not multiplied', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-s360e-'));
  const b = path.join(dataDir, 'brands', 'x'); fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, 'profile.json'), JSON.stringify({ name: 'T' }));
  fs.writeFileSync(path.join(b, 'social_intelligence.json'), JSON.stringify({ brands: [{ name: 'Kiddy Land', platforms: { instagram: { followers: 1000, posts: 25, engagementRate: 2.5, postsPerWeek: 3 } } }] }));
  const ev = s360.buildEvidence(s360.loadInputs('x', dataDir));
  assert.match(ev.text, /instagram: 1000 \/ 25 \/ 2\.50% \/ 3/);
});
