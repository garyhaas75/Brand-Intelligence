/**
 * Japan demand signals: real search interest and population baselines for a brand's category,
 * so persona work rests on data instead of homepage inference.
 *
 * Writes data/brands/<slug>/jp_demand.json:
 *   { generatedAt, market, trends: [{ term, termEn, interestOverTime, topRelated }],
 *     demographics: { source, ... }, notes: [...] }
 *
 * Sources, all optional. Each one degrades to an explanatory note when its key is missing:
 *   (a) Google Trends, geo=JP, via the Apify Google Trends actor. Needs APIFY_API_TOKEN.
 *   (b) e-Stat (Statistics Bureau of Japan) baseline demographics. Needs ESTAT_APP_ID.
 *
 * Usage: node analysis/jp_demand.js --slug=<brand-slug> [--dry-run]
 *   --dry-run prints every outbound call it would make and makes none. Nothing is written.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const checkpoint = require('../utils/checkpoint');

const DATA_DIR = path.join(__dirname, '../data');
const MAX_TERMS = 5; // Google Trends compares at most 5 terms per request
const TRENDS_ACTOR = 'apify/google-trends-scraper';
const CHECKPOINT_STEP = 'demand';

// e-Stat API v3 (JSON). Docs: https://www.e-stat.go.jp/api/api-info/e-stat-manual3-0
//   Table search: GET https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList?appId=..&searchWord=..&limit=..
//   Table data:   GET https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData?appId=..&statsDataId=..&limit=..
// Table ids change between survey years, so by default the table is found by search word.
// Pin a specific table with the env var named in envId once someone has confirmed the right one.
const ESTAT_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';
const ESTAT_DATASETS = [
  { key: 'births', label: 'Live births (Vital Statistics)', searchWord: '人口動態調査 出生数 年次', envId: 'ESTAT_BIRTHS_STATS_ID' },
  { key: 'householdsWithChildren', label: 'Households with children by age of youngest child (Census)', searchWord: '国勢調査 最年少の子供の年齢 世帯', envId: 'ESTAT_HOUSEHOLDS_STATS_ID' },
];
const ESTAT_MAX_ROWS = 60;

// Generic English category word to Japanese search vocabulary. Keyed by category concept, not
// by retailer or product, so any brand whose industry mentions the concept gets the same seeds.
const CATEGORY_VOCAB = [
  { match: /toy|play|game/i, terms: [['おもちゃ', 'toys'], ['知育玩具', 'educational toys'], ['プレゼント 子供', 'gifts for kids'], ['ボードゲーム', 'board games']] },
  { match: /baby|infant|maternity|nursery/i, terms: [['ベビー用品', 'baby goods'], ['出産祝い', 'baby shower gifts']] },
  { match: /child|kid/i, terms: [['子供 誕生日プレゼント', 'kids birthday gifts'], ['子供服', 'kids clothing']] },
  { match: /fashion|apparel|cloth/i, terms: [['レディース 服', "women's clothing"], ['メンズ 服', "men's clothing"]] },
  { match: /shoe|footwear/i, terms: [['スニーカー', 'sneakers'], ['靴', 'shoes']] },
  { match: /jewel|watch/i, terms: [['腕時計', 'watches'], ['アクセサリー', 'accessories']] },
  { match: /beauty|cosmetic/i, terms: [['化粧品', 'cosmetics'], ['スキンケア', 'skincare']] },
  { match: /sport/i, terms: [['スポーツ用品', 'sporting goods']] },
];

function defaultLog(msg) { console.log(`[jp_demand] [${new Date().toISOString()}] ${msg}`); }

function readJson(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

const hasJapanese = (s) => /[぀-ヿ㐀-鿿]/.test(String(s || ''));

// Marketplace category labels arrive as breadcrumbs or ranking-page titles. Keep the most
// specific segment and drop ranking boilerplate so the label reads as a search term.
function normalizeCategoryLabel(label) {
  let s = String(label || '').trim();
  if (!s) return '';
  const parts = s.split(/\s*(?:>|›|»|\/|｜|\|)\s*/).filter(Boolean);
  s = parts.length ? parts[parts.length - 1] : s;
  s = s.replace(/(の)?(売れ筋|人気)?ランキング.*$/, '')
    .replace(/^(Amazon|楽天市場?)\s*[:：]?\s*/i, '')
    .replace(/\s*-\s*(Amazon|楽天).*$/i, '')
    .trim();
  return s.length > 30 ? '' : s;
}

/**
 * Japanese search terms for this brand's category. Marketplace categories come first because
 * they are what Japanese shoppers actually browse; the industry vocabulary fills the rest.
 * Returns [{ term, termEn, origin }], deduped, at most `max`.
 */
function deriveTerms(profile, marketplace, max = MAX_TERMS) {
  const out = [];
  const seen = new Set();
  const add = (term, termEn, origin) => {
    const t = String(term || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push({ term: t, termEn: termEn || null, origin });
  };

  const cats = Array.isArray(marketplace?.categories) ? marketplace.categories : [];
  for (const c of cats) {
    const label = normalizeCategoryLabel(c?.category);
    if (label && hasJapanese(label)) add(label, null, 'marketplace');
    if (out.length >= Math.ceil(max / 2)) break;
  }

  // The marketplace writes English category labels, so the Japanese vocabulary it holds is in
  // brandMix (toy brands and IPs counted from Japanese product titles). Use the top ones.
  const mix = Array.isArray(marketplace?.brandMix) ? marketplace.brandMix : [];
  let fromMix = 0;
  for (const m of mix) {
    const b = String(m?.brand || '').trim();
    if (b && hasJapanese(b) && b.length >= 2 && fromMix < 2) { add(b, null, 'marketplace-brandmix'); fromMix++; }
  }

  const industry = `${profile?.industry || ''} ${profile?.positioning || ''}`;
  for (const v of CATEGORY_VOCAB) {
    if (!v.match.test(industry)) continue;
    for (const [ja, en] of v.terms) add(ja, en, 'industry');
  }
  return out.slice(0, max);
}

// ─── Google Trends via Apify ────────────────────────────────────────────────

// Allowed timeRange values, copied from the actor's own input schema (enum of the timeRange
// property, build 0.0.149, read 2026-11-17 from GET https://api.apify.com/v2/actor-builds/<id>).
// The actor rejects anything else ("Field input.timeRange must be equal to one of the allowed
// values"), so the value is checked here first and a bad one is a local error, not a paid run.
// '' is the actor's "Past 12 months (output frequency: 7 days)", which is what we want.
// 'today 12-m' is NOT accepted by the actor even though Google Trends itself uses it.
const TRENDS_TIME_RANGES = Object.freeze(['', 'now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 5-y', 'all']);
const TRENDS_TIME_RANGE_12M = '';

function validateTimeRange(value) {
  if (!TRENDS_TIME_RANGES.includes(value)) {
    throw new Error(`Google Trends timeRange ${JSON.stringify(value)} is not one the actor accepts. Allowed: ${TRENDS_TIME_RANGES.map(v => JSON.stringify(v)).join(', ')} ('' means past 12 months).`);
  }
  return value;
}

function buildTrendsInput(terms, { timeRange = TRENDS_TIME_RANGE_12M } = {}) {
  return {
    searchTerms: terms.map(t => t.term),
    geo: 'JP',
    timeRange: validateTimeRange(timeRange),
    isMultiple: false,
    maxItems: terms.length,
  };
}

// Actor output field names follow the apify/google-trends-scraper README
// (interestOverTime_timelineData, relatedQueries_top). Not yet verified against a live run,
// so the parser accepts a couple of shapes and never throws.
function summarizeTimeline(timeline) {
  const pts = (Array.isArray(timeline) ? timeline : [])
    .map(p => ({ t: p.formattedTime || p.time || p.date || null, v: Number(Array.isArray(p.value) ? p.value[0] : p.value) }))
    .filter(p => Number.isFinite(p.v));
  if (!pts.length) return null;
  const vals = pts.map(p => p.v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const peak = pts.reduce((a, b) => (b.v > a.v ? b : a));
  const tail = vals.slice(-12);
  const head = vals.slice(-24, -12);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const recent = avg(tail);
  const prior = avg(head);
  const direction = prior == null || prior === 0 ? 'unknown'
    : recent > prior * 1.1 ? 'rising' : recent < prior * 0.9 ? 'falling' : 'flat';
  return { points: pts.length, mean: Math.round(mean), latest: pts[pts.length - 1].v, peak: { value: peak.v, at: peak.t }, direction };
}

function parseTrendsItems(items, terms) {
  const byTerm = new Map((Array.isArray(items) ? items : []).map(it => [it.searchTerm || it.inputUrlOrTerm || it.term, it]));
  return terms.map(t => {
    const it = byTerm.get(t.term) || {};
    const timeline = it.interestOverTime_timelineData || it.interestOverTime?.timelineData || it.interestOverTime || [];
    const related = it.relatedQueries_top || it.relatedQueries?.top || [];
    return {
      term: t.term,
      termEn: t.termEn,
      interestOverTime: summarizeTimeline(timeline),
      topRelated: (Array.isArray(related) ? related : []).slice(0, 10).map(r => ({ query: r.query || r.title || String(r), value: r.value ?? null })),
    };
  });
}

// Every return carries ok (at least one term has a real timeline) and, when not ok, error.
// apify/google-trends-scraper: priced per result, one result per search term. Estimate per term
// plus a small start fee, reserved generously; maxItems = terms.length keeps the result count bounded.
const TRENDS_USD_PER_TERM = 0.02;
const TRENDS_BASE_USD = 0.05;
function trendsEstimateUsd(n) { return Number((TRENDS_BASE_USD + TRENDS_USD_PER_TERM * Math.max(0, n)).toFixed(2)); }

async function fetchTrends(terms, { log, dryRun, deps, timeRange, slug = null, dataDir }) {
  const notes = [];
  const blank = () => terms.map(t => ({ term: t.term, termEn: t.termEn, interestOverTime: null, topRelated: [] }));
  if (!terms.length) return { trends: [], ok: false, error: 'no terms', notes: ['No Japanese terms could be derived, so Google Trends was skipped.'] };
  let input;
  try {
    input = buildTrendsInput(terms, timeRange === undefined ? {} : { timeRange });
  } catch (err) {
    log(`Google Trends input invalid: ${err.message}`);
    return { trends: blank(), ok: false, error: err.message, notes: [`Google Trends not called, input invalid: ${err.message}`] };
  }
  if (dryRun) {
    log(`DRY RUN: would call Apify actor ${TRENDS_ACTOR} with ${JSON.stringify(input)}`);
    return { trends: blank(), ok: false, error: 'dry run', notes: ['Dry run: Google Trends not called.'] };
  }
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return { trends: blank(), ok: false, error: 'APIFY_API_TOKEN is not set', notes: ['APIFY_API_TOKEN is not set, so Google Trends (geo=JP) was skipped. Terms are listed without interest data.'] };
  }
  // Per-run Apify spend cap (utils/apify_budget.js).
  const budget = deps.budget || require('../utils/apify_budget');
  const budgetOpts = dataDir ? { dataDir } : {};
  let grant = null;
  if (slug) {
    grant = budget.reserve(slug, trendsEstimateUsd(terms.length), `google trends JP (${terms.length} terms)`, budgetOpts);
    if (!grant.ok) {
      log(`Google Trends skipped: ${grant.reason}`);
      return { trends: blank(), ok: false, error: grant.reason, budgetSkipped: true, budgetReason: grant.reason, notes: [`Google Trends not called: ${grant.reason}`] };
    }
  }
  let run = null;
  try {
    const client = deps.apifyClientFactory(token);
    log(`Calling ${TRENDS_ACTOR} for ${input.searchTerms.join(', ')}`);
    try {
      run = await client.actor(TRENDS_ACTOR).call(input, budget.callOptions(grant, { timeout: 300 }));
    } finally {
      if (grant) { try { budget.record(slug, grant, run, budgetOpts); } catch (e) { log(`Apify spend not recorded: ${e.message}`); } }
    }
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const trends = parseTrendsItems(items, terms);
    const empty = trends.filter(t => !t.interestOverTime).length;
    if (empty) notes.push(`${empty} of ${trends.length} terms came back without an interest timeline.`);
    const ok = empty < trends.length;
    return { trends, notes, ok, error: ok ? null : 'no term came back with an interest timeline' };
  } catch (err) {
    log(`Google Trends error: ${err.message}`);
    return { trends: blank(), ok: false, error: err.message, notes: [`Google Trends call failed: ${err.message}`] };
  }
}

// ─── e-Stat baseline demographics ───────────────────────────────────────────

function estatUrl(op, params) {
  const qs = new URLSearchParams(params).toString();
  return `${ESTAT_BASE}/${op}?${qs}`;
}

const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const textOf = (x) => (x && typeof x === 'object' ? x.$ ?? '' : x ?? '');

function pickTable(listJson) {
  const tables = asArray(listJson?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF);
  const t = tables[0];
  if (!t) return null;
  return { id: t['@id'], title: textOf(t.TITLE), statistics: textOf(t.STATISTICS_NAME), surveyDate: t.SURVEY_DATE ?? null };
}

// Flatten a getStatsData response into rows of human labels, capped.
function compactStatsData(dataJson, maxRows = ESTAT_MAX_ROWS) {
  const sd = dataJson?.GET_STATS_DATA?.STATISTICAL_DATA;
  if (!sd) return null;
  const labels = {};
  for (const obj of asArray(sd.CLASS_INF?.CLASS_OBJ)) {
    const m = {};
    for (const c of asArray(obj.CLASS)) m[c['@code']] = c['@name'];
    labels[obj['@id']] = { name: obj['@name'], codes: m };
  }
  const rows = asArray(sd.DATA_INF?.VALUE).slice(0, maxRows).map(v => {
    const row = { value: v.$, unit: v['@unit'] || null };
    for (const [k, code] of Object.entries(v)) {
      if (!k.startsWith('@') || k === '@unit') continue;
      const dim = k.slice(1);
      row[labels[dim]?.name || dim] = labels[dim]?.codes?.[code] ?? code;
    }
    return row;
  });
  return { totalRows: Number(sd.RESULT_INF?.TOTAL_NUMBER) || rows.length, rows };
}

function httpGetJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'brand-intelligence/1.0' } }, (res) => {
      if (res.statusCode >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchDemographics({ log, dryRun, deps }) {
  const appId = process.env.ESTAT_APP_ID;
  const notes = [];
  if (!appId && !dryRun) {
    return { demographics: { source: null, omitted: true, reason: 'ESTAT_APP_ID is not set, so e-Stat baseline demographics were omitted.' }, notes: ['ESTAT_APP_ID is not set, so e-Stat baseline demographics were omitted.'], ok: false, error: 'ESTAT_APP_ID is not set' };
  }
  const out = { source: 'e-Stat (Statistics Bureau of Japan), api.e-stat.go.jp v3', datasets: {} };
  for (const ds of ESTAT_DATASETS) {
    const pinned = process.env[ds.envId];
    const redact = (u) => u.replace(/appId=[^&]*/, 'appId=<ESTAT_APP_ID>');
    if (dryRun) {
      const u = pinned
        ? estatUrl('getStatsData', { appId: appId || '', statsDataId: pinned, limit: ESTAT_MAX_ROWS })
        : estatUrl('getStatsList', { appId: appId || '', searchWord: ds.searchWord, limit: 5 });
      log(`DRY RUN: would GET ${redact(u)}`);
      continue;
    }
    try {
      let table = pinned ? { id: pinned, title: null } : null;
      if (!table) {
        table = pickTable(await deps.httpGetJson(estatUrl('getStatsList', { appId, searchWord: ds.searchWord, limit: 5 })));
        if (!table) { notes.push(`e-Stat: no table found for "${ds.searchWord}" (${ds.key}).`); continue; }
        notes.push(`e-Stat ${ds.key}: table chosen by search, "${table.title}" (${table.id}). Confirm it and pin with ${ds.envId}.`);
      }
      const data = compactStatsData(await deps.httpGetJson(estatUrl('getStatsData', { appId, statsDataId: table.id, limit: ESTAT_MAX_ROWS })));
      if (!data) { notes.push(`e-Stat ${ds.key}: table ${table.id} returned no statistical data.`); continue; }
      out.datasets[ds.key] = { label: ds.label, table, ...data };
    } catch (err) {
      log(`e-Stat ${ds.key} error: ${err.message}`);
      notes.push(`e-Stat ${ds.key} failed: ${err.message}`);
    }
  }
  if (dryRun) notes.push('Dry run: e-Stat not called.');
  const ok = !dryRun && Object.keys(out.datasets).length > 0;
  return { demographics: out, notes, ok, error: ok ? null : (dryRun ? 'dry run' : (notes.join(' ') || 'no e-Stat dataset returned')) };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

const defaultDeps = {
  apifyClientFactory: (token) => { const { ApifyClient } = require('apify-client'); return new ApifyClient({ token }); },
  httpGetJson,
};

const hasGoodTrends = (j) => Array.isArray(j?.trends) && j.trends.some(t => t && t.interestOverTime);
// Which search terms a jp_demand.json's trends belong to. Files written before termKey existed
// fall back to the term list itself.
const trendsTermKey = (j) => (typeof j?.termKey === 'string' ? j.termKey : (Array.isArray(j?.trends) ? j.trends.map(t => t && t.term).join('|') : null));

/** Write JSON via temp file then rename. On any failure the temp file is removed and the error rethrown. */
function writeJsonAtomic(fp, data) {
  const tmp = `${fp}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, fp);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* nothing left to remove */ }
    throw err;
  }
}

const hasGoodDemographics = (j) => !!(j?.demographics?.datasets && Object.keys(j.demographics.datasets).length);

async function collectDemand({ slug, profile, log = defaultLog, dryRun = false, dataDir = DATA_DIR, deps = {}, timeRange } = {}) {
  if (!slug) throw new Error('collectDemand: slug is required');
  const d = { ...defaultDeps, ...deps };
  const brandDir = path.join(dataDir, 'brands', slug);
  const prof = profile || readJson(path.join(brandDir, 'profile.json')) || {};
  const marketplace = readJson(path.join(brandDir, 'marketplace.json'));

  const terms = deriveTerms(prof, marketplace);
  log(`Derived ${terms.length} Japanese terms: ${terms.map(t => t.term).join(', ') || 'none'}`);
  const notes = [];
  if (!marketplace) notes.push('marketplace.json not found, so terms come from the profile industry only.');

  // Checkpoint units (step 'demand'): 'trends' and 'estat'. A fresh saved unit is reused, so a
  // crash after the paid Trends call does not pay for it again. Dry runs never read or save.
  const termKey = terms.map(t => t.term).join('|');
  const cpOpts = { dataDir };
  const resumed = (key, check) => {
    if (dryRun) return null;
    const v = checkpoint.get(slug, CHECKPOINT_STEP, key, cpOpts);
    if (!v || !check(v)) return null;
    log(`${key}: resumed from checkpoint`);
    return v;
  };

  let tr = resumed('trends', v => v.termKey === termKey && Array.isArray(v.trends));
  if (tr) tr = { ...tr, notes: [...(tr.notes || []), 'Google Trends resumed from checkpoint.'] };
  else {
    tr = await fetchTrends(terms, { log, dryRun, deps: d, timeRange, slug, dataDir });
    if (tr.ok && !dryRun) checkpoint.put(slug, CHECKPOINT_STEP, 'trends', { termKey, trends: tr.trends, notes: tr.notes, ok: true }, cpOpts);
  }
  let dm = resumed('estat', v => v.demographics && typeof v.demographics === 'object');
  if (dm) dm = { ...dm, notes: [...(dm.notes || []), 'e-Stat resumed from checkpoint.'] };
  else {
    dm = await fetchDemographics({ log, dryRun, deps: d });
    if (dm.ok && !dryRun) checkpoint.put(slug, CHECKPOINT_STEP, 'estat', { demographics: dm.demographics, notes: dm.notes, ok: true }, cpOpts);
  }

  // Never replace good prior data with a failed attempt: carry the previous unit forward, stale.
  let trends = tr.trends;
  let demographics = dm.demographics;
  if (!dryRun) {
    const prev = readJson(path.join(brandDir, 'jp_demand.json'));
    const now = new Date().toISOString();
    if (!tr.ok && hasGoodTrends(prev) && trendsTermKey(prev) !== termKey) {
      // Old interest data for other terms would be mislabelled under this run: record the failure only.
      notes.push(`Google Trends failed this run (${tr.error || 'unknown'}); previous trends from ${prev.generatedAt || 'an earlier run'} were for different terms (${trendsTermKey(prev)}), so they were not carried forward.`);
      log('trends: failed, previous trends were for different terms, not carried forward');
    } else if (!tr.ok && hasGoodTrends(prev)) {
      trends = prev.trends.map(t => ({ ...t, stale: true, asOf: t.asOf || prev.generatedAt || null, lastAttempt: now, lastError: tr.error || 'unknown' }));
      notes.push(`Google Trends failed this run (${tr.error || 'unknown'}); previous trends from ${prev.generatedAt || 'an earlier run'} carried forward and marked stale.`);
      log('trends: failed, carried previous good data forward (stale)');
    }
    if (!dm.ok && hasGoodDemographics(prev)) {
      demographics = { ...prev.demographics, stale: true, asOf: prev.demographics.asOf || prev.generatedAt || null, lastAttempt: now, lastError: dm.error || 'unknown' };
      notes.push(`e-Stat failed this run (${dm.error || 'unknown'}); previous demographics carried forward and marked stale.`);
      log('estat: failed, carried previous good data forward (stale)');
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    market: 'JP',
    dryRun: dryRun || undefined,
    termKey,
    trends,
    demographics,
    notes: [...notes, ...tr.notes, ...dm.notes],
    // The per-run Apify cap refused the Trends call: reports say what was not covered.
    ...(tr.budgetSkipped ? { budgetSkipped: true, budgetReason: tr.budgetReason, budgetSkippedUnits: ['trends'] } : {}),
  };
  if (!dryRun) {
    fs.mkdirSync(brandDir, { recursive: true });
    // Atomic write (temp then rename): a kill mid-write cannot leave a truncated file. Every
    // failure before this point either is caught per source (carried forward stale) or rejects
    // without writing, so a crash never leaves a reduced jp_demand.json behind.
    const fp = path.join(brandDir, 'jp_demand.json');
    writeJsonAtomic(fp, output);
    log(`Wrote ${path.join(brandDir, 'jp_demand.json')}`);
    checkpoint.clear(slug, CHECKPOINT_STEP, cpOpts);
  } else {
    log('DRY RUN: nothing written.');
  }
  return output;
}

module.exports = {
  trendsEstimateUsd,
  collectDemand,
  deriveTerms,
  normalizeCategoryLabel,
  buildTrendsInput,
  validateTimeRange,
  writeJsonAtomic,
  fetchTrends,
  TRENDS_TIME_RANGES,
  TRENDS_TIME_RANGE_12M,
  CHECKPOINT_STEP,
  summarizeTimeline,
  parseTrendsItems,
  compactStatsData,
  pickTable,
  estatUrl,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  const dryRun = args.includes('--dry-run');
  if (!slug) { defaultLog('ERROR: --slug= required'); process.exit(1); }
  collectDemand({ slug, dryRun }).catch(err => { defaultLog(`FATAL: ${err.message}`); process.exit(1); });
}
