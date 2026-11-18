/**
 * Players: the tiered view of a brand's competitive set.
 *
 * Every entry in profile.identifiedCompetitors may carry:
 *   tier:         'marketplace' | 'mass' | 'specialty' | 'niche'
 *   relationship: 'competitor' | 'partner'
 * Missing values default to tier 'unknown' and relationship 'competitor', so
 * profiles written before tiers existed keep working unchanged.
 *
 * A partner (for Toys R Us Japan: Don Quijote) is studied as a channel and
 * must never be scored or ranked as a competitor. Use isPartner() to split.
 *
 * Pure module: no I/O, no network, no model calls.
 */

const TIERS = Object.freeze({
  marketplace: Object.freeze({
    label: 'Marketplace / pure e-commerce',
    description: 'Online marketplaces and pure-play e-commerce where many sellers list toys.',
  }),
  mass: Object.freeze({
    label: 'Mass retail',
    description: 'General merchandise, electronics and baby chains with a large toy department.',
  }),
  specialty: Object.freeze({
    label: 'Specialty',
    description: 'Toy, character and hobby specialists, including manufacturer-direct stores.',
  }),
  niche: Object.freeze({
    label: 'Niche',
    description: 'Small or focused players: educational, gacha, collectibles, indie and D2C labels.',
  }),
  unknown: Object.freeze({
    label: 'Unclassified',
    description: 'No tier recorded yet.',
  }),
});

// Display order. 'unknown' sorts last.
const TIER_ORDER = Object.freeze(['marketplace', 'mass', 'specialty', 'niche', 'unknown']);
const RELATIONSHIPS = Object.freeze(['competitor', 'partner']);
const HANDLE_KEYS = Object.freeze([
  'instagramHandle', 'tiktokHandle', 'facebookHandle', 'xHandle', 'youtubeHandle', 'lineId',
]);

function normTier(t) {
  const s = String(t || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TIERS, s) ? s : 'unknown';
}

function normRelationship(r) {
  const s = String(r || '').trim().toLowerCase();
  return RELATIONSHIPS.includes(s) ? s : 'competitor';
}

/**
 * Normalized players for a profile. Never mutates the input. Every field on
 * the original entry is kept; tier and relationship are normalized.
 *
 * @param {object} profile
 * @returns {Array<object>}
 */
function playersFor(profile) {
  const list = profile && Array.isArray(profile.identifiedCompetitors) ? profile.identifiedCompetitors : [];
  return list
    .filter(c => c && typeof c === 'object' && (c.name || c.url))
    .map(c => ({
      ...c,
      name: c.name || c.url,
      url: c.url || null,
      tier: normTier(c.tier),
      relationship: normRelationship(c.relationship),
    }));
}

/**
 * Group players by tier. Every key in TIER_ORDER is present (possibly empty).
 * @param {Array<object>} players output of playersFor
 * @returns {{marketplace:Array, mass:Array, specialty:Array, niche:Array, unknown:Array}}
 */
function byTier(players) {
  const out = {};
  for (const t of TIER_ORDER) out[t] = [];
  for (const p of players || []) out[normTier(p && p.tier)].push(p);
  return out;
}

function isPartner(p) {
  return !!p && normRelationship(p.relationship) === 'partner';
}

/** Players that may be scored and ranked as competitors (partners excluded). */
function competitorsOnly(players) {
  return (players || []).filter(p => !isPartner(p));
}

/** Social handles on a player, keyed as in the profile, only those set. */
function handlesOf(p) {
  const out = {};
  for (const k of HANDLE_KEYS) if (p && p[k]) out[k] = p[k];
  return out;
}

module.exports = {
  TIERS, TIER_ORDER, RELATIONSHIPS, HANDLE_KEYS,
  playersFor, byTier, isPartner, competitorsOnly, handlesOf, normTier, normRelationship,
};
