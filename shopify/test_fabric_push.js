/**
 * Tests the correct 5-layer approach:
 * TaxonomyValue → Metaobject entry → Metafield (list.metaobject_reference)
 */
require('dotenv').config();
const https = require('https');

function shopifyGraphQL(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = { hostname: process.env.SHOPIFY_STORE_DOMAIN, path: '/admin/api/2025-07/graphql.json', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN, 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(options, res => { let d=''; res.on('data',c=>{d+=c;}); res.on('end',()=>{ try{const j=JSON.parse(d); if(j.errors) return reject(new Error(j.errors.map(e=>e.message).join('; '))); resolve(j.data);} catch(e){reject(e);} }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

(async () => {
  const productGid = 'gid://shopify/Product/7367179305031'; // Sport Jackets blazer
  const woolTaxonomyGid = 'gid://shopify/TaxonomyValue/16999'; // Wool
  const metaobjectType = 'shopify--fabric';

  console.log('Step 1: Check existing shopify--fabric entries...');
  const existing = await shopifyGraphQL(`{
    metaobjects(type: "shopify--fabric", first: 250) {
      edges { node { id fields { key value } } }
    }
  }`);
  const entries = existing?.metaobjects?.edges || [];
  console.log(`  Found ${entries.length} existing entries`);
  const woolEntry = entries.find(e => e.node.fields?.find(f => f.key === 'taxonomy_reference' && f.value === woolTaxonomyGid));
  let woolMetaobjectGid = woolEntry?.node?.id;
  console.log('  Wool entry:', woolMetaobjectGid || 'NOT FOUND');

  if (!woolMetaobjectGid) {
    console.log('\nStep 2: Creating shopify--fabric entry for Wool...');
    const r = await shopifyGraphQL(`
      mutation CreateMetaobjectEntry($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id fields { key value } }
          userErrors { field message }
        }
      }
    `, {
      metaobject: {
        type: metaobjectType,
        fields: [
          { key: 'name', value: 'Wool' },
          { key: 'taxonomy_reference', value: woolTaxonomyGid },
        ],
      },
    });
    const errors = r?.metaobjectCreate?.userErrors || [];
    if (errors.length) {
      console.log('  ERROR creating entry:', JSON.stringify(errors));
      return;
    }
    woolMetaobjectGid = r?.metaobjectCreate?.metaobject?.id;
    console.log('  Created:', woolMetaobjectGid);
    console.log('  Fields:', JSON.stringify(r?.metaobjectCreate?.metaobject?.fields));
  }

  console.log('\nStep 3: Push shopify.fabric metafield with Metaobject GID...');
  const r2 = await shopifyGraphQL(`
    mutation M($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{id key value}userErrors{field message}}}
  `, {
    m: [{ ownerId: productGid, namespace: 'shopify', key: 'fabric', type: 'list.metaobject_reference', value: JSON.stringify([woolMetaobjectGid]) }]
  });
  console.log('  errors:', JSON.stringify(r2?.metafieldsSet?.userErrors));
  console.log('  pushed metafields:', r2?.metafieldsSet?.metafields?.length);
  if (r2?.metafieldsSet?.metafields?.length) {
    console.log('  value:', r2.metafieldsSet.metafields[0].value);
    console.log('\n✓ SUCCESS: shopify.fabric now set to Wool via Metaobject entry');
  }
})().catch(e => console.error('ERROR:', e.message));
