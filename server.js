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
const { getInStockProducts, getProductCatalogForPrompt, checkHandles, invalidateCache, isConfigured: shopifyConfigured } = require('./shopify/inventory');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');

// Validators: return true if the live file's data is valid (no seed override needed).
const SEED_VALIDATORS = {
  'gsc_keywords.json':            (d) => d?.queryAnalysis?.totalQueries > 0,
  'social_intelligence.json':     (d) => Array.isArray(d?.brands) && d.brands.length > 0,
  'site_intelligence.json':       (d) => Array.isArray(d?.brands) && d.brands.length > 0,
  'product_catalog.json':         (d) => Array.isArray(d?.products) && d.products.length > 0,
  'content_recommendations.json': (d) => !!d?.content,
  'agentic_search.json':          (d) => Array.isArray(d?.queries) && d.queries.length > 0,
  'ownable_events.json':          (d) => Array.isArray(d) && d.length > 0,
  'campaigns.json':               (d) => Array.isArray(d) && d.some(c => Array.isArray(c.storyArc) && c.storyArc.length > 0),
  'content_strategy.json':        (d) => d && Array.isArray(d.globalRules) && d.globalRules.length > 0,
};

// On startup: copy seed file if live file is missing or fails validation.
// For files without a validator, merge any new top-level keys only.
(function mergeSeedData() {
  const seedDir = path.join(__dirname, 'seed_data');
  if (!fs.existsSync(seedDir)) return;
  for (const file of fs.readdirSync(seedDir).filter(f => f.endsWith('.json'))) {
    const livePath = path.join(DATA_DIR, file);
    const seedPath = path.join(seedDir, file);
    try {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      if (!fs.existsSync(livePath)) {
        fs.copyFileSync(seedPath, livePath);
        console.log(`[seed] copied ${file} (missing)`);
        continue;
      }
      const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
      const validator = SEED_VALIDATORS[file];
      if (validator && !validator(live)) {
        fs.copyFileSync(seedPath, livePath);
        console.log(`[seed] replaced ${file} (failed validation)`);
        continue;
      }
      // No validator — merge missing top-level keys only
      let changed = false;
      for (const key of Object.keys(seed)) {
        if (!(key in live)) {
          live[key] = seed[key];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(livePath, JSON.stringify(live, null, 2));
    } catch (e) { console.error(`[seed] error processing ${file}:`, e.message); }
  }
})();

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
app.post('/api/content-recommendations/regenerate', (req, res) => {
  const { spawn } = require('child_process');
  const child = spawn('node', [path.join(__dirname, 'analysis/content_generator.js')], {
    env: { ...process.env },
    cwd: __dirname,
  });
  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });
  child.on('close', code => {
    const data = loadData('content_recommendations.json') || {};
    res.json({ ok: code === 0, output: output.slice(-2000), generatedAt: data.generatedAt });
  });
});
app.get('/api/email-inbox',            (req, res) => res.json(loadData('email_inbox.json') || {}));
app.get('/api/email-analysis',         (req, res) => res.json(loadData('email_analysis.json') || {}));
app.post('/api/email-analysis/refresh', (req, res) => {
  const { spawn } = require('child_process');
  const child = spawn('node', [path.join(__dirname, 'email/analyze_inbox.js')], {
    env: { ...process.env },
    cwd: __dirname,
  });
  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });
  child.on('close', code => {
    const data = loadData('email_analysis.json') || {};
    res.json({ ok: code === 0, output: output.slice(-2000), generatedAt: data.generatedAt });
  });
});
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

// ─── Persona Chat (streaming SSE) ────────────────────────────────────────────
app.post('/api/persona-chat', async (req, res) => {
  const { personaIndex, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const personasData = loadData('personas.json');
  const persona = personasData?.personas?.[personaIndex ?? 0];
  if (!persona) return res.status(404).json({ error: 'Persona not found' });

  const brandContext = getBrandContext();
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

Brand you are being asked about: Anne Klein
${brandContext}

Rules:
- Speak as this person would — naturally, conversationally, from lived experience
- Reference your specific pain points, values, and shopping behaviors when relevant
- Do not use marketing language or brand voice
- If asked what you think about Anne Klein, answer honestly from your character's perspective
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

// ─── Suggest Adjacent Personas ───────────────────────────────────────────────
app.post('/api/suggest-personas', async (req, res) => {
  const personasData = loadData('personas.json');
  const existing = personasData?.personas || [];
  const brandContext = getBrandContext();
  const intel = {
    siteAnalysis: loadData('site_analysis.json'),
    gscKeywords: loadData('gsc_keywords.json'),
    socialIntel: loadData('social_intelligence.json'),
  };

  const prompt = `Based on the brand context and existing personas below, identify 2-3 adjacent customer segments that Anne Klein is not currently addressing but should consider.

BRAND CONTEXT:
${brandContext}

EXISTING PERSONAS (do not duplicate these):
${existing.map(p => `- ${p.name}: ${p.ageRange}, ${p.income}, ${(p.occupation||[]).join('/')}`).join('\n')}

AVAILABLE INTEL:
${intel.gscKeywords?.keywords ? `Top search queries: ${intel.gscKeywords.keywords.slice(0,15).map(k=>k.query||k).join(', ')}` : ''}

Return JSON with this exact structure:
{
  "suggestions": [
    {
      "name": "evocative label like The Executive Achiever",
      "ageRange": "",
      "income": "",
      "occupation": [],
      "rationale": "1-2 sentences on why AK should address this segment",
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

// ─── Campaigns CRUD ───────────────────────────────────────────────────────────
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');

function loadCampaigns() {
  if (!fs.existsSync(CAMPAIGNS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8')); } catch { return []; }
}
function saveCampaigns(data) {
  fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/campaigns', (req, res) => res.json(loadCampaigns()));

app.post('/api/campaigns', (req, res) => {
  const campaigns = loadCampaigns();
  const item = { ...req.body, id: `campaign_${Date.now()}`, createdAt: new Date().toISOString(), calendarItemIds: [] };
  campaigns.push(item);
  saveCampaigns(campaigns);
  res.json(item);
});

app.put('/api/campaigns/:id', (req, res) => {
  const campaigns = loadCampaigns();
  const idx = campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  campaigns[idx] = { ...campaigns[idx], ...req.body, id: req.params.id };
  saveCampaigns(campaigns);
  res.json(campaigns[idx]);
});

app.delete('/api/campaigns/:id', (req, res) => {
  const campaigns = loadCampaigns();
  const filtered = campaigns.filter(c => c.id !== req.params.id);
  saveCampaigns(filtered);
  res.json({ ok: true });
});

app.post('/api/campaigns/:id/generate-brief', async (req, res) => {
  const campaigns = loadCampaigns();
  const campaign = campaigns.find(c => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  // Pull matching content assets from content_recommendations.json
  let contentAssetContext = '';
  try {
    const contentFile = path.join(DATA_DIR, 'content_recommendations.json');
    if (fs.existsSync(contentFile)) {
      const contentData = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
      const persona = campaign.persona || 'The Polished Professional';
      const emailAssets = (contentData.content?.emailCampaigns?.emailCampaigns || [])
        .filter(e => !e.targetPersona || e.targetPersona === persona)
        .slice(0, 3)
        .map(e => `  - Email: "${e.subjectLine}" | ${e.theme} | CTA: ${e.ctaButton}`)
        .join('\n');
      const igAssets = (contentData.content?.instagramCaptions?.instagramCaptions || [])
        .filter(g => !g.targetPersona || g.targetPersona === persona)
        .slice(0, 2)
        .map(g => `  - IG (${g.category}): ${g.caption.slice(0, 100)}…`)
        .join('\n');
      const linkedAssets = (campaign.linkedContent || [])
        .map(a => `  - [Pinned] ${a.type === 'email' ? 'Email' : 'IG'}: "${a.subjectLine || a.caption?.slice(0, 80)}"`)
        .join('\n');
      if (emailAssets || igAssets || linkedAssets) {
        contentAssetContext = `\nEXISTING CONTENT ASSETS (persona-matched from content library):
${linkedAssets ? 'PINNED TO THIS CAMPAIGN:\n' + linkedAssets + '\n' : ''}${emailAssets ? 'EMAIL OPTIONS:\n' + emailAssets + '\n' : ''}${igAssets ? 'INSTAGRAM OPTIONS:\n' + igAssets : ''}

Use these as starting points for channel execution notes — reference specific subject lines and IG angles where relevant.`;
      }
    }
  } catch (_) {}

  const brandContext = getBrandContext();
  const prompt = `Write a campaign brief for this Anne Klein marketing campaign.

CAMPAIGN:
Name: ${campaign.name}
Dates: ${campaign.startDate} to ${campaign.endDate}
Target persona: ${campaign.persona || 'The Polished Professional'}
Status: ${campaign.status}

STYLE GUIDE:
Color direction: ${campaign.styleGuide?.colorDirection || 'not specified'}
Mood: ${(campaign.styleGuide?.moodKeywords || []).join(', ') || 'not specified'}
Avoid: ${(campaign.styleGuide?.avoidWords || []).join(', ') || 'none specified'}
Hero image direction: ${campaign.styleGuide?.heroImageDirection || 'not specified'}
${contentAssetContext}
BRAND CONTEXT:
${brandContext}

Write a 3-paragraph campaign brief covering:
1. Campaign objective and strategic rationale
2. Creative direction (tone, visual language, key message)
3. Channel execution notes (email, Instagram, site) — reference specific content assets above where relevant

Be specific and actionable. No generic marketing language.`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const brief = msg.content[0].text;
    const idx = campaigns.findIndex(c => c.id === req.params.id);
    campaigns[idx].brief = brief;
    saveCampaigns(campaigns);
    res.json({ brief });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Link a content asset to a campaign (stored in campaign.linkedContent[])
app.post('/api/campaigns/:id/link-content', (req, res) => {
  const campaigns = loadCampaigns();
  const idx = campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const asset = req.body; // { type, subjectLine, theme, caption, targetPersona, category }
  const linked = campaigns[idx].linkedContent || [];
  const key = asset.type === 'email' ? asset.subjectLine : asset.caption?.slice(0, 80);
  if (!linked.some(a => (a.type === 'email' ? a.subjectLine : a.caption?.slice(0, 80)) === key)) {
    linked.push(asset);
  }
  campaigns[idx].linkedContent = linked;
  saveCampaigns(campaigns);
  res.json(campaigns[idx]);
});

app.delete('/api/campaigns/:id/link-content', (req, res) => {
  const campaigns = loadCampaigns();
  const idx = campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { key } = req.body;
  campaigns[idx].linkedContent = (campaigns[idx].linkedContent || []).filter(a => {
    const k = a.type === 'email' ? a.subjectLine : a.caption?.slice(0, 80);
    return k !== key;
  });
  saveCampaigns(campaigns);
  res.json(campaigns[idx]);
});

// ─── Calendar CRUD ────────────────────────────────────────────────────────────
const CALENDAR_FILE = path.join(DATA_DIR, 'content_calendar.json');

function loadCalendar() {
  if (!fs.existsSync(CALENDAR_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CALENDAR_FILE, 'utf8')); } catch { return []; }
}
function saveCalendar(data) {
  fs.writeFileSync(CALENDAR_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/calendar', (req, res) => res.json(loadCalendar()));

app.post('/api/calendar/item', (req, res) => {
  const items = loadCalendar();
  const item = {
    id: `cal_${Date.now()}`,
    date: '',
    channel: 'email',
    status: 'brief',
    campaignId: null,
    personaTarget: '',
    theme: '',
    brief: '',
    subjectLine: '',
    previewText: '',
    heroImageBrief: null,
    selectedProducts: [],
    assignedTo: '',
    notes: '',
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  saveCalendar(items);
  res.json(item);
});

app.put('/api/calendar/item/:id', (req, res) => {
  const items = loadCalendar();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  items[idx] = { ...items[idx], ...req.body, id: req.params.id };
  saveCalendar(items);
  res.json(items[idx]);
});

app.delete('/api/calendar/item/:id', (req, res) => {
  const items = loadCalendar();
  saveCalendar(items.filter(i => i.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/calendar/item/:id/generate-brief', async (req, res) => {
  const items = loadCalendar();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const campaigns = loadCampaigns();
  const campaign = item.campaignId ? campaigns.find(c => c.id === item.campaignId) : null;
  const brandContext = getBrandContext();
  const personas = loadData('personas.json');
  const persona = personas?.personas?.find(p => p.name === item.personaTarget) || personas?.personas?.[0];

  const prompt = `Write a content brief for this ${item.channel} piece.

ITEM:
Date: ${item.date}
Channel: ${item.channel}
Theme: ${item.theme}
Persona: ${item.personaTarget || persona?.name}
${item.subjectLine ? `Subject line: ${item.subjectLine}` : ''}
${item.previewText ? `Preview text: ${item.previewText}` : ''}

${campaign ? `CAMPAIGN CONTEXT:\n${campaign.brief || `Campaign: ${campaign.name}, ${campaign.startDate}–${campaign.endDate}\nColor direction: ${campaign.styleGuide?.colorDirection || ''}\nMood: ${(campaign.styleGuide?.moodKeywords||[]).join(', ')}`}` : ''}

${persona ? `PERSONA:\n${persona.name} — ${persona.ageRange}, ${persona.income}\nKey motivators: ${(persona.motivators||[]).slice(0,2).join(' | ')}\nPain points: ${(persona.painPoints||[]).slice(0,2).join(' | ')}` : ''}

BRAND CONTEXT:
${brandContext}

Write a brief covering:
- What to feature and why (specific products/categories if relevant)
- Key message (1 sentence the customer should feel after reading)
- Tone notes specific to this piece
- CTA recommendation

Keep it tight — this is a working brief, not an essay.`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    const brief = msg.content[0].text;
    const idx = items.findIndex(i => i.id === req.params.id);
    items[idx].brief = brief;
    saveCalendar(items);
    res.json({ brief });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/item/:id/generate-hero-brief', async (req, res) => {
  const items = loadCalendar();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const campaigns = loadCampaigns();
  const campaign = item.campaignId ? campaigns.find(c => c.id === item.campaignId) : null;
  const brandContext = getBrandContext();

  const selectedProductNames = (item.selectedProducts || []).map(p => p.name).join(', ');

  const prompt = `Write a hero image creative brief for this Anne Klein ${item.channel} piece.

PIECE:
Theme: ${item.theme}
Channel: ${item.channel}
Date: ${item.date}
${selectedProductNames ? `Products featured: ${selectedProductNames}` : ''}

${campaign?.styleGuide ? `CAMPAIGN STYLE:\nColor direction: ${campaign.styleGuide.colorDirection || ''}\nMood: ${(campaign.styleGuide.moodKeywords||[]).join(', ')}\nHero direction: ${campaign.styleGuide.heroImageDirection || ''}` : ''}

BRAND CONTEXT:
${brandContext}

Write a concise hero image brief with these sections:
- Subject: (who is in the shot — model type, age range, styling)
- Setting: (location, background, lighting mood)
- Wardrobe: (specific pieces, how they're styled)
- Mood: (3 adjectives)
- Avoid: (what NOT to include)
- AI image prompt: (a single prompt sentence usable for image generation)

Be specific and visual. No abstract concepts.`;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const heroImageBrief = msg.content[0].text;
    const idx = items.findIndex(i => i.id === req.params.id);
    items[idx].heroImageBrief = heroImageBrief;
    saveCalendar(items);
    res.json({ heroImageBrief });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SEO Product Suggestions ─────────────────────────────────────────────────
const SEO_SUGGESTIONS_FILE = path.join(DATA_DIR, 'seo_suggestions.json');

function loadSeoSuggestions() {
  if (!fs.existsSync(SEO_SUGGESTIONS_FILE)) return { totalAnalyzed: 0, totalProducts: 0, products: [] };
  try { return JSON.parse(fs.readFileSync(SEO_SUGGESTIONS_FILE, 'utf8')); } catch { return { totalAnalyzed: 0, totalProducts: 0, products: [] }; }
}
function saveSeoSuggestions(data) {
  fs.writeFileSync(SEO_SUGGESTIONS_FILE, JSON.stringify(data, null, 2));
}

// Get all suggestions (with optional status filter)
app.get('/api/seo-suggestions', (req, res) => {
  const data = loadSeoSuggestions();
  const { status, filter } = req.query;
  let products = data.products || [];
  if (status) products = products.filter(p => p.status === status);
  if (filter && filter !== 'all') {
    const re = {
      new_arrivals: /new.arrival|new.in/i,
      clothing:     /clothing|blazer|jacket|pant|dress|top|skirt|suit/i,
      shoes:        /shoe|heel|boot|flat|sandal|loafer|pump/i,
      jewelry:      /jewelry|earring|necklace|bracelet|ring|watch/i,
      handbags:     /handbag|bag|purse|satchel|tote|crossbody|wallet/i,
    }[filter];
    if (re) products = products.filter(p => re.test(p.category || ''));
  }
  res.json({ ...data, products });
});

// Run a new batch (triggers the analyzer script in-process)
app.post('/api/seo-suggestions/run', async (req, res) => {
  const { filter = 'all', limit = 50, force = false } = req.body || {};
  const { spawn } = require('child_process');
  const args = [`--filter=${filter}`, `--limit=${limit}`];
  if (force) args.push('--force');
  const child = spawn('node', [path.join(__dirname, 'analysis/seo_product_analyzer.js'), ...args], {
    env: { ...process.env },
    cwd: __dirname,
  });
  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });
  child.on('close', code => {
    const data = loadSeoSuggestions();
    res.json({ ok: code === 0, output: output.slice(-2000), totalAnalyzed: data.totalAnalyzed, totalProducts: data.totalProducts });
  });
});

// Re-analyze a single product by href
app.post('/api/seo-suggestions/reanalyze-one', async (req, res) => {
  const { href } = req.body || {};
  if (!href) return res.status(400).json({ ok: false, error: 'href required' });
  const { spawn } = require('child_process');
  const child = spawn('node', [path.join(__dirname, 'analysis/seo_product_analyzer.js'), `--href=${href}`], {
    env: { ...process.env },
    cwd: __dirname,
  });
  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });
  child.on('close', code => {
    const data = loadSeoSuggestions();
    const product = data.products?.find(p => p.href === href) || null;
    res.json({ ok: code === 0, output: output, product });
  });
});

// Update status of a single product suggestion (href in body to avoid Express 5 route issues)
app.put('/api/seo-suggestions/status', (req, res) => {
  const { href, status, notes } = req.body || {};
  if (!href) return res.status(400).json({ error: 'href required' });
  const data = loadSeoSuggestions();
  const idx = data.products.findIndex(p => p.href === href);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (status) data.products[idx].status = status;
  if (status === 'approved') data.products[idx].approvedAt = new Date().toISOString();
  if (notes !== undefined) data.products[idx].notes = notes;
  saveSeoSuggestions(data);
  res.json(data.products[idx]);
});

// Bulk approve
app.post('/api/seo-suggestions/bulk-approve', (req, res) => {
  const { hrefs } = req.body || {};
  if (!Array.isArray(hrefs)) return res.status(400).json({ error: 'hrefs array required' });
  const data = loadSeoSuggestions();
  const now = new Date().toISOString();
  let count = 0;
  for (const href of hrefs) {
    const idx = data.products.findIndex(p => p.href === href);
    if (idx !== -1) { data.products[idx].status = 'approved'; data.products[idx].approvedAt = now; count++; }
  }
  saveSeoSuggestions(data);
  res.json({ ok: true, approved: count });
});

// Push approved products to Shopify via GraphQL Admin API
app.post('/api/seo-suggestions/push-shopify', async (req, res) => {
  const { hrefs, dryRun = false } = req.body || {};
  const { spawn } = require('child_process');
  const args = [];
  if (dryRun) args.push('--dry-run');
  if (hrefs?.length === 1) args.push(`--href=${hrefs[0]}`);
  else if (hrefs?.length > 1) {
    // Write hrefs to a temp file and pass as arg (avoids shell escaping issues)
    const tmpFile = path.join(__dirname, 'data', '.push_hrefs_tmp.json');
    fs.writeFileSync(tmpFile, JSON.stringify(hrefs));
    args.push(`--hrefs-file=${tmpFile}`);
  }
  const child = spawn('node', [path.join(__dirname, 'shopify/push_seo.js'), ...args], {
    env: { ...process.env },
    cwd: __dirname,
  });
  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });
  child.on('close', code => {
    // Clean up temp file if created
    const tmpFile = path.join(__dirname, 'data', '.push_hrefs_tmp.json');
    if (fs.existsSync(tmpFile)) try { fs.unlinkSync(tmpFile); } catch {}
    const data = loadSeoSuggestions();
    const pushed = data.products.filter(p => p.pushStatus === 'pushed').length;
    const errors = data.products.filter(p => p.pushStatus === 'error').length;
    res.json({ ok: code === 0, output: output.slice(-3000), pushed, errors, dryRun });
  });
});

// Shopify connection status check
app.get('/api/shopify/status', (_req, res) => {
  const configured = !!(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_API_TOKEN);
  res.json({
    configured,
    domain: process.env.SHOPIFY_STORE_DOMAIN || null,
    apiVersion: process.env.SHOPIFY_API_VERSION || '2025-07',
  });
});

// Export approved as CSV
app.get('/api/seo-suggestions/export-csv', (req, res) => {
  const data = loadSeoSuggestions();
  const approved = data.products.filter(p => p.status === 'approved');
  const rows = [['Product Name', 'Category', 'Price', 'URL', 'Meta Title', 'Meta Description', 'Tags', 'Alt Text', 'GEO Description', 'Image Insights', 'Approved At']];
  for (const p of approved) {
    rows.push([
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${p.category || ''}"`,
      `"${p.price || ''}"`,
      `"${p.href || ''}"`,
      `"${(p.suggested?.meta_title || '').replace(/"/g, '""')}"`,
      `"${(p.suggested?.meta_description || '').replace(/"/g, '""')}"`,
      `"${(p.suggested?.tags || []).join(', ')}"`,
      `"${(p.suggested?.alt_text || '').replace(/"/g, '""')}"`,
      `"${(p.suggested?.geo_description || '').replace(/"/g, '""')}"`,
      `"${(p.suggested?.image_insights || '').replace(/"/g, '""')}"`,
      `"${p.approvedAt || ''}"`,
    ]);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ak_seo_approved.csv"');
  res.send(rows.map(r => r.join(',')).join('\n'));
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

// ─── Ownable Events ───────────────────────────────────────────────────────────
const OWNABLE_EVENTS_FILE = path.join(DATA_DIR, 'ownable_events.json');

function loadOwnableEvents() {
  if (!fs.existsSync(OWNABLE_EVENTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(OWNABLE_EVENTS_FILE, 'utf8')); } catch { return []; }
}
function saveOwnableEvents(data) {
  fs.writeFileSync(OWNABLE_EVENTS_FILE, JSON.stringify(data, null, 2));
}

// Resolve recurring events' YYYY placeholder to an actual year
function resolveEvents(events, year) {
  return events.map(e => ({
    ...e,
    date: e.date ? e.date.replace('YYYY', String(year)) : e.date,
  }));
}

app.get('/api/ownable-events', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const events = resolveEvents(loadOwnableEvents(), year);
  res.json(events);
});

app.post('/api/ownable-events', (req, res) => {
  const events = loadOwnableEvents();
  const event = {
    id: `event_custom_${Date.now()}`,
    recurring: false,
    category: 'custom',
    relevance: 'medium',
    ...req.body,
  };
  events.push(event);
  saveOwnableEvents(events);
  res.json(event);
});

app.delete('/api/ownable-events/:id', (req, res) => {
  const events = loadOwnableEvents();
  saveOwnableEvents(events.filter(e => e.id !== req.params.id));
  res.json({ ok: true });
});

// ─── Weekly Content Plans ─────────────────────────────────────────────────────
const WEEKLY_PLANS_FILE = path.join(DATA_DIR, 'weekly_plans.json');

function loadWeeklyPlans() {
  if (!fs.existsSync(WEEKLY_PLANS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(WEEKLY_PLANS_FILE, 'utf8')); } catch { return {}; }
}
function saveWeeklyPlans(data) {
  fs.writeFileSync(WEEKLY_PLANS_FILE, JSON.stringify(data, null, 2));
}

const CONTENT_PREFS_FILE = path.join(DATA_DIR, 'content_preferences.json');
const CONTENT_FEEDBACK_LOG = path.join(DATA_DIR, 'content_feedback_log.json');

function loadContentPreferences() {
  try { return JSON.parse(fs.readFileSync(CONTENT_PREFS_FILE, 'utf8')); } catch { return null; }
}

const CONTENT_STRATEGY_FILE = path.join(DATA_DIR, 'content_strategy.json');
function loadContentStrategy() {
  try { return fs.existsSync(CONTENT_STRATEGY_FILE) ? JSON.parse(fs.readFileSync(CONTENT_STRATEGY_FILE, 'utf8')) : null; } catch { return null; }
}
function saveContentStrategy(strategy) {
  fs.writeFileSync(CONTENT_STRATEGY_FILE, JSON.stringify({ ...strategy, updatedAt: new Date().toISOString() }, null, 2));
}
function saveContentPreferences(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(CONTENT_PREFS_FILE, JSON.stringify(data, null, 2));
}
function appendFeedbackLog(entry) {
  try {
    let log = [];
    if (fs.existsSync(CONTENT_FEEDBACK_LOG)) {
      log = JSON.parse(fs.readFileSync(CONTENT_FEEDBACK_LOG, 'utf8'));
    }
    log.push({ ts: new Date().toISOString(), ...entry });
    fs.writeFileSync(CONTENT_FEEDBACK_LOG, JSON.stringify(log, null, 2));
  } catch {}
}

// Background: update content_preferences.json with learnings from a feedback event.
// Uses Haiku (cheap/fast) since this is bookkeeping, not user-facing.
async function updatePreferencesFromFeedback(channel, feedback, originalSnippet, revisedSnippet) {
  try {
    const prefs = loadContentPreferences() || {
      email: { dos: [], donts: [], toneNotes: [] },
      instagram: { dos: [], donts: [], toneNotes: [] },
      approvedExamples: [],
      revisedExamples: [],
    };
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `You maintain a content preferences file for Anne Klein marketing.
Current preferences: ${JSON.stringify(prefs)}

New feedback event:
- Channel: ${channel}
- User feedback: "${feedback}"
- Original content snippet: ${originalSnippet}
- Revised content snippet: ${revisedSnippet}

Update the preferences JSON:
- Add any new dos/donts/toneNotes implied by this feedback to the appropriate channel arrays
- Avoid duplicating existing entries
- Add a concise entry to revisedExamples (keep max 20 total)
- Do not remove existing entries unless they directly contradict this feedback

Return ONLY valid JSON matching the existing structure, no commentary.`,
      }],
    });
    const raw = msg.content[0].text.trim();
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const updated = JSON.parse(raw.slice(start, end + 1));
      saveContentPreferences(updated);
    }
  } catch (err) {
    console.error('[prefs update] failed:', err.message);
  }
}

function validateEmailItem(item, personasData) {
  const warnings = [];
  if (item.channel !== 'email') return { valid: true, warnings };

  // component-story uses sections, not looks — different validation path
  if (item.template === 'component-story') {
    if (!item.sections || item.sections.length < 2) {
      warnings.push('component-story email must have at least 2 sections');
    } else {
      // Check 1: thin sections
      const thinSections = item.sections.filter(s => (s.products || []).length < 2).map(s => s.label || 'unnamed');
      if (thinSections.length > 0) warnings.push(`Sections with fewer than 2 products: ${thinSections.join(', ')}`);

      // Check 2: mixed product categories within a section
      const CLOTHING = /dress|jacket|blazer|skirt|pant|top|blouse|tunic|suit|cardigan|sweater|vest|shirt|midi|maxi|mini|jumpsuit|romper|coat/i;
      const SHOES    = /flat|heel|pump|sneaker|boot|sandal|loafer|mule|wedge|shoe/i;
      const BAGS     = /tote|bag|clutch|crossbody|satchel|purse|wristlet/i;
      const JEWELRY  = /necklace|earring|bracelet|ring|pendant|stud|pearl|chain/i;
      function inferCategory(name) {
        if (CLOTHING.test(name)) return 'clothing';
        if (SHOES.test(name))    return 'shoes';
        if (BAGS.test(name))     return 'bags';
        if (JEWELRY.test(name))  return 'jewelry';
        return null;
      }
      for (const section of item.sections) {
        const cats = new Set((section.products || []).map(p => inferCategory(p.name || '')).filter(Boolean));
        if (cats.size > 1) {
          warnings.push(`Section "${section.label}" mixes product types (${[...cats].join(' + ')}) — each section must contain only one product category`);
        }
      }

      // Check 3: outfit-language section names
      const OUTFIT_WORDS = /\b(look|outfit|layered\s+look|complete|combination|paired|styled)\b/i;
      const badLabels = item.sections.filter(s => OUTFIT_WORDS.test(s.label || '')).map(s => s.label);
      if (badLabels.length > 0) {
        warnings.push(`Section names sound like outfit combinations: "${badLabels.join('", "')}" — use component names like "The Dress", "The Shoe", "The Layer"`);
      }

      // Check 4: "N days" / "all week" / "N outfits" claims in subject or preview
      const csText = (item.email?.subjectLine || '') + ' ' + (item.email?.previewText || '');
      const csDayMatches = [...csText.matchAll(/\b(\d+|five|four|three|two|one)\s+day/gi)];
      const csWeekMatch  = /all week/i.test(csText);
      const csOutfitMatches = [...csText.matchAll(/\b(\d+)\s*(outfit|look)s?\b/gi)];
      if (csDayMatches.length > 0 || csWeekMatch) {
        warnings.push(`Subject/preview claims days or "all week" — component-story emails show options, not a weekly schedule. Remove day count claims.`);
      }
      if (csOutfitMatches.length > 0) {
        warnings.push(`Subject/preview claims N outfits/looks — component-story emails don't promise specific outfits. Rewrite to describe the wardrobe concept.`);
      }
    }
    return { valid: warnings.length === 0, warnings };
  }

  if (!item.looks) return { valid: true, warnings };

  const looks = item.looks;
  const subject = (item.email?.subjectLine || '') + ' ' + (item.email?.previewText || '');

  // Check 1: ALL number claims in subject vs actual look count (matchAll catches "3 pieces, 5 days" — not just first)
  const allWeek = /all week/i.test(subject);
  if (allWeek && looks.length < 5) {
    warnings.push(`Subject says "all week" (5 days) but has only ${looks.length} looks`);
  } else {
    const allNumMatches = [...subject.matchAll(/\b(\d+)\s*(outfit|look|day)s?\b/gi)];
    for (const m of allNumMatches) {
      const claimed = parseInt(m[1]);
      if (looks.length !== claimed) {
        warnings.push(`Subject claims ${claimed} ${m[2].toLowerCase()}s but has ${looks.length} looks`);
      }
    }
  }

  // Check 2: Duplicate hero products (within this email)
  const heroHandles = looks.map(l => (l.products || [])[0]?.handle).filter(Boolean);
  const heroSet = new Set(heroHandles);
  if (heroSet.size < heroHandles.length) {
    const dupes = heroHandles.filter((h, i) => heroHandles.indexOf(h) !== i);
    warnings.push(`Duplicate hero products across looks: ${dupes.join(', ')}`);
  }

  // Check 3: Any look with fewer than 2 products
  const thinLooks = looks.filter(l => (l.products || []).length < 2).map(l => l.name);
  if (thinLooks.length > 0) {
    warnings.push(`Looks with fewer than 2 products: ${thinLooks.join(', ')}`);
  }

  // Check 3b: Clothing presence — each look must include at least one clothing item
  const CLOTHING_KW = /dress|jacket|blazer|skirt|pant|top|blouse|tunic|suit|cardigan|sweater|vest|shirt|midi|maxi|mini|jumpsuit|romper|coat/i;
  const accessoryOnlyLooks = looks.filter(l =>
    (l.products || []).length > 0 &&
    !(l.products || []).some(p => CLOTHING_KW.test(p.name || ''))
  ).map(l => l.name);
  if (accessoryOnlyLooks.length > 0) {
    warnings.push(`Looks contain no clothing items (only shoes/bags/jewelry): ${accessoryOnlyLooks.join(', ')} — each look needs at least one dress, jacket, top, or pants`);
  }

  // Check 4: Persona price coherence
  if (personasData && item.targetPersona) {
    const persona = (personasData.personas || []).find(p => p.name === item.targetPersona);
    if (persona) {
      const isEntryPersona = /\$55k|\$65k/.test(persona.income || '');
      const allPrices = looks.flatMap(l => (l.products || []).map(p => p.price || 0)).filter(p => p > 0);
      const avgPrice = allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : 0;
      if (isEntryPersona && avgPrice > 200) {
        warnings.push(`Price mismatch: ${item.targetPersona} but avg product price is $${Math.round(avgPrice)} — too high for her budget`);
      }
    }
  }

  return { valid: warnings.length === 0, warnings };
}

async function critiqueAndRevise(item, warnings, anthropic) {
  const prefs = loadContentPreferences();
  const stylingRules = prefs?.stylingRules ? JSON.stringify(prefs.stylingRules) : '{}';
  const isComponentStory = item.template === 'component-story';
  const fixInstructions = isComponentStory ? `Fix ALL the issues above for this component-story email:
- MIXED CATEGORIES: If a section contains products from more than one type (e.g. dress + shoe in same section), split them into separate sections — one section per product category. Each section = only dresses, or only shoes, or only blazers/jackets, or only bags, etc.
- OUTFIT SECTION NAMES: If any section is named like an outfit ("The Layered Look", "The Complete Outfit", "The Paired Set"), rename it to a product-category name ("The Dress", "The Layer", "The Shoe", "The Bag").
- DAY/OUTFIT CLAIMS: If the subject line or preview text claims "N days", "all week", or "N outfits/looks", rewrite it to describe the wardrobe concept instead (e.g. "Your spring foundation", "Three ways to dress this season", "The pieces that carry you").
- Keep the same theme, persona, template, campaign, and overall angle.` : `Fix ALL the issues above:
- If subject claims N outfits/looks/days, adjust the looks array to have exactly N looks with unique hero products, OR rewrite the subject to match the actual look count — whichever requires fewer changes
- Each look must have a DIFFERENT first (hero) product handle
- Every look needs at least 2 products
- Keep the same theme, persona, template, campaign, and overall styling angle`;
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a fashion editor and copywriter for Anne Klein reviewing a generated email content card.

The following issues were found:
${warnings.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Styling rules: ${stylingRules}

Current item JSON:
${JSON.stringify(item, null, 2)}

${fixInstructions}

Return ONLY the corrected item as valid JSON (same schema as input, no commentary).`,
      }],
    });
    const raw = res.content[0].text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return item;
    const revised = JSON.parse(raw.slice(start, end + 1));
    return { ...item, ...revised, id: item.id, weekOf: item.weekOf, generatedAt: item.generatedAt };
  } catch (e) {
    console.error('[critique] Haiku revision failed:', e.message);
    return item;
  }
}

// Vision validation for looks-based email templates.
// Passes each look's product images to Haiku Vision to confirm it's a coherent outfit.
// Gracefully skips looks where images are unavailable or the API fails.
async function visionValidateLooks(item, anthropic, catalogByHandle) {
  const LOOKS_TEMPLATES = ['multi-look', 'story-led', 'single-hero'];
  if (!LOOKS_TEMPLATES.includes(item.template) || !item.looks?.length) return [];

  const warnings = [];
  for (const look of item.looks) {
    const withImages = (look.products || [])
      .map(p => ({ ...p, imageUrl: (catalogByHandle[p.handle] || {}).image || null }))
      .filter(p => p.imageUrl);

    if (withImages.length === 0) continue; // no images available — text check is the fallback

    try {
      const imageContent = withImages.flatMap(p => [
        { type: 'image', source: { type: 'url', url: p.imageUrl } },
        { type: 'text', text: `${p.name} ($${p.price})` },
      ]);

      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: `These ${withImages.length} products are proposed as one outfit look named "${look.name}" in an Anne Klein email for a professional woman.\n\nEvaluate:\n1. CLOTHING: Does this combination include at least one clothing item (dress, blazer, jacket, top, pants, skirt)? Shoes, bags, and jewelry alone are NOT an outfit.\n2. COHERENCE: Do these pieces work together as a complete, polished professional outfit?\n\nRespond ONLY in JSON with no commentary: {"valid": true|false, "issues": ["issue1"]}`,
            },
          ],
        }],
      });

      const raw = res.content[0].text.trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        const result = JSON.parse(raw.slice(start, end + 1));
        if (!result.valid && result.issues?.length > 0) {
          warnings.push(`Look "${look.name}" failed visual check: ${result.issues.join('; ')}`);
        }
      }
    } catch (e) {
      console.error(`[vision] Skipping look "${look.name}":`, e.message);
      // Graceful degradation — text checks already ran, don't block on vision failure
    }
  }
  return warnings;
}

app.get('/api/weekly-plan', (req, res) => {
  const { week } = req.query;
  if (!week) return res.status(400).json({ error: 'week param required (YYYY-MM-DD)' });
  const plans = loadWeeklyPlans();
  res.json(plans[week] || []);
});

app.post('/api/weekly-plan/generate', async (req, res) => {
  const { weekStart, campaignIds = [], volumes = { email: 2, instagram: 3, hero: 1 }, ownableEventIds = [], mode = 'replace' } = req.body || {};
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' });

  const campaigns = loadCampaigns();
  const allEvents = resolveEvents(loadOwnableEvents(), new Date(weekStart).getFullYear());
  const personas = loadData('personas.json');
  const brandGuidelines = loadData('brand_guidelines.json');
  const plans = loadWeeklyPlans();

  // Compute active campaigns with arc week position
  const weekStartDate = new Date(weekStart);
  const activeCampaigns = campaigns
    .filter(c => campaignIds.length === 0 || campaignIds.includes(c.id))
    .filter(c => {
      const s = new Date(c.startDate), e = new Date(c.endDate);
      return s <= weekStartDate && e >= weekStartDate;
    })
    .map(c => {
      const s = new Date(c.startDate);
      const weekNum = Math.floor((weekStartDate - s) / (7 * 24 * 60 * 60 * 1000)) + 1;
      const totalWeeks = Math.ceil((new Date(c.endDate) - s) / (7 * 24 * 60 * 60 * 1000));
      const arcWeek = (c.storyArc || []).find(w => w.weekNum === weekNum) || null;
      return { ...c, weekNum, totalWeeks, arcWeek };
    });

  // Events in next 35 days (5-week lead time for gifting/planning)
  const lookAheadEnd = new Date(weekStartDate);
  lookAheadEnd.setDate(lookAheadEnd.getDate() + 35);
  const upcomingEvents = allEvents.filter(e => {
    if (!e.date) return false;
    const d = new Date(e.date);
    return d >= weekStartDate && d <= lookAheadEnd;
  }).filter(e => ownableEventIds.length === 0 || ownableEventIds.includes(e.id));

  // Sent history — last 8 weeks
  const calendar = loadCalendar();
  const eightWeeksAgo = new Date(weekStartDate);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
  const sentHistory = calendar
    .filter(i => i.status === 'sent' && new Date(i.date) >= eightWeeksAgo)
    .map(i => ({ channel: i.channel, theme: i.theme, subjectLine: i.subjectLine, date: i.date }));

  // Fetch rich product catalog for Claude (grouped by category, with descriptions + tags)
  const productCatalog = await getProductCatalogForPrompt({ perCategory: 12 }).catch(() => '');

  // Build handle → product map for vision validation (reuses the 30-min Shopify cache)
  const allProducts = await getInStockProducts({ limit: 999 }).catch(() => []);
  const catalogByHandle = Object.fromEntries(allProducts.map(p => [p.handle, p]));

  // Build Claude prompt
  const brandContext = getBrandContext();
  const campaignContext = activeCampaigns.length > 0
    ? activeCampaigns.map(c => `
CAMPAIGN: "${c.name}" (Week ${c.weekNum} of ${c.totalWeeks}, ${c.startDate}–${c.endDate})
Target persona: ${c.persona || 'The Polished Professional'}
Style: ${JSON.stringify(c.styleGuide || {})}
${c.arcWeek ? `THIS WEEK'S ARC: Theme="${c.arcWeek.theme}" | Angle="${c.arcWeek.angle}" | Key message="${c.arcWeek.keyMessage}"` : 'No arc defined for this week.'}
Prior arc weeks: ${(c.storyArc || []).filter(w => w.weekNum < c.weekNum).map(w => `Week ${w.weekNum}: ${w.theme} — ${w.angle}`).join(' | ') || 'none yet'}
`).join('\n---\n')
    : 'No active campaigns for this week. Generate standalone brand-building content.';

  const eventsContext = upcomingEvents.length > 0
    ? upcomingEvents.map(e => `- ${e.name} (${e.date}): ${e.suggestedAngle}`).join('\n')
    : 'No major ownable events in the next 35 days.';

  const sentContext = sentHistory.length > 0
    ? sentHistory.map(i => `[${i.date}] ${i.channel} — Theme: "${i.theme}"${i.subjectLine ? ` | Subject: "${i.subjectLine}"` : ''}`).join('\n')
    : 'No sent history yet.';

  const personasContext = (personas?.personas || []).slice(0, 3).map(p => `
PERSONA: ${p.name} | Age: ${p.ageRange} | Income: ${p.income}
Lifestyle: ${(p.lifestyle || []).slice(0, 2).join(' | ')}
Fashion goals: ${(p.fashionGoals || []).join(' | ')}
Pain points: ${(p.painPoints || []).slice(0, 3).join(' | ')}
Shopping triggers: ${(p.motivators || []).slice(0, 3).join(' | ')}
Content that resonates: ${(p.contentTopics || []).slice(0, 3).join(' | ')}
Her voice: "${p.quoteExample || ''}"
Occasions she dresses for: ${(p.lifestyle || []).filter(l => /meeting|lunch|client|travel|event/i.test(l)).join(' | ') || 'professional settings, business travel, evening events'}
`).join('\n---\n');

  const productContext = productCatalog || '';

  // Inject learned content preferences
  const prefs = loadContentPreferences();
  const activePersonaNames = activeCampaigns.map(c => c.persona).filter(Boolean);
  const personaRuleText = activePersonaNames.map(name => {
    const r = (prefs?.personas || {})[name];
    if (!r) return '';
    return `\n${name} specific rules:\nDos: ${(r.dos || []).join(' | ')}\nDon'ts: ${(r.donts || []).join(' | ')}`;
  }).filter(Boolean).join('\n');
  const prefsContext = prefs ? `
CONTENT RULES (apply to all output):
EMAIL dos: ${prefs.email?.dos?.join(' | ') || 'none yet'}
EMAIL don'ts: ${prefs.email?.donts?.join(' | ') || 'none yet'}
Tone: ${prefs.email?.toneNotes?.join(' | ') || 'none yet'}

STYLING RULES (apply when building looks and product pairings):
Color combos approved: ${prefs.stylingRules?.colorCombinations?.approved?.join(' | ') || ''}
Color combos to avoid: ${prefs.stylingRules?.colorCombinations?.avoid?.join(' | ') || ''}
Outfit logic: ${prefs.stylingRules?.outfitLogic?.join(' | ') || ''}
Occasion framing: ${prefs.stylingRules?.occasionFraming?.join(' | ') || ''}${personaRuleText}${prefs.revisedExamples?.length ? `
Past corrections (apply these lessons):
${prefs.revisedExamples.slice(-5).map(e => `- Feedback "${e.feedback}" → changed "${e.original}" to "${e.revised}"`).join('\n')}` : ''}
` : '';

  // Inject content strategy rules
  const strategy = loadContentStrategy();
  const strategyContext = strategy ? `
CONTENT STRATEGY — honor when selecting email types, Instagram angles, and product focus:

Email monthly mix (targets per 4-week month):
${(strategy.monthlyEmailMix?.slots || []).map(s => `  - ${s.label} (target: ${s.perMonth}x/month, templates: ${s.templates.join('/')}): ${s.description}`).join('\n')}

Instagram weekly mix (targets per week):
${(strategy.instagramWeeklyMix?.slots || []).map(s => `  - ${s.label} (target: ${s.perWeek}x/week): ${s.description}`).join('\n')}

Category rotation order: ${(strategy.categoryRotation?.categories || []).join(' → ')}
Rule: No category should go unspotlighted for more than ${strategy.categoryRotation?.frequencyWeeks || 6} weeks.

Persona rotation: Cycle all personas so each is the primary target at least once every ${strategy.personaRotation?.rotationWeeks || 4} weeks.
${(strategy.personaRotation?.personas || []).map(p => `  - ${p.name}: focus on ${p.topTopics?.slice(0, 2).join(', ')}; avoid ${p.avoidTopics?.slice(0, 1).join(', ')}`).join('\n')}

Hero banner hierarchy: ${(strategy.heroWeeklyFocus?.priority || []).join(' | ')}

Global content rules:
${(strategy.globalRules || []).map(r => `  - ${r}`).join('\n')}
` : '';

  // ── System prompt: stable brand context, personas, schemas, rules ──────────
  const systemPrompt = `You are a marketing strategist, fashion stylist, and copywriter for Anne Klein (anneklein.com). You generate weekly content plans — email campaigns, Instagram posts, and hero banners — that reflect the Anne Klein brand: sophisticated professional fashion for accomplished women 35–55.

${brandContext}

CUSTOMER PERSONAS:
${personasContext}
${prefsContext}${strategyContext}
OUTPUT SCHEMAS — every item must match one of these exactly:

For EMAIL (looks-based templates: multi-look, story-led, category-focus, single-hero):
{
  "channel": "email",
  "campaignId": "<campaign id or null>",
  "ownableEventId": "<event id or null>",
  "theme": "<short theme label>",
  "targetPersona": "<persona name>",
  "template": "<multi-look|story-led|category-focus|single-hero|component-story>",
  "looks": [
    {
      "name": "<evocative look name, e.g. 'The Board Meeting' or 'Friday Closing'>",
      "angle": "<1-sentence styling angle for this look>",
      "products": [{"handle": "<product handle>", "name": "<product name>", "price": 0}]
    }
  ],
  "email": {
    "subjectLine": "<compelling subject, under 50 chars — specific beats generic>",
    "previewText": "<preview text, 80-100 chars>",
    "bodyOutline": "<3-4 bullet points describing body sections>",
    "cta": "<CTA button text>",
    "sendDay": "<recommended day, e.g. Tuesday>"
  }
}

For component-story template ONLY — omit "looks" entirely and use "sections" instead:
{
  "channel": "email",
  "campaignId": "<campaign id or null>",
  "ownableEventId": "<event id or null>",
  "theme": "<short theme label>",
  "targetPersona": "<persona name>",
  "template": "component-story",
  "sections": [
    {
      "label": "<component label, e.g. 'The Dress', 'The Shoe', 'The Layer', 'The Foundation', 'The Bag'>",
      "angle": "<1-sentence description of this component's role in the wardrobe>",
      "products": [{"handle": "<product handle>", "name": "<product name>", "price": 0}]
    }
  ],
  "email": {
    "subjectLine": "<compelling subject, under 50 chars>",
    "previewText": "<preview text, 80-100 chars>",
    "bodyOutline": "<3-4 bullet points describing body sections>",
    "cta": "<CTA button text>",
    "sendDay": "<recommended day, e.g. Tuesday>"
  }
}

For INSTAGRAM:
{
  "channel": "instagram",
  "campaignId": "<campaign id or null>",
  "ownableEventId": "<event id or null>",
  "theme": "<short theme label>",
  "targetPersona": "<persona name>",
  "instagram": {
    "caption": "<full caption, 150-220 chars>",
    "hashtags": ["<max 5 hashtags>"],
    "imageryDirection": "<brief art direction for the image>",
    "productFeature": "<product category or specific piece to feature>"
  }
}

For HERO:
{
  "channel": "hero",
  "campaignId": "<campaign id or null>",
  "ownableEventId": "<event id or null>",
  "theme": "<short theme label>",
  "targetPersona": "<persona name>",
  "hero": {
    "headline": "<punchy headline, 4-8 words>",
    "subhead": "<supporting subhead, 10-16 words>",
    "cta": "<CTA button text>",
    "imageDirection": "<brief description of hero image>"
  }
}

TEMPLATE GUIDANCE:
- "multi-look": 3-4 named looks, each with 2-3 products — default for editorial/narrative campaign emails
- "story-led": 1-2 looks, editorial narrative focus — best for event-driven emails (Mother's Day, etc.)
- "category-focus": 1 look with 4-6 products from one category — best for category launches
- "single-hero": 1 look with 1 hero product + 2 supporting items — best for hero product launches
- "component-story": 3-4 sections each showing 2-3 options of ONE product type (all dresses, all shoes, all blazers, all bags) — best for capsule/workwear planning emails where the customer mixes and matches herself. Use this instead of multi-look when the email theme is about building a wardrobe, not showing specific outfit combinations.

RULES:
- Each piece must feel DIFFERENT from the others — vary tone, product focus, and angle
- If a campaign arc week is defined, ALL pieces should reinforce that arc's theme and key message
- If an ownable event applies, naturally integrate it — do not force it if it doesn't fit
- Do NOT repeat themes from recent sent history provided in the user message
- Distribute emails across different send days (Mon, Tue, Wed, Thu) — not all on the same day
- For EMAIL looks (multi-look, story-led, category-focus, single-hero): each look must have at least one UNIQUE hero product not used in any other look. Each look gets 2-3 complementary products. Structured jacket needs a soft piece underneath; every look needs a bottom or dress; shoes should appear. Use the handle exactly as shown in the catalog. If no catalog was provided, use empty products arrays.
- For EMAIL sections (component-story): each section must contain 2-3 products from the SAME category type — all dresses, OR all shoes, OR all blazers, OR all bags. Never mix categories in one section. Subject line must speak to the wardrobe concept, not claim a specific number of outfits.
- PERSONA TAILORING: Write every email as if you ARE a trusted stylist speaking directly to that specific persona. Use the persona's fashion goals, pain points, and her own voice to shape look names, angles, and subject lines. The Polished Professional should feel understood and efficient. The Emerging Leader should feel mentored not lectured. The Refined Rewinder should feel respected not patronized. The Practical Multitasker should feel seen not judged.

CRITICAL EMAIL RULES for looks-based templates — verify before outputting:
1. SUBJECT LINE MATH: If your subject says "N outfits", "N looks", or "N days" — the looks array MUST contain exactly N looks. "All week" = 5 looks. Fix the count or rewrite the subject.
2. NO REPEATED HEROES: Every look must have a DIFFERENT first (hero) product handle. Swap if reused.
3. COMPLETE OUTFITS ONLY: Each look needs at least 2 products — a top or jacket AND a bottom or dress. Shoes in at least half the looks. No look = accessories only.
4. OUTFIT LOGIC: Never pair two stiff/structured pieces. Every structured top needs something soft underneath.
5. SELF-CHECK: Re-read subject line, count looks, verify all hero products are unique before returning.

CRITICAL RULES for component-story emails — verify before outputting:
1. ONE CATEGORY PER SECTION: "The Dress" = only dresses. "The Shoe" = only shoes. NEVER mix two product types in one section.
2. COMPONENT NAMES ONLY: Labels must name a product category. CORRECT: "The Dress", "The Shoe", "The Layer". WRONG: "The Layered Look", "The Complete Outfit".
3. NO DAY OR OUTFIT CLAIMS: Do NOT write "5 days", "all week", or "N outfits" in subject or preview. Use wardrobe language: "Your spring foundation", "The pieces that carry you".`;

  // ── User message: week-specific context + task ───────────────────────────
  const userPrompt = `Generate a weekly content plan for the week of ${weekStart}.

PLANNING WEEK: ${weekStart}

${campaignContext}
${productContext ? '\nIN-STOCK PRODUCTS (use these handles exactly):\n' + productContext : ''}
UPCOMING OWNABLE EVENTS (next 35 days — plan content to land BEFORE the event):
${eventsContext}

RECENT SENT CONTENT (last 8 weeks — do NOT repeat these themes/angles):
${sentContext}

YOUR TASK:
Generate EXACTLY ${volumes.email || 0} email pieces, ${volumes.instagram || 0} Instagram posts, and ${volumes.hero || 0} hero/site banner pieces for this week.

Return ONLY a JSON array with EXACTLY ${(volumes.email || 0) + (volumes.instagram || 0) + (volumes.hero || 0)} items, starting with [ and ending with ]. No markdown, no commentary.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = msg.content[0].text.trim();
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('Claude did not return a valid JSON array');

    const generated = JSON.parse(raw.slice(start, end + 1));

    // Validate + auto-fix email items — up to 3 attempts per item (text + vision)
    const validated = await Promise.all(generated.map(async (item) => {
      if (item.channel !== 'email') return item;
      const isLooksBased = ['multi-look', 'story-led', 'single-hero', 'category-focus'].includes(item.template);
      let current = item;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { warnings: textWarnings } = validateEmailItem(current, personas);
        const visionWarnings = isLooksBased
          ? await visionValidateLooks(current, anthropic, catalogByHandle)
          : [];
        const allWarnings = [...textWarnings, ...visionWarnings];
        if (allWarnings.length === 0) {
          if (attempt > 1) console.log(`[validate] "${current.theme}" passed on attempt ${attempt}`);
          return current;
        }
        console.log(`[validate] Attempt ${attempt}/3 fixing "${current.theme}": ${allWarnings.join('; ')}`);
        current = await critiqueAndRevise(current, allWarnings, anthropic);
      }
      const { warnings: finalTextWarnings } = validateEmailItem(current, personas);
      const finalVisionWarnings = isLooksBased ? await visionValidateLooks(current, anthropic, catalogByHandle) : [];
      const finalWarnings = [...finalTextWarnings, ...finalVisionWarnings];
      if (finalWarnings.length > 0) console.log(`[validate] "${current.theme}" still has issues after 3 attempts: ${finalWarnings.join('; ')}`);
      return { ...current, validationWarnings: finalWarnings.length > 0 ? finalWarnings : [] };
    }));

    const now = Date.now();
    const items = validated.map((item, i) => {
      // Flatten sections/looks → products, deduped by handle
      const seenHandles = new Set();
      const flatProducts = (
        item.sections
          ? item.sections.flatMap(s => s.products || [])
          : item.looks
            ? item.looks.flatMap(l => l.products || [])
            : (item.products || [])
      ).filter(p => p.handle && !seenHandles.has(p.handle) && seenHandles.add(p.handle));
      return {
        id: `gen_${now}_${i}`,
        weekOf: weekStart,
        approved: false,
        skipped: false,
        generatedAt: new Date().toISOString(),
        ...item,
        products: flatProducts,
      };
    });

    if (mode === 'append') {
      plans[weekStart] = [...(plans[weekStart] || []), ...items];
    } else {
      plans[weekStart] = items;
    }
    saveWeeklyPlans(plans);
    res.json({ ok: true, items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/weekly-plan/approve', (req, res) => {
  const { weekStart, itemIds } = req.body || {};
  if (!weekStart || !Array.isArray(itemIds)) return res.status(400).json({ error: 'weekStart and itemIds required' });
  const plans = loadWeeklyPlans();
  const items = plans[weekStart] || [];
  for (const item of items) {
    if (itemIds.includes(item.id)) item.approved = true;
  }
  plans[weekStart] = items;
  saveWeeklyPlans(plans);
  res.json({ ok: true });
});

app.post('/api/weekly-plan/skip', (req, res) => {
  const { weekStart, itemId } = req.body || {};
  if (!weekStart || !itemId) return res.status(400).json({ error: 'weekStart and itemId required' });
  const plans = loadWeeklyPlans();
  const items = plans[weekStart] || [];
  const item = items.find(i => i.id === itemId);
  if (item) item.skipped = true;
  plans[weekStart] = items;
  saveWeeklyPlans(plans);
  res.json({ ok: true });
});

app.post('/api/weekly-plan/add-to-calendar', (req, res) => {
  const { weekStart, itemIds, dates = {} } = req.body || {};
  if (!weekStart || !Array.isArray(itemIds)) return res.status(400).json({ error: 'weekStart and itemIds required' });
  const plans = loadWeeklyPlans();
  const items = (plans[weekStart] || []).filter(i => itemIds.includes(i.id));
  const calItems = loadCalendar();
  const created = [];

  for (const item of items) {
    // Resolve send date: explicitly provided, or computed from sendDay
    let date = dates[item.id] || weekStart;
    if (!dates[item.id] && item.email?.sendDay) {
      const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const targetDay = days.indexOf(item.email.sendDay);
      if (targetDay !== -1) {
        const d = new Date(weekStart);
        while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1);
        date = d.toISOString().split('T')[0];
      }
    }

    const calItem = {
      id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      channel: item.channel,
      status: 'brief',
      campaignId: item.campaignId || null,
      personaTarget: item.targetPersona || '',
      theme: item.theme || '',
      weeklyPlanId: item.id,
      weekOf: weekStart,
      ownableEventId: item.ownableEventId || null,
      // Pre-populate channel-specific fields
      subjectLine: item.email?.subjectLine || '',
      previewText: item.email?.previewText || '',
      brief: item.email?.bodyOutline
        ? `Body outline:\n${item.email.bodyOutline}\n\nCTA: ${item.email.cta}`
        : item.instagram?.caption
        ? `Caption: ${item.instagram.caption}\n\nHashtags: ${(item.instagram.hashtags || []).join(' ')}\nImagery: ${item.instagram.imageryDirection}\nProduct: ${item.instagram.productFeature}`
        : item.hero
        ? `Headline: ${item.hero.headline}\nSubhead: ${item.hero.subhead}\nCTA: ${item.hero.cta}\nImage direction: ${item.hero.imageDirection}`
        : '',
      heroImageBrief: null,
      selectedProducts: item.products || [],
      assignedTo: '',
      notes: '',
      createdAt: new Date().toISOString(),
    };
    calItems.push(calItem);
    created.push(calItem);
  }

  saveCalendar(calItems);

  // Mark items as added to calendar in the weekly plan
  const planItems = plans[weekStart] || [];
  for (const item of planItems) {
    if (itemIds.includes(item.id)) item.addedToCalendar = true;
  }
  plans[weekStart] = planItems;
  saveWeeklyPlans(plans);

  res.json({ ok: true, created: created.length, items: created });
});

// ── Shopify endpoints ─────────────────────────────────────────────────────────

// GET /api/shopify/products — in-stock product list for the product picker UI
app.get('/api/shopify/products', async (req, res) => {
  const limit = parseInt(req.query.limit) || 999;
  const productType = req.query.type || undefined;
  try {
    const products = await getInStockProducts({ limit, productType });
    res.json({ ok: true, configured: shopifyConfigured(), products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shopify/catalog/refresh — bust 30-min cache and re-fetch all products immediately
app.post('/api/shopify/catalog/refresh', async (_req, res) => {
  if (!shopifyConfigured()) return res.status(400).json({ error: 'Shopify not configured' });
  try {
    invalidateCache();
    const products = await getInStockProducts({ limit: 9999 });
    res.json({ ok: true, count: products.length, refreshedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/content-strategy — load the persistent content strategy config
app.get('/api/content-strategy', (_req, res) => {
  res.json({ ok: true, strategy: loadContentStrategy() });
});

// PUT /api/content-strategy — save updated content strategy config
app.put('/api/content-strategy', (req, res) => {
  const { strategy } = req.body || {};
  if (!strategy) return res.status(400).json({ error: 'strategy required' });
  saveContentStrategy(strategy);
  res.json({ ok: true, strategy: loadContentStrategy() });
});

// POST /api/shopify/check-availability — check current stock for given handles
app.post('/api/shopify/check-availability', async (req, res) => {
  const { handles } = req.body || {};
  if (!handles?.length) return res.status(400).json({ error: 'handles required' });
  try {
    const results = await checkHandles(handles);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/weekly-plan/item/:itemId — update products selection on a plan item
app.patch('/api/weekly-plan/item/:itemId', (req, res) => {
  const { itemId } = req.params;
  const { weekStart, products } = req.body || {};
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' });
  const plans = loadWeeklyPlans();
  const items = plans[weekStart] || [];
  const item = items.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (products !== undefined) item.products = products;
  plans[weekStart] = items;
  saveWeeklyPlans(plans);
  res.json({ ok: true, item });
});

// POST /api/weekly-plan/item/:itemId/chat — Claude revises a single content card based on feedback
app.post('/api/weekly-plan/item/:itemId/chat', async (req, res) => {
  const { itemId } = req.params;
  const { weekStart, message, history = [] } = req.body || {};
  if (!weekStart || !message) return res.status(400).json({ error: 'weekStart and message required' });

  const plans = loadWeeklyPlans();
  const items = plans[weekStart] || [];
  const item = items.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const originalSnapshot = JSON.stringify({ email: item.email, looks: item.looks, template: item.template, theme: item.theme });

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Inject live product catalog so Claude can find real products for swaps
    const productCatalog = await getProductCatalogForPrompt({ perCategory: 12 }).catch(() => '');

    const systemPrompt = `You are a senior marketing editor and fashion stylist for Anne Klein, a classic American women's fashion brand (think: understated authority, not fast fashion).

THE ANNE KLEIN WOMAN: 35–55, professionally accomplished, dresses for impact not trend. Her occasions: boardroom presentations, client lunches, work travel, weekend errands with polish. She buys fewer pieces but wears them more.

STYLING RULES you enforce in all content:
- Outfit logic: blazer + matching trouser OR contrasting texture pant. A structured jacket always pairs with a soft underneath (knit, silk blouse). Never two boxy pieces together.
- Color: AK palette is navy/ivory/camel/black/blush/burgundy. Safe combos: navy+camel, black+ivory, burgundy+camel. Avoid: all-black described as a "look" (too generic), mismatched warm+cool unless intentional.
- Occasion specificity: name the moment — "the Tuesday board meeting" not "work." "A long-haul flight" not "travel."
- Product pairing: shoes should always be mentioned with footwear-adjacent outfits. A blazer look needs a bottom. Never float a single piece without context.
- Copy tone: short declarative sentences. No exclamation points. No words: fresh, effortless, trendy, stunning, must-have, chic. Yes words: precise, polished, considered, built for, made to.

PRODUCT SWAPS — CRITICAL RULES:
- ALWAYS pick replacement products from the IN-STOCK PRODUCTS list below. Never invent products.
- When swapping a product, use the exact handle, name, and price from the catalog.
- Product object format: { "handle": "exact-handle", "name": "Exact Product Name", "price": 00.00 }
- For looks-based emails: return the full updated "looks" array with the swap applied.
- For component-story emails: return the full updated "sections" array with the swap applied. Each section has { label, angle, products[] }.
- If no suitable replacement exists in the catalog, say so in one sentence — do NOT invent a product.

${productCatalog ? `IN-STOCK PRODUCTS (use ONLY these for product swaps):\n${productCatalog}` : ''}

RESPONDING TO FEEDBACK:
- If the message is a QUESTION (starts with "what", "why", "how", "did you", "can you explain") → answer in 1-2 sentences only. No JSON.
- If the message is a REVISION REQUEST → make the change, return ONLY:
  1. \`\`\`json block with the revised fields (only what changed — email, looks, sections, instagram, hero, or theme)
  2. One sentence: "Changed [X] from '[old]' to '[new]'."
  Never explain your reasoning. Never be defensive. Just change it and say what you changed.
- Keep ALL responses under 3 sentences unless showing JSON.`;

    // Only prepend the card context on the first message (when no history yet)
    const isFirstMessage = history.length === 0;
    const userContent = isFirstMessage
      ? `Content card to work with:\n${originalSnapshot}\n\nInstruction: ${message}`
      : message;

    const chatMessages = [
      // Seed the conversation with the card context as the first exchange if we have history
      ...(history.length > 0 ? [{
        role: 'user',
        content: `Content card:\n${originalSnapshot}`,
      }, {
        role: 'assistant',
        content: 'Ready. Tell me what to change.',
      }] : []),
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent },
    ];

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: chatMessages,
    });

    const raw = msg.content[0].text.trim();

    // Extract JSON block
    let updatedFields = null;
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { updatedFields = JSON.parse(jsonMatch[1].trim()); } catch {}
    }
    // Fallback: look for bare { ... }
    if (!updatedFields) {
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        try { updatedFields = JSON.parse(raw.slice(s, e + 1)); } catch {}
      }
    }

    // Extract explanation (text after the JSON block)
    const explanation = raw.replace(/```json[\s\S]*?```/, '').trim() || 'Content updated.';

    if (updatedFields) {
      // Merge revised fields, preserve identity fields
      Object.assign(item, updatedFields);
      item.id = itemId; // never overwrite
      item.weekOf = weekStart;
      // Re-flatten products list from whichever structure was updated
      if (updatedFields.looks) {
        const seen2 = new Set();
        item.products = updatedFields.looks.flatMap(l => l.products || [])
          .filter(p => p.handle && !seen2.has(p.handle) && seen2.add(p.handle));
      } else if (updatedFields.sections) {
        const seen2 = new Set();
        item.products = updatedFields.sections.flatMap(s => s.products || [])
          .filter(p => p.handle && !seen2.has(p.handle) && seen2.add(p.handle));
      }
      item.lastEditedAt = new Date().toISOString();
      plans[weekStart] = items;
      saveWeeklyPlans(plans);
    }

    // Log feedback
    const revisedSnapshot = JSON.stringify({ email: item.email, looks: item.looks, template: item.template });
    appendFeedbackLog({
      itemId,
      channel: item.channel,
      theme: item.theme,
      message,
      originalSnapshot,
      revisedSnapshot,
    });

    // Async background: update preferences from this feedback (fire and forget)
    updatePreferencesFromFeedback(item.channel, message, originalSnapshot, revisedSnapshot);

    res.json({ ok: true, reply: explanation, updatedItem: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
