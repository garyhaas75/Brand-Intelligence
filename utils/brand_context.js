/**
 * Slug-aware brand context loader.
 * All AI generation modules import this to get a consistent brand context
 * string derived from the live data/brands/[slug]/profile.json file.
 */

const fs = require('fs');
const path = require('path');

function loadProfile(slug) {
  const profilePath = path.join(__dirname, '../data/brands', slug, 'profile.json');
  try {
    if (fs.existsSync(profilePath)) {
      return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    }
  } catch {}
  return null;
}

/**
 * Returns a formatted brand context string for use in AI system prompts.
 * @param {string} slug — brand slug (e.g. 'anne-klein')
 */
function getBrandContext(slug) {
  const p = loadProfile(slug);
  if (!p) return `Brand context unavailable for slug: ${slug}`;

  const lines = [];
  if (p.name) lines.push(`BRAND: ${p.name}`);
  if (p.url) lines.push(`URL: ${p.url}`);
  if (p.industry) lines.push(`INDUSTRY: ${p.industry}`);
  if (p.tagline) lines.push(`TAGLINE: ${p.tagline}`);
  if (p.positioning) lines.push(`POSITIONING: ${p.positioning}`);
  if (p.brandArchetype) lines.push(`BRAND ARCHETYPE: ${p.brandArchetype}`);

  if (p.identifiedCompetitors?.length) {
    lines.push(`\nKEY COMPETITORS:`);
    p.identifiedCompetitors.forEach(c => lines.push(`  - ${c.name} (${c.url})`));
  }

  if (p.social?.instagram) lines.push(`\nINSTAGRAM: @${p.social.instagram}`);
  if (p.social?.twitter) lines.push(`TWITTER/X: @${p.social.twitter}`);

  return lines.join('\n');
}

/**
 * Returns a short one-liner brand context for compact prompts.
 * @param {string} slug
 */
function getBrandContextShort(slug) {
  const p = loadProfile(slug);
  if (!p) return `Unknown brand (${slug})`;
  return `${p.name || slug} — ${p.industry || 'brand'} — ${p.positioning || p.tagline || p.url || ''}`.trim();
}

module.exports = { getBrandContext, getBrandContextShort, loadProfile };
