const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  isJapanese, isTranslatableProse, collectStrings, applyTranslations, localizeData,
} = require('../modules/localize');

const FIX = path.join(__dirname, 'fixtures/translate/brand');
const load = f => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

test('isJapanese: hiragana, katakana, kanji, half width katakana', () => {
  assert.equal(isJapanese('おもちゃ'), true);
  assert.equal(isJapanese('プラレール'), true);
  assert.equal(isJapanese('本'), true);
  assert.equal(isJapanese('ｶﾀｶﾅ'), true);
  assert.equal(isJapanese('Build a rotation from 0-1歳'), true);
  assert.equal(isJapanese('Toys R Us Japan'), false);
  assert.equal(isJapanese(''), false);
  assert.equal(isJapanese(null), false);
  assert.equal(isJapanese(42), false);
});

test('isTranslatableProse: prose yes, technical strings no', () => {
  assert.equal(isTranslatableProse('No navigation categories exposed to crawlers at all'), true);
  assert.equal(isTranslatableProse('Toys R Us store'), true);
  assert.equal(isTranslatableProse('Age / developmental stage navigation (0-1歳, 1-3歳, 3-6歳, 小学生 etc.)'), true);
  for (const s of [
    'short text', 'https://www.toysrus.co.jp/some/long/path', 'www.example.com/a/b/c',
    'toysrus.co.jp/category/toys', '/api/social-image/toysrus-jp/rec_0.jpg', '@toysrus_jp_official',
    '#ToysRUsJapanSale', 'someone@example.co.jp', '1,234,567.89 %', '2026-11-16T21:54:00.562Z',
    'November 16, 2026', 'toys_ranking_daily_long_id', 'Two words',
    '他の投稿もCHECK👀 保存 シェア おすすめです Toys R Us',
  ]) {
    assert.equal(isTranslatableProse(s), false, s);
  }
  assert.equal(isTranslatableProse(undefined), false);
  assert.equal(isTranslatableProse('word '.repeat(900)), false, 'over 4000 chars');
});

test('collectStrings en: Japanese only, unique, skip technical keys and history', () => {
  const obj = {
    title: 'おもちゃ',
    dup: ['おもちゃ', 'プラレール'],
    url: 'https://www.rakuten.co.jp/category/おもちゃ/',
    postUrl: 'https://x.com/トイザらス',
    imageUrl: '/img/玩具.jpg',
    id: '玩具ID', slug: 'すらっぐ', handle: 'トイザらス', handleVerified: 'はんどる', xHandle: 'エックス',
    href: '/カテゴリ', src: '画像', token: 'トークン', email: 'メール',
    screenshotBase64: 'あいう', thumbnailUrl: 'サムネ', image: '画像2',
    history: [{ note: '過去の記録' }],
    nested: { deep: [{ x: null, y: 3, z: true, w: '深い' }] },
    english: 'English only text here',
    long: 'あ'.repeat(4001),
  };
  assert.deepEqual(collectStrings(obj, 'en'), ['おもちゃ', 'プラレール', '深い']);
});

test('collectStrings ja: prose only, skip keys respected', () => {
  const obj = {
    a: 'No retrievable hero value proposition at all',
    b: 'おもちゃ',
    url: 'This is under a url key and must be skipped',
    history: ['Old analysis text that should not be sent'],
    c: ['Gift-ready packaging and in-store reservation', 'Gift-ready packaging and in-store reservation'],
    d: 12345,
  };
  assert.deepEqual(collectStrings(obj, 'ja'), [
    'No retrievable hero value proposition at all', 'Gift-ready packaging and in-store reservation',
  ]);
});

test('collectStrings: null, numbers, primitives, cycles, bad direction', () => {
  assert.deepEqual(collectStrings(null, 'en'), []);
  assert.deepEqual(collectStrings(7, 'ja'), []);
  assert.deepEqual(collectStrings('おもちゃ', 'en'), ['おもちゃ']);
  const cyc = { a: 'おもちゃ' };
  cyc.self = cyc;
  assert.deepEqual(collectStrings(cyc, 'en'), ['おもちゃ']);
  assert.throws(() => collectStrings({}, 'fr'));
});

test('collectStrings on real-shaped fixtures', () => {
  const social = load('social_intelligence.json');
  const en = collectStrings(social, 'en');
  assert.ok(en.length > 0);
  assert.ok(en.every(isJapanese));
  // Captions are collected, post urls and image urls are not.
  assert.ok(en.some(s => s === social.brands[0].recentPosts[0].caption));
  assert.ok(!en.some(s => /^https?:/.test(s) || s.startsWith('/api/')));
  const site = load('site_intelligence.json');
  const ja = collectStrings(site, 'ja');
  assert.ok(ja.length > 0);
  assert.ok(ja.every(isTranslatableProse));
  assert.ok(!ja.includes(site.generatedAt));
});

test('applyTranslations gloss and replace, untouched strings and skipped keys', () => {
  const obj = { a: 'おもちゃ', b: ['プラレール', 'Lego'], url: 'おもちゃ', n: 5, z: null, t: true };
  const map = { おもちゃ: 'toys', プラレール: 'Plarail' };
  assert.deepEqual(applyTranslations(obj, map, 'gloss'), {
    a: 'おもちゃ (toys)', b: ['プラレール (Plarail)', 'Lego'], url: 'おもちゃ', n: 5, z: null, t: true,
  });
  assert.deepEqual(applyTranslations(obj, map, 'replace'), {
    a: 'toys', b: ['Plarail', 'Lego'], url: 'おもちゃ', n: 5, z: null, t: true,
  });
  // A Map works too, and empty or identical translations are ignored.
  assert.deepEqual(applyTranslations(['本', '箱', '絵'], new Map([['本', 'book'], ['箱', ''], ['絵', '絵']]), 'gloss'), ['本 (book)', '箱', '絵']);
  // Prototype keys are not treated as translations.
  assert.equal(applyTranslations('constructor', {}, 'replace'), 'constructor');
  assert.throws(() => applyTranslations({}, {}, 'other'));
});

test('gloss: mostly-Latin strings are replaced, mostly-Japanese and ties are glossed', () => {
  const { isMostlyLatin } = require('../modules/localize');
  const mixed = 'Age / developmental stage navigation (0-1歳, 1-3歳, 3-6歳, 小学生 etc.)';
  const mostlyJa = 'トイザらス限定 LEGO セット';
  const tie = 'ab あい'; // 2 Latin letters, 2 Japanese characters
  assert.equal(isMostlyLatin(mixed), true);
  assert.equal(isMostlyLatin(mostlyJa), false);
  assert.equal(isMostlyLatin(tie), false);
  const map = {
    [mixed]: 'Age / developmental stage navigation (0-1 yrs, 1-3 yrs, 3-6 yrs, elementary school etc.)',
    [mostlyJa]: 'Toys R Us exclusive LEGO set',
    [tie]: 'ab ai',
  };
  assert.deepEqual(applyTranslations([mixed, mostlyJa, tie], map, 'gloss'), [
    map[mixed], `${mostlyJa} (${map[mostlyJa]})`, `${tie} (${map[tie]})`,
  ]);
  // The gloss rule and isTranslatableProse use the same count, so they agree.
  assert.equal(isTranslatableProse(mixed), isMostlyLatin(mixed));
  assert.equal(isTranslatableProse(mostlyJa), false);
  // localizeData 'en' follows the same rule.
  assert.deepEqual(localizeData({ a: mixed, b: mostlyJa }, 'en', { en: map }), { a: map[mixed], b: `${mostlyJa} (${map[mostlyJa]})` });
});

test('applyTranslations and localizeData never mutate input', () => {
  const social = load('social_intelligence.json');
  const before = JSON.stringify(social);
  const en = collectStrings(social, 'en');
  const map = Object.fromEntries(en.map(s => [s, `EN(${s.length})`]));
  const out = applyTranslations(social, map, 'replace');
  assert.equal(JSON.stringify(social), before);
  assert.notStrictEqual(out, social);
  assert.notStrictEqual(out.brands, social.brands);
  assert.equal(out.brands[0].recentPosts[0].postUrl, social.brands[0].recentPosts[0].postUrl);
  assert.ok(out.brands[0].recentPosts[0].caption.startsWith('EN('));
  localizeData(social, 'en', { en: map, ja: {} });
  localizeData(social, 'ja', { en: {}, ja: map });
  assert.equal(JSON.stringify(social), before);
});

test('localizeData: orig, en gloss, ja replace keeps Japanese', () => {
  const obj = { title: 'おもちゃ', note: 'No navigation categories exposed to crawlers at all' };
  const tr = {
    en: { おもちゃ: 'toys' },
    ja: { 'No navigation categories exposed to crawlers at all': 'クローラーに公開されたナビゲーションカテゴリがない' },
  };
  assert.strictEqual(localizeData(obj, 'orig', tr), obj);
  assert.strictEqual(localizeData(obj, undefined, tr), obj);
  assert.deepEqual(localizeData(obj, 'en', tr), { title: 'おもちゃ (toys)', note: obj.note });
  assert.deepEqual(localizeData(obj, 'ja', tr), { title: 'おもちゃ', note: tr.ja[obj.note] });
  assert.deepEqual(localizeData(obj, 'ja', null), obj);
  assert.deepEqual(localizeData(obj, 'en', {}), obj);
  assert.equal(localizeData(null, 'en', tr), null);
});
