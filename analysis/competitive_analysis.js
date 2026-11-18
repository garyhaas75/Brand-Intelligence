/**
 * Competitive Analysis — scrapes each competitor and generates
 * strengths/opportunities analysis + positioning map via Claude.
 *
 * Usage: node analysis/competitive_analysis.js --slug=<brand-slug>
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL_DEEP, MODEL_FAST, EFFORT_LOW, extractText } = require('../utils/models');
const fs = require('fs');
const path = require('path');
const { scrapeBrands, manualCaptureFor, scrapeStatusLine } = require('../scrapers/site_scraper');
const { getBrandContext } = require('../utils/brand_context');
const checkpoint = require('../utils/checkpoint');
const { playersFor, competitorsOnly, isPartner } = require('../utils/players');

const SCRAPE_STEP = 'competitive-scrape';
const ANALYZE_STEP = 'competitive-analyze';

const DATA_DIR = path.join(__dirname, '../data');

function log(msg) { console.log(`[competitive_analysis] [${new Date().toISOString()}] ${msg}`); }

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function loadBrandData(slug, filename) {
  const fp = path.join(DATA_DIR, 'brands', slug, filename);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function saveBrandData(slug, filename, data) {
  const dir = path.join(DATA_DIR, 'brands', slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
}

function archiveData(slug, module, data) {
  const histDir = path.join(DATA_DIR, 'brands', slug, 'history');
  ensureDir(histDir);
  const timestamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(histDir, `${module}_${timestamp}.json`), JSON.stringify(data, null, 2));
  // Prune history older than 365 days
  try {
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
    fs.readdirSync(histDir).filter(f => f.startsWith(module + '_')).forEach(f => {
      const dateStr = f.replace(module + '_', '').replace('.json', '');
      if (new Date(dateStr) < cutoff) fs.unlinkSync(path.join(histDir, f));
    });
  } catch (_) {}
}

async function analyzeCompetitor(anthropic, brandName, brandIndustry, competitor) {
  const prompt = buildCompetitorPrompt(brandName, brandIndustry, competitor);
  return runCompetitorPrompt(anthropic, prompt);
}

/** Prompt for one competitor. Exported so the status wording can be tested. */
function buildCompetitorPrompt(brandName, brandIndustry, competitor) {
  return `You are a competitive intelligence analyst. Analyze this competitor for ${brandName} (${brandIndustry}).

COMPETITOR: ${competitor.name}
URL: ${competitor.url}
NAV CATEGORIES: ${(competitor.featuredCategories || []).slice(0, 20).join(', ') || 'unknown'}
HERO HEADLINE: ${competitor.heroContent?.headline || 'not scraped'}
PROMO BANNERS: ${(competitor.promoBanners || []).slice(0, 3).join(' | ') || 'none'}
SCRAPE STATUS: ${scrapeStatusLine(competitor)}

Return JSON with this exact structure:
{
  "pricingTier": "budget|mid|premium|luxury",
  "positioningStatement": "1-sentence positioning based on signals",
  "strengths": ["3-5 specific strengths vs ${brandName}"],
  "opportunities": ["3-5 specific gaps/weaknesses ${brandName} could exploit"],
  "assortmentHighlights": ["top 3-5 category strengths"]
}${competitor && competitor.stale ? `

The site data above is STALE: it is from ${competitor.asOf || competitor.scrapedAt || 'an earlier run'} and could not be refreshed. Base the analysis on it, but do not describe it as the competitor's current site, promotions or messaging.` : ''}`;
}

async function runCompetitorPrompt(anthropic, prompt) {
  const msg = await anthropic.messages.create({
    model: MODEL_FAST,
    max_tokens: 2500,
    output_config: EFFORT_LOW,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = extractText(msg);
  const start = raw.indexOf('{');
  if (start === -1) return { pricingTier: 'mid', positioningStatement: '', strengths: [], opportunities: [], assortmentHighlights: [] };
  let depth = 0, end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return { pricingTier: 'mid', positioningStatement: '', strengths: [], opportunities: [], assortmentHighlights: [] }; }
}

/**
 * One positioning-map line per competitor. A stale entry carries its date and
 * reason; one with no analysis says so instead of reading as an empty "mid" brand.
 */
function competitorSummaryLine(c) {
  if (!c.positioningStatement && !(c.strengths || []).length) {
    return `${c.name}: NO DATA (no site data or analysis this run${c.error ? `: ${c.error}` : ''}). Do not place this brand from guesswork; omit it or mark it unknown.`;
  }
  const staleNote = c.stale ? ` [STALE: data from ${c.asOf || c.scrapedAt || 'an earlier run'}, not refreshed: ${c.lastError || 'unknown reason'}; do not describe as current]` : '';
  return `${c.name}: ${c.positioningStatement || ''} (${c.pricingTier || 'mid'} tier)${staleNote}`;
}

async function generatePositioningMap(anthropic, brandName, brandContext, competitors) {
  const competitorSummaries = competitors.map(competitorSummaryLine).join('\n');

  const prompt = `You are a strategic brand consultant. Create a positioning map analysis for ${brandName} and its competitors.

TARGET BRAND CONTEXT:
${brandContext}

COMPETITORS:
${competitorSummaries}

Return JSON with this structure:
{
  "narrative": "2-3 paragraph analysis of the competitive positioning landscape and where the target brand sits",
  "axes": {
    "x": "Price (Budget → Luxury)",
    "y": "Style (Classic → Contemporary)"
  },
  "brandPositions": [
    { "name": "${brandName}", "x": 50, "y": 50, "note": "brief rationale" }
  ],
  "whiteSpaceOpportunities": ["2-3 positioning gaps no current competitor is filling"]
}

For brandPositions, include the target brand AND all competitors. x/y values are 0-100.`;

  const msg = await anthropic.messages.create({
    model: MODEL_DEEP,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = extractText(msg);
  const start = raw.indexOf('{');
  if (start === -1) return { narrative: raw, axes: { x: 'Price (Budget → Luxury)', y: 'Style (Classic → Contemporary)' }, brandPositions: [], whiteSpaceOpportunities: [] };
  let depth = 0, end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return { narrative: raw, axes: { x: 'Price', y: 'Style' }, brandPositions: [], whiteSpaceOpportunities: [] }; }
}

/**
 * Keep only the assortment gaps that are genuinely comparable.
 *
 * Stated as a principle rather than a blocklist, so it holds for any brand in any
 * vertical instead of hard-coding "drop men/beauty/christmas" for this one. Falls
 * back to the unfiltered ranking if the call fails, since a noisy list beats none.
 */
async function filterAssortmentGaps(anthropic, profile, targetCategories, candidates) {
  if (candidates.length === 0) return [];
  try {
    const prompt = [
      `${profile.name} is a ${profile.industry || 'retailer'}${profile.market ? ' in ' + profile.market : ''}.`,
      '',
      `Its own categories: ${targetCategories.slice(0, 60).join(', ') || 'unknown'}`,
      '',
      'Candidate gaps found at competitors:',
      candidates.map((c, i) => `${i}. ${c.category} (at: ${c.seenAt.join(', ')})`).join('\n'),
      '',
      'Return the indices of candidates that are a genuine, actionable assortment gap:',
      'a product category this brand could credibly stock and does not appear to.',
      '',
      'Exclude:',
      "- categories belonging to a different line of business than this brand (a general merchant's departments outside this brand's vertical)",
      '- seasonal or promotional campaign pages rather than product categories',
      '- broader or generic labels for what the brand already sells',
      '- duplicates and near-synonyms of each other',
      '',
      'Order by commercial relevance to this brand, most valuable first.',
      'Return a JSON array of indices only, e.g. [3,7,1]',
    ].join('\n');

    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 2000,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = extractText(msg);
    const picked = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1))
      .map(i => candidates[i])
      .filter(Boolean);
    log(`Assortment gaps: ${candidates.length} candidates -> ${picked.length} relevant`);
    return picked.length ? picked : candidates;
  } catch (err) {
    log(`Gap relevance filter failed (${err.message}), using unfiltered list`);
    return candidates;
  }
}

/**
 * Split the profile's players for this module. Pure.
 *   competitors: relationship 'competitor' with a website (scraped, analysed, mapped, counted)
 *   partners:    relationship 'partner' (context only; never analysed, ranked, scored or counted)
 *   noWebsite:   competitors with no url (recorded, never scraped)
 */
function planPlayers(profile) {
  const players = playersFor(profile);
  const competitors = [];
  const noWebsite = [];
  for (const p of competitorsOnly(players)) (p.url ? competitors : noWebsite).push(p);
  const partners = players.filter(isPartner);
  return { competitors, partners, noWebsite };
}

function brandIdFor(name) { return String(name).toLowerCase().replace(/\s+/g, '-'); }

function playerSummary(p) {
  return { name: p.name, url: p.url || null, tier: p.tier, relationship: p.relationship };
}

/**
 * The competitive output for one run, with every I/O dependency injected:
 *   scrape(brands) -> scraped results (role 'target' | 'competitor')
 *   analyze(scraped) -> per-competitor analysis
 *   positioning(analyzedCompetitors) -> positioning map
 *   filterGaps(targetCategories, candidates) -> relevant gap candidates
 * Only competitors with a website reach analyze, positioning and the gap count.
 */
async function buildCompetitiveOutput({ slug, profile, scrape, analyze, positioning, filterGaps, prevCompetitors = [], dataDir, now = () => new Date().toISOString() }) {
  const plan = planPlayers(profile);
  const competitorIds = new Set(plan.competitors.map(c => brandIdFor(c.name)));
  for (const p of plan.noWebsite) log(`${p.name}: no website on record, not scraped`);
  if (plan.partners.length) log(`Partner(s) listed for context only, not analysed or ranked: ${plan.partners.map(p => p.name).join(', ')}`);

  const brandsToScrape = [
    { id: slug, name: profile.name, url: profile.url, role: 'target', skipApifyRetry: !!(profile.scrape && profile.scrape.skipApifyRetry), manualCapture: manualCaptureFor(slug, slug) },
    ...plan.competitors.map(c => ({ id: brandIdFor(c.name), name: c.name, url: c.url, role: 'competitor' })),
  ];
  log(`Scraping ${brandsToScrape.length} sites...`);
  const scrapedResults = await scrape(brandsToScrape);
  // Was the target's own site observed this run (proxied live scrape or manual capture)? When not,
  // assortment gaps are only what competitors carry, not a finding about the current site.
  const targetScrape = scrapedResults.find(r => r.role === 'target');
  const targetObs = require('../utils/observed').targetObservation(targetScrape);

  // Defence in depth: only ids planned as competitors are analysed, even if a scraper echoes more.
  const scrapedCompetitors = scrapedResults.filter(r => r.role === 'competitor' && competitorIds.has(r.id));
  const analyzedCompetitors = await analyzeAll(scrapedCompetitors, { slug, prevCompetitors, analyze, dataDir, now });

  log('Generating positioning map...');
  const positioningMap = await Promise.resolve().then(() => positioning(analyzedCompetitors)).catch(err => {
    log(`Positioning map error: ${err.message}`);
    return { narrative: '', axes: { x: 'Price (Budget → Luxury)', y: 'Style (Classic → Contemporary)' }, brandPositions: [], whiteSpaceOpportunities: [] };
  });
  // A model may still place a partner it knows about; it never belongs on the competitor map.
  const partnerNames = new Set(plan.partners.map(p => String(p.name).toLowerCase()));
  if (positioningMap && Array.isArray(positioningMap.brandPositions)) {
    positioningMap.brandPositions = positioningMap.brandPositions.filter(b => !(b && partnerNames.has(String(b.name || '').toLowerCase())));
  }

  const targetCategories = new Set(((targetScrape && targetScrape.featuredCategories) || []).map(c => c.toLowerCase()));
  const gapCandidates = assortmentGapCandidates(targetCategories, analyzedCompetitors);
  const relevantGaps = await filterGaps([...targetCategories], gapCandidates);
  const topAssortmentGaps = relevantGaps
    .slice(0, 10)
    .map(g => `${g.category} (seen at: ${g.seenAt.join(', ')})`);

  return {
    generatedAt: now(),
    brandSlug: slug,
    competitors: analyzedCompetitors,
    positioningMap,
    topAssortmentGaps,
    // Context only: partners are a channel, never analysed, ranked, scored or counted as competitors.
    partners: plan.partners.map(playerSummary),
    // Competitors with no website on record: listed, not scraped.
    noWebsite: plan.noWebsite.map(playerSummary),
    // true when the target's own site was read this run (live, including via the authorized Japanese
    // proxy, or from a manual capture). false: the gaps are competitor benchmarks, not site findings.
    targetObserved: !!targetObs.observed,
    targetObservedVia: !targetObs.observed ? null : (targetScrape.manualCapture ? 'manual_capture' : targetScrape.via === 'jp_proxy' ? 'jp_proxy' : 'direct'),
    assortmentBasis: targetObs.observed ? 'observed' : 'benchmark',
    ...(targetObs.observed ? {} : { assortmentNote: `The target site was not observed in this run (${targetObs.why}). Assortment gaps list what competitors carry and are not findings about the current site.` }),
  };
}

/**
 * Categories competitors carry that the target does not, most-seen first.
 * The raw set difference is recall only. It cannot tell a real gap from a
 * department belonging to a different business: general merchants like Kmart and
 * Target publish their whole taxonomy, so a toy retailer gets told it is missing
 * "men", "beauty" and "women". It also surfaces seasonal campaign pages
 * ("black friday", "christmas") that are marketing rather than assortment, and
 * trips on broader labels for what the brand already sells, so "toys" reads as a
 * gap for a toy shop whose own categories are age bands and product lines.
 */
function assortmentGapCandidates(targetCategories, analyzedCompetitors) {
  const assortmentGapMap = {};
  analyzedCompetitors.forEach(c => {
    (c.navCategories || []).forEach(cat => {
      const key = cat.toLowerCase();
      if (!targetCategories.has(key)) {
        if (!assortmentGapMap[cat]) assortmentGapMap[cat] = { category: cat, seenAt: [] };
        assortmentGapMap[cat].seenAt.push(c.name);
      }
    });
  });
  return Object.values(assortmentGapMap)
    .sort((a, b) => b.seenAt.length - a.seenAt.length)
    .slice(0, 60);
}

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found, run brand_discovery.js first'); process.exit(1); }

  log(`Starting competitive analysis for: ${profile.name}`);

  // Only real competitors are scraped, analysed, mapped and counted. The partner (relationship
  // 'partner', for Toys R Us Japan: Don Quijote) is a channel and is listed for context only.
  // A player with no website (an approved niche brand with url null) is recorded, never scraped.
  const plan = planPlayers(profile);
  if (plan.competitors.length === 0 && plan.partners.length === 0 && plan.noWebsite.length === 0) { log('No competitors in profile, skipping'); process.exit(0); }

  const logFile = path.join(__dirname, '../logs', `competitive_analysis_${slug}.log`);
  // Previous site scrape, keyed by brand id: a brand that fails this time keeps its
  // last good data (marked stale) instead of being replaced by the failure.
  const prevSite = loadBrandData(slug, 'site_intelligence.json');
  const existingData = {};
  for (const b of (prevSite && Array.isArray(prevSite.brands) ? prevSite.brands : [])) if (b && b.id) existingData[b.id] = b;
  const targetAccess = require('../utils/site_access').accessFor(profile.url);
  if (targetAccess.mode === 'jp_proxy') log(`Target ${profile.url}: live scrape via Japanese proxy (authorized ${targetAccess.authorization.by} ${targetAccess.authorization.at}); manual capture only as fallback`);
  const prevAnalysis = loadBrandData(slug, 'competitive_analysis.json');

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const brandContext = getBrandContext(slug);

  const output = await buildCompetitiveOutput({
    slug, profile,
    prevCompetitors: (prevAnalysis && prevAnalysis.competitors) || [],
    scrape: (brands) => scrapeBrands(brands, { logFile, existingData, slug, checkpointStep: SCRAPE_STEP }),
    analyze: (scraped) => analyzeCompetitor(anthropic, profile.name, profile.industry, scraped),
    positioning: (analyzed) => generatePositioningMap(anthropic, profile.name, brandContext, analyzed),
    filterGaps: (targetCats, candidates) => filterAssortmentGaps(anthropic, profile, targetCats, candidates),
  });
  const analyzedCompetitors = output.competitors;
  const topAssortmentGaps = output.topAssortmentGaps;

  // Archive previous and save new
  const existing = loadBrandData(slug, 'competitive_analysis.json');
  if (existing) archiveData(slug, 'competitive_analysis', existing);
  saveBrandData(slug, 'competitive_analysis.json', output);
  // Real output is written: the next run starts fresh.
  checkpoint.clear(slug, SCRAPE_STEP);
  checkpoint.clear(slug, ANALYZE_STEP);
  log(`Done. ${analyzedCompetitors.length} competitors analyzed, ${topAssortmentGaps.length} assortment gaps found.`);

  // ---- BEGIN marketplace_jp hook (Japan only; writes marketplace.json; never throws) ----
  try {
    const marketplaceJp = require('../scrapers/marketplace_jp');
    if (marketplaceJp.isJapanMarket(profile) && process.env.BI_SKIP_MARKETPLACE_HOOK !== '1') {
      log('Japan market: collecting marketplace intelligence (Amazon.co.jp, Rakuten)...');
      const mp = await marketplaceJp.collectMarketplace({ slug, log: m => log(`[marketplace_jp] ${m}`) });
      log(`Marketplace: ${(mp.categories || []).length} categories, ${(mp.reviews || []).length} reviews`);
    }
  } catch (err) {
    log(`Marketplace step skipped: ${err.message}`);
  }
  // ---- END marketplace_jp hook ----
}

/**
 * Analyze each scraped competitor with one Claude call, checkpointing every result
 * under ANALYZE_STEP keyed by competitor id, so a failure part way does not pay
 * again for the ones that finished. A checkpoint is reused only if it was made from
 * the same scrape (matching scrapedAt). A failed analysis keeps the previous good
 * analysis for that competitor, marked stale.
 */
async function analyzeAll(scrapedCompetitors, { slug, prevCompetitors = [], analyze, dataDir, now = () => new Date().toISOString() }) {
  const cpOpts = dataDir ? { dataDir } : {};
  const out = [];
  for (const scraped of scrapedCompetitors) {
    const key = scraped.id || scraped.name;
    const saved = checkpoint.get(slug, ANALYZE_STEP, key, cpOpts);
    if (saved && saved.scrapedAt === scraped.scrapedAt && !saved.analysisError) {
      log(`${scraped.name}: resumed from checkpoint (${ANALYZE_STEP})`);
      out.push(saved);
      continue;
    }
    log(`Analyzing ${scraped.name}...`);
    try {
      const analysis = await analyze(scraped);
      const entry = {
        name: scraped.name,
        url: scraped.url,
        pricingTier: analysis.pricingTier,
        positioningStatement: analysis.positioningStatement,
        strengths: analysis.strengths || [],
        opportunities: analysis.opportunities || [],
        assortmentHighlights: analysis.assortmentHighlights || [],
        navCategories: scraped.featuredCategories || [],
        heroHeadline: scraped.heroContent?.headline || '',
        promoBanners: scraped.promoBanners || [],
        scrapedAt: scraped.scrapedAt,
        botBlocked: scraped.botBlocked || false,
        error: scraped.error || null,
        ...(scraped.stale ? { stale: true, asOf: scraped.asOf || scraped.scrapedAt || null, lastAttempt: scraped.lastAttempt, lastError: scraped.lastError } : {}),
      };
      checkpoint.put(slug, ANALYZE_STEP, key, entry, cpOpts);
      out.push(entry);
    } catch (err) {
      log(`Error analyzing ${scraped.name}: ${err.message}`);
      const prior = prevCompetitors.find(c => c && c.name === scraped.name && !c.analysisError && (c.strengths || []).length > 0);
      if (prior) {
        log(`  Keeping previous analysis for ${scraped.name} (stale)`);
        out.push({ ...prior, stale: true, asOf: prior.asOf || prior.scrapedAt || null, lastAttempt: now(), lastError: `analysis failed: ${err.message}` });
      } else {
        out.push({ name: scraped.name, url: scraped.url, error: err.message, analysisError: true, strengths: [], opportunities: [] });
      }
    }
  }
  return out;
}

// Only auto-run as a script, so helpers can be required and tested in isolation.
if (require.main === module) {
  // A stranded network call (run 1: an Apify request whose race was already lost
  // died with ECONNRESET) can reject or throw after the fact. Log it, keep whatever
  // is checkpointed, and exit non-zero instead of dumping a stack.
  const onFatal = (kind) => (err) => {
    log(`FATAL (${kind}): ${err && err.message ? err.message : String(err)}${err && err.code ? ` [${err.code}]` : ''}. Finished work stays checkpointed under data/brands/<slug>/_checkpoints/ (${SCRAPE_STEP}, ${ANALYZE_STEP}); rerun to resume.`);
    process.exit(1);
  };
  process.on('unhandledRejection', onFatal('unhandledRejection'));
  process.on('uncaughtException', onFatal('uncaughtException'));

  run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
}

module.exports = { filterAssortmentGaps, analyzeAll, planPlayers, buildCompetitiveOutput, assortmentGapCandidates, buildCompetitorPrompt, competitorSummaryLine, SCRAPE_STEP, ANALYZE_STEP };
