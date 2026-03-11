/**
 * Shopify metafield diagnostic — run once to reveal actual definition keys.
 * node shopify/diagnose.js
 */
require('dotenv').config();
const https = require('https');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN  = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION  = process.env.SHOPIFY_API_VERSION || '2025-07';

// Product to inspect — the Sport Jacket we've been testing
const PRODUCT_HANDLE = 'anne-klein-double-breasted-blazer-camel'; // update if needed

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
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
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

async function run() {
  console.log('=== Shopify Metafield Diagnostic ===\n');

  // 1. All product metafield definitions
  console.log('── Store metafield definitions (PRODUCT) ──');
  const defData = await shopifyGraphQL(`{
    metafieldDefinitions(first: 100, ownerType: PRODUCT) {
      edges { node { namespace key name type { name } } }
    }
  }`);
  const defs = (defData?.metafieldDefinitions?.edges || []).map(e => e.node);
  const shopifyDefs = defs.filter(d => d.namespace === 'shopify');
  const customDefs  = defs.filter(d => d.namespace === 'custom');

  console.log('\nshopify.* definitions:');
  if (shopifyDefs.length) shopifyDefs.forEach(d => console.log(`  shopify.${d.key}  (${d.type.name})  "${d.name}"`));
  else console.log('  (none)');

  console.log('\ncustom.* definitions:');
  if (customDefs.length) customDefs.forEach(d => console.log(`  custom.${d.key}  (${d.type.name})  "${d.name}"`));
  else console.log('  (none)');

  // 2. Actual metafields stored on the product (first 50, custom + shopify namespace)
  console.log('\n── Product metafields stored on handle: ' + PRODUCT_HANDLE + ' ──');
  const prodData = await shopifyGraphQL(`
    query ($handle: String!) {
      productByIdentifier(identifier: { handle: $handle }) {
        id title
        metafields(first: 50) {
          edges { node { namespace key type value } }
        }
      }
    }
  `, { handle: PRODUCT_HANDLE });

  const product = prodData?.productByIdentifier;
  if (!product) {
    console.log('  Product not found. Update PRODUCT_HANDLE in the script.');
    return;
  }
  console.log(`  Product: ${product.title} (${product.id})`);
  const metas = (product.metafields?.edges || []).map(e => e.node);
  if (!metas.length) { console.log('  No metafields stored.'); return; }

  const shopifyMetas = metas.filter(m => m.namespace === 'shopify');
  const customMetas  = metas.filter(m => m.namespace === 'custom');
  const globalMetas  = metas.filter(m => m.namespace === 'global');

  if (shopifyMetas.length) {
    console.log('\n  shopify.* metafields:');
    shopifyMetas.forEach(m => console.log(`    shopify.${m.key}  [${m.type}]  ${m.value?.slice(0, 80)}`));
  }
  if (customMetas.length) {
    console.log('\n  custom.* metafields:');
    customMetas.forEach(m => console.log(`    custom.${m.key}  [${m.type}]  ${m.value?.slice(0, 80)}`));
  }
  if (globalMetas.length) {
    console.log('\n  global.* metafields:');
    globalMetas.forEach(m => console.log(`    global.${m.key}  [${m.type}]  ${m.value?.slice(0, 80)}`));
  }
}

run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
