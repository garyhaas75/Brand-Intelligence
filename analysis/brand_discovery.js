/**
 * Brand Discovery — entry point for the "Add Brand" flow.
 * Given a URL, scrapes the homepage and uses Claude to extract:
 *   - brand name, industry, tagline, positioning, brand archetype
 *   - 5-8 identified competitors (with URLs)
 * Writes: data/brands/[slug]/profile.json
 * Updates: data/brands.json (discovery status → complete)
 * Then queues all downstream analysis modules.
 *
 * Usage:
 *   node analysis/brand_discovery.js --slug=<slug> --url=<url>
 *   node analysis/brand_discovery.js --slug=<slug> --refresh-all  (re-run all modules)
 */

require('dotenv').config();
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = path.join(__dirname, '../data');
const BRANDS_FILE = path.join(DATA_DIR, 'brands.json');

function log(msg) { console.log(`[brand_discovery] [${new Date().toISOString()}] ${msg}`); }

function loadBrandsRegistry() {
  try { return JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8')); } catch { return { brands: [] }; }
}
function saveBrandsRegistry(data) {
  fs.writeFileSync(BRANDS_FILE, JSON.stringify(data, null, 2));
}
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function updateRegistryStatus(slug, updates) {
  const registry = loadBrandsRegistry();
  const idx = registry.brands.findIndex(b => b.slug === slug);
  if (idx !== -1) {
    Object.assign(registry.brands[idx], updates);
    saveBrandsRegistry(registry);
  }
}

async function scrapeHomepage(url) {
  log(`Launching Playwright for: ${url}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());

  const data = { url, title: '', h1s: [], h2s: [], metaDescription: '', navCategories: [], socialLinks: {}, footerLinks: [] };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    data.title = await page.title().catch(() => '');
    data.metaDescription = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');

    // OG tags
    data.ogTitle = await page.$eval('meta[property="og:title"]', el => el.content).catch(() => '');
    data.ogDescription = await page.$eval('meta[property="og:description"]', el => el.content).catch(() => '');

    // Headings
    data.h1s = await page.$$eval('h1', els => els.map(e => e.innerText.trim()).filter(t => t.length > 1 && t.length < 200)).catch(() => []);
    data.h2s = await page.$$eval('h2', els => els.map(e => e.innerText.trim()).filter(t => t.length > 1 && t.length < 200).slice(0, 10)).catch(() => []);

    // Nav categories
    const navLinks = await page.$$eval('nav a, header a, [role="navigation"] a', anchors =>
      anchors.map(a => a.innerText.trim().replace(/\s+/g, ' ')).filter(t => t.length > 1 && t.length < 50 && !/^(sign|log|search|cart|bag|account|help|stores|wishlist)/i.test(t))
    ).catch(() => []);
    data.navCategories = [...new Set(navLinks)].slice(0, 30);

    // Social links from footer/header
    const allLinks = await page.$$eval('a[href]', anchors => anchors.map(a => a.href)).catch(() => []);
    const socialPatterns = { instagram: /instagram\.com\/([^/?]+)/, twitter: /twitter\.com\/([^/?]+)|x\.com\/([^/?]+)/, facebook: /facebook\.com\/([^/?]+)/, linkedin: /linkedin\.com\/company\/([^/?]+)/ };
    for (const [platform, pattern] of Object.entries(socialPatterns)) {
      for (const link of allLinks) {
        const match = link.match(pattern);
        if (match) { data.socialLinks[platform] = match[1] || match[2]; break; }
      }
    }

    // Footer text (about, brand story signals)
    data.footerText = await page.$eval('footer', el => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 500)).catch(() => '');

    log(`Scraped: title="${data.title}", h1s=${data.h1s.length}, nav=${data.navCategories.length}`);
  } catch (err) {
    log(`Scrape error: ${err.message}`);
    data.error = err.message;
  }

  await browser.close();
  return data;
}

async function researchLocalCompetitors(anthropic, brandName, industry, market) {
  if (!market || market === 'Global') return [];
  log(`  Pre-researching local ${industry} ecommerce competitors in ${market}...`);
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content:
        `List all known ${industry} retailers that have an ACTIVE ECOMMERCE WEBSITE serving customers in ${market}.
Brand context: This research is for a brand named "${brandName}" in the ${industry} industry.

ONLY include businesses that:
- Sell products ONLINE via a working ecommerce website with a shopping cart
- Actively deliver to customers in ${market}
- Are general ${industry} RETAILERS (sell multiple brands/products, not just one)
- Have a local website or local domain (e.g. brand.lb, brand.ae) if one exists

DO NOT include:
- Entertainment venues, theme parks, or experience centers
- Single-brand manufacturer stores (e.g. a store that only sells LEGO)
- Fashion, clothing, or lifestyle brands not directly selling ${industry} products
- Global brands that have no confirmed local ecommerce presence in ${market}
- Businesses whose websites you are not confident about

For each, provide: name, website URL (use local domain if it exists), and type.
Return ONLY a JSON array with no other text:
[{ "name": "...", "url": "https://...", "type": "ecommerce|both" }]
If you are not confident about a URL, omit that entry rather than guess.
List up to 12 businesses.` }]
    });
    const raw = msg.content[0].text;
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      log(`  Found ${parsed.length} local competitors via pre-research`);
      return parsed;
    }
  } catch (err) { log(`  Local competitor pre-research failed: ${err.message}`); }
  return [];
}

async function discoverWithClaude(scraped, slug) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Extract country hint from URL TLD
  let tldHint = '';
  let detectedMarket = null;
  try {
    const hostname = new URL(scraped.url).hostname;
    const tld = hostname.split('.').slice(-1)[0];
    const tldMap = { lb: 'Lebanon', ae: 'UAE', sa: 'Saudi Arabia', eg: 'Egypt', jo: 'Jordan', kw: 'Kuwait', qa: 'Qatar', bh: 'Bahrain', om: 'Oman', uk: 'United Kingdom', au: 'Australia', ca: 'Canada', de: 'Germany', fr: 'France', in: 'India', sg: 'Singapore' };
    if (tldMap[tld]) { detectedMarket = tldMap[tld]; tldHint = `URL TLD (.${tld}) strongly suggests this brand operates in: ${tldMap[tld]}`; }
  } catch {}

  // Pre-research local competitors if market is detectable
  // Use navCategories for industry, fall back to page title, then slug as last resort
  const roughIndustry = scraped.navCategories.slice(0, 5).join(', ') || scraped.title || slug.replace(/-/g, ' ') || 'retail';
  // Extract rough brand name from URL for context
  const roughBrandName = scraped.title || new URL(scraped.url).hostname.replace(/^www\./, '').split('.')[0];
  const localCompetitors = detectedMarket ? await researchLocalCompetitors(anthropic, roughBrandName, roughIndustry, detectedMarket) : [];
  const localCompetitorContext = localCompetitors.length > 0
    ? `\nKNOWN LOCAL COMPETITORS IN ${detectedMarket} (pre-researched — use these as your primary source for identifiedCompetitors):\n${localCompetitors.map(c => `- ${c.name} (${c.type}): ${c.url}`).join('\n')}\n`
    : '';

  const prompt = `You are a brand intelligence analyst. Analyze the following data scraped from a brand's homepage and return a JSON profile.

SCRAPED HOMEPAGE DATA:
URL: ${scraped.url}
${tldHint ? `Geographic signal: ${tldHint}` : ''}
Page title: ${scraped.title}
OG title: ${scraped.ogTitle || ''}
Meta description: ${scraped.metaDescription || ''}
OG description: ${scraped.ogDescription || ''}
H1 headings: ${scraped.h1s.join(' | ') || 'none found'}
H2 headings: ${scraped.h2s.slice(0, 5).join(' | ') || 'none found'}
Navigation categories: ${scraped.navCategories.join(', ') || 'none found'}
Footer text snippet: ${scraped.footerText?.slice(0, 300) || ''}
${localCompetitorContext}
TASK: Return a JSON object with this exact structure. Be specific and accurate — base all answers on the scraped data above, not assumptions.

{
  "name": "official brand name",
  "industry": "specific industry (e.g. 'Women\\'s Apparel', 'Athletic Footwear', 'Home Decor')",
  "tagline": "brand tagline or key marketing phrase from the page (exact quote if found, otherwise your best inference)",
  "positioning": "1-sentence positioning statement based on the homepage content",
  "brandArchetype": "one of: The Hero, The Caregiver, The Explorer, The Sage, The Creator, The Ruler, The Jester, The Lover, The Outlaw, The Magician, The Everyman, The Innocent",
  "brandArchetypeRationale": "1 sentence explaining why this archetype fits",
  "market": "the specific country or city/region this brand operates in (e.g. 'Lebanon', 'UAE', 'Saudi Arabia', 'United Kingdom', 'Global')",
  "identifiedCompetitors": [
    {
      "name": "Competitor Brand Name",
      "url": "https://www.competitor.com",
      "rationale": "1 sentence on why this is a direct competitor IN THE SAME MARKET"
    }
  ],
  "discoveryNotes": "any caveats or uncertainties about the data quality"
}

Rules for identifiedCompetitors:
- CRITICAL: Only list brands that have an ACTUAL PHYSICAL PRESENCE or ACTIVE LOCAL WEBSITE serving the SAME GEOGRAPHIC MARKET as this brand. If the brand is in Lebanon, only include competitors operating IN Lebanon — not global brands that happen to share the same industry.
- List 5-8 DIRECT competitors (same industry, similar price point, similar target customer, SAME MARKET)
- Include only real brands with real website URLs that you are confident about
- For regional/local markets (e.g. Lebanon, UAE), prioritize local and regional chains over global-only brands
- If a global brand has confirmed local stores or a dedicated local website (e.g. amazon.ae for UAE), it qualifies
- If you are uncertain whether a brand operates in this specific market, omit it rather than guess
- If you cannot find 5 confident competitors for this specific market, return fewer — accuracy over quantity`;

  log('Calling Claude for brand profile extraction...');
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text;
  log(`Claude response length: ${raw.length} chars`);

  // Extract JSON from response
  const start = raw.indexOf('{');
  let result = null;
  if (start !== -1) {
    let depth = 0, end = -1;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      try { result = JSON.parse(raw.slice(start, end + 1)); } catch (e) { log(`JSON parse error: ${e.message}`); }
    }
  }

  if (!result) throw new Error('Failed to extract JSON from Claude response');
  return result;
}

const SCRIPT_TO_MODULE = {
  'competitive_analysis.js': 'competitive_analysis',
  'social_audit.js': 'social_intelligence',
  'website_audit.js': 'site_intelligence',
  'search_seo.js': 'search_seo',
  'personas.js': 'personas',
  'action_plan.js': 'action_plan',
};

function spawnModule(script, slug, extraArgs = []) {
  log(`Spawning: ${script} --slug=${slug}`);
  const moduleName = SCRIPT_TO_MODULE[script] || script.replace('.js', '');

  // stdio needs a real file descriptor. A freshly created WriteStream still has
  // fd === null, which makes spawn() throw ERR_INVALID_ARG_VALUE, so open the fd
  // synchronously. Logging must never be able to stop a module from running.
  let stdio = 'ignore';
  try {
    const brandDir = path.join(DATA_DIR, 'brands', slug);
    ensureDir(brandDir);
    const logFd = fs.openSync(path.join(brandDir, `${moduleName}.log`), 'a');
    stdio = ['ignore', logFd, logFd];
  } catch (err) {
    log(`WARN: could not open log file for ${moduleName}, running without logs: ${err.message}`);
  }

  try {
    const child = spawn('node', [path.join(__dirname, script), `--slug=${slug}`, ...extraArgs], {
      env: { ...process.env },
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio,
    });
    child.unref();
  } catch (err) {
    // One module failing to spawn must not take down the remaining queued modules.
    log(`ERROR: failed to spawn ${script} for ${slug}: ${err.message}`);
  }
}

async function run() {
  const args = process.argv.slice(2);
  const slugArg = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  const urlArg = (args.find(a => a.startsWith('--url=')) || '').replace('--url=', '');
  const refreshAll = args.includes('--refresh-all');

  if (!slugArg) { log('ERROR: --slug= required'); process.exit(1); }

  const brandDir = path.join(DATA_DIR, 'brands', slugArg);
  ensureDir(brandDir);
  ensureDir(path.join(brandDir, 'history'));

  if (refreshAll) {
    log(`Re-running all modules for slug: ${slugArg}`);
    const scripts = ['competitive_analysis.js', 'social_audit.js', 'website_audit.js', 'search_seo.js', 'personas.js'];
    scripts.forEach(s => spawnModule(s, slugArg));
    // action_plan runs last (depends on all others) — delay spawn
    setTimeout(() => spawnModule('action_plan.js', slugArg), 5 * 60 * 1000);
    return;
  }

  if (!urlArg) { log('ERROR: --url= required for discovery'); process.exit(1); }

  try {
    // 1. Scrape homepage
    const scraped = await scrapeHomepage(urlArg);

    // 2. Claude extraction
    const discovered = await discoverWithClaude(scraped, slugArg);

    // 3. Build profile.json — merge with existing to preserve manual edits
    const now = new Date().toISOString();
    const existingProfilePath = path.join(brandDir, 'profile.json');
    const existingProfile = fs.existsSync(existingProfilePath)
      ? JSON.parse(fs.readFileSync(existingProfilePath, 'utf8'))
      : null;

    // Merge competitors: manually-set ones always win and come first.
    // Discovery can add new entries but never removes or demotes manually-set competitors.
    const existingComps = existingProfile?.identifiedCompetitors || [];
    const manualComps = existingComps.filter(e => e.manuallySet);
    const autoComps = existingComps.filter(e => !e.manuallySet);

    // Build discovered list (excluding any already in manualComps)
    const discoveredComps = (discovered.identifiedCompetitors || [])
      .filter(c => !manualComps.find(m => m.name === c.name || m.url === c.url))
      .map(c => {
        const existing = autoComps.find(e => e.name === c.name || e.url === c.url);
        return { name: c.name, url: c.url, rationale: c.rationale, discoveredAt: now, instagramHandle: existing?.instagramHandle || null };
      });

    // Manual first, then discovered (capped at 6 to avoid bloat)
    const mergedCompetitors = [...manualComps, ...discoveredComps.slice(0, 6)];

    const profile = {
      slug: slugArg,
      name: discovered.name || new URL(urlArg).hostname.replace(/^www\./, ''),
      url: urlArg,
      industry: discovered.industry || null,
      tagline: discovered.tagline || null,
      positioning: discovered.positioning || null,
      brandArchetype: discovered.brandArchetype || null,
      brandArchetypeRationale: discovered.brandArchetypeRationale || null,
      market: discovered.market || existingProfile?.market || null,
      identifiedCompetitors: mergedCompetitors,
      social: {
        instagram: scraped.socialLinks?.instagram || existingProfile?.social?.instagram || null,
        twitter: scraped.socialLinks?.twitter || scraped.socialLinks?.x || existingProfile?.social?.twitter || null,
      },
      discoveryNotes: discovered.discoveryNotes || null,
      discoveredAt: existingProfile?.discoveredAt || now,
      updatedAt: now,
    };

    fs.writeFileSync(existingProfilePath, JSON.stringify(profile, null, 2));
    log(`Profile saved: ${profile.name} (${profile.industry}), ${profile.identifiedCompetitors.length} competitors identified`);

    // 4. Update brands registry
    updateRegistryStatus(slugArg, {
      name: profile.name,
      industry: profile.industry,
      discoveryStatus: 'complete',
      lastRefreshedAt: now,
    });

    // 5. Spawn downstream modules (staggered to avoid memory spikes)
    const modules = ['competitive_analysis.js', 'website_audit.js', 'social_audit.js', 'search_seo.js', 'personas.js'];
    modules.forEach((script, i) => {
      setTimeout(() => spawnModule(script, slugArg), i * 30000); // 30s stagger
    });
    // action_plan runs after all others complete (rough estimate: 5 min after last module)
    setTimeout(() => spawnModule('action_plan.js', slugArg), (modules.length * 30000) + 5 * 60 * 1000);

    log('Discovery complete. Downstream modules queued.');
  } catch (err) {
    log(`FATAL: ${err.message}`);
    updateRegistryStatus(slugArg, { discoveryStatus: 'failed' });
    process.exit(1);
  }
}

run();
