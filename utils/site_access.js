/**
 * How this tool may reach a website: directly, only through a Japanese proxy, or not at all.
 *
 * toysrus.co.jp fences its storefront to Japan (it blocks traffic from outside Japan to keep sales
 * inside the licensed territory). WHP, the brand owner, authorized on 2026-11-18 reading that site
 * through a Japanese residential proxy: only that host, a handful of read-only pages per module per
 * run, slow pace, no login and no purchase.
 *
 * A host is jp_proxy only when BOTH hold:
 *   (i)  it is in PROXY_ALLOWED_HOSTS below (code, reviewed in a commit; a dashboard edit cannot add one), and
 *   (ii) the LIVE profile for that host (data/brands, not the seed) has scrape.access.mode === 'jp_proxy'.
 * Removing scrape.access from the live profile, or setting BI_PROXY_OFF=1, revokes it. The seed carries
 * the block only so the boot migration can copy it into the live profile once.
 *
 * accessFor(url) answers:
 *   { mode: 'direct' }                                   ordinary site, request it normally
 *   { mode: 'jp_proxy', maxPages, authorization }        only through fetchPage / playwrightProxy
 *   { mode: 'denied', reason }                           never request it
 *
 * A host in the built-in list, or of a profile with scrape.skipApifyRetry, or in BI_NO_CONTACT_HOSTS,
 * is denied unless it is jp_proxy as above. utils/no_contact.js keeps its meaning "may this host be
 * requested DIRECTLY", so it stays false for a jp_proxy host and every caller that has not been taught
 * the proxy route stays safe by default. guardContext(context) enforces the same rule on every request
 * (redirects and subresources) a Playwright context makes.
 */
const fs = require('fs');
const path = require('path');
const noContact = require('./no_contact');

/** The only hosts that may ever be reached through the proxy. Who authorized it, when, and why. */
const PROXY_ALLOWED_HOSTS = Object.freeze({
  'toysrus.co.jp': Object.freeze({
    authorizedBy: 'WHP (Gary Haas, brand owner side)',
    authorizedAt: '2026-11-18',
    reason: 'The brand owner authorized read-only access to its geo-fenced Japan storefront through a Japanese residential proxy: a handful of pages per module per run, slow pace, no login, no purchase.',
  }),
});

const LIVE_DIRS = [path.join(__dirname, '../data/brands')];
const DEFAULT_MAX_PAGES = 8;
const PROXY_SERVER = 'http://proxy.apify.com:8000';
const PROXY_USERNAME = 'groups-RESIDENTIAL,country-JP';
const MIN_GAP_MS = 2500; // polite pace between proxied requests to one host
const MAX_HOPS = 5;
const PASSWORD_TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REDIRECT_REASON = 'redirected to a host this route may not request';

const allowedKeyFor = (h) => Object.keys(PROXY_ALLOWED_HOSTS).find(k => h === k || h.endsWith('.' + k)) || null;

let liveCache = { at: 0, key: '', map: new Map() };
/** allow-listed host -> live scrape.access block, from profiles with scrape.access.mode === 'jp_proxy'. */
function liveProxySwitches(dirs = LIVE_DIRS) {
  const key = dirs.join('|');
  if (liveCache.key === key && Date.now() - liveCache.at < 60000) return liveCache.map;
  const map = new Map();
  for (const dir of dirs) {
    let slugs = [];
    try { slugs = fs.readdirSync(dir); } catch { continue; }
    for (const slug of slugs) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, slug, 'profile.json'), 'utf8'));
        const a = p && p.scrape && p.scrape.access;
        if (!a || a.mode !== 'jp_proxy') continue;
        const k = allowedKeyFor(noContact.hostOf(p.url));
        if (k && !map.has(k)) map.set(k, { ...a, slug });
      } catch { /* no profile */ }
    }
  }
  liveCache = { at: Date.now(), key, map };
  return map;
}

/** How this URL may be reached. dirs: live profile dirs (tests pass their own). */
function accessFor(url, dirs) {
  const h = url ? noContact.hostOf(String(url)) : '';
  if (!h) return { mode: 'denied', reason: 'no valid URL' };
  const k = allowedKeyFor(h);
  if (k && process.env.BI_PROXY_OFF !== '1') {
    const live = liveProxySwitches(dirs || LIVE_DIRS).get(k);
    if (live) {
      const asked = Number(live.maxPagesPerModule);
      const maxPages = asked > 0 ? Math.min(asked, DEFAULT_MAX_PAGES) : DEFAULT_MAX_PAGES;
      const code = PROXY_ALLOWED_HOSTS[k];
      return { mode: 'jp_proxy', maxPages, authorization: { by: code.authorizedBy, at: code.authorizedAt, reason: code.reason } };
    }
  }
  if (!noContact.hostAllowed(url, dirs)) return { mode: 'denied', reason: noContact.NO_CONTACT_REASON };
  return { mode: 'direct' };
}

/** True when this URL may be fetched at all (directly or via the proxy). */
function reachable(url, dirs) { return accessFor(url, dirs).mode !== 'denied'; }

/** The log line every proxied request writes. */
function proxyLogLine(url, access) {
  const a = (access && access.authorization) || {};
  return `Requesting ${url} via Japanese proxy (authorized ${a.by} ${a.at})`;
}

// ── proxy credentials ──────────────────────────────────────────────────────
let pwPromise = null;
/** Apify proxy password: APIFY_PROXY_PASSWORD, else read once from the Apify account (15s timeout). */
function proxyPassword() {
  if (process.env.APIFY_PROXY_PASSWORD) return Promise.resolve(process.env.APIFY_PROXY_PASSWORD);
  if (!pwPromise) {
    const tok = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
    if (!tok) return Promise.reject(new Error('No APIFY_TOKEN, cannot use the Japanese proxy'));
    pwPromise = fetch('https://api.apify.com/v2/users/me', { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(PASSWORD_TIMEOUT_MS) })
      .then(r => r.json())
      .then(j => {
        const pw = j && j.data && j.data.proxy && j.data.proxy.password;
        if (!pw) throw new Error('Apify account returned no proxy password');
        return pw;
      })
      .catch(e => { pwPromise = null; throw e; });
  }
  return pwPromise;
}

/** Proxy settings for a Playwright browser.launch / newContext / request.newContext. */
async function playwrightProxy() {
  return { server: PROXY_SERVER, username: PROXY_USERNAME, password: await proxyPassword() };
}

// ── page budget and pace, per process (each module is its own process) ─────
const pagesUsed = new Map(); // host -> count
const lastAt = new Map();    // host -> ms
function takePage(url, maxPages) {
  const h = noContact.hostOf(url);
  const n = pagesUsed.get(h) || 0;
  if (n >= maxPages) return false;
  pagesUsed.set(h, n + 1);
  return true;
}
async function pace(url, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  const h = noContact.hostOf(url);
  const wait = (lastAt.get(h) || 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt.set(h, Date.now());
}
function pagesUsedFor(url) { return pagesUsed.get(noContact.hostOf(url)) || 0; }
function _resetForTests() { pagesUsed.clear(); lastAt.clear(); liveCache = { at: 0, key: '', map: new Map() }; pwPromise = null; }

/** Take one proxied page from the budget and wait for the pace. Returns a skip result or null. */
async function spendProxiedPage(url, access, opts) {
  if (!takePage(url, access.maxPages)) return { ok: false, skipped: true, reason: `Page budget for this site reached (${access.maxPages} per module per run)`, via: 'jp_proxy' };
  await pace(url, opts.sleep);
  return null;
}

/**
 * Fetch a URL the way the rules allow. Returns { ok, status, url, text, via } or
 * { ok:false, skipped:true, reason } when the rules (or the page budget) say no request.
 * GET only, read-only. Redirects are followed by hand (at most 5 hops) and every hop is checked with
 * accessFor: a hop whose route differs from the first request's (direct -> denied, direct -> jp_proxy,
 * jp_proxy -> direct) stops the chain. A jp_proxy hop costs one page of the budget and waits for the pace.
 * opts.timeoutMs (default 45s), opts.dirs, opts.requestFactory (test seam:
 * async (proxy|null) => { get(url, {timeout, headers, maxRedirects}) -> { status(), url(), text(), headers() }, dispose() }).
 */
async function fetchPage(url, opts = {}) {
  const access = accessFor(url, opts.dirs);
  if (access.mode === 'denied') return { ok: false, skipped: true, reason: access.reason, via: 'none' };
  if (access.mode === 'jp_proxy') { const skip = await spendProxiedPage(url, access, opts); if (skip) return skip; }
  const proxy = access.mode === 'jp_proxy' ? await playwrightProxy() : null;
  const factory = opts.requestFactory || (async (px) => {
    const { request } = require('playwright');
    return request.newContext({ ...(px ? { proxy: px } : {}), userAgent: UA, extraHTTPHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.5' }, ignoreHTTPSErrors: false });
  });
  const ctx = await factory(proxy);
  try {
    let current = url;
    let res = await ctx.get(current, { timeout: opts.timeoutMs || 45000, maxRedirects: 0 });
    for (let hop = 0; ; hop++) {
      const status = res.status();
      const headers = typeof res.headers === 'function' ? (res.headers() || {}) : {};
      const loc = status >= 300 && status < 400 ? (headers.location || headers.Location) : null;
      if (!loc) break;
      if (hop >= MAX_HOPS) return { ok: false, status, url: current, text: '', via: access.mode, reason: `more than ${MAX_HOPS} redirects` };
      let next;
      try { next = new URL(loc, current).href; } catch { return { ok: false, skipped: true, reason: REDIRECT_REASON, via: access.mode, url: current }; }
      const hopAccess = accessFor(next, opts.dirs);
      if (hopAccess.mode !== access.mode) return { ok: false, skipped: true, reason: REDIRECT_REASON, via: access.mode, url: current, redirectTo: next };
      if (hopAccess.mode === 'jp_proxy') { const skip = await spendProxiedPage(next, hopAccess, opts); if (skip) return skip; }
      current = next;
      res = await ctx.get(current, { timeout: opts.timeoutMs || 45000, maxRedirects: 0 });
    }
    const text = await res.text();
    const status = res.status();
    const blocked = /you have been blocked|Attention Required!/i.test(text.slice(0, 20000));
    const finalUrl = typeof res.url === 'function' ? res.url() : current;
    return { ok: status >= 200 && status < 300 && !blocked, status, url: finalUrl, text, via: access.mode, blocked };
  } finally {
    try { await ctx.dispose(); } catch (_) {}
  }
}

/**
 * Guard every request a Playwright BrowserContext makes (navigations, redirects, subresources).
 * mode 'direct' (default): abort anything accessFor() does not call 'direct', so a direct context never
 * reaches a denied host or a proxy-only host without the proxy. mode 'jp_proxy': abort requests to
 * denied hosts only. data:, blob: and about: URLs make no network request and pass.
 * Returns true when installed, false when the context has no route() (test fakes).
 */
async function guardContext(context, mode = 'direct', opts = {}) {
  if (!context || typeof context.route !== 'function') return false;
  await context.route('**/*', async (route) => {
    let u = '';
    try { u = route.request().url(); } catch (_) {}
    if (/^(data|blob|about):/i.test(u)) return route.continue();
    const m = accessFor(u, opts.dirs).mode;
    const allowed = mode === 'jp_proxy' ? m !== 'denied' : m === 'direct';
    if (allowed) return route.continue();
    if (opts.onBlocked) { try { opts.onBlocked(u, m); } catch (_) {} }
    return route.abort('blockedbyclient');
  });
  return true;
}

module.exports = {
  accessFor, reachable, fetchPage, guardContext, playwrightProxy, proxyPassword, proxyLogLine, pagesUsedFor, takePage, pace,
  PROXY_ALLOWED_HOSTS, PROXY_USERNAME, DEFAULT_MAX_PAGES, REDIRECT_REASON, _LIVE_DIRS: LIVE_DIRS, _resetForTests,
};
