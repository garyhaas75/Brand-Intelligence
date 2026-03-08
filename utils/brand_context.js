/**
 * Shared brand context loader.
 * All AI generation modules import this to get a consistent brand context
 * string derived from the live brand_guidelines.json file.
 * Changes made in the Brand Guidelines UI propagate to all generation automatically.
 */

const fs = require('fs');
const path = require('path');

const GUIDELINES_FILE = path.join(__dirname, '../data/brand_guidelines.json');

function loadGuidelines() {
  try {
    if (fs.existsSync(GUIDELINES_FILE)) {
      return JSON.parse(fs.readFileSync(GUIDELINES_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

/**
 * Returns a formatted brand context string for use in AI system prompts.
 * Falls back to minimal defaults if the file is missing.
 */
function getBrandContext() {
  const g = loadGuidelines();
  if (!g) {
    return `Anne Klein is a women's workwear brand founded in 1968. Brand voice: approachable authority, warm, practical, classic. Target: professional women 38-55, $55K-$95K income. Price: $50-$300.`;
  }

  const lines = [];

  // Brand voice
  if (g.brandVoice) {
    lines.push(`BRAND VOICE: ${g.brandVoice.summary || ''}`);
    if (g.brandVoice.tone) lines.push(`TONE: ${g.brandVoice.tone}`);
    if (g.brandVoice.personality?.length) lines.push(`PERSONALITY: ${g.brandVoice.personality.join(' | ')}`);
    if (g.brandVoice.writingStyle?.length) lines.push(`WRITING STYLE:\n${g.brandVoice.writingStyle.map(s => `  - ${s}`).join('\n')}`);
  }

  // Brand heritage
  if (g.brandHeritage) {
    const h = g.brandHeritage;
    lines.push(`\nBRAND HERITAGE: Founded ${h.founded} by ${h.founder}. ${h.legacy || ''}`);
    if (h.designPhilosophy) lines.push(`DESIGN PHILOSOPHY: ${h.designPhilosophy}`);
    if (h.modernMission) lines.push(`MODERN MISSION: ${h.modernMission}`);
    if (h.keyFacts?.length) lines.push(`KEY FACTS: ${h.keyFacts.join(' | ')}`);
  }

  // Brand values
  if (g.brandValues?.length) {
    lines.push(`\nBRAND VALUES:\n${g.brandValues.map(v => `  - ${v}`).join('\n')}`);
  }

  // Brand pillars
  if (g.brandPillars?.length) {
    lines.push(`\nBRAND PILLARS:`);
    for (const p of g.brandPillars) {
      lines.push(`  ${p.pillar}: ${p.description}`);
      if (p.inCopy) lines.push(`    In copy: ${p.inCopy}`);
    }
  }

  // Target customer
  if (g.targetCustomer) {
    const t = g.targetCustomer;
    lines.push(`\nTARGET CUSTOMER: ${t.name} — ${t.description} Age ${t.age}, income ${t.income}.`);
    if (t.quote) lines.push(`  Her words: "${t.quote}"`);
    if (t.values?.length) lines.push(`  Values: ${t.values.join(', ')}`);
  }

  // Writing rules
  if (g.writingRules) {
    if (g.writingRules.dos?.length) lines.push(`\nALWAYS:\n${g.writingRules.dos.map(d => `  ✓ ${d}`).join('\n')}`);
    if (g.writingRules.donts?.length) lines.push(`NEVER:\n${g.writingRules.donts.map(d => `  ✗ ${d}`).join('\n')}`);
  }

  // Keywords
  if (g.keywords) {
    if (g.keywords.positive?.length) lines.push(`\nPOSITIVE KEYWORDS: ${g.keywords.positive.join(', ')}`);
    if (g.keywords.negative?.length) lines.push(`AVOID THESE WORDS: ${g.keywords.negative.join(', ')}`);
  }

  // Tone by channel (summary)
  if (g.toneByChannel) {
    lines.push(`\nTONE BY CHANNEL:`);
    for (const [channel, guidance] of Object.entries(g.toneByChannel)) {
      lines.push(`  ${channel}: ${guidance}`);
    }
  }

  return lines.join('\n');
}

/**
 * Returns a short brand context suitable for system prompts (voice + rules only).
 */
function getBrandContextShort() {
  const g = loadGuidelines();
  if (!g) return `Anne Klein: women's workwear brand, founded 1968. Voice: approachable authority, warm, practical. Target: professional women 38-55. Price: $50-$300.`;

  const parts = [];
  if (g.brandVoice?.summary) parts.push(`Voice: ${g.brandVoice.summary}`);
  if (g.targetCustomer?.description) parts.push(`Target: ${g.targetCustomer.name} — ${g.targetCustomer.description}`);
  if (g.brandHeritage?.keyFacts) parts.push(g.brandHeritage.keyFacts.join('. '));
  if (g.writingRules?.donts?.length) parts.push(`Never: ${g.writingRules.donts.slice(0, 4).join('; ')}`);

  return parts.join('\n');
}

module.exports = { getBrandContext, getBrandContextShort, loadGuidelines };
