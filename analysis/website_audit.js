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
const { scrapeBrands, manualCaptureFor, isFailedResult, scrapeStatusLine } = require('../scrapers/site_scraper');
const { isJapanMarket } = require('../utils/market');
const { getBrandContext } = require('../utils/brand_context');
const checkpoint = require('../utils/checkpoint');

const CHECKPOINT_STEP = 'website-scrape';

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
    // Seen on sites that serve a bot challenge: the page loads, but what loads is the
    // challenge, so every category scores zero.
    if (scores.seo === 0 && scores.performance === 0 && scores.accessibility === 0) {
      const runtimeError = result.lhr.runtimeError && result.lhr.runtimeError.code;
      log(`Lighthouse returned all-zero scores${runtimeError ? ` (${runtimeError})` : ''}: the page could not be evaluated, most often because the site blocks automated browsers`);
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
    { id: slug, name: profile.name, url: profile.url, role: 'target', takeScreenshot: true, skipApifyRetry: !!(profile.scrape && profile.scrape.skipApifyRetry), manualCapture: manualCaptureFor(slug, slug) },
    ...(profile.identifiedCompetitors || []).slice(0, isJapanMarket(profile) ? 12 : 6).map(c => ({
      id: c.name.toLowerCase().replace(/\s+/g, '-'),
      name: c.name, url: /^https?:\/\//i.test(c.url) ? c.url : `https://${c.url}`, role: 'competitor',
    })),
  ];

  const logFile = path.join(__dirname, '../logs', `website_audit_${slug}.log`);
  log(`Scraping ${brandsToScrape.length} sites...`);
  // Sites that block a datacentre IP now retry through Apify's residential proxy,
  // which turns a 2-second failure into a minutes-long attempt. The old budget
  // resolved to [] on timeout — the log claimed "partial results" while actually
  // discarding every successful scrape. Collect brands as they land so a timeout
  // costs only the sites that hadn't finished.
  const SCRAPE_BUDGET_MS = 10 * 60 * 1000;
  const partial = [];
  // Previous output, keyed by brand id: a brand that fails this time keeps its last
  // good data (marked stale) instead of being replaced by the failure.
  const existingData = existingBrandsById(loadBrandData(slug, 'site_intelligence.json'));
  let scrapeTimedOut = false;
  let scrapeTimer;
  // Aborted on timeout so the scrape still running in the background starts no new
  // brand and writes no checkpoint after this run has moved on.
  const scrapeAbort = new AbortController();
  const scraped = await Promise.race([
    scrapeBrands(brandsToScrape, { logFile, collector: partial, existingData, slug, checkpointStep: CHECKPOINT_STEP, signal: scrapeAbort.signal }),
    new Promise(resolve => { scrapeTimer = setTimeout(() => {
      scrapeTimedOut = true;
      scrapeAbort.abort();
      log(`Scraping timed out after 10min: continuing with ${partial.length}/${brandsToScrape.length} sites that finished`);
      resolve(fillUnfinished(brandsToScrape, [...partial], existingData, 'scrape budget exceeded'));
    }, SCRAPE_BUDGET_MS); scrapeTimer.unref(); }),
  ]);
  clearTimeout(scrapeTimer);
  log(`Scraped ${scraped.length}/${brandsToScrape.length} sites (${scraped.filter(b => !b.botBlocked && !b.error).length} usable)`);

  // Timeout is a backstop only; a healthy run finishes in well under a minute.
  const targetScraped = scraped.find(s => s.role === 'target') || {};
  const lighthouseSkip = lighthouseSkipReason(profile, brandsToScrape[0], targetScraped);
  let lighthouseAudit = null;
  let lighthouseNote = null;
  if (lighthouseSkip) {
    lighthouseNote = lighthouseSkip;
    log(`Lighthouse skipped: ${lighthouseSkip}`);
  } else {
    log(`Running Lighthouse audit for ${profile.url}...`);
    let lhTimer;
    lighthouseAudit = await Promise.race([
      runLighthouse(profile.url),
      new Promise(resolve => { lhTimer = setTimeout(() => { log('Lighthouse timed out after 120s, skipping'); resolve(null); }, 120000); lhTimer.unref(); }),
    ]);
    clearTimeout(lhTimer);
    if (!lighthouseAudit) lighthouseNote = 'Lighthouse could not evaluate the page (see log)';
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const brandContext = getBrandContext(slug);

  const targetFound = scraped.find(s => s.role === 'target');
  const targetSite = targetFound || {};

  // Build comparison context for Claude. Every competitor that was meant to be
  // scraped appears, with its data status (stale, blocked, or no data at all).
  const competitorContext = competitorContextBlock(brandsToScrape, scraped);

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
Data status: ${scrapeStatusLine(targetFound)}

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
    ...(lighthouseNote ? { lighthouseNote } : {}),
    hasScreenshot: !!targetSite.screenshotBase64,
    ...analysis,
  };

  persistOutput(slug, output, { complete: !scrapeTimedOut });
  log(`Done. ${(analysis.navGaps || []).length} nav gaps, ${(analysis.topOpportunities || []).length} opportunities. Lighthouse: ${lighthouseAudit ? `SEO ${lighthouseAudit.scores.seo}` : lighthouseSkip ? 'skipped' : 'failed'}.`);
}

/**
 * Competitor section of the audit prompt. Each competitor that was meant to be
 * scraped gets a Status line: stale data carries its date and reason, and a
 * competitor with no data at all is listed as such instead of being omitted.
 */
function competitorContextBlock(brandsToScrape, scraped) {
  const byId = new Map(scraped.map(s => [s.id, s]));
  return brandsToScrape.filter(b => b.role === 'competitor').map(b => {
    const c = byId.get(b.id);
    if (!c) return `${b.name}:\n  Status: ${scrapeStatusLine(null)}`;
    return `${c.name}:
  Status: ${scrapeStatusLine(c)}
  Nav: ${(c.featuredCategories || []).slice(0, 15).join(', ') || 'not scraped'}
  Hero: "${c.heroContent?.headline || 'not found'}"
  Promos: ${(c.promoBanners || []).slice(0, 2).join(' | ') || 'none'}`;
  }).join('\n\n');
}

/** Previous output's brands keyed by id, for carry-forward. */
function existingBrandsById(prev) {
  const out = {};
  for (const b of (prev && Array.isArray(prev.brands) ? prev.brands : [])) if (b && b.id) out[b.id] = b;
  return out;
}

/**
 * After a scrape timeout, brands that never finished keep their previous good
 * data, marked stale, instead of silently disappearing from the output.
 */
function fillUnfinished(brands, finished, existingData, reason, now = new Date().toISOString()) {
  const done = new Set(finished.map(b => b && b.id));
  for (const b of brands) {
    const prior = existingData[b.id];
    if (!done.has(b.id) && prior && !isFailedResult(prior)) {
      finished.push({ ...prior, stale: true, asOf: prior.asOf || prior.scrapedAt || null, lastAttempt: now, lastError: reason });
    }
  }
  return finished;
}

/**
 * Why Lighthouse should not run against the target, or null to run it. Running it
 * against a site that blocks automated browsers only scores the block page, which
 * is reported as all zeros and read as a failure. Universal rule: skip when the
 * brand is configured as blocked (skipApifyRetry), when a manual capture stands in
 * for the live page, or when this run's scrape of the target was bot-blocked.
 */
function lighthouseSkipReason(profile, targetBrand, targetScraped) {
  if (targetBrand && targetBrand.manualCapture) return 'target site blocks automated access; a manual capture is in use, so there is no live page to audit';
  if ((targetBrand && targetBrand.skipApifyRetry) || (profile && profile.scrape && profile.scrape.skipApifyRetry)) return 'target site blocks automated access (profile.scrape.skipApifyRetry)';
  if (targetScraped && targetScraped.botBlocked) return 'target site served a bot challenge to this run, so Lighthouse would only score the block page';
  return null;
}

/**
 * Archive the previous output, write the new one, then clear the scrape checkpoint.
 * An incomplete run (scrape budget exceeded) keeps its checkpoint so the next run
 * resumes the brands that did finish.
 */
function persistOutput(slug, output, { complete = true, dataDir = DATA_DIR } = {}) {
  const dir = path.join(dataDir, 'brands', slug);
  ensureDir(dir);
  const file = path.join(dir, 'site_intelligence.json');
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  if (existing) {
    const histDir = path.join(dir, 'history');
    ensureDir(histDir);
    fs.writeFileSync(path.join(histDir, `site_intelligence_${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(existing, null, 2));
  }
  fs.writeFileSync(file, JSON.stringify(output, null, 2));
  if (complete) checkpoint.clear(slug, CHECKPOINT_STEP, { dataDir });
  else log(`Scrape incomplete, keeping checkpoint ${CHECKPOINT_STEP} so the next run resumes`);
}

// Hard kill after 12 minutes — prevents zombie processes on Railway
// .unref() so this backstop does not itself hold the process open. Without it the
// module sits idle for the full 12 minutes after finishing its work and then exits
// with code 1, which looks like a failed run and leaves one node process per module
// lingering on the container. Unref'd, the timer still fires if real work is hung,
// but a completed run exits immediately and cleanly.
// Must stay comfortably above the scrape budget (10min) plus Lighthouse (2min)
// plus the Claude analysis call, or this kills healthy runs mid-flight.
// Only auto-run as a script, so helpers can be required and tested in isolation.
if (require.main === module) {
  setTimeout(() => { log('TIMEOUT: website audit exceeded 20min, forcing exit'); process.exit(1); }, 20 * 60 * 1000).unref();

  // A stranded network call (an Apify request whose race was already lost) can
  // reject or throw after the fact. Log it, keep whatever is checkpointed, and exit
  // non-zero instead of dumping a stack and leaving the cause unclear.
  const onFatal = (kind) => (err) => {
    log(`FATAL (${kind}): ${err && err.message ? err.message : String(err)}${err && err.code ? ` [${err.code}]` : ''}. Completed sites stay checkpointed under data/brands/<slug>/_checkpoints/${CHECKPOINT_STEP}.json; rerun to resume.`);
    process.exit(1);
  };
  process.on('unhandledRejection', onFatal('unhandledRejection'));
  process.on('uncaughtException', onFatal('uncaughtException'));

  run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
}

module.exports = { competitorContextBlock, existingBrandsById, fillUnfinished, lighthouseSkipReason, persistOutput, CHECKPOINT_STEP };
