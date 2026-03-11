/**
 * Social Audit — scrapes Instagram (via Apify, with Playwright fallback) for
 * the target brand and competitors. Generates 12-month trend data and
 * content gap analysis via Claude.
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

// Try to detect Instagram handle by scraping brand website
async function detectInstagramHandle(brandUrl) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(brandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Pass 1: look for <a href> links to instagram.com
    const links = await page.$$eval('a[href*="instagram.com"]', anchors => anchors.map(a => a.href));
    if (links.length > 0) {
      const match = links[0].match(/instagram\.com\/([^/?#\s]+)/);
      if (match && match[1] !== 'p' && match[1] !== 'explore') return match[1];
    }

    // Pass 2: regex scan entire page HTML for instagram.com/handle pattern
    const html = await page.content();
    const igMatches = [...html.matchAll(/instagram\.com\/([a-zA-Z0-9_.]{2,30})[^a-zA-Z0-9_.]/g)];
    const filtered = igMatches
      .map(m => m[1])
      .filter(h => !['p', 'explore', 'accounts', 'stories', 'reel', 'tv', 'share', 'sharedAction', 'oauth'].includes(h));
    if (filtered.length > 0) return filtered[0];

    // Pass 3: try /about or /contact page
    const origin = new URL(brandUrl).origin;
    for (const path of ['/about', '/contact', '/about-us']) {
      try {
        await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
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

async function scrapeInstagramViaApify(handle) {
  if (!process.env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN not set');
  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  log(`  Scraping Instagram @${handle} via Apify...`);

  const run = await client.actor('apify/instagram-scraper').call({
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: 'posts',
    resultsLimit: 50,
    // addParentData removed — wraps posts in profile objects, breaking post extraction
  });

  log(`  Apify run status: ${run.status}, datasetId: ${run.defaultDatasetId}`);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 50 });
  log(`  Apify returned ${items.length} items. First item keys: ${items[0] ? Object.keys(items[0]).slice(0, 10).join(', ') : 'none'}`);

  // Filter to actual post objects (not profile wrappers)
  const posts = items.filter(item =>
    item.type === 'Image' || item.type === 'Video' || item.type === 'Sidecar' ||
    item.shortCode || item.timestamp || item.taken_at_timestamp
  );
  log(`  ${posts.length} valid posts after filtering`);
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

// Playwright fallback: scrape public Instagram profile for basic stats
async function scrapeInstagramFallback(handle) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try to extract data from page JSON (window._sharedData no longer works but try meta tags)
    const bio = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
    const title = await page.title().catch(() => '');

    // Extract post count from bio/title if present
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

function buildMonthlyTrend(posts) {
  const monthMap = {};
  posts.forEach(post => {
    const date = new Date(post.timestamp || post.taken_at_timestamp * 1000);
    if (isNaN(date)) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap[key]) monthMap[key] = { month: key, totalLikes: 0, totalComments: 0, postCount: 0 };
    monthMap[key].totalLikes += post.likesCount || post.edge_media_preview_like?.count || 0;
    monthMap[key].totalComments += post.commentsCount || post.edge_media_to_comment?.count || 0;
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

function extractContentThemes(posts) {
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
  posts.forEach(post => {
    const text = (post.caption || post.caption?.text || '').toLowerCase();
    Object.entries(themeKeywords).forEach(([theme, keywords]) => {
      if (keywords.some(k => text.includes(k))) {
        counts[theme] = (counts[theme] || 0) + 1;
      }
    });
  });

  return Object.entries(counts).map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count);
}

async function generateContentGapAnalysis(anthropic, targetBrand, targetData, competitorBrandsData) {
  const targetThemes = (targetData.contentThemes || []).map(t => t.theme).slice(0, 5);
  const competitorThemes = competitorBrandsData.flatMap(b => (b.contentThemes || []).map(t => t.theme));
  const uniqueCompThemes = [...new Set(competitorThemes)];
  const gaps = uniqueCompThemes.filter(t => !targetThemes.includes(t));

  if (!process.env.ANTHROPIC_API_KEY) return gaps.map(g => `Consider adding ${g} content`);

  const prompt = `As a social media strategist, analyze the content gap between ${targetBrand} and its competitors on Instagram.

TARGET BRAND (${targetBrand}) content themes: ${targetThemes.join(', ') || 'unknown'}
Target posting frequency: ${targetData.summary?.postingFrequencyPerWeek || 0} posts/week
Target avg engagement: ${targetData.summary?.avgEngagement || 0}

COMPETITOR themes they use that target brand doesn't: ${gaps.join(', ') || 'none identified'}

Identify the 3-5 most impactful content gaps and return as a JSON array of strings:
["Gap description and recommended action", ...]`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0].text;
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) return JSON.parse(raw.slice(start, end + 1));
  } catch (_) {}
  return gaps.slice(0, 5).map(g => `Add ${g} content to close gap vs competitors`);
}

async function processBrand(brandInfo, anthropic) {
  const { slug, name, url, role, handle: existingHandle } = brandInfo;

  log(`Processing ${name} (${role})`);
  const brandData = {
    id: slug || name.toLowerCase().replace(/\s+/g, '-'),
    name,
    role,
    handle: existingHandle || null,
    platform: 'instagram',
    scrapedAt: new Date().toISOString(),
    summary: { postCount: 0, avgEngagement: 0, followersEstimate: null, postingFrequencyPerWeek: 0 },
    contentThemes: [],
    topHashtags: [],
    recentPosts: [],
    monthlyTrend: [],
    contentGaps: [],
    error: null,
    partialData: false,
  };

  // Detect handle if not provided
  let handle = existingHandle;
  if (!handle && url) {
    log(`  Detecting Instagram handle for ${name}...`);
    handle = await detectInstagramHandle(url).catch(() => null);
    brandData.handle = handle;
  }

  if (!handle) {
    brandData.error = 'Could not detect Instagram handle';
    brandData.partialData = true;
    log(`  No handle found for ${name}`);
    return brandData;
  }

  // Try Apify first, fallback to Playwright
  let posts = [];
  let apifyError = null;
  try {
    posts = await scrapeInstagramViaApify(handle);
    log(`  ${name}: ${posts.length} posts via Apify`);
  } catch (err) {
    apifyError = err.message;
    log(`  Apify failed for ${name}: ${err.message}. Trying Playwright fallback...`);
    const fallback = await scrapeInstagramFallback(handle).catch(e => ({ error: e.message, partialData: true }));
    brandData.partialData = true;
    if (fallback.error) { brandData.error = `Apify: ${apifyError} | Playwright: ${fallback.error}`; return brandData; }
    brandData.summary.estimatedPostCount = fallback.estimatedPostCount;
    brandData.summary.followersEstimate = fallback.estimatedFollowers;
    return brandData;
  }

  if (posts.length === 0) {
    // Try profile-scraper fallback to at least get follower/post count
    log(`  No posts returned — trying profile-scraper fallback for @${handle}`);
    const profile = await scrapeInstagramProfileViaApify(handle);
    if (profile) {
      brandData.summary.followersEstimate = profile.followersCount || profile.followers || null;
      brandData.summary.estimatedPostCount = profile.postsCount || profile.mediaCount || null;
      brandData.error = 'Post data unavailable (account may be private or scraper blocked) — profile stats only';
    } else {
      brandData.error = 'No posts returned from Apify — account may be private, new, or inactive';
    }
    brandData.partialData = true;
    return brandData;
  }

  // Process posts
  const totalLikes = posts.reduce((s, p) => s + (p.likesCount || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.commentsCount || 0), 0);
  brandData.summary.postCount = posts.length;
  brandData.summary.avgEngagement = posts.length > 0 ? Math.round((totalLikes + totalComments) / posts.length) : 0;

  // Estimate posting frequency (posts over last 30 days / 4.3 weeks)
  const now = Date.now();
  const last30 = posts.filter(p => {
    const ts = p.timestamp || (p.taken_at_timestamp ? p.taken_at_timestamp * 1000 : null);
    return ts && (now - new Date(ts)) < 30 * 24 * 3600 * 1000;
  });
  brandData.summary.postingFrequencyPerWeek = Math.round((last30.length / 4.3) * 10) / 10;

  brandData.monthlyTrend = buildMonthlyTrend(posts);
  brandData.contentThemes = extractContentThemes(posts);

  // Top hashtags
  const hashtagCounts = {};
  posts.forEach(p => {
    const text = p.caption || p.caption?.text || '';
    const tags = text.match(/#\w+/g) || [];
    tags.forEach(t => { hashtagCounts[t] = (hashtagCounts[t] || 0) + 1; });
  });
  brandData.topHashtags = Object.entries(hashtagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count }));

  // Recent posts (last 5)
  brandData.recentPosts = posts.slice(0, 5).map(p => ({
    caption: (p.caption || p.caption?.text || '').slice(0, 150),
    likes: p.likesCount || 0,
    comments: p.commentsCount || 0,
    timestamp: p.timestamp || null,
  }));

  return brandData;
}

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found'); process.exit(1); }

  log(`Starting social audit for: ${profile.name}`);

  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

  const brandsToAudit = [
    { slug, name: profile.name, url: profile.url, role: 'target', handle: profile.social?.instagram || null },
    ...(profile.identifiedCompetitors || []).slice(0, 5).map(c => ({
      slug: c.name.toLowerCase().replace(/\s+/g, '-'),
      name: c.name,
      url: c.url,
      role: 'competitor',
      handle: c.instagramHandle || null, // use manually-set handle if available
    })),
  ];

  const brandResults = [];
  for (const brand of brandsToAudit) {
    const result = await processBrand(brand, anthropic).catch(err => ({
      id: brand.slug,
      name: brand.name,
      role: brand.role,
      error: err.message,
      partialData: true,
      contentThemes: [],
      topHashtags: [],
      recentPosts: [],
      monthlyTrend: [],
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

  // Write discovered handles back to profile.json so Brand Profile tab shows them
  const handleUpdates = brandResults.filter(r => r.role === 'competitor' && r.handle);
  if (handleUpdates.length > 0) {
    const updatedProfile = { ...profile };
    updatedProfile.identifiedCompetitors = (profile.identifiedCompetitors || []).map(c => {
      const found = handleUpdates.find(r => r.name === c.name);
      if (found && !c.instagramHandle) return { ...c, instagramHandle: found.handle };
      return c;
    });
    saveBrandData(slug, 'profile.json', updatedProfile);
    log(`  Wrote ${handleUpdates.length} discovered handles back to profile.json`);
  }

  const now = new Date().toISOString();
  const output = { generatedAt: now, brandSlug: slug, brands: brandResults };

  const existing = loadBrandData(slug, 'social_intelligence.json');
  if (existing) archiveData(slug, 'social_intelligence', existing);
  saveBrandData(slug, 'social_intelligence.json', output);
  log(`Done. ${brandResults.length} brands audited.`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
