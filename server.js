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
const basicAuth = require('express-basic-auth');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

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

const rawUsers = process.env.DASHBOARD_USERS || '';
const users = rawUsers
  ? Object.fromEntries(rawUsers.split(',').map(pair => pair.trim().split(':')))
  : { admin: process.env.DASHBOARD_PASSWORD || 'changeme' };

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
  const profile = loadBrandData(entry.brandSlug, 'profile.json') || {};
  const actionPlan = loadBrandData(entry.brandSlug, 'action_plan.json') || {};
  const competitive = loadBrandData(entry.brandSlug, 'competitive_analysis.json') || {};

  const wins = (actionPlan.immediateWins || []).map(w =>
    `<div class="win-item"><span class="badge ${w.impact === 'high' ? 'badge-high' : w.impact === 'medium' ? 'badge-medium' : 'badge-low'}">${w.impact || 'medium'} impact</span><strong>${w.title}</strong><p>${w.description}</p></div>`
  ).join('');

  const roadmap30 = (actionPlan.roadmap?.day30 || []).map(r => `<li>${r.action}</li>`).join('');
  const roadmap60 = (actionPlan.roadmap?.day60 || []).map(r => `<li>${r.action}</li>`).join('');
  const roadmap90 = (actionPlan.roadmap?.day90 || []).map(r => `<li>${r.action}</li>`).join('');

  const competitors = (competitive.competitors || []).map(c =>
    `<div class="competitor"><h3>${c.name}</h3><p>${c.positioningStatement || ''}</p></div>`
  ).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${profile.name || 'Brand'} Intelligence Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; color: #1a1a1a; }
  .header { background: #1a1a1a; color: #fff; padding: 32px 40px; }
  .header h1 { font-size: 28px; font-weight: 700; }
  .header p { color: #aaa; margin-top: 6px; font-size: 14px; }
  .container { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
  .section { background: #fff; border-radius: 12px; padding: 28px; margin-bottom: 24px; border: 1px solid #e5e7eb; }
  .section h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #111; }
  .exec-summary { font-size: 16px; line-height: 1.7; color: #374151; }
  .win-item { border-left: 3px solid #6366f1; padding: 12px 16px; margin-bottom: 12px; background: #f9fafb; border-radius: 0 8px 8px 0; }
  .win-item strong { display: block; font-size: 15px; margin: 4px 0; }
  .win-item p { font-size: 14px; color: #6b7280; margin-top: 4px; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge-high { background: #fee2e2; color: #991b1b; }
  .badge-medium { background: #fef3c7; color: #92400e; }
  .badge-low { background: #d1fae5; color: #065f46; }
  .roadmap-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .roadmap-col h3 { font-size: 14px; font-weight: 700; color: #6366f1; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .roadmap-col ul { padding-left: 16px; }
  .roadmap-col li { font-size: 14px; color: #374151; margin-bottom: 6px; line-height: 1.5; }
  .competitor { padding: 12px 0; border-bottom: 1px solid #f3f4f6; }
  .competitor:last-child { border-bottom: none; }
  .competitor h3 { font-size: 15px; font-weight: 600; }
  .competitor p { font-size: 14px; color: #6b7280; margin-top: 4px; }
  .meta { font-size: 12px; color: #9ca3af; margin-top: 32px; text-align: center; }
  @media (max-width: 600px) { .roadmap-grid { grid-template-columns: 1fr; } }
  @media print { body { background: #fff; } .header { background: #1a1a1a !important; -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="header">
  <h1>${profile.name || 'Brand'} Intelligence Report</h1>
  <p>${profile.industry || ''} &bull; ${profile.url || ''} &bull; Generated ${new Date(actionPlan.generatedAt || Date.now()).toLocaleDateString()}</p>
</div>
<div class="container">
  ${actionPlan.executiveSummary ? `
  <div class="section">
    <h2>Executive Summary</h2>
    <p class="exec-summary">${actionPlan.executiveSummary}</p>
  </div>` : ''}

  ${wins ? `
  <div class="section">
    <h2>Immediate Wins</h2>
    ${wins}
  </div>` : ''}

  ${(roadmap30 || roadmap60 || roadmap90) ? `
  <div class="section">
    <h2>30 / 60 / 90 Day Roadmap</h2>
    <div class="roadmap-grid">
      <div class="roadmap-col"><h3>30 Days</h3><ul>${roadmap30}</ul></div>
      <div class="roadmap-col"><h3>60 Days</h3><ul>${roadmap60}</ul></div>
      <div class="roadmap-col"><h3>90 Days</h3><ul>${roadmap90}</ul></div>
    </div>
  </div>` : ''}

  ${competitors ? `
  <div class="section">
    <h2>Competitive Landscape</h2>
    ${competitors}
  </div>` : ''}

  <p class="meta">Powered by Brand Intelligence &bull; Confidential</p>
</div>
</body>
</html>`);
});

// ─── Auth (applied after public routes) ───────────────────────────────────────
app.use(basicAuth({ users, challenge: true, realm: 'Brand Intelligence' }));

// ─── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ─── Brand Registry Routes ─────────────────────────────────────────────────────

// GET /api/brands — list all brands
app.get('/api/brands', (req, res) => {
  const registry = loadBrandsRegistry();
  const brands = registry.brands.map(b => ({
    ...b,
    healthStatus: getHealthStatus(b.slug),
    moduleStatus: getBrandStatus(b.slug),
  }));
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
app.post('/api/brands/:slug/refresh/:module', (req, res) => {
  const { slug, module: moduleName } = req.params;
  const registry = loadBrandsRegistry();
  if (!registry.brands.find(b => b.slug === slug)) {
    return res.status(404).json({ error: 'Brand not found' });
  }
  const mod = BRAND_MODULES.find(m => m.name === moduleName);
  if (!mod) return res.status(400).json({ error: `Unknown module: ${moduleName}` });

  const child = spawn('node', [path.join(__dirname, mod.script), `--slug=${slug}`], {
    env: { ...process.env },
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  res.json({ ok: true, slug, module: moduleName, status: 'running' });
});

// POST /api/brands/:slug/refresh/all — trigger full pipeline
app.post('/api/brands/:slug/refresh/all', (req, res) => {
  const { slug } = req.params;
  const registry = loadBrandsRegistry();
  if (!registry.brands.find(b => b.slug === slug)) {
    return res.status(404).json({ error: 'Brand not found' });
  }
  const child = spawn('node', [path.join(__dirname, 'analysis/brand_discovery.js'), `--slug=${slug}`, '--refresh-all'], {
    env: { ...process.env },
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  res.json({ ok: true, slug, status: 'running' });
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
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
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
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0].text;
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
    // Create a short-lived share token for Puppeteer to load
    const token = uuidv4();
    const tokensData = loadShareTokens();
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour
    tokensData.tokens.push({ token, brandSlug: slug, createdAt: new Date().toISOString(), expiresAt });
    saveShareTokens(tokensData);

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
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
      });
    }

    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/share/${token}`, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } });
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

// ─── SerpAPI Key Management ─────────────────────────────────────────────────────
app.post('/api/settings/serp-api-key', (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
  // Store in .env.local (not committed to git)
  const envLocalPath = path.join(__dirname, '.env.local');
  const existing = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, 'utf8') : '';
  const updated = existing.replace(/^SERP_API_KEY=.*/m, '').trim() + `\nSERP_API_KEY=${apiKey}\n`;
  fs.writeFileSync(envLocalPath, updated);
  process.env.SERP_API_KEY = apiKey;
  res.json({ ok: true, serpApiEnabled: true });
});

app.get('/api/settings', (req, res) => {
  res.json({ serpApiEnabled: !!process.env.SERP_API_KEY });
});

// ─── Image Proxy (bypasses Instagram CDN hotlink protection) ──────────────────

app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
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
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`Brand Intelligence server running on port ${PORT}`);
});
