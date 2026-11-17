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
const MAX_CHILD_SITEMAPS_FULL = 30;     // full-taxonomy walk opens every category file
const MAX_URLS_FULL = 60000;            // hard ceiling on a full walk
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

// The same chrome in Japanese. CJK has no word boundaries and these phrases are
// rarely part of a merchandising name, so a contains test is used rather than
// an exact match: it also catches variants such as "店舗検索" or "会員登録はこちら".
const NON_CATEGORY_JA = /(カート|買い物かご|ログイン|ログアウト|会員登録|新規登録|マイページ|お気に入り|お問い?合わせ|会社概要|企業情報|プライバシー|個人情報|利用規約|ご利用ガイド|サイトマップ|特定商取引|ヘルプ|よくある(ご)?質問|店舗|採用|検索|配送|送料|返品)/;

// Scripts with no letter case and no ASCII slug form. When a site's slugs are
// written in these, numeric IDs are often the only stable path segment.
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/;

function isNonCategory(name) {
  return NON_CATEGORY.test(name) || NON_CATEGORY_JA.test(name);
}

/** Percent-decode a URL segment. Malformed escapes keep the raw text. */
function safeDecode(seg) {
  try { return decodeURIComponent(seg); } catch { return seg; }
}

/**
 * A sensible length gate for a category name. Counts code points, not UTF-16
 * units, and allows a single CJK character ("本", "靴") since one ideograph
 * carries a whole word. The upper bound is the same in characters for every
 * script, which is generous for CJK where names are short.
 */
function nameLengthOk(name, max) {
  const len = [...name].length;
  const min = CJK.test(name) ? 1 : 2;
  return len >= min && len < max;
}

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
  // NFKC folds full-width Latin and half-width katakana to their standard
  // forms. toLowerCase is a no-op on CJK, so it is safe for every script.
  return safeDecode(slug).normalize('NFKC')
    .replace(/\.(html?|php|aspx)$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

/** Same-site URLs as decoded path segment arrays. Hosts compare without www. */
function pathsFromLocs(locs, baseUrl, limit = Infinity) {
  const bareHost = h => h.replace(/^www\./i, '').toLowerCase();
  const baseHost = bareHost(new URL(baseUrl).hostname);
  const origin = new URL(baseUrl).origin;
  const out = [];
  for (const u of locs.slice(0, limit)) {
    try {
      const parsed = new URL(u, origin);
      const host = bareHost(parsed.hostname);
      if (host !== baseHost && !host.endsWith('.' + baseHost)) continue;
      const segs = parsed.pathname.split('/').filter(Boolean).map(safeDecode);
      if (segs.length) out.push(segs);
    } catch { /* skip unparseable */ }
  }
  return out;
}

/**
 * Whether numeric-ID slugs should be kept rather than discarded. True when the
 * site writes its names in a CJK script, or when most leaf slugs are IDs. In
 * either case discarding IDs throws away most of the taxonomy (a Japanese shop
 * at /category/1234 has nothing else to go on).
 */
function shouldKeepIdSlugs(paths) {
  const leaves = [...new Set(paths.map(p => p[p.length - 1]))];
  if (leaves.length === 0) return false;
  const anyCjk = paths.some(p => p.some(seg => CJK.test(seg)));
  const idShare = leaves.filter(sl => LOOKS_LIKE_ID.test(sl)).length / leaves.length;
  return anyCjk || idShare > 0.5;
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

  const result = categoriesFromLocs(locs, baseUrl);
  if (!result) return null;
  log(`  sitemap: ${locs.length} URLs -> ${result.topLevelSections.length} top-level sections, ${result.featuredCategories.length} categories${result.idSlugs ? ' (ID slugs kept)' : ''}`);
  const { source, idSlugs, ...rest } = result;
  return { ...rest, sitemapUrl: found.url, source, idSlugs };
}

/**
 * Pure parse step behind fetchCategoriesFromSitemap: sitemap <loc> URLs in,
 * ranked category names out. No network, so it is testable from fixtures.
 *
 * @returns {null|{featuredCategories:string[], topLevelSections:string[],
 *   categoryUrlCount:number, source:'sitemap', idSlugs:boolean}}
 */
function categoriesFromLocs(locs, baseUrl) {
  if (!locs || locs.length === 0) return null;
  const allSegs = pathsFromLocs(locs, baseUrl);
  if (allSegs.length === 0) return null;
  const keepIds = shouldKeepIdSlugs(allSegs);

  // Top-level sections: the first segment that carries meaning. Retailers wrap
  // their taxonomy in a routing prefix (Kmart uses /category/, Target /c/,
  // Shopify /collections/) and locale prefixes stack on top of that. Taking
  // segment[0] blindly yields a "taxonomy" of the single word "category".
  const LOCALE = /^([a-z]{2}([-_][a-z]{2})?|en|au|us|uk|nz|ja|jp)$/i;
  const CONTAINER = /^(c|cat|categor(y|ies)|collections?|dept|departments?|shop|shopping|browse|store|range|ranges|product-category|genre|b|g|l)$/i;
  const firstMeaningful = segs => {
    for (const seg of segs) {
      if (LOCALE.test(seg) || CONTAINER.test(seg)) continue;
      return seg;
    }
    return null;
  };
  const topLevel = [...new Set(allSegs.map(firstMeaningful).filter(Boolean))]
    .filter(s => !isNonCategory(s) && !isNonCategory(slugToName(s)))
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
  const nameDepth = new Map();
  const leaves = [...depthOf.keys()]
    .filter(sl => !isNonCategory(sl) && !isNonCategory(slugToName(sl)))
    .filter(sl => keepIds || !LOOKS_LIKE_ID.test(slugToName(sl)))
    .sort((a, b) => (depthOf.get(a) - depthOf.get(b)) || (freqOf.get(b) - freqOf.get(a)) || a.localeCompare(b))
    .map(sl => {
      const name = slugToName(sl);
      if (!nameDepth.has(name)) nameDepth.set(name, depthOf.get(sl));
      return name;
    })
    .filter(n => nameLengthOk(n, 45));

  // Lead with the structural sections, then fill the remaining slots with leaves.
  //
  // Take an even sample of the deep leaves rather than the first N. Within a depth
  // band the order is alphabetical, so slicing the head returns only the start of
  // the alphabet: Kmart's toy categories came back as action figures, action toys,
  // activity games, adult lego, air hockey, which then became the entire assortment
  // gap list. An even sample gives the model a view of the whole taxonomy.
  const structural = leaves.filter(n => (nameDepth.get(n) || 99) <= 2);
  const deep = leaves.filter(n => !structural.includes(n));
  const slots = Math.max(0, MAX_CATEGORIES - new Set([...topLevel, ...structural]).size);
  const step = deep.length > slots && slots > 0 ? deep.length / slots : 1;
  const sampledDeep = slots > 0
    ? Array.from({ length: Math.min(slots, deep.length) }, (_, i) => deep[Math.floor(i * step)])
    : [];
  const featuredCategories = [...new Set([...topLevel, ...structural, ...sampledDeep])].slice(0, MAX_CATEGORIES);
  if (featuredCategories.length === 0) return null;

  return {
    featuredCategories,
    topLevelSections: topLevel.slice(0, MAX_CATEGORIES),
    categoryUrlCount: locs.length,
    source: 'sitemap',
    // Tells the caller these names may be bare IDs that want a better label
    // (breadcrumb, page title) from another source.
    idSlugs: keepIds,
  };
}

/**
 * Pure parse step behind fetchFullTaxonomy. Paths are percent-decoded.
 * @returns {null|{paths:string[][], leaves:string[], urlCount:number, idSlugs:boolean}}
 */
function fullTaxonomyFromLocs(locs, baseUrl) {
  if (!locs || locs.length === 0) return null;
  const paths = pathsFromLocs(locs, baseUrl, MAX_URLS_FULL);
  if (paths.length === 0) return null;
  const keepIds = shouldKeepIdSlugs(paths);
  const leaves = [...new Set(paths.map(p => p[p.length - 1]))]
    .filter(sl => !isNonCategory(sl) && !isNonCategory(slugToName(sl)))
    .filter(sl => keepIds || !LOOKS_LIKE_ID.test(slugToName(sl)))
    .map(slugToName)
    .filter(n => nameLengthOk(n, 60));
  return { paths, leaves: [...new Set(leaves)], urlCount: paths.length, idSlugs: keepIds };
}

/**
 * Every category path a site publishes, uncapped.
 *
 * fetchCategoriesFromSitemap returns a capped, ranked list for prompts that only
 * need a flavour of the taxonomy. Assortment gap analysis is different: a gap you
 * did not sample is a gap you cannot report, so it needs the whole tree. These are
 * a few thousand short strings per retailer, which is cheap next to the cost of
 * being wrong.
 *
 * @returns {Promise<null|{paths:string[][], leaves:string[], urlCount:number}>}
 */
async function fetchFullTaxonomy(baseUrl, log = () => {}) {
  let found;
  try { found = await locateSitemap(baseUrl); } catch { return null; }
  if (!found) return null;

  let locs = extractLocs(found.xml);
  if (/<sitemapindex/i.test(found.xml)) {
    const children = rankChildren(locs).slice(0, MAX_CHILD_SITEMAPS_FULL);
    const collected = [];
    for (const child of children) {
      if (collected.length >= MAX_URLS_FULL) break;
      const childXml = await fetchText(child);
      if (childXml) collected.push(...extractLocs(childXml));
    }
    locs = collected;
  }
  if (locs.length === 0) return null;

  const result = fullTaxonomyFromLocs(locs, baseUrl);
  if (!result) return null;
  log(`  full taxonomy: ${result.paths.length} paths, ${result.leaves.length} distinct categories${result.idSlugs ? ' (ID slugs kept)' : ''}`);
  return result;
}

module.exports = {
  fetchCategoriesFromSitemap,
  fetchFullTaxonomy,
  // Pure helpers, exported for offline tests.
  categoriesFromLocs,
  fullTaxonomyFromLocs,
  slugToName,
  isNonCategory,
};
