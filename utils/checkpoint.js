/**
 * Checkpoints: progress that survives a crash, so a failed run resumes instead of restarting.
 *
 * A step that works through many units (brands, sources) saves each unit's result the moment it
 * finishes, under data/brands/<slug>/_checkpoints/<step>.json:
 *   { step, updatedAt, items: { "<key>": { savedAt, value } } }
 * On the next start the step reads those back and only does the units that are missing or stale.
 * When the step finishes and writes its real output, it clears its checkpoint, so the following
 * run starts fresh and gets fresh data. A crash leaves the checkpoint in place.
 *
 * Controls (environment):
 *   BI_FORCE=1              ignore every checkpoint (start from zero)
 *   BI_RESUME_TTL_HOURS=N   a checkpoint older than N hours is ignored (default 24)
 *
 * Writes are atomic (temp file then rename) so a kill mid-write cannot corrupt the file.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_TTL_HOURS = 24;

function dirFor(slug, dataDir) {
  return path.join(dataDir || path.join(__dirname, '../data'), 'brands', slug, '_checkpoints');
}
function fileFor(slug, step, dataDir) {
  return path.join(dirFor(slug, dataDir), `${String(step).replace(/[^a-z0-9_.-]/gi, '_')}.json`);
}
function ttlHours() {
  const n = Number(process.env.BI_RESUME_TTL_HOURS);
  return n > 0 ? n : DEFAULT_TTL_HOURS;
}
function forced() { return process.env.BI_FORCE === '1'; }

// Keys are stored with a prefix so an id such as "__proto__" or "constructor" is an ordinary
// entry and cannot hit Object.prototype.
const K = 'k:';
const enc = key => K + String(key);

// A tiny cross-process lock around the read-modify-write in put(). Without it, two processes
// saving units for one slug at the same moment lose each other's entries.
//   - mkdir is atomic, so exactly one process holds the lock.
//   - The holder writes its pid inside the lock. A lock is stale when that pid is no longer
//     running, or when it is older than LOCK_STALE_MS (a hung or killed holder).
//   - A stale lock is broken by renaming it to a unique name, which only one contender can win,
//     so two contenders can never delete each other's live lock.
//   - If the lock cannot be obtained within the deadline, the save is SKIPPED (put returns
//     false). Writing without the lock would silently reintroduce the lost update.
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
function withLock(slug, step, dataDir, fn) {
  const lock = fileFor(slug, step, dataDir) + '.lock';
  const deadline = Date.now() + LOCK_WAIT_MS;
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

function readFile(slug, step, dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(fileFor(slug, step, dataDir), 'utf8'));
    return j && typeof j === 'object' && j.items && typeof j.items === 'object' ? j : null;
  } catch { return null; }
}

/** Saved value for a unit, or undefined if absent, stale or forced off. */
function get(slug, step, key, { dataDir, maxAgeHours } = {}) {
  if (forced()) return undefined;
  const entry = (readFile(slug, step, dataDir) || { items: {} }).items[enc(key)];
  if (!entry) return undefined;
  const ageH = (Date.now() - new Date(entry.savedAt).getTime()) / 3600000;
  if (!(ageH >= 0) || ageH > (maxAgeHours || ttlHours())) return undefined;
  return entry.value;
}

/** Save one unit's result immediately. Never throws: a failed save must not fail the step. */
function put(slug, step, key, value, { dataDir } = {}) {
  try {
    const file = fileFor(slug, step, dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return withLock(slug, step, dataDir, () => {
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        const cur = readFile(slug, step, dataDir) || { step, items: {} };
        cur.items[enc(key)] = { savedAt: new Date().toISOString(), value };
        cur.updatedAt = new Date().toISOString();
        fs.writeFileSync(tmp, JSON.stringify(cur));
        fs.renameSync(tmp, file);
        return true;
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch (_) {} // do not leave a stray temp file behind
        return false;
      }
    });
  } catch { return false; }
}

/** Keys currently saved (and fresh) for a step. */
function keys(slug, step, { dataDir } = {}) {
  if (forced()) return [];
  const cur = readFile(slug, step, dataDir);
  if (!cur) return [];
  return Object.keys(cur.items).filter(k => k.startsWith(K)).map(k => k.slice(K.length))
    .filter(k => get(slug, step, k, { dataDir }) !== undefined);
}

/** Call after the step has written its real output. */
function clear(slug, step, { dataDir } = {}) {
  try { fs.rmSync(fileFor(slug, step, dataDir), { force: true }); } catch { /* nothing to clear */ }
}

module.exports = { get, put, keys, clear, fileFor, DEFAULT_TTL_HOURS };
