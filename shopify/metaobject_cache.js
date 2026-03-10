/**
 * Shopify Metaobject Cache
 * Builds a name→GID lookup for Shopify taxonomy category metafields.
 * Used by both the SEO analyzer (to constrain Claude's output to valid values)
 * and push_seo.js (to resolve exact display values to their store-specific GIDs).
 *
 * ALL Shopify category metafields use list.metaobject_reference type.
 * Each value is a store-specific GID like gid://shopify/Metaobject/12345.
 *
 * IMPORTANT: metaobjectDefinitions only returns merchant-created definitions,
 * NOT Shopify's system-managed taxonomy metaobjects. We skip definition discovery
 * and directly query metaobjects by well-known Shopify type strings instead.
 *
 * Type→key naming: Shopify metaobject type "shopify--material" → metafield key "material".
 * Strip "shopify--" prefix from type to get the metafield key.
 *
 * Cache freshness: buildCache() always queries Shopify fresh — no disk caching.
 * Call once at the start of each analyzer/push run.
 *
 * Run this file directly for diagnostics:
 *   node shopify/metaobject_cache.js
 *   node shopify/metaobject_cache.js --definitions  (list all metaobject definitions)
 */

require('dotenv').config();
const https = require('https');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN  = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION  = process.env.SHOPIFY_API_VERSION || '2025-07';

// Field keys and their Shopify type strings to query.
// Key = cache field key (also used as the Shopify metafield key, without shopify-- prefix).
// Candidates = type strings to try in order; first one with entries is used.
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
  // Retained in case Shopify adds these entries later:
  'fabric':                    ['shopify--fabric'],
  'neckline':                  ['shopify--neckline'],
  'sleeve-length-type':        ['shopify--sleeve-length-type'],
  'care-instructions':         ['shopify--care-instructions'],
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

// Fetch entries for a specific metaobject type. Returns [] if type doesn't exist.
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
 * Build a fresh lookup cache from Shopify.
 * Returns: { [fieldKey]: { type, nameToGid, gidToName, validValues } }
 *
 * Only includes field keys that actually have entries in the store.
 * If Shopify credentials are not configured, returns {} gracefully.
 */
async function buildCache() {
  if (!STORE_DOMAIN || !ADMIN_TOKEN) {
    return {};
  }

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

/**
 * Get valid display-value strings for a field key.
 * Returns array like ["Wool", "Cotton"] or null if field not in cache.
 */
function getValidValues(cache, fieldKey) {
  return cache?.[fieldKey]?.validValues || null;
}

/**
 * Resolve an exact display value to its Shopify metaobject GID.
 * Returns GID string or null if not found.
 */
function resolveToGid(cache, fieldKey, displayValue) {
  if (!cache?.[fieldKey]?.nameToGid) return null;
  return cache[fieldKey].nameToGid[displayValue] || null;
}

module.exports = { buildCache, getValidValues, resolveToGid };

// ─── Diagnostic CLI ───────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  (async () => {
    if (!STORE_DOMAIN || !ADMIN_TOKEN) {
      console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN must be set in .env');
      process.exit(1);
    }
    console.log(`Shopify Metaobject Cache Diagnostic`);
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

    console.log('=== Cache Build ===');
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
