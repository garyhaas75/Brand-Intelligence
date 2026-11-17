// Offline tests for social audit checkpoint/resume, carry-forward and save-before-analysis.
// Run: node --test test/social_resume.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const social = require('../analysis/social_audit.js');
const checkpoint = require('../utils/checkpoint');
delete process.env.APIFY_API_TOKEN;
delete process.env.YOUTUBE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SOCIAL_DRY_RUN;
delete process.env.BI_FORCE;
delete process.env.BI_RESUME_TTL_HOURS;

const SLUG = 'resume-test';
const STEP = social.CHECKPOINT_STEP;

function setup({ existing } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-resume-'));
  const dir = path.join(dataDir, 'brands', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({
    name: 'Target Co', url: 'https://target.example/', social: {},
    identifiedCompetitors: [{ name: 'Comp A', url: 'https://a.example/' }, { name: 'Comp B', url: 'https://b.example/' }],
  }));
  if (existing) fs.writeFileSync(path.join(dir, 'social_intelligence.json'), JSON.stringify(existing));
  return { dataDir, dir };
}
const readOut = dir => JSON.parse(fs.readFileSync(path.join(dir, 'social_intelligence.json'), 'utf8'));

function goodRecord(b, extra = {}) {
  return {
    id: b.slug, name: b.name, role: b.role, handle: `${b.slug}_ig`, scrapedAt: '2026-11-16T00:00:00.000Z',
    summary: { postCount: 10, avgEngagement: 50, postingFrequencyPerWeek: 2 }, contentThemes: [], topPosts: [], recentPosts: [],
    xHandle: null, xData: null, youtubeHandle: null, youtubeData: null, tiktokData: null, facebookData: null,
    handleSources: { instagram: 'profile' }, platformStatus: {}, contentGaps: [], ...extra,
  };
}

// Stub processBrand: records calls, optional per-brand behaviour.
function stub(behaviour = {}) {
  const calls = [];
  const fn = async (brand, anthropic, advance, opts) => {
    calls.push({ slug: brand.slug, opts });
    if (behaviour[brand.slug]) return behaviour[brand.slug](brand, opts);
    return goodRecord(brand);
  };
  return { fn, calls };
}

test('resume: a checkpointed brand is reused, not re-processed, and logged; checkpoint cleared after output', async () => {
  const { dataDir, dir } = setup();
  const compA = { slug: 'comp-a', name: 'Comp A', role: 'competitor' };
  checkpoint.put(SLUG, STEP, 'comp-a', { inputs: social.brandHandleInputs(compA), result: goodRecord(compA, { fromCheckpoint: true }) }, { dataDir });
  const s = stub();
  const logs = [];
  const orig = console.log; console.log = m => { logs.push(String(m)); };
  try { await social.runAudit({ slug: SLUG, dataDir, anthropic: null, processBrandImpl: s.fn }); }
  finally { console.log = orig; }
  assert.deepEqual(s.calls.map(c => c.slug), [SLUG, 'comp-b']);
  assert.ok(logs.some(l => /Comp A: resumed from checkpoint/.test(l)));
  const out = readOut(dir);
  assert.equal(out.brands.find(b => b.name === 'Comp A').fromCheckpoint, true);
  assert.equal(fs.existsSync(checkpoint.fileFor(SLUG, STEP, dataDir)), false, 'checkpoint cleared');
});

test('resume: a crash keeps finished brands and per-platform results; the rerun does not pay again', async () => {
  const { dataDir, dir } = setup();
  const outPath = path.join(dir, 'social_intelligence.json');
  fs.mkdirSync(outPath); // makes the output write throw: stands in for a crash after scraping
  const first = stub({
    'comp-b': async (b, opts) => { opts.cache.put('x', { posts: [{ likes: 1, comments: 0 }], paid: true }); throw new Error('boom mid-brand'); },
  });
  await assert.rejects(social.runAudit({ slug: SLUG, dataDir, anthropic: null, processBrandImpl: first.fn }));
  assert.deepEqual(checkpoint.keys(SLUG, STEP, { dataDir }).sort(), ['comp-a', 'comp-b#x', SLUG].sort());

  fs.rmdirSync(outPath);
  let cachedX;
  const second = stub({ 'comp-b': async (b, opts) => { cachedX = opts.cache.get('x'); return goodRecord(b); } });
  await social.runAudit({ slug: SLUG, dataDir, anthropic: null, processBrandImpl: second.fn });
  assert.deepEqual(second.calls.map(c => c.slug), ['comp-b'], 'only the unfinished brand runs');
  assert.equal(cachedX.paid, true, 'the platform result paid for before the crash is reused');
  assert.equal(readOut(dir).brands.length, 3);
  assert.equal(fs.existsSync(checkpoint.fileFor(SLUG, STEP, dataDir)), false);
});

test('processBrand: a cached platform result is used instead of a new scrape', async () => {
  let touched = false;
  const store = new Map([['x:c_x', { posts: [{ likes: 5, comments: 1, shares: 0, caption: 'cached', timestamp: '2026-11-01T00:00:00.000Z', postUrl: null, imageUrl: null, views: null }], followers: 600, reason: null, source: 'apidojo/tweet-scraper', notFound: false }]]);
  const out = await social.processBrand({ slug: 'c', name: 'C', url: 'https://c.co.jp/', role: 'competitor', xHandle: 'c_x' }, null, () => {}, {
    dryRun: true, cache: { get: k => store.get(k), put: (k, v) => store.set(k, v) },
    fixtures: { get x() { touched = true; return null; } },
  });
  assert.equal(touched, false);
  assert.equal(out.xData.summary.postCount, 1);
  assert.equal(out.engagementByPlatform.x.basis, 'followers');
  assert.equal(out.engagementByPlatform.x.rate, 1);
});

test('carry-forward: a brand that fails now keeps its previous good data, marked stale; failed brand is not checkpointed', async () => {
  const prevB = goodRecord({ slug: 'comp-b', name: 'Comp B', role: 'competitor' }, { summary: { postCount: 40, avgEngagement: 99 } });
  const { dataDir, dir } = setup({ existing: { brands: [prevB], whiteSpaceOpportunities: null, competitionStrategy: null } });
  const putKeys = [];
  const origPut = checkpoint.put;
  checkpoint.put = (...args) => { putKeys.push(args[2]); return origPut(...args); };
  try {
    const s = stub({ 'comp-b': async () => { throw new Error('Apify down'); } });
    await social.runAudit({ slug: SLUG, dataDir, anthropic: null, processBrandImpl: s.fn });
  } finally { checkpoint.put = origPut; }
  const b = readOut(dir).brands.find(x => x.name === 'Comp B');
  assert.equal(b.stale, true);
  assert.equal(b.summary.postCount, 40);
  assert.equal(b.lastError, 'Apify down');
  assert.ok(b.lastAttempt);
  assert.ok(putKeys.includes('comp-a'), 'finished brands are checkpointed');
  assert.ok(!putKeys.includes('comp-b'), 'a failed brand is not checkpointed, so a resume retries it');

  // No previous data: the failure is recorded as such, nothing invented.
  const fresh = social.carryForwardBrand({ name: 'N', failed: true, error: 'x' }, null);
  assert.equal(fresh.failed, true);
  assert.equal(fresh.stale, undefined);
});

test('carry-forward per platform: same handle and a failed status keep old data; not-found or a new handle do not', () => {
  const prev = { name: 'P', scrapedAt: 't0', xHandle: 'same', xData: { summary: { postCount: 9, avgEngagement: 10 } }, summary: { postCount: 0 } };
  // A second failure keeps the original data date instead of creeping forward to the last carried record.
  const prev2 = { ...prev, scrapedAt: 't1', platformStatus: { x: { stale: true, dataFrom: 't0' } } };
  const again = social.carryForwardBrand({ name: 'P', xHandle: 'same', xData: null, summary: { postCount: 0 }, engagementByPlatform: {}, platformStatus: { x: { status: 'no-data' } } }, prev2);
  assert.equal(again.platformStatus.x.dataFrom, 't0');
  const base = { name: 'P', xHandle: 'same', xData: null, summary: { postCount: 0 }, engagementByPlatform: {} };
  const kept = social.carryForwardBrand({ ...base, platformStatus: { x: { status: 'no-data', reason: 'X scrape failed: timeout' } } }, prev);
  assert.equal(kept.xData.summary.postCount, 9);
  assert.equal(kept.platformStatus.x.stale, true);
  assert.equal(kept.platformStatus.x.dataFrom, 't0');
  assert.equal(kept.platformStatus.x.lastError, 'X scrape failed: timeout');
  assert.equal(kept.engagementBasis.platform, 'x');
  const nf = social.carryForwardBrand({ ...base, platformStatus: { x: { status: 'handle_not_found' } } }, prev);
  assert.equal(nf.xData, null);
  const other = social.carryForwardBrand({ ...base, xHandle: 'different', platformStatus: { x: { status: 'no-data' } } }, prev);
  assert.equal(other.xData, null);
});

test('write-back: handles that were not found or are unverified guesses never reach profile.json', async () => {
  const { dataDir, dir } = setup();
  const s = stub({
    'comp-a': async b => goodRecord(b, { xHandle: 'missing_x', handleSources: { x: 'profile-less' }, platformStatus: { x: { status: 'handle_not_found', verified: false } } }),
    'comp-b': async b => goodRecord(b, { xHandle: 'guess_x', handleSources: { x: 'claude' }, platformStatus: { x: { status: 'unverified_handle', verified: null } } }),
  });
  await social.runAudit({ slug: SLUG, dataDir, anthropic: null, processBrandImpl: s.fn });
  const prof = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  for (const c of prof.identifiedCompetitors) assert.equal(c.xHandle, undefined, c.name);
});

test('analysis failure never discards scraped data: scrape output is on disk before analysis starts', async () => {
  const { dataDir, dir } = setup({ existing: { brands: [], whiteSpaceOpportunities: [{ theme: 'old' }], competitionStrategy: null } });
  let seenAtAnalysis = null;
  const s = stub();
  const out = await social.runAudit({
    slug: SLUG, dataDir, anthropic: {}, processBrandImpl: s.fn,
    analyses: {
      contentGaps: async () => { seenAtAnalysis = readOut(dir); throw new Error('Claude 529'); },
      whiteSpace: async () => { throw new Error('Claude 529'); },
      strategy: async () => [{ tactic: 'new tactic' }],
    },
  });
  assert.equal(seenAtAnalysis.brands.length, 3, 'scraped brands were saved before the first analysis');
  assert.equal(seenAtAnalysis.analysisStatus.contentGaps, 'pending');
  const disk = readOut(dir);
  assert.equal(disk.brands.length, 3);
  assert.equal(disk.analysisStatus.contentGaps, 'failed');
  assert.equal(disk.analysisStatus.whiteSpace, 'failed-kept-previous');
  assert.deepEqual(disk.whiteSpaceOpportunities, [{ theme: 'old' }]);
  assert.equal(disk.analysisStatus.strategy, 'ok');
  assert.deepEqual(out.competitionStrategy, [{ tactic: 'new tactic' }]);
});

test('checkpoints key on the handle: a corrected handle misses, a written-back discovered handle still hits', async () => {
  const brand = { slug: 'comp-a', name: 'Comp A', handle: 'old_ig' };
  const saved = { inputs: social.brandHandleInputs(brand), result: { handle: 'old_ig' } };
  assert.equal(social.brandCheckpointMatches(brand, saved), true);
  assert.equal(social.brandCheckpointMatches({ ...brand, handle: 'fixed_ig' }, saved), false, 'corrected handle');
  assert.equal(social.brandCheckpointMatches({ ...brand, xHandle: 'new_x' }, saved), false, 'added handle');
  assert.equal(social.brandCheckpointMatches({ ...brand, structuredSocialLinks: ['https://x.com/sd_x'] }, saved), false, 'new sameAs handle');
  assert.equal(social.brandCheckpointMatches(brand, saved.result), false, 'old format without inputs never matches');
  const discovered = { inputs: social.brandHandleInputs({ name: 'D' }), result: { handle: 'found_ig' } };
  assert.equal(social.brandCheckpointMatches({ name: 'D', handle: 'found_ig' }, discovered), true);

  // Through runAudit: profile handle corrected after the checkpoint was saved, the brand is redone.
  const { dataDir, dir } = setup();
  checkpoint.put(SLUG, STEP, 'comp-a', { inputs: social.brandHandleInputs({ handle: 'old_ig' }), result: goodRecord({ slug: 'comp-a', name: 'Comp A', role: 'competitor' }, { handle: 'old_ig' }) }, { dataDir });
  const prof = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  prof.identifiedCompetitors[0].instagramHandle = 'fixed_ig';
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(prof));
  const s = stub();
  await social.runAudit({ slug: SLUG, dataDir, anthropic: null, processBrandImpl: s.fn });
  assert.ok(s.calls.some(c => c.slug === 'comp-a'), 'comp-a re-processed after its handle changed');

  // Per-platform: the cache key carries the handle, so a different handle misses.
  const store = new Map();
  const cache = { get: k => store.get(k), put: (k, v) => store.set(k, v) };
  const scrapes = [];
  const scrapers = { instagram: async h => { scrapes.push(h); return [{ shortCode: 'a', likesCount: 1, commentsCount: 0, timestamp: '2026-11-01T00:00:00.000Z' }]; }, tiktok: async () => [], facebook: async () => [] };
  await social.processBrand({ slug: 'z', name: 'Z', handle: 'one' }, null, () => {}, { dryRun: true, cache, scrapers });
  await social.processBrand({ slug: 'z', name: 'Z', handle: 'one' }, null, () => {}, { dryRun: true, cache, scrapers });
  await social.processBrand({ slug: 'z', name: 'Z', handle: 'two' }, null, () => {}, { dryRun: true, cache, scrapers });
  assert.deepEqual(scrapes, ['one', 'two']);
});

test('empty TikTok and Facebook results are not checkpointed', async () => {
  const puts = [];
  const cache = { get: () => undefined, put: k => puts.push(k) };
  const out = await social.processBrand({ slug: 'e', name: 'E', tiktokHandle: 'tt', facebookHandle: 'fbpage' }, null, () => {}, {
    dryRun: true, cache, scrapers: { tiktok: async () => [], facebook: async () => [] },
  });
  assert.equal(out.platformStatus.tiktok.status, 'no-data');
  assert.equal(out.platformStatus.facebook.status, 'no-data');
  assert.deepEqual(puts.filter(k => /^(tiktok|facebook)/.test(k)), []);
  const withData = await social.processBrand({ slug: 'e', name: 'E', tiktokHandle: 'tt' }, null, () => {}, {
    dryRun: true, cache, scrapers: { tiktok: async () => [{ diggCount: 3, commentCount: 1, text: 'hi', createTime: 1762000000 }] },
  });
  assert.equal(withData.platformStatus.tiktok.status, 'ok');
  assert.ok(puts.includes('tiktok:tt'));
});

test('guess laundering: Claude guesses wrong_ig and wrong_tt, scrapes error, profile.json holds neither', async () => {
  const { dataDir, dir } = setup();
  const fakeClaude = { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ instagram: 'wrong_ig', tiktok: 'wrong_tt' }) }] }) } };
  const boom = async () => { throw new Error('Apify actor failed'); };
  await social.runAudit({
    slug: SLUG, dataDir, anthropic: fakeClaude,
    processBrandOpts: { skipPageDetection: true, scrapers: { instagram: boom, tiktok: boom, facebook: boom } },
    analyses: { contentGaps: async () => [], whiteSpace: async () => [], strategy: async () => [] },
  });
  const out = readOut(dir);
  const target = out.brands.find(b => b.role === 'target');
  assert.equal(target.handle, 'wrong_ig');
  assert.equal(target.handleSources.instagram, 'claude');
  assert.equal(target.platformStatus.instagram.status, 'error');
  assert.equal(target.platformStatus.tiktok.status, 'error');
  const prof = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  assert.equal(prof.social.instagram, undefined);
  assert.equal(prof.social.tiktok, undefined);
  for (const c of prof.identifiedCompetitors) {
    assert.equal(c.instagramHandle, undefined, c.name);
    assert.equal(c.tiktokHandle, undefined, c.name);
  }
});

test('provenance: a Claude guess that returned data is saved with its provenance and reported next run', async () => {
  const { dataDir, dir } = setup();
  const fakeClaude = { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ instagram: 'real_ig' }) }] }) } };
  const ig = async () => [{ shortCode: 'a', likesCount: 4, commentsCount: 1, timestamp: '2026-11-01T00:00:00.000Z' }];
  const opts = { skipPageDetection: true, scrapers: { instagram: ig, tiktok: async () => [], facebook: async () => [] } };
  const analyses = { contentGaps: async () => [], whiteSpace: async () => [], strategy: async () => [] };
  await social.runAudit({ slug: SLUG, dataDir, anthropic: fakeClaude, processBrandOpts: opts, analyses });
  const prof = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  assert.equal(prof.social.instagram, 'real_ig');
  assert.deepEqual(prof.socialProvenance.instagram, { source: 'claude-guess-returned-data', handle: 'real_ig' });
  await social.runAudit({ slug: SLUG, dataDir, anthropic: null, processBrandOpts: opts, analyses });
  const t = readOut(dir).brands.find(b => b.role === 'target');
  assert.equal(t.handleSources.instagram, 'profile');
  assert.equal(t.platformStatus.instagram.provenance, 'claude-guess-returned-data');

  // The user then edits the handle by hand: the old provenance must not stick to the new handle.
  const edited = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  edited.social.instagram = 'hand_entered_ig';
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(edited));
  await social.runAudit({ slug: SLUG, dataDir, anthropic: null, processBrandOpts: opts, analyses });
  const t2 = readOut(dir).brands.find(b => b.role === 'target');
  assert.equal(t2.handle, 'hand_entered_ig');
  assert.equal(t2.platformStatus.instagram.provenance, undefined);
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  assert.equal(after.social.instagram, 'hand_entered_ig');
  assert.equal(after.socialProvenance.instagram, undefined, 'stale provenance removed from profile.json');
});

test('provenance helpers: applies only to the handle it was recorded for; legacy string form never applies', () => {
  const prov = { source: 'claude-guess-returned-data', handle: '@Real_IG' };
  assert.equal(social.provenanceApplies(prov, 'real_ig'), true);
  assert.equal(social.provenanceApplies(prov, 'other_ig'), false);
  assert.equal(social.provenanceApplies(prov, null), false);
  assert.equal(social.provenanceApplies('claude-guess-returned-data', 'real_ig'), false);
  const pruned = social.pruneProvenance({ instagram: prov, tiktok: { source: 'page-scan', handle: 'tt' } }, { instagram: 'changed', tiktok: 'tt' });
  assert.deepEqual(Object.keys(pruned.value), ['tiktok']);
  assert.equal(pruned.changed, true);
});

test('LINE: a Claude-guessed id stays unverified even when the page exists, and is never written back', async () => {
  const { dataDir, dir } = setup();
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  p.market = 'Japan';
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(p));
  const fakeClaude = { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ line: '@toysrus' }) }] }) } };
  const LINE_FOUND = path.join(__dirname, 'fixtures', 'social', 'line_found.json');
  await social.runAudit({
    slug: SLUG, dataDir, anthropic: fakeClaude,
    processBrandOpts: { skipPageDetection: true, fixtures: { line: LINE_FOUND }, scrapers: { instagram: async () => [], tiktok: async () => [], facebook: async () => [] } },
    analyses: { contentGaps: async () => [], whiteSpace: async () => [], strategy: async () => [] },
  });
  const t = readOut(dir).brands.find(b => b.role === 'target');
  assert.equal(t.lineAccount.exists, true, 'the page exists');
  assert.equal(t.handleSources.line, 'claude');
  assert.equal(t.platformStatus.line.verified, null);
  assert.equal(t.platformStatus.line.unverifiedGuess, true);
  assert.match(social.buildPlatformCoverageContext([t]), /unverified guess/);
  const prof = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  assert.equal(prof.social.line, undefined);
  for (const c of prof.identifiedCompetitors) assert.equal(c.lineId, undefined, c.name);

  // The same id from the site's own sameAs links is trusted.
  const sd = await social.processBrand({ slug: 's', name: 'S', url: 'https://s.co.jp/', role: 'competitor', structuredSocialLinks: ['https://line.me/R/ti/p/@toysrus'] }, null, () => {}, { dryRun: true, fixtures: { line: LINE_FOUND } });
  assert.equal(sd.platformStatus.line.verified, true);
  assert.equal(social.writebackBlocked(sd, 'line'), false);
});

test('non-Japan run with a twitter sameAs link in site data: zero X scrapes, zero YouTube and LINE calls', async () => {
  const { dataDir, dir } = setup();
  fs.writeFileSync(path.join(dir, 'site_intelligence.json'), JSON.stringify({ brands: [
    { id: SLUG, name: 'Target Co', role: 'target', structuredData: { socialLinks: ['https://twitter.com/target_co', 'https://www.youtube.com/@targetco', 'https://line.me/R/ti/p/@targetco'] } },
    { id: 'comp-a', name: 'Comp A', url: 'https://a.example/', structuredData: { socialLinks: ['https://x.com/comp_a'] } },
  ] }));
  const touched = [];
  const fetchCalls = [];
  const origFetch = globalThis.fetch;
  const origYt = process.env.YOUTUBE_API_KEY;
  globalThis.fetch = async u => { fetchCalls.push(String(u)); return { ok: false, status: 404, url: String(u), json: async () => ({}), text: async () => '' }; };
  process.env.YOUTUBE_API_KEY = 'test-key-not-real';
  try {
    await social.runAudit({
      slug: SLUG, dataDir, anthropic: null,
      processBrandOpts: {
        skipPageDetection: true,
        scrapers: { instagram: async () => [], tiktok: async () => [], facebook: async () => [] },
        fixtures: { get x() { touched.push('x'); return null; }, get youtube() { touched.push('youtube'); return null; }, get line() { touched.push('line'); return null; } },
      },
    });
  } finally {
    globalThis.fetch = origFetch;
    if (origYt === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = origYt;
  }
  assert.deepEqual(touched, [], 'scrapeXViaApify, fetchYouTubeChannel and checkLinePresence never called');
  assert.deepEqual(fetchCalls.filter(u => /googleapis|line\.me|lin\.ee/.test(u)), []);
  const out = readOut(dir);
  const t = out.brands.find(b => b.role === 'target');
  assert.equal(t.platformStatus.x.status, 'not-applicable');
  assert.equal(t.platformStatus.x.reason, 'not enabled for this market');
  assert.equal(t.platformStatus.x.ignoredHandle, 'target_co');
  assert.equal(out.brands.find(b => b.name === 'Comp A').platformStatus.x.ignoredHandle, 'comp_a');
  const prof = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  assert.equal(prof.social.twitter, undefined, 'nothing written back for an off-market platform');
});

test('dry run is a pure no-op: no processing, no files, no checkpoint', async () => {
  const { dataDir, dir } = setup();
  const before = fs.readdirSync(dir).sort();
  const s = stub();
  const r = await social.runAudit({ slug: SLUG, dataDir, dryRun: true, anthropic: { messages: { create: async () => { throw new Error('Claude called in dry run'); } } }, processBrandImpl: s.fn });
  assert.equal(r, null);
  assert.equal(s.calls.length, 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
  assert.equal(fs.existsSync(path.join(dir, '_checkpoints')), false);
});

test('no em dashes in this test file', () => {
  assert.ok(!fs.readFileSync(__filename, 'utf8').includes(String.fromCharCode(0x2014)));
});
