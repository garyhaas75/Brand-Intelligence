/**
 * Module 6 — Competitor Email Inbox Intelligence
 * Uses Gmail API to read competitor marketing emails received at SIGNUP_EMAIL.
 * Searches for emails from each competitor domain, extracts subject lines,
 * send frequency, offers, and content themes.
 * Saves to /data/email_inbox.json
 *
 * Run after manually signing up for competitor newsletters.
 * Re-run weekly to capture new campaigns.
 */

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/check_inbox.log');
const OUTPUT_FILE = path.join(__dirname, '../data/email_inbox.json');

const COMPETITOR_DOMAINS = [
  { id: 'anne_klein',    name: 'Anne Klein',              domain: 'anneklein.com' },
  { id: 'donna_karan',   name: 'Donna Karan',             domain: 'donnakaran.com' },
  { id: 'jones_new_york',name: 'Jones New York',          domain: 'jny.com' },
  { id: 'ann_taylor',    name: 'Ann Taylor',              domain: 'anntaylor.com' },
  { id: 'talbots',       name: 'Talbots',                 domain: 'talbots.com' },
  { id: 'whbm',          name: 'White House Black Market',domain: 'whitehouseblackmarket.com' },
];

// Patterns to extract offers/discount codes from subject lines + snippets
const OFFER_PATTERNS = [
  /(\d+)%\s*off/i,
  /\$(\d+)\s*off/i,
  /free\s+shipping/i,
  /EXTRA\s+\d+%/i,
  /promo\s+code[:\s]+([A-Z0-9]+)/i,
  /use\s+code[:\s]+([A-Z0-9]+)/i,
  /code[:\s]+([A-Z0-9]{4,12})\b/i,
  /enjoy\s+\d+%/i,
  /\d+%\s*off\s+your\s+first/i,
  /welcome\s+offer/i,
  /sale\s+ends/i,
  /last\s+(chance|day|hours?)/i,
  /exclusive/i,
];

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

function buildGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN in .env');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

function extractOffer(subject, snippet) {
  const text = `${subject} ${snippet}`;
  for (const pattern of OFFER_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function categorizeSubject(subject) {
  const s = subject.toLowerCase();
  if (/welcome|so happy you joined|thanks for joining|glad you're here/.test(s)) return 'Welcome';
  if (/reward|point|earn|redeem|loyalty|vip|member|insider|status/.test(s)) return 'Rewards';
  if (/sale|off|deal|save|discount|extra|coupon|promo/.test(s)) return 'Promotion';
  if (/new arrival|just dropped|introducing|launching|now available|shop new/.test(s)) return 'Product Launch';
  if (/last (chance|day|call)|ending|expires|hurry|don't miss|only \d+ (hour|day)/.test(s)) return 'Urgency';
  if (/spring|summer|fall|winter|holiday|season/.test(s)) return 'Seasonal';
  if (/free shipping/.test(s)) return 'Shipping Offer';
  if (/style|how to|outfit|look|wear|trend|edit/.test(s)) return 'Editorial';
  if (/back in stock|just restocked|you left|still thinking|cart/.test(s)) return 'Restock/Browse';
  return 'General';
}

async function fetchEmailsForDomain(gmail, domain, name, maxResults = 30) {
  log(`  Searching for emails from ${domain}...`);
  const result = {
    id: domain.replace('.com', '').replace('.', '_'),
    name,
    domain,
    emails: [],
    summary: {},
    error: null,
  };

  try {
    // Use "in:anywhere" to include Promotions, Social, and all Gmail tabs
    // (without this, Gmail API defaults to Primary inbox only)
    // Also match sending subdomains like @email.anntaylor.com, @em.talbots.com
    const baseDomain = domain.replace(/^www\./, '').replace(/\.com$/, '');
    const searchRes = await gmail.users.messages.list({
      userId: 'me',
      q: `from:${baseDomain} in:anywhere`,
      maxResults,
    });

    const messages = searchRes.data.messages || [];
    log(`  ${name}: ${messages.length} emails found`);

    if (messages.length === 0) {
      result.summary = { count: 0, note: 'No emails received yet. Sign up for their newsletter first.' };
      return result;
    }

    // Fetch headers for each message (parallel, capped)
    const fetched = await Promise.all(
      messages.slice(0, maxResults).map(m =>
        gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        }).then(r => r.data).catch(() => null)
      )
    );

    result.emails = fetched
      .filter(Boolean)
      .map(msg => {
        const headers = {};
        (msg.payload?.headers || []).forEach(h => { headers[h.name] = h.value; });
        const subject = headers['Subject'] || '(no subject)';
        const snippet = msg.snippet || '';
        return {
          id: msg.id,
          subject,
          snippet: snippet.substring(0, 200),
          from: headers['From'] || '',
          date: headers['Date'] || '',
          category: categorizeSubject(subject),
          offer: extractOffer(subject, snippet),
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Summary
    const categories = {};
    const offers = [];
    result.emails.forEach(e => {
      categories[e.category] = (categories[e.category] || 0) + 1;
      if (e.offer) offers.push({ subject: e.subject, offer: e.offer });
    });

    result.summary = {
      count: result.emails.length,
      categories,
      offersFound: offers.slice(0, 5),
      sendFrequency: result.emails.length > 1
        ? `~${Math.round(result.emails.length / 4)} emails/month (est.)`
        : 'Not enough data',
      mostRecentSubject: result.emails[0]?.subject || '',
      mostRecentDate: result.emails[0]?.date || '',
    };

    log(`  ${name}: ${result.emails.length} emails, ${offers.length} offers detected`);
  } catch (err) {
    result.error = err.message;
    log(`  ${name} ERROR: ${err.message}`);

    if (err.message.includes('insufficient')) {
      result.error = 'Gmail API scope not authorized. Re-run OAuth with gmail.readonly scope.';
    }
  }

  return result;
}

async function run() {
  ensureDirs();
  log('=== Email Inbox Checker Started ===');

  let gmail;
  try {
    gmail = buildGmailClient();
  } catch (err) {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  }

  const results = [];
  for (const competitor of COMPETITOR_DOMAINS) {
    const result = await fetchEmailsForDomain(gmail, competitor.domain, competitor.name);
    results.push(result);
  }

  const totalEmails = results.reduce((sum, r) => sum + (r.summary.count || 0), 0);
  const allOffers = results.flatMap(r => (r.summary.offersFound || []).map(o => ({ brand: r.name, ...o })));

  const output = {
    generatedAt: new Date().toISOString(),
    signupEmail: process.env.SIGNUP_EMAIL,
    totalEmailsFound: totalEmails,
    brands: results,
    competitiveIntel: {
      allOffers,
      sendFrequencies: results.map(r => ({ brand: r.name, frequency: r.summary.sendFrequency || 'No emails yet', count: r.summary.count || 0 })),
      categoryBreakdown: results.map(r => ({ brand: r.name, categories: r.summary.categories || {} })),
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`=== Done. Results saved to ${OUTPUT_FILE} ===`);

  console.log('\n========================================');
  console.log('MODULE 6 — EMAIL INBOX COMPLETE');
  console.log('========================================');
  results.forEach(r => {
    if (r.error) {
      console.log(`  ${r.name}: ERROR — ${r.error}`);
    } else {
      console.log(`  ${r.name}: ${r.summary.count} emails | ${r.summary.offersFound?.length || 0} offers`);
      if (r.summary.mostRecentSubject) {
        console.log(`    Latest: "${r.summary.mostRecentSubject}"`);
      }
    }
  });
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
