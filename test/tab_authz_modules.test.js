// Every analysis module the server exposes must be gated by tab, in all three directions
// (read, per-module refresh, history). A module missing from the maps resolves to "no tabs
// required", which lets any signed-in user, including one granted nothing, read it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tabsForPath, userAllowed } = require('../modules/tab_catalog');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const block = server.slice(server.indexOf('const BRAND_MODULES = ['), server.indexOf('];', server.indexOf('const BRAND_MODULES = [')));
const modules = [...block.matchAll(/name:\s*'([a-z_]+)'/g)].map(m => m[1]);

const nobody = { permissions: { tabs: [] } };

test('the module list was read from server.js', () => {
  assert.ok(modules.length >= 8, modules.join(','));
  assert.ok(modules.includes('marketplace') && modules.includes('jp_demand'));
});

for (const mod of ['marketplace', 'jp_demand', 'competitive_analysis', 'personas', 'social_intelligence', 'site_intelligence', 'search_seo', 'action_plan']) {
  test(`${mod}: read, refresh and history all require a tab, and a user with no tabs is refused`, () => {
    for (const [p, m] of [[`/api/brands/s/${mod}`, 'GET'], [`/api/brands/s/refresh/${mod}`, 'POST'], [`/api/brands/s/history/${mod}`, 'GET']]) {
      const tabs = tabsForPath(p, m);
      assert.ok(Array.isArray(tabs) && tabs.length > 0, `${m} ${p} is ungated (${JSON.stringify(tabs)})`);
      assert.strictEqual(userAllowed(nobody, tabs), false, `${m} ${p} lets a no-grant user through`);
    }
  });
}

test('every module in server.js BRAND_MODULES has a read gate', () => {
  for (const mod of modules) {
    const tabs = tabsForPath(`/api/brands/s/${mod}`, 'GET');
    assert.ok(Array.isArray(tabs) && tabs.length > 0, `${mod} read is ungated`);
  }
});
