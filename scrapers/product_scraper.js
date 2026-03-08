/**
 * Module 3 — Anne Klein Product Catalog Scraper
 * Uses Shopify's public JSON API (/collections/[handle]/products.json)
 * to reliably extract the full product catalog without needing JS rendering.
 * Saves to /data/product_catalog.json — used by ALL other modules.
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/product_scraper.log');
const OUTPUT_FILE = path.join(__dirname, '../data/product_catalog.json');
const BASE_URL = 'https://www.anneklein.com';

// Collections discovered from live site nav scrape
const COLLECTIONS = [
  { handle: 'new', category: 'New Arrivals' },
  { handle: 'clothing', category: 'Clothing' },
  { handle: 'dresses', category: 'Dresses & Jumpsuits' },
  { handle: 'blazers-jackets', category: 'Blazers & Jackets' },
  { handle: 'tops', category: 'Tops' },
  { handle: 'pants', category: 'Bottoms' },
  { handle: 'sweaters', category: 'Sweaters' },
  { handle: 'outerwear', category: 'Outerwear' },
  { handle: 'plus-sizes', category: 'Plus Size' },
  { handle: 'petite', category: 'Petite' },
  { handle: 'shoes', category: 'Shoes' },
  { handle: 'boots', category: 'Boots' },
  { handle: 'heels', category: 'Heels' },
  { handle: 'flats', category: 'Flats & Loafers' },
  { handle: 'sandals-slides', category: 'Sandals & Slides' },
  { handle: 'wedges', category: 'Wedges' },
  { handle: 'handbags-1', category: 'Handbags' },
  { handle: 'jewelry', category: 'Jewelry' },
  { handle: 'best-seller-jewelry', category: 'Jewelry Best Sellers' },
  { handle: 'executive-collection', category: 'Executive Collection' },
  { handle: 'fall-25-campaign', category: 'Fall Campaign Collection' },
  { handle: 'powerful-prints', category: 'Powerful Prints' },
  { handle: 'consider-it', category: 'Sustainable' },
];

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function ensureDirs() {
  [
    path.join(__dirname, '../data'),
    path.join(__dirname, '../logs'),
  ].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all products from a Shopify collection using the paginated JSON API.
 * Shopify returns max 250 products per page.
 */
async function fetchCollectionProducts(handle, category) {
  const products = [];
  let page = 1;
  const limit = 250;

  while (true) {
    const url = `${BASE_URL}/collections/${handle}/products.json?limit=${limit}&page=${page}`;
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'application/json',
        },
        timeout: 15000,
      });

      const items = response.data?.products || [];
      if (items.length === 0) break;

      items.forEach(product => {
        const firstVariant = product.variants?.[0] || {};
        const compareAtPrice = firstVariant.compare_at_price;
        const price = firstVariant.price;

        products.push({
          id: String(product.id),
          name: product.title,
          handle: product.handle,
          href: `${BASE_URL}/products/${product.handle}`,
          category,
          subcategory: handle,
          price: price ? `$${parseFloat(price).toFixed(2)}` : '',
          originalPrice: compareAtPrice ? `$${parseFloat(compareAtPrice).toFixed(2)}` : '',
          onSale: !!(compareAtPrice && parseFloat(compareAtPrice) > parseFloat(price)),
          description: product.body_html
            ? product.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500)
            : '',
          productType: product.product_type || '',
          tags: product.tags || [],
          vendor: product.vendor || 'Anne Klein',
          variantCount: product.variants?.length || 1,
          colors: [
            ...new Set(
              (product.options || [])
                .filter(o => /color|colour/i.test(o.name))
                .flatMap(o => o.values)
            ),
          ],
          sizes: [
            ...new Set(
              (product.options || [])
                .filter(o => /size/i.test(o.name))
                .flatMap(o => o.values)
            ),
          ],
          image: product.images?.[0]?.src || '',
          publishedAt: product.published_at || '',
        });
      });

      log(`  ${category} page ${page}: ${items.length} products`);
      if (items.length < limit) break;
      page++;
      await sleep(300); // Be polite to the server
    } catch (err) {
      if (err.response?.status === 404) {
        log(`  ${category}: collection not found (404) — skipping`);
      } else {
        log(`  ${category} ERROR: ${err.message}`);
      }
      break;
    }
  }

  return products;
}

async function run() {
  ensureDirs();
  log('=== Product Catalog Scraper Started (Shopify JSON API) ===');

  // Map: product ID → { product, allCategories[] }
  // We collect ALL categories a product belongs to, then assign the most specific one.
  // "New Arrivals" is a cross-category editorial slice and should never override a
  // real category like Clothing, Shoes, etc.
  const GENERIC_CATEGORIES = new Set(['New Arrivals', 'Fall Campaign Collection', 'Powerful Prints', 'Sustainable']);

  const allProducts = new Map();

  for (const collection of COLLECTIONS) {
    const products = await fetchCollectionProducts(collection.handle, collection.category);
    products.forEach(p => {
      if (!allProducts.has(p.id)) {
        allProducts.set(p.id, { product: p, allCategories: [p.category] });
      } else {
        // Accumulate every category this product appears in
        const entry = allProducts.get(p.id);
        if (!entry.allCategories.includes(p.category)) {
          entry.allCategories.push(p.category);
        }
      }
    });
    log(`  Total unique so far: ${allProducts.size}`);
  }

  // Assign primary category: prefer specific over generic.
  // Preserve isNewArrival flag so dashboards can still filter on it.
  const productsArray = [...allProducts.values()].map(({ product, allCategories }) => {
    const specific = allCategories.filter(c => !GENERIC_CATEGORIES.has(c));
    product.category = specific.length > 0 ? specific[0] : allCategories[0];
    product.isNewArrival = allCategories.includes('New Arrivals');
    product.allCategories = allCategories;
    return product;
  });

  // --- Category counts ---
  const categoryCounts = {};
  productsArray.forEach(p => {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  });

  // --- Price range stats ---
  const prices = productsArray
    .map(p => parseFloat((p.price || '$0').replace('$', '').replace(',', '')))
    .filter(n => n > 0);

  const priceStats = prices.length
    ? {
        min: `$${Math.min(...prices).toFixed(2)}`,
        max: `$${Math.max(...prices).toFixed(2)}`,
        avg: `$${(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)}`,
        count: prices.length,
      }
    : {};

  // --- Top product types ---
  const typeCounts = {};
  productsArray.forEach(p => {
    if (p.productType) typeCounts[p.productType] = (typeCounts[p.productType] || 0) + 1;
  });

  const catalog = {
    generatedAt: new Date().toISOString(),
    source: BASE_URL,
    platform: 'Shopify',
    totalProducts: productsArray.length,
    categoryCounts,
    priceStats,
    topProductTypes: Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([type, count]) => ({ type, count })),
    products: productsArray,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2));
  log(`=== Done. ${catalog.totalProducts} products saved to ${OUTPUT_FILE} ===`);
  log(`Category breakdown: ${JSON.stringify(categoryCounts)}`);

  return catalog;
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
