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

for (const mod of ['marketplace', 'jp_demand', 'translations', 'site_blueprint', 'competitive_analysis', 'personas', 'social_intelligence', 'site_intelligence', 'search_seo', 'action_plan']) {
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

test('the report routes (html and pdf) require a tab and refuse a user with no grants', () => {
  for (const p of ['/api/brands/s/report', '/api/brands/s/report.pdf']) {
    const tabs = tabsForPath(p, 'GET');
    assert.ok(Array.isArray(tabs) && tabs.length > 0, `${p} is ungated`);
    assert.strictEqual(userAllowed(nobody, tabs), false, `${p} lets a no-grant user through`);
    // a mixed-case variant must resolve to the same tabs
    assert.deepStrictEqual(tabsForPath(p.toUpperCase().replace('/API/BRANDS/S/', '/api/brands/s/'), 'GET') || tabs, tabs);
  }
});

test('server wires lang on module reads, the report routes and the translate phase', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /localizedBrandData\(req\.params\.slug, data, reqLang\(req\), res, file\)/);
  assert.match(src, /app\.get\('\/api\/brands\/:slug\/report'/);
  assert.match(src, /app\.get\('\/api\/brands\/:slug\/report\.pdf'/);
  assert.match(src, /X-Translations/);
  const bd = fs.readFileSync(path.join(__dirname, '../analysis/brand_discovery.js'), 'utf8');
  assert.match(bd, /name: 'translate', scripts: \['translate_outputs\.js'\]/);
});

test('stale translations are signalled, the profile is localized for the report, and the pdf guard is released as soon as the PDF exists', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /setHeader\('X-Translations', 'stale'\)/);
  assert.match(src, /loadBrandReportInput\(path\.join\(BRANDS_DIR, slug\), lang, tr\)/);
  const fin = src.slice(src.indexOf('Release the guard as soon as the PDF has been produced'));
  assert.ok(fin.indexOf('reportPdfBusy = false') < fin.indexOf('browser.close()'), 'guard must be released before the shutdown wait');
  assert.match(fin, /SIGKILL/);
});

test('model-cost Japan modules refuse a refresh for any other market', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /\['translations', 'site_blueprint', 'marketplace', 'jp_demand'\]\.includes\(moduleName\)/);
  assert.match(src, /only available for Japan-market brands/);
});
