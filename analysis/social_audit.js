/**
 * Social Audit — scrapes Instagram, TikTok, and Facebook (via Apify, with
 * Playwright fallback for Instagram) for the target brand and competitors.
 * Generates 12-month trend data and content gap analysis via Claude.
 *
 * Usage: node analysis/social_audit.js --slug=<brand-slug>
 */

require('dotenv').config();
const { chromium } = require('playwright');
const { ApifyClient } = require('apify-client');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

function log(msg) { console.log(`[social_audit] [${new Date().toISOString()}] ${msg}`); }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function loadBrandData(slug, filename) {
  const fp = path.join(DATA_DIR, 'brands', slug, filename);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function saveBrandData(slug, filename, data) {
  ensureDir(path.join(DATA_DIR, 'brands', slug));
  fs.writeFileSync(path.join(DATA_DIR, 'brands', slug, filename), JSON.stringify(data, null, 2));
}

function archiveData(slug, module, data) {
  const histDir = path.join(DATA_DIR, 'brands', slug, 'history');
  ensureDir(histDir);
  const ts = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(histDir, `${module}_${ts}.json`), JSON.stringify(data, null, 2));
}

// ─── Handle Detection ─────────────────────────────────────────────────────────

async function detectInstagramHandle(brandUrl) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(brandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const links = await page.$$eval('a[href*="instagram.com"]', anchors => anchors.map(a => a.href));
    if (links.length > 0) {
      const match = links[0].match(/instagram\.com\/([^/?#\s]+)/);
      if (match && match[1] !== 'p' && match[1] !== 'explore') return match[1];
    }
    const html = await page.content();
    const igMatches = [...html.matchAll(/instagram\.com\/([a-zA-Z0-9_.]{2,30})[^a-zA-Z0-9_.]/g)];
    const filtered = igMatches
      .map(m => m[1])
      .filter(h => !['p', 'explore', 'accounts', 'stories', 'reel', 'tv', 'share', 'sharedAction', 'oauth'].includes(h));
    if (filtered.length > 0) return filtered[0];
    const origin = new URL(brandUrl).origin;
    for (const subpath of ['/about', '/contact', '/about-us']) {
      try {
        await page.goto(origin + subpath, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const aboutLinks = await page.$$eval('a[href*="instagram.com"]', anchors => anchors.map(a => a.href)).catch(() => []);
        if (aboutLinks.length > 0) {
          const match = aboutLinks[0].match(/instagram\.com\/([^/?#\s]+)/);
          if (match && !['p', 'explore', 'accounts'].includes(match[1])) return match[1];
        }
      } catch { /* page doesn't exist, skip */ }
    }
    return null;
  } catch { return null; }
  finally { await browser.close(); }
}

async function detectTikTokHandle(brandUrl) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(brandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const links = await page.$$eval('a[href*="tiktok.com"]', anchors => anchors.map(a => a.href)).catch(() => []);
    for (const link of links) {
      const match = link.match(/tiktok\.com\/@([a-zA-Z0-9_.]{2,30})/);
      if (match) return match[1];
    }
    const html = await page.content();
    const m = html.match(/tiktok\.com\/@([a-zA-Z0-9_.]{2,30})/);
    if (m) return m[1];
    return null;
  } catch { return null; }
  finally { await browser.close(); }
}

async function detectFacebookHandle(brandUrl) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(brandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const links = await page.$$eval('a[href*="facebook.com"]', anchors => anchors.map(a => a.href)).catch(() => []);
    const blocked = ['sharer', 'share', 'dialog', 'plugins', 'tr', 'login', 'policy', 'help', 'groups', 'events', 'photo', 'video'];
    for (const link of links) {
      const match = link.match(/facebook\.com\/([a-zA-Z0-9.]+)(?:[/?#]|$)/);
      if (match && !blocked.includes(match[1]) && match[1].length >= 3) return match[1];
    }
    const html = await page.content();
    const m = html.match(/facebook\.com\/([a-zA-Z0-9.]{3,50})(?:[/?#"'])/);
    if (m && !blocked.includes(m[1])) return m[1];
    return null;
  } catch { return null; }
  finally { await browser.close(); }
}

// ─── Claude-Based Handle Lookup (fallback when Playwright finds nothing) ─────

async function lookupHandlesViaClaude(anthropic, brandName, brandUrl, market) {
  if (!anthropic) return {};
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `What are the official social media handles for this brand?

Brand: ${brandName}
Website: ${brandUrl}
Market: ${market || 'Lebanon'}

Return ONLY a JSON object (no explanation):
{"instagram": "handle_without_@_or_null", "tiktok": "handle_without_@_or_null", "facebook": "page_name_or_null"}

Only include handles you are highly confident are correct. Use null if unsure. Do not include @ symbols.`,
      }],
    });
    const raw = msg.content[0].text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      log(`  Claude handle lookup for ${brandName}: IG=${parsed.instagram || 'null'}, TT=${parsed.tiktok || 'null'}, FB=${parsed.facebook || 'null'}`);
      return parsed;
    }
  } catch (err) { log(`  Claude handle lookup failed for ${brandName}: ${err.message}`); }
  return {};
}

// ─── Platform Scrapers ────────────────────────────────────────────────────────

async function scrapeInstagramViaApify(handle) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Scraping Instagram @${handle} via Apify...`);
  const run = await client.actor('apify/instagram-scraper').call({
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: 'posts',
    resultsLimit: 50,
  });
  log(`  Apify run status: ${run.status}, datasetId: ${run.defaultDatasetId}`);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 50 });
  log(`  Apify returned ${items.length} items`);
  const posts = items.filter(item =>
    item.type === 'Image' || item.type === 'Video' || item.type === 'Sidecar' ||
    item.shortCode || item.timestamp || item.taken_at_timestamp
  );
  log(`  ${posts.length} valid Instagram posts after filtering`);
  return posts;
}

async function scrapeInstagramProfileViaApify(handle) {
  if (!process.env.APIFY_API_TOKEN) return null;
  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Trying profile-scraper fallback for @${handle}...`);
  try {
    const run = await client.actor('apify/instagram-profile-scraper').call({ usernames: [handle] });
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 1 });
    return items[0] || null;
  } catch (err) {
    log(`  Profile scraper also failed: ${err.message}`);
    return null;
  }
}

async function scrapeInstagramFallback(handle) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const bio = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
    const title = await page.title().catch(() => '');
    const postCountMatch = bio.match(/([\d,]+)\s+posts?/i) || title.match(/([\d,]+)\s+posts?/i);
    const followerMatch = bio.match(/([\d,.KMk]+)\s+followers?/i);
    return {
      partialData: true,
      bio,
      estimatedPostCount: postCountMatch ? parseInt(postCountMatch[1].replace(/,/g, '')) : null,
      estimatedFollowers: followerMatch ? followerMatch[1] : null,
    };
  } catch (err) {
    return { error: err.message, partialData: true };
  } finally {
    await browser.close();
  }
}

async function scrapeTikTokViaApify(handle) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Scraping TikTok @${handle} via Apify...`);
  const run = await client.actor('clockworks/tiktok-scraper').call({
    type: 'user',
    usernames: [handle],
    resultsLimit: 30,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 30 });
  const posts = items.filter(item => item.diggCount !== undefined || item.text || item.createTime);
  log(`  ${posts.length} TikTok posts for @${handle}`);
  return posts;
}

async function scrapeFacebookViaApify(handle) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Scraping Facebook /${handle} via Apify...`);
  const run = await client.actor('apify/facebook-pages-scraper').call({
    startUrls: [{ url: `https://www.facebook.com/${handle}` }],
    maxPosts: 30,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 50 });
  // Filter to actual post items (not page info entries)
  const posts = items.filter(item => item.message || item.text || item.story || item.postId || item.url);
  log(`  ${posts.length} Facebook posts for /${handle}`);
  return posts;
}

// ─── Analytics Helpers ────────────────────────────────────────────────────────

function buildMonthlyTrend(normalizedPosts) {
  const monthMap = {};
  normalizedPosts.forEach(post => {
    const date = new Date(post.timestamp);
    if (isNaN(date)) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap[key]) monthMap[key] = { month: key, totalLikes: 0, totalComments: 0, postCount: 0 };
    monthMap[key].totalLikes += post.likes || 0;
    monthMap[key].totalComments += post.comments || 0;
    monthMap[key].postCount++;
  });
  return Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map(m => ({
      month: m.month,
      avgEngagement: m.postCount > 0 ? Math.round((m.totalLikes + m.totalComments) / m.postCount) : 0,
      postCount: m.postCount,
    }));
}

function extractContentThemes(normalizedPosts) {
  const themeKeywords = {
    'Product Showcase': ['new', 'collection', 'available', 'shop', 'now'],
    'Lifestyle': ['lifestyle', 'mood', 'vibe', 'inspiration', 'everyday'],
    'User Generated': ['regram', 'repost', 'customer', 'community', 'wearing'],
    'Promotional': ['sale', 'off', '% off', 'discount', 'deal', 'save'],
    'Behind the Scenes': ['bts', 'behind', 'team', 'making', 'process'],
    'Seasonal': ['fall', 'winter', 'spring', 'summer', 'holiday', 'season'],
    'Brand Story': ['since', 'founded', 'heritage', 'legacy', 'brand'],
  };
  const counts = {};
  normalizedPosts.forEach(post => {
    const text = (post.caption || '').toLowerCase();
    Object.entries(themeKeywords).forEach(([theme, keywords]) => {
      if (keywords.some(k => text.includes(k))) counts[theme] = (counts[theme] || 0) + 1;
    });
  });
  return Object.entries(counts).map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count);
}

function buildPostingPattern(normalizedPosts) {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const dayBreakdown = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
  normalizedPosts.forEach(post => {
    if (!post.timestamp) return;
    const d = new Date(post.timestamp);
    if (isNaN(d)) return;
    dayBreakdown[dayNames[d.getDay()]]++;
  });
  const best = Object.entries(dayBreakdown).sort((a, b) => b[1] - a[1])[0];
  return { bestDay: best && best[1] > 0 ? DAY_LABELS[best[0]] : null, dayBreakdown };
}

// Normalize raw posts from any platform to a consistent shape
function normalizePosts(rawPosts, platform) {
  return rawPosts.map(p => {
    if (platform === 'tiktok') {
      return {
        likes: p.diggCount || 0,
        comments: p.commentCount || 0,
        caption: (p.text || '').slice(0, 200),
        timestamp: p.createTime ? new Date(p.createTime * 1000).toISOString() : null,
        postUrl: p.webVideoUrl || null,
        imageUrl: p.covers && p.covers[0] ? p.covers[0] : null,
      };
    }
    if (platform === 'facebook') {
      const likes = typeof p.likes === 'number' ? p.likes
        : (p.likes && typeof p.likes === 'object' ? p.likes.summary?.total_count || 0 : 0);
      const comments = typeof p.comments === 'number' ? p.comments
        : (p.comments && typeof p.comments === 'object' ? p.comments.summary?.total_count || 0 : 0);
      return {
        likes,
        comments,
        caption: (p.message || p.text || p.story || '').slice(0, 200),
        timestamp: p.time || p.created_time || null,
        postUrl: p.url || p.postUrl || null,
        imageUrl: p.media && p.media[0] ? p.media[0].image?.src || null : null,
      };
    }
    // Instagram (default)
    return {
      likes: p.likesCount || p.edge_media_preview_like?.count || 0,
      comments: p.commentsCount || p.edge_media_to_comment?.count || 0,
      caption: (p.caption || p.caption?.text || '').slice(0, 200),
      timestamp: p.timestamp || (p.taken_at_timestamp ? new Date(p.taken_at_timestamp * 1000).toISOString() : null),
      postUrl: p.shortCode ? `https://instagram.com/p/${p.shortCode}` : null,
      imageUrl: p.displayUrl || null,
    };
  });
}

// Build a platform data object from normalized posts (for tiktokData / facebookData fields)
function buildPlatformData(normalizedPosts) {
  if (!normalizedPosts || normalizedPosts.length === 0) return null;
  const totalLikes = normalizedPosts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalComments = normalizedPosts.reduce((s, p) => s + (p.comments || 0), 0);
  const avgEngagement = Math.round((totalLikes + totalComments) / normalizedPosts.length);
  const now = Date.now();
  const last30 = normalizedPosts.filter(p => p.timestamp && (now - new Date(p.timestamp)) < 30 * 24 * 3600 * 1000);
  const topPosts = [...normalizedPosts]
    .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
    .slice(0, 3);
  return {
    summary: { postCount: normalizedPosts.length, avgEngagement, postingFrequencyPerWeek: Math.round((last30.length / 4.3) * 10) / 10 },
    topPosts,
    contentThemes: extractContentThemes(normalizedPosts),
    monthlyTrend: buildMonthlyTrend(normalizedPosts),
  };
}

// ─── Content Gap Analysis (Claude) ───────────────────────────────────────────

async function generateContentGapAnalysis(anthropic, targetBrand, targetData, competitorBrandsData) {
  const targetThemes = (targetData.contentThemes || []).map(t => t.theme).slice(0, 5);

  // Build top post context from competitors for richer prompt
  const competitorContext = competitorBrandsData
    .filter(b => b.topPosts && b.topPosts.length > 0)
    .map(b => {
      const posts = b.topPosts.slice(0, 2).map(p => `  "${p.caption.slice(0, 80)}" (${p.likes + p.comments} engagements)`).join('\n');
      return `${b.name} top posts:\n${posts}`;
    })
    .join('\n\n');

  const competitorThemes = competitorBrandsData.flatMap(b => (b.contentThemes || []).map(t => t.theme));
  const uniqueCompThemes = [...new Set(competitorThemes)];
  const gaps = uniqueCompThemes.filter(t => !targetThemes.includes(t));

  if (!process.env.ANTHROPIC_API_KEY) {
    return gaps.slice(0, 5).map(g => `Consider adding ${g} content to close gap vs competitors`);
  }

  const prompt = `You are a social media strategist analyzing content opportunities for ${targetBrand} on Instagram, TikTok, and Facebook.

TARGET BRAND (${targetBrand}):
- Content themes: ${targetThemes.join(', ') || 'unknown'}
- Posting frequency: ${targetData.summary?.postingFrequencyPerWeek || 0} posts/week
- Avg engagement: ${targetData.summary?.avgEngagement || 0}

COMPETITOR THEMES NOT USED BY TARGET: ${gaps.join(', ') || 'none identified'}

${competitorContext ? `COMPETITOR TOP POSTS (what's working for them):\n${competitorContext}` : ''}

Identify the 4-5 most impactful content opportunities. Return ONLY a JSON array:
[{ "headline": "short action title", "detail": "plain English explanation of why this matters and how to do it", "competitor": "competitor name who does this well or null", "platform": "instagram|tiktok|facebook|all", "contentFormat": "Reels|Carousel|Story|Video|Post" }]`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0].text;
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') return parsed;
    }
  } catch (err) { log(`  Content gap analysis error: ${err.message}`); }
  // Fallback: plain strings for backward compat
  return gaps.slice(0, 5).map(g => `Add ${g} content to close gap vs competitors`);
}

// ─── Brand Processing ─────────────────────────────────────────────────────────

async function processBrand(brandInfo, anthropic) {
  const { slug, name, url, role, handle: existingIgHandle, tiktokHandle: existingTtHandle, facebookHandle: existingFbHandle, market } = brandInfo;

  log(`Processing ${name} (${role})`);
  const brandData = {
    id: slug || name.toLowerCase().replace(/\s+/g, '-'),
    name,
    role,
    handle: existingIgHandle || null,
    platform: 'instagram',
    scrapedAt: new Date().toISOString(),
    summary: { postCount: 0, avgEngagement: 0, followersEstimate: null, postingFrequencyPerWeek: 0 },
    contentThemes: [],
    topHashtags: [],
    recentPosts: [],
    topPosts: [],
    monthlyTrend: [],
    postingPattern: null,
    engagementRate: null,
    tiktokHandle: existingTtHandle || null,
    tiktokData: null,
    facebookHandle: existingFbHandle || null,
    facebookData: null,
    contentGaps: [],
    error: null,
    partialData: false,
  };

  // ── Handle Discovery: Playwright → Claude fallback ─────────────────────────
  // Detect all three platforms at once if any are missing
  const needsDetection = (!existingIgHandle || !existingTtHandle || !existingFbHandle) && url;
  let claudeHandles = {};
  if (needsDetection) {
    log(`  Detecting missing handles for ${name}...`);
    // Playwright passes first
    const [igDetected, ttDetected, fbDetected] = await Promise.all([
      existingIgHandle ? Promise.resolve(null) : detectInstagramHandle(url).catch(() => null),
      existingTtHandle ? Promise.resolve(null) : detectTikTokHandle(url).catch(() => null),
      existingFbHandle ? Promise.resolve(null) : detectFacebookHandle(url).catch(() => null),
    ]);
    if (!existingIgHandle && igDetected) brandData.handle = igDetected;
    if (!existingTtHandle && ttDetected) brandData.tiktokHandle = ttDetected;
    if (!existingFbHandle && fbDetected) brandData.facebookHandle = fbDetected;

    // Claude fallback for anything still missing
    const stillMissingAny = (!brandData.handle && !existingIgHandle) || (!brandData.tiktokHandle && !existingTtHandle) || (!brandData.facebookHandle && !existingFbHandle);
    if (stillMissingAny && anthropic) {
      claudeHandles = await lookupHandlesViaClaude(anthropic, name, url, market).catch(() => ({}));
      if (!brandData.handle && !existingIgHandle && claudeHandles.instagram) brandData.handle = claudeHandles.instagram;
      if (!brandData.tiktokHandle && !existingTtHandle && claudeHandles.tiktok) brandData.tiktokHandle = claudeHandles.tiktok;
      if (!brandData.facebookHandle && !existingFbHandle && claudeHandles.facebook) brandData.facebookHandle = claudeHandles.facebook;
    }
  }

  // ── Instagram ──────────────────────────────────────────────────────────────
  const igHandle = existingIgHandle || brandData.handle;
  log(`  Instagram: ${igHandle ? '@' + igHandle : 'not found'}`);

  let igPosts = [];
  if (igHandle) {
    try {
      igPosts = await scrapeInstagramViaApify(igHandle);
      log(`  ${name}: ${igPosts.length} posts via Apify`);
    } catch (err) {
      log(`  Apify failed for ${name}: ${err.message}. Trying Playwright fallback...`);
      const fallback = await scrapeInstagramFallback(igHandle).catch(e => ({ error: e.message, partialData: true }));
      brandData.partialData = true;
      if (fallback.error) { brandData.error = `Apify: ${err.message} | Playwright: ${fallback.error}`; }
      else {
        brandData.summary.estimatedPostCount = fallback.estimatedPostCount;
        brandData.summary.followersEstimate = fallback.estimatedFollowers;
      }
    }

    if (igPosts.length === 0 && !brandData.partialData) {
      log(`  No posts returned — trying profile-scraper fallback for @${igHandle}`);
      const profile = await scrapeInstagramProfileViaApify(igHandle);
      if (profile) {
        brandData.summary.followersEstimate = profile.followersCount || profile.followers || null;
        brandData.summary.estimatedPostCount = profile.postsCount || profile.mediaCount || null;
        brandData.error = 'Post data unavailable (account may be private or scraper blocked) — profile stats only';
      } else {
        brandData.error = 'No posts returned from Apify — account may be private, new, or inactive';
      }
      brandData.partialData = true;
    }
  } else {
    brandData.error = 'Could not detect Instagram handle';
    brandData.partialData = true;
  }

  if (igPosts.length > 0) {
    const normalized = normalizePosts(igPosts, 'instagram');
    const totalLikes = normalized.reduce((s, p) => s + p.likes, 0);
    const totalComments = normalized.reduce((s, p) => s + p.comments, 0);
    brandData.summary.postCount = normalized.length;
    brandData.summary.avgEngagement = Math.round((totalLikes + totalComments) / normalized.length);
    const now = Date.now();
    const last30 = normalized.filter(p => p.timestamp && (now - new Date(p.timestamp)) < 30 * 24 * 3600 * 1000);
    brandData.summary.postingFrequencyPerWeek = Math.round((last30.length / 4.3) * 10) / 10;
    brandData.monthlyTrend = buildMonthlyTrend(normalized);
    brandData.contentThemes = extractContentThemes(normalized);
    brandData.postingPattern = buildPostingPattern(normalized);
    if (brandData.summary.followersEstimate && typeof brandData.summary.followersEstimate === 'number' && brandData.summary.avgEngagement > 0) {
      brandData.engagementRate = Math.round((brandData.summary.avgEngagement / brandData.summary.followersEstimate) * 1000) / 10;
    }
    const hashtagCounts = {};
    igPosts.forEach(p => {
      const text = p.caption || '';
      const tags = text.match(/#\w+/g) || [];
      tags.forEach(t => { hashtagCounts[t] = (hashtagCounts[t] || 0) + 1; });
    });
    brandData.topHashtags = Object.entries(hashtagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count }));
    brandData.recentPosts = normalized.slice(0, 5);
    brandData.topPosts = [...normalized].sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments)).slice(0, 3);
    log(`  ${name}: topPosts=${brandData.topPosts.length}, bestDay=${brandData.postingPattern?.bestDay || 'none'}`);
  }

  // ── TikTok ────────────────────────────────────────────────────────────────
  const ttHandle = existingTtHandle || brandData.tiktokHandle;
  log(`  TikTok: ${ttHandle ? '@' + ttHandle : 'not found'}`);
  if (ttHandle) {
    try {
      const ttPosts = await scrapeTikTokViaApify(ttHandle);
      if (ttPosts.length > 0) brandData.tiktokData = buildPlatformData(normalizePosts(ttPosts, 'tiktok'));
    } catch (err) { log(`  TikTok scrape failed for ${name}: ${err.message}`); }
  }

  // ── Facebook ──────────────────────────────────────────────────────────────
  const fbHandle = existingFbHandle || brandData.facebookHandle;
  log(`  Facebook: ${fbHandle ? '/' + fbHandle : 'not found'}`);
  if (fbHandle) {
    try {
      const fbPosts = await scrapeFacebookViaApify(fbHandle);
      if (fbPosts.length > 0) brandData.facebookData = buildPlatformData(normalizePosts(fbPosts, 'facebook'));
    } catch (err) { log(`  Facebook scrape failed for ${name}: ${err.message}`); }
  }

  return brandData;
}

// ─── Orchestration ────────────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found'); process.exit(1); }

  log(`Starting social audit for: ${profile.name}`);

  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

  const brandsToAudit = [
    {
      slug,
      name: profile.name,
      url: profile.url,
      role: 'target',
      handle: profile.social?.instagram || null,
      tiktokHandle: profile.social?.tiktok || null,
      facebookHandle: profile.social?.facebook || null,
    },
    ...(profile.identifiedCompetitors || []).slice(0, 5).map(c => ({
      slug: c.name.toLowerCase().replace(/\s+/g, '-'),
      name: c.name,
      url: c.url,
      role: 'competitor',
      handle: c.instagramHandle || null,
      tiktokHandle: c.tiktokHandle || null,
      facebookHandle: c.facebookHandle || null,
    })),
  ];

  const brandResults = [];
  for (const brand of brandsToAudit) {
    const result = await processBrand(brand, anthropic).catch(err => ({
      id: brand.slug,
      name: brand.name,
      role: brand.role,
      handle: brand.handle || null,
      tiktokHandle: brand.tiktokHandle || null,
      facebookHandle: brand.facebookHandle || null,
      error: err.message,
      partialData: true,
      contentThemes: [],
      topHashtags: [],
      recentPosts: [],
      topPosts: [],
      monthlyTrend: [],
      postingPattern: null,
      engagementRate: null,
      tiktokData: null,
      facebookData: null,
      summary: { postCount: 0, avgEngagement: 0 },
    }));
    brandResults.push(result);
  }

  // Content gap analysis for target brand
  const targetResult = brandResults.find(b => b.role === 'target');
  const competitorResults = brandResults.filter(b => b.role === 'competitor');
  if (targetResult && anthropic) {
    log('Generating content gap analysis...');
    targetResult.contentGaps = await generateContentGapAnalysis(anthropic, profile.name, targetResult, competitorResults).catch(() => []);
  }

  // Write all discovered handles back to profile.json
  const updatedProfile = { ...profile };
  let handleWritebacks = 0;
  updatedProfile.identifiedCompetitors = (profile.identifiedCompetitors || []).map(c => {
    const found = brandResults.find(r => r.role === 'competitor' && r.name === c.name);
    if (!found) return c;
    const updates = {};
    if (found.handle && !c.instagramHandle) { updates.instagramHandle = found.handle; handleWritebacks++; }
    if (found.tiktokHandle && !c.tiktokHandle) { updates.tiktokHandle = found.tiktokHandle; handleWritebacks++; }
    if (found.facebookHandle && !c.facebookHandle) { updates.facebookHandle = found.facebookHandle; handleWritebacks++; }
    return Object.keys(updates).length > 0 ? { ...c, ...updates } : c;
  });
  if (targetResult) {
    const socialUpdates = {};
    if (targetResult.handle && !profile.social?.instagram) { socialUpdates.instagram = targetResult.handle; handleWritebacks++; }
    if (targetResult.tiktokHandle && !profile.social?.tiktok) { socialUpdates.tiktok = targetResult.tiktokHandle; handleWritebacks++; }
    if (targetResult.facebookHandle && !profile.social?.facebook) { socialUpdates.facebook = targetResult.facebookHandle; handleWritebacks++; }
    if (Object.keys(socialUpdates).length > 0) updatedProfile.social = { ...profile.social, ...socialUpdates };
  }
  if (handleWritebacks > 0) {
    saveBrandData(slug, 'profile.json', updatedProfile);
    log(`  Wrote ${handleWritebacks} discovered handles back to profile.json`);
  }

  const now = new Date().toISOString();
  const output = { generatedAt: now, brandSlug: slug, brands: brandResults };

  const existing = loadBrandData(slug, 'social_intelligence.json');
  if (existing) archiveData(slug, 'social_intelligence', existing);
  saveBrandData(slug, 'social_intelligence.json', output);
  log(`Done. ${brandResults.length} brands audited. TikTok data: ${brandResults.filter(b => b.tiktokData).length} brands. Facebook data: ${brandResults.filter(b => b.facebookData).length} brands.`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
