/**
 * One definition of "was the target's own site observed in this run", shared by the website audit,
 * the blueprint, the action plan and the persona prompt, so they cannot disagree.
 *
 * Observed means a usable scrape this run: not blocked, not errored, not stale (an older carried
 * forward result), not skipped, and with a navigation or category list that was actually read. A
 * manual capture counts only if its navigation parsed. Anything else is "not observed", and nothing
 * may then be said about what the site currently contains.
 */
function targetObservation(target) {
  const t = target || null;
  if (!t) return { observed: false, why: 'no scrape of the target in this run' };
  const hasNav = (Array.isArray(t.navigation) && t.navigation.length > 0) || (Array.isArray(t.featuredCategories) && t.featuredCategories.length > 0);
  if (t.stale) return { observed: false, why: 'only an older scrape exists (stale)' };
  if (t.botBlocked || t.error || t.skippedNoDirectRequest) return { observed: false, why: t.manualCapture ? 'the manual capture could not be read' : 'the site blocks automated access' };
  if (!hasNav) return { observed: false, why: t.manualCapture ? 'the manual capture had no readable navigation' : 'no navigation could be read' };
  return { observed: true, manual: !!t.manualCapture, why: t.manualCapture ? 'manual capture' : 'live scrape' };
}

/** From a site_intelligence object: the target's observation. */
function observationFromSite(site) {
  const t = site && Array.isArray(site.brands) ? site.brands.find(b => b.role === 'target') : null;
  return targetObservation(t);
}

module.exports = { targetObservation, observationFromSite };
