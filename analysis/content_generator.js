/**
 * Module 5 — Content & Campaign Generator
 * Synthesizes intelligence from Modules 1–4 into actionable marketing content:
 *  - Email campaign angles (subject lines + preview text)
 *  - Homepage hero headlines
 *  - Instagram captions per product category
 *  - SEO-optimized collection descriptions
 *  - Monthly editorial calendar outline
 * Saves to /data/content_recommendations.json
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/content_generator.log');
const OUTPUT_FILE = path.join(__dirname, '../data/content_recommendations.json');

const DATA_FILES = {
  productCatalog:    path.join(__dirname, '../data/product_catalog.json'),
  siteAnalysis:      path.join(__dirname, '../data/site_analysis.json'),
  siteIntelligence:  path.join(__dirname, '../data/site_intelligence.json'),
  socialIntelligence:path.join(__dirname, '../data/social_intelligence.json'),
  gscKeywords:       path.join(__dirname, '../data/gsc_keywords.json'),
  emailSignups:      path.join(__dirname, '../data/email_signups.json'),
};

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

function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    log(`  ${label} not found — skipping`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    log(`  Error reading ${label}: ${err.message}`);
    return null;
  }
}

async function generateContent(client, prompt, systemPrompt, label, maxTokens = 2500) {
  log(`Generating: ${label}`);
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { raw };
  } catch (err) {
    log(`  Error in ${label}: ${err.message}`);
    return { error: err.message };
  }
}

function buildContext(data) {
  const parts = [];

  if (data.productCatalog) {
    const cat = data.productCatalog;
    parts.push(`PRODUCT CATALOG SUMMARY:
Total products: ${cat.totalProducts}
Category breakdown: ${JSON.stringify(cat.categoryCounts)}
Price range: ${JSON.stringify(cat.priceStats)}
Top product types: ${cat.topProductTypes?.slice(0, 10).map(t => t.type).join(', ')}`);
  }

  if (data.siteAnalysis) {
    const sa = data.siteAnalysis;
    if (sa.navigationAnalysis?.missingCategories) {
      parts.push(`TOP MISSING CATEGORIES VS COMPETITORS:
${JSON.stringify(sa.navigationAnalysis.missingCategories, null, 2)}`);
    }
    if (sa.messagingAnalysis?.positioningOpportunity) {
      parts.push(`POSITIONING OPPORTUNITY:
${sa.messagingAnalysis.positioningOpportunity}`);
    }
    if (sa.messagingAnalysis?.recommendedHeadlines) {
      parts.push(`PREVIOUSLY RECOMMENDED HEADLINES:
${sa.messagingAnalysis.recommendedHeadlines.join('\n')}`);
    }
  }

  if (data.socialIntelligence) {
    const si = data.socialIntelligence;
    const ak = si.brands?.find(b => b.id === 'anne_klein');
    if (ak?.summary?.themes?.length) {
      parts.push(`AK INSTAGRAM TOP THEMES:
${ak.summary.themes.slice(0, 5).map(t => t.theme).join(', ')}`);
    }
    if (si.competitiveIntel?.competitorHashtagsNotUsedByAK?.length) {
      const hashtags = si.competitiveIntel.competitorHashtagsNotUsedByAK.slice(0, 15).map(h => h.tag);
      parts.push(`COMPETITOR HASHTAGS AK IS NOT USING:
${hashtags.join(', ')}`);
    }
  }

  if (data.gscKeywords) {
    const gsc = data.gscKeywords;
    if (gsc.queryAnalysis?.top50Queries?.length) {
      const topQueries = gsc.queryAnalysis.top50Queries.slice(0, 15).map(q => q.query);
      parts.push(`TOP GSC SEARCH QUERIES (real search terms driving traffic):
${topQueries.join(', ')}`);
    }
    if (gsc.queryAnalysis?.quickWins?.length) {
      const quickWins = gsc.queryAnalysis.quickWins.slice(0, 10).map(q => q.query);
      parts.push(`GSC QUICK WIN KEYWORDS (pos 4–15, high impression):
${quickWins.join(', ')}`);
    }
  }

  if (data.emailSignups) {
    const es = data.emailSignups;
    if (es.signupOffers?.length) {
      parts.push(`COMPETITOR EMAIL SIGNUP OFFERS:
${es.signupOffers.map(o => `${o.brand}: "${o.offer}"`).join('\n')}`);
    }
  }

  return parts.join('\n\n');
}

async function run() {
  ensureDirs();
  log('=== Content Generator Started ===');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Load all available intelligence
  const data = {};
  for (const [key, filePath] of Object.entries(DATA_FILES)) {
    data[key] = loadJSON(filePath, key);
  }

  if (!data.productCatalog) {
    log('FATAL: product_catalog.json required. Run npm run scrape:products first.');
    process.exit(1);
  }

  const context = buildContext(data);

  const systemPrompt = `You are a senior brand and content strategist for Anne Klein, a women's workwear brand founded in 1968.

BRAND VOICE: Approachable authority. Warm, practical, classic. Never stiff, never trendy, never corporate jargon.
TARGET: The Polished Professional — women 38–55, income $55K–$95K (managers, teachers, healthcare admins, HR directors, accountants). She wants to look credible and polished at work without overthinking it.
PRICE: $50–$300. Quality that lasts. NOT luxury.
AVOID: Buzzwords like "empower", "slay", "girlboss". Keep it real and warm.

You have access to live intelligence from competitor sites, GSC keyword data, social feeds, and the full product catalog.
Generate content that is immediately usable — specific, on-brand, and grounded in the data provided.`;

  const allResults = {};

  // --- 1. Email Campaign Angles ---
  const emailPrompt = `${context}

Generate 12 email campaign angles for Anne Klein's next 4 weeks (3 emails per week). Each angle should be:
- A specific campaign theme tied to a real product category or seasonal moment
- A primary subject line (under 45 chars)
- A preview text (under 90 chars)
- A brief content brief (2 sentences: what to feature, what the CTA is)
- Optimal send day/time recommendation

If competitor signup offers exist in the data, recommend whether AK should match, beat, or differentiate.

Format as JSON: { "emailCampaigns": [ { "week": 1, "dayOfWeek": "", "theme": "", "subjectLine": "", "previewText": "", "brief": "", "sendTiming": "", "ctaButton": "" } ] }`;

  allResults.emailCampaigns = await generateContent(client, emailPrompt, systemPrompt, 'Email campaigns', 4000);

  // --- 2. Homepage Hero Headlines ---
  const heroPrompt = `${context}

Write 5 homepage hero headline options for anneklein.com. Each should:
- Be 4–10 words
- Speak directly to the Polished Professional's desire to look credible without effort
- Avoid generic fashion words (beautiful, stunning, gorgeous, chic)
- Be paired with a 1-sentence subhead and a CTA button label

If GSC keyword data exists, incorporate real search language where it fits naturally.

Format as JSON: { "heroHeadlines": [ { "headline": "", "subhead": "", "cta": "", "bestFor": "describe which campaign/season this works for" } ] }`;

  allResults.heroHeadlines = await generateContent(client, heroPrompt, systemPrompt, 'Hero headlines');

  // --- 3. Instagram Captions by Category ---
  const igPrompt = `${context}

Write 8 Instagram captions for Anne Klein — 2 per category, covering the highest-volume product categories.
Each caption should:
- Be 2–4 sentences max
- Lead with a hook (not the product name)
- Include 8–12 relevant hashtags (use competitor hashtag intel if available)
- Have a soft CTA (link in bio, or shop the look)
- Be authentic, not salesy

Format as JSON: { "instagramCaptions": [ { "category": "", "caption": "", "hashtags": [], "imageryNotes": "describe the visual: product type, setting, lighting, mood — e.g. 'blazer flat lay on marble, natural morning light' or 'model at desk in tailored pants, editorial lighting'", "notes": "" } ] }`;

  allResults.instagramCaptions = await generateContent(client, igPrompt, systemPrompt, 'Instagram captions');

  // --- 4. SEO Collection Descriptions ---
  const seoPrompt = `${context}

Write SEO-optimized collection page descriptions for the 5 highest-traffic Anne Klein categories.
Each description should:
- Be 80–120 words
- Include the primary keyword naturally in the first sentence
- Speak to the Polished Professional's actual need (not generic fashion copy)
- Mention 2–3 specific product types within the collection
- Have a natural secondary keyword in the final sentence

Use real GSC keyword data if available to pick the right search terms.

Format as JSON: { "collectionDescriptions": [ { "collection": "", "primaryKeyword": "", "description": "", "secondaryKeyword": "" } ] }`;

  allResults.collectionDescriptions = await generateContent(client, seoPrompt, systemPrompt, 'SEO collection descriptions');

  // --- 5. Editorial Calendar ---
  const calendarPrompt = `${context}

Create a 4-week editorial content calendar for Anne Klein across 3 channels: Email, Instagram, Website hero.
Ground it in real seasonal timing and product catalog inventory. Be concise.

For each week: overarching theme, email subject + focus (1 sentence), 3 Instagram post ideas with format (Reel/Carousel/Static), website hero headline + collection to feature.

Format as JSON: { "editorialCalendar": [ { "week": 1, "dates": "", "theme": "", "email": { "subject": "", "focus": "" }, "instagram": [ { "format": "", "idea": "" } ], "hero": { "headline": "", "collection": "" } } ] }`;

  allResults.editorialCalendar = await generateContent(client, calendarPrompt, systemPrompt, 'Editorial calendar', 4000);

  // --- 6. Quick-Win SEO Content Gaps ---
  if (data.gscKeywords?.queryAnalysis?.quickWins?.length) {
    const seoGapsPrompt = `${context}

Based on the GSC quick win keywords (positions 4–15), identify the top 5 content or page optimization opportunities.
For each, recommend:
- The specific page/collection to optimize
- Exact title tag change
- Meta description (under 155 chars)
- 1-2 on-page content additions to boost ranking

Format as JSON: { "seoQuickWins": [ { "keyword": "", "currentPage": "", "titleTag": "", "metaDescription": "", "contentAdditions": [] } ] }`;

    allResults.seoQuickWins = await generateContent(client, seoGapsPrompt, systemPrompt, 'SEO quick wins');
  }

  const output = {
    generatedAt: new Date().toISOString(),
    modulesUsed: Object.entries(data).filter(([, v]) => v !== null).map(([k]) => k),
    content: allResults,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`=== Done. Content saved to ${OUTPUT_FILE} ===`);

  console.log('\n========================================');
  console.log('MODULE 5 — CONTENT GENERATOR COMPLETE');
  console.log('========================================');
  console.log(`  Modules used as input: ${output.modulesUsed.join(', ')}`);

  if (allResults.emailCampaigns?.emailCampaigns) {
    console.log(`\n  EMAIL CAMPAIGNS (${allResults.emailCampaigns.emailCampaigns.length} generated):`);
    allResults.emailCampaigns.emailCampaigns.slice(0, 3).forEach((c, i) => {
      console.log(`    ${i + 1}. "${c.subjectLine}"`);
    });
  }

  if (allResults.heroHeadlines?.heroHeadlines) {
    console.log(`\n  HERO HEADLINES (${allResults.heroHeadlines.heroHeadlines.length} generated):`);
    allResults.heroHeadlines.heroHeadlines.slice(0, 3).forEach((h, i) => {
      console.log(`    ${i + 1}. "${h.headline}"`);
    });
  }

  console.log(`\n  Full content report: ${OUTPUT_FILE}`);
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
