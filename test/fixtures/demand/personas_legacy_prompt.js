// Copy of the persona prompt template from analysis/personas.js BEFORE the evidence
// digest change (only the generatedAt timestamp is parameterized as now). Used to prove the
// no-evidence path is byte-for-byte unchanged. Em dashes from the original are written as unicode escapes. Do not edit.
module.exports = function legacyPersonaPrompt({ profile, slug, brandContext, combinedIntel, now }) {
  const prompt = `You are a consumer insights researcher. Based on all the intelligence data below about ${profile.name} and its competitive landscape, build 3-4 detailed customer personas for ${profile.name}'s target customers.

BRAND CONTEXT:
${brandContext}

---
COMPETITIVE INTELLIGENCE DATA:
${combinedIntel || 'Limited data available \u2014 base personas on brand positioning and industry context.'}

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
- brandFit (why ${profile.name} is relevant to this persona \u2014 2-3 sentences)
- quoteExample (one realistic quote this persona might say)

Return ONLY valid JSON:
{
  "generatedAt": "${now}",
  "brandSlug": "${slug}",
  "totalPersonas": 3,
  "personas": [],
  "summaryInsights": ["4-5 cross-persona insights for marketing strategy"]
}`;
  return prompt;
};
