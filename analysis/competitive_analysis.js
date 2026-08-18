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
const { scrapeBrands } = require('../scrapers/site_scraper');
const { getBrandContext } = require('../utils/brand_context');

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
  const prompt = `You are a competitive intelligence analyst. Analyze this competitor for ${brandName} (${brandIndustry}).

COMPETITOR: ${competitor.name}
URL: ${competitor.url}
NAV CATEGORIES: ${(competitor.featuredCategories || []).slice(0, 20).join(', ') || 'unknown'}
HERO HEADLINE: ${competitor.heroContent?.headline || 'not scraped'}
PROMO BANNERS: ${(competitor.promoBanners || []).slice(0, 3).join(' | ') || 'none'}
SCRAPE STATUS: ${competitor.botBlocked ? 'bot-blocked (limited data)' : competitor.error ? 'error: ' + competitor.error : 'success'}

Return JSON with this exact structure:
{
  "pricingTier": "budget|mid|premium|luxury",
  "positioningStatement": "1-sentence positioning based on signals",
  "strengths": ["3-5 specific strengths vs ${brandName}"],
  "opportunities": ["3-5 specific gaps/weaknesses ${brandName} could exploit"],
  "assortmentHighlights": ["top 3-5 category strengths"]
}`;

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

async function generatePositioningMap(anthropic, brandName, brandContext, competitors) {
  const competitorSummaries = competitors.map(c =>
    `${c.name}: ${c.positioningStatement || ''} (${c.pricingTier || 'mid'} tier)`
  ).join('\n');

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

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found — run brand_discovery.js first'); process.exit(1); }

  log(`Starting competitive analysis for: ${profile.name}`);

  const competitors = profile.identifiedCompetitors || [];
  if (competitors.length === 0) { log('No competitors in profile — skipping'); process.exit(0); }

  // Build brand list for scraping
  const brandsToScrape = [
    { id: slug, name: profile.name, url: profile.url, role: 'target' },
    ...competitors.map(c => ({
      id: c.name.toLowerCase().replace(/\s+/g, '-'),
      name: c.name, url: c.url, role: 'competitor',
    })),
  ];

  log(`Scraping ${brandsToScrape.length} sites...`);
  const logFile = path.join(__dirname, '../logs', `competitive_analysis_${slug}.log`);
  const scrapedResults = await scrapeBrands(brandsToScrape, { logFile });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const brandContext = getBrandContext(slug);

  // Analyze each competitor
  const analyzedCompetitors = [];
  for (const scraped of scrapedResults.filter(r => r.role === 'competitor')) {
    log(`Analyzing ${scraped.name}...`);
    try {
      const analysis = await analyzeCompetitor(anthropic, profile.name, profile.industry, scraped);
      analyzedCompetitors.push({
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
      });
    } catch (err) {
      log(`Error analyzing ${scraped.name}: ${err.message}`);
      analyzedCompetitors.push({ name: scraped.name, url: scraped.url, error: err.message, strengths: [], opportunities: [] });
    }
  }

  // Generate positioning map
  log('Generating positioning map...');
  const positioningMap = await generatePositioningMap(anthropic, profile.name, brandContext, analyzedCompetitors).catch(err => {
    log(`Positioning map error: ${err.message}`);
    return { narrative: '', axes: { x: 'Price (Budget → Luxury)', y: 'Style (Classic → Contemporary)' }, brandPositions: [], whiteSpaceOpportunities: [] };
  });

  // Compute assortment gaps
  const targetCategories = new Set((scrapedResults.find(r => r.role === 'target')?.featuredCategories || []).map(c => c.toLowerCase()));
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
  const topAssortmentGaps = Object.values(assortmentGapMap)
    .sort((a, b) => b.seenAt.length - a.seenAt.length)
    .slice(0, 10)
    .map(g => `${g.category} (seen at: ${g.seenAt.join(', ')})`);

  const now = new Date().toISOString();
  const output = {
    generatedAt: now,
    brandSlug: slug,
    competitors: analyzedCompetitors,
    positioningMap,
    topAssortmentGaps,
  };

  // Archive previous and save new
  const existing = loadBrandData(slug, 'competitive_analysis.json');
  if (existing) archiveData(slug, 'competitive_analysis', existing);
  saveBrandData(slug, 'competitive_analysis.json', output);
  log(`Done. ${analyzedCompetitors.length} competitors analyzed, ${topAssortmentGaps.length} assortment gaps found.`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
