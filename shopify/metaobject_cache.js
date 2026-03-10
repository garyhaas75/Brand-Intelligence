/**
 * Shopify Metaobject Cache
 * Builds a name→GID lookup for Shopify taxonomy category metafields.
 * Used by both the SEO analyzer (to constrain Claude's output to valid values)
 * and push_seo.js (to resolve exact display values to their store-specific GIDs).
 *
 * ALL Shopify category metafields (shopify.fabric, shopify.neckline, etc.) use
 * list.metaobject_reference type — not text. Each value is a store-specific GID
 * like gid://shopify/Metaobject/12345. This module discovers those GIDs from live
 * Shopify data via the Admin GraphQL API.
 *
 * Cache freshness: buildCache() always queries Shopify fresh — no disk caching.
 * Call once at the start of each analyzer/push run. Adds <1s per run (~2 GQL calls).
 *
 * Usage:
 *   const { buildCache, getValidValues, resolveToGid } = require('./metaobject_cache');
 *   const cache = await buildCache().catch(() => ({}));
 *   const fabrics = getValidValues(cache, 'fabric'); // ["Wool", "Cotton", ...]
 *   const gid = resolveToGid(cache, 'fabric', 'Wool'); // "gid://shopify/Metaobject/123"
 */

require('dotenv').config();
const https = require('https');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN  = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION  = process.env.SHOPIFY_API_VERSION || '2025-07';

// Maps our field key → substring to search for in Shopify metaobject definition types.
// Shopify taxonomy metaobjects are typically named like "shopify--fabric", "shopify--neckline", etc.
const FIELD_KEY_TO_TYPE_PATTERN = {
  'fabric':             'fabric',
  'neckline':           'neckline',
  'sleeve-length-type': 'sleeve-length',
  'care-instructions':  'care-instruction',
  'age-group':          'age-group',
  'target-gender':      'target-gender',
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

async function fetchDefinitions() {
  const data = await shopifyGraphQL(`
    query {
      metaobjectDefinitions(first: 100) {
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

async function fetchEntries(type) {
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
  return (data?.metaobjects?.edges || []).map(e => e.node);
}

/**
 * Build a fresh lookup cache from Shopify.
 * Returns: { [fieldKey]: { type, nameToGid, gidToName, validValues } }
 *
 * If Shopify credentials are not configured, returns {} gracefully.
 */
async function buildCache() {
  if (!STORE_DOMAIN || !ADMIN_TOKEN) {
    return {};
  }

  const definitions = await fetchDefinitions();
  const cache = {};

  for (const [fieldKey, pattern] of Object.entries(FIELD_KEY_TO_TYPE_PATTERN)) {
    const matched = definitions.find(d => d.type.toLowerCase().includes(pattern.toLowerCase()));
    if (!matched) {
      // Not found — log but don't fail
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[metaobject_cache] WARN: no definition found for field "${fieldKey}" (pattern: "${pattern}")`);
      }
      continue;
    }

    const entries = await fetchEntries(matched.type);
    const nameToGid = {};
    const gidToName = {};

    for (const entry of entries) {
      if (entry.displayName && entry.id) {
        nameToGid[entry.displayName] = entry.id;
        gidToName[entry.id] = entry.displayName;
      }
    }

    cache[fieldKey] = {
      type: matched.type,
      nameToGid,
      gidToName,
      validValues: Object.keys(nameToGid).sort(),
    };

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[metaobject_cache] ${fieldKey} (${matched.type}): ${Object.keys(nameToGid).length} entries — ${Object.keys(nameToGid).join(', ')}`);
    }
  }

  return cache;
}

/**
 * Get valid display-value strings for a field key.
 * Used to constrain Claude's output to exact Shopify values during analysis.
 * Returns array like ["Wool", "Cotton", "Silk"] or null if field not in cache.
 */
function getValidValues(cache, fieldKey) {
  return cache?.[fieldKey]?.validValues || null;
}

/**
 * Resolve an exact display value to its Shopify metaobject GID.
 * Used at push time. Returns GID string or null if not found.
 * No fuzzy matching — Claude returns the exact valid value (constrained during analysis).
 */
function resolveToGid(cache, fieldKey, displayValue) {
  if (!cache?.[fieldKey]?.nameToGid) return null;
  return cache[fieldKey].nameToGid[displayValue] || null;
}

module.exports = { buildCache, getValidValues, resolveToGid };
