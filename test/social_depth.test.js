// Social audit 360 depth (2026-11-18): 25 posts per platform, followers and engagement, Apify budget
// gating, the jp_proxy page scan, tiers and the partner relationship, marketplaces, and coverage.
// Stubs only: no Apify, no model, no request to any brand site.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

delete process.env.APIFY_API_TOKEN;
delete process.env.YOUTUBE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SOCIAL_DRY_RUN;
delete process.env.BI_FORCE;

const social = require('../analysis/social_audit.js');
const checkpoint = require('../utils/checkpoint');
const FX = path.join(__dirname, 'fixtures', 'social');

const DAY = 24 * 3600 * 1000;
// n Instagram posts, one every 2 days back from 2026-11-15; displayUrl is local so no image is fetched.
function igPosts(n, { likes = 90, comments = 10 } = {}) {
  const t0 = Date.parse('2026-11-15T00:00:00.000Z');
  return Array.from({ length: n }, (_, i) => ({
    shortCode: `p${i}`, type: i % 3 === 0 ? 'Sidecar' : 'Image', productType: i % 5 === 0 ? 'clips' : undefined,
    likesCount: likes, commentsCount: comments, caption: `post ${i} #おもちゃ`,
    timestamp: new Date(t0 - i * 2 * DAY).toISOString(), displayUrl: `/local/${i}.jpg`,
  }));
}
const empty = async () => [];

function setup(profile, slug = 'depth-test') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-depth-'));
  const dir = path.join(dataDir, 'brands', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(profile));
  return { dataDir, dir, slug, read: f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) };
}
const deniedAccess = { accessFor: () => ({ mode: 'denied', reason: 'test' }), fetchPage: async () => { throw new Error('must not fetch'); } };

test('depth: 25 of 40 posts are kept, newest first; only the first 5 keep an image', async () => {
  const out = await social.processBrand({ slug: 'd', name: 'D', handle: 'd_ig', role: 'competitor' }, null, () => {}, {
    dryRun: true, scrapers: { instagram: async () => ({ posts: igPosts(40), followers: 2000 }), tiktok: empty, facebook: empty },
  });
  assert.equal(social.POSTS_ANALYSED, 25);
  assert.equal(out.summary.postCount, 25);
  assert.equal(out.recentPosts.length, 25);
  assert.equal(out.platforms.instagram.posts, 25);
  assert.equal(out.recentPosts[0].postUrl, 'https://instagram.com/p/p0', 'newest first');
  assert.equal(out.recentPosts.filter(p => p.imageUrl).length, social.POSTS_WITH_IMAGES);
  assert.equal(out.recentPosts[5].imageUrl, null);
  assert.equal(out.summary.followersEstimate, 2000);
});

test('images: at most POSTS_WITH_IMAGES downloads per brand; the top posts are always saved, then the newest', async () => {
  const posts = igPosts(25).map((p, i) => ({ ...p, displayUrl: `https://cdn.example.test/img/${i}.jpg`,
    likesCount: i === 2 ? 900 : i === 10 ? 800 : i === 15 ? 700 : 10 }));
  const { dataDir } = setup({ name: 'Img' }, 'img');
  const realFetch = globalThis.fetch;
  const downloads = [];
  globalThis.fetch = async (url) => { downloads.push(String(url)); return new Response(Buffer.from('jpg'), { status: 200, headers: { 'content-type': 'image/jpeg' } }); };
  let out;
  try {
    out = await social.processBrand({ slug: 'img', name: 'Img', handle: 'img_ig', role: 'competitor' }, null, () => {}, {
      dryRun: true, dataDir, scrapers: { instagram: async () => ({ posts, followers: 2000 }), tiktok: empty, facebook: empty },
    });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(downloads.length, social.POSTS_WITH_IMAGES, 'every download counted: top and recent together');
  const got = downloads.map(u => Number(/\/img\/(\d+)\.jpg$/.exec(u)[1])).sort((a, b) => a - b);
  assert.deepEqual(got, [0, 1, 2, 10, 15], 'the three top posts plus the newest two that are not top posts');
  assert.equal(out.topPosts.length, 3);
  for (const tp of out.topPosts) assert.match(tp.imageUrl, /^\/api\/social-image\/img\//, 'every top post has a saved image');
  const byCode = c => out.topPosts.find(p => /\/p\/(p\d+)$/.exec(p.postUrl)[1] === c);
  assert.equal(out.recentPosts[2].imageUrl, byCode('p2').imageUrl, 'recent and top share one saved image');
  assert.equal(out.recentPosts.length, 25);
  assert.equal(out.recentPosts.filter(p => p.imageUrl).length, social.POSTS_WITH_IMAGES);
});

test('followers and engagement: rate = avg interactions / followers, frequency from timestamps', async () => {
  const out = await social.processBrand({ slug: 'e', name: 'E', handle: 'e_ig', tiktokHandle: 'e_tt', facebookHandle: 'e_fb', role: 'competitor' }, null, () => {}, {
    dryRun: true,
    scrapers: {
      instagram: async () => ({ posts: igPosts(25, { likes: 45, comments: 5 }), followers: 1000 }),
      tiktok: async () => [
        { diggCount: 300, commentCount: 0, text: 'a', createTime: Date.parse('2026-11-10T00:00:00Z') / 1000, authorMeta: { fans: 10000 } },
        { diggCount: 100, commentCount: 0, text: 'b', createTime: Date.parse('2026-11-03T00:00:00Z') / 1000, authorMeta: { fans: 10000 } },
      ],
      facebook: async () => [{ postId: '1', text: 'fb', likes: 10, comments: 2, time: '2026-11-01T00:00:00Z' }],
    },
  });
  const ig = out.platforms.instagram;
  assert.equal(ig.followers, 1000);
  assert.equal(ig.avgInteractions, 50);
  assert.equal(ig.engagementRate, 5, '50 / 1000 = 5 percent per post');
  assert.equal(ig.engagementRateUnit, 'percent of followers per post');
  assert.equal(ig.postsPerWeek, 3.5, '24 intervals over 48 days = 3.5 per week');
  assert.ok(ig.topFormats.some(f => f.format === 'reel') && ig.topFormats.some(f => f.format === 'carousel'));
  const tt = out.platforms.tiktok;
  assert.equal(tt.followers, 10000);
  assert.equal(tt.engagementRate, 2, 'avg 200 / 10000 = 2 percent');
  assert.equal(tt.postsPerWeek, 1);
  const fb = out.platforms.facebook;
  assert.equal(fb.engagementRate, null);
  assert.match(fb.engagementRateReason, /does not report page followers/);
  assert.equal(fb.postsPerWeek, null);
  // Pure helpers
  assert.deepEqual(social.postsPerWeekFrom([]), { postsPerWeek: null, reason: 'no dated posts', lastPostAt: null });
  const b = social.buildPlatformBlock({ handle: 'h', posts: [], followers: 500 });
  assert.equal(b.engagementRate, null);
  assert.equal(b.engagementRateReason, 'no posts analysed');
});

test('budget refusal: budgetSkipped recorded, no actor call, the run stops paying after the first refusal', async () => {
  process.env.BI_RUN_ID = `depth-budget-${Date.now()}`;
  try {
    const { dataDir, read } = setup({
      name: 'Target', url: 'https://target.example/', market: 'Japan', social: { instagram: 't_ig' },
      scrape: { apifyCapUsd: 0.1 },
      identifiedCompetitors: [{ name: 'Niche One', url: 'https://n1.example/', tier: 'niche', instagramHandle: 'n1', tiktokHandle: 'n1t' }],
    });
    let calls = 0;
    const count = async () => { calls++; return []; };
    const out = await social.runAudit({
      slug: 'depth-test', dataDir, anthropic: null, siteAccess: deniedAccess,
      processBrandOpts: { skipPageDetection: true, scrapers: { instagram: count, tiktok: count, facebook: count } },
    });
    assert.equal(calls, 0, 'no actor call after a refusal');
    const t = out.brands.find(b => b.role === 'target');
    assert.equal(t.platforms.instagram.budgetSkipped, true);
    assert.match(t.platforms.instagram.reason, /budget cap reached/);
    assert.equal(t.platformStatus.instagram.status, 'budget-skipped');
    const n = out.brands.find(b => b.name === 'Niche One');
    assert.equal(n.platforms.tiktok.budgetSkipped, true);
    assert.deepEqual(out.coverage.platforms.instagram.budgetSkipped.sort(), ['Niche One', 'Target']);
    assert.match(out.coverage.budgetStop, /cap reached/);
    const ledger = JSON.parse(fs.readFileSync(path.join(dataDir, 'brands', 'depth-test', '_apify_spend.json'), 'utf8'));
    assert.equal(ledger.runs[process.env.BI_RUN_ID].entries.filter(e => e.refused).length, 1, 'one refusal, then a clean stop');
    assert.equal(read('social_intelligence.json').coverage.budget.socialRefused, 1);
  } finally { delete process.env.BI_RUN_ID; }
});

test('budget grant: the reservation is recorded with the real cost of every actor run in the step', async () => {
  process.env.BI_RUN_ID = `depth-grant-${Date.now()}`;
  try {
    const { dataDir } = setup({ name: 'T', url: 'https://t.example/', social: { instagram: 't_ig' } });
    let opts = null;
    const ig = async (h, apify) => {
      opts = apify.callOptions({ maxItems: 25 });
      apify.onRun({ id: 'r1', usageTotalUsd: 0.004 });
      apify.onRun({ id: 'r2', usageTotalUsd: 0.06 });
      return { posts: igPosts(3), followers: 10 };
    };
    await social.runAudit({ slug: 'depth-test', dataDir, anthropic: null, siteAccess: deniedAccess, processBrandOpts: { skipPageDetection: true, scrapers: { instagram: ig } } });
    assert.equal(opts.maxItems, 25);
    assert.ok(opts.maxTotalChargeUsd > 0 && opts.maxTotalChargeUsd <= social.APIFY_EST_USD.instagram * 1.5 + 1e-9);
    const ledger = JSON.parse(fs.readFileSync(path.join(dataDir, 'brands', 'depth-test', '_apify_spend.json'), 'utf8'));
    const e = ledger.runs[process.env.BI_RUN_ID].entries.find(x => /^social instagram @t_ig/.test(x.label));
    assert.equal(e.reservedUsd, social.APIFY_EST_USD.instagram);
    assert.equal(e.actualUsd, 0.064);
    assert.equal(e.runId, 'r1,r2');
  } finally { delete process.env.BI_RUN_ID; }
});

test('jp_proxy: the page scan uses fetchPage once and never Playwright', async () => {
  let fetches = 0; let playwright = 0;
  const siteAccess = {
    accessFor: () => ({ mode: 'jp_proxy', maxPages: 8, authorization: { by: 'WHP', at: '2026-11-18' } }),
    fetchPage: async (url) => { fetches++; return { ok: true, status: 200, url, via: 'jp_proxy', text: '<footer><a href="https://www.instagram.com/proxy_ig/">IG</a><a href="https://x.com/proxy_x">X</a><a href="https://www.tiktok.com/@proxy_tt">TT</a></footer>' }; },
  };
  const out = await social.processBrand({ slug: 'jp', name: 'JP', url: 'https://www.proxied.example.jp/', role: 'target', market: 'Japan' }, null, () => {}, {
    siteAccess, detectPageImpl: async () => { playwright++; return {}; },
    fixtures: { x: path.join(FX, 'x_tweets.json'), line: path.join(FX, 'line_found.json') },
    scrapers: { instagram: empty, tiktok: empty, facebook: empty },
  });
  assert.equal(fetches, 1, 'one proxied page shared by every platform');
  assert.equal(playwright, 0);
  assert.equal(out.handle, 'proxy_ig');
  assert.equal(out.handleSources.instagram, 'page-scan');
  assert.equal(out.tiktokHandle, 'proxy_tt');
  assert.equal(out.xHandle, 'proxy_x');
  // Pure: hrefs are made absolute
  assert.deepEqual(social.extractHrefs('<a href="/about">a</a><a href=\'https://lin.ee/abc\'>l</a>', 'https://s.example/'), ['https://s.example/about', 'https://lin.ee/abc']);
});

test('jp_proxy: runAudit does not skip the target page scan for an authorized proxy site; denied does', async () => {
  const run = async (mode) => {
    const { dataDir } = setup({ name: 'T', url: 'https://t.example.jp/', market: 'Japan', scrape: { skipApifyRetry: true }, social: {} });
    const seen = [];
    await social.runAudit({
      slug: 'depth-test', dataDir, anthropic: null,
      siteAccess: { accessFor: () => ({ mode }), fetchPage: async () => ({ ok: false }) },
      processBrandImpl: async (b, a, adv, opts) => { seen.push(opts); return { id: b.slug, name: b.name, role: b.role, summary: { postCount: 0 }, platformStatus: {}, platforms: {} }; },
    });
    return seen[0];
  };
  const proxied = await run('jp_proxy');
  assert.notEqual(proxied.skipPageDetection, true);
  assert.ok(proxied.siteAccess && proxied.budget);
  assert.equal((await run('denied')).skipPageDetection, true);
});

test('tiers: partner carried through, audit order target, partner, niche, specialty, mass, then unclassified; partner never analysed as a competitor', async () => {
  const { dataDir, read } = setup({
    name: 'Toys R Us Japan', url: 'https://t.example.jp/', market: 'Japan', social: {},
    identifiedCompetitors: [
      { name: 'Niche A', url: 'https://na.example/', tier: 'niche' },
      { name: 'Spec A', url: 'https://sa.example/', tier: 'specialty' },
      { name: 'Don Quijote', url: 'https://www.donki.com/', tier: 'mass', relationship: 'partner' },
      { name: 'Mass A', url: 'https://ma.example/', tier: 'mass' },
      { name: 'Old Entry', url: 'https://old.example/' },
    ],
  });
  const order = [];
  const withData = new Set(['Toys R Us Japan', 'Don Quijote', 'Niche A']);
  const rec = (b) => {
    order.push(b.name);
    const blk = withData.has(b.name) ? social.buildPlatformBlock({ handle: 'h', posts: [{ likes: 10, comments: 0, timestamp: '2026-11-01T00:00:00Z', format: 'reel' }], followers: 100 }) : social.buildPlatformBlock({});
    return { id: b.slug, name: b.name, role: b.role, tier: 'wrong', summary: { postCount: 0 }, platformStatus: {}, platforms: { instagram: blk } };
  };
  let strategyComps = null; let synthBrands = null;
  const out = await social.runAudit({
    slug: 'depth-test', dataDir, anthropic: {}, siteAccess: deniedAccess, processBrandImpl: async (b) => rec(b),
    analyses: {
      contentGaps: async () => [], whiteSpace: async () => [],
      strategy: async (a, t, comps) => { strategyComps = comps.map(c => c.name); return []; },
      synthesis: async (a, brands) => {
        synthBrands = brands;
        return {
          tierInsights: [{ tier: 'niche', summary: 'Niche players post reels.', evidenceBrands: ['Niche A', 'Spec A'] }],
          differentiation: { nichePlaybook: [{ move: 'curation', evidenceBrands: ['Niche A', 'Invented Brand'] }], standOutFromMarketplaces: [] },
          partnerPlay: [{ idea: 'shop-in-shop reels', evidenceBrands: ['Don Quijote'] }],
        };
      },
    },
  });
  assert.deepEqual(order, ['Toys R Us Japan', 'Don Quijote', 'Niche A', 'Spec A', 'Mass A', 'Old Entry']);
  const dq = out.brands.find(b => b.name === 'Don Quijote');
  assert.equal(dq.relationship, 'partner');
  assert.equal(dq.tier, 'mass', 'profile tier wins over a stale record');
  assert.equal(out.brands.find(b => b.name === 'Old Entry').tier, 'unknown');
  assert.equal(out.brands.find(b => b.role === 'target').relationship, 'self');
  assert.ok(!strategyComps.includes('Don Quijote'));
  assert.ok(synthBrands.some(b => b.name === 'Don Quijote'), 'synthesis sees the partner for partnerPlay');
  const niche = out.tierInsights.find(t => t.tier === 'niche');
  assert.deepEqual(niche.evidenceBrands, ['Niche A'], 'Spec A had no data and is not cited');
  assert.equal(niche.evidenceStrength, 'thin');
  assert.match(niche.summary, /^Evidence is thin/);
  assert.deepEqual(out.differentiation.nichePlaybook[0].evidenceBrands, ['Niche A']);
  assert.deepEqual(out.partnerPlay[0].evidenceBrands, ['Don Quijote']);
  assert.equal(out.coverage.removedCitations, 2);
  assert.equal(out.analysisStatus.synthesis, 'ok');
  assert.ok(Array.isArray(read('social_intelligence.json').whiteSpaceOpportunities), 'existing fields still written');
  const prompt = social.buildTierSynthesisPrompt({ targetName: 'Toys R Us Japan', market: 'Japan', evidence: social.buildTierEvidence(out.brands), coverage: out.coverage });
  assert.match(prompt, /Don Quijote is Toys R Us Japan's PARTNER/);
  assert.match(prompt, /TIER niche \(THIN EVIDENCE/);
  assert.match(prompt, /No data \(do not cite\): Spec A/);
});

test('marketplace with no profile handle: no discovery, no scrape, every platform says no brand-level toy account', async () => {
  let calls = 0;
  const count = async () => { calls++; return []; };
  const out = await social.processBrand({
    slug: 'amz', name: 'Amazon.co.jp Toys', url: 'https://www.amazon.co.jp/toys/', role: 'competitor', market: 'Japan',
    structuredSocialLinks: ['https://www.instagram.com/amazonjp/'],
  }, { messages: { create: async () => { calls++; return { content: [] }; } } }, () => {}, {
    siteAccess: { accessFor: () => { calls++; return { mode: 'direct' }; }, fetchPage: count },
    detectPageImpl: count, scrapers: { instagram: count, tiktok: count, facebook: count },
  });
  assert.equal(calls, 0, 'no page access, no Claude guess, no scrape');
  assert.equal(out.noBrandAccount, true);
  assert.equal(out.tier, 'unknown');
  assert.equal(out.handle, null, 'the marketplace corporate sameAs link is ignored');
  for (const p of ['instagram', 'tiktok', 'facebook', 'x', 'youtube', 'line']) assert.equal(out.platformStatus[p].reason, social.NO_BRAND_ACCOUNT_REASON, p);
  assert.equal(out.platforms.instagram.reason, social.NO_BRAND_ACCOUNT_REASON);
  assert.equal(social.isMarketplacePlayer({ tier: 'specialty', url: 'https://www.amazon.co.jp/x' }), false, 'an explicit tier wins');
});

test('Toys R Us Japan: official footer handles outrank the profile and correct the wrong Facebook page', async () => {
  const { dataDir, read } = setup({ name: 'Toys R Us Japan', url: 'https://www.toysrus.co.jp/', market: 'Japan', social: { instagram: 'toysrus_jp', facebook: 'ToysRUsJapan' } });
  let seen = null;
  await social.runAudit({
    slug: 'depth-test', dataDir, anthropic: null, siteAccess: deniedAccess,
    processBrandImpl: async (b) => { seen = b; return { id: b.slug, name: b.name, role: b.role, handle: b.handle, facebookHandle: b.facebookHandle, tiktokHandle: b.tiktokHandle, xHandle: b.xHandle, youtubeHandle: b.youtubeHandle, lineId: b.lineId, handleSources: Object.fromEntries(b.officialPlatforms.map(p => [p, 'official'])), summary: { postCount: 0 }, platformStatus: {}, platforms: {} }; },
  });
  assert.equal(seen.facebookHandle, 'toysrusjp');
  assert.equal(seen.tiktokHandle, 'toysrus_japan');
  assert.equal(seen.xHandle, 'toysrus_jp');
  assert.equal(seen.lineId, '@toysrus_jp');
  assert.equal(seen.youtubeHandle, 'https://www.youtube.com/user/ToysrusJPN');
  assert.deepEqual(seen.officialPlatforms.sort(), ['facebook', 'instagram', 'line', 'tiktok', 'x', 'youtube']);
  const prof = read('profile.json');
  assert.equal(prof.social.facebook, 'toysrusjp');
  assert.equal(prof.social.tiktok, 'toysrus_japan');
  assert.match(prof.socialProvenance.facebook.source, /^official/);
});

test('coverage: which brands and platforms had data, what was skipped and why, and the social spend', () => {
  const blk = (n, extra = {}) => social.buildPlatformBlock({ handle: 'h', posts: Array.from({ length: n }, () => ({ likes: 1, comments: 0, timestamp: '2026-11-01T00:00:00Z', format: 'image' })), ...extra });
  const brands = [
    { name: 'T', role: 'target', platforms: { instagram: blk(3) }, platformStatus: {} },
    { name: 'S1', role: 'competitor', tier: 'specialty', relationship: 'competitor', platforms: { instagram: blk(2), tiktok: blk(0, { budgetSkipped: true, reason: 'Not scraped: cap' }) }, platformStatus: {} },
    { name: 'M1', role: 'competitor', tier: 'marketplace', noBrandAccount: true, platforms: {}, platformStatus: { instagram: { status: 'not-applicable', reason: social.NO_BRAND_ACCOUNT_REASON } } },
  ];
  const cov = social.buildCoverage(brands, { runId: 'r', capUsd: 15, spentUsd: 3.2, entries: [
    { label: 'social instagram @a', reservedUsd: 0.12, actualUsd: 0.07 },
    { label: 'social tiktok @b', reservedUsd: 0, actualUsd: 0, refused: true },
    { label: 'marketplace rakuten', reservedUsd: 1, actualUsd: 0.9 },
  ] });
  assert.equal(cov.brandsWithData, 2);
  assert.equal(cov.brandsTotal, 3);
  assert.deepEqual(cov.platforms.instagram.withData, ['T', 'S1']);
  assert.deepEqual(cov.platforms.tiktok.budgetSkipped, ['S1']);
  assert.equal(cov.byTier.specialty.evidence, 'thin');
  assert.deepEqual(cov.byTier.marketplace.withData, []);
  assert.equal(cov.brands[2].noBrandAccount, true);
  assert.equal(cov.brands[2].skipped.find(s => s.platform === 'instagram').reason, social.NO_BRAND_ACCOUNT_REASON);
  assert.deepEqual(cov.budget, { runId: 'r', capUsd: 15, runSpentUsd: 3.2, socialSpentUsd: 0.07, socialCalls: 1, socialRefused: 1 });
});

test('checkpoints are versioned: a v1 (5-post) checkpoint is never reused as v2', async () => {
  assert.equal(social.CHECKPOINT_STEP, 'social-v2');
  const { dataDir } = setup({ name: 'T', url: 'https://t.example/', social: { instagram: 't_ig' } });
  const brand = { slug: 'depth-test', name: 'T', role: 'target', handle: 't_ig' };
  checkpoint.put('depth-test', 'social', 'depth-test', { inputs: social.brandHandleInputs(brand), result: { id: 'depth-test', name: 'T', role: 'target', handle: 't_ig', recentPosts: [1, 2, 3, 4, 5] } }, { dataDir });
  let processed = 0;
  await social.runAudit({ slug: 'depth-test', dataDir, anthropic: null, siteAccess: deniedAccess, processBrandImpl: async (b) => { processed++; return { id: b.slug, name: b.name, role: b.role, summary: { postCount: 0 }, platformStatus: {}, platforms: {} }; } });
  assert.equal(processed, 1);
});

test('formats and helpers', () => {
  assert.equal(social.detectFormat({ productType: 'clips', type: 'Video' }, 'instagram'), 'reel');
  assert.equal(social.detectFormat({ type: 'Sidecar' }, 'instagram'), 'carousel');
  assert.equal(social.detectFormat({ type: 'Image' }, 'instagram'), 'image');
  assert.equal(social.detectFormat({ snippet: { liveBroadcastContent: 'live' } }, 'youtube'), 'live');
  assert.equal(social.detectFormat({ isSlideshow: true }, 'tiktok'), 'carousel');
  assert.equal(social.detectFormat({ text: 'hi' }, 'x'), 'text');
  assert.equal(social.detectFormat({ extendedEntities: { media: [{ type: 'video' }] } }, 'x'), 'video');
  assert.deepEqual(social.combineRuns([{ id: 'a', usageTotalUsd: 0.1 }, { id: 'b' }]), { id: 'a,b' }, 'unknown usage keeps the reservation');
  assert.deepEqual(social.toScrapeResult([1]), { posts: [1], followers: null, postsCount: null });
  assert.deepEqual(social.auditOrder([{ name: 'n', tier: 'niche' }, { name: 'p', relationship: 'partner', tier: 'niche' }, { name: 'm', tier: 'mass' }]).map(x => x.name), ['p', 'n', 'm']);
});

test('no em dashes in this test file or in social_audit.js', () => {
  for (const f of [__filename, path.join(__dirname, '../analysis/social_audit.js')]) assert.ok(!fs.readFileSync(f, 'utf8').includes(String.fromCharCode(0x2014)), f);
});
