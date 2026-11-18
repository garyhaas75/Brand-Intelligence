/**
 * Social Audit: scrapes Instagram, TikTok, and Facebook (via Apify, with
 * Playwright fallback for Instagram) for the target brand and competitors.
 * Generates 12-month trend data and content gap analysis via Claude.
 *
 * Also covers X (Twitter) via Apify, YouTube via the YouTube Data API v3, and
 * LINE Official Account presence (presence only: LINE has no public post feed).
 * Handles are discovered from the brand site's JSON-LD sameAs links
 * (site_intelligence.json brands[].structuredData.socialLinks) first, then
 * Playwright page scan, then Claude.
 *
 * Usage: node analysis/social_audit.js --slug=<brand-slug> [--target-only] [--dry-run]
 *
 * Environment variables (all optional; every missing key degrades softly):
 *   APIFY_API_TOKEN     Apify token for Instagram, TikTok, Facebook and X scrapes.
 *                       Missing: those platforms record a reason instead of data.
 *   ANTHROPIC_API_KEY   Claude for handle lookup fallback and the analysis prompts.
 *   YOUTUBE_API_KEY     YouTube Data API v3 key for channel stats and recent uploads.
 *                       Missing: youtubeData stays null, youtubeStatus records why.
 *   SOCIAL_DRY_RUN=1    Same as --dry-run: no network for X, YouTube or LINE.
 *                       Those paths only run when a fixture is injected (tests).
 *
 * Depth and spend (2026-11-18): POSTS_ANALYSED (25) posts per platform plus follower counts. Every
 * Apify call first reserves APIFY_EST_USD from utils/apify_budget (cap per run, all modules); after
 * the first refusal the run stops paying and marks the rest budgetSkipped. Order: target, partner,
 * mass, specialty, unclassified, marketplace, niche. The brand's own page is read per
 * utils/site_access (direct, jp_proxy through fetchPage only, or denied).
 */

require('dotenv').config();
const { chromium } = require('playwright');
const { ApifyClient } = require('apify-client');
const { isJapanMarket } = require('../utils/market');
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL_DEEP, MODEL_FAST, EFFORT_LOW, extractText } = require('../utils/models');
const fs = require('fs');
const path = require('path');
const checkpoint = require('../utils/checkpoint');
const apifyBudget = require('../utils/apify_budget');
const siteAccessDefault = require('../utils/site_access');
const { normTier, normRelationship } = require('../utils/players');

const DATA_DIR = path.join(__dirname, '../data');
// v2 (2026-11-18): 25 posts per platform plus follower counts. A v1 checkpoint held 5 posts and no
// followers, so it must never be reused as if it were v2: the step name carries the version.
const CHECKPOINT_STEP = 'social-v2';

// Depth: posts analysed per platform, and how many of those get their image saved for the dashboard.
const POSTS_ANALYSED = 25;
const POSTS_WITH_IMAGES = 5;

/**
 * Apify cost estimate per account per platform (USD), reserved before the call. The ledger records
 * the real usageTotalUsd afterwards, so these only decide whether a call may start.
 *   instagram: profile scraper (followers, ~$0.003) + instagram-scraper 25 posts (~$2.70/1000 = $0.07)
 *              + two actor starts (~$0.02 each) = ~$0.11, reserved as $0.12
 *   tiktok:    clockworks/tiktok-scraper 25 posts (~$5/1000 = $0.125) + start = ~$0.15
 *   facebook:  apify/facebook-posts-scraper 25 posts (~$5/1000 = $0.125) + start = ~$0.15
 *   x:         apidojo/tweet-scraper 30 tweets (~$0.40/1000) + minimum charge and start = ~$0.05
 * YouTube (Data API) and LINE (public page) cost no Apify money and are never gated.
 */
const APIFY_EST_USD = { instagram: 0.12, tiktok: 0.15, facebook: 0.15, x: 0.05 };

/**
 * Official accounts read from the brand's own site footer. They outrank the profile (which held a
 * wrong Facebook page, ToysRUsJapan) and are written back to profile.json as a correction.
 */
const OFFICIAL_HANDLES = {
  'toysrus.co.jp': {
    checkedAt: '2026-11-18',
    source: 'toysrus.co.jp site footer',
    instagram: 'toysrus_jp',
    facebook: 'toysrusjp',
    x: 'toysrus_jp',
    tiktok: 'toysrus_japan',
    youtube: 'https://www.youtube.com/user/ToysrusJPN',
    line: '@toysrus_jp',
  },
};

// Marketplace category pages have no brand-level toy account. Used when a player has no tier yet.
const MARKETPLACE_HOSTS = ['amazon.co.jp', 'amazon.com', 'rakuten.co.jp', 'shopping.yahoo.co.jp', 'yahoo.co.jp', 'mercari.com', 'jp.mercari.com'];
const NO_BRAND_ACCOUNT_REASON = 'No brand-level toy account: a marketplace toy category, not a brand. Set a handle in the profile to scrape one.';

function hostOfUrl(u) {
  const p = parseUrlLoose(u);
  return p ? p.hostname.toLowerCase().replace(/^www\./, '') : null;
}
function officialHandlesFor(url) {
  const h = hostOfUrl(url);
  if (!h) return null;
  for (const [host, v] of Object.entries(OFFICIAL_HANDLES)) if (h === host || h.endsWith('.' + host)) return v;
  return null;
}
function isMarketplacePlayer(b) {
  if (!b) return false;
  if (b.tier === 'marketplace') return true;
  if (b.tier && b.tier !== 'unknown') return false;
  const h = hostOfUrl(b.url);
  return !!h && MARKETPLACE_HOSTS.some(m => h === m || h.endsWith('.' + m));
}

function log(msg) { console.log(`[social_audit] [${new Date().toISOString()}] ${msg}`); }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function writeAuditStatus(slug, update, dataDir = DATA_DIR) {
  try {
    const statusPath = path.join(dataDir, 'brands', slug, '_audit_status.json');
    fs.writeFileSync(statusPath, JSON.stringify({ ...update, updatedAt: new Date().toISOString() }));
  } catch {}
}

// Download post images immediately after scraping (CDN URLs are IP/time-bound, must fetch right away)
async function downloadPostImages(slug, posts, prefix = 'post', dataDir = DATA_DIR) {
  if (!posts || posts.length === 0) return posts;
  const imgDir = path.join(dataDir, 'brands', slug, 'social_images');
  ensureDir(imgDir);
  const updated = await Promise.all(posts.map(async (post, idx) => {
    if (!post.imageUrl || post.imageUrl.startsWith('/')) return post; // already local
    try {
      const res = await fetch(post.imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return post;
      const buf = await res.arrayBuffer();
      const ext = (res.headers.get('content-type') || '').includes('webp') ? 'webp' : 'jpg';
      const filename = `${prefix}_${idx}.${ext}`;
      fs.writeFileSync(path.join(imgDir, filename), Buffer.from(buf));
      return { ...post, imageUrl: `/api/social-image/${slug}/${filename}` };
    } catch { return post; }
  }));
  const saved = updated.filter(p => p.imageUrl?.startsWith('/api/')).length;
  if (saved > 0) log(`  Downloaded ${saved}/${posts.length} post images for ${slug}`);
  return updated;
}

/**
 * Pure. Top posts get the saved image of the same post when it is among the newest (originals[i] ->
 * downloaded[i]); otherwise they keep the platform's imageUrl. No download here.
 */
function reuseDownloadedImages(topPosts, originals, downloaded) {
  return (topPosts || []).map(tp => {
    const i = (originals || []).indexOf(tp);
    return i >= 0 && downloaded && downloaded[i] ? { ...tp, imageUrl: downloaded[i].imageUrl } : tp;
  });
}

function loadBrandData(slug, filename, dataDir = DATA_DIR) {
  const fp = path.join(dataDir, 'brands', slug, filename);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function loadSocialCookies() {
  const cookiePath = path.join(DATA_DIR, 'social_cookies.json');
  try { return JSON.parse(fs.readFileSync(cookiePath, 'utf8')); } catch { return {}; }
}

function saveBrandData(slug, filename, data, dataDir = DATA_DIR) {
  ensureDir(path.join(dataDir, 'brands', slug));
  fs.writeFileSync(path.join(dataDir, 'brands', slug, filename), JSON.stringify(data, null, 2));
}

function archiveData(slug, module, data, dataDir = DATA_DIR) {
  const histDir = path.join(dataDir, 'brands', slug, 'history');
  ensureDir(histDir);
  const ts = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(histDir, `${module}_${ts}.json`), JSON.stringify(data, null, 2));
}

// ─── Structured-data handle classification ───────────────────────────────────

// Path segments that are site features, never an account handle.
const RESERVED_SEGMENTS = {
  instagram: ['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'share', 'sharedaction', 'oauth', 'direct'],
  facebook: ['sharer', 'sharer.php', 'share', 'share.php', 'dialog', 'plugins', 'tr', 'login', 'policy', 'help', 'groups', 'events', 'photo', 'photo.php', 'video', 'watch', 'pages', 'hashtag', 'people'],
  x: ['intent', 'share', 'home', 'i', 'hashtag', 'search', 'explore', 'login', 'signup', 'settings', 'privacy', 'tos', 'messages', 'notifications'],
  youtube: ['watch', 'embed', 'shorts', 'playlist', 'results', 'feed', 'redirect', 'about', 'account', 'live'],
};

function emptySocialLinks() {
  return { instagram: null, tiktok: null, facebook: null, x: null, youtube: null, line: null, unknown: [] };
}

function parseUrlLoose(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('//')) s = 'https:' + s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s); } catch { return null; }
}

// Classify one URL into { platform, ...ref } or null when it is not a recognisable account link.
function classifySocialUrl(raw) {
  const u = parseUrlLoose(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
  const segs = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  const first = (segs[0] || '');
  const firstLc = first.toLowerCase();

  if (host === 'instagram.com' || host === 'instagr.am') {
    if (first && !RESERVED_SEGMENTS.instagram.includes(firstLc) && /^[A-Za-z0-9_.]{1,30}$/.test(first)) return { platform: 'instagram', handle: first };
    return null;
  }
  if (host === 'tiktok.com') {
    const m = first.match(/^@([A-Za-z0-9_.]{2,30})$/);
    return m ? { platform: 'tiktok', handle: m[1] } : null;
  }
  if (host === 'facebook.com' || host === 'fb.com' || host === 'fb.me') {
    if (firstLc === 'profile.php' && u.searchParams.get('id')) return { platform: 'facebook', handle: `profile.php?id=${u.searchParams.get('id')}` };
    if (firstLc === 'pages' && segs.length >= 3 && /^\d+$/.test(segs[2])) return { platform: 'facebook', handle: segs[2] };
    if (first && !RESERVED_SEGMENTS.facebook.includes(firstLc) && /^[A-Za-z0-9.\-]{3,80}$/.test(first)) return { platform: 'facebook', handle: first };
    return null;
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const h = first.replace(/^@/, '');
    if (h && !RESERVED_SEGMENTS.x.includes(h.toLowerCase()) && /^[A-Za-z0-9_]{1,15}$/.test(h)) return { platform: 'x', handle: h };
    return null;
  }
  if (host === 'youtube.com' || host === 'youtube.jp') {
    const url = `https://www.youtube.com/${segs.slice(0, 2).join('/')}`;
    if (first.startsWith('@') && first.length > 1) return { platform: 'youtube', kind: 'handle', id: first.slice(1), url: `https://www.youtube.com/${first}` };
    if (firstLc === 'channel' && segs[1]) return { platform: 'youtube', kind: 'channel', id: segs[1], url };
    if (firstLc === 'c' && segs[1]) return { platform: 'youtube', kind: 'custom', id: segs[1], url };
    if (firstLc === 'user' && segs[1]) return { platform: 'youtube', kind: 'user', id: segs[1], url };
    // Legacy vanity URL: youtube.com/<name>
    if (first && segs.length === 1 && !RESERVED_SEGMENTS.youtube.includes(firstLc)) return { platform: 'youtube', kind: 'custom', id: first, url: `https://www.youtube.com/${first}` };
    return null;
  }
  if (host === 'lin.ee') {
    return first ? { platform: 'line', kind: 'short', id: null, url: `https://lin.ee/${first}` } : null;
  }
  if (host === 'line.me' || host === 'page.line.me' || host === 'liff.line.me') {
    if (host === 'page.line.me') {
      const id = (first || u.searchParams.get('searchId') || '').replace(/^@/, '');
      return id ? { platform: 'line', kind: 'oa', id: `@${id}`, url: `https://page.line.me/${id}` } : null;
    }
    // line.me/R/ti/p/@id, line.me/ti/p/@id, line.me/R/ti/p/%40id
    const tiIdx = segs.findIndex((s, i) => s.toLowerCase() === 'ti' && (segs[i + 1] || '').toLowerCase() === 'p');
    if (tiIdx !== -1 && segs[tiIdx + 2]) {
      const raw = segs[tiIdx + 2];
      if (raw.startsWith('@')) return { platform: 'line', kind: 'oa', id: raw, url: `https://line.me/R/ti/p/${raw}` };
      return null; // ~userid links are personal accounts, not an Official Account
    }
    return null;
  }
  return null;
}

/**
 * Pure: classify a list of URLs (typically JSON-LD sameAs) into per-platform handles.
 * First match per platform wins. Non-social or unparseable URLs go to unknown[].
 * Returns { instagram, tiktok, facebook, x: string|null, youtube: {kind,id,url}|null,
 *           line: {kind,id,url}|null, unknown: string[] }
 */
function classifySocialLinks(urls) {
  const out = emptySocialLinks();
  for (const raw of [].concat(urls || [])) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const hit = classifySocialUrl(raw);
    if (!hit) { out.unknown.push(raw); continue; }
    if (out[hit.platform]) continue;
    if (hit.platform === 'youtube' || hit.platform === 'line') {
      const { platform, ...ref } = hit;
      out[platform] = ref;
    } else {
      out[hit.platform] = hit.handle;
    }
  }
  return out;
}

// Accept a stored YouTube / LINE reference as a URL, '@handle', or a bare id.
function toYouTubeRef(v) {
  if (!v) return null;
  if (typeof v === 'object' && v.id) return v;
  const s = String(v).trim();
  if (/youtube\./i.test(s)) return classifySocialLinks([s]).youtube;
  if (s.startsWith('@')) return { kind: 'handle', id: s.slice(1), url: `https://www.youtube.com/${s}` };
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(s)) return { kind: 'channel', id: s, url: `https://www.youtube.com/channel/${s}` };
  return { kind: 'handle', id: s, url: `https://www.youtube.com/@${s}` };
}

function toLineRef(v) {
  if (!v) return null;
  if (typeof v === 'object' && (v.id || v.url)) return v;
  const s = String(v).trim();
  if (/line\.me|lin\.ee/i.test(s)) return classifySocialLinks([s]).line;
  const id = s.startsWith('@') ? s : `@${s}`;
  return { kind: 'oa', id, url: `https://line.me/R/ti/p/${id}` };
}

function youTubeRefToString(ref) { return ref ? ref.url || null : null; }
function lineRefToString(ref) { return ref ? ref.id || ref.url || null : null; }

// Find this brand's structured-data social links in the target's site_intelligence.json.
function findStructuredSocialLinks(siteIntel, brand) {
  const list = Array.isArray(siteIntel?.brands) ? siteIntel.brands : [];
  const hostOf = u => { const p = parseUrlLoose(u); return p ? p.hostname.toLowerCase().replace(/^www\./, '') : null; };
  const bHost = hostOf(brand.url);
  const match = list.find(b => (brand.slug && b.id === brand.slug))
    || list.find(b => b.name && brand.name && b.name.toLowerCase() === brand.name.toLowerCase())
    || (bHost ? list.find(b => hostOf(b.url) === bHost) : null)
    || (brand.role === 'target' ? list.find(b => b.role === 'target') : null);
  const links = match?.structuredData?.socialLinks;
  return Array.isArray(links) ? links : [];
}

// Truncate by code points so Japanese text and emoji are never split mid-character.
function truncateChars(s, n) {
  const arr = Array.from(String(s || ''));
  return arr.length > n ? arr.slice(0, n).join('') : arr.join('');
}

function isDryRun(opts) {
  return !!(opts && opts.dryRun) || process.env.SOCIAL_DRY_RUN === '1';
}

function loadFixture(fixture) {
  if (!fixture) return null;
  if (typeof fixture === 'string') return JSON.parse(fs.readFileSync(fixture, 'utf8'));
  return fixture;
}

// ─── Handle Detection ─────────────────────────────────────────────────────────

// The Playwright detectors below request a page DIRECTLY, so each keeps the no_contact.hostAllowed
// gate: it is false for a denied host and for a jp_proxy host alike (utils/site_access.js). A jp_proxy
// site is read once through site_access.fetchPage instead (scanPageViaFetch), never by Playwright.
/** Pure: every href in an HTML string, made absolute against base. */
function extractHrefs(html, base) {
  const out = [];
  for (const m of String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try { out.push(new URL(m[1].replace(/&amp;/g, '&'), base).href); } catch { /* not a URL */ }
  }
  return out;
}

/**
 * Handle scan for a site reachable only through the Japanese proxy: one fetchPage call (it routes
 * through the proxy and enforces the page budget), never Playwright. Returns classified links.
 */
const proxyScanCache = new Map(); // url -> Promise<links>: one proxied page per process (page budget is 8)
function scanPageViaFetch(brandUrl, siteAccess = siteAccessDefault) {
  if (siteAccess === siteAccessDefault && proxyScanCache.has(brandUrl)) return proxyScanCache.get(brandUrl);
  const p = scanPageViaFetchOnce(brandUrl, siteAccess);
  if (siteAccess === siteAccessDefault) proxyScanCache.set(brandUrl, p);
  return p;
}
async function scanPageViaFetchOnce(brandUrl, siteAccess) {
  try {
    const acc = siteAccess.accessFor(brandUrl);
    if (acc.mode === 'denied') return emptySocialLinks();
    if (acc.mode === 'jp_proxy') log(`  Requesting ${brandUrl} via Japanese proxy (authorized ${acc.authorization?.by || 'unknown'} ${acc.authorization?.at || ''})`);
    const r = await siteAccess.fetchPage(brandUrl);
    if (!r || !r.ok) { log(`  Page scan via ${r?.via || 'fetchPage'} skipped for ${brandUrl}: ${r?.reason || (r?.blocked ? 'block page' : `HTTP ${r?.status}`)}`); return emptySocialLinks(); }
    return classifySocialLinks(extractHrefs(r.text, r.url || brandUrl));
  } catch (err) {
    log(`  Page scan via fetchPage failed for ${brandUrl}: ${err.message}`);
    return emptySocialLinks();
  }
}

// A page in a fresh context whose every request (redirects, subresources) is checked by
// utils/site_access.js: a hop to a denied or proxy-only host is aborted, never loaded directly.
async function guardedPage(browser) {
  const context = await browser.newContext();
  await siteAccessDefault.guardContext(context);
  return context.newPage();
}

// One page load, every anchor classified. Used for X, YouTube and LINE when
// neither the profile nor the structured data supplied them.
async function detectHandlesFromPage(brandUrl) {
  if (!require('../utils/no_contact').hostAllowed(brandUrl)) return emptySocialLinks();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await guardedPage(browser);
  try {
    await page.goto(brandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const links = await page.$$eval('a[href]', anchors => anchors.map(a => a.href)).catch(() => []);
    return classifySocialLinks(links);
  } catch { return emptySocialLinks(); }
  finally { await browser.close(); }
}

async function detectInstagramHandle(brandUrl) {
  if (!require('../utils/no_contact').hostAllowed(brandUrl)) return null;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await guardedPage(browser);
  try {
    await page.goto(brandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const links = await page.$$eval('a[href*="instagram.com"]', anchors => anchors.map(a => a.href));
    if (links.length > 0) {
      const match = links[0].match(/instagram\.com\/([^/?#\s]+)/);
      if (match && match[1] !== 'p' && match[1] !== 'explore') return match[1];
    }
    const html = await page.content();
    const igMatches = [...html.matchAll(/instagram\.com\/([a-zA-Z0-9_.]{2,30})[^a-zA-Z0-9_.]/g)];
    const filtered = igMatches
      .map(m => m[1])
      .filter(h => !['p', 'explore', 'accounts', 'stories', 'reel', 'tv', 'share', 'sharedAction', 'oauth'].includes(h));
    if (filtered.length > 0) return filtered[0];
    const origin = new URL(brandUrl).origin;
    for (const subpath of ['/about', '/contact', '/about-us']) {
      try {
        await page.goto(origin + subpath, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const aboutLinks = await page.$$eval('a[href*="instagram.com"]', anchors => anchors.map(a => a.href)).catch(() => []);
        if (aboutLinks.length > 0) {
          const match = aboutLinks[0].match(/instagram\.com\/([^/?#\s]+)/);
          if (match && !['p', 'explore', 'accounts'].includes(match[1])) return match[1];
        }
      } catch { /* page doesn't exist, skip */ }
    }
    return null;
  } catch { return null; }
  finally { await browser.close(); }
}

async function detectTikTokHandle(brandUrl) {
  if (!require('../utils/no_contact').hostAllowed(brandUrl)) return null;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await guardedPage(browser);
  try {
    await page.goto(brandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const links = await page.$$eval('a[href*="tiktok.com"]', anchors => anchors.map(a => a.href)).catch(() => []);
    for (const link of links) {
      const match = link.match(/tiktok\.com\/@([a-zA-Z0-9_.]{2,30})/);
      if (match) return match[1];
    }
    const html = await page.content();
    const m = html.match(/tiktok\.com\/@([a-zA-Z0-9_.]{2,30})/);
    if (m) return m[1];
    return null;
  } catch { return null; }
  finally { await browser.close(); }
}

async function detectFacebookHandle(brandUrl) {
  if (!require('../utils/no_contact').hostAllowed(brandUrl)) return null;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await guardedPage(browser);
  try {
    await page.goto(brandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const links = await page.$$eval('a[href*="facebook.com"]', anchors => anchors.map(a => a.href)).catch(() => []);
    const blocked = ['sharer', 'share', 'dialog', 'plugins', 'tr', 'login', 'policy', 'help', 'groups', 'events', 'photo', 'video'];
    for (const link of links) {
      const match = link.match(/facebook\.com\/([a-zA-Z0-9.]+)(?:[/?#]|$)/);
      if (match && !blocked.includes(match[1]) && match[1].length >= 3) return match[1];
    }
    const html = await page.content();
    const m = html.match(/facebook\.com\/([a-zA-Z0-9.]{3,50})(?:[/?#"'])/);
    if (m && !blocked.includes(m[1])) return m[1];
    return null;
  } catch { return null; }
  finally { await browser.close(); }
}

// ─── Claude-Based Handle Lookup (fallback when Playwright finds nothing) ─────

// Pure. Non-Japan brands get the legacy prompt byte for byte (Instagram, TikTok, Facebook only);
// Japan brands also ask for X, YouTube and LINE.
function buildHandleLookupPrompt(brandName, brandUrl, market, japan) {
  if (!japan) {
    return `What are the official social media handles for this brand?

Brand: ${brandName}
Website: ${brandUrl}
Market: ${market || 'Lebanon'}

Return ONLY a JSON object (no explanation):
{"instagram": "handle_without_@_or_null", "tiktok": "handle_without_@_or_null", "facebook": "page_name_or_null"}

Only include handles you are highly confident are correct. Use null if unsure. Do not include @ symbols.`;
  }
  return `What are the official social media handles for this brand?

Brand: ${brandName}
Website: ${brandUrl}
Market: ${market || 'the local market'}

Return ONLY a JSON object (no explanation):
{"instagram": "handle_without_@_or_null", "tiktok": "handle_without_@_or_null", "facebook": "page_name_or_null", "x": "x_twitter_handle_without_@_or_null", "youtube": "full_youtube_channel_url_or_null", "line": "line_official_account_id_like_@abc123_or_null"}

Only include handles you are highly confident are correct. Use null if unsure. Do not include @ symbols except in the LINE id.`;
}

async function lookupHandlesViaClaude(anthropic, brandName, brandUrl, market, japan = true) {
  if (!anthropic) return {};
  try {
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 2500,
      output_config: EFFORT_LOW,
      messages: [{
        role: 'user',
        content: buildHandleLookupPrompt(brandName, brandUrl, market, japan),
      }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (japan) log(`  Claude handle lookup for ${brandName}: IG=${parsed.instagram || 'null'}, TT=${parsed.tiktok || 'null'}, FB=${parsed.facebook || 'null'}, X=${parsed.x || 'null'}, YT=${parsed.youtube || 'null'}, LINE=${parsed.line || 'null'}`);
      else log(`  Claude handle lookup for ${brandName}: IG=${parsed.instagram || 'null'}, TT=${parsed.tiktok || 'null'}, FB=${parsed.facebook || 'null'}`);
      return parsed;
    }
  } catch (err) { log(`  Claude handle lookup failed for ${brandName}: ${err.message}`); }
  return {};
}

// ─── Platform Scrapers ────────────────────────────────────────────────────────

/**
 * Apify call context. processBrand reserves the budget for a platform step, then hands the real
 * scraper this object: callOptions() gives the hard charge ceiling plus maxItems, onRun() collects
 * every actor run so the step records its true cost once. Without a grant (no budget configured)
 * it only passes maxItems through.
 */
function apifyContext(grant, budgetMod) {
  const runs = [];
  return {
    runs,
    callOptions: (extra = {}) => (grant && budgetMod ? budgetMod.callOptions(grant, extra) : { ...extra }),
    onRun: (run) => { if (run) runs.push(run); },
  };
}
function noCtx() { return apifyContext(null, null); }

/** Pure: one run-like record for the budget ledger from every actor run in a step. */
function combineRuns(runs) {
  const list = (runs || []).filter(Boolean);
  if (!list.length) return null;
  const usages = list.map(r => Number(r.usageTotalUsd));
  const known = usages.every(Number.isFinite);
  return { id: list.map(r => r.id).filter(Boolean).join(',') || null, ...(known ? { usageTotalUsd: usages.reduce((a, b) => a + b, 0) } : {}) };
}

/**
 * Instagram: the profile scraper first (followers, post count, up to 12 latest posts; costs a
 * fraction of a cent), then the post scraper for POSTS_ANALYSED posts. Returns
 * { posts: raw[], followers, postsCount }. Throws when the token is missing or the post run fails.
 */
async function scrapeInstagramViaApify(handle, apify = noCtx()) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  let profile = null;
  try {
    log(`  Instagram @${handle}: profile (followers) via apify/instagram-profile-scraper...`);
    const pr = await client.actor('apify/instagram-profile-scraper').call({ usernames: [handle] }, apify.callOptions({ maxItems: 1 }));
    apify.onRun(pr);
    const { items } = await client.dataset(pr.defaultDatasetId).listItems({ limit: 1 });
    profile = items[0] || null;
  } catch (err) { log(`  Instagram profile scrape failed for @${handle}: ${err.message}`); }

  log(`  Scraping Instagram @${handle} via Apify (${POSTS_ANALYSED} posts)...`);
  const cookies = loadSocialCookies();
  const igInput = { directUrls: [`https://www.instagram.com/${handle}/`], resultsType: 'posts', resultsLimit: POSTS_ANALYSED };
  if (cookies.instagram && cookies.instagram.length > 0) {
    igInput.loginCookies = cookies.instagram;
    log(`  Using ${cookies.instagram.length} session cookies for Instagram @${handle}`);
  }
  const run = await client.actor('apify/instagram-scraper').call(igInput, apify.callOptions({ maxItems: POSTS_ANALYSED }));
  apify.onRun(run);
  log(`  Apify run status: ${run.status}, datasetId: ${run.defaultDatasetId}`);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: POSTS_ANALYSED + 5 });
  log(`  Apify returned ${items.length} items`);
  const posts = items.filter(item =>
    item.type === 'Image' || item.type === 'Video' || item.type === 'Sidecar' ||
    item.shortCode || item.timestamp || item.taken_at_timestamp
  );
  // Restricted profile response: one profile object with latestPosts[]
  const restrictedPosts = items
    .filter(item => item.isRestrictedProfile && Array.isArray(item.latestPosts))
    .flatMap(item => item.latestPosts);
  let allPosts = [...posts, ...restrictedPosts];
  if (!allPosts.length && Array.isArray(profile?.latestPosts) && profile.latestPosts.length) {
    log(`  Post scraper returned nothing for @${handle}: using ${profile.latestPosts.length} latestPosts from the profile scrape`);
    allPosts = profile.latestPosts;
  }
  log(`  ${allPosts.length} valid Instagram posts for @${handle}`);
  const followers = profile ? (profile.followersCount ?? profile.followers ?? null) : null;
  return { posts: allPosts, followers: typeof followers === 'number' ? followers : null, postsCount: profile?.postsCount ?? profile?.mediaCount ?? null };
}

async function scrapeInstagramFallback(handle) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await siteAccessDefault.guardContext(context);
  const page = await context.newPage();
  try {
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const bio = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
    const title = await page.title().catch(() => '');
    const postCountMatch = bio.match(/([\d,]+)\s+posts?/i) || title.match(/([\d,]+)\s+posts?/i);
    const followerMatch = bio.match(/([\d,.KMk]+)\s+followers?/i);
    return {
      partialData: true,
      bio,
      estimatedPostCount: postCountMatch ? parseInt(postCountMatch[1].replace(/,/g, '')) : null,
      estimatedFollowers: followerMatch ? followerMatch[1] : null,
    };
  } catch (err) {
    return { error: err.message, partialData: true };
  } finally {
    await browser.close();
  }
}

async function scrapeTikTokViaApify(handle, apify = noCtx()) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Scraping TikTok @${handle} via Apify...`);
  const run = await client.actor('clockworks/tiktok-scraper').call({
    profiles: [`https://www.tiktok.com/@${handle}`],
    resultsPerPage: POSTS_ANALYSED,
  }, apify.callOptions({ maxItems: POSTS_ANALYSED }));
  apify.onRun(run);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: POSTS_ANALYSED });
  const posts = items.filter(item => item.diggCount !== undefined || item.text || item.createTime);
  log(`  ${posts.length} TikTok posts for @${handle}`);
  return posts; // followers ride on each item as authorMeta.fans
}

async function scrapeFacebookViaApify(handle, apify = noCtx()) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Scraping Facebook /${handle} via Apify (facebook-posts-scraper)...`);
  const fbCookies = loadSocialCookies();
  const fbInput = { startUrls: [{ url: `https://www.facebook.com/${handle}` }], resultsLimit: POSTS_ANALYSED };
  if (fbCookies.facebook && fbCookies.facebook.length > 0) {
    fbInput.cookies = fbCookies.facebook;
    log(`  Using ${fbCookies.facebook.length} session cookies for Facebook /${handle}`);
  }
  const run = await client.actor('apify/facebook-posts-scraper').call(fbInput, apify.callOptions({ maxItems: POSTS_ANALYSED }));
  apify.onRun(run);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: POSTS_ANALYSED + 10 });
  const posts = items.filter(item => item.message || item.text || item.story || item.postId);
  log(`  ${posts.length} Facebook posts for /${handle}`);
  return posts;
}

/** Pure: page followers from Facebook post items, when the actor includes them. Else null. */
function facebookFollowersFrom(items) {
  for (const p of Array.isArray(items) ? items : []) {
    const v = p?.pageFollowers ?? p?.user?.followers ?? p?.pageLikes ?? p?.page?.followers ?? p?.page?.likes;
    if (typeof v === 'number' && v > 0) return v;
  }
  return null;
}

/** Pure: a scraper may return a raw array (older seams) or { posts, followers, postsCount }. */
function toScrapeResult(v) {
  if (Array.isArray(v)) return { posts: v, followers: null, postsCount: null };
  if (v && typeof v === 'object') return { posts: Array.isArray(v.posts) ? v.posts : [], followers: typeof v.followers === 'number' ? v.followers : null, postsCount: v.postsCount ?? null };
  return { posts: [], followers: null, postsCount: null };
}


// ─── X (Twitter) via Apify ───────────────────────────────────────────────────
// Actor: apidojo/tweet-scraper ("Tweet Scraper V2" by API Dojo), the most widely
// used pay-per-result X scraper on the Apify store. Output items carry text,
// createdAt, likeCount, replyCount, retweetCount, quoteCount, viewCount, url.
const X_ACTOR_ID = 'apidojo/tweet-scraper';

/**
 * Returns { posts: rawTweets[], reason: string|null, source }. Never throws.
 * Raw tweets go through normalizePosts(posts, 'x') like every other platform.
 * opts.fixture: array of actor output items (or a path to one) for offline runs.
 */
/**
 * Pure: does this actor run say the account does not exist? Observed in run 1 (2026-11-16):
 * the actor logs "ERROR C017. User: <handle> not found" and returns no tweets. The marker can
 * also arrive as a dataset item carrying an error string. Returns true only on an explicit
 * not-found marker; an empty dataset alone is not proof (the account may simply be quiet).
 */
function isXHandleNotFound(items, logText, handle) {
  const clean = String(handle || '').replace(/^@/, '').toLowerCase();
  const texts = [String(logText || '')];
  for (const t of Array.isArray(items) ? items : []) {
    if (t && typeof t === 'object') texts.push([t.error, t.errorMessage, t.message, t.errorDescription].filter(v => typeof v === 'string').join(' '));
  }
  return texts.some(txt => {
    if (/\bC017\b/.test(txt)) return true;
    const m = txt.match(/User:?\s*@?([A-Za-z0-9_]{1,15})\s+not found/i);
    return !!(m && (!clean || m[1].toLowerCase() === clean));
  });
}

/**
 * Returns { posts: rawTweets[], followers, reason, source, notFound }. Never throws.
 * A not-found result is final: no retry and no second actor run.
 * opts.fixture: actor output items, or { items, log } to include the run log text.
 */
async function scrapeXViaApify(handle, opts = {}) {
  const clean = String(handle || '').replace(/^@/, '');
  if (!clean) return { posts: [], reason: 'No X handle', source: null, notFound: false };
  let items;
  let logText = '';
  try {
    if (opts.fixture) {
      const fx = loadFixture(opts.fixture);
      if (Array.isArray(fx)) items = fx;
      else { items = fx?.items || []; logText = fx?.log || ''; }
    } else if (isDryRun(opts)) {
      return { posts: [], reason: 'Dry run: X scrape skipped', source: null, notFound: false };
    } else if (!process.env.APIFY_API_TOKEN) {
      return { posts: [], reason: 'APIFY_API_TOKEN not set: X scrape skipped', source: null, notFound: false };
    } else {
      const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
      log(`  Scraping X @${clean} via Apify (${X_ACTOR_ID})...`);
      const apify = opts.apify || noCtx();
      const run = await client.actor(X_ACTOR_ID).call({ twitterHandles: [clean], maxItems: POSTS_ANALYSED + 5, sort: 'Latest' }, apify.callOptions({ maxItems: POSTS_ANALYSED + 5 }));
      apify.onRun(run);
      ({ items } = await client.dataset(run.defaultDatasetId).listItems({ limit: POSTS_ANALYSED + 5 }));
      // The not-found marker only appears in the run log. Reading the log is free; best effort.
      const hasPosts = (items || []).some(t => t && (t.text || t.fullText));
      if (!hasPosts && run?.id) {
        try { logText = String(await client.log(run.id).get() || ''); } catch { logText = ''; }
      }
    }
  } catch (err) {
    if (isXHandleNotFound([], err.message, clean)) {
      return { posts: [], followers: null, reason: `X account @${clean} not found`, source: X_ACTOR_ID, notFound: true };
    }
    return { posts: [], reason: `X scrape failed: ${err.message}`, source: X_ACTOR_ID, notFound: false };
  }
  const source = opts.fixture ? 'fixture' : X_ACTOR_ID;
  const posts = (Array.isArray(items) ? items : [])
    .filter(t => t && !t.noResults && (t.text || t.fullText) && (t.createdAt || t.created_at))
    .filter(t => !t.isRetweet && !t.retweeted_tweet);
  const followers = (Array.isArray(items) ? items : []).map(t => t?.author?.followers).find(n => typeof n === 'number') ?? null;
  if (!posts.length && isXHandleNotFound(items, logText, clean)) {
    log(`  X @${clean}: account not found (no retry)`);
    return { posts: [], followers: null, reason: `X account @${clean} not found`, source, notFound: true };
  }
  log(`  ${posts.length} X posts for @${clean}`);
  return { posts, followers, reason: posts.length ? null : 'X scrape returned no original posts', source, notFound: false };
}

// ─── YouTube Data API v3 ─────────────────────────────────────────────────────

const YT_API = 'https://www.googleapis.com/youtube/v3';

// Fixture fetch: routes by endpoint name (channels, search, playlistItems, videos).
function fixtureFetch(fixture) {
  const data = loadFixture(fixture);
  return async (url) => {
    const endpoint = new URL(url).pathname.split('/').pop();
    const body = data[endpoint];
    if (!body) return { ok: false, status: 404, json: async () => ({ error: { message: `no fixture for ${endpoint}` } }) };
    return { ok: true, status: 200, json: async () => body };
  };
}

/**
 * Returns { channel: {...}|null, posts: rawVideos[], reason: string|null, source }. Never throws.
 * ref: { kind: 'handle'|'channel'|'user'|'custom', id } (see classifySocialLinks).
 * opts.fixture: { channels, search?, playlistItems, videos } API response bodies.
 */
async function fetchYouTubeChannel(ref, opts = {}) {
  ref = toYouTubeRef(ref);
  if (!ref) return { channel: null, posts: [], reason: 'No YouTube channel', source: null };
  let fetchImpl; let apiKey;
  if (opts.fixture) { fetchImpl = fixtureFetch(opts.fixture); apiKey = 'fixture'; }
  else if (isDryRun(opts)) return { channel: null, posts: [], reason: 'Dry run: YouTube fetch skipped', source: null };
  else {
    apiKey = opts.apiKey || process.env.YOUTUBE_API_KEY;
    if (!apiKey) return { channel: null, posts: [], reason: 'YOUTUBE_API_KEY not set: YouTube skipped', source: null };
    fetchImpl = opts.fetchImpl || fetch;
  }

  const get = async (endpoint, params) => {
    const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
    const res = await fetchImpl(`${YT_API}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    // Never echo the URL: it carries the API key.
    if (!res.ok) throw new Error(`YouTube ${endpoint} HTTP ${res.status}${body?.error?.message ? ': ' + body.error.message : ''}`);
    return body;
  };

  try {
    const part = 'snippet,statistics,contentDetails';
    let chRes;
    if (ref.kind === 'channel') chRes = await get('channels', { part, id: ref.id });
    else if (ref.kind === 'user') chRes = await get('channels', { part, forUsername: ref.id });
    else if (ref.kind === 'handle') chRes = await get('channels', { part, forHandle: '@' + ref.id });
    else {
      // Legacy /c/ custom URLs have no direct lookup: resolve via search (100 quota units).
      const s = await get('search', { part: 'snippet', type: 'channel', q: ref.id, maxResults: '1' });
      const cid = s?.items?.[0]?.id?.channelId || s?.items?.[0]?.snippet?.channelId;
      if (!cid) return { channel: null, posts: [], reason: `YouTube channel not found for ${ref.id}`, source: 'youtube-data-api' };
      chRes = await get('channels', { part, id: cid });
    }
    const ch = chRes?.items?.[0];
    if (!ch) return { channel: null, posts: [], reason: `YouTube channel not found for ${ref.kind} ${ref.id}`, source: 'youtube-data-api' };
    const st = ch.statistics || {};
    const channel = {
      id: ch.id,
      title: ch.snippet?.title || null,
      customUrl: ch.snippet?.customUrl || null,
      country: ch.snippet?.country || null,
      subscriberCount: st.hiddenSubscriberCount ? null : (st.subscriberCount != null ? Number(st.subscriberCount) : null),
      hiddenSubscriberCount: !!st.hiddenSubscriberCount,
      videoCount: st.videoCount != null ? Number(st.videoCount) : null,
      viewCount: st.viewCount != null ? Number(st.viewCount) : null,
    };
    const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return { channel, posts: [], reason: 'No uploads playlist', source: 'youtube-data-api' };
    const pl = await get('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '25' });
    const ids = (pl?.items || []).map(i => i.contentDetails?.videoId).filter(Boolean);
    if (!ids.length) return { channel, posts: [], reason: 'No recent uploads', source: 'youtube-data-api' };
    const vids = await get('videos', { part: 'snippet,statistics', id: ids.join(',') });
    const posts = vids?.items || [];
    log(`  YouTube ${channel.title || ch.id}: ${posts.length} recent uploads`);
    return { channel, posts, reason: posts.length ? null : 'No video details returned', source: opts.fixture ? 'fixture' : 'youtube-data-api' };
  } catch (err) {
    return { channel: null, posts: [], reason: `YouTube fetch failed: ${err.message}`, source: 'youtube-data-api' };
  }
}

// ─── LINE Official Account (presence only) ───────────────────────────────────
// LINE has no public post feed, so this records presence and nothing else:
// no followers, likes, comments or post counts are ever produced here.
const LINE_PRESENCE_NOTE = 'LINE Official Account: presence only. LINE has no public post feed, so no posts or engagement metrics are collected.';

/**
 * Pure: interpret a fetched public LINE page. Observed live (2026-11-16): a desktop
 * request to page.line.me/<id> redirects to line.me/R/ti/p/@<id>, which returns 200
 * with an add-friend QR block (class MdQrSuccess) and an og:image carrying the basic
 * id, or 404 with MdQrError when the account does not exist. Badges are not rendered
 * on that page, so badge stays null unless a marker is actually present.
 */
function parseLinePage({ status, finalUrl, html }) {
  const body = String(html || '');
  const exists = status === 200 && !/MdQrError/.test(body) && /MdQrSuccess|qr-official\.line\.me|page-share\.line\.me/.test(body);
  const basicMatch = body.match(/page-share\.line\.me\/(@[A-Za-z0-9_.\-]+)\//);
  const finalRef = finalUrl ? classifySocialLinks([finalUrl]).line : null;
  const ogTitle = (body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || [])[1] || null;
  const genericTitle = !ogTitle || /^(add line friend|line|title)$/i.test(ogTitle.trim());
  let badge = null;
  if (/premium[-_ ]?(account|badge|icon)|プレミアムアカウント/i.test(body)) badge = 'premium';
  else if (/verified[-_ ]?(account|badge|icon)|認証済(み)?アカウント/i.test(body)) badge = 'verified';
  return {
    exists,
    basicId: basicMatch ? basicMatch[1] : null,
    resolvedId: finalRef?.id || null,
    displayName: genericTitle ? null : ogTitle,
    badge,
    badgeVisible: badge !== null,
  };
}

/**
 * Returns a presence-only record. Never throws, never contains engagement numbers.
 * opts.fixture: { status, finalUrl, html } as if fetched.
 */
async function checkLinePresence(ref, opts = {}) {
  ref = toLineRef(ref);
  const base = {
    platform: 'line',
    presenceOnly: true,
    note: LINE_PRESENCE_NOTE,
    accountId: ref?.id || null,
    basicId: null,
    url: ref?.url || null,
    displayName: null,
    exists: null,
    badge: null,
    badgeVisible: false,
    checkedAt: new Date().toISOString(),
    reason: null,
  };
  if (!ref) return { ...base, reason: 'No LINE account link found' };
  let page;
  try {
    if (opts.fixture) page = loadFixture(opts.fixture);
    else if (isDryRun(opts)) return { ...base, reason: 'Dry run: LINE page not fetched; presence inferred from link only' };
    else {
      const target = ref.kind === 'short' ? ref.url : `https://page.line.me/${String(ref.id).replace(/^@/, '')}`;
      const res = await (opts.fetchImpl || fetch)(target, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' },
        signal: AbortSignal.timeout(15000),
      });
      page = { status: res.status, finalUrl: res.url || target, html: await res.text().catch(() => '') };
    }
  } catch (err) {
    return { ...base, reason: `LINE page check failed: ${err.message}` };
  }
  const parsed = parseLinePage(page);
  return {
    ...base,
    accountId: parsed.resolvedId || base.accountId,
    basicId: parsed.basicId,
    displayName: parsed.displayName,
    exists: parsed.exists,
    badge: parsed.badge,
    badgeVisible: parsed.badgeVisible,
    reason: parsed.exists ? (parsed.badgeVisible ? null : 'Badge not shown on the public add-friend page') : `LINE page returned ${page.status}; account not confirmed`,
  };
}

// ─── Analytics Helpers ────────────────────────────────────────────────────────

function buildMonthlyTrend(normalizedPosts) {
  const monthMap = {};
  normalizedPosts.forEach(post => {
    const date = new Date(post.timestamp);
    if (isNaN(date)) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap[key]) monthMap[key] = { month: key, totalLikes: 0, totalComments: 0, postCount: 0 };
    monthMap[key].totalLikes += post.likes || 0;
    monthMap[key].totalComments += post.comments || 0;
    monthMap[key].postCount++;
  });
  return Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map(m => ({
      month: m.month,
      avgEngagement: m.postCount > 0 ? Math.round((m.totalLikes + m.totalComments) / m.postCount) : 0,
      postCount: m.postCount,
    }));
}

function extractContentThemes(normalizedPosts) {
  // English keywords plus Japanese equivalents so JP captions are themed too.
  const themeKeywords = {
    'Product Showcase': ['new', 'collection', 'available', 'shop', 'now', '新商品', '新作', '発売', '登場', '入荷'],
    'Lifestyle': ['lifestyle', 'mood', 'vibe', 'inspiration', 'everyday', '暮らし', '日常', 'おうち'],
    'User Generated': ['regram', 'repost', 'customer', 'community', 'wearing', '投稿キャンペーン', 'お客様', 'みんなの'],
    'Promotional': ['sale', 'off', '% off', 'discount', 'deal', 'save', 'セール', '割引', '%オフ', 'ポイント', 'キャンペーン', 'プレゼント'],
    'Behind the Scenes': ['bts', 'behind', 'team', 'making', 'process', '舞台裏', 'スタッフ', 'メイキング'],
    'Seasonal': ['fall', 'winter', 'spring', 'summer', 'holiday', 'season', 'クリスマス', 'お正月', '夏休み', '冬休み', 'こどもの日', 'ひなまつり', 'ハロウィン'],
    'Brand Story': ['since', 'founded', 'heritage', 'legacy', 'brand', '創業', '周年', 'ブランド'],
  };
  const counts = {};
  normalizedPosts.forEach(post => {
    const text = (post.caption || '').toLowerCase();
    Object.entries(themeKeywords).forEach(([theme, keywords]) => {
      if (keywords.some(k => text.includes(k))) counts[theme] = (counts[theme] || 0) + 1;
    });
  });
  return Object.entries(counts).map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count);
}

function buildPostingPattern(normalizedPosts) {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const dayBreakdown = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
  normalizedPosts.forEach(post => {
    if (!post.timestamp) return;
    const d = new Date(post.timestamp);
    if (isNaN(d)) return;
    dayBreakdown[dayNames[d.getDay()]]++;
  });
  const best = Object.entries(dayBreakdown).sort((a, b) => b[1] - a[1])[0];
  return { bestDay: best && best[1] > 0 ? DAY_LABELS[best[0]] : null, dayBreakdown };
}

/**
 * Pure: the content format of one raw post: reel | carousel | video | image | live | text.
 * Only reads fields the actors actually return; anything unrecognised falls back by platform.
 */
function detectFormat(p, platform) {
  if (!p || typeof p !== 'object') return null;
  if (platform === 'youtube') {
    const live = p.snippet?.liveBroadcastContent;
    return live === 'live' || live === 'upcoming' || p.liveStreamingDetails ? 'live' : 'video';
  }
  if (platform === 'tiktok') {
    if (p.isLive || p.liveRoom) return 'live';
    if (p.isSlideshow || (Array.isArray(p.imagePost?.images) && p.imagePost.images.length) || (Array.isArray(p.slideshowImageLinks) && p.slideshowImageLinks.length)) return 'carousel';
    return 'video';
  }
  if (platform === 'x') {
    const media = p.extendedEntities?.media || p.entities?.media || p.media || [];
    if (!Array.isArray(media) || !media.length) return 'text';
    if (media.some(m => m && (m.type === 'video' || m.type === 'animated_gif'))) return 'video';
    return media.length > 1 ? 'carousel' : 'image';
  }
  if (platform === 'facebook') {
    if (p.isLive || /live/i.test(String(p.videoType || ''))) return 'live';
    if (p.isVideo || p.video || (Array.isArray(p.media) && p.media.some(m => /video/i.test(String(m?.__typename || m?.type || ''))))) return 'video';
    if (Array.isArray(p.media) && p.media.length > 1) return 'carousel';
    if (Array.isArray(p.media) && p.media.length === 1) return 'image';
    return 'text';
  }
  // Instagram
  if (p.productType === 'clips' || p.type === 'Reel') return 'reel';
  if (p.type === 'Sidecar' || (Array.isArray(p.childPosts) && p.childPosts.length > 1) || p.childCount > 1) return 'carousel';
  if (p.productType === 'igtv' || p.type === 'Video' || p.isVideo) return 'video';
  if (p.type === 'Image') return 'image';
  return null;
}

// Normalize raw posts from any platform to a consistent shape (plus `format`)
function normalizePosts(rawPosts, platform) {
  return (rawPosts || []).map(p => ({ ...normalizeOne(p, platform), format: detectFormat(p, platform) }));
}

/** Pure: newest first, at most n (posts without a timestamp go last). */
function newestFirst(posts, n = POSTS_ANALYSED) {
  const t = p => { const d = p?.timestamp ? new Date(p.timestamp).getTime() : NaN; return Number.isFinite(d) ? d : -Infinity; };
  return [...(posts || [])].sort((a, b) => t(b) - t(a)).slice(0, n);
}

function normalizeOne(p, platform) {
  {
    if (platform === 'x') {
      // Shared shape plus additive shares/views. Caption text is kept verbatim (Japanese included).
      const media = p.extendedEntities?.media?.[0] || p.entities?.media?.[0] || p.media?.[0] || null;
      const ts = p.createdAt || p.created_at || null;
      const d = ts ? new Date(ts) : null;
      return {
        likes: Number(p.likeCount ?? p.favorite_count ?? 0) || 0,
        comments: Number(p.replyCount ?? p.reply_count ?? 0) || 0,
        caption: truncateChars(p.fullText || p.text || '', 200),
        timestamp: d && !isNaN(d) ? d.toISOString() : null,
        postUrl: p.url || p.twitterUrl || null,
        imageUrl: (media && (media.media_url_https || media.url)) || null,
        shares: (Number(p.retweetCount ?? 0) || 0) + (Number(p.quoteCount ?? 0) || 0),
        views: p.viewCount != null ? Number(p.viewCount) || 0 : null,
      };
    }
    if (platform === 'youtube') {
      const sn = p.snippet || {};
      const st = p.statistics || {};
      const th = sn.thumbnails || {};
      return {
        likes: Number(st.likeCount || 0) || 0,
        comments: Number(st.commentCount || 0) || 0,
        caption: truncateChars(sn.title || '', 200),
        timestamp: sn.publishedAt || null,
        postUrl: p.id ? `https://www.youtube.com/watch?v=${p.id}` : null,
        imageUrl: (th.high || th.medium || th.default || {}).url || null,
        views: st.viewCount != null ? Number(st.viewCount) || 0 : null,
      };
    }
    if (platform === 'tiktok') {
      return {
        likes: p.diggCount || 0,
        comments: p.commentCount || 0,
        caption: (p.text || '').slice(0, 200),
        timestamp: p.createTime ? new Date(p.createTime * 1000).toISOString() : null,
        postUrl: p.webVideoUrl || null,
        imageUrl: p.covers && p.covers[0] ? p.covers[0] : null,
      };
    }
    if (platform === 'facebook') {
      const likes = typeof p.likes === 'number' ? p.likes
        : (p.likes && typeof p.likes === 'object' ? p.likes.summary?.total_count || 0 : 0);
      const comments = typeof p.comments === 'number' ? p.comments
        : (p.comments && typeof p.comments === 'object' ? p.comments.summary?.total_count || 0 : 0);
      return {
        likes,
        comments,
        caption: (p.message || p.text || p.story || '').slice(0, 200),
        timestamp: p.time || p.created_time || null,
        postUrl: p.url || p.postUrl || null,
        imageUrl: p.media && p.media[0] ? p.media[0].image?.src || null : null,
      };
    }
    // Instagram (default)
    return {
      likes: p.likesCount || p.edge_media_preview_like?.count || 0,
      comments: p.commentsCount || p.edge_media_to_comment?.count || 0,
      caption: (p.caption || p.caption?.text || '').slice(0, 200),
      timestamp: p.timestamp || (p.taken_at_timestamp ? new Date(p.taken_at_timestamp * 1000).toISOString() : null),
      postUrl: p.shortCode ? `https://instagram.com/p/${p.shortCode}` : null,
      imageUrl: p.displayUrl || null,
    };
  }
}

// Build a platform data object from normalized posts (for tiktokData / facebookData fields)
function buildPlatformData(normalizedPosts) {
  if (!normalizedPosts || normalizedPosts.length === 0) return null;
  const totalLikes = normalizedPosts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalComments = normalizedPosts.reduce((s, p) => s + (p.comments || 0), 0);
  const avgEngagement = Math.round((totalLikes + totalComments) / normalizedPosts.length);
  const now = Date.now();
  const last30 = normalizedPosts.filter(p => p.timestamp && (now - new Date(p.timestamp)) < 30 * 24 * 3600 * 1000);
  const topPosts = [...normalizedPosts]
    .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
    .slice(0, 3);
  return {
    summary: { postCount: normalizedPosts.length, avgEngagement, postingFrequencyPerWeek: Math.round((last30.length / 4.3) * 10) / 10 },
    topPosts,
    contentThemes: extractContentThemes(normalizedPosts),
    monthlyTrend: buildMonthlyTrend(normalizedPosts),
  };
}

// ─── Engagement rate ─────────────────────────────────────────────────────────
// Run 1 left engagementRate null for every brand: it was only computed for Instagram and only
// when followersEstimate was set, which happens solely in the zero-posts profile fallback, so a
// brand with posts never had followers and a brand with followers never had posts. Engagement is
// now computed per platform whenever posts exist, with the basis stated on every value.

const ENGAGEMENT_PLATFORM_ORDER = ['instagram', 'x', 'youtube', 'tiktok', 'facebook'];

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }

/**
 * Pure. avgPerPost: mean engagements per post. followers: number or null.
 * rate is ALWAYS a percent of followers per post, and is null when followers are unknown.
 * avgEngagementPerPost is always the raw average count. basis: 'followers' (both exist) or
 * 'per-post' (only avgEngagementPerPost exists).
 */
function engagementFromAverage(avgPerPost, postCount, followers, counts = 'likes+comments') {
  const posts = Number(postCount) || 0;
  const avg = Number(avgPerPost);
  if (!(posts > 0) || !Number.isFinite(avg)) return null;
  const f = Number(followers);
  if (f > 0) {
    return { basis: 'followers', rate: round((avg / f) * 100, 3), unit: 'percent of followers per post', avgEngagementPerPost: round(avg, 1), followers: f, posts, counts };
  }
  return { basis: 'per-post', rate: null, unit: 'engagements per post (followers unknown, no rate)', avgEngagementPerPost: round(avg, 1), followers: null, posts, counts };
}

/** Pure: engagement from normalized posts. Shares count when the platform reports them (X). */
function computeEngagement(normalizedPosts, followers) {
  const list = (normalizedPosts || []).filter(Boolean);
  if (!list.length) return null;
  const hasShares = list.some(p => typeof p.shares === 'number');
  const total = list.reduce((s, p) => s + (Number(p.likes) || 0) + (Number(p.comments) || 0) + (hasShares ? (Number(p.shares) || 0) : 0), 0);
  return engagementFromAverage(total / list.length, list.length, followers, hasShares ? 'likes+comments+shares' : 'likes+comments');
}

/**
 * Pure: brand-level pick. Prefers a follower-based platform (Instagram, X, YouTube, TikTok,
 * Facebook in that order), else the first platform with posts.
 * Returns { engagementRate, avgEngagementPerPost, engagementBasis }:
 *   engagementRate: percent of followers per post, or null when no platform has followers.
 *   avgEngagementPerPost: raw average engagements per post on the same platform.
 *   engagementBasis.available lists which of the two fields hold a value.
 */
function pickBrandEngagement(byPlatform) {
  const entries = ENGAGEMENT_PLATFORM_ORDER.map(p => [p, byPlatform?.[p]]).filter(([, e]) => e);
  const hit = entries.find(([, e]) => e.basis === 'followers') || entries[0];
  if (!hit) return { engagementRate: null, avgEngagementPerPost: null, engagementBasis: null };
  const e = hit[1];
  const rate = e.basis === 'followers' ? e.rate : null;
  const available = [rate != null && 'engagementRate', e.avgEngagementPerPost != null && 'avgEngagementPerPost'].filter(Boolean);
  return { engagementRate: rate, avgEngagementPerPost: e.avgEngagementPerPost ?? null, engagementBasis: { platform: hit[0], ...e, available } };
}

/**
 * Pure: engagement from an already-built brand record (summaries only). Used for carried-forward
 * and older records whose raw posts are gone. Summaries hold likes+comments only.
 */
function deriveEngagement(brand) {
  if (!brand) return {};
  const igFollowers = typeof brand.summary?.followersEstimate === 'number' ? brand.summary.followersEstimate : null;
  const pd = (d, f) => d?.summary ? engagementFromAverage(d.summary.avgEngagement, d.summary.postCount, f) : null;
  const out = {
    instagram: brand.summary ? engagementFromAverage(brand.summary.avgEngagement, brand.summary.postCount, igFollowers) : null,
    x: pd(brand.xData, brand.xData?.followers),
    youtube: pd(brand.youtubeData, brand.youtubeChannel?.subscriberCount),
    tiktok: pd(brand.tiktokData, brand.tiktokData?.followers),
    facebook: pd(brand.facebookData, brand.facebookData?.followers),
  };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

// ─── Per-platform blocks, coverage and tier evidence (pure) ──────────────────

const BLOCK_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'x', 'youtube', 'line'];
const TIER_SEQUENCE = ['marketplace', 'mass', 'specialty', 'niche', 'unknown'];
const THIN_EVIDENCE_MIN = 3; // fewer brands with data than this in a tier: say evidence is thin

/**
 * Pure: posts per week from post timestamps. (n - 1) intervals over the span between the oldest and
 * newest post, so 25 posts over 12 weeks reads 2.0 whatever the date of the run.
 * Returns { postsPerWeek, reason, lastPostAt }.
 */
function postsPerWeekFrom(posts) {
  const ts = (posts || []).map(p => new Date(p?.timestamp).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const lastPostAt = ts.length ? new Date(ts[ts.length - 1]).toISOString() : null;
  if (ts.length < 2) return { postsPerWeek: null, reason: ts.length ? 'only one dated post' : 'no dated posts', lastPostAt };
  const weeks = (ts[ts.length - 1] - ts[0]) / (7 * 24 * 3600 * 1000);
  if (!(weeks > 0)) return { postsPerWeek: null, reason: 'all posts share one timestamp', lastPostAt };
  // At least one day of span, so a burst of same-day posts does not read as hundreds per week.
  return { postsPerWeek: round((ts.length - 1) / Math.max(weeks, 1 / 7), 1), reason: null, lastPostAt };
}

/** Pure: format mix, most used first: [{ format, count, share }]. */
function formatMix(posts) {
  const counts = {};
  let n = 0;
  for (const p of posts || []) { if (!p?.format) continue; counts[p.format] = (counts[p.format] || 0) + 1; n++; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([format, count]) => ({ format, count, share: round(count / n, 2) }));
}

/**
 * Pure: the per-platform block. engagementRate is a percent of followers per post
 * (avg interactions per post / followers * 100), null with engagementRateReason when either is missing.
 */
function buildPlatformBlock({ handle = null, posts = [], followers = null, followersReason = null, status = null, budgetSkipped = false, reason = null } = {}) {
  const list = (posts || []).filter(Boolean);
  const n = list.length;
  const eng = n ? computeEngagement(list, followers) : null;
  const freq = postsPerWeekFrom(list);
  const f = typeof followers === 'number' && followers > 0 ? followers : null;
  let engagementRateReason = null;
  if (!(eng && eng.basis === 'followers')) {
    engagementRateReason = budgetSkipped ? 'not scraped: Apify budget cap reached'
      : !n ? (reason || 'no posts analysed')
      : (followersReason || 'follower count not available from this source');
  }
  return {
    handle: handle || null,
    status: status || (n ? 'ok' : 'no-data'),
    followers: f,
    posts: n,
    avgInteractions: eng ? eng.avgEngagementPerPost : null,
    interactionsCounted: eng ? eng.counts : null,
    engagementRate: eng && eng.basis === 'followers' ? eng.rate : null,
    engagementRateUnit: 'percent of followers per post',
    engagementRateReason,
    postsPerWeek: freq.postsPerWeek,
    ...(freq.reason && n ? { postsPerWeekReason: freq.reason } : {}),
    lastPostAt: freq.lastPostAt,
    topFormats: formatMix(list).slice(0, 5),
    topThemes: extractContentThemes(list).slice(0, 5),
    ...(budgetSkipped ? { budgetSkipped: true } : {}),
    ...(reason ? { reason } : {}),
  };
}

function hasPlatformData(block) { return !!block && (block.posts || 0) > 0; }

/** Pure: brands with post data on at least one platform. */
function brandsWithData(brands) {
  return (brands || []).filter(b => b && BLOCK_PLATFORMS.some(p => hasPlatformData(b.platforms?.[p])));
}

/**
 * Pure: which brands and platforms had data, which were skipped and why, and the Apify spend.
 * budgetSummary: utils/apify_budget summary() for this run (or null).
 */
function buildCoverage(brands, budgetSummary = null) {
  const list = (brands || []).filter(Boolean);
  const perBrand = list.map(b => {
    const withData = BLOCK_PLATFORMS.filter(p => hasPlatformData(b.platforms?.[p]));
    const skipped = BLOCK_PLATFORMS.map(p => [p, b.platforms?.[p], b.platformStatus?.[p]])
      .filter(([p, blk]) => !withData.includes(p))
      .map(([p, blk, st]) => ({
        platform: p,
        reason: blk?.reason || st?.reason || (p === 'line' && b.lineAccount ? 'presence only (LINE has no public feed)' : 'no account found'),
        ...(blk?.budgetSkipped || st?.budgetSkipped ? { budgetSkipped: true } : {}),
        ...(p === 'line' && b.lineAccount?.exists ? { presenceOnly: true } : {}),
      }));
    return { name: b.name, role: b.role, tier: b.tier || 'unknown', relationship: b.relationship || 'competitor', platformsWithData: withData, skipped, ...(b.noBrandAccount ? { noBrandAccount: true } : {}), ...(b.stale ? { stale: true } : {}) };
  });
  const byTier = {};
  for (const t of TIER_SEQUENCE) {
    const inTier = perBrand.filter(b => b.role !== 'target' && b.tier === t);
    if (!inTier.length) continue;
    const withData = inTier.filter(b => b.platformsWithData.length).map(b => b.name);
    byTier[t] = { brands: inTier.map(b => b.name), withData, evidence: withData.length >= THIN_EVIDENCE_MIN ? 'adequate' : 'thin' };
  }
  const platforms = {};
  for (const p of BLOCK_PLATFORMS) {
    platforms[p] = {
      withData: perBrand.filter(b => b.platformsWithData.includes(p)).map(b => b.name),
      budgetSkipped: perBrand.filter(b => b.skipped.some(s => s.platform === p && s.budgetSkipped)).map(b => b.name),
    };
  }
  const entries = budgetSummary?.entries || [];
  const socialEntries = entries.filter(e => /^social /.test(e.label || ''));
  const spent = socialEntries.reduce((s, e) => s + (e.actualUsd != null ? e.actualUsd : (e.reservedUsd || 0)), 0);
  return {
    brands: perBrand,
    byTier,
    platforms,
    brandsWithData: perBrand.filter(b => b.platformsWithData.length).length,
    brandsTotal: perBrand.length,
    budget: budgetSummary ? {
      runId: budgetSummary.runId || null,
      capUsd: budgetSummary.capUsd ?? null,
      runSpentUsd: budgetSummary.spentUsd ?? null,
      socialSpentUsd: round(spent, 2),
      socialCalls: socialEntries.filter(e => !e.refused).length,
      socialRefused: socialEntries.filter(e => e.refused).length,
    } : null,
  };
}

/**
 * Pure: compact per-tier evidence for the synthesis prompt. Only brands with data are listed as
 * evidence; brands without data are named separately so the model cannot cite them.
 */
function buildTierEvidence(brands) {
  const out = {};
  for (const b of (brands || []).filter(Boolean)) {
    const tier = b.role === 'target' ? 'target' : (b.tier || 'unknown');
    if (!out[tier]) out[tier] = { withData: [], withoutData: [] };
    const plats = BLOCK_PLATFORMS.filter(p => hasPlatformData(b.platforms?.[p]));
    if (!plats.length) { out[tier].withoutData.push(b.name); continue; }
    out[tier].withData.push({
      name: b.name,
      relationship: b.relationship || (b.role === 'target' ? 'self' : 'competitor'),
      platforms: Object.fromEntries(plats.map(p => {
        const k = b.platforms[p];
        return [p, {
          followers: k.followers, posts: k.posts, engagementRate: k.engagementRate, avgInteractions: k.avgInteractions,
          postsPerWeek: k.postsPerWeek, formats: k.topFormats.map(f => `${f.format} ${Math.round(f.share * 100)}%`).join(', '),
          themes: k.topThemes.map(t => t.theme).join(', '),
        }];
      })),
    });
  }
  return out;
}

function buildTierSynthesisPrompt({ targetName, market, evidence, coverage, guidelines }) {
  const tiers = Object.entries(evidence);
  const lines = tiers.map(([tier, ev]) => {
    const thin = tier !== 'target' && ev.withData.length < THIN_EVIDENCE_MIN;
    return `TIER ${tier}${thin ? ` (THIN EVIDENCE: only ${ev.withData.length} brand(s) with data)` : ''}\n`
      + (ev.withData.length ? ev.withData.map(b => `  ${b.name} [${b.relationship}]: ` + Object.entries(b.platforms).map(([p, k]) =>
        `${p} followers=${k.followers ?? 'unknown'} posts=${k.posts} eng=${k.engagementRate != null ? k.engagementRate + '%' : 'n/a'} avgInteractions=${k.avgInteractions ?? 'n/a'} perWeek=${k.postsPerWeek ?? 'n/a'} formats=[${k.formats}] themes=[${k.themes}]`).join(' | ')).join('\n') : '  (no brand in this tier returned data)')
      + (ev.withoutData.length ? `\n  No data (do not cite): ${ev.withoutData.join(', ')}` : '');
  }).join('\n');
  const skippedBudget = (coverage?.brands || []).filter(b => b.skipped.some(s => s.budgetSkipped)).map(b => b.name);
  return `You are a social media strategist for ${targetName}, a toy retailer in ${market}. The owner says the social picture has been weak and needs to know what niche brands do, how ${targetName} can differentiate, and how it can stand out from the marketplaces (Amazon, Rakuten, Yahoo! Shopping).

Players are grouped in tiers: marketplace (pure e-commerce, many sellers), mass (general retail with a toy department), specialty (toy, character and hobby specialists), niche (small focused players: educational, gacha, collectibles, indie, D2C). Don Quijote is ${targetName}'s PARTNER (a shop-in-shop deal was just signed), never a competitor: never frame it as a rival.

EVIDENCE (last ${POSTS_ANALYSED} posts per platform; engagement = average interactions per post as a percent of followers):
${lines}
${skippedBudget.length ? `\nNot scraped this run because the Apify budget cap was reached: ${skippedBudget.join(', ')}. Say so where it matters.\n` : ''}
RULES
- Every claim cites brands from the evidence above that actually have data, by exact name. Never cite a brand listed under "No data".
- When a tier is marked THIN EVIDENCE, say the evidence is thin and describe only what those brands show; do not generalise to the whole tier.
- Marketplaces usually have no brand-level toy account; if a marketplace tier has no data, say that rather than inventing their social behaviour.
- ${LANGUAGE_INSTRUCTION}
${buildGuidelinesContext(guidelines)}
Return ONLY a JSON object:
{
  "tierInsights": [{"tier": "marketplace|mass|specialty|niche", "summary": "what these players do on social", "formats": "dominant formats", "cadence": "typical posts per week", "typicalEngagement": "typical engagement rate or interactions", "evidenceBrands": ["exact brand names with data"], "evidenceStrength": "adequate|thin"}],
  "differentiation": {"nichePlaybook": [{"move": "what niche and specialty players do that marketplaces cannot (curation, storytelling, community, expertise, exclusives, events)", "evidenceBrands": ["..."]}], "standOutFromMarketplaces": [{"move": "how ${targetName} can stand out from the marketplaces on social", "why": "...", "platform": "instagram|tiktok|x|youtube|line|facebook|all", "evidenceBrands": ["..."]}]},
  "partnerPlay": [{"idea": "how ${targetName} and Don Quijote use social around the shop-in-shop and to drive store traffic", "platform": "...", "how": "...", "evidenceBrands": ["..."]}]
}`;
}

/**
 * Pure: enforce the evidence rules on the model's answer. Citations of brands without data are
 * removed (and counted), every tier insight gets evidenceStrength from the data rather than from the
 * model, and a thin tier always says so.
 */
function enforceEvidence(synth, brands) {
  if (!synth || typeof synth !== 'object') return null;
  const withData = new Map(brandsWithData(brands).map(b => [String(b.name).toLowerCase(), b]));
  let removed = 0;
  const clean = (arr) => {
    const list = Array.isArray(arr) ? arr : [];
    const kept = list.filter(n => withData.has(String(n).toLowerCase()));
    removed += list.length - kept.length;
    return kept.map(n => withData.get(String(n).toLowerCase()).name);
  };
  const tierCount = {};
  for (const b of withData.values()) if (b.role !== 'target') tierCount[b.tier || 'unknown'] = (tierCount[b.tier || 'unknown'] || 0) + 1;
  const tierInsights = (Array.isArray(synth.tierInsights) ? synth.tierInsights : []).map(t => {
    const n = tierCount[t.tier] || 0;
    const strength = n >= THIN_EVIDENCE_MIN ? 'adequate' : 'thin';
    const out = { ...t, evidenceBrands: clean(t.evidenceBrands), evidenceStrength: strength, brandsWithData: n };
    if (strength === 'thin' && !/thin/i.test(String(t.summary || ''))) out.summary = `Evidence is thin (${n} brand${n === 1 ? '' : 's'} with data in this tier). ${t.summary || ''}`.trim();
    return out;
  });
  const d = synth.differentiation && typeof synth.differentiation === 'object' ? synth.differentiation : {};
  const differentiation = {
    nichePlaybook: (Array.isArray(d.nichePlaybook) ? d.nichePlaybook : []).map(x => ({ ...x, evidenceBrands: clean(x.evidenceBrands) })),
    standOutFromMarketplaces: (Array.isArray(d.standOutFromMarketplaces) ? d.standOutFromMarketplaces : []).map(x => ({ ...x, evidenceBrands: clean(x.evidenceBrands) })),
  };
  const partnerPlay = (Array.isArray(synth.partnerPlay) ? synth.partnerPlay : []).map(x => ({ ...x, evidenceBrands: clean(x.evidenceBrands) }));
  return { tierInsights, differentiation, partnerPlay, removedCitations: removed };
}

async function generateTierSynthesis(anthropic, brands, coverage, guidelines, market = 'the local market') {
  const target = (brands || []).find(b => b && b.role === 'target');
  const prompt = buildTierSynthesisPrompt({ targetName: target?.name || 'this brand', market, evidence: buildTierEvidence(brands), coverage, guidelines });
  const msg = await anthropic.messages.create({
    model: MODEL_DEEP,
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = extractText(msg);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('synthesis returned no JSON object');
  return enforceEvidence(JSON.parse(raw.slice(start, end + 1)), brands);
}

// ─── Content Gap Analysis (Claude) ───────────────────────────────────────────

function buildGuidelinesContext(guidelines) {
  if (!guidelines) return '';
  const parts = [];
  if (guidelines.brandVoice?.length) parts.push(`Voice: ${guidelines.brandVoice.join(', ')}`);
  if (guidelines.messagingPillars?.length) parts.push(`Pillars: ${guidelines.messagingPillars.slice(0, 3).join(' | ')}`);
  if (guidelines.tentpoles?.length) parts.push(`Campaigns: ${guidelines.tentpoles.map(t => t.name).join(', ')}`);
  if (guidelines.doList?.length) parts.push(`Always: ${guidelines.doList.slice(0, 3).join('; ')}`);
  if (guidelines.dontList?.length) parts.push(`Avoid: ${guidelines.dontList.slice(0, 3).join('; ')}`);
  if (!parts.length) return '';
  return `\nBrand guidelines (use for brand-appropriate direction: not strict rules):\n${parts.join('\n')}\n`;
}

const LANGUAGE_INSTRUCTION = 'Answer in English. Post captions may be in Japanese or another language: quote them exactly as written (do not translate inside the quote), and add a short English gloss where it helps.';

// Per-brand, per-platform status line for the prompts, so Claude knows which
// platforms have data, which are presence-only, and which are not applicable.
function platformStatusLabel(b, platform) {
  if (platform === 'instagram') return (b.summary?.postCount || 0) > 0 ? `data (${b.summary.postCount} posts)` : (b.handle ? 'handle found, no post data' : 'not applicable (no account found)');
  if (platform === 'line') {
    const l = b.lineAccount;
    if (!l) return 'not applicable (no LINE account found)';
    return `presence only, no feed or metrics exist (${l.accountId || l.url}${l.exists === true ? ', page exists' : l.exists === false ? ', not confirmed' : ''}${l.unverifiedGuess ? ', unverified guess, may not be this brand' : ''})`;
  }
  const dataKey = { tiktok: 'tiktokData', facebook: 'facebookData', x: 'xData', youtube: 'youtubeData' }[platform];
  const handleKey = { tiktok: 'tiktokHandle', facebook: 'facebookHandle', x: 'xHandle', youtube: 'youtubeHandle' }[platform];
  const d = b[dataKey];
  const st = b.platformStatus?.[platform]?.status;
  if (d?.summary?.postCount) return `data (${d.summary.postCount} posts, avg ${d.summary.avgEngagement} eng, ${d.summary.postingFrequencyPerWeek}/wk)`;
  if (st === 'handle_not_found') return `no data (handle ${b[handleKey] || ''} does not exist)`;
  if (st === 'unverified_handle') return `no data (handle ${b[handleKey] || ''} unverified, not scraped)`;
  if (b[handleKey]) return `handle found, no post data${b.platformStatus?.[platform]?.reason ? ` (${b.platformStatus[platform].reason})` : ''}`;
  return 'not applicable (no account found)';
}

// Prompt label: role, plus tier and relationship when known (older records have neither).
function brandLabel(b) {
  const parts = [b.role];
  if (b.role !== 'target' && b.tier && b.tier !== 'unknown') parts.push(`tier ${b.tier}`);
  if (b.relationship === 'partner') parts.push('PARTNER, not a competitor');
  return parts.join(', ');
}

function buildPlatformCoverageContext(brands) {
  const platforms = ['instagram', 'tiktok', 'facebook', 'x', 'youtube', 'line'];
  const lines = (brands || []).filter(Boolean).map(b =>
    `${b.name} (${brandLabel(b)}): ` + platforms.map(p => `${p}=${platformStatusLabel(b, p)}`).join('; '));
  if (!lines.length) return '';
  const tiered = (brands || []).some(b => b && b.tier && b.tier !== 'unknown' && b.role !== 'target');
  const partners = (brands || []).filter(b => b && b.relationship === 'partner').map(b => b.name);
  return `\nPLATFORM COVERAGE (state plainly when a platform is not applicable or presence-only; never invent metrics for those):\n${lines.join('\n')}\n`
    + (tiered ? 'Players carry a tier (marketplace, mass, specialty, niche). Compare like with like, and contrast what niche and specialty players do with what marketplaces cannot do. Only cite brands that have data above.\n' : '')
    + (partners.length ? `${partners.join(', ')} ${partners.length === 1 ? 'is a PARTNER' : 'are PARTNERS'} of the target, not ${partners.length === 1 ? 'a competitor' : 'competitors'}: never frame ${partners.length === 1 ? 'it' : 'them'} as a rival.\n` : '');
}

async function generateWhiteSpaceOpportunities(anthropic, allBrandsData, guidelines, market = 'the local market') {
  const ALL_THEMES = ['Product Showcase', 'Lifestyle', 'User Generated', 'Promotional', 'Behind the Scenes', 'Seasonal', 'Brand Story'];

  // Build theme → brand coverage map
  const themeCoverage = {};
  ALL_THEMES.forEach(t => { themeCoverage[t] = []; });
  allBrandsData.forEach(b => {
    (b.contentThemes || []).forEach(({ theme, count }) => {
      if (themeCoverage[theme] !== undefined && count > 2) themeCoverage[theme].push(b.name);
    });
  });

  const lowCoverageThemes = ALL_THEMES
    .filter(t => themeCoverage[t].length <= 1)
    .map(t => `${t} (used by: ${themeCoverage[t].join(', ') || 'nobody'})`);

  const target = allBrandsData.find(b => b.role === 'target');
  const targetThemes = (target?.contentThemes || []).map(t => t.theme);

  const prompt = `You are a social media strategist. Identify untapped content opportunities for ${target?.name || 'this brand'} in the toy retail market in ${market}.

Market theme coverage (how many brands post about each theme significantly):
${ALL_THEMES.map(t => `  ${t}: ${themeCoverage[t].length > 0 ? themeCoverage[t].join(', ') : 'nobody doing this well'}`).join('\n')}
${buildPlatformCoverageContext(allBrandsData)}
${LANGUAGE_INSTRUCTION}

Target brand current themes: ${targetThemes.join(', ') || 'none'}
Low-coverage themes (white space): ${lowCoverageThemes.join(', ')}
${buildGuidelinesContext(guidelines)}
Identify 4-5 white space opportunities: content areas with low competition that would work well for this brand.
Return ONLY a JSON array:
[{"theme": "theme name", "description": "what this content looks like in practice", "rationale": "why this is an opportunity", "brandAlignment": "how this fits the brand voice/guidelines", "suggestedFormat": "Reels|Carousel|Story|Video|Post", "priority": "high|medium"}]`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 3000,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) { log(`  White space analysis error: ${err.message}`); }
  return null;
}

async function generateCompetitionStrategy(anthropic, targetData, competitorData, guidelines, market = 'the local market') {
  const target = targetData;
  // A partner is studied as a channel, never as a competitor to beat.
  competitorData = (competitorData || []).filter(c => c && c.relationship !== 'partner');
  const compSummaries = competitorData
    .filter(c => c.summary?.postCount > 0)
    .map(c => {
      const topTheme = c.contentThemes?.[0]?.theme || 'unknown';
      const eng = c.summary?.avgEngagement || 0;
      return `${c.name}${c.tier && c.tier !== 'unknown' ? ` [${c.tier}]` : ''}: avg ${eng} eng, ${c.summary?.postingFrequencyPerWeek || 0}/wk, top theme: ${topTheme}`;
    })
    .join('\n');

  const targetSummary = `${target.name}: avg ${target.summary?.avgEngagement || 0} eng, ${target.summary?.postingFrequencyPerWeek || 0}/wk`;
  const topCompetitor = competitorData
    .filter(c => c.summary?.avgEngagement > 0)
    .sort((a, b) => b.summary.avgEngagement - a.summary.avgEngagement)[0];

  const prompt = `You are a competitive social media strategist for a toy retailer in ${market}.

Target brand: ${targetSummary}
Competitors:
${compSummaries || 'No competitor data available'}
${buildPlatformCoverageContext([target, ...competitorData])}
${LANGUAGE_INSTRUCTION}

${topCompetitor ? `Market leader: ${topCompetitor.name} with ${topCompetitor.summary.avgEngagement} avg engagement` : ''}
${buildGuidelinesContext(guidelines)}
Design 4-5 specific tactical moves to help the target brand carve out a distinct, ownable lane on social media. Focus on differentiation, not imitation.

Return ONLY a JSON array:
[{"tactic": "short tactic title", "rationale": "why this works given the competitive landscape", "competitorInspiration": "competitor name or null", "brandAlignment": "how this fits brand voice/direction", "priority": "high|medium"}]`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 3000,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) { log(`  Competition strategy error: ${err.message}`); }
  return null;
}

async function generateContentGapAnalysis(anthropic, targetBrand, targetData, competitorBrandsData, guidelines) {
  const targetThemes = (targetData.contentThemes || []).map(t => t.theme).slice(0, 5);

  // Build top post context from competitors for richer prompt
  const competitorContext = competitorBrandsData
    .map(b => {
      // Instagram top posts first (unchanged), then X / YouTube top posts labelled by platform.
      const sets = [
        ['', b.topPosts],
        ['X ', b.xData?.topPosts],
        ['YouTube ', b.youtubeData?.topPosts],
      ].filter(([, arr]) => Array.isArray(arr) && arr.length > 0);
      if (!sets.length) return null;
      return sets.map(([label, arr]) => {
        const posts = arr.slice(0, 2).map(p => `  "${truncateChars(p.caption, 80)}" (${(p.likes || 0) + (p.comments || 0)} engagements)`).join('\n');
        return `${b.name} ${label}top posts:\n${posts}`;
      }).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  const competitorThemes = competitorBrandsData.flatMap(b => (b.contentThemes || []).map(t => t.theme));
  const uniqueCompThemes = [...new Set(competitorThemes)];
  const gaps = uniqueCompThemes.filter(t => !targetThemes.includes(t));

  if (!process.env.ANTHROPIC_API_KEY) {
    return gaps.slice(0, 5).map(g => `Consider adding ${g} content to close gap vs competitors`);
  }

  const prompt = `You are a social media strategist analyzing content opportunities for ${targetBrand} on Instagram, TikTok, Facebook, X, YouTube and LINE (LINE is presence-only: no public feed or metrics exist).
${buildPlatformCoverageContext([{ ...targetData, name: targetBrand }, ...competitorBrandsData])}
${LANGUAGE_INSTRUCTION}

TARGET BRAND (${targetBrand}):
- Content themes: ${targetThemes.join(', ') || 'unknown'}
- Posting frequency: ${targetData.summary?.postingFrequencyPerWeek || 0} posts/week
- Avg engagement: ${targetData.summary?.avgEngagement || 0}

COMPETITOR THEMES NOT USED BY TARGET: ${gaps.join(', ') || 'none identified'}

${competitorContext ? `COMPETITOR TOP POSTS (what's working for them):\n${competitorContext}` : ''}
${buildGuidelinesContext(guidelines)}
Identify the 4-5 most impactful content opportunities. Return ONLY a JSON array:
[{ "headline": "short action title", "detail": "plain English explanation of why this matters and how to do it", "competitor": "competitor name who does this well or null", "platform": "instagram|tiktok|facebook|x|youtube|line|all", "contentFormat": "Reels|Carousel|Story|Video|Post" }]`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 2500,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') return parsed;
    }
  } catch (err) { log(`  Content gap analysis error: ${err.message}`); }
  // Fallback: plain strings for backward compat
  return gaps.slice(0, 5).map(g => `Add ${g} content to close gap vs competitors`);
}

// ─── Brand Processing ─────────────────────────────────────────────────────────

// Handle trust. A handle from the profile, the site's own structured data or a page scan of the
// site is trusted and may be scraped. A handle Claude suggested is a guess: run 1 paid for X
// scrapes of four Claude-guessed handles that do not exist. A guess is only used once verified:
// YouTube by the channels API (free), LINE by the public add-friend page (free). X has no free
// check, so a Claude-guessed X handle is recorded as unverified and not scraped, unless an earlier
// run already scraped real posts from that same handle (prior-scrape evidence).
const TRUSTED_SOURCES = ['profile', 'structured-data', 'page-scan', 'official'];

function handleKey(h) { return String(h || '').replace(/^@/, '').toLowerCase(); }

function handleTrust(source, verified = null, verifiedBy = null) {
  const trusted = TRUSTED_SOURCES.includes(source);
  return { handleSource: source || null, verified: trusted ? true : verified, verifiedBy: trusted ? source : verifiedBy };
}

// Trim raw Instagram items to the fields this module reads, so checkpoints stay small.
function pickInstagramFields(p) {
  if (!p || typeof p !== 'object') return p;
  const keep = ['type', 'productType', 'isVideo', 'childCount', 'shortCode', 'timestamp', 'taken_at_timestamp', 'likesCount', 'commentsCount', 'caption', 'displayUrl', 'edge_media_preview_like', 'edge_media_to_comment'];
  const out = {};
  for (const k of keep) if (p[k] !== undefined) out[k] = p[k];
  if (Array.isArray(p.childPosts)) out.childCount = p.childPosts.length; // count only, keeps checkpoints small
  return out;
}

/**
 * opts (all optional, used by tests and --dry-run):
 *   dryRun: skip all network for X, YouTube and LINE (fixtures still apply)
 *   skipPageDetection: never launch Playwright for handle discovery
 *   fixtures: { x, youtube, line } passed to the matching fetcher
 *   detectPageImpl, scrapers: test seams for the page scan and the Apify IG/TikTok/Facebook calls
 *   cache: { get(key), put(key, value) } per-platform results for this brand, so a crash
 *          mid-brand does not pay again for platforms that already finished
 * brandInfo.structuredSocialLinks: JSON-LD sameAs URLs from site_intelligence.json
 * brandInfo.priorVerified: { x: handle } handles an earlier run scraped real posts from
 */
async function processBrand(brandInfo, anthropic, advance = () => {}, opts = {}) {
  const { slug, name, url, role, market } = brandInfo;
  const fixtures = opts.fixtures || {};
  const cache = opts.cache || null;
  const scrapers = opts.scrapers || {}; // tests: { instagram, tiktok, facebook } replace the Apify calls
  const priorVerified = brandInfo.priorVerified || {};
  const siteAccess = opts.siteAccess || siteAccessDefault;
  // opts.budget: { mod, slug, opts, state } from runAudit. state.refusedReason is shared by every
  // brand in the run: after the first refusal no further paid call is attempted (a clean stop).
  const budget = opts.budget || null;
  const tier = role === 'target' ? 'target' : normTier(brandInfo.tier);
  const relationship = role === 'target' ? 'self' : normRelationship(brandInfo.relationship);
  const official = new Set(brandInfo.officialPlatforms || []);
  // Marketplaces (Amazon, Rakuten, Yahoo toy categories) have no brand-level toy account: no handle
  // discovery and no guessing for them. A handle set in the profile is still scraped.
  const marketplace = role !== 'target' && isMarketplacePlayer({ tier: brandInfo.tier, url });
  const profileHasAny = !!(brandInfo.handle || brandInfo.tiktokHandle || brandInfo.facebookHandle || brandInfo.xHandle || brandInfo.youtubeHandle || brandInfo.lineId);
  const noBrandAccount = marketplace && !profileHasAny;
  const canPay = (platform) => !!(scrapers[platform] || process.env.APIFY_API_TOKEN);

  // Paid platform calls go through here: a checkpointed result is reused instead of paid for again,
  // and a new call first reserves its estimate from the run's Apify budget. A refusal returns
  // { __budgetSkipped, reason } and the actor is never called.
  async function cachedStep(key, fn, keep, paid = null) {
    if (cache) {
      const hit = cache.get(key);
      if (hit !== undefined) { log(`  ${name} ${key}: resumed from checkpoint`); return hit; }
    }
    let grant = null;
    if (paid && budget) {
      if (budget.state.refusedReason) return { __budgetSkipped: true, reason: budget.state.refusedReason };
      try { grant = budget.mod.reserve(budget.slug, paid.est, `social ${paid.label}`, budget.opts); }
      catch (err) { grant = { ok: false, reason: `Apify budget ledger unavailable: ${err.message}` }; }
      if (!grant.ok) {
        budget.state.refusedReason = grant.reason;
        log(`  ${name} ${key}: not scraped, ${grant.reason}`);
        return { __budgetSkipped: true, reason: grant.reason };
      }
    }
    const apify = apifyContext(grant, budget ? budget.mod : null);
    let value;
    try { value = await fn(apify); }
    finally { if (grant) { try { budget.mod.record(budget.slug, grant, combineRuns(apify.runs), budget.opts); } catch (err) { log(`  budget record failed: ${err.message}`); } } }
    if (cache && keep(value)) cache.put(key, value);
    return value;
  }

  // ── Handle sources, in priority order: profile > structured data > page scan > Claude
  // A marketplace's sameAs links are the marketplace's corporate accounts, not a toy account.
  const sd = marketplace ? emptySocialLinks() : classifySocialLinks(brandInfo.structuredSocialLinks || []);
  const handleSources = {};
  const pick = (platform, existing, fromSd) => {
    if (existing) { handleSources[platform] = official.has(platform) ? 'official' : 'profile'; return existing; }
    if (fromSd) { handleSources[platform] = 'structured-data'; return fromSd; }
    return null;
  };
  const existingIgHandle = pick('instagram', brandInfo.handle, sd.instagram);
  const existingTtHandle = pick('tiktok', brandInfo.tiktokHandle, sd.tiktok);
  const existingFbHandle = pick('facebook', brandInfo.facebookHandle, sd.facebook);
  let xHandle = pick('x', brandInfo.xHandle ? String(brandInfo.xHandle).replace(/^@/, '') : null, sd.x);
  let ytRef = pick('youtube', toYouTubeRef(brandInfo.youtubeHandle), sd.youtube);
  let lineRef = pick('line', toLineRef(brandInfo.lineId), sd.line);

  log(`Processing ${name} (${role})`);
  const brandData = {
    id: slug || name.toLowerCase().replace(/\s+/g, '-'),
    name,
    role,
    tier,
    relationship,
    handle: existingIgHandle || null,
    platform: 'instagram',
    scrapedAt: new Date().toISOString(),
    summary: { postCount: 0, avgEngagement: 0, followersEstimate: null, postingFrequencyPerWeek: 0 },
    contentThemes: [],
    topHashtags: [],
    recentPosts: [],
    topPosts: [],
    monthlyTrend: [],
    postingPattern: null,
    engagementRate: null,
    avgEngagementPerPost: null,
    tiktokHandle: existingTtHandle || null,
    tiktokData: null,
    facebookHandle: existingFbHandle || null,
    facebookData: null,
    // Added for X / YouTube / LINE (additive: existing fields above are unchanged)
    xHandle: xHandle || null,
    xData: null,
    youtubeHandle: youTubeRefToString(ytRef),
    youtubeChannel: null,
    youtubeData: null,
    lineId: lineRefToString(lineRef),
    lineAccount: null,
    handleSources,
    platformStatus: {},
    // engagementBasis says which platform and which basis engagementRate uses (see computeEngagement)
    engagementBasis: null,
    engagementByPlatform: {},
    structuredSocialLinks: (brandInfo.structuredSocialLinks || []).slice(0, 20),
    // Per-platform blocks {handle, followers, posts, engagementRate, postsPerWeek, topFormats, topThemes, ...}
    platforms: {},
    ...(noBrandAccount ? { noBrandAccount: true } : {}),
    contentGaps: [],
    error: null,
    partialData: false,
  };

  // ── Handle Discovery: Playwright → Claude fallback ─────────────────────────
  // Only for platforms the profile and structured data did not already supply.
  // Site access decides how (and whether) the brand's own page is read: 'direct' keeps the Playwright
  // detectors, 'jp_proxy' reads one page through site_access.fetchPage only, 'denied' reads nothing.
  let access = { mode: 'denied' };
  if (url && !opts.skipPageDetection && !isDryRun(opts) && !marketplace) {
    try { access = siteAccess.accessFor(url); } catch { access = { mode: 'denied' }; }
  }
  const canScanPage = access.mode === 'direct' || access.mode === 'jp_proxy';
  let proxyScan = null;
  const proxyLinks = async () => (proxyScan || (proxyScan = await scanPageViaFetch(url, siteAccess)));
  const needsDetection = (!existingIgHandle || !existingTtHandle || !existingFbHandle) && canScanPage;
  let claudeHandles = {};
  if (needsDetection) {
    log(`  Detecting missing handles for ${name} (${access.mode})...`);
    let igDetected = null; let ttDetected = null; let fbDetected = null;
    if (access.mode === 'jp_proxy') {
      const found = await proxyLinks();
      igDetected = found.instagram; ttDetected = found.tiktok; fbDetected = found.facebook;
    } else {
      // Playwright passes first
      [igDetected, ttDetected, fbDetected] = await Promise.all([
        existingIgHandle ? Promise.resolve(null) : detectInstagramHandle(url).catch(() => null),
        existingTtHandle ? Promise.resolve(null) : detectTikTokHandle(url).catch(() => null),
        existingFbHandle ? Promise.resolve(null) : detectFacebookHandle(url).catch(() => null),
      ]);
    }
    if (!existingIgHandle && igDetected) { brandData.handle = igDetected; handleSources.instagram = 'page-scan'; }
    if (!existingTtHandle && ttDetected) { brandData.tiktokHandle = ttDetected; handleSources.tiktok = 'page-scan'; }
    if (!existingFbHandle && fbDetected) { brandData.facebookHandle = fbDetected; handleSources.facebook = 'page-scan'; }
  }
  // X, YouTube and LINE are Japan-only. Before this work no market scraped or checked them at all,
  // so for every non-Japan brand they stay off whatever the handle source (profile, sameAs, page
  // scan, Claude): no Apify X run, no YouTube API call, no LINE page fetch. Any handle seen is
  // recorded in platformStatus as ignoredHandle with status not-applicable. Japan discovery below
  // (page scan, then Claude) runs only for Japan brands.
  const jpBrand = isJapanMarket({ market, url });
  if (jpBrand && (!xHandle || !ytRef || !lineRef) && canScanPage) {
    const found = access.mode === 'jp_proxy' ? await proxyLinks() : await (opts.detectPageImpl || detectHandlesFromPage)(url).catch(() => emptySocialLinks());
    if (!xHandle && found.x) { xHandle = found.x; handleSources.x = 'page-scan'; }
    if (!ytRef && found.youtube) { ytRef = found.youtube; handleSources.youtube = 'page-scan'; }
    if (!lineRef && found.line) { lineRef = found.line; handleSources.line = 'page-scan'; }
  }

  // Claude fallback for anything still missing
  const stillMissingAny = (!brandData.handle && !existingIgHandle) || (!brandData.tiktokHandle && !existingTtHandle) || (!brandData.facebookHandle && !existingFbHandle)
    || (jpBrand && (!xHandle || !ytRef || !lineRef));
  if (url && stillMissingAny && anthropic && !isDryRun(opts) && !marketplace) {
    claudeHandles = await lookupHandlesViaClaude(anthropic, name, url, market, jpBrand).catch(() => ({}));
    if (!brandData.handle && !existingIgHandle && claudeHandles.instagram) { brandData.handle = claudeHandles.instagram; handleSources.instagram = 'claude'; }
    if (!brandData.tiktokHandle && !existingTtHandle && claudeHandles.tiktok) { brandData.tiktokHandle = claudeHandles.tiktok; handleSources.tiktok = 'claude'; }
    if (!brandData.facebookHandle && !existingFbHandle && claudeHandles.facebook) { brandData.facebookHandle = claudeHandles.facebook; handleSources.facebook = 'claude'; }
    if (jpBrand) {
      if (!xHandle && claudeHandles.x) { xHandle = String(claudeHandles.x).replace(/^@/, ''); handleSources.x = 'claude'; }
      if (!ytRef && claudeHandles.youtube) { ytRef = toYouTubeRef(claudeHandles.youtube); handleSources.youtube = 'claude'; }
      if (!lineRef && claudeHandles.line) { lineRef = toLineRef(claudeHandles.line); handleSources.line = 'claude'; }
    }
  }
  const offMarket = {};
  if (!jpBrand) {
    if (xHandle) offMarket.x = xHandle;
    if (ytRef) offMarket.youtube = youTubeRefToString(ytRef);
    if (lineRef) offMarket.line = lineRefToString(lineRef);
    xHandle = null; ytRef = null; lineRef = null;
    delete handleSources.x; delete handleSources.youtube; delete handleSources.line;
  }
  const notEnabled = p => ({ status: 'not-applicable', reason: 'not enabled for this market', ...(offMarket[p] ? { ignoredHandle: offMarket[p] } : {}) });
  brandData.xHandle = xHandle || null;
  brandData.youtubeHandle = youTubeRefToString(ytRef);
  brandData.lineId = lineRefToString(lineRef);

  // ── Instagram ──────────────────────────────────────────────────────────────
  const igHandle = existingIgHandle || brandData.handle;
  log(`  Instagram: ${igHandle ? '@' + igHandle : 'not found'}`);

  const skipped = {}; // platform -> budget refusal reason
  let igRaw = [];
  let igNorm = [];
  let igFollowers = null;
  if (igHandle) {
    advance(`Instagram @${igHandle} (${name})`);
    let ig = null;
    try {
      const scraper = scrapers.instagram || scrapeInstagramViaApify;
      ig = await cachedStep(`instagram:${handleKey(igHandle)}`, async (apify) => {
        const r = toScrapeResult(await scraper(igHandle, apify));
        return { posts: r.posts.map(pickInstagramFields), followers: r.followers, postsCount: r.postsCount };
      }, v => Array.isArray(v?.posts) && v.posts.length > 0, canPay('instagram') ? { est: APIFY_EST_USD.instagram, label: `instagram @${igHandle} (${name})` } : null);
    } catch (err) {
      log(`  Apify failed for ${name}: ${err.message}`);
      brandData.partialData = true;
      brandData.error = `Apify scrape failed: ${err.message}`;
    }
    if (ig && ig.__budgetSkipped) {
      skipped.instagram = ig.reason;
      brandData.partialData = true;
      brandData.error = `Not scraped: ${ig.reason}`;
      ig = null;
    }
    if (ig) {
      igRaw = ig.posts || [];
      igFollowers = typeof ig.followers === 'number' ? ig.followers : null;
      brandData.summary.followersEstimate = igFollowers;
      if (ig.postsCount != null) brandData.summary.estimatedPostCount = ig.postsCount;
      log(`  ${name}: ${igRaw.length} posts via Apify, followers ${igFollowers ?? 'unknown'}`);
      if (!igRaw.length) {
        brandData.error = igFollowers != null
          ? 'Post data unavailable (account may be private or scraper blocked): profile stats only'
          : 'No posts returned from Apify: account may be private, new, or inactive';
        brandData.partialData = true;
      }
    }
    igNorm = newestFirst(normalizePosts(igRaw, 'instagram'));
    brandData.platformStatus.instagram = {
      status: igNorm.length ? 'ok' : (skipped.instagram ? 'budget-skipped' : (brandData.error && /Apify scrape failed/.test(brandData.error) ? 'error' : 'no-data')),
      reason: igNorm.length ? null : brandData.error,
      ...(skipped.instagram ? { budgetSkipped: true } : {}),
      ...handleTrust(handleSources.instagram, igNorm.length ? true : null, igNorm.length ? 'scrape-returned-data' : null),
    };
  } else {
    brandData.error = noBrandAccount ? NO_BRAND_ACCOUNT_REASON : 'Could not detect Instagram handle';
    brandData.partialData = true;
  }

  if (igNorm.length > 0) {
    const normalized = igNorm;
    const totalLikes = normalized.reduce((s, p) => s + p.likes, 0);
    const totalComments = normalized.reduce((s, p) => s + p.comments, 0);
    brandData.summary.postCount = normalized.length;
    brandData.summary.avgEngagement = Math.round((totalLikes + totalComments) / normalized.length);
    const now = Date.now();
    const last30 = normalized.filter(p => p.timestamp && (now - new Date(p.timestamp)) < 30 * 24 * 3600 * 1000);
    brandData.summary.postingFrequencyPerWeek = Math.round((last30.length / 4.3) * 10) / 10;
    brandData.monthlyTrend = buildMonthlyTrend(normalized);
    brandData.contentThemes = extractContentThemes(normalized);
    brandData.postingPattern = buildPostingPattern(normalized);
    brandData.engagementByPlatform.instagram = computeEngagement(normalized, igFollowers);
    const hashtagCounts = {};
    igRaw.forEach(p => {
      const text = typeof p.caption === 'string' ? p.caption : '';
      const tags = text.match(/#[\p{L}\p{N}_]+/gu) || []; // Unicode-aware so Japanese hashtags count
      tags.forEach(t => { hashtagCounts[t] = (hashtagCounts[t] || 0) + 1; });
    });
    brandData.topHashtags = Object.entries(hashtagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count }));
    const top = [...normalized].sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments)).slice(0, 3);
    // Download images immediately while CDN URLs are fresh (platform CDN links expire). All POSTS_ANALYSED
    // posts are kept for analysis, but at most POSTS_WITH_IMAGES images are saved per brand: the top posts
    // first (the dashboard gallery shows them, so a top post must never be left with an expiring link),
    // then the newest posts that are not already among them.
    const imageSet = [...top, ...normalized.filter(p => !top.includes(p))].slice(0, POSTS_WITH_IMAGES);
    const saved = await downloadPostImages(slug, imageSet, 'rec', opts.dataDir);
    const savedFor = p => { const i = imageSet.indexOf(p); return i >= 0 && saved && saved[i] ? saved[i].imageUrl : null; };
    brandData.topPosts = top.map(tp => ({ ...tp, imageUrl: savedFor(tp) || tp.imageUrl }));
    brandData.recentPosts = normalized.map(p => ({ ...p, imageUrl: savedFor(p) }));
    log(`  ${name}: ${normalized.length} posts analysed, topPosts=${brandData.topPosts.length}, bestDay=${brandData.postingPattern?.bestDay || 'none'}`);
  }

  // Shared handling for a budget refusal on TikTok / Facebook / X.
  const budgetStatus = (platform, res) => {
    skipped[platform] = res.reason;
    return { status: 'budget-skipped', reason: `Not scraped: ${res.reason}`, budgetSkipped: true };
  };

  // ── TikTok ────────────────────────────────────────────────────────────────
  const ttHandle = existingTtHandle || brandData.tiktokHandle;
  log(`  TikTok: ${ttHandle ? '@' + ttHandle : 'not found'}`);
  let ttPosts = []; let ttFollowers = null;
  if (ttHandle) {
    advance(`TikTok @${ttHandle} (${name})`);
    let reason = null; let status = 'no-data'; let extra = {};
    try {
      const tt = await cachedStep(`tiktok:${handleKey(ttHandle)}`, async (apify) => {
        const r = toScrapeResult(await (scrapers.tiktok || scrapeTikTokViaApify)(ttHandle, apify));
        const followers = r.followers ?? r.posts.map(p => p?.authorMeta?.fans).find(n => typeof n === 'number') ?? null;
        return { posts: newestFirst(normalizePosts(r.posts, 'tiktok')), followers };
      }, v => Array.isArray(v?.posts) && v.posts.length > 0, canPay('tiktok') ? { est: APIFY_EST_USD.tiktok, label: `tiktok @${ttHandle} (${name})` } : null);
      if (tt.__budgetSkipped) ({ status, reason, ...extra } = budgetStatus('tiktok', tt));
      else if (tt.posts.length > 0) {
        ttPosts = tt.posts; ttFollowers = tt.followers;
        brandData.tiktokData = buildPlatformData(tt.posts);
        if (tt.followers != null) brandData.tiktokData.followers = tt.followers;
        brandData.engagementByPlatform.tiktok = computeEngagement(tt.posts, tt.followers);
        status = 'ok';
      } else reason = 'TikTok scrape returned no posts';
    } catch (err) { log(`  TikTok scrape failed for ${name}: ${err.message}`); reason = `TikTok scrape failed: ${err.message}`; status = 'error'; }
    brandData.platformStatus.tiktok = { status, reason, ...extra, ...handleTrust(handleSources.tiktok, status === 'ok' ? true : null, status === 'ok' ? 'scrape-returned-data' : null) };
  }

  // ── Facebook ──────────────────────────────────────────────────────────────
  const fbHandle = existingFbHandle || brandData.facebookHandle;
  log(`  Facebook: ${fbHandle ? '/' + fbHandle : 'not found'}`);
  let fbPosts = []; let fbFollowers = null;
  if (fbHandle) {
    advance(`Facebook /${fbHandle} (${name})`);
    let reason = null; let status = 'no-data'; let extra = {};
    try {
      const fb = await cachedStep(`facebook:${handleKey(fbHandle)}`, async (apify) => {
        const r = toScrapeResult(await (scrapers.facebook || scrapeFacebookViaApify)(fbHandle, apify));
        return { posts: newestFirst(normalizePosts(r.posts, 'facebook')), followers: r.followers ?? facebookFollowersFrom(r.posts) };
      }, v => Array.isArray(v?.posts) && v.posts.length > 0, canPay('facebook') ? { est: APIFY_EST_USD.facebook, label: `facebook /${fbHandle} (${name})` } : null);
      if (fb.__budgetSkipped) ({ status, reason, ...extra } = budgetStatus('facebook', fb));
      else if (fb.posts.length > 0) {
        fbPosts = fb.posts; fbFollowers = typeof fb.followers === 'number' ? fb.followers : null;
        brandData.facebookData = buildPlatformData(fb.posts);
        if (fbFollowers != null) brandData.facebookData.followers = fbFollowers;
        brandData.engagementByPlatform.facebook = computeEngagement(fb.posts, fbFollowers);
        status = 'ok';
      } else reason = 'Facebook scrape returned no posts';
    } catch (err) { log(`  Facebook scrape failed for ${name}: ${err.message}`); reason = `Facebook scrape failed: ${err.message}`; status = 'error'; }
    brandData.platformStatus.facebook = { status, reason, ...extra, ...handleTrust(handleSources.facebook, status === 'ok' ? true : null, status === 'ok' ? 'scrape-returned-data' : null) };
  }

  // ── X (Twitter) ──────────────────────────────────────────────────────────
  log(`  X: ${xHandle ? '@' + xHandle : 'not found'}`);
  let xPosts = []; let xFollowers = null;
  if (xHandle) {
    let trust = handleTrust(handleSources.x);
    if (handleSources.x === 'claude' && priorVerified.x && String(priorVerified.x).toLowerCase() === xHandle.toLowerCase()) {
      trust = handleTrust('claude', true, 'prior-scrape');
    }
    if (trust.verified !== true) {
      log(`  X @${xHandle}: suggested by Claude, no free verification exists; not scraped`);
      brandData.platformStatus.x = {
        status: 'unverified_handle',
        reason: `X handle @${xHandle} was suggested by Claude and cannot be verified for free; not scraped. Add it to profile.json to scrape it.`,
        source: null,
        ...trust,
      };
    } else {
      advance(`X @${xHandle} (${name})`);
      // Only a real actor call is paid for: a fixture, a dry run or a missing token reserves nothing.
      const xPaid = !Object.prototype.hasOwnProperty.call(fixtures, 'x') && !isDryRun(opts) && process.env.APIFY_API_TOKEN ? { est: APIFY_EST_USD.x, label: `x @${xHandle} (${name})` } : null;
      let res = await cachedStep(`x:${handleKey(xHandle)}`, async (apify) => {
        const r = await scrapeXViaApify(xHandle, { dryRun: opts.dryRun, fixture: fixtures.x, apify });
        return { posts: newestFirst(normalizePosts(r.posts, 'x')), followers: r.followers ?? null, reason: r.reason, source: r.source, notFound: !!r.notFound };
      }, v => v.posts.length > 0 || v.notFound, xPaid);
      let xBudget = null;
      if (res.__budgetSkipped) { xBudget = budgetStatus('x', res); res = { posts: [], followers: null, reason: xBudget.reason, source: null, notFound: false }; }
      xPosts = res.posts; xFollowers = res.followers;
      if (res.posts.length > 0) {
        brandData.xData = buildPlatformData(res.posts);
        if (brandData.xData && res.followers != null) brandData.xData.followers = res.followers;
        brandData.engagementByPlatform.x = computeEngagement(res.posts, res.followers);
      }
      const status = brandData.xData ? 'ok' : (res.notFound ? 'handle_not_found' : (xBudget ? 'budget-skipped' : 'no-data'));
      brandData.platformStatus.x = { status, reason: res.reason, source: res.source, ...(xBudget ? { budgetSkipped: true } : {}), ...trust };
      if (res.notFound) brandData.platformStatus.x.verified = false;
    }
  } else {
    brandData.platformStatus.x = jpBrand ? { status: 'not-applicable', reason: 'No X account found' } : notEnabled('x');
  }

  // ── YouTube ──────────────────────────────────────────────────────────────
  log(`  YouTube: ${ytRef ? `${ytRef.kind} ${ytRef.id}` : 'not found'}`);
  let ytPosts = [];
  if (ytRef) {
    advance(`YouTube ${ytRef.id} (${name})`);
    const res = await cachedStep(`youtube:${handleKey(ytRef.kind + ':' + ytRef.id)}`, async () => {
      const r = await fetchYouTubeChannel(ytRef, { dryRun: opts.dryRun, fixture: fixtures.youtube });
      return { channel: r.channel, posts: normalizePosts(r.posts, 'youtube'), reason: r.reason, source: r.source };
    }, v => !!v.channel || /channel not found/i.test(v.reason || ''));
    brandData.youtubeChannel = res.channel;
    ytPosts = newestFirst(res.posts);
    if (res.posts.length > 0) {
      brandData.youtubeData = buildPlatformData(res.posts);
      brandData.engagementByPlatform.youtube = computeEngagement(res.posts, res.channel?.subscriberCount ?? null);
    }
    const notFound = !res.channel && /channel not found/i.test(res.reason || '');
    // A guessed channel is verified only when it returned videos: a channel merely existing under
    // that name is not proof it is this brand's channel.
    const ytHasData = !!brandData.youtubeData;
    const trust = handleTrust(handleSources.youtube, ytHasData ? true : (notFound ? false : null), ytHasData ? 'scrape-returned-data' : (notFound ? 'youtube-channels-api' : null));
    brandData.platformStatus.youtube = {
      status: brandData.youtubeData ? 'ok' : (res.channel ? 'channel-only' : (notFound ? 'handle_not_found' : 'no-data')),
      reason: res.reason, source: res.source, ...trust,
    };
    if (notFound) brandData.platformStatus.youtube.verified = false;
  } else {
    brandData.platformStatus.youtube = jpBrand ? { status: 'not-applicable', reason: 'No YouTube channel found' } : notEnabled('youtube');
  }

  // ── LINE Official Account (presence only) ────────────────────────────────
  log(`  LINE: ${lineRef ? lineRef.id || lineRef.url : 'not found'}`);
  if (lineRef) {
    advance(`LINE ${lineRef.id || lineRef.url} (${name})`);
    brandData.lineAccount = await checkLinePresence(lineRef, { dryRun: opts.dryRun, fixture: fixtures.line });
    if (brandData.lineAccount.accountId) brandData.lineId = brandData.lineAccount.accountId;
    const exists = brandData.lineAccount.exists;
    // LINE has no post data, so a Claude-guessed LINE id can never be verified: a page existing
    // under that id does not prove it is this brand's account. The guess stays unverified (presence
    // is still reported, labelled as a guess) and is never written back. Trusted LINE ids come only
    // from the profile or the site's own sameAs links.
    const guessed = handleSources.line === 'claude';
    const trust = handleTrust(handleSources.line, exists === false ? false : null, exists === false ? 'line-page-check' : null);
    brandData.platformStatus.line = { status: exists === false ? 'handle_not_found' : 'presence-only', reason: brandData.lineAccount.reason, ...trust };
    if (guessed) {
      brandData.platformStatus.line.unverifiedGuess = true;
      brandData.lineAccount.unverifiedGuess = true;
      brandData.lineAccount.note = `${LINE_PRESENCE_NOTE} This LINE id was suggested by Claude and is unverified: a page existing under it does not prove it belongs to the brand.`;
    }
  } else {
    brandData.platformStatus.line = jpBrand ? { status: 'not-applicable', reason: 'No LINE Official Account found' } : notEnabled('line');
  }

  // Provenance from profile.json (stored with the handle it was recorded for): lets a report tell
  // a profile-entered handle from a Claude guess that was saved because it returned data. If the
  // profile handle was since edited by hand, the old provenance does not apply and is ignored.
  const profileInputs = profileHandleInputs(brandInfo);
  for (const [p, prov] of Object.entries(brandInfo.handleProvenance || {})) {
    if (handleSources[p] === 'profile' && brandData.platformStatus[p] && provenanceApplies(prov, profileInputs[p])) {
      brandData.platformStatus[p].provenance = prov.source;
    }
  }

  for (const k of Object.keys(brandData.engagementByPlatform)) if (!brandData.engagementByPlatform[k]) delete brandData.engagementByPlatform[k];
  Object.assign(brandData, pickBrandEngagement(brandData.engagementByPlatform));

  // Marketplace with no profile handle: every platform says why there is nothing, in one voice.
  if (noBrandAccount) {
    for (const p of BLOCK_PLATFORMS) brandData.platformStatus[p] = { status: 'not-applicable', reason: NO_BRAND_ACCOUNT_REASON };
  }

  // ── Per-platform blocks ─────────────────────────────────────────────────
  const yt = brandData.youtubeChannel;
  const block = (p, handle, posts, followers, followersReason) => {
    const st = brandData.platformStatus[p];
    return buildPlatformBlock({
      handle, posts, followers, followersReason,
      status: st?.status || (handle ? 'no-data' : 'not-applicable'),
      budgetSkipped: !!st?.budgetSkipped,
      reason: posts.length ? null : (st?.reason || (handle ? 'no posts returned' : (noBrandAccount ? NO_BRAND_ACCOUNT_REASON : 'no account found'))),
    });
  };
  brandData.platforms = {
    instagram: block('instagram', igHandle || null, igNorm, igFollowers, 'Instagram profile scraper returned no follower count'),
    tiktok: block('tiktok', ttHandle || null, ttPosts, ttFollowers, 'TikTok actor returned no follower count (authorMeta.fans)'),
    facebook: block('facebook', fbHandle || null, fbPosts, fbFollowers, 'facebook-posts-scraper does not report page followers'),
    x: block('x', xHandle || null, xPosts, xFollowers, 'X actor returned no author follower count'),
    youtube: block('youtube', brandData.youtubeHandle, ytPosts, yt?.subscriberCount ?? null, yt?.hiddenSubscriberCount ? 'channel hides its subscriber count' : 'no subscriber count returned'),
    line: {
      handle: brandData.lineId || null,
      status: brandData.platformStatus.line?.status || 'not-applicable',
      presenceOnly: true,
      exists: brandData.lineAccount ? brandData.lineAccount.exists : null,
      followers: null, posts: 0, avgInteractions: null, engagementRate: null,
      engagementRateUnit: 'percent of followers per post',
      engagementRateReason: 'LINE has no public feed or follower count',
      postsPerWeek: null, lastPostAt: null, topFormats: [], topThemes: [],
      reason: brandData.platformStatus.line?.reason || null,
    },
  };

  return brandData;
}

// ─── Carry-forward and output composition (pure) ─────────────────────────────

const PLATFORM_DATA_KEYS = { tiktok: ['tiktokData', 'tiktokHandle'], facebook: ['facebookData', 'facebookHandle'], x: ['xData', 'xHandle'], youtube: ['youtubeData', 'youtubeHandle'] };
const IG_FIELDS = ['summary', 'contentThemes', 'topHashtags', 'recentPosts', 'topPosts', 'monthlyTrend', 'postingPattern'];
// Statuses that are a deliberate decision, not a failure: never paper over them with old data.
const NO_CARRY_STATUSES = ['handle_not_found', 'unverified_handle', 'not-applicable', 'ok'];

function hasGoodData(b) {
  if (!b || typeof b !== 'object') return false;
  return (b.summary?.postCount || 0) > 0 || !!(b.tiktokData || b.facebookData || b.xData || b.youtubeData || b.youtubeChannel);
}

function sameHandle(a, b) { return !!a && !!b && String(a).replace(/^@/, '').toLowerCase() === String(b).replace(/^@/, '').toLowerCase(); }

/**
 * Pure. Never replace good prior data with a failed attempt.
 * - fresh.failed (processBrand threw): use prev whole, marked stale, when prev has good data.
 * - otherwise per platform: when the new attempt got no data for the same handle and the status is
 *   a failure (not a deliberate not-found / unverified / not-applicable), keep prev's block, stale.
 */
function carryForwardBrand(fresh, prev, now = new Date().toISOString()) {
  if (!fresh) return fresh;
  if (fresh.failed) {
    if (!hasGoodData(prev)) return fresh;
    log(`  ${fresh.name}: failed now (${fresh.error}); carrying forward previous data, marked stale`);
    return { ...prev, stale: true, lastAttempt: now, lastError: fresh.error || 'unknown error' };
  }
  if (!prev) return fresh;
  const out = { ...fresh, platformStatus: { ...(fresh.platformStatus || {}) } };
  const carried = [];
  const status = p => out.platformStatus[p]?.status;
  for (const [p, [dataKey, handleKey]] of Object.entries(PLATFORM_DATA_KEYS)) {
    if (out[dataKey] || !prev[dataKey] || !sameHandle(out[handleKey], prev[handleKey])) continue;
    if (NO_CARRY_STATUSES.includes(status(p))) continue;
    out[dataKey] = prev[dataKey];
    if (prev.platforms?.[p]) out.platforms = { ...(out.platforms || {}), [p]: { ...prev.platforms[p], stale: true } };
    if (p === 'youtube' && !out.youtubeChannel && prev.youtubeChannel) out.youtubeChannel = prev.youtubeChannel;
    out.platformStatus[p] = { ...(out.platformStatus[p] || {}), stale: true, dataFrom: prev.platformStatus?.[p]?.dataFrom || prev.scrapedAt || null, lastAttempt: now, lastError: out.platformStatus[p]?.reason || 'no data this run' };
    carried.push(p);
  }
  if (!(out.summary?.postCount > 0) && (prev.summary?.postCount || 0) > 0 && sameHandle(out.handle, prev.handle) && !NO_CARRY_STATUSES.includes(status('instagram'))) {
    for (const k of IG_FIELDS) out[k] = prev[k];
    if (prev.platforms?.instagram) out.platforms = { ...(out.platforms || {}), instagram: { ...prev.platforms.instagram, stale: true } };
    out.platformStatus.instagram = { ...(out.platformStatus.instagram || {}), stale: true, dataFrom: prev.platformStatus?.instagram?.dataFrom || prev.scrapedAt || null, lastAttempt: now, lastError: out.error || 'no data this run' };
    carried.push('instagram');
  }
  if (carried.length) {
    log(`  ${out.name}: kept previous ${carried.join(', ')} data (stale) after a failed attempt`);
    const derived = deriveEngagement(out);
    out.engagementByPlatform = { ...derived, ...Object.fromEntries(Object.entries(fresh.engagementByPlatform || {}).filter(([k]) => !carried.includes(k))) };
    Object.assign(out, pickBrandEngagement(out.engagementByPlatform));
  }
  return out;
}

// Pure: the handle inputs (profile first, then the site's sameAs links) a brand starts from, per
// platform, normalized. Stored with each brand checkpoint and compared on reuse.
const RESULT_HANDLE_FIELD = { instagram: 'handle', tiktok: 'tiktokHandle', facebook: 'facebookHandle', x: 'xHandle', youtube: 'youtubeHandle', line: 'lineId' };
function brandHandleInputs(b) {
  const sd = classifySocialLinks(b.structuredSocialLinks || []);
  const n = v => (v == null ? '' : String(v).replace(/^@/, '').toLowerCase());
  return {
    instagram: n(b.handle || sd.instagram),
    tiktok: n(b.tiktokHandle || sd.tiktok),
    facebook: n(b.facebookHandle || sd.facebook),
    x: n(b.xHandle || sd.x),
    youtube: n(youTubeRefToString(toYouTubeRef(b.youtubeHandle) || sd.youtube)),
    line: n(lineRefToString(toLineRef(b.lineId) || sd.line)),
  };
}

/**
 * Pure: may a saved brand checkpoint be reused for this brand? Only when every handle input still
 * matches: a corrected, added or removed handle misses, so the old handle's posts are never served.
 * A handle this audit itself discovered and wrote back to profile.json still matches (it equals the
 * handle the saved result used). Old-format checkpoints (no stored inputs) never match.
 * (Per-platform checkpoints also carry the handle in their key.)
 */
function brandCheckpointMatches(brand, saved) {
  if (!saved || typeof saved !== 'object' || !saved.inputs || !saved.result) return false;
  const now = brandHandleInputs(brand);
  const n = v => (v == null ? '' : String(v).replace(/^@/, '').toLowerCase());
  return Object.keys(now).every(p => {
    const cur = now[p];
    const was = saved.inputs[p] || '';
    if (cur === was) return true;
    return cur !== '' && cur === n(saved.result[RESULT_HANDLE_FIELD[p]]);
  });
}

function findPrevBrand(existing, brand) {
  const list = Array.isArray(existing?.brands) ? existing.brands : [];
  return list.find(b => b && brand.slug && b.id === brand.slug) || list.find(b => b && b.name === brand.name) || null;
}

// Handles from an earlier run that produced real posts. Counts as verification for a Claude guess.
function priorVerifiedHandles(prevBrand) {
  const out = {};
  if (prevBrand?.xHandle && (prevBrand.xData?.summary?.postCount || 0) > 0) out.x = prevBrand.xHandle;
  return out;
}

function failedBrandStub(brand, err) {
  return {
    id: brand.slug,
    name: brand.name,
    role: brand.role,
    tier: brand.role === 'target' ? 'target' : normTier(brand.tier),
    relationship: brand.role === 'target' ? 'self' : normRelationship(brand.relationship),
    platforms: {},
    handle: brand.handle || null,
    tiktokHandle: brand.tiktokHandle || null,
    facebookHandle: brand.facebookHandle || null,
    error: err.message,
    failed: true,
    partialData: true,
    contentThemes: [],
    topHashtags: [],
    recentPosts: [],
    topPosts: [],
    monthlyTrend: [],
    postingPattern: null,
    engagementRate: null,
    avgEngagementPerPost: null,
    engagementBasis: null,
    tiktokData: null,
    facebookData: null,
    xHandle: brand.xHandle || null,
    xData: null,
    youtubeHandle: youTubeRefToString(toYouTubeRef(brand.youtubeHandle)),
    youtubeChannel: null,
    youtubeData: null,
    lineId: brand.lineId || null,
    lineAccount: null,
    handleSources: {},
    platformStatus: {},
    summary: { postCount: 0, avgEngagement: 0 },
  };
}

function composeOutput({ slug, brandResults, existing, targetOnly, whiteSpaceOpportunities, competitionStrategy, analysisStatus, tierInsights = null, differentiation = null, partnerPlay = null, coverage = null }) {
  const now = new Date().toISOString();
  if (targetOnly && existing && Array.isArray(existing.brands)) {
    // Patch just the target brand entry, keep existing competitor data + analysis intact
    const patchedBrands = existing.brands.map(b => b.role === 'target' ? brandResults[0] : b);
    return { ...existing, brands: patchedBrands, generatedAt: now, analysisStatus };
  }
  return {
    generatedAt: now, brandSlug: slug, schemaVersion: 2, postsAnalysedPerPlatform: POSTS_ANALYSED,
    brands: brandResults, whiteSpaceOpportunities, competitionStrategy,
    tierInsights, differentiation, partnerPlay, coverage, analysisStatus,
  };
}

/** Pure: audit order. Target, then partners, then niche, specialty, mass, unknown, marketplace last. */
// niche first after the partner: what niche brands do is the owner's main question, so a tight budget cuts
// the marketplaces (usually no brand account at all) before it cuts niche
const AUDIT_TIER_ORDER = ['niche', 'specialty', 'mass', 'unknown', 'marketplace'];
function auditOrder(players) {
  const rank = c => (normRelationship(c.relationship) === 'partner' ? -1 : AUDIT_TIER_ORDER.indexOf(normTier(c.tier)));
  return (players || []).map((c, i) => ({ c, i })).sort((a, b) => (rank(a.c) - rank(b.c)) || (a.i - b.i)).map(x => x.c);
}

// ─── Handle provenance (pure) ────────────────────────────────────────────────
// Stored in profile.json as { <platform>: { source, handle } }. It applies only while the profile
// still holds that same handle; a hand edit makes it stale and it is dropped.

function profileHandleInputs(b) {
  return {
    instagram: b.handle, tiktok: b.tiktokHandle, facebook: b.facebookHandle, x: b.xHandle,
    youtube: youTubeRefToString(toYouTubeRef(b.youtubeHandle)), line: b.lineId,
  };
}
function competitorProfileInputs(c) {
  return profileHandleInputs({ handle: c.instagramHandle, tiktokHandle: c.tiktokHandle, facebookHandle: c.facebookHandle, xHandle: c.xHandle, youtubeHandle: c.youtubeHandle, lineId: c.lineId });
}
function targetProfileInputs(social) {
  const s = social || {};
  return profileHandleInputs({ handle: s.instagram, tiktokHandle: s.tiktok, facebookHandle: s.facebook, xHandle: s.x || s.twitter, youtubeHandle: s.youtube, lineId: s.line });
}
function provenanceApplies(prov, currentHandle) {
  if (!prov || typeof prov !== 'object' || !prov.source || !prov.handle) return false; // legacy or malformed: unknown handle
  // Inputs are already normalized per platform (YouTube as a channel URL), the same form written back.
  return !!currentHandle && handleKey(prov.handle) === handleKey(currentHandle);
}
/** Pure: keep only provenance entries whose stored handle still matches the profile. */
function pruneProvenance(provMap, inputs) {
  if (!provMap || typeof provMap !== 'object') return { value: provMap, changed: false };
  const value = {};
  for (const [p, prov] of Object.entries(provMap)) if (provenanceApplies(prov, inputs[p])) value[p] = prov;
  return { value, changed: Object.keys(value).length !== Object.keys(provMap).length };
}

// Pure: did this run's scrape of the platform return real data (not carried forward)?
function hadLiveData(r, platform) {
  const st = r.platformStatus?.[platform];
  if (st?.stale) return false;
  if (platform === 'instagram') return (r.summary?.postCount || 0) > 0;
  if (platform === 'tiktok') return (r.tiktokData?.summary?.postCount || 0) > 0;
  if (platform === 'facebook') return (r.facebookData?.summary?.postCount || 0) > 0;
  if (platform === 'x') return (r.xData?.summary?.postCount || 0) > 0;
  if (platform === 'youtube') return (r.youtubeData?.summary?.postCount || 0) > 0;
  if (platform === 'line') return false; // presence-only: no post data, so a LINE guess is never verified by data
  return false;
}

// A handle may be written back to profile.json (which outranks every other source next run) only
// when it came from a trusted source, or was a Claude guess whose scrape returned real data this
// run. Never when the platform said it does not exist. An errored, empty or skipped scrape of a
// guess writes nothing back.
function writebackBlocked(r, platform) {
  const st = r.platformStatus?.[platform];
  if (st?.status === 'handle_not_found' || st?.verified === false) return true;
  if (r.handleSources?.[platform] === 'claude') return !hadLiveData(r, platform);
  return false;
}

// Current tier and relationship from the profile win over whatever a checkpoint or prior run held.
function withPlayerFields(r, brand) {
  if (!r) return r;
  return { ...r, tier: brand.role === 'target' ? 'target' : normTier(brand.tier), relationship: brand.role === 'target' ? 'self' : normRelationship(brand.relationship) };
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Testable core of the CLI. options:
 *   slug, targetOnly, dryRun, maxCompetitors, dataDir (defaults to ./data)
 *   anthropic: client or null (default: built from ANTHROPIC_API_KEY)
 *   processBrandImpl: replaces processBrand (tests)
 *   processBrandOpts: extra processBrand opts (tests, e.g. skipPageDetection, scrapers)
 *   analyses: { contentGaps, whiteSpace, strategy } replace the Claude analysis calls (tests)
 * Returns the final output object, or null for a dry run.
 */
async function runAudit(options = {}) {
  const { slug, targetOnly = false } = options;
  const dryRun = !!options.dryRun || process.env.SOCIAL_DRY_RUN === '1';
  const dataDir = options.dataDir || DATA_DIR;
  const doProcess = options.processBrandImpl || processBrand;
  if (!slug) throw new Error('slug required');

  const profile = loadBrandData(slug, 'profile.json', dataDir);
  if (!profile) throw new Error('profile.json not found');

  log(`Starting social audit for: ${profile.name}${targetOnly ? ' (target only)' : ''}`);

  // Load brand guidelines if available
  const guidelines = loadBrandData(slug, 'brand_guidelines.json', dataDir);
  if (guidelines) log(`Loaded brand guidelines (voice: ${(guidelines.brandVoice || []).join(', ')})`);

  // 5 competitors as before; a Japan scan covers the whole seeded list (--max-competitors=N overrides).
  // Japan: the tiered player list (about 25 with approved niche brands); the Apify budget is the real limit.
  const maxCompetitors = options.maxCompetitors > 0 ? options.maxCompetitors : (isJapanMarket(profile) ? 30 : 5);
  const marketLabel = profile.market || (isJapanMarket(profile) ? 'Japan' : 'the local market');

  // Official accounts read from the target's own site outrank the profile (see OFFICIAL_HANDLES).
  const official = officialHandlesFor(profile.url) || {};
  const officialPlatforms = ['instagram', 'tiktok', 'facebook', 'x', 'youtube', 'line'].filter(p => official[p]);
  const brandsToAudit = [
    {
      slug,
      name: profile.name,
      url: profile.url,
      role: 'target',
      handle: official.instagram || profile.social?.instagram || null,
      tiktokHandle: official.tiktok || profile.social?.tiktok || null,
      facebookHandle: official.facebook || profile.social?.facebook || null,
      xHandle: official.x || profile.social?.x || profile.social?.twitter || null,
      youtubeHandle: official.youtube || profile.social?.youtube || null,
      lineId: official.line || profile.social?.line || null,
      officialPlatforms,
      handleProvenance: profile.socialProvenance || null,
      market: marketLabel,
    },
    ...(targetOnly ? [] : auditOrder((profile.identifiedCompetitors || []).filter(c => c && c.name)).slice(0, maxCompetitors).map(c => ({
      slug: c.name.toLowerCase().replace(/\s+/g, '-'),
      name: c.name,
      url: c.url,
      role: 'competitor',
      tier: normTier(c.tier),
      relationship: normRelationship(c.relationship),
      handle: c.instagramHandle || null,
      tiktokHandle: c.tiktokHandle || null,
      facebookHandle: c.facebookHandle || null,
      xHandle: c.xHandle || null,
      youtubeHandle: c.youtubeHandle || null,
      lineId: c.lineId || null,
      handleProvenance: c.handleProvenance || null,
      market: marketLabel,
    }))),
  ];

  // Official handles from the sites' own JSON-LD sameAs links (site_scraper output)
  const siteIntel = loadBrandData(slug, 'site_intelligence.json', dataDir);
  brandsToAudit.forEach(b => {
    b.structuredSocialLinks = findStructuredSocialLinks(siteIntel, b);
    if (b.structuredSocialLinks.length) log(`  ${b.name}: ${b.structuredSocialLinks.length} structured-data social links`);
  });

  // A dry run must touch nothing: no Apify, no Claude, no files, no checkpoints. Print what a real run would do.
  if (dryRun) {
    for (const b of brandsToAudit) {
      const sd = classifySocialLinks(b.structuredSocialLinks || []);
      const have = { instagram: b.handle || sd.instagram, tiktok: b.tiktokHandle || sd.tiktok, facebook: b.facebookHandle || sd.facebook, x: b.xHandle || sd.x, youtube: b.youtubeHandle || sd.youtube, line: b.lineId || sd.line };
      log(`[dry-run] ${b.role} ${b.name}: ${Object.entries(have).map(([k, v]) => `${k}=${v || 'none'}`).join(' ')}`);
    }
    // Upper-bound Apify estimate for the handles known now (discovery may add more, budget gating caps it).
    let est = 0;
    for (const b of brandsToAudit) {
      const mkt = b.role !== 'target' && isMarketplacePlayer(b);
      const sd = mkt ? emptySocialLinks() : classifySocialLinks(b.structuredSocialLinks || []);
      if (b.handle || sd.instagram) est += APIFY_EST_USD.instagram;
      if (b.tiktokHandle || sd.tiktok) est += APIFY_EST_USD.tiktok;
      if (b.facebookHandle || sd.facebook) est += APIFY_EST_USD.facebook;
      if (isJapanMarket({ market: b.market, url: b.url }) && (b.xHandle || sd.x)) est += APIFY_EST_USD.x;
    }
    log(`[dry-run] would audit ${brandsToAudit.length} brands (competitor cap ${maxCompetitors}), Apify estimate for known handles about $${est.toFixed(2)}; no Apify, Claude, checkpoint or file writes made.`);
    return null;
  }

  const anthropic = options.anthropic !== undefined ? options.anthropic
    : (process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null);
  const existing = loadBrandData(slug, 'social_intelligence.json', dataDir);
  const cp = { dataDir };

  // Progress tracking: 6 platform steps per brand (IG, TikTok, FB, X, YouTube, LINE) + 3 Claude analysis steps
  const totalSteps = brandsToAudit.length * 6 + 4;
  let stepIdx = 0;
  const startedAt = new Date().toISOString();
  writeAuditStatus(slug, { step: `Starting audit for ${profile.name}...`, stepIdx: 0, totalSteps, done: false, startedAt }, dataDir);

  function advance(step) {
    stepIdx++;
    writeAuditStatus(slug, { step, stepIdx, totalSteps, done: false, startedAt }, dataDir);
    log(`[step ${stepIdx}/${totalSteps}] ${step}`);
  }

  // One budget context for the whole run: the ledger lives under the target's slug.
  const budget = { mod: options.budget || apifyBudget, slug, opts: { dataDir }, state: { refusedReason: null } };
  const siteAccess = options.siteAccess || siteAccessDefault;
  const brandResults = [];
  for (const brand of brandsToAudit) {
    const key = brand.slug;
    const inputs = brandHandleInputs(brand);
    const saved = checkpoint.get(slug, CHECKPOINT_STEP, key, cp);
    if (brandCheckpointMatches(brand, saved)) {
      log(`${brand.name}: resumed from checkpoint (no platform calls repeated)`);
      stepIdx += 6;
      brandResults.push(withPlayerFields(carryForwardBrand(saved.result, findPrevBrand(existing, brand)), brand));
      continue;
    }
    if (saved !== undefined) log(`${brand.name}: checkpoint ignored (handles changed since it was saved)`);
    const prev = findPrevBrand(existing, brand);
    brand.priorVerified = priorVerifiedHandles(prev);
    const cache = {
      get: k => checkpoint.get(slug, CHECKPOINT_STEP, `${key}#${k}`, cp),
      put: (k, v) => checkpoint.put(slug, CHECKPOINT_STEP, `${key}#${k}`, v, cp),
    };
    let result;
    try {
      // The brand's own site is never requested when its operator blocks automated access (handles then
      // come from the profile and from structured data we already have), see utils/no_contact.js
      // A jp_proxy authorization (utils/site_access.js) lets processBrand read one page through the
      // Japanese proxy; any other blocked target is not requested at all.
      let targetMode = null;
      if (brand.role === 'target') { try { targetMode = siteAccess.accessFor(profile.url).mode; } catch { targetMode = 'denied'; } }
      const noContactTarget = brand.role === 'target' && !require('../utils/no_contact').targetContactAllowed(profile) && targetMode !== 'jp_proxy';
      result = await doProcess(brand, anthropic, advance, { siteAccess, budget, ...(options.processBrandOpts || {}), ...(noContactTarget ? { skipPageDetection: true } : {}), dryRun, cache, dataDir });
    } catch (err) {
      log(`  ${brand.name} failed: ${err.message}`);
      result = failedBrandStub(brand, err);
    }
    if (!result.failed) checkpoint.put(slug, CHECKPOINT_STEP, key, { inputs, result }, cp);
    brandResults.push(withPlayerFields(carryForwardBrand(result, prev), brand));
  }

  const targetResult = brandResults.find(b => b.role === 'target');
  // Partners stay in brandResults (coverage, partnerPlay) but are never analysed as competitors.
  const competitorResults = brandResults.filter(b => b.role === 'competitor' && b.relationship !== 'partner');

  // Write all discovered handles back to profile.json.
  // Re-read the file first so a dashboard edit made during the audit is not overwritten. Never
  // persist a Claude guess for X/YouTube/LINE unless it was verified, and never persist a handle
  // the platform reported as not found: profile.json outranks every other source next run.
  const freshProfile = loadBrandData(slug, 'profile.json', dataDir) || profile;
  const updatedProfile = { ...freshProfile };
  let handleWritebacks = 0;
  const live = r => r && !r.stale; // carried-forward records are not new evidence
  // [platform, result field, competitor profile key, target social keys (first is written)]
  const WRITEBACK = [
    ['instagram', 'handle', 'instagramHandle', ['instagram']],
    ['tiktok', 'tiktokHandle', 'tiktokHandle', ['tiktok']],
    ['facebook', 'facebookHandle', 'facebookHandle', ['facebook']],
    ['x', 'xHandle', 'xHandle', ['twitter', 'x']], // X goes into the existing `twitter` key
    ['youtube', 'youtubeHandle', 'youtubeHandle', ['youtube']],
    ['line', 'lineId', 'lineId', ['line']],
  ];
  const provenanceOf = (r, p, handle) => ({ source: (r.handleSources?.[p] === 'claude' ? 'claude-guess-returned-data' : r.handleSources?.[p]) || 'unknown', handle });
  updatedProfile.identifiedCompetitors = (freshProfile.identifiedCompetitors || []).map(c => {
    const found = brandResults.find(r => r.role === 'competitor' && r.name === c.name);
    if (!live(found)) return c;
    const updates = {};
    const prov = {};
    for (const [p, field, key] of WRITEBACK) {
      if (found[field] && !c[key] && !writebackBlocked(found, p)) { updates[key] = found[field]; prov[p] = provenanceOf(found, p, found[field]); handleWritebacks++; }
    }
    // Drop provenance recorded for a handle the user has since changed by hand.
    const keptProv = pruneProvenance(c.handleProvenance, competitorProfileInputs(c));
    if (keptProv.changed) { handleWritebacks++; updates.handleProvenance = keptProv.value; }
    if (Object.keys(prov).length) updates.handleProvenance = { ...(keptProv.value || {}), ...prov };
    return Object.keys(updates).length > 0 ? { ...c, ...updates } : c;
  });
  if (live(targetResult)) {
    const socialUpdates = {};
    const prov = {};
    for (const [p, field, , keys] of WRITEBACK) {
      if (targetResult[field] && !keys.some(k => freshProfile.social?.[k]) && !writebackBlocked(targetResult, p)) {
        socialUpdates[keys[0]] = targetResult[field]; prov[p] = provenanceOf(targetResult, p, targetResult[field]); handleWritebacks++;
      }
    }
    // Official handles correct a wrong profile value (e.g. Facebook ToysRUsJapan -> toysrusjp).
    for (const [p, field, , keys] of WRITEBACK) {
      if (!official[p] || !targetResult[field]) continue;
      const cur = keys.map(k => freshProfile.social?.[k]).find(Boolean);
      const norm = v => (p === 'youtube' ? handleKey(youTubeRefToString(toYouTubeRef(v))) : handleKey(v));
      if (!cur || norm(cur) !== norm(official[p])) {
        socialUpdates[keys[0]] = official[p];
        prov[p] = { source: `official (${OFFICIAL_HANDLES[hostOfUrl(profile.url)]?.source || 'site'}, ${OFFICIAL_HANDLES[hostOfUrl(profile.url)]?.checkedAt || ''})`.replace(/, \)$/, ')'), handle: official[p] };
        handleWritebacks++;
      }
    }
    if (Object.keys(socialUpdates).length > 0) updatedProfile.social = { ...freshProfile.social, ...socialUpdates };
    const keptProv = pruneProvenance(freshProfile.socialProvenance, targetProfileInputs(freshProfile.social));
    if (keptProv.changed) { handleWritebacks++; updatedProfile.socialProvenance = keptProv.value; }
    if (Object.keys(prov).length) updatedProfile.socialProvenance = { ...(keptProv.value || {}), ...prov };
  }
  if (handleWritebacks > 0) {
    try {
      saveBrandData(slug, 'profile.json', updatedProfile, dataDir);
      log(`  Wrote ${handleWritebacks} discovered handles back to profile.json`);
    } catch (err) { log(`  Handle write-back failed (scrape data unaffected): ${err.message}`); }
  }

  // Save the scraped data BEFORE any Claude analysis, so an analysis failure cannot discard it.
  // Until the analyses finish, the previous analyses (if any) stand, marked pending.
  if (existing) archiveData(slug, 'social_intelligence', existing, dataDir);
  const analysisStatus = { contentGaps: 'pending', whiteSpace: 'pending', strategy: 'pending', synthesis: 'pending' };
  let whiteSpaceOpportunities = existing?.whiteSpaceOpportunities ?? null;
  let competitionStrategy = existing?.competitionStrategy ?? null;
  let tierInsights = existing?.tierInsights ?? null;
  let differentiation = existing?.differentiation ?? null;
  let partnerPlay = existing?.partnerPlay ?? null;
  let budgetSummary = null;
  try { budgetSummary = budget.mod.summary(slug, { dataDir }); } catch (err) { log(`  Budget summary unavailable: ${err.message}`); }
  const coverage = buildCoverage(brandResults, budgetSummary);
  if (budget.state.refusedReason) coverage.budgetStop = budget.state.refusedReason;
  const prevTarget = existing ? (existing.brands || []).find(b => b && b.role === 'target') : null;
  if (targetResult && !(targetResult.contentGaps || []).length && prevTarget?.contentGaps?.length) targetResult.contentGaps = prevTarget.contentGaps;
  const save = () => saveBrandData(slug, 'social_intelligence.json',
    composeOutput({ slug, brandResults, existing, targetOnly, whiteSpaceOpportunities, competitionStrategy, tierInsights, differentiation, partnerPlay, coverage, analysisStatus: { ...analysisStatus, scrapeSavedAt: new Date().toISOString() } }), dataDir);
  save();
  log(`  Scrape output saved (${brandResults.length} brands) before analysis`);

  const an = options.analyses || {};
  const runAnalysis = async (label, fn) => {
    try { return { ok: true, value: await fn() }; }
    catch (err) { log(`  ${label} failed (scrape data already saved): ${err.message}`); return { ok: false, error: err.message }; }
  };
  if (anthropic) {
    if (targetResult) {
      advance('Analyzing content gaps with Claude...');
      const r = await runAnalysis('Content gap analysis', () => (an.contentGaps || generateContentGapAnalysis)(anthropic, profile.name, targetResult, competitorResults, guidelines));
      if (r.ok && Array.isArray(r.value)) { targetResult.contentGaps = r.value; analysisStatus.contentGaps = 'ok'; }
      else analysisStatus.contentGaps = targetResult.contentGaps?.length ? 'failed-kept-previous' : 'failed';
    } else analysisStatus.contentGaps = 'skipped';
    advance('Identifying white space opportunities with Claude...');
    const ws = await runAnalysis('White space analysis', () => (an.whiteSpace || generateWhiteSpaceOpportunities)(anthropic, brandResults, guidelines, marketLabel));
    if (ws.ok && ws.value) { whiteSpaceOpportunities = ws.value; analysisStatus.whiteSpace = 'ok'; }
    else analysisStatus.whiteSpace = whiteSpaceOpportunities ? 'failed-kept-previous' : 'failed';
    advance('Building competition strategy with Claude...');
    const cs = targetResult
      ? await runAnalysis('Competition strategy', () => (an.strategy || generateCompetitionStrategy)(anthropic, targetResult, competitorResults, guidelines, marketLabel))
      : { ok: false };
    if (cs.ok && cs.value) { competitionStrategy = cs.value; analysisStatus.strategy = 'ok'; }
    else analysisStatus.strategy = competitionStrategy ? 'failed-kept-previous' : 'failed';
    advance('Tier insights, differentiation and partner play with Claude...');
    if (targetOnly) analysisStatus.synthesis = 'skipped: target-only run';
    else {
      const sy = await runAnalysis('Tier synthesis', () => (an.synthesis || generateTierSynthesis)(anthropic, brandResults, coverage, guidelines, marketLabel));
      if (sy.ok && sy.value) {
        const v = enforceEvidence(sy.value, brandResults); // idempotent; also guards a stubbed or older generator
        tierInsights = v.tierInsights; differentiation = v.differentiation; partnerPlay = v.partnerPlay;
        coverage.removedCitations = v.removedCitations;
        analysisStatus.synthesis = 'ok';
      } else analysisStatus.synthesis = tierInsights ? 'failed-kept-previous' : 'failed';
    }
  } else {
    analysisStatus.contentGaps = analysisStatus.whiteSpace = analysisStatus.strategy = analysisStatus.synthesis = 'skipped: no ANTHROPIC_API_KEY';
  }

  const finalOutput = composeOutput({ slug, brandResults, existing, targetOnly, whiteSpaceOpportunities, competitionStrategy, tierInsights, differentiation, partnerPlay, coverage, analysisStatus });
  saveBrandData(slug, 'social_intelligence.json', finalOutput, dataDir);
  checkpoint.clear(slug, CHECKPOINT_STEP, cp);
  writeAuditStatus(slug, { step: 'Done', stepIdx: totalSteps, totalSteps, done: true, startedAt, completedAt: new Date().toISOString() }, dataDir);
  log(`Done. ${brandResults.length} brands audited (${brandResults.filter(b => b.stale).length} carried forward stale). TikTok data: ${brandResults.filter(b => b.tiktokData).length} brands. Facebook data: ${brandResults.filter(b => b.facebookData).length} brands. X data: ${brandResults.filter(b => b.xData).length}. YouTube data: ${brandResults.filter(b => b.youtubeData).length}. LINE presence: ${brandResults.filter(b => b.lineAccount).length}.`);
  return finalOutput;
}

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }
  const maxArg = Number((args.find(a => a.startsWith('--max-competitors=')) || '').split('=')[1]);
  try {
    await runAudit({
      slug,
      targetOnly: args.includes('--target-only'),
      dryRun: args.includes('--dry-run') || process.env.SOCIAL_DRY_RUN === '1',
      maxCompetitors: maxArg > 0 ? maxArg : undefined,
    });
  } catch (err) {
    if (/profile\.json not found/.test(err.message)) { log('ERROR: profile.json not found'); process.exit(1); }
    throw err;
  }
}

module.exports = {
  classifySocialLinks,
  findStructuredSocialLinks,
  scrapeXViaApify,
  isXHandleNotFound,
  fetchYouTubeChannel,
  checkLinePresence,
  parseLinePage,
  normalizePosts,
  buildPlatformData,
  buildPlatformCoverageContext,
  computeEngagement,
  engagementFromAverage,
  pickBrandEngagement,
  deriveEngagement,
  carryForwardBrand,
  composeOutput,
  writebackBlocked,
  hadLiveData,
  pruneProvenance,
  provenanceApplies,
  brandHandleInputs,
  brandCheckpointMatches,
  buildHandleLookupPrompt,
  processBrand,
  runAudit,
  truncateChars,
  X_ACTOR_ID,
  LANGUAGE_INSTRUCTION,
  CHECKPOINT_STEP,
  // 360 depth, tiers, budget and coverage (2026-11-18)
  POSTS_ANALYSED,
  POSTS_WITH_IMAGES,
  APIFY_EST_USD,
  OFFICIAL_HANDLES,
  NO_BRAND_ACCOUNT_REASON,
  detectFormat,
  newestFirst,
  reuseDownloadedImages,
  postsPerWeekFrom,
  formatMix,
  buildPlatformBlock,
  buildCoverage,
  buildTierEvidence,
  buildTierSynthesisPrompt,
  enforceEvidence,
  generateTierSynthesis,
  auditOrder,
  isMarketplacePlayer,
  officialHandlesFor,
  extractHrefs,
  scanPageViaFetch,
  combineRuns,
  toScrapeResult,
};

// Only run when executed directly (scheduler and server spawn it as a script); require() is side-effect free.
if (require.main === module) {
  run().catch(err => {
    log(`FATAL: ${err.message}`);
    // Best-effort: try to write error status (slug may not be in scope if args parsing failed)
    try {
      const slug = (process.argv.slice(2).find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
      if (slug) writeAuditStatus(slug, { step: `Error: ${err.message}`, done: false, error: err.message });
    } catch {}
    process.exit(1);
  });
}
