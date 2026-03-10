'use strict';
const axios = require('axios');

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function shopifyHeaders() {
  return { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN };
}

function shopifyUrl(path) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN || 'anneklein.myshopify.com';
  const version = process.env.SHOPIFY_API_VERSION || '2024-01';
  return `https://${domain}/admin/api/${version}${path}`;
}

function isConfigured() {
  return !!process.env.SHOPIFY_ADMIN_API_TOKEN;
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Fetches in-stock products with rich metadata (description, tags, category).
 * Returns products grouped by type for smarter Claude matching.
 * Cache: 30 minutes.
 */
async function getInStockProducts({ limit = 30, productType } = {}) {
  if (!isConfigured()) return [];
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    const results = productType
      ? _cache.filter(p => p.productType?.toLowerCase() === productType.toLowerCase())
      : _cache;
    return results.slice(0, limit);
  }

  try {
    // Paginate through all products (Shopify caps each page at 250)
    let allRaw = [];
    let params = { fields: 'id,title,handle,product_type,body_html,tags,variants,images', limit: 250 };
    while (true) {
      const { data, headers } = await axios.get(shopifyUrl('/products.json'), {
        headers: shopifyHeaders(),
        params,
      });
      allRaw = allRaw.concat(data.products || []);
      // Parse Link header for next page cursor
      const link = headers['link'] || '';
      const nextMatch = link.match(/<[^>]+page_info=([^&>]+)[^>]*>;\s*rel="next"/);
      if (!nextMatch) break;
      params = { fields: params.fields, limit: 250, page_info: nextMatch[1] };
    }

    const all = allRaw
      .map(p => {
        const qty = (p.variants || []).reduce((sum, v) => sum + (parseInt(v.inventory_quantity) || 0), 0);
        const price = parseFloat(p.variants?.[0]?.price || 0);
        // Extract clean tags (remove internal ops tags)
        const tags = (p.tags || '').split(',')
          .map(t => t.trim())
          .filter(t => t && !['bis-show', 'discount-eligible', 'gorgias_do_not_recommend'].includes(t))
          .slice(0, 6);
        return {
          handle: p.handle,
          name: p.title,
          productType: p.product_type || '',
          price,
          availableQty: qty,
          description: stripHtml(p.body_html),
          tags,
          image: p.images?.[0]?.src || null,
          href: `https://anneklein.com/products/${p.handle}`,
        };
      })
      .filter(p => p.availableQty > 0)
      .sort((a, b) => b.availableQty - a.availableQty);

    _cache = all;
    _cacheTime = Date.now();

    const results = productType
      ? all.filter(p => p.productType?.toLowerCase() === productType.toLowerCase())
      : all;
    return results.slice(0, limit);
  } catch (err) {
    console.error('[shopify/inventory] getInStockProducts error:', err.message);
    return [];
  }
}

/**
 * Returns the product catalog formatted for Claude — grouped by type,
 * top N per category, with enough context for intelligent theme matching.
 * This is what gets injected into the generate prompt.
 */
async function getProductCatalogForPrompt({ perCategory = 6 } = {}) {
  if (!isConfigured()) return '';
  const all = await getInStockProducts({ limit: 9999 });
  if (!all.length) return '';

  // Group by productType
  const byType = {};
  for (const p of all) {
    const t = p.productType || 'Other';
    if (!byType[t]) byType[t] = [];
    if (byType[t].length < perCategory) byType[t].push(p);
  }

  const lines = ['IN-STOCK PRODUCTS BY CATEGORY (pick the best match for each email\'s theme — do not use out-of-stock products):'];
  for (const [type, products] of Object.entries(byType)) {
    lines.push(`\n${type.toUpperCase()}:`);
    for (const p of products) {
      const tagStr = p.tags.length ? ` [${p.tags.join(', ')}]` : '';
      const imgStr = p.image ? ` | image: ${p.image}` : '';
      lines.push(`  • ${p.name} ($${p.price})${tagStr} — ${p.description || 'No description'} | handle: ${p.handle}${imgStr}`);
    }
  }

  return lines.join('\n');
}

/**
 * Checks current availability for a list of product handles.
 */
async function checkHandles(handles) {
  if (!isConfigured() || !handles?.length) return {};
  const out = {};
  for (const handle of handles) {
    try {
      const { data } = await axios.get(shopifyUrl('/products.json'), {
        headers: shopifyHeaders(),
        params: { handle, fields: 'id,title,handle,variants' },
      });
      const p = data.products?.[0];
      if (!p) { out[handle] = { status: 'notFound' }; continue; }
      const qty = (p.variants || []).reduce((sum, v) => sum + (parseInt(v.inventory_quantity) || 0), 0);
      out[handle] = {
        name: p.title,
        qty,
        status: qty > 5 ? 'inStock' : qty > 0 ? 'lowStock' : 'outOfStock',
      };
    } catch (err) {
      console.error(`[shopify/inventory] checkHandles error for ${handle}:`, err.message);
      out[handle] = { status: 'error' };
    }
  }
  return out;
}

function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = { getInStockProducts, getProductCatalogForPrompt, checkHandles, invalidateCache, isConfigured };
