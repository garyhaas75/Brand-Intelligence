/**
 * Price Intelligence — Promotion & Markdown Tracker
 * Tracks Anne Klein sale events over time and competitor promo cadence.
 *
 * AK data: free — uses Shopify JSON API directly, no Apify.
 * Competitor promos: extracted from site_intelligence.json banner data.
 *
 * On each run:
 *   1. Fetches current AK product prices from Shopify
 *   2. Diffs against previous snapshot to find new sales, ended sales, price changes
 *   3. Extracts competitor promo banners from latest site scrape
 *   4. Appends to sale rate history (trend data)
 *   5. Archives previous output, saves new to /data/price_intelligence.json
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { archive, getHistory } = require('../utils/archive');

const LOG_FILE      = path.join(__dirname, '../logs/price_tracker.log');
const OUTPUT_FILE   = path.join(__dirname, '../data/price_intelligence.json');
const SITE_INTEL    = path.join(__dirname, '../data/site_intelligence.json');
const AK_BASE       = 'https://www.anneklein.com';

// Collections to sample — these cover the full AK catalog
const AK_COLLECTIONS = ['new-arrivals', 'clothing', 'shoes', 'handbags', 'jewelry'];

// Promo keyword patterns to extract from competitor banners
const PROMO_RE = /(\d+)%?\s*off|free\s+ship|buy\s+\d+|sitewide|clearance|extra\s+\d+%|up\s+to\s+\d+%/i;
const DISCOUNT_RE = /(\d+)%\s*off/gi;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function ensureDirs() {
  [path.join(__dirname, '../data'), path.join(__dirname, '../logs')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

async function fetchAKProducts() {
  const products = [];
  const seen = new Set();

  for (const handle of AK_COLLECTIONS) {
    try {
      let page = 1;
      while (page <= 5) {
        const url = `${AK_BASE}/collections/${handle}/products.json?limit=250&page=${page}`;
        const res = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const batch = res.data?.products || [];
        if (!batch.length) break;

        batch.forEach(p => {
          if (seen.has(p.id)) return;
          seen.add(p.id);
          const variant = p.variants?.[0];
          if (!variant) return;
          const price = parseFloat(variant.price) || 0;
          const compareAt = parseFloat(variant.compare_at_price) || 0;
          const onSale = !!(compareAt && compareAt > price);
          products.push({
            id: p.id,
            handle: p.handle,
            title: p.title,
            collection: handle,
            price,
            compareAtPrice: compareAt || null,
            onSale,
            saleDepth: onSale ? Math.round((1 - price / compareAt) * 100) : 0,
          });
        });

        if (batch.length < 250) break;
        page++;
      }
      log(`  ${handle}: ${products.filter(p => p.collection === handle).length} products`);
    } catch (err) {
      log(`  Error fetching ${handle}: ${err.message}`);
    }
  }
  return products;
}

function diffPrices(current, previous) {
  if (!previous || !previous.length) {
    return { newSaleItems: [], endedSaleItems: [], priceChanges: [], note: 'First run — no previous snapshot to compare' };
  }
  const prevMap = {};
  previous.forEach(p => { prevMap[p.id] = p; });

  const newSaleItems = [];
  const endedSaleItems = [];
  const priceChanges = [];

  current.forEach(p => {
    const prev = prevMap[p.id];
    if (!prev) return;
    if (p.onSale && !prev.onSale) {
      newSaleItems.push({ id: p.id, title: p.title, collection: p.collection, price: p.price, compareAtPrice: p.compareAtPrice, saleDepth: p.saleDepth });
    } else if (!p.onSale && prev.onSale) {
      endedSaleItems.push({ id: p.id, title: p.title, collection: p.collection, price: p.price, prevPrice: prev.price });
    } else if (Math.abs(p.price - prev.price) >= 1) {
      priceChanges.push({ id: p.id, title: p.title, collection: p.collection, price: p.price, prevPrice: prev.price, delta: Math.round(p.price - prev.price) });
    }
  });

  return { newSaleItems, endedSaleItems, priceChanges };
}

function extractCompetitorPromos(siteIntel) {
  if (!siteIntel?.brands) return [];
  return siteIntel.brands.map(b => {
    const allBanners = b.promoBanners || [];
    const promoBanners = allBanners.filter(p => PROMO_RE.test(p));

    // Extract all discount percentages mentioned
    const discounts = [];
    promoBanners.forEach(banner => {
      let m;
      const re = new RegExp(DISCOUNT_RE.source, 'gi');
      while ((m = re.exec(banner)) !== null) {
        discounts.push(parseInt(m[1]));
      }
    });
    const maxDiscount = discounts.length ? Math.max(...discounts) : null;

    return {
      brand: b.name,
      scrapedAt: b.scrapedAt,
      hasPromo: promoBanners.length > 0,
      promoBanners,
      allBanners,
      maxDiscount,
      discounts: [...new Set(discounts)].sort((a, b) => b - a),
    };
  });
}

async function run() {
  ensureDirs();
  log('=== Price Tracker Started ===');

  // Archive previous output before overwriting
  if (fs.existsSync(OUTPUT_FILE)) {
    const dest = archive(OUTPUT_FILE);
    if (dest) log(`  Archived previous output`);
  }

  // Load previous AK product snapshot from history for diff
  const history = getHistory('price_intelligence', 60);
  const lastSnapshot = history.length > 0 ? history[0].data?.akProducts : null;
  log(`  History: ${history.length} previous snapshots found`);

  // Build sale rate history from all snapshots
  const saleRateHistory = history
    .filter(h => h.data?.akSaleRate !== undefined)
    .map(h => ({ date: h.date, rate: h.data.akSaleRate, onSale: h.data.akOnSaleCount, total: h.data.akProductsTracked }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Fetch current AK product prices
  log('Fetching AK products from Shopify API...');
  const currentProducts = await fetchAKProducts();
  log(`  Total unique products: ${currentProducts.length}`);

  if (!currentProducts.length) {
    log('ERROR: No products returned. Aborting.');
    process.exit(1);
  }

  const onSaleNow = currentProducts.filter(p => p.onSale);
  const akSaleRate = Math.round(onSaleNow.length / currentProducts.length * 100);
  const avgSaleDepth = onSaleNow.length
    ? Math.round(onSaleNow.reduce((s, p) => s + p.saleDepth, 0) / onSaleNow.length)
    : 0;

  // Category-level sale breakdown
  const catMap = {};
  currentProducts.forEach(p => {
    if (!catMap[p.collection]) catMap[p.collection] = { total: 0, onSale: 0, depths: [] };
    catMap[p.collection].total++;
    if (p.onSale) { catMap[p.collection].onSale++; catMap[p.collection].depths.push(p.saleDepth); }
  });
  const categorySaleRates = Object.entries(catMap).map(([cat, d]) => ({
    category: cat,
    total: d.total,
    onSale: d.onSale,
    rate: Math.round(d.onSale / d.total * 100),
    avgDepth: d.depths.length ? Math.round(d.depths.reduce((a, b) => a + b, 0) / d.depths.length) : 0,
  })).sort((a, b) => b.rate - a.rate);

  // Diff against last snapshot
  log('Comparing against previous snapshot...');
  const diff = diffPrices(currentProducts, lastSnapshot);
  log(`  New sales: ${diff.newSaleItems?.length || 0}, ended: ${diff.endedSaleItems?.length || 0}, price changes: ${diff.priceChanges?.length || 0}`);

  // Extract competitor promos from site intel banners
  const siteIntel = fs.existsSync(SITE_INTEL) ? JSON.parse(fs.readFileSync(SITE_INTEL, 'utf8')) : null;
  const competitorPromos = extractCompetitorPromos(siteIntel);
  const activePromos = competitorPromos.filter(p => p.hasPromo);
  log(`  Competitor promos detected: ${activePromos.length} brands active`);

  // Add today to sale rate history
  const today = new Date().toISOString().split('T')[0];
  const updatedHistory = [
    ...saleRateHistory.filter(h => h.date !== today),
    { date: today, rate: akSaleRate, onSale: onSaleNow.length, total: currentProducts.length },
  ].sort((a, b) => a.date.localeCompare(b.date));

  const output = {
    generatedAt: new Date().toISOString(),
    akSaleRate,
    akAvgSaleDepth: avgSaleDepth,
    akProductsTracked: currentProducts.length,
    akOnSaleCount: onSaleNow.length,
    categorySaleRates,
    changes: diff,
    competitorPromos,
    saleRateHistory: updatedHistory,
    // Compact snapshot for next diff — just ids + prices
    akProducts: currentProducts.map(p => ({
      id: p.id, title: p.title, price: p.price,
      compareAtPrice: p.compareAtPrice, onSale: p.onSale, saleDepth: p.saleDepth,
      collection: p.collection,
    })),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log('\n========================================');
  console.log('PRICE TRACKER COMPLETE');
  console.log('========================================');
  console.log(`AK Sale Rate: ${akSaleRate}% (${onSaleNow.length}/${currentProducts.length} products)`);
  console.log(`Avg Discount: ${avgSaleDepth}% off when on sale`);
  if (diff.newSaleItems?.length) console.log(`  NEW sales: ${diff.newSaleItems.length} items just went on sale`);
  if (diff.endedSaleItems?.length) console.log(`  ENDED: ${diff.endedSaleItems.length} items came off sale`);
  console.log('\nCompetitor promos:');
  competitorPromos.forEach(p => {
    const label = p.hasPromo ? `${p.maxDiscount ? p.maxDiscount + '% off' : 'promo active'} (${p.promoBanners.length} banners)` : 'no active promo';
    console.log(`  ${p.brand}: ${label}`);
  });
  log('=== Done ===');
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
