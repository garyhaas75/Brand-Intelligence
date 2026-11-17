/**
 * translate_outputs: build data/brands/<slug>/translations.json from a brand's module outputs.
 *
 *   node analysis/translate_outputs.js --slug=<slug> [--dry-run] [--max-strings=N] [--max-chars=N]
 *
 * Collects Japanese strings (to English, direction 'en') and English prose (to Japanese,
 * direction 'ja') from every module output that exists, translates only what is not already in
 * the shared cache or the previous translations.json, and writes
 *   { generatedAt, en, ja, stats: { enCount, jaCount, cached, translated, failed, costNote, ... } }
 * atomically, holding only entries for strings present in the current data (previous entries
 * for those strings are reused, never re-sent). A failed run leaves the previous file intact. Progress is checkpointed per batch (step 'translate') so a crash resumes
 * without paying again; the checkpoint is cleared after the output is written.
 *
 * Dry run: prints counts and characters, makes no call and writes nothing.
 */
const fs = require('fs');
const path = require('path');
const checkpoint = require('../utils/checkpoint');
const { collectStrings } = require('../modules/localize');
const { translateStrings, readCache, cachedLookup, DEFAULT_CACHE_FILE } = require('../utils/translate');
const { MODEL_FAST } = require('../utils/models');

const SOURCE_FILES = [
  'competitive_analysis.json', 'personas.json', 'social_intelligence.json', 'site_intelligence.json',
  'search_seo.json', 'action_plan.json', 'marketplace.json', 'jp_demand.json', 'site_blueprint.json', 'profile.json',
];
// Bump when the translation rules change so previously saved translations are not reused.
const TRANSLATOR_VERSION = 2;
const DEFAULT_MAX_STRINGS = 3000;
const DEFAULT_MAX_CHARS = 400000; // total source characters per direction
const CAPTIONS_PER_BRAND = 60;
const STEP = 'translate';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    throw e;
  }
}

/**
 * Copy of social_intelligence with post captions beyond the first `cap` per brand removed, so
 * huge caption sets do not dominate the bill. Returns { data, dropped }. Never mutates input.
 */
function capSocialCaptions(social, cap = CAPTIONS_PER_BRAND) {
  if (!social || typeof social !== 'object' || !Array.isArray(social.brands)) return { data: social, dropped: 0 };
  let dropped = 0;
  const brands = social.brands.map(brand => {
    let seen = 0;
    const walk = v => {
      if (Array.isArray(v)) return v.map(walk);
      if (!v || typeof v !== 'object') return v;
      const out = {};
      for (const k of Object.keys(v)) {
        if (k === 'caption' || (k === 'text' && Object.prototype.hasOwnProperty.call(v, 'likes'))) {
          if (typeof v[k] === 'string') {
            seen++;
            if (seen > cap) { dropped++; continue; }
          }
          out[k] = v[k];
        } else {
          out[k] = walk(v[k]);
        }
      }
      return out;
    };
    return walk(brand);
  });
  return { data: { ...social, brands }, dropped };
}

/** Load every module output for a slug. Missing or unreadable files are skipped. */
function loadSources(brandDir) {
  const sources = {};
  for (const f of SOURCE_FILES) {
    const j = readJson(path.join(brandDir, f));
    if (j != null) sources[f] = j;
  }
  return sources;
}

/** Unique strings per direction across all sources, with caption capping applied. */
function collectAll(sources, { captionsPerBrand = CAPTIONS_PER_BRAND } = {}) {
  let captionsDropped = 0;
  const en = new Set();
  const ja = new Set();
  for (const [file, data] of Object.entries(sources)) {
    let d = data;
    if (file === 'social_intelligence.json') {
      const capped = capSocialCaptions(data, captionsPerBrand);
      d = capped.data;
      captionsDropped += capped.dropped;
    }
    for (const s of collectStrings(d, 'en')) en.add(s);
    for (const s of collectStrings(d, 'ja')) ja.add(s);
  }
  return { en: [...en], ja: [...ja], captionsDropped };
}

const charCount = list => list.reduce((n, s) => n + s.length, 0);

async function run(opts = {}) {
  const slug = opts.slug;
  if (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) throw new Error('translate_outputs: a valid --slug is required');
  const log = typeof opts.log === 'function' ? opts.log : (...a) => console.log(...a);
  const dataDir = opts.dataDir || path.join(__dirname, '../data');
  const brandDir = path.join(dataDir, 'brands', slug);
  const cacheFile = opts.cacheFile || (opts.dataDir ? path.join(dataDir, 'translations_cache.json') : DEFAULT_CACHE_FILE);
  const maxStrings = opts.maxStrings > 0 ? opts.maxStrings : DEFAULT_MAX_STRINGS;
  const maxChars = opts.maxChars > 0 ? opts.maxChars : DEFAULT_MAX_CHARS;
  const outFile = path.join(brandDir, 'translations.json');

  if (!fs.existsSync(brandDir)) throw new Error(`translate_outputs: no data folder for ${slug}`);
  const sources = loadSources(brandDir);
  const collected = collectAll(sources, { captionsPerBrand: opts.captionsPerBrand || CAPTIONS_PER_BRAND });

  const prev = readJson(outFile) || {};
  // Entries are reused from the previous file only if it was built under the same translator rules.
  // The English rules changed (no Japanese may remain in English output), so a file written before
  // that carries entries that still contain Japanese and must be redone. The shared cache is
  // versioned the same way, so redoing them costs only the strings that really changed.
  const prevEnOk = prev.translatorVersion === TRANSLATOR_VERSION;
  const prevMap = {
    en: prevEnOk && prev.en && typeof prev.en === 'object' ? prev.en : {},
    ja: prev.ja && typeof prev.ja === 'object' ? prev.ja : {},
  };
  const cache = readCache(cacheFile);

  const plan = {};
  for (const dir of ['en', 'ja']) {
    const all = collected[dir];
    // Caps apply in collection order: stop at maxStrings strings or maxChars source characters.
    const list = [];
    let chars = 0;
    for (const s of all) {
      if (list.length >= maxStrings || chars + s.length > maxChars) break;
      list.push(s);
      chars += s.length;
    }
    const truncated = all.length - list.length;
    const known = list.filter(s => Object.prototype.hasOwnProperty.call(prevMap[dir], s) || cachedLookup(cache, dir, s) !== undefined);
    const knownSet = new Set(known);
    const need = list.filter(s => !knownSet.has(s));
    plan[dir] = { all, list, truncated, known: known.length, need };
  }

  const summary = {
    enCount: collected.en.length, jaCount: collected.ja.length,
    enChars: charCount(collected.en), jaChars: charCount(collected.ja),
    enToSend: plan.en.need.length, jaToSend: plan.ja.need.length,
    enCharsToSend: charCount(plan.en.need), jaCharsToSend: charCount(plan.ja.need),
    captionsDropped: collected.captionsDropped,
    files: Object.keys(sources),
  };

  if (opts.dryRun) {
    log(`[translate_outputs] dry run for ${slug}: files ${summary.files.join(', ') || '(none)'}`);
    log(`[translate_outputs] en (Japanese to English): ${summary.enCount} strings, ${summary.enChars} chars; ${summary.enToSend} not cached, ${summary.enCharsToSend} chars would be sent`);
    log(`[translate_outputs] ja (English to Japanese): ${summary.jaCount} strings, ${summary.jaChars} chars; ${summary.jaToSend} not cached, ${summary.jaCharsToSend} chars would be sent`);
    if (summary.captionsDropped) log(`[translate_outputs] ${summary.captionsDropped} social captions skipped (beyond the first ${CAPTIONS_PER_BRAND} per brand)`);
    if (plan.en.truncated || plan.ja.truncated) log(`[translate_outputs] ${capNote(maxStrings, maxChars, plan)}`);
    return { dryRun: true, summary };
  }

  const cpOpts = { dataDir };
  const cp = {
    get: key => checkpoint.get(slug, STEP, key, cpOpts),
    put: (key, value) => checkpoint.put(slug, STEP, key, value, cpOpts),
  };

  // translations.json holds only strings present in the current data, so it does not grow with
  // every content refresh. Dropped strings stay in the shared cache, so re-adding one is free.
  const merged = { en: {}, ja: {} };
  for (const dir of ['en', 'ja']) {
    for (const s of plan[dir].all) {
      if (Object.prototype.hasOwnProperty.call(prevMap[dir], s) && typeof prevMap[dir][s] === 'string') merged[dir][s] = prevMap[dir][s];
    }
  }
  const tally = { cached: 0, translated: 0, failed: 0, calls: 0, chars: 0, noKey: false, resumedBatches: 0 };
  const failedStrings = { en: [], ja: [] };
  for (const dir of ['en', 'ja']) {
    // Entries the previous file already had count as cached and are never re-sent.
    tally.cached += plan[dir].list.filter(s => Object.prototype.hasOwnProperty.call(prevMap[dir], s)).length;
    const toTranslate = plan[dir].list.filter(s => !Object.prototype.hasOwnProperty.call(prevMap[dir], s));
    const map = await translateStrings(toTranslate, dir, {
      log, cacheFile, client: opts.client, checkpoint: cp, concurrency: opts.concurrency,
      batchSize: opts.batchSize, batchChars: opts.batchChars, residualRetry: opts.residualRetry,
    });
    for (const [s, t] of map) merged[dir][s] = t;
    const st = map.stats;
    tally.cached += st.cached;
    tally.translated += st.translated;
    tally.failed += st.failed;
    tally.calls += st.calls;
    tally.chars += st.chars;
    tally.resumedBatches += st.resumedBatches;
    tally.noKey = tally.noKey || st.noKey;
    failedStrings[dir] = st.failedStrings;
    if (st.resumedBatches) log(`[translate_outputs] ${dir}: ${st.resumedBatches} batches resumed from checkpoint`);
  }

  const noteParts = [
    `${tally.calls} ${MODEL_FAST} calls, ${tally.chars} source characters sent`,
    `${tally.cached} strings reused from cache or the previous file`,
  ];
  if (collected.captionsDropped) noteParts.push(`${collected.captionsDropped} social captions skipped (only the first ${CAPTIONS_PER_BRAND} per brand are translated; they are long and low value)`);
  if (plan.en.truncated || plan.ja.truncated) noteParts.push(capNote(maxStrings, maxChars, plan));
  if (tally.noKey) noteParts.push('ANTHROPIC_API_KEY not set, new strings left untranslated');

  const output = {
    generatedAt: new Date().toISOString(),
    translatorVersion: TRANSLATOR_VERSION,
    en: merged.en,
    ja: merged.ja,
    stats: {
      enCount: collected.en.length,
      jaCount: collected.ja.length,
      cached: tally.cached,
      translated: tally.translated,
      failed: tally.failed,
      failedSample: { en: failedStrings.en.slice(0, 20), ja: failedStrings.ja.slice(0, 20) },
      captionsSkipped: collected.captionsDropped,
      truncated: { en: plan.en.truncated, ja: plan.ja.truncated, maxStrings, maxChars },
      resumedBatches: tally.resumedBatches,
      costNote: noteParts.join('; '),
    },
  };
  writeJsonAtomic(outFile, output);
  checkpoint.clear(slug, STEP, cpOpts);
  log(`[translate_outputs] wrote ${outFile}: en ${Object.keys(merged.en).length} entries, ja ${Object.keys(merged.ja).length} entries, translated ${tally.translated}, failed ${tally.failed}`);
  return { dryRun: false, summary, output };
}

function capNote(maxStrings, maxChars, plan) {
  return `over the per direction cap (${maxStrings} strings or ${maxChars} characters): en ${plan.en.truncated}, ja ${plan.ja.truncated} strings not translated`;
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--slug=')) args.slug = a.slice(7);
    else if (a.startsWith('--max-strings=')) args.maxStrings = Number(a.slice(14));
    else if (a.startsWith('--max-chars=')) args.maxChars = Number(a.slice(12));
  }
  return args;
}

module.exports = { TRANSLATOR_VERSION, run, parseArgs, collectAll, capSocialCaptions, loadSources, SOURCE_FILES, CAPTIONS_PER_BRAND, DEFAULT_MAX_STRINGS, DEFAULT_MAX_CHARS };

if (require.main === module) {
  try { require('dotenv').config(); } catch (_) {}
  // Without a key nothing can be translated. Exit non-zero so the phased run records the translate
  // phase as failed instead of reporting a finished phase that translated nothing.
  if (!process.env.ANTHROPIC_API_KEY && !process.argv.includes('--dry-run')) {
    console.error('[translate_outputs] ANTHROPIC_API_KEY is not set, nothing can be translated');
    process.exit(2);
  }
  run(parseArgs(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch(err => { console.error(`[translate_outputs] failed: ${err && err.stack || err}`); process.exit(1); });
}
