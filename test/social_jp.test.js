// Offline tests for the Japan social audit additions (X, YouTube, LINE, sameAs discovery).
// Run: node --test test/social_jp.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const social = require('../analysis/social_audit.js');
// Requiring the module loads dotenv; force the no-key environment these tests assert on.
delete process.env.APIFY_API_TOKEN;
delete process.env.YOUTUBE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SOCIAL_DRY_RUN;

const FX = path.join(__dirname, 'fixtures', 'social');
const fx = name => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf8'));
// format (reel|carousel|video|image|live|text) was added with the 25-post depth work (2026-11-18).
const SHARED_POST_KEYS = ['likes', 'comments', 'caption', 'timestamp', 'postUrl', 'imageUrl', 'format'];
const ENGAGEMENT_KEYS = ['likes', 'comments', 'followers', 'friends', 'friendCount', 'views', 'posts', 'postCount', 'avgEngagement', 'engagementRate', 'summary', 'topPosts', 'monthlyTrend'];

// ── classifySocialLinks ──────────────────────────────────────────────────────

test('classifySocialLinks: x.com and twitter.com, trailing slash, query string', () => {
  assert.equal(social.classifySocialLinks(['https://x.com/ToysRUs_JP/']).x, 'ToysRUs_JP');
  assert.equal(social.classifySocialLinks(['https://twitter.com/toysrus_jp?ref_src=twsrc%5Etfw']).x, 'toysrus_jp');
  assert.equal(social.classifySocialLinks(['https://mobile.twitter.com/abc_def']).x, 'abc_def');
  assert.equal(social.classifySocialLinks(['https://twitter.com/intent/tweet?text=hi']).x, null);
  assert.equal(social.classifySocialLinks(['https://x.com/home']).x, null);
});

test('classifySocialLinks: YouTube @handle, /channel/, /c/, /user/, legacy vanity', () => {
  assert.deepEqual(social.classifySocialLinks(['https://www.youtube.com/@toysrusjp/']).youtube,
    { kind: 'handle', id: 'toysrusjp', url: 'https://www.youtube.com/@toysrusjp' });
  assert.deepEqual(social.classifySocialLinks(['https://youtube.com/channel/UCabcdefghijklmnopqrstuv?sub_confirmation=1']).youtube,
    { kind: 'channel', id: 'UCabcdefghijklmnopqrstuv', url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv' });
  assert.equal(social.classifySocialLinks(['https://www.youtube.com/c/ToysRUsJapan']).youtube.kind, 'custom');
  assert.equal(social.classifySocialLinks(['https://www.youtube.com/c/ToysRUsJapan']).youtube.id, 'ToysRUsJapan');
  assert.deepEqual(social.classifySocialLinks(['https://m.youtube.com/user/toysrusjapan/videos']).youtube,
    { kind: 'user', id: 'toysrusjapan', url: 'https://www.youtube.com/user/toysrusjapan' });
  assert.equal(social.classifySocialLinks(['https://www.youtube.com/toysrusjapan']).youtube.kind, 'custom');
  assert.equal(social.classifySocialLinks(['https://www.youtube.com/watch?v=abc']).youtube, null);
});

test('classifySocialLinks: LINE line.me/R/ti/p/@id, %40 encoding, page.line.me, lin.ee', () => {
  assert.deepEqual(social.classifySocialLinks(['https://line.me/R/ti/p/@toysrus?from=page']).line,
    { kind: 'oa', id: '@toysrus', url: 'https://line.me/R/ti/p/@toysrus' });
  assert.equal(social.classifySocialLinks(['https://line.me/R/ti/p/%40abc1234']).line.id, '@abc1234');
  assert.equal(social.classifySocialLinks(['https://line.me/ti/p/@abc1234/']).line.id, '@abc1234');
  assert.deepEqual(social.classifySocialLinks(['https://page.line.me/toysrus/']).line,
    { kind: 'oa', id: '@toysrus', url: 'https://page.line.me/toysrus' });
  assert.deepEqual(social.classifySocialLinks(['https://lin.ee/AbCdEf1?utm_source=site']).line,
    { kind: 'short', id: null, url: 'https://lin.ee/AbCdEf1' });
  assert.equal(social.classifySocialLinks(['https://line.me/R/ti/p/~personaluser']).line, null);
});

test('classifySocialLinks: existing platforms, unknowns, first match wins, junk tolerated', () => {
  const r = social.classifySocialLinks([
    'https://www.instagram.com/toysrus_jp/',
    'https://www.instagram.com/second/',
    'https://www.tiktok.com/@toysrus.jp?lang=ja',
    'https://www.facebook.com/ToysRUsJapan/',
    'https://ja.wikipedia.org/wiki/x',
    'https://www.instagram.com/p/ABC/',
    'not a url at all %%%',
    null,
    '',
  ]);
  assert.equal(r.instagram, 'toysrus_jp');
  assert.equal(r.tiktok, 'toysrus.jp');
  assert.equal(r.facebook, 'ToysRUsJapan');
  assert.ok(r.unknown.includes('https://ja.wikipedia.org/wiki/x'));
  assert.ok(r.unknown.includes('https://www.instagram.com/p/ABC/'));
  assert.equal(r.x, null);
  assert.deepEqual(social.classifySocialLinks(undefined), { instagram: null, tiktok: null, facebook: null, x: null, youtube: null, line: null, unknown: [] });
});

test('findStructuredSocialLinks matches by id, name, and host', () => {
  const si = fx('site_intelligence.json');
  assert.equal(social.findStructuredSocialLinks(si, { slug: 'toysrus-jp-test', name: 'x', role: 'target' }).length, 5);
  assert.equal(social.findStructuredSocialLinks(si, { slug: 'other', name: 'Kiddy Land Test', role: 'competitor' }).length, 2);
  assert.equal(social.findStructuredSocialLinks(si, { slug: 'other', name: 'Other', url: 'https://kiddyland.co.jp/', role: 'competitor' }).length, 2);
  assert.deepEqual(social.findStructuredSocialLinks(null, { slug: 'a' }), []);
});

// ── X ───────────────────────────────────────────────────────────────────────

test('X: missing APIFY_API_TOKEN returns empty plus reason, does not throw', async () => {
  const r = await social.scrapeXViaApify('toysrus_jp');
  assert.deepEqual(r.posts, []);
  assert.match(r.reason, /APIFY_API_TOKEN not set/);
});

test('X: fixture maps to the shared post shape, Japanese text untouched, retweets dropped', async () => {
  const r = await social.scrapeXViaApify('toysrus_jp_test', { fixture: path.join(FX, 'x_tweets.json') });
  assert.equal(r.posts.length, 2);
  assert.equal(r.followers, 250000);
  const norm = social.normalizePosts(r.posts, 'x');
  for (const p of norm) for (const k of SHARED_POST_KEYS) assert.ok(k in p, `missing ${k}`);
  assert.equal(norm[0].likes, 120);
  assert.equal(norm[0].comments, 8);
  assert.equal(norm[0].caption, '【新商品】クリスマスにぴったりのおもちゃが入荷しました！ #トイザらス #クリスマス');
  assert.equal(norm[0].timestamp, '2026-11-11T03:00:00.000Z');
  assert.equal(norm[0].imageUrl, 'https://pbs.twimg.com/media/test1.jpg');
  assert.equal(norm[0].shares, 32);
  const pd = social.buildPlatformData(norm);
  assert.equal(pd.summary.postCount, 2);
  assert.equal(pd.summary.avgEngagement, Math.round((120 + 8 + 45 + 3) / 2));
  assert.deepEqual(pd.monthlyTrend.map(m => m.month), ['2026-10', '2026-11']);
  assert.ok(pd.contentThemes.some(t => t.theme === 'Promotional'), 'Japanese promo keywords themed');
});

// ── YouTube ─────────────────────────────────────────────────────────────────

test('YouTube: missing YOUTUBE_API_KEY returns empty plus reason, does not throw', async () => {
  const r = await social.fetchYouTubeChannel({ kind: 'handle', id: 'toysrusjp' });
  assert.deepEqual(r.posts, []);
  assert.equal(r.channel, null);
  assert.match(r.reason, /YOUTUBE_API_KEY not set/);
});

test('YouTube: fixture maps channel stats and uploads to the shared post shape', async () => {
  const r = await social.fetchYouTubeChannel('https://www.youtube.com/@toysrusjptest', { fixture: path.join(FX, 'youtube_api.json') });
  assert.equal(r.reason, null);
  assert.equal(r.channel.subscriberCount, 48200);
  assert.equal(r.channel.title, 'トイザらス公式チャンネル');
  const norm = social.normalizePosts(r.posts, 'youtube');
  for (const p of norm) for (const k of SHARED_POST_KEYS) assert.ok(k in p, `missing ${k}`);
  assert.deepEqual(norm[0], {
    likes: 340, comments: 25, caption: '【開封動画】人気のブロックセットを組み立ててみた',
    timestamp: '2026-11-10T09:00:00Z', postUrl: 'https://www.youtube.com/watch?v=vidA',
    imageUrl: 'https://i.ytimg.com/vi/vidA/hqdefault.jpg', views: 12000, format: 'video',
  });
  assert.equal(norm[1].comments, 0, 'missing commentCount (comments disabled) becomes 0');
});

test('YouTube: /c/ custom URL resolves via search; API error becomes a reason without leaking the key', async () => {
  const r = await social.fetchYouTubeChannel({ kind: 'custom', id: 'ToysRUsJapan' }, { fixture: path.join(FX, 'youtube_api.json') });
  assert.equal(r.channel.id, 'UCtestchannel000000000001');
  const failing = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'quotaExceeded' } }) });
  const e = await social.fetchYouTubeChannel({ kind: 'handle', id: 'x' }, { apiKey: 'SECRET123', fetchImpl: failing });
  assert.match(e.reason, /HTTP 403: quotaExceeded/);
  assert.ok(!e.reason.includes('SECRET123'));
});

// ── LINE ────────────────────────────────────────────────────────────────────

function assertNoEngagement(rec) {
  for (const k of ENGAGEMENT_KEYS) assert.ok(!(k in rec), `LINE record must not carry ${k}`);
}

test('LINE: presence-only record from fixture has no engagement numbers', async () => {
  const rec = await social.checkLinePresence('https://line.me/R/ti/p/@uniqlo', { fixture: path.join(FX, 'line_found.json') });
  assert.equal(rec.presenceOnly, true);
  assert.equal(rec.platform, 'line');
  assert.equal(rec.exists, true);
  assert.equal(rec.accountId, '@uniqlo');
  assert.equal(rec.basicId, '@246qipts');
  assert.equal(rec.badge, null);
  assert.match(rec.note, /presence only/);
  assertNoEngagement(rec);
});

test('LINE: 404 page is recorded as not confirmed; dry run never fetches', async () => {
  const nf = await social.checkLinePresence('@linejapan', { fixture: path.join(FX, 'line_notfound.json') });
  assert.equal(nf.exists, false);
  assert.match(nf.reason, /404/);
  assertNoEngagement(nf);
  const dry = await social.checkLinePresence({ kind: 'short', id: null, url: 'https://lin.ee/AbCdEf1' }, {
    dryRun: true, fetchImpl: () => { throw new Error('network used in dry run'); },
  });
  assert.equal(dry.exists, null);
  assert.match(dry.reason, /Dry run/);
  const none = await social.checkLinePresence(null);
  assert.match(none.reason, /No LINE/);
});

// ── Existing platforms unchanged ────────────────────────────────────────────

test('existing platforms: normalizePosts shape is exactly the shared seven keys (six plus format)', () => {
  for (const [file, platform] of [['instagram_posts.json', 'instagram'], ['tiktok_posts.json', 'tiktok'], ['facebook_posts.json', 'facebook']]) {
    const norm = social.normalizePosts(fx(file), platform);
    assert.deepEqual(Object.keys(norm[0]).sort(), [...SHARED_POST_KEYS].sort(), platform);
  }
  const pd = social.buildPlatformData(social.normalizePosts(fx('tiktok_posts.json'), 'tiktok'));
  assert.deepEqual(Object.keys(pd).sort(), ['contentThemes', 'monthlyTrend', 'summary', 'topPosts']);
  assert.deepEqual(Object.keys(pd.summary).sort(), ['avgEngagement', 'postCount', 'postingFrequencyPerWeek']);
});

test('processBrand: all original output fields kept, new fields added, structured-data handles used first', async () => {
  const ORIGINAL_KEYS = ['id', 'name', 'role', 'handle', 'platform', 'scrapedAt', 'summary', 'contentThemes', 'topHashtags',
    'recentPosts', 'topPosts', 'monthlyTrend', 'postingPattern', 'engagementRate', 'tiktokHandle', 'tiktokData',
    'facebookHandle', 'facebookData', 'contentGaps', 'error', 'partialData'];
  const si = fx('site_intelligence.json');
  const brand = { slug: 'toysrus-jp-test', name: 'Toys R Us Japan', url: 'https://www.toysrus.co.jp/', role: 'target' };
  brand.structuredSocialLinks = social.findStructuredSocialLinks(si, brand);
  const out = await social.processBrand(brand, null, () => {}, {
    dryRun: true,
    fixtures: { x: path.join(FX, 'x_tweets.json'), youtube: path.join(FX, 'youtube_api.json'), line: path.join(FX, 'line_found.json') },
  });
  for (const k of ORIGINAL_KEYS) assert.ok(k in out, `original key ${k} missing`);
  assert.equal(out.platform, 'instagram');
  assert.equal(out.handle, 'toysrus_jp_test');
  assert.equal(out.handleSources.instagram, 'structured-data');
  assert.match(out.error, /APIFY_API_TOKEN not set/, 'IG without token degrades to an error string, no throw');
  assert.equal(out.xHandle, 'toysrus_jp_test');
  assert.equal(out.xData.summary.postCount, 2);
  assert.equal(out.platformStatus.x.status, 'ok');
  assert.equal(out.youtubeHandle, 'https://www.youtube.com/@toysrusjptest');
  assert.equal(out.youtubeData.summary.postCount, 2);
  assert.equal(out.youtubeChannel.subscriberCount, 48200);
  assert.equal(out.lineAccount.presenceOnly, true);
  assert.equal(out.platformStatus.line.status, 'presence-only');
  assert.equal(out.platformStatus.tiktok, undefined);
  assertNoEngagement(out.lineAccount);
});

test('processBrand: no keys and no fixtures still completes with reasons for every new platform', async () => {
  const brand = { slug: 'kiddy-land-test', name: 'Kiddy Land Test', url: 'https://www.kiddyland.co.jp', role: 'competitor',
    structuredSocialLinks: ['https://twitter.com/kiddyland_test', 'https://www.youtube.com/@kiddy', 'https://lin.ee/AbCdEf1'] };
  const out = await social.processBrand(brand, null, () => {}, { dryRun: true });
  assert.equal(out.xData, null);
  assert.match(out.platformStatus.x.reason, /Dry run/);
  assert.equal(out.youtubeData, null);
  assert.match(out.platformStatus.youtube.reason, /Dry run/);
  assert.equal(out.lineAccount.exists, null);
  assert.equal(out.lineId, 'https://lin.ee/AbCdEf1');
});

test('analysis prompt context states not applicable and presence-only; language rule present', () => {
  const ctx = social.buildPlatformCoverageContext([
    { name: 'A', role: 'target', summary: { postCount: 0 }, lineAccount: { accountId: '@a', exists: true } },
  ]);
  assert.match(ctx, /x=not applicable/);
  assert.match(ctx, /youtube=not applicable/);
  assert.match(ctx, /line=presence only/);
  assert.match(social.LANGUAGE_INSTRUCTION, /Answer in English/);
  assert.match(social.LANGUAGE_INSTRUCTION, /quote them exactly/);
});

test('truncateChars never splits a code point', () => {
  assert.equal(social.truncateChars('おもちゃ😀テスト', 5), 'おもちゃ😀');
});

test('no em dashes in this test file or the fixtures', () => {
  const EM = String.fromCharCode(0x2014);
  const files = [path.join(__dirname, 'social_jp.test.js'), ...fs.readdirSync(FX).map(f => path.join(FX, f))];
  for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes(EM), f);
});

// ── Round 2: handle trust, handle_not_found, engagement basis ───────────────

// Fake Claude client: answers the handle lookup with fixed guesses, no network.
function fakeClaude(handles) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(handles) }] }) } };
}

test('trust: a Claude-guessed X handle is recorded unverified and never scraped', async () => {
  let xCalled = false;
  const brand = { slug: 'guess-test', name: 'Guess Test', url: 'https://example.co.jp/', role: 'competitor', market: 'Japan' };
  const out = await social.processBrand(brand, fakeClaude({ x: 'guessed_handle' }), () => {}, {
    skipPageDetection: true,
    // If the scrape ran, this fixture would produce posts; it must not run.
    fixtures: { get x() { xCalled = true; return path.join(FX, 'x_tweets.json'); } },
  });
  assert.equal(xCalled, false, 'X fixture (stand-in for the paid scrape) was touched');
  assert.equal(out.xHandle, 'guessed_handle');
  assert.equal(out.handleSources.x, 'claude');
  assert.equal(out.xData, null);
  assert.equal(out.platformStatus.x.status, 'unverified_handle');
  assert.equal(out.platformStatus.x.verified, null);
  assert.equal(out.platformStatus.x.handleSource, 'claude');
  assert.match(out.platformStatus.x.reason, /suggested by Claude/);
  assert.match(social.buildPlatformCoverageContext([out]), /x=no data \(handle guessed_handle unverified, not scraped\)/);
  assert.equal(social.writebackBlocked(out, 'x', false), true);
});

test('trust: profile, structured-data and page-scan X handles are scraped and marked verified by source', async () => {
  for (const [field, val, src] of [['xHandle', 'from_profile', 'profile'], ['structuredSocialLinks', ['https://x.com/from_sd'], 'structured-data']]) {
    const brand = { slug: 't', name: 'T', url: 'https://example.co.jp/', role: 'competitor', [field]: val };
    const out = await social.processBrand(brand, null, () => {}, { dryRun: true, fixtures: { x: path.join(FX, 'x_tweets.json') } });
    assert.equal(out.platformStatus.x.status, 'ok', src);
    assert.equal(out.platformStatus.x.handleSource, src);
    assert.equal(out.platformStatus.x.verified, true);
    assert.equal(out.platformStatus.x.verifiedBy, src);
  }
});

test('trust: a Claude-guessed X handle that an earlier run scraped posts from counts as verified', async () => {
  const brand = { slug: 'p', name: 'P', url: 'https://example.co.jp/', role: 'target', market: 'Japan', priorVerified: { x: 'ToysRUs_jp' } };
  const out = await social.processBrand(brand, fakeClaude({ x: 'toysrus_JP' }), () => {}, {
    skipPageDetection: true, fixtures: { x: path.join(FX, 'x_tweets.json') },
  });
  assert.equal(out.platformStatus.x.status, 'ok');
  assert.equal(out.platformStatus.x.verified, true);
  assert.equal(out.platformStatus.x.verifiedBy, 'prior-scrape');
});

test('trust: Claude-guessed YouTube is verified only when it returned videos; guessed LINE that 404s is handle_not_found', async () => {
  const brand = { slug: 'y', name: 'Y', url: 'https://example.co.jp/', role: 'competitor', market: 'Japan' };
  const out = await social.processBrand(brand, fakeClaude({ youtube: '@toysrusjptest', line: '@linejapan' }), () => {}, {
    skipPageDetection: true,
    fixtures: { youtube: path.join(FX, 'youtube_api.json'), line: path.join(FX, 'line_notfound.json') },
  });
  assert.equal(out.handleSources.youtube, 'claude');
  assert.equal(out.platformStatus.youtube.verified, true);
  assert.equal(out.platformStatus.youtube.verifiedBy, 'scrape-returned-data');
  assert.equal(social.writebackBlocked(out, 'youtube'), false, 'a guess that returned videos may be saved');
  // A channel that exists under the guessed name but returned no videos is not verified and not saved.
  const yt = JSON.parse(fs.readFileSync(path.join(FX, 'youtube_api.json'), 'utf8'));
  const noVideos = await social.processBrand(brand, fakeClaude({ youtube: '@toysrusjptest' }), () => {}, {
    skipPageDetection: true, fixtures: { youtube: { channels: yt.channels, playlistItems: { items: [] } } },
  });
  assert.equal(noVideos.platformStatus.youtube.status, 'channel-only');
  assert.equal(noVideos.platformStatus.youtube.verified, null);
  assert.equal(social.writebackBlocked(noVideos, 'youtube'), true);
  assert.equal(out.platformStatus.line.status, 'handle_not_found');
  assert.equal(out.platformStatus.line.verified, false);
  assert.equal(social.writebackBlocked(out, 'line', false), true);

  const missing = await social.processBrand(brand, fakeClaude({ youtube: '@nochannel' }), () => {}, {
    skipPageDetection: true, fixtures: { youtube: { channels: { items: [] } } },
  });
  assert.equal(missing.platformStatus.youtube.status, 'handle_not_found');
  assert.equal(missing.platformStatus.youtube.verified, false);
});

test('handle_not_found: Apify C017 log marker gives a clean status, no data, no write-back', async () => {
  const r = await social.scrapeXViaApify('kiddyland_jp', { fixture: path.join(FX, 'x_notfound.json') });
  assert.equal(r.notFound, true);
  assert.equal(r.posts.length, 0);
  assert.match(r.reason, /not found/);
  assert.equal(social.isXHandleNotFound([], 'ERROR C017. User: kiddyland_jp not found', 'kiddyland_jp'), true);
  assert.equal(social.isXHandleNotFound([{ error: 'User: someone_else not found' }], '', 'kiddyland_jp'), false);
  assert.equal(social.isXHandleNotFound([], '', 'kiddyland_jp'), false, 'an empty run alone is not proof');

  let calls = 0;
  const brand = { slug: 'k', name: 'K', url: 'https://example.co.jp/', role: 'competitor', xHandle: 'kiddyland_jp' };
  const out = await social.processBrand(brand, null, () => {}, {
    dryRun: true, fixtures: { get x() { calls++; return path.join(FX, 'x_notfound.json'); } },
  });
  assert.equal(calls, 1, 'exactly one run, no retry');
  assert.equal(out.platformStatus.x.status, 'handle_not_found');
  assert.equal(out.platformStatus.x.verified, false);
  assert.equal(out.xData, null);
  assert.equal(social.writebackBlocked(out, 'x', false), true);
  assert.match(social.buildPlatformCoverageContext([out]), /x=no data \(handle kiddyland_jp does not exist\)/);
});

test('engagement: followers basis when followers known, per-post basis otherwise, shares counted for X', () => {
  const posts = [{ likes: 10, comments: 2, shares: 3 }, { likes: 4, comments: 0, shares: 1 }];
  const f = social.computeEngagement(posts, 1000);
  assert.equal(f.basis, 'followers');
  assert.equal(f.counts, 'likes+comments+shares');
  assert.equal(f.avgEngagementPerPost, 10);
  assert.equal(f.rate, 1);
  const p = social.computeEngagement([{ likes: 10, comments: 2 }, { likes: 4, comments: 0 }], null);
  assert.equal(p.basis, 'per-post');
  assert.equal(p.rate, null, 'rate is only ever a percent of followers');
  assert.equal(p.avgEngagementPerPost, 8);
  const brandPerPost = social.pickBrandEngagement({ instagram: p });
  assert.equal(brandPerPost.engagementRate, null);
  assert.equal(brandPerPost.avgEngagementPerPost, 8);
  assert.deepEqual(brandPerPost.engagementBasis.available, ['avgEngagementPerPost']);
  const brandF = social.pickBrandEngagement({ instagram: p, x: f });
  assert.equal(brandF.engagementRate, 1);
  assert.equal(brandF.avgEngagementPerPost, 10);
  assert.equal(brandF.engagementBasis.platform, 'x');
  assert.deepEqual(brandF.engagementBasis.available, ['engagementRate', 'avgEngagementPerPost']);
  assert.match(p.unit, /followers unknown/);
  assert.equal(social.computeEngagement([], 1000), null);
});

test('engagement: processBrand fills engagementRate when posts exist (X fixture with author followers)', async () => {
  const brand = { slug: 'e', name: 'E', url: 'https://example.co.jp/', role: 'competitor', xHandle: 'toysrus_jp_test' };
  const out = await social.processBrand(brand, null, () => {}, { dryRun: true, fixtures: { x: path.join(FX, 'x_tweets.json'), youtube: path.join(FX, 'youtube_api.json') }, });
  assert.notEqual(out.avgEngagementPerPost, null);
  assert.ok(out.engagementBasis.platform);
  if (out.engagementBasis.basis === 'followers') assert.equal(typeof out.engagementRate, 'number');
  else assert.equal(out.engagementRate, null);
  assert.ok(out.engagementByPlatform.x);
});

test('engagement: real run-1 output (fixture copy) gets a value for every brand with posts, a rate where followers are known', () => {
  const run1 = fx('run1_social_intelligence.json');
  const withPosts = run1.brands.filter(b => (b.summary?.postCount || 0) > 0 || b.xData || b.youtubeData || b.tiktokData || b.facebookData);
  assert.ok(withPosts.length >= 8, `brands with posts: ${withPosts.length}`);
  assert.ok(run1.brands.every(b => b.engagementRate == null), 'run 1 had null everywhere (the bug)');
  for (const b of withPosts) {
    const picked = social.pickBrandEngagement(social.deriveEngagement(b));
    assert.notEqual(picked.avgEngagementPerPost, null, b.name);
    assert.ok(picked.engagementBasis.unit, b.name);
    const followersKnown = !!(b.xData?.followers || b.youtubeChannel?.subscriberCount);
    assert.equal(picked.engagementRate != null, followersKnown, b.name);
  }
  const tru = run1.brands.find(b => b.role === 'target');
  const t = social.pickBrandEngagement(social.deriveEngagement(tru));
  // Instagram has no follower count in run 1, so the follower-based X rate is preferred.
  assert.equal(t.engagementBasis.platform, 'x');
  assert.equal(t.engagementBasis.basis, 'followers');
  assert.equal(t.engagementRate, Math.round((tru.xData.summary.avgEngagement / tru.xData.followers) * 100 * 1000) / 1000);
  assert.equal(social.deriveEngagement(tru).instagram.basis, 'per-post');
  assert.equal(social.deriveEngagement(tru).instagram.rate, null);
  assert.equal(social.deriveEngagement(tru).instagram.avgEngagementPerPost, tru.summary.avgEngagement);
  // Real normalized X posts kept in the file: computeEngagement includes shares.
  const real = social.computeEngagement(tru.xData.topPosts, tru.xData.followers);
  assert.equal(real.counts, 'likes+comments+shares');
  assert.equal(real.basis, 'followers');
});

// ── Round 3: non-Japan stays legacy, guesses gated by data ──────────────────

test('non-Japan: X, YouTube and LINE are off whatever the source (profile, sameAs, page scan, Claude)', async () => {
  let scanned = false;
  // IG/TikTok/Facebook supplied so the legacy page detectors never launch a browser in this test.
  const brand = { slug: 'lb', name: 'Beirut Toys', url: 'https://beiruttoys.example.com/', role: 'competitor', market: 'Lebanon',
    handle: 'lb_ig', tiktokHandle: 'lb_tt', facebookHandle: 'lbfb',
    xHandle: 'profile_x', youtubeHandle: '@profileyt', lineId: '@profileline',
    structuredSocialLinks: ['https://twitter.com/official_lb', 'https://www.youtube.com/@lbchannel', 'https://line.me/R/ti/p/@lbline'] };
  const touched = [];
  const out = await social.processBrand(brand, fakeClaude({ x: 'guess_x', youtube: '@guessyt', line: '@guessline' }), () => {}, {
    detectPageImpl: async () => { scanned = true; return social.classifySocialLinks(['https://x.com/scanned_x']); },
    scrapers: { instagram: async () => [], tiktok: async () => [], facebook: async () => [] },
    fixtures: { get x() { touched.push('x'); return null; }, get youtube() { touched.push('youtube'); return null; }, get line() { touched.push('line'); return null; } },
  });
  assert.equal(scanned, false, 'no X/YouTube/LINE page scan for non-Japan');
  assert.deepEqual(touched, [], 'no X scrape, YouTube fetch or LINE check');
  assert.equal(out.xHandle, null);
  assert.equal(out.youtubeHandle, null);
  assert.equal(out.lineId, null);
  for (const p of ['x', 'youtube', 'line']) {
    assert.equal(out.platformStatus[p].status, 'not-applicable', p);
    assert.equal(out.platformStatus[p].reason, 'not enabled for this market', p);
    assert.equal(out.handleSources[p], undefined, p);
  }
  assert.equal(out.platformStatus.x.ignoredHandle, 'profile_x');
});

test('non-Japan: Claude handle lookup prompt is byte-identical to the legacy prompt', () => {
  const legacy = `What are the official social media handles for this brand?

Brand: Beirut Toys
Website: https://beiruttoys.example.com/
Market: Lebanon

Return ONLY a JSON object (no explanation):
{"instagram": "handle_without_@_or_null", "tiktok": "handle_without_@_or_null", "facebook": "page_name_or_null"}

Only include handles you are highly confident are correct. Use null if unsure. Do not include @ symbols.`;
  assert.equal(social.buildHandleLookupPrompt('Beirut Toys', 'https://beiruttoys.example.com/', 'Lebanon', false), legacy);
  assert.equal(social.buildHandleLookupPrompt('Beirut Toys', 'https://beiruttoys.example.com/', undefined, false), legacy);
  assert.match(social.buildHandleLookupPrompt('Kiddy', 'https://k.co.jp/', 'Japan', true), /"line"/);
});

test('write-back gate: a Claude guess is saved only when its scrape returned data this run', () => {
  const base = { handleSources: { instagram: 'claude', tiktok: 'claude' }, summary: { postCount: 0 }, platformStatus: {} };
  assert.equal(social.writebackBlocked(base, 'instagram'), true, 'no data');
  assert.equal(social.writebackBlocked({ ...base, platformStatus: { tiktok: { status: 'error' } } }, 'tiktok'), true, 'errored');
  assert.equal(social.writebackBlocked({ ...base, summary: { postCount: 5 } }, 'instagram'), false, 'data');
  assert.equal(social.writebackBlocked({ ...base, summary: { postCount: 5 }, platformStatus: { instagram: { stale: true } } }, 'instagram'), true, 'carried-forward data is not evidence');
  assert.equal(social.writebackBlocked({ handleSources: { instagram: 'page-scan' }, summary: { postCount: 0 } }, 'instagram'), false, 'trusted source');
});
