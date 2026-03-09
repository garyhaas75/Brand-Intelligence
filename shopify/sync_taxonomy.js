/**
 * Shopify Taxonomy Sync
 * Fetches the Shopify Product Taxonomy from the public GitHub repo
 * (no API credentials required — the taxonomy is open source).
 *
 * Filters to "Apparel & Accessories" subtree (relevant to Anne Klein),
 * saves a clean lookup to data/shopify_taxonomy.json.
 *
 * Run quarterly or whenever Shopify releases a new taxonomy version.
 * Current taxonomy version: 2025-12 (updated quarterly).
 *
 * Usage:
 *   node shopify/sync_taxonomy.js
 *   npm run shopify:sync-taxonomy
 *
 * Output: data/shopify_taxonomy.json
 */

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '../data/shopify_taxonomy.json');
const LOG_FILE    = path.join(__dirname, '../logs/shopify_sync.log');

// Public GitHub raw URL for the Shopify product taxonomy
const TAXONOMY_URL = 'https://raw.githubusercontent.com/Shopify/product-taxonomy/main/dist/en/categories.json';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'anne-klein-intel/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

// Map taxonomy GID to our internal category group using the GID prefix structure:
//   aa-1  = Clothing
//   aa-2  = Clothing Accessories
//   aa-3  = Costumes & Accessories
//   aa-4  = (other)
//   aa-5  = Handbags, Wallets & Cases
//   aa-6  = Jewelry
//   aa-7  = Shoe Accessories
//   aa-8  = Shoes
function getCategoryGroup(gid) {
  const id = gid.replace('gid://shopify/TaxonomyCategory/', '');
  if (id === 'aa') return 'other'; // root
  if (id.startsWith('aa-5')) return 'handbags';
  if (id.startsWith('aa-6')) return 'jewelry';
  if (id.startsWith('aa-8')) return 'shoes';
  if (id.startsWith('aa-1')) return 'clothing'; // aa-1 = Clothing (most of apparel)
  return 'other';
}

async function run() {
  log('=== Shopify Taxonomy Sync Started ===');
  log(`Fetching from: ${TAXONOMY_URL}`);

  const raw = await fetchJSON(TAXONOMY_URL);

  // Taxonomy JSON: { version, verticals: [{ name, prefix, categories: [...] }] }
  const version = raw.version || 'unknown';
  log(`Taxonomy version: ${version}`);

  const allVerticals = raw.verticals || [];
  const totalAll = allVerticals.reduce((n, v) => n + (v.categories || []).length, 0);
  log(`Total categories across all verticals: ${totalAll}`);

  // Extract Apparel & Accessories vertical (prefix: "aa")
  const apparelVertical = allVerticals.find(v => v.prefix === 'aa' || /apparel/i.test(v.name));
  const apparel = apparelVertical?.categories || [];

  log(`Apparel & Accessories categories: ${apparel.length}`);

  // Build clean lookup
  const categories = apparel.map(c => {
    const fullName = c.full_name || c.fullName || c.name || '';
    return {
      gid: c.id,
      name: c.name,
      fullName,
      level: c.level || fullName.split('>').length,
      parentGid: c.parent_id || c.parentId || null,
      categoryGroup: getCategoryGroup(c.id || ''),
    };
  });

  // Group by categoryGroup for easy lookup
  const byGroup = {};
  for (const cat of categories) {
    if (!byGroup[cat.categoryGroup]) byGroup[cat.categoryGroup] = [];
    byGroup[cat.categoryGroup].push(cat);
  }

  const output = {
    syncedAt: new Date().toISOString(),
    taxonomyVersion: version,
    source: TAXONOMY_URL,
    totalApparel: categories.length,
    counts: Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, v.length])),
    categories,
    byGroup,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  log(`Saved ${categories.length} categories to data/shopify_taxonomy.json`);
  log('Breakdown:');
  for (const [group, cats] of Object.entries(byGroup)) {
    log(`  ${group}: ${cats.length} categories`);
  }
  log('=== Sync Complete ===');
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
