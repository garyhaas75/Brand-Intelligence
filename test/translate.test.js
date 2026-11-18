const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../utils/translate');
const { makeBatches, validateReply, readCache, cacheKey } = T;
// These tests are about batching, caching and failures. Their fake replies echo the Japanese source,
// which the residual-Japanese retry (tested separately below) would treat as a bad English answer.
const translateStrings = (strings, direction, opts = {}) => T.translateStrings(strings, direction, { residualRetry: false, ...opts });
const outputs = require('../analysis/translate_outputs');
const checkpoint = require('../utils/checkpoint');

const FIX = path.join(__dirname, 'fixtures/translate/brand');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bi-translate-'));

// Stub Anthropic client. `behave(batchInput, callNo)` returns the reply text, or throws.
function stubClient(behave) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async req => {
        const input = JSON.parse(req.messages[0].content);
        calls.push({ req, input });
        const text = behave ? behave(input, calls.length) : JSON.stringify(Object.fromEntries(
          Object.entries(input).map(([k, v]) => [k, `T:${v}`])));
        return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] };
      },
    },
  };
}
const echo = input => JSON.stringify(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, `T:${v}`])));

test('makeBatches splits by count and characters', () => {
  const strings = Array.from({ length: 95 }, (_, i) => `s${i}`);
  assert.deepEqual(makeBatches(strings, 40, 6000).map(b => b.length), [40, 40, 15]);
  const big = ['a'.repeat(5000), 'b'.repeat(2000), 'c'.repeat(100), 'd'.repeat(7000)];
  assert.deepEqual(makeBatches(big, 40, 6000).map(b => b.length), [1, 2, 1]);
});

test('validateReply: object, array, fenced, wrapper; rejects bad shapes', () => {
  assert.deepEqual(validateReply('{"0":"a","1":"b"}', 2), ['a', 'b']);
  assert.deepEqual(validateReply('["a","b"]', 2), ['a', 'b']);
  assert.deepEqual(validateReply('```json\n{"0":"a"}\n```', 1), ['a']);
  assert.deepEqual(validateReply('Here: {"translations":{"0":"a"}}', 1), ['a']);
  assert.throws(() => validateReply('not json', 1), /JSON/);
  assert.throws(() => validateReply('["a"]', 2), /expected 2/);
  assert.throws(() => validateReply('{"0":"a"}', 2), /item 1/);
  assert.throws(() => validateReply('{"0":"  "}', 1), /item 0/);
  assert.throws(() => validateReply('{"0":5}', 1), /item 0/);
  assert.throws(() => validateReply('', 1));
});

test('translateStrings batches, uses MODEL_FAST, writes the cache', async () => {
  const dir = tmpDir();
  const cacheFile = path.join(dir, 'cache.json');
  const client = stubClient();
  const strings = Array.from({ length: 85 }, (_, i) => `文字列${i}`);
  const map = await translateStrings([...strings, strings[0]], 'en', { client, cacheFile, concurrency: 2 });
  assert.equal(client.calls.length, 3);
  assert.deepEqual(client.calls.map(c => Object.keys(c.input).length).sort((a, b) => a - b), [5, 40, 40]);
  const req = client.calls[0].req;
  assert.equal(req.model, require('../utils/models').MODEL_FAST);
  assert.ok(req.max_tokens >= require('../utils/models').MIN_TOKENS_JSON);
  assert.equal(map.size, 85);
  assert.equal(map.get('文字列3'), 'T:文字列3');
  assert.equal(map.stats.translated, 85);
  assert.equal(map.stats.failed, 0);
  const cache = readCache(cacheFile);
  assert.equal(cache.entries[cacheKey('en', '文字列3')].t, 'T:文字列3');
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')).length, 0);
});

test('cache hit means no client call; directions are cached separately', async () => {
  const cacheFile = path.join(tmpDir(), 'cache.json');
  await translateStrings(['おもちゃ', 'プラレール'], 'en', { client: stubClient(), cacheFile });
  const client = stubClient();
  const map = await translateStrings(['おもちゃ', 'プラレール'], 'en', { client, cacheFile });
  assert.equal(client.calls.length, 0);
  assert.equal(map.get('おもちゃ'), 'T:おもちゃ');
  assert.equal(map.stats.cached, 2);
  const other = stubClient();
  await translateStrings(['おもちゃ'], 'ja', { client: other, cacheFile });
  assert.equal(other.calls.length, 1);
});

test('failed batch is retried once, then left untranslated and reported', async () => {
  const cacheFile = path.join(tmpDir(), 'cache.json');
  // Batch containing "bad" always fails; the other batch succeeds.
  const client = stubClient(input => {
    if (Object.values(input).includes('悪い')) throw new Error('overloaded');
    return echo(input);
  });
  const map = await translateStrings(['良い', '悪い'], 'en', { client, cacheFile, batchSize: 1, concurrency: 1 });
  assert.equal(client.calls.length, 3, 'one good call plus two attempts for the bad batch');
  assert.equal(map.get('良い'), 'T:良い');
  assert.equal(map.has('悪い'), false);
  assert.equal(map.stats.failed, 1);
  assert.deepEqual(map.stats.failedStrings, ['悪い']);
  assert.equal(readCache(cacheFile).entries[cacheKey('en', '悪い')], undefined);
});

test('bad JSON then good JSON: retry succeeds; bad JSON twice: untranslated', async () => {
  const cacheFile = path.join(tmpDir(), 'cache.json');
  let n = 0;
  const flaky = stubClient(input => (++n === 1 ? 'sorry, here you go: {broken' : echo(input)));
  const map = await translateStrings(['一'], 'en', { client: flaky, cacheFile });
  assert.equal(flaky.calls.length, 2);
  assert.equal(map.get('一'), 'T:一');
  const short = stubClient(() => '["only one"]');
  const map2 = await translateStrings(['二', '三'], 'en', { client: short, cacheFile });
  assert.equal(short.calls.length, 2);
  assert.equal(map2.stats.failed, 2);
  const truncated = {
    calls: [],
    messages: { create: async () => { truncated.calls.push(1); return { stop_reason: 'max_tokens', content: [] }; } },
  };
  const map3 = await translateStrings(['四'], 'en', { client: truncated, cacheFile });
  assert.equal(truncated.calls.length, 2);
  assert.equal(map3.stats.failed, 1);
});

test('no key and dry run make no call and return cached entries only', async () => {
  const cacheFile = path.join(tmpDir(), 'cache.json');
  await translateStrings(['おもちゃ'], 'en', { client: stubClient(), cacheFile });
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const map = await translateStrings(['おもちゃ', '新しい'], 'en', { cacheFile });
    assert.equal(map.stats.noKey, true);
    assert.equal(map.get('おもちゃ'), 'T:おもちゃ');
    assert.equal(map.has('新しい'), false);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
  const client = stubClient();
  const dry = await translateStrings(['新しい'], 'en', { client, cacheFile, dryRun: true });
  assert.equal(client.calls.length, 0);
  assert.equal(dry.stats.dryRun, true);
});

test('maxStrings and maxChars caps', async () => {
  const cacheFile = path.join(tmpDir(), 'cache.json');
  const client = stubClient();
  const map = await translateStrings(['あ', 'い', 'う', 'え'], 'en', { client, cacheFile, maxStrings: 2 });
  assert.equal(map.stats.translated, 2);
  assert.equal(map.stats.skipped, 2);
  const map2 = await translateStrings(['かかかか', 'きききき'], 'en', { client: stubClient(), cacheFile, maxChars: 5 });
  assert.equal(map2.stats.translated, 1);
});

test('cache write failure never throws', async () => {
  const dir = tmpDir();
  const blocker = path.join(dir, 'file');
  fs.writeFileSync(blocker, 'x');
  const map = await translateStrings(['あ'], 'en', { client: stubClient(), cacheFile: path.join(blocker, 'cache.json') });
  assert.equal(map.get('あ'), 'T:あ');
  assert.equal(map.stats.cacheWriteOk, false);
});

// ---- analysis/translate_outputs.js ----

function brandSandbox() {
  const dataDir = tmpDir();
  const brandDir = path.join(dataDir, 'brands', 'demo');
  fs.mkdirSync(brandDir, { recursive: true });
  for (const f of fs.readdirSync(FIX)) fs.copyFileSync(path.join(FIX, f), path.join(brandDir, f));
  return { dataDir, brandDir, outFile: path.join(brandDir, 'translations.json') };
}
const quiet = () => {};

test('translate_outputs writes translations.json for both directions', async () => {
  const { dataDir, outFile } = brandSandbox();
  const client = stubClient();
  const res = await outputs.run({ slug: 'demo', dataDir, client, log: quiet });
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.ok(out.generatedAt);
  assert.equal(Object.keys(out.en).length, res.summary.enCount);
  assert.equal(Object.keys(out.ja).length, res.summary.jaCount);
  assert.ok(res.summary.enCount > 0 && res.summary.jaCount > 0);
  assert.equal(out.stats.failed, 0);
  assert.match(out.stats.costNote, /calls/);
  assert.deepEqual(checkpoint.keys('demo', 'translate', { dataDir }), []);
  // A second run is fully cached: no calls.
  const again = stubClient();
  await outputs.run({ slug: 'demo', dataDir, client: again, log: quiet });
  assert.equal(again.calls.length, 0);
});

test('translate_outputs dry run makes no call and writes nothing', async () => {
  const { dataDir, brandDir } = brandSandbox();
  const before = fs.readdirSync(brandDir).sort();
  const client = stubClient();
  const lines = [];
  const res = await outputs.run({ slug: 'demo', dataDir, client, dryRun: true, log: l => lines.push(l) });
  assert.equal(client.calls.length, 0);
  assert.equal(res.dryRun, true);
  assert.deepEqual(fs.readdirSync(brandDir).sort(), before);
  assert.equal(fs.existsSync(path.join(dataDir, 'translations_cache.json')), false);
  assert.ok(lines.some(l => /chars would be sent/.test(l)));
});

test('translate_outputs keeps the previous file on failure and merges on success', async () => {
  const { dataDir, brandDir, outFile } = brandSandbox();
  const { en, ja } = outputs.collectAll(outputs.loadSources(brandDir));
  const prev = { generatedAt: 'old', translatorVersion: outputs.TRANSLATOR_VERSION, en: { [en[0]]: 'old entry' }, ja: { [ja[0]]: '古い文' }, stats: {} };
  fs.writeFileSync(outFile, JSON.stringify(prev));
  const client = stubClient();
  await outputs.run({ slug: 'demo', dataDir, client, log: quiet, cacheFile: path.join(dataDir, 'c1.json') });
  let out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(out.en[en[0]], 'old entry', 'previous entries for current strings survive and are reused');
  assert.equal(out.ja[ja[0]], '古い文');
  const sent = client.calls.flatMap(c => Object.values(c.input));
  assert.ok(!sent.includes(ja[0]), 'a previous entry is not sent again');
  assert.ok(Object.keys(out.en).length > 1);

  // A run whose output write fails must leave the previous file exactly as it was.
  fs.writeFileSync(outFile, JSON.stringify(prev));
  const origRename = fs.renameSync;
  fs.renameSync = (a, b) => { if (b === outFile) throw new Error('rename failed'); return origRename(a, b); };
  try {
    await assert.rejects(outputs.run({ slug: 'demo', dataDir, client: stubClient(), log: quiet, cacheFile: path.join(dataDir, 'c2.json') }), /rename failed/);
  } finally { fs.renameSync = origRename; }
  out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.deepEqual(out, prev);
  assert.equal(fs.readdirSync(path.dirname(outFile)).filter(f => f.endsWith('.tmp')).length, 0);
  // The checkpoint stays so the next run resumes without paying.
  assert.ok(checkpoint.keys('demo', 'translate', { dataDir }).length > 0);
});

test('translate_outputs: all batches failing still writes, reports failures, keeps old entries', async () => {
  const { dataDir, brandDir, outFile } = brandSandbox();
  const { en } = outputs.collectAll(outputs.loadSources(brandDir));
  fs.writeFileSync(outFile, JSON.stringify({ translatorVersion: outputs.TRANSLATOR_VERSION, en: { [en[0]]: 'old' }, ja: {} }));
  const crashing = stubClient(() => { throw new Error('overloaded'); });
  const res = await outputs.run({ slug: 'demo', dataDir, client: crashing, log: quiet });
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(out.en[en[0]], 'old');
  assert.equal(out.stats.failed, res.summary.enCount - 1 + res.summary.jaCount);
  assert.ok(out.stats.failedSample.en.length > 0);
});

test('translateStrings saves each finished batch to the checkpoint', async () => {
  const puts = [];
  const cp = { get: () => undefined, put: (k, v) => { puts.push([k, v]); throw new Error('save failed'); } };
  const map = await translateStrings(['あ', 'い', 'う'], 'en', {
    client: stubClient(), cacheFile: path.join(tmpDir(), 'c.json'), checkpoint: cp, batchSize: 2, concurrency: 1,
  });
  assert.equal(map.size, 3, 'a failing checkpoint save does not fail the run');
  assert.deepEqual(puts.map(p => p[0]), ['en:0', 'en:1']);
  assert.deepEqual(puts[0][1], { strings: ['あ', 'い'], out: ['T:あ', 'T:い'] });
});

test('translate_outputs resumes from checkpoint without paying again', async () => {
  const { dataDir, outFile } = brandSandbox();
  const { en } = outputs.collectAll(outputs.loadSources(path.join(dataDir, 'brands', 'demo')));
  // What a crashed run leaves behind: batch 0 of the en direction saved, no output, no cache.
  checkpoint.put('demo', 'translate', 'en:0', { strings: en.slice(0, 5), out: en.slice(0, 5).map(s => `CP:${s}`) }, { dataDir });
  // A stale entry whose strings no longer match is ignored rather than misapplied.
  checkpoint.put('demo', 'translate', 'en:1', { strings: ['別の'], out: ['other'] }, { dataDir });
  const lines = [];
  const client = stubClient();
  await outputs.run({ slug: 'demo', dataDir, client, log: l => lines.push(String(l)), batchSize: 5, concurrency: 1 });
  // Only the en direction calls (a mixed string can also be English prose for the ja direction).
  const sent = client.calls.filter(c => /into English/.test(c.req.system)).flatMap(c => Object.values(c.input));
  assert.ok(en.slice(0, 5).every(s => !sent.includes(s)), 'the checkpointed batch is not sent again');
  assert.ok(en.slice(5).every(s => sent.includes(s)));
  assert.ok(lines.some(l => /resumed from checkpoint/.test(l)));
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(out.en[en[0]], `CP:${en[0]}`);
  assert.equal(out.stats.resumedBatches, 1);
  assert.equal(Object.keys(out.en).length, en.length);
  assert.deepEqual(checkpoint.keys('demo', 'translate', { dataDir }), [], 'checkpoint cleared after write');
});

test('capSocialCaptions keeps the first N captions per brand without mutating', () => {
  const social = {
    brands: [
      { name: 'A', recentPosts: [{ caption: 'いち' }, { caption: 'に' }], xData: { topPosts: [{ caption: 'さん' }] } },
      { name: 'B', recentPosts: [{ caption: 'よん' }] },
    ],
  };
  const before = JSON.stringify(social);
  const { data, dropped } = outputs.capSocialCaptions(social, 2);
  assert.equal(dropped, 1);
  assert.equal(data.brands[0].xData.topPosts[0].caption, undefined);
  assert.equal(data.brands[1].recentPosts[0].caption, 'よん');
  assert.equal(JSON.stringify(social), before);
});

test('parseArgs', () => {
  assert.deepEqual(outputs.parseArgs(['--slug=toysrus-jp', '--dry-run', '--max-strings=10', '--max-chars=500']), { slug: 'toysrus-jp', dryRun: true, maxStrings: 10, maxChars: 500 });
});

test('translations.json holds only strings in the current data; the cache keeps the rest', async () => {
  const { dataDir, brandDir, outFile } = brandSandbox();
  const cacheFile = path.join(dataDir, 'translations_cache.json');
  const pFile = path.join(brandDir, 'personas.json');
  const personas = JSON.parse(fs.readFileSync(pFile, 'utf8'));
  personas.summaryInsights.push('消える予定の文字列', 'This sentence will be removed from the data soon');
  fs.writeFileSync(pFile, JSON.stringify(personas));
  // A previous file with an entry for a string that is not in the data at all.
  fs.writeFileSync(outFile, JSON.stringify({ en: { 昔の文字列: 'old string' }, ja: {} }));
  await outputs.run({ slug: 'demo', dataDir, client: stubClient(), log: quiet });
  let out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(out.en['消える予定の文字列'], 'T:消える予定の文字列');
  assert.equal(out.ja['This sentence will be removed from the data soon'], 'T:This sentence will be removed from the data soon');
  assert.equal(out.en['昔の文字列'], undefined, 'an entry for a string absent from the data is dropped');

  personas.summaryInsights = personas.summaryInsights.slice(0, -2);
  fs.writeFileSync(pFile, JSON.stringify(personas));
  const client = stubClient();
  await outputs.run({ slug: 'demo', dataDir, client, log: quiet });
  assert.equal(client.calls.length, 0, 'nothing new to translate');
  out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(out.en['消える予定の文字列'], undefined);
  assert.equal(out.ja['This sentence will be removed from the data soon'], undefined);
  const cache = readCache(cacheFile);
  assert.equal(cache.entries[cacheKey('en', '消える予定の文字列')].t, 'T:消える予定の文字列');
  assert.equal(cache.entries[cacheKey('ja', 'This sentence will be removed from the data soon')].t, 'T:This sentence will be removed from the data soon');

  // Re-adding the string costs nothing: it comes back from the cache.
  personas.summaryInsights.push('消える予定の文字列');
  fs.writeFileSync(pFile, JSON.stringify(personas));
  const third = stubClient();
  await outputs.run({ slug: 'demo', dataDir, client: third, log: quiet });
  assert.equal(third.calls.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(outFile, 'utf8')).en['消える予定の文字列'], 'T:消える予定の文字列');
});

test('translate_outputs maxChars caps source characters per direction in collection order', async () => {
  const { dataDir, brandDir, outFile } = brandSandbox();
  const { en } = outputs.collectAll(outputs.loadSources(brandDir));
  const cap = en[0].length + en[1].length; // exactly the first two en strings fit
  const client = stubClient();
  const res = await outputs.run({ slug: 'demo', dataDir, client, log: quiet, maxChars: cap, residualRetry: false });
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.deepEqual(Object.keys(out.en), [en[0], en[1]]);
  assert.equal(out.stats.truncated.en, en.length - 2);
  assert.equal(out.stats.truncated.maxChars, cap);
  assert.ok(out.stats.truncated.ja > 0);
  assert.match(out.stats.costNote, new RegExp(`${cap} characters`));
  const sentEn = client.calls.filter(c => /into English/.test(c.req.system)).flatMap(c => Object.values(c.input));
  assert.equal(sentEn.reduce((n, s) => n + s.length, 0) <= cap, true);
  assert.equal(res.summary.enCount, en.length);
  assert.equal(outputs.DEFAULT_MAX_CHARS, 400000);
});

test('writeCache: three concurrent processes writing distinct keys lose nothing', async () => {
  const { spawn } = require('child_process');
  const cacheFile = path.join(tmpDir(), 'cache.json');
  const modPath = require.resolve('../utils/translate');
  const script = `
    const { writeCache } = require(${JSON.stringify(modPath)});
    const [file, who] = process.argv.slice(1);
    let ok = 0;
    for (let i = 0; i < 40; i++) {
      if (writeCache(file, { [who + '-' + i]: { s: who + i, t: 'x', d: 'en' } })) ok++;
    }
    process.stdout.write(String(ok));
  `;
  const runOne = who => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', script, cacheFile, who]);
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(Number(out)) : reject(new Error(`exit ${code}`))));
  });
  const oks = await Promise.all(['a', 'b', 'c'].map(runOne));
  assert.deepEqual(oks, [40, 40, 40], 'every write took the lock');
  const keys = Object.keys(readCache(cacheFile).entries);
  assert.equal(keys.length, 120);
  for (const who of ['a', 'b', 'c']) for (let i = 0; i < 40; i++) assert.ok(keys.includes(`${who}-${i}`));
  assert.equal(fs.existsSync(`${cacheFile}.lock`), false);
});

test('writeCache skips (never throws) when the lock is held, and breaks a dead holder lock', () => {
  const { writeCache } = require('../utils/translate');
  const cacheFile = path.join(tmpDir(), 'cache.json');
  const lock = `${cacheFile}.lock`;
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); // a live holder
  const t0 = Date.now();
  assert.equal(writeCache(cacheFile, { k: { s: 'a', t: 'b' } }, { lockWaitMs: 150 }), false);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(fs.existsSync(cacheFile), false);
  fs.writeFileSync(path.join(lock, 'pid'), '999999999'); // holder no longer running
  assert.equal(writeCache(cacheFile, { k: { s: 'a', t: 'b' } }, { lockWaitMs: 150 }), true);
  assert.equal(readCache(cacheFile).entries.k.t, 'b');
});

test('output token request stays under the SDK non-streaming limit for every default-size batch (real run failed at 22000)', () => {
  const { maxTokensFor, DEFAULT_BATCH_CHARS, makeBatches } = require('../utils/translate');
  const big = Array.from({ length: 200 }, (_, i) => 'x'.repeat(300 + (i % 7) * 400));
  for (const b of makeBatches(big)) {
    const tok = maxTokensFor(b);
    assert.ok(tok <= 20000, `batch of ${b.length} strings asks for ${tok} tokens`);
  }
  // even one string longer than the batch limit may not exceed the cap
  assert.ok(maxTokensFor(['y'.repeat(DEFAULT_BATCH_CHARS * 3)]) <= 20000);
});

test('English output: the prompt forbids Japanese, residual Japanese is retried once with the strict rule, and the cache is versioned', async () => {
  const { buildPrompt } = T;
  const sys = buildPrompt(['x'], 'en').system;
  assert.match(sys, /NO Japanese characters/);
  assert.match(sys, /知育玩具 \(educational toys\)/);
  assert.doesNotMatch(sys, /hashtags[^\n]*exactly as they are/);
  assert.match(buildPrompt(['x'], 'ja').system, /Keep hashtags exactly as they are/);
  assert.match(buildPrompt(['x'], 'en', { strict: true }).system, /remove every one of them/);
  const sha = d => require('crypto').createHash('sha1').update(d).digest('hex');
  assert.notStrictEqual(cacheKey('en', 'a'), sha('en\na'), 'en cache must be versioned');
  assert.strictEqual(cacheKey('ja', 'a'), sha('ja\na'), 'ja cache unchanged');
  const src = ['Choose 知育玩具 (educational toys) for age 3', 'Plain 玩具'];
  const calls = [];
  const client = { messages: { create: async req => {
    calls.push(req.system);
    const input = JSON.parse(req.messages[0].content);
    const strict = /remove every one of them/.test(req.system);
    const text = JSON.stringify(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, strict ? 'Choose educational toys for age 3' : (v.includes('Choose') ? 'Choose 知育玩具 (educational toys) for age 3' : 'Plain toy')])));
    return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
  } } };
  const map = await T.translateStrings(src, 'en', { client, cacheFile: path.join(tmpDir(), 'c.json'), log: () => {} });
  assert.strictEqual(map.get(src[0]), 'Choose educational toys for age 3');
  assert.strictEqual(map.get(src[1]), 'Plain toy');
  assert.strictEqual(calls.length, 2, 'one batch call plus one strict retry for the single offender');
});

test('a translations.json built under older English rules is not reused; the same version is', async () => {
  const dataDir = tmpDir();
  const dir = path.join(dataDir, 'brands', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'personas.json'), JSON.stringify({ lifestyle: 'Choose 知育玩具 (educational toys) for age 3' }));
  const quiet = () => {};
  const mk = () => { const calls = []; return { calls, messages: { create: async req => { calls.push(1); const input = JSON.parse(req.messages[0].content); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(Object.fromEntries(Object.entries(input).map(([k]) => [k, /into English/.test(req.system) ? 'Choose educational toys for age 3' : 'x']))) }] }; } } }; };
  // an old-format file (no translatorVersion) holding the bad entry
  fs.writeFileSync(path.join(dir, 'translations.json'), JSON.stringify({ generatedAt: 'x', en: { 'Choose 知育玩具 (educational toys) for age 3': 'Choose 知育玩具 (educational toys) for age 3' }, ja: {} }));
  const c1 = mk();
  await outputs.run({ slug: 'demo', dataDir, client: c1, log: quiet, cacheFile: path.join(dataDir, 'cache.json') });
  const out1 = JSON.parse(fs.readFileSync(path.join(dir, 'translations.json'), 'utf8'));
  assert.strictEqual(out1.en['Choose 知育玩具 (educational toys) for age 3'], 'Choose educational toys for age 3');
  assert.strictEqual(out1.translatorVersion, outputs.TRANSLATOR_VERSION);
  assert.ok(c1.calls.length >= 1, 'the old entry was redone');
  const c2 = mk();
  await outputs.run({ slug: 'demo', dataDir, client: c2, log: quiet, cacheFile: path.join(dataDir, 'cache.json') });
  assert.strictEqual(c2.calls.length, 0, 'same version: nothing is re-sent');
});

test('buildPrompt: opts.context adds one guidance line; without it the prompt is unchanged', () => {
  const { buildPrompt } = T;
  const plain = buildPrompt(['x'], 'ja').system;
  assert.equal(buildPrompt(['x'], 'ja', { context: '' }).system, plain);
  assert.equal(buildPrompt(['x'], 'ja', { context: '   ' }).system, plain);
  const withCtx = buildPrompt(['x'], 'ja', { context: 'These are dashboard button and menu labels.' }).system;
  assert.equal(withCtx, plain.replace('\nInput is a JSON object', '\nContext: These are dashboard button and menu labels.\nInput is a JSON object'));
});
