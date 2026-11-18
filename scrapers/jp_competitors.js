/**
 * Japan toy and baby retail player list, for scanning Toys"R"Us Japan.
 *
 * Every player carries a tier (marketplace | mass | specialty | niche, see
 * utils/players.js) and a relationship (competitor | partner). Don Quijote is
 * Toys"R"Us Japan's retail PARTNER (deal signed 2026-11; a shop-in-shop is
 * planned): it is studied as a channel and must never be scored as a
 * competitor. Approved starting set: business owner, 2026-11-18.
 *
 * Every entry in JP_COMPETITORS returned an HTTP status to ONE plain GET from
 * this tool's environment (curl -L, Accept-Language ja-JP, desktop Chrome UA,
 * no proxy) on its verifiedAt date. The status is recorded as seen. A 403 means
 * the domain is real and answering but walls off automation from a
 * non-Japanese IP; those need the Apify JP residential path.
 *
 * Social handles are only those linked from the URL's own HTML in that same
 * GET. None are guessed. An empty handle set means none were visible (often
 * because the page was a block or international landing page).
 *
 * Entries that produced no HTTP status, or whose domain could not be tied to
 * the business, are in JP_UNVERIFIED with the reason, and are deliberately
 * left out of the main list and the seed profile: a wrong domain wastes a paid
 * proxy run and produces an empty card.
 *
 * Note on page titles: several sites answer 200 with a restriction or global
 * landing page when the request is not from Japan. The notes say so; a 200
 * here proves the URL resolves, not that a foreign IP sees the storefront.
 */

const VERIFIED_AT = '2026-11-18';
const via = 'curl';
const ok = (status, extra = {}) => ({ date: VERIFIED_AT, status, via, ...extra });

const JP_COMPETITORS = [
  {
    // Not re-requested on 2026-11-18: nothing may request toysrus.co.jp (utils/no_contact.js).
    name: 'Toys"R"Us Japan',
    nameJa: 'トイザらス',
    url: 'https://www.toysrus.co.jp/',
    type: 'target',
    tier: 'specialty',
    relationship: 'self',
    notes: 'The scan target. Cloudflare challenge to curl and headless Chromium from a non-JP IP (checked 2026-11-16, not requested since).',
    verifiedAt: { date: '2026-11-16', status: 403, via: 'curl+chromium' },
  },

  // ---- marketplace / pure e-commerce ----
  {
    name: 'Amazon.co.jp Toys',
    nameJa: 'Amazon おもちゃ',
    url: 'https://www.amazon.co.jp/toys/',
    type: 'marketplace', tier: 'marketplace', relationship: 'competitor',
    rationale: 'Largest online marketplace in Japan; sets the delivery-speed and price expectation for toy shoppers.',
    notes: 'Redirects to /gp/browse.html?node=13299531. Title: Amazon | おもちゃ・玩具.',
    verifiedAt: ok(200),
  },
  {
    name: 'Rakuten Ichiba Toys',
    nameJa: '楽天市場 おもちゃ',
    url: 'https://www.rakuten.co.jp/category/566382/',
    type: 'marketplace', tier: 'marketplace', relationship: 'competitor',
    rationale: 'Points-driven mall marketplace where many toy shops, including chains, run storefronts.',
    notes: 'Curl gets 200 with a 43 byte Akamai reference body, so the status proves the URL answers, not the content. Chromium saw 【楽天市場】おもちゃの通販 on 2026-11-16.',
    verifiedAt: ok(200),
  },
  {
    name: 'Yahoo! Shopping Games and Toys',
    nameJa: 'Yahoo!ショッピング ゲーム、おもちゃ',
    url: 'https://shopping.yahoo.co.jp/category/2511/recommend',
    type: 'marketplace', tier: 'marketplace', relationship: 'competitor',
    rationale: 'PayPay-linked marketplace competing on points and campaigns for toy purchases.',
    notes: 'Title: ゲーム、おもちゃ 通販 - Yahoo!ショッピング. The /category/2511/ list view answered 500 to automation on 2026-11-16; /recommend answers 200.',
    verifiedAt: ok(200),
  },
  {
    name: 'Mercari',
    nameJa: 'メルカリ',
    url: 'https://jp.mercari.com/',
    type: 'marketplace', tier: 'marketplace', relationship: 'competitor',
    rationale: 'Largest resale app in Japan; secondhand and collectible toys compete with new-item sales.',
    notes: 'Title: メルカリ - 日本最大のフリマサービス.',
    handles: { xHandle: 'mercari_jp', facebookHandle: 'mercarijp' },
    verifiedAt: ok(200),
  },

  // ---- mass ----
  {
    name: 'AEON.com',
    nameJa: 'イオンドットコム',
    url: 'https://www.aeon.com/',
    type: 'general_merchandise', tier: 'mass', relationship: 'competitor',
    rationale: 'Largest general merchandise group in Japan with toy departments nationwide and online.',
    notes: 'AEON group portal. Toy assortment sits in AEON Style; no toy-specific URL confirmed. Also links x.com/iAEON_official (the app account, not recorded).',
    handles: { xHandle: 'AEON_JAPAN', facebookHandle: 'aeonretail' },
    verifiedAt: ok(200),
  },
  {
    name: 'Ito-Yokado',
    nameJa: 'イトーヨーカドー',
    url: 'https://www.itoyokado.co.jp/',
    type: 'general_merchandise', tier: 'mass', relationship: 'competitor',
    rationale: 'General merchandise chain with toy floors and seasonal toy catalogues.',
    notes: 'Title: イトーヨーカドー トップページ.',
    handles: { xHandle: 'lets_go_yokado', facebookHandle: 'itoyokado', instagramHandle: 'itoyokado_official', youtubeHandle: 'https://www.youtube.com/channel/UC9dz0cMdpw_BXiQF1P8LoZA' },
    verifiedAt: ok(200),
  },
  {
    name: 'Joshin',
    nameJa: 'ジョーシン',
    url: 'https://joshinweb.jp/',
    type: 'electronics_mass', tier: 'mass', relationship: 'competitor',
    rationale: 'Electronics chain with a large toy and hobby department and strong online sales.',
    notes: 'Access Denied to automation from a non-JP IP.',
    verifiedAt: ok(403),
  },
  {
    name: 'Nishimatsuya',
    nameJa: '西松屋',
    url: 'https://www.24028.jp/',
    type: 'baby_kids', tier: 'mass', relationship: 'competitor',
    rationale: 'Value baby and kids chain with a toy assortment at everyday low prices.',
    notes: 'Title: マタニティ・ベビー・子供服（～160㎝）など情報満載 | 西松屋. Also links a second YouTube (@cochococho_yt) and a LINE sticker page, not recorded.',
    handles: { instagramHandle: '24028.jp', youtubeHandle: 'https://www.youtube.com/channel/UCPc1yG6UsVnA1rI-ZKcYa0g' },
    verifiedAt: ok(200),
  },
  {
    name: 'Akachan Honpo',
    nameJa: 'アカチャンホンポ',
    url: 'https://www.akachan.jp/',
    type: 'baby_kids', tier: 'mass', relationship: 'competitor',
    rationale: 'Baby specialty chain; competes directly with Babies"R"Us Japan.',
    notes: 'Title: アカチャンホンポ｜赤ちゃん本舗.',
    handles: { instagramHandle: 'akachanhonpo_smile', tiktokHandle: 'akachanhonpo_official', facebookHandle: 'akachanhonpo', xHandle: 'akachanhonpo', youtubeHandle: 'https://www.youtube.com/channel/UCrW_zOFeyKcQQsfPAUkJBzw' },
    verifiedAt: ok(200),
  },

  // ---- specialty ----
  {
    name: 'Kiddy Land',
    nameJa: 'キデイランド',
    url: 'https://www.kiddyland.co.jp/',
    type: 'specialty_toy', tier: 'specialty', relationship: 'competitor',
    rationale: 'Character goods and toy specialty chain with flagship tourist stores.',
    notes: 'No social links in the homepage HTML returned to this GET.',
    verifiedAt: ok(200),
  },
  {
    name: 'Hakuhinkan Toy Park',
    nameJa: '博品館TOY PARK',
    url: 'https://www.hakuhinkan.co.jp/toypark/',
    type: 'specialty_toy', tier: 'specialty', relationship: 'competitor',
    rationale: 'Ginza destination toy store; benchmark for experiential and gift-led toy retail.',
    notes: 'Linked as ./toypark/ from the hakuhinkan.co.jp homepage. Title: 博品館TOY PARK.',
    handles: { xHandle: 'toypark_ginza', facebookHandle: 'HAKUHINKANTOYPARK', instagramHandle: 'hakuhinkan_toypark' },
    verifiedAt: ok(200),
  },
  {
    name: 'Pokemon Center Online',
    nameJa: 'ポケモンセンターオンライン',
    url: 'https://www.pokemoncenter-online.com/',
    type: 'manufacturer_direct', tier: 'specialty', relationship: 'competitor',
    rationale: 'Official Pokemon goods and card store; captures the biggest character franchise directly.',
    notes: 'Title: ポケモンセンターオンライン. The page also links Instagram pokemon_jpn, Facebook PokemonCoJp and YouTube PokemonCoJp, which are The Pokemon Company corporate accounts, not the store; only the store X account is recorded.',
    handles: { xHandle: 'pokemoncenterPR' },
    verifiedAt: ok(200),
  },
  {
    name: 'Premium Bandai',
    nameJa: 'プレミアムバンダイ',
    url: 'https://p-bandai.jp/',
    type: 'manufacturer_direct', tier: 'specialty', relationship: 'competitor',
    rationale: 'Bandai Namco direct store for limited and pre-order figures and collectibles.',
    notes: 'From a non-JP IP redirects to /global_newpc.html (international page). Needs a JP IP for the domestic store.',
    verifiedAt: ok(200, { finalUrl: 'https://p-bandai.jp/global_newpc.html' }),
  },
  {
    name: 'Sanrio Online Shop',
    nameJa: 'サンリオオンラインショップ',
    url: 'https://shop.sanrio.co.jp/',
    type: 'manufacturer_direct', tier: 'specialty', relationship: 'competitor',
    rationale: 'Sanrio direct store; character goods sold to kids and adult fans.',
    notes: 'Answers 200 with a restriction page (制限について) to a non-JP IP. Needs a JP IP for content.',
    verifiedAt: ok(200),
  },

  // ---- niche ----
  {
    name: 'Bornelund',
    nameJa: 'ボーネルンド',
    url: 'https://www.bornelund.co.jp/',
    type: 'specialty_toy', tier: 'niche', relationship: 'competitor',
    rationale: 'Premium educational and play-equipment importer and retailer with indoor play spaces.',
    notes: 'Title: ボーネルンド オフィシャルサイト｜世界の優れたあそび道具.',
    handles: { instagramHandle: 'bornelund', xHandle: 'BorneLund_PL' },
    verifiedAt: ok(200),
  },
  {
    name: 'Gashapon Official (Bandai)',
    nameJa: 'ガシャポンオフィシャルサイト',
    url: 'https://gashapon.jp/',
    type: 'manufacturer_direct', tier: 'niche', relationship: 'competitor',
    rationale: 'Bandai capsule toys and official Gashapon shops; impulse and collectible spend.',
    notes: 'Title: ガシャポンオフィシャルサイト. Shop locator and official shops are part of this site.',
    handles: { xHandle: 'Gashapon_Bandai', instagramHandle: 'gashapon_instabu', tiktokHandle: 'gashapon_bandai', youtubeHandle: 'https://www.youtube.com/channel/UC2lvffCZhyY8Z5ZIKGIiDwQ', lineId: '@wvp1993r' },
    verifiedAt: ok(200),
  },
  {
    name: 'Animate Online Shop',
    nameJa: 'アニメイト通販',
    url: 'https://www.animate-onlineshop.jp/',
    type: 'specialty_hobby', tier: 'niche', relationship: 'competitor',
    rationale: 'Anime and character goods chain; competes for teen and adult collector spend.',
    notes: 'Answers 403 with an アクセス制限のお知らせ page to a non-JP IP.',
    verifiedAt: ok(403),
  },

  // ---- partner ----
  {
    name: 'Don Quijote',
    nameJa: 'ドン・キホーテ',
    url: 'https://www.donki.com/',
    type: 'discount_general', tier: 'mass', relationship: 'partner',
    rationale: 'PARTNER, not a competitor: Toys"R"Us Japan retail partner (deal signed; shop-in-shop inside Don Quijote planned, not open). Studied as a channel.',
    notes: 'Title: 驚安の殿堂 ドン・キホーテ. Also links LINE via lin.ee/OehESzw (a short link, not a LINE id; not recorded).',
    handles: { instagramHandle: 'donki_jp', tiktokHandle: 'donki_cp', facebookHandle: 'donki.majicaglobal.jp', xHandle: 'donki_donki', youtubeHandle: 'https://www.youtube.com/user/DonQuijotekoushiki' },
    verifiedAt: ok(200),
  },
];

// Approved candidates with no usable HTTP status, or no confirmed domain. Reason as observed.
// curl exit 92 is an HTTP/2 stream reset (PROTOCOL_ERROR) before any status: a network-level
// block of non-JP automation, not a wrong domain. Those are tier-tagged so a JP-IP check can
// promote them without re-deciding the tier.
const JP_UNVERIFIED = [
  {
    name: 'Yodobashi', nameJa: 'ヨドバシカメラ', url: 'https://www.yodobashi.com/', tier: 'mass', relationship: 'competitor',
    why: '2026-11-18: one GET, HTTP/2 stream reset (curl exit 92), no status. Same on 2026-11-16 with Chromium. Network-level block; confirm via Apify JP proxy.',
  },
  {
    name: 'Bic Camera', nameJa: 'ビックカメラ', url: 'https://www.biccamera.com/', tier: 'mass', relationship: 'competitor',
    why: '2026-11-18: one GET, HTTP/2 stream reset (curl exit 92), no status. Same on 2026-11-16 with Chromium. Network-level block; confirm via Apify JP proxy.',
  },
  {
    name: 'Yamada Denki', nameJa: 'ヤマダデンキ', url: 'https://www.yamada-denkiweb.com/', tier: 'mass', relationship: 'competitor',
    why: '2026-11-18: one GET, HTTP/2 stream reset (curl exit 92), no status. Same on 2026-11-16 with Chromium. Network-level block; confirm via Apify JP proxy.',
  },
  {
    name: 'Takara Tomy Mall', nameJa: 'タカラトミーモール', url: 'https://takaratomymall.jp/', tier: 'specialty', relationship: 'competitor',
    why: '2026-11-18: one GET, HTTP/2 stream reset (curl exit 92), no status. Domain is linked from the takaratomy.co.jp homepage (seen 2026-11-16), so likely a bot wall, not a wrong domain. Confirm via Apify JP proxy.',
  },
  {
    name: 'Yamashiroya', nameJa: '山城屋', url: '', tier: 'specialty', relationship: 'competitor',
    why: '2026-11-18: domain unconfirmed. yamashiroya.co.jp answers 200 but is a Kyoto dried-goods shop (京の乾物屋 山城屋), and yamashiroya.jp is a discount supermarket (やましろや). Neither is the Ueno toy store. Needs the domain from a primary source.',
  },
  {
    name: 'Hamleys Japan', nameJa: 'ハムリーズ', url: 'https://hamleys.jp/', tier: 'niche', relationship: 'competitor',
    why: '2026-11-18: one GET timed out after 25s (curl exit 28), no status; TCP connect also timed out on 2026-11-16. Possibly closed (owner flagged this); the domain could not be confirmed from Hamleys\' own site. Not verified open.',
  },
  {
    name: 'Toy Kingdom', nameJa: '', url: '', tier: 'unknown', relationship: 'competitor',
    why: 'Not checked: no Japanese retailer of this name could be tied to a domain from a primary source, so there was no URL to request. Not in the approved set.',
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
 * Entries keep tier and relationship. A caller that scores competitors must
 * drop relationship 'partner' (utils/players.js isPartner).
 *
 * @param {string} targetUrl
 * @returns {Array<{name,nameJa,url,type,tier,relationship,notes,verifiedAt}>}
 */
function jpCompetitorsFor(targetUrl) {
  const target = bareHost(targetUrl);
  return JP_COMPETITORS
    .filter(c => !target || bareHost(c.url) !== target)
    // a site this tool must not request is never offered as a competitor to scan
    .filter(c => require('../utils/no_contact').hostAllowed(c.url))
    .map(c => ({ ...c, verifiedAt: { ...c.verifiedAt }, ...(c.handles ? { handles: { ...c.handles } } : {}) }));
}

/**
 * Profile identifiedCompetitors entries for a target: the shape the seed
 * profile and the live-profile migration use. Handles are flattened onto the
 * entry (instagramHandle, xHandle, ...), as the rest of the app reads them.
 */
function jpProfilePlayers(targetUrl) {
  return jpCompetitorsFor(targetUrl)
    .filter(c => c.type !== 'target')
    .map(c => ({
      name: c.name,
      nameJa: c.nameJa,
      url: c.url,
      tier: c.tier,
      relationship: c.relationship,
      rationale: c.rationale,
      ...(c.handles || {}),
      verifiedAt: { ...c.verifiedAt },
    }));
}

module.exports = { JP_COMPETITORS, JP_UNVERIFIED, jpCompetitorsFor, jpProfilePlayers, VERIFIED_AT };
