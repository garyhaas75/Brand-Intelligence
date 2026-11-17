/**
 * translateStrings: batch-translate strings with Claude, with a persistent cache so each
 * string is paid for once across every brand.
 *
 *   translateStrings(strings, direction, opts) -> Promise<Map<source, translation>>
 *
 * direction 'en' translates Japanese into English; 'ja' translates English into Japanese.
 * The returned Map holds every string that has a translation (cached or new). It also carries
 * a `stats` property: { requested, cached, sent, translated, failed, failedStrings, skipped,
 * calls, chars, noKey, dryRun, resumedBatches }.
 *
 * Options:
 *   log          function for progress lines (default no-op)
 *   dryRun       no network, no cache write; returns cached entries only
 *   cacheFile    default data/translations_cache.json
 *   maxStrings   cap on uncached strings sent this run (rest counted as skipped)
 *   maxChars     cap on total characters sent this run (rest counted as skipped)
 *   client       an Anthropic-compatible client ({ messages: { create } }); tests inject a stub
 *   batchSize    strings per call (default 40)
 *   batchChars   characters per call (default 6000)
 *   concurrency  parallel calls (default 3)
 *   checkpoint   optional { get(key), put(key, value) } so a crashed run resumes per batch
 *
 * Without ANTHROPIC_API_KEY (and no injected client) nothing is sent: the result is soft
 * (cached entries only, stats.noKey true). A failed batch is retried once, then its strings
 * are left untranslated and listed in stats.failedStrings. Cache failures never throw.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MODEL_FAST, MIN_TOKENS_JSON, EFFORT_LOW, extractText } = require('./models');

const DEFAULT_CACHE_FILE = path.join(__dirname, '../data/translations_cache.json');
const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_BATCH_CHARS = 4500; // keeps 4000 + chars * 3 under the 20000 token cap
const DEFAULT_CONCURRENCY = 3;

// The English direction changed its rules (no Japanese characters may remain, see buildPrompt), so its
// cache entries are versioned: results written under the old rules are not reused.
const CACHE_VERSION = { en: 'en.v2', ja: 'ja' };
function cacheKey(direction, s) {
  return crypto.createHash('sha1').update(`${CACHE_VERSION[direction] || direction}\n${s}`).digest('hex');
}

function readCache(cacheFile) {
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (j && typeof j === 'object' && j.entries && typeof j.entries === 'object') return j;
  } catch { /* missing or corrupt: start empty */ }
  return { version: 1, entries: {} };
}

// Cross-process lock around the cache read-modify-write, the same pattern as utils/checkpoint.js:
// mkdir is atomic; the holder writes its pid; a lock whose pid is gone or older than
// LOCK_STALE_MS is broken by renaming it to a unique name (only one contender wins). If the lock
// cannot be taken within LOCK_WAIT_MS the write is skipped, because writing without it would
// silently drop another run's entries.
const LOCK_STALE_MS = 10000;
const LOCK_WAIT_MS = 3000;
const sleepMs = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function lockIsStale(lock) {
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) return true;
    const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
    return Number.isInteger(pid) && pid > 0 && !pidAlive(pid);
  } catch { return false; }
}
/** Run fn under the lock. Returns fn's result, or false if the lock was not obtained. */
function withCacheLock(cacheFile, fn, waitMs = LOCK_WAIT_MS) {
  const lock = `${cacheFile}.lock`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      try { fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); } catch (_) {}
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') return false;
      if (lockIsStale(lock)) {
        const grave = `${lock}.stale.${process.pid}.${Date.now()}`;
        try { fs.renameSync(lock, grave); fs.rmSync(grave, { recursive: true, force: true }); } catch (_) { /* another contender broke it first */ }
        continue;
      }
      if (Date.now() > deadline) return false;
      sleepMs(25);
    }
  }
  try { return fn(); } finally { try { fs.rmSync(lock, { recursive: true, force: true }); } catch (_) {} }
}

/**
 * Merge new entries into the cache on disk: read, merge and write (temp then rename) under the
 * lock. Returns false when the write was skipped or failed. Never throws.
 */
function writeCache(cacheFile, newEntries, { lockWaitMs } = {}) {
  if (!newEntries || !Object.keys(newEntries).length) return true;
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    return withCacheLock(cacheFile, () => {
      const tmp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
      try {
        const cur = readCache(cacheFile); // re-read under the lock so a concurrent run's entries are kept
        Object.assign(cur.entries, newEntries);
        cur.updatedAt = new Date().toISOString();
        fs.writeFileSync(tmp, JSON.stringify(cur));
        fs.renameSync(tmp, cacheFile);
        return true;
      } catch {
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
        return false;
      }
    }, lockWaitMs);
  } catch {
    return false;
  }
}

/** Cached translation for one string, or undefined. */
function cachedLookup(cache, direction, s) {
  const e = cache.entries[cacheKey(direction, s)];
  return e && e.s === s && typeof e.t === 'string' && e.t.trim() ? e.t : undefined;
}

/** Split strings into batches by count and characters. A single oversized string gets its own batch. */
function makeBatches(strings, batchSize = DEFAULT_BATCH_SIZE, batchChars = DEFAULT_BATCH_CHARS) {
  const batches = [];
  let cur = [];
  let chars = 0;
  for (const s of strings) {
    if (cur.length && (cur.length >= batchSize || chars + s.length > batchChars)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += s.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

function buildPrompt(batch, direction, opts = {}) {
  const target = direction === 'en' ? 'English' : 'natural, native Japanese';
  const source = direction === 'en' ? 'Japanese (or mixed Japanese and English)' : 'English';
  const input = {};
  batch.forEach((s, i) => { input[String(i)] = s; });
  const system = [
    `You translate ${source} text from a retail competitive intelligence report into ${target}.`,
    'Rules:',
    '- Keep proper nouns, brand names, product names, store names and character names recognisable. For English output, write the established English name if one exists, otherwise romanise; do not invent names.',
    '- Keep numbers, prices, dates, percentages, punctuation, emoji, @handles and URLs exactly as they are.',
    ...(direction === 'en' ? [
      '- The English output must contain NO Japanese characters (no hiragana, katakana or kanji). This is the most important rule.',
      '- The input is often English that already quotes or glosses Japanese terms, for example "Choose 知育玩具 (educational toys)" or "searches \'3歳 知育玩具\'/educational toys for 3-year-olds". Keep the English meaning and drop the Japanese: "Choose educational toys", "searches \'educational toys for 3-year-olds\'". Do not repeat the same idea twice.',
      '- A quoted Japanese phrase becomes its English meaning in the same quotation marks. A Japanese brand, store or product name becomes its established English name, otherwise romaji. A Japanese hashtag becomes an English hashtag of its meaning, for example #おうち遊び becomes #at-home-play.',
    ] : [
      '- Keep hashtags exactly as they are.',
    ]),
    '- Keep list markers, line breaks and bullet structure.',
    '- Translate meaning faithfully. Do not summarise, add commentary, or omit content.',
    direction === 'en'
      ? '- Only if a string contains no Japanese characters at all, return it unchanged.'
      : '- If a string is already fully in the target language, return it unchanged.',
    ...(opts.strict ? ['- A previous answer still contained Japanese characters. Check every string again and remove every one of them.'] : []),
    'Input is a JSON object mapping index to source string.',
    'Reply with ONLY a JSON object mapping the same indexes to the translated strings, every index present, no other text.',
  ].join('\n');
  return { system, user: JSON.stringify(input) };
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  let start;
  let end;
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr; end = t.lastIndexOf(']');
  } else {
    start = firstObj; end = t.lastIndexOf('}');
  }
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

/**
 * Validate a model reply for a batch of n strings. Accepts an object keyed "0".."n-1" or an
 * array of length n. Returns an array of n non-empty strings, or throws with the reason.
 */
function validateReply(text, n) {
  const parsed = extractJson(text);
  if (parsed == null) throw new Error('reply is not valid JSON');
  let arr;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (typeof parsed === 'object') {
    const obj = parsed.translations && typeof parsed.translations === 'object' ? parsed.translations : parsed;
    arr = Array.isArray(obj) ? obj : Array.from({ length: n }, (_, i) => obj[String(i)]);
  } else {
    throw new Error('reply is not an object or array');
  }
  if (arr.length !== n) throw new Error(`reply has ${arr.length} items, expected ${n}`);
  arr.forEach((t, i) => {
    if (typeof t !== 'string' || !t.trim()) throw new Error(`item ${i} is missing or empty`);
  });
  return arr;
}

function maxTokensFor(batch) {
  const chars = batch.reduce((n, s) => n + s.length, 0);
  // Japanese output can use more tokens per character than the English source; leave room for
  // thinking too (see utils/models.js header).
  // Capped at 20000: the SDK refuses a non-streaming call whose max_tokens implies more than 10
  // minutes (about 21333 for this model class), and a real run hit that with 6000-char batches.
  return Math.min(20000, Math.max(MIN_TOKENS_JSON, 4000 + chars * 3));
}

async function callOnce(client, batch, direction, opts) {
  const { system, user } = buildPrompt(batch, direction, opts);
  const msg = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: maxTokensFor(batch),
    output_config: EFFORT_LOW,
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (msg && msg.stop_reason === 'max_tokens') throw new Error('reply hit max_tokens');
  return validateReply(extractText(msg), batch.length);
}

const HAS_JAPANESE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

async function callBatch(client, batch, direction, residualRetry = true) {
  const out = await callOnce(client, batch, direction, {});
  if (direction !== 'en' || !residualRetry) return out;
  // English output must have no Japanese left. Ask again, once, for just the offenders.
  const bad = out.map((t, i) => (HAS_JAPANESE.test(t) ? i : -1)).filter(i => i >= 0);
  if (!bad.length) return out;
  try {
    const retry = await callOnce(client, bad.map(i => batch[i]), direction, { strict: true });
    bad.forEach((i, k) => { if (!HAS_JAPANESE.test(retry[k]) || retry[k].length) out[i] = retry[k]; });
  } catch (_) { /* keep the first answer rather than fail the whole batch */ }
  return out;
}

function defaultClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function translateStrings(strings, direction, opts = {}) {
  if (direction !== 'en' && direction !== 'ja') throw new Error(`translateStrings: unknown direction "${direction}"`);
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const cacheFile = opts.cacheFile || DEFAULT_CACHE_FILE;
  const maxStrings = opts.maxStrings > 0 ? opts.maxStrings : Infinity;
  const maxChars = opts.maxChars > 0 ? opts.maxChars : Infinity;
  const cp = opts.checkpoint && typeof opts.checkpoint.get === 'function' ? opts.checkpoint : null;

  const unique = [...new Set((strings || []).filter(s => typeof s === 'string' && s.trim()))];
  const result = new Map();
  const stats = {
    requested: unique.length, cached: 0, sent: 0, translated: 0, failed: 0, failedStrings: [],
    skipped: 0, calls: 0, chars: 0, noKey: false, dryRun: !!opts.dryRun, resumedBatches: 0, cacheWriteOk: true,
  };
  result.stats = stats;

  const cache = readCache(cacheFile);
  const todo = [];
  for (const s of unique) {
    const hit = cachedLookup(cache, direction, s);
    if (hit !== undefined) { result.set(s, hit); stats.cached++; } else todo.push(s);
  }

  // Apply the per-run caps.
  const send = [];
  let chars = 0;
  for (const s of todo) {
    if (send.length >= maxStrings || chars + s.length > maxChars) { stats.skipped++; continue; }
    send.push(s);
    chars += s.length;
  }

  if (!send.length) return result;
  if (opts.dryRun) {
    stats.skipped += send.length;
    stats.chars = chars;
    log(`[translate] dry run (${direction}): ${send.length} strings, ${chars} chars would be sent`);
    return result;
  }
  const client = opts.client || defaultClient();
  if (!client) {
    stats.noKey = true;
    stats.skipped += send.length;
    log(`[translate] ANTHROPIC_API_KEY not set: ${send.length} ${direction} strings left untranslated`);
    return result;
  }

  const batches = makeBatches(send, opts.batchSize || DEFAULT_BATCH_SIZE, opts.batchChars || DEFAULT_BATCH_CHARS);
  const newEntries = {};
  const record = (batch, out) => {
    batch.forEach((s, i) => {
      result.set(s, out[i]);
      newEntries[cacheKey(direction, s)] = { s, t: out[i], d: direction, at: new Date().toISOString() };
    });
  };

  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const idx = next++;
      const batch = batches[idx];
      const cpKey = `${direction}:${idx}`;
      if (cp) {
        const saved = cp.get(cpKey);
        if (saved && Array.isArray(saved.strings) && Array.isArray(saved.out)
          && saved.strings.length === batch.length && saved.strings.every((s, i) => s === batch[i])
          && saved.out.length === batch.length && saved.out.every(t => typeof t === 'string' && t.trim())) {
          record(batch, saved.out);
          stats.translated += batch.length;
          stats.resumedBatches++;
          log(`[translate] ${direction} batch ${idx + 1}/${batches.length}: resumed from checkpoint`);
          continue;
        }
      }
      let out = null;
      let lastErr = null;
      for (let attempt = 1; attempt <= 2 && !out; attempt++) {
        stats.calls++;
        stats.sent += attempt === 1 ? batch.length : 0;
        stats.chars += batch.reduce((n, s) => n + s.length, 0);
        try {
          out = await callBatch(client, batch, direction, opts.residualRetry !== false);
        } catch (e) {
          lastErr = e;
          log(`[translate] ${direction} batch ${idx + 1}/${batches.length} attempt ${attempt} failed: ${e.message}`);
        }
      }
      if (out) {
        record(batch, out);
        stats.translated += batch.length;
        if (cp && typeof cp.put === 'function') {
          try { cp.put(cpKey, { strings: batch, out }); } catch (_) { /* a failed save must not fail the run */ }
        }
        log(`[translate] ${direction} batch ${idx + 1}/${batches.length}: ${batch.length} strings translated`);
      } else {
        stats.failed += batch.length;
        stats.failedStrings.push(...batch);
        log(`[translate] ${direction} batch ${idx + 1}/${batches.length}: left untranslated after retry (${lastErr && lastErr.message})`);
      }
    }
  }

  try {
    const n = Math.max(1, Math.min(opts.concurrency || DEFAULT_CONCURRENCY, batches.length));
    await Promise.all(Array.from({ length: n }, worker));
  } finally {
    // Persist whatever was paid for, even if something above threw.
    stats.cacheWriteOk = writeCache(cacheFile, newEntries);
    if (!stats.cacheWriteOk) log('[translate] warning: could not write translation cache');
  }
  return result;
}

module.exports = {
  maxTokensFor,
  DEFAULT_BATCH_CHARS,
  translateStrings,
  makeBatches,
  validateReply,
  buildPrompt,
  readCache,
  writeCache,
  cachedLookup,
  cacheKey,
  DEFAULT_CACHE_FILE,
};
