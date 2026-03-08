/**
 * Module 1 — Competitor Email List Intelligence
 * Signs up SIGNUP_EMAIL to each competitor's newsletter via Playwright.
 * Captures signup confirmation and promo offer text (first-purchase discounts, etc.)
 * Saves to /data/email_signups.json — sets up inbox for ongoing email intel.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/email_signup.log');
const OUTPUT_FILE = path.join(__dirname, '../data/email_signups.json');
const SIGNUP_EMAIL = process.env.SIGNUP_EMAIL;

if (!SIGNUP_EMAIL) {
  console.error('SIGNUP_EMAIL not set in .env');
  process.exit(1);
}

const COMPETITORS = [
  {
    id: 'donna_karan',
    name: 'Donna Karan',
    url: 'https://www.donnakaran.com',
    signupHints: ['footer', 'newsletter', 'email-signup', 'subscribe'],
  },
  {
    id: 'jones_new_york',
    name: 'Jones New York',
    url: 'https://www.jny.com',
    signupHints: ['footer', 'newsletter', 'email-signup', 'subscribe'],
  },
  {
    id: 'ann_taylor',
    name: 'Ann Taylor',
    url: 'https://www.anntaylor.com',
    signupHints: ['footer', 'newsletter', 'email-signup', 'subscribe'],
  },
  {
    id: 'talbots',
    name: 'Talbots',
    url: 'https://www.talbots.com',
    signupHints: ['footer', 'newsletter', 'email-signup', 'subscribe'],
  },
  {
    id: 'whbm',
    name: 'White House Black Market',
    url: 'https://www.whitehouseblackmarket.com',
    signupHints: ['footer', 'newsletter', 'email-signup', 'subscribe'],
  },
];

// Email input selectors to try in order
const EMAIL_INPUT_SELECTORS = [
  'footer input[type="email"]',
  'footer input[placeholder*="email" i]',
  'footer input[name*="email" i]',
  '[class*="newsletter"] input[type="email"]',
  '[class*="newsletter"] input[placeholder*="email" i]',
  '[class*="subscribe"] input[type="email"]',
  '[class*="subscribe"] input[placeholder*="email" i]',
  '[class*="signup"] input[type="email"]',
  '[class*="email-signup"] input[type="email"]',
  'input[type="email"]',
];

// Submit button selectors to try in order
const SUBMIT_SELECTORS = [
  'footer button[type="submit"]',
  'footer input[type="submit"]',
  '[class*="newsletter"] button[type="submit"]',
  '[class*="newsletter"] button',
  '[class*="subscribe"] button[type="submit"]',
  '[class*="subscribe"] button',
  '[class*="signup"] button[type="submit"]',
  'button[type="submit"]',
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

async function findAndFillEmail(page) {
  for (const selector of EMAIL_INPUT_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        await el.scrollIntoViewIfNeeded();
        await el.fill(SIGNUP_EMAIL);
        return selector;
      }
    } catch (_) {}
  }
  return null;
}

async function findAndClickSubmit(page) {
  for (const selector of SUBMIT_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        await el.click();
        return selector;
      }
    } catch (_) {}
  }
  return null;
}

async function capturePromoText(page) {
  // Capture any confirmation message or promo/discount copy near signup
  const promoSelectors = [
    '[class*="newsletter"] *',
    '[class*="subscribe"] *',
    '[class*="signup"] *',
    '[class*="promo"] *',
    '[class*="discount"] *',
    '[class*="offer"] *',
    '[class*="success"] *',
    '[class*="thank"] *',
    '[class*="confirmation"] *',
  ];

  const texts = new Set();
  for (const sel of promoSelectors) {
    try {
      const found = await page.$$eval(sel, els =>
        els
          .map(e => e.innerText?.trim().replace(/\s+/g, ' '))
          .filter(t => t && t.length > 3 && t.length < 300)
      );
      found.forEach(t => texts.add(t));
    } catch (_) {}
  }
  return [...texts].slice(0, 15);
}

async function signupBrand(page, brand) {
  const result = {
    id: brand.id,
    name: brand.name,
    url: brand.url,
    email: SIGNUP_EMAIL,
    attemptedAt: new Date().toISOString(),
    status: 'unknown',
    promoTexts: [],
    signupOffer: '',
    inputSelector: null,
    submitSelector: null,
    error: null,
  };

  log(`Attempting signup at ${brand.name} — ${brand.url}`);

  try {
    await page.goto(brand.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Capture promo copy before filling the form
    result.promoTexts = await capturePromoText(page);

    // Scroll to footer where most newsletter forms live
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    const inputSel = await findAndFillEmail(page);
    result.inputSelector = inputSel;

    if (!inputSel) {
      result.status = 'no_form_found';
      log(`  ${brand.name}: No email input found`);
      return result;
    }

    log(`  ${brand.name}: Found email input (${inputSel}), filling ${SIGNUP_EMAIL}`);

    const submitSel = await findAndClickSubmit(page);
    result.submitSelector = submitSel;

    if (!submitSel) {
      result.status = 'no_submit_found';
      log(`  ${brand.name}: No submit button found`);
      return result;
    }

    // Wait for confirmation
    await page.waitForTimeout(3000);

    // Capture post-submit text
    const postSubmitTexts = await capturePromoText(page);
    result.promoTexts = [...new Set([...result.promoTexts, ...postSubmitTexts])].slice(0, 15);

    // Try to identify signup offer (% off, free shipping, etc.)
    const offerPatterns = [
      /\d+%\s*off/i,
      /free\s+shipping/i,
      /\$\d+\s*off/i,
      /welcome\s+offer/i,
      /exclusive\s+(discount|offer|access)/i,
      /sign\s*up\s+and\s+(get|save|receive)/i,
    ];

    for (const text of result.promoTexts) {
      for (const pattern of offerPatterns) {
        if (pattern.test(text)) {
          result.signupOffer = text;
          break;
        }
      }
      if (result.signupOffer) break;
    }

    result.status = 'submitted';
    log(`  ${brand.name}: Submitted. Offer detected: "${result.signupOffer || 'none'}"`);
  } catch (err) {
    result.status = 'error';
    result.error = err.message;
    log(`  ${brand.name} ERROR: ${err.message}`);
  }

  return result;
}

async function run() {
  ensureDirs();
  log('=== Email Signup Module Started ===');
  log(`Signup email: ${SIGNUP_EMAIL}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];

  for (const brand of COMPETITORS) {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.route('**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf}', route => route.abort());

    const result = await signupBrand(page, brand);
    results.push(result);
    await context.close();
  }

  await browser.close();

  const summary = {
    generatedAt: new Date().toISOString(),
    signupEmail: SIGNUP_EMAIL,
    totalAttempted: results.length,
    submitted: results.filter(r => r.status === 'submitted').length,
    noFormFound: results.filter(r => r.status === 'no_form_found').length,
    errors: results.filter(r => r.status === 'error').length,
    signupOffers: results
      .filter(r => r.signupOffer)
      .map(r => ({ brand: r.name, offer: r.signupOffer })),
    signups: results,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));
  log(`=== Done. Results saved to ${OUTPUT_FILE} ===`);

  console.log('\n========================================');
  console.log('MODULE 1 — EMAIL SIGNUPS COMPLETE');
  console.log('========================================');
  results.forEach(r => {
    console.log(`  ${r.name}: ${r.status}${r.signupOffer ? ` | Offer: "${r.signupOffer}"` : ''}`);
  });
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
