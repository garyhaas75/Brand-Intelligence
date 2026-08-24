/**
 * Category taxonomy from sitemaps — no browser, no proxy, no Apify credits.
 *
 * Most retailers publish their category structure in a sitemap because they want
 * search engines to index it. That makes it reachable with a plain HTTP GET even
 * on sites whose pages are hard-blocked to automation: kmart.com.au returns
 * nothing to a residential-proxy browser after ~3 minutes, but hands over 2,234
 * category URLs here in under a second.
 *
 * Two deliberate choices:
 *   - No User-Agent spoofing. An honest crawler request outperforms a fake
 *     browser one; Kmart returns 200 to the former and 403 to the latter.
 *   - Category names come from URL slugs, which are cleaner than scraped nav
 *     text (no "Sign In" / "Cart" / "Wishlist" noise to filter out).
 */

const FETCH_TIMEOUT_MS = 20 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;      // don't swallow a giant product sitemap
const MAX_CHILD_SITEMAPS = 4;           // enough to find the category file
const MAX_CATEGORIES = 60;              // what we hand the model

// Child sitemaps worth opening, best first. Product sitemaps are deliberately
// excluded — thousands of SKU URLs tell us nothing about category structure.
const CHILD_PRIORITY = [/categor/i, /collection/i, /department/i, /shop/i, /page/i, /content/i];
const CHILD_EXCLUDE = [/product/i, /storelocation/i, /store-/i, /blog/i, /article/i, /review/i];

const CANDIDATE_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap/sitemap.xml'];

// Internal identifiers that leak into sitemap URLs, such as Target's "w1045680".
// A category name is words, not a serial number.
const LOOKS_LIKE_ID = /^[a-z]{0,3}\d{3,}[a-z0-9]*$/i;

// Slugs that are navigation chrome or legal boilerplate, not merchandising.
const NON_CATEGORY = /^(home|index|search|cart|bag|account|login|sign-?in|register|wishlist|checkout|contact|about|help|faq|terms|privacy|returns|shipping|careers|sitemap|store-?locator|gift-?card)s?$/i;

async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return null;
    const text = await res.text();
    return text.length > MAX_BYTES ? null : text;
  } catch {
    return null;
  }
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decodeEntities(m[1]));
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function slugToName(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\.(html?|php|aspx)$/i, '').trim().toLowerCase();
}

/** Rank child sitemaps so the category file is opened first and products never. */
function rankChildren(urls) {
  return urls
    .filter(u => !CHILD_EXCLUDE.some(rx => rx.test(u)))
    .map(u => {
      const idx = CHILD_PRIORITY.findIndex(rx => rx.test(u));
      return { url: u, rank: idx === -1 ? CHILD_PRIORITY.length : idx };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(x => x.url);
}

/** Find a reachable sitemap: robots.txt first, then the usual paths. */
async function locateSitemap(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const robots = await fetchText(origin + '/robots.txt');
  const fromRobots = robots
    ? robots.split('\n').filter(l => /^\s*sitemap:/i.test(l)).map(l => l.replace(/^\s*sitemap:\s*/i, '').trim())
    : [];
  for (const candidate of [...fromRobots, ...CANDIDATE_PATHS.map(p => origin + p)]) {
    const xml = await fetchText(candidate);
    if (xml && xml.includes('<loc>')) return { url: candidate, xml };
  }
  return null;
}

/**
 * @returns {Promise<null|{featuredCategories:string[], topLevelSections:string[],
 *   categoryUrlCount:number, sitemapUrl:string, source:'sitemap'}>}
 */
async function fetchCategoriesFromSitemap(baseUrl, log = () => {}) {
  let found;
  try {
    found = await locateSitemap(baseUrl);
  } catch {
    return null;
  }
  if (!found) return null;

  let locs = extractLocs(found.xml);

  // A sitemap index lists other sitemaps rather than pages — walk into it.
  if (/<sitemapindex/i.test(found.xml)) {
    const children = rankChildren(locs).slice(0, MAX_CHILD_SITEMAPS);
    const collected = [];
    for (const child of children) {
      const childXml = await fetchText(child);
      if (!childXml) continue;
      const childLocs = extractLocs(childXml);
      collected.push(...childLocs);
      // A category file is the jackpot; no need to keep opening siblings.
      if (/categor|collection|department/i.test(child) && childLocs.length > 0) break;
    }
    locs = collected;
  }
  if (locs.length === 0) return null;

  const origin = new URL(baseUrl).origin;
  // Compare on registrable host, not exact origin: www.toysrus.com.au redirects to
  // toysrus.com.au, so every URL in its sitemap lives on a different origin than
  // the one we were handed. An exact match discards the entire sitemap.
  const bareHost = h => h.replace(/^www\./i, '').toLowerCase();
  const baseHost = bareHost(new URL(baseUrl).hostname);
  const segmentsOf = u => {
    try {
      const parsed = new URL(u, origin);
      const host = bareHost(parsed.hostname);
      if (host !== baseHost && !host.endsWith('.' + baseHost)) return null;
      return parsed.pathname.split('/').filter(Boolean);
    } catch { return null; }
  };

  const allSegs = locs.map(segmentsOf).filter(Boolean).filter(s => s.length > 0);
  if (allSegs.length === 0) return null;

  // Top-level sections: the first segment that carries meaning. Retailers wrap
  // their taxonomy in a routing prefix — Kmart uses /category/, Target /c/,
  // Shopify /collections/ — and locale prefixes stack on top of that. Taking
  // segment[0] blindly yields a "taxonomy" of the single word "category".
  const LOCALE = /^([a-z]{2}([-_][a-z]{2})?|en|au|us|uk|nz)$/i;
  const CONTAINER = /^(c|cat|categor(y|ies)|collections?|dept|departments?|shop|shopping|browse|store|range|ranges|product-category|b|g|l)$/i;
  const firstMeaningful = segs => {
    for (const seg of segs) {
      if (LOCALE.test(seg) || CONTAINER.test(seg)) continue;
      return seg;
    }
    return null;
  };
  const topLevel = [...new Set(allSegs.map(firstMeaningful).filter(Boolean))]
    .filter(s => !NON_CATEGORY.test(s))
    .map(slugToName)
    .filter(Boolean);

  // Leaf categories, most specific segment of each path.
  //
  // Order matters as much as the filter. Sitemaps list URLs alphabetically, so
  // taking the first N leaves yields a taxonomy that stops at the letter "a":
  // Kmart produced action figures, action toys, activity games, adult lego, air
  // hockey and nothing else, from 2,248 URLs. Rank by path depth instead, so the
  // shallow structural categories a merchandiser cares about outrank deep niche
  // ones, and break ties by how often a segment appears.
  const depthOf = new Map();
  const freqOf = new Map();
  for (const segs of allSegs) {
    const leaf = segs[segs.length - 1];
    if (!depthOf.has(leaf) || segs.length < depthOf.get(leaf)) depthOf.set(leaf, segs.length);
    freqOf.set(leaf, (freqOf.get(leaf) || 0) + 1);
  }
  const leaves = [...depthOf.keys()]
    .filter(sl => !NON_CATEGORY.test(sl))
    .sort((a, b) => (depthOf.get(a) - depthOf.get(b)) || (freqOf.get(b) - freqOf.get(a)) || a.localeCompare(b))
    .map(slugToName)
    .filter(n => n.length > 1 && n.length < 45 && !LOOKS_LIKE_ID.test(n));

  // Lead with the structural sections, then fill the remaining slots with leaves.
  //
  // Take an even sample of the deep leaves rather than the first N. Within a depth
  // band the order is alphabetical, so slicing the head returns only the start of
  // the alphabet: Kmart's toy categories came back as action figures, action toys,
  // activity games, adult lego, air hockey, which then became the entire assortment
  // gap list. An even sample gives the model a view of the whole taxonomy.
  const structural = leaves.filter(n => (depthOf.get(n.replace(/ /g, '-')) || 99) <= 2);
  const deep = leaves.filter(n => !structural.includes(n));
  const slots = Math.max(0, MAX_CATEGORIES - new Set([...topLevel, ...structural]).size);
  const step = deep.length > slots && slots > 0 ? deep.length / slots : 1;
  const sampledDeep = slots > 0
    ? Array.from({ length: Math.min(slots, deep.length) }, (_, i) => deep[Math.floor(i * step)])
    : [];
  const featuredCategories = [...new Set([...topLevel, ...structural, ...sampledDeep])].slice(0, MAX_CATEGORIES);
  if (featuredCategories.length === 0) return null;

  log(`  sitemap: ${locs.length} URLs -> ${topLevel.length} top-level sections, ${featuredCategories.length} categories`);
  return {
    featuredCategories,
    topLevelSections: topLevel.slice(0, MAX_CATEGORIES),
    categoryUrlCount: locs.length,
    sitemapUrl: found.url,
    source: 'sitemap',
  };
}

module.exports = { fetchCategoriesFromSitemap };
