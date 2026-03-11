/**
 * Shopify SEO Push — Phase 3
 * Reads approved products from data/seo_suggestions.json and pushes to Shopify via GraphQL Admin API.
 *
 * Pushes per product:
 *   - meta_title   → global.title_tag metafield (single_line_text_field)
 *   - meta_description → global.description_tag metafield (single_line_text_field)
 *   - tags         → product.tags (productUpdate mutation)
 *   - alt_text     → first product image alt (fileUpdate mutation)
 *   - category     → Shopify taxonomy GID (productUpdate mutation)
 *   - custom fields → category-specific metafields (metafieldsSet)
 *
 * Tracks push status in seo_suggestions.json: pushStatus = 'pushed' | 'error', pushedAt
 *
 * Usage:
 *   node shopify/push_seo.js              # push all approved, not yet pushed
 *   node shopify/push_seo.js --all        # re-push all approved (including already pushed)
 *   node shopify/push_seo.js --dry-run    # print what would be pushed, no API calls
 *   node shopify/push_seo.js --href=https://www.anneklein.com/products/some-handle
 *
 * Required .env:
 *   SHOPIFY_STORE_DOMAIN=anneklein.myshopify.com
 *   SHOPIFY_ADMIN_API_TOKEN=shpat_xxxxxx
 *   SHOPIFY_API_VERSION=2025-07   (optional, defaults to 2025-07)
 *
 * API notes (verified against Shopify docs):
 *   - productByHandle deprecated → productByIdentifier (2025-01+)
 *   - productUpdate argument renamed: input: ProductInput! → product: ProductUpdateInput! (2024-10+)
 *   - ProductInput.category is a bare ID scalar, NOT { id: "gid://..." }
 *   - productUpdateMedia deprecated → fileUpdate (2025-07+)
 *   - global.title_tag / global.description_tag with single_line_text_field are correct
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { buildFullCache, resolveToGid, getMetafieldType } = require('./metaobject_cache');

const SEO_FILE = path.join(__dirname, '../data/seo_suggestions.json');
const LOG_FILE = path.join(__dirname, '../logs/shopify_push.log');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN      = args.includes('--dry-run');
const PUSH_ALL     = args.includes('--all');
const hrefArg      = (args.find(a => a.startsWith('--href=')) || '').replace('--href=', '') || null;
const hrefsFileArg = (args.find(a => a.startsWith('--hrefs-file=')) || '').replace('--hrefs-file=', '') || null;
const hrefsFromFile = hrefsFileArg && fs.existsSync(hrefsFileArg)
  ? JSON.parse(fs.readFileSync(hrefsFileArg, 'utf8'))
  : null;

// ─── Config ───────────────────────────────────────────────────────────────────
const STORE_DOMAIN  = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN   = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION   = process.env.SHOPIFY_API_VERSION || '2025-07';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function loadSeo() {
  try { return JSON.parse(fs.readFileSync(SEO_FILE, 'utf8')); } catch { return null; }
}

function saveSeo(data) {
  fs.writeFileSync(SEO_FILE, JSON.stringify(data, null, 2));
}

function extractHandle(href) {
  const match = (href || '').match(/\/products\/([^/?#]+)/);
  return match ? match[1] : null;
}

// ─── Shopify GraphQL client ───────────────────────────────────────────────────
function shopifyGraphQL(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = {
      hostname: STORE_DOMAIN,
      path: `/admin/api/${API_VERSION}/graphql.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_TOKEN,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) return reject(new Error(json.errors.map(e => e.message).join('; ')));
          resolve(json.data);
        } catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── GraphQL operations ───────────────────────────────────────────────────────

// Look up product GID + first IMAGE file GID by handle.
// Uses productByIdentifier (replaces deprecated productByHandle).
// Media node IDs from product.media are also valid File GIDs for fileUpdate.
async function getProductByHandle(handle) {
  const data = await shopifyGraphQL(`
    query getProduct($handle: String!) {
      productByIdentifier(identifier: { handle: $handle }) {
        id
        title
        media(first: 5) {
          edges {
            node {
              id
              alt
              mediaContentType
            }
          }
        }
      }
    }
  `, { handle });

  const product = data?.productByIdentifier;
  if (!product) return null;
  // Only update alt text on IMAGE type media
  const imageEdge = product.media?.edges?.find(e => e.node.mediaContentType === 'IMAGE')?.node || null;
  return {
    id: product.id,
    title: product.title,
    mediaId: imageEdge?.id || null,
    currentAlt: imageEdge?.alt || null,
  };
}

// Push global.title_tag and global.description_tag SEO metafields.
// Verified: namespace='global', type='single_line_text_field' is correct per Shopify docs.
async function pushMetafields(productGid, metaTitle, metaDescription) {
  const metafields = [];
  if (metaTitle) {
    metafields.push({ ownerId: productGid, namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: metaTitle.slice(0, 255) });
  }
  if (metaDescription) {
    metafields.push({ ownerId: productGid, namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: metaDescription.slice(0, 320) });
  }
  if (!metafields.length) return { ok: true };

  const data = await shopifyGraphQL(`
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key value }
        userErrors { field message }
      }
    }
  `, { metafields });

  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '));
  return { ok: true };
}

// Push product tags, taxonomy category, and description HTML in a single productUpdate call.
// API 2024-10+ breaking change: argument renamed from `input: ProductInput!`
// to `product: ProductUpdateInput!`.
// ProductUpdateInput.category is a bare ID scalar (not an object wrapper).
async function pushTagsAndCategory(productGid, tags, categoryGid, descriptionHtml) {
  const product = { id: productGid };
  // Shopify enforces max 255 chars per tag
  if (tags?.length) product.tags = tags.map(t => String(t).slice(0, 255));
  // category is a bare ID scalar — do NOT wrap in { id: ... }
  if (categoryGid) product.category = categoryGid;
  // Push improved product description if provided
  if (descriptionHtml) product.descriptionHtml = descriptionHtml;
  if (Object.keys(product).length === 1) return { ok: true }; // nothing beyond id

  const data = await shopifyGraphQL(`
    mutation productUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id tags category { id name fullName } }
        userErrors { field message }
      }
    }
  `, { product });

  const errors = data?.productUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '));
  return { ok: true };
}

// Activate taxonomy category metafields via productSet.
// productSet is the documented mutation that triggers Shopify to expose the shopify.*
// namespace metafield slots (fabric, neckline, sleeve-length-type, care-instructions)
// for the assigned category. productUpdate sets the category value but does NOT trigger
// the metafield slot activation — productSet does.
// Using synchronous:true ensures activation is complete before we attempt to write values.
async function activateProductCategory(productGid, categoryGid) {
  if (!productGid || !categoryGid) return;

  // productSet requires title when creating, but for updates (id present) it may be optional.
  // Fetch current title to include it — avoids BLANK validation errors on title.
  let title;
  try {
    const d = await shopifyGraphQL(`query { node(id: "${productGid}") { ... on Product { title } } }`);
    title = d?.node?.title;
  } catch { /* non-fatal */ }

  const input = { id: productGid, category: categoryGid };
  if (title) input.title = title;

  const data = await shopifyGraphQL(`
    mutation productSet($input: ProductSetInput!) {
      productSet(synchronous: true, input: $input) {
        product { id category { id name fullName } }
        userErrors { field message code }
      }
    }
  `, { input });

  const errors = data?.productSet?.userErrors || [];
  if (errors.length) {
    log(`    WARN activateProductCategory: ${errors.map(e => `${e.field}: ${e.message}`).join('; ')}`);
  }
  const cat = data?.productSet?.product?.category;
  if (cat) {
    log(`    Category activated: ${cat.fullName} (${cat.id})`);
  }
}

// Taxonomy attribute metafield keys in the shopify.* namespace that require
// store-level definition activation before values can be written via metafieldsSet.
// The API equivalent of clicking "+ Fabric", "+ Neckline" etc. in Shopify Admin.
// Age-group and target-gender are NOT listed here — they are merchant metaobjects
// (list.metaobject_reference) and are already defined.
// Covers all AK product categories: clothing, shoes, jewelry, handbags
const TAXONOMY_SHOPIFY_KEYS = [
  'fabric',           // clothing
  'neckline',         // clothing
  'sleeve-length-type', // clothing
  'care-instructions',  // clothing
  'heel-style',       // shoes
  'stone-type',       // jewelry (Shopify key for gemstone/stone)
  'clasp-type',       // jewelry
];

// Template IDs: TaxonomyAttribute GID numeric + 10000 (community-verified formula).
// Used as fallback when namespace+key approach returns no result.
const TAXONOMY_TEMPLATE_IDS = {
  'fabric':             'gid://shopify/StandardMetafieldDefinitionTemplate/12777',
  'neckline':           'gid://shopify/StandardMetafieldDefinitionTemplate/13243',
  'sleeve-length-type': 'gid://shopify/StandardMetafieldDefinitionTemplate/13242',
  'care-instructions':  'gid://shopify/StandardMetafieldDefinitionTemplate/12336',
  'heel-style':         'gid://shopify/StandardMetafieldDefinitionTemplate/13267',
  'stone-type':         'gid://shopify/StandardMetafieldDefinitionTemplate/15032',
  'clasp-type':         'gid://shopify/StandardMetafieldDefinitionTemplate/10108',
};

// Enable store-level standard metafield definitions for Shopify taxonomy attribute keys.
// Must be called once per run (before attempting to write values). Calling on an already-
// enabled definition is a no-op (Shopify returns ALREADY_ENABLED or empty createdDefinition).
// This is the API equivalent of clicking "+ Fabric", "+ Neckline", "+ Sleeve length type",
// "+ Care instructions" in Shopify Admin → Category metafields section.
async function ensureTaxonomyDefinitionsEnabled() {
  for (const key of TAXONOMY_SHOPIFY_KEYS) {
    try {
      // First attempt: namespace + key (cleaner, no hardcoded IDs)
      const data = await shopifyGraphQL(`
        mutation enableDef($key: String!, $namespace: String!) {
          standardMetafieldDefinitionEnable(
            key: $key
            namespace: $namespace
            ownerType: PRODUCT
            pin: true
          ) {
            createdDefinition { id name key namespace }
            userErrors { field message code }
          }
        }
      `, { key, namespace: 'shopify' });

      const errors = data?.standardMetafieldDefinitionEnable?.userErrors || [];
      const def = data?.standardMetafieldDefinitionEnable?.createdDefinition;
      const alreadyEnabled = errors.some(e =>
        e.code === 'ALREADY_ENABLED' ||
        e.message?.toLowerCase().includes('already') ||
        e.message?.toLowerCase().includes('exists')
      );

      if (def) {
        log(`    enabled: shopify.${key} (${def.id})`);
        continue;
      } else if (alreadyEnabled) {
        log(`    shopify.${key}: already enabled ✓`);
        continue;
      } else if (errors.length) {
        log(`    WARN shopify.${key} (namespace+key attempt): ${errors.map(e => `[${e.code}] ${e.message}`).join('; ')}`);
      } else {
        // No definition created and no errors — namespace+key approach may not work for this type.
        // Try ID-based fallback.
        log(`    shopify.${key}: namespace+key returned no result — trying template ID fallback`);
      }

      // Fallback: template ID approach
      const templateId = TAXONOMY_TEMPLATE_IDS[key];
      if (!templateId) {
        log(`    WARN: no template ID for shopify.${key} — definition may need manual activation`);
        continue;
      }

      const data2 = await shopifyGraphQL(`
        mutation enableDefById($id: ID!) {
          standardMetafieldDefinitionEnable(
            id: $id
            ownerType: PRODUCT
            pin: true
          ) {
            createdDefinition { id name key namespace }
            userErrors { field message code }
          }
        }
      `, { id: templateId });

      const errors2 = data2?.standardMetafieldDefinitionEnable?.userErrors || [];
      const def2 = data2?.standardMetafieldDefinitionEnable?.createdDefinition;
      const alreadyEnabled2 = errors2.some(e =>
        e.code === 'ALREADY_ENABLED' ||
        e.message?.toLowerCase().includes('already') ||
        e.message?.toLowerCase().includes('exists')
      );

      if (def2) {
        log(`    enabled (by ID): shopify.${key} (${def2.id})`);
      } else if (alreadyEnabled2) {
        log(`    shopify.${key}: already enabled ✓ (ID-based check)`);
      } else if (errors2.length) {
        log(`    WARN shopify.${key} (ID fallback): ${errors2.map(e => `[${e.code}] ${e.message}`).join('; ')}`);
      } else {
        log(`    shopify.${key}: ID fallback also returned no result — may need manual activation`);
      }
    } catch (err) {
      log(`    WARN: could not enable shopify.${key}: ${err.message}`);
    }
  }
}

// Query and log all product metafield definitions in the store.
// Reveals: (1) which shopify.* taxonomy attribute definitions exist, (2) actual custom.* keys
// for GEO fields (so we can confirm fit_logic/customer_qa definition keys match our push keys).
async function logMetafieldDefinitions() {
  try {
    const data = await shopifyGraphQL(`{
      metafieldDefinitions(first: 100, ownerType: PRODUCT) {
        edges { node { namespace key name type { name } } }
      }
    }`);
    const defs = (data?.metafieldDefinitions?.edges || []).map(e => e.node);
    const shopifyDefs = defs.filter(d => d.namespace === 'shopify').map(d => `${d.key}(${d.type.name})`);
    const customDefs  = defs.filter(d => d.namespace === 'custom').map(d => `${d.key}→"${d.name}"`);
    if (shopifyDefs.length) log(`  shopify.* defs: ${shopifyDefs.join(', ')}`);
    else log(`  shopify.* defs: none found`);
    if (customDefs.length) log(`  custom.* defs: ${customDefs.join(', ')}`);
  } catch (err) {
    log(`  WARN: could not query metafield definitions: ${err.message}`);
  }
}

// Update image alt text via fileUpdate (replaces deprecated productUpdateMedia).
// The media node ID from product.media is a valid File GID for fileUpdate.
async function pushAltText(mediaId, altText) {
  if (!mediaId || !altText) return { ok: true };

  const data = await shopifyGraphQL(`
    mutation fileUpdate($files: [FileUpdateInput!]!) {
      fileUpdate(files: $files) {
        files { id alt }
        userErrors { field message }
      }
    }
  `, { files: [{ id: mediaId, alt: altText.slice(0, 512) }] });

  const errors = data?.fileUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '));
  return { ok: true };
}

// Fields handled by dedicated push steps — excluded from custom metafields (single_line_text_field).
// GEO fields are excluded here because they are JSON type and pushed by pushGeoMetafields instead.
const SEO_FIELDS = new Set([
  'meta_title', 'meta_description', 'tags', 'alt_text',
  'image_insights', 'geo_description', 'suggested_description',
  'shopify_taxonomy_gid', 'shopify_category',
  // GEO JSON fields — pushed separately as json type metafields
  'why_it_works', 'compatibility', 'care_notes', 'fit_logic', 'customer_qa', 'use_cases',
]);

// Per-category field maps: our analyzed key → Shopify shopify.* namespace key.
// Each category group uses different Shopify keys (footwear-material vs jewelry-material vs material).
// Clothing has no explicit 'material' entry — fabric is resolved via material→fabric fallback below.
const CATEGORY_FIELD_MAPS = {
  clothing: {
    closure_type:      'closure-type',
    neckline:          'neckline',
    sleeve_length:     'sleeve-length-type',
    care_instructions: 'care-instructions',
    // material → fabric handled by fallback logic in pushShopifyTaxonomyMetafields
  },
  shoes: {
    material:          'footwear-material',   // shopify.footwear-material for shoes
    closure_type:      'closure-type',
    heel_style:        'heel-style',
    toe_style:         'toe-style',
  },
  jewelry: {
    material:          'jewelry-material',    // shopify.jewelry-material for jewelry
    clasp_type:        'clasp-type',
    stone_type:        'stone-type',
  },
  handbags: {
    material:          'material',            // shopify.material for handbags
    closure_type:      'closure-type',
  },
};

// All product category groups that get Shopify taxonomy metafields pushed.
// age-group="Adults" and target-gender="Female" apply to all AK products.
// SHOPIFY_CATEGORY_FIELD_MAP fields (material, closure-type) only resolve if the
// product's analyzed value exists in the metaobject cache — others are silently skipped.
const CLOTHING_CATEGORY_GROUPS = new Set(['clothing', 'shoes', 'jewelry', 'handbags']);

// Push Shopify-namespace category metafields (appear in "Category metafields" section in Shopify admin).
// Metafield type depends on the GID source:
//   - Merchant metaobjects (age-group, target-gender, material, closure-type): list.metaobject_reference
//   - Taxonomy attributes (fabric, neckline, sleeve-length-type, care-instructions): list.product_taxonomy_value_reference
//
// Confirmed actual values from live store diagnostic:
//   age-group: "Adults" (NOT "Adult")
//   target-gender: "Female" (NOT "Women")
async function pushShopifyTaxonomyMetafields(productGid, suggested, cache, categoryGroup) {
  if (!cache || !Object.keys(cache).length) {
    log('    SKIP taxonomy metafields — metaobject cache unavailable');
    return { ok: true, count: 0 };
  }

  const metafields = [];

  // age-group and target-gender are constants for AK (women's workwear brand).
  // IMPORTANT: store values are "Adults" and "Female" — confirmed via diagnostic.
  const ageGid    = resolveToGid(cache, 'age-group', 'Adults');
  const genderGid = resolveToGid(cache, 'target-gender', 'Female');
  if (ageGid)    metafields.push({ ownerId: productGid, namespace: 'shopify', key: 'age-group',     type: getMetafieldType(cache, 'age-group'),     value: JSON.stringify([ageGid]) });
  if (genderGid) metafields.push({ ownerId: productGid, namespace: 'shopify', key: 'target-gender', type: getMetafieldType(cache, 'target-gender'), value: JSON.stringify([genderGid]) });

  if (!ageGid)    log('    WARN: no GID for age-group="Adults" — check metaobject cache');
  if (!genderGid) log('    WARN: no GID for target-gender="Female" — check metaobject cache');

  // Analyzed taxonomy fields — Claude returned exact valid values (constrained during analysis).
  // Use getMetafieldType() to pick the correct type: taxonomy attributes use list.taxonomy_reference.
  const fieldMap = CATEGORY_FIELD_MAPS[categoryGroup] || {};
  log(`    using field map for category group: ${categoryGroup || 'unknown'} (${Object.keys(fieldMap).length} field(s))`);

  // Clothing: material is not in the field map (no shopify.material for clothing).
  // Instead, try to push the analyzed material value via the taxonomy 'fabric' cache.
  if (categoryGroup === 'clothing' && suggested.material && cache['fabric']) {
    const fabricGid = resolveToGid(cache, 'fabric', String(suggested.material).trim());
    if (fabricGid) {
      const type = getMetafieldType(cache, 'fabric');
      metafields.push({ ownerId: productGid, namespace: 'shopify', key: 'fabric', type, value: JSON.stringify([fabricGid]) });
      log(`    clothing material "${suggested.material}" → shopify.fabric (${fabricGid})`);
    } else {
      log(`    WARN: material "${suggested.material}" not found in fabric taxonomy cache — skipped`);
    }
  }

  for (const [ourKey, shopifyKey] of Object.entries(fieldMap)) {
    const val = suggested[ourKey];
    if (!val || typeof val !== 'string' || !val.trim()) continue;

    let gid = resolveToGid(cache, shopifyKey, val.trim());
    let resolvedKey = shopifyKey;

    // Special case: 'material' in analyzed data maps to a merchant metaobject key (footwear-material,
    // jewelry-material, or material). If the value isn't in the merchant cache, fall back to the
    // taxonomy 'fabric' cache which has 48 exact fabric values (Wool, Cashmere, Silk, etc.).
    if (!gid && ourKey === 'material' && cache['fabric']) {
      gid = resolveToGid(cache, 'fabric', val.trim());
      if (gid) {
        resolvedKey = 'fabric';
        log(`    material "${val}" not in merchant cache → resolved via taxonomy fabric`);
      }
    }

    if (gid) {
      const type = getMetafieldType(cache, resolvedKey);
      metafields.push({ ownerId: productGid, namespace: 'shopify', key: resolvedKey, type, value: JSON.stringify([gid]) });
    } else {
      log(`    WARN: no GID for ${shopifyKey}="${val}" — value not in cache, skipped`);
    }
  }

  if (!metafields.length) return { ok: true, count: 0 };

  const data = await shopifyGraphQL(`
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key value }
        userErrors { field message }
      }
    }
  `, { metafields });

  const errors = data?.metafieldsSet?.userErrors || [];
  const accessErrors = errors.filter(e => e.message?.includes('Access to this namespace'));
  const otherErrors  = errors.filter(e => !e.message?.includes('Access to this namespace'));
  if (accessErrors.length) {
    // Taxonomy fields need to be added in Shopify Admin first:
    // Open the product → Category metafields → click "+ Fabric", "+ Neckline", etc.
    // Once added there, these will populate automatically on the next push.
    const blocked = metafields.filter((_, i) => accessErrors.some(e => e.field?.includes(String(i)))).map(f => f.key);
    log(`    INFO: taxonomy fields need to be added in Shopify Admin first: ${blocked.join(', ') || accessErrors.length + ' fields'}`);
  }
  if (otherErrors.length) throw new Error(otherErrors.map(e => `${e.field}: ${e.message}`).join('; '));
  const pushed = metafields.length - accessErrors.length;
  return { ok: true, count: pushed };
}

// Build category-specific metafield entries (namespace: custom).
// Dynamically pushes all attribute fields the analyzer generated,
// using the exact key names (metal_finish, heel_height, fit_type, etc.).
// Skips SEO fields handled by dedicated steps above.
function buildCategoryMetafields(productGid, suggested) {
  const fields = [];
  for (const [key, value] of Object.entries(suggested)) {
    if (SEO_FIELDS.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) || typeof value === 'object') continue;
    fields.push({
      ownerId: productGid,
      namespace: 'custom',
      key,
      type: 'single_line_text_field',
      value: String(value).slice(0, 255),
    });
  }
  return fields;
}

// Push all category-specific metafields in one metafieldsSet call.
async function pushCategoryMetafields(productGid, suggested) {
  const metafields = buildCategoryMetafields(productGid, suggested);
  if (!metafields.length) return { ok: true };

  const data = await shopifyGraphQL(`
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key value }
        userErrors { field message }
      }
    }
  `, { metafields });

  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '));
  return { ok: true, count: metafields.length };
}

// GEO metafield keys — JSON type, custom namespace.
// These populate the AI/GEO product discovery metafields for Shopify Semantic Search,
// Shop app, Google Shopping AI (UCP), and ChatGPT product feeds (ACP).
const GEO_FIELD_KEYS = ['why_it_works', 'compatibility', 'care_notes', 'fit_logic', 'customer_qa', 'use_cases'];

// Push GEO JSON metafields (custom.why_it_works, custom.compatibility, etc.).
// Non-blocking — logs warnings on error, never throws.
async function pushGeoMetafields(productGid, suggested) {
  const metafields = [];
  for (const key of GEO_FIELD_KEYS) {
    const val = suggested[key];
    if (val === null || val === undefined) { log(`    GEO skip ${key}: null/undefined`); continue; }
    // Skip empty strings, empty objects {}, and empty arrays [] — means Claude returned nothing useful
    if (typeof val === 'string' && !val.trim()) { log(`    GEO skip ${key}: empty string`); continue; }
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) { log(`    GEO skip ${key}: empty object {}`); continue; }
    if (Array.isArray(val) && val.length === 0) { log(`    GEO skip ${key}: empty array []`); continue; }
    // Log the actual value being pushed (truncated) for diagnostics
    const preview = JSON.stringify(val).slice(0, 120);
    log(`    GEO push ${key}: ${preview}${preview.length >= 120 ? '…' : ''}`);
    metafields.push({
      ownerId: productGid,
      namespace: 'custom',
      key,
      type: 'json',
      value: JSON.stringify(val),
    });
  }
  if (!metafields.length) return;

  const data = await shopifyGraphQL(`
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key }
        userErrors { field message }
      }
    }
  `, { metafields });

  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    log(`    WARN GEO metafields: ${errors.map(e => `${e.field}: ${e.message}`).join('; ')}`);
  } else {
    log(`    GEO metafields: ${metafields.length} pushed (${metafields.map(f => f.key).join(', ')})`);
  }
}

// ─── Push a single product ────────────────────────────────────────────────────
async function pushProduct(product, metaCache) {
  const handle = extractHandle(product.href);
  if (!handle) throw new Error(`Could not extract handle from href: ${product.href}`);

  const suggested = product.suggested || {};
  const categoryGroup = product.categoryGroup || 'other';

  // Unwrap GID if stored as object { id: "gid://..." } instead of plain string
  const rawGid = suggested.shopify_taxonomy_gid;
  const gidStr = rawGid && typeof rawGid === 'object' ? rawGid.id : (rawGid || null);

  if (DRY_RUN) {
    log(`  [DRY RUN] Would push: handle=${handle} (${categoryGroup})`);
    log(`    meta_title:       ${suggested.meta_title}`);
    log(`    meta_description: ${suggested.meta_description}`);
    log(`    tags:             ${(suggested.tags || []).join(', ')}`);
    log(`    alt_text:         ${suggested.alt_text || '(none)'}`);
    log(`    taxonomy_gid:     ${gidStr || '(none)'}`);
    if (suggested.suggested_description) {
      const preview = suggested.suggested_description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      log(`    description:      ${preview}…`);
    }
    const catFields = buildCategoryMetafields('(gid)', suggested);
    if (catFields.length) {
      log(`    custom metafields: ${catFields.map(f => `${f.key}="${f.value}"`).join(', ')}`);
    }
    if (CLOTHING_CATEGORY_GROUPS.has(categoryGroup) && metaCache && Object.keys(metaCache).length) {
      const fieldMap = CATEGORY_FIELD_MAPS[categoryGroup] || {};
      const taxFields = Object.entries(fieldMap)
        .map(([k, sk]) => `${sk}="${suggested[k] || '(none)'}"`).join(', ');
      log(`    taxonomy metafields: age-group="Adults", target-gender="Female"${taxFields ? ', ' + taxFields : ''}`);
    }
    const geoFields = GEO_FIELD_KEYS.filter(k => suggested[k]).map(k => `${k}=✓`).join(', ');
    if (geoFields) log(`    GEO metafields: ${geoFields}`);
    return { ok: true, dryRun: true };
  }

  // 1. Look up product GID + image media ID
  const shopifyProduct = await getProductByHandle(handle);
  if (!shopifyProduct) throw new Error(`Product not found in Shopify: ${handle}`);
  const { id: productGid, mediaId } = shopifyProduct;

  // 2. Push SEO metafields (global.title_tag + global.description_tag)
  if (suggested.meta_title || suggested.meta_description) {
    await pushMetafields(productGid, suggested.meta_title, suggested.meta_description);
  }

  // 3. Push tags, taxonomy category GID, and suggested description via productUpdate
  // category is passed as a bare ID string per Shopify's ProductUpdateInput schema
  if (suggested.tags?.length || gidStr || suggested.suggested_description) {
    await pushTagsAndCategory(productGid, suggested.tags, gidStr, suggested.suggested_description || null);
  }

  // 4. Push category-specific custom metafields (material, fit_type, metal_finish, etc.)
  await pushCategoryMetafields(productGid, suggested);

  // 4a. Activate taxonomy category metafield slots via productSet.
  // productSet (not productUpdate) is what triggers Shopify to expose the shopify.*
  // namespace fields (fabric, neckline, sleeve-length-type, care-instructions) for the
  // assigned category. We call this even if the category was already set — re-setting
  // via productSet re-runs the activation logic.
  if (gidStr && CLOTHING_CATEGORY_GROUPS.has(categoryGroup)) {
    try {
      await activateProductCategory(productGid, gidStr);
    } catch (err) {
      log(`    WARN: category activation via productSet failed (${err.message})`);
    }
  }

  // 5a. Push Shopify taxonomy category metafields (shopify.fabric, shopify.neckline, etc.)
  // Only for clothing products. Uses list.metaobject_reference type with store-specific GIDs.
  if (CLOTHING_CATEGORY_GROUPS.has(categoryGroup)) {
    try {
      const taxResult = await pushShopifyTaxonomyMetafields(productGid, suggested, metaCache, categoryGroup);
      if (taxResult.count > 0) log(`    taxonomy metafields: ${taxResult.count} pushed`);
    } catch (err) {
      log(`    WARN taxonomy metafields: ${err.message}`);
    }
  }

  // 5b. Push GEO JSON metafields (custom.why_it_works, custom.compatibility, etc.)
  // Powers Shopify Semantic Search, Shop app (UCP) and ChatGPT product feeds (ACP).
  await pushGeoMetafields(productGid, suggested);

  // 6. Push image alt text via fileUpdate
  if (suggested.alt_text && mediaId) {
    await pushAltText(mediaId, suggested.alt_text);
  }

  return { ok: true, productGid, mediaId };
}

// ─── Run ──────────────────────────────────────────────────────────────────────
async function run() {
  log(`=== Shopify SEO Push Started${DRY_RUN ? ' [DRY RUN]' : ''} ===`);
  log(`    API version: ${API_VERSION}`);

  if (!DRY_RUN && (!STORE_DOMAIN || !ADMIN_TOKEN)) {
    log('FATAL: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN must be set in .env');
    process.exit(1);
  }

  // Build merchant metaobject cache fresh at start of every push run.
  // Per-product taxonomy attribute cache is built separately in pushProduct using the product's category GID.
  log('Building Shopify metaobject cache…');
  const merchantCache = DRY_RUN ? {} : await buildFullCache(null).catch(err => {
    log(`WARN: metaobject cache build failed (${err.message}) — taxonomy metafields will be skipped`);
    return {};
  });
  if (!DRY_RUN) {
    const cachedKeys = Object.keys(merchantCache);
    if (cachedKeys.length) {
      log(`Metaobject cache ready: ${cachedKeys.map(k => `${k}(${merchantCache[k].validValues.length})`).join(', ')}`);
    } else {
      log('Metaobject cache: empty — taxonomy metafields will be skipped');
    }
  }

  // Ensure Shopify taxonomy attribute metafield definitions are enabled store-wide.
  // This is the API equivalent of clicking "+ Fabric", "+ Neckline" etc. in Admin.
  // Must succeed before metafieldsSet can write to shopify.fabric, shopify.neckline, etc.
  if (!DRY_RUN) {
    log('Enabling Shopify taxonomy metafield definitions…');
    await ensureTaxonomyDefinitionsEnabled();
    log('Querying store metafield definitions…');
    await logMetafieldDefinitions();
  }

  // Per-category taxonomy caches — memoized by category GID to avoid redundant API calls.
  const taxonomyCacheByGid = {};

  const seoData = loadSeo();
  if (!seoData?.products?.length) {
    log('FATAL: seo_suggestions.json not found or empty.');
    process.exit(1);
  }

  let targets = seoData.products.filter(p => p.status === 'approved');

  if (hrefsFromFile) {
    const hrefSet = new Set(hrefsFromFile);
    targets = targets.filter(p => hrefSet.has(p.href));
  } else if (hrefArg) {
    targets = targets.filter(p => p.href === hrefArg);
  } else if (!PUSH_ALL) {
    targets = targets.filter(p => !p.pushedAt || p.pushStatus === 'error');
  }

  if (!targets.length) {
    log('No products to push. All approved products already pushed. Use --all to re-push.');
    process.exit(0);
  }

  log(`${targets.length} products queued for push`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const product = targets[i];
    log(`  [${i + 1}/${targets.length}] ${product.name?.substring(0, 60)}`);

    try {
      // Build per-product cache: merge merchant cache with taxonomy attributes for this category.
      // Memoized by category GID — one taxonomy query per unique category across all products.
      let metaCache = merchantCache;
      if (!DRY_RUN) {
        const categoryGid = product.suggested?.shopify_taxonomy_gid || null;
        const rawGid = categoryGid && typeof categoryGid === 'object' ? categoryGid.id : categoryGid;
        if (rawGid && !taxonomyCacheByGid[rawGid]) {
          const { buildFullCache: _buildFull } = require('./metaobject_cache');
          taxonomyCacheByGid[rawGid] = await _buildFull(rawGid).catch(() => merchantCache);
          const taxKeys = Object.keys(taxonomyCacheByGid[rawGid]).filter(k => taxonomyCacheByGid[rawGid][k].source === 'taxonomy');
          if (taxKeys.length) log(`    taxonomy attributes loaded: ${taxKeys.join(', ')}`);
        }
        if (rawGid && taxonomyCacheByGid[rawGid]) {
          metaCache = taxonomyCacheByGid[rawGid];
        }
      }
      const result = await pushProduct(product, metaCache);
      const idx = seoData.products.findIndex(p => p.href === product.href);
      if (idx !== -1) {
        seoData.products[idx].pushStatus = 'pushed';
        seoData.products[idx].pushedAt = new Date().toISOString();
        if (result.productGid) seoData.products[idx].shopifyGid = result.productGid;
      }
      successCount++;
    } catch (err) {
      log(`    ERROR: ${err.message}`);
      const idx = seoData.products.findIndex(p => p.href === product.href);
      if (idx !== -1) {
        seoData.products[idx].pushStatus = 'error';
        seoData.products[idx].pushError = err.message;
      }
      errorCount++;
    }

    // Save after each product so partial progress is preserved on failure
    saveSeo(seoData);

    if (i < targets.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  log(`=== Done. ${successCount} pushed, ${errorCount} errors ===`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
