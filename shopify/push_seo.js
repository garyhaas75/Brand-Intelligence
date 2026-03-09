/**
 * Shopify SEO Push — Phase 3
 * Reads approved products from data/seo_suggestions.json and pushes to Shopify via GraphQL Admin API.
 *
 * Pushes per product:
 *   - meta_title   → global.title_tag metafield (single_line_text_field)
 *   - meta_description → global.description_tag metafield (single_line_text_field)
 *   - tags         → product.tags (productUpdate mutation)
 *   - alt_text     → first product image alt (productUpdateMedia mutation)
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
  // https://www.anneklein.com/products/ponte-blazer-with-pockets -> ponte-blazer-with-pockets
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

// Get product GID + first media ID by handle
async function getProductByHandle(handle) {
  const data = await shopifyGraphQL(`
    query getProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id
        title
        media(first: 1) {
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

  const product = data?.productByHandle;
  if (!product) return null;
  const mediaEdge = product.media?.edges?.[0]?.node;
  return {
    id: product.id,
    title: product.title,
    mediaId: mediaEdge?.id || null,
    currentAlt: mediaEdge?.alt || null,
  };
}

// Push title_tag and description_tag metafields
async function pushMetafields(productGid, metaTitle, metaDescription) {
  const metafields = [];
  if (metaTitle) {
    metafields.push({ ownerId: productGid, namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: metaTitle });
  }
  if (metaDescription) {
    metafields.push({ ownerId: productGid, namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: metaDescription });
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

// Update product tags and/or taxonomy category
// category = { id: "gid://shopify/TaxonomyCategory/aa-1-4-3" }
async function pushTags(productGid, tags, _unused, category) {
  const input = { id: productGid };
  if (tags?.length) input.tags = tags;
  if (category?.id) input.category = category; // sets Shopify taxonomy category (unlocks metafield definitions)
  if (Object.keys(input).length === 1) return { ok: true }; // nothing to set

  const data = await shopifyGraphQL(`
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id tags category { id name fullName } }
        userErrors { field message }
      }
    }
  `, { input });

  const errors = data?.productUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '));
  return { ok: true };
}

// Update image alt text
async function pushAltText(productGid, mediaId, altText) {
  if (!mediaId || !altText) return { ok: true };

  const data = await shopifyGraphQL(`
    mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
      productUpdateMedia(productId: $productId, media: $media) {
        media { id alt }
        userErrors { field message }
      }
    }
  `, { productId: productGid, media: [{ id: mediaId, alt: altText }] });

  const errors = data?.productUpdateMedia?.userErrors || [];
  if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '));
  return { ok: true };
}

// Build category-specific metafield entries (namespace: custom)
// These map to the fields the analyzer generates per category group
function buildCategoryMetafields(productGid, categoryGroup, suggested) {
  const fields = [];
  const add = (key, value) => {
    if (value) fields.push({ ownerId: productGid, namespace: 'custom', key, type: 'single_line_text_field', value: String(value) });
  };

  switch (categoryGroup) {
    case 'clothing':
      add('material', suggested.material);
      add('care_instructions', suggested.care_instructions);
      add('fit_type', suggested.fit_type);
      break;
    case 'shoes':
      add('material', suggested.material);
      add('heel_style', suggested.heel_style);
      add('closure_type', suggested.closure_type);
      break;
    case 'jewelry':
      add('material', suggested.material);
      add('closure_type', suggested.closure_type);
      break;
    case 'handbags':
      add('material', suggested.material);
      add('closure_type', suggested.closure_type);
      add('strap_drop', suggested.strap_drop);
      break;
  }
  return fields;
}

// Push category-specific metafields (bundled into a single metafieldsSet call)
async function pushCategoryMetafields(productGid, categoryGroup, suggested) {
  const metafields = buildCategoryMetafields(productGid, categoryGroup, suggested);
  if (!metafields.length) return { ok: true };

  // metafieldsSet accepts up to 25 per call — well within limit
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

  if (DRY_RUN) {
    log(`  [DRY RUN] Would push: handle=${handle} (${categoryGroup})`);
    log(`    meta_title:       ${suggested.meta_title}`);
    log(`    meta_description: ${suggested.meta_description}`);
    log(`    tags:             ${(suggested.tags || []).join(', ')}`);
    log(`    alt_text:         ${suggested.alt_text || '(none)'}`);
    log(`    taxonomy_gid:     ${suggested.shopify_taxonomy_gid || suggested.shopify_category || '(none)'}`);
    const catFields = buildCategoryMetafields('(gid)', categoryGroup, suggested);
    if (catFields.length) {
      log(`    category metafields: ${catFields.map(f => `${f.key}="${f.value}"`).join(', ')}`);
    }
    return { ok: true, dryRun: true };
  }

  // 1. Look up product GID
  const shopifyProduct = await getProductByHandle(handle);
  if (!shopifyProduct) throw new Error(`Product not found in Shopify: ${handle}`);

  const { id: productGid, mediaId } = shopifyProduct;

  // 2. Push SEO metafields (global.title_tag + global.description_tag)
  if (suggested.meta_title || suggested.meta_description) {
    await pushMetafields(productGid, suggested.meta_title, suggested.meta_description);
  }

  // 3. Push tags + taxonomy category GID (drives Shopify's metafield definitions)
  const updateInput = { id: productGid };
  if (suggested.tags?.length) updateInput.tags = suggested.tags;
  // shopify_taxonomy_gid is the real Shopify taxonomy category GID (from sync_taxonomy.js)
  // Falls back to shopify_category string (legacy free-text) if GID not yet generated
  if (suggested.shopify_taxonomy_gid) {
    updateInput.category = { id: suggested.shopify_taxonomy_gid };
  }
  if (Object.keys(updateInput).length > 1) {
    await pushTags(productGid, updateInput.tags, null, updateInput.category);
  }

  // 4. Push category-specific metafields (material, fit, heel_style, etc.)
  await pushCategoryMetafields(productGid, categoryGroup, suggested);

  // 5. Push image alt text
  if (suggested.alt_text && mediaId) {
    await pushAltText(productGid, mediaId, suggested.alt_text);
  }

  return { ok: true, productGid, mediaId };
}

// ─── Run ──────────────────────────────────────────────────────────────────────
async function run() {
  log(`=== Shopify SEO Push Started${DRY_RUN ? ' [DRY RUN]' : ''} ===`);

  if (!DRY_RUN && (!STORE_DOMAIN || !ADMIN_TOKEN)) {
    log('FATAL: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN must be set in .env');
    process.exit(1);
  }

  const seoData = loadSeo();
  if (!seoData?.products?.length) {
    log('FATAL: seo_suggestions.json not found or empty.');
    process.exit(1);
  }

  // Select products to push
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
    log('No products to push. All approved products have already been pushed. Use --all to re-push.');
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

      // Update push status in the file
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

    // Save after each product so partial progress is preserved
    saveSeo(seoData);

    if (i < targets.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  log(`=== Done. ${successCount} pushed, ${errorCount} errors ===`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
