'use strict';
/**
 * =============================================================================
 * Tab catalog + API access map
 * =============================================================================
 *
 * TAB_CATALOG is the canonical list of everything a person can be granted here.
 * It mirrors the dashboard nav (TABS in dashboard/src/App.jsx) one for one, ids
 * included, because a catalog that drifts from the nav puts a checkbox in the
 * whp-auth console that corresponds to nothing on screen. It is published at
 * GET /api/tab-catalog and pushed to whp-auth at boot, and it drives the gating
 * below.
 *
 * Three layers decide what a request needs, in this order:
 *
 *   1. API_ROUTE_RULES, an ordered method-and-path list, first match wins. This
 *      is where a privileged write gets pinned tighter than the prefix it sits
 *      under. Used sparingly, for writes that create, destroy or spend.
 *   2. The two-segment map key, so a detail path can differ from its parent.
 *   3. The one-segment map key, the fallback for the rest of a surface.
 *
 * Anything that resolves to nothing is authenticated-but-ungated. That is the
 * safe direction: a new endpoint stays reachable by any signed-in user rather
 * than silently 403-ing for everyone including the person who added it.
 *
 * Several endpoints are read by more than one screen. The Action Plan tab loads
 * all six analysis datasets to build its plan, so every one of those prefixes
 * lists 'action' as a legitimate caller. Miss one and a person holding Action
 * Plan 403s inside a page they were granted.
 *
 * Enforcement is tab-level. This app has no subtabs.
 *
 * The tenant-in-the-path trap, which this app has. Nearly every route here is
 *
 *     /api/brands/<brand-slug>/<area>[/<detail>]
 *
 * so the first segment under /api is the literal string 'brands' on almost
 * everything, and the segment that names the area sits two further along, past
 * a brand slug that varies per row. Keying on the first segment alone would
 * collapse the whole API onto one entry and leave every screen ungated while
 * looking correct. tabsForPath skips the brand slug before doing the two-then-
 * one segment lookup:
 *
 *     /api/brands/acme/refresh/personas  ->  'refresh/personas', then 'refresh'
 *     /api/brands/acme/personas          ->  'personas'
 *     /api/settings/social-cookies       ->  'settings/social-cookies', then 'settings'
 *
 * This app has no brand-level scoping of any kind: nothing in the token, the
 * routes or the data layer narrows anyone to a subset of brands. Per-tab access
 * therefore says which sections a person sees, never which brands, and nothing
 * here should be read as implying otherwise.
 */

// Ids and order match TABS in dashboard/src/App.jsx. Do not rename an id: it is
// what a grant in whp-auth records, so renaming one silently revokes it.
const TAB_CATALOG = [
  { group: 'portfolio', label: 'Portfolio', tabs: [
    { id: 'portfolio',   label: 'Portfolio' },
    { id: 'profile',     label: 'Brand Profile' },
  ] },
  { group: 'analysis', label: 'Analysis', tabs: [
    { id: 'competitive', label: 'Competitive Analysis' },
    { id: 'personas',    label: 'Personas' },
    { id: 'social',      label: 'Social Audit' },
    { id: 'website',     label: 'Website Audit' },
    { id: 'search',      label: 'Search & SEO' },
    { id: 'action',      label: 'Action Plan' },
  ] },
];

const ALL_TABS = TAB_CATALOG.flatMap(g => g.tabs.map(t => t.id));

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ---------------------------------------------------------------------------
// Ordered rules, checked BEFORE the map. First match wins. `method: 'WRITE'`
// matches any of POST, PUT, PATCH, DELETE.
//
// Reach for a rule only where the map genuinely cannot express the split. That
// is the collection-versus-detail shape: the second segment is a brand slug, so
// no map key can tell GET /api/brands from DELETE /api/brands/acme.
// ---------------------------------------------------------------------------
const API_ROUTE_RULES = [
  // --- The brand registry --------------------------------------------------
  // GET /api/brands is the header's brand switcher. Every screen reads it on
  // load, including screens that own nothing about the portfolio, so that
  // prefix has to stay broad. The writes underneath it must not be. Adding a
  // brand starts a full discovery run, and deleting one removes the registry
  // entry AND rm -rf's the brand's whole data directory, which was reachable by
  // anyone who could sign in.
  { method: 'POST',   path: /^\/api\/brands\/?(?:[?#]|$)/,          tabs: ['portfolio'] },
  { method: 'DELETE', path: /^\/api\/brands\/[^/]+\/?(?:[?#]|$)/,   tabs: ['portfolio'] },

  // Reading the registry stays broad, but it is not open to everyone who can
  // merely sign in. ALL_TABS here means "holds at least one area of this tool",
  // because userAllowed passes on any one of the required tabs. Someone granted
  // nothing has no screen that needs the switcher, and the switcher was handing
  // them the name of every brand WHP is tracking. Anyone holding any section
  // keeps the switcher exactly as before.
  { method: 'GET', path: /^\/api\/brands(?:\/[^/]+)?\/?(?:[?#]|$)/, tabs: ALL_TABS },

  // --- Whole-brand re-discovery -------------------------------------------
  // Spawns every analysis module at once. That is the Portfolio screen's
  // "Refresh All", not any single analysis tab: the cost and the blast radius
  // both belong to the screen that owns the brand rather than to one section of
  // it. Per-module refresh stays with its own tab, via the map below.
  { method: 'POST', path: /^\/api\/brands\/[^/]+\/refresh\/all(?:[/?#]|$)/, tabs: ['portfolio'] },
];

/** The first rule matching this method and path, or null. */
function ruleFor(pathname, method) {
  const m = String(method || 'GET').toUpperCase();
  const raw = String(pathname || '').split('#')[0];
  for (const r of API_ROUTE_RULES) {
    if (r.method === 'WRITE' ? !WRITE_METHODS.has(m) : r.method !== m) continue;
    if (r.path.test(raw)) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The area segment of a request path  ->  the screens allowed to call it.
// ---------------------------------------------------------------------------

// The six analysis modules, and who legitimately reads each one. The Action
// Plan tab renders on top of all six, which is why 'action' appears throughout.
const MODULE_READERS = {
  competitive_analysis: ['competitive', 'action'],
  personas:             ['personas', 'action'],
  social_intelligence:  ['social', 'action'],
  site_intelligence:    ['website', 'action'],
  search_seo:           ['search', 'action'],
  action_plan:          ['action'],
};

// Only the tab that owns a module may pay for a re-run of it. Brand Profile is
// listed on three of them because its "re-discover" button kicks those off.
const MODULE_WRITERS = {
  competitive_analysis: ['competitive', 'profile'],
  personas:             ['personas'],
  social_intelligence:  ['social', 'profile'],
  site_intelligence:    ['website', 'profile'],
  search_seo:           ['search'],
  action_plan:          ['action'],
};

const API_TAB_MAP = {
  // ---- Brand profile -------------------------------------------------------
  'profile':              ['profile'],
  'brand_guidelines':     ['profile'],
  'upload_style_guide':   ['profile'],
  'process_style_guide':  ['profile'],
  'discovery-log':        ['profile', 'portfolio'],

  // ---- Analysis module reads ----------------------------------------------
  'competitive_analysis': MODULE_READERS.competitive_analysis,
  'personas':             MODULE_READERS.personas,
  'social_intelligence':  MODULE_READERS.social_intelligence,
  'site_intelligence':    MODULE_READERS.site_intelligence,
  'search_seo':           MODULE_READERS.search_seo,
  'action_plan':          MODULE_READERS.action_plan,

  // ---- Per-tab extras ------------------------------------------------------
  'persona-chat':         ['personas'],
  'suggest-personas':     ['personas'],
  'social-manual-import': ['social'],
  'audit-progress':       ['social'],

  // The export pair and the share links they mint are the Action Plan tab's
  // deliverable. A share link is readable by anyone who receives it, with no
  // account at all, so minting one is not something a read-only grant on some
  // other section should reach. Revoking one sits with minting it.
  'export':               ['action'],
  'export/pdf':           ['action'],
  'export/share-link':    ['action'],
  'share-links':          ['action'],

  // ---- Portfolio -----------------------------------------------------------
  'data-size':            ['portfolio'],

  // ---- Social session cookies ---------------------------------------------
  // Credentials the social scrapers sign in with. No screen calls this today,
  // so it is scoped to the section it serves rather than left open to every
  // signed-in user.
  'settings':             ['social'],

  // ---- Per-module detail paths --------------------------------------------
  // Filled in below so /refresh/<module>, /history/<module> and
  // /module-log/<module> land on the same tabs as the module itself. The bare
  // prefixes sit under them as a floor, so an unrecognised module name cannot
  // fall through the two-segment lookup into "ungated". 'refresh' resolves to
  // Portfolio by way of the rule above; these are the read equivalents.
  'refresh':              ['portfolio'],
  'history':              ['portfolio'],
  'module-log':           ['portfolio'],
};

for (const [module, tabs] of Object.entries(MODULE_WRITERS)) {
  API_TAB_MAP[`refresh/${module}`] = tabs;
}
for (const [module, tabs] of Object.entries(MODULE_READERS)) {
  API_TAB_MAP[`history/${module}`] = tabs;
  API_TAB_MAP[`module-log/${module}`] = tabs;
}

// Intentionally left ungated for any signed-in user:
//
//   'status'      polled by the app shell on every tab while a refresh runs.
//   'me'          identity, and it is what tells the client who it is.
//   'proxy-image' a generic image proxy no screen calls today.

/**
 * The tabs allowed to make this request, or null for "any authenticated user".
 * Takes the method as well as the path: several rules cannot be expressed
 * without it.
 */
function tabsForPath(pathname, method) {
  const rule = ruleFor(pathname, method);
  if (rule) return rule.tabs;

  const raw = String(pathname || '').split('?')[0].split('#')[0];
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] !== 'api') return null;

  // Drop 'api', then drop the brand slug so the area lands in first position.
  let segs = parts.slice(1);
  if (segs[0] === 'brands' && segs.length >= 3) segs = segs.slice(2);
  if (!segs.length) return null;

  // Two segments first so /refresh/personas and /history/personas can differ
  // from their prefix, then one so an unlisted detail path still inherits its
  // area's rule instead of falling through ungated.
  const two = segs.length >= 2 ? `${segs[0]}/${segs[1]}` : null;
  if (two && API_TAB_MAP[two]) return API_TAB_MAP[two];
  return API_TAB_MAP[segs[0]] || null;
}

// Does this user hold at least one of `required`? Admins always pass.
function userAllowed(user, required) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (!required || !required.length) return true;
  const held = new Set((user.permissions && user.permissions.tabs) || []);
  return required.some(t => held.has(t));
}

module.exports = {
  TAB_CATALOG, ALL_TABS, API_TAB_MAP, API_ROUTE_RULES, WRITE_METHODS,
  ruleFor, tabsForPath, userAllowed,
};
