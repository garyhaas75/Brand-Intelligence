/**
 * Japan toy marketplace intelligence: what sells, at what price, with what reviews.
 *
 * Sources: Rakuten Ichiba (JSON-LD ItemList / Product / Offer / AggregateRating, plus the
 * optional official Ichiba Ranking API) and Amazon.co.jp (best sellers and browse pages).
 * Output follows the shared contract at data/brands/<slug>/marketplace.json:
 *   { generatedAt, market:"JP", sources, categories:[{source,category,url,topItems:[...]}],
 *     brandMix:[{brand,count}], reviews:[{source,productTitle,rating,text,lang}] }
 * Extra diagnostic fields (blocked, reviewStatus, notes) are additive; consumers ignore them.
 *
 * Politeness: one browser, one context, one page, a fixed delay between requests and a
 * hard page cap. A captcha, robot check or access denial is recorded as blocked and never
 * retried. A temporary refusal (overload page, 429, 503, timeout) gets exactly one delayed
 * retry later in the same run, then is recorded as status "retryable_block".
 *
 * Resume: units are checkpointed via utils/checkpoint.js (step "marketplace") and a unit that
 * fails now but has good data in the previous marketplace.json is carried forward, stale.
 *
 * Optional keys (all degrade softly when missing):
 *   RAKUTEN_APP_ID   official Ichiba Ranking API
 *   APIFY_API_TOKEN  generic Apify page fetch, only after a direct fetch was blocked
 *
 * Usage: node scrapers/marketplace_jp.js --slug=<brand-slug> [--dry-run]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const checkpoint = require('../utils/checkpoint');

let localeFor;
try {
  ({ localeFor } = require('./site_scraper'));
} catch (_) {
  localeFor = () => ({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.5' });
}

const DATA_DIR = path.join(__dirname, '../data');
const MAX_PAGES = 24;          // hard cap on page loads per run, categories plus reviews
const DELAY_MS = 2500;         // pause between page loads
const TOP_N = 30;              // items kept per category
const MAX_REVIEWS = 200;       // contract cap
const REVIEW_TEXT_CAP = 600;   // contract cap per review
const REVIEW_ITEMS_PER_SOURCE = 6;
const REVIEWS_PER_ITEM = 20;

const DEFAULT_CATEGORIES = [
  { source: 'rakuten', category: 'toys', url: 'https://www.rakuten.co.jp/category/toy/' },
  { source: 'rakuten', category: 'toys_ranking_daily', url: 'https://ranking.rakuten.co.jp/daily/566382/' },
  { source: 'amazon_jp', category: 'toys_bestsellers', url: 'https://www.amazon.co.jp/gp/bestsellers/toys/' },
  { source: 'amazon_jp', category: 'toys_browse', url: 'https://www.amazon.co.jp/toys-games/b?node=13299531' },
];

// Rakuten Ichiba Item Ranking API (official, needs a free applicationId):
//   GET https://app.rakuten.co.jp/services/api/IchibaItem/Ranking/20220601
//       ?applicationId=<RAKUTEN_APP_ID>&genreId=<genre>&format=json&formatVersion=2
// Response (formatVersion=2): { Items: [ { rank, itemName, itemPrice, reviewCount, reviewAverage,
// itemUrl, shopName } ] }. formatVersion=1 wraps each entry as { Item: {...} }; both are parsed.
// RAKUTEN_API_BASE overrides the endpoint if Rakuten moves it.
const RAKUTEN_RANKING_API = 'https://app.rakuten.co.jp/services/api/IchibaItem/Ranking/20220601';
const RAKUTEN_TOY_GENRE_ID = '566382';

// Generic Apify actor that returns raw page HTML. Used only after a direct fetch was blocked.
const APIFY_ACTOR = 'apify/cheerio-scraper';

// ---------------------------------------------------------------- text helpers

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}

function stripTags(s) {
  return decodeEntities(String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[,\s￥¥円]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function detectLang(text) {
  const t = String(text || '');
  if (/[぀-ヿ一-鿿]/.test(t)) return 'ja';
  if (/[a-z]/i.test(t)) return 'en';
  return 'und';
}

function capText(t) {
  const s = String(t || '').trim();
  return s.length > REVIEW_TEXT_CAP ? s.slice(0, REVIEW_TEXT_CAP) : s;
}

function htmlTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]) : '';
}

// ---------------------------------------------------------------- block detection

const BLOCK_PATTERNS = [
  { re: /validateCaptcha|captchacharacters|Robot Check|ロボットでないことを確認|api-services-support@amazon/i, reason: 'captcha' },
  { re: /アクセスが集中/, reason: 'overload_page' },
  { re: /cf-chl-|challenges\.cloudflare\.com|<title>\s*Just a moment|Attention Required!/i, reason: 'bot_challenge' },
  { re: /<title>\s*(Access Denied|403 Forbidden)/i, reason: 'access_denied' },
];

/** Returns { blocked:true, reason } for a captcha, challenge, login wall or error status, else null. */
function detectBlock({ html, status, url } = {}) {
  const h = String(html || '');
  for (const p of BLOCK_PATTERNS) if (p.re.test(h)) return { blocked: true, reason: p.reason };
  if (url && /\/ap\/signin|login\./i.test(url)) return { blocked: true, reason: 'login_required' };
  if (status === 403 || status === 429 || status === 503) return { blocked: true, reason: `http_${status}` };
  if (status && status >= 400) return { blocked: true, reason: `http_${status}` };
  if (!h.trim()) return { blocked: true, reason: 'empty_response' };
  return null;
}

// ---------------------------------------------------------------- JSON-LD

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let parsed;
    try { parsed = JSON.parse(m[1].trim()); } catch (_) { continue; }
    const stack = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of stack) {
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node['@graph'])) out.push(...node['@graph']);
      else out.push(node);
    }
  }
  return out;
}

function isType(node, t) {
  const ty = node && node['@type'];
  return Array.isArray(ty) ? ty.includes(t) : ty === t;
}

function brandName(b) {
  if (!b) return null;
  if (typeof b === 'string') return b.trim() || null;
  if (Array.isArray(b)) return brandName(b[0]);
  return (b.name && String(b.name).trim()) || null;
}

function offerPriceJPY(offers) {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of list) {
    if (!o) continue;
    const cur = o.priceCurrency || (o.priceSpecification && o.priceSpecification.priceCurrency);
    if (cur && String(cur).toUpperCase() !== 'JPY') continue;
    const p = toNumber(o.price ?? o.lowPrice ?? (o.priceSpecification && o.priceSpecification.price));
    if (p !== null) return p;
  }
  return null;
}

function productToItem(p, rank) {
  const agg = p.aggregateRating || {};
  const title = decodeEntities(String(p.name || '')).trim();
  return {
    rank,
    title,
    brand: brandName(p.brand) || guessBrandFromTitle(title),
    priceJPY: offerPriceJPY(p.offers),
    reviewCount: toNumber(agg.reviewCount ?? agg.ratingCount),
    rating: toNumber(agg.ratingValue),
    url: p.url || (p.offers && !Array.isArray(p.offers) && p.offers.url) || null,
  };
}

/** Rakuten (or any schema.org) ItemList of Products into contract topItems. */
function parseRakutenJsonLd(html, { limit = TOP_N } = {}) {
  const items = [];
  for (const node of extractJsonLd(html)) {
    if (!isType(node, 'ItemList') || !Array.isArray(node.itemListElement)) continue;
    node.itemListElement.forEach((el, i) => {
      const p = el && (el.item || el);
      if (!p || !p.name) return;
      items.push(productToItem(p, toNumber(el.position) || items.length + 1 || i + 1));
    });
  }
  items.sort((a, b) => a.rank - b.rank);
  return dedupeItems(items).slice(0, limit);
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter(it => {
    const k = (it.url || it.title || '').split('?')[0];
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Official Ichiba Ranking API response (formatVersion 1 or 2) into topItems. */
function parseRakutenApi(json, { limit = TOP_N } = {}) {
  const list = (json && (json.Items || json.items)) || [];
  return list.map((e, i) => {
    const it = e && e.Item ? e.Item : e || {};
    const title = decodeEntities(String(it.itemName || '')).trim();
    return {
      rank: toNumber(it.rank) || i + 1,
      title,
      brand: guessBrandFromTitle(title),
      priceJPY: toNumber(it.itemPrice),
      reviewCount: toNumber(it.reviewCount),
      rating: toNumber(it.reviewAverage),
      url: it.itemUrl || null,
    };
  }).filter(it => it.title).slice(0, limit);
}

// ---------------------------------------------------------------- Amazon list parsing

function parseYen(chunk) {
  const m = String(chunk).match(/[￥¥]\s*([\d,]+)/) || String(chunk).match(/JPY(?:&nbsp;|\s)*([\d,]+)/);
  return m ? toNumber(m[1]) : null;
}

function parseStarRating(chunk) {
  const s = decodeEntities(chunk);
  const m = s.match(/5つ星のうち\s*([\d.]+)/) || s.match(/星\s*5\s*つ中\s*([\d.]+)/) || s.match(/([\d.]+)\s*out of 5 stars/i);
  return m ? toNumber(m[1]) : null;
}

function parseAmazonCard(chunk, asin, fallbackRank) {
  const clamp = chunk.match(/<div[^>]*line-clamp[^>]*>([\s\S]*?)<\/div>/i);
  const alt = chunk.match(/<img[^>]*\salt="([^"]{4,})"/i);
  const h2 = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const title = stripTags((clamp && clamp[1]) || (h2 && h2[1]) || (alt && alt[1]) || '');
  const rankM = chunk.match(/zg-bdg-text[^>]*>\s*#?\s*(\d+)/);
  const s = decodeEntities(chunk);
  const revM = s.match(/([\d,]+)\s*件の(?:レーティング|評価|カスタマーレビュー)/)
    || s.match(/([\d,]+)\s*(?:ratings|reviews)/i)
    || chunk.match(/a-icon-alt[\s\S]{0,400}?<span[^>]*a-size-small[^>]*>\s*([\d,]+)\s*</);
  return {
    rank: rankM ? Number(rankM[1]) : fallbackRank,
    title,
    brand: guessBrandFromTitle(title),
    priceJPY: parseYen(chunk),
    reviewCount: revM ? toNumber(revM[1]) : null,
    rating: parseStarRating(chunk),
    url: `https://www.amazon.co.jp/dp/${asin}`,
  };
}

/**
 * Amazon.co.jp list or browse page into topItems. Cards are delimited by data-asin; pages
 * without data-asin (carousel browse pages) fall back to /dp/<ASIN> anchors. A product card
 * must carry a price or a rating, which drops nav promos and editorial tiles generically.
 */
function parseAmazonListHtml(html, { limit = TOP_N } = {}) {
  const h = String(html || '');
  let marks = [];
  const reAsin = /data-asin="([A-Z0-9]{10})"/g;
  let m;
  while ((m = reAsin.exec(h))) marks.push({ asin: m[1], at: m.index });
  if (!marks.length) {
    const reDp = /\/dp\/([A-Z0-9]{10})/g;
    const seenAt = new Set();
    while ((m = reDp.exec(h))) {
      if (seenAt.has(m[1])) continue;
      seenAt.add(m[1]);
      marks.push({ asin: m[1], at: Math.max(0, h.lastIndexOf('<a', m.index)) });
    }
  }
  const items = [];
  const seen = new Set();
  marks.forEach((mk, i) => {
    if (seen.has(mk.asin)) return;
    const end = i + 1 < marks.length ? marks[i + 1].at : mk.at + 8000;
    const chunk = h.slice(mk.at, end);
    const it = parseAmazonCard(chunk, mk.asin, items.length + 1);
    if (!it.title || (it.priceJPY === null && it.rating === null)) return;
    seen.add(mk.asin);
    items.push(it);
  });
  items.sort((a, b) => a.rank - b.rank);
  return items.slice(0, limit);
}

// ---------------------------------------------------------------- reviews

/** First element matching openRe (group 1 = tag name) with its balanced inner HTML, or null. */
function elementAt(html, openRe) {
  const m = String(html).match(openRe);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = m.index + m[0].length;
  let depth = 1, t;
  while ((t = re.exec(html))) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return { openTag: m[0], inner: html.slice(m.index + m[0].length, t.index) };
  }
  return { openTag: m[0], inner: html.slice(m.index + m[0].length) };
}

/** Country a review was written in, from the review date line ("...に日本でレビュー済み" / "Reviewed in X on ..."). */
function reviewedIn(block) {
  const d = String(block || '').match(/data-hook="review-date"[^>]*>([^<]*)</);
  if (!d) return null;
  const s = decodeEntities(d[1]).trim();
  const m = s.match(/日に\s*(.+?)\s*でレビュー済み/) || s.match(/Reviewed in (?:the )?(.+?) on /i);
  return m ? m[1].trim() : null;
}

// Japanese reviews are the evidence we want; Amazon.co.jp mixes in reviews from other Amazon
// sites (mostly English). Keep every Japanese review and only as many others as keep Japanese
// at or above minJaShare. When a source has no Japanese reviews at all, nothing is dropped:
// the other-language reviews are the only evidence and they keep their lang and reviewedIn.
const MIN_JA_SHARE = 0.7;
function balanceReviewLanguages(reviews, { minJaShare = MIN_JA_SHARE } = {}) {
  const list = Array.isArray(reviews) ? reviews : [];
  const ja = list.filter(r => r && r.lang === 'ja').length;
  if (!ja) return { reviews: list.slice(), ja: 0, other: list.length, dropped: 0 };
  const allowedOther = Math.floor((ja * (1 - minJaShare)) / minJaShare + 1e-9);
  let other = 0, dropped = 0;
  const kept = list.filter(r => {
    if (r && r.lang === 'ja') return true;
    if (other < allowedOther) { other++; return true; }
    dropped++;
    return false;
  });
  return { reviews: kept, ja, other, dropped };
}

/** Public on-page reviews from an Amazon.co.jp product page. */
function parseAmazonReviews(html, productTitle, { limit = REVIEWS_PER_ITEM } = {}) {
  const h = String(html || '');
  const title = productTitle || stripTags((h.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '') || htmlTitle(h);
  const starts = [];
  const re = /data-hook="review"[\s>]/g;
  let m;
  while ((m = re.exec(h))) starts.push(m.index);
  const out = [];
  const seen = new Set();
  starts.forEach((st, i) => {
    const block = h.slice(st, i + 1 < starts.length ? starts[i + 1] : st + 12000);
    const ratingM = block.match(/data-hook="(?:review-star-rating|cmps-review-star-rating)"[\s\S]{0,300}?a-icon-alt[^>]*>([^<]*)</);
    const rating = ratingM ? parseStarRating(ratingM[1]) : null;
    const bodyM = elementAt(block, /<(div|span)\b[^>]*data-hook="(?:reviewRichContentContainer|review-body)"([^>]*)>/);
    if (!bodyM) return;
    const text = capText(stripTags(bodyM.inner).replace(/\s+/g, ' '));
    if (!text || seen.has(text)) return;
    seen.add(text);
    const langAttr = (bodyM.openTag.match(/lang="([a-z]{2})/i) || [])[1];
    const review = { source: 'amazon_jp', productTitle: title, rating, text, lang: langAttr ? langAttr.toLowerCase() : detectLang(text) };
    const where = reviewedIn(block);
    if (where) review.reviewedIn = where; // Amazon.co.jp also shows reviews written on other Amazon sites
    out.push(review);
  });
  return out.slice(0, limit);
}

/** Reviews from schema.org Product.review JSON-LD (Rakuten review pages carry these). */
function parseJsonLdReviews(html, source, productTitle, { limit = REVIEWS_PER_ITEM } = {}) {
  const out = [];
  for (const node of extractJsonLd(html)) {
    if (!isType(node, 'Product') || !node.review) continue;
    const reviews = Array.isArray(node.review) ? node.review : [node.review];
    for (const r of reviews) {
      const text = capText(String(r.reviewBody || r.description || '').replace(/\s+/g, ' '));
      if (!text) continue;
      out.push({
        source,
        productTitle: productTitle || node.name || '',
        rating: toNumber(r.reviewRating && r.reviewRating.ratingValue),
        text,
        lang: detectLang(text),
      });
    }
  }
  return out.slice(0, limit);
}

/** The item's own review page link on a Rakuten item page, or null. */
function findRakutenReviewUrl(html) {
  const links = [...String(html || '').matchAll(/https?:\/\/review\.rakuten\.co\.jp\/item\/[^"'\s<>]+/g)].map(x => decodeEntities(x[0]));
  const own = links.find(u => /item_review/.test(u));
  if (own) return own.split('?')[0];
  const bare = [...new Set(links.filter(u => !u.includes('?')))];
  return bare.length === 1 ? bare[0] : null;
}

// ---------------------------------------------------------------- brand / IP mix

/** Leading "Maker(LATIN)" pattern that Japanese listings use for the manufacturer. */
function guessBrandFromTitle(title) {
  const t = String(title || '').normalize('NFKC').replace(/^\s*(【[^】]*】|\[[^\]]*\]|\s)+/, '');
  const m = t.match(/^([^\s()【】\[\]]{1,30}\([A-Za-z0-9 .&'+-]{2,30}\))/);
  return m ? m[1] : null;
}

// Generic retail and toy vocabulary, not brands. Extend with words, never with brand names.
const STOPWORDS = new Set([
  'おもちゃ', '玩具', 'トイ', '知育', '知育玩具', 'プレゼント', 'ギフト', '誕生日', 'クリスマス', 'お正月', 'こどもの日',
  '男の子', '女の子', '子供', '子ども', 'こども', 'キッズ', '幼児', '赤ちゃん', 'ベビー', '小学生', '大人', '保育園', '幼稚園',
  'セット', '送料無料', 'ポイント', 'クーポン', '公式', '正規品', '新品', '人気', 'ランキング', '対応', '入り', '個', '本体',
  'ラッピング', '日本', '日本語', '説明書', '付き', '限定', '販売', 'おすすめ', '室内', '屋外', '遊び', 'ゲーム', 'カード',
  '安全', '安心', '国内', '選べる', 'カラー', 'サイズ', '歳', '才', '以上', '向け', '用', 'タイプ', 'シリーズ', '対象', '年齢',
  '対象年齢', '才以上', '歳以上', 'から', '子供用', '日本語版', 'トレカ', 'カードゲーム', 'カードセット', 'スターター',
  'ブースターパック', '拡張パック', 'ランダムブースター', 'インテリア', 'ブロック', 'ぬいぐるみ', 'フィギュア', 'パズル',
  'box', 'pack', 'set', 'toy', 'toys', 'kids', 'gift', 'new', 'the', 'and', 'for', 'with', 'of', 'ver', 'type', 'edition',
]);

function titleTokens(title) {
  const t = decodeEntities(String(title || '')).normalize('NFKC')
    .replace(/【[^】]*】|\[[^\]]*\]|≪[^≫]*≫|《[^》]*》/g, ' ')
    .replace(/[★☆◆◇■□●○♪!?！？、。,:;/|+~=*"'「」『』〔〕]/g, ' ')
    .replace(/\(([^()]{1,40})\)/g, (_, inner) => `(${inner.replace(/\s+/g, '\u00a0')})`); // keep "Maker(LATIN NAME)" whole
  const raw = t.split(/[ \t\n\u3000]+/)
    .map(w => w.replace(/^\([^()]*\)/, '').replace(/^[\[<]+|[\]>]+$/g, '').replace(/\u00a0/g, ' '))
    .map(w => w.replace(/^\((?![^()]*\))/, '').replace(/^([^(]*)\)$/, '$1'))
    .filter(Boolean);
  const keep = w => {
    const lw = w.toLowerCase();
    if (STOPWORDS.has(lw)) return false;
    if (w.length < 2) return false;
    if (/^[\d.,%x×-]+[a-z%]*$/i.test(w)) return false;          // numbers, sizes, percentages
    if ((w.match(/\d/g) || []).length / w.length >= 0.3) return false; // model codes
    if (/\d+\s*(歳|才|ヶ月|か月|cm|mm|kg|個|枚|本|パック|入り|ピース|pcs)/i.test(w)) return false; // ages, sizes, counts
    return true;
  };
  // Runs of all-caps Latin words form one IP name ("ONE PIECE"), others stand alone.
  const out = [];
  let run = [];
  const flush = () => { if (run.length) out.push(run.join(' ')); run = []; };
  for (const w of raw) {
    if (/^[A-Z][A-Z0-9&.'-]*$/.test(w) && (keep(w) || (run.length && w.length === 1))) { run.push(w); continue; }
    flush();
    if (keep(w)) out.push(w);
  }
  flush();
  return out;
}

/**
 * Brand / IP counts across every top item, by document frequency of title tokens over a
 * generic stoplist. An explicit item.brand counts once for that item. No brand list.
 */
function deriveBrandMix(items, { minCount = 2, top = 40 } = {}) {
  const counts = new Map();
  for (const it of items || []) {
    if (!it || !it.title) continue;
    const tokens = new Set(titleTokens(it.title));
    if (it.brand) {
      const b = String(it.brand).normalize('NFKC').trim();
      tokens.delete(b);
      tokens.add(b);
    }
    for (const tk of tokens) counts.set(tk, (counts.get(tk) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([brand, count]) => ({ brand, count }));
}

// ---------------------------------------------------------------- output

function buildMarketplace({ categories = [], reviews = [], blocked = [], reviewStatus = [], notes = [], dryRun = false } = {}) {
  const allItems = categories.flatMap(c => c.topItems || []);
  const out = {
    generatedAt: new Date().toISOString(),
    market: 'JP',
    sources: [...new Set(categories.map(c => c.source))],
    categories,
    brandMix: deriveBrandMix(allItems),
    reviews: reviews.slice(0, MAX_REVIEWS).map(r => ({ ...r, text: capText(r.text) })),
  };
  if (blocked.length) out.blocked = blocked;
  if (reviewStatus.length) out.reviewStatus = reviewStatus;
  if (notes.length) out.notes = notes;
  if (dryRun) out.dryRun = true;
  return out;
}

/** Write JSON via temp file then rename. On any failure the temp file is removed and the error rethrown. */
function writeJsonAtomic(fp, data) {
  const tmp = `${fp}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, fp);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* nothing left to remove */ }
    throw err;
  }
}

function writeMarketplace(slug, data, { dataDir = DATA_DIR } = {}) {
  if (!slug || /[\\/]|\.\./.test(slug)) throw new Error(`invalid slug: ${slug}`);
  const dir = path.join(dataDir, 'brands', slug);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, 'marketplace.json');
  writeJsonAtomic(fp, data);
  return fp;
}

/** True when a brand profile targets Japan: market mentions japan, or the url is a .jp host. */
const { isJapanMarket } = require('../utils/market');

// ---------------------------------------------------------------- network layer

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Rakuten's toy category carousels also surface books and discs; their reviews describe the
// book or film, not toy buyers, so they are not sampled as customer evidence.
const NON_TOY_MEDIA_URL = /item\.rakuten\.co\.jp\/(book|dvd|cd|bookoff|neowing|hmv|magazine)[^/]*\//i;

/** One browser, one context, one page, polite delay, hard page cap. */
function createBrowserFetcher({ log = () => {}, maxPages = MAX_PAGES, delayMs = DELAY_MS } = {}) {
  let browser = null, page = null, used = 0;
  async function init() {
    const { chromium } = require('playwright');
    const loc = localeFor({ url: 'https://www.amazon.co.jp/' });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: loc.locale || 'ja-JP',
      timezoneId: loc.timezoneId || 'Asia/Tokyo',
      extraHTTPHeaders: { 'Accept-Language': loc.acceptLanguage || 'ja-JP,ja;q=0.9' },
      viewport: { width: 1366, height: 900 },
    });
    // Amazon renders prices in the visitor's geo currency unless the site preference says JPY.
    await context.addCookies([{ name: 'i18n-prefs', value: 'JPY', domain: '.amazon.co.jp', path: '/' }]);
    page = await context.newPage();
  }
  return {
    get used() { return used; },
    remaining() { return maxPages - used; },
    async fetchPage(url) {
      if (used >= maxPages) return { capped: true, url };
      if (!page) await init();
      if (used > 0) await sleep(delayMs);
      used++;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(2000);
        const html = await page.content();
        return { url, finalUrl: page.url(), status: resp ? resp.status() : null, html, title: await page.title() };
      } catch (err) {
        const msg = String(err.message || err).split('\n')[0];
        log(`fetch failed ${url}: ${msg}`);
        return { url, error: msg };
      }
    },
    async close() { if (browser) await browser.close().catch(() => {}); },
  };
}

/** Official Rakuten Ranking API. Returns { skipped, reason } when RAKUTEN_APP_ID is missing. */
async function fetchRakutenRankingApi({ env = process.env, genreId = RAKUTEN_TOY_GENRE_ID, fetchImpl = globalThis.fetch, dryRun = false, log = () => {} } = {}) {
  const appId = env.RAKUTEN_APP_ID;
  if (!appId) return { skipped: true, reason: 'RAKUTEN_APP_ID not set' };
  const base = env.RAKUTEN_API_BASE || RAKUTEN_RANKING_API;
  const url = `${base}?applicationId=${encodeURIComponent(appId)}&genreId=${encodeURIComponent(genreId)}&format=json&formatVersion=2`;
  if (dryRun) { log(`[dry-run] would GET ${base}?genreId=${genreId}&format=json&formatVersion=2`); return { skipped: true, reason: 'dry run' }; }
  const r = await fetchImpl(url, { headers: { 'Accept-Language': 'ja' } });
  if (!r.ok) return { skipped: true, reason: `rakuten api http_${r.status}` };
  return { items: parseRakutenApi(await r.json()) };
}

/**
 * Generic Apify page fetch with a JP residential proxy. Never calls Apify on a dry run or
 * without APIFY_API_TOKEN; prints the intended call instead.
 */
async function apifyFetchHtml({ url, env = process.env, dryRun = false, log = () => {}, clientFactory } = {}) {
  const input = {
    startUrls: [{ url }],
    maxRequestsPerCrawl: 1,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'JP' },
    pageFunction: 'async function pageFunction(context) { return { url: context.request.url, html: context.$.html() }; }',
  };
  const token = env.APIFY_API_TOKEN;
  if (dryRun || !token) {
    log(`[apify ${dryRun ? 'dry-run' : 'skipped, APIFY_API_TOKEN not set'}] would call ${APIFY_ACTOR} for ${url} (proxy RESIDENTIAL/JP)`);
    return { skipped: true, reason: dryRun ? 'dry run' : 'APIFY_API_TOKEN not set', intended: { actor: APIFY_ACTOR, input } };
  }
  try {
    const client = clientFactory ? clientFactory(token) : new (require('apify-client').ApifyClient)({ token });
    const run = await client.actor(APIFY_ACTOR).call(input, { timeout: 120 });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const html = items && items[0] && items[0].html;
    return html ? { html } : { skipped: true, reason: 'apify returned no html' };
  } catch (err) {
    return { skipped: true, reason: `apify error: ${err.message}` };
  }
}

// ---------------------------------------------------------------- orchestration

function parseCategory(source, html) {
  return source === 'amazon_jp' ? parseAmazonListHtml(html) : parseRakutenJsonLd(html);
}

// Checkpoint step and units: '<source>/<category>' per category page, 'rakuten/toys_ranking_api'
// for the official API, 'reviews/<source>' per review sample. Cleared after marketplace.json is written.
const CHECKPOINT_STEP = 'marketplace';
// Temporary refusals (overload page, rate limit, unavailable, timeout) get one delayed retry
// later in the same run. Captchas, challenges and access denials are never retried.
const RETRY_DELAY_MS = 30000;
function isRetryableBlock(reason) {
  return /^(overload_page|http_429|http_503)$/.test(String(reason || '')) || /^error: .*timeout/i.test(String(reason || ''));
}

function readJsonSafe(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { return null; }
}

/** Split the review cap fairly across sources so one source cannot crowd the other out. */
function capReviewsFairly(bySource, max) {
  const sources = Object.keys(bySource).filter(s => (bySource[s] || []).length);
  const out = Object.fromEntries(sources.map(s => [s, []]));
  let room = max, progressed = true;
  const idx = Object.fromEntries(sources.map(s => [s, 0]));
  while (room > 0 && progressed) {
    progressed = false;
    for (const s of sources) {
      if (room <= 0) break;
      if (idx[s] < bySource[s].length) { out[s].push(bySource[s][idx[s]++]); room--; progressed = true; }
    }
  }
  return sources.flatMap(s => out[s]);
}

/**
 * Collect marketplace intelligence and (unless dryRun or write:false) write marketplace.json.
 * Never throws: failures are recorded in the output. A unit that fails now but has good data in
 * the previous marketplace.json is carried forward with stale:true, lastAttempt and lastError.
 */
async function collectMarketplace({
  slug, categories, log = m => console.log(`[marketplace_jp] ${m}`), dryRun = false, write = true,
  dataDir = DATA_DIR, env = process.env, maxReviews = MAX_REVIEWS, fetcher: injected, fetchImpl,
  retryDelayMs = RETRY_DELAY_MS,
} = {}) {
  const cats = (categories && categories.length ? categories : DEFAULT_CATEGORIES)
    .filter(c => c && c.url && (c.source === 'amazon_jp' || c.source === 'rakuten'));
  const notes = [];

  if (dryRun) {
    cats.forEach(c => log(`[dry-run] would load ${c.source} ${c.category}: ${c.url}`));
    const api = await fetchRakutenRankingApi({ env, dryRun: true, log });
    if (api.skipped && api.reason !== 'dry run') notes.push(api.reason);
    await apifyFetchHtml({ url: cats[0] ? cats[0].url : '', env, dryRun: true, log });
    log(`[dry-run] would sample up to ${maxReviews} reviews from ${REVIEW_ITEMS_PER_SOURCE} top items per source; nothing written`);
    return buildMarketplace({ categories: cats.map(c => ({ ...c, topItems: [] })), notes, dryRun: true });
  }

  const useCp = !!(slug && write);
  const cpOpts = { dataDir };
  const resume = (key) => {
    if (!useCp) return undefined;
    const v = checkpoint.get(slug, CHECKPOINT_STEP, key, cpOpts);
    if (v !== undefined) log(`${key}: resumed from checkpoint`);
    return v;
  };
  const save = (key, value) => { if (useCp) checkpoint.put(slug, CHECKPOINT_STEP, key, value, cpOpts); };
  const prev = slug && !/[\\/]|\.\./.test(slug) ? readJsonSafe(path.join(dataDir, 'brands', slug, 'marketplace.json')) : null;
  const prevAsOf = (x) => (x && x.asOf) || (prev && prev.generatedAt) || null;
  const attemptAt = new Date().toISOString();

  const categoriesOut = [], blocked = [], reviewStatus = [];
  const reviewsBySource = {};
  let crashed = false;
  const doneReviewSources = new Set(); // sources whose review sampling finished (or resumed)
  const fetcher = injected || createBrowserFetcher({ log });

  // A failed category: record the block, then carry the previous good result forward if any.
  const recordFailed = (c, reason, extra = {}) => {
    blocked.push({ source: c.source, category: c.category, url: c.url, blocked: true, reason, ...extra });
    const p = prev && Array.isArray(prev.categories)
      ? prev.categories.find(x => x && x.source === c.source && x.category === c.category && Array.isArray(x.topItems) && x.topItems.length)
      : null;
    if (p) {
      log(`${c.source}/${c.category}: ${reason}, carried previous good data forward (stale)`);
      const { blocked: _b, reason: _r, ...rest } = p;
      categoriesOut.push({ ...rest, stale: true, asOf: prevAsOf(p), lastAttempt: attemptAt, lastError: reason, ...extra });
    } else {
      categoriesOut.push({ ...c, blocked: true, reason, topItems: [], ...extra });
    }
  };

  // Direct fetch, then the Apify fallback when blocked. Returns { capped } | { block } | { html }.
  const loadCategory = async (c, { apify = true } = {}) => {
    const res = await fetcher.fetchPage(c.url);
    if (res.capped) return { capped: true };
    let html = res.html;
    let block = res.error ? { blocked: true, reason: `error: ${res.error}` } : detectBlock({ html, status: res.status, url: res.finalUrl });
    if (block && apify) {
      const ap = await apifyFetchHtml({ url: c.url, env, log });
      if (ap.html && !detectBlock({ html: ap.html })) { html = ap.html; block = null; notes.push(`apify used for ${c.url}`); }
      else notes.push(`apify not used for ${c.url}: ${ap.reason || 'still blocked'}`);
    }
    return block ? { block } : { html };
  };

  try {
    const API_KEY = 'rakuten/toys_ranking_api';
    const savedApi = resume(API_KEY);
    if (savedApi) categoriesOut.push(savedApi);
    else {
      try {
        const api = await fetchRakutenRankingApi({ env, fetchImpl, log });
        if (api.items) {
          const cat = { source: 'rakuten', category: 'toys_ranking_api', url: RAKUTEN_RANKING_API, topItems: api.items };
          categoriesOut.push(cat);
          if (api.items.length) save(API_KEY, cat);
        } else notes.push(`rakuten api: ${api.reason}`);
      } catch (err) { notes.push(`rakuten api error: ${err.message}`); }
    }

    const retryQueue = [];
    let capped = false;
    for (const c of cats) {
      const key = `${c.source}/${c.category}`;
      const saved = resume(key);
      if (saved) { categoriesOut.push(saved); continue; }
      if (capped) { recordFailed(c, 'page cap reached'); continue; }
      const r = await loadCategory(c);
      if (r.capped) { notes.push(`page cap reached before ${c.url}`); capped = true; recordFailed(c, 'page cap reached'); continue; }
      if (r.block) {
        if (isRetryableBlock(r.block.reason)) {
          log(`${key} temporarily blocked (${r.block.reason}), one delayed retry later in this run`);
          retryQueue.push({ c, firstReason: r.block.reason });
          continue;
        }
        log(`${key} blocked (${r.block.reason})`);
        recordFailed(c, r.block.reason);
        continue;
      }
      const topItems = parseCategory(c.source, r.html);
      log(`${key}: ${topItems.length} items`);
      const cat = { ...c, topItems };
      categoriesOut.push(cat);
      if (topItems.length) save(key, cat);
    }

    if (retryQueue.length) {
      log(`waiting ${Math.round(retryDelayMs / 1000)}s before retrying ${retryQueue.length} temporarily blocked page(s)`);
      if (retryDelayMs > 0) await sleep(retryDelayMs);
      for (const { c, firstReason } of retryQueue) {
        const key = `${c.source}/${c.category}`;
        const r = await loadCategory(c, { apify: false });
        if (r.html) {
          const topItems = parseCategory(c.source, r.html);
          log(`${key}: retry ok, ${topItems.length} items`);
          const cat = { ...c, topItems, retry: { firstReason, result: 'ok' } };
          categoriesOut.push(cat);
          if (topItems.length) save(key, cat);
        } else {
          const reason = r.capped ? 'page cap reached' : r.block.reason;
          log(`${key}: still blocked after one delayed retry (${reason})`);
          recordFailed(c, reason, { status: 'retryable_block', retry: { firstReason, result: 'blocked' } });
        }
      }
    }
    // Keep categories in their configured order (API first) regardless of retry order.
    const order = new Map([['rakuten/toys_ranking_api', -1], ...cats.map((c, i) => [`${c.source}/${c.category}`, i])]);
    categoriesOut.sort((a, b) => (order.get(`${a.source}/${a.category}`) ?? 1e6) - (order.get(`${b.source}/${b.category}`) ?? 1e6));

    // Reviews from the top items of each source, while page budget and the review cap allow.
    for (const source of ['amazon_jp', 'rakuten']) {
      const rkey = `reviews/${source}`;
      const savedRev = resume(rkey);
      if (savedRev && Array.isArray(savedRev.reviews)) {
        reviewStatus.push({ ...(savedRev.status || { source }), resumed: true });
        reviewsBySource[source] = savedRev.reviews;
        doneReviewSources.add(source);
        continue;
      }
      const status = { source, itemsTried: 0, collected: 0, reason: null };
      reviewStatus.push(status);
      const got = [];
      const seen = new Set();
      const top = categoriesOut.filter(c => c.source === source).flatMap(c => c.topItems || [])
        .filter(it => it.url && !NON_TOY_MEDIA_URL.test(it.url))
        .filter(it => it.url && !seen.has(it.url.split('?')[0]) && seen.add(it.url.split('?')[0]))
        .slice(0, REVIEW_ITEMS_PER_SOURCE);
      if (!top.length) status.reason = 'no top items to sample';
      for (const it of top) {
        if (got.length >= maxReviews) { status.reason = 'review cap reached'; break; }
        status.itemsTried++;
        const page = await fetcher.fetchPage(it.url);
        if (page.capped) { status.reason = 'page cap reached'; break; }
        if (page.error) { status.skipped = (status.skipped || 0) + 1; status.lastError = page.error; continue; }
        const b = detectBlock({ html: page.html, status: page.status, url: page.finalUrl });
        if (b) { status.reason = `item page blocked (${b.reason})`; break; }
        let found = [];
        if (source === 'amazon_jp') {
          found = parseAmazonReviews(page.html, it.title);
        } else {
          found = parseJsonLdReviews(page.html, 'rakuten', it.title);
          const revUrl = found.length ? null : findRakutenReviewUrl(page.html);
          if (revUrl) {
            const rp = await fetcher.fetchPage(revUrl);
            if (rp.capped) { status.reason = 'page cap reached'; break; }
            if (rp.error) { status.skipped = (status.skipped || 0) + 1; status.lastError = rp.error; continue; }
            const rb = detectBlock({ html: rp.html, status: rp.status, url: rp.finalUrl });
            if (rb) { status.reason = `review page blocked (${rb.reason})`; break; }
            found = parseJsonLdReviews(rp.html, 'rakuten', it.title);
          }
        }
        got.push(...found.slice(0, maxReviews - got.length));
      }
      const bal = balanceReviewLanguages(got);
      status.collected = bal.reviews.length;
      status.lang = { ja: bal.ja, other: bal.other, droppedOther: bal.dropped };
      if (bal.dropped) log(`${source} reviews: kept ${bal.ja} Japanese and ${bal.other} other-language, dropped ${bal.dropped} other-language to keep Japanese at least ${Math.round(MIN_JA_SHARE * 100)}%`);
      if (bal.reviews.length) {
        reviewsBySource[source] = bal.reviews;
        save(rkey, { reviews: bal.reviews, status });
        doneReviewSources.add(source);
        continue;
      }
      if (!status.reason) status.reason = 'no publicly loadable reviews found on sampled item pages';
      const prevRev = prev && Array.isArray(prev.reviews) ? prev.reviews.filter(r => r && r.source === source) : [];
      if (prevRev.length) {
        log(`${source} reviews: none collected (${status.reason}), carried ${prevRev.length} previous reviews forward (stale)`);
        reviewsBySource[source] = prevRev.map(r => ({ ...r, stale: true, asOf: prevAsOf(r), lastAttempt: attemptAt, lastError: status.reason }));
        Object.assign(status, { stale: true, carriedForward: prevRev.length, lastAttempt: attemptAt, lastError: status.reason });
      }
      doneReviewSources.add(source);
    }
  } catch (err) {
    crashed = true;
    notes.push(`collector error: ${err.message}`);
    log(`collector error: ${err.message}`);
  } finally {
    if (!injected) await fetcher.close();
  }

  // After a crash, units the run never reached must not vanish from the file: carry the previous
  // good data forward (stale) and flag the file partial with the list of unreached units.
  const unreached = [];
  if (crashed) {
    const reason = 'not reached after crash';
    const have = new Set(categoriesOut.map(c => `${c.source}/${c.category}`));
    const wanted = [...cats];
    for (const c of (prev && Array.isArray(prev.categories) ? prev.categories : [])) {
      if (c && c.source && c.category && !wanted.some(w => w.source === c.source && w.category === c.category)) wanted.push(c);
    }
    for (const c of wanted) {
      const key = `${c.source}/${c.category}`;
      if (have.has(key)) continue;
      unreached.push(key);
      const p = prev && Array.isArray(prev.categories)
        ? prev.categories.find(x => x && x.source === c.source && x.category === c.category && Array.isArray(x.topItems) && x.topItems.length)
        : null;
      if (p) {
        const { blocked: _b, reason: _r, ...rest } = p;
        categoriesOut.push({ ...rest, stale: true, asOf: prevAsOf(p), lastAttempt: attemptAt, lastError: reason });
      }
    }
    for (const source of ['amazon_jp', 'rakuten']) {
      if (doneReviewSources.has(source)) continue;
      unreached.push(`reviews/${source}`);
      const prevRev = prev && Array.isArray(prev.reviews) ? prev.reviews.filter(r => r && r.source === source) : [];
      if (prevRev.length) {
        reviewsBySource[source] = prevRev.map(r => ({ ...r, stale: true, asOf: prevAsOf(r), lastAttempt: attemptAt, lastError: reason }));
        reviewStatus.push({ source, reason, stale: true, carriedForward: prevRev.length, lastAttempt: attemptAt, lastError: reason });
      }
    }
    const order = new Map([['rakuten/toys_ranking_api', -1], ...cats.map((c, i) => [`${c.source}/${c.category}`, i])]);
    categoriesOut.sort((a, b) => (order.get(`${a.source}/${a.category}`) ?? 1e6) - (order.get(`${b.source}/${b.category}`) ?? 1e6));
    if (unreached.length) log(`partial run: ${unreached.length} unit(s) not reached (${unreached.join(', ')}); previous data carried forward where it existed`);
  }

  const reviews = capReviewsFairly(reviewsBySource, Math.min(maxReviews, MAX_REVIEWS));
  const out = buildMarketplace({ categories: categoriesOut, reviews, blocked, reviewStatus, notes });
  if (crashed) { out.partial = true; out.unreached = unreached; }
  if (write && slug) {
    try {
      log(`wrote ${writeMarketplace(slug, out, { dataDir })}`);
      // A crash mid-run keeps the checkpoint so the next run resumes the finished units.
      if (!crashed) checkpoint.clear(slug, CHECKPOINT_STEP, cpOpts);
    } catch (err) { log(`write failed: ${err.message}`); }
  }
  return out;
}

module.exports = {
  collectMarketplace,
  // pure parsers and helpers
  parseRakutenJsonLd, parseRakutenApi, parseAmazonListHtml, parseAmazonReviews, parseJsonLdReviews,
  findRakutenReviewUrl, detectBlock, deriveBrandMix, guessBrandFromTitle, titleTokens, detectLang,
  extractJsonLd, buildMarketplace, writeMarketplace, writeJsonAtomic, isJapanMarket,
  balanceReviewLanguages, capReviewsFairly, isRetryableBlock, reviewedIn, CHECKPOINT_STEP, MIN_JA_SHARE,
  // optional key paths
  fetchRakutenRankingApi, apifyFetchHtml, createBrowserFetcher,
  DEFAULT_CATEGORIES, MAX_REVIEWS, REVIEW_TEXT_CAP,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  const dryRun = args.includes('--dry-run');
  if (!slug) { console.error('[marketplace_jp] --slug= required'); process.exit(1); }
  collectMarketplace({ slug, dryRun }).then(out => {
    const counts = (out.categories || []).map(c => `${c.source}/${c.category}=${c.blocked ? 'BLOCKED(' + c.reason + ')' : (c.topItems || []).length}`).join(' ');
    console.log(`[marketplace_jp] categories: ${counts}; reviews=${out.reviews.length}; brandMix=${out.brandMix.length}`);
  });
}
