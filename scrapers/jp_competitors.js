/**
 * Japan toy and baby retail competitor seed list, for scanning Toys"R"Us Japan.
 *
 * Every entry in JP_COMPETITORS returned an HTTP status to a single request
 * from this tool's environment (curl and/or one headless Chromium load, ja-JP
 * locale, no proxy) on the verifiedAt date. The status is recorded as seen. A
 * 403 means the domain is real and answering but walls off automation from a
 * non-Japanese datacentre IP; those need the Apify JP residential path.
 *
 * Entries that never produced an HTTP status are in JP_UNVERIFIED with the
 * reason. They are deliberately not in the main list: a seed list that hands
 * the scanner a wrong domain wastes a paid proxy run and produces an empty
 * competitor card.
 *
 * Note on page titles: several sites answer 200 with a restriction or global
 * landing page when the request is not from Japan. The notes say so; a 200
 * here proves the URL resolves, not that a foreign IP sees the storefront.
 */

const VERIFIED_AT = '2026-11-16';

const JP_COMPETITORS = [
  {
    name: 'Toys"R"Us Japan',
    nameJa: 'トイザらス',
    url: 'https://www.toysrus.co.jp/',
    type: 'target',
    notes: 'The scan target. Cloudflare challenge ("Attention Required!") to curl and headless Chromium from a non-JP IP.',
    verifiedAt: { date: VERIFIED_AT, status: 403, via: 'curl+chromium' },
  },
  {
    name: 'Amazon.co.jp Toys',
    nameJa: 'Amazon おもちゃ',
    url: 'https://www.amazon.co.jp/toys/',
    type: 'marketplace',
    notes: 'Redirects to /gp/browse.html?node=13299531. Title: Amazon | おもちゃ・玩具.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl+chromium' },
  },
  {
    name: 'Rakuten Ichiba Toys',
    nameJa: '楽天市場 おもちゃ',
    url: 'https://www.rakuten.co.jp/category/566382/',
    type: 'marketplace',
    notes: 'Title: 【楽天市場】おもちゃの通販 (Chromium). Curl gets a 43 byte Akamai reference body with status 200, so curl alone is not proof here.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'chromium' },
  },
  {
    name: 'Yahoo! Shopping Games and Toys',
    nameJa: 'Yahoo!ショッピング ゲーム、おもちゃ',
    url: 'https://shopping.yahoo.co.jp/category/2511/recommend',
    type: 'marketplace',
    notes: 'Category 2511 taken from the Yahoo! Shopping homepage menu. The /category/2511/ list view answers 500 to automation; /recommend answers 200.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl+chromium' },
  },
  {
    name: 'Kiddy Land',
    nameJa: 'キデイランド',
    url: 'https://www.kiddyland.co.jp/',
    type: 'specialty_toy',
    notes: 'Character goods and toy specialty chain.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl+chromium' },
  },
  {
    name: 'Nishimatsuya',
    nameJa: '西松屋',
    url: 'https://www.24028.jp/',
    type: 'baby_kids',
    notes: 'Baby and kids value chain with a toy assortment.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl+chromium' },
  },
  {
    name: 'Akachan Honpo',
    nameJa: 'アカチャンホンポ',
    url: 'https://www.akachan.jp/',
    type: 'baby_kids',
    notes: 'Baby specialty chain; competes with Babies"R"Us Japan.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl+chromium' },
  },
  {
    name: 'Premium Bandai',
    nameJa: 'プレミアムバンダイ',
    url: 'https://p-bandai.jp/',
    type: 'manufacturer_direct',
    notes: 'From a non-JP IP redirects to /global_newpc.html (international page). Needs a JP IP for the domestic store.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl+chromium' },
  },
  {
    name: 'Sanrio Online Shop',
    nameJa: 'サンリオオンラインショップ',
    url: 'https://shop.sanrio.co.jp/',
    type: 'manufacturer_direct',
    notes: 'Answers 200 with a restriction page (制限について) to a non-JP IP. Needs a JP IP for content.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl+chromium' },
  },
  {
    name: 'Don Quijote',
    nameJa: 'ドン・キホーテ',
    url: 'https://www.donki.com/',
    type: 'discount_general',
    notes: 'Curl 200. Headless Chromium timed out at 20s on domcontentloaded.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl' },
  },
  {
    name: 'AEON.com',
    nameJa: 'イオンドットコム',
    url: 'https://www.aeon.com/',
    type: 'general_merchandise',
    notes: 'AEON group portal. Toy assortment sits in AEON Style; no toy-specific URL confirmed.',
    verifiedAt: { date: VERIFIED_AT, status: 200, via: 'curl+chromium' },
  },
  {
    name: 'Joshin',
    nameJa: 'ジョーシン',
    url: 'https://joshinweb.jp/',
    type: 'electronics_mass',
    notes: 'Electronics chain with a large toy and hobby department. Access Denied to automation from a non-JP IP.',
    verifiedAt: { date: VERIFIED_AT, status: 403, via: 'curl+chromium' },
  },
];

// Candidates that produced no HTTP status. Reason recorded as observed.
const JP_UNVERIFIED = [
  {
    name: 'Takara Tomy Mall', nameJa: 'タカラトミーモール', url: 'https://takaratomymall.jp/',
    why: 'Domain taken from the takaratomy.co.jp homepage, which links to https://takaratomymall.jp, and DNS resolves (Akamai). But curl and Chromium both get an HTTP/2 stream reset, so no status. Likely a bot wall, not a wrong domain. Retry via Apify JP proxy.',
  },
  {
    name: 'Hamleys Japan', nameJa: 'ハムリーズ', url: 'https://hamleys.jp/',
    why: 'DNS resolves but TCP connect timed out (curl 10s, Chromium 20s). Could not confirm the domain from Hamleys\' own site: hamleys.com served a Cloudflare challenge and robots.txt lists no sitemap. Domain unconfirmed.',
  },
  {
    name: 'Yodobashi', nameJa: 'ヨドバシカメラ', url: 'https://www.yodobashi.com/',
    why: 'HTTP/2 stream reset to curl and Chromium (network-level block). Retry via Apify JP proxy.',
  },
  {
    name: 'Bic Camera', nameJa: 'ビックカメラ', url: 'https://www.biccamera.com/',
    why: 'HTTP/2 stream reset to curl and Chromium (network-level block). Retry via Apify JP proxy.',
  },
  {
    name: 'Yamada Denki', nameJa: 'ヤマダデンキ', url: 'https://www.yamada-denkiweb.com/',
    why: 'HTTP/2 stream reset to curl and Chromium (network-level block). Retry via Apify JP proxy.',
  },
  {
    name: 'Toy Kingdom', nameJa: '', url: '',
    why: 'Not checked: no Japanese retailer of this name could be tied to a domain from a primary source in this pass, so there was no URL to request.',
  },
];

const bareHost = u => {
  try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
};

/**
 * The verified list minus the scan target. The target is matched by host so
 * www and path differences do not matter. Entries typed 'target' are dropped
 * only when they match the given URL, so scanning a different brand keeps
 * Toys"R"Us Japan in its competitor set.
 *
 * @param {string} targetUrl
 * @returns {Array<{name,nameJa,url,type,notes,verifiedAt}>}
 */
function jpCompetitorsFor(targetUrl) {
  const target = bareHost(targetUrl);
  return JP_COMPETITORS
    .filter(c => !target || bareHost(c.url) !== target)
    // a site this tool must not request is never offered as a competitor to scan
    .filter(c => require('../utils/no_contact').hostAllowed(c.url))
    .map(c => ({ ...c, verifiedAt: { ...c.verifiedAt } }));
}

module.exports = { JP_COMPETITORS, JP_UNVERIFIED, jpCompetitorsFor, VERIFIED_AT };
