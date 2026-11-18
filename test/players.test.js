const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../utils/players');
const { JP_COMPETITORS, JP_UNVERIFIED, jpProfilePlayers } = require('../scrapers/jp_competitors');

test('playersFor defaults tier and relationship, keeps every other field, does not mutate', () => {
  const profile = { identifiedCompetitors: [
    { name: 'A', url: 'https://a.jp/', instagramHandle: 'a_ig', lineId: '@a', custom: 1 },
    { name: 'B', url: 'https://b.jp/', tier: 'MASS', relationship: 'Partner' },
    { name: 'C', url: 'https://c.jp/', tier: 'bogus', relationship: 'frenemy' },
    null, {},
  ] };
  const before = JSON.stringify(profile);
  const ps = P.playersFor(profile);
  assert.equal(ps.length, 3);
  assert.deepStrictEqual([ps[0].tier, ps[0].relationship, ps[0].instagramHandle, ps[0].lineId, ps[0].custom], ['unknown', 'competitor', 'a_ig', '@a', 1]);
  assert.deepStrictEqual([ps[1].tier, ps[1].relationship], ['mass', 'partner']);
  assert.deepStrictEqual([ps[2].tier, ps[2].relationship], ['unknown', 'competitor']);
  assert.equal(JSON.stringify(profile), before);
  assert.deepStrictEqual(P.playersFor(null), []);
  assert.deepStrictEqual(P.playersFor({}), []);
});

test('byTier has every tier key; isPartner and competitorsOnly split the partner out', () => {
  const ps = P.playersFor({ identifiedCompetitors: [
    { name: 'M', tier: 'marketplace' }, { name: 'D', tier: 'mass', relationship: 'partner' }, { name: 'X' },
  ] });
  const g = P.byTier(ps);
  assert.deepStrictEqual(Object.keys(g), [...P.TIER_ORDER]);
  assert.equal(g.marketplace.length, 1);
  assert.equal(g.mass.length, 1);
  assert.equal(g.unknown.length, 1);
  assert.equal(g.niche.length, 0);
  assert.ok(P.isPartner(ps[1]));
  assert.ok(!P.isPartner(ps[0]) && !P.isPartner(null));
  assert.deepStrictEqual(P.competitorsOnly(ps).map(p => p.name), ['M', 'X']);
  assert.deepStrictEqual(P.handlesOf({ xHandle: 'x', instagramHandle: '', foo: 1 }), { xHandle: 'x' });
});

test('TIERS carry English labels and descriptions for the four tiers', () => {
  for (const t of ['marketplace', 'mass', 'specialty', 'niche']) {
    assert.ok(P.TIERS[t].label && P.TIERS[t].description, t);
  }
});

test('JP list: every player has a tier and relationship; Don Quijote is the only partner', () => {
  for (const c of JP_COMPETITORS.filter(c => c.type !== 'target')) {
    assert.ok(['marketplace', 'mass', 'specialty', 'niche'].includes(c.tier), c.name);
    assert.ok(['competitor', 'partner'].includes(c.relationship), c.name);
    assert.ok(c.rationale, c.name);
  }
  const partners = JP_COMPETITORS.filter(c => c.relationship === 'partner');
  assert.deepStrictEqual(partners.map(c => c.name), ['Don Quijote']);
  // Every tier is covered
  for (const t of ['marketplace', 'mass', 'specialty', 'niche']) assert.ok(JP_COMPETITORS.some(c => c.tier === t), t);
  // Hamleys is not verified open, so it is not offered
  assert.ok(!JP_COMPETITORS.some(c => /hamleys/i.test(c.name)));
  assert.ok(JP_UNVERIFIED.some(c => /hamleys/i.test(c.name) && c.why));
});

test('seed profile players match the verified list and keep the scrape block', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../seed_data/brands/toysrus-jp/profile.json'), 'utf8'));
  const expected = jpProfilePlayers(seed.url);
  assert.deepStrictEqual(seed.identifiedCompetitors, expected);
  assert.ok(!seed.identifiedCompetitors.some(c => /toysrus\.co\.jp/.test(c.url)));
  assert.equal(seed.scrape.skipApifyRetry, true);
  const dq = P.playersFor(seed).find(p => p.name === 'Don Quijote');
  assert.ok(P.isPartner(dq));
  assert.ok(!/competing/i.test(dq.rationale));
});
