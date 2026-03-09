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
const INLINE_TAXONOMY = {
  clothing: [
    'gid://shopify/TaxonomyCategory/aa-1-10-2-1 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Bolero Jackets',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-2 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Bomber Jackets',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-3 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Capes',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-5 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Overcoats',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-6 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Parkas',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-7 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Pea Coats',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-8 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Ponchos',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-9 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Puffer Jackets',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-10 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Rain Coats',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-11 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Sport Jackets',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-12 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Track Jackets',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-13 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Trench Coats',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-14 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Trucker Jackets',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-15 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Varsity Jackets',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-16 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Windbreakers',
    'gid://shopify/TaxonomyCategory/aa-1-10-2-17 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Wrap Coats',
    'gid://shopify/TaxonomyCategory/aa-1-13-1 | Apparel & Accessories > Clothing > Clothing Tops > Blouses',
    'gid://shopify/TaxonomyCategory/aa-1-13-2 | Apparel & Accessories > Clothing > Clothing Tops > Bodysuits',
    'gid://shopify/TaxonomyCategory/aa-1-13-3 | Apparel & Accessories > Clothing > Clothing Tops > Cardigans',
    'gid://shopify/TaxonomyCategory/aa-1-13-5 | Apparel & Accessories > Clothing > Clothing Tops > Overshirts',
    'gid://shopify/TaxonomyCategory/aa-1-13-7 | Apparel & Accessories > Clothing > Clothing Tops > Shirts',
    'gid://shopify/TaxonomyCategory/aa-1-13-12 | Apparel & Accessories > Clothing > Clothing Tops > Sweaters',
    'gid://shopify/TaxonomyCategory/aa-1-13-9 | Apparel & Accessories > Clothing > Clothing Tops > Tank Tops',
    'gid://shopify/TaxonomyCategory/aa-1-13-11 | Apparel & Accessories > Clothing > Clothing Tops > Tunics',
    'gid://shopify/TaxonomyCategory/aa-1-10-2 | Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
    'gid://shopify/TaxonomyCategory/aa-1-10-6 | Apparel & Accessories > Clothing > Outerwear > Vests',
    'gid://shopify/TaxonomyCategory/aa-1-12-3 | Apparel & Accessories > Clothing > Pants > Chinos',
    'gid://shopify/TaxonomyCategory/aa-1-12-4 | Apparel & Accessories > Clothing > Pants > Jeans',
    'gid://shopify/TaxonomyCategory/aa-1-12-8 | Apparel & Accessories > Clothing > Pants > Leggings',
    'gid://shopify/TaxonomyCategory/aa-1-12-11 | Apparel & Accessories > Clothing > Pants > Trousers',
    'gid://shopify/TaxonomyCategory/aa-1-19-1 | Apparel & Accessories > Clothing > Suits > Pant Suits',
    'gid://shopify/TaxonomyCategory/aa-1-19-2 | Apparel & Accessories > Clothing > Suits > Skirt Suits',
    'gid://shopify/TaxonomyCategory/aa-1-13 | Apparel & Accessories > Clothing > Clothing Tops',
    'gid://shopify/TaxonomyCategory/aa-1-4 | Apparel & Accessories > Clothing > Dresses',
    'gid://shopify/TaxonomyCategory/aa-1-10 | Apparel & Accessories > Clothing > Outerwear',
    'gid://shopify/TaxonomyCategory/aa-1-11 | Apparel & Accessories > Clothing > Outfit Sets',
    'gid://shopify/TaxonomyCategory/aa-1-12 | Apparel & Accessories > Clothing > Pants',
    'gid://shopify/TaxonomyCategory/aa-1-15 | Apparel & Accessories > Clothing > Skirts',
    'gid://shopify/TaxonomyCategory/aa-1-19 | Apparel & Accessories > Clothing > Suits',
  ].join('\n'),
  shoes: [
    'gid://shopify/TaxonomyCategory/aa-8-1 | Apparel & Accessories > Shoes > Athletic Shoes',
    'gid://shopify/TaxonomyCategory/aa-8-3 | Apparel & Accessories > Shoes > Boots',
    'gid://shopify/TaxonomyCategory/aa-8-9 | Apparel & Accessories > Shoes > Flats',
    'gid://shopify/TaxonomyCategory/aa-8-10 | Apparel & Accessories > Shoes > Heels',
    'gid://shopify/TaxonomyCategory/aa-8-6 | Apparel & Accessories > Shoes > Sandals',
    'gid://shopify/TaxonomyCategory/aa-8-7 | Apparel & Accessories > Shoes > Slippers',
    'gid://shopify/TaxonomyCategory/aa-8-8 | Apparel & Accessories > Shoes > Sneakers',
  ].join('\n'),
  jewelry: [
    'gid://shopify/TaxonomyCategory/aa-6-3 | Apparel & Accessories > Jewelry > Bracelets',
    'gid://shopify/TaxonomyCategory/aa-6-4 | Apparel & Accessories > Jewelry > Brooches & Lapel Pins',
    'gid://shopify/TaxonomyCategory/aa-6-5 | Apparel & Accessories > Jewelry > Charms & Pendants',
    'gid://shopify/TaxonomyCategory/aa-6-6 | Apparel & Accessories > Jewelry > Earrings',
    'gid://shopify/TaxonomyCategory/aa-6-7 | Apparel & Accessories > Jewelry > Jewelry Sets',
    'gid://shopify/TaxonomyCategory/aa-6-8 | Apparel & Accessories > Jewelry > Necklaces',
    'gid://shopify/TaxonomyCategory/aa-6-9 | Apparel & Accessories > Jewelry > Rings',
    'gid://shopify/TaxonomyCategory/aa-6-12 | Apparel & Accessories > Jewelry > Smart Watches',
    'gid://shopify/TaxonomyCategory/aa-6-11 | Apparel & Accessories > Jewelry > Watches',
  ].join('\n'),
  handbags: [
    'gid://shopify/TaxonomyCategory/aa-5-4-5 | Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Clutch Bags',
    'gid://shopify/TaxonomyCategory/aa-5-4-7 | Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Cross Body Bags',
    'gid://shopify/TaxonomyCategory/aa-5-4-9 | Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Envelope Clutches',
    'gid://shopify/TaxonomyCategory/aa-5-4-12 | Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Hobo Bags',
    'gid://shopify/TaxonomyCategory/aa-5-4-16 | Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Satchel Bags',
    'gid://shopify/TaxonomyCategory/aa-5-4-18 | Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Shopper Bags',
    'gid://shopify/TaxonomyCategory/aa-5-4-19 | Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Shoulder Bags',
    'gid://shopify/TaxonomyCategory/aa-5-5-2 | Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips > Card Cases',
    'gid://shopify/TaxonomyCategory/aa-5-5-3 | Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips > Coin Purses',
    'gid://shopify/TaxonomyCategory/aa-5-5-7 | Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips > Wallets',
    'gid://shopify/TaxonomyCategory/aa-5-4 | Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
    'gid://shopify/TaxonomyCategory/aa-5-5 | Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips',
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
    ? `shopify_taxonomy_gid: Pick the single most specific matching GID from this list (return only the GID string, e.g. "gid://shopify/TaxonomyCategory/aa-1-4-3"):
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
    max_tokens: 800,
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
