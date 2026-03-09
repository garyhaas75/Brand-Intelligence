/**
 * SEO Product Analyzer — Phase 2
 * Analyzes Anne Klein products in batches and suggests:
 *   - Optimized meta title (under 60 chars)
 *   - Optimized meta description (under 160 chars)
 *   - Improved tags (search-friendly, persona-aware)
 *   - Image insights (derived from product image via Claude Vision)
 *
 * Tracks analyzed products so re-runs skip already-processed items.
 * Supports --filter=new_arrivals|clothing|jewelry|shoes|handbags
 * Supports --limit=N (default 50)
 *
 * Usage:
 *   node analysis/seo_product_analyzer.js
 *   node analysis/seo_product_analyzer.js --filter=new_arrivals --limit=25
 *   node analysis/seo_product_analyzer.js --filter=clothing --limit=50
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { getBrandContext } = require('../utils/brand_context');

const LOG_FILE     = path.join(__dirname, '../logs/seo_product_analyzer.log');
const CATALOG_FILE = path.join(__dirname, '../data/product_catalog.json');
const OUTPUT_FILE  = path.join(__dirname, '../data/seo_suggestions.json');

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const filterArg = (args.find(a => a.startsWith('--filter=')) || '').replace('--filter=', '') || 'all';
const limitArg  = parseInt((args.find(a => a.startsWith('--limit='))  || '').replace('--limit=', '')) || 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function loadJSON(fp) {
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function loadSuggestions() {
  return loadJSON(OUTPUT_FILE) || { lastRunAt: null, totalAnalyzed: 0, totalProducts: 0, products: [] };
}

function saveSuggestions(data) {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
}

// Fetch image as base64 for Claude Vision
function fetchImageBase64(url) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http')) return resolve(null);
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || 'image/jpeg';
        resolve({ base64: buf.toString('base64'), mediaType: ct.split(';')[0] });
      });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// ─── Product filtering ────────────────────────────────────────────────────────
function filterProducts(products, filter) {
  switch (filter) {
    case 'new_arrivals':
      return products.filter(p => p.isNewArrival || p.subcategory === 'new' || (p.tags || []).some(t => /new.arrival|new.in/i.test(t)));
    case 'clothing':
      return products.filter(p => /clothing|blazer|jacket|pant|dress|top|shirt|skirt|suit/i.test(p.category || ''));
    case 'shoes':
      return products.filter(p => /shoe|heel|boot|flat|sandal|loafer|pump/i.test(p.category || ''));
    case 'jewelry':
      return products.filter(p => /jewelry|earring|necklace|bracelet|ring|watch/i.test(p.category || ''));
    case 'handbags':
      return products.filter(p => /handbag|bag|purse|satchel|tote|crossbody|wallet/i.test(p.category || ''));
    default:
      return products;
  }
}

// ─── Main analysis function ───────────────────────────────────────────────────
async function analyzeProduct(client, product, brandContext) {
  const imageData = product.image ? await fetchImageBase64(product.image) : null;

  // Build the message content
  const content = [];

  // If we have an image, include it for vision analysis
  if (imageData) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: imageData.mediaType, data: imageData.base64 },
    });
  }

  const existingTags = (product.tags || [])
    .filter(t => !/enrich:|gorgias|2026|2025|discount|do.not/i.test(t))
    .slice(0, 10)
    .join(', ');

  content.push({
    type: 'text',
    text: `You are an SEO specialist for Anne Klein, a women's workwear brand.

BRAND CONTEXT:
${brandContext}

PRODUCT:
Name: ${product.name}
Category: ${product.category || 'Unknown'}
Price: ${product.price || 'Unknown'}
Current description: ${(product.description || '').substring(0, 400)}
Current tags: ${existingTags || 'none'}
${imageData ? 'Product image included above.' : 'No image available.'}

${imageData ? `First, analyze the product image and note: material appearance, silhouette/cut, occasion suitability, who it is clearly for.` : ''}

Then generate:
1. meta_title: Under 60 characters. Include product type + key attribute + brand name. Natural, not keyword-stuffed. Example: "Ponte Blazer with Welt Pockets | Anne Klein"
2. meta_description: Under 160 characters. Lead with what makes this piece worth buying for a professional woman. Include 1-2 search-natural phrases. End with a soft CTA.
3. tags: 6-10 clean, search-friendly tags. Mix of: product type, occasion (work, office, professional), style descriptor, material if obvious from image. No internal codes, dates, or operational tags.
4. image_insights: ${imageData ? '1-2 sentences on what the image reveals about material, silhouette, and occasion — facts the current description may be missing.' : 'null (no image)'}

Return ONLY valid JSON:
{
  "meta_title": "",
  "meta_description": "",
  "tags": [],
  "image_insights": ""
}`,
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content }],
  });

  const raw = response.content[0].text;
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('No JSON in response');
  let depth = 0, end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Unbalanced JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

// ─── Run ──────────────────────────────────────────────────────────────────────
async function run() {
  const logsDir = path.join(__dirname, '../logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  log(`=== SEO Product Analyzer Started — filter: ${filterArg}, limit: ${limitArg} ===`);

  const catalog = loadJSON(CATALOG_FILE);
  if (!catalog?.products?.length) {
    log('FATAL: product_catalog.json not found or empty. Run npm run scrape:products first.');
    process.exit(1);
  }

  const suggestions = loadSuggestions();
  const analyzedHrefs = new Set(suggestions.products.map(p => p.href));

  // Filter + exclude already analyzed
  const pool = filterProducts(catalog.products, filterArg)
    .filter(p => !analyzedHrefs.has(p.href));

  if (pool.length === 0) {
    log(`No unanalyzed products found for filter "${filterArg}". All done or try a different filter.`);
    process.exit(0);
  }

  const batch = pool.slice(0, limitArg);
  log(`${pool.length} unanalyzed products in pool. Analyzing ${batch.length} now.`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const brandContext = getBrandContext();

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const product = batch[i];
    log(`  [${i + 1}/${batch.length}] ${product.name.substring(0, 60)}`);

    try {
      const suggested = await analyzeProduct(client, product, brandContext);

      suggestions.products.push({
        href: product.href,
        id: product.id,
        name: product.name,
        category: product.category,
        image: product.image || null,
        price: product.price,
        isNewArrival: product.isNewArrival || false,
        current: {
          description: (product.description || '').substring(0, 300),
          tags: (product.tags || []).filter(t => !/enrich:|gorgias|2026|2025|discount|do.not/i.test(t)).slice(0, 10),
        },
        suggested,
        status: 'pending',
        analyzedAt: new Date().toISOString(),
        approvedAt: null,
      });

      successCount++;
    } catch (err) {
      log(`    ERROR: ${err.message}`);
      errorCount++;
    }

    // Small delay to respect rate limits
    if (i < batch.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  suggestions.lastRunAt = new Date().toISOString();
  suggestions.totalAnalyzed = suggestions.products.length;
  suggestions.totalProducts = catalog.totalProducts;
  suggestions.filterUsed = filterArg;
  saveSuggestions(suggestions);

  log(`=== Done. ${successCount} analyzed, ${errorCount} errors. Total in file: ${suggestions.totalAnalyzed}/${catalog.totalProducts} ===`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
