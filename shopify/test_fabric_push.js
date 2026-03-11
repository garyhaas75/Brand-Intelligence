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
  // Find Wool TaxonomyValue GID
  const data = await shopifyGraphQL(`{
    taxonomy {
      categories(first: 50, childrenOf: "gid://shopify/TaxonomyCategory/aa-1-10-2") {
        edges { node { id name attributes(first: 20) { edges { node {
          ... on TaxonomyChoiceListAttribute { name values(first: 50) { edges { node { id name } } } }
        } } } } }
      }
    }
  }`);
  const cats = data?.taxonomy?.categories?.edges || [];
  const sport = cats.find(e => e.node.id === 'gid://shopify/TaxonomyCategory/aa-1-10-2-11') || cats[0];
  const attrs = sport?.node?.attributes?.edges || [];
  const fabricAttr = attrs.find(e => e.node.name === 'Fabric');
  const woolVal = fabricAttr?.node?.values?.edges?.find(e => e.node.name === 'Wool');
  console.log('Wool TaxonomyValue GID:', woolVal?.node?.id);
  if (!woolVal) { console.log('Could not find Wool GID'); return; }

  // Find any clothing product
  const p = await shopifyGraphQL(`{ products(first: 1, query: "blazer") { edges { node { id title } } } }`);
  const productGid = p?.products?.edges?.[0]?.node?.id;
  console.log('Test product:', p?.products?.edges?.[0]?.node?.title, productGid);
  if (!productGid) { console.log('No product found'); return; }

  // Test 1: push with list.metaobject_reference (matches definition type)
  const r1 = await shopifyGraphQL(`mutation M($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{id key value}userErrors{field message}}}`, {
    m: [{ ownerId: productGid, namespace: 'shopify', key: 'fabric', type: 'list.metaobject_reference', value: JSON.stringify([woolVal.node.id]) }]
  });
  console.log('\nTest 1 (list.metaobject_reference + TaxonomyValue GID):');
  console.log('  errors:', JSON.stringify(r1?.metafieldsSet?.userErrors));
  console.log('  pushed:', r1?.metafieldsSet?.metafields?.length);

  // Test 2: push with list.product_taxonomy_value_reference
  const r2 = await shopifyGraphQL(`mutation M($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{id key value}userErrors{field message}}}`, {
    m: [{ ownerId: productGid, namespace: 'shopify', key: 'fabric', type: 'list.product_taxonomy_value_reference', value: JSON.stringify([woolVal.node.id]) }]
  });
  console.log('\nTest 2 (list.product_taxonomy_value_reference + TaxonomyValue GID):');
  console.log('  errors:', JSON.stringify(r2?.metafieldsSet?.userErrors));
  console.log('  pushed:', r2?.metafieldsSet?.metafields?.length);
})().catch(e => console.error('ERROR:', e.message));
