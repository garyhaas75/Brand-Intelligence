'use strict';
const axios = require('axios');

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function shopifyHeaders() {
  return { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN };
}

function shopifyUrl(path) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN || 'anneklein.com';
  const version = process.env.SHOPIFY_API_VERSION || '2024-01';
  return `https://${domain}/admin/api/${version}${path}`;
}

function isConfigured() {
  return !!process.env.SHOPIFY_ADMIN_API_TOKEN;
}

/**
 * Returns top in-stock products sorted by available quantity.
 * Results are cached for 30 minutes to avoid hammering the API.
 * Returns [] if SHOPIFY_ADMIN_API_TOKEN is not set.
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
    const { data } = await axios.get(shopifyUrl('/products.json'), {
      headers: shopifyHeaders(),
      params: { fields: 'id,title,handle,product_type,variants,images', limit: 250 },
    });

    const all = (data.products || [])
      .map(p => {
        const qty = (p.variants || []).reduce((sum, v) => sum + (parseInt(v.inventory_quantity) || 0), 0);
        const price = parseFloat(p.variants?.[0]?.price || 0);
        return {
          handle: p.handle,
          name: p.title,
          productType: p.product_type || '',
          price,
          availableQty: qty,
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
 * Checks current availability for a list of product handles.
 * Returns { handle: { name, qty, status: 'inStock'|'lowStock'|'outOfStock'|'notFound' } }
 * Returns {} if SHOPIFY_ADMIN_API_TOKEN is not set.
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

/** Invalidates the in-memory product cache (call after a manual rescrape) */
function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = { getInStockProducts, checkHandles, invalidateCache, isConfigured };
