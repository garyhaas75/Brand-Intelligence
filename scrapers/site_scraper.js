/**
 * Site & Navigation Scraper — exportable multi-brand module.
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

const APIFY_STALE_HOURS = 48;

function log(msg, logFile) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line + '\n');
  }
}

async function scrapeBrand(page, brand, logFile) {
  log(`Scraping ${brand.name} — ${brand.url}`, logFile);
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
      .filter(t => t.length > 1 && t.length < 40 && !/^(sign in|log in|search|cart|bag|account|help|stores|wishlist|0|menu)/i.test(t))
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
    const isReadable = t => t.length > 3 && t.length < 200 && !t.includes('{fill:') && !t.startsWith('.cls-');
    const heroList = [...heroTexts].filter(isReadable);
    result.heroContent = {
      headline: heroList.find(t => t.length > 5 && t.length < 120) || '',
      allText: heroList.slice(0, 10),
    };

    // Promo banners
    const promoSelectors = ['[class*="promo"] *', '[class*="announcement"] *', '[class*="banner"] *', '[class*="top-bar"] *', '[class*="topbar"] *'];
    const promoTexts = new Set();
    for (const sel of promoSelectors) {
      try {
        const texts = await page.$$eval(sel, els => els.map(e => e.innerText.trim().replace(/\s+/g, ' ')).filter(t => t.length > 3 && t.length < 200));
        texts.forEach(t => promoTexts.add(t));
      } catch (_) {}
    }
    result.promoBanners = [...promoTexts].slice(0, 10);

    if (result.navigation.length === 0) {
      result.botBlocked = true;
      result.note = 'No navigation found — site may be bot-protected';
      log(`  ${brand.name}: 0 nav items — flagged as bot-blocked`, logFile);
    }

    log(`  ${brand.name}: ${result.navigation.length} nav items, hero: "${(result.heroContent.headline || '').substring(0, 50)}"`, logFile);
  } catch (err) {
    result.error = err.message;
    log(`  ERROR scraping ${brand.name}: ${err.message}`, logFile);
  }

  return result;
}

// Apify pageFunction (stringified — runs in Apify's browser)
const APIFY_PAGE_FUNCTION = `async function pageFunction(context) {
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
    try { const t = await page.$$eval(sel, els => els.map(e => e.innerText.trim().replace(/\\s+/g, ' ')).filter(t => t.length > 3 && t.length < 200)); t.forEach(x => promoSet.add(x)); } catch(_) {}
  }
  const nav = [...navMap.values()];
  return { navigation: nav, heroContent: { headline: heroTexts.find(t => t.length > 5 && t.length < 120) || '', allText: heroTexts.slice(0, 10) }, promoBanners: [...promoSet].slice(0, 10), featuredCategories: nav.map(l => l.text).filter(t => t.length > 1 && t.length < 40 && !/^(sign in|log in|search|cart|bag|account|help|stores|wishlist|0|menu)/i.test(t)).slice(0, 40) };
}`;

async function scrapeWithApifyFallback(brand, logFile) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Using Apify for ${brand.name}...`, logFile);
  const run = await apifyClient.actor('apify/playwright-scraper').call({
    startUrls: [{ url: brand.url }],
    pageFunction: APIFY_PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    maxRequestsPerCrawl: 1,
    launchContext: { launchOptions: { headless: true } },
  });
  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 1 });
  if (!items.length) throw new Error('No data returned from Apify');
  return items[0];
}

/**
 * Scrape a list of brands.
 * @param {Array} brands — [{ id, name, url, role, useApify? }]
 * @param {Object} opts — { logFile?, existingData? }
 * @returns {Array} scraped brand results
 */
async function scrapeBrands(brands, opts = {}) {
  const { logFile, existingData = {} } = opts;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const results = [];

  for (const brand of brands) {
    let brandResult;
    if (brand.useApify) {
      const cached = existingData[brand.id];
      if (cached && !brand.forceRefresh) {
        const ageHours = (Date.now() - new Date(cached.scrapedAt)) / 3600000;
        if (ageHours < APIFY_STALE_HOURS) {
          log(`  ${brand.name}: Apify cache fresh, skipping`, logFile);
          results.push(cached);
          continue;
        }
      }
      brandResult = { id: brand.id || brand.name, name: brand.name, url: brand.url, role: brand.role || 'competitor', scrapedAt: new Date().toISOString(), navigation: [], heroContent: {}, promoBanners: [], featuredCategories: [], botBlocked: false, error: null };
      try {
        const apifyData = await scrapeWithApifyFallback(brand, logFile);
        Object.assign(brandResult, apifyData);
      } catch (err) {
        brandResult.error = err.message;
        log(`  ${brand.name} Apify ERROR: ${err.message}`, logFile);
      }
    } else {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      // Skip image abort for brands that need a screenshot (target brand visual audit)
      if (!brand.takeScreenshot) {
        await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());
      }
      brandResult = await scrapeBrand(page, brand, logFile);
      // Capture viewport screenshot after page is loaded (only when requested)
      if (brand.takeScreenshot && !brandResult.error) {
        try {
          const buf = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 75 });
          brandResult.screenshotBase64 = buf.toString('base64');
          log(`  ${brand.name}: screenshot captured (${Math.round(buf.length / 1024)}KB)`, logFile);
        } catch (err) {
          log(`  ${brand.name}: screenshot failed: ${err.message}`, logFile);
        }
      }
      await context.close();
    }

    // Preserve prior good data if this run errored
    if (brandResult.error && existingData[brand.id] && !existingData[brand.id].error) {
      log(`  Keeping previous successful data for ${brand.name}`, logFile);
      results.push({ ...existingData[brand.id], lastAttempt: new Date().toISOString(), lastError: brandResult.error });
    } else {
      results.push(brandResult);
    }
  }

  await browser.close();
  return results;
}

module.exports = { scrapeBrand, scrapeBrands, scrapeWithApifyFallback };

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
  scrapeBrands(brands, { logFile }).then(results => {
    const outPath = path.join(__dirname, '../data/brands', slug, 'site_intelligence.json');
    fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), brandSlug: slug, brands: results }, null, 2));
    console.log(`Saved to ${outPath}`);
  }).catch(err => { console.error(err.message); process.exit(1); });
}
