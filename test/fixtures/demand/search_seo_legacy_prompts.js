// Copies of the prompts in analysis/search_seo.js BEFORE the Japan branch was added, lifted
// from the original source. Used to prove non-Japan output is unchanged. Do not edit.
function legacyKeywordPrompt(profile, { targetNav = [], competitorNavs = [], onPageSeo = {} } = {}) {
  const market = profile.market || 'their market';

  const prompt = `Generate a comprehensive keyword research list (150-200 terms total) for ${profile.name}, a ${profile.industry} brand operating in ${market}.

Context:
- Brand positioning: ${profile.positioning || 'not specified'}
- Nav categories: ${targetNav.join(', ') || 'not available'}
- Title tag: ${onPageSeo.titleTag}
- H1: ${onPageSeo.h1}
- Competitor signals: ${competitorNavs.join(', ') || 'not available'}

Return ONLY valid JSON with this exact structure (no other text):
{
  "brandTerms": ["brand name variants, misspellings, brand + category combos"],
  "categoryTerms": ["main product category keywords from the nav/site"],
  "ageGroupTerms": ["gifts and products for different ages, for example 'toys for 2 year olds', 'gifts for 8 year old boy'"],
  "occasionTerms": ["occasion-based queries, for example 'christmas toy sale', 'birthday gifts for kids', 'back to school'"],
  "topBrands": ["carried or competing brands as a shopper types them, for example 'lego duplo', 'barbie dreamhouse'"],
  "localTerms": ["how someone physically nearby searches: 'toy store near me', 'toy shop open now', and city or suburb names, for example 'toy store sydney'"],
  "competitorGapTerms": ["terms competitors likely rank for that this brand should also target"],
  "aiDiscoveryQueries": ["natural-language questions a shopper asks an AI assistant, for example 'what is the best toy store for a 5 year old', 'where can I buy lego near me'"]
}

Each category should have 15-30 terms.

IMPORTANT, how people in ${market} actually search:
Do NOT append "${market}" to terms. Someone in ${market} searching for LEGO types "lego", not "lego ${market}". Adding the country name is how a person OUTSIDE the market searches, or how an export site is found, and those terms carry almost no domestic volume. This site already targets ${market} through its domain and Google's own location signals.
Express local intent the way locals do instead: "near me", "open now", "delivery", "click and collect", and city, state or suburb names. A country name belongs in a term only when a shopper would genuinely type it, such as a query about shipping or availability from abroad. Keep at most 2 such terms in total across every category.`;
  return prompt;
}
function legacyGeoQueryGenPrompt(profile) {
  const queryGenPrompt = `Generate 20 realistic search queries that a customer might use when looking for a ${profile.industry} brand like ${profile.name} (${profile.market || ''}).

Include these categories (4-5 queries each): brand discovery, category/product search, occasion-based, comparison/alternatives, local market.

Return a JSON array only:
[{"id": "q1", "category": "brand discovery", "query": "the search query"}]`;
  return queryGenPrompt;
}
function legacyFallbackQueries(profile) {
  const brandName = profile.name;
  return [
      { id: 'q1', category: 'brand discovery', query: `best ${profile.industry} stores in ${profile.market || 'my area'}` },
      { id: 'q2', category: 'comparison', query: `${brandName} alternatives` },
  ];
}
const LEGACY_GEO_SYSTEM = 'You are a helpful shopping assistant. Give honest, specific recommendations mentioning real brands.';
module.exports = { legacyKeywordPrompt, legacyGeoQueryGenPrompt, legacyFallbackQueries, LEGACY_GEO_SYSTEM };
