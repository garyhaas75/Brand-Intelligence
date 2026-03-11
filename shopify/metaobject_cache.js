/**
 * Shopify Metaobject + Taxonomy Attribute Cache
 * Builds a name→GID lookup for Shopify category metafields — two sources:
 *
 * 1. Merchant metaobjects (source: 'metaobject')
 *    - Queried via metaobjects(type: "shopify--X") — merchant-created entries
 *    - GIDs are store-specific: gid://shopify/Metaobject/12345
 *    - Push type: list.metaobject_reference
 *    - Examples: material, closure-type, age-group, target-gender
 *
 * 2. Shopify taxonomy attributes (source: 'taxonomy')
 *    - Queried via taxonomyCategory(id: $id) → attributes → values
 *    - GIDs are globally standardized: gid://shopify/TaxonomyValue/6
 *    - Push type: list.taxonomy_reference
 *    - Examples: fabric, neckline, sleeve-length-type, care-instructions
 *
 * Exports:
 *   buildCache()                  — merchant metaobjects only (legacy, still used)
 *   buildTaxonomyAttributeCache(categoryGid) — taxonomy attributes for one category
 *   buildFullCache(categoryGid)   — combines both; taxonomy wins on key conflict
 *   getValidValues(cache, key)    — ["Wool", "Cotton"] or null
 *   resolveToGid(cache, key, val) — GID string or null
 *   getMetafieldType(cache, key)  — 'list.metaobject_reference' | 'list.taxonomy_reference'
 *
 * Run directly for diagnostics:
 *   node shopify/metaobject_cache.js
 *   node shopify/metaobject_cache.js --definitions
 *   node shopify/metaobject_cache.js --taxonomy=gid://shopify/TaxonomyCategory/aa-4-1-3
 */

require('dotenv').config();
const https = require('https');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN  = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION  = process.env.SHOPIFY_API_VERSION || '2025-07';

// Merchant metaobject types to query (source: 'metaobject').
// Key = cache field key = Shopify metafield key.
const FIELD_KEY_CANDIDATES = {
  'material':                  ['shopify--material'],
  'closure-type':              ['shopify--closure-type'],
  'occasion-style':            ['shopify--occasion-style'],
  'age-group':                 ['shopify--age-group'],
  'target-gender':             ['shopify--target-gender'],
  'skirt-style':               ['shopify--skirt-style'],
  'skirt-dress-length-type':   ['shopify--skirt-dress-length-type'],
  'color-pattern':             ['shopify--color-pattern'],
  'toe-style':                 ['shopify--toe-style'],
};

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

// Fetch entries for a specific merchant metaobject type. Returns [] if type doesn't exist.
async function fetchEntries(type) {
  try {
    const data = await shopifyGraphQL(`
      query GetEntries($type: String!) {
        metaobjects(type: $type, first: 250) {
          edges {
            node {
              id
              displayName
            }
          }
        }
      }
    `, { type });
    return (data?.metaobjects?.edges || []).map(e => e.node).filter(e => e.displayName);
  } catch {
    return [];
  }
}

// Fetch all merchant-visible metaobject definitions (for diagnostics only).
async function fetchDefinitions() {
  const data = await shopifyGraphQL(`
    query {
      metaobjectDefinitions(first: 250) {
        edges {
          node {
            type
            name
          }
        }
      }
    }
  `);
  return (data?.metaobjectDefinitions?.edges || []).map(e => e.node);
}

/**
 * Build merchant metaobject cache (source: 'metaobject').
 * Returns: { [fieldKey]: { source: 'metaobject', type, nameToGid, gidToName, validValues } }
 */
async function buildCache() {
  if (!STORE_DOMAIN || !ADMIN_TOKEN) return {};

  const cache = {};
  const verbose = process.env.NODE_ENV !== 'test';

  for (const [fieldKey, candidates] of Object.entries(FIELD_KEY_CANDIDATES)) {
    for (const typeStr of candidates) {
      const entries = await fetchEntries(typeStr);
      if (!entries.length) continue;

      const nameToGid = {};
      const gidToName = {};
      for (const entry of entries) {
        nameToGid[entry.displayName] = entry.id;
        gidToName[entry.id] = entry.displayName;
      }

      cache[fieldKey] = {
        source: 'metaobject',
        type: typeStr,
        nameToGid,
        gidToName,
        validValues: Object.keys(nameToGid).sort(),
      };

      if (verbose) {
        console.log(`[metaobject_cache] ${fieldKey} (${typeStr}): ${entries.length} entries — ${Object.keys(nameToGid).slice(0, 8).join(', ')}${entries.length > 8 ? '…' : ''}`);
      }
      break;
    }
  }

  return cache;
}

// Attribute names from Shopify taxonomy → the metafield key we use for them.
// Shopify uses "Fabric" but the metafield key is "fabric", "Neckline" → "neckline", etc.
// Any attribute name not in this map is skipped (e.g. Color, Size, Pattern, Age group —
// those are either pushed separately or not used in our flow).
const TAXONOMY_ATTR_NAME_TO_KEY = {
  'Fabric':              'fabric',
  'Neckline':            'neckline',
  'Sleeve length type':  'sleeve-length-type',
  'Care instructions':   'care-instructions',
};

/**
 * Build taxonomy attribute cache for a specific Shopify taxonomy category.
 *
 * Approach: strip the last GID segment to get the parent category, then query
 * childrenOf(parent) to get the first sibling — all siblings share the same attribute
 * definitions. Extracts only the attribute types we care about (fabric, neckline, etc.).
 *
 * TaxonomyValue GIDs are globally standardized (gid://shopify/TaxonomyValue/X).
 * Push type for these is list.taxonomy_reference (not list.metaobject_reference).
 *
 * Returns {} gracefully on any error.
 */
async function buildTaxonomyAttributeCache(categoryGid) {
  if (!STORE_DOMAIN || !ADMIN_TOKEN || !categoryGid) return {};

  const verbose = process.env.NODE_ENV !== 'test';

  try {
    // Derive parent GID by stripping the last hyphen-segment from the category ID.
    // e.g. "gid://shopify/TaxonomyCategory/aa-1-10-2-11" → parent "gid://shopify/TaxonomyCategory/aa-1-10-2"
    const prefix = 'gid://shopify/TaxonomyCategory/';
    const idPart = categoryGid.replace(prefix, ''); // e.g. "aa-1-10-2-11"
    const segments = idPart.split('-');
    segments.pop(); // remove last segment
    if (segments.length < 2) {
      if (verbose) console.log(`[taxonomy_cache] GID too shallow to derive parent: ${categoryGid}`);
      return {};
    }
    const parentGid = prefix + segments.join('-');

    // Query up to 50 siblings so we can find the exact matching category.
    // first:1 returned the alphabetically-first sibling (e.g. Bolero Jackets) which may
    // have different attributes than the product's actual category (e.g. Sport Jackets).
    const data = await shopifyGraphQL(`
      query TaxonomyParentChildren($parent: ID!) {
        taxonomy {
          categories(first: 50, childrenOf: $parent) {
            edges {
              node {
                id
                name
                attributes(first: 30) {
                  edges {
                    node {
                      ... on TaxonomyChoiceListAttribute {
                        id
                        name
                        values(first: 100) {
                          edges {
                            node {
                              id
                              name
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, { parent: parentGid });

    const catEdges = data?.taxonomy?.categories?.edges || [];
    if (!catEdges.length) {
      if (verbose) console.log(`[taxonomy_cache] No categories found under parent: ${parentGid}`);
      return {};
    }

    // Prefer the exact category; fall back to first sibling only if not found.
    const exactEdge = catEdges.find(e => e.node.id === categoryGid);
    const repCategory = (exactEdge || catEdges[0]).node;
    if (verbose) console.log(`[taxonomy_cache] Using attributes from: ${repCategory.name} (${repCategory.id})${exactEdge ? ' [exact match]' : ' [sibling fallback]'}`);

    const cache = {};
    const attrEdges = repCategory.attributes?.edges || [];

    for (const edge of attrEdges) {
      const attr = edge.node;
      if (!attr.name || !attr.values) continue; // skip non-choice-list (TaxonomyMeasurementAttribute)

      const metafieldKey = TAXONOMY_ATTR_NAME_TO_KEY[attr.name];
      if (!metafieldKey) continue; // skip Color, Size, Pattern, etc.

      const values = attr.values.edges.map(e => e.node).filter(v => v.id && v.name);
      if (!values.length) continue;

      const nameToGid = {};
      const gidToName = {};
      for (const v of values) {
        nameToGid[v.name] = v.id;
        gidToName[v.id] = v.name;
      }

      cache[metafieldKey] = {
        source: 'taxonomy',
        nameToGid,
        gidToName,
        validValues: Object.keys(nameToGid).sort(),
      };

      if (verbose) {
        console.log(`[taxonomy_cache] ${metafieldKey} (${attr.name}): ${values.length} values — ${Object.keys(nameToGid).slice(0, 8).join(', ')}${values.length > 8 ? '…' : ''}`);
      }
    }

    return cache;
  } catch (err) {
    if (verbose) console.log(`[taxonomy_cache] WARN: ${err.message} — taxonomy attributes unavailable`);
    return {};
  }
}

/**
 * Build combined cache: merchant metaobjects + taxonomy attributes for a category.
 * Taxonomy entries override merchant entries on key conflict (taxonomy is more specific).
 * Call once per run; pass the product's shopify_taxonomy_gid if known.
 */
async function buildFullCache(categoryGid) {
  const [merchantCache, taxonomyCache] = await Promise.all([
    buildCache(),
    categoryGid ? buildTaxonomyAttributeCache(categoryGid) : Promise.resolve({}),
  ]);
  return { ...merchantCache, ...taxonomyCache };
}

/**
 * Get valid display-value strings for a field key.
 * Returns array like ["Wool", "Cotton"] or null if field not in cache.
 */
function getValidValues(cache, fieldKey) {
  return cache?.[fieldKey]?.validValues || null;
}

/**
 * Resolve an exact display value to its Shopify GID.
 * Returns GID string or null if not found.
 */
function resolveToGid(cache, fieldKey, displayValue) {
  if (!cache?.[fieldKey]?.nameToGid) return null;
  return cache[fieldKey].nameToGid[displayValue] || null;
}

/**
 * Get the correct Shopify metafield type for a cache field.
 * All shopify.* category metafields use list.metaobject_reference — both merchant metaobjects
 * (age-group, target-gender, material) and taxonomy attributes (fabric, neckline, etc.).
 * Taxonomy attribute values (TaxonomyValue GIDs) must be wrapped in Metaobject entries
 * (shopify--fabric, shopify--neckline, etc.) before pushing. The metafield type is always
 * list.metaobject_reference regardless of the source.
 */
function getMetafieldType(cache, fieldKey) {
  return 'list.metaobject_reference';
}

module.exports = { buildCache, buildTaxonomyAttributeCache, buildFullCache, getValidValues, resolveToGid, getMetafieldType };

// ─── Diagnostic CLI ───────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  (async () => {
    if (!STORE_DOMAIN || !ADMIN_TOKEN) {
      console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN must be set in .env');
      process.exit(1);
    }
    console.log(`Shopify Metaobject + Taxonomy Cache Diagnostic`);
    console.log(`Store: ${STORE_DOMAIN} | API: ${API_VERSION}\n`);

    if (args.includes('--definitions')) {
      console.log('=== Metaobject Definitions ===');
      const defs = await fetchDefinitions();
      if (!defs.length) {
        console.log('(none found)');
      } else {
        defs.forEach(d => console.log(`  type="${d.type}"  name="${d.name}"`));
      }
      console.log();
    }

    const taxonomyGid = (args.find(a => a.startsWith('--taxonomy=')) || '').replace('--taxonomy=', '') || null;

    if (taxonomyGid) {
      console.log(`=== Taxonomy Attribute Cache (${taxonomyGid}) ===`);
      const taxCache = await buildTaxonomyAttributeCache(taxonomyGid);
      const taxKeys = Object.keys(taxCache);
      if (!taxKeys.length) {
        console.log('  (no taxonomy attributes found)');
      } else {
        for (const [key, data] of Object.entries(taxCache)) {
          console.log(`\n  ${key} (taxonomy, ${data.validValues.length} values)`);
          data.validValues.forEach(v => console.log(`    - "${v}"  →  ${data.nameToGid[v]}`));
        }
      }
      console.log();
    }

    console.log('=== Merchant Metaobject Cache ===');
    const cache = await buildCache();
    const keys = Object.keys(cache);
    if (!keys.length) {
      console.log('\nWARN: Cache is empty. No taxonomy metaobjects found in store.');
    } else {
      console.log(`\nCache: ${keys.length} field(s) populated`);
      for (const [key, data] of Object.entries(cache)) {
        console.log(`\n  ${key} (type: ${data.type}, ${data.validValues.length} entries)`);
        data.validValues.forEach(v => console.log(`    - "${v}"  →  ${data.nameToGid[v]}`));
      }
    }
  })().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
}
