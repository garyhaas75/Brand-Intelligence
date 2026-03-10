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

// Fields handled by dedicated push steps — excluded from custom metafields
const SEO_FIELDS = new Set([
  'meta_title', 'meta_description', 'tags', 'alt_text',
  'image_insights', 'geo_description', 'suggested_description',
  'shopify_taxonomy_gid', 'shopify_category',
]);

// Mapping from our analyzed field keys → Shopify shopify.* namespace category metafield keys.
// These populate the "Category metafields" section in Shopify admin.
// Value type: list.single_line_text_field — value must be a JSON-encoded string array.
const SHOPIFY_CATEGORY_FIELD_MAP = {
  material:          'fabric',
  care_instructions: 'care-instructions',
  neckline:          'neckline',
  sleeve_length:     'sleeve-length-type',
};

// Category groups that get Shopify taxonomy metafields (age-group, target-gender, fabric, etc.)
const CLOTHING_CATEGORY_GROUPS = new Set(['clothing']);

// Push Shopify-namespace category metafields (appear in Shopify admin "Category metafields" section).
// Always sets age-group and target-gender for women's clothing.
// Maps material → fabric, care_instructions → care-instructions, neckline, sleeve_length.
async function pushShopifyTaxonomyMetafields(productGid, suggested) {
  const metafields = [
    { ownerId: productGid, namespace: 'shopify', key: 'age-group',     type: 'list.single_line_text_field', value: '["Adult"]' },
    { ownerId: productGid, namespace: 'shopify', key: 'target-gender', type: 'list.single_line_text_field', value: '["Women"]' },
  ];

  for (const [ourKey, shopifyKey] of Object.entries(SHOPIFY_CATEGORY_FIELD_MAP)) {
    const val = suggested[ourKey];
    if (val && typeof val === 'string' && val.trim()) {
      metafields.push({
        ownerId: productGid,
        namespace: 'shopify',
        key: shopifyKey,
        type: 'list.single_line_text_field',
        value: JSON.stringify([val.trim()]),
      });
    }
  }

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

// ─── Push a single product ────────────────────────────────────────────────────
async function pushProduct(product) {
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
      log(`    category metafields: ${catFields.map(f => `${f.key}="${f.value}"`).join(', ')}`);
    }
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

  // 5. Push Shopify taxonomy category metafields (namespace: shopify — "Category metafields" in admin)
  //    Populates: age-group, target-gender, fabric, care-instructions, neckline, sleeve-length-type
  if (CLOTHING_CATEGORY_GROUPS.has(categoryGroup)) {
    await pushShopifyTaxonomyMetafields(productGid, suggested);
  }

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
      const result = await pushProduct(product);
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
