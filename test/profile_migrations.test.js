const test = require('node:test');
const assert = require('node:assert');
const M = require('../modules/profile_migrations');

const seed = () => ({
  slug: 'toysrus-jp',
  identifiedCompetitors: [
    { name: 'Amazon.co.jp Toys', nameJa: 'Amazon おもちゃ', url: 'https://www.amazon.co.jp/toys/', tier: 'marketplace', relationship: 'competitor', rationale: 'New marketplace text.', verifiedAt: { date: '2026-11-18', status: 200 } },
    { name: 'Don Quijote', url: 'https://www.donki.com/', tier: 'mass', relationship: 'partner', rationale: 'PARTNER, studied as a channel.', instagramHandle: 'donki_jp', xHandle: 'donki_donki' },
    { name: 'Mercari', url: 'https://jp.mercari.com/', tier: 'marketplace', relationship: 'competitor', rationale: 'Resale.', xHandle: 'mercari_jp' },
  ],
  scrape: { skipApifyRetry: true, access: { mode: 'apify-jp' }, apifyCapUsd: 5 },
});

const live = () => ({
  slug: 'toysrus-jp',
  name: 'Toys R Us Japan',
  social: { instagram: 'toysrus_jp' },
  identifiedCompetitors: [
    { name: 'Amazon.co.jp Toys', url: 'https://www.amazon.co.jp/toys/', rationale: 'Large online marketplace competing for Japanese toy and baby shoppers.' },
    { name: 'Don Quijote', url: 'https://www.donki.com/', rationale: 'Discount general retailer competing for Japanese toy and baby shoppers.', instagramHandle: 'my_own_ig', lineId: '@634oqtiy' },
    { name: 'User Added Shop', url: 'https://user-added.jp/', rationale: 'Mine.', tiktokHandle: 'mine' },
  ],
  scrape: { skipApifyRetry: true, note: 'keep me' },
});

test('players: fills tiers, adds new seed players, keeps user entries and handles, marks once', () => {
  const input = live();
  const before = JSON.stringify(input);
  const r = M.migrateToysrusJpPlayers(input, seed());
  assert.equal(JSON.stringify(input), before, 'input not mutated');
  assert.equal(r.changed, true);
  const list = r.profile.identifiedCompetitors;
  assert.deepStrictEqual(list.map(c => c.name), ['Amazon.co.jp Toys', 'Don Quijote', 'User Added Shop', 'Mercari']);

  const amz = list[0];
  assert.equal(amz.tier, 'marketplace');
  assert.equal(amz.nameJa, 'Amazon おもちゃ');
  assert.equal(amz.rationale, 'New marketplace text.', 'old generic seed text replaced');
  assert.match(amz.previousRationale, /competing for Japanese toy/);

  const dq = list[1];
  assert.equal(dq.relationship, 'partner');
  assert.equal(dq.instagramHandle, 'my_own_ig', 'existing handle wins');
  assert.equal(dq.lineId, '@634oqtiy', 'live-only handle kept');
  assert.equal(dq.xHandle, 'donki_donki', 'missing handle filled from seed');
  assert.equal(dq.rationale, 'PARTNER, studied as a channel.');
  assert.match(dq.previousRationale, /competing/);

  assert.deepStrictEqual(list[2], live().identifiedCompetitors[2], 'user-added entry untouched');
  assert.equal(list[3].source, 'seed');
  assert.deepStrictEqual(r.profile.social, { instagram: 'toysrus_jp' });
  assert.deepStrictEqual(r.profile.migrations, [M.PLAYERS_MIGRATION]);
});

test('players: idempotent, and a removed seed player is not re-added after the marker', () => {
  const once = M.migrateToysrusJpPlayers(live(), seed()).profile;
  const twice = M.migrateToysrusJpPlayers(once, seed());
  assert.equal(twice.changed, false);
  assert.deepStrictEqual(twice.profile, once);
  const removed = { ...once, identifiedCompetitors: once.identifiedCompetitors.filter(c => c.name !== 'Mercari') };
  const again = M.migrateToysrusJpPlayers(removed, seed());
  assert.ok(!again.profile.identifiedCompetitors.some(c => c.name === 'Mercari'));
});

test('players: a user-written rationale and relationship are never overwritten', () => {
  const p = live();
  p.identifiedCompetitors[0].rationale = 'Our own words.';
  p.identifiedCompetitors[1].relationship = 'competitor';
  const r = M.migrateToysrusJpPlayers(p, seed()).profile.identifiedCompetitors;
  assert.equal(r[0].rationale, 'Our own words.');
  assert.equal(r[0].previousRationale, undefined);
  assert.equal(r[1].relationship, 'competitor');
});

test('players: empty seed is a no-op and is not marked applied', () => {
  const r = M.migrateToysrusJpPlayers(live(), { identifiedCompetitors: [] });
  assert.equal(r.changed, false);
  assert.equal(r.profile.migrations, undefined);
});

test('scrape: copies access and apifyCapUsd only when absent, keeps other keys', () => {
  const r = M.migrateToysrusJpScrape(live(), seed());
  assert.equal(r.changed, true);
  assert.deepStrictEqual(r.profile.scrape, { skipApifyRetry: true, note: 'keep me', access: { mode: 'apify-jp' }, apifyCapUsd: 5 });
  const p = live(); p.scrape.apifyCapUsd = 2;
  assert.equal(M.migrateToysrusJpScrape(p, seed()).profile.scrape.apifyCapUsd, 2);
  const noSeed = M.migrateToysrusJpScrape(live(), { scrape: { skipApifyRetry: true } });
  assert.equal(noSeed.changed, false);
  assert.equal(noSeed.profile.migrations, undefined, 'not marked so it runs once the seed has the fields');
  assert.equal(M.migrateToysrusJpScrape(r.profile, seed()).changed, false);
});

test('migrateProfile runs both for toysrus-jp only', () => {
  const r = M.migrateProfile('toysrus-jp', live(), seed());
  assert.equal(r.changed, true);
  assert.deepStrictEqual(r.profile.migrations, [M.PLAYERS_MIGRATION, M.SCRAPE_MIGRATION]);
  const other = live();
  const o = M.migrateProfile('akyoung', other, seed());
  assert.equal(o.changed, false);
  assert.strictEqual(o.profile, other);
});

test('real seed against a copy of the live profile shape: no player or handle lost', () => {
  const fs = require('fs');
  const path = require('path');
  const realSeed = JSON.parse(fs.readFileSync(path.join(__dirname, '../seed_data/brands/toysrus-jp/profile.json'), 'utf8'));
  const l = live();
  const r = M.migrateProfile('toysrus-jp', l, realSeed).profile;
  for (const c of l.identifiedCompetitors) {
    const m = r.identifiedCompetitors.find(x => x.url === c.url);
    assert.ok(m, c.name);
    for (const k of ['instagramHandle', 'tiktokHandle', 'lineId']) if (c[k]) assert.equal(m[k], c[k], `${c.name} ${k}`);
  }
  assert.ok(r.identifiedCompetitors.length >= realSeed.identifiedCompetitors.length);
});
