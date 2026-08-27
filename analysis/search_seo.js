/**
 * Search & SEO / GEO — scrapes on-page SEO signals and runs GEO analysis.
 *
 * On-page SEO: title, meta description, H1/H2, schema markup, speed signal.
 *   - Scrapes homepage + category pages + product pages (multi-page audit)
 *   - Sitemap analysis (robots.txt + sitemap.xml)
 * Keyword Universe: ~200 terms across 8 structured categories.
 * GEO: queries Claude as an AI shopping assistant, measures brand visibility.
 * Competitor Benchmarks: Claude-generated plain-English callouts where competitors outperform target.
 * Priority Actions: Claude-ranked executive action list with impact + effort.
 *
 * Usage: node analysis/search_seo.js --slug=<brand-slug>
 */

require('dotenv').config();
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL_DEEP, MODEL_FAST, EFFORT_LOW, extractText } = require('../utils/models');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DATA_DIR = path.join(__dirname, '../data');

function log(msg) { console.log(`[search_seo] [${new Date().toISOString()}] ${msg}`); }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function loadBrandData(slug, filename) {
  const fp = path.join(DATA_DIR, 'brands', slug, filename);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function saveBrandData(slug, filename, data) {
  ensureDir(path.join(DATA_DIR, 'brands', slug));
  fs.writeFileSync(path.join(DATA_DIR, 'brands', slug, filename), JSON.stringify(data, null, 2));
}

function archiveData(slug, module, data) {
  const histDir = path.join(DATA_DIR, 'brands', slug, 'history');
  ensureDir(histDir);
  const ts = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(histDir, `${module}_${ts}.json`), JSON.stringify(data, null, 2));
}

// ─── HTTP fetch helper (no npm deps — uses built-in https/http) ───────────────

function fetchText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (e) { return reject(new Error(`Invalid URL: ${url}`)); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' } }, (res) => {
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      // Follow redirect
      if (res.statusCode >= 300 && res.headers.location) {
        return fetchText(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
  });
}

// ─── URL shape helpers ────────────────────────────────────────────────────────
//
// Shared so the sitemap classifier and the product-page discovery below cannot drift apart.
// Both used to carry /\/product[^s\/]/, which excludes Shopify's own /products/ path and so
// found zero product pages on every Shopify store we audit.
const COLLECTION_URL = /\/collections\/|\/category\/|\/categories\/|\/c\/|\/shop\//i;
const PRODUCT_URL = /\/products?\/|\/p\/[^/]|\/item\/|\/dp\/|\/sku\//i;
const CONTENT_URL = /\/pages\/|\/blogs\/|\/blog\//i;

// A page that answers with a bot wall tells us nothing about its owner's SEO. Recording the
// interstitial as their title tag is worse than recording nothing, because it flows into the
// competitor comparison as though it were a real finding.
const BLOCK_TITLES = /just a moment|attention required|access denied|are you a robot|checking your browser|pardon our interruption|captcha|cloudflare|403 forbidden|request unsuccessful|bot detection/i;
function detectBlocked(seo) {
  if (!seo || seo.error) return true;
  if (seo.titleTag && BLOCK_TITLES.test(seo.titleTag)) return true;
  // Nothing at all came back: no title, no H1, no schema, no canonical. A real homepage has
  // at least one of these.
  return !seo.titleTag && !seo.h1 && !(seo.schemaMarkup || []).length && !seo.canonicalTag;
}

// ─── Sitemap analysis ─────────────────────────────────────────────────────────

async function analyzeSitemap(baseUrl) {
  const result = {
    found: false,
    url: null,
    robotsTxtFound: false,
    sitemapInRobots: false,
    totalUrls: 0,
    byType: { product: 0, collection: 0, page: 0, other: 0 },
    childSitemapsFound: 0,
    childSitemapsRead: 0,
    issues: [],
  };

  // 1. Fetch robots.txt
  let sitemapUrlFromRobots = null;
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).href;
    const robotsTxt = await fetchText(robotsUrl, 8000);
    result.robotsTxtFound = true;
    const sitemapLine = robotsTxt.split('\n').find(l => l.toLowerCase().startsWith('sitemap:'));
    if (sitemapLine) {
      sitemapUrlFromRobots = sitemapLine.replace(/^sitemap:\s*/i, '').trim();
      result.sitemapInRobots = true;
    }
  } catch (_) {
    result.issues.push('No robots.txt found — search engines may have trouble locating your sitemap.');
  }

  // 2. Determine sitemap URL and fetch it
  const sitemapUrl = sitemapUrlFromRobots || new URL('/sitemap.xml', baseUrl).href;
  result.url = sitemapUrl;

  let sitemapXml = null;
  try {
    sitemapXml = await fetchText(sitemapUrl, 10000);
    result.found = true;
  } catch (_) {
    result.found = false;
    result.issues.push('No sitemap found — Google cannot efficiently discover all your pages. Creating one is a high-impact, one-time task your developer can complete in under an hour.');
    return result;
  }

  if (result.found && !result.sitemapInRobots) {
    result.issues.push(`Your sitemap exists but isn't listed in robots.txt — add "Sitemap: ${sitemapUrl}" to robots.txt so Google finds it automatically.`);
  }

  // 3. Handle sitemap index (contains child sitemaps)
  //
  // Two bugs used to live here. The child list was capped at 3, so an 11-part Shopify product
  // sitemap was read as "2002 URLs" and the other 9 parts, the collections sitemap and the pages
  // sitemap were never seen. And child <loc> values carry XML-escaped query strings
  // (?from=1&amp;to=2), which have to be decoded or the fetch asks for a URL the server does not
  // recognise. Read every child now, bounded by MAX_CHILD_SITEMAPS, and say so when the bound bites.
  const MAX_CHILD_SITEMAPS = 30;
  const decodeXml = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
  const locsIn = (xml) => [...xml.matchAll(/<loc>\s*(https?[^<]+)\s*<\/loc>/gi)].map(m => decodeXml(m[1].trim()));

  let allUrls = [];
  if (sitemapXml.includes('<sitemapindex')) {
    const childLocs = locsIn(sitemapXml);
    result.childSitemapsFound = childLocs.length;
    const toRead = childLocs.slice(0, MAX_CHILD_SITEMAPS);
    if (childLocs.length > toRead.length) {
      log(`Sitemap index lists ${childLocs.length} children, reading the first ${toRead.length}`);
      result.issues.push(`Your sitemap index lists ${childLocs.length} sections and this audit read the first ${toRead.length}, so the counts below are a floor, not a total.`);
    }
    let failed = 0;
    // Small parallel batches: 15 sequential fetches of a half-megabyte each is slow enough to
    // trip the module timeout on a large catalogue.
    for (let i = 0; i < toRead.length; i += 5) {
      const batch = toRead.slice(i, i + 5);
      const results = await Promise.all(batch.map(u =>
        fetchText(u, 15000).then(locsIn).catch(() => { failed++; return null; })
      ));
      results.forEach(urls => { if (urls) allUrls.push(...urls); });
    }
    result.childSitemapsRead = toRead.length - failed;
    if (failed > 0) {
      result.issues.push(`${failed} of ${toRead.length} sitemap sections could not be read, so the counts below are incomplete.`);
    }
  } else {
    allUrls = locsIn(sitemapXml);
  }

  result.totalUrls = allUrls.length;

  // 4. Classify URLs by type
  //
  // Collections are tested before products because Shopify collection URLs (/collections/x) and
  // product URLs (/products/x) both contain the word "product" in some themes. The old product
  // test was /\/product[^s\/]/, which required the next character NOT to be an "s" and therefore
  // never matched Shopify's own /products/ format: every PDP on the platform counted as zero and
  // the store was told its catalogue was missing from its sitemap.
  for (const u of allUrls) {
    if (COLLECTION_URL.test(u)) result.byType.collection++;
    else if (PRODUCT_URL.test(u)) result.byType.product++;
    else if (CONTENT_URL.test(u)) result.byType.page++;
    else result.byType.other++;
  }

  // 5. Issues
  if (result.totalUrls < 10) {
    result.issues.push(`Your sitemap only lists ${result.totalUrls} URL${result.totalUrls === 1 ? '' : 's'}, which looks incomplete for an ecommerce store. A full sitemap helps Google find all your product and category pages.`);
  }
  // Only claim the catalogue is missing when the whole sitemap was actually read. On a partial
  // read, zero products means "not in the part we saw", which is not a finding.
  const fullyRead = result.childSitemapsFound === 0 || result.childSitemapsRead === result.childSitemapsFound;
  if (result.byType.product === 0 && result.totalUrls > 0 && fullyRead) {
    result.issues.push('Your sitemap contains no product page URLs, so Google may be missing your entire product catalog. Ask your developer to ensure product pages are included.');
  }
  if (result.byType.collection === 0 && result.totalUrls > 5 && fullyRead) {
    result.issues.push('No category or collection pages found in your sitemap. These are high-traffic pages that help shoppers and Google navigate your range by topic.');
  }

  log(`Sitemap: found=${result.found}, ${result.totalUrls} URLs (product:${result.byType.product}, collection:${result.byType.collection})`);
  return result;
}

// ─── Multi-page URL discovery ─────────────────────────────────────────────────

async function discoverMultiPageUrls(profile) {
  const result = { categoryUrls: [], productUrls: [] };
  try {
    const siteIntel = loadBrandData(profile.slug, 'site_intelligence.json');
    if (!siteIntel) return result;
    const targetBrand = (siteIntel.brands || []).find(b => b.role === 'target');
    if (!targetBrand) return result;

    const baseHostname = new URL(profile.url).hostname;

    // Find category URLs from nav
    const categoryUrls = (targetBrand.navigation || [])
      .map(n => n.href)
      .filter(href => {
        try {
          const u = new URL(href);
          return u.hostname === baseHostname && /\/products\/all\/|\/collections\/|\/category\//i.test(href);
        } catch { return false; }
      })
      .slice(0, 2);
    result.categoryUrls = categoryUrls;

    // Find product URLs by crawling the first category page
    if (categoryUrls.length > 0) {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      try {
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();
        await page.goto(categoryUrls[0], { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
        const productHrefs = await page.$$eval('a[href]', (els, args) => {
          const re = new RegExp(args.pattern, 'i');
          return [...new Set(els.map(e => e.href))]
            .filter(h => {
              try {
                const u = new URL(h);
                return u.hostname === args.hostname && re.test(h);
              } catch { return false; }
            })
            .slice(0, 2);
        }, { hostname: baseHostname, pattern: PRODUCT_URL.source }).catch(() => []);
        result.productUrls = productHrefs;
        log(`Discovered product URLs: ${productHrefs.join(', ') || 'none'}`);
      } catch (err) {
        log(`Product URL discovery error: ${err.message}`);
      } finally {
        await browser.close();
      }
    }

    log(`Discovered ${result.categoryUrls.length} category URLs, ${result.productUrls.length} product URLs`);
  } catch (err) {
    log(`discoverMultiPageUrls error: ${err.message}`);
  }
  return result;
}

// ─── On-page SEO scraping ─────────────────────────────────────────────────────

async function scrapeOnPageSeoWithBrowser(url, browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const result = { url, titleTag: '', metaDescription: '', h1: '', h2s: [], schemaMarkup: [], canonicalTag: null, pageSpeedSignal: 'unknown', error: null };

  try {
    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const loadTime = Date.now() - startTime;
    result.pageSpeedSignal = loadTime < 3000 ? 'fast' : loadTime < 6000 ? 'medium' : 'slow';

    result.titleTag = await page.title().catch(() => '');
    result.metaDescription = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
    result.h1 = await page.$eval('h1', el => el.innerText.trim()).catch(() => '');
    result.h2s = await page.$$eval('h2', els => els.map(e => e.innerText.trim()).filter(t => t.length > 1).slice(0, 8)).catch(() => []);
    result.canonicalTag = await page.$eval('link[rel="canonical"]', el => el.href).catch(() => null);
    const schemas = await page.$$eval('script[type="application/ld+json"]', scripts =>
      scripts.map(s => { try { return JSON.parse(s.textContent)['@type']; } catch { return null; } }).filter(Boolean)
    ).catch(() => []);
    result.schemaMarkup = [...new Set(schemas.flat())];
    result.blocked = detectBlocked(result);
    if (result.blocked) log(`  ${url}: BLOCKED by bot protection (title="${result.titleTag.slice(0, 40)}") — excluded from comparisons`);
    else log(`  ${url}: title="${result.titleTag.slice(0, 40)}", speed=${result.pageSpeedSignal}, schema=[${result.schemaMarkup.join(',')}]`);
  } catch (err) {
    result.error = err.message;
    result.blocked = true;
    log(`  Error scraping ${url}: ${err.message}`);
  }
  await context.close();
  return result;
}

async function scrapeOnPageSeo(url) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    return await scrapeOnPageSeoWithBrowser(url, browser);
  } finally {
    await browser.close();
  }
}

async function scrapeMultiplePages(urlGroups) {
  // urlGroups: [{ url, pageType }]
  if (!urlGroups.length) return [];
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const results = [];
  try {
    for (const { url, pageType } of urlGroups) {
      log(`Scraping ${pageType} page: ${url}`);
      const seo = await scrapeOnPageSeoWithBrowser(url, browser).catch(err => ({
        url, titleTag: '', metaDescription: '', h1: '', h2s: [], schemaMarkup: [], canonicalTag: null, pageSpeedSignal: 'unknown', error: err.message,
      }));
      results.push({ ...seo, pageType });
    }
  } finally {
    await browser.close();
  }
  return results;
}

// ─── Keyword universe ─────────────────────────────────────────────────────────

async function generateKeywordUniverse(anthropic, profile, onPageSeo, competitorSeos) {
  const targetNav = (loadBrandData(profile.slug || '', 'site_intelligence.json')?.brands?.find(b => b.role === 'target')?.featuredCategories || []).slice(0, 20);
  const competitorNavs = competitorSeos.flatMap(c => c.h2s || []).slice(0, 20);
  const market = profile.market || 'their market';

  const prompt = `Generate a comprehensive keyword research list (150-200 terms total) for ${profile.name}, a ${profile.industry} brand operating in ${market}.

Context:
- Brand positioning: ${profile.positioning || 'not specified'}
- Nav categories: ${targetNav.join(', ') || 'not available'}
- Title tag: ${onPageSeo.titleTag}
- H1: ${onPageSeo.h1}
- Competitor signals: ${competitorNavs.join(', ') || 'not available'}

Return ONLY valid JSON with this exact structure (no other text):
{
  "brandTerms": ["brand name variants, misspellings, brand + category combos"],
  "categoryTerms": ["main product category keywords from the nav/site"],
  "ageGroupTerms": ["gifts and products for different ages, for example 'toys for 2 year olds', 'gifts for 8 year old boy'"],
  "occasionTerms": ["occasion-based queries, for example 'christmas toy sale', 'birthday gifts for kids', 'back to school'"],
  "topBrands": ["carried or competing brands as a shopper types them, for example 'lego duplo', 'barbie dreamhouse'"],
  "localTerms": ["how someone physically nearby searches: 'toy store near me', 'toy shop open now', and city or suburb names, for example 'toy store sydney'"],
  "competitorGapTerms": ["terms competitors likely rank for that this brand should also target"],
  "aiDiscoveryQueries": ["natural-language questions a shopper asks an AI assistant, for example 'what is the best toy store for a 5 year old', 'where can I buy lego near me'"]
}

Each category should have 15-30 terms.

IMPORTANT, how people in ${market} actually search:
Do NOT append "${market}" to terms. Someone in ${market} searching for LEGO types "lego", not "lego ${market}". Adding the country name is how a person OUTSIDE the market searches, or how an export site is found, and those terms carry almost no domestic volume. This site already targets ${market} through its domain and Google's own location signals.
Express local intent the way locals do instead: "near me", "open now", "delivery", "click and collect", and city, state or suburb names. A country name belongs in a term only when a shopper would genuinely type it, such as a query about shipping or availability from abroad. Keep at most 2 such terms in total across every category.`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 5000,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      const totalCount = Object.values(parsed).flat().length;
      log(`Keyword universe: ${totalCount} terms across ${Object.keys(parsed).length} categories`);
      return { ...parsed, totalCount };
    }
  } catch (err) { log(`Keyword generation error: ${err.message}`); }
  return { brandTerms: [], categoryTerms: [], ageGroupTerms: [], occasionTerms: [], topBrands: [], localTerms: [], competitorGapTerms: [], aiDiscoveryQueries: [], totalCount: 0 };
}

// ─── Keyword Intelligence ─────────────────────────────────────────────────────

async function generateKeywordIntelligence(anthropic, profile, keywordUniverse, siteIntel) {
  // Extract nav slugs from site_intelligence.json for the target brand
  const targetEntry = (siteIntel?.brands || []).find(b => b.role === 'target') || {};
  const navHrefs = (targetEntry.navigation || []).map(n => n.href).filter(Boolean);
  const targetHostname = (() => { try { return new URL(profile.url).hostname; } catch { return ''; } })();
  const categoryNavSlugs = navHrefs
    .filter(h => { try { return new URL(h).hostname === targetHostname && h.includes('/products/all/'); } catch { return false; } })
    .map(h => h.split('/products/all/')[1]?.split('?')[0])
    .filter(Boolean);

  // Cap each category to 20 terms to keep input tokens manageable
  const cap = (arr) => (arr || []).slice(0, 20);
  const kwJson = JSON.stringify({
    brandTerms: cap(keywordUniverse.brandTerms),
    categoryTerms: cap(keywordUniverse.categoryTerms),
    ageGroupTerms: cap(keywordUniverse.ageGroupTerms),
    occasionTerms: cap(keywordUniverse.occasionTerms),
    topBrands: cap(keywordUniverse.topBrands),
    localTerms: cap(keywordUniverse.localTerms),
    competitorGapTerms: cap(keywordUniverse.competitorGapTerms),
    aiDiscoveryQueries: cap(keywordUniverse.aiDiscoveryQueries),
  });

  const prompt = `You are an expert SEO strategist analyzing keyword opportunities for ${profile.name} (${profile.url}), a ${profile.industry} brand in ${profile.market || 'the local market'}.

EXISTING SITE NAVIGATION (categories already covered on the site):
${categoryNavSlugs.length ? categoryNavSlugs.map(s => `- /products/all/${s}`).join('\n') : '- No structured category navigation detected'}

KEYWORD UNIVERSE (${keywordUniverse.totalCount || 0} total terms):
${kwJson}

Your job: analyze this keyword universe and produce a structured intelligence report.

Return ONLY a valid JSON object with this exact structure:
{
  "opportunitySummary": {
    "quickWins": <number of clusters that are quick wins>,
    "contentToCreate": <number of clusters needing new content>,
    "contentGaps": <number of high-value gaps with no existing page>,
    "totalOpportunities": <total number of meaningful keyword clusters>
  },
  "clusters": [
    {
      "id": "cluster-1",
      "name": "<descriptive cluster name, 2-5 words>",
      "intent": "transactional|commercial|informational|navigational",
      "competition": "low|medium|high",
      "opportunity": "high|medium|low",
      "hasExistingPage": true|false,
      "contentGap": "<plain English description of what's missing or weak, 1-2 sentences>",
      "contentType": "category-page|blog-post|landing-page|faq-page|product-page",
      "recommendation": "<specific, executive-friendly action. What to create/fix and why it matters to the business. 2-3 sentences max.>",
      "estimatedMonthlySearches": "<e.g. 500-2000 or 'Low' or 'Medium'>",
      "isQuickWin": true|false,
      "keywords": ["<up to 8 representative keywords from the universe for this cluster>"]
    }
  ],
  "topContentGaps": [
    {
      "title": "<gap title>",
      "description": "<plain English: what searches exist that the site is missing, and why it matters>",
      "estimatedMonthlySearches": "<volume estimate>",
      "recommendedContentType": "category-page|blog-post|landing-page|faq-page|product-page",
      "exampleKeywords": ["<3-5 keywords>"]
    }
  ]
}

Rules:
- Create 10-15 clusters covering the full keyword universe
- Mark isQuickWin=true only for clusters where: (a) the page already exists but needs optimization, OR (b) it's a high-intent term with low competition
- topContentGaps: list the 4-5 biggest missed opportunities where the brand has no page
- hasExistingPage: true only if a matching /products/all/ slug exists in the navigation list above
- Keep all text executive-friendly — no technical jargon
- Estimates don't need to be precise — relative ranges (200-500, 1000-3000) are fine for a ${profile.market || 'local'} market`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 9000,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      log(`Keyword intelligence: ${parsed.clusters?.length || 0} clusters, ${parsed.topContentGaps?.length || 0} content gaps`);
      return parsed;
    }
  } catch (err) { log(`Keyword intelligence error: ${err.message}`); }
  return null;
}

// ─── GEO analysis ─────────────────────────────────────────────────────────────

function analyzeAgentResponse(response, brandName, competitorNames) {
  if (!response) return { brandMentioned: false, mentionPosition: null, sentiment: 'not_mentioned', competitorMentions: [], snippet: '' };
  const lower = response.toLowerCase();
  const brandMentioned = lower.includes(brandName.toLowerCase());
  let mentionPosition = null;
  let sentiment = 'not_mentioned';
  if (brandMentioned) {
    const sentences = response.split(/[.!?]/);
    mentionPosition = sentences.findIndex(s => s.toLowerCase().includes(brandName.toLowerCase())) + 1;
    const idx = lower.indexOf(brandName.toLowerCase());
    const ctx = response.slice(Math.max(0, idx - 60), idx + 120).toLowerCase();
    sentiment = /excellent|great|top|best|highly|recommend|strong|quality|popular|favorite|leading/.test(ctx) ? 'positive'
      : /avoid|poor|limited|overpriced|decline|outdated|bad/.test(ctx) ? 'negative'
      : 'neutral';
  }
  const competitorMentions = competitorNames.filter(c => lower.includes(c.toLowerCase()));
  const snippet = response.slice(0, 300);
  return { brandMentioned, mentionPosition, sentiment, competitorMentions, snippet };
}

async function runGeoAnalysis(anthropic, profile, keywordUniverse) {
  const brandName = profile.name;
  const competitorNames = (profile.identifiedCompetitors || []).slice(0, 8).map(c => c.name);
  const aiQueries = (keywordUniverse.aiDiscoveryQueries || []).slice(0, 10);

  const queryGenPrompt = `Generate 20 realistic search queries that a customer might use when looking for a ${profile.industry} brand like ${profile.name} (${profile.market || ''}).

Include these categories (4-5 queries each): brand discovery, category/product search, occasion-based, comparison/alternatives, local market.

Return a JSON array only:
[{"id": "q1", "category": "brand discovery", "query": "the search query"}]`;

  let queries = [];
  try {
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 3000,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: queryGenPrompt }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) queries = JSON.parse(raw.slice(start, end + 1));
  } catch (_) { log('Could not generate dynamic queries'); }

  const extraQueries = aiQueries.map((q, i) => ({ id: `ai${i}`, category: 'ai discovery', query: q }));
  const allQueries = [...queries, ...extraQueries].slice(0, 30);

  if (allQueries.length === 0) {
    allQueries.push(
      { id: 'q1', category: 'brand discovery', query: `best ${profile.industry} stores in ${profile.market || 'my area'}` },
      { id: 'q2', category: 'comparison', query: `${brandName} alternatives` },
    );
  }

  log(`Running GEO analysis: ${allQueries.length} queries via Claude`);

  const claudeResults = [];

  for (const q of allQueries) {
    log(`  Query: "${q.query.slice(0, 50)}"`);
    try {
      const msg = await anthropic.messages.create({
        model: MODEL_FAST,
        max_tokens: 2500,
        system: 'You are a helpful shopping assistant. Give honest, specific recommendations mentioning real brands.',
        messages: [{ role: 'user', content: q.query }],
      });
      const analysis = analyzeAgentResponse(extractText(msg), brandName, competitorNames);
      claudeResults.push({ ...q, agent: 'claude', ...analysis });
      log(`    Claude: ${brandName} ${analysis.brandMentioned ? 'mentioned' : 'NOT mentioned'}`);
    } catch (err) {
      claudeResults.push({ ...q, agent: 'claude', brandMentioned: false, sentiment: 'not_mentioned', competitorMentions: [], snippet: '', error: err.message });
    }
  }

  const claudeScore = allQueries.length > 0 ? Math.round((claudeResults.filter(r => r.brandMentioned).length / allQueries.length) * 100) : 0;
  // Single-agent measurement. combinedScore is retained as the field the dashboard
  // reads, and now simply equals the Claude score.
  const combinedScore = claudeScore;

  const missedCategories = [...new Set(claudeResults.filter(r => !r.brandMentioned).map(r => r.category))];
  const gapRecommendations = [
    `Brand is visible in ${combinedScore}% of AI shopping queries — ${combinedScore < 30 ? 'critically low' : combinedScore < 60 ? 'below average' : 'good'} GEO visibility`,
    ...missedCategories.map(cat => `Improve visibility for "${cat}" queries with targeted content`),
    'Add FAQ schema and product schema markup to improve AI assistant indexing',
    'Create comparison-style content (e.g., "Why choose [Brand]") to capture comparison queries',
    'Ensure brand Wikipedia/Wikidata entry is accurate and up to date',
  ].slice(0, 6);

  return {
    queriesTested: allQueries.length,
    byAgent: {
      claude: { visibilityScore: claudeScore, queries: claudeResults },
    },
    combinedScore,
    gapRecommendations,
    queries: claudeResults,
    visibilityScore: claudeScore,
  };
}

// ─── Competitor benchmarks ────────────────────────────────────────────────────

async function generateCompetitorBenchmarks(anthropic, profile, onPageSeo, competitorSeos) {
  if (!competitorSeos.length) return [];

  // A competitor behind Cloudflare returns "Just a moment..." as its title and nothing else.
  // Feeding that to the model produced confident findings about competitors we never actually
  // read, including the reassuring and false "all competitors have weak or missing H1s too".
  // Blocked sites are excluded here and reported separately so the gap in coverage is visible
  // rather than disguised as data.
  const usable = competitorSeos.filter(c => !c.blocked);
  const blocked = competitorSeos.filter(c => c.blocked).map(c => c.name);
  if (blocked.length) log(`Competitor benchmarks: excluding ${blocked.join(', ')} (bot-blocked or unreadable)`);
  if (!usable.length) {
    log('Competitor benchmarks: no readable competitor sites, skipping');
    return [];
  }

  // Build a structured comparison table for the prompt
  const signals = ['titleTag', 'metaDescription', 'h1', 'schemaMarkup', 'canonicalTag', 'pageSpeedSignal'];
  const signalLabels = { titleTag: 'Title Tag', metaDescription: 'Meta Description', h1: 'H1 Heading', schemaMarkup: 'Schema Markup', canonicalTag: 'Canonical Tag', pageSpeedSignal: 'Page Speed' };

  const rows = signals.map(sig => {
    const targetVal = Array.isArray(onPageSeo[sig]) ? onPageSeo[sig].join(', ') : (onPageSeo[sig] || '');
    const compVals = usable.map(c => ({
      name: c.name,
      value: Array.isArray(c[sig]) ? c[sig].join(', ') : (c[sig] || ''),
    }));
    return { signal: signalLabels[sig], target: targetVal, competitors: compVals };
  });

  const table = rows.map(r =>
    `${r.signal}:\n  ${profile.name}: "${r.target || 'MISSING'}"\n${r.competitors.map(c => `  ${c.name}: "${c.value || 'MISSING'}"`).join('\n')}`
  ).join('\n\n');

  const prompt = `You are an SEO consultant preparing a plain-English briefing for a non-technical executive.

Below is a comparison of on-page SEO signals between ${profile.name} (the target brand) and the competitors whose sites we could read.

${table}

Identify the signals where a competitor clearly outperforms ${profile.name}. Return between 0 and 5 of them: return only the ones that are genuinely true from the values above, and return an empty array if there are none. Do not pad the list.

Rules:
- Compare only against the competitors listed. Do not comment on competitors that are not in the table, and never claim something about "all competitors".
- Every claim must be supported by the actual values shown. Do not infer anything the values do not say.
- Avoid technical jargon. Write as if explaining to a CEO who has never heard of SEO.

For each one, give the concrete fix, not just the diagnosis. The recommendation must be specific enough to hand to whoever owns the site: for a title or description, write the replacement text out in full.

Return ONLY a JSON array:
[
  {
    "signal": "Signal name",
    "competitorName": "Competitor name",
    "competitorValue": "Their actual value",
    "targetValue": "Target's value or 'Missing'",
    "callout": "Plain English explanation of what they do better and why it costs ${profile.name} (2-3 sentences max)",
    "recommendation": "The specific change to make, written out ready to use",
    "effort": "Quick Win|Medium|Large"
  }
]`;

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
      const benchmarks = JSON.parse(raw.slice(start, end + 1));
      log(`Competitor benchmarks: ${benchmarks.length} callouts generated from ${usable.length} readable competitor(s)`);
      return benchmarks;
    }
  } catch (err) { log(`Competitor benchmarks error: ${err.message}`); }
  return [];
}

// ─── Priority actions ─────────────────────────────────────────────────────────

function buildFallbackPriorityActions(onPageSeo, sitemapAnalysis, pageAnalyses) {
  const actions = [];
  if (!onPageSeo.metaDescription) {
    actions.push({ rank: 1, action: 'Write a meta description for every page — 140–160 characters summarizing what you sell and why shoppers should choose you.', impact: 'High', why: 'This is the text Google shows under your link in search results. Without it, Google picks random page text, which looks unprofessional and gets far fewer clicks.', effort: 'Quick Win' });
  }
  if (!onPageSeo.h1) {
    actions.push({ rank: actions.length + 1, action: `Add an H1 heading to your homepage: one clear headline naming what you sell and who for, such as "Toys, Games and Gifts for Every Age".`, impact: 'High', why: 'The H1 is the most important on-page signal Google uses to understand what a page is about. Every page should have exactly one.', effort: 'Quick Win' });
  }
  if (onPageSeo.pageSpeedSignal === 'slow') {
    actions.push({ rank: actions.length + 1, action: 'Improve page load speed — work with your developer to compress images and reduce JavaScript bundle size.', impact: 'High', why: 'Google uses speed as a direct ranking factor. Slow pages also lose roughly 7% of visitors per second of delay before they even see your products.', effort: '1-2 weeks' });
  }
  if (sitemapAnalysis && !sitemapAnalysis.found) {
    actions.push({ rank: actions.length + 1, action: 'Create and submit an XML sitemap that lists all your product, category, and content pages.', impact: 'High', why: 'Without a sitemap, Google has to discover your pages by crawling links — it will miss many. A sitemap ensures every product page gets indexed.', effort: 'Quick Win' });
  }
  if (!onPageSeo.canonicalTag) {
    actions.push({ rank: actions.length + 1, action: 'Add canonical tags to all pages to tell Google which URL is the "master" version when products appear at multiple URLs.', impact: 'Medium', why: 'Ecommerce sites often have the same product at many URLs (with filters, sorting, etc.). Without canonical tags, Google splits ranking credit across all of them.', effort: 'Quick Win' });
  }
  return actions.slice(0, 5);
}

async function generatePriorityActions(anthropic, profile, allData) {
  const { onPageSeo, pageAnalyses, sitemapAnalysis, competitorSeos, geoSection, competitorBenchmarks } = allData;

  // Build a concise narrative summary to keep token usage low
  const pagesSummary = pageAnalyses.length > 0
    ? pageAnalyses.map(p => `  ${p.pageType} (${p.url.split('/').slice(-2).join('/')}): title="${p.titleTag || 'MISSING'}", H1="${p.h1 || 'MISSING'}", speed=${p.pageSpeedSignal}, schema=[${(p.schemaMarkup || []).join(',')||'none'}]${p.error ? ` [ERROR: could not scrape]` : ''}`).join('\n')
    : '  Multi-page data not available';

  const sitemapSummary = sitemapAnalysis
    ? `Sitemap: ${sitemapAnalysis.found ? `found at ${sitemapAnalysis.url} — ${sitemapAnalysis.totalUrls} URLs (${sitemapAnalysis.byType.product} products, ${sitemapAnalysis.byType.collection} collections)` : 'NOT FOUND'}`
    : 'Sitemap: not analyzed';

  const topBenchmark = competitorBenchmarks[0];
  const benchmarkSummary = topBenchmark
    ? `Top competitor gap: ${topBenchmark.competitorName} has better ${topBenchmark.signal} ("${topBenchmark.competitorValue}" vs target's "${topBenchmark.targetValue}")`
    : 'No competitor benchmarks available';

  const prompt = `You are an SEO consultant creating a priority action list for the executive team at ${profile.name}, a ${profile.industry} brand in ${profile.market || 'their market'}.

Here is the current SEO diagnostic data:

HOMEPAGE:
  Title: "${onPageSeo.titleTag || 'MISSING'}"
  Meta description: "${onPageSeo.metaDescription || 'MISSING'}"
  H1: "${onPageSeo.h1 || 'MISSING'}"
  Page speed: ${onPageSeo.pageSpeedSignal}
  Schema markup: [${(onPageSeo.schemaMarkup || []).join(', ') || 'none'}]
  Canonical tag: ${onPageSeo.canonicalTag ? 'present' : 'MISSING'}

OTHER PAGES ANALYZED:
${pagesSummary}

${sitemapSummary}

GEO VISIBILITY: ${geoSection?.combinedScore ?? 0}% of AI shopping queries mention the brand.

${benchmarkSummary}

Create exactly 5–7 prioritized actions. Each must be:
- Written in plain English that a non-technical executive can understand and act on
- Specific to ${profile.name}'s actual gaps (not generic SEO advice)
- Ordered by business impact (most impactful first)
- Include a "quick wins" vs "longer projects" classification

Return ONLY a JSON array:
[
  {
    "rank": 1,
    "action": "Specific, concrete action to take (1-2 sentences)",
    "impact": "High",
    "why": "One sentence explaining the business reason in plain language",
    "effort": "Quick Win"
  }
]

Valid values: impact = "High" | "Medium" | "Low", effort = "Quick Win" | "1-2 weeks" | "1+ month"`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 4000,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const actions = JSON.parse(raw.slice(start, end + 1));
      log(`Priority actions: ${actions.length} actions generated`);
      return actions;
    }
  } catch (err) { log(`Priority actions error: ${err.message}`); }

  // Fallback: derive actions from raw data
  return buildFallbackPriorityActions(onPageSeo, sitemapAnalysis, pageAnalyses);
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found'); process.exit(1); }
  profile.slug = slug;

  log(`Starting search/SEO audit for: ${profile.name}`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // 1. Discover multi-page URLs
  log('Discovering multi-page URLs from site intelligence...');
  const { categoryUrls, productUrls } = await discoverMultiPageUrls(profile).catch(err => {
    log(`URL discovery error: ${err.message}`);
    return { categoryUrls: [], productUrls: [] };
  });

  // 2. Sitemap analysis
  log(`Analyzing sitemap for ${profile.url}...`);
  const sitemapAnalysis = await analyzeSitemap(profile.url).catch(err => {
    log(`Sitemap error: ${err.message}`);
    return null;
  });

  // 3. Scrape homepage
  log(`Scraping on-page SEO for ${profile.url}...`);
  const onPageSeo = await scrapeOnPageSeo(profile.url);

  // 4. Scrape category + product pages
  const multiPageGroups = [
    ...categoryUrls.map(url => ({ url, pageType: 'category' })),
    ...productUrls.map(url => ({ url, pageType: 'product' })),
  ];
  let pageAnalyses = [];
  if (multiPageGroups.length > 0) {
    log(`Scraping ${multiPageGroups.length} additional pages (category/product)...`);
    pageAnalyses = await scrapeMultiplePages(multiPageGroups).catch(err => {
      log(`Multi-page scraping error: ${err.message}`);
      return [];
    });
  }

  // Homepage is always first in pageAnalyses
  const allPageAnalyses = [{ ...onPageSeo, pageType: 'homepage' }, ...pageAnalyses];

  // 5. Scrape competitor homepages (top 3)
  const competitorUrls = (profile.identifiedCompetitors || []).slice(0, 3);
  const competitorSeos = [];
  for (const comp of competitorUrls) {
    log(`Scraping competitor SEO: ${comp.url}`);
    const seo = await scrapeOnPageSeo(comp.url).catch(err => ({ url: comp.url, error: err.message, blocked: true }));
    competitorSeos.push({ name: comp.name, ...seo });
  }

  // 6. Generate keyword universe
  log('Generating keyword universe...');
  const keywordUniverse = await generateKeywordUniverse(anthropic, profile, onPageSeo, competitorSeos).catch(() => ({ totalCount: 0 }));

  // 7. Keyword intelligence
  log('Generating keyword intelligence...');
  const siteIntel = loadBrandData(slug, 'site_intelligence.json') || {};
  const keywordIntelligence = await generateKeywordIntelligence(anthropic, profile, keywordUniverse, siteIntel).catch(err => {
    log(`Keyword intelligence error: ${err.message}`);
    return null;
  });

  // 8. GEO analysis
  log('Running GEO (Generative Engine Optimization) analysis...');
  const geoSection = await runGeoAnalysis(anthropic, profile, keywordUniverse).catch(err => {
    log(`GEO error: ${err.message}`);
    return { queries: [], visibilityScore: 0, combinedScore: 0, byAgent: { claude: { visibilityScore: 0, queries: [] } }, gapRecommendations: ['GEO analysis failed — check API key'] };
  });

  // 8. Competitor benchmarks
  log('Generating competitor benchmarks...');
  const competitorBenchmarks = await generateCompetitorBenchmarks(anthropic, profile, onPageSeo, competitorSeos).catch(err => {
    log(`Benchmarks error: ${err.message}`);
    return [];
  });

  // 9. Priority actions
  log('Generating priority actions...');
  const priorityActions = await generatePriorityActions(anthropic, profile, {
    onPageSeo, pageAnalyses: allPageAnalyses, sitemapAnalysis, competitorSeos, geoSection, competitorBenchmarks,
  }).catch(err => {
    log(`Priority actions error: ${err.message}`);
    return buildFallbackPriorityActions(onPageSeo, sitemapAnalysis, allPageAnalyses);
  });

  const now = new Date().toISOString();
  const output = {
    generatedAt: now,
    brandSlug: slug,
    brandName: profile.name,
    onPageSeo,
    pageAnalyses: allPageAnalyses,
    sitemapAnalysis,
    competitors: competitorSeos,
    competitorBenchmarks,
    priorityActions,
    keywordUniverse,
    keywordIntelligence,
    estimatedKeywordTerritory: [
      ...(keywordUniverse.brandTerms || []).slice(0, 5),
      ...(keywordUniverse.categoryTerms || []).slice(0, 5),
      ...(keywordUniverse.localTerms || []).slice(0, 5),
    ],
    geoSection,
  };

  const existing = loadBrandData(slug, 'search_seo.json');
  if (existing) archiveData(slug, 'search_seo', existing);
  saveBrandData(slug, 'search_seo.json', output);
  log(`Done. Pages: ${allPageAnalyses.length}. Keywords: ${keywordUniverse.totalCount || 0}. GEO combined: ${geoSection.combinedScore}%. Priority actions: ${priorityActions.length}.`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
