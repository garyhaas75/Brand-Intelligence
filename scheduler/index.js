/**
 * Brand Intelligence — Scheduler
 * Runs analysis modules for all tracked brands on a cron schedule.
 * Staggers pipeline per brand by 90s to avoid memory exhaustion.
 *
 * Schedule:
 *   Daily  6:00 AM  — Website audit + competitive analysis for all brands
 *   Daily  7:00 AM  — Social audit for all brands
 *   Weekly Mon 8:00 — Search/SEO + GEO for all brands (API-intensive)
 *   Monthly 1st 9:00 — Personas refresh for all brands
 *   Monthly 1st 10:00 — Action plan refresh for all brands
 */

require('dotenv').config();
const cron = require('node-cron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/scheduler.log');
const BRANDS_FILE = path.join(__dirname, '../data/brands.json');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function ensureLogs() {
  const dir = path.join(__dirname, '../logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadBrands() {
  try { return JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8')).brands || []; }
  catch { return []; }
}

/**
 * Spawn a module for each brand, staggered by delayMs per brand.
 * @param {string} script - relative path to analysis script
 * @param {number} delayMs - milliseconds to stagger between brands
 */
function runForAllBrands(script, delayMs = 90000) {
  const brands = loadBrands();
  if (brands.length === 0) { log(`No brands to process for ${script}`); return; }

  log(`Running ${script} for ${brands.length} brand(s) (staggered by ${delayMs / 1000}s)`);

  brands.forEach((brand, i) => {
    setTimeout(() => {
      log(`  Spawning ${script} for ${brand.name} (${brand.slug})`);
      const child = spawn('node', [path.join(__dirname, '..', script), `--slug=${brand.slug}`], {
        env: { ...process.env },
        cwd: path.join(__dirname, '..'),
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }, i * delayMs);
  });
}

ensureLogs();
log('=== Brand Intelligence Scheduler started ===');

// Daily 6:00 AM — Website audit + competitive analysis
cron.schedule('0 6 * * *', () => {
  log('--- Daily: Website Audit ---');
  runForAllBrands('analysis/website_audit.js', 90000);
  // Competitive analysis 30 min later (depends on fresh site scrapes)
  setTimeout(() => {
    log('--- Daily: Competitive Analysis ---');
    runForAllBrands('analysis/competitive_analysis.js', 90000);
  }, 30 * 60 * 1000);
});

// Daily 7:00 AM — Social audit
cron.schedule('0 7 * * *', () => {
  log('--- Daily: Social Audit ---');
  runForAllBrands('analysis/social_audit.js', 120000); // 2min stagger (Apify rate limits)
});

// Weekly Monday 8:00 AM — Search/SEO + GEO (Playwright + Claude API — slower)
cron.schedule('0 8 * * 1', () => {
  log('--- Weekly: Search & SEO / GEO ---');
  runForAllBrands('analysis/search_seo.js', 180000); // 3min stagger
});

// Monthly 1st 9:00 AM — Personas refresh
cron.schedule('0 9 1 * *', () => {
  log('--- Monthly: Personas ---');
  runForAllBrands('analysis/personas.js', 90000);
});

// Monthly 1st 10:00 AM — Action plan refresh (depends on all others being fresh)
cron.schedule('0 10 1 * *', () => {
  log('--- Monthly: Action Plan ---');
  runForAllBrands('analysis/action_plan.js', 90000);
});

log('Cron jobs registered. Waiting...');
log('  Daily  06:00  Website Audit + Competitive Analysis (all brands)');
log('  Daily  07:00  Social Audit (all brands)');
log('  Weekly Mon 08:00  Search & SEO / GEO (all brands)');
log('  Monthly 1st 09:00  Personas refresh (all brands)');
log('  Monthly 1st 10:00  Action Plan refresh (all brands)');
