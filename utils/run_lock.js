/**
 * One phased run per brand at a time.
 *
 * A Japan refresh-all now stays alive for the whole run (possibly an hour), so a second click, or
 * a module refresh fired mid-run, would put two orchestrators on one slug: output files become
 * last-writer-wins and the first to finish clears the checkpoint the other still uses.
 * The orchestrator takes this lock (mkdir is atomic); the server's refresh routes check it and
 * answer 409. A lock is stale, and is taken over, when its owner pid is gone or it is older
 * than MAX_AGE_MS (a hung or killed run).
 */
const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 3 * 60 * 60 * 1000;

function lockDir(slug, dataDir) {
  return path.join(dataDir || path.join(__dirname, '../data'), 'brands', slug, '_run.lock');
}
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

/** @returns {{held:boolean, pid?:number, startedAt?:string, kind?:string}} */
function status(slug, { dataDir } = {}) {
  const dir = lockDir(slug, dataDir);
  let info;
  try { info = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')); }
  catch { return fs.existsSync(dir) ? { held: !isStale(dir, null), kind: 'unknown' } : { held: false }; }
  if (isStale(dir, info)) return { held: false };
  return { held: true, ...info };
}
function isStale(dir, info) {
  try {
    if (Date.now() - fs.statSync(dir).mtimeMs > MAX_AGE_MS) return true;
    if (info && Number.isInteger(info.pid) && !pidAlive(info.pid)) return true;
    return false;
  } catch { return true; }
}

/** @returns {boolean} true if this process now holds the lock */
function acquire(slug, kind = 'phased', { dataDir } = {}) {
  const dir = lockDir(slug, dataDir);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), kind }));
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') return false;
      if (status(slug, { dataDir }).held) return false;
      // stale: break it by renaming (only one contender wins), then retry the mkdir
      try { const grave = `${dir}.stale.${process.pid}.${Date.now()}`; fs.renameSync(dir, grave); fs.rmSync(grave, { recursive: true, force: true }); } catch (_) {}
    }
  }
  return false;
}

function release(slug, { dataDir } = {}) {
  try {
    const dir = lockDir(slug, dataDir);
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8'));
    if (info.pid === process.pid) fs.rmSync(dir, { recursive: true, force: true }); // never release someone else's lock
  } catch { /* nothing to release */ }
}

module.exports = { acquire, release, status, MAX_AGE_MS };
