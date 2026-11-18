/**
 * One-time, idempotent migrations of live brand profiles from their seed.
 *
 * Why: the Railway volume already holds data/brands/<slug>/profile.json and
 * seeding never overwrites an existing file (cp -rn, mergeBrandSeedData), so a
 * change to a seed profile never reaches production on its own. These pure
 * functions merge the new seed fields into the live profile without dropping
 * anything the live profile has (user-added competitors, handles found by
 * scans, edited rationales).
 *
 * Pure: no I/O. The caller reads both files, calls migrateProfile (or the
 * single functions), and writes the profile back only when `changed` is true.
 *
 * Contract of every migrate* function:
 *   input:  (profile, seedProfile), neither is mutated
 *   output: { profile, changed, report: string[] }
 *   - profile.migrations gets the migration id appended once it has run
 *   - a migration whose id is already in profile.migrations is a no-op, so a
 *     user who later removes a seeded player does not get it re-added
 */

const PLAYERS_MIGRATION = 'players-tiers-2026-11-18';
const SCRAPE_MIGRATION = 'scrape-access-2026-11-18';
const TARGET_SLUG = 'toysrus-jp';

const HANDLE_KEYS = ['instagramHandle', 'tiktokHandle', 'facebookHandle', 'xHandle', 'youtubeHandle', 'lineId'];
// Fields copied from the seed onto a matched live entry only when the live entry lacks them.
const FILL_KEYS = ['nameJa', 'tier', 'relationship', 'verifiedAt', ...HANDLE_KEYS];

// The generic rationale every entry carried in the pre-2026-11-18 seed. Text that
// matches it was written by the seed, not a person, so the new seed text may replace
// it (the old text is kept as previousRationale). Anything else is a user's and wins.
const OLD_SEED_RATIONALE = /^[^.]* competing for Japanese toy and baby shoppers\.$/;

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const has = v => v !== undefined && v !== null && v !== '';

function normUrl(u) {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./i, '') + x.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch { return ''; }
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
}
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9぀-ヿ㐀-鿿]+/g, '');

// Exact URL, then host when the host is unique on both sides, then name.
function findMatch(list, seedEntry, taken) {
  const free = list.map((c, i) => ({ c, i })).filter(x => !taken.has(x.i));
  const u = normUrl(seedEntry.url);
  let hit = u && free.find(x => normUrl(x.c.url) === u);
  if (hit) return hit.i;
  const h = hostOf(seedEntry.url);
  if (h) {
    const same = free.filter(x => hostOf(x.c.url) === h);
    if (same.length === 1) return same[0].i;
  }
  const n = normName(seedEntry.name);
  hit = n && free.find(x => normName(x.c.name) === n);
  return hit ? hit.i : -1;
}

function withMarker(profile, id) {
  const m = Array.isArray(profile.migrations) ? profile.migrations.slice() : [];
  if (!m.includes(id)) m.push(id);
  return m;
}

/**
 * Merge tiers, relationships, new players and handles from the seed into a
 * live toysrus-jp profile.
 *  - matched entries: missing fields filled from the seed; existing values win
 *    (a user's own handle or relationship is never overwritten). When this
 *    migration makes an entry a partner, its old competitor rationale is kept
 *    as previousRationale and the seed rationale replaces it, so no screen
 *    calls the partner a competitor. The same replacement happens when the
 *    live rationale is the old generic seed text (OLD_SEED_RATIONALE).
 *  - seed players not in the live profile are appended (source 'seed').
 *  - live players not in the seed are kept as they are.
 */
function migrateToysrusJpPlayers(profile, seedProfile) {
  const report = [];
  if (!profile || typeof profile !== 'object') return { profile, changed: false, report: ['no profile'] };
  if (Array.isArray(profile.migrations) && profile.migrations.includes(PLAYERS_MIGRATION)) {
    return { profile, changed: false, report: ['already applied'] };
  }
  const seedList = seedProfile && Array.isArray(seedProfile.identifiedCompetitors) ? seedProfile.identifiedCompetitors : [];
  if (!seedList.length) return { profile, changed: false, report: ['seed has no players; not marking as applied'] };

  const out = clone(profile);
  const list = Array.isArray(out.identifiedCompetitors) ? out.identifiedCompetitors : [];
  const taken = new Set();

  for (const s of seedList) {
    if (!s || !(s.url || s.name)) continue;
    const i = findMatch(list, s, taken);
    if (i === -1) {
      list.push({ ...clone(s), source: 'seed' });
      taken.add(list.length - 1);
      report.push(`added ${s.name}`);
      continue;
    }
    taken.add(i);
    const live = list[i];
    const filled = [];
    const becomesPartner = !has(live.relationship) && s.relationship === 'partner';
    for (const k of FILL_KEYS) {
      if (!has(live[k]) && has(s[k])) { live[k] = clone(s[k]); filled.push(k); }
    }
    const staleSeedText = OLD_SEED_RATIONALE.test(String(live.rationale || ''));
    if ((becomesPartner || staleSeedText) && has(s.rationale) && live.rationale !== s.rationale) {
      if (has(live.rationale)) live.previousRationale = live.rationale;
      live.rationale = s.rationale;
      filled.push('rationale');
    } else if (!has(live.rationale) && has(s.rationale)) {
      live.rationale = s.rationale;
      filled.push('rationale');
    }
    if (filled.length) report.push(`updated ${live.name || s.name}: ${filled.join(', ')}`);
  }

  out.identifiedCompetitors = list;
  out.migrations = withMarker(out, PLAYERS_MIGRATION);
  return { profile: out, changed: true, report };
}

/**
 * Copy scrape.access and scrape.apifyCapUsd from the seed when the live
 * profile lacks them. Every other scrape key (skipApifyRetry, note, ...) is
 * left exactly as it is. A no-op without a marker while the seed does not yet
 * carry either field, so it runs once the seed does.
 */
function migrateToysrusJpScrape(profile, seedProfile) {
  if (!profile || typeof profile !== 'object') return { profile, changed: false, report: ['no profile'] };
  if (Array.isArray(profile.migrations) && profile.migrations.includes(SCRAPE_MIGRATION)) {
    return { profile, changed: false, report: ['already applied'] };
  }
  const seedScrape = (seedProfile && seedProfile.scrape) || {};
  if (!has(seedScrape.access) && !has(seedScrape.apifyCapUsd)) {
    return { profile, changed: false, report: ['seed has no scrape.access or scrape.apifyCapUsd; not marking as applied'] };
  }
  const out = clone(profile);
  const scrape = out.scrape && typeof out.scrape === 'object' ? out.scrape : {};
  const report = [];
  for (const k of ['access', 'apifyCapUsd']) {
    if (!has(scrape[k]) && has(seedScrape[k])) { scrape[k] = clone(seedScrape[k]); report.push(`scrape.${k} copied from seed`); }
  }
  // the old note said not to use proxies, which now contradicts the authorization: take the seed's note
  if (typeof scrape.note === 'string' && /proxies/i.test(scrape.note) && typeof seedScrape.note === 'string' && seedScrape.note !== scrape.note) {
    scrape.note = seedScrape.note; report.push('scrape.note updated from seed');
  }
  out.scrape = scrape;
  out.migrations = withMarker(out, SCRAPE_MIGRATION);
  return { profile: out, changed: true, report };
}

/**
 * Run every migration that applies to this slug, in order. For any slug other
 * than toysrus-jp it returns the profile untouched.
 */
function migrateProfile(slug, profile, seedProfile) {
  if (slug !== TARGET_SLUG || !profile || !seedProfile) return { profile, changed: false, report: [] };
  let cur = profile;
  let changed = false;
  const report = [];
  for (const fn of [migrateToysrusJpPlayers, migrateToysrusJpScrape]) {
    const r = fn(cur, seedProfile);
    cur = r.profile;
    changed = changed || r.changed;
    report.push(...r.report.map(x => `${fn.name}: ${x}`));
  }
  return { profile: cur, changed, report };
}

module.exports = {
  migrateToysrusJpPlayers, migrateToysrusJpScrape, migrateProfile,
  PLAYERS_MIGRATION, SCRAPE_MIGRATION, TARGET_SLUG,
};
