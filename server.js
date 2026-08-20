/**
 * Brand Intelligence — Express API Server
 * Multi-brand external competitive intelligence platform.
 * Runs on PORT 3001, CORS-enabled for dashboard dev server.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL_DEEP, MODEL_FAST, EFFORT_LOW, extractText } = require('./utils/models');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const BRANDS_DIR = path.join(DATA_DIR, 'brands');
const BRANDS_FILE = path.join(DATA_DIR, 'brands.json');
const SHARE_TOKENS_FILE = path.join(DATA_DIR, 'share_tokens.json');

// ─── Bootstrap directories ─────────────────────────────────────────────────────
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDir(DATA_DIR);
ensureDir(BRANDS_DIR);
if (!fs.existsSync(BRANDS_FILE)) fs.writeFileSync(BRANDS_FILE, JSON.stringify({ brands: [] }, null, 2));
if (!fs.existsSync(SHARE_TOKENS_FILE)) fs.writeFileSync(SHARE_TOKENS_FILE, JSON.stringify({ tokens: [] }, null, 2));

// ─── Seed System (per-brand) ───────────────────────────────────────────────────
const BRAND_DATA_VALIDATORS = {
  'profile.json':               (d) => !!d?.url && !!d?.name,
  'competitive_analysis.json':  (d) => Array.isArray(d?.competitors) && d.competitors.length > 0,
  'personas.json':              (d) => Array.isArray(d?.personas) && d.personas.length > 0,
  'social_intelligence.json':   (d) => Array.isArray(d?.brands) && d.brands.length > 0,
  'site_intelligence.json':     (d) => Array.isArray(d?.brands) && d.brands.length > 0,
  'search_seo.json':            (d) => !!d?.onPageSeo,
  'action_plan.json':           (d) => Array.isArray(d?.immediateWins) && d.immediateWins.length > 0,
};

function mergeBrandSeedData(slug) {
  const seedBrandDir = path.join(__dirname, 'seed_data', 'brands', slug);
  const liveBrandDir = path.join(BRANDS_DIR, slug);
  if (!fs.existsSync(seedBrandDir)) return;
  ensureDir(liveBrandDir);
  ensureDir(path.join(liveBrandDir, 'history'));
  for (const file of fs.readdirSync(seedBrandDir).filter(f => f.endsWith('.json'))) {
    const livePath = path.join(liveBrandDir, file);
    const seedPath = path.join(seedBrandDir, file);
    try {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      if (!fs.existsSync(livePath)) {
        fs.copyFileSync(seedPath, livePath);
        console.log(`[seed:${slug}] copied ${file} (missing)`);
        continue;
      }
      const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
      const validator = BRAND_DATA_VALIDATORS[file];
      if (validator && !validator(live)) {
        fs.copyFileSync(seedPath, livePath);
        console.log(`[seed:${slug}] replaced ${file} (failed validation)`);
        continue;
      }
      let changed = false;
      for (const key of Object.keys(seed)) {
        if (!(key in live)) { live[key] = seed[key]; changed = true; }
      }
      if (changed) fs.writeFileSync(livePath, JSON.stringify(live, null, 2));
    } catch (e) { console.error(`[seed:${slug}] error processing ${file}:`, e.message); }
  }
}

// Run seed for all brands on startup
(function bootstrapSeeds() {
  const brandsData = loadBrandsRegistry();
  brandsData.brands.forEach(b => mergeBrandSeedData(b.slug));
  // Also seed the demo brand if seed dir exists
  const demoBrandSeedDir = path.join(__dirname, 'seed_data', 'brands', 'demo-brand');
  if (fs.existsSync(demoBrandSeedDir) && !brandsData.brands.find(b => b.slug === 'demo-brand')) {
    mergeBrandSeedData('demo-brand');
  }
})();

// ─── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors());
app.use(express.json());

// ─── Data Utilities ─────────────────────────────────────────────────────────────
function loadBrandsRegistry() {
  try { return JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8')); }
  catch { return { brands: [] }; }
}

function saveBrandsRegistry(data) {
  fs.writeFileSync(BRANDS_FILE, JSON.stringify(data, null, 2));
}

function loadBrandData(slug, filename) {
  const filepath = path.join(BRANDS_DIR, slug, filename);
  if (!fs.existsSync(filepath)) return null;
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
  catch { return null; }
}

function saveBrandData(slug, filename, data) {
  const dir = path.join(BRANDS_DIR, slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function uniqueSlug(name) {
  const base = slugify(name);
  const registry = loadBrandsRegistry();
  const existing = registry.brands.map(b => b.slug);
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function getBrandStatus(slug) {
  const brandDir = path.join(BRANDS_DIR, slug);
  const modules = ['profile', 'competitive_analysis', 'personas', 'social_intelligence', 'site_intelligence', 'search_seo', 'action_plan'];
  return modules.map(mod => {
    const fp = path.join(brandDir, `${mod}.json`);
    if (!fs.existsSync(fp)) return { module: mod, exists: false };
    const stat = fs.statSync(fp);
    return { module: mod, exists: true, lastRefreshed: stat.mtime, size: stat.size };
  });
}

function getHealthStatus(slug) {
  const status = getBrandStatus(slug);
  const existingModules = status.filter(s => s.exists);
  if (existingModules.length === 0) return 'never_run';
  const mostRecent = existingModules.reduce((a, b) => new Date(a.lastRefreshed) > new Date(b.lastRefreshed) ? a : b);
  const ageHours = (Date.now() - new Date(mostRecent.lastRefreshed)) / 3600000;
  if (ageHours < 24) return 'fresh';
  if (ageHours < 72) return 'stale';
  return 'needs_refresh';
}

function loadShareTokens() {
  try { return JSON.parse(fs.readFileSync(SHARE_TOKENS_FILE, 'utf8')); }
  catch { return { tokens: [] }; }
}

function saveShareTokens(data) {
  fs.writeFileSync(SHARE_TOKENS_FILE, JSON.stringify(data, null, 2));
}

// ─── Health Check (BEFORE basicAuth) ──────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const registry = loadBrandsRegistry();
  res.json({
    ok: true,
    brandCount: registry.brands.length,
    brands: registry.brands.map(b => ({ slug: b.slug, name: b.name, healthStatus: getHealthStatus(b.slug) })),
    serverTime: new Date().toISOString(),
  });
});

// ─── Share Link (public, BEFORE basicAuth) ────────────────────────────────────
app.get('/share/:token', (req, res) => {
  const { tokens } = loadShareTokens();
  const entry = tokens.find(t => t.token === req.params.token);
  if (!entry) return res.status(404).send('<h1>Link not found or expired</h1>');
  if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
    return res.status(410).send('<h1>This link has expired</h1>');
  }

  const slug = entry.brandSlug;
  const profile = loadBrandData(slug, 'profile.json') || {};
  const actionPlan = loadBrandData(slug, 'action_plan.json') || {};
  const competitive = loadBrandData(slug, 'competitive_analysis.json') || {};
  const personas = loadBrandData(slug, 'personas.json') || {};
  const social = loadBrandData(slug, 'social_intelligence.json') || {};
  const site = loadBrandData(slug, 'site_intelligence.json') || {};
  const seo = loadBrandData(slug, 'search_seo.json') || {};

  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const date = new Date(actionPlan.generatedAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Chapter 1: Personas ──
  const personaList = (personas.personas || []);
  const personasHtml = personaList.map(p => `
    <div class="card avoid-break">
      <div class="card-header" style="background:#6366f1">${esc(p.name)} &mdash; ${esc(p.ageRange || '')}</div>
      <div class="card-body">
        <p class="body-text">${esc(p.description || p.psychographic || '')}</p>
        ${(p.topNeeds || p.needs || []).length ? `
          <p class="label" style="margin-top:12px">What they need</p>
          <ul class="bullet-list">${(p.topNeeds || p.needs || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${p.contentThatWins ? `<div class="how-box"><strong>Content that wins:</strong> ${esc(p.contentThatWins)}</div>` : ''}
      </div>
    </div>`).join('');

  // ── Chapter 2: Competition ──
  const competitorList = (competitive.competitors || []).filter(c => !c.isTarget);
  const competitorsHtml = competitorList.map(c => `
    <div class="card avoid-break">
      <div class="card-header" style="background:#7c3aed">${esc(c.name)}</div>
      <div class="card-body">
        <p class="body-text">${esc(c.positioningStatement || '')}</p>
        ${(c.strengths || []).length ? `<p class="label" style="margin-top:10px">Strengths</p><ul class="bullet-list">${c.strengths.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        ${(c.weaknesses || []).length ? `<p class="label" style="margin-top:10px">Weaknesses</p><ul class="bullet-list">${c.weaknesses.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>`).join('');

  // ── Chapter 3: Social ──
  const socialBrands = (social.brands || []).filter(b => !b.isTarget);
  const socialHtml = socialBrands.map(b => {
    const ig = b.instagram || {};
    const tt = b.tiktok || {};
    const igEng = ig.summary?.avgEngagement || 0;
    const ttEng = tt.summary?.avgEngagement || 0;
    return `<div class="card avoid-break">
      <div class="card-header" style="background:#0ea5e9">${esc(b.name)}</div>
      <div class="card-body">
        <div class="two-col">
          <div><p class="label">Instagram</p><p class="stat">${igEng > 0 ? igEng.toLocaleString() : '—'} avg engagement</p>${ig.summary?.postCount ? `<p class="body-text">${ig.summary.postCount} posts</p>` : ''}</div>
          <div><p class="label">TikTok</p><p class="stat">${ttEng > 0 ? ttEng.toLocaleString() : '—'} avg engagement</p>${tt.summary?.postCount ? `<p class="body-text">${tt.summary.postCount} posts</p>` : ''}</div>
        </div>
        ${ig.topContent?.length ? `<p class="label" style="margin-top:12px">Top content themes</p><ul class="bullet-list">${ig.topContent.slice(0,3).map(t=>`<li>${esc(t.theme||t.caption||t)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>`;
  }).join('');

  // ── Chapter 4: Digital Presence ──
  const navGaps = (site.navGaps || []).filter(g => g.priority === 'high');
  const msgGaps = (site.messagingGaps || []);
  const crawlerVis = site.crawlerVisibility || {};

  const navGapsHtml = navGaps.map(g => `
    <div class="row-item avoid-break">
      <span class="badge badge-red">Missing</span>
      <div><strong>${esc(g.category)}</strong>${g.competitorsWithIt?.length ? `<span class="muted"> — available at ${esc(g.competitorsWithIt.join(', '))}</span>` : ''}</div>
    </div>`).join('');

  const msgGapsHtml = msgGaps.map(mg => `
    <div class="card avoid-break" style="border-left:3px solid #6366f1;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:10px">
      <p style="color:#4f46e5;font-weight:700;font-size:14px;margin-bottom:4px">${esc(mg.recommendation || mg.gap)}</p>
      ${mg.recommendation && mg.gap ? `<p class="muted" style="font-size:12px">Currently missing: ${esc(mg.gap)}</p>` : ''}
      ${mg.competitorExample ? `<p class="muted" style="font-size:12px;margin-top:4px">Example: ${esc(mg.competitorExample)}</p>` : ''}
    </div>`).join('');

  // ── Chapter 5: SEO — verified findings only ──
  const onPage = seo.onPageSeo || {};
  const pageAnalyses = seo.pageAnalyses || [];
  const sitemap = seo.sitemapAnalysis || {};
  const catPages = pageAnalyses.filter(p => p.pageType === 'category');
  const allSameH1 = catPages.length > 1 && catPages.every(p => p.h1 === catPages[0].h1);
  const allSameTitle = catPages.length > 1 && catPages.every(p => p.titleTag === catPages[0].titleTag);
  const noMeta = pageAnalyses.length > 0 && pageAnalyses.every(p => !p.metaDescription);
  const noH1 = !onPage.h1;
  const noProductsInSitemap = sitemap.found && sitemap.byType?.product === 0;

  const seoFindings = [];
  if ((allSameH1 || allSameTitle) && catPages.length > 0) {
    seoFindings.push({ severity: 'critical', title: 'Every category page has the same title and H1',
      body: `All category pages share the same title tag "${esc(catPages[0].titleTag)}" and H1 "${esc(catPages[0].h1 || '(none)')}" — Google treats them as duplicate pages and none rank for anything.`,
      fix: 'Give each category page a unique title and H1 containing the category name and "Lebanon." This is a single template change that applies to all pages at once.' });
  }
  if (noMeta) {
    seoFindings.push({ severity: 'critical', title: 'No meta descriptions on any page',
      body: 'Every page — homepage and all category pages — has a blank meta description. Google writes your search snippet with random body text, which looks unprofessional and gets fewer clicks.',
      fix: 'Write 140–160 character meta descriptions for the homepage and each category page. Category pages can use a template: "Shop [Category] toys in Lebanon at Toys R Us. Huge range, trusted brands, fast delivery."' });
  }
  if (noH1) {
    seoFindings.push({ severity: 'high', title: 'Homepage hero text is baked into an image — invisible to Google',
      body: `The homepage H1 is empty. The headline "Fun for the whole family!" lives inside a banner image — Google and AI crawlers cannot read it. The page title is just "${esc(onPage.titleTag || 'Toys R Us')}".`,
      fix: 'Add a live-text H1 overlaid on or adjacent to the hero. Example: "Lebanon\'s Favourite Toy Store — Thousands of Toys for Every Age." Update page title to "Toys R Us Lebanon — Official Toy Store | Shop Online".' });
  }
  if (noProductsInSitemap) {
    seoFindings.push({ severity: 'high', title: `Sitemap has ${(sitemap.totalUrls||0).toLocaleString()} URLs — but 0 product pages`,
      body: 'The sitemap tells Google which pages exist. Yours has no product pages listed — meaning Google may not know your entire product catalog exists. It\'s also not referenced in robots.txt.',
      fix: 'Ask your developer to regenerate the sitemap to include all product and category URLs, then add "Sitemap: https://toysrus.com.lb/sitemap.xml" to robots.txt. Submit directly in Google Search Console.' });
  }

  const seoHtml = seoFindings.map(f => `
    <div class="card avoid-break" style="border:1px solid ${f.severity==='critical'?'#fca5a5':'#fcd34d'};margin-bottom:16px">
      <div style="background:${f.severity==='critical'?'#fef2f2':'#fffbeb'};padding:14px 20px;display:flex;gap:12px;align-items:center;border-bottom:1px solid ${f.severity==='critical'?'#fca5a5':'#fcd34d'}">
        <span class="badge ${f.severity==='critical'?'badge-red':'badge-orange'}">${f.severity}</span>
        <strong style="font-size:14px;color:${f.severity==='critical'?'#991b1b':'#78350f'}">${f.title}</strong>
      </div>
      <div class="card-body">
        <p class="body-text">${f.body}</p>
        <div class="how-box" style="margin-top:12px"><strong>Fix:</strong> ${f.fix}</div>
      </div>
    </div>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(profile.name || 'Brand')} Intelligence Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #1a1a1a; font-size: 14px; line-height: 1.6; }

  /* ── Cover ── */
  .cover { background: #111; color: #fff; padding: 60px 48px; min-height: 200px; }
  .cover h1 { font-size: 32px; font-weight: 800; letter-spacing: -0.02em; }
  .cover .sub { color: #aaa; font-size: 16px; margin-top: 8px; }
  .cover .date { color: #666; font-size: 13px; margin-top: 24px; }

  /* ── Layout ── */
  .container { max-width: 900px; margin: 0 auto; padding: 40px 32px; }

  /* ── Chapter headers ── */
  .chapter { margin-top: 48px; margin-bottom: 24px; page-break-before: always; }
  .chapter:first-of-type { page-break-before: auto; }
  .chapter-label { font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .chapter-title { font-size: 22px; font-weight: 800; color: #111; }
  .chapter-divider { height: 2px; background: #f3f4f6; margin-bottom: 16px; }
  .chapter-intro { color: #4b5563; font-size: 14px; line-height: 1.75; margin-bottom: 24px; }

  /* ── Cards ── */
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
  .card-header { padding: 14px 20px; color: #fff; font-size: 14px; font-weight: 700; }
  .card-body { padding: 16px 20px; }
  .avoid-break { page-break-inside: avoid; break-inside: avoid; }

  /* ── Executive summary ── */
  .exec-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 24px 28px; margin-bottom: 32px; page-break-inside: avoid; }
  .exec-box p { font-size: 15px; line-height: 1.8; color: #374151; }

  /* ── Text styles ── */
  .body-text { color: #4b5563; font-size: 13px; line-height: 1.65; }
  .muted { color: #9ca3af; }
  .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 6px; }
  .stat { font-size: 18px; font-weight: 800; color: #111; }
  .bullet-list { padding-left: 18px; margin-top: 6px; }
  .bullet-list li { font-size: 13px; color: #4b5563; margin-bottom: 4px; line-height: 1.55; }

  /* ── Badges ── */
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-orange { background: #fef3c7; color: #92400e; }
  .badge-green { background: #d1fae5; color: #065f46; }

  /* ── Row items ── */
  .row-item { display: flex; gap: 12px; align-items: flex-start; padding: 10px 14px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; page-break-inside: avoid; }
  .row-item strong { font-size: 13px; }

  /* ── How box ── */
  .how-box { background: #f0fdf4; border-left: 3px solid #10b981; border-radius: 0 8px 8px 0; padding: 10px 14px; margin-top: 10px; }
  .how-box strong { color: #065f46; font-size: 12px; }
  .how-box, .how-box * { font-size: 12px; color: #14532d; line-height: 1.6; }

  /* ── Two column ── */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* ── Opportunity cards ── */
  .opp-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-bottom: 24px; page-break-inside: avoid; }
  .opp-card { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; page-break-inside: avoid; }
  .opp-card-header { padding: 14px 16px; color: #fff; }
  .opp-card-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; opacity: 0.85; margin-bottom: 4px; }
  .opp-card-title { font-size: 13px; font-weight: 800; line-height: 1.3; }
  .opp-card-body { padding: 14px 16px; }
  .opp-card-body p { font-size: 12px; color: #4b5563; line-height: 1.65; margin-bottom: 10px; }

  /* ── Footer ── */
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 12px; page-break-inside: avoid; }

  /* ── Print ── */
  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .chapter { page-break-before: always; }
    .chapter:first-of-type { page-break-before: auto; }
  }
</style>
</head>
<body>

<!-- Cover -->
<div class="cover">
  <div style="max-width:900px;margin:0 auto">
    <p style="color:#6366f1;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Brand Intelligence Report</p>
    <h1>${esc(profile.name || 'Brand')}</h1>
    <p class="sub">${esc(profile.industry || '')}${profile.url ? ` &mdash; ${esc(profile.url)}` : ''}</p>
    <p class="date">Generated ${date} &nbsp;&bull;&nbsp; Confidential</p>
  </div>
</div>

<div class="container">

  <!-- Executive Summary -->
  ${actionPlan.executiveSummary ? `
  <div style="margin-top:40px">
    <p class="label">Executive Summary</p>
    <div class="exec-box avoid-break">
      <p>${esc(actionPlan.executiveSummary)}</p>
    </div>
  </div>` : ''}

  <!-- Chapter 1: Customers -->
  ${personasHtml ? `
  <div class="chapter">
    <div class="chapter-divider"></div>
    <p class="chapter-label">Chapter 1</p>
    <h2 class="chapter-title">Your Customers — Who You're Really Selling To</h2>
  </div>
  <p class="chapter-intro">Understanding who walks through the door (or visits the site) is the foundation of every other decision — what to stock, how to communicate, where to spend marketing budget.</p>
  ${personasHtml}` : ''}

  <!-- Chapter 2: Competition -->
  ${competitorsHtml ? `
  <div class="chapter">
    <div class="chapter-divider"></div>
    <p class="chapter-label">Chapter 2</p>
    <h2 class="chapter-title">The Competition — Where You Win and Where You Don't</h2>
  </div>
  <p class="chapter-intro">These are the brands competing for the same customer in the same market. Each one has a distinct position, and understanding that position reveals where the white space is.</p>
  ${competitorsHtml}` : ''}

  <!-- Chapter 3: Social -->
  ${socialHtml ? `
  <div class="chapter">
    <div class="chapter-divider"></div>
    <p class="chapter-label">Chapter 3</p>
    <h2 class="chapter-title">Social Media — What's Working in This Market</h2>
  </div>
  <p class="chapter-intro">This data is based on scraped competitor social activity — showing what content resonates with your shared customer base and where the engagement opportunities are.</p>
  ${socialHtml}` : ''}

  <!-- Chapter 4: Digital Presence -->
  <div class="chapter">
    <div class="chapter-divider"></div>
    <p class="chapter-label">Chapter 4</p>
    <h2 class="chapter-title">Your Digital Presence — Where You're Losing Customers</h2>
  </div>
  <p class="chapter-intro">A customer who lands on your website has already found you — but the site has to convert them.</p>

  ${crawlerVis.heroTextIsLive === false ? `
  <div class="card avoid-break" style="background:#fff7ed;border:1px solid #fdba74;margin-bottom:16px">
    <div class="card-body">
      <p style="color:#9a3412;font-weight:700;font-size:13px;margin-bottom:6px">Critical: Your homepage hero is invisible to Google and AI</p>
      <p class="body-text" style="color:#7c2d12">${esc(crawlerVis.aiReadabilityNote || '')}</p>
    </div>
  </div>` : ''}

  ${navGapsHtml ? `
  <p style="font-weight:700;font-size:14px;margin-bottom:8px">Navigation categories your competitors have that you don't</p>
  ${navGapsHtml}` : ''}

  <!-- Revenue Opportunities -->
  <p style="font-weight:700;font-size:14px;margin:24px 0 8px">Three revenue unlocks hiding in plain sight</p>
  <p class="body-text" style="margin-bottom:16px">Each of these is a page or category that competitors with smaller budgets have already built.</p>
  <div class="opp-grid">
    <div class="opp-card avoid-break">
      <div class="opp-card-header" style="background:#0ea5e9">
        <p class="opp-card-label">Opportunity 1</p>
        <p class="opp-card-title">Add an Infant &amp; Toddler Category (0–2 Years)</p>
      </div>
      <div class="opp-card-body">
        <p>Chez Les Petits, Wild Willy Toys, The Toy Store LB, Mumzworld, and FirstCry Lebanon all have dedicated Baby &amp; Toddler sections. Toys R Us Lebanon doesn't — ceding the highest-spending parent demographic to every competitor.</p>
        <div class="how-box"><strong>How:</strong> Create a dedicated "Ages 0–2" landing page, tag existing products with the age range, and run a gift-guide campaign targeting new-parent communities.</div>
      </div>
    </div>
    <div class="opp-card avoid-break">
      <div class="opp-card-header" style="background:#8b5cf6">
        <p class="opp-card-label">Opportunity 2</p>
        <p class="opp-card-title">Add a Gift Finder</p>
      </div>
      <div class="opp-card-body">
        <p>JouéClub Lebanon, The Toy Store LB, and Hamley's all have a Gift Finder in navigation. Finding the right gift is the #1 reason people visit a toy store. Every shopper without a Gift Finder to guide them leaves to find an answer elsewhere.</p>
        <div class="how-box"><strong>How:</strong> Build a Gift Finder page with 3 filters: age bracket, interest category, and price range. Add to main navigation. This is the single highest-converting page type in toy retail.</div>
      </div>
    </div>
    <div class="opp-card avoid-break">
      <div class="opp-card-header" style="background:#10b981">
        <p class="opp-card-label">Opportunity 3</p>
        <p class="opp-card-title">Build Age-Based Landing Pages</p>
      </div>
      <div class="opp-card-body">
        <p>"Toys for 6-year-olds" is one of the highest-intent toy searches in every market. Parents search by age — not by brand or category. Age-based landing pages are how toy retailers capture this intent and rank for it on Google.</p>
        <div class="how-box"><strong>How:</strong> Create 4–5 static landing pages organized by age bracket (3–5, 6–8, 9–12, Teens). Cross-link from homepage and navigation. Once indexed, they drive organic traffic indefinitely.</div>
      </div>
    </div>
  </div>

  ${msgGapsHtml ? `
  <p style="font-weight:700;font-size:14px;margin:24px 0 4px">Messaging moves that will set you apart</p>
  <p class="body-text" style="margin-bottom:16px">These are value messages your competitors are already communicating — adding them to your site is a fast, high-leverage way to increase trust and conversion.</p>
  ${msgGapsHtml}` : ''}

  <!-- Chapter 5: SEO -->
  <div class="chapter">
    <div class="chapter-divider"></div>
    <p class="chapter-label">Chapter 5</p>
    <h2 class="chapter-title">Search &amp; SEO — Your Biggest Untapped Growth Channel</h2>
  </div>
  <p class="chapter-intro">We crawled your site and verified these issues directly from the page data — not estimated. Fix these and you build the foundation for both organic search and AI search at once.</p>

  ${seoHtml || '<p class="body-text">SEO analysis not yet generated.</p>'}

</div>

<div class="footer" style="max-width:900px;margin:48px auto 32px;padding:16px 32px 32px">
  Brand Intelligence Report &bull; ${esc(profile.name || '')} &bull; ${date} &bull; Confidential
</div>

</body>
</html>`);
});

// ─── Locally-cached social post images (public, BEFORE basicAuth) ─────────────
// slug/filename are attacker-controlled and this route runs BEFORE auth, so they must be
// constrained hard. Express decodes %2e%2e%2f to ../ and path.join normalizes it away, so a
// bare join let an unauthenticated caller climb out of the images dir and read social session
// cookies and share tokens off the volume. Allowlist the segments, then require the resolved
// path to stay inside the images directory.
const _SEG_OK = /^[a-z0-9][a-z0-9._-]*$/i;
app.get('/api/social-image/:slug/:filename', (req, res) => {
  const { slug, filename } = req.params;
  if (!_SEG_OK.test(slug) || !_SEG_OK.test(filename)) return res.status(400).end();
  const base = path.join(BRANDS_DIR, slug, 'social_images');
  const imgPath = path.resolve(base, filename);
  if (!imgPath.startsWith(path.resolve(base) + path.sep)) return res.status(400).end();
  if (!fs.existsSync(imgPath)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(imgPath);
});

// ─── Auth (applied after public routes) ───────────────────────────────────────
// Sign-in is whp-auth's job. People are individual accounts there, granted this tool by name,
// with two-factor and an audit trail.
//
// What this replaced: shared basic-auth credentials, and a `|| 'changeme'` fallback that made
// the live password the literal string "changeme" whenever the env var was missing.
//
// The routes deliberately registered ABOVE this line stay public and are unchanged: the health
// check, /share/:token, and the cached social images. Share links are meant to be openable by
// people with no account, which is the whole point of them.
const { requireUser } = require('./whpAuth');

// What the login box needs. No secrets, and outside the gate so the login page can load.
app.get('/api/config', (_req, res) => res.json({
  whp_auth_url: (process.env.WHP_AUTH_URL || '').replace(/\/$/, ''),
  app: (process.env.WHP_AUTH_APP || 'brand-intelligence'),
}));

app.use('/api', requireUser);
app.get('/api/me', (req, res) => res.json({ ok: true, user: req.user }));

// ─── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ─── Session Cookies Settings ─────────────────────────────────────────────────

const SOCIAL_COOKIES_FILE = path.join(DATA_DIR, 'social_cookies.json');

function readSocialCookies() {
  try { return JSON.parse(fs.readFileSync(SOCIAL_COOKIES_FILE, 'utf8')); } catch { return {}; }
}

// GET /api/settings/social-cookies — returns configured status (no actual cookie values)
app.get('/api/settings/social-cookies', (req, res) => {
  const data = readSocialCookies();
  res.json({
    ok: true,
    instagram: { configured: Array.isArray(data.instagram) && data.instagram.length > 0, count: (data.instagram || []).length },
    facebook: { configured: Array.isArray(data.facebook) && data.facebook.length > 0, count: (data.facebook || []).length },
  });
});

// POST /api/settings/social-cookies — saves cookie arrays
app.post('/api/settings/social-cookies', (req, res) => {
  const { instagram, facebook } = req.body || {};
  const existing = readSocialCookies();
  const updated = { ...existing };
  if (instagram !== undefined) updated.instagram = instagram;
  if (facebook !== undefined) updated.facebook = facebook;
  fs.writeFileSync(SOCIAL_COOKIES_FILE, JSON.stringify(updated, null, 2));
  res.json({ ok: true });
});

// ─── Manual Social Import ──────────────────────────────────────────────────────

function normalizeImportedPosts(rawPosts, platform) {
  return rawPosts.map(p => {
    if (platform === 'instagram') {
      return {
        likes: p.likesCount || p.edge_liked_by?.count || p.likes || 0,
        comments: p.commentsCount || p.edge_media_to_comment?.count || p.comments || 0,
        caption: (p.caption || p.edge_media_to_caption?.edges?.[0]?.node?.text || '').slice(0, 300),
        timestamp: p.timestamp || (p.taken_at_timestamp ? new Date(p.taken_at_timestamp * 1000).toISOString() : null),
        postUrl: p.shortCode ? `https://instagram.com/p/${p.shortCode}` : (p.postUrl || null),
        imageUrl: p.displayUrl || p.imageUrl || null,
        type: p.type || 'Image',
      };
    }
    if (platform === 'facebook') {
      return {
        likes: p.likes || 0,
        comments: p.comments || 0,
        caption: (p.message || p.caption || p.text || '').slice(0, 300),
        timestamp: p.timestamp || p.time || p.created_time || null,
        postUrl: p.postUrl || p.url || null,
        imageUrl: p.imageUrl || null,
      };
    }
    return p;
  });
}

function buildImportedPlatformData(posts) {
  if (!posts || posts.length === 0) return null;
  const totalLikes = posts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comments || 0), 0);
  const avgEngagement = Math.round((totalLikes + totalComments) / posts.length);
  const now = Date.now();
  const last30 = posts.filter(p => p.timestamp && (now - new Date(p.timestamp)) < 30 * 24 * 3600 * 1000);
  const topPosts = [...posts].sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments)).slice(0, 3);
  const themeKeywords = {
    'Product Showcase': ['new', 'collection', 'available', 'shop', 'now'],
    'Lifestyle': ['lifestyle', 'mood', 'vibe', 'inspiration', 'everyday'],
    'Promotional': ['sale', 'off', '% off', 'discount', 'deal', 'save'],
    'Behind the Scenes': ['bts', 'behind', 'team', 'making', 'process'],
    'Seasonal': ['fall', 'winter', 'spring', 'summer', 'holiday', 'season'],
  };
  const counts = {};
  posts.forEach(p => {
    const text = (p.caption || '').toLowerCase();
    Object.entries(themeKeywords).forEach(([theme, kws]) => {
      if (kws.some(k => text.includes(k))) counts[theme] = (counts[theme] || 0) + 1;
    });
  });
  const contentThemes = Object.entries(counts).map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count);
  return {
    summary: { postCount: posts.length, avgEngagement, postingFrequencyPerWeek: Math.round((last30.length / 4.3) * 10) / 10 },
    topPosts,
    contentThemes,
    monthlyTrend: [],
    manuallyImported: true,
    importedAt: new Date().toISOString(),
  };
}

// POST /api/brands/:slug/social-manual-import
app.post('/api/brands/:slug/social-manual-import', (req, res) => {
  const { slug } = req.params;
  const { platform, posts: rawPosts } = req.body || {};
  if (!platform || !Array.isArray(rawPosts) || rawPosts.length === 0) {
    return res.status(400).json({ error: 'platform and posts[] are required' });
  }
  const siPath = path.join(DATA_DIR, 'brands', slug, 'social_intelligence.json');
  let si;
  try { si = JSON.parse(fs.readFileSync(siPath, 'utf8')); }
  catch { return res.status(404).json({ error: 'social_intelligence.json not found for this brand — run the Social Audit first' }); }

  const normalized = normalizeImportedPosts(rawPosts, platform);
  const platformData = buildImportedPlatformData(normalized);

  si.brands = si.brands.map(b => {
    if (b.role !== 'target') return b;
    if (platform === 'instagram') {
      const summary = platformData.summary;
      return {
        ...b,
        summary,
        topPosts: platformData.topPosts,
        contentThemes: platformData.contentThemes,
        allPosts: normalized,
        partialData: false,
        manuallyImported: true,
      };
    }
    if (platform === 'facebook') {
      return { ...b, facebookData: platformData };
    }
    return b;
  });
  si.updatedAt = new Date().toISOString();
  fs.writeFileSync(siPath, JSON.stringify(si, null, 2));
  res.json({ ok: true, platform, postCount: normalized.length, avgEngagement: platformData.summary.avgEngagement });
});

// ─── Brand Registry Routes ─────────────────────────────────────────────────────

// GET /api/brands — list all brands
app.get('/api/brands', (req, res) => {
  const registry = loadBrandsRegistry();
  let dirty = false;
  const brands = registry.brands.map(b => {
    const moduleStatus = getBrandStatus(b.slug);
    // Auto-clear stuck 'running' status when at least one module has completed
    if (b.discoveryStatus === 'running' && moduleStatus.some(m => m.exists)) {
      b.discoveryStatus = 'complete';
      dirty = true;
    }
    return { ...b, healthStatus: getHealthStatus(b.slug), moduleStatus };
  });
  if (dirty) saveBrandsRegistry(registry);
  res.json({ brands });
});

// POST /api/brands — add a brand by URL, spawns async discovery
app.post('/api/brands', (req, res) => {
  const { url, name } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  // Validate URL format
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL format' }); }

  const tentativeName = name || new URL(url).hostname.replace(/^www\./, '');
  const slug = uniqueSlug(tentativeName);

  const registry = loadBrandsRegistry();
  const entry = {
    slug,
    name: tentativeName,
    url,
    industry: null,
    addedAt: new Date().toISOString(),
    lastRefreshedAt: null,
    discoveryStatus: 'running',
    healthStatus: 'never_run',
  };
  registry.brands.push(entry);
  saveBrandsRegistry(registry);

  // Ensure brand directory exists
  ensureDir(path.join(BRANDS_DIR, slug));
  ensureDir(path.join(BRANDS_DIR, slug, 'history'));

  // Spawn discovery async
  const child = spawn('node', [path.join(__dirname, 'analysis/brand_discovery.js'), `--slug=${slug}`, `--url=${url}`], {
    env: { ...process.env },
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  res.json({ ok: true, slug, discoveryStatus: 'running' });
});

// GET /api/brands/:slug — single brand
app.get('/api/brands/:slug', (req, res) => {
  const registry = loadBrandsRegistry();
  const brand = registry.brands.find(b => b.slug === req.params.slug);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json({ ...brand, healthStatus: getHealthStatus(brand.slug), moduleStatus: getBrandStatus(brand.slug) });
});

// DELETE /api/brands/:slug — remove brand and all its data
app.delete('/api/brands/:slug', (req, res) => {
  const { slug } = req.params;
  const registry = loadBrandsRegistry();
  registry.brands = registry.brands.filter(b => b.slug !== slug);
  saveBrandsRegistry(registry);
  const brandDir = path.join(BRANDS_DIR, slug);
  if (fs.existsSync(brandDir)) fs.rmSync(brandDir, { recursive: true, force: true });
  res.json({ ok: true });
});

// GET /api/brands/:slug/profile
app.get('/api/brands/:slug/profile', (req, res) => {
  const data = loadBrandData(req.params.slug, 'profile.json');
  if (!data) return res.status(404).json({ error: 'Profile not found — brand may still be discovering' });
  res.json(data);
});

// PUT /api/brands/:slug/profile — update editable fields
app.put('/api/brands/:slug/profile', (req, res) => {
  const { slug } = req.params;
  const existing = loadBrandData(slug, 'profile.json') || {};
  const body = { ...req.body };
  // Competitors saved from the UI are always manually curated — mark them as protected
  if (Array.isArray(body.identifiedCompetitors)) {
    body.identifiedCompetitors = body.identifiedCompetitors.map(c => ({ ...c, manuallySet: true }));
  }
  const updated = { ...existing, ...body, slug, updatedAt: new Date().toISOString() };
  saveBrandData(slug, 'profile.json', updated);
  // Sync name to registry if changed
  if (req.body.name) {
    const registry = loadBrandsRegistry();
    const idx = registry.brands.findIndex(b => b.slug === slug);
    if (idx !== -1) { registry.brands[idx].name = req.body.name; saveBrandsRegistry(registry); }
  }
  res.json({ ok: true });
});

// GET /api/brands/:slug/status — per-module freshness
app.get('/api/brands/:slug/status', (req, res) => {
  res.json({ slug: req.params.slug, modules: getBrandStatus(req.params.slug) });
});

// GET /api/brands/:slug/history/:module — history snapshots
app.get('/api/brands/:slug/history/:module', (req, res) => {
  const { slug, module } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 30, 90);
  const histDir = path.join(BRANDS_DIR, slug, 'history');
  if (!fs.existsSync(histDir)) return res.json({ snapshots: [] });
  const files = fs.readdirSync(histDir)
    .filter(f => f.startsWith(module + '_') && f.endsWith('.json'))
    .sort().reverse().slice(0, limit);
  const snapshots = files.map(f => {
    const date = f.replace(module + '_', '').replace('.json', '');
    try { return { date, data: JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8')) }; }
    catch { return { date, error: true }; }
  });
  res.json({ module, snapshots });
});

// ─── Brand Data Routes ─────────────────────────────────────────────────────────

const BRAND_MODULES = [
  { name: 'competitive_analysis', file: 'competitive_analysis.json', script: 'analysis/competitive_analysis.js' },
  { name: 'personas',             file: 'personas.json',             script: 'analysis/personas.js' },
  { name: 'social_intelligence',  file: 'social_intelligence.json',  script: 'analysis/social_audit.js' },
  { name: 'site_intelligence',    file: 'site_intelligence.json',    script: 'analysis/website_audit.js' },
  { name: 'search_seo',           file: 'search_seo.json',           script: 'analysis/search_seo.js' },
  { name: 'action_plan',          file: 'action_plan.json',          script: 'analysis/action_plan.js' },
];

BRAND_MODULES.forEach(({ name, file }) => {
  app.get(`/api/brands/:slug/${name}`, (req, res) => {
    const data = loadBrandData(req.params.slug, file);
    if (!data) return res.status(404).json({ error: `${name} not yet generated` });
    res.json(data);
  });
});

// POST /api/brands/:slug/refresh/:module — trigger individual module refresh
app.post('/api/brands/:slug/refresh/all', (req, res) => {
  const { slug } = req.params;
  const registry = loadBrandsRegistry();
  const brand = registry.brands.find(b => b.slug === slug);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const profilePath = path.join(BRANDS_DIR, slug, 'profile.json');
  const hasProfile = fs.existsSync(profilePath);

  // If profile exists, just re-run analysis modules. If not, run full discovery first.
  const spawnArgs = hasProfile
    ? [path.join(__dirname, 'analysis/brand_discovery.js'), `--slug=${slug}`, '--refresh-all']
    : [path.join(__dirname, 'analysis/brand_discovery.js'), `--slug=${slug}`, `--url=${brand.url}`];

  const reg2 = loadBrandsRegistry();
  const bidx = reg2.brands.findIndex(b => b.slug === slug);
  if (bidx !== -1) { reg2.brands[bidx].discoveryStatus = 'running'; saveBrandsRegistry(reg2); }

  const logFile = path.join(DATA_DIR, 'brands', slug, 'discovery.log');
  const logStream = fs.openSync(logFile, 'w');
  const child = spawn('node', spawnArgs, {
    env: { ...process.env },
    cwd: __dirname,
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });
  child.unref();
  res.json({ ok: true, slug, status: 'running' });
});

app.post('/api/brands/:slug/refresh/:module', (req, res) => {
  const { slug, module: moduleName } = req.params;
  const registry = loadBrandsRegistry();
  if (!registry.brands.find(b => b.slug === slug)) {
    return res.status(404).json({ error: 'Brand not found' });
  }
  const mod = BRAND_MODULES.find(m => m.name === moduleName);
  if (!mod) return res.status(400).json({ error: `Unknown module: ${moduleName}` });

  let moduleStdio = 'ignore';
  try {
    const moduleLogPath = path.join(BRANDS_DIR, slug, `${moduleName}.log`);
    const logFd = fs.openSync(moduleLogPath, 'a');
    moduleStdio = ['ignore', logFd, logFd];
  } catch (_) {}
  const child = spawn('node', [path.join(__dirname, mod.script), `--slug=${slug}`], {
    env: { ...process.env },
    cwd: __dirname,
    detached: true,
    stdio: moduleStdio,
  });
  child.unref();
  res.json({ ok: true, slug, module: moduleName, status: 'running' });
});

// GET /api/brands/:slug/data-size — storage used by brand
app.get('/api/brands/:slug/data-size', (req, res) => {
  const brandDir = path.join(BRANDS_DIR, req.params.slug);
  if (!fs.existsSync(brandDir)) return res.json({ bytes: 0 });
  let total = 0;
  function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) walk(fp);
      else total += fs.statSync(fp).size;
    }
  }
  walk(brandDir);
  res.json({ bytes: total, kb: Math.round(total / 1024), mb: (total / 1048576).toFixed(2) });
});

// ─── Persona Chat (streaming SSE) ─────────────────────────────────────────────
app.post('/api/brands/:slug/persona-chat', async (req, res) => {
  const { slug } = req.params;
  const { personaIndex, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const personasData = loadBrandData(slug, 'personas.json');
  const persona = personasData?.personas?.[personaIndex ?? 0];
  if (!persona) return res.status(404).json({ error: 'Persona not found' });

  const profile = loadBrandData(slug, 'profile.json') || {};
  const brandName = profile.name || 'this brand';

  const system = `You are roleplaying as a real customer named ${persona.name}.

Here is everything about you:
- Age range: ${persona.ageRange}
- Income: ${persona.income}
- Occupation: ${(persona.occupation || []).join(', ')}
- Location: ${persona.location}
- Lifestyle: ${(persona.lifestyle || []).join(' | ')}
- Values: ${(persona.values || []).join(' | ')}
- Fashion goals: ${(persona.fashionGoals || []).join(' | ')}
- Shopping behaviors: ${(persona.shoppingBehaviors || []).join(' | ')}
- Pain points: ${(persona.painPoints || []).join(' | ')}
- Motivators: ${(persona.motivators || []).join(' | ')}
- Preferred channels: ${(persona.preferredChannels || []).join(', ')}

Brand being discussed: ${brandName}
Industry: ${profile.industry || 'fashion/retail'}
Brand positioning: ${profile.positioning || ''}

Rules:
- Speak as this person would — naturally, conversationally, from lived experience
- Reference your specific pain points, values, and shopping behaviors when relevant
- Do not use marketing language or brand voice
- If asked what you think about ${brandName}, answer honestly from your character's perspective
- Keep answers to 2-4 sentences unless the question requires more
- Never break character or acknowledge you are an AI`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = anthropic.messages.stream({
      model: MODEL_FAST,
      max_tokens: 2500,
      output_config: EFFORT_LOW,
      system,
      messages,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ token: event.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
});

// ─── Suggest Adjacent Personas ─────────────────────────────────────────────────
app.post('/api/brands/:slug/suggest-personas', async (req, res) => {
  const { slug } = req.params;
  const personasData = loadBrandData(slug, 'personas.json');
  const existing = personasData?.personas || [];
  const profile = loadBrandData(slug, 'profile.json') || {};
  const competitive = loadBrandData(slug, 'competitive_analysis.json') || {};
  const social = loadBrandData(slug, 'social_intelligence.json') || {};

  const prompt = `Based on the brand context and existing personas below, identify 2-3 adjacent customer segments that ${profile.name || 'this brand'} is not currently addressing but should consider.

BRAND: ${profile.name}
INDUSTRY: ${profile.industry}
POSITIONING: ${profile.positioning || ''}

EXISTING PERSONAS (do not duplicate these):
${existing.map(p => `- ${p.name}: ${p.ageRange}, ${p.income}, ${(p.occupation||[]).join('/')}`).join('\n')}

COMPETITIVE CONTEXT:
${(competitive.competitors || []).slice(0, 3).map(c => `- ${c.name}: ${c.positioningStatement || ''}`).join('\n')}

Return JSON with this exact structure:
{
  "suggestions": [
    {
      "name": "evocative label like The Executive Achiever",
      "ageRange": "",
      "income": "",
      "occupation": [],
      "rationale": "1-2 sentences on why this brand should address this segment",
      "opportunitySize": "high/medium/low",
      "keyDifference": "1 sentence on how they differ from existing personas"
    }
  ]
}`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: 3000,
      output_config: EFFORT_LOW,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = extractText(msg);
    const start = raw.indexOf('{');
    let result = { suggestions: [] };
    if (start !== -1) {
      let depth = 0, end = -1;
      for (let i = start; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) result = JSON.parse(raw.slice(start, end + 1));
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Export: Share Link ─────────────────────────────────────────────────────────
app.post('/api/brands/:slug/export/share-link', (req, res) => {
  const { slug } = req.params;
  const registry = loadBrandsRegistry();
  if (!registry.brands.find(b => b.slug === slug)) {
    return res.status(404).json({ error: 'Brand not found' });
  }
  const token = uuidv4();
  const tokensData = loadShareTokens();
  tokensData.tokens.push({
    token,
    brandSlug: slug,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  });
  saveShareTokens(tokensData);
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  res.json({ ok: true, shareUrl: `${baseUrl}/share/${token}`, token });
});

// ─── Export: PDF ───────────────────────────────────────────────────────────────
app.post('/api/brands/:slug/export/pdf', async (req, res) => {
  const { slug } = req.params;
  const registry = loadBrandsRegistry();
  if (!registry.brands.find(b => b.slug === slug)) {
    return res.status(404).json({ error: 'Brand not found' });
  }

  try {
    // Get credentials to authenticate Puppeteer
    const [pdfUser, pdfPass] = Object.entries(users)[0];

    let browser;
    try {
      const chromium = require('@sparticuz/chromium');
      const puppeteer = require('puppeteer-core');
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    } catch {
      // Local dev fallback
      const puppeteer = require('puppeteer-core');
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      });
    }

    const page = await browser.newPage();
    await page.authenticate({ username: pdfUser, password: pdfPass });
    await page.setViewport({ width: 1100, height: 900 });
    // Load the real React app in PDF mode — shows the actual Action Plan UI
    await page.goto(`http://localhost:${PORT}/?brand=${slug}&tab=action&pdf=1`, { waitUntil: 'networkidle2', timeout: 45000 });
    // Wait for the action plan content to render
    await new Promise(r => setTimeout(r, 2000));
    // Add page-break CSS for clean pagination
    await page.addStyleTag({ content: `
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @media print {
        body { background: #fff !important; }
      }
      /* Keep cards together across page breaks */
      [style*="border-radius"][style*="border"] { page-break-inside: avoid; break-inside: avoid; }
      /* Force chapter section headers to start on a new page */
      .chapter-break { page-break-before: always; break-before: page; }
    ` });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
    await browser.close();

    const profile = loadBrandData(slug, 'profile.json') || {};
    const filename = `${slug}-brand-intelligence-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: `PDF generation failed: ${err.message}` });
  }
});

// SerpAPI key management removed — search visibility is measured through Claude
// only, so there is no third-party search key to store or report on.

// ─── Social audit live progress ───────────────────────────────────────────────

app.get('/api/brands/:slug/discovery-log', (req, res) => {
  const logPath = path.join(DATA_DIR, 'brands', req.params.slug, 'discovery.log');
  if (!fs.existsSync(logPath)) return res.json({ log: '' });
  res.json({ log: fs.readFileSync(logPath, 'utf8').slice(-3000) });
});

app.get('/api/brands/:slug/module-log/:module', (req, res) => {
  const logPath = path.join(BRANDS_DIR, req.params.slug, `${req.params.module}.log`);
  if (!fs.existsSync(logPath)) return res.json({ log: '' });
  res.json({ log: fs.readFileSync(logPath, 'utf8').slice(-3000) });
});

app.get('/api/brands/:slug/audit-progress', (req, res) => {
  const statusPath = path.join(DATA_DIR, 'brands', req.params.slug, '_audit_status.json');
  if (!fs.existsSync(statusPath)) return res.json({ running: false });
  try { res.json(JSON.parse(fs.readFileSync(statusPath, 'utf8'))); }
  catch { res.json({ running: false }); }
});

// ─── Image Proxy (bypasses Instagram CDN hotlink protection) ──────────────────

app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    clearTimeout(timer);
    if (!response.ok) return res.status(response.status).end();
    const ct = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buf = await response.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err) {
    res.status(500).end();
  }
});

// ─── Brand Guidelines Routes ──────────────────────────────────────────────────

// GET /api/brands/:slug/brand_guidelines
app.get('/api/brands/:slug/brand_guidelines', (req, res) => {
  const data = loadBrandData(req.params.slug, 'brand_guidelines.json');
  res.json(data || null);
});

// PUT /api/brands/:slug/brand_guidelines — save manual edits
app.put('/api/brands/:slug/brand_guidelines', (req, res) => {
  const { slug } = req.params;
  const existing = loadBrandData(slug, 'brand_guidelines.json') || {};
  const updated = { ...existing, ...req.body, updatedAt: new Date().toISOString() };
  saveBrandData(slug, 'brand_guidelines.json', updated);
  res.json({ ok: true });
});

// POST /api/brands/:slug/upload_style_guide — receive PDF upload
const pdfUpload = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(BRANDS_DIR, req.params.slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, 'style_guide.pdf'),
}) });
app.post('/api/brands/:slug/upload_style_guide', pdfUpload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, path: req.file.path });
});

// POST /api/brands/:slug/process_style_guide — spawn script, SSE stream stdout
app.post('/api/brands/:slug/process_style_guide', (req, res) => {
  const { slug } = req.params;
  const fileArg = req.body.file ? `--file=${req.body.file}` : null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const nodeArgs = [path.join(__dirname, 'analysis/process_style_guide.js'), `--slug=${slug}`];
  if (fileArg) nodeArgs.push(fileArg);

  const child = spawn('node', nodeArgs, {
    env: { ...process.env },
    cwd: __dirname,
  });

  child.stdout.on('data', chunk => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(line => res.write(`data: ${line}\n\n`));
  });
  child.stderr.on('data', chunk => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    lines.forEach(line => res.write(`data: [stderr] ${line}\n\n`));
  });
  child.on('close', code => {
    res.write(`data: __DONE__ exit=${code}\n\n`);
    res.end();
  });
  req.on('close', () => child.kill());
});

// ─── Static dashboard ─────────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dashboard', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/share')) {
      return res.sendFile(path.join(distPath, 'index.html'));
    }
    // This catch-all matches /api paths too. Falling through without answering
    // leaves the request open until the client times out, so a typo'd or removed
    // endpoint shows up in the UI as a spinner that never resolves rather than
    // an error. Answer explicitly instead.
    res.status(404).json({ error: 'Not found', path: req.path });
  });
}

app.listen(PORT, () => {
  console.log(`Brand Intelligence server running on port ${PORT}`);
});
