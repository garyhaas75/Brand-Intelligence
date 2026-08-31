'use strict';
// Locks the path shapes this app actually serves. The failure this guards
// against is silent: a tabsForPath that resolves nothing leaves every endpoint
// ungated while the wiring reads as correct, so each shape gets a case.

const test = require('node:test');
const assert = require('node:assert');
const { tabsForPath, userAllowed, TAB_CATALOG, ALL_TABS } = require('../modules/tab_catalog');

const eq = (a, b) => assert.deepStrictEqual(a && [...a].sort(), b && [...b].sort());

test('catalog ids are unique across the whole catalog and match the nav', () => {
  assert.strictEqual(ALL_TABS.length, new Set(ALL_TABS).size);
  eq(ALL_TABS, ['portfolio', 'profile', 'competitive', 'personas', 'social', 'website', 'search', 'action']);
  for (const g of TAB_CATALOG) {
    assert.ok(g.group && g.label, 'every group needs group and label');
    for (const t of g.tabs) assert.strictEqual(t.id, t.id.trim());
  }
});

test('tenant in the path: the brand slug is skipped, not read as the area', () => {
  eq(tabsForPath('/api/brands/anne-klein/personas', 'GET'), ['personas', 'action']);
  eq(tabsForPath('/api/brands/some-other-brand/personas', 'GET'), ['personas', 'action']);
  // The trap: if the slug were read as the area this would resolve to null.
  assert.notStrictEqual(tabsForPath('/api/brands/anne-klein/search_seo', 'GET'), null);
});

test('two-segment key wins over one, and the one-segment floor still catches', () => {
  eq(tabsForPath('/api/brands/x/refresh/personas', 'POST'), ['personas']);
  eq(tabsForPath('/api/brands/x/refresh/search_seo', 'POST'), ['search']);
  eq(tabsForPath('/api/brands/x/history/personas', 'GET'), ['personas', 'action']);
  // An unrecognised module must not fall through to ungated.
  eq(tabsForPath('/api/brands/x/refresh/not-a-module', 'POST'), ['portfolio']);
  eq(tabsForPath('/api/brands/x/history/not-a-module', 'GET'), ['portfolio']);
});

test('collection versus detail: the read is chrome, the writes are pinned', () => {
  // The registry read is chrome for every section, so it resolves to the whole
  // area list rather than to one tab. userAllowed passes on any one of them,
  // which is how "holds at least one area" is expressed here.
  eq(tabsForPath('/api/brands', 'GET'), ALL_TABS);
  eq(tabsForPath('/api/brands/anne-klein', 'GET'), ALL_TABS);
  eq(tabsForPath('/api/brands', 'POST'), ['portfolio']);
  eq(tabsForPath('/api/brands/anne-klein', 'DELETE'), ['portfolio']);
  // The rule must not swallow the detail paths underneath it.
  eq(tabsForPath('/api/brands/anne-klein/personas', 'DELETE'), ['personas', 'action']);
  eq(tabsForPath('/api/brands/anne-klein/share-links/tok-123', 'DELETE'), ['action']);
});

test('the brand switcher is readable by any area holder, and by nobody with none', () => {
  const registry = tabsForPath('/api/brands', 'GET');
  const socialOnly = { permissions: { tabs: ['social'] } };
  const nothing = { permissions: { tabs: [] } };
  assert.strictEqual(userAllowed(socialOnly, registry), true);
  assert.strictEqual(userAllowed({ isAdmin: true }, registry), true);
  assert.strictEqual(userAllowed(nothing, registry), false);
  // The same holds for the brand summary the switcher links to.
  assert.strictEqual(userAllowed(nothing, tabsForPath('/api/brands/anne-klein', 'GET')), false);
  assert.strictEqual(userAllowed(socialOnly, tabsForPath('/api/brands/anne-klein', 'GET')), true);
});

test('refresh/all is Portfolio, not the union of the analysis tabs', () => {
  eq(tabsForPath('/api/brands/x/refresh/all', 'POST'), ['portfolio']);
});

test('non-brand paths resolve on their own first segment', () => {
  eq(tabsForPath('/api/settings/social-cookies', 'POST'), ['social']);
  assert.strictEqual(tabsForPath('/api/status', 'GET'), null);
  assert.strictEqual(tabsForPath('/api/tab-catalog', 'GET'), null);
  assert.strictEqual(tabsForPath('/share/some-token', 'GET'), null);
});

test('a query string does not change the answer', () => {
  eq(tabsForPath('/api/brands/x/history/personas?limit=5', 'GET'), ['personas', 'action']);
  eq(tabsForPath('/api/brands?all=1', 'POST'), ['portfolio']);
});

test('userAllowed: admins bypass, holders pass, others do not, no user fails closed', () => {
  const narrow = { isAdmin: false, permissions: { tabs: ['personas'] } };
  assert.ok(userAllowed({ isAdmin: true, permissions: {} }, ['portfolio']));
  assert.ok(userAllowed(narrow, ['personas', 'action']));
  assert.ok(!userAllowed(narrow, ['portfolio']));
  assert.ok(userAllowed(narrow, null), 'unmapped means any authenticated user');
  assert.ok(!userAllowed(null, null), 'no user is refused even on an unmapped path');
  assert.ok(!userAllowed({ isAdmin: false, permissions: {} }, ['personas']));
});
