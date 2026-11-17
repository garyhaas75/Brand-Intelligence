#!/usr/bin/env node
'use strict';
/**
 * Render the printable brand report for one brand.
 *
 *   node scripts/render_report.js --slug=<slug> --lang=en|ja [--out=<path.html>] [--pdf]
 *                                 [--translations=<translations.json>] [--data-dir=<dir>]
 *
 * Reads data/brands/<slug>/*.json, applies localizeData from modules/localize.js
 * when that module exists, renders with modules/report_html.js and writes HTML
 * (default data/brands/<slug>/report_<lang>.html). With --pdf it also writes a
 * PDF next to it, printed by puppeteer-core with page.setContent and every
 * network request refused.
 */
const fs = require('fs');
const path = require('path');
const { renderReport } = require('../modules/report_html');

const MODULE_FILES = ['competitive_analysis', 'personas', 'social_intelligence', 'site_intelligence', 'search_seo', 'action_plan', 'marketplace', 'jp_demand', 'site_blueprint'];

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function loadLocalize() {
  try { return require('../modules/localize'); } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && /modules[\\/]localize/.test(String(e.message))) return null;
    throw e;
  }
}

/**
 * loadBrandReportInput(dir, lang, translations = null, log = () => {}) -> { profile, data }
 * Single loader for the CLI and the server route. dir is data/brands/<slug>; lang 'en' or 'ja';
 * translations is a parsed translations.json object, or null to read <dir>/translations.json.
 * profile and every module file are localized with modules/localize.js localizeData when that
 * module and a translations object exist; otherwise returned as collected. Missing files are null
 * (profile falls back to {}). Pass the result to renderReport({ profile, brandName: profile.name, data, lang }).
 */
function loadBrandReportInput(dir, lang, translations, log = () => {}) {
  let profile = readJson(path.join(dir, 'profile.json')) || {};
  let data = {};
  for (const k of MODULE_FILES) data[k] = readJson(path.join(dir, `${k}.json`));
  const tr = translations || readJson(path.join(dir, 'translations.json'));
  const localize = loadLocalize();
  if (localize && typeof localize.localizeData === 'function') {
    if (tr) {
      data = localize.localizeData(data, lang, tr);
      profile = localize.localizeData(profile, lang, tr);
    } else {
      log('no translations.json for this brand: data rendered as collected');
    }
  } else {
    log('modules/localize.js not found: data rendered as collected (not localized)');
  }
  return { profile, data };
}

async function findExecutable(log) {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === 'linux') {
    try {
      const chromium = require('@sparticuz/chromium');
      const p = await chromium.executablePath();
      if (p) return { path: p, args: chromium.args };
    } catch (e) { log(`@sparticuz/chromium unavailable: ${e.message}`); }
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(mac)) return mac;
  return null;
}

async function htmlToPdf(html, pdfPath, log = () => {}) {
  const puppeteer = require('puppeteer-core');
  const exe = await findExecutable(log);
  if (!exe) throw new Error('no Chrome found: set PUPPETEER_EXECUTABLE_PATH');
  const executablePath = typeof exe === 'string' ? exe : exe.path;
  const args = typeof exe === 'string' ? ['--no-sandbox'] : exe.args;
  const browser = await puppeteer.launch({ executablePath, args, headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().startsWith('data:') || req.url() === 'about:blank' ? req.continue() : req.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (m) => console.log(`[render_report] ${m}`);
  const slug = args.slug;
  if (!slug || slug === true) { console.error('usage: node scripts/render_report.js --slug=<slug> --lang=en|ja [--out=<path>] [--pdf] [--translations=<file>]'); process.exit(2); }
  if (!/^[\p{L}\p{N}_.-]+$/u.test(slug) || slug.includes('..')) { console.error('invalid slug'); process.exit(2); }
  const lang = args.lang === 'ja' ? 'ja' : 'en';
  const dir = args['data-dir'] ? path.resolve(args['data-dir']) : path.join(__dirname, '..', 'data', 'brands', slug);
  if (!fs.existsSync(dir)) { console.error(`no data directory: ${dir}`); process.exit(1); }
  const translations = args.translations ? readJson(path.resolve(args.translations)) : null;
  if (args.translations && !translations) { console.error(`could not read translations file ${args.translations}`); process.exit(1); }

  const { profile, data } = loadBrandReportInput(dir, lang, translations, log);
  const generatedAt = new Date().toISOString();
  const html = renderReport({ profile, brandName: profile.name || slug, data, lang, generatedAt });
  const out = args.out && args.out !== true ? path.resolve(args.out) : path.join(dir, `report_${lang}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  log(`wrote ${out} (${html.length} chars)`);
  if (args.pdf) {
    const pdfPath = out.replace(/\.html?$/i, '') + '.pdf';
    await htmlToPdf(html, pdfPath, log);
    log(`wrote ${pdfPath} (${fs.statSync(pdfPath).size} bytes)`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`[render_report] failed: ${e.message}`); process.exit(1); });
}

module.exports = { loadBrandReportInput, htmlToPdf, MODULE_FILES };
