/**
 * Register brands that ship with the code, without calling the brand-creation endpoint.
 *
 * POST /api/brands runs discovery, which loads the brand's homepage. That is wrong for a brand
 * whose site blocks automated access (Toys R Us Japan), and it also hands the profile to a model
 * to rewrite. A seed directory seed_data/brands/<slug>/ that contains a `_registry.json` is
 * registered here instead, once: an existing registry entry is never changed or duplicated, so a
 * redeploy cannot overwrite what an operator edited.
 *
 * @param {{brands: object[]}} registry  the live registry (mutated)
 * @param {string} seedBrandsDir         e.g. <repo>/seed_data/brands
 * @returns {string[]} slugs added
 */
const fs = require('fs');
const path = require('path');

function registerSeedBrands(registry, seedBrandsDir, now = new Date()) {
  const added = [];
  if (!registry || !Array.isArray(registry.brands) || !fs.existsSync(seedBrandsDir)) return added;
  for (const slug of fs.readdirSync(seedBrandsDir)) {
    const regFile = path.join(seedBrandsDir, slug, '_registry.json');
    if (!fs.existsSync(regFile)) continue;
    let seed;
    try { seed = JSON.parse(fs.readFileSync(regFile, 'utf8')); } catch { continue; }
    if (!seed || seed.slug !== slug || !seed.name || !seed.url) continue;
    if (registry.brands.some(b => b.slug === slug)) continue;
    if (Array.isArray(registry.deletedSeeds) && registry.deletedSeeds.includes(slug)) continue; // deleted on purpose
    registry.brands.push({
      slug, name: seed.name, url: seed.url, industry: seed.industry || null,
      addedAt: now.toISOString(), lastRefreshedAt: null,
      discoveryStatus: 'complete', healthStatus: 'never_run', seeded: true,
      ...(seed.scheduled === false ? { scheduled: false } : {}),
    });
    added.push(slug);
  }
  return added;
}

module.exports = { registerSeedBrands };
