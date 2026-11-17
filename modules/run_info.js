/**
 * What a phased run is doing right now, for the dashboard.
 *
 * The Japan refresh runs in phases (collect, analyse, personas, plan) and keeps a lock and a
 * _run_summary.json while it works. This turns those two files into one small object so the
 * brand list and brand card can say "running, analyse phase" instead of looking idle.
 */
const fs = require('fs');
const path = require('path');
const runLock = require('../utils/run_lock');

const PHASE_ORDER = ['collect', 'analyse', 'personas', 'blueprint', 'plan', 'translate'];

// Between the click and the orchestrator taking its lock there is a gap of a second or two (a new
// process has to start). The route drops a marker file then, so the brand reads as running from
// the first poll instead of flickering to complete and stopping the dashboard's polling.
const REQUEST_GRACE_MS = 45 * 1000;
const requestedFile = (slug, dataDir) => path.join(dataDir, 'brands', slug, '_run.requested');
function markRequested(slug, dataDir) {
  try { fs.mkdirSync(path.join(dataDir, 'brands', slug), { recursive: true }); fs.writeFileSync(requestedFile(slug, dataDir), new Date().toISOString()); } catch (_) {}
}
function clearRequested(slug, dataDir) { try { fs.rmSync(requestedFile(slug, dataDir), { force: true }); } catch (_) {} }
function isStarting(slug, dataDir) {
  try { return Date.now() - fs.statSync(requestedFile(slug, dataDir)).mtimeMs < REQUEST_GRACE_MS; } catch { return false; }
}

function getRunInfo(slug, dataDir) {
  const lock = runLock.status(slug, { dataDir });
  let summary = null;
  try { summary = JSON.parse(fs.readFileSync(path.join(dataDir, 'brands', slug, '_run_summary.json'), 'utf8')); } catch { /* none yet */ }
  const byName = new Map(((summary && summary.phases) || []).map(p => [p.name, p]));
  const phases = PHASE_ORDER.map(name => {
    const p = byName.get(name);
    // a summary written before this phase existed (finished run) must not show it as pending forever
    if (!p) return { name, state: summary && summary.finishedAt ? 'skipped' : 'pending' };
    if (p.exit) {
      const failed = Object.entries(p.exit).filter(([, c]) => c !== 0).map(([s]) => s);
      return { name, state: 'done', failed: failed.length ? failed : undefined };
    }
    return { name, state: 'running', startedAt: p.startedAt };
  });
  const running = phases.find(p => p.state === 'running');
  const starting = !lock.held && isStarting(slug, dataDir);
  return {
    active: !!lock.held || starting,
    startedAt: (lock.held && lock.startedAt) || (summary && summary.startedAt) || null,
    finishedAt: (!lock.held && summary && summary.finishedAt) || null,
    phase: lock.held ? (running ? running.name : null) : (starting ? 'starting' : null),
    phases: summary ? phases : [],
  };
}

module.exports = { getRunInfo, markRequested, clearRequested, PHASE_ORDER };
