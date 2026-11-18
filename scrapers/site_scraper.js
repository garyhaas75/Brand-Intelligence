/**
 * Site & Navigation Scraper: exportable multi-brand module.
 * Scrapes homepage nav, hero messaging, promo banners from any brand list.
 * Used by: analysis/website_audit.js, analysis/competitive_analysis.js
 *
 * Can also be run directly: node scrapers/site_scraper.js --slug=brand-slug
 */

require('dotenv').config();
const { chromium } = require('playwright');
const { ApifyClient } = require('apify-client');
const fs = require('fs');
const path = require('path');
const { fetchCategoriesFromSitemap } = require('./sitemap_categories');
const checkpoint = require('../utils/checkpoint');
const siteAccess = require('../utils/site_access');
const apifyBudget = require('../utils/apify_budget');

// One page of apify/playwright-scraper on residential proxy: about 0.05 compute units plus proxy
// traffic. Reserved generously so the cap is never under-counted.
const APIFY_SITE_ESTIMATE_USD = 0.10;

/** The log line that proves a request went through the authorized proxy route. */
function proxyLogLine(brand, access) {
  const a = (access && access.authorization) || {};
  return `  ${brand.name}: requesting ${brand.url} via Japanese proxy (authorized ${a.by || 'unknown'} ${a.at || 'unknown date'})`;
}

/**
 * Whether a nav link's text is a merchandising category. Applied to
 * featuredCategories only; raw navigation is kept whole.
 *
 * Self-contained on purpose: its source is injected into the Apify page
 * function, which runs in the browser with no access to this module.
 *   - English chrome is a prefix match, as before.
 *   - Japanese chrome (cart, login, search, signup, favourites, my page, help)
 *     and corporate noise (stores, recruiting, company, IR, news releases,
 *     contact) are contains matches, since CJK has no word boundaries.
 *   - One CJK character is a whole word ("本", "靴"), so the 2 character
 *     minimum applies only to non-CJK text.
 */
function isFeaturedCategory(t) {
  if (typeof t !== 'string') return false;
  const len = [...t].length;
  const cjk = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(t);
  if (len < (cjk ? 1 : 2) || len >= 40) return false;
  if (/^(sign in|log in|search|cart|bag|account|help|stores|wishlist|0|menu|previous|next|home)/i.test(t)) return false;
  if (/(カート|買い物かご|ログイン|ログアウト|検索|会員登録|新規登録|お気に入り|マイページ|ヘルプ|よくある(ご)?質問|ご利用ガイド|メニュー)/.test(t)) return false;
  if (/(店舗|採用|会社|企業情報|ニュースリリース|プレスリリース|お問い?合わせ|募集|ショップリスト|^ホーム$|[\u3040-\u30ff\u3400-\u9fff]店$|(^|[^A-Za-z])IR([^A-Za-z]|$))/.test(t)) return false;
  return true;
}

const APIFY_STALE_HOURS = 48;
// Per-site ceiling on the Apify residential retry. Measured: a site that yields
// comes back in ~40s; one that is genuinely hardened (Kmart) burned 188s and
// still returned nothing. 120s is comfortably above the former and cuts the latter.
const APIFY_RETRY_TIMEOUT_MS = 120 * 1000;

// Locale profile per brand. A site scraped with the wrong Accept-Language, timezone
// or exit country can serve an English/global storefront or a geo-block page, so the
// locale follows the brand. An explicit brand.locale / timezoneId / proxyCountry wins;
// otherwise it is inferred from the TLD. Unknown TLDs return {} and behave exactly as
// before (no locale override, no proxy country).
const TLD_LOCALES = {
  jp: { locale: 'ja-JP', timezoneId: 'Asia/Tokyo', proxyCountry: 'JP', acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.5' },
};

function localeFor(brand) {
  let inferred = {};
  try {
    const tld = new URL(brand.url).hostname.split('.').pop().toLowerCase();
    inferred = TLD_LOCALES[tld] || {};
  } catch (_) {}
  const out = { ...inferred };
  if (brand.locale) out.locale = brand.locale;
  if (brand.timezoneId) out.timezoneId = brand.timezoneId;
  if (brand.proxyCountry) out.proxyCountry = brand.proxyCountry;
  if (brand.acceptLanguage) out.acceptLanguage = brand.acceptLanguage;
  if (out.locale && !out.acceptLanguage) out.acceptLanguage = `${out.locale},${out.locale.split('-')[0]};q=0.9,en;q=0.5`;
  return out;
}

/**
 * A hand-made capture of a page we cannot fetch ourselves (for example a site whose operator
 * blocks automated access). Files live in data/brands/<slug>/manual_capture/<brandId>.html and
 * optionally <brandId>.png|jpg. The HTML is served to the page extractors in place of the
 * network response, so every downstream field (nav, hero, promos, SEO tags) is produced by the
 * same code as a live scrape, and the result is marked manualCapture so nobody mistakes it for
 * a live one.
 */
function manualCaptureFor(slug, brandId) {
  try {
    const dir = path.join(__dirname, '../data/brands', slug, 'manual_capture');
    const htmlPath = path.join(dir, `${brandId}.html`);
    if (!fs.existsSync(htmlPath)) return undefined;
    const shot = ['png', 'jpg', 'jpeg'].map(e => path.join(dir, `${brandId}.${e}`)).find(f => fs.existsSync(f));
    return { htmlPath, screenshotPath: shot || null, capturedAt: fs.statSync(htmlPath).mtime.toISOString() };
  } catch (_) { return undefined; }
}

function log(msg, logFile) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line + '\n');
  }
}

async function scrapeBrand(page, brand, logFile) {
  log(`Scraping ${brand.name}: ${brand.url}`, logFile);
  const result = {
    id: brand.id || brand.slug || brand.name.toLowerCase().replace(/\s+/g, '-'),
    name: brand.name,
    url: brand.url,
    role: brand.role || 'competitor',
    scrapedAt: new Date().toISOString(),
    navigation: [],
    heroContent: {},
    promoBanners: [],
    featuredCategories: [],
    botBlocked: false,
    error: null,
  };

  try {
    await page.goto(brand.url, { waitUntil: brand.waitUntil || 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(brand.extraWait || 2000);

    // Navigation
    const navSelectors = ['nav a', 'header a', '[class*="nav"] a', '[class*="menu"] a', '[role="navigation"] a'];
    const navLinks = new Map();
    for (const selector of navSelectors) {
      try {
        const links = await page.$$eval(selector, anchors =>
          anchors.map(a => ({ text: a.innerText.trim().replace(/\s+/g, ' '), href: a.href }))
                 .filter(l => l.text.length > 0 && l.text.length < 60 && !l.href.includes('javascript'))
        );
        links.forEach(l => navLinks.set(l.text.toLowerCase(), l));
      } catch (_) {}
    }
    result.navigation = [...navLinks.values()];

    result.featuredCategories = result.navigation
      .map(l => l.text)
      .filter(isFeaturedCategory)
      .slice(0, 40);

    // Hero content
    const heroSelectors = ['h1', '[class*="hero"] h1', '[class*="hero"] h2', '[class*="banner"] h1', '[class*="banner"] h2', '[class*="hero"] p'];
    const heroTexts = new Set();
    for (const sel of heroSelectors) {
      try {
        const texts = await page.$$eval(sel, els => els.map(e => e.innerText.trim().replace(/\s+/g, ' ')).filter(t => t.length > 2));
        texts.forEach(t => heroTexts.add(t));
      } catch (_) {}
    }
    const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
    const minLen = (t, latin) => (CJK_RE.test(t) ? 2 : latin);
    const isReadable = t => t.length >= minLen(t, 4) && t.length < 200 && !t.includes('{fill:') && !t.startsWith('.cls-');
    const heroList = [...heroTexts].filter(isReadable);
    result.heroContent = {
      headline: heroList.find(t => t.length >= minLen(t, 6) && t.length < 120) || '',
      allText: heroList.slice(0, 10),
    };

    // Promo banners
    const promoSelectors = ['[class*="promo"] *', '[class*="announcement"] *', '[class*="banner"] *', '[class*="top-bar"] *', '[class*="topbar"] *'];
    const promoTexts = new Set();
    for (const sel of promoSelectors) {
      try {
        const texts = await page.$$eval(sel, els => els.map(e => e.innerText.trim().replace(/\s+/g, ' ')).filter(t => t.length >= (/[\u3040-\u30ff\u3400-\u9fff]/.test(t) ? 2 : 4) && t.length < 200));
        texts.forEach(t => promoTexts.add(t));
      } catch (_) {}
    }
    result.promoBanners = [...promoTexts].slice(0, 10);

    // SEO signals
    try {
      const seoData = await page.evaluate(() => ({
        titleTag: document.title || '',
        metaDescription: document.querySelector('meta[name="description"]')?.content || '',
        h1: document.querySelector('h1')?.innerText?.trim() || '',
        canonicalTag: document.querySelector('link[rel="canonical"]')?.href || '',
        schemaMarkup: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map(s => { try { return JSON.parse(s.textContent)['@type']; } catch { return null; } })
          .filter(Boolean),
      }));
      Object.assign(result, seoData);
    } catch (_) {}

    // Structured data. JSON-LD and embedded page JSON are language-neutral and survive
    // redesigns that break CSS selectors. Collect nav/breadcrumb/list names and the
    // organisation's own social profile links (sameAs), which feeds social discovery.
    try {
      const sd = await page.evaluate(() => {
        const names = new Set(), social = new Set(), types = new Set();
        // Names count as navigation only when they sit in a SiteNavigationElement or a
        // BreadcrumbList. WebPage titles and product ItemList entries are page content, not nav.
        const walk = (n, inNav) => {
          if (!n || typeof n !== 'object') return;
          if (Array.isArray(n)) return n.forEach(x => walk(x, inNav));
          const t = [].concat(n['@type'] || []);
          t.forEach(x => types.add(x));
          const isNavNode = t.some(x => /^(SiteNavigationElement|BreadcrumbList)$/.test(x));
          const nav = inNav || isNavNode;
          if (typeof n.name === 'string' && (t.includes('SiteNavigationElement') || (inNav && t.includes('ListItem')))) names.add(n.name.trim());
          if (n.sameAs) [].concat(n.sameAs).forEach(u => typeof u === 'string' && social.add(u));
          Object.values(n).forEach(v => walk(v, nav));
        };
        document.querySelectorAll('script[type="application/ld+json"]').forEach(sc => { try { walk(JSON.parse(sc.textContent), false); } catch (_) {} });
        const next = document.getElementById('__NEXT_DATA__');
        return { names: [...names], social: [...social], types: [...types], hasNextData: !!next };
      });
      result.structuredData = {
        navNames: sd.names.filter(t => t.length > 1 && t.length < 60).slice(0, 60),
        socialLinks: sd.social.slice(0, 20),
        types: sd.types.slice(0, 20),
        hasNextData: sd.hasNextData,
      };
      // Thin DOM nav but structured data has names: use them rather than flag a block.
      const sdNames = result.structuredData.navNames.filter(isFeaturedCategory);
      if (result.navigation.length === 0 && sdNames.length >= 3) {
        result.navigation = sdNames.map(text => ({ text, href: '' }));
        result.featuredCategories = sdNames.slice(0, 40);
        result.navSource = 'structured-data';
        log(`  ${brand.name}: DOM nav empty, using ${result.navigation.length} names from structured data`, logFile);
      }
    } catch (_) {}

    if (result.navigation.length === 0) {
      result.botBlocked = true;
      result.note = 'No navigation found: site may be bot-protected';
      log(`  ${brand.name}: 0 nav items: flagged as bot-blocked`, logFile);
    }

    log(`  ${brand.name}: ${result.navigation.length} nav items, hero: "${(result.heroContent.headline || '').substring(0, 50)}"`, logFile);
  } catch (err) {
    result.error = err.message;
    log(`  ERROR scraping ${brand.name}: ${err.message}`, logFile);
  }

  return result;
}

// Apify pageFunction (stringified: runs in Apify's browser)
const APIFY_PAGE_FUNCTION = `async function pageFunction(context) {
  ${isFeaturedCategory.toString()}
  const { page } = context;
  await page.waitForTimeout(5000);
  try { await page.waitForSelector('nav, header, [class*="nav"], [class*="menu"]', { timeout: 10000 }); } catch(_) {}
  const navSelectors = ['nav a','header a','[class*="nav"] a','[class*="menu"] a','[role="navigation"] a','[class*="navigation"] a','[id*="nav"] a','a[href*="/c/"]','a[href*="/category"]','a[href*="/shop"]','a[href*="/collections"]'];
  const navMap = new Map();
  for (const selector of navSelectors) {
    try {
      const links = await page.$$eval(selector, anchors => anchors.map(a => ({ text: a.innerText.trim().replace(/\\s+/g, ' '), href: a.href })).filter(l => l.text.length > 0 && l.text.length < 60 && !l.href.includes('javascript')));
      links.forEach(l => navMap.set(l.text.toLowerCase(), l));
    } catch(_) {}
  }
  const heroTexts = [];
  for (const sel of ['h1','[class*="hero"] h1','[class*="hero"] h2','[class*="banner"] h1']) {
    try { const t = await page.$$eval(sel, els => els.map(e => e.innerText.trim().replace(/\\s+/g, ' ')).filter(t => t.length > 2)); heroTexts.push(...t); } catch(_) {}
  }
  const promoSet = new Set();
  for (const sel of ['[class*="promo"] *','[class*="announcement"] *','[class*="banner"] *','[class*="top-bar"] *']) {
    try { const t = await page.$$eval(sel, els => els.map(e => e.innerText.trim().replace(/\\s+/g, ' ')).filter(t => t.length >= (/[\\u3040-\\u30ff\\u3400-\\u9fff]/.test(t) ? 2 : 4) && t.length < 200)); t.forEach(x => promoSet.add(x)); } catch(_) {}
  }
  const nav = [...navMap.values()];
  return { navigation: nav, heroContent: { headline: heroTexts.find(t => t.length >= (/[\\u3040-\\u30ff\\u3400-\\u9fff]/.test(t) ? 2 : 6) && t.length < 120) || '', allText: heroTexts.slice(0, 10) }, promoBanners: [...promoSet].slice(0, 10), featuredCategories: nav.map(l => l.text).filter(isFeaturedCategory).slice(0, 40) };
}`;

/**
 * One page through apify/playwright-scraper. opts.slug makes it ask the per-run Apify budget first
 * (utils/apify_budget.js); a refusal throws an error with err.budgetSkipped = true and makes no call.
 * opts.client is a test seam for the ApifyClient.
 */
async function scrapeWithApifyFallback(brand, logFile, opts = {}) {
  if (!opts.client && !process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const budgetSlug = opts.slug || null;
  const budget = opts.budget || apifyBudget;
  let grant = null;
  if (budgetSlug) {
    grant = budget.reserve(budgetSlug, APIFY_SITE_ESTIMATE_USD, `site scrape ${brand.name}`);
    if (!grant.ok) {
      log(`  ${brand.name}: Apify call skipped: ${grant.reason}`, logFile);
      const e = new Error(grant.reason); e.budgetSkipped = true; throw e;
    }
  }
  const apifyClient = opts.client || new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Using Apify for ${brand.name}...`, logFile);
  let run = null;
  try {
  run = await apifyClient.actor('apify/playwright-scraper').call({
    startUrls: [{ url: brand.url }],
    pageFunction: APIFY_PAGE_FUNCTION,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
      ...(localeFor(brand).proxyCountry ? { apifyProxyCountry: localeFor(brand).proxyCountry } : {}),
    },
    maxRequestsPerCrawl: 1,
    launchContext: { launchOptions: { headless: true } },
  }, budget.callOptions(grant, {
    // Bound the run on Apify's side. Without this, a caller that gives up after its own
    // timeout leaves the actor running (and billing) until Apify's default run timeout.
    waitSecs: Math.floor(APIFY_RETRY_TIMEOUT_MS / 1000) - 10,
    timeout: Math.floor(APIFY_RETRY_TIMEOUT_MS / 1000) + 30,
  }));
  } finally {
    if (grant) { try { budget.record(budgetSlug, grant, run); } catch (e) { log(`  Apify spend not recorded: ${e.message}`, logFile); } }
  }
  if (run.status !== 'SUCCEEDED') {
    try { await apifyClient.run(run.id).abort(); } catch (_) {}
    throw new Error(`Apify run ${run.status}, no data`);
  }
  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 1 });
  if (!items.length) throw new Error('No data returned from Apify');
  return items[0];
}

// A checkpoint copy keeps the screenshot unless it is large, so a resumed target
// brand still gets its vision audit without bloating the checkpoint file.
const CHECKPOINT_SCREENSHOT_MAX_BYTES = 400 * 1024;

/** True when a scrape attempt produced nothing usable. */
// Sitemap categories, when recovered, are written into featuredCategories, so an
// empty list means neither the page nor the sitemap produced a category. That holds
// even when the page had nav links that were all filtered out as site chrome.
function isFailedResult(r) {
  if (!r) return true;
  if (r.error) return true;
  if (r.botBlocked) return true;
  return (r.featuredCategories || []).length === 0;
}

/** True when a prior result is worth keeping over a failed attempt. */
function isGoodPrior(r) {
  return !isFailedResult(r);
}

/**
 * URL in a comparable form: host lowercased, root slash added, fragment dropped,
 * query kept. Returns null for anything that is not a parseable URL.
 */
function normaliseUrl(u) {
  try { const x = new URL(String(u)); x.hash = ''; return x.href; } catch { return null; }
}

/**
 * Predicate for the one request a manual capture may answer: the brand URL itself,
 * however the browser spells it ("http://Host" is requested as "http://host/").
 * Every other URL is refused, so a manual capture makes no outbound request.
 */
function manualCaptureMatcher(brandUrl) {
  const want = normaliseUrl(brandUrl);
  return (reqUrl) => want !== null && normaliseUrl(reqUrl) === want;
}

/**
 * A brand whose operator blocks automated access (skipApifyRetry) or that is served
 * from a manual capture must get no direct request to its host: no live page load,
 * no sitemap GET. Returns the reason, or null when direct requests are allowed.
 */
function noDirectRequestReason(brand) {
  if (brand && brand.manualCapture) return 'manual capture in use';
  if (brand && brand.skipApifyRetry) return 'site blocks automated access (skipApifyRetry)';
  // host based: the same site may be a competitor in another brand's set
  if (brand && brand.url && !require('../utils/no_contact').hostAllowed(brand.url)) return 'site blocks automated access (host not requested)';
  return null;
}

/** The copy of a brand result that goes into the checkpoint file. */
function checkpointCopy(result) {
  if (!result || !result.screenshotBase64) return result;
  if (Buffer.byteLength(result.screenshotBase64, 'utf8') <= CHECKPOINT_SCREENSHOT_MAX_BYTES) return result;
  const { screenshotBase64: _, ...rest } = result;
  return { ...rest, screenshotDroppedFromCheckpoint: true };
}

/** A checkpointed result that may be reused instead of scraping again. */
function reusableCheckpoint(saved) {
  return saved && typeof saved === 'object' && !isFailedResult(saved) && !saved.stale ? saved : undefined;
}

/**
 * Never replace good prior data with a failed attempt. When this attempt failed
 * and a good previous result exists, return the previous one marked stale with
 * when and why the refresh failed. Otherwise return the attempt unchanged.
 */
function carryForward(attempt, prior, now = new Date().toISOString()) {
  if (isFailedResult(attempt) && isGoodPrior(prior)) {
    const reason = (attempt && attempt.error) || (attempt && attempt.botBlocked ? 'bot-blocked' : attempt ? 'no categories' : 'no result');
    return { ...prior, stale: true, asOf: prior.asOf || prior.scrapedAt || null, lastAttempt: now, lastError: reason };
  }
  return attempt;
}

/**
 * One line describing how current a brand's site data is, for any prompt that
 * includes that data. A carried-forward (stale) record is the old good scrape, so
 * its own botBlocked/error fields say "fine"; the stale flag must win, or the model
 * reads months-old data as live. A missing record says so instead of vanishing.
 */
function scrapeStatusLine(r) {
  if (!r) return 'NO DATA (not scraped this run and no previous data). Do not infer anything about this site.';
  if (r.stale) {
    const asOf = r.asOf || r.scrapedAt || 'unknown date';
    return `STALE (data from ${asOf}, not re-scraped: ${r.lastError || 'unknown reason'}${r.lastAttempt ? `, last attempt ${r.lastAttempt}` : ''}). Do not describe this site's content as current.`;
  }
  if (r.error) return `error: ${r.error} (no usable data)`;
  if (r.botBlocked) return r.skippedNoDirectRequest ? 'not scraped: site blocks automated access (no data)' : 'bot-blocked (limited data)';
  if ((r.featuredCategories || []).length === 0) return 'scraped, but no categories found (limited data)';
  return `success (scraped ${r.scrapedAt || 'this run'}${r.via === 'jp_proxy' ? ', via Japanese proxy' : ''}${r.manualCapture ? ', from a manual capture' : ''})`;
}

const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BLOCK_PAGE_TITLE = /just a moment|attention required|access denied|you have been blocked|are you a robot|checking your browser/i;

/**
 * A live scrape of a site the brand owner authorized for reading only through a Japanese proxy.
 * One page (the brand URL), counted against the per-module page budget, in a browser context whose
 * every request goes through the proxy. Never a direct request, never a sitemap GET, never Apify.
 */
async function scrapeViaJpProxy(brand, access, { getBrowser, logFile, proxyFor = siteAccess.playwrightProxy, takePage = siteAccess.takePage, pace = siteAccess.pace }) {
  const auth = (access && access.authorization) || {};
  const base = { id: brand.id || brand.name, name: brand.name, url: brand.url, role: brand.role || 'competitor', scrapedAt: new Date().toISOString(), navigation: [], heroContent: {}, promoBanners: [], featuredCategories: [], botBlocked: false, error: null, via: 'jp_proxy', access: { mode: 'jp_proxy', authorizedBy: auth.by || null, authorizedAt: auth.at || null } };
  if (!takePage(brand.url, access.maxPages)) {
    log(`  ${brand.name}: not requested, page budget for this site reached (${access.maxPages} per module per run)`, logFile);
    return { ...base, error: `Page budget for this site reached (${access.maxPages} per module per run)` };
  }
  let proxy;
  try { proxy = await proxyFor(); } catch (err) {
    log(`  ${brand.name}: not requested, Japanese proxy unavailable: ${err.message}`, logFile);
    return { ...base, error: `Japanese proxy unavailable: ${err.message}` };
  }
  await pace(brand.url);
  log(proxyLogLine(brand, access), logFile);
  const loc = localeFor(brand);
  let context = null;
  let result;
  try {
    context = await (await getBrowser()).newContext({
      proxy,
      ...(loc.locale ? { locale: loc.locale } : {}),
      ...(loc.timezoneId ? { timezoneId: loc.timezoneId } : {}),
      ...(loc.acceptLanguage ? { extraHTTPHeaders: { 'Accept-Language': loc.acceptLanguage } } : {}),
      userAgent: UA_DESKTOP,
      viewport: { width: 1440, height: 900 },
      ...(brand.takeScreenshot ? { deviceScaleFactor: 1.75 } : {}),
    });
    await siteAccess.guardContext(context, 'jp_proxy');
    const page = await context.newPage();
    // Images and fonts only cost proxy traffic, unless the vision audit needs the screenshot.
    if (!brand.takeScreenshot) await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());
    result = { ...base, ...(await scrapeBrand(page, brand, logFile)), via: 'jp_proxy', access: base.access };
    if (!result.error && BLOCK_PAGE_TITLE.test(result.titleTag || '')) {
      result.botBlocked = true;
      result.note = `Proxied load returned a block page ("${String(result.titleTag).slice(0, 60)}")`;
      log(`  ${brand.name}: proxied load returned a block page`, logFile);
    }
    if (brand.takeScreenshot && !result.error && !result.botBlocked) {
      try {
        const buf = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 85 });
        result.screenshotBase64 = buf.toString('base64');
        log(`  ${brand.name}: screenshot captured via Japanese proxy (${Math.round(buf.length / 1024)}KB)`, logFile);
      } catch (err) { log(`  ${brand.name}: screenshot failed: ${err.message}`, logFile); }
    }
  } catch (err) {
    result = { ...base, error: err.message };
    log(`  ${brand.name}: proxied scrape failed: ${err.message}`, logFile);
  } finally {
    if (context) { try { await context.close(); } catch (_) {} }
  }
  return result;
}

/**
 * The saved capture served in place of the network: the brand URL answers with the saved HTML and
 * every other request is refused, so this makes no outbound request at all.
 */
async function scrapeFromManualCapture(brand, { getBrowser, logFile }) {
  const context = await (await getBrowser()).newContext({ userAgent: UA_DESKTOP, viewport: { width: 1440, height: 900 } });
  try {
    await siteAccess.guardContext(context);
    const page = await context.newPage();
    const html = fs.readFileSync(brand.manualCapture.htmlPath, 'utf8');
    const isCapturedUrl = manualCaptureMatcher(brand.url);
    await page.route('**/*', route => isCapturedUrl(route.request().url())
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      : route.abort());
    log(`  ${brand.name}: using manual capture (${brand.manualCapture.capturedAt})`, logFile);
    const r = await scrapeBrand(page, brand, logFile);
    r.manualCapture = true;
    r.manualCaptureAt = brand.manualCapture.capturedAt;
    if (r.navigation.length > 0) { r.botBlocked = false; delete r.note; }
    if (brand.manualCapture.screenshotPath && brand.takeScreenshot) {
      r.screenshotBase64 = fs.readFileSync(brand.manualCapture.screenshotPath).toString('base64');
      log(`  ${brand.name}: manual screenshot used`, logFile);
    }
    return r;
  } finally {
    try { await context.close(); } catch (_) {}
  }
}

/**
 * Scrape a list of brands.
 * @param {Array} brands  [{ id, name, url, role, useApify? }]
 * @param {Object} opts   { logFile?, existingData?, collector?, slug?, checkpointStep?, checkpointDataDir?, scrapeOne? }
 *   existingData     previous results keyed by brand id; a failed brand keeps its previous good data, marked stale
 *   slug + checkpointStep  enable per-brand checkpoints (utils/checkpoint.js): each brand is saved the moment it
 *                    finishes and a later run reuses fresh good ones instead of scraping them again
 *   scrapeOne        test seam: async (brand) => result, replaces the browser scrape
 * @returns {Array} scraped brand results
 */
async function scrapeBrands(brands, opts = {}) {
  // collector, when supplied, receives each brand as it completes. A caller that
  // races this against a deadline can then still use whatever finished, instead of
  // throwing away every successful scrape because one site was slow.
  // signal (AbortSignal): a caller that gave up (deadline passed) aborts it, and this
  // loop then starts no new brand and writes no further checkpoint.
  const { logFile, existingData = {}, collector, slug, checkpointStep, checkpointDataDir, scrapeOne, signal } = opts;
  // Test seams: accessFor (route decision), launchBrowser (Playwright), apifyClient.
  const accessFor = opts.accessFor || siteAccess.accessFor;
  const budgetSlug = slug || null;
  const aborted = () => !!(signal && signal.aborted);
  const useCheckpoint = !!(slug && checkpointStep);
  const cpOpts = checkpointDataDir ? { dataDir: checkpointDataDir } : {};
  // Launch the browser only when a brand actually needs it, so a fully resumed
  // run (or a test) never starts Chromium.
  let browser = null;
  const getBrowser = async () => {
    if (!browser) browser = opts.launchBrowser ? await opts.launchBrowser() : await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    return browser;
  };
  const results = [];
  const finish = (result) => {
    results.push(result);
    if (Array.isArray(collector)) collector.push(result);
  };

  try {
  for (const brand of brands) {
    if (aborted()) { log(`  Scrape aborted by caller, not starting ${brand.name} or later brands`, logFile); break; }
    if (!brand.url) {
      // A player with no website (an approved niche candidate can have url:null): nothing to load,
      // so no browser, no sitemap, no budget reservation and no Apify call.
      log(`  ${brand.name}: no website on file, nothing to scrape`, logFile);
      finish({ id: brand.id || brand.name, name: brand.name, url: null, role: brand.role || 'competitor', scrapedAt: new Date().toISOString(), navigation: [], heroContent: {}, promoBanners: [], featuredCategories: [], botBlocked: false, error: null, noWebsite: true, note: 'No website on file' });
      continue;
    }
    if (useCheckpoint) {
      const saved = reusableCheckpoint(checkpoint.get(slug, checkpointStep, brand.id, cpOpts));
      if (saved) {
        log(`  ${brand.name}: resumed from checkpoint (${checkpointStep}, scraped ${saved.scrapedAt || 'unknown'})`, logFile);
        finish(saved);
        continue;
      }
    }
    let brandResult;
    let access = { mode: 'direct' };
    if (scrapeOne) {
      try {
        brandResult = await scrapeOne(brand);
      } catch (err) {
        brandResult = { id: brand.id, name: brand.name, url: brand.url, role: brand.role || 'competitor', scrapedAt: new Date().toISOString(), botBlocked: false, error: err.message };
      }
    } else if (brand.useApify) {
      const cached = existingData[brand.id];
      if (cached && !brand.forceRefresh) {
        const ageHours = (Date.now() - new Date(cached.scrapedAt)) / 3600000;
        if (ageHours < APIFY_STALE_HOURS) {
          log(`  ${brand.name}: Apify cache fresh, skipping`, logFile);
          finish(cached);
          continue;
        }
      }
      brandResult = { id: brand.id || brand.name, name: brand.name, url: brand.url, role: brand.role || 'competitor', scrapedAt: new Date().toISOString(), navigation: [], heroContent: {}, promoBanners: [], featuredCategories: [], botBlocked: false, error: null };
      try {
        const apifyData = await scrapeWithApifyFallback(brand, logFile, { slug: budgetSlug, client: opts.apifyClient, budget: opts.budget });
        Object.assign(brandResult, apifyData);
      } catch (err) {
        brandResult.error = err.message;
        if (err.budgetSkipped) { brandResult.budgetSkipped = true; brandResult.budgetReason = err.message; }
        log(`  ${brand.name} Apify ERROR: ${err.message}`, logFile);
      }
    } else if ((access = accessFor(brand.url)).mode === 'jp_proxy') {
      brandResult = await scrapeViaJpProxy(brand, access, { getBrowser, logFile, ...(opts.proxyFor ? { proxyFor: opts.proxyFor } : {}), ...(opts.pace ? { pace: opts.pace } : {}) });
      if (isFailedResult(brandResult) && brand.manualCapture) {
        log(`  ${brand.name}: proxied scrape unusable (${brandResult.error || (brandResult.botBlocked ? 'blocked' : 'no categories')}), falling back to the manual capture`, logFile);
        const proxyAttempt = { error: brandResult.error || null, botBlocked: !!brandResult.botBlocked, at: brandResult.scrapedAt };
        brandResult = await scrapeFromManualCapture(brand, { getBrowser, logFile });
        brandResult.proxyAttempt = proxyAttempt;
      }
    } else if (access.mode === 'denied' && !brand.manualCapture) {
      // Never requested at all (no direct request, no proxy authorization).
      log(`  ${brand.name}: skipped, no request made (${noDirectRequestReason(brand) || access.reason}) and no manual capture available`, logFile);
      brandResult = { id: brand.id || brand.name, name: brand.name, url: brand.url, role: brand.role || 'competitor', scrapedAt: new Date().toISOString(), navigation: [], heroContent: {}, promoBanners: [], featuredCategories: [], botBlocked: true, error: null, skippedNoDirectRequest: true, note: 'Site blocks automated access; supply a manual capture' };
    } else if (brand.skipApifyRetry && !brand.manualCapture) {
      // Blocked by its operator and no manual capture: do not touch the host at all.
      log(`  ${brand.name}: skipped, no direct request made (${noDirectRequestReason(brand)}) and no manual capture available`, logFile);
      brandResult = { id: brand.id || brand.name, name: brand.name, url: brand.url, role: brand.role || 'competitor', scrapedAt: new Date().toISOString(), navigation: [], heroContent: {}, promoBanners: [], featuredCategories: [], botBlocked: true, error: null, skippedNoDirectRequest: true, note: 'Site blocks automated access; supply a manual capture' };
    } else {
      const loc = localeFor(brand);
      const context = await (await getBrowser()).newContext({
        ...(loc.locale ? { locale: loc.locale } : {}),
        ...(loc.timezoneId ? { timezoneId: loc.timezoneId } : {}),
        ...(loc.acceptLanguage ? { extraHTTPHeaders: { 'Accept-Language': loc.acceptLanguage } } : {}),
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        // Retina-density capture for the brand we run vision analysis on: 1440 x 1.75
        // = 2520px, just under the model's 2576px long-edge limit, so the screenshot
        // is used at full resolution instead of being downscaled. Small on-page text
        // (CTAs, promo copy, nav labels) becomes legible to the audit.
        ...(brand.takeScreenshot ? { deviceScaleFactor: 1.75 } : {}),
      });
      // Every request this direct context makes (redirects, subresources) is checked: a hop to a
      // denied or proxy-only host is aborted, never loaded directly.
      await siteAccess.guardContext(context);
      const page = await context.newPage();
      if (brand.manualCapture) {
        // Serve the saved HTML for the brand URL and refuse everything else, so a manual
        // capture never reaches out to the (blocking) site.
        const html = fs.readFileSync(brand.manualCapture.htmlPath, 'utf8');
        const isCapturedUrl = manualCaptureMatcher(brand.url);
        await page.route('**/*', route => isCapturedUrl(route.request().url())
          ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
          : route.abort());
        log(`  ${brand.name}: using manual capture (${brand.manualCapture.capturedAt})`, logFile);
      }
      // Skip image abort for brands that need a screenshot (target brand visual audit)
      if (!brand.takeScreenshot) {
        await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());
      }
      brandResult = await scrapeBrand(page, brand, logFile);
      if (brand.manualCapture) {
        brandResult.manualCapture = true;
        brandResult.manualCaptureAt = brand.manualCapture.capturedAt;
        if (brandResult.navigation.length > 0) { brandResult.botBlocked = false; delete brandResult.note; }
      }
      // A manual screenshot replaces the live one
      if (brand.manualCapture && brand.manualCapture.screenshotPath && brand.takeScreenshot) {
        brandResult.screenshotBase64 = fs.readFileSync(brand.manualCapture.screenshotPath).toString('base64');
        log(`  ${brand.name}: manual screenshot used`, logFile);
      } else if (brand.takeScreenshot && !brandResult.error) {
        try {
          const buf = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 85 });
          brandResult.screenshotBase64 = buf.toString('base64');
          log(`  ${brand.name}: screenshot captured (${Math.round(buf.length / 1024)}KB)`, logFile);
        } catch (err) {
          log(`  ${brand.name}: screenshot failed: ${err.message}`, logFile);
        }
      }
      await context.close();

      // Direct Playwright hits these sites from a datacentre IP with no proxy, so
      // Cloudflare and friends serve a challenge page instead of the storefront -
      // which shows up as zero nav items (botBlocked) or a hard navigation error.
      // The Apify path already exists for exactly this and routes through
      // residential proxies; it was only ever reachable via an opt-in `useApify`
      // flag that nothing set, so it never ran. Retry through it automatically.
      // Sitemap first. The analysis prompts are dominated by the category list -
      // hero and promos are a line each: and retailers publish that taxonomy for
      // search engines, so it is reachable with a plain GET on sites whose pages
      // are hard-blocked. Kmart returns nothing to a residential-proxy browser
      // after ~3 minutes but yields 2,234 category URLs here in under two seconds,
      // at no cost. Try it before spending an Apify retry.
      const thinCategories = (brandResult.featuredCategories || []).length < 5;
      const sitemapBlockedReason = noDirectRequestReason(brand);
      if ((brandResult.botBlocked || brandResult.error || thinCategories) && sitemapBlockedReason) {
        log(`  ${brand.name}: sitemap lookup skipped, no direct request to this host (${sitemapBlockedReason})`, logFile);
      } else if (brandResult.botBlocked || brandResult.error || thinCategories) {
        try {
          const viaSitemap = await fetchCategoriesFromSitemap(brand.url, msg => log(msg, logFile));
          // A sitemap whose slugs are bare numeric IDs ("1001", "2005") is worse
          // than a short DOM list of real names. Keep the DOM list in that case
          // and record the sitemap only as a flag.
          const mostlyIds = viaSitemap && viaSitemap.idSlugs &&
            viaSitemap.featuredCategories.filter(n => /^[a-z]{0,3}\d{3,}[a-z0-9]*$/i.test(n)).length > viaSitemap.featuredCategories.length / 2;
          if (viaSitemap && mostlyIds && (brandResult.featuredCategories || []).length > 0) {
            brandResult.sitemapIdSlugs = true;
            brandResult.sitemapUrl = viaSitemap.sitemapUrl;
            log(`  ${brand.name}: sitemap categories are numeric IDs, keeping ${brandResult.featuredCategories.length} DOM names`, logFile);
          } else if (viaSitemap) {
            brandResult.featuredCategories = viaSitemap.featuredCategories;
            if (viaSitemap.idSlugs) brandResult.sitemapIdSlugs = true;
            brandResult.topLevelSections = viaSitemap.topLevelSections;
            brandResult.categorySource = 'sitemap';
            brandResult.sitemapUrl = viaSitemap.sitemapUrl;
            // Categories recovered, so this is no longer a dead result: but keep
            // any error visible, since hero/promo/screenshot really did fail.
            brandResult.botBlocked = false;
            delete brandResult.note;
            log(`  ${brand.name}: categories recovered from sitemap (${viaSitemap.featuredCategories.length})`, logFile);
          }
        } catch (err) {
          log(`  ${brand.name}: sitemap lookup failed: ${err.message}`, logFile);
        }
      }

      // Apify is now the last resort: only when the sitemap gave us nothing either.
      const stillNoCategories = (brandResult.featuredCategories || []).length === 0;
      const shouldRetry = stillNoCategories && (brandResult.botBlocked || brandResult.error) && process.env.APIFY_API_TOKEN && !brand.skipApifyRetry;
      if (brand.skipApifyRetry && stillNoCategories && (brandResult.botBlocked || brandResult.error)) log(`  ${brand.name}: blocked, Apify retry disabled for this brand (skipApifyRetry)`, logFile);
      if (shouldRetry) {
        log(`  ${brand.name}: ${brandResult.botBlocked ? 'bot-blocked' : 'errored'} on direct scrape: retrying via Apify residential proxy`, logFile);
        try {
          // Cap each retry. Apify runs its own internal retries against hostile
          // sites and can sit there for many minutes; without a per-site ceiling a
          // couple of stubborn competitors consume the caller's entire budget.
          const apifyCall = scrapeWithApifyFallback(brand, logFile, { slug: budgetSlug, client: opts.apifyClient, budget: opts.budget });
          apifyCall.catch(() => {}); // a late rejection after the timeout won must not become an unhandled rejection
          const apifyData = await Promise.race([
            apifyCall,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Apify retry exceeded ${APIFY_RETRY_TIMEOUT_MS / 1000}s`)), APIFY_RETRY_TIMEOUT_MS)),
          ]);
          if ((apifyData.navigation || []).length > 0) {
            // Keep the screenshot from the direct attempt: Apify does not return one.
            const { screenshotBase64 } = brandResult;
            Object.assign(brandResult, apifyData, {
              botBlocked: false,
              error: null,
              recoveredViaApify: true,
              ...(screenshotBase64 ? { screenshotBase64 } : {}),
            });
            delete brandResult.note;
            log(`  ${brand.name}: recovered via Apify: ${brandResult.navigation.length} nav items`, logFile);
          } else {
            log(`  ${brand.name}: Apify returned no navigation either: leaving as blocked`, logFile);
          }
        } catch (err) {
          // Leave the original blocked/errored result intact rather than masking it.
          if (err.budgetSkipped) { brandResult.budgetSkipped = true; brandResult.budgetReason = err.message; }
          log(`  ${brand.name}: Apify retry failed: ${err.message}`, logFile);
        }
      }
    }

    // Preserve prior good data if this run failed (errored, or blocked with no
    // categories). Applies to every path: direct, Apify and test seam alike.
    const finalResult = carryForward(brandResult, existingData[brand.id]);
    if (finalResult !== brandResult) log(`  Keeping previous successful data for ${brand.name} (stale: ${finalResult.lastError})`, logFile);
    // Save the unit the moment it finishes. A stale or failed one is saved too, for
    // visibility, but reusableCheckpoint() refuses it so the next run retries it.
    if (useCheckpoint && !aborted()) checkpoint.put(slug, checkpointStep, brand.id, checkpointCopy(finalResult), cpOpts);
    finish(finalResult);
  }
  } finally {
    if (browser) { try { await browser.close(); } catch (_) { /* already gone */ } }
  }
  return results;
}

module.exports = { scrapeBrand, scrapeBrands, scrapeWithApifyFallback, scrapeViaJpProxy, scrapeFromManualCapture, APIFY_SITE_ESTIMATE_USD, localeFor, isFeaturedCategory, APIFY_PAGE_FUNCTION, manualCaptureFor, carryForward, checkpointCopy, reusableCheckpoint, isFailedResult, noDirectRequestReason, scrapeStatusLine, manualCaptureMatcher, CHECKPOINT_SCREENSHOT_MAX_BYTES };

// ─── CLI entrypoint (standalone run) ───────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { console.error('Usage: node scrapers/site_scraper.js --slug=<brand-slug>'); process.exit(1); }

  const dataPath = path.join(__dirname, '../data/brands', slug, 'profile.json');
  if (!fs.existsSync(dataPath)) { console.error(`Profile not found for slug: ${slug}`); process.exit(1); }
  const profile = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const brands = [
    { id: slug, name: profile.name, url: profile.url, role: 'target' },
    ...(profile.identifiedCompetitors || []).map(c => ({
      id: c.name.toLowerCase().replace(/\s+/g, '-'),
      name: c.name, url: c.url, role: 'competitor',
    })),
  ];

  const logFile = path.join(__dirname, '../logs', `site_scraper_${slug}.log`);
  const outPath = path.join(__dirname, '../data/brands', slug, 'site_intelligence.json');
  let existingData = {};
  try { existingData = Object.fromEntries((JSON.parse(fs.readFileSync(outPath, 'utf8')).brands || []).filter(b => b && b.id).map(b => [b.id, b])); } catch { /* no previous output */ }
  scrapeBrands(brands, { logFile, existingData, slug }).then(results => {
    fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), brandSlug: slug, brands: results }, null, 2));
    console.log(`Saved to ${outPath}`);
  }).catch(err => { console.error(err.message); process.exit(1); });
}
