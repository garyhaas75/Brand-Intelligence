/**
 * Tech stack per player: what each Japanese competitor's (and the target's) storefront runs on.
 *
 * Pure detection, no model call. For every player (profile.identifiedCompetitors via utils/players.js)
 * plus the target, read the homepage and at most two more pages on the same host (one product or
 * category page, one help/guide page about payment or delivery), then match the SIGNATURES table below.
 * Every detection keeps the regex hit as evidence, so a reader can see why we said so.
 *
 * Access goes through utils/site_access.js fetchPage (toysrus.co.jp only through the authorized
 * Japanese proxy, within its page budget; other sites directly). A site that refuses us (for example a
 * 403 to non-Japanese IPs) is recorded observed:false with the reason. Nothing is guessed from memory.
 * The target falls back to its hand-saved capture (data/brands/<slug>/manual_capture/*.html).
 *
 * Writes:
 *   data/brands/<slug>/tech_stack.json        the stack per player plus a summary
 *   data/brands/<slug>/tech_stack_pages.json  a trimmed text digest per page read, so par_matrix.js can
 *                                             classify capabilities without requesting the pages again
 * Progress is checkpointed per player (utils/checkpoint.js). A failed player keeps its previous good
 * data, marked stale.
 *
 * CLI: node analysis/tech_stack.js --slug=<slug> [--only=Name1,Name2] [--no-target]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const checkpoint = require('../utils/checkpoint');

const DATA_DIR_DEFAULT = path.join(__dirname, '../data');
const STEP = 'tech_stack';
const MAX_EXTRA_PAGES = 2;
const DIGEST_HEAD = 9000;
const DIGEST_TAIL = 7000;

function log(msg) { console.log(`[tech_stack] [${new Date().toISOString()}] ${msg}`); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2));
  fs.renameSync(file + '.tmp', file);
}
const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

/**
 * Signature table. Each entry: id, name, category, re (matched against raw HTML), proves (what a hit
 * means). Categories: platform | analytics | crm | reviews | search | chat | payments | ads | loyalty.
 * Platform entries carry a confidence. Add a row to extend; nothing else needs to change.
 */
const SIGNATURES = [
  // commerce platform
  { id: 'sfcc', name: 'Salesforce Commerce Cloud', category: 'platform', confidence: 'high', re: /demandware\.static|demandware\.store|\/on\/demandware|dwstatic|cdn\.cquotient\.com/i, proves: 'Salesforce Commerce Cloud (Demandware) asset or controller paths' },
  { id: 'shopify', name: 'Shopify', category: 'platform', confidence: 'high', re: /cdn\.shopify\.com|myshopify\.com|Shopify\.theme|shopify-section/i, proves: 'Shopify CDN, theme object or section markup' },
  { id: 'ecbeing', name: 'ecbeing', category: 'platform', confidence: 'high', re: /ecbeing/i, proves: 'ecbeing platform marker' },
  { id: 'ecbeing_url', name: 'ecbeing', category: 'platform', confidence: 'medium', re: /href="[^"]*\/shop\/(?:g\/g|c\/c)[0-9A-Za-z_-]+/i, proves: 'ecbeing style goods/category URL (/shop/g/g..., /shop/c/c...)' },
  { id: 'futureshop', name: 'futureshop', category: 'platform', confidence: 'high', re: /futureshop|fs2cdn\.com|\/fs\/[a-z0-9_-]+\/(?:c|goods|GoodsSearchList)\b/i, proves: 'futureshop marker or /fs/<shop>/ URL' },
  { id: 'makeshop', name: 'MakeShop', category: 'platform', confidence: 'high', re: /makeshop|shopdetail\/\d{6,}/i, proves: 'MakeShop marker or shopdetail URL' },
  { id: 'eccube', name: 'EC-CUBE', category: 'platform', confidence: 'high', re: /ec-?cube|eccube_|\/html\/template\/default\//i, proves: 'EC-CUBE marker or template path' },
  { id: 'magento', name: 'Magento / Adobe Commerce', category: 'platform', confidence: 'high', re: /Magento_[A-Z]|mage\/cookies|\/static\/version\d+\/frontend\//, proves: 'Magento module or static version path' },
  { id: 'sap', name: 'SAP Commerce (Hybris)', category: 'platform', confidence: 'high', re: /\/_ui\/(?:responsive|desktop)\/|yacceleratorstorefront|hybris/i, proves: 'SAP Commerce accelerator paths' },
  { id: 'nextjs', name: 'Custom (Next.js front end)', category: 'platform', confidence: 'low', re: /__NEXT_DATA__|\/_next\/static\//, proves: 'Next.js front end; commerce back end not identifiable from the page' },
  { id: 'nuxt', name: 'Custom (Nuxt front end)', category: 'platform', confidence: 'low', re: /__NUXT__|\/_nuxt\//, proves: 'Nuxt front end; commerce back end not identifiable from the page' },
  // content management (not a commerce platform; used when nothing better is found)
  { id: 'wordpress', name: 'WordPress', category: 'cms', re: /\/wp-content\/|\/wp-includes\//i, proves: 'WordPress theme or core asset paths' },
  // tag managers / analytics
  { id: 'gtm', name: 'Google Tag Manager', category: 'analytics', re: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{5,}/, proves: 'GTM container snippet or ID' },
  { id: 'ga4', name: 'Google Analytics 4', category: 'analytics', re: /gtag\/js\?id=G-|['"]G-[A-Z0-9]{8,}['"]/, proves: 'gtag.js with a G- measurement ID' },
  { id: 'adobe_analytics', name: 'Adobe Analytics', category: 'analytics', re: /AppMeasurement|s_code\.js|\.sc\.omtrdc\.net|omniture/i, proves: 'Adobe Analytics library or collection host' },
  { id: 'adobe_launch', name: 'Adobe Experience Platform Tags', category: 'analytics', re: /assets\.adobedtm\.com/i, proves: 'Adobe Launch/Tags loader' },
  { id: 'tealium', name: 'Tealium', category: 'analytics', re: /tags\.tiqcdn\.com/i, proves: 'Tealium iQ loader' },
  { id: 'treasure_data', name: 'Treasure Data', category: 'analytics', re: /treasuredata|in\.treasuredata\.com|td-cdn/i, proves: 'Treasure Data CDP tag' },
  { id: 'clarity', name: 'Microsoft Clarity', category: 'analytics', re: /clarity\.ms\/tag/i, proves: 'Clarity tag' },
  { id: 'hotjar', name: 'Hotjar', category: 'analytics', re: /static\.hotjar\.com|hjSetting/i, proves: 'Hotjar tag' },
  // CRM / MA / personalization
  { id: 'karte', name: 'KARTE', category: 'crm', re: /static\.karte\.io|karte\.io\/|krt\.\w+\.js|tracker\.karte/i, proves: 'KARTE (PLAID) tracker' },
  { id: 'bdash', name: 'b-dash', category: 'crm', re: /b-dash|bdash-marketing/i, proves: 'b-dash tag' },
  { id: 'rtoaster', name: 'Rtoaster', category: 'crm', re: /rtoaster/i, proves: 'Rtoaster (BrainPad) tag' },
  { id: 'sfmc', name: 'Salesforce Marketing Cloud', category: 'crm', re: /exacttarget|igodigital|marketingcloudapis/i, proves: 'Salesforce Marketing Cloud collect/tracking host' },
  { id: 'einstein', name: 'Salesforce Einstein (Commerce Cloud recommendations)', category: 'crm', re: /cquotient/i, proves: 'Einstein / CQuotient activity tracking' },
  { id: 'braze', name: 'Braze', category: 'crm', re: /braze\.com|appboy/i, proves: 'Braze SDK' },
  { id: 'repro', name: 'Repro', category: 'crm', re: /repro\.io/i, proves: 'Repro web tag' },
  { id: 'insider', name: 'Insider', category: 'crm', re: /useinsider\.com/i, proves: 'Insider tag' },
  { id: 'dynamic_yield', name: 'Dynamic Yield', category: 'crm', re: /dynamicyield/i, proves: 'Dynamic Yield tag' },
  { id: 'line_login', name: 'LINE Login', category: 'crm', re: /access\.line\.me\/oauth2|LINEでログイン|LINE\s*ログイン/i, proves: 'LINE Login link or button' },
  // reviews
  { id: 'yotpo', name: 'Yotpo', category: 'reviews', re: /yotpo/i, proves: 'Yotpo widget' },
  { id: 'bazaarvoice', name: 'Bazaarvoice', category: 'reviews', re: /bazaarvoice|bvapi/i, proves: 'Bazaarvoice widget' },
  { id: 'revico', name: 'ReviCo', category: 'reviews', re: /revico/i, proves: 'ReviCo widget' },
  { id: 'powerreviews', name: 'PowerReviews', category: 'reviews', re: /powerreviews/i, proves: 'PowerReviews widget' },
  { id: 'native_reviews', name: 'Native reviews', category: 'reviews', re: /itemprop="(?:review|aggregateRating)"|"aggregateRating"|レビュー\s*[(（]\s*\d+|商品レビュー|カスタマーレビュー/, proves: 'review markup or review counts on page' },
  // site search
  { id: 'zeta', name: 'ZETA SEARCH', category: 'search', re: /zeta-?search|zetacx|ZETA\s?SEARCH/i, proves: 'ZETA SEARCH script or endpoint' },
  { id: 'algolia', name: 'Algolia', category: 'search', re: /algolia/i, proves: 'Algolia client' },
  { id: 'marketing_search', name: 'Marketing Search', category: 'search', re: /marketing-?search/i, proves: 'Marketing Search script' },
  { id: 'searchspring', name: 'Searchspring', category: 'search', re: /searchspring/i, proves: 'Searchspring script' },
  { id: 'sli', name: 'SLI / Klevu / Doofinder', category: 'search', re: /sli-spark|klevu|doofinder/i, proves: 'hosted search script' },
  // chat / CS
  { id: 'zendesk', name: 'Zendesk', category: 'chat', re: /zdassets\.com|zendesk/i, proves: 'Zendesk widget or help center' },
  { id: 'zendesk_guide', name: 'Zendesk (help center)', category: 'chat', re: /https?:\/\/[a-z0-9.-]+\/hc\/(?:ja|en-us)\//i, proves: 'help center on the Zendesk Guide URL pattern (/hc/<locale>/); medium confidence' },
  { id: 'karakuri', name: 'KARAKURI', category: 'chat', re: /karakuri/i, proves: 'KARAKURI chatbot' },
  { id: 'chatplus', name: 'ChatPlus', category: 'chat', re: /chatplus/i, proves: 'ChatPlus widget' },
  { id: 'sf_chat', name: 'Salesforce chat', category: 'chat', re: /embeddedservice|salesforceliveagent|liveagent/i, proves: 'Salesforce embedded service chat' },
  { id: 'intercom', name: 'Intercom', category: 'chat', re: /widget\.intercom\.io/i, proves: 'Intercom widget' },
  { id: 'line_oa', name: 'LINE official account', category: 'chat', re: /line\.me\/R\/ti\/p|lin\.ee\/|page\.line\.me|line\.me\/ti\/p/i, proves: 'link to a LINE official account' },
  // payments (text, logo IDs or image names)
  { id: 'cards', name: 'Credit cards', category: 'payments', re: /payment-(?:visa|jcb|mc|amex)\b|クレジットカード(?:決済|払い)/i, proves: 'card brand logos or card payment text' },
  { id: 'paypay', name: 'PayPay', category: 'payments', re: /payment-paypay|PayPay(?!\s*(?:ギフト|ポイント))|paypay(?:-|_)?logo/i, proves: 'PayPay logo or payment text' },
  { id: 'amazon_pay', name: 'Amazon Pay', category: 'payments', re: /amazon[\s_-]?pay|payment-amz\b|static-fe\.payments-amazon\.com/i, proves: 'Amazon Pay logo, button or script' },
  { id: 'rakuten_pay', name: 'Rakuten Pay', category: 'payments', re: /楽天ペイ|rakuten[\s_-]?pay/i, proves: 'Rakuten Pay text or logo' },
  { id: 'd_barai', name: 'd Barai', category: 'payments', re: /d払い|d-?barai/i, proves: 'd Barai text or logo' },
  { id: 'au_pay', name: 'au PAY', category: 'payments', re: /au\s?PAY|aupay/i, proves: 'au PAY text or logo' },
  { id: 'konbini', name: 'Konbini payment', category: 'payments', re: /コンビニ(?:決済|払い|支払|後払い)|konbini/i, proves: 'convenience store payment text' },
  { id: 'carrier', name: 'Carrier billing', category: 'payments', re: /キャリア決済|ドコモ払い|docomo払い|ソフトバンクまとめて支払い|auかんたん決済/i, proves: 'mobile carrier billing text' },
  { id: 'paidy', name: 'Paidy', category: 'payments', re: /paidy/i, proves: 'Paidy text or script' },
  { id: 'atobarai', name: 'Deferred payment (NP atobarai etc.)', category: 'payments', re: /NP後払い|np-atobarai|後払い決済|後払い/i, proves: 'deferred (atobarai) payment text' },
  { id: 'apple_pay', name: 'Apple Pay', category: 'payments', re: /apple[\s_-]?pay/i, proves: 'Apple Pay text or button' },
  { id: 'google_pay', name: 'Google Pay', category: 'payments', re: /google[\s_-]?pay/i, proves: 'Google Pay text or button' },
  { id: 'aeon_card', name: 'AEON Card', category: 'payments', re: /payment-aeon\b|イオンカード/i, proves: 'AEON card logo or text' },
  { id: 'saison', name: 'Saison Card', category: 'payments', re: /payment-a?s?aison\b|セゾンカード/i, proves: 'Saison card logo or text' },
  { id: 'nicos', name: 'NICOS', category: 'payments', re: /payment-nicos\b|NICOSカード|三菱UFJニコス/i, proves: 'NICOS card logo or text' },
  // ad pixels
  { id: 'google_ads', name: 'Google Ads', category: 'ads', re: /googleadservices\.com|['"]AW-\d{6,}/, proves: 'Google Ads conversion tag' },
  { id: 'criteo', name: 'Criteo', category: 'ads', re: /criteo/i, proves: 'Criteo OneTag' },
  { id: 'yahoo_ads', name: 'Yahoo! JAPAN Ads', category: 'ads', re: /yjtag|s\.yimg\.jp\/images\/listing\/tool\/cv|ytag\.js|b\.yjtag\.jp/i, proves: 'Yahoo! JAPAN ads tag' },
  { id: 'meta_pixel', name: 'Meta Pixel', category: 'ads', re: /connect\.facebook\.net\/[^"']*fbevents|fbq\(/i, proves: 'Meta pixel' },
  { id: 'tiktok_pixel', name: 'TikTok Pixel', category: 'ads', re: /analytics\.tiktok\.com|ttq\.load/i, proves: 'TikTok pixel' },
  { id: 'line_tag', name: 'LINE Tag', category: 'ads', re: /line_tag|d\.line-scdn\.net\/n\/line_tag|_ltq/i, proves: 'LINE Tag (ads conversion)' },
  { id: 'x_pixel', name: 'X (Twitter) Pixel', category: 'ads', re: /static\.ads-twitter\.com|twq\(/i, proves: 'X pixel' },
  { id: 'a8', name: 'A8.net affiliate', category: 'ads', re: /a8\.net|statics\.a8\.net/i, proves: 'A8.net affiliate tag' },
  { id: 'valuecommerce', name: 'ValueCommerce affiliate', category: 'ads', re: /valuecommerce/i, proves: 'ValueCommerce tag' },
  // loyalty
  { id: 'd_point', name: 'd Point', category: 'loyalty', re: /dポイント/, proves: 'd Point earn/use mention' },
  { id: 'rakuten_point', name: 'Rakuten Point', category: 'loyalty', re: /楽天ポイント/, proves: 'Rakuten Point mention' },
  { id: 'v_point', name: 'V Point', category: 'loyalty', re: /Vポイント|Tポイント/, proves: 'V Point (ex T Point) mention' },
  { id: 'ponta', name: 'Ponta', category: 'loyalty', re: /Ponta|ポンタ/, proves: 'Ponta mention' },
  { id: 'paypay_point', name: 'PayPay Point', category: 'loyalty', re: /PayPayポイント/, proves: 'PayPay Point mention' },
  { id: 'waon', name: 'WAON', category: 'loyalty', re: /WAON/, proves: 'WAON mention' },
  { id: 'own_program', name: 'Own membership program', category: 'loyalty', re: /会員(?:特典|プログラム|ランク)|ポイントカード|スターカード|majica|メンバーズカード/, proves: 'own member or point program mention' },
];
const CATEGORIES = ['analytics', 'crm', 'reviews', 'search', 'chat', 'payments', 'ads', 'loyalty'];

/** Platforms decided by the host itself (marketplaces run their own stack). */
const HOST_PLATFORMS = [
  { re: /(^|\.)amazon\.co\.jp$/, name: 'Amazon (proprietary marketplace)' },
  { re: /(^|\.)rakuten\.co\.jp$/, name: 'Rakuten Ichiba (proprietary marketplace)' },
  { re: /(^|\.)shopping\.yahoo\.co\.jp$|(^|\.)store\.shopping\.yahoo\.co\.jp$/, name: 'Yahoo! Shopping (proprietary marketplace)' },
];

function snippetAround(text, index, len, pad = 50) {
  return String(text.slice(Math.max(0, index - pad), index + len + pad)).replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** All signature hits in one page's HTML. */
function detectSignatures(html, url) {
  const hits = [];
  const t = String(html || '');
  for (const s of SIGNATURES) {
    const m = s.re.exec(t);
    if (m) hits.push({ id: s.id, name: s.name, category: s.category, confidence: s.confidence || null, proves: s.proves, match: m[0].slice(0, 80), snippet: snippetAround(t, m.index, m[0].length), url: url || null });
  }
  return hits;
}

/** JSON-LD @type values on a page. Unparseable blocks are counted, not guessed. */
function jsonLdTypes(html) {
  const types = new Set();
  let blocks = 0, unparsed = 0;
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const ty = o['@type'];
    if (typeof ty === 'string') types.add(ty);
    else if (Array.isArray(ty)) ty.filter(x => typeof x === 'string').forEach(x => types.add(x));
    if (o['@graph']) walk(o['@graph']);
  };
  while ((m = re.exec(String(html || '')))) {
    blocks++;
    try { walk(JSON.parse(m[1].trim())); } catch { unparsed++; }
  }
  return { types: [...types], blocks, unparsed };
}

/** App presence: Smart App Banner meta and store links. */
function detectApp(html) {
  const t = String(html || '');
  const meta = /<meta[^>]+name=["']apple-itunes-app["'][^>]*content=["']([^"']+)["']/i.exec(t);
  const ios = /https?:\/\/(?:apps|itunes)\.apple\.com\/[^"'\s<>]*id\d+/i.exec(t);
  const android = /https?:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.]+/i.exec(t);
  return {
    ios: ios ? ios[0] : (meta ? `apple-itunes-app: ${meta[1].slice(0, 80)}` : null),
    android: android ? android[0] : null,
    smartBanner: !!meta,
  };
}

const NAMED_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", yen: '¥', middot: '·', copy: '©', reg: '®', times: '×', hellip: '...' };
function decodeEntities(s) {
  return String(s || '').replace(/&(nbsp|amp|lt|gt|quot|apos|yen|middot|copy|reg|times|hellip|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ' '; } }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

/** Readable text digest of a page: title, meta description, visible text with alt/title attributes. */
function htmlToDigest(html) {
  let t = String(html || '');
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(t) || [])[1] || '';
  const desc = (/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(t) || [])[1] || '';
  t = t.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<img\b[^>]*?\balt\s*=\s*["']([^"']+)["'][^>]*>/gi, ' [$1] ')
    .replace(/<(?:button|a)\b[^>]*?\btitle\s*=\s*["']([^"']+)["'][^>]*>/gi, ' $1 ')
    .replace(/<br\s*\/?>|<\/(?:p|li|div|h\d|tr|section|footer|header|nav|ul)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t).replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
  // de-duplicate repeated lines (mega menus repeat for mobile and desktop)
  const seen = new Set();
  t = t.split('\n').filter(l => { const k = l.trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join('\n');
  const head = `TITLE: ${decodeEntities(title).replace(/\s+/g, ' ').trim()}\nDESCRIPTION: ${decodeEntities(desc).replace(/\s+/g, ' ').trim()}\n`;
  if (t.length > DIGEST_HEAD + DIGEST_TAIL) t = t.slice(0, DIGEST_HEAD) + '\n[...]\n' + t.slice(-DIGEST_TAIL);
  return head + t;
}

/** Same-host links with their anchor text. */
function extractLinks(html, baseUrl) {
  const out = [];
  const base = hostOf(baseUrl);
  const re = /<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < 3000) {
    let abs;
    try { abs = new URL(m[1].replace(/&amp;/g, '&'), baseUrl).toString(); } catch { continue; }
    if (!/^https?:/.test(abs)) continue;
    const h = hostOf(abs);
    if (h !== base && !h.endsWith('.' + base) && !base.endsWith('.' + h)) continue;
    out.push({ url: abs, text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) });
  }
  return out;
}

const PRODUCT_RE = /\/(?:products?|items?|goods|dp|p|c|category|categories|collections|shop\/g|shop\/c|ec\/(?:pro|cmdty)|disp\/(?:item|category))\/|[?&](?:pid|item_id|goods_id|category_id)=|\/[^/]*-\d{6,}\.html/i;
const HELP_TEXT_RE = /ご利用ガイド|お支払い?|支払方法|決済方法|配送|送料|お届け|ガイド|ヘルプ|よくあるご質問|FAQ|guide|help|payment|shipping|delivery/i;
const HELP_URL_RE = /guide|help|faq|payment|shipping|delivery|guidance|support|shiharai|souryou/i;
const SKIP_RE = /login|logout|cart|mypage|account|signin|register|entry|\.pdf($|\?)|\.(?:jpg|png|gif|zip)($|\?)/i;

/** Up to two follow-up pages: one product or category page, one payment/delivery help page. */
function pickExtraPages(links, homeUrl) {
  const home = String(homeUrl).replace(/\/$/, '');
  const ok = links.filter(l => !SKIP_RE.test(l.url) && l.url.replace(/\/$/, '') !== home);
  const help = ok.find(l => HELP_TEXT_RE.test(l.text) && /支払|決済|配送|送料|お届け|payment|shipping|delivery/i.test(l.text))
    || ok.find(l => HELP_TEXT_RE.test(l.text) && HELP_URL_RE.test(l.url))
    || ok.find(l => HELP_URL_RE.test(l.url));
  const isHelpish = u => HELP_URL_RE.test(u) || /^https?:\/\/(?:help|support|faq)\./i.test(u) || /\/hc\/[a-z-]+\//i.test(u);
  const prod = ok.find(l => PRODUCT_RE.test(l.url) && !isHelpish(l.url) && (!help || l.url !== help.url));
  return [prod && { url: prod.url, kind: 'product_or_category' }, help && { url: help.url, kind: 'help' }].filter(Boolean).slice(0, MAX_EXTRA_PAGES);
}

function decidePlatform(url, hits, storefronts = []) {
  const cms = hits.find(x => x.category === 'cms');
  const h = hostOf(url);
  const hp = HOST_PLATFORMS.find(x => x.re.test(h));
  if (hp) return { name: hp.name, confidence: 'high', evidence: `host ${h}` };
  const rank = { high: 3, medium: 2, low: 1 };
  const plats = hits.filter(x => x.category === 'platform').sort((a, b) => (rank[b.confidence] || 0) - (rank[a.confidence] || 0));
  const commerce = plats.filter(x => x.confidence !== 'low');
  if (!commerce.length && storefronts.length) {
    const where = [...new Set(storefronts.map(s => s.marketplace))].join(', ');
    return { name: `Marketplace storefront (${where})`, confidence: 'medium', evidence: `no own commerce platform found; the site links its store at ${storefronts[0].url}${cms ? `; the site itself runs on ${cms.name}` : ''}` };
  }
  if (!plats.length) return cms
    ? { name: `${cms.name} site, commerce platform unidentified`, confidence: 'low', evidence: `${cms.proves}: "${cms.match}"; no commerce platform signature on the pages read` }
    : { name: 'Custom or unidentified', confidence: 'low', evidence: 'no known platform signature on the pages read' };
  const top = plats[0];
  return { name: top.name, confidence: top.confidence || 'medium', evidence: `${top.proves}: "${top.match}" (${top.url || 'page'})` };
}

/** Links to the player's own storefront on a marketplace (Yahoo! / Rakuten / Amazon store hosting). */
const STOREFRONT_RES = [
  { marketplace: 'Yahoo! Shopping', re: /https?:\/\/store\.shopping\.yahoo\.co\.jp\/[a-z0-9_-]+\/?/gi },
  { marketplace: 'Rakuten Ichiba', re: /https?:\/\/(?:www\.)?rakuten\.co\.jp\/[a-z0-9_-]+\/?(?=["'\s<>?])/gi },
  { marketplace: 'Rakuten Ichiba', re: /https?:\/\/item\.rakuten\.co\.jp\/[a-z0-9_-]+\/?/gi },
  { marketplace: 'Amazon', re: /https?:\/\/(?:www\.)?amazon\.co\.jp\/stores\/[^"'\s<>]+/gi },
];
function detectStorefronts(html, homeUrl) {
  const own = hostOf(homeUrl);
  if (HOST_PLATFORMS.some(x => x.re.test(own))) return [];
  const out = [];
  for (const s of STOREFRONT_RES) for (const m of String(html || '').matchAll(s.re)) {
    const url = m[0].replace(/\/$/, '');
    if (/\/(?:category|search|event|gold|info|guide)$/i.test(url) || out.some(o => o.url === url)) continue;
    out.push({ marketplace: s.marketplace, url });
    if (out.length >= 5) return out;
  }
  return out;
}

/** Fold one player's page reads into the stack record. pages: [{url, kind, html}] */
function analyzePages(pages, homeUrl) {
  const allHits = [];
  const ld = new Set();
  let ldBlocks = 0;
  const app = { ios: null, android: null, smartBanner: false };
  const storefronts = [];
  for (const p of pages) {
    allHits.push(...detectSignatures(p.html, p.url));
    const j = jsonLdTypes(p.html);
    j.types.forEach(x => ld.add(x));
    ldBlocks += j.blocks;
    const a = detectApp(p.html);
    app.ios = app.ios || a.ios; app.android = app.android || a.android; app.smartBanner = app.smartBanner || a.smartBanner;
    for (const s of detectStorefronts(p.html, homeUrl)) if (!storefronts.some(o => o.url === s.url)) storefronts.push(s);
  }
  const categories = Object.fromEntries(CATEGORIES.map(c => [c, []]));
  for (const hit of allHits) {
    if (hit.category === 'platform' || hit.category === 'cms') continue;
    const list = categories[hit.category];
    if (!list || list.some(x => x.name === hit.name)) continue;
    list.push({ name: hit.name, evidence: `${hit.proves}: "${hit.match}"`, url: hit.url });
  }
  const cms = allHits.find(x => x.category === 'cms');
  return { platform: decidePlatform(homeUrl, allHits, storefronts), cms: cms ? cms.name : null, storefronts, categories, structuredData: { jsonLdTypes: [...ld], jsonLdBlocks: ldBlocks }, app };
}

// ── players ─────────────────────────────────────────────────────────────────
function loadPlayers(profile) {
  const players = require('../utils/players').playersFor(profile) || [];
  const target = { name: profile.name, url: profile.url, tier: profile.tier || null, relationship: 'self', role: 'target' };
  return [target, ...players.filter(p => p && p.url).map(p => ({ name: p.name, url: p.url, tier: p.tier || 'unknown', relationship: p.relationship || 'competitor', role: 'player' }))];
}

function manualCapturePath(slug, dataDir) {
  const dir = path.join(dataDir, 'brands', slug, 'manual_capture');
  try {
    const f = fs.readdirSync(dir).filter(x => x.endsWith('.html')).sort();
    const pick = f.find(x => x.startsWith(slug)) || f[0];
    return pick ? path.join(dir, pick) : null;
  } catch { return null; }
}

function describeFailure(r) {
  if (!r) return 'no response';
  if (r.skipped) return r.reason || 'not requested';
  if (r.blocked) return `blocked by the site (HTTP ${r.status}, bot or region block page)`;
  if (r.status === 403) return 'HTTP 403: the site refused the request (Japanese sites often block non-Japanese IPs)';
  if (r.error) return r.error;
  return `HTTP ${r.status}`;
}

/** Read one player. Returns { record, digests } */
async function readPlayer(pl, { fetchPage, slug, dataDir, lg, accessFor }) {
  const base = { name: pl.name, url: pl.url, tier: pl.tier, relationship: pl.relationship, role: pl.role };
  const siteAccess = require('../utils/site_access');
  const routeOf = accessFor || siteAccess.accessFor;
  const rawFetch = fetchPage;
  // Every proxied request writes the same line as the other modules, so a grep of the log for the
  // host shows the authorization on each one.
  fetchPage = async (url) => {
    let acc = null;
    try { acc = routeOf(url); } catch (_) {}
    if (acc && acc.mode === 'jp_proxy') lg(siteAccess.proxyLogLine(url, acc));
    return rawFetch(url);
  };
  let home;
  try { home = await fetchPage(pl.url); } catch (e) { home = { ok: false, error: e.message }; }
  const pages = [];
  let via = home && home.via;
  if (home && home.ok && home.text) {
    pages.push({ url: home.url || pl.url, kind: 'home', html: home.text });
    for (const extra of pickExtraPages(extractLinks(home.text, home.url || pl.url), home.url || pl.url)) {
      let r;
      try { r = await fetchPage(extra.url); } catch (e) { r = { ok: false, error: e.message }; }
      if (r && r.ok && r.text) pages.push({ url: r.url || extra.url, kind: extra.kind, html: r.text });
      else lg(`${pl.name}: ${extra.kind} page not read (${describeFailure(r)})`);
    }
  } else if (pl.role === 'target') {
    const mc = manualCapturePath(slug, dataDir);
    if (mc) {
      lg(`${pl.name}: live read failed (${describeFailure(home)}), using manual capture ${path.basename(mc)}`);
      pages.push({ url: pl.url, kind: 'home', html: fs.readFileSync(mc, 'utf8'), manual: true, capturedAt: fs.statSync(mc).mtime.toISOString() });
      via = 'manual_capture';
    }
  }
  if (!pages.length) return { failed: true, reason: describeFailure(home), base };
  const a = analyzePages(pages, pl.url);
  const manual = pages[0].manual;
  const record = {
    ...base, observed: true, via, observedAt: manual ? pages[0].capturedAt : new Date().toISOString(),
    pagesRead: pages.map(p => ({ url: p.url, kind: p.kind })), ...a,
    notes: manual ? `Homepage only, from the hand-saved capture (${pages[0].capturedAt.slice(0, 10)}); the live site was not read in this run.` : `${pages.length} page(s) read live.`,
  };
  const digests = pages.map(p => ({ url: p.url, kind: p.kind, digest: htmlToDigest(p.html) }));
  return { record, digests };
}

function summarize(players) {
  const obs = players.filter(p => p.observed);
  const platformShare = {};
  for (const p of obs) platformShare[p.platform.name] = (platformShare[p.platform.name] || 0) + 1;
  const mostCommon = {};
  for (const c of CATEGORIES) {
    const counts = {};
    for (const p of obs) for (const t of (p.categories[c] || [])) counts[t.name] = (counts[t.name] || 0) + 1;
    mostCommon[c] = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }
  const withJsonLd = obs.filter(p => p.structuredData.jsonLdTypes.length).length;
  const withApp = obs.filter(p => p.app.ios || p.app.android).length;
  return { observedPlayers: obs.length, totalPlayers: players.length, platformShare, mostCommon, withJsonLd, withApp };
}

async function run({ slug, dataDir = DATA_DIR_DEFAULT, fetchPage, accessFor = null, only = null, skipTarget = false, log: lg = log } = {}) {
  if (!slug) throw new Error('slug is required');
  const profile = readJson(path.join(dataDir, 'brands', slug, 'profile.json'));
  if (!profile) throw new Error('profile.json not found');
  fetchPage = fetchPage || require('../utils/site_access').fetchPage;
  const outFile = path.join(dataDir, 'brands', slug, 'tech_stack.json');
  const pagesFile = path.join(dataDir, 'brands', slug, 'tech_stack_pages.json');
  const prev = readJson(outFile);
  const prevPages = readJson(pagesFile);
  let players = loadPlayers(profile);
  if (skipTarget) players = players.filter(p => p.role !== 'target');
  if (only && only.length) players = players.filter(p => p.role === 'target' ? !skipTarget && only.includes(p.name) : only.includes(p.name));

  const records = [];
  const digests = {};
  for (const pl of players) {
    const key = pl.url;
    const saved = checkpoint.get(slug, STEP, key, { dataDir });
    if (saved && saved.record) { lg(`${pl.name}: resumed from checkpoint`); records.push(saved.record); digests[pl.name] = saved.digests || []; continue; }
    const res = await readPlayer(pl, { fetchPage, slug, dataDir, lg, accessFor });
    let rec, dig;
    if (!res.failed) { rec = res.record; dig = res.digests; }
    else {
      const old = prev && Array.isArray(prev.players) ? prev.players.find(p => p.url === pl.url && p.observed) : null;
      if (old) {
        lg(`${pl.name}: not read (${res.reason}); keeping previous data marked stale`);
        rec = { ...old, ...res.base, stale: true, staleReason: res.reason, lastAttempt: new Date().toISOString() };
        dig = (prevPages && prevPages.players && prevPages.players[pl.name]) || [];
      } else {
        lg(`${pl.name}: not observed (${res.reason})`);
        rec = { ...res.base, observed: false, via: 'none', reason: res.reason, pagesRead: [], platform: { name: 'Not observed', confidence: 'none', evidence: res.reason }, cms: null, storefronts: [], categories: Object.fromEntries(CATEGORIES.map(c => [c, []])), structuredData: { jsonLdTypes: [], jsonLdBlocks: 0 }, app: { ios: null, android: null, smartBanner: false }, notes: `Not observed: ${res.reason}. Nothing is assumed about this site.` };
        dig = [];
      }
    }
    records.push(rec);
    digests[pl.name] = dig;
    checkpoint.put(slug, STEP, key, { record: rec, digests: dig }, { dataDir });
    if (rec.observed) lg(`${pl.name}: ${rec.platform.name} (${rec.platform.confidence})${rec.stale ? ' [STALE]' : ''}, ${rec.pagesRead.length} page(s)`);
  }

  const output = { generatedAt: new Date().toISOString(), brandSlug: slug, signatureCount: SIGNATURES.length, players: records, summary: summarize(records) };
  try {
    if (prev) { const h = path.join(dataDir, 'brands', slug, 'history'); fs.mkdirSync(h, { recursive: true }); fs.writeFileSync(path.join(h, `tech_stack_${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(prev, null, 2)); }
  } catch (_) { /* history is best effort */ }
  writeJsonAtomic(outFile, output);
  writeJsonAtomic(pagesFile, { generatedAt: output.generatedAt, players: digests });
  checkpoint.clear(slug, STEP, { dataDir });
  lg(`wrote ${outFile}: ${output.summary.observedPlayers}/${output.summary.totalPlayers} players observed`);
  return { output };
}

module.exports = { run, SIGNATURES, CATEGORIES, detectSignatures, detectStorefronts, jsonLdTypes, detectApp, htmlToDigest, extractLinks, pickExtraPages, analyzePages, decidePlatform, loadPlayers, summarize };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
  const slug = arg('slug');
  const only = arg('only') ? arg('only').split(',').map(s => s.trim()).filter(Boolean) : null;
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }
  run({ slug, only, skipTarget: args.includes('--no-target') }).catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
}
