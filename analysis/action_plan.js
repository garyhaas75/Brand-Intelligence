/**
 * Action Plan Generator — reads all 6 module outputs and synthesizes
 * a prioritized executive summary + 30/60/90 day roadmap via Claude.
 *
 * Usage: node analysis/action_plan.js --slug=<brand-slug>
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { getBrandContext } = require('../utils/brand_context');

const DATA_DIR = path.join(__dirname, '../data');

function log(msg) { console.log(`[action_plan] [${new Date().toISOString()}] ${msg}`); }
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

  log(`Generating action plan for: ${profile.name}`);

  // Load all module outputs
  const competitive = loadBrandData(slug, 'competitive_analysis.json') || {};
  const personas = loadBrandData(slug, 'personas.json') || {};
  const socialIntel = loadBrandData(slug, 'social_intelligence.json') || {};
  const siteIntel = loadBrandData(slug, 'site_intelligence.json') || {};
  const searchSeo = loadBrandData(slug, 'search_seo.json') || {};
  const brandContext = getBrandContext(slug);

  // Build comprehensive context for Claude
  const contextSections = [];

  // Competitive
  if (competitive.competitors?.length) {
    const topOpps = competitive.competitors.flatMap(c => (c.opportunities || []).slice(0, 2)).slice(0, 8);
    contextSections.push(`COMPETITIVE OPPORTUNITIES (from competitive analysis):
${topOpps.map((o, i) => `${i + 1}. ${o}`).join('\n')}`);

    if (competitive.topAssortmentGaps?.length) {
      contextSections.push(`ASSORTMENT GAPS: ${competitive.topAssortmentGaps.slice(0, 5).join('; ')}`);
    }
    if (competitive.positioningMap?.whiteSpaceOpportunities?.length) {
      contextSections.push(`POSITIONING WHITE SPACE: ${competitive.positioningMap.whiteSpaceOpportunities.join('; ')}`);
    }
  }

  // Personas
  if (personas.personas?.length) {
    contextSections.push(`CUSTOMER PERSONAS: ${personas.personas.map(p => `${p.name} (${p.ageRange})`).join(', ')}
Key pain points: ${personas.personas.flatMap(p => (p.painPoints || []).slice(0, 1)).join('; ')}
Key motivators: ${personas.personas.flatMap(p => (p.motivators || []).slice(0, 1)).join('; ')}`);
  }

  // Social
  if (socialIntel.brands?.length) {
    const targetSocial = socialIntel.brands.find(b => b.role === 'target');
    if (targetSocial) {
      contextSections.push(`SOCIAL AUDIT:
Engagement: ${targetSocial.summary?.avgEngagement || 0} avg per post
Posting frequency: ${targetSocial.summary?.postingFrequencyPerWeek || 0} posts/week
Content gaps: ${(targetSocial.contentGaps || []).slice(0, 3).join('; ')}`);
    }
  }

  // Website
  if (siteIntel.topOpportunities?.length) {
    contextSections.push(`WEBSITE AUDIT TOP OPPORTUNITIES:
${siteIntel.topOpportunities.slice(0, 5).map((o, i) => `${i + 1}. [${o.impact}] ${o.title}: ${o.description}`).join('\n')}`);
  }
  if (siteIntel.navGaps?.length) {
    const navGapList = Array.isArray(siteIntel.navGaps) ? siteIntel.navGaps.slice(0, 5).map(g => g.category || g) : [];
    if (navGapList.length) contextSections.push(`NAVIGATION GAPS: ${navGapList.join(', ')}`);
  }

  // Search/SEO
  if (searchSeo.geoSection) {
    contextSections.push(`GEO VISIBILITY: ${searchSeo.geoSection.visibilityScore || 0}% of AI shopping queries mention this brand
SEO speed signal: ${searchSeo.onPageSeo?.pageSpeedSignal || 'unknown'}
Schema markup present: ${(searchSeo.onPageSeo?.schemaMarkup || []).join(', ') || 'none'}
GEO gaps: ${(searchSeo.geoSection.gapRecommendations || []).slice(0, 3).join('; ')}`);
  }

  const fullContext = contextSections.join('\n\n---\n\n');

  const prompt = `You are a senior brand strategy consultant. Based on the comprehensive brand intelligence below for ${profile.name}, create a prioritized action plan.

BRAND CONTEXT:
${brandContext}

---
INTELLIGENCE SUMMARY:
${fullContext || 'Limited data available — base recommendations on brand profile and industry best practices.'}

Generate a strategic action plan. Return ONLY valid JSON:
{
  "executiveSummary": "3-4 sentence executive summary of the brand's current position, key challenges, and the strategic opportunity. Write for a C-suite audience. Be specific to ${profile.name}.",
  "immediateWins": [
    {
      "rank": 1,
      "title": "Short action title (5-8 words)",
      "description": "Specific, actionable 2-sentence description with clear expected outcome",
      "effort": "low|medium|high",
      "impact": "low|medium|high",
      "sourceModule": "competitive|social|website|search|personas"
    }
  ],
  "roadmap": {
    "day30": [
      { "action": "Specific action to complete in 30 days", "owner": "team role (e.g. Marketing Manager)", "metric": "how success will be measured" }
    ],
    "day60": [
      { "action": "...", "owner": "...", "metric": "..." }
    ],
    "day90": [
      { "action": "...", "owner": "...", "metric": "..." }
    ]
  },
  "competitiveGapsToClose": [
    { "gap": "specific gap description", "competitor": "which competitor is doing it better", "priority": "high|medium|low" }
  ],
  "opportunitiesRanked": [
    { "rank": 1, "opportunity": "opportunity title", "rationale": "why this is a top opportunity", "estimatedImpact": "Specific impact description" }
  ]
}

Rules:
- immediateWins: exactly 5 items, ranked 1-5 by impact/effort ratio
- roadmap: 3-4 items per time period (day30, day60, day90)
- competitiveGapsToClose: 3-5 most critical gaps
- opportunitiesRanked: top 5 opportunities across all modules
- Be specific to ${profile.name} — avoid generic platitudes
- Ground every recommendation in the intelligence data above`;

  log('Calling Claude opus for action plan synthesis...');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text;
  const jsonStr = extractBraces(raw);
  if (!jsonStr) { log('ERROR: Could not extract JSON from Claude response'); log(raw.slice(0, 300)); process.exit(1); }

  let output;
  try { output = JSON.parse(jsonStr); } catch (e) { log(`JSON parse error: ${e.message}`); process.exit(1); }

  output.generatedAt = new Date().toISOString();
  output.brandSlug = slug;

  log(`Action plan generated: ${output.immediateWins?.length || 0} wins, roadmap has ${
    (output.roadmap?.day30?.length || 0) + (output.roadmap?.day60?.length || 0) + (output.roadmap?.day90?.length || 0)
  } total items`);

  const existing = loadBrandData(slug, 'action_plan.json');
  if (existing) archiveData(slug, 'action_plan', existing);
  saveBrandData(slug, 'action_plan.json', output);
  log('Done.');
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
