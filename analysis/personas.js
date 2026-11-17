/**
 * Customer Personas Generator — slug-aware, external brand only.
 * Uses competitive intelligence, social, and site data to build 3-5 personas.
 *
 * Usage: node analysis/personas.js --slug=<brand-slug>
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { MODEL_DEEP, MODEL_FAST, EFFORT_LOW, extractText } = require('../utils/models');
const fs = require('fs');
const path = require('path');
const { getBrandContext } = require('../utils/brand_context');

const DATA_DIR = path.join(__dirname, '../data');

function log(msg) { console.log(`[personas] [${new Date().toISOString()}] ${msg}`); }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function loadBrandData(slug, filename) {
  const fp = path.join(DATA_DIR, 'brands', slug, filename);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function saveBrandData(slug, filename, data) {
  ensureDir(path.join(DATA_DIR, 'brands', slug));
  fs.writeFileSync(path.join(DATA_DIR, 'brands', slug, filename), JSON.stringify(data, null, 2));
}

function archiveData(slug, module, data) {
  const histDir = path.join(DATA_DIR, 'brands', slug, 'history');
  ensureDir(histDir);
  const ts = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(histDir, `${module}_${ts}.json`), JSON.stringify(data, null, 2));
}

function extractBraces(text) {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
  const start = stripped.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') { depth--; if (depth === 0) return stripped.slice(start, i + 1); }
  }
  return null;
}

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  const profile = loadBrandData(slug, 'profile.json');
  if (!profile) { log('ERROR: profile.json not found'); process.exit(1); }

  log(`Generating personas for: ${profile.name}`);

  // Load all available intel for this brand
  const competitive = loadBrandData(slug, 'competitive_analysis.json');
  const socialIntel = loadBrandData(slug, 'social_intelligence.json');
  const siteIntel = loadBrandData(slug, 'site_intelligence.json');
  const searchSeo = loadBrandData(slug, 'search_seo.json');

  const brandContext = getBrandContext(slug);

  // Build intel summary from available data
  const intelParts = [];

  if (competitive?.competitors?.length) {
    const compSummary = competitive.competitors.slice(0, 4).map(c =>
      `${c.name} (${c.pricingTier}): ${c.positioningStatement}`
    ).join('\n');
    intelParts.push(`COMPETITIVE LANDSCAPE:\n${compSummary}`);
    if (competitive.topAssortmentGaps?.length) {
      intelParts.push(`ASSORTMENT GAPS: ${competitive.topAssortmentGaps.slice(0, 5).join(', ')}`);
    }
  }

  if (socialIntel?.brands?.length) {
    const targetSocial = socialIntel.brands.find(b => b.role === 'target');
    if (targetSocial?.contentThemes?.length) {
      intelParts.push(`SOCIAL CONTENT THEMES: ${targetSocial.contentThemes.slice(0, 6).map(t => t.theme).join(', ')}`);
    }
    const allHashtags = socialIntel.brands.flatMap(b => (b.topHashtags || []).slice(0, 5).map(h => h.tag));
    if (allHashtags.length) intelParts.push(`TOP HASHTAGS: ${[...new Set(allHashtags)].slice(0, 15).join(', ')}`);
  }

  if (siteIntel?.brands?.length) {
    const targetSite = siteIntel.brands.find(b => b.role === 'target');
    // auditBasis 'benchmark' means the brand's own site was not observed: say nothing about what it
    // contains (older data has no auditBasis and keeps the original wording byte for byte)
    const siteUnseen = siteIntel.auditBasis === 'benchmark';
    if (!siteUnseen && targetSite?.featuredCategories?.length) {
      intelParts.push(`PRODUCT CATEGORIES: ${targetSite.featuredCategories.slice(0, 15).join(', ')}`);
    }
    if (siteIntel.navGaps?.length) {
      intelParts.push(`${siteUnseen ? 'CATEGORIES COMPETITORS HAVE (the brand\'s own site was not observed, so do not assume what it lacks)' : 'NAVIGATION GAPS VS COMPETITORS'}: ${(Array.isArray(siteIntel.navGaps) ? siteIntel.navGaps.slice(0, 5).map(g => g.category || g) : []).join(', ')}`);
    }
  }

  if (searchSeo?.estimatedKeywordTerritory?.length) {
    intelParts.push(`ESTIMATED SEARCH KEYWORDS: ${searchSeo.estimatedKeywordTerritory.slice(0, 15).join(', ')}`);
  }

  if (searchSeo?.geoSection?.queries?.length) {
    const geoQueries = searchSeo.geoSection.queries.map(q => q.query).slice(0, 8);
    intelParts.push(`AI SHOPPING QUERY TYPES: ${geoQueries.join(' | ')}`);
  }

  const combinedIntel = intelParts.join('\n\n---\n\n');

  // Real customer evidence (marketplace reviews, brand mix, Japan demand). Both files are
  // optional; when neither exists the digest is '' and the prompt is exactly the legacy prompt.
  const evidenceDigest = buildEvidenceDigest(
    loadBrandData(slug, 'marketplace.json'),
    loadBrandData(slug, 'jp_demand.json'),
  );
  if (evidenceDigest) log(`Evidence digest: ${evidenceDigest.length} chars`);

  const prompt = buildPersonaPrompt({ profile, slug, brandContext, combinedIntel, evidenceDigest, now: new Date().toISOString() });

  log('Calling Claude opus to generate personas...');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const msg = await anthropic.messages.create({
    model: MODEL_DEEP,
    max_tokens: 12000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = extractText(msg);
  const jsonStr = extractBraces(raw);
  if (!jsonStr) { log('ERROR: Could not extract JSON from Claude response'); process.exit(1); }

  const output = JSON.parse(jsonStr);
  output.generatedAt = new Date().toISOString();
  output.brandSlug = slug;
  output.totalPersonas = output.personas?.length || 0;

  log(`Generated ${output.totalPersonas} personas`);
  output.personas?.forEach((p, i) => log(`  ${i + 1}. ${p.name} (${p.ageRange})`));

  const existing = loadBrandData(slug, 'personas.json');
  if (existing) archiveData(slug, 'personas', existing);
  saveBrandData(slug, 'personas.json', output);
  log('Done.');
}

// ─── Evidence digest ────────────────────────────────────────────────────────

const DIGEST_MAX_CHARS = 6000;
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };

const isJapaneseReview = (r) => (r.lang ? r.lang === 'ja' : /[\u3040-\u30ff\u4e00-\u9fff]/.test(String(r.text || '')));

// Pick reviews spread across ratings so pain points (low stars) are represented, not only praise.
// Japanese reviews come first and sources alternate, so one marketplace (or Amazon's reviews from
// other countries) cannot fill the whole sample.
function sampleReviews(reviews, n) {
  const valid = (Array.isArray(reviews) ? reviews : []).filter(r => r && r.text);
  const bySource = new Map();
  for (const r of valid) {
    const k = r.source || '?';
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k).push(r);
  }
  const interleaved = [];
  const queues = [...bySource.values()];
  for (let i = 0; interleaved.length < valid.length; i++) {
    for (const q of queues) if (i < q.length) interleaved.push(q[i]);
  }
  const list = [...interleaved.filter(isJapaneseReview), ...interleaved.filter(r => !isJapaneseReview(r))];
  const low = list.filter(r => Number(r.rating) > 0 && Number(r.rating) <= 3);
  const rest = list.filter(r => !low.includes(r));
  const out = [];
  let i = 0;
  while (out.length < n && (i < low.length || i < rest.length)) {
    if (i < rest.length) out.push(rest[i]);
    if (out.length < n && i < low.length) out.push(low[i]);
    i++;
  }
  return out;
}

// Data carried forward from an earlier run after a failed refresh is labelled with its date.
const staleTag = (x, file) => (x && x.stale ? ` [stale, as of ${String(x.asOf || file?.generatedAt || 'an earlier run').slice(0, 10)}]` : '');

/**
 * Compact, size-capped text digest of real customer evidence for the persona prompt.
 * Every line carries an id ([R1], [B1], [C1], [T1], [D1]) the model must cite.
 * Returns '' when there is no usable evidence.
 */
function buildEvidenceDigest(marketplace, jpDemand, { maxChars = DIGEST_MAX_CHARS } = {}) {
  const sections = [];

  const mp = marketplace && typeof marketplace === 'object' ? marketplace : null;
  if (mp) {
    const reviews = sampleReviews(mp.reviews, 24);
    if (reviews.length) {
      sections.push(['MARKETPLACE REVIEWS (customer words, may be Japanese):',
        ...reviews.map((r, i) => `[R${i + 1}] ${r.source || '?'}${r.reviewedIn ? ` (reviewed in ${clip(r.reviewedIn, 20)})` : ''}${staleTag(r, mp)} | ${r.rating ?? '?'}/5 | ${clip(r.productTitle, 60)} | "${clip(r.text, 220)}"`)]);
    }
    const mix = (Array.isArray(mp.brandMix) ? mp.brandMix : []).filter(b => b && b.brand).slice(0, 15);
    if (mix.length) {
      sections.push(['BRAND MIX IN BEST-SELLER LISTS (brand: listings):',
        ...mix.map((b, i) => `[B${i + 1}] ${clip(b.brand, 40)}: ${b.count ?? '?'}`)]);
    }
    // Blocked or empty categories carry no evidence, so they get no citation id.
    const cats = (Array.isArray(mp.categories) ? mp.categories : [])
      .filter(c => c && c.category && Array.isArray(c.topItems) && c.topItems.length).slice(0, 8);
    if (cats.length) {
      sections.push(['BEST-SELLER CATEGORIES (top items, price in JPY):',
        ...cats.map((c, i) => {
          const items = (Array.isArray(c.topItems) ? c.topItems : []).slice(0, 3)
            .map(it => `${clip(it.title, 50)}${it.priceJPY != null ? ` JPY${it.priceJPY}` : ''}${it.reviewCount != null ? ` (${it.reviewCount} reviews)` : ''}`);
          return `[C${i + 1}] ${c.source || '?'} ${clip(c.category, 40)}${staleTag(c, mp)}: ${items.join('; ')}`;
        })]);
    }
  }

  const jd = jpDemand && typeof jpDemand === 'object' ? jpDemand : null;
  if (jd) {
    // A term without an interest timeline is not evidence (run 1: the Trends call failed and all
    // five terms were listed as "no interest data", each with a citable id). Only real data is cited.
    const trends = (Array.isArray(jd.trends) ? jd.trends : []).filter(t => t && t.term && t.interestOverTime).slice(0, 5);
    if (trends.length) {
      sections.push(['GOOGLE TRENDS, JAPAN, LAST 12 MONTHS (0-100 index):',
        ...trends.map((t, i) => {
          const s = t.interestOverTime;
          const stat = s ? `mean ${s.mean}, latest ${s.latest}, peak ${s.peak?.value} at ${s.peak?.at || '?'}, ${s.direction}` : 'no interest data';
          const rel = (Array.isArray(t.topRelated) ? t.topRelated : []).slice(0, 5).map(r => r.query).filter(Boolean);
          return `[T${i + 1}] ${t.term}${t.termEn ? ` (${t.termEn})` : ''}${staleTag(t, jd)}: ${stat}${rel.length ? `; related: ${rel.join(', ')}` : ''}`;
        })]);
    }
    const ds = jd.demographics?.datasets && typeof jd.demographics.datasets === 'object' ? Object.entries(jd.demographics.datasets) : [];
    if (ds.length) {
      sections.push([`JAPAN BASELINE DEMOGRAPHICS (${clip(jd.demographics.source, 60)})${staleTag(jd.demographics, jd)}:`,
        ...ds.slice(0, 4).map(([k, v], i) => {
          const rows = (Array.isArray(v?.rows) ? v.rows : []).slice(0, 6).map(r => clip(Object.entries(r).map(([a, b]) => `${a}=${b}`).join(' '), 120));
          return `[D${i + 1}] ${clip(v?.label || k, 60)}: ${rows.join(' | ') || 'no rows'}`;
        })]);
    }
  }

  if (!sections.length) return '';

  // A partial marketplace file (the run crashed) is flagged first so it cannot be read as complete.
  // The note has no citation id: it qualifies evidence, it is not evidence.
  if (mp && mp.partial) {
    const un = (Array.isArray(mp.unreached) ? mp.unreached : []).slice(0, 8).map(u => clip(u, 40));
    sections.unshift([`NOTE: the latest marketplace run did not finish${un.length ? ` (not reached: ${un.join(', ')})` : ''}. Lines marked stale come from an earlier run; treat them as older evidence and do not treat missing categories as absent from the market.`]);
  }

  // Hard cap: add whole lines until the budget is spent, so the digest never ends mid-citation.
  const lines = [];
  let used = 0;
  for (const sec of sections) {
    for (const line of [...sec, '']) {
      if (used + line.length + 1 > maxChars) { lines.push('(evidence truncated to fit)'); return lines.join('\n').trim(); }
      lines.push(line);
      used += line.length + 1;
    }
  }
  return lines.join('\n').trim();
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function buildPersonaPrompt({ profile, slug, brandContext, combinedIntel, evidenceDigest = '', now }) {
  const evidenceBlock = evidenceDigest ? `

---
CUSTOMER EVIDENCE (real marketplace and demand data, each line has a citation id):
${evidenceDigest}

EVIDENCE RULES:
- Ground every persona in the CUSTOMER EVIDENCE above wherever it applies. Japanese review text is input; write all persona fields in English. Short Japanese quotes (under 20 characters) are allowed inside quoteExample and evidence notes, followed by an English gloss.
- For each persona add an "evidence" object keyed by attribute name (ageRange, income, location, lifestyle, values, shoppingBehaviors, painPoints, motivators, preferredChannels, quoteExample). Each value is {"status": "evidenced" | "inferred", "cites": ["R3", "T1"], "note": "one short line"}.
- Use "evidenced" only when a cited line directly supports the attribute. Anything without support is "inferred" with an empty cites array. Do not invent citation ids.` : '';

  return `You are a consumer insights researcher. Based on all the intelligence data below about ${profile.name} and its competitive landscape, build 3-4 detailed customer personas for ${profile.name}'s target customers.

BRAND CONTEXT:
${brandContext}

---
COMPETITIVE INTELLIGENCE DATA:
${combinedIntel || 'Limited data available — base personas on brand positioning and industry context.'}${evidenceBlock}

Create exactly ${combinedIntel.length > 200 ? '4' : '3'} personas. For each persona include:
- name (evocative label, e.g. "The Executive Achiever")
- ageRange
- income (household, e.g. "$85k-$140k")
- occupation (array of 2-3 examples)
- location (e.g. "Metro areas, Northeast and Midwest")
- lifestyle (array of 3-4 bullet points)
- values (array of 4-5 core values)
- fashionGoals (array of 3-4 points)
- shoppingBehaviors (array of 3-4 points)
- painPoints (array of 3-4 frustrations)
- motivators (array of 3-4 purchase drivers)
- contentTopics (array of 4-5 topics)
- preferredChannels (array, ranked)
- brandFit (why ${profile.name} is relevant to this persona — 2-3 sentences)
- quoteExample (one realistic quote this persona might say)

Return ONLY valid JSON:
{
  "generatedAt": "${now}",
  "brandSlug": "${slug}",
  "totalPersonas": 3,
  "personas": [],
  "summaryInsights": ["4-5 cross-persona insights for marketing strategy"]
}`;
}

module.exports = { buildEvidenceDigest, buildPersonaPrompt, sampleReviews, DIGEST_MAX_CHARS };

if (require.main === module) {
  run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
}
