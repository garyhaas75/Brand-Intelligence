/**
 * Search & SEO / GEO — scrapes on-page SEO signals and runs GEO analysis.
 *
 * On-page SEO: title, meta description, H1/H2, schema markup, speed signal.
 * Keyword Universe: ~200 terms across 8 structured categories.
 * GEO: queries Claude + Perplexity as AI shopping assistants, measures brand visibility.
 *
 * Usage: node analysis/search_seo.js --slug=<brand-slug>
 */

require('dotenv').config();
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

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

async function scrapeOnPageSeo(url) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const result = { url, titleTag: '', metaDescription: '', h1: '', h2s: [], schemaMarkup: [], canonicalTag: null, pageSpeedSignal: 'unknown', error: null };

  try {
    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    const loadTime = Date.now() - startTime;
    result.pageSpeedSignal = loadTime < 3000 ? 'fast' : loadTime < 6000 ? 'medium' : 'slow';

    result.titleTag = await page.title().catch(() => '');
    result.metaDescription = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
    result.h1 = await page.$eval('h1', el => el.innerText.trim()).catch(() => '');
    result.h2s = await page.$$eval('h2', els => els.map(e => e.innerText.trim()).filter(t => t.length > 1).slice(0, 8)).catch(() => []);
    result.canonicalTag = await page.$eval('link[rel="canonical"]', el => el.href).catch(() => null);

    const schemas = await page.$$eval('script[type="application/ld+json"]', scripts => {
      return scripts.map(s => { try { return JSON.parse(s.textContent)['@type']; } catch { return null; } }).filter(Boolean);
    }).catch(() => []);
    result.schemaMarkup = [...new Set(schemas.flat())];

    log(`  ${url}: title=${result.titleTag.slice(0, 40)}, speed=${result.pageSpeedSignal}, schema=[${result.schemaMarkup.join(',')}]`);
  } catch (err) {
    result.error = err.message;
    log(`  Error scraping ${url}: ${err.message}`);
  }

  await browser.close();
  return result;
}

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
  "ageGroupTerms": ["gifts/products for different ages — 'toys for 2 year olds', 'gifts for 8 year old boy', etc."],
  "occasionTerms": ["occasion-based queries — Christmas, birthday, Eid, back-to-school, Valentine's Day, etc. + market location"],
  "topBrands": ["carried or competing brands — 'LEGO ${market}', 'Barbie ${market}', etc."],
  "localTerms": ["local market queries — '${profile.industry} ${market}', 'toy store near me', 'online delivery ${market}', etc."],
  "competitorGapTerms": ["terms competitors likely rank for that this brand should also target"],
  "aiDiscoveryQueries": ["natural-language questions a shopper asks an AI assistant — 'what are the best toy stores in ${market}?', 'where can I buy LEGO in ${market}?', etc."]
}

Each category should have 15-30 terms. Prioritize local/market-specific terms where relevant.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0].text;
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

async function queryPerplexity(query) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: query }],
        max_tokens: 600,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

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

  // Build test queries: sample from aiDiscoveryQueries + generated category-based queries
  const aiQueries = (keywordUniverse.aiDiscoveryQueries || []).slice(0, 10);
  const hasPerplexity = !!process.env.PERPLEXITY_API_KEY;

  // Generate structured test queries
  const queryGenPrompt = `Generate 20 realistic search queries that a customer might use when looking for a ${profile.industry} brand like ${profile.name} (${profile.market || ''}).

Include these categories (4-5 queries each): brand discovery, category/product search, occasion-based, comparison/alternatives, local market.

Return a JSON array only:
[{"id": "q1", "category": "brand discovery", "query": "the search query"}]`;

  let queries = [];
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: queryGenPrompt }],
    });
    const raw = msg.content[0].text;
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) queries = JSON.parse(raw.slice(start, end + 1));
  } catch (_) { log('Could not generate dynamic queries'); }

  // Merge with aiDiscoveryQueries from keyword universe
  const extraQueries = aiQueries.map((q, i) => ({ id: `ai${i}`, category: 'ai discovery', query: q }));
  const allQueries = [...queries, ...extraQueries].slice(0, 30);

  if (allQueries.length === 0) {
    allQueries.push(
      { id: 'q1', category: 'brand discovery', query: `best ${profile.industry} stores in ${profile.market || 'my area'}` },
      { id: 'q2', category: 'comparison', query: `${brandName} alternatives` },
    );
  }

  log(`Running GEO analysis: ${allQueries.length} queries × ${hasPerplexity ? '2 agents (Claude + Perplexity)' : '1 agent (Claude)'}`);

  const claudeResults = [];
  const perplexityResults = [];

  for (const q of allQueries) {
    log(`  Query: "${q.query.slice(0, 50)}"`);

    // Claude
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: 'You are a helpful shopping assistant. Give honest, specific recommendations mentioning real brands.',
        messages: [{ role: 'user', content: q.query }],
      });
      const analysis = analyzeAgentResponse(msg.content[0].text, brandName, competitorNames);
      claudeResults.push({ ...q, agent: 'claude', ...analysis });
      log(`    Claude: ${brandName} ${analysis.brandMentioned ? 'mentioned' : 'NOT mentioned'}`);
    } catch (err) {
      claudeResults.push({ ...q, agent: 'claude', brandMentioned: false, sentiment: 'not_mentioned', competitorMentions: [], snippet: '', error: err.message });
    }

    // Perplexity (only if key configured)
    if (hasPerplexity) {
      const response = await queryPerplexity(q.query);
      const analysis = analyzeAgentResponse(response, brandName, competitorNames);
      perplexityResults.push({ ...q, agent: 'perplexity', ...analysis });
      log(`    Perplexity: ${brandName} ${analysis.brandMentioned ? 'mentioned' : 'NOT mentioned'}`);
    }
  }

  const claudeScore = allQueries.length > 0 ? Math.round((claudeResults.filter(r => r.brandMentioned).length / allQueries.length) * 100) : 0;
  const perplexityScore = perplexityResults.length > 0 ? Math.round((perplexityResults.filter(r => r.brandMentioned).length / perplexityResults.length) * 100) : null;
  const combinedScore = perplexityScore !== null ? Math.round((claudeScore + perplexityScore) / 2) : claudeScore;

  // Gap analysis
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
      ...(hasPerplexity ? { perplexity: { visibilityScore: perplexityScore, queries: perplexityResults } } : {}),
    },
    combinedScore,
    gapRecommendations,
    // Legacy field for backwards compat with existing UI
    queries: claudeResults,
    visibilityScore: claudeScore,
  };
}

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found'); process.exit(1); }
  profile.slug = slug;

  log(`Starting search/SEO audit for: ${profile.name}`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // On-page SEO for target brand
  log(`Scraping on-page SEO for ${profile.url}...`);
  const onPageSeo = await scrapeOnPageSeo(profile.url);

  // On-page SEO for competitors (top 3)
  const competitorUrls = (profile.identifiedCompetitors || []).slice(0, 3);
  const competitorSeos = [];
  for (const comp of competitorUrls) {
    log(`Scraping competitor SEO: ${comp.url}`);
    const seo = await scrapeOnPageSeo(comp.url).catch(err => ({ url: comp.url, error: err.message }));
    competitorSeos.push({ name: comp.name, ...seo });
  }

  // Generate keyword universe (~200 terms)
  log('Generating keyword universe...');
  const keywordUniverse = await generateKeywordUniverse(anthropic, profile, onPageSeo, competitorSeos).catch(() => ({ totalCount: 0 }));

  // GEO analysis (Claude + Perplexity)
  log('Running GEO (Generative Engine Optimization) analysis...');
  const geoSection = await runGeoAnalysis(anthropic, profile, keywordUniverse).catch(err => {
    log(`GEO error: ${err.message}`);
    return { queries: [], visibilityScore: 0, combinedScore: 0, byAgent: { claude: { visibilityScore: 0, queries: [] } }, gapRecommendations: ['GEO analysis failed — check API key'] };
  });

  const now = new Date().toISOString();
  const output = {
    generatedAt: now,
    brandSlug: slug,
    onPageSeo,
    competitors: competitorSeos,
    keywordUniverse,
    // Legacy field kept for backwards compat
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
  log(`Done. Keywords: ${keywordUniverse.totalCount || 0}. GEO combined: ${geoSection.combinedScore}%.`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
