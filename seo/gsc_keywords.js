/**
 * Module 4 — Google Search Console Keyword Intelligence
 * Pulls search query data for anneklein.com from GSC API.
 * Provides: top queries, CTR gaps, branded vs unbranded traffic,
 * trending queries, and content opportunity keywords.
 * Saves to /data/gsc_keywords.json
 */

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/gsc_keywords.log');
const OUTPUT_FILE = path.join(__dirname, '../data/gsc_keywords.json');

const SITE_URL = 'sc-domain:anneklein.com';
const DAYS_BACK = 90;

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

function getDateRange() {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3); // GSC data lags ~3 days
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - DAYS_BACK);
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

function buildOAuth2Client() {
  // Use GSC credentials if available, fall back to Gmail credentials
  // (same Google project — refresh token may cover both scopes)
  const clientId = process.env.GSC_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GSC_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing OAuth2 credentials. Need GSC_CLIENT_ID, GSC_CLIENT_SECRET, and a refresh token.');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

async function fetchQueries(searchconsole, dateRange) {
  log(`Fetching top queries (last ${DAYS_BACK} days: ${dateRange.startDate} → ${dateRange.endDate})`);

  const response = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dimensions: ['query'],
      rowLimit: 500,
      dataState: 'final',
    },
  });

  return response.data.rows || [];
}

async function fetchPages(searchconsole, dateRange) {
  log('Fetching top pages...');

  const response = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dimensions: ['page'],
      rowLimit: 100,
      dataState: 'final',
    },
  });

  return response.data.rows || [];
}

async function fetchQueryByDevice(searchconsole, dateRange) {
  log('Fetching queries by device...');

  const response = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dimensions: ['query', 'device'],
      rowLimit: 200,
      dataState: 'final',
    },
  });

  return response.data.rows || [];
}

function classifyQuery(query) {
  const q = query.toLowerCase();
  if (/anne\s*klein/.test(q)) return 'branded';
  if (/\b(women'?s?|ladies|female)\b/.test(q)) return 'category-generic';
  if (/\b(buy|shop|sale|discount|cheap|affordable)\b/.test(q)) return 'transactional';
  if (/\b(how|what|best|review|vs|compare)\b/.test(q)) return 'informational';
  return 'unbranded-product';
}

function analyzeQueries(rows) {
  const queries = rows.map(row => ({
    query: row.keys[0],
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: parseFloat(((row.ctr || 0) * 100).toFixed(2)),
    position: parseFloat((row.position || 0).toFixed(1)),
    type: classifyQuery(row.keys[0]),
  }));

  // High impression, low CTR = content/title opportunity
  const ctrOpportunities = queries
    .filter(q => q.impressions >= 50 && q.ctr < 3 && q.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30);

  // Position 4–15 = "almost ranking" — quick win candidates
  const quickWins = queries
    .filter(q => q.position >= 4 && q.position <= 15 && q.impressions >= 30)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30);

  // Branded vs unbranded split
  const branded = queries.filter(q => q.type === 'branded');
  const unbranded = queries.filter(q => q.type !== 'branded');
  const brandedClicks = branded.reduce((s, q) => s + q.clicks, 0);
  const totalClicks = queries.reduce((s, q) => s + q.clicks, 0);

  // Category breakdown
  const categoryMap = {};
  queries.forEach(q => {
    categoryMap[q.type] = categoryMap[q.type] || { count: 0, clicks: 0, impressions: 0 };
    categoryMap[q.type].count++;
    categoryMap[q.type].clicks += q.clicks;
    categoryMap[q.type].impressions += q.impressions;
  });

  return {
    totalQueries: queries.length,
    totalClicks,
    totalImpressions: queries.reduce((s, q) => s + q.impressions, 0),
    avgCTR: parseFloat(((totalClicks / Math.max(queries.reduce((s, q) => s + q.impressions, 0), 1)) * 100).toFixed(2)),
    brandedClickShare: parseFloat(((brandedClicks / Math.max(totalClicks, 1)) * 100).toFixed(1)),
    queryTypeBreakdown: categoryMap,
    top50Queries: queries.slice(0, 50),
    ctrOpportunities,
    quickWins,
    allQueries: queries,
  };
}

async function run() {
  ensureDirs();
  log('=== GSC Keyword Intelligence Started ===');

  let auth;
  try {
    auth = buildOAuth2Client();
  } catch (err) {
    log(`Auth setup failed: ${err.message}`);
    process.exit(1);
  }

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const dateRange = getDateRange();

  let queryRows = [];
  let pageRows = [];

  try {
    queryRows = await fetchQueries(searchconsole, dateRange);
    log(`  Queries returned: ${queryRows.length}`);
  } catch (err) {
    log(`ERROR fetching queries: ${err.message}`);
    if (err.message.includes('403') || err.message.includes('401')) {
      log('Auth error — token may lack Search Console scope. Re-auth required.');
    }
  }

  try {
    pageRows = await fetchPages(searchconsole, dateRange);
    log(`  Pages returned: ${pageRows.length}`);
  } catch (err) {
    log(`ERROR fetching pages: ${err.message}`);
  }

  const queryAnalysis = analyzeQueries(queryRows);

  const topPages = pageRows.map(row => ({
    page: row.keys[0],
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: parseFloat(((row.ctr || 0) * 100).toFixed(2)),
    position: parseFloat((row.position || 0).toFixed(1)),
  }));

  const output = {
    generatedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    dateRange,
    daysAnalyzed: DAYS_BACK,
    queryAnalysis,
    topPages,
    keyInsights: {
      totalClicks: queryAnalysis.totalClicks,
      totalImpressions: queryAnalysis.totalImpressions,
      avgCTR: queryAnalysis.avgCTR,
      brandedClickShare: queryAnalysis.brandedClickShare,
      ctrOpportunityCount: queryAnalysis.ctrOpportunities.length,
      quickWinCount: queryAnalysis.quickWins.length,
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`=== Done. Results saved to ${OUTPUT_FILE} ===`);

  console.log('\n========================================');
  console.log('MODULE 4 — GSC KEYWORDS COMPLETE');
  console.log('========================================');
  console.log(`  Date range: ${dateRange.startDate} → ${dateRange.endDate}`);
  console.log(`  Total queries: ${queryAnalysis.totalQueries}`);
  console.log(`  Total clicks: ${queryAnalysis.totalClicks.toLocaleString()}`);
  console.log(`  Total impressions: ${queryAnalysis.totalImpressions.toLocaleString()}`);
  console.log(`  Avg CTR: ${queryAnalysis.avgCTR}%`);
  console.log(`  Branded click share: ${queryAnalysis.brandedClickShare}%`);
  console.log(`  CTR opportunities: ${queryAnalysis.ctrOpportunities.length}`);
  console.log(`  Quick wins (pos 4–15): ${queryAnalysis.quickWins.length}`);
  if (queryAnalysis.top50Queries.length) {
    console.log(`\n  Top 5 queries:`);
    queryAnalysis.top50Queries.slice(0, 5).forEach((q, i) => {
      console.log(`    ${i + 1}. "${q.query}" — ${q.clicks} clicks, pos ${q.position}`);
    });
  }
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
