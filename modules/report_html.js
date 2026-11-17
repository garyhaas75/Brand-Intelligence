'use strict';
/**
 * Printable bilingual brand report.
 *
 * renderReport({ profile, brandName, data, lang, generatedAt }) returns one
 * complete standalone HTML document (inline CSS, no scripts, no external
 * requests) laid out for A4 print. `data` holds the module outputs, each of
 * which may be null:
 *   competitive_analysis, personas, social_intelligence, site_intelligence,
 *   search_seo, action_plan, marketplace, jp_demand
 * The caller has already localized the data for `lang`. Only the chrome
 * (titles, labels, table headers) comes from the dictionaries below.
 *
 * Rules: every string is HTML-escaped, objects are never stringified, image
 * and base64 fields are never read, a section with nothing to show renders a
 * short "no data yet" note, and stale or blocked inputs are labelled where
 * they appear and again in the data notes section.
 */

const DICT = {
  en: {
    docTitle: 'Brand Intelligence Report',
    subtitle: 'Competitive intelligence report',
    brand: 'Brand',
    generated: 'Generated',
    market: 'Market',
    industry: 'Industry',
    website: 'Website',
    contents: 'Contents',
    pagePrefix: 'Page ',
    pageSuffix: '',
    s_summary: 'Executive summary',
    s_action: 'Action plan',
    s_competitors: 'Competitor landscape',
    s_website: 'Website and navigation',
    s_marketplace: 'Marketplace',
    s_social: 'Social media',
    s_personas: 'Customer personas',
    s_search: 'Search and AI visibility',
    s_demand: 'Demand and trends',
    s_notes: 'Data notes',
    noData: 'No data yet for this section. It will appear after the next successful run.',
    stale: 'Stale',
    staleNote: 'Data from {date}, not refreshed in the latest run.',
    blocked: 'Blocked',
    targetBlocked: "The brand's own website blocks automated access, so no pages could be collected from it. Statements about the site are based on the blocked response and on competitor data.",
    target: 'Target',
    competitor: 'Competitor',
    keyFacts: 'At a glance',
    competitorsTracked: 'Competitors tracked',
    personasCount: 'Customer personas',
    aiVisibility: 'AI visibility score',
    winsCount: 'Immediate wins',
    topPriorities: 'Top priorities',
    keyInsights: 'Key insights',
    name: 'Name',
    role: 'Role',
    pricingTier: 'Price tier',
    positioning: 'Positioning',
    strengths: 'Strengths',
    opportunities: 'Opportunities for us',
    assortment: 'Assortment highlights',
    positioningMap: 'Positioning map',
    whiteSpace: 'White space',
    assortmentGaps: 'Top assortment gaps',
    identifiedCompetitors: 'Competitors identified',
    rationale: 'Rationale',
    competitorAnalysisPending: 'The detailed competitor analysis has not run yet. These are the competitors identified for the scan.',
    immediateWins: 'Immediate wins',
    rank: '#',
    action: 'Action',
    detail: 'Detail',
    effort: 'Effort',
    impact: 'Impact',
    source: 'Source',
    roadmap: 'Roadmap',
    day30: 'First 30 days',
    day60: '31 to 60 days',
    day90: '61 to 90 days',
    owner: 'Owner',
    metric: 'Success metric',
    gapsToClose: 'Competitive gaps to close',
    gap: 'Gap',
    priority: 'Priority',
    opportunitiesRanked: 'Ranked opportunities',
    opportunity: 'Opportunity',
    estImpact: 'Estimated impact',
    sitesReviewed: 'Sites reviewed',
    status: 'Status',
    collected: 'Collected',
    error: 'Error',
    navItems: 'Navigation items',
    featuredCats: 'Featured categories',
    heroHeadline: 'Hero headline',
    navGaps: 'Navigation gaps',
    category: 'Category',
    competitorsWithIt: 'Competitors with it',
    messagingGaps: 'Messaging gaps',
    competitorExample: 'Competitor example',
    recommendation: 'Recommendation',
    ctaTitle: 'Calls to action',
    rating: 'Rating',
    observations: 'Observations',
    topOpportunities: 'Top opportunities',
    crawlerTitle: 'Crawler and AI readability',
    heroLive: 'Hero text is live HTML',
    contentInImages: 'Content inside images',
    missingCategories: 'Missing categories',
    contentGaps: 'Content gaps',
    lighthouse: 'Lighthouse scores',
    performance: 'Performance',
    accessibility: 'Accessibility',
    bestPractices: 'Best practices',
    seo: 'SEO',
    yes: 'Yes',
    no: 'No',
    unknown: 'Unknown',
    sources: 'Sources',
    topItems: 'Top items',
    product: 'Product',
    priceJpy: 'Price (JPY)',
    reviewCount: 'Reviews',
    brandMix: 'Brand mix in top listings',
    count: 'Count',
    reviewSamples: 'Customer review samples',
    reviewsCollected: 'Reviews collected',
    pagesNotRead: 'Pages that could not be read',
    reason: 'Reason',
    accounts: 'Accounts reviewed',
    platform: 'Platform',
    account: 'Account',
    postsAnalysed: 'Posts analysed',
    avgEngagement: 'Avg engagement per post',
    perWeek: 'Posts per week',
    themes: 'Content themes',
    hashtags: 'Top hashtags',
    bestDay: 'Best posting day',
    format: 'Format',
    socialWhiteSpace: 'White space opportunities',
    howToCompete: 'How to compete',
    tactic: 'Tactic',
    notFound: 'Not found',
    st_ok: 'Collected',
    st_notApplicable: 'Not found',
    st_noData: 'No posts returned',
    st_presenceOnly: 'Presence only',
    d_monday: 'Monday',
    d_tuesday: 'Tuesday',
    d_wednesday: 'Wednesday',
    d_thursday: 'Thursday',
    d_friday: 'Friday',
    d_saturday: 'Saturday',
    d_sunday: 'Sunday',
    v_high: 'High',
    v_medium: 'Medium',
    v_low: 'Low',
    age: 'Age',
    income: 'Income',
    location: 'Location',
    occupation: 'Occupation',
    lifestyle: 'Lifestyle',
    values: 'Values',
    behaviors: 'Shopping behaviour',
    painPoints: 'Pain points',
    motivators: 'Motivators',
    channels: 'Preferred channels',
    contentTopics: 'Content topics',
    brandFit: 'Brand fit',
    quote: 'In their words',
    summaryInsights: 'Summary insights',
    onPage: 'On-page SEO',
    page: 'Page',
    titleTag: 'Title tag',
    metaDesc: 'Meta description',
    h1: 'H1',
    sitemap: 'Sitemap',
    found: 'Found',
    urlsListed: 'URLs listed',
    priorityActions: 'Priority actions',
    why: 'Why it matters',
    benchmarks: 'Competitor benchmarks',
    signal: 'Signal',
    ours: 'Ours',
    theirs: 'Competitor value',
    keywordClusters: 'Keyword clusters',
    intent: 'Intent',
    monthlySearches: 'Est. monthly searches',
    keywords: 'Keywords',
    geo: 'AI assistant visibility',
    visibility: 'Visibility score',
    queriesTested: 'Queries tested',
    query: 'Query',
    mentioned: 'Brand mentioned',
    mentionPosition: 'Position',
    serp: 'Search rankings',
    notChecked: 'Not checked',
    trends: 'Search interest',
    term: 'Search term',
    meaning: 'Meaning',
    avgInterest: 'Average interest',
    related: 'Related searches',
    noTrend: 'No trend data returned',
    demographics: 'Demographics',
    notes: 'Notes',
    notesIntro: 'What this report could and could not see, with dates.',
    freshness: 'Data freshness by module',
    module: 'Module',
    updated: 'Last updated',
    notAvailable: 'Not available',
    staleItems: 'Stale items carried forward',
    item: 'Item',
    asOf: 'Data as of',
    lastError: 'Last error',
    blockedItems: 'Blocked or skipped sources',
    otherNotes: 'Other notes',
    noIssues: 'No stale, blocked or missing data was recorded.',
    partialRun: 'The last marketplace run stopped early. Earlier data was kept for: {list}',
    socialNotFound: 'Social account not found or not readable',
    moreRows: '{n} more not shown.',
    partial: 'Partial',
    included: 'Included',
    noDataYet: 'No data yet',
    emptySections: 'No data yet for: {list}. These sections will appear after the next successful run.',
    competitorsPartial: 'Competitors identified; the detailed analysis has not run yet',
    includesStale: 'Includes items carried forward from an earlier run',
    r_notConnected: 'Optional data source not connected',
    r_permission: 'The data service needs an account permission',
    r_blocked: 'The site restricts automated access',
    r_busy: 'The site was too busy when we collected this',
    r_unreachable: 'The page could not be reached',
    r_timeout: 'The site took too long to respond',
    r_accountNotFound: 'No account was found',
    r_private: 'The account is private or its posts could not be read',
    r_noPosts: 'No posts were returned',
    r_notReached: 'Not collected because the run stopped early',
    r_generic: 'Collection issue (see run log)',
  },
  ja: {
    docTitle: 'ブランド・インテリジェンス・レポート',
    subtitle: '競合インテリジェンス・レポート',
    brand: '対象ブランド',
    generated: '作成日',
    market: '市場',
    industry: '業種',
    website: 'ウェブサイト',
    contents: '目次',
    pagePrefix: '',
    pageSuffix: ' ページ',
    s_summary: 'エグゼクティブサマリー',
    s_action: 'アクションプラン',
    s_competitors: '競合環境',
    s_website: 'ウェブサイトとナビゲーション',
    s_marketplace: 'マーケットプレイス動向',
    s_social: 'ソーシャルメディア',
    s_personas: '顧客ペルソナ',
    s_search: '検索・AIでの露出状況',
    s_demand: '需要とトレンド',
    s_notes: 'データに関する注記',
    noData: 'このセクションのデータはまだありません。次回の分析が正常に完了すると表示されます。',
    stale: '旧データ',
    staleNote: '{date}時点のデータです。最新の実行では更新できませんでした。',
    blocked: 'アクセス遮断',
    targetBlocked: '自社サイトが自動アクセスを遮断しているため、サイトのページを取得できませんでした。サイトに関する記述は、遮断時の応答内容と競合サイトのデータに基づいています。',
    target: '自社',
    competitor: '競合',
    keyFacts: '概要',
    competitorsTracked: '調査対象の競合数',
    personasCount: '顧客ペルソナ数',
    aiVisibility: 'AI露出スコア',
    winsCount: '即効性のある施策数',
    topPriorities: '最優先事項',
    keyInsights: '主なインサイト',
    name: '名称',
    role: '区分',
    pricingTier: '価格帯',
    positioning: 'ポジショニング',
    strengths: '強み',
    opportunities: '自社にとっての機会',
    assortment: '品揃えの特徴',
    positioningMap: 'ポジショニングマップ',
    whiteSpace: '未開拓の領域',
    assortmentGaps: '主な品揃えギャップ',
    identifiedCompetitors: '特定した競合',
    rationale: '選定理由',
    competitorAnalysisPending: '競合の詳細分析はまだ実行されていません。以下は今回の調査対象として特定した競合です。',
    immediateWins: 'すぐに着手できる施策',
    rank: '順位',
    action: '施策',
    detail: '内容',
    effort: '工数',
    impact: '効果',
    source: '出典',
    roadmap: 'ロードマップ',
    day30: '30日以内',
    day60: '31〜60日',
    day90: '61〜90日',
    owner: '担当',
    metric: '評価指標',
    gapsToClose: '解消すべき競合とのギャップ',
    gap: 'ギャップ',
    priority: '優先度',
    opportunitiesRanked: '優先順位付きの機会',
    opportunity: '機会',
    estImpact: '想定効果',
    sitesReviewed: '調査したサイト',
    status: '状態',
    collected: '取得済み',
    error: 'エラー',
    navItems: 'ナビゲーション項目数',
    featuredCats: '主要カテゴリー数',
    heroHeadline: 'メインビジュアルの見出し',
    navGaps: 'ナビゲーションのギャップ',
    category: 'カテゴリー',
    competitorsWithIt: '採用している競合',
    messagingGaps: 'メッセージのギャップ',
    competitorExample: '競合の事例',
    recommendation: '推奨事項',
    ctaTitle: 'CTA（行動喚起）',
    rating: '評価',
    observations: '所見',
    topOpportunities: '主な改善機会',
    crawlerTitle: 'クローラー・AIからの読み取りやすさ',
    heroLive: 'メインビジュアルの文言がHTMLテキストか',
    contentInImages: '画像内に埋め込まれた情報の量',
    missingCategories: '不足しているカテゴリー',
    contentGaps: 'コンテンツのギャップ',
    lighthouse: 'Lighthouseスコア',
    performance: 'パフォーマンス',
    accessibility: 'アクセシビリティ',
    bestPractices: 'ベストプラクティス',
    seo: 'SEO',
    yes: 'はい',
    no: 'いいえ',
    unknown: '不明',
    sources: 'データソース',
    topItems: '上位商品',
    product: '商品',
    priceJpy: '価格（円）',
    reviewCount: 'レビュー数',
    brandMix: '上位掲載商品のブランド構成',
    count: '件数',
    reviewSamples: '顧客レビュー（抜粋）',
    reviewsCollected: '収集したレビュー',
    pagesNotRead: '取得できなかったページ',
    reason: '理由',
    accounts: '調査したアカウント',
    platform: 'プラットフォーム',
    account: 'アカウント',
    postsAnalysed: '分析した投稿数',
    avgEngagement: '投稿あたり平均エンゲージメント',
    perWeek: '週あたり投稿数',
    themes: 'コンテンツのテーマ',
    hashtags: '主なハッシュタグ',
    bestDay: '最も反応の良い曜日',
    format: '形式',
    socialWhiteSpace: '未開拓のコンテンツ機会',
    howToCompete: '競合への対抗策',
    tactic: '施策',
    notFound: '未検出',
    st_ok: '取得済み',
    st_notApplicable: '未検出',
    st_noData: '投稿を取得できず',
    st_presenceOnly: 'アカウントの存在のみ確認',
    d_monday: '月曜日',
    d_tuesday: '火曜日',
    d_wednesday: '水曜日',
    d_thursday: '木曜日',
    d_friday: '金曜日',
    d_saturday: '土曜日',
    d_sunday: '日曜日',
    v_high: '高',
    v_medium: '中',
    v_low: '低',
    age: '年齢層',
    income: '収入',
    location: '居住地域',
    occupation: '職業',
    lifestyle: 'ライフスタイル',
    values: '価値観',
    behaviors: '購買行動',
    painPoints: '課題・不満',
    motivators: '購買の動機',
    channels: 'よく利用するチャネル',
    contentTopics: '関心のあるコンテンツ',
    brandFit: 'ブランドとの適合性',
    quote: '本人の声（想定）',
    summaryInsights: 'インサイトのまとめ',
    onPage: 'オンページSEO',
    page: 'ページ',
    titleTag: 'タイトルタグ',
    metaDesc: 'メタディスクリプション',
    h1: 'H1見出し',
    sitemap: 'サイトマップ',
    found: '検出',
    urlsListed: '掲載URL数',
    priorityActions: '優先施策',
    why: '重要な理由',
    benchmarks: '競合とのベンチマーク',
    signal: '項目',
    ours: '自社',
    theirs: '競合の値',
    keywordClusters: 'キーワードクラスター',
    intent: '検索意図',
    monthlySearches: '推定月間検索数',
    keywords: 'キーワード',
    geo: 'AIアシスタントでの露出',
    visibility: '露出スコア',
    queriesTested: '検証したクエリ数',
    query: 'クエリ',
    mentioned: 'ブランドへの言及',
    mentionPosition: '言及順位',
    serp: '検索順位',
    notChecked: '未確認',
    trends: '検索関心度',
    term: '検索語',
    meaning: '意味',
    avgInterest: '平均関心度',
    related: '関連検索語',
    noTrend: 'トレンドデータを取得できませんでした',
    demographics: '人口統計',
    notes: '注記',
    notesIntro: '本レポートで取得できたデータと取得できなかったデータを、日付とともに示します。',
    freshness: 'モジュール別のデータ更新日',
    module: 'モジュール',
    updated: '最終更新',
    notAvailable: 'データなし',
    staleItems: '前回データを引き継いだ項目',
    item: '項目',
    asOf: 'データ時点',
    lastError: '直近のエラー',
    blockedItems: '遮断またはスキップされたデータソース',
    otherNotes: 'その他の注記',
    noIssues: '旧データ、アクセス遮断、データ欠損の記録はありません。',
    partialRun: '前回のマーケットプレイス取得は途中で終了したため、次の項目は以前のデータを使用しています：{list}',
    socialNotFound: 'ソーシャルアカウントが見つからないか、読み取れませんでした',
    moreRows: 'ほか{n}件は省略しています。',
    partial: '一部のみ',
    included: '掲載',
    noDataYet: 'データなし',
    emptySections: '次のセクションはまだデータがありません：{list}。次回の分析が正常に完了すると表示されます。',
    competitorsPartial: '競合は特定済みですが、詳細分析は未実行です',
    includesStale: '前回実行時のデータを一部含みます',
    r_notConnected: '任意のデータソースが未接続です',
    r_permission: 'データ取得サービスのアカウント権限が必要です',
    r_blocked: 'サイトが自動アクセスを制限しています',
    r_busy: 'データ取得時にサイトが混雑していました',
    r_unreachable: 'ページに接続できませんでした',
    r_timeout: 'サイトの応答が時間内にありませんでした',
    r_accountNotFound: 'アカウントが見つかりませんでした',
    r_private: 'アカウントが非公開か、投稿を読み取れませんでした',
    r_noPosts: '投稿を取得できませんでした',
    r_notReached: '実行が途中で終了したため未取得です',
    r_generic: '取得時に問題が発生しました（実行ログを参照）',
  },
};

const SECTION_ORDER = [
  ['summary', 's_summary'],
  ['action', 's_action'],
  ['competitors', 's_competitors'],
  ['website', 's_website'],
  ['marketplace', 's_marketplace'],
  ['social', 's_social'],
  ['personas', 's_personas'],
  ['search', 's_search'],
  ['demand', 's_demand'],
  ['notes', 's_notes'],
];

const MODULE_KEYS = [
  ['action_plan', 's_action'],
  ['competitive_analysis', 's_competitors'],
  ['site_intelligence', 's_website'],
  ['marketplace', 's_marketplace'],
  ['social_intelligence', 's_social'],
  ['personas', 's_personas'],
  ['search_seo', 's_search'],
  ['jp_demand', 's_demand'],
];

// ---------- primitives ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

/** Primitive to display string. Objects, arrays, base64 and data URIs are never shown. */
function str(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return '';
  if (typeof v !== 'string') return '';
  let s = v;
  if (/^data:[^,]{0,80};base64,/i.test(s.trim())) return '';
  if (s.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(s)) return '';
  // House style: no em dashes in the document, even when the data carries them.
  s = s.replace(/\s*\u2014\s*/g, ', ');
  return s;
}

// Japanese typography. Set only for the duration of a synchronous renderReport('ja') call.
let JA_PUNCT = false;
const JCH = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uff66-\\uff9f\\u3005\\u3006\\u30fc]';
const RE_HAS_J = new RegExp(JCH);
const RE_URLISH = /(https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+|@[A-Za-z0-9_.]+)/g;

/**
 * Normalise ASCII punctuation next to Japanese text: ( ) around Japanese become （ ）,
 * ';' touching Japanese becomes '；', ',' between Japanese becomes '、'. URLs, emails,
 * handles, numbers and purely Latin strings are left alone.
 */
function jaPunctuate(s) {
  if (typeof s !== 'string' || !RE_HAS_J.test(s)) return s;
  return s.split(RE_URLISH).map((part, i) => {
    if (i % 2 === 1) return part; // captured URL, email or handle
    let x = part;
    x = x.replace(/\(([^()]*)\)/g, (m, inner) => (RE_HAS_J.test(inner) ? `（${inner}）` : m));
    x = x.replace(new RegExp(`(${JCH}|[）」』])\\s*;\\s*`, 'g'), '$1；');
    x = x.replace(new RegExp(`\\s*;\\s*(${JCH}|[（「『])`, 'g'), '；$1');
    x = x.replace(new RegExp(`(${JCH}|[）」』])\\s*,\\s*(?=${JCH}|[（「『])`, 'g'), '$1、');
    return x;
  }).join('');
}

/** Map a raw technical error or note to a plain-language reason key. Unknown input maps to r_generic. */
const REASON_RULES = [
  ['r_notReached', /not reached|run stopped|crash/i],
  ['r_permission', /approvePermissions|requires full access|approve its permissions|permission/i],
  ['r_private', /private|post data unavailable|profile stats only/i],
  ['r_notConnected', /\b[A-Z][A-Z0-9]*_(?:[A-Z0-9_]*_)?(?:KEY|ID|TOKEN|SECRET)\b|api[ _-]?key|app[ _-]?id|token|not set|not configured|missing key/i],
  ['r_busy', /overload|too many requests|\b429\b|\b503\b|rate.?limit|busy/i],
  ['r_timeout', /time[d]?[ _-]?out|ETIMEDOUT/i],
  ['r_unreachable', /net::ERR|ERR_[A-Z0-9_]+|ECONN|ENOTFOUND|EAI_AGAIN|socket hang|protocol error|HTTP2|unreachable|dns/i],
  ['r_blocked', /block|cloudflare|captcha|forbidden|\b403\b|access denied|attention required|bot[- ]?protect|skipApifyRetry|manual capture/i],
  ['r_noPosts', /no original posts|no posts|returned no/i],
  ['r_accountNotFound', /could not detect|handle_not_found|not found|no .{1,30} (account|channel) found|404/i],
];

function reasonKey(raw) {
  const s = typeof raw === 'string' ? raw : '';
  if (!s.trim()) return 'r_generic';
  for (const [k, re] of REASON_RULES) if (re.test(s)) return k;
  return 'r_generic';
}

function plainReason(raw, t) { return t(reasonKey(raw)); }

/** Short source label from a note like "rakuten api: ...". Never returns URLs, codes or env names. */
function noteLabel(raw) {
  const m = /^([A-Za-z][A-Za-z0-9 ._-]{1,24}):\s/.exec(typeof raw === 'string' ? raw : '');
  if (!m || /[A-Z]{2,}_|\/|\d{3}/.test(m[1])) return '';
  const l = m[1].trim();
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/** Escape for attribute values and <title>: no markup added. */
function escAttr(v) {
  const s0 = str(v);
  return (JA_PUNCT ? jaPunctuate(s0) : s0)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape for element text. Long unbroken Latin tokens (URLs, paths, ids) get <wbr> break
 * opportunities after separators and every 24 letters, so they wrap inside a table cell
 * instead of widening the table past the page.
 */
function esc(v) {
  return escAttr(v).replace(/[^\s<>]{28,}/g, (tok) => tok
    .replace(/([/_?=.,-])(?=[^\s])/g, '$1<wbr>')
    .replace(/([A-Za-z0-9]{24})(?=[A-Za-z0-9])/g, '$1<wbr>'));
}

function clip(v, n) {
  const s = str(v).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function makeT(lang) {
  const d = DICT[lang] || DICT.en;
  return (key, vars) => {
    let s = d[key] !== undefined ? d[key] : (DICT.en[key] !== undefined ? DICT.en[key] : key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

function fmtDate(v, lang) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return str(v);
  try {
    return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', { year: 'numeric', month: lang === 'ja' ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function fmtNum(v, lang, digits) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  try {
    return new Intl.NumberFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', { maximumFractionDigits: digits === undefined ? 1 : digits }).format(v);
  } catch {
    return String(v);
  }
}

/** Translate a fixed vocabulary value (high, medium, low) when the dictionary knows it. */
function vocab(v, t) {
  const s = str(v);
  const k = 'v_' + s.trim().toLowerCase();
  const out = t(k);
  return out === k ? s : out;
}

function dayName(v, t) {
  const s = str(v).trim().toLowerCase();
  const out = t('d_' + s);
  return out === 'd_' + s ? str(v) : out;
}

function table(headers, rows, opts = {}) {
  const body = rows.filter(r => r && r.some(c => c !== '' && c !== undefined && c !== null));
  if (!body.length) return '';
  const cls = opts.cls ? ` class="${opts.cls}"` : '';
  let h = `<table${cls}><thead><tr>${headers.map(x => `<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>`;
  for (const r of body) h += `<tr>${r.map(c => `<td>${c === undefined || c === null ? '' : c}</td>`).join('')}</tr>`;
  h += '</tbody></table>';
  if (opts.more > 0 && opts.t) h += `<p class="more">${esc(opts.t('moreRows', { n: opts.more }))}</p>`;
  return h;
}

function ul(items, max = 12) {
  const xs = arr(items).map(x => str(typeof x === 'string' ? x : (isObj(x) ? (x.text || x.title || x.name || x.recommendation || x.gap || '') : ''))).filter(Boolean).slice(0, max);
  if (!xs.length) return '';
  return `<ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
}

function h3(text) { return `<h3>${esc(text)}</h3>`; }
function para(text, cls) { const s = str(text); return s ? `<p${cls ? ` class="${cls}"` : ''}>${esc(s)}</p>` : ''; }

function staleTag(obj, t, lang) {
  if (!isObj(obj) || obj.stale !== true) return '';
  const date = fmtDate(obj.asOf || obj.dataFrom || obj.scrapedAt, lang) || t('unknown');
  return ` <span class="tag tag-stale" title="${escAttr(t('staleNote', { date }))}">${esc(t('stale'))} · ${esc(date)}</span>`;
}

function blockedTag(t) { return ` <span class="tag tag-blocked">${esc(t('blocked'))}</span>`; }

function noData(t) { return `<p class="nodata">${esc(t('noData'))}</p>`; }

function kv(pairs) {
  const xs = pairs.filter(([, v]) => v !== '' && v !== undefined && v !== null);
  if (!xs.length) return '';
  return `<dl class="kv">${xs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function bars(items, t) {
  const xs = items.filter(x => typeof x.value === 'number' && x.value > 0 && str(x.label));
  if (!xs.length) return '';
  const max = Math.max(...xs.map(x => x.value));
  return `<div class="bars">${xs.map(x => `<div class="bar-row"><span class="bar-label">${esc(clip(x.label, 40))}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, Math.round((x.value / max) * 100))}%"></span></span><span class="bar-val">${esc(fmtNum(x.value, 'en', 0))}</span></div>`).join('')}</div>`;
}

// ---------- target block detection ----------

function targetBlockedInfo(profile, data) {
  const site = data.site_intelligence;
  const target = isObj(site) ? arr(site.brands).find(b => isObj(b) && b.role === 'target') : null;
  const seoBlocked = isObj(data.search_seo) && isObj(data.search_seo.onPageSeo) && data.search_seo.onPageSeo.blocked === true;
  const scrape = isObj(profile) && isObj(profile.scrape) ? profile.scrape : {};
  const siteBlocked = !!(target && target.botBlocked === true);
  const skip = scrape.skipApifyRetry === true;
  return {
    blocked: siteBlocked || seoBlocked || (skip && !(target && (arr(target.navigation).length || arr(target.featuredCategories).length))),
    target,
  };
}

// ---------- sections ----------

function secSummary(ctx) {
  const { t, data, lang, blockInfo } = ctx;
  const ap = data.action_plan;
  const comp = data.competitive_analysis;
  const parts = [];
  if (blockInfo.blocked) parts.push(`<div class="callout callout-warn">${esc(t('targetBlocked'))}</div>`);
  if (isObj(ap) && str(ap.executiveSummary)) parts.push(para(ap.executiveSummary, 'lead'));

  const compCount = isObj(comp) ? arr(comp.competitors).length
    : (isObj(ctx.profile) ? arr(ctx.profile.identifiedCompetitors).length : 0);
  const facts = [];
  if (compCount) facts.push([t('competitorsTracked'), esc(String(compCount))]);
  if (isObj(data.personas) && arr(data.personas.personas).length) facts.push([t('personasCount'), esc(String(arr(data.personas.personas).length))]);
  const geo = isObj(data.search_seo) && isObj(data.search_seo.geoSection) ? data.search_seo.geoSection : null;
  const geoScore = geo ? (typeof geo.combinedScore === 'number' ? geo.combinedScore : geo.visibilityScore) : null;
  if (typeof geoScore === 'number') facts.push([t('aiVisibility'), esc(fmtNum(geoScore, lang, 0) + ' / 100')]);
  if (isObj(ap) && arr(ap.immediateWins).length) facts.push([t('winsCount'), esc(String(arr(ap.immediateWins).length))]);
  if (facts.length) parts.push(h3(t('keyFacts')) + `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="fact-val">${v}</div><div class="fact-label">${esc(k)}</div></div>`).join('')}</div>`);

  // Top priorities: the action plan first, otherwise the strongest per-module recommendations.
  let pri = [];
  if (isObj(ap)) pri = arr(ap.immediateWins).slice(0, 5).map(w => [str(w.title), str(w.description)]);
  if (!pri.length && isObj(data.site_intelligence)) pri = arr(data.site_intelligence.topOpportunities).slice(0, 3).map(o => [str(o.title), str(o.description)]);
  if (pri.length < 5 && isObj(data.search_seo)) pri = pri.concat(arr(data.search_seo.priorityActions).slice(0, 5 - pri.length).map(o => [str(o.action), str(o.why)]));
  pri = pri.filter(p => p[0]);
  if (pri.length) parts.push(h3(t('topPriorities')) + `<ol class="pri">${pri.map(([a, b]) => `<li><strong>${esc(a)}</strong>${b ? `<br><span>${esc(clip(b, 320))}</span>` : ''}</li>`).join('')}</ol>`);

  if (isObj(data.personas) && arr(data.personas.summaryInsights).length) parts.push(h3(t('keyInsights')) + ul(data.personas.summaryInsights, 6));
  return parts.join('');
}

function secAction(ctx) {
  const { t, data } = ctx;
  const ap = data.action_plan;
  if (!isObj(ap)) return '';
  const parts = [];
  if (str(ap.executiveSummary)) parts.push(para(ap.executiveSummary));
  const wins = arr(ap.immediateWins);
  if (wins.length) parts.push(h3(t('immediateWins')) + table([t('rank'), t('action'), t('detail'), t('effort'), t('impact')],
    wins.map((w, i) => [esc(str(w.rank) || String(i + 1)), `<strong>${esc(w.title)}</strong>`, esc(w.description), esc(vocab(w.effort, t)), esc(vocab(w.impact, t))])));
  if (isObj(ap.roadmap)) {
    let rm = '';
    for (const k of ['day30', 'day60', 'day90']) {
      const rows = arr(ap.roadmap[k]).map(r => [esc(r.action), esc(r.owner), esc(r.metric)]);
      const tb = table([t('action'), t('owner'), t('metric')], rows);
      if (tb) rm += `<h4>${esc(t(k))}</h4>` + tb;
    }
    if (rm) parts.push(h3(t('roadmap')) + rm);
  }
  const gaps = arr(ap.competitiveGapsToClose);
  if (gaps.length) parts.push(h3(t('gapsToClose')) + table([t('gap'), t('competitor'), t('priority')], gaps.map(g => [esc(g.gap), esc(g.competitor), esc(vocab(g.priority, t))])));
  const opps = arr(ap.opportunitiesRanked);
  if (opps.length) parts.push(h3(t('opportunitiesRanked')) + table([t('rank'), t('opportunity'), t('rationale'), t('estImpact')], opps.map((o, i) => [esc(str(o.rank) || String(i + 1)), `<strong>${esc(o.opportunity)}</strong>`, esc(o.rationale), esc(o.estimatedImpact)])));
  return parts.join('');
}

function secCompetitors(ctx) {
  const { t, data, lang, profile } = ctx;
  const ca = data.competitive_analysis;
  const parts = [];
  if (isObj(ca)) {
    const comps = arr(ca.competitors).filter(isObj);
    if (comps.length) {
      parts.push(table([t('name'), t('pricingTier'), t('positioning')], comps.map(c => [
        `<strong>${esc(c.name)}</strong>${c.botBlocked ? blockedTag(t) : ''}${staleTag(c, t, lang)}<div class="muted small u">${esc(c.url)}</div>`,
        esc(vocab(c.pricingTier, t)), esc(c.positioningStatement)])));
      for (const c of comps) {
        const body = [
          arr(c.strengths).length ? `<h4>${esc(t('strengths'))}</h4>${ul(c.strengths, 5)}` : '',
          arr(c.opportunities).length ? `<h4>${esc(t('opportunities'))}</h4>${ul(c.opportunities, 5)}` : '',
          arr(c.assortmentHighlights).length ? `<h4>${esc(t('assortment'))}</h4>${ul(c.assortmentHighlights, 5)}` : '',
        ].join('');
        if (body) parts.push(`<div class="card"><h3>${esc(c.name)}${staleTag(c, t, lang)}</h3><div class="cols">${body}</div></div>`);
      }
    }
    const pm = ca.positioningMap;
    if (isObj(pm)) {
      let s = para(pm.narrative);
      if (isObj(pm.axes)) s += kv([['X', esc(pm.axes.x)], ['Y', esc(pm.axes.y)]]);
      s += table([t('name'), 'X', 'Y', t('notes')], arr(pm.brandPositions).map(b => [esc(b.name), esc(b.x), esc(b.y), esc(b.note)]));
      if (arr(pm.whiteSpaceOpportunities).length) s += `<h4>${esc(t('whiteSpace'))}</h4>` + ul(pm.whiteSpaceOpportunities, 6);
      if (s.trim()) parts.push(h3(t('positioningMap')) + s);
    }
    if (arr(ca.topAssortmentGaps).length) parts.push(h3(t('assortmentGaps')) + ul(ca.topAssortmentGaps, 10));
  }
  if (!parts.length && isObj(profile) && arr(profile.identifiedCompetitors).length) {
    parts.push(`<p class="muted">${esc(t('competitorAnalysisPending'))}</p>`);
    parts.push(h3(t('identifiedCompetitors')) + table([t('name'), t('website'), t('rationale')],
      arr(profile.identifiedCompetitors).filter(isObj).map(c => [`<strong>${esc(c.name)}</strong>`, `<span class="u">${esc(c.url)}</span>`, esc(c.rationale)])));
  }
  return parts.join('');
}

function secWebsite(ctx) {
  const { t, data, lang, blockInfo } = ctx;
  const si = data.site_intelligence;
  if (!isObj(si)) return '';
  const parts = [];
  if (blockInfo.blocked) parts.push(`<div class="callout callout-warn">${esc(t('targetBlocked'))}</div>`);
  const brands = arr(si.brands).filter(isObj);
  if (brands.length) {
    parts.push(h3(t('sitesReviewed')) + table([t('name'), t('role'), t('status'), t('navItems'), t('featuredCats'), t('heroHeadline')], brands.map(b => {
      const st = b.botBlocked ? `<span class="tag tag-blocked">${esc(t('blocked'))}</span>` : (str(b.error) ? `<span class="tag tag-blocked">${esc(t('error'))}</span>` : esc(t('collected')));
      const hero = b.botBlocked ? '' : (isObj(b.heroContent) ? esc(clip(b.heroContent.headline, 80)) : '');
      return [`<strong>${esc(b.name)}</strong><div class="muted small u">${esc(b.url)}</div>`, esc(b.role === 'target' ? t('target') : t('competitor')), st + staleTag(b, t, lang), esc(String(arr(b.navigation).length)), esc(String(arr(b.featuredCategories).length)), hero];
    })));
  }
  const lh = isObj(si.lighthouseAudit) && isObj(si.lighthouseAudit.scores) ? si.lighthouseAudit.scores : null;
  if (lh) parts.push(h3(t('lighthouse')) + kv(['performance', 'accessibility', 'bestPractices', 'seo'].map(k => [t(k), esc(lh[k])])) + ul(si.lighthouseAudit.topIssues, 6));
  const ng = arr(si.navGaps).filter(isObj);
  if (ng.length) parts.push(h3(t('navGaps')) + table([t('category'), t('competitorsWithIt'), t('priority')], ng.map(g => [esc(g.category), esc(arr(g.competitorsWithIt).map(str).filter(Boolean).join(', ')), esc(vocab(g.priority, t))])));
  const mg = arr(si.messagingGaps).filter(isObj);
  if (mg.length) parts.push(h3(t('messagingGaps')) + table([t('gap'), t('competitorExample'), t('recommendation')], mg.map(g => [esc(g.gap), esc(g.competitorExample), esc(g.recommendation)])));
  if (isObj(si.ctaEffectiveness)) {
    const c = si.ctaEffectiveness;
    const s = kv([[t('rating'), esc(c.rating)], [t('observations'), esc(c.observations)], [t('recommendation'), esc(c.recommendation)]]);
    if (s) parts.push(h3(t('ctaTitle')) + s);
  }
  const to = arr(si.topOpportunities).filter(isObj);
  if (to.length) parts.push(h3(t('topOpportunities')) + table([t('rank'), t('opportunity'), t('detail'), t('impact')], to.map((o, i) => [esc(str(o.rank) || String(i + 1)), `<strong>${esc(o.title)}</strong>`, esc(o.description), esc(vocab(o.impact, t))])));
  if (isObj(si.crawlerVisibility)) {
    const c = si.crawlerVisibility;
    const live = c.heroTextIsLive === true ? t('yes') : c.heroTextIsLive === false ? t('no') : '';
    const s = kv([[t('heroLive'), esc(live)], [t('contentInImages'), esc(vocab(c.contentInImagesLevel, t))], [t('notes'), esc(c.aiReadabilityNote)]]);
    if (s) parts.push(h3(t('crawlerTitle')) + s);
  }
  if (isObj(si.navigationAnalysis) && arr(si.navigationAnalysis.missingCategories).length) parts.push(h3(t('missingCategories')) + ul(si.navigationAnalysis.missingCategories, 12));
  if (isObj(si.productContentReview) && arr(si.productContentReview.contentGaps).length) parts.push(h3(t('contentGaps')) + ul(si.productContentReview.contentGaps, 10));
  return parts.join('');
}

function secMarketplace(ctx) {
  const { t, data, lang } = ctx;
  const m = data.marketplace;
  if (!isObj(m)) return '';
  const parts = [];
  if (arr(m.sources).length) parts.push(kv([[t('sources'), esc(arr(m.sources).map(str).filter(Boolean).join(', '))]]));
  for (const c of arr(m.categories).filter(isObj)) {
    const items = arr(c.topItems).filter(isObj);
    if (!items.length) continue;
    const shown = items.slice(0, 10);
    parts.push(`<h3>${esc(c.source)} · ${esc(c.category)}${staleTag(c, t, lang)}</h3>` + table(
      [t('rank'), t('product'), t('brand'), t('priceJpy'), t('reviewCount'), t('rating')],
      shown.map((it, i) => [esc(str(it.rank) || String(i + 1)), `<span title="${escAttr(clip(it.title, 400))}">${esc(clip(it.title, 70))}</span>`, esc(it.brand), esc(fmtNum(it.priceJPY, lang, 0)), esc(fmtNum(it.reviewCount, lang, 0)), esc(fmtNum(it.rating, lang, 2))]),
      { more: items.length - shown.length, t }));
  }
  const mix = arr(m.brandMix).filter(isObj).slice(0, 15);
  if (mix.length) parts.push(h3(t('brandMix')) + bars(mix.map(b => ({ label: str(b.brand), value: b.count })), t));
  const reviews = arr(m.reviews).filter(isObj);
  if (reviews.length) {
    const sample = reviews.filter(r => str(r.text)).slice(0, 8);
    parts.push(h3(t('reviewSamples')) + kv([[t('reviewsCollected'), esc(String(reviews.length))]]) + sample.map(r =>
      `<blockquote><div class="small muted">${esc(r.source)} · ${esc(clip(r.productTitle, 90))}${typeof r.rating === 'number' ? ` · ${esc(t('rating'))} ${esc(fmtNum(r.rating, lang, 1))}` : ''}${staleTag(r, t, lang)}</div>${esc(clip(r.text, 400))}</blockquote>`).join(''));
  }
  const bl = arr(m.blocked).filter(isObj);
  if (bl.length) parts.push(h3(t('pagesNotRead')) + table([t('source'), t('category'), t('reason')], bl.map(b => [esc(b.source), esc(b.category), esc(plainReason(b.reason || (b.blocked ? 'blocked' : ''), t))])));
  return parts.join('');
}

function platformCell(status, t) {
  if (!isObj(status)) return '';
  const map = { ok: 'st_ok', 'not-applicable': 'st_notApplicable', 'no-data': 'st_noData', 'presence-only': 'st_presenceOnly' };
  const k = map[str(status.status)];
  return k ? esc(t(k)) : esc(status.status);
}

function secSocial(ctx) {
  const { t, data, lang } = ctx;
  const so = data.social_intelligence;
  if (!isObj(so)) return '';
  const parts = [];
  const brands = arr(so.brands).filter(isObj);
  if (brands.length) {
    const rows = brands.map(b => {
      const s = isObj(b.summary) ? b.summary : {};
      const x = isObj(b.xData) && isObj(b.xData.summary) ? b.xData.summary : null;
      const ps = isObj(b.platformStatus) ? b.platformStatus : {};
      const ig = s.postCount > 0 ? `${esc(fmtNum(s.postCount, lang, 0))} / ${esc(fmtNum(s.avgEngagement, lang, 0))} / ${esc(fmtNum(s.postingFrequencyPerWeek, lang, 1))}` : esc(str(b.handle) ? t('st_noData') : t('notFound'));
      const xs = x && x.postCount > 0 ? `${esc(fmtNum(x.postCount, lang, 0))} / ${esc(fmtNum(x.avgEngagement, lang, 0))} / ${esc(fmtNum(x.postingFrequencyPerWeek, lang, 1))}` : (platformCell(ps.x, t) || esc(t('notFound')));
      return [`<strong>${esc(b.name)}</strong>${b.role === 'target' ? ` <span class="tag">${esc(t('target'))}</span>` : ''}${staleTag(b, t, lang)}${str(b.handle) ? `<div class="small muted u">@${esc(b.handle)}</div>` : ''}`,
        ig, xs, platformCell(ps.youtube, t), platformCell(ps.line, t)];
    });
    parts.push(h3(t('accounts')) + `<p class="small muted">Instagram, X: ${esc(t('postsAnalysed'))} / ${esc(t('avgEngagement'))} / ${esc(t('perWeek'))}</p>` +
      table([t('name'), 'Instagram', 'X', 'YouTube', 'LINE'], rows, { cls: 'compact' }));
    const eng = brands.map(b => ({ label: str(b.name), value: isObj(b.summary) ? b.summary.avgEngagement : 0 }));
    const bb = bars(eng, t);
    if (bb) parts.push(`<h4>Instagram · ${esc(t('avgEngagement'))}</h4>` + bb);
    const target = brands.find(b => b.role === 'target');
    if (target) {
      let s = '';
      const themes = arr(target.contentThemes).filter(isObj);
      if (themes.length) s += `<h4>${esc(t('themes'))}</h4>` + table([t('category'), t('count')], themes.map(x => [esc(x.theme), esc(fmtNum(x.count, lang, 0))]));
      const tags = arr(target.topHashtags).filter(isObj).slice(0, 12);
      if (tags.length) s += `<h4>${esc(t('hashtags'))}</h4><p>${tags.map(x => `<span class="chip">${esc(x.tag)} (${esc(fmtNum(x.count, lang, 0))})</span>`).join(' ')}</p>`;
      if (isObj(target.postingPattern) && str(target.postingPattern.bestDay)) s += kv([[t('bestDay'), esc(dayName(target.postingPattern.bestDay, t))]]);
      const cg = arr(target.contentGaps).filter(isObj);
      if (cg.length) s += `<h4>${esc(t('contentGaps'))}</h4>` + table([t('gap'), t('detail'), t('competitor'), t('platform')], cg.map(g => [`<strong>${esc(g.headline)}</strong>`, esc(g.detail), esc(g.competitor), esc(g.platform)]));
      if (s) parts.push(`<h3>${esc(target.name)}${staleTag(target, t, lang)}</h3>` + s);
    }
  }
  const ws = arr(so.whiteSpaceOpportunities).filter(isObj);
  if (ws.length) parts.push(h3(t('socialWhiteSpace')) + table([t('opportunity'), t('detail'), t('format'), t('priority')], ws.map(w => [`<strong>${esc(w.theme)}</strong>`, esc(w.description), esc(w.suggestedFormat), esc(vocab(w.priority, t))])));
  const cs = arr(so.competitionStrategy).filter(isObj);
  if (cs.length) parts.push(h3(t('howToCompete')) + table([t('tactic'), t('rationale'), t('priority')], cs.map(c => [`<strong>${esc(c.tactic)}</strong>`, esc(c.rationale), esc(vocab(c.priority, t))])));
  return parts.join('');
}

function secPersonas(ctx) {
  const { t, data } = ctx;
  const p = data.personas;
  if (!isObj(p)) return '';
  const parts = [];
  // Summary first: short text that can share a page, then the cards, which never split.
  if (arr(p.summaryInsights).length) parts.push(h3(t('summaryInsights')) + ul(p.summaryInsights, 8));
  for (const x of arr(p.personas).filter(isObj)) {
    const list = (k, label) => (arr(x[k]).length ? `<div><h4>${esc(t(label))}</h4>${ul(x[k], 6)}</div>` : '');
    const head = kv([[t('age'), esc(x.ageRange)], [t('income'), esc(x.income)], [t('location'), esc(x.location)], [t('occupation'), esc(arr(x.occupation).map(str).filter(Boolean).join('; '))]]);
    const lists = [list('values', 'values'), list('shoppingBehaviors', 'behaviors'), list('painPoints', 'painPoints'), list('motivators', 'motivators'), list('preferredChannels', 'channels'), list('contentTopics', 'contentTopics')].join('');
    const fit = str(x.brandFit) ? `<h4>${esc(t('brandFit'))}</h4>${para(x.brandFit)}` : '';
    const q = str(x.quoteExample) ? `<blockquote class="quote"><span class="small muted">${esc(t('quote'))}</span><br>${esc(x.quoteExample)}</blockquote>` : '';
    if (head || lists || fit) parts.push(`<div class="card persona"><div class="persona-head"><h3>${esc(x.name)}</h3>${head}${q}</div><div class="cols">${lists}</div>${fit}</div>`);
  }
  return parts.join('');
}

function secSearch(ctx) {
  const { t, data, lang, blockInfo } = ctx;
  const s = data.search_seo;
  if (!isObj(s)) return '';
  const parts = [];
  const pages = [];
  if (isObj(s.onPageSeo)) pages.push({ name: str(s.brandName) || ctx.brandName, role: 'target', ...s.onPageSeo });
  for (const c of arr(s.competitors).filter(isObj)) pages.push({ ...c, role: 'competitor' });
  if (pages.length) {
    if (blockInfo.blocked) parts.push(`<div class="callout callout-warn">${esc(t('targetBlocked'))}</div>`);
    parts.push(h3(t('onPage')) + table([t('name'), t('titleTag'), t('h1'), t('metaDesc')], pages.map(p => [
      `<strong>${esc(p.name)}</strong>${p.role === 'target' ? ` <span class="tag">${esc(t('target'))}</span>` : ''}${p.blocked ? blockedTag(t) : ''}`,
      esc(clip(p.titleTag, 90)), esc(clip(p.h1, 70)), esc(clip(p.metaDescription, 160))])));
  }
  if (isObj(s.sitemapAnalysis)) {
    const sm = s.sitemapAnalysis;
    parts.push(h3(t('sitemap')) + kv([[t('found'), esc(sm.found === true ? t('yes') : sm.found === false ? t('no') : '')], [t('urlsListed'), esc(fmtNum(sm.totalUrls, lang, 0))]]) + ul(sm.issues, 6));
  }
  const pa = arr(s.priorityActions).filter(isObj);
  if (pa.length) parts.push(h3(t('priorityActions')) + table([t('rank'), t('action'), t('why'), t('impact'), t('effort')], pa.map((a, i) => [esc(str(a.rank) || String(i + 1)), `<strong>${esc(a.action)}</strong>`, esc(a.why), esc(vocab(a.impact, t)), esc(vocab(a.effort, t))])));
  const bm = arr(s.competitorBenchmarks).filter(isObj);
  if (bm.length) parts.push(h3(t('benchmarks')) + table([t('signal'), t('competitor'), t('theirs'), t('ours'), t('recommendation')], bm.map(b => [esc(b.signal), esc(b.competitorName), esc(clip(b.competitorValue, 90)), esc(clip(b.targetValue, 90)), esc(b.recommendation)])));
  const ki = isObj(s.keywordIntelligence) ? s.keywordIntelligence : null;
  const clusters = ki ? arr(ki.clusters).filter(isObj) : [];
  if (clusters.length) parts.push(h3(t('keywordClusters')) + table([t('name'), t('intent'), t('monthlySearches'), t('keywords'), t('recommendation')], clusters.map(c => [`<strong>${esc(c.name)}</strong>`, esc(c.intent), esc(c.estimatedMonthlySearches), esc(arr(c.keywords).map(str).filter(Boolean).slice(0, 8).join(', ')), esc(c.recommendation)])));
  const geo = isObj(s.geoSection) ? s.geoSection : null;
  if (geo) {
    const score = typeof geo.combinedScore === 'number' ? geo.combinedScore : geo.visibilityScore;
    let g = kv([[t('visibility'), typeof score === 'number' ? esc(fmtNum(score, lang, 0) + ' / 100') : ''], [t('queriesTested'), esc(fmtNum(geo.queriesTested, lang, 0))]]);
    const qs = arr(geo.queries).filter(isObj);
    const shown = qs.slice(0, 30);
    g += table([t('category'), t('query'), t('mentioned'), t('mentionPosition')], shown.map(q => [
      esc(q.category), esc(q.query) + (str(q.queryEn) && str(q.queryEn) !== str(q.query) && lang !== 'ja' ? `<div class="small muted">${esc(q.queryEn)}</div>` : ''),
      esc(q.brandMentioned === true ? t('yes') : q.brandMentioned === false ? t('no') : ''), esc(fmtNum(q.mentionPosition, lang, 0))]), { more: qs.length - shown.length, t, cls: 'compact' });
    if (arr(geo.gapRecommendations).length) g += `<h4>${esc(t('recommendation'))}</h4>` + ul(geo.gapRecommendations, 8);
    if (g) parts.push(h3(t('geo')) + g);
  }
  if (isObj(s.serpRankings) && s.serpRankings.skipped) parts.push(h3(t('serp')) + kv([[t('status'), esc(t('notChecked'))], [t('reason'), esc(plainReason(s.serpRankings.reason, t))]]));
  return parts.join('');
}

function avgInterest(series) {
  const vals = arr(series).map(p => (typeof p === 'number' ? p : isObj(p) ? (typeof p.value === 'number' ? p.value : Array.isArray(p.value) ? p.value[0] : null) : null)).filter(v => typeof v === 'number' && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function secDemand(ctx) {
  const { t, data, lang } = ctx;
  const d = data.jp_demand;
  if (!isObj(d)) return '';
  const parts = [];
  const trends = arr(d.trends).filter(isObj);
  if (trends.length) parts.push(h3(t('trends')) + table([t('term'), t('meaning'), t('avgInterest'), t('related')], trends.map(x => {
    const a = avgInterest(x.interestOverTime);
    const rel = arr(x.topRelated).map(r => str(typeof r === 'string' ? r : isObj(r) ? (r.query || r.term || r.title) : '')).filter(Boolean).slice(0, 6).join(', ');
    return [`<strong>${esc(x.term)}</strong>${staleTag(x, t, lang)}`, esc(x.termEn), a === null ? `<span class="muted">${esc(t('noTrend'))}</span>` : esc(fmtNum(a, lang, 0)), esc(rel)];
  })));
  if (isObj(d.demographics)) {
    const dm = d.demographics;
    parts.push(h3(t('demographics')) + (dm.omitted ? kv([[t('status'), esc(t('notAvailable'))], [t('reason'), esc(plainReason(dm.reason, t))]]) : kv([[t('source'), esc(dm.source)]]) + staleTag(dm, t, lang)));
  }
  const dn = [...new Set(arr(d.notes).filter(n => str(n) && !(isObj(d.demographics) && n === d.demographics.reason)).map(n => { const l = noteLabel(n); return (l ? `${l}: ` : '') + plainReason(n, t); }))];
  if (dn.length) parts.push(h3(t('notes')) + ul(dn, 8));
  return parts.join('');
}

// ---------- data notes ----------

function collectStale(data) {
  const out = [];
  const seen = new Set();
  const walk = (v, mod, depth) => {
    if (depth > 6 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, mod, depth + 1); return; }
    if (v.stale === true) {
      const label = str(v.name) || [str(v.source), str(v.category)].filter(Boolean).join(' · ') || str(v.term) || str(v.productTitle) || mod;
      const key = mod + '|' + label + '|' + str(v.lastError);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ mod, label, asOf: v.asOf || v.dataFrom || v.scrapedAt || null, lastError: str(v.lastError), lastAttempt: v.lastAttempt || null });
      }
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === 'history' || /^(screenshot|image|thumbnail)/i.test(k)) continue;
      if (x && typeof x === 'object') walk(x, mod, depth + 1);
    }
  };
  for (const [k] of MODULE_KEYS) if (data[k]) walk(data[k], k, 0);
  return out;
}

/** Per-module status for the freshness table: included, partial (with reason) or no data. */
function moduleStatus(k, ctx, staleMods) {
  const d = ctx.data[k];
  const { t } = ctx;
  if (!isObj(d)) {
    if (k === 'competitive_analysis' && arr(ctx.profile.identifiedCompetitors).length) return { cls: 'partial', text: `${t('partial')}: ${t('competitorsPartial')}` };
    return { cls: 'none', text: t('noDataYet') };
  }
  if (k === 'marketplace' && d.partial) return { cls: 'partial', text: `${t('partial')}: ${t('r_notReached')}` };
  if (staleMods.has(k)) return { cls: 'partial', text: `${t('partial')}: ${t('includesStale')}` };
  return { cls: 'ok', text: t('included') };
}

function secNotes(ctx) {
  const { t, data, lang, blockInfo, profile } = ctx;
  const parts = [`<p class="muted">${esc(t('notesIntro'))}</p>`];
  const stale = collectStale(data);
  const staleMods = new Set(stale.map(x => x.mod));
  parts.push(h3(t('freshness')) + table([t('module'), t('updated'), t('status')], MODULE_KEYS.map(([k, label]) => {
    const d = data[k];
    const g = isObj(d) ? fmtDate(d.generatedAt, lang) : '';
    const st = moduleStatus(k, ctx, staleMods);
    return [esc(t(label)), g ? esc(g) : '<span class="muted">-</span>', st.cls === 'ok' ? esc(st.text) : `<span class="${st.cls === 'partial' ? 'tag-partial' : 'muted'}">${esc(st.text)}</span>`];
  })));

  const modName = (k) => t((MODULE_KEYS.find(m => m[0] === k) || [k, k])[1]);
  if (stale.length) parts.push(h3(t('staleItems')) + table([t('module'), t('item'), t('asOf'), t('reason')], stale.map(x => [esc(modName(x.mod)), esc(clip(x.label, 60)), esc(fmtDate(x.asOf, lang) || t('unknown')), esc(plainReason(x.lastError, t))])));

  const blocked = [];
  const seen = new Set();
  const push = (mod, item, reason) => { const key = mod + '|' + item + '|' + reason; if (!seen.has(key)) { seen.add(key); blocked.push([esc(mod), /^https?:|\//.test(item) ? `<span class="u">${esc(clip(item, 60))}</span>` : esc(clip(item, 60)), esc(reason)]); } };
  if (blockInfo.blocked) push(t('s_website'), str(profile && profile.url) || ctx.brandName, t('targetBlocked'));
  const si = data.site_intelligence;
  if (isObj(si)) for (const b of arr(si.brands).filter(isObj)) {
    if (b.role !== 'target' && (b.botBlocked || str(b.error))) push(t('s_website'), str(b.name), b.botBlocked ? t('r_blocked') : plainReason(b.error, t));
  }
  const m = data.marketplace;
  if (isObj(m)) for (const b of arr(m.blocked).filter(isObj)) push(t('s_marketplace'), [str(b.source), str(b.category)].filter(Boolean).join(' · '), plainReason(b.reason || 'blocked', t));
  const so = data.social_intelligence;
  if (isObj(so)) for (const b of arr(so.brands).filter(isObj)) if (str(b.error)) push(t('s_social'), str(b.name), plainReason(b.error, t));
  const seo = data.search_seo;
  if (isObj(seo) && isObj(seo.serpRankings) && seo.serpRankings.skipped) push(t('s_search'), t('serp'), plainReason(seo.serpRankings.reason, t));
  const dm = data.jp_demand;
  if (isObj(dm) && isObj(dm.demographics) && dm.demographics.omitted) push(t('s_demand'), t('demographics'), plainReason(dm.demographics.reason, t));
  if (blocked.length) parts.push(h3(t('blockedItems')) + table([t('module'), t('item'), t('reason')], blocked));

  const other = [];
  if (isObj(m) && m.partial && arr(m.unreached).length) other.push(t('partialRun', { list: arr(m.unreached).map(u => clip(u, 40)).filter(u => u && !/^https?:/i.test(u)).join(', ') }));
  const noteLine = (mod, raw) => { const l = noteLabel(raw); return `${mod}: ${l ? l + ', ' : ''}${plainReason(raw, t)}`; };
  if (isObj(m)) for (const n of arr(m.notes)) if (str(n)) other.push(noteLine(t('s_marketplace'), n));
  if (isObj(m)) for (const r of arr(m.reviewStatus).filter(isObj)) if (str(r.lastError)) other.push(`${t('s_marketplace')}: ${clip(r.source, 30)}, ${plainReason(r.lastError, t)}`);
  if (isObj(dm)) for (const n of arr(dm.notes)) if (str(n) && !(isObj(dm.demographics) && n === dm.demographics.reason)) other.push(noteLine(t('s_demand'), n));
  const otherClean = [...new Set(other.filter(Boolean))];
  if (otherClean.length) parts.push(h3(t('otherNotes')) + ul(otherClean, 20));

  const missing = MODULE_KEYS.filter(([k]) => !isObj(data[k]));
  if (!stale.length && !blocked.length && !otherClean.length && !missing.length) parts.push(`<p>${esc(t('noIssues'))}</p>`);
  return parts.join('');
}

// ---------- document ----------

function cssString(v) {
  // Quoted CSS string: escape backslash, quote, newlines and angle brackets so it cannot close the style element.
  return '"' + str(v).replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ').replace(/</g, '\\3C ').replace(/>/g, '\\3E ') + '"';
}

const MARGIN_FONT = "font-family: 'Noto Sans JP','IPAGothic','Hiragino Sans','Yu Gothic','Meiryo',sans-serif; font-size: 8pt; color: #6b7280;";

function pageCss(headerLeft, headerRight, pagePrefix, pageSuffix) {
  return `@page { size: A4; margin: 20mm 16mm 18mm 16mm;
  @top-left { content: ${cssString(headerLeft)}; ${MARGIN_FONT} }
  @top-right { content: ${cssString(headerRight)}; ${MARGIN_FONT} }
  @bottom-right { content: ${cssString(pagePrefix)} counter(page) ${cssString(pageSuffix)}; ${MARGIN_FONT} }
}
@page :first { @top-left { content: none; } @top-right { content: none; } @bottom-right { content: none; } }
`;
}

const CSS = `
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: 'Noto Sans JP','IPAGothic','Hiragino Sans','Yu Gothic','Meiryo',sans-serif; font-size: 9.5pt; line-height: 1.55; color: #1f2937; background: #fff; }
main { max-width: 178mm; margin: 0 auto; }
h1 { font-size: 26pt; line-height: 1.2; margin: 0 0 6mm; font-weight: 700; color: #111827; }
h2 { font-size: 16pt; line-height: 1.3; margin: 0 0 5mm; padding-bottom: 2mm; border-bottom: 2px solid #1d4ed8; color: #111827; font-weight: 700; }
h3 { font-size: 11.5pt; margin: 6mm 0 2.5mm; color: #111827; font-weight: 700; break-after: avoid; }
h4 { font-size: 9.5pt; margin: 3mm 0 1.5mm; color: #374151; font-weight: 700; break-after: avoid; }
p { margin: 0 0 2.5mm; }
.lead { font-size: 11pt; line-height: 1.65; color: #111827; }
.muted { color: #6b7280; }
.small { font-size: 8pt; }
.more { font-size: 8pt; color: #6b7280; margin-top: 1mm; }
section.major { break-before: auto; padding-top: 4mm; }
section.major:first-of-type, #sec-summary { break-before: page; padding-top: 0; }
/* A section starts on a new page only when less than about a third of the page is left: this invisible block cannot split, so it moves to the next page and pulls the heading with it, then its negative margin gives the space back. */
.keep-space { height: 85mm; margin-bottom: -85mm; break-inside: avoid; break-after: avoid; }
h2 { break-after: avoid; }
.cover { break-after: page; min-height: 250mm; display: flex; flex-direction: column; justify-content: space-between; padding-top: 40mm; }
.cover .eyebrow { font-size: 9pt; letter-spacing: 0.12em; text-transform: uppercase; color: #1d4ed8; font-weight: 700; margin-bottom: 4mm; }
.cover .brandname { font-size: 18pt; color: #374151; margin-bottom: 10mm; }
.cover .rule { width: 30mm; height: 3px; background: #1d4ed8; margin: 6mm 0 10mm; }
.toc ol { padding-left: 6mm; margin: 0; columns: 2; column-gap: 10mm; }
.toc li { margin-bottom: 1.5mm; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; font-size: 8.5pt; }
thead { display: table-header-group; }
th { text-align: left; font-weight: 700; color: #374151; background: #f3f4f6; border-bottom: 1px solid #d1d5db; padding: 1.6mm 2mm; vertical-align: bottom; }
td { border-bottom: 1px solid #e5e7eb; padding: 1.6mm 2mm; vertical-align: top; }
tr { break-inside: avoid; }
table.compact td, table.compact th { padding: 1.1mm 1.6mm; }
ul, ol { margin: 0 0 2.5mm; padding-left: 5mm; }
li { margin-bottom: 1mm; }
ol.pri li { margin-bottom: 2.5mm; }
dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 1mm 5mm; margin: 0 0 3mm; }
dl.kv dt { color: #6b7280; font-weight: 700; }
dl.kv dd { margin: 0; }
.card { border: 1px solid #e5e7eb; border-radius: 2mm; padding: 3mm 4mm; margin: 0 0 4mm; break-inside: avoid; }
.card h3 { margin-top: 0; }
.persona { break-inside: avoid; font-size: 8.6pt; line-height: 1.45; padding: 2.5mm 4mm; }
.persona h4 { margin: 2mm 0 0.8mm; font-size: 8.8pt; }
.persona li { margin-bottom: 0.4mm; }
.persona ul { margin-bottom: 1.5mm; }
.persona dl.kv { gap: 0.6mm 5mm; margin-bottom: 2mm; }
.persona blockquote { margin-bottom: 1.5mm; }
.persona-head { break-inside: avoid; break-after: avoid; }
.persona-head + .cols > div:first-child { break-before: avoid; }
li { break-inside: avoid; }
body, li, p, dd, blockquote { overflow-wrap: anywhere; word-break: normal; }
td, th { overflow-wrap: break-word; word-break: normal; }
/* URLs, handles and other long unbroken tokens may break anywhere so they never overrun a column. */
.u { overflow-wrap: anywhere; }
th { word-break: keep-all; }
/* First column holds names and labels: wrap only between words, and never squeeze below a readable width. */
td:first-child, th:first-child { overflow-wrap: break-word; min-width: 26mm; }
.tag-partial { color: #92400e; font-weight: 700; font-size: 8pt; }
.empty-line { color: #6b7280; font-size: 8.5pt; margin-top: 5mm; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 6mm; }
.facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 4mm; }
.fact { border-left: 3px solid #1d4ed8; background: #f9fafb; padding: 2.5mm 3mm; }
.fact-val { font-size: 16pt; font-weight: 700; color: #111827; line-height: 1.2; }
.fact-label { font-size: 8pt; color: #6b7280; }
.callout { padding: 3mm 4mm; margin: 0 0 4mm; border-left: 3px solid #6b7280; background: #f3f4f6; }
.callout-warn { border-left-color: #b45309; background: #fffbeb; }
.nodata { color: #6b7280; font-style: italic; padding: 3mm 0; }
.tag { display: inline-block; font-size: 7pt; font-weight: 700; padding: 0.3mm 1.6mm; border-radius: 1mm; background: #e5e7eb; color: #374151; vertical-align: middle; white-space: nowrap; }
.tag-stale { background: #fef3c7; color: #92400e; }
.tag-blocked { background: #fee2e2; color: #991b1b; }
.chip { display: inline-block; font-size: 8pt; background: #f3f4f6; border-radius: 1mm; padding: 0.4mm 1.6mm; margin: 0 1mm 1mm 0; }
blockquote { margin: 0 0 2.5mm; padding: 1.5mm 3mm; border-left: 2px solid #d1d5db; color: #374151; break-inside: avoid; }
blockquote.quote { border-left-color: #1d4ed8; font-style: normal; }
.bars { margin: 1mm 0 4mm; }
.bar-row { display: grid; grid-template-columns: 50mm 1fr 14mm; align-items: center; gap: 2mm; margin-bottom: 1mm; font-size: 8pt; break-inside: avoid; }
.bar-label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.bar-track { height: 3mm; background: #f3f4f6; }
.bar-fill { display: block; height: 100%; background: #1d4ed8; }
.bar-val { text-align: right; color: #374151; }
@media screen { body { background: #f3f4f6; } main { background: #fff; padding: 16mm; margin: 8mm auto; box-shadow: 0 1px 3px rgba(0,0,0,.08); } }
@media print { main { max-width: none; } }
`;

function renderReport(opts = {}) {
  // JA typography applies to every escaped string of a Japanese render, chrome and data alike.
  JA_PUNCT = opts.lang === 'ja';
  try { return renderReportInner(opts); } finally { JA_PUNCT = false; }
}

function renderReportInner(opts) {
  const lang = DICT[opts.lang] ? opts.lang : 'en';
  const t = makeT(lang);
  const profile = isObj(opts.profile) ? opts.profile : {};
  const data = isObj(opts.data) ? opts.data : {};
  const brandName = str(opts.brandName) || str(profile.name) || str(profile.slug) || '';
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const ctx = { t, lang, profile, data, brandName, blockInfo: targetBlockedInfo(profile, data) };

  const builders = {
    summary: secSummary, action: secAction, competitors: secCompetitors, website: secWebsite,
    marketplace: secMarketplace, social: secSocial, personas: secPersonas, search: secSearch,
    demand: secDemand, notes: secNotes,
  };
  const hasText = (html) => !!html.replace(/<[^>]*>/g, '').trim();
  const bodies = {};
  {
    // Content sections first, so the summary and notes know which ones are empty.
    for (const [id] of SECTION_ORDER) {
      if (id === 'summary' || id === 'notes') continue;
      try { bodies[id] = builders[id](ctx) || ''; } catch { bodies[id] = ''; }
    }
    const empty = SECTION_ORDER.filter(([id]) => id !== 'summary' && id !== 'notes' && !hasText(bodies[id]));
    ctx.emptySections = empty.map(([, key]) => t(key));
    try { bodies.notes = builders.notes(ctx) || ''; } catch { bodies.notes = ''; }
    try { bodies.summary = builders.summary(ctx) || ''; } catch { bodies.summary = ''; }
    if (!hasText(bodies.summary)) bodies.summary = noData(t);
    if (ctx.emptySections.length) bodies.summary += `<p class="empty-line">${esc(t('emptySections', { list: ctx.emptySections.join(lang === 'ja' ? '、' : ', ') }))}</p>`;
  }
  const kept = SECTION_ORDER.filter(([id]) => id === 'summary' || id === 'notes' || hasText(bodies[id]));
  const sections = kept.map(([id, key], i) => `<section class="major" id="sec-${id}">${i > 0 ? '<div class="keep-space"></div>' : ''}<h2>${esc(t(key))}</h2>${bodies[id]}</section>`);

  const dateStr = fmtDate(generatedAt, lang);
  const css = pageCss(`${brandName} · ${t('docTitle')}`, dateStr, t('pagePrefix'), t('pageSuffix')) + CSS;

  const cover = `<section class="cover"><div>
<div class="eyebrow">${esc(t('subtitle'))}</div>
<h1>${esc(t('docTitle'))}</h1>
<div class="brandname">${esc(brandName)}</div>
<div class="rule"></div>
${kv([[t('brand'), esc(brandName)], [t('generated'), esc(dateStr)], [t('market'), esc(profile.market)], [t('industry'), esc(profile.industry)], [t('website'), esc(profile.url)]])}
</div>
<nav class="toc"><h3>${esc(t('contents'))}</h3><ol>${kept.map(([, key]) => `<li>${esc(t(key))}</li>`).join('')}</ol></nav>
</section>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(t('docTitle'))} · ${escAttr(brandName)}</title>
<style>${css}</style>
</head>
<body>
<main>
${cover}
${sections.join('\n')}
</main>
</body>
</html>`;
}

module.exports = { renderReport, DICT, SECTION_ORDER, jaPunctuate, reasonKey, plainReason, _internal: { esc, str, collectStale, targetBlockedInfo, noteLabel } };
