const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lock = require('../utils/run_lock');
const { getRunInfo, markRequested, clearRequested } = require('../modules/run_info');
const { tabsForPath, userAllowed } = require('../modules/tab_catalog');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ri-'));
function summary(d, phases, extra = {}) {
  fs.mkdirSync(path.join(d, 'brands/s'), { recursive: true });
  fs.writeFileSync(path.join(d, 'brands/s/_run_summary.json'), JSON.stringify({ slug: 's', startedAt: '2026-01-01T00:00:00Z', phases, ...extra }));
}

test('no run: inactive, no phases', () => {
  const r = getRunInfo('s', tmp());
  assert.strictEqual(r.active, false);
  assert.deepStrictEqual(r.phases, []);
});

test('an active run reports the phase in progress and the ones before and after it', () => {
  const d = tmp();
  summary(d, [{ name: 'collect', exit: { 'a.js': 0 } }, { name: 'analyse', exit: null, startedAt: 'x' }]);
  assert.strictEqual(lock.acquire('s', 'phased', { dataDir: d }), true);
  const r = getRunInfo('s', d);
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.phase, 'analyse');
  assert.deepStrictEqual(r.phases.map(p => p.state), ['done', 'running', 'pending', 'pending']);
});

test('a failed module in a finished phase is listed so the card can say so', () => {
  const d = tmp();
  summary(d, [{ name: 'collect', exit: { 'a.js': 0, 'b.js': 1 } }]);
  const r = getRunInfo('s', d);
  assert.deepStrictEqual(r.phases[0].failed, ['b.js']);
});

test('after the lock is released the run is inactive and reports its finish time', () => {
  const d = tmp();
  summary(d, [{ name: 'collect', exit: { 'a.js': 0 } }], { finishedAt: '2026-01-01T01:00:00Z' });
  lock.acquire('s', 'phased', { dataDir: d }); lock.release('s', { dataDir: d });
  const r = getRunInfo('s', d);
  assert.strictEqual(r.active, false);
  assert.strictEqual(r.finishedAt, '2026-01-01T01:00:00Z');
});

test('run-status is gated by tab and refuses a user with no grants', () => {
  const tabs = tabsForPath('/api/brands/s/run-status', 'GET');
  assert.ok(Array.isArray(tabs) && tabs.length > 0);
  assert.strictEqual(userAllowed({ permissions: { tabs: [] } }, tabs), false);
});

test('server.js keeps a live run showing as running and does not count profile.json as fresh', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /!run\.active && moduleStatus\.some\(m => m\.exists && m\.module !== 'profile'\)/);
  assert.match(src, /s\.module !== 'profile'/);
});

test('demand runs after marketplace: it reads marketplace.json for its search terms', () => {
  const src = fs.readFileSync(path.join(__dirname, '../analysis/brand_discovery.js'), 'utf8');
  const collect = src.match(/name: 'collect', scripts: \[([^\]]*)\]/)[1];
  const analyse = src.match(/name: 'analyse', scripts: \[([^\]]*)\]/)[1];
  assert.ok(collect.includes('marketplace_jp.js') && !collect.includes('jp_demand.js'));
  assert.ok(analyse.includes('jp_demand.js'));
});

test('a run requested a moment ago reads as starting before the lock exists, and not after it is cleared or expires', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'brands/s'), { recursive: true });
  markRequested('s', d);
  const r = getRunInfo('s', d);
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.phase, 'starting');
  clearRequested('s', d);
  assert.strictEqual(getRunInfo('s', d).active, false);
  markRequested('s', d);
  const f = path.join(d, 'brands/s/_run.requested');
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(f, old, old);
  assert.strictEqual(getRunInfo('s', d).active, false, 'a request that never started must not stay running forever');
});
