/**
 * Translate the dashboard's interface strings into Japanese.
 *
 * Reads dashboard/src/i18n/ui.en.json (written by scripts/extract_ui_strings.js), translates only
 * the strings that are not already in dashboard/src/i18n/ja.json, validates that every {placeholder}
 * survives unchanged, and writes ja.json. Needs ANTHROPIC_API_KEY. Re-running is cheap: finished
 * strings are kept and the shared translation cache is used.
 *
 * Usage: node scripts/translate_ui.js [--dry-run]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { translateStrings } = require('../utils/translate');

const DIR = path.join(__dirname, '../dashboard/src/i18n');
const SRC = path.join(DIR, 'ui.en.json');
const OUT = path.join(DIR, 'ja.json');

const CONTEXT = [
  'These strings are the interface of a retail competitive-intelligence dashboard (buttons, headings, table headers, notices, tooltips, explanations). Translate them as natural, concise business Japanese suitable for a Japanese retail marketing team.',
  'Consistent terms: Portfolio=ポートフォリオ; Brand Profile=ブランドプロフィール; Competitive Analysis=競合分析; Personas=ペルソナ; Social Audit=SNS分析; Website Audit=ウェブサイト監査; Search & SEO=検索・SEO; Action Plan=アクションプラン; Refresh All=すべて更新; Open=開く; Sign out=ログアウト; Fresh=最新; Stale=古い; Needs Refresh=要更新; Never Run=未実行; Pipeline running=分析を実行中; Recommended=推奨; Priority=優先度; Effort=工数; Confidence=確度; High=高; Medium=中; Low=低.',
  'Keep these names in English exactly: Toys R Us, Instagram, TikTok, Facebook, X, YouTube, LINE, Rakuten, Amazon, Google, Cloudflare, Lighthouse, SEO, GEO, AI, CTA, URL, PDF.',
  'Every {placeholder} in braces, such as {n} or {name}, must appear in the translation exactly as written, once for each time it appears in the source.',
  'Never use em dashes. Keep button labels short. Keep sentence endings polite and plain (です・ます).',
].join('\n');

const placeholders = s => (String(s).match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join('|');

async function main() {
  const dry = process.argv.includes('--dry-run');
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8')).map(x => (typeof x === 'string' ? x : x.text));
  let ja = {};
  try { ja = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { /* first run */ }
  // drop entries whose English source no longer exists (an English string was edited or removed)
  const known = new Set(src);
  for (const k of Object.keys(ja)) if (!known.has(k)) delete ja[k];
  const todo = src.filter(s => !(s in ja) || !ja[s] || placeholders(ja[s]) !== placeholders(s));
  console.log(`[translate_ui] ${src.length} strings, ${src.length - todo.length} already done, ${todo.length} to translate`);
  if (dry || !todo.length) return;
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(2); }
  const map = await translateStrings(todo, 'ja', { context: CONTEXT, residualRetry: false, log: m => console.log(m) });
  let bad = 0;
  for (const s of todo) {
    let t = map.get(s);
    if (!t) { bad++; continue; }
    t = t.replace(/\s*—\s*/g, '、');
    if (placeholders(t) !== placeholders(s)) { bad++; console.log(`  placeholder mismatch, kept English: ${s.slice(0, 70)}`); continue; }
    ja[s] = t;
  }
  const sorted = Object.fromEntries(Object.keys(ja).sort().map(k => [k, ja[k]]));
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(sorted, null, 2) + '\n');
  fs.renameSync(OUT + '.tmp', OUT);
  console.log(`[translate_ui] wrote ${OUT}: ${Object.keys(sorted).length} entries, ${bad} not translated (they fall back to English)`);
}
main().catch(e => { console.error(e); process.exit(1); });
