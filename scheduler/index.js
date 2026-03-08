/**
 * Anne Klein Intel — Scheduler
 * Runs all intelligence modules on a cron schedule.
 *
 * Schedule (all times local):
 *   Daily  6:00 AM  — Site scraper + product catalog + site analysis (Module 3)
 *   Daily  6:30 AM  — Social scraper (Module 2)
 *   Daily  7:00 AM  — SEO / GSC keywords (Module 4)
 *   Daily  7:30 AM  — Check email inbox (Module 6)
 *   Daily  8:00 AM  — Analyze inbox + generate content (Modules 6b + 5)
 *   Weekly Mon 8:30 — Agentic search visibility (Module 7, expensive — API calls per query)
 *
 * Run with: node scheduler/index.js
 * Or add to npm start via concurrently.
 */

require('dotenv').config();
const cron = require('node-cron');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/scheduler.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function ensureLogs() {
  const dir = path.join(__dirname, '../logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function run(label, command) {
  log(`START  ${label}`);
  try {
    execSync(command, { cwd: path.join(__dirname, '..'), stdio: 'inherit', timeout: 10 * 60 * 1000 });
    log(`DONE   ${label}`);
  } catch (err) {
    log(`ERROR  ${label}: ${err.message}`);
  }
}

ensureLogs();
log('=== Scheduler started ===');

// Price tracker: AK sale events + competitor promos — runs daily (free, Shopify API only)
cron.schedule('0 5 * * *', () => {
  log('--- Price Tracker ---');
  run('price_tracker', 'node scrapers/price_tracker.js');
});

// Module 3: site scrape + product catalog + site analysis
cron.schedule('0 6 * * *', () => {
  log('--- Module 3: Site + Products + Analysis ---');
  run('site_scraper',    'node scrapers/site_scraper.js');
  run('product_scraper', 'node scrapers/product_scraper.js');
  run('site_analysis',   'node analysis/site_analysis.js');
});

// Module 2: social scraper
cron.schedule('30 6 * * *', () => {
  log('--- Module 2: Social ---');
  run('social_scraper', 'node scrapers/social_scraper.js');
});

// Module 4: SEO / GSC
cron.schedule('0 7 * * *', () => {
  log('--- Module 4: SEO/GSC ---');
  run('gsc_keywords', 'node seo/gsc_keywords.js');
});

// Module 6: check inbox
cron.schedule('30 7 * * *', () => {
  log('--- Module 6: Check Inbox ---');
  run('check_inbox', 'node email/check_inbox.js');
});

// Module 6b + 5: analyze inbox + generate content
cron.schedule('0 8 * * *', () => {
  log('--- Module 6b + 5: Analyze Inbox + Content ---');
  run('analyze_inbox',     'node email/analyze_inbox.js');
  run('content_generator', 'node analysis/content_generator.js');
});

// Module 7: agentic search — weekly (Monday 8:30 AM) to conserve API budget
cron.schedule('30 8 * * 1', () => {
  log('--- Module 7: Agentic Search Visibility ---');
  run('agentic_search', 'node analysis/agentic_search.js');
});

// Module 8: customer personas — 1st of month (data-intensive, no need more often)
cron.schedule('0 9 1 * *', () => {
  log('--- Module 8: Customer Personas ---');
  run('personas', 'node analysis/personas.js');
});

log('Cron jobs registered. Waiting...');
log('  Daily  05:00  Price Tracker — AK sales + competitor promos (free)');
log('  Daily  06:00  Module 3  — Site + Products + Analysis');
log('  Daily  06:30  Module 2  — Social');
log('  Daily  07:00  Module 4  — SEO/GSC');
log('  Daily  07:30  Module 6  — Check Inbox');
log('  Daily  08:00  Module 6b+5 — Analyze + Content');
log('  Weekly Mon 08:30  Module 7  — AI Search Visibility');
log('  Monthly 1st 09:00  Module 8  — Customer Personas');
