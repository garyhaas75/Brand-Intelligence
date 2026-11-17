/**
 * One definition of "is this a Japan-market brand", shared by every module so they
 * cannot disagree. Matches a market that names Japan anywhere ("Japan", "Japan (Kanto)",
 * "日本"), the bare code "JP", or a .jp / .co.jp hostname.
 */
function isJapanMarket(profile) {
  if (!profile) return false;
  const market = String(profile.market || '').trim();
  if (/japan|日本/i.test(market) || /^jp$/i.test(market)) return true;
  try { return new URL(profile.url).hostname.toLowerCase().endsWith('.jp'); } catch { return false; }
}
module.exports = { isJapanMarket };
