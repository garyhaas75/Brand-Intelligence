/**
 * Website Audit — scrapes brand + competitor sites and uses Claude to identify
 * navigation gaps, messaging gaps, CTA effectiveness, and top opportunities.
 * Includes: Playwright screenshot + Claude vision, Lighthouse technical SEO.
 *
 * Usage: node analysis/website_audit.js --slug=<brand-slug>
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL_DEEP, MODEL_FAST, EFFORT_LOW, extractText } = require('../utils/models');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { chromium } = require('playwright');
const { scrapeBrands } = require('../scrapers/site_scraper');
const { getBrandContext } = require('../utils/brand_context');

const DATA_DIR = path.join(__dirname, '../data');

function log(msg) { console.log(`[website_audit] [${new Date().toISOString()}] ${msg}`); }
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

// Ask the OS for an unused port rather than guessing a fixed one, so two audits
// running back to back can't collide on the debugging port.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Lighthouse technical SEO audit.
 *
 * This previously used chrome-launcher, which hung on Railway because it hunts
 * for a system Chrome install that isn't there. Instead we launch the Chromium
 * that Playwright already installs during the Railway build, expose its CDP
 * endpoint on a free port, and point Lighthouse at that port. Same audit, no
 * system Chrome dependency — and it completes in seconds rather than hanging.
 */
async function runLighthouse(url) {
  let browser;
  try {
    const port = await findFreePort();
    browser = await chromium.launch({
      args: [
        `--remote-debugging-port=${port}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // container /dev/shm is small; avoids crashes
      ],
    });

    const { default: lighthouse } = await import('lighthouse');
    const result = await lighthouse(url, {
      port,
      onlyCategories: ['seo', 'performance', 'accessibility', 'best-practices'],
      output: 'json',
      logLevel: 'error',
    });

    const cats = result.lhr.categories;
    const scores = {
      seo: Math.round((cats.seo?.score ?? 0) * 100),
      performance: Math.round((cats.performance?.score ?? 0) * 100),
      accessibility: Math.round((cats.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((cats['best-practices']?.score ?? 0) * 100),
    };

    // Chromium can launch, fail to actually render the page, and still report a
    // full set of zeros. That is a failure, not a site scoring zero everywhere.
    if (scores.seo === 0 && scores.performance === 0 && scores.accessibility === 0) {
      log('Lighthouse returned all-zero scores — Chromium launched but could not evaluate the page');
      return null;
    }

    const topIssues = Object.values(result.lhr.audits)
      .filter(a => a.score !== null && a.score !== undefined && a.score < 0.9
        && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'informative')
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map(a => ({ id: a.id, title: a.title, score: Math.round(a.score * 100) }));

    log(`Lighthouse: SEO=${scores.seo}, Perf=${scores.performance}, A11y=${scores.accessibility}, BP=${scores.bestPractices} (${topIssues.length} issues)`);
    return { scores, topIssues, lighthouseVersion: result.lhr.lighthouseVersion };
  } catch (err) {
    log(`Lighthouse failed: ${err.message}`);
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}


async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found'); process.exit(1); }

  log(`Starting website audit for: ${profile.name}`);

  const brandsToScrape = [
    { id: slug, name: profile.name, url: profile.url, role: 'target', takeScreenshot: true },
    ...(profile.identifiedCompetitors || []).slice(0, 6).map(c => ({
      id: c.name.toLowerCase().replace(/\s+/g, '-'),
      name: c.name, url: /^https?:\/\//i.test(c.url) ? c.url : `https://${c.url}`, role: 'competitor',
    })),
  ];

  const logFile = path.join(__dirname, '../logs', `website_audit_${slug}.log`);
  log(`Scraping ${brandsToScrape.length} sites...`);
  const scraped = await Promise.race([
    scrapeBrands(brandsToScrape, { logFile }),
    new Promise(resolve => setTimeout(() => { log('Scraping timed out after 6min — continuing with partial results'); resolve([]); }, 360000)),
  ]);

  // Timeout is a backstop only — a healthy run finishes in well under a minute.
  log(`Running Lighthouse audit for ${profile.url}...`);
  const lighthouseAudit = await Promise.race([
    runLighthouse(profile.url),
    new Promise(resolve => setTimeout(() => { log('Lighthouse timed out after 120s — skipping'); resolve(null); }, 120000)),
  ]);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const brandContext = getBrandContext(slug);

  const targetSite = scraped.find(s => s.role === 'target') || {};
  const competitorSites = scraped.filter(s => s.role === 'competitor');

  // Build comparison context for Claude
  const competitorContext = competitorSites.map(c =>
    `${c.name}:
  Nav: ${(c.featuredCategories || []).slice(0, 15).join(', ') || 'not scraped'}
  Hero: "${c.heroContent?.headline || 'not found'}"
  Promos: ${(c.promoBanners || []).slice(0, 2).join(' | ') || 'none'}`
  ).join('\n\n');

  const visionNote = targetSite.screenshotBase64
    ? '\nA screenshot of the target brand homepage is attached. Use it to assess visual design, hero messaging, image vs. live text usage, CTA prominence, and above-the-fold content.'
    : '';

  const prompt = `You are a UX, digital strategy, and SEO auditor. Analyze ${profile.name}'s website against its competitors.${visionNote}

TARGET BRAND:
${brandContext}
Nav categories: ${(targetSite.featuredCategories || []).join(', ') || 'not scraped'}
Hero headline: "${targetSite.heroContent?.headline || 'not found'}"
All hero text: ${(targetSite.heroContent?.allText || []).slice(0, 5).join(' | ') || 'none'}
Promo banners: ${(targetSite.promoBanners || []).slice(0, 3).join(' | ') || 'none'}
Bot blocked: ${targetSite.botBlocked ? 'yes (limited data)' : 'no'}

COMPETITORS:
${competitorContext}

Return JSON with this exact structure:
{
  "navGaps": [
    { "category": "category name missing from target", "competitorsWithIt": ["list"], "priority": "high|medium|low" }
  ],
  "messagingGaps": [
    { "gap": "specific messaging gap", "competitorExample": "which competitor does it better and how", "recommendation": "what to do" }
  ],
  "ctaEffectiveness": {
    "rating": "strong|moderate|needs improvement",
    "observations": "2-3 sentences on CTA quality",
    "recommendation": "specific improvement"
  },
  "topOpportunities": [
    { "rank": 1, "title": "short title", "description": "actionable 1-2 sentence description", "impact": "high|medium|low" }
  ],
  "heroMessagingAnalysis": {
    "targetStrengths": ["what target brand does well"],
    "targetGaps": ["areas for improvement — what the target brand is missing"],
    "competitorBestPractices": ["notable examples from competitors"]
  },
  "crawlerVisibility": {
    "heroTextIsLive": true,
    "contentInImagesLevel": "low|medium|high",
    "aiReadabilityNote": "1-2 sentences on how visible this site is to AI crawlers and shopping agents"
  },
  "navigationAnalysis": {
    "topCategories": ["top nav items found"],
    "missingCategories": ["important categories not in nav"],
    "depth": "shallow|moderate|deep",
    "notes": "brief observation about nav structure"
  },
  "productContentReview": {
    "brandsCovered": ["brands or product lines found"],
    "ageGroupCoverage": ["age groups or audiences mentioned"],
    "priceVisibility": "visible|hidden|partial",
    "contentGaps": ["missing content types or product areas"]
  }
}

Generate at least 5 navGaps, 3 messagingGaps, and 5 topOpportunities.`;

  log('Calling Claude for website audit analysis...');
  const visionContent = targetSite.screenshotBase64
    ? [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: targetSite.screenshotBase64 } },
        { type: 'text', text: prompt },
      ]
    : prompt;

  const msg = await anthropic.messages.create({
    model: MODEL_DEEP,
    max_tokens: 8000,
    messages: [{ role: 'user', content: visionContent }],
  });

  const raw = extractText(msg);
  let analysis = {
    navGaps: [], messagingGaps: [], ctaEffectiveness: {}, topOpportunities: [],
    heroMessagingAnalysis: {}, crawlerVisibility: {}, navigationAnalysis: {}, productContentReview: {},
  };

  const start = raw.indexOf('{');
  if (start !== -1) {
    let depth = 0, end = -1;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    try { analysis = JSON.parse(raw.slice(start, end + 1)); } catch (e) { log(`JSON parse error: ${e.message}`); }
  }

  const now = new Date().toISOString();
  // Strip screenshotBase64 from saved brands (too large for JSON file)
  const brandsForStorage = scraped.map(b => {
    const { screenshotBase64: _, ...rest } = b;
    return rest;
  });

  const output = {
    generatedAt: now,
    brandSlug: slug,
    brands: brandsForStorage,
    lighthouseAudit: lighthouseAudit || null,
    hasScreenshot: !!targetSite.screenshotBase64,
    ...analysis,
  };

  const existing = loadBrandData(slug, 'site_intelligence.json');
  if (existing) archiveData(slug, 'site_intelligence', existing);
  saveBrandData(slug, 'site_intelligence.json', output);
  log(`Done. ${(analysis.navGaps || []).length} nav gaps, ${(analysis.topOpportunities || []).length} opportunities. Lighthouse: ${lighthouseAudit ? `SEO ${lighthouseAudit.scores.seo}` : 'failed'}.`);
}

// Hard kill after 12 minutes — prevents zombie processes on Railway
setTimeout(() => { log('TIMEOUT: website audit exceeded 12min, forcing exit'); process.exit(1); }, 12 * 60 * 1000);

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
