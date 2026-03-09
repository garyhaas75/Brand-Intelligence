/**
 * SEO Product Analyzer — Phase 2 (updated)
 * Analyzes Anne Klein products in batches and suggests:
 *   - Optimized meta title (under 60 chars)
 *   - Optimized meta description (under 160 chars)
 *   - Improved tags (search-friendly, persona-aware)
 *   - Image insights (derived from product image via Claude Vision)
 *   - Alt text for Shopify productUpdateMedia
 *   - GEO description for AI assistant discoverability
 *   - Category-specific Shopify taxonomy metafields:
 *       clothing  → material, care_instructions, fit_type
 *       shoes     → material, heel_style, closure_type
 *       jewelry   → material, closure_type
 *       handbags  → material, closure_type
 *   - shopify_category → suggested Shopify taxonomy string for productType
 *
 * Tracks analyzed products so re-runs skip already-processed items.
 * Use --force to re-analyze and update products already in the file.
 *
 * Supports --filter=new_arrivals|clothing|jewelry|shoes|handbags
 * Supports --limit=N (default 50)
 * Supports --force (re-analyze products already processed, updates in place)
 *
 * Usage:
 *   node analysis/seo_product_analyzer.js
 *   node analysis/seo_product_analyzer.js --filter=new_arrivals --limit=25
 *   node analysis/seo_product_analyzer.js --filter=clothing --force
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { getBrandContext } = require('../utils/brand_context');

const LOG_FILE       = path.join(__dirname, '../logs/seo_product_analyzer.log');
const CATALOG_FILE   = path.join(__dirname, '../data/product_catalog.json');
const OUTPUT_FILE    = path.join(__dirname, '../data/seo_suggestions.json');
const TAXONOMY_FILE  = path.join(__dirname, '../data/shopify_taxonomy.json');

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const filterArg = (args.find(a => a.startsWith('--filter=')) || '').replace('--filter=', '') || 'all';
const limitArg  = parseInt((args.find(a => a.startsWith('--limit='))  || '').replace('--limit=', '')) || 50;
const FORCE     = args.includes('--force');
const hrefArg   = (args.find(a => a.startsWith('--href=')) || '').replace('--href=', '') || null;

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

// Inline taxonomy — embedded so Railway volume mount can't shadow the file.
// Sourced from Shopify product taxonomy 2026-05. Update quarterly via sync_taxonomy.js.
// Only AK-relevant categories included (women's workwear, shoes, jewelry, handbags).
// Rules: ONLY leaf nodes (no entry if it has children also in this list).
// This forces Claude to always pick a specific type, never a vague parent category.
const INLINE_TAXONOMY = {
  clothing: [
    // Coats & Jackets — leaf types only (parent "Coats & Jackets" removed)
    'gid://shopify/TaxonomyCategory/aa-1-10-2-1 | Bolero Jackets (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-2 | Bomber Jackets (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-3 | Capes (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-5 | Overcoats (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-6 | Parkas (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-7 | Pea Coats (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-9 | Puffer Jackets (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-11 | Sport Jackets / Blazers (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-13 | Trench Coats (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-17 | Wrap Coats (Clothing > Outerwear)',
    'gid://shopify/TaxonomyCategory/aa-1-10-6 | Vests (Clothing > Outerwear)',
    // Tops — leaf types only (parent "Clothing Tops" removed)
    'gid://shopify/TaxonomyCategory/aa-1-13-1 | Blouses (Clothing > Tops)',
    'gid://shopify/TaxonomyCategory/aa-1-13-2 | Bodysuits (Clothing > Tops)',
    'gid://shopify/TaxonomyCategory/aa-1-13-3 | Cardigans (Clothing > Tops)',
    'gid://shopify/TaxonomyCategory/aa-1-13-5 | Overshirts (Clothing > Tops)',
    'gid://shopify/TaxonomyCategory/aa-1-13-7 | Shirts (Clothing > Tops)',
    'gid://shopify/TaxonomyCategory/aa-1-13-12 | Sweaters (Clothing > Tops)',
    'gid://shopify/TaxonomyCategory/aa-1-13-9 | Tank Tops (Clothing > Tops)',
    'gid://shopify/TaxonomyCategory/aa-1-13-11 | Tunics (Clothing > Tops)',
    // Pants — leaf types only (parent "Pants" removed)
    'gid://shopify/TaxonomyCategory/aa-1-12-3 | Chinos (Clothing > Pants)',
    'gid://shopify/TaxonomyCategory/aa-1-12-4 | Jeans (Clothing > Pants)',
    'gid://shopify/TaxonomyCategory/aa-1-12-8 | Leggings (Clothing > Pants)',
    'gid://shopify/TaxonomyCategory/aa-1-12-11 | Trousers / Dress Pants (Clothing > Pants)',
    // Suits — leaf types only (parent "Suits" removed)
    'gid://shopify/TaxonomyCategory/aa-1-19-1 | Pant Suits (Clothing > Suits)',
    'gid://shopify/TaxonomyCategory/aa-1-19-2 | Skirt Suits (Clothing > Suits)',
    // No-child categories (kept as-is)
    'gid://shopify/TaxonomyCategory/aa-1-4 | Dresses (Clothing)',
    'gid://shopify/TaxonomyCategory/aa-1-11 | Outfit Sets / Matching Sets (Clothing)',
    'gid://shopify/TaxonomyCategory/aa-1-15 | Skirts (Clothing)',
  ].join('\n'),
  shoes: [
    'gid://shopify/TaxonomyCategory/aa-8-1 | Athletic Shoes (Shoes)',
    'gid://shopify/TaxonomyCategory/aa-8-3 | Boots (Shoes)',
    'gid://shopify/TaxonomyCategory/aa-8-9 | Flats (Shoes)',
    'gid://shopify/TaxonomyCategory/aa-8-10 | Heels / Pumps (Shoes)',
    'gid://shopify/TaxonomyCategory/aa-8-6 | Sandals (Shoes)',
    'gid://shopify/TaxonomyCategory/aa-8-8 | Sneakers (Shoes)',
  ].join('\n'),
  jewelry: [
    'gid://shopify/TaxonomyCategory/aa-6-3 | Bracelets (Jewelry)',
    'gid://shopify/TaxonomyCategory/aa-6-4 | Brooches & Lapel Pins (Jewelry)',
    'gid://shopify/TaxonomyCategory/aa-6-5 | Charms & Pendants (Jewelry)',
    'gid://shopify/TaxonomyCategory/aa-6-6 | Earrings (Jewelry)',
    'gid://shopify/TaxonomyCategory/aa-6-7 | Jewelry Sets (Jewelry)',
    'gid://shopify/TaxonomyCategory/aa-6-8 | Necklaces (Jewelry)',
    'gid://shopify/TaxonomyCategory/aa-6-9 | Rings (Jewelry)',
    'gid://shopify/TaxonomyCategory/aa-6-11 | Watches (Jewelry)',
  ].join('\n'),
  handbags: [
    'gid://shopify/TaxonomyCategory/aa-5-4-5 | Clutch Bags (Handbags)',
    'gid://shopify/TaxonomyCategory/aa-5-4-7 | Cross Body Bags (Handbags)',
    'gid://shopify/TaxonomyCategory/aa-5-4-9 | Envelope Clutches (Handbags)',
    'gid://shopify/TaxonomyCategory/aa-5-4-12 | Hobo Bags (Handbags)',
    'gid://shopify/TaxonomyCategory/aa-5-4-16 | Satchel Bags (Handbags)',
    'gid://shopify/TaxonomyCategory/aa-5-4-18 | Shopper / Tote Bags (Handbags)',
    'gid://shopify/TaxonomyCategory/aa-5-4-19 | Shoulder Bags (Handbags)',
    'gid://shopify/TaxonomyCategory/aa-5-5-2 | Card Cases (Wallets)',
    'gid://shopify/TaxonomyCategory/aa-5-5-3 | Coin Purses (Wallets)',
    'gid://shopify/TaxonomyCategory/aa-5-5-7 | Wallets (Wallets)',
  ].join('\n'),
};

// Return the inline taxonomy options string for the given category group.
function getTaxonomyOptions(categoryGroup) {
  return INLINE_TAXONOMY[categoryGroup] || null;
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

// ─── Detect Shopify category group from product category string ───────────────
function detectCategoryGroup(category) {
  const c = (category || '').toLowerCase();
  if (/shoe|heel|boot|flat|sandal|loafer|pump|wedge|mule/i.test(c)) return 'shoes';
  if (/jewelry|earring|necklace|bracelet|ring|watch|pendant|bangle/i.test(c)) return 'jewelry';
  if (/handbag|bag|purse|satchel|tote|crossbody|wallet|clutch/i.test(c)) return 'handbags';
  if (/clothing|blazer|jacket|pant|dress|top|shirt|skirt|suit|cardigan|sweater|coat|blouse/i.test(c)) return 'clothing';
  return 'other';
}

// Returns extra field instructions + JSON schema additions per category.
// Injects real taxonomy GIDs from the synced taxonomy file so Claude picks
// an exact valid GID instead of guessing a free-text string.
function getCategoryPromptSection(categoryGroup, hasImage) {
  const imageNote = hasImage ? ' (infer from the image if visible)' : ' (infer from the product name/description)';
  const taxonomyOptions = getTaxonomyOptions(categoryGroup);

  const taxonomyInstruction = taxonomyOptions
    ? `shopify_taxonomy_gid: Pick the DEEPEST (most specific leaf-level) matching GID from this list. Always prefer a subcategory over its parent — e.g. pick "Sport Jackets" over "Coats & Jackets", pick "Trousers" over "Pants". Return only the GID string, no other text:
${taxonomyOptions}`
    : `shopify_taxonomy_gid: The Shopify taxonomy GID for this product type (format: "gid://shopify/TaxonomyCategory/aa-X-X").`;

  switch (categoryGroup) {
    case 'clothing':
      return {
        fields: `7. material: The primary fabric or material composition${imageNote}. Be specific: "Ponte knit blend", "Stretch crepe", "Woven polyester". Not just "fabric".
8. care_instructions: One line, practical${imageNote}. E.g., "Machine wash cold, tumble dry low" or "Hand wash or dry clean recommended".
9. fit_type: How it fits the body${imageNote}. One of: Slim, Regular, Relaxed, Tailored, Fitted, Straight. One word or short phrase.
10. ${taxonomyInstruction}`,
        schema: `  "material": "",
  "care_instructions": "",
  "fit_type": "",
  "shopify_taxonomy_gid": ""`,
      };

    case 'shoes':
      return {
        fields: `7. material: Upper material${imageNote}. E.g., "Faux leather upper, synthetic sole" or "Suede upper, leather lining".
8. heel_style: Heel type and height if visible${imageNote}. E.g., "Block heel, 2.5 inch", "Kitten heel, 1.5 inch", "Flat", "Wedge, 3 inch".
9. closure_type: How the shoe is put on/secured${imageNote}. E.g., "Slip-on", "Ankle strap with buckle", "Side zip", "Lace-up".
10. ${taxonomyInstruction}`,
        schema: `  "material": "",
  "heel_style": "",
  "closure_type": "",
  "shopify_taxonomy_gid": ""`,
      };

    case 'jewelry':
      return {
        fields: `7. material: Metal finish and base material${imageNote}. E.g., "Gold-tone base metal", "Silver-tone stainless steel", "Rose gold-plated brass".
8. closure_type: How the piece fastens${imageNote}. For earrings: "Push back", "Lever back", "Clip-on". For necklaces: "Lobster clasp". For bracelets: "Toggle clasp", "Magnetic clasp".
9. ${taxonomyInstruction}`,
        schema: `  "material": "",
  "closure_type": "",
  "shopify_taxonomy_gid": ""`,
      };

    case 'handbags':
      return {
        fields: `7. material: Exterior material${imageNote}. E.g., "Faux leather with fabric lining", "Quilted nylon", "Smooth vegan leather".
8. closure_type: How the bag closes${imageNote}. E.g., "Magnetic snap flap", "Zip-top", "Open top with inner zip pocket", "Flap with turn-lock".
9. strap_drop: Strap length or carry style${imageNote}. E.g., "10-inch top handle drop", "22-inch adjustable strap", "Detachable chain strap".
10. ${taxonomyInstruction}`,
        schema: `  "material": "",
  "closure_type": "",
  "strap_drop": "",
  "shopify_taxonomy_gid": ""`,
      };

    default:
      return {
        fields: `7. ${taxonomyInstruction}`,
        schema: `  "shopify_taxonomy_gid": ""`,
      };
  }
}

// ─── Main analysis function ───────────────────────────────────────────────────
async function analyzeProduct(client, product, brandContext) {
  const imageData = product.image ? await fetchImageBase64(product.image) : null;
  const categoryGroup = detectCategoryGroup(product.category);
  const catSection = getCategoryPromptSection(categoryGroup, !!imageData);

  const content = [];
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
    text: `You are an SEO and merchandising specialist for Anne Klein, a women's workwear brand.

BRAND CONTEXT:
${brandContext}

PRODUCT:
Name: ${product.name}
Category: ${product.category || 'Unknown'} (type: ${categoryGroup})
Price: ${product.price || 'Unknown'}
Current description: ${(product.description || '').substring(0, 400)}
Current tags: ${existingTags || 'none'}
${imageData ? 'Product image included above.' : 'No image available.'}

${imageData ? 'First, analyze the product image: material appearance, silhouette/cut, construction details, occasion suitability.' : ''}

Generate ALL of the following fields:

1. meta_title: Under 60 characters. Product type + key attribute + brand name. Natural, not keyword-stuffed. Example: "Ponte Blazer with Welt Pockets | Anne Klein"
2. meta_description: Under 160 characters. Lead with the purchase reason for a professional woman. Include 1-2 natural search phrases. Soft CTA at end.
3. tags: 6-10 clean search-friendly tags. Mix: product type, occasion (work, office, professional), style descriptor, material. No internal codes or operational tags.
4. image_insights: ${imageData ? '1-2 sentences on what the image reveals about material, silhouette, and occasion that the current description misses.' : 'null'}
5. alt_text: Under 125 characters. Descriptive image alt text. Describe what is literally shown: product type, color, key style details. Do NOT start with "Image of" or "Photo of".
6. geo_description: 2-3 sentences for AI assistant discoverability. Answer a query like "best blazers for work" or "professional outfit ideas". Name product type and brand naturally. Include one specific functional feature. No superlatives.
${catSection.fields}

Return ONLY valid JSON (no markdown, no explanation):
{
  "meta_title": "",
  "meta_description": "",
  "tags": [],
  "image_insights": "",
  "alt_text": "",
  "geo_description": "",
  ${catSection.schema}
}`,
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
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
  const parsed = JSON.parse(raw.slice(start, end + 1));

  // Validate taxonomy GID — Claude sometimes hallucinates a GID not in the options list.
  // Build the valid set from the same options we sent, then clear if invalid.
  log(`    GID from Claude: ${parsed.shopify_taxonomy_gid || '(none)'} | material="${parsed.material||''}" fit="${parsed.fit_type||''}" heel="${parsed.heel_style||''}"`);
  const categoryGroup2 = detectCategoryGroup(product.category);
  const validOptions = getTaxonomyOptions(categoryGroup2);
  if (parsed.shopify_taxonomy_gid && validOptions) {
    const validGids = new Set(validOptions.split('\n').map(line => line.split(' | ')[0].trim()));
    if (!validGids.has(parsed.shopify_taxonomy_gid)) {
      log(`    WARN: Claude returned invalid GID "${parsed.shopify_taxonomy_gid}" — cleared`);
      parsed.shopify_taxonomy_gid = null;
    }
  }
  return parsed;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
async function run() {
  const logsDir = path.join(__dirname, '../logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  log(`=== SEO Product Analyzer Started — ${hrefArg ? `single: ${hrefArg}` : `filter: ${filterArg}, limit: ${limitArg}`}${FORCE ? ', FORCE' : ''} ===`);

  const catalog = loadJSON(CATALOG_FILE);
  if (!catalog?.products?.length) {
    log('FATAL: product_catalog.json not found or empty. Run npm run scrape:products first.');
    process.exit(1);
  }

  const suggestions = loadSuggestions();
  const analyzedHrefs = new Set(suggestions.products.map(p => p.href));

  // Single-product mode (--href=): always re-analyzes that one product
  let pool;
  if (hrefArg) {
    pool = catalog.products.filter(p => p.href === hrefArg);
    if (!pool.length) { log(`FATAL: Product not found in catalog: ${hrefArg}`); process.exit(1); }
  } else {
    // Filter products — with --force, include already-analyzed ones too
    pool = filterProducts(catalog.products, filterArg)
      .filter(p => FORCE ? true : !analyzedHrefs.has(p.href));
  }

  if (pool.length === 0) {
    log(`No products found for filter "${filterArg}"${FORCE ? '' : ' (all already analyzed — use --force to re-analyze)'}. Done.`);
    process.exit(0);
  }

  const batch = pool.slice(0, limitArg);
  log(`${pool.length} products in pool. Analyzing ${batch.length} now.`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const brandContext = getBrandContext();

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const product = batch[i];
    const categoryGroup = detectCategoryGroup(product.category);
    log(`  [${i + 1}/${batch.length}] [${categoryGroup}] ${product.name.substring(0, 55)}`);

    try {
      const suggested = await analyzeProduct(client, product, brandContext);

      const entry = {
        href: product.href,
        id: product.id,
        name: product.name,
        category: product.category,
        categoryGroup,
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
      };

      if ((FORCE || hrefArg) && analyzedHrefs.has(product.href)) {
        // Update in place — preserve approval status and push state
        const idx = suggestions.products.findIndex(p => p.href === product.href);
        const existing = suggestions.products[idx];
        suggestions.products[idx] = {
          ...entry,
          status: existing.status,
          approvedAt: existing.approvedAt,
          pushStatus: existing.pushStatus,
          pushedAt: existing.pushedAt,
          shopifyGid: existing.shopifyGid,
        };
        log(`    → Updated (was ${existing.status})`);
      } else {
        suggestions.products.push(entry);
      }

      successCount++;
    } catch (err) {
      log(`    ERROR: ${err.message}`);
      errorCount++;
    }

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
