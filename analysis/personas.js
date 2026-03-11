/**
 * Customer Personas Generator — slug-aware, external brand only.
 * Uses competitive intelligence, social, and site data to build 3-5 personas.
 *
 * Usage: node analysis/personas.js --slug=<brand-slug>
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { getBrandContext } = require('../utils/brand_context');

const DATA_DIR = path.join(__dirname, '../data');

function log(msg) { console.log(`[personas] [${new Date().toISOString()}] ${msg}`); }
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

function extractBraces(text) {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
  const start = stripped.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') { depth--; if (depth === 0) return stripped.slice(start, i + 1); }
  }
  return null;
}

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found'); process.exit(1); }

  log(`Generating personas for: ${profile.name}`);

  // Load all available intel for this brand
  const competitive = loadBrandData(slug, 'competitive_analysis.json');
  const socialIntel = loadBrandData(slug, 'social_intelligence.json');
  const siteIntel = loadBrandData(slug, 'site_intelligence.json');
  const searchSeo = loadBrandData(slug, 'search_seo.json');

  const brandContext = getBrandContext(slug);

  // Build intel summary from available data
  const intelParts = [];

  if (competitive?.competitors?.length) {
    const compSummary = competitive.competitors.slice(0, 4).map(c =>
      `${c.name} (${c.pricingTier}): ${c.positioningStatement}`
    ).join('\n');
    intelParts.push(`COMPETITIVE LANDSCAPE:\n${compSummary}`);
    if (competitive.topAssortmentGaps?.length) {
      intelParts.push(`ASSORTMENT GAPS: ${competitive.topAssortmentGaps.slice(0, 5).join(', ')}`);
    }
  }

  if (socialIntel?.brands?.length) {
    const targetSocial = socialIntel.brands.find(b => b.role === 'target');
    if (targetSocial?.contentThemes?.length) {
      intelParts.push(`SOCIAL CONTENT THEMES: ${targetSocial.contentThemes.slice(0, 6).map(t => t.theme).join(', ')}`);
    }
    const allHashtags = socialIntel.brands.flatMap(b => (b.topHashtags || []).slice(0, 5).map(h => h.tag));
    if (allHashtags.length) intelParts.push(`TOP HASHTAGS: ${[...new Set(allHashtags)].slice(0, 15).join(', ')}`);
  }

  if (siteIntel?.brands?.length) {
    const targetSite = siteIntel.brands.find(b => b.role === 'target');
    if (targetSite?.featuredCategories?.length) {
      intelParts.push(`PRODUCT CATEGORIES: ${targetSite.featuredCategories.slice(0, 15).join(', ')}`);
    }
    if (siteIntel.navGaps?.length) {
      intelParts.push(`NAVIGATION GAPS VS COMPETITORS: ${(Array.isArray(siteIntel.navGaps) ? siteIntel.navGaps.slice(0, 5).map(g => g.category || g) : []).join(', ')}`);
    }
  }

  if (searchSeo?.estimatedKeywordTerritory?.length) {
    intelParts.push(`ESTIMATED SEARCH KEYWORDS: ${searchSeo.estimatedKeywordTerritory.slice(0, 15).join(', ')}`);
  }

  if (searchSeo?.geoSection?.queries?.length) {
    const geoQueries = searchSeo.geoSection.queries.map(q => q.query).slice(0, 8);
    intelParts.push(`AI SHOPPING QUERY TYPES: ${geoQueries.join(' | ')}`);
  }

  const combinedIntel = intelParts.join('\n\n---\n\n');

  const prompt = `You are a consumer insights researcher. Based on all the intelligence data below about ${profile.name} and its competitive landscape, build 3-4 detailed customer personas for ${profile.name}'s target customers.

BRAND CONTEXT:
${brandContext}

---
COMPETITIVE INTELLIGENCE DATA:
${combinedIntel || 'Limited data available — base personas on brand positioning and industry context.'}

Create exactly ${combinedIntel.length > 200 ? '4' : '3'} personas. For each persona include:
- name (evocative label, e.g. "The Executive Achiever")
- ageRange
- income (household, e.g. "$85k-$140k")
- occupation (array of 2-3 examples)
- location (e.g. "Metro areas, Northeast and Midwest")
- lifestyle (array of 3-4 bullet points)
- values (array of 4-5 core values)
- fashionGoals (array of 3-4 points)
- shoppingBehaviors (array of 3-4 points)
- painPoints (array of 3-4 frustrations)
- motivators (array of 3-4 purchase drivers)
- contentTopics (array of 4-5 topics)
- preferredChannels (array, ranked)
- brandFit (why ${profile.name} is relevant to this persona — 2-3 sentences)
- quoteExample (one realistic quote this persona might say)

Return ONLY valid JSON:
{
  "generatedAt": "${new Date().toISOString()}",
  "brandSlug": "${slug}",
  "totalPersonas": 3,
  "personas": [],
  "summaryInsights": ["4-5 cross-persona insights for marketing strategy"]
}`;

  log('Calling Claude opus to generate personas...');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text;
  const jsonStr = extractBraces(raw);
  if (!jsonStr) { log('ERROR: Could not extract JSON from Claude response'); process.exit(1); }

  const output = JSON.parse(jsonStr);
  output.generatedAt = new Date().toISOString();
  output.brandSlug = slug;
  output.totalPersonas = output.personas?.length || 0;

  log(`Generated ${output.totalPersonas} personas`);
  output.personas?.forEach((p, i) => log(`  ${i + 1}. ${p.name} (${p.ageRange})`));

  const existing = loadBrandData(slug, 'personas.json');
  if (existing) archiveData(slug, 'personas', existing);
  saveBrandData(slug, 'personas.json', output);
  log('Done.');
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
