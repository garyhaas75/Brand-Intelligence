#!/usr/bin/env node
/**
 * process_style_guide.js
 * Extract brand guidelines from a PDF style guide using pdf-parse + Claude.
 *
 * Usage:
 *   node analysis/process_style_guide.js --slug=toysrus-com-lb
 *   node analysis/process_style_guide.js --slug=toysrus-com-lb --file="/path/to/guide.pdf"
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const DATA_DIR = path.join(__dirname, '..', 'data', 'brands');

function log(msg) { console.log(`[style-guide] ${msg}`); }

function loadBrandData(slug, filename) {
  const fp = path.join(DATA_DIR, slug, filename);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function saveBrandData(slug, filename, data) {
  const dir = path.join(DATA_DIR, slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
}

async function extractTextFromPdf(filePath) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (e) {
    throw new Error('pdf-parse not installed — run: npm install pdf-parse');
  }
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer, {
    // Limit pages to avoid memory issues on huge PDFs
    max: 80,
  });
  return data.text || '';
}

async function extractGuidelinesWithClaude(anthropic, text, sourceFile, slug) {
  const profile = loadBrandData(slug, 'profile.json') || {};
  const brandName = profile.name || slug;
  const market = profile.market || '';

  const truncated = text.slice(0, 40000);

  const prompt = `You are analyzing a brand style guide for ${brandName}${market ? ` (${market} market)` : ''}.

Extract structured brand guidelines from the text below. Return ONLY a valid JSON object — no explanation, no markdown fences.

Required schema:
{
  "brandVoice": ["adjective1", "adjective2", ...],
  "messagingPillars": ["pillar1", "pillar2", ...],
  "tentpoles": [{"name": "Campaign Name", "theme": "brief theme description", "keywords": ["kw1", "kw2"]}],
  "targetAudience": "brief description of who the brand speaks to",
  "doList": ["do this", "always this", ...],
  "dontList": ["never this", "avoid this", ...],
  "visualDirection": "brief note on visual style, colors, imagery direction",
  "competitivePositioning": "how the brand differentiates from competitors",
  "campaignNotes": "any specific campaign timing, themes, or messaging notes extracted"
}

If a field can't be determined from the text, use an empty array [] or "Not specified" for strings.
Extract as much as possible — even partial or inferred information is valuable.

STYLE GUIDE TEXT:
${truncated || '(No text extracted — document may be image-only)'}`;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Claude did not return valid JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

async function run() {
  const args = process.argv.slice(2);
  const slug = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');
  if (!slug) { log('ERROR: --slug= required'); process.exit(1); }

  // Resolve PDF file path
  let filePath = (args.find(a => a.startsWith('--file=')) || '').replace('--file=', '').replace(/^["']|["']$/g, '');
  if (!filePath) {
    // Default search order
    const candidates = [
      path.join(DATA_DIR, slug, 'style_guide.pdf'),
      path.join(process.env.HOME || '~', 'Downloads', 'ToysRUs_2026_HolidayTentpoles Style Guide.pdf'),
    ];
    filePath = candidates.find(f => fs.existsSync(f));
  }

  if (!filePath || !fs.existsSync(filePath)) {
    log(`ERROR: No style guide PDF found. Provide --file= path or place PDF at data/brands/${slug}/style_guide.pdf`);
    process.exit(1);
  }

  log(`Processing: ${path.basename(filePath)} (${(fs.statSync(filePath).size / 1048576).toFixed(1)} MB)`);

  // Extract text
  log('Extracting text from PDF...');
  let extractedText = '';
  try {
    extractedText = await extractTextFromPdf(filePath);
  } catch (err) {
    log(`PDF extraction error: ${err.message}`);
    extractedText = '';
  }

  const charCount = extractedText.trim().length;
  log(`Extracted ${charCount.toLocaleString()} characters from PDF text layer`);

  if (charCount < 300) {
    log('WARNING: Very little text extracted — this PDF appears to be mostly images. Guidelines will be limited.');
    log('TIP: Consider manually editing brand_guidelines.json after processing to add key messaging details.');
  }

  const extractionNote = charCount < 300
    ? `Only ${charCount} chars extracted — PDF is mostly images. Manual editing recommended.`
    : `Extracted ${charCount.toLocaleString()} chars from PDF text layer`;

  // Extract guidelines with Claude
  if (!process.env.ANTHROPIC_API_KEY) {
    log('ERROR: ANTHROPIC_API_KEY not set — cannot analyze with Claude');
    process.exit(1);
  }

  log('Analyzing with Claude to extract brand guidelines...');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let guidelines;
  try {
    guidelines = await extractGuidelinesWithClaude(anthropic, extractedText, path.basename(filePath), slug);
  } catch (err) {
    log(`Claude analysis error: ${err.message}`);
    process.exit(1);
  }

  const output = {
    processedAt: new Date().toISOString(),
    sourceFile: path.basename(filePath),
    extractionNote,
    rawExtract: extractedText.slice(0, 2000) || '(no text extracted)',
    ...guidelines,
  };

  saveBrandData(slug, 'brand_guidelines.json', output);

  log(`Done. brand_guidelines.json saved.`);
  log(`  Voice: ${(output.brandVoice || []).join(', ') || 'none extracted'}`);
  log(`  Pillars: ${(output.messagingPillars || []).length}`);
  log(`  Tentpoles: ${(output.tentpoles || []).length}`);
  log(`  Do/Don't: ${(output.doList || []).length} / ${(output.dontList || []).length}`);
}

run().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
