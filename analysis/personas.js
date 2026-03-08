/**
 * Customer Personas Generator — Module 8
 * Uses all available intel to build rich customer personas for Anne Klein.
 *
 * Inputs: site_analysis.json, product_catalog.json, social_intelligence.json,
 *         email_analysis.json, gsc_keywords.json, content_recommendations.json
 * Output: /data/personas.json
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { archive } = require('../utils/archive');

const LOG_FILE    = path.join(__dirname, '../logs/personas.log');
const OUTPUT_FILE = path.join(__dirname, '../data/personas.json');
const DATA_DIR    = path.join(__dirname, '../data');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function loadJson(filename) {
  const fp = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function extractBraces(text) {
  // Strip markdown code fences if present
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
  const logsDir = path.join(__dirname, '../logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  log('=== Personas Generator Started ===');

  if (fs.existsSync(OUTPUT_FILE)) {
    const dest = archive(OUTPUT_FILE);
    if (dest) log(`  Archived previous output`);
  }

  // Load all available intel
  const siteAnalysis   = loadJson('site_analysis.json');
  const productCatalog = loadJson('product_catalog.json');
  const socialIntel    = loadJson('social_intelligence.json');
  const emailAnalysis  = loadJson('email_analysis.json');
  const gscKeywords    = loadJson('gsc_keywords.json');
  const contentRecs    = loadJson('content_recommendations.json');
  const priceIntel     = loadJson('price_intelligence.json');

  // Build intel summary
  const intelSummary = [];

  if (siteAnalysis?.messagingAnalysis) {
    intelSummary.push(`COMPETITIVE MESSAGING:\n${JSON.stringify(siteAnalysis.messagingAnalysis, null, 2)}`);
  }

  if (productCatalog) {
    const cats = productCatalog.categoryCounts || {};
    const topCats = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}: ${v}`);
    intelSummary.push(`PRODUCT CATALOG: ${productCatalog.totalProducts || 0} total products\nTop categories: ${topCats.join(', ')}`);
  }

  if (socialIntel?.brands) {
    const themes = socialIntel.brands.flatMap(b => b.contentThemes || []).filter(Boolean);
    if (themes.length) intelSummary.push(`SOCIAL CONTENT THEMES:\n${themes.slice(0,20).join('\n')}`);
  }

  if (emailAnalysis?.brands) {
    const subjects = emailAnalysis.brands.flatMap(b => (b.recentEmails || []).map(e => e.subject)).filter(Boolean);
    if (subjects.length) intelSummary.push(`EMAIL SUBJECTS (competitor + AK):\n${subjects.slice(0,20).join('\n')}`);
  }

  if (gscKeywords?.keywords) {
    const topKw = (gscKeywords.keywords || []).slice(0,30).map(k=>k.query||k.keyword||k).filter(Boolean);
    intelSummary.push(`TOP GSC KEYWORDS: ${topKw.join(', ')}`);
  }

  if (contentRecs?.recommendations) {
    intelSummary.push(`CONTENT RECOMMENDATIONS:\n${JSON.stringify(contentRecs.recommendations?.slice(0,5), null, 2)}`);
  }

  if (priceIntel) {
    intelSummary.push(`PRICING: ${priceIntel.akSaleRate}% of products currently on sale, avg ${priceIntel.akAvgSaleDepth}% off`);
  }

  const combinedIntel = intelSummary.join('\n\n---\n\n');

  const prompt = `You are a consumer insights researcher specializing in women's fashion. Based on all the intelligence data below about Anne Klein and its competitive landscape, build 4 detailed customer personas for Anne Klein shoppers.

BRAND INTELLIGENCE:
${combinedIntel}

Create exactly 4 personas. For each persona include:
- name (evocative label, e.g. "The Executive Achiever")
- age range
- income (household, e.g. "$85k-$140k")
- occupation (2-3 examples)
- location (e.g. "Metro areas, Northeast and Midwest")
- lifestyle (3-4 bullet points about daily life and habits)
- values (4-5 core values)
- fashionGoals (what she wants from clothing — 3-4 points)
- shoppingBehaviors (how she shops — price sensitivity, channels, frequency — 3-4 points)
- painPoints (frustrations with current market — 3-4 points)
- motivators (what drives a purchase decision — 3-4 points)
- contentTopics (what content/messaging resonates — 4-5 topics)
- preferredChannels (social, email, in-store, online — ranked)
- annKleinFit (why AK is relevant to this persona — 2-3 sentences)
- quoteExample (one realistic quote this persona might say about fashion)

Return ONLY valid JSON with this shape:
{
  "generatedAt": "<ISO timestamp>",
  "totalPersonas": 4,
  "personas": [ /* array of 4 persona objects as described above */ ],
  "summaryInsights": [ /* 4-5 cross-persona insights for AK marketing strategy */ ]
}`;

  log('Calling Claude to generate personas...');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text;
  const jsonStr = extractBraces(raw);
  if (!jsonStr) {
    log('ERROR: Could not extract JSON from Claude response');
    log(raw.slice(0, 500));
    process.exit(1);
  }

  const output = JSON.parse(jsonStr);
  output.generatedAt = new Date().toISOString();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log('\n========================================');
  console.log('PERSONAS COMPLETE');
  console.log('========================================');
  output.personas.forEach((p, i) => {
    console.log(`\n${i+1}. ${p.name} (${p.ageRange || p.age})`);
    console.log(`   ${p.occupation}`);
    console.log(`   ${p.annKleinFit?.slice(0, 100)}...`);
  });
  if (output.summaryInsights?.length) {
    console.log('\nKey Insights:');
    output.summaryInsights.forEach(s => console.log(`  • ${s}`));
  }

  log(`=== Done — ${output.personas?.length || 0} personas written ===`);
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
