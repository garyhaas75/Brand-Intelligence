'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderReport, DICT, SECTION_ORDER } = require('../modules/report_html');

const FIX = path.join(__dirname, 'fixtures', 'report');
const full = JSON.parse(fs.readFileSync(path.join(FIX, 'full_data.json'), 'utf8'));
const GEN = '2026-11-17T09:00:00.000Z';

const render = (over = {}) => renderReport({ profile: full.profile, brandName: full.profile.name, data: full.data, lang: 'en', generatedAt: GEN, ...over });
const sectionHeadings = (lang) => SECTION_ORDER.map(([, k]) => DICT[lang][k]);
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('dictionaries: en and ja have exactly the same keys', () => {
  assert.deepStrictEqual(Object.keys(DICT.ja).sort(), Object.keys(DICT.en).sort());
});

test('dictionaries: no em dashes, no empty values except page affixes', () => {
  for (const lang of ['en', 'ja']) {
    for (const [k, v] of Object.entries(DICT[lang])) {
      assert.ok(!v.includes('\u2014'), `${lang}.${k} has an em dash`);
      if (!['pagePrefix', 'pageSuffix'].includes(k)) assert.ok(v.length > 0, `${lang}.${k} is empty`);
    }
  }
});

test('ja dictionary is actually Japanese for the section headings', () => {
  for (const h of sectionHeadings('ja')) assert.match(h, /[぀-ヿ一-鿿]/, h);
});

test('full data renders a complete document with every section heading, both languages', () => {
  for (const lang of ['en', 'ja']) {
    const html = render({ lang });
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<\/html>$/);
    assert.ok(html.includes(`<html lang="${lang}">`));
    for (const h of sectionHeadings(lang)) assert.ok(html.includes(`<h2>${escHtml(h)}</h2>`), `${lang} missing heading ${h}`);
    assert.ok(html.includes("font-family: 'Noto Sans JP','IPAGothic','Hiragino Sans','Yu Gothic','Meiryo',sans-serif"));
    assert.ok(html.includes('size: A4'));
    assert.ok(html.includes('break-before: page'));
    assert.ok(!html.includes(DICT[lang].noData) || lang === 'xx', `${lang}: full data should not need a no-data note`);
  }
});

test('full data shows real content from each module', () => {
  const html = render();
  for (const s of ['Fix the hero headline', 'Rival Toys', 'Gift hub missing', 'Lego City Set', 'The Planner Parent', 'toy store near me', 'birthday gifts', 'Ship a gift finder']) {
    assert.ok(html.includes(escHtml(s)), `missing ${s}`);
  }
});

test('all-null data: empty sections are omitted from body and contents, one line names them', () => {
  for (const lang of ['en', 'ja']) {
    const html = renderReport({ profile: null, brandName: 'Empty Brand', data: { competitive_analysis: null, personas: null, social_intelligence: null, site_intelligence: null, search_seo: null, action_plan: null, marketplace: null, jp_demand: null }, lang, generatedAt: GEN });
    assert.match(html, /^<!DOCTYPE html>/);
    const d = DICT[lang];
    assert.ok(html.includes(`<h2>${escHtml(d.s_summary)}</h2>`));
    assert.ok(html.includes(`<h2>${escHtml(d.s_notes)}</h2>`));
    assert.strictEqual((html.match(/<h2>/g) || []).length, 2, `${lang}: only summary and notes remain`);
    const toc = html.slice(html.indexOf('<nav class="toc">'), html.indexOf('</nav>'));
    assert.strictEqual((toc.match(/<li>/g) || []).length, 2, `${lang}: contents renumbered to 2 entries`);
    assert.strictEqual(html.split('class="empty-line"').length - 1, 1, `${lang}: exactly one empty-sections line`);
    assert.ok(html.includes(escHtml(d.s_personas)), 'empty-sections line names personas');
    assert.ok(html.includes(escHtml(d.noDataYet)));
  }
});

test('a section with partial data is kept (competitors from profile) and labelled Partial in notes', () => {
  for (const lang of ['en', 'ja']) {
    const html = renderReport({ profile: full.profile, data: { personas: full.data.personas }, lang, generatedAt: GEN });
    assert.ok(html.includes(`<h2>${escHtml(DICT[lang].s_competitors)}</h2>`));
    const notes = html.slice(html.indexOf('id="sec-notes"'));
    assert.ok(notes.includes(escHtml(`${DICT[lang].partial}: ${DICT[lang].competitorsPartial}`)), `${lang}: partial label`);
    assert.ok(!html.includes(`<h2>${escHtml(DICT[lang].s_social)}</h2>`));
  }
});

const RAW_ERRORS = [
  ['rakuten api: RAKUTEN_APP_ID not set', 'r_notConnected'],
  ['SERP_API_KEY is not set, so google.co.jp rankings were not checked.', 'r_notConnected'],
  ['ESTAT_APP_ID is not set, so e-Stat baseline demographics were omitted.', 'r_notConnected'],
  ['apify not used for https://ranking.rakuten.co.jp/daily/566382/: apify error: This Actor requires full access to your account. You must approve its permissions before running it: https://console.apify.com/actors/YrQuEkowkNCLdk4j2?approvePermissions=true', 'r_permission'],
  ['page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://item.rakuten.co.jp/book/18646529/?variantId=18646529&scid=seo-carousel-search', 'r_unreachable'],
  ['overload_page', 'r_busy'],
  ['Could not detect Instagram handle', 'r_accountNotFound'],
  ['Post data unavailable (account may be private or scraper blocked) \u2014 profile stats only', 'r_private'],
  ['No navigation found \u2014 site may be bot-protected', 'r_blocked'],
  ['Input is not valid: Field input.timeRange must be equal to one of the allowed values', 'r_generic'],
  ['something odd happened', 'r_generic'],
];

test('technical causes map to plain-language reasons', () => {
  const { reasonKey } = require('../modules/report_html');
  for (const [raw, key] of RAW_ERRORS) assert.strictEqual(reasonKey(raw), key, raw);
});

test('raw developer errors never reach the document, in either language', () => {
  const data = JSON.parse(JSON.stringify(full.data));
  data.marketplace.notes = RAW_ERRORS.map(r => r[0]);
  data.marketplace.blocked = [{ source: 'rakuten', category: 'ranking', blocked: true, reason: 'overload_page' }];
  data.marketplace.reviewStatus = [{ source: 'rakuten', lastError: RAW_ERRORS[4][0] }];
  data.marketplace.categories[0].lastError = RAW_ERRORS[3][0];
  data.search_seo.serpRankings = { skipped: true, reason: RAW_ERRORS[1][0] };
  data.jp_demand.demographics = { omitted: true, reason: RAW_ERRORS[2][0] };
  data.jp_demand.notes = [RAW_ERRORS[9][0]];
  for (const lang of ['en', 'ja']) {
    const html = render({ lang, data });
    const body = html.slice(html.indexOf('<body>'));
    for (const bad of ['RAKUTEN_APP_ID', 'SERP_API_KEY', 'ESTAT_APP_ID', 'approvePermissions', 'net::', 'ERR_HTTP2', 'overload_page', 'timeRange', 'page.goto', 'console.apify.com']) {
      assert.ok(!body.includes(bad), `${lang}: leaked ${bad}`);
    }
    assert.ok(!/\b[A-Z][A-Z0-9]*_[A-Z0-9_]*(KEY|ID|TOKEN)\b/.test(body), `${lang}: env var name leaked`);
    for (const u of body.match(/https?:\/\/[^\s<"]+/g) || []) assert.ok(u.length <= 60, `${lang}: long url ${u}`);
    const d = DICT[lang];
    for (const k of ['r_notConnected', 'r_permission', 'r_unreachable', 'r_busy']) assert.ok(body.includes(escHtml(d[k])), `${lang}: missing ${k}`);
  }
});

test('jaPunctuate normalises punctuation next to Japanese only', () => {
  const { jaPunctuate } = require('../modules/report_html');
  assert.strictEqual(jaPunctuate('保護者(30代)'), '保護者（30代）');
  assert.strictEqual(jaPunctuate('事務職; 会社員'), '事務職；会社員');
  assert.strictEqual(jaPunctuate('おもちゃ, 知育玩具, ぬいぐるみ'), 'おもちゃ、知育玩具、ぬいぐるみ');
  assert.strictEqual(jaPunctuate('トイザらス (Toys R Us)'), 'トイザらス (Toys R Us)', 'Latin-only parentheses untouched');
  assert.strictEqual(jaPunctuate('Price (JPY), 1,000; ok'), 'Price (JPY), 1,000; ok', 'purely Latin untouched');
  assert.strictEqual(jaPunctuate('価格 1,000円'), '価格 1,000円', 'numbers untouched');
  assert.strictEqual(jaPunctuate('詳細 https://example.jp/a,b(c) を参照'), '詳細 https://example.jp/a,b(c) を参照', 'URL untouched');
  assert.strictEqual(jaPunctuate('@toysrus_jp, @akachan'), '@toysrus_jp, @akachan');
});

test('ja render applies Japanese punctuation, en render does not', () => {
  const data = JSON.parse(JSON.stringify(full.data));
  data.personas.personas[0].occupation = ['パート', '会社員'];
  data.personas.personas[0].income = '世帯年収(約600万円)';
  const ja = render({ lang: 'ja', data });
  assert.ok(ja.includes('パート；会社員'));
  assert.ok(ja.includes('世帯年収（約600万円）'));
  const en = render({ lang: 'en', data });
  assert.ok(en.includes('パート; 会社員'));
  assert.ok(en.includes('世帯年収(約600万円)'));
});

test('long marketplace titles are cut to 70 chars with the full text in a title attribute', () => {
  const data = JSON.parse(JSON.stringify(full.data));
  const long = 'MAX50%OFF coupon balance stones 11 piece set for kids indoor play equipment balance training gift';
  data.marketplace.categories[0].topItems[0].title = long;
  const html = render({ data });
  assert.ok(html.includes(`title="${long}"`));
  assert.ok(html.includes(`>${long.slice(0, 69).trimEnd()}…</span>`));
  assert.ok(html.includes('.u { overflow-wrap: anywhere'));
});

test('persona header is grouped and kept with its content', () => {
  const html = render();
  assert.ok(html.includes('<div class="persona-head"><h3>The Planner Parent</h3>'));
  assert.ok(/\.persona-head \{ break-inside: avoid; break-after: avoid; \}/.test(html));
  assert.ok(!/section\.major \{ break-before: page/.test(html), 'no forced page break before every section');
});

test('missing data argument entirely does not throw', () => {
  const html = renderReport({});
  assert.match(html, /<\/html>$/);
});

test('unknown lang falls back to en', () => {
  const html = render({ lang: 'fr' });
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes(`<h2>${DICT.en.s_summary}</h2>`));
});

test('escapes HTML in strings, including brand name and page header CSS', () => {
  const evil = `<script>alert("x")</script> & 'quoted' "double"`;
  const data = JSON.parse(JSON.stringify(full.data));
  data.action_plan.immediateWins[0].title = evil;
  data.personas.personas[0].name = evil;
  const html = renderReport({ profile: { ...full.profile, url: evil }, brandName: evil, data, lang: 'en', generatedAt: GEN });
  assert.ok(!html.includes('<script>'), 'raw <script> found');
  assert.ok(!html.includes('</script>'), 'raw </script> found');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39; &quot;double&quot;'));
  const style = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  assert.ok(!style.includes('<'), 'angle bracket inside style would allow breaking out');
});

test('no raw JSON or base64 in the output', () => {
  const data = JSON.parse(JSON.stringify(full.data));
  data.social_intelligence.brands[0].screenshotBase64 = 'iVBORw0KGgo' + 'A'.repeat(400);
  data.site_intelligence.brands[0].heroContent.headline = 'data:image/png;base64,' + 'A'.repeat(300);
  const html = render({ data });
  assert.ok(!html.includes('iVBORw0KGgo'));
  assert.ok(!html.includes('base64,'));
  assert.ok(!/AAAAAAAAAAAAAAAAAAAA/.test(html));
  const body = html.slice(html.indexOf('<body>'));
  assert.ok(!/\{"[a-zA-Z_]+":/.test(body), 'JSON object literal in body');
  assert.ok(!body.includes('[object Object]'));
});

test('no em dashes in the output even when data carries them', () => {
  const data = JSON.parse(JSON.stringify(full.data));
  data.action_plan.executiveSummary = 'First part \u2014 second part';
  const html = render({ data });
  assert.ok(!html.includes('\u2014'));
  assert.ok(html.includes('First part, second part'));
});

test('stale entries are labelled in the section and in the data notes', () => {
  for (const lang of ['en', 'ja']) {
    const html = render({ lang });
    const tag = escHtml(DICT[lang].stale);
    assert.ok(html.split(`tag-stale`).length - 1 >= 2, `${lang}: expected stale tags`);
    assert.ok(html.includes(tag));
    const notes = html.slice(html.indexOf('id="sec-notes"'));
    assert.ok(notes.includes(escHtml(DICT[lang].staleItems)), `${lang}: stale table missing in notes`);
    assert.ok(notes.includes('Rival Toys'), 'stale competitor named in notes');
    assert.ok(notes.includes(escHtml(DICT[lang].r_busy)), 'last error shown in notes as a plain reason'); assert.ok(!notes.includes('HTTP 503'), 'raw error not shown');
  }
});

test('blocked target site is stated plainly in the right language', () => {
  for (const lang of ['en', 'ja']) {
    const html = render({ lang });
    const msg = escHtml(DICT[lang].targetBlocked);
    assert.ok(html.split(msg).length - 1 >= 2, `${lang}: blocked message should appear in summary and notes`);
    assert.ok(html.includes(escHtml(DICT[lang].blocked)));
  }
});

test('profile skipApifyRetry with no collected site data counts as blocked even without site file', () => {
  const html = renderReport({ profile: { name: 'X', scrape: { skipApifyRetry: true } }, data: {}, lang: 'ja', generatedAt: GEN });
  assert.ok(html.includes(escHtml(DICT.ja.targetBlocked)));
});

test('header and footer use @page margin boxes with brand, date and page counter', () => {
  const en = render();
  assert.match(en, /@top-left \{ content: "Test Toys Co · Brand Intelligence Report"/);
  assert.match(en, /@bottom-right \{ content: "Page " counter\(page\) ""/);
  const ja = render({ lang: 'ja' });
  assert.match(ja, /@bottom-right \{ content: "" counter\(page\) " ページ"/);
  assert.ok(ja.includes('2026年11月17日'));
});

test('no external requests: no http src or href, no script tags, no @import', () => {
  const html = render();
  assert.ok(!/<script/i.test(html));
  assert.ok(!/(src|href)\s*=\s*"https?:/i.test(html));
  assert.ok(!/@import|url\(/i.test(html));
});

test('render_report loader localizes with modules/localize.js when present', () => {
  const { loadBrandReportInput } = require('../scripts/render_report');
  const dir = path.join(FIX, 'brand');
  const tr = JSON.parse(fs.readFileSync(path.join(FIX, 'translations_ja.json'), 'utf8'));
  const { profile, data } = loadBrandReportInput(dir, 'ja', { generatedAt: GEN, en: {}, ja: { 'Planners who buy early for every birthday.': '誕生日のたびに早めに購入する計画的な保護者。' } });
  assert.strictEqual(profile.name, 'Fixture Brand');
  let localize = null;
  try { localize = require('../modules/localize'); } catch { /* translate lane not present */ }
  if (localize) assert.strictEqual(data.personas.summaryInsights[0], '誕生日のたびに早めに購入する計画的な保護者。');
  else assert.strictEqual(data.personas.summaryInsights[0], 'Planners who buy early for every birthday.');
  assert.strictEqual(data.marketplace, null);
  assert.ok(tr.ja && Object.keys(tr.ja).length > 0);
});

test('loadBrandReportInput localizes the profile too, so CLI and server render the same document', () => {
  const { loadBrandReportInput } = require('../scripts/render_report');
  let localize = null;
  try { localize = require('../modules/localize'); } catch { /* translate lane absent */ }
  if (!localize) return;
  const dir = path.join(FIX, 'brand');
  const tr = JSON.parse(fs.readFileSync(path.join(dir, 'translations.fixture.json'), 'utf8'));
  const ja = loadBrandReportInput(dir, 'ja', tr);
  const jaHtml = renderReport({ profile: ja.profile, brandName: ja.profile.name, data: ja.data, lang: 'ja', generatedAt: GEN });
  assert.ok(jaHtml.includes('ギフト需要に強い全国規模のおもちゃチェーン。'), 'translated English rationale in ja');
  assert.ok(jaHtml.includes('国内最大級のおもちゃ専門チェーン'), 'Japanese rationale kept in ja');
  const en = loadBrandReportInput(dir, 'en', tr);
  const enHtml = renderReport({ profile: en.profile, brandName: en.profile.name, data: en.data, lang: 'en', generatedAt: GEN });
  assert.strictEqual(enHtml.split('国内最大級のおもちゃ専門チェーン').length - 1, 1, 'Japanese source appears once in en');
  assert.ok(enHtml.includes('One of the largest toy specialist chains in Japan'), 'English gloss present in en');
});
