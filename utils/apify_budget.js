/**
 * Apify spend cap per run. Gary set it at about $15 per full run, on demand only (2026-11-18).
 *
 * Every module that starts an Apify actor asks first and records after:
 *
 *   const budget = require('../utils/apify_budget');
 *   const grant = budget.reserve(slug, 0.40, 'instagram @kiddyland_official');   // estimate in USD
 *   if (!grant.ok) { ...skip, record "budget cap reached" in the output... }
 *   const run = await client.actor(id).call(input, budget.callOptions(grant));    // hard ceiling for pay-per-event actors
 *   budget.record(slug, grant, run);                                              // actual cost from run.usageTotalUsd
 *
 * The ledger is data/brands/<slug>/_apify_spend.json, keyed by BI_RUN_ID (set by the phased run for
 * every module it spawns; a module run on its own gets a per-day id). Writes take a short file lock
 * because the analyse phase runs modules in parallel. A reservation counts against the cap until it
 * is recorded, so two parallel modules cannot both spend the last dollars.
 *
 * Cap: profile.scrape.apifyCapUsd, else BI_APIFY_CAP_USD, else 15.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CAP = 15;
const dataDirOf = (opts) => (opts && opts.dataDir) || path.join(__dirname, '../data');
const ledgerPath = (slug, opts) => path.join(dataDirOf(opts), 'brands', slug, '_apify_spend.json');

function runId() {
  return process.env.BI_RUN_ID || `adhoc-${new Date().toISOString().slice(0, 10)}`;
}

function capFor(slug, opts) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dataDirOf(opts), 'brands', slug, 'profile.json'), 'utf8'));
    const c = Number(p && p.scrape && p.scrape.apifyCapUsd);
    if (c > 0) return c;
  } catch (_) {}
  const env = Number(process.env.BI_APIFY_CAP_USD);
  return env > 0 ? env : DEFAULT_CAP;
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** Remove a lock older than 30s safely: rename it to a unique name first, so only one waiter steals it. */
function stealStaleLock(lock) {
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs <= 30000) return false;
    const grave = `${lock}.stale-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    fs.renameSync(lock, grave); // atomic: exactly one waiter wins, the others get ENOENT
    // Between our stat and rename another waiter may have stolen the old lock and taken a fresh one.
    // If what we moved is fresh, put it back (link never overwrites) and do not proceed.
    if (Date.now() - fs.statSync(grave).mtimeMs <= 30000) {
      try { fs.linkSync(grave, lock); } catch (_) {}
      try { fs.rmSync(grave, { force: true }); } catch (_) {}
      return false;
    }
    try { fs.rmSync(grave, { force: true }); } catch (_) {}
    return true;
  } catch (_) { return false; }
}

/** Run fn with an exclusive lock on the ledger; a lock older than 30s is treated as abandoned. */
function withLock(slug, opts, fn) {
  const file = ledgerPath(slug, opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  for (let i = 0; i < 200; i++) {
    let fd;
    try { fd = fs.openSync(lock, 'wx'); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (stealStaleLock(lock)) continue; // only the renamer retries at once
      sleepSync(25);
      continue;
    }
    fs.closeSync(fd);
    try { return fn(file); } finally { try { fs.rmSync(lock, { force: true }); } catch (_) {} }
  }
  throw new Error('Could not lock the Apify spend ledger');
}

/** Write the ledger atomically: a temp file in the same directory, then rename over the old one. */
function writeLedger(file, all) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, file);
}

const UNREADABLE = 'spend ledger unreadable';

function readLedger(file, slug, opts) {
  // A missing ledger starts empty. A ledger that exists but does not parse is NOT reset (that would
  // forget real spend): the caller refuses instead.
  let all = {};
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') return { unreadable: true }; }
  if (raw != null) {
    try { all = JSON.parse(raw); } catch (_) { return { unreadable: true }; }
    if (!all || typeof all !== 'object' || Array.isArray(all)) return { unreadable: true };
  }
  const id = runId();
  if (!all.runs) all.runs = {};
  if (!all.runs[id]) all.runs[id] = { capUsd: capFor(slug, opts), startedAt: new Date().toISOString(), entries: [] };
  // keep the ledger small: the last 10 runs
  const ids = Object.keys(all.runs);
  if (ids.length > 10) for (const old of ids.slice(0, ids.length - 10)) delete all.runs[old];
  return { all, run: all.runs[id] };
}

const committed = (run) => run.entries.reduce((s, e) => s + (e.actualUsd != null ? e.actualUsd : e.reservedUsd), 0);

/** Ask to spend about estimateUsd. Returns { ok, id, reservedUsd, remainingUsd, capUsd, reason? }. */
function reserve(slug, estimateUsd, label, opts = {}) {
  const est = Math.max(0, Number(estimateUsd) || 0);
  return withLock(slug, opts, (file) => {
    const led = readLedger(file, slug, opts);
    if (led.unreadable) return { ok: false, reservedUsd: 0, remainingUsd: 0, capUsd: capFor(slug, opts), reason: UNREADABLE };
    const { all, run } = led;
    const remaining = run.capUsd - committed(run);
    if (est > remaining) {
      run.entries.push({ label, reservedUsd: 0, actualUsd: 0, refused: true, at: new Date().toISOString() });
      writeLedger(file, all);
      return { ok: false, reservedUsd: 0, remainingUsd: Math.max(0, remaining), capUsd: run.capUsd, reason: `Apify budget cap reached ($${run.capUsd} per run, $${Math.max(0, remaining).toFixed(2)} left, needed about $${est.toFixed(2)})` };
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    run.entries.push({ id, label, reservedUsd: est, actualUsd: null, at: new Date().toISOString() });
    writeLedger(file, all);
    return { ok: true, id, reservedUsd: est, remainingUsd: remaining - est, capUsd: run.capUsd };
  });
}

/**
 * Options for client.actor(id).call(input, options): a hard ceiling so a pay-per-event actor stops at
 * the reservation (plus 50% headroom, never above what is left). Pay-per-result actors also need
 * maxItems, which the caller sets from its own item limit.
 */
function callOptions(grant, extra = {}) {
  if (!grant || !grant.ok) return { ...extra };
  const ceiling = Math.min(grant.reservedUsd * 1.5, grant.reservedUsd + Math.max(0, grant.remainingUsd));
  return { ...(ceiling > 0 ? { maxTotalChargeUsd: Number(ceiling.toFixed(2)) } : {}), ...extra };
}

/** Record the real cost of a finished (or failed) actor run. run may be null (call threw). */
function record(slug, grant, run, opts = {}) {
  if (!grant || !grant.ok) return;
  const actual = run && Number.isFinite(Number(run.usageTotalUsd)) ? Number(run.usageTotalUsd) : null;
  withLock(slug, opts, (file) => {
    const led = readLedger(file, slug, opts);
    if (led.unreadable) return; // leave the unreadable file for a human; never overwrite it
    const { all, run: r } = led;
    const e = r.entries.find(x => x.id === grant.id);
    // no usage figure (call threw before a run existed): keep the reservation as the cost, which over-counts rather than under-counts
    if (e) { e.actualUsd = actual != null ? actual : e.reservedUsd; e.actualKnown = actual != null; e.runId = run && run.id || null; }
    writeLedger(file, all);
  });
}

/** Summary for the dashboard and run summary: { runId, capUsd, spentUsd, refused, entries }. */
function summary(slug, opts = {}) {
  let all = {};
  try { all = JSON.parse(fs.readFileSync(ledgerPath(slug, opts), 'utf8')); } catch (_) {}
  const r = all.runs && all.runs[runId()];
  if (!r) return { runId: runId(), capUsd: capFor(slug, opts), spentUsd: 0, refused: 0, entries: [] };
  return { runId: runId(), capUsd: r.capUsd, spentUsd: Number(committed(r).toFixed(2)), refused: r.entries.filter(e => e.refused).length, entries: r.entries };
}

module.exports = { reserve, record, callOptions, summary, runId, capFor, DEFAULT_CAP, UNREADABLE, _withLock: withLock };
