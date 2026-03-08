/**
 * Anne Klein Intel — Express API Server
 * Serves all /data/*.json files as REST endpoints.
 * Runs on PORT 3001, CORS-enabled for dashboard dev server.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const basicAuth = require('express-basic-auth');
const { getBrandContext } = require('./utils/brand_context');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Password protection — users defined as USER_1=name:password pairs in .env
// e.g. DASHBOARD_USERS=gary:secret123,sarah:pass456
const rawUsers = process.env.DASHBOARD_USERS || '';
const users = rawUsers
  ? Object.fromEntries(rawUsers.split(',').map(pair => pair.trim().split(':')))
  : { admin: process.env.DASHBOARD_PASSWORD || 'changeme' };

app.use(cors());
app.use(express.json());

function loadData(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Health check — BEFORE basicAuth so Railway healthcheck works unauthenticated
app.get('/api/status', (req, res) => {
  const files = [
    'site_intelligence.json',
    'product_catalog.json',
    'site_analysis.json',
    'email_signups.json',
    'social_intelligence.json',
    'gsc_keywords.json',
    'content_recommendations.json',
  ];
  const status = {};
  files.forEach(f => {
    const fp = path.join(DATA_DIR, f);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      status[f] = { exists: true, size: stat.size, updatedAt: stat.mtime };
    } else {
      status[f] = { exists: false };
    }
  });
  res.json({ ok: true, dataFiles: status, serverTime: new Date().toISOString() });
});

// Password protection — applied AFTER /api/status so Railway healthcheck passes
app.use(basicAuth({
  users,
  challenge: true,
  realm: 'Anne Klein Intel',
}));

// Rate limit API routes — 200 req/min per IP
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get('/api/site-intelligence',      (req, res) => res.json(loadData('site_intelligence.json') || {}));
app.get('/api/product-catalog',        (req, res) => res.json(loadData('product_catalog.json') || {}));
app.get('/api/site-analysis',          (req, res) => res.json(loadData('site_analysis.json') || {}));
app.get('/api/email-intelligence',     (req, res) => res.json(loadData('email_signups.json') || {}));
app.get('/api/social-intelligence',    (req, res) => res.json(loadData('social_intelligence.json') || {}));
app.get('/api/seo-intelligence',       (req, res) => res.json(loadData('gsc_keywords.json') || {}));
app.get('/api/content-recommendations',(req, res) => res.json(loadData('content_recommendations.json') || {}));
app.get('/api/email-inbox',            (req, res) => res.json(loadData('email_inbox.json') || {}));
app.get('/api/email-analysis',         (req, res) => res.json(loadData('email_analysis.json') || {}));
app.get('/api/agentic-search',         (req, res) => res.json(loadData('agentic_search.json') || {}));
app.get('/api/price-intelligence',     (req, res) => res.json(loadData('price_intelligence.json') || {}));
app.get('/api/brand-guidelines',       (req, res) => res.json(loadData('brand_guidelines.json') || {}));
app.put('/api/brand-guidelines',       (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid JSON body' });
    data.updatedAt = new Date().toISOString().split('T')[0];
    fs.writeFileSync(path.join(DATA_DIR, 'brand_guidelines.json'), JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// History endpoint — returns last N snapshots for any module
app.get('/api/history/:module', (req, res) => {
  const { module } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 30, 90);
  const histDir = path.join(DATA_DIR, 'history');
  if (!fs.existsSync(histDir)) return res.json({ snapshots: [] });
  const files = fs.readdirSync(histDir)
    .filter(f => f.startsWith(module + '_') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);
  const snapshots = files.map(f => {
    const date = f.replace(module + '_', '').replace('.json', '');
    try {
      const data = JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8'));
      return { date, data };
    } catch { return { date, error: true }; }
  });
  res.json({ module, snapshots });
});

// On-demand content generation
app.post('/api/generate', async (req, res) => {
  const { contentType, prompt, context } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Pull relevant intel to ground the generation
  const siteAnalysis   = loadData('site_analysis.json');
  const priceIntel     = loadData('price_intelligence.json');
  const contentRecs    = loadData('content_recommendations.json');
  const personas       = loadData('personas.json');

  const brandContext = getBrandContext();
  const systemPrompt = `You are a marketing strategist and copywriter for Anne Klein.

${brandContext}

${siteAnalysis ? `COMPETITIVE LANDSCAPE:\n${JSON.stringify(siteAnalysis.messagingAnalysis || {}, null, 2)}` : ''}
${priceIntel ? `CURRENT SALE RATE: ${priceIntel.akSaleRate}% of products on sale (avg ${priceIntel.akAvgSaleDepth}% off)` : ''}
${personas ? `CUSTOMER PERSONAS:\n${JSON.stringify(personas.personas?.slice(0,2) || [], null, 2)}` : ''}
${context ? `\nADDITIONAL CONTEXT:\n${context}` : ''}

Content type requested: ${contentType || 'general marketing copy'}
Respond with the requested content only — no meta-commentary.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ content: msg.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apify usage
app.get('/api/apify-usage', async (req, res) => {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'APIFY_API_TOKEN not set' });
  try {
    const r = await axios.get('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const u = r.data?.data?.plan || {};
    const usage = r.data?.data?.usage || {};
    res.json({
      planId: u.id || 'unknown',
      monthlyUsageCreditsCents: usage.monthlyUsageCreditsCents ?? null,
      monthlyBasePriceCents: u.monthlyBasePriceCents ?? null,
      dataRetentionDays: u.dataRetentionDays ?? null,
      raw: r.data?.data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Personas
app.get('/api/personas', (req, res) => res.json(loadData('personas.json') || {}));

// Serve built dashboard in production
const dashboardDist = path.join(__dirname, 'dashboard', 'dist');
if (fs.existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.use((req, res) => res.sendFile(path.join(dashboardDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Anne Klein Intel API running on http://localhost:${PORT}`);
  console.log(`  GET /api/status`);
  console.log(`  GET /api/site-intelligence`);
  console.log(`  GET /api/product-catalog`);
  console.log(`  GET /api/site-analysis`);
  console.log(`  GET /api/email-intelligence`);
  console.log(`  GET /api/social-intelligence`);
  console.log(`  GET /api/seo-intelligence`);
  console.log(`  GET /api/content-recommendations`);
});
