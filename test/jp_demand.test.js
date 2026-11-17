// Japan demand, persona evidence and search/SEO Japan branch. Offline only: no network, no keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'demand');
const readFix = (...p) => JSON.parse(fs.readFileSync(path.join(FIX, ...p), 'utf8'));

const demand = require('../analysis/jp_demand');
const personas = require('../analysis/personas');
const seo = require('../analysis/search_seo');
const legacyPersonaPrompt = require('./fixtures/demand/personas_legacy_prompt');
const legacySeo = require('./fixtures/demand/search_seo_legacy_prompts');

const jpProfile = readFix('brands', 'jp-toy', 'profile.json');
const plainProfile = readFix('brands', 'plain-brand', 'profile.json');
const quiet = () => {};

// Deps that fail the test if anything tries to reach the network.
function trapDeps(calls) {
  return {
    apifyClientFactory: () => { calls.push('apify'); throw new Error('network call attempted'); },
    httpGetJson: async (u) => { calls.push(u); throw new Error('network call attempted'); },
  };
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(saved)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}

function tmpDataDir(withMarketplace) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-demand-'));
  const b = path.join(dir, 'brands', 'jp-toy');
  fs.mkdirSync(b, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brands', 'jp-toy', 'profile.json'), path.join(b, 'profile.json'));
  if (withMarketplace) fs.copyFileSync(path.join(FIX, 'brands', 'jp-toy', 'marketplace.json'), path.join(b, 'marketplace.json'));
  return dir;
}

// ─── jp_demand ──────────────────────────────────────────────────────────────

test('deriveTerms: marketplace Japanese categories first, normalized, then industry vocab, capped at 5', () => {
  const terms = demand.deriveTerms(jpProfile, readFix('brands', 'jp-toy', 'marketplace.json'));
  assert.equal(terms.length, 5);
  assert.deepEqual(terms.slice(0, 2).map(t => [t.term, t.origin]), [['知育玩具', 'marketplace'], ['ブロック', 'marketplace']]);
  assert.ok(!terms.some(t => t.term === 'Toys'), 'non-Japanese category label is not a JP search term');
  assert.ok(terms.some(t => t.term === 'おもちゃ' && t.termEn === 'toys'));
  assert.equal(new Set(terms.map(t => t.term)).size, terms.length, 'deduped');
});

test('deriveTerms: tolerates absent marketplace and unknown industry', () => {
  assert.ok(demand.deriveTerms(jpProfile, null).length > 0);
  assert.deepEqual(demand.deriveTerms({ industry: 'Industrial valves' }, null), []);
  assert.deepEqual(demand.deriveTerms({}, { categories: 'not-an-array' }), []);
});

test('normalizeCategoryLabel strips breadcrumbs and ranking boilerplate', () => {
  assert.equal(demand.normalizeCategoryLabel('おもちゃ > 知育玩具の売れ筋ランキング'), '知育玩具');
  assert.equal(demand.normalizeCategoryLabel('楽天市場 ｜ ブロック'), 'ブロック');
  assert.equal(demand.normalizeCategoryLabel(''), '');
});

test('collectDemand dryRun: makes no network call and writes nothing, even with keys set', async () => {
  const calls = [];
  const logs = [];
  const dir = tmpDataDir(true);
  await withEnv({ APIFY_API_TOKEN: 'fake-token', ESTAT_APP_ID: 'fake-app' }, async () => {
    const out = await demand.collectDemand({ slug: 'jp-toy', dryRun: true, dataDir: dir, log: m => logs.push(m), deps: trapDeps(calls) });
    assert.equal(out.dryRun, true);
    assert.equal(out.trends.length, 5);
  });
  assert.deepEqual(calls, []);
  assert.ok(!fs.existsSync(path.join(dir, 'brands', 'jp-toy', 'jp_demand.json')));
  assert.ok(logs.some(l => l.includes('DRY RUN: would call Apify actor apify/google-trends-scraper') && l.includes('"geo":"JP"')));
  assert.ok(logs.some(l => l.includes('DRY RUN: would GET https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList')));
  assert.ok(!logs.some(l => l.includes('fake-app')), 'e-Stat appId is redacted from logs');
});

test('collectDemand without keys: degrades with reasons, no network, file written', async () => {
  const calls = [];
  const dir = tmpDataDir(false);
  await withEnv({ APIFY_API_TOKEN: null, ESTAT_APP_ID: null }, async () => {
    const out = await demand.collectDemand({ slug: 'jp-toy', dataDir: dir, log: quiet, deps: trapDeps(calls) });
    assert.ok(out.notes.some(n => n.includes('APIFY_API_TOKEN is not set')));
    assert.ok(out.notes.some(n => n.includes('ESTAT_APP_ID is not set')));
    assert.ok(out.notes.some(n => n.includes('marketplace.json not found')));
    assert.equal(out.demographics.omitted, true);
    assert.ok(out.trends.every(t => t.interestOverTime === null));
  });
  assert.deepEqual(calls, []);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'brands', 'jp-toy', 'jp_demand.json'), 'utf8'));
  assert.ok(Array.isArray(written.trends) && written.generatedAt);
});

test('collectDemand with Apify token: parses actor output into a timeline summary', async () => {
  const dir = tmpDataDir(true);
  let input = null;
  const fakeClient = {
    actor: () => ({ call: async (i) => { input = i; return { defaultDatasetId: 'ds1' }; } }),
    dataset: () => ({ listItems: async () => ({ items: readFix('trends_items.json') }) }),
  };
  await withEnv({ APIFY_API_TOKEN: 'fake-token', ESTAT_APP_ID: null }, async () => {
    const out = await demand.collectDemand({ slug: 'jp-toy', dataDir: dir, log: quiet, deps: { apifyClientFactory: () => fakeClient, httpGetJson: async () => { throw new Error('no'); } } });
    assert.equal(input.geo, 'JP');
    const toy = out.trends.find(t => t.term === 'おもちゃ');
    assert.equal(toy.interestOverTime.peak.value, 100);
    assert.equal(toy.interestOverTime.peak.at, 'Dec 2025');
    assert.equal(toy.topRelated[0].query, 'おもちゃ 2歳');
  });
});

test('compactStatsData labels e-Stat rows and caps them', () => {
  const sample = { GET_STATS_DATA: { STATISTICAL_DATA: {
    RESULT_INF: { TOTAL_NUMBER: 3 },
    CLASS_INF: { CLASS_OBJ: [{ '@id': 'time', '@name': '時間軸', CLASS: [{ '@code': '2024000000', '@name': '2024年' }] }] },
    DATA_INF: { VALUE: [{ '@time': '2024000000', '@unit': '人', $: '686061' }, { '@time': 'x', $: '1' }, { '@time': 'y', $: '2' }] },
  } } };
  const out = demand.compactStatsData(sample, 2);
  assert.equal(out.totalRows, 3);
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.rows[0], { value: '686061', unit: '人', 時間軸: '2024年' });
  assert.equal(demand.compactStatsData({}), null);
});

// ─── personas evidence digest ───────────────────────────────────────────────

const promptArgs = (profile) => ({ profile, slug: profile.slug, brandContext: 'CTX', combinedIntel: 'INTEL', now: '2026-11-16T00:00:00.000Z' });

test('personas: no evidence files means the prompt is byte-for-byte the legacy prompt', () => {
  assert.equal(personas.buildEvidenceDigest(null, null), '');
  for (const p of [plainProfile, jpProfile]) {
    assert.equal(personas.buildPersonaPrompt({ ...promptArgs(p), evidenceDigest: '' }), legacyPersonaPrompt(promptArgs(p)));
    assert.equal(personas.buildPersonaPrompt(promptArgs(p)), legacyPersonaPrompt(promptArgs(p)));
  }
  const longIntel = { ...promptArgs(plainProfile), combinedIntel: 'x'.repeat(300) };
  assert.equal(personas.buildPersonaPrompt(longIntel), legacyPersonaPrompt(longIntel));
  const noIntel = { ...promptArgs(plainProfile), combinedIntel: '' };
  assert.equal(personas.buildPersonaPrompt(noIntel), legacyPersonaPrompt(noIntel));
});

test('personas: evidence digest has citation ids and the prompt requires evidence/inferred', () => {
  const digest = personas.buildEvidenceDigest(readFix('brands', 'jp-toy', 'marketplace.json'), readFix('brands', 'jp-toy', 'jp_demand.json'));
  for (const id of ['[R1]', '[R2]', '[B1]', '[C1]', '[T1]', '[D1]']) assert.ok(digest.includes(id), id);
  const prompt = personas.buildPersonaPrompt({ ...promptArgs(jpProfile), evidenceDigest: digest });
  assert.ok(prompt.includes('CUSTOMER EVIDENCE'));
  assert.ok(prompt.includes('"inferred"'));
  assert.ok(prompt.includes('write all persona fields in English'));
  assert.ok(prompt.startsWith(legacyPersonaPrompt(promptArgs(jpProfile)).split('\n\nCreate exactly')[0]));
});

test('personas: digest is size-capped on a 200-review marketplace file', () => {
  const big = {
    reviews: Array.from({ length: 200 }, (_, i) => ({ source: 'rakuten', productTitle: `商品${i}`, rating: (i % 5) + 1, text: 'とても良い'.repeat(120) })),
    brandMix: Array.from({ length: 100 }, (_, i) => ({ brand: `Brand${i}`, count: i })),
    categories: Array.from({ length: 50 }, (_, i) => ({ source: 'amazon_jp', category: `カテゴリ${i}`, topItems: [{ title: 'x'.repeat(200), priceJPY: 1000 }] })),
  };
  const d = personas.buildEvidenceDigest(big, null);
  assert.ok(d.length <= personas.DIGEST_MAX_CHARS, `digest ${d.length} chars`);
  assert.ok(d.includes('(evidence truncated to fit)'));
  const small = personas.buildEvidenceDigest(big, null, { maxChars: 500 });
  assert.ok(small.length <= 500);
  const sampled = personas.sampleReviews(big.reviews, 24);
  assert.ok(sampled.some(r => r.rating <= 3) && sampled.some(r => r.rating > 3), 'low and high ratings both sampled');
});

// ─── search_seo Japan branch ────────────────────────────────────────────────

test('search_seo: Japan detection by market or .jp TLD', () => {
  assert.equal(seo.isJapanMarket(jpProfile), true);
  assert.equal(seo.isJapanMarket({ market: 'JP', url: 'https://x.com' }), true);
  assert.equal(seo.isJapanMarket({ market: '', url: 'https://www.toys.co.jp/' }), true);
  assert.equal(seo.isJapanMarket(plainProfile), false);
  assert.equal(seo.isJapanMarket({ market: 'Lebanon', url: 'not a url' }), false);
});

test('search_seo: Japan selects gl=jp, hl=ja, google.co.jp; non-Japan gets no SERP params', () => {
  assert.deepEqual(seo.serpParamsFor(jpProfile), { engine: 'google', gl: 'jp', hl: 'ja', google_domain: 'google.co.jp' });
  assert.equal(seo.serpParamsFor(plainProfile), null);
  const u = new URL(seo.buildSerpUrl('おもちゃ', seo.serpParamsFor(jpProfile), 'k'));
  assert.equal(u.searchParams.get('gl'), 'jp');
  assert.equal(u.searchParams.get('hl'), 'ja');
  assert.equal(u.searchParams.get('google_domain'), 'google.co.jp');
  assert.equal(u.searchParams.get('q'), 'おもちゃ');
});

test('search_seo: Japan keyword and GEO prompts are Japanese, keep the no-country-name rule', () => {
  const kw = seo.buildKeywordUniversePrompt(jpProfile, {});
  assert.ok(kw.includes('JAPANESE MARKET RULES'));
  assert.ok(kw.includes('"glosses"'));
  assert.ok(kw.includes('Do NOT append "Japan" to terms'));
  assert.ok(kw.includes('Do NOT append "Japan" or "日本"'));
  const geo = seo.buildGeoQueryGenPrompt(jpProfile, ['Rival Toys']);
  assert.ok(geo.includes('in Japanese') && geo.includes('"queryEn"') && geo.includes('Rival Toys'));
  assert.ok(/[぀-ヿ]/.test(seo.geoSystemPrompt(jpProfile)));
  assert.ok(seo.fallbackGeoQueries(jpProfile).every(q => /[぀-ヿ]/.test(q.query) && q.queryEn));
});

test('search_seo: non-Japan prompts are identical to the pre-change prompts', () => {
  const ctx = { targetNav: ['Lego', 'Dolls'], competitorNavs: ['Sale'], onPageSeo: { titleTag: 'T', h1: 'H' } };
  assert.equal(seo.buildKeywordUniversePrompt(plainProfile, ctx), legacySeo.legacyKeywordPrompt(plainProfile, ctx));
  assert.equal(seo.buildGeoQueryGenPrompt(plainProfile, ['X']), legacySeo.legacyGeoQueryGenPrompt(plainProfile));
  assert.equal(seo.geoSystemPrompt(plainProfile), legacySeo.LEGACY_GEO_SYSTEM);
  assert.deepEqual(seo.fallbackGeoQueries(plainProfile), legacySeo.legacyFallbackQueries(plainProfile));
  const noMarket = { name: 'N', industry: 'Toys', url: 'https://n.com/' };
  assert.equal(seo.buildKeywordUniversePrompt(noMarket, ctx), legacySeo.legacyKeywordPrompt(noMarket, ctx));
});

test('search_seo: analyzeAgentResponse unchanged without opts, matches Japanese aliases with opts', () => {
  const en = seo.analyzeAgentResponse('Try Toy Hub. It is the best store. Also Rival Toys.', 'Toy Hub', ['Rival Toys']);
  assert.deepEqual(en, { brandMentioned: true, mentionPosition: 1, sentiment: 'positive', competitorMentions: ['Rival Toys'], snippet: 'Try Toy Hub. It is the best store. Also Rival Toys.' });
  const ja = 'おもちゃならトイハブが人気です。ライバルトイズもおすすめ。';
  assert.equal(seo.analyzeAgentResponse(ja, 'Toy Hub', ['Rival Toys']).brandMentioned, false);
  const jaHit = seo.analyzeAgentResponse(ja, 'Toy Hub', ['Rival Toys'], { japanese: true, brandAliases: ['トイハブ'], competitorAliases: { 'Rival Toys': ['ライバルトイズ'] } });
  assert.equal(jaHit.brandMentioned, true);
  assert.equal(jaHit.mentionPosition, 1);
  assert.equal(jaHit.sentiment, 'positive');
  assert.deepEqual(jaHit.competitorMentions, ['Rival Toys']);
});

test('search_seo: parseJapanGeoQueryGen tolerates junk and keeps glosses', () => {
  assert.deepEqual(seo.parseJapanGeoQueryGen('no json', 'B', []).queries, []);
  const raw = 'x {"brandAliases":["ビー","B",""],"competitorAliases":{"C":["シー"],"Z":["ゼット"]},"queries":[{"id":"q1","category":"local market","query":"渋谷 おもちゃ屋","queryEn":"toy shop shibuya"},{"query":""}]} y';
  const p = seo.parseJapanGeoQueryGen(raw, 'B', ['C']);
  assert.equal(p.queries.length, 1);
  assert.equal(p.queries[0].queryEn, 'toy shop shibuya');
  assert.deepEqual(p.matchOpts.brandAliases, ['ビー']);
  assert.deepEqual(p.matchOpts.competitorAliases, { C: ['シー'] });
});

test('search_seo: SERP rank check is null for non-Japan, soft-skips without key, ranks with a fake fetch', async () => {
  const fetched = [];
  const fetchJson = async (u) => {
    fetched.push(u);
    return { organic_results: [{ position: 1, link: 'https://www.rival-toys.jp/a' }, { position: 4, link: 'https://example-toys.co.jp/b' }] };
  };
  const ku = { categoryTerms: ['おもちゃ', '知育玩具'], glosses: { 'おもちゃ': 'toys' } };
  await withEnv({ SERP_API_KEY: 'secret' }, async () => {
    assert.equal(await seo.runSerpRankCheck(plainProfile, ku, { fetchJson }), null);
    assert.equal(fetched.length, 0);
    const r = await seo.runSerpRankCheck(jpProfile, ku, { fetchJson });
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].targetPosition, 4);
    assert.equal(r.results[0].termEn, 'toys');
    assert.deepEqual(r.results[0].competitorPositions, { 'Rival Toys': 1 });
    assert.ok(fetched.every(u => u.includes('gl=jp') && u.includes('hl=ja') && u.includes('google_domain=google.co.jp')));
  });
  await withEnv({ SERP_API_KEY: null }, async () => {
    const r = await seo.runSerpRankCheck(jpProfile, ku, { fetchJson });
    assert.equal(r.skipped, true);
    assert.match(r.reason, /SERP_API_KEY is not set/);
  });
  assert.equal(fetched.length, 2);
});
