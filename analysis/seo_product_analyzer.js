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

// Resize Shopify CDN image URLs to max 600px wide before fetching.
// A full-res product photo is 2-4MB; the 600px version is ~60-120KB.
// Sending 4MB base64 to Claude takes minutes to upload — this caps it at seconds.
// Format: image.jpg?v=xxx  →  image_600x.jpg?v=xxx
function resizeShopifyUrl(url, width = 600) {
  if (!url || !url.includes('cdn.shopify.com')) return url;
  return url.replace(/(\.\w{3,4})(\?|$)/, `_${width}x$1$2`);
}

// Fetch image as base64 for Claude Vision.
// Uses Promise.race with a hard 15s wall-clock deadline — unconditionally wins
// regardless of whether the TCP handshake or data transfer stalls.
function fetchImageBase64(url) {
  if (!url || !url.startsWith('http')) return Promise.resolve(null);

  const deadline = new Promise(resolve => setTimeout(() => resolve(null), 15000));

  const doFetch = new Promise((resolve) => {
    const req = https.get(url, (res) => {
      // Follow a single redirect if needed
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        const redir = new Promise((r) => {
          const r2 = https.get(res.headers.location, (res2) => {
            const chunks = [];
            res2.on('data', c => chunks.push(c));
            res2.on('end', () => {
              const buf = Buffer.concat(chunks);
              const ct = res2.headers['content-type'] || 'image/jpeg';
              r({ base64: buf.toString('base64'), mediaType: ct.split(';')[0] });
            });
            res2.on('error', () => r(null));
          });
          r2.on('error', () => r(null));
        });
        redir.then(resolve);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || 'image/jpeg';
        resolve({ base64: buf.toString('base64'), mediaType: ct.split(';')[0] });
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
  });

  return Promise.race([doFetch, deadline]);
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

// ─── Detect specific product sub-type from name + category ───────────────────
// Used to pick a richer, type-specific metafield schema.
function detectSpecificType(product) {
  const combined = ((product.name || '') + ' ' + (product.category || '')).toLowerCase();
  // Shoes
  if (/\bboot/i.test(combined)) return 'boots';
  if (/\bpump\b|\bheel\b|\bstiletto|\bkitten.heel/i.test(combined)) return 'heels';
  if (/\bsandal|\bmule\b|\bslide\b/i.test(combined)) return 'sandals';
  if (/\bflat\b|\bloafer|\bmoccasin/i.test(combined)) return 'flats';
  if (/\bsneaker|\btrainer/i.test(combined)) return 'sneakers';
  // Jewelry
  if (/\bearing/i.test(combined)) return 'earrings';
  if (/\bnecklace|\bpendant|\bchain/i.test(combined)) return 'necklaces';
  if (/\bbracelet|\bbangle/i.test(combined)) return 'bracelets';
  if (/\bring\b/i.test(combined)) return 'rings';
  if (/\bwatch/i.test(combined)) return 'watches';
  if (/\bbrooch|\blapel.pin/i.test(combined)) return 'brooches';
  if (/jewelry.set/i.test(combined)) return 'jewelry_sets';
  // Handbags
  if (/\bclutch/i.test(combined)) return 'clutch';
  if (/\bcrossbody|\bcross.body/i.test(combined)) return 'crossbody';
  if (/\btote\b|\bshopper/i.test(combined)) return 'tote';
  if (/\bsatchel/i.test(combined)) return 'satchel';
  if (/\bshoulder.bag/i.test(combined)) return 'shoulder_bag';
  if (/\bwallet|\bcard.case|\bcoin.purse/i.test(combined)) return 'wallet';
  if (/\bhandbag\b|\bpurse\b/i.test(combined)) return 'handbag_generic';
  // Clothing — specific types
  if (/\bblazer|\bsport.jacket|\bsport.coat/i.test(combined)) return 'blazer';
  if (/\bdress\b/i.test(combined)) return 'dress';
  if (/\bpant\b|\btrouser|\bchino|\blegging/i.test(combined)) return 'pants';
  if (/\bskirt\b/i.test(combined)) return 'skirt';
  if (/\bsuit\b/i.test(combined)) return 'suit';
  if (/\btrench|\bparka|\bpuffer|\bovercoat/i.test(combined)) return 'coat';
  // Generic "jacket" or "coat" without a more specific keyword → treat as blazer (AK workwear context)
  if (/\bjacket\b|\bcoat\b/i.test(combined)) return 'blazer';
  if (/\bcardigan|\bsweater|\bknit\b/i.test(combined)) return 'sweater';
  if (/\bblouse|\btop\b|\bshirt\b|\btunic|\btank\b/i.test(combined)) return 'top';
  // Fall back to broad category group
  return detectCategoryGroup(product.category);
}

// ─── Per-type metafield schemas ───────────────────────────────────────────────
// Two rules used per field:
//   NO_INFER_MAT  → material/fabric only: must be stated in name/description, never assumed from visual
//   FROM_IMAGE    → visual attributes (fit, silhouette, closure, neckline, etc.): use image + description
//   NO_INFER_FACT → non-visual facts (care instructions, numeric measurements): stated in description only
const NO_INFER_MAT  = 'Use the product name and description first. If material is clearly identified there (e.g., "faux leather", "canvas", "nylon"), use it. If the image strongly confirms what the description implies, use it. Do NOT guess a premium material (leather, suede, silk) from appearance alone if the description does not confirm it. Return null only if genuinely unclear.';
const NO_INFER_FACT = 'ONLY fill if explicitly stated in the product name or description. Return null if not clearly specified.';
const FROM_IMAGE    = 'Use the product image and description. If clearly visible or described, fill this in. Return null only if genuinely ambiguous.';

const TYPE_SCHEMAS = {
  // ── Clothing ──────────────────────────────────────────────────────────────
  blazer: {
    fields: [
      `material: Primary fabric composition. ${NO_INFER_MAT} E.g. "Wool-blend crepe", "Stretch ponte", "Woven polyester". Be specific, not just "fabric".`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT} E.g. "Dry clean only" or "Machine wash cold, lay flat to dry".`,
      `fit_type: Body fit silhouette. ${FROM_IMAGE} E.g. "Slim", "Regular", "Tailored", "Relaxed", "Oversized".`,
      `closure_type: Fastening style. ${FROM_IMAGE} E.g. "Single-breasted 2-button", "Double-breasted 6-button", "Open front / no closure".`,
      `lining: Lining detail. ${FROM_IMAGE} E.g. "Fully lined", "Half-lined", "Unlined".`,
      `neckline: Lapel or collar style. ${FROM_IMAGE} E.g. "Notched lapel", "Peak lapel", "Shawl collar", "Collarless", "Mandarin collar".`,
      `sleeve_length: Sleeve length. ${FROM_IMAGE} E.g. "Long sleeve", "3/4 sleeve", "Short sleeve", "Sleeveless".`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null, "closure_type": null, "lining": null, "neckline": null, "sleeve_length": null`,
  },
  coat: {
    fields: [
      `material: Primary fabric composition. ${NO_INFER_MAT}`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT}`,
      `fit_type: Body fit silhouette. ${FROM_IMAGE} E.g. "Slim", "Relaxed", "Oversized".`,
      `closure_type: Fastening style. ${FROM_IMAGE} E.g. "Double-breasted buttons", "Belt-tie", "Zip-front", "Snap closure".`,
      `neckline: Lapel or collar style. ${FROM_IMAGE} E.g. "Notched lapel", "Peak lapel", "Shawl collar", "Funnel neck", "Collarless".`,
      `sleeve_length: Sleeve length. ${FROM_IMAGE} E.g. "Long sleeve", "3/4 sleeve".`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null, "closure_type": null, "neckline": null, "sleeve_length": null`,
  },
  dress: {
    fields: [
      `material: Primary fabric composition. ${NO_INFER_MAT}`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT}`,
      `fit_type: Dress silhouette/fit. ${FROM_IMAGE} E.g. "Fitted sheath", "A-line", "Shift", "Wrap", "Fit-and-flare".`,
      `neckline: Neckline style. ${FROM_IMAGE} E.g. "V-neck", "Scoop neck", "Crew neck", "Square neck", "Off-shoulder".`,
      `sleeve_length: Sleeve length. ${FROM_IMAGE} E.g. "Sleeveless", "Short sleeve", "3/4 sleeve", "Long sleeve".`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null, "neckline": null, "sleeve_length": null`,
  },
  pants: {
    fields: [
      `material: Primary fabric composition. ${NO_INFER_MAT}`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT}`,
      `fit_type: Leg and body fit. ${FROM_IMAGE} E.g. "Straight leg", "Wide leg", "Slim fit", "Flared", "Bootcut", "Tapered".`,
      `rise: Waist rise. ${FROM_IMAGE} E.g. "High rise", "Mid rise", "Low rise".`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null, "rise": null`,
  },
  skirt: {
    fields: [
      `material: Primary fabric composition. ${NO_INFER_MAT}`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT}`,
      `fit_type: Skirt silhouette. ${FROM_IMAGE} E.g. "A-line", "Pencil", "Wrap", "Pleated", "Tiered".`,
      `length: Skirt length. ${FROM_IMAGE} E.g. "Mini", "Knee-length", "Midi", "Maxi".`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null, "length": null`,
  },
  suit: {
    fields: [
      `material: Primary fabric composition. ${NO_INFER_MAT}`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT}`,
      `fit_type: Suit silhouette. ${FROM_IMAGE} E.g. "Tailored", "Slim", "Regular", "Relaxed".`,
      `lining: Lining detail. ${FROM_IMAGE} E.g. "Fully lined", "Partially lined", "Unlined".`,
      `neckline: Jacket lapel or collar style. ${FROM_IMAGE} E.g. "Notched lapel", "Peak lapel", "Collarless".`,
      `sleeve_length: Jacket sleeve length. ${FROM_IMAGE} E.g. "Long sleeve", "3/4 sleeve".`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null, "lining": null, "neckline": null, "sleeve_length": null`,
  },
  sweater: {
    fields: [
      `material: Primary fiber composition. ${NO_INFER_MAT} E.g. "100% merino wool", "Acrylic blend", "Cotton knit".`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT}`,
      `fit_type: Body fit. ${FROM_IMAGE} E.g. "Slim", "Regular", "Oversized", "Relaxed", "Cropped".`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null`,
  },
  top: {
    fields: [
      `material: Primary fabric composition. ${NO_INFER_MAT}`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT}`,
      `fit_type: Body fit. ${FROM_IMAGE} E.g. "Slim", "Regular", "Relaxed", "Fitted", "Cropped".`,
      `neckline: Neckline style. ${FROM_IMAGE} E.g. "V-neck", "Crew neck", "Cowl neck", "Wrap", "Scoop neck", "Off-shoulder".`,
      `sleeve_length: Sleeve length. ${FROM_IMAGE} E.g. "Sleeveless", "Short sleeve", "3/4 sleeve", "Long sleeve".`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null, "neckline": null, "sleeve_length": null`,
  },
  // ── Shoes ──────────────────────────────────────────────────────────────────
  heels: {
    fields: [
      `heel_height: Numeric heel height. ${NO_INFER_FACT} E.g. "3.5 inch", "2 inch". Return null if not stated.`,
      `heel_style: Heel shape. ${FROM_IMAGE} E.g. "Stiletto", "Block heel", "Kitten heel", "Cone heel", "Wedge".`,
      `toe_shape: Toe box shape. ${FROM_IMAGE} E.g. "Pointed toe", "Square toe", "Round toe", "Almond toe".`,
      `closure_type: How the shoe is secured. ${FROM_IMAGE} E.g. "Slip-on", "Ankle strap with buckle", "Slingback", "Side zip".`,
    ],
    schema: `"heel_height": null, "heel_style": null, "toe_shape": null, "closure_type": null`,
  },
  boots: {
    fields: [
      `heel_height: Numeric heel height. ${NO_INFER_FACT} E.g. "1.5 inch", "3 inch". Return null if not stated.`,
      `shaft_height: Boot shaft height. ${FROM_IMAGE} E.g. "Ankle", "Mid-calf", "Knee-high", "Over-the-knee".`,
      `closure_type: How the boot is put on. ${FROM_IMAGE} E.g. "Side zip", "Pull-on", "Lace-up", "Chelsea pull-tab".`,
    ],
    schema: `"heel_height": null, "shaft_height": null, "closure_type": null`,
  },
  sandals: {
    fields: [
      `heel_style: Heel type. ${FROM_IMAGE} E.g. "Flat", "Block heel", "Wedge", "Kitten heel", "Espadrille".`,
      `strap_style: Strap configuration. ${FROM_IMAGE} E.g. "T-strap", "Ankle strap", "Toe-ring", "Slide", "Gladiator lace-up".`,
      `closure_type: Fastening. ${FROM_IMAGE} E.g. "Buckle ankle strap", "Slip-on", "Adjustable hook-and-loop".`,
    ],
    schema: `"heel_style": null, "strap_style": null, "closure_type": null`,
  },
  flats: {
    fields: [
      `toe_shape: Toe shape. ${FROM_IMAGE} E.g. "Pointed", "Round", "Square", "Almond".`,
      `closure_type: How the shoe is secured. ${FROM_IMAGE} E.g. "Slip-on", "Mary Jane strap", "Lace-up", "Loafer penny keeper".`,
    ],
    schema: `"toe_shape": null, "closure_type": null`,
  },
  sneakers: {
    fields: [
      `closure_type: Fastening. ${FROM_IMAGE} E.g. "Lace-up", "Slip-on", "Velcro".`,
    ],
    schema: `"closure_type": null`,
  },
  // ── Jewelry ────────────────────────────────────────────────────────────────
  earrings: {
    fields: [
      `metal_finish: Metal color/finish. ${NO_INFER_MAT} E.g. "Gold-tone", "Silver-tone", "Rose gold-tone", "Two-tone". Must appear in name or description.`,
      `stone_type: Stone or ornament. ${NO_INFER_FACT} E.g. "Crystal", "Cubic zirconia", "Imitation pearl", "Enamel". Return null if none mentioned.`,
      `earring_back: Back/fastening type. ${FROM_IMAGE} E.g. "Post with push back", "Lever back", "Clip-on", "Threader", "Hoop".`,
    ],
    schema: `"metal_finish": null, "stone_type": null, "earring_back": null`,
  },
  necklaces: {
    fields: [
      `metal_finish: Metal color/finish. ${NO_INFER_MAT} E.g. "Gold-tone", "Silver-tone", "Rose gold-tone".`,
      `stone_type: Stone or pendant ornament. ${NO_INFER_FACT} Return null if no stone/pendant mentioned.`,
      `chain_length: Length in inches. ${NO_INFER_FACT} E.g. "16 inch", "18 inch with 2-inch extender".`,
      `clasp_type: Closure type. ${FROM_IMAGE} E.g. "Lobster clasp", "Spring ring", "Toggle clasp".`,
    ],
    schema: `"metal_finish": null, "stone_type": null, "chain_length": null, "clasp_type": null`,
  },
  bracelets: {
    fields: [
      `metal_finish: Metal color/finish. ${NO_INFER_MAT}`,
      `stone_type: Stone or ornament. ${NO_INFER_FACT} Return null if none mentioned.`,
      `clasp_type: Closure type. ${FROM_IMAGE} E.g. "Toggle clasp", "Magnetic clasp", "Stretch", "Box clasp", "Lobster clasp".`,
    ],
    schema: `"metal_finish": null, "stone_type": null, "clasp_type": null`,
  },
  rings: {
    fields: [
      `metal_finish: Metal color/finish. ${NO_INFER_MAT}`,
      `stone_type: Stone or ornament. ${NO_INFER_FACT} Return null if none mentioned.`,
    ],
    schema: `"metal_finish": null, "stone_type": null`,
  },
  watches: {
    fields: [
      `metal_finish: Case and band finish. ${NO_INFER_MAT} E.g. "Gold-tone case with mesh band", "Silver-tone stainless steel".`,
      `band_material: Band/strap material. ${FROM_IMAGE} E.g. "Mesh bracelet", "Link bracelet", "Leather strap".`,
      `case_diameter: Case size. ${NO_INFER_FACT} E.g. "36mm", "38mm".`,
    ],
    schema: `"metal_finish": null, "band_material": null, "case_diameter": null`,
  },
  brooches: {
    fields: [
      `metal_finish: Metal color/finish. ${NO_INFER_MAT}`,
      `stone_type: Stone or ornament. ${NO_INFER_FACT} Return null if none mentioned.`,
    ],
    schema: `"metal_finish": null, "stone_type": null`,
  },
  jewelry_sets: {
    fields: [
      `metal_finish: Metal color/finish. ${NO_INFER_MAT}`,
      `stone_type: Stone or ornament. ${NO_INFER_FACT} Return null if none mentioned.`,
    ],
    schema: `"metal_finish": null, "stone_type": null`,
  },
  // ── Handbags ───────────────────────────────────────────────────────────────
  clutch: {
    fields: [
      `exterior_material: Outer material. ${NO_INFER_MAT} Do NOT assume leather from appearance. E.g. "Faux leather", "Satin", "Quilted fabric".`,
      `closure_type: How it closes. ${FROM_IMAGE} E.g. "Magnetic snap", "Frame clasp", "Zip-top", "Envelope flap".`,
      `strap_type: Strap detail. ${FROM_IMAGE} E.g. "No strap", "Detachable chain strap", "Wristlet loop".`,
    ],
    schema: `"exterior_material": null, "closure_type": null, "strap_type": null`,
  },
  crossbody: {
    fields: [
      `exterior_material: Outer material. ${NO_INFER_MAT}`,
      `closure_type: How it closes. ${FROM_IMAGE} E.g. "Zip-top", "Flap with turn-lock", "Magnetic snap".`,
      `strap_type: Strap style/carry options. ${FROM_IMAGE} E.g. "Adjustable shoulder strap", "Detachable chain strap", "Top handle + crossbody strap".`,
    ],
    schema: `"exterior_material": null, "closure_type": null, "strap_type": null`,
  },
  tote: {
    fields: [
      `exterior_material: Outer material. ${NO_INFER_MAT}`,
      `closure_type: How it closes. ${FROM_IMAGE} E.g. "Open top", "Magnetic snap", "Zip-top".`,
      `strap_type: Handle/strap options. ${FROM_IMAGE} E.g. "Dual top handles", "Top handle + removable strap", "Tote handles only".`,
    ],
    schema: `"exterior_material": null, "closure_type": null, "strap_type": null`,
  },
  satchel: {
    fields: [
      `exterior_material: Outer material. ${NO_INFER_MAT}`,
      `closure_type: How it closes. ${FROM_IMAGE} E.g. "Zip-top", "Flap with turn-lock", "Magnetic snap".`,
      `strap_type: Strap/handle options. ${FROM_IMAGE} E.g. "Top handles + detachable shoulder strap", "Convertible top handle and crossbody strap".`,
    ],
    schema: `"exterior_material": null, "closure_type": null, "strap_type": null`,
  },
  shoulder_bag: {
    fields: [
      `exterior_material: Outer material. ${NO_INFER_MAT}`,
      `closure_type: How it closes. ${FROM_IMAGE}`,
      `strap_type: Strap/handle options. ${FROM_IMAGE}`,
    ],
    schema: `"exterior_material": null, "closure_type": null, "strap_type": null`,
  },
  handbag_generic: {
    fields: [
      `exterior_material: Outer material. ${NO_INFER_MAT}`,
      `closure_type: How it closes. ${FROM_IMAGE}`,
      `strap_type: Strap/handle options. ${FROM_IMAGE}`,
    ],
    schema: `"exterior_material": null, "closure_type": null, "strap_type": null`,
  },
  wallet: {
    fields: [
      `exterior_material: Outer material. ${NO_INFER_MAT}`,
      `closure_type: How it closes. ${FROM_IMAGE} E.g. "Zip-around", "Snap closure", "Bi-fold, no closure".`,
    ],
    schema: `"exterior_material": null, "closure_type": null`,
  },
  // ── Category group fallbacks ───────────────────────────────────────────────
  clothing: {
    fields: [
      `material: Primary fabric composition. ${NO_INFER_MAT}`,
      `care_instructions: One-line care instruction. ${NO_INFER_FACT}`,
      `fit_type: Body fit. ${FROM_IMAGE}`,
    ],
    schema: `"material": null, "care_instructions": null, "fit_type": null`,
  },
  shoes: {
    fields: [
      `heel_style: Heel type. ${FROM_IMAGE}`,
      `closure_type: Fastening. ${FROM_IMAGE}`,
    ],
    schema: `"heel_style": null, "closure_type": null`,
  },
  jewelry: {
    fields: [
      `metal_finish: Metal color/finish. ${NO_INFER_MAT}`,
      `stone_type: Stone if mentioned. ${NO_INFER_FACT}`,
    ],
    schema: `"metal_finish": null, "stone_type": null`,
  },
  handbags: {
    fields: [
      `exterior_material: Outer material. ${NO_INFER_MAT}`,
      `closure_type: Closure if visible. ${FROM_IMAGE}`,
      `strap_type: Strap/handle options. ${FROM_IMAGE}`,
    ],
    schema: `"exterior_material": null, "closure_type": null, "strap_type": null`,
  },
};

// Returns field instructions + JSON schema for a given specific type.
function getCategoryPromptSection(specificType, categoryGroup) {
  const taxonomyOptions = getTaxonomyOptions(categoryGroup);
  const taxonomyInstruction = taxonomyOptions
    ? `shopify_taxonomy_gid: Pick the DEEPEST (most specific leaf-level) matching GID from this list. Always prefer a subcategory over its parent — e.g. pick "Sport Jackets" over "Coats & Jackets". Return only the GID string, no other text:\n${taxonomyOptions}`
    : `shopify_taxonomy_gid: The Shopify taxonomy GID for this product type (format: "gid://shopify/TaxonomyCategory/aa-X-X").`;

  const typeSchema = TYPE_SCHEMAS[specificType] || TYPE_SCHEMAS[categoryGroup] || { fields: [], schema: '' };
  const fieldLines = typeSchema.fields.map((f, i) => `${i + 8}. ${f}`).join('\n');
  const nextNum = typeSchema.fields.length + 8;

  return {
    fields: fieldLines + `\n${nextNum}. ${taxonomyInstruction}`,
    schema: `  ${typeSchema.schema}${typeSchema.schema ? ',\n  ' : ''}"shopify_taxonomy_gid": null`,
  };
}

// ─── Main analysis function ───────────────────────────────────────────────────
async function analyzeProduct(client, product, brandContext) {
  // Resize Shopify CDN images to 600px wide before fetching — full-res images
  // are 2-4MB and take minutes to upload to the Claude API.
  const imageUrl = resizeShopifyUrl(product.image);
  log(`    → fetching image${imageUrl !== product.image ? ' (600px)' : ''}…`);
  const t0 = Date.now();
  const imageData = imageUrl ? await fetchImageBase64(imageUrl) : null;
  if (imageData) {
    log(`    → image: ${Math.round(imageData.base64.length / 1024)}KB base64 (${Date.now() - t0}ms)`);
  } else {
    log(`    → image: none (${Date.now() - t0}ms)`);
  }
  const categoryGroup = detectCategoryGroup(product.category);
  const specificType = detectSpecificType(product);
  const catSection = getCategoryPromptSection(specificType, categoryGroup);

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
Current description: ${(product.description || '').substring(0, 900)}
Current tags: ${existingTags || 'none'}
${imageData ? 'Product image included above.' : 'No image available.'}

${imageData ? 'First, analyze the product image: material appearance, silhouette/cut, construction details, occasion suitability.' : ''}

Generate ALL of the following fields:

1. meta_title: Under 60 characters. Product type + key attribute + brand name. Natural, not keyword-stuffed. Example: "Ponte Blazer with Welt Pockets | Anne Klein"
2. meta_description: Under 160 characters. Lead with the purchase reason for a professional woman. Include 1-2 natural search phrases. Soft CTA at end.
3. tags: 6-10 NEW search-friendly SEO tags to ADD alongside the existing tags. Mix: product type, occasion (work, office, professional), style descriptor. Do NOT repeat or duplicate any existing tag. Do NOT include operational codes (style numbers, campaign names, season codes).
4. image_insights: ${imageData ? '1-2 sentences on what the image reveals about material, silhouette, and occasion that the current description misses.' : 'null'}
5. alt_text: Under 125 characters. Descriptive image alt text. Describe what is literally shown: product type, color, key style details. Do NOT start with "Image of" or "Photo of".
6. geo_description: 2-3 sentences for AI assistant discoverability. Answer a query like "best blazers for work" or "professional outfit ideas". Name product type and brand naturally. Include one specific functional feature. No superlatives.
7. suggested_description: A fresh Shopify product description, 150-200 words. Format as clean HTML with 2-3 <p> tags. Structure: (1) lead sentence naming the specific occasion + product type and its standout feature, (2) 2-3 sentences on construction details, fabric feel, and functional benefits — pull from the image and description, be specific, (3) closing sentence on versatility or styling context for a professional woman. Follow ALL brand writing rules from the context above. No exclamation marks. Short declarative sentences. Never use: fresh, effortless, trendy, stunning, must-have, chic, vibrant.
${catSection.fields}

Return ONLY valid JSON (no markdown, no explanation):
{
  "meta_title": "",
  "meta_description": "",
  "tags": [],
  "image_insights": "",
  "alt_text": "",
  "geo_description": "",
  "suggested_description": "",
  ${catSection.schema}
}`,
  });

  log(`    → calling Claude (opus-4-6)…`);
  const t1 = Date.now();
  // Promise.race gives a hard 90s wall-clock cap — more reliable than SDK timeout option
  const claudeDeadline = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Claude API timeout after 90s')), 90000)
  );
  const response = await Promise.race([
    client.messages.create({ model: 'claude-opus-4-6', max_tokens: 2000, messages: [{ role: 'user', content }] }),
    claudeDeadline,
  ]);
  log(`    → Claude responded (${Date.now() - t1}ms)`);

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
  const fieldSummary = Object.entries(parsed).filter(([k]) => !['meta_title','meta_description','tags','image_insights','alt_text','geo_description','shopify_taxonomy_gid'].includes(k)).map(([k,v]) => `${k}="${v||''}"`).join(' | ');
  log(`    GID: ${parsed.shopify_taxonomy_gid || '(none)'} | type: ${specificType} | ${fieldSummary}`);
  const categoryGroup2 = detectCategoryGroup(product.category);
  const validOptions = getTaxonomyOptions(categoryGroup2);
  if (parsed.shopify_taxonomy_gid && validOptions) {
    const validGids = new Set(validOptions.split('\n').map(line => line.split(' | ')[0].trim()));
    if (!validGids.has(parsed.shopify_taxonomy_gid)) {
      log(`    WARN: Claude returned invalid GID "${parsed.shopify_taxonomy_gid}" — cleared`);
      parsed.shopify_taxonomy_gid = null;
    }
  }
  // Merge AI-generated SEO tags with existing navigational/merchandising tags.
  // Keep all original tags that aren't internal junk; append new AI tags (no duplicates).
  const keepTags = product.tags || [];  // keep ALL original tags — they drive Shopify systems
  const aiTags = (parsed.tags || []).map(t => String(t).trim());
  const existingLower = new Set(keepTags.map(t => t.toLowerCase()));
  const newOnly = aiTags.filter(t => !existingLower.has(t.toLowerCase()));
  parsed.tags = [...keepTags, ...newOnly];
  log(`    Tags: kept ${keepTags.length} existing + added ${newOnly.length} new = ${parsed.tags.length} total`);

  parsed._specificType = specificType;
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
    const specificType = detectSpecificType(product);
    log(`  [${i + 1}/${batch.length}] [${specificType}] ${product.name.substring(0, 55)}`);

    try {
      const suggested = await analyzeProduct(client, product, brandContext);
      const resolvedSpecificType = suggested._specificType || specificType;
      delete suggested._specificType;

      const entry = {
        href: product.href,
        id: product.id,
        name: product.name,
        category: product.category,
        categoryGroup,
        specificType: resolvedSpecificType,
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
