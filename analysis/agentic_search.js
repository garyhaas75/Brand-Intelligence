/**
 * Module 7 — Agentic Search Visibility
 * Tests how Anne Klein appears (or doesn't) when AI shopping assistants
 * answer real customer queries. Benchmarks AK vs competitors across:
 *   - Brand discovery queries
 *   - Demographic-targeted queries
 *   - Product-specific queries
 *   - Competitor comparison queries
 *
 * Uses Claude as the AI model under test. Generates visibility scores,
 * gap analysis, and GEO (Generative Engine Optimization) recommendations.
 * Saves to /data/agentic_search.json
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { getBrandContextShort } = require('../utils/brand_context');

const LOG_FILE = path.join(__dirname, '../logs/agentic_search.log');
const OUTPUT_FILE = path.join(__dirname, '../data/agentic_search.json');

const BRANDS = ['Anne Klein', 'Ann Taylor', 'Talbots', 'White House Black Market', 'Jones New York', 'Donna Karan'];

// Queries a real shopper might ask an AI assistant
const QUERIES = [
  { id: 'brand_discover_1',   category: 'Brand Discovery',    query: 'What are the best women\'s workwear clothing brands?' },
  { id: 'brand_discover_2',   category: 'Brand Discovery',    query: 'Top women\'s professional fashion brands in the US' },
  { id: 'demographic_1',      category: 'Demographic',        query: 'Best women\'s clothing brands for professional women over 40' },
  { id: 'demographic_2',      category: 'Demographic',        query: 'Stylish work clothes for women in their 50s that aren\'t frumpy' },
  { id: 'price_tier_1',       category: 'Price-Conscious',    query: 'Affordable women\'s work clothes brands, $50 to $200 range' },
  { id: 'price_tier_2',       category: 'Price-Conscious',    query: 'Best mid-range women\'s workwear brands under $300' },
  { id: 'product_blazer',     category: 'Product-Specific',   query: 'Best brands for women\'s work blazers and suit jackets' },
  { id: 'product_dress',      category: 'Product-Specific',   query: 'Best women\'s brands for work dresses and office-appropriate dresses' },
  { id: 'product_shoes',      category: 'Product-Specific',   query: 'Best women\'s shoe brands for the office and professional settings' },
  { id: 'competitor_alt_1',   category: 'Competitor Alt',     query: 'Brands similar to Ann Taylor for women\'s work clothes' },
  { id: 'competitor_alt_2',   category: 'Competitor Alt',     query: 'Alternatives to Talbots for professional women\'s clothing' },
  { id: 'occasion_1',         category: 'Occasion',           query: 'What to wear to a job interview — best women\'s clothing brands' },
  { id: 'occasion_2',         category: 'Occasion',           query: 'Best women\'s brands for business formal and corporate attire' },
  { id: 'ak_direct',          category: 'Brand Awareness',    query: 'Tell me about Anne Klein as a clothing brand — who is it for, what do they sell, and is it good quality?' },
  { id: 'ak_vs_comp',         category: 'Brand Awareness',    query: 'How does Anne Klein compare to Ann Taylor and Talbots for women\'s workwear?' },
];

const SHOPPING_SYSTEM = `You are a knowledgeable shopping assistant helping women find the best clothing brands for their needs.
Provide honest, specific, helpful answers. Name real brands with real products. Be direct and practical.
Keep answers to 3-5 sentences or a short list. Do not add disclaimers or caveats.`;

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function ensureDirs() {
  [path.join(__dirname, '../data'), path.join(__dirname, '../logs')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function parseVisibility(response, query) {
  const text = response.toLowerCase();
  const results = {};

  for (const brand of BRANDS) {
    const brandLower = brand.toLowerCase();
    const mentioned = text.includes(brandLower);

    if (mentioned) {
      // Find position (which mention number)
      const allMentions = BRANDS.filter(b => text.includes(b.toLowerCase()));
      const position = allMentions.indexOf(brand) + 1;

      // Detect sentiment context around brand mention
      const idx = text.indexOf(brandLower);
      const context = response.substring(Math.max(0, idx - 80), Math.min(response.length, idx + 200));
      const positive = /(great|excellent|best|top|recommend|known for|quality|classic|polished|perfect|ideal|strong)/i.test(context);
      const negative = /(avoid|limited|overpriced|dated|old|boring|decline|struggling)/i.test(context);
      const sentiment = positive ? 'positive' : negative ? 'negative' : 'neutral';

      // Check if it's the first brand mentioned (top of mind)
      const firstBrand = BRANDS.find(b => text.includes(b.toLowerCase()));
      const isTopOfMind = firstBrand === brand;

      results[brand] = { mentioned: true, position, sentiment, isTopOfMind, context: context.trim() };
    } else {
      results[brand] = { mentioned: false };
    }
  }

  return results;
}

async function runQuery(client, queryDef) {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: SHOPPING_SYSTEM,
      messages: [{ role: 'user', content: queryDef.query }],
    });
    const text = response.content[0].text;
    const visibility = parseVisibility(text, queryDef.query);
    const akResult = visibility['Anne Klein'];

    return {
      id: queryDef.id,
      category: queryDef.category,
      query: queryDef.query,
      response: text,
      visibility,
      akMentioned: akResult?.mentioned || false,
      akPosition: akResult?.position || null,
      akSentiment: akResult?.sentiment || null,
      akTopOfMind: akResult?.isTopOfMind || false,
      competitorsMentioned: BRANDS.filter(b => b !== 'Anne Klein' && visibility[b]?.mentioned),
    };
  } catch (err) {
    log(`  Error on query "${queryDef.id}": ${err.message}`);
    return { id: queryDef.id, category: queryDef.category, query: queryDef.query, error: err.message };
  }
}

function computeScores(results) {
  const valid = results.filter(r => !r.error);
  const total = valid.length;
  const mentioned = valid.filter(r => r.akMentioned).length;
  const topOfMind = valid.filter(r => r.akTopOfMind).length;
  const positive = valid.filter(r => r.akSentiment === 'positive').length;

  // Per-category breakdown
  const categories = {};
  for (const r of valid) {
    if (!categories[r.category]) categories[r.category] = { total: 0, mentioned: 0 };
    categories[r.category].total++;
    if (r.akMentioned) categories[r.category].mentioned++;
  }

  // Competitor presence
  const competitorScores = {};
  for (const brand of BRANDS.filter(b => b !== 'Anne Klein')) {
    competitorScores[brand] = valid.filter(r => r.visibility?.[brand]?.mentioned).length;
  }

  // Queries where AK was invisible but competitors dominated
  const gaps = valid
    .filter(r => !r.akMentioned && r.competitorsMentioned?.length > 0)
    .map(r => ({
      query: r.query,
      category: r.category,
      competitorsPresent: r.competitorsMentioned,
    }));

  return {
    visibilityRate: total > 0 ? Math.round((mentioned / total) * 100) : 0,
    topOfMindRate: total > 0 ? Math.round((topOfMind / total) * 100) : 0,
    positiveRateWhenMentioned: mentioned > 0 ? Math.round((positive / mentioned) * 100) : 0,
    queriesTested: total,
    queriesMentioned: mentioned,
    queriesTopOfMind: topOfMind,
    categoryBreakdown: Object.entries(categories).map(([cat, d]) => ({
      category: cat,
      visibilityRate: Math.round((d.mentioned / d.total) * 100),
      mentioned: d.mentioned,
      total: d.total,
    })).sort((a, b) => b.visibilityRate - a.visibilityRate),
    competitorVisibility: Object.entries(competitorScores)
      .map(([brand, count]) => ({ brand, mentions: count, rate: Math.round((count / total) * 100) }))
      .sort((a, b) => b.mentions - a.mentions),
    gaps,
  };
}

async function generateRecommendations(client, scores, results) {
  const gapQueries = scores.gaps.slice(0, 5).map(g => `- "${g.query}" (${g.competitorsPresent.join(', ')} mentioned instead)`).join('\n');
  const topCompetitor = scores.competitorVisibility[0];
  const akRate = scores.visibilityRate;

  const brandContext = getBrandContextShort();
  const prompt = `Anne Klein's AI search visibility audit results:

BRAND CONTEXT:
${brandContext}

---

- AK mentioned in ${akRate}% of shopping queries tested (${scores.queriesMentioned}/${scores.queriesTested} queries)
- Top competitor ${topCompetitor?.brand} mentioned in ${topCompetitor?.rate}% of queries
- AK positive sentiment when mentioned: ${scores.positiveRateWhenMentioned}%

Biggest gaps — queries where AK was invisible but competitors appeared:
${gapQueries}

Category breakdown:
${scores.categoryBreakdown.map(c => `- ${c.category}: ${c.visibilityRate}% visibility`).join('\n')}

Based on these AI search visibility gaps, provide 5 specific, actionable GEO (Generative Engine Optimization) recommendations for Anne Klein to improve how AI assistants discover and recommend the brand.

Focus on: content strategy, structured data, brand authority signals, topic coverage gaps, and FAQ/editorial content that would make AI models more likely to cite AK.

Format as JSON: { "recommendations": [ { "title": "", "priority": "high/medium", "action": "specific thing to do", "rationale": "why this improves AI visibility" } ] }`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0].text;
    const start = raw.indexOf('{');
    if (start !== -1) {
      let depth = 0, end = -1;
      for (let i = start; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) return JSON.parse(raw.slice(start, end + 1));
    }
  } catch (err) {
    log(`  Recommendations error: ${err.message}`);
  }
  return { recommendations: [] };
}

async function run() {
  ensureDirs();
  log('=== Agentic Search Visibility Started ===');
  log(`Testing ${QUERIES.length} queries across ${BRANDS.length} brands`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const results = [];
  for (const queryDef of QUERIES) {
    log(`  [${queryDef.category}] ${queryDef.query.substring(0, 60)}...`);
    const result = await runQuery(client, queryDef);
    results.push(result);
    log(`  → AK mentioned: ${result.akMentioned ? 'YES' : 'NO'}${result.akTopOfMind ? ' (TOP)' : ''}${result.competitorsMentioned?.length ? ` | Competitors: ${result.competitorsMentioned.join(', ')}` : ''}`);
  }

  log('Computing visibility scores...');
  const scores = computeScores(results);

  log('Generating GEO recommendations...');
  const geo = await generateRecommendations(client, scores, results);

  const output = {
    generatedAt: new Date().toISOString(),
    model: 'claude-sonnet-4-6',
    scores,
    geoRecommendations: geo.recommendations || [],
    queryResults: results,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`=== Done. Saved to ${OUTPUT_FILE} ===`);

  console.log('\n========================================');
  console.log('MODULE 7 — AGENTIC SEARCH COMPLETE');
  console.log('========================================');
  console.log(`AK Visibility Rate: ${scores.visibilityRate}% (${scores.queriesMentioned}/${scores.queriesTested} queries)`);
  console.log(`Top of Mind Rate:   ${scores.topOfMindRate}%`);
  console.log('\nCompetitor comparison:');
  scores.competitorVisibility.forEach(c => console.log(`  ${c.brand}: ${c.rate}% (${c.mentions}/${scores.queriesTested})`));
  console.log(`\nGaps: ${scores.gaps.length} queries where AK invisible but competitors present`);
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
