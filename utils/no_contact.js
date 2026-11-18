/**
 * Sites this tool must not request.
 *
 * toysrus.co.jp is run by another company behind Cloudflare, and it blocks automated access. We agreed
 * not to probe or work around that. The rule is HOST based, because the same host can appear as the
 * target of one brand and as a competitor in another (the Japan competitor set lists it), and every
 * module that loads a page, a sitemap, robots.txt or a category page must check it first.
 *
 * A host is denied when it is (1) in the built-in list, (2) the host of any brand profile (live data or
 * the shipped seed) that has scrape.skipApifyRetry, or (3) listed in BI_NO_CONTACT_HOSTS (comma separated).
 * To protect a new site: set scrape.skipApifyRetry in its brand profile. That alone is enough.
 */
const fs = require('fs');
const path = require('path');

const NO_CONTACT_REASON = 'The site operator blocks automated access, so this tool did not request the site.';
const BUILT_IN_HOSTS = ['toysrus.co.jp'];

const bare = h => String(h || '').toLowerCase().replace(/^www\./, '');
function hostOf(url) { try { return bare(new URL(url).hostname); } catch { return ''; } }

// Hosts of every flagged brand profile. Cached for a minute so a run does not re-read the files per URL.
let flaggedCache = { at: 0, dirs: '', hosts: [] };
function flaggedHosts(dirs) {
  const key = dirs.join('|');
  if (flaggedCache.dirs === key && Date.now() - flaggedCache.at < 60000) return flaggedCache.hosts;
  const hosts = [];
  for (const dir of dirs) {
    let slugs = [];
    try { slugs = fs.readdirSync(dir); } catch { continue; }
    for (const slug of slugs) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, slug, 'profile.json'), 'utf8'));
        if (p && p.scrape && p.scrape.skipApifyRetry) { const h = hostOf(p.url); if (h) hosts.push(h); }
      } catch { /* no profile here */ }
    }
  }
  flaggedCache = { at: Date.now(), dirs: key, hosts };
  return hosts;
}

const DEFAULT_DIRS = [path.join(__dirname, '../data/brands'), path.join(__dirname, '../seed_data/brands')];

function deniedHosts(dirs = DEFAULT_DIRS) {
  const extra = String(process.env.BI_NO_CONTACT_HOSTS || '').split(',').map(bare).filter(Boolean);
  return new Set([...BUILT_IN_HOSTS.map(bare), ...flaggedHosts(dirs), ...extra]);
}

/** True when this URL's host (or a parent domain of it) may be requested. */
function hostAllowed(url, dirs) {
  const h = hostOf(url);
  if (!h) return true;
  for (const d of deniedHosts(dirs)) if (h === d || h.endsWith('.' + d)) return false;
  return true;
}

/** True when the tool may request the brand's own website: no profile flag and the host is allowed. */
function targetContactAllowed(profile, dirs) {
  if (profile && profile.scrape && profile.scrape.skipApifyRetry) return false;
  return hostAllowed(profile && profile.url, dirs);
}

module.exports = { targetContactAllowed, hostAllowed, hostOf, deniedHosts, NO_CONTACT_REASON, BUILT_IN_HOSTS };
