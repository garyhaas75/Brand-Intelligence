'use strict'
// Interface translation: t() interpolation and fallback, the extraction rules,
// and the source list staying in step with the t('...') calls in the dashboard.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { analyze, collect, looksUI, cleanJSX, OUT, SRC_DIR, FILES } = require('../scripts/extract_ui_strings')

const core = () => import(pathToFileURL(path.join(__dirname, '..', 'dashboard', 'src', 'i18n-core.js')).href)
const FIX = path.join(__dirname, 'fixtures', 'ui', 'Sample.jsx')

test('t: en and orig return the English with vars, ja uses the dictionary', async () => {
  const { translate } = await core()
  const dict = { 'Signed in as {email}.': '{email} でサインイン中。', Refresh: '更新' }
  for (const lang of ['en', 'orig']) {
    assert.equal(translate(lang, 'Refresh', undefined, dict), 'Refresh')
    assert.equal(translate(lang, 'Signed in as {email}.', { email: 'a@b.c' }, dict), 'Signed in as a@b.c.')
  }
  assert.equal(translate('ja', 'Refresh', undefined, dict), '更新')
  assert.equal(translate('ja', 'Signed in as {email}.', { email: 'a@b.c' }, dict), 'a@b.c でサインイン中。')
})

test('t: a missing ja key falls back to the English, never blank, and reports the miss', async () => {
  const { translate } = await core()
  const missed = []
  assert.equal(translate('ja', 'Not in the dictionary ({n})', { n: 3 }, { x: 'y' }, null, s => missed.push(s)), 'Not in the dictionary (3)')
  assert.equal(translate('ja', 'Empty value', undefined, { 'Empty value': '' }), 'Empty value')
  assert.deepEqual(missed, ['Not in the dictionary ({n})'])
})

test('fmt: null, undefined and booleans render as nothing; unknown placeholders stay', async () => {
  const { fmt } = await core()
  assert.equal(fmt('{a}|{b}|{c}|{d}|{zero}', { a: null, b: undefined, c: false, d: 'x', zero: 0 }), '|||x|0')
  assert.equal(fmt('Keep {other}', { name: 1 }), 'Keep {other}')
  assert.equal(fmt('No vars {x}'), 'No vars {x}')
  // A React node among the vars: parts go to the element builder in order.
  const el = { type: 'b' }
  assert.deepEqual(fmt('Score {n} of {max}', { n: el, max: 10 }, (...p) => p), ['Score ', el, ' of ', '10'])
})

test('cleanJSX follows the JSX whitespace rule', () => {
  assert.equal(cleanJSX('\n    Hello\n    world  \n  '), 'Hello world')
  assert.equal(cleanJSX(' Hello '), ' Hello ')
})

test('looksUI keeps prose and labels, drops ids, classes, urls, css and brand names', () => {
  for (const s of ['Refresh', 'Search & SEO', 'No meta description yet.']) assert.equal(looksUI(s), true, s)
  for (const s of ['bp-chips', 'site_intelligence', 'https://x.jp/', '/api/brands', '1px solid #ccc', 'camelCase', 'SEO', 'Instagram', 'LINE', 'Toys R Us', '#fff', 'icon.svg']) assert.equal(looksUI(s), false, s)
})

test('extraction on a fixture: what counts and what is ignored', () => {
  const src = fs.readFileSync(FIX, 'utf8')
  const texts = new Set(analyze(src, 'Sample.jsx').strings.map(s => s.text))
  for (const s of ['Competitor overview', 'Identified Competitors ({n})', 'Search brands', 'Close panel', 'Loading data...', 'Nothing yet',
    'Meta Description', 'No meta description: Google picks random text', 'Too short ({length} chars)', 'Could not save the profile',
    'Signal', 'Current Value', 'Overview tab', 'Already wrapped']) {
    assert.ok(texts.has(s), 'missing ' + s)
  }
  for (const s of ['high', 'Compared Value', 'card-title', 'https://example.com/', 'console only message', 'Thrown, never shown',
    'Instagram', 'TikTok', '1px solid #ddd', 'site_intelligence', 'Stored Key']) {
    assert.ok(!texts.has(s), 'should ignore ' + s)
  }
})

test('codemod on the fixture: splices t() in place and adds the hook', () => {
  const { transform } = require('../scripts/apply_ui_i18n')
  const src = fs.readFileSync(FIX, 'utf8')
  const out = transform(src, 'Sample.jsx').code
  assert.match(out, /import \{ useT(, fmt)? \} from '\.\/i18n\.js'/)
  assert.match(out, /const t = useT\(\)/)
  assert.match(out, /\{t\('Identified Competitors \(\{n\}\)', \{ n \}\)\}/)
  assert.match(out, /placeholder=\{t\('Search brands'\)\}/)
  assert.match(out, /t\('Too short \(\{length\} chars\)', \{ length: seo\.metaDescription\.length \}\)/)
  assert.match(out, /x === 'Compared Value'/)
  // Module-level constants keep the English key at the definition.
  assert.match(out, /label: 'Overview tab'/)
  // Lines without strings are untouched.
  assert.match(out, /className="card-title"/)
  // Running the extractor on the output finds the same strings.
  const before = new Set(analyze(src, 'Sample.jsx').strings.map(s => s.text))
  const after = new Set(analyze(out, 'Sample.jsx').strings.map(s => s.text))
  assert.deepEqual([...after].sort(), [...before].sort())
})

test('ui.en.json: sorted, unique, no empty strings, and matches a fresh extraction', () => {
  const list = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  assert.ok(list.length > 300, 'expected the full interface, got ' + list.length)
  const texts = list.map(e => e.text)
  assert.equal(new Set(texts).size, texts.length, 'duplicates')
  for (const e of list) {
    assert.equal(typeof e.text, 'string')
    assert.ok(e.text.trim().length > 0, 'empty string')
    assert.match(e.at, /^[\w.-]+\.(jsx|js):\d+$/)
  }
  assert.deepEqual(texts, [...texts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
  assert.deepEqual(texts, collect().map(e => e.text), 'ui.en.json is stale: run node scripts/extract_ui_strings.js')
})

test("every t('...') key in the dashboard source exists in ui.en.json", () => {
  const known = new Set(JSON.parse(fs.readFileSync(OUT, 'utf8')).map(e => e.text))
  const missing = []
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(SRC_DIR, f), 'utf8')
    for (const s of analyze(src, f).strings) if (s.kind === 't' && !known.has(s.text)) missing.push(`${f}:${s.line} ${s.text}`)
  }
  assert.deepEqual(missing, [])
})

test('ja.json is a flat map of strings whose keys are known source strings', () => {
  const ja = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'i18n', 'ja.json'), 'utf8'))
  const known = new Set(JSON.parse(fs.readFileSync(OUT, 'utf8')).map(e => e.text))
  for (const [k, v] of Object.entries(ja)) {
    assert.equal(typeof v, 'string', k)
    assert.ok(known.has(k), 'unknown key in ja.json: ' + k)
    for (const ph of k.match(/\{\w+\}/g) || []) assert.ok(v.includes(ph), `placeholder ${ph} lost in: ${k}`)
  }
})

test('every interface string has a Japanese entry (an English edit without re-running extraction and translation fails here)', () => {
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../dashboard/src/i18n/ui.en.json'), 'utf8')).map(x => (typeof x === 'string' ? x : x.text));
  const ja = JSON.parse(fs.readFileSync(path.join(__dirname, '../dashboard/src/i18n/ja.json'), 'utf8'));
  const missing = en.filter(s => !ja[s] || !String(ja[s]).trim());
  assert.deepStrictEqual(missing, [], 'missing Japanese for: ' + missing.slice(0, 5).join(' | '));
});

test('context keys: Action Plan@@nav renders as Action Plan in English and has its own Japanese', async () => {
  const { translate } = await core()
  const dict = { 'Action Plan@@nav': 'アクション', 'Action Plan': 'アクションプラン' }
  assert.equal(translate('en', 'Action Plan@@nav', undefined, dict), 'Action Plan')
  assert.equal(translate('orig', 'Action Plan@@nav', undefined, dict), 'Action Plan')
  assert.equal(translate('ja', 'Action Plan@@nav', undefined, dict), 'アクション')
  assert.equal(translate('ja', 'Action Plan', undefined, dict), 'アクションプラン')
  assert.equal(translate('ja', 'Unknown tab@@nav', undefined, dict), 'Unknown tab')
})

test('tEnum: maps known data values for ja only, never changes English or unknown values', async () => {
  const { translate, tEnum, ENUM_LABELS } = await core()
  const dict = { High: '高', 'Quick Win': 'すぐできる' }
  const tJa = Object.assign((s, v) => translate('ja', s, v, dict), { lang: 'ja' })
  const tEn = Object.assign((s, v) => translate('en', s, v, dict), { lang: 'en' })
  assert.equal(tEnum(tJa, 'high'), '高')
  assert.equal(tEnum(tJa, 'HIGH'), '高')
  assert.equal(tEnum(tJa, 'Quick Win'), 'すぐできる')
  assert.equal(tEnum(tJa, 'medium'), 'Medium') // known, not yet translated: English label
  assert.equal(tEnum(tJa, 'something else'), 'something else')
  assert.equal(tEnum(tEn, 'high'), 'high')
  assert.equal(tEnum(tJa, null), null)
  const known = new Set(JSON.parse(fs.readFileSync(OUT, 'utf8')).map(e => e.text))
  for (const k of ENUM_LABELS) assert.ok(known.has(k), 'enum label missing from ui.en.json: ' + k)
})
