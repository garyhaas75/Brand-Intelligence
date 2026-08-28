'use strict';
/**
 * =============================================================================
 * Publish this app's tab catalog to whp-auth
 * =============================================================================
 *
 * The console renders a per-tab checkbox for every area an app has, so it needs
 * to know what those areas are. That list lives here, next to the routes it
 * gates, which is the only place it can be correct. So the app publishes it and
 * whp-auth consumes it.
 *
 * Two halves, matching clients/python/whp_catalog.py:
 *
 *   1. Serve it, unauthenticated, at GET /api/tab-catalog. whp-auth reads that
 *      on registration and on its daily poll.
 *   2. Push it at boot. Every app in this fleet redeploys on a git push, so an
 *      app that publishes on startup can never leave whp-auth holding a stale
 *      copy, and it works even when whp-auth cannot reach back into the app.
 *
 * Env: WHP_AUTH_URL, WHP_AUTH_APP, WHP_AUTH_PUSH_SECRET (shown once in the
 * console when the app is registered).
 *
 * Best effort by design. A failed push logs and resolves false, and never
 * throws into the caller. whp-auth keeps the catalog it already has and its
 * daily poll picks the change up anyway. Publishing tab names must never be
 * able to stop this app from starting.
 */

const crypto = require('crypto');

const TIMEOUT_MS = 10000;
// whp-auth waking from sleep is exactly when a fleet deploy happens, so a single
// attempt would make the primary path a coin flip precisely when it matters.
// Seconds to wait BEFORE each attempt.
const BACKOFF_S = [0, 5, 20];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The whp-auth base URL, https only. Throws on anything else. */
function authBaseUrl(raw) {
  const u = String(raw || '').trim().replace(/\/$/, '');
  if (!u) return '';
  let parsed;
  try { parsed = new URL(u); } catch { throw new Error(`WHP_AUTH_URL is not a URL (got '${raw}')`); }
  const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localhost)) {
    throw new Error(`WHP_AUTH_URL must be https (got '${raw}'). The app secret travels in a `
      + 'header and must not go out in the clear.');
  }
  return u;
}

/** The version whp-auth computes when an app publishes none. Same digest as the python client. */
function versionOf(catalog) {
  // Must byte-for-byte match python's json.dumps(sort_keys=True, separators=(',', ':')),
  // because whp-auth recomputes this hash to decide whether the catalog changed. Two things
  // differ from a plain JSON.stringify: python orders object keys at every depth, and it
  // escapes non-ASCII by default. This catalog's labels are full of emoji, so skipping the
  // escaping alone is enough to make every push look like a change.
  const blob = JSON.stringify(sortDeep(catalog))
    .replace(/[^\x00-\x7F]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return crypto.createHash('sha256').update(blob).digest('hex').slice(0, 12);
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortDeep(value[k])]));
  }
  return value;
}

/** One POST. Resolves { published, worthRetrying }. */
async function attempt(url, body, secret) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      // Following a redirect would forward the app secret to whatever answered,
      // possibly on another host and possibly in the clear. A redirect here always
      // means the URL is wrong, so failing loudly beats succeeding quietly.
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-App-Secret': secret },
      body,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      console.warn(`[whp-catalog] whp-auth refused the catalog: HTTP ${res.status} ${detail}`);
      // 4xx is this app's bug (bad secret, malformed catalog) and will fail identically
      // on a retry. 5xx is whp-auth having a bad moment, which is worth another go.
      return { published: false, worthRetrying: res.status >= 500 };
    }
    const out = await res.json().catch(() => ({}));
    const added = (out && out.added) || [];
    console.log(`[whp-catalog] published ${out && out.tab_count} area(s) to whp-auth`
      + (added.length ? `; new: ${added.join(', ')} (granted to nobody until an admin ticks them)` : ''));
    return { published: true, worthRetrying: false };
  } catch (e) {
    console.warn(`[whp-catalog] could not publish the catalog: ${e.message}`);
    return { published: false, worthRetrying: true };
  } finally {
    clearTimeout(timer);
  }
}

async function pushCatalog(catalog, version) {
  if (process.env.WHP_CATALOG_PUSH === 'off') {
    console.log('[whp-catalog] not publishing: WHP_CATALOG_PUSH is off');
    return false;
  }
  const slug = (process.env.WHP_AUTH_APP || '').trim();
  const secret = (process.env.WHP_AUTH_PUSH_SECRET || '').trim();
  let base;
  try {
    base = authBaseUrl(process.env.WHP_AUTH_URL);
  } catch (e) {
    console.warn(`[whp-catalog] not publishing: ${e.message}`);
    return false;
  }
  // Name what is actually missing. "one of these three" sends the next person hunting.
  const missing = [['WHP_AUTH_URL', base], ['WHP_AUTH_APP', slug], ['WHP_AUTH_PUSH_SECRET', secret]]
    .filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) {
    console.log(`[whp-catalog] not publishing: ${missing.join(', ')} not set`);
    return false;
  }

  const body = JSON.stringify({ slug, version: version || versionOf(catalog), permission_catalog: catalog });
  const url = `${base}/api/apps/${slug}/catalog`;
  for (const wait of BACKOFF_S) {
    if (wait) await sleep(wait * 1000);
    const { published, worthRetrying } = await attempt(url, body, secret);
    if (published) return true;
    if (!worthRetrying) return false;
  }
  console.warn("[whp-catalog] gave up publishing the catalog; whp-auth's daily poll is the remaining path");
  return false;
}

/** The payload served at GET /api/tab-catalog. */
function publishCatalog(catalog, slug) {
  return {
    slug: slug || (process.env.WHP_AUTH_APP || '').trim(),
    version: versionOf(catalog),
    permission_catalog: catalog,
  };
}

module.exports = { publishCatalog, pushCatalog, versionOf, authBaseUrl };
