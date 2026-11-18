// The partner (relationship 'partner', for Toys R Us Japan: Don Quijote) is never analysed,
// placed on the positioning map or counted in assortment gaps. Players with no website are
// recorded as noWebsite and never scraped. No network, no model: every dependency is stubbed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const competitive = require('../analysis/competitive_analysis');

const profile = {
  name: 'Toys R Us Japan',
  url: 'https://www.toysrus.co.jp/',
  industry: 'toy retail',
  identifiedCompetitors: [
    { name: 'Yodobashi', url: 'https://www.yodobashi.com/', tier: 'mass' },
    { name: 'Don Quijote', url: 'https://www.donki.com/', tier: 'mass', relationship: 'partner' },
    { name: 'Kiddyland', url: 'https://www.kiddyland.co.jp/', tier: 'specialty', relationship: 'competitor' },
    { name: 'Tiny Gacha Label', url: null, tier: 'niche' },
  ],
};

function scrapedFor(b) {
  const cats = { 'toys-r-us-japan': ['lego'], yodobashi: ['games', 'lego'], 'don-quijote': ['party goods', 'snacks'], kiddyland: ['plush', 'games'] };
  const id = b.role === 'target' ? b.id : b.id;
  return { ...b, scrapedAt: '2026-11-18T00:00:00.000Z', featuredCategories: cats[id] || [], botBlocked: false, error: null };
}

async function runWith(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-comp-partner-'));
  const calls = { scraped: [], analyzed: [], positioned: [], gapCandidates: [] };
  try {
    const out = await competitive.buildCompetitiveOutput({
      slug: 'zz-comp-partner', profile, dataDir,
      scrape: async (brands) => { calls.scraped = brands.map(b => b.name); return brands.map(scrapedFor); },
      analyze: async (s) => { calls.analyzed.push(s.name); return { pricingTier: 'mid', positioningStatement: `${s.name} line`, strengths: ['s'], opportunities: ['o'] }; },
      positioning: async (analyzed) => {
        calls.positioned = analyzed.map(c => c.name);
        // A model that knows the market may still place the partner; it must be dropped.
        return { narrative: '', axes: {}, brandPositions: [{ name: 'Toys R Us Japan', x: 1, y: 1 }, { name: 'Don Quijote', x: 2, y: 2 }, { name: 'Yodobashi', x: 3, y: 3 }], whiteSpaceOpportunities: [] };
      },
      filterGaps: async (_t, candidates) => { calls.gapCandidates = candidates; return candidates; },
      ...overrides,
    });
    return { out, calls };
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}

test('planPlayers splits competitors, partners and players with no website', () => {
  const plan = competitive.planPlayers(profile);
  assert.deepStrictEqual(plan.competitors.map(p => p.name), ['Yodobashi', 'Kiddyland']);
  assert.deepStrictEqual(plan.partners.map(p => p.name), ['Don Quijote']);
  assert.deepStrictEqual(plan.noWebsite.map(p => p.name), ['Tiny Gacha Label']);
});

test('partner is never scraped, analysed, positioned or counted in gaps', async () => {
  const { out, calls } = await runWith();
  assert.ok(!calls.scraped.includes('Don Quijote'), 'partner not scraped');
  assert.ok(!calls.scraped.includes('Tiny Gacha Label'), 'no-website player not scraped');
  assert.deepStrictEqual(calls.analyzed, ['Yodobashi', 'Kiddyland']);
  assert.deepStrictEqual(calls.positioned, ['Yodobashi', 'Kiddyland']);
  assert.ok(!out.competitors.some(c => c.name === 'Don Quijote'));
  assert.ok(!out.positioningMap.brandPositions.some(b => b.name === 'Don Quijote'), 'partner dropped from the map');
  assert.ok(out.positioningMap.brandPositions.some(b => b.name === 'Yodobashi'));
  assert.ok(!calls.gapCandidates.some(g => g.seenAt.includes('Don Quijote')));
  assert.ok(!out.topAssortmentGaps.some(g => /Don Quijote/.test(g)), 'no "seen at: Don Quijote"');
  assert.ok(!out.topAssortmentGaps.some(g => /party goods|snacks/.test(g)));
  assert.ok(out.topAssortmentGaps.some(g => /games \(seen at: Yodobashi, Kiddyland\)/.test(g)));
});

test('partner and no-website players are labelled in the output for context', async () => {
  const { out } = await runWith();
  assert.deepStrictEqual(out.partners, [{ name: 'Don Quijote', url: 'https://www.donki.com/', tier: 'mass', relationship: 'partner' }]);
  assert.deepStrictEqual(out.noWebsite, [{ name: 'Tiny Gacha Label', url: null, tier: 'niche', relationship: 'competitor' }]);
});

test('a scraper that echoes the partner back still cannot get it analysed', async () => {
  const { calls } = await runWith({
    scrape: async (brands) => [...brands.map(scrapedFor), scrapedFor({ id: 'don-quijote', name: 'Don Quijote', url: 'https://www.donki.com/', role: 'competitor' })],
  });
  assert.ok(!calls.analyzed.includes('Don Quijote'));
});
