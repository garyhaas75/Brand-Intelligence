/**
 * Module 3 — Site Intelligence Analysis
 * Reads /data/site_intelligence.json and /data/product_catalog.json,
 * uses Claude API to generate:
 *   - Navigation gap report with specific recommendations
 *   - Missing category opportunities
 *   - Homepage messaging comparison
 *   - Product catalog summary (for other modules to consume)
 * Saves to /data/site_analysis.json
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/site_analysis.log');
const SITE_INTEL_FILE = path.join(__dirname, '../data/site_intelligence.json');
const PRODUCT_CATALOG_FILE = path.join(__dirname, '../data/product_catalog.json');
const OUTPUT_FILE = path.join(__dirname, '../data/site_analysis.json');

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}. Run the scraper first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function analyzeWithClaude(client, prompt, systemPrompt) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].text;
}

async function run() {
  ensureDir(path.join(__dirname, '../logs'));
  ensureDir(path.join(__dirname, '../data'));
  log('=== Site Analysis Started ===');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const siteIntel = loadJSON(SITE_INTEL_FILE, 'Site intelligence');
  const productCatalog = loadJSON(PRODUCT_CATALOG_FILE, 'Product catalog');

  const systemPrompt = `You are a senior brand strategist for Anne Klein, a women's workwear brand founded in 1968.
Anne Klein serves the Polished Professional — women aged 38–55, income $55K–$95K, working as managers, teachers, healthcare admins, HR directors, accountants, and coordinators.
She wants to look polished and credible at work without overthinking it. She values versatility, quality, and fair price.
She is NOT a CEO, C-suite exec, luxury shopper, or trend-chaser.

Anne Klein's voice: Approachable authority. Warm, practical, classic. Never stiff.
Price range: $50–$300.

Competitors in scope: Donna Karan (premium/aspirational ceiling), Jones New York (basic/dated — our floor), Calvin Klein Women's (minimalist, younger), Tahari ASL (direct workwear competitor), Liz Claiborne (value/broad distribution).

Provide specific, actionable recommendations that Anne Klein can realistically implement. Be direct and concise.`;

  // --- Analysis 1: Navigation & Category Gaps ---
  log('Analyzing navigation and category gaps...');

  const akBrand = siteIntel.brands.find(b => b.id === 'anne_klein') || {};
  const competitors = siteIntel.brands.filter(b => b.role === 'competitor');

  const navPrompt = `Here is the navigation data scraped from all 6 brand websites:

ANNE KLEIN (our site):
Categories/Nav: ${JSON.stringify(akBrand.featuredCategories || [], null, 2)}

COMPETITORS:
${competitors
  .map(
    b => `
${b.name.toUpperCase()}:
Categories/Nav: ${JSON.stringify(b.featuredCategories || [], null, 2)}
`
  )
  .join('')}

CATEGORY GAPS (categories on competitor sites not on ours):
${JSON.stringify(siteIntel.categoryGapAnalysis?.gaps || [], null, 2)}

Based on this data, provide:
1. TOP 5 MISSING CATEGORIES: The most impactful categories we should add to our navigation, with a one-sentence rationale for each
2. NAVIGATION STRUCTURE RECOMMENDATION: How should we restructure our top nav to better serve the Polished Professional (3-5 bullet points)
3. COMPETITOR NAVIGATION INSIGHTS: What is each competitor doing in their nav that's notable — positive or negative (1 sentence each)

Format your response as JSON with keys: missingCategories, navigationRecommendations, competitorInsights`;

  let navigationAnalysis = {};
  try {
    const navRaw = await analyzeWithClaude(client, navPrompt, systemPrompt);
    // Extract JSON from response
    const jsonMatch = navRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      navigationAnalysis = JSON.parse(jsonMatch[0]);
    } else {
      navigationAnalysis = { raw: navRaw };
    }
    log('Navigation analysis complete');
  } catch (err) {
    log(`Navigation analysis error: ${err.message}`);
    navigationAnalysis = { error: err.message };
  }

  // --- Analysis 2: Homepage Messaging Comparison ---
  log('Analyzing homepage messaging...');

  const heroPrompt = `Here is the homepage hero and promo banner content scraped from all 6 brand sites:

${siteIntel.brands
  .map(
    b => `
${b.name.toUpperCase()} (${b.role === 'ours' ? 'US' : 'competitor'}):
Hero headline: "${b.heroContent?.headline || 'n/a'}"
Hero text: ${JSON.stringify(b.heroContent?.allText || [], null, 2)}
Promo banners: ${JSON.stringify(b.promoBanners || [], null, 2)}
`
  )
  .join('')}

Based on this data, provide:
1. MESSAGING THEMES: What is each brand leading with above the fold? (1-2 sentences each)
2. AK POSITIONING OPPORTUNITY: Where is there a clear gap in positioning that Anne Klein could own? (2-3 sentences)
3. PROMO STRATEGY: What promotional angles are competitors using that we should consider or avoid? (bullet points)
4. RECOMMENDED AK HERO MESSAGES: Write 3 sample hero headlines for anneklein.com that match our brand voice and would resonate with the Polished Professional

Format as JSON with keys: messagingThemes, positioningOpportunity, promoStrategy, recommendedHeadlines`;

  let messagingAnalysis = {};
  try {
    const msgRaw = await analyzeWithClaude(client, heroPrompt, systemPrompt);
    const jsonMatch = msgRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      messagingAnalysis = JSON.parse(jsonMatch[0]);
    } else {
      messagingAnalysis = { raw: msgRaw };
    }
    log('Messaging analysis complete');
  } catch (err) {
    log(`Messaging analysis error: ${err.message}`);
    messagingAnalysis = { error: err.message };
  }

  // --- Analysis 3: Product Catalog Summary ---
  log('Generating product catalog summary...');

  const catalogSummary = {
    totalProducts: productCatalog.totalProducts,
    categoryCounts: productCatalog.categoryCounts,
    priceRange: getPriceRange(productCatalog.products),
    sampleProducts: productCatalog.products.slice(0, 20).map(p => ({
      name: p.name,
      category: p.category,
      price: p.price,
    })),
  };

  const catalogPrompt = `Here is a summary of the Anne Klein product catalog we scraped:

Total products: ${catalogSummary.totalProducts}
Category breakdown: ${JSON.stringify(catalogSummary.categoryCounts, null, 2)}
Price range: ${JSON.stringify(catalogSummary.priceRange, null, 2)}
Sample products: ${JSON.stringify(catalogSummary.sampleProducts, null, 2)}

Based on this catalog data:
1. CATALOG HEALTH: What does this catalog say about Anne Klein's current product strategy? (2-3 sentences)
2. MERCHANDISING GAPS: Based on competitor navigation categories and our catalog, what product gaps exist? (bullet points, be specific)
3. CONTENT OPPORTUNITIES: Which product categories in our catalog are underrepresented in marketing content and deserve more spotlight? (top 3, with rationale)

Format as JSON with keys: catalogHealth, merchandisingGaps, contentOpportunities`;

  let catalogAnalysis = {};
  try {
    const catRaw = await analyzeWithClaude(client, catalogPrompt, systemPrompt);
    const jsonMatch = catRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      catalogAnalysis = JSON.parse(jsonMatch[0]);
    } else {
      catalogAnalysis = { raw: catRaw };
    }
    log('Catalog analysis complete');
  } catch (err) {
    log(`Catalog analysis error: ${err.message}`);
    catalogAnalysis = { error: err.message };
  }

  // --- Compile and save ---
  const output = {
    generatedAt: new Date().toISOString(),
    navigationAnalysis,
    messagingAnalysis,
    catalogAnalysis,
    catalogSummary,
    rawCategoryGaps: siteIntel.categoryGapAnalysis,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`=== Analysis complete. Saved to ${OUTPUT_FILE} ===`);

  // Print key findings to console
  console.log('\n========================================');
  console.log('MODULE 3 ANALYSIS COMPLETE');
  console.log('========================================');

  if (navigationAnalysis.missingCategories) {
    console.log('\nTOP MISSING CATEGORIES:');
    (navigationAnalysis.missingCategories || []).forEach((cat, i) => {
      console.log(`  ${i + 1}. ${typeof cat === 'string' ? cat : JSON.stringify(cat)}`);
    });
  }

  if (messagingAnalysis.recommendedHeadlines) {
    console.log('\nRECOMMENDED AK HERO HEADLINES:');
    (messagingAnalysis.recommendedHeadlines || []).forEach((h, i) => {
      const text = typeof h === 'string' ? h : (h.headline || JSON.stringify(h));
      console.log(`  ${i + 1}. "${text}"`);
    });
  }

  console.log(`\nFull report: ${OUTPUT_FILE}`);
}

function getPriceRange(products) {
  const prices = products
    .map(p => {
      const match = (p.price || '').match(/\$([\d,]+\.?\d*)/);
      return match ? parseFloat(match[1].replace(',', '')) : null;
    })
    .filter(Boolean);

  if (!prices.length) return { min: null, max: null, avg: null };

  return {
    min: `$${Math.min(...prices).toFixed(2)}`,
    max: `$${Math.max(...prices).toFixed(2)}`,
    avg: `$${(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)}`,
    count: prices.length,
  };
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
