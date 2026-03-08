/**
 * Module 3 — Site & Navigation Intelligence
 * Scrapes homepage nav, categories, hero messaging, and promo banners
 * from all 6 brand sites. Saves to /data/site_intelligence.json
 */

require('dotenv').config();
const { chromium } = require('playwright');
const { ApifyClient } = require('apify-client');
const fs = require('fs');
const path = require('path');
const { isStale } = require('../utils/archive');

// Apify brands: skip if cached data is less than this many hours old
// Site nav and promos change slowly — 48h is sufficient
const APIFY_STALE_HOURS = 48;

const LOG_FILE = path.join(__dirname, '../logs/site_scraper.log');
const OUTPUT_FILE = path.join(__dirname, '../data/site_intelligence.json');

const BRANDS = [
  {
    id: 'anne_klein',
    name: 'Anne Klein',
    url: 'https://www.anneklein.com',
    role: 'ours',
    waitUntil: 'domcontentloaded',
  },
  {
    id: 'donna_karan',
    name: 'Donna Karan',
    url: 'https://www.donnakaran.com',
    role: 'competitor',
    waitUntil: 'domcontentloaded',
  },
  {
    id: 'jones_new_york',
    name: 'Jones New York',
    url: 'https://www.jny.com',
    role: 'competitor',
    waitUntil: 'domcontentloaded',
  },
  {
    id: 'ann_taylor',
    name: 'Ann Taylor',
    url: 'https://www.anntaylor.com',
    role: 'competitor',
    waitUntil: 'domcontentloaded',
    useApify: true,
  },
  {
    id: 'talbots',
    name: 'Talbots',
    url: 'https://www.talbots.com',
    role: 'competitor',
    waitUntil: 'domcontentloaded',
    useApify: true,
  },
  {
    id: 'whbm',
    name: 'White House Black Market',
    url: 'https://www.whitehouseblackmarket.com',
    role: 'competitor',
    waitUntil: 'domcontentloaded',
  },
];

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function ensureDirs() {
  [
    path.join(__dirname, '../data'),
    path.join(__dirname, '../logs'),
  ].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

async function scrapeBrand(page, brand) {
  log(`Scraping ${brand.name} — ${brand.url}`);
  const result = {
    id: brand.id,
    name: brand.name,
    url: brand.url,
    role: brand.role,
    scrapedAt: new Date().toISOString(),
    navigation: [],
    heroContent: {},
    promoBanners: [],
    featuredCategories: [],
    error: null,
  };

  try {
    await page.goto(brand.url, { waitUntil: brand.waitUntil || 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(brand.extraWait || 2000);

    // --- Navigation ---
    // Try common nav selectors across different site structures
    const navSelectors = [
      'nav a',
      'header a',
      '[class*="nav"] a',
      '[class*="menu"] a',
      '[role="navigation"] a',
    ];

    const navLinks = new Map();
    for (const selector of navSelectors) {
      try {
        const links = await page.$$eval(selector, anchors =>
          anchors
            .map(a => ({
              text: a.innerText.trim().replace(/\s+/g, ' '),
              href: a.href,
            }))
            .filter(l => l.text.length > 0 && l.text.length < 60 && !l.href.includes('javascript'))
        );
        links.forEach(l => navLinks.set(l.text.toLowerCase(), l));
      } catch (_) {
        // selector didn't match — continue
      }
    }

    result.navigation = [...navLinks.values()];
    log(`  Nav items found: ${result.navigation.length}`);

    // --- Top-level categories (unique nav labels, no URL noise) ---
    result.featuredCategories = result.navigation
      .map(l => l.text)
      .filter(t =>
        t.length > 1 &&
        t.length < 40 &&
        !/^(sign in|log in|search|cart|bag|account|help|stores|wishlist|0|menu)/i.test(t)
      )
      .slice(0, 40);

    // --- Hero / Above-the-fold content ---
    const heroSelectors = [
      'h1',
      '[class*="hero"] h1',
      '[class*="hero"] h2',
      '[class*="banner"] h1',
      '[class*="banner"] h2',
      '[class*="hero"] p',
      '[class*="hero"] [class*="headline"]',
      '[class*="hero"] [class*="tagline"]',
      '[class*="hero"] [class*="cta"]',
      '[class*="hero"] a',
    ];

    const heroTexts = new Set();
    for (const sel of heroSelectors) {
      try {
        const texts = await page.$$eval(sel, els =>
          els.map(e => e.innerText.trim().replace(/\s+/g, ' ')).filter(t => t.length > 2)
        );
        texts.forEach(t => heroTexts.add(t));
      } catch (_) {}
    }

    // Filter out SVG/CSS artifacts (e.g. ".cls-1{fill:#...}")
    const isReadableText = t =>
      t.length > 3 &&
      t.length < 200 &&
      !t.includes('{fill:') &&
      !t.includes('{stroke') &&
      !t.startsWith('.cls-') &&
      !/^[\s\d.,;:{}()]+$/.test(t);

    const heroList = [...heroTexts].filter(isReadableText);
    result.heroContent = {
      headline: heroList.find(t => t.length > 5 && t.length < 120) || '',
      allText: heroList.slice(0, 10),
    };

    // --- Promo banners (site-wide announcement bars) ---
    const promoSelectors = [
      '[class*="promo"] *',
      '[class*="announcement"] *',
      '[class*="banner"] *',
      '[class*="marquee"] *',
      '[class*="alert"] *',
      '[class*="notice"] *',
      '[class*="top-bar"] *',
      '[class*="topbar"] *',
    ];

    const promoTexts = new Set();
    for (const sel of promoSelectors) {
      try {
        const texts = await page.$$eval(sel, els =>
          els
            .map(e => e.innerText.trim().replace(/\s+/g, ' '))
            .filter(t => t.length > 3 && t.length < 200)
        );
        texts.forEach(t => promoTexts.add(t));
      } catch (_) {}
    }

    result.promoBanners = [...promoTexts].slice(0, 10);

    log(`  Hero: "${result.heroContent.headline.substring(0, 60)}..."`);
    log(`  Promo banners: ${result.promoBanners.length}`);
  } catch (err) {
    result.error = err.message;
    log(`  ERROR scraping ${brand.name}: ${err.message}`);
  }

  return result;
}

// Apify playwright-scraper pageFunction — runs inside Apify's browser with residential proxies
const APIFY_PAGE_FUNCTION = `async function pageFunction(context) {
  const { page } = context;
  // Wait longer for SPA/SFCC sites that render nav client-side
  await page.waitForTimeout(5000);
  // Also wait for any nav element to appear (up to 10s)
  try { await page.waitForSelector('nav, header, [class*="nav"], [class*="menu"]', { timeout: 10000 }); } catch(_) {}

  const navSelectors = [
    'nav a',
    'header a',
    '[class*="nav"] a',
    '[class*="menu"] a',
    '[role="navigation"] a',
    '[class*="navigation"] a',
    '[id*="nav"] a',
    '[id*="menu"] a',
    '[class*="header"] a',
    // SFCC (Salesforce Commerce Cloud) selectors
    '[class*="flyout"] a',
    '[class*="dropdown"] a',
    '[data-cmp-hook*="navigation"] a',
    '[data-nav] a',
    // Broad fallback: category-style hrefs (e.g. /c/ or /categories/)
    'a[href*="/c/"]',
    'a[href*="/category"]',
    'a[href*="/shop"]',
    'a[href*="/collections"]',
  ];
  const navMap = new Map();
  for (const selector of navSelectors) {
    try {
      const links = await page.$$eval(selector, anchors =>
        anchors.map(a => ({ text: a.innerText.trim().replace(/\\s+/g, ' '), href: a.href }))
               .filter(l => l.text.length > 0 && l.text.length < 60 && !l.href.includes('javascript'))
      );
      links.forEach(l => navMap.set(l.text.toLowerCase(), l));
    } catch(_) {}
  }

  const heroTexts = [];
  for (const sel of ['h1', '[class*="hero"] h1', '[class*="hero"] h2', '[class*="banner"] h1', '[class*="banner"] h2']) {
    try {
      const texts = await page.$$eval(sel, els => els.map(e => e.innerText.trim().replace(/\\s+/g, ' ')).filter(t => t.length > 2));
      heroTexts.push(...texts);
    } catch(_) {}
  }

  const promoSet = new Set();
  for (const sel of ['[class*="promo"] *', '[class*="announcement"] *', '[class*="banner"] *', '[class*="top-bar"] *', '[class*="topbar"] *']) {
    try {
      const texts = await page.$$eval(sel, els =>
        els.map(e => e.innerText.trim().replace(/\\s+/g, ' ')).filter(t => t.length > 3 && t.length < 200)
      );
      texts.forEach(t => promoSet.add(t));
    } catch(_) {}
  }

  const nav = [...navMap.values()];
  return {
    navigation: nav,
    heroContent: {
      headline: heroTexts.find(t => t.length > 5 && t.length < 120) || '',
      allText: heroTexts.slice(0, 10),
    },
    promoBanners: [...promoSet].slice(0, 10),
    featuredCategories: nav
      .map(l => l.text)
      .filter(t => t.length > 1 && t.length < 40 && !/^(sign in|log in|search|cart|bag|account|help|stores|wishlist|0|menu)/i.test(t))
      .slice(0, 40),
  };
}`;

async function scrapeWithApify(brand) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set in .env');
  const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Using Apify playwright-scraper for ${brand.name}...`);

  const run = await apifyClient.actor('apify/playwright-scraper').call({
    startUrls: [{ url: brand.url }],
    pageFunction: APIFY_PAGE_FUNCTION,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
    },
    maxRequestsPerCrawl: 1,
    launchContext: {
      launchOptions: { headless: true },
    },
  });

  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 1 });
  if (!items.length) throw new Error('No data returned from Apify');
  return items[0];
}

async function run() {
  ensureDirs();
  log('=== Site Scraper Started ===');

  // Load existing data so we can merge/update by brand
  let existing = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
      if (prev.brands) {
        prev.brands.forEach(b => (existing[b.id] = b));
      }
    } catch (_) {}
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];

  for (const brand of BRANDS) {
    let brandResult;

    if (brand.useApify) {
      // Check if cached Apify data is still fresh — skip if so (saves credits)
      const cached = existing[brand.id];
      if (cached && !isStale(cached.scrapedAt, APIFY_STALE_HOURS) && !process.env.FORCE_REFRESH) {
        log(`  ${brand.name}: Apify data fresh (<${APIFY_STALE_HOURS}h), using cache`);
        results.push(cached);
        continue;
      }

      // Use Apify with residential proxies to bypass Cloudflare bot protection
      brandResult = {
        id: brand.id,
        name: brand.name,
        url: brand.url,
        role: brand.role,
        scrapedAt: new Date().toISOString(),
        navigation: [],
        heroContent: {},
        promoBanners: [],
        featuredCategories: [],
        error: null,
      };
      try {
        const apifyData = await scrapeWithApify(brand);
        Object.assign(brandResult, apifyData);
        log(`  ${brand.name} (Apify): ${brandResult.navigation.length} nav items`);
      } catch (err) {
        brandResult.error = err.message;
        log(`  ${brand.name} Apify ERROR: ${err.message}`);
      }
    } else {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());
      brandResult = await scrapeBrand(page, brand);
      await context.close();
    }

    results.push(brandResult);

    // Preserve prior good data if this run errored
    if (brandResult.error && existing[brand.id] && !existing[brand.id].error) {
      log(`  Keeping previous successful data for ${brand.name}`);
      results[results.length - 1] = {
        ...existing[brand.id],
        lastAttempt: new Date().toISOString(),
        lastError: brandResult.error,
      };
    }
  }

  await browser.close();

  // Flag brands where nav came back empty without an error (bot-blocked indicator)
  results.forEach(r => {
    if (!r.error && r.navigation.length === 0) {
      r.botBlocked = true;
      r.note = 'Site returned no navigation — likely bot-protected. Use Apify actor for this brand.';
      log(`  ${r.name}: 0 nav items with no error — flagged as bot-blocked`);
    }
  });

  // --- Cross-brand category gap analysis ---
  log('Computing category gap analysis...');
  const akCategories = new Set(
    (results.find(b => b.id === 'anne_klein')?.featuredCategories || []).map(c => c.toLowerCase())
  );
  const competitorCategoryMap = {};

  results
    .filter(b => b.role === 'competitor')
    .forEach(brand => {
      (brand.featuredCategories || []).forEach(cat => {
        const key = cat.toLowerCase();
        if (!akCategories.has(key)) {
          if (!competitorCategoryMap[cat]) {
            competitorCategoryMap[cat] = { category: cat, seenAt: [] };
          }
          competitorCategoryMap[cat].seenAt.push(brand.name);
        }
      });
    });

  const categoryGaps = Object.values(competitorCategoryMap)
    .sort((a, b) => b.seenAt.length - a.seenAt.length);

  const output = {
    generatedAt: new Date().toISOString(),
    brandCount: results.length,
    brands: results,
    categoryGapAnalysis: {
      akCategoryCount: akCategories.size,
      gaps: categoryGaps,
      summary: `${categoryGaps.length} categories found on competitor sites not present in AK navigation`,
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`=== Done. Results saved to ${OUTPUT_FILE} ===`);
  log(`Category gaps found: ${categoryGaps.length}`);

  return output;
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
