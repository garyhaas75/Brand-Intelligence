/**
 * Module 2 — Social Feed Intelligence
 * Uses Apify's Instagram Profile Scraper to pull recent posts from
 * Anne Klein and competitors. Saves to /data/social_intelligence.json.
 * Provides: post frequency, caption themes, hashtag strategy, engagement signals.
 */

require('dotenv').config();
const { ApifyClient } = require('apify-client');
const fs = require('fs');
const path = require('path');
const { isStale } = require('../utils/archive');

// Skip Apify if data is less than this many hours old (conserves credits)
// Instagram updates slowly — every 2 days is sufficient
const STALE_HOURS = 48;

const LOG_FILE = path.join(__dirname, '../logs/social_scraper.log');
const OUTPUT_FILE = path.join(__dirname, '../data/social_intelligence.json');

// Apify actor for Instagram profile scraping
// apify/instagram-scraper handles profile URLs → returns recent posts
const ACTOR_ID = 'apify/instagram-scraper';

const BRANDS = [
  { id: 'anne_klein',    name: 'Anne Klein',              handle: 'annekleinofficial', role: 'ours' },
  { id: 'donna_karan',   name: 'Donna Karan',             handle: 'donnakaran', role: 'competitor' },
  { id: 'jones_new_york',name: 'Jones New York',          handle: 'jnywomen',   role: 'competitor' },
  { id: 'ann_taylor',    name: 'Ann Taylor',              handle: 'anntaylor',  role: 'competitor' },
  { id: 'talbots',       name: 'Talbots',                 handle: 'talbots',    role: 'competitor' },
  { id: 'whbm',          name: 'White House Black Market',handle: 'whbm',       role: 'competitor' },
];

const POSTS_PER_BRAND = 12; // last ~12 posts per brand

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function ensureDirs() {
  [path.join(__dirname, '../data'), path.join(__dirname, '../logs')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function extractThemes(posts) {
  // Identify dominant content themes from captions and hashtags
  const allText = posts.map(p => (p.caption || '') + ' ' + (p.hashtags || []).join(' ')).join(' ').toLowerCase();

  const themePatterns = [
    { theme: 'Sale / Promotion',     pattern: /\b(sale|off|discount|promo|deal|save|percent)\b/g },
    { theme: 'New Arrivals',         pattern: /\b(new|arrival|just dropped|launching|introducing)\b/g },
    { theme: 'Seasonal / Campaign',  pattern: /\b(spring|summer|fall|winter|holiday|season|collection)\b/g },
    { theme: 'Workwear / Office',    pattern: /\b(work|office|professional|career|boss|business|corporate)\b/g },
    { theme: 'Lifestyle / Aspiration',pattern: /\b(lifestyle|women|empower|confidence|style|chic|elegant)\b/g },
    { theme: 'Product Feature',      pattern: /\b(dress|blazer|shoes|bag|jewelry|pants|top|coat)\b/g },
    { theme: 'UGC / Community',      pattern: /\b(community|customer|fan|real|wear|regram|repost)\b/g },
    { theme: 'Sustainability',       pattern: /\b(sustainable|eco|responsible|consider it)\b/g },
  ];

  return themePatterns
    .map(({ theme, pattern }) => {
      const matches = allText.match(pattern) || [];
      return { theme, count: matches.length };
    })
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);
}

function summarizePosts(posts, brandName) {
  if (!posts.length) return { postCount: 0, themes: [], topHashtags: [], avgEngagement: 0, recentCaptions: [] };

  // Top hashtags
  const hashtagCounts = {};
  posts.forEach(p => {
    (p.hashtags || []).forEach(tag => {
      hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
    });
  });
  const topHashtags = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  // Avg engagement (likes + comments)
  const engagements = posts.map(p => (p.likesCount || 0) + (p.commentsCount || 0));
  const avgEngagement = Math.round(engagements.reduce((a, b) => a + b, 0) / engagements.length);

  // Recent captions (trimmed)
  const recentCaptions = posts.slice(0, 5).map(p => ({
    caption: (p.caption || '').substring(0, 200),
    likes: p.likesCount || 0,
    comments: p.commentsCount || 0,
    timestamp: p.timestamp,
    type: p.type || 'post',
  }));

  return {
    postCount: posts.length,
    themes: extractThemes(posts),
    topHashtags,
    avgEngagement,
    recentCaptions,
  };
}

async function scrapeInstagram(client, brand) {
  log(`Scraping Instagram for ${brand.name} (@${brand.handle})`);

  const result = {
    id: brand.id,
    name: brand.name,
    handle: brand.handle,
    role: brand.role,
    platform: 'instagram',
    profileUrl: `https://www.instagram.com/${brand.handle}/`,
    scrapedAt: new Date().toISOString(),
    posts: [],
    summary: {},
    error: null,
  };

  try {
    const run = await client.actor(ACTOR_ID).call({
      directUrls: [`https://www.instagram.com/${brand.handle}/`],
      resultsType: 'posts',
      resultsLimit: POSTS_PER_BRAND,
      addParentData: false,
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    result.posts = items.map(item => ({
      id: item.id || item.shortCode,
      type: item.type,
      caption: item.caption || '',
      hashtags: item.hashtags || [],
      likesCount: item.likesCount || 0,
      commentsCount: item.commentsCount || 0,
      timestamp: item.timestamp,
      url: item.url,
      isVideo: item.isVideo || false,
    }));

    result.summary = summarizePosts(result.posts, brand.name);
    log(`  ${brand.name}: ${result.posts.length} posts | avg engagement: ${result.summary.avgEngagement}`);
  } catch (err) {
    result.error = err.message;
    log(`  ${brand.name} ERROR: ${err.message}`);
  }

  return result;
}

async function run() {
  ensureDirs();
  log('=== Social Feed Scraper Started (Apify Instagram) ===');

  if (!process.env.APIFY_API_TOKEN) {
    log('ERROR: APIFY_API_TOKEN not set in .env');
    process.exit(1);
  }

  // Skip if data is fresh — Apify credits cost money, Instagram changes slowly
  if (!isStale(OUTPUT_FILE, STALE_HOURS) && !process.env.FORCE_REFRESH) {
    log(`Social data is fresh (<${STALE_HOURS}h old). Skipping Apify run to conserve credits.`);
    log(`To force: FORCE_REFRESH=1 npm run scrape:social  OR  delete ${OUTPUT_FILE}`);
    process.exit(0);
  }

  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  const brandResults = [];

  for (const brand of BRANDS) {
    const result = await scrapeInstagram(client, brand);
    brandResults.push(result);
  }

  // Cross-brand comparison
  const akSummary = brandResults.find(b => b.id === 'anne_klein')?.summary || {};
  const competitorAvgEngagement = Math.round(
    brandResults
      .filter(b => b.role === 'competitor' && b.summary.avgEngagement)
      .reduce((sum, b) => sum + b.summary.avgEngagement, 0) /
    brandResults.filter(b => b.role === 'competitor' && b.summary.avgEngagement).length
  );

  // Competitor hashtags AK isn't using
  const akHashtags = new Set((akSummary.topHashtags || []).map(h => h.tag));
  const competitorUniqueHashtags = [];
  brandResults.filter(b => b.role === 'competitor').forEach(b => {
    (b.summary.topHashtags || []).forEach(h => {
      if (!akHashtags.has(h.tag)) {
        competitorUniqueHashtags.push({ tag: h.tag, brand: b.name });
      }
    });
  });

  const output = {
    generatedAt: new Date().toISOString(),
    postsPerBrand: POSTS_PER_BRAND,
    brands: brandResults,
    competitiveIntel: {
      akAvgEngagement: akSummary.avgEngagement || 0,
      competitorAvgEngagement,
      engagementGap: competitorAvgEngagement - (akSummary.avgEngagement || 0),
      competitorHashtagsNotUsedByAK: competitorUniqueHashtags.slice(0, 30),
      akTopThemes: akSummary.themes || [],
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`=== Done. Results saved to ${OUTPUT_FILE} ===`);

  console.log('\n========================================');
  console.log('MODULE 2 — SOCIAL INTELLIGENCE COMPLETE');
  console.log('========================================');
  brandResults.forEach(b => {
    if (b.error) {
      console.log(`  ${b.name}: ERROR — ${b.error}`);
    } else {
      console.log(`  ${b.name}: ${b.summary.postCount} posts | avg engagement: ${b.summary.avgEngagement}`);
      if (b.summary.themes.length) {
        console.log(`    Top themes: ${b.summary.themes.slice(0, 3).map(t => t.theme).join(', ')}`);
      }
    }
  });
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
