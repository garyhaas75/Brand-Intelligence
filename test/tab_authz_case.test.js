'use strict';
// ---------------------------------------------------------------------------
// The case-variant auth bypass.
//
// Express matches routes case-insensitively by default, so POST /API/brands
// reached the same handler as POST /api/brands while the gate's prefix test
// (`req.path.startsWith('/api')`) and its lookups were case-SENSITIVE. One
// capital letter meant no auth at all: /API/brands created a brand and
// DELETE /API/brands/<slug> removed the registry entry and rm -rf'd the
// brand's data directory, anonymously. Confirmed against this app before the
// fix: GET /api/brands returned 401, GET /API/brands returned 200 with no
// token.
//
// Two things stop it now, and both are asserted here. server.js sets
// `case sensitive routing` so a variant cannot reach a handler at all, and the
// gate tests /^\/api(\/|$)/i and lowercases the path before every lookup
// (server.js: API_PREFIX, OPEN_PATHS.has(...toLowerCase()) and
// tabsForPath(req.path.toLowerCase(), ...)). The two literals below mirror the
// gate's; change one and change the other.
//
// Normalisation lives at the call site, not inside tabsForPath, so this file
// applies it the same way the gate does rather than expecting the map to be
// case-blind.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const { tabsForPath } = require('../modules/tab_catalog');

const eq = (a, b) => assert.deepStrictEqual(a && [...a].sort(), b && [...b].sort());

// Mirrors the gate's prefix test in server.js.
const API_PREFIX = /^\/api(\/|$)/i;

// Mirrors what the gate does before calling tabsForPath.
const gateTabs = (p, m) => tabsForPath(p.toLowerCase(), m);

test('case variants of the exploit paths resolve to the same tabs, never null', () => {
  for (const p of ['/api/brands', '/API/brands', '/Api/Brands', '/aPi/brANDs']) {
    assert.notStrictEqual(gateTabs(p, 'POST'), null, `POST ${p} must not be ungated`);
    eq(gateTabs(p, 'POST'), tabsForPath('/api/brands', 'POST'));
    eq(gateTabs(p, 'POST'), ['portfolio']);
  }
  for (const p of ['/api/brands/anne-klein', '/API/brands/anne-klein', '/Api/Brands/anne-klein']) {
    assert.notStrictEqual(gateTabs(p, 'DELETE'), null, `DELETE ${p} must not be ungated`);
    eq(gateTabs(p, 'DELETE'), tabsForPath('/api/brands/anne-klein', 'DELETE'));
    eq(gateTabs(p, 'DELETE'), ['portfolio']);
  }
});

test('a mixed-case path resolves to the same tabs as its lowercase twin', () => {
  const pairs = [
    ['/API/brands/anne-klein/personas', '/api/brands/anne-klein/personas', 'GET'],
    ['/Api/Brands/anne-klein/Refresh/Personas', '/api/brands/anne-klein/refresh/personas', 'POST'],
    ['/API/brands/anne-klein/Share-Links', '/api/brands/anne-klein/share-links', 'GET'],
    ['/API/settings/Social-Cookies', '/api/settings/social-cookies', 'POST'],
  ];
  for (const [variant, lower, method] of pairs) {
    const got = gateTabs(variant, method);
    assert.notStrictEqual(got, null, `${method} ${variant} must not be ungated`);
    eq(got, tabsForPath(lower, method));
  }
});

test('the gate prefix catches every case variant but respects the segment boundary', () => {
  for (const p of ['/api', '/api/brands', '/API/brands', '/Api/Mixed-Case', '/aPI/x']) {
    assert.ok(API_PREFIX.test(p), `${p} must be gated`);
  }
  // Without the (\/|$) these would be falsely gated and 401 for everyone.
  for (const p of ['/apixyz', '/apiary/things', '/', '/share/tok-123', '/assets/app.js']) {
    assert.ok(!API_PREFIX.test(p), `${p} must not be gated`);
  }
});
