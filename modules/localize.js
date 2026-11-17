/**
 * Localize: pure helpers that find translatable strings in any JSON value and apply a
 * translation map to a deep copy of it. No network, no file access, never mutates input.
 *
 * Translations come from data/brands/<slug>/translations.json:
 *   { generatedAt, en: { "<japanese>": "<english>" }, ja: { "<english>": "<japanese>" } }
 *
 * Directions:
 *   'en'  collects strings that contain Japanese (hiragana, katakana or kanji)
 *   'ja'  collects English prose worth translating into Japanese
 *
 * Values under technical keys (urls, ids, handles, images, tokens, emails) and anything inside
 * an array named "history" are never collected and never rewritten.
 */

const MAX_STRING_LENGTH = 4000;

// Hiragana, katakana (full and half width, plus phonetic extensions), CJK ideographs (incl. ext A
// and compatibility), and the iteration mark.
const JA_RE = /[぀-ゟ゠-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ々]/;
const JA_RE_G = new RegExp(JA_RE.source, 'g');
const LATIN_WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

function isJapanese(s) {
  return typeof s === 'string' && JA_RE.test(s);
}

const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i;
const PATHISH_RE = /^\/?[\w.-]+(?:\/[\w.%?=&#:-]*)+$/; // /api/x/y.jpg or a/b/c
const DOMAIN_RE = /^[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/; // example.co.jp/path
const HANDLE_RE = /^[@#][\w.぀-ヿ一-鿿-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_RE = /^[\s\d.,%+\-−$¥￥€£()x/:]+$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SIMPLE_DATE_RE = /^(?:\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9}\.? \d{4})$/;
const ID_RE = /^[\w:.-]+$/; // a single token with no spaces (slug, uuid, sku, snake_case key)

/** True for English prose worth translating into Japanese. */
function isTranslatableProse(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 12 || t.length > MAX_STRING_LENGTH) return false;
  if (URL_RE.test(t) || PATHISH_RE.test(t) || DOMAIN_RE.test(t)) return false;
  if (HANDLE_RE.test(t) || EMAIL_RE.test(t) || NUMBER_RE.test(t)) return false;
  if (ISO_DATE_RE.test(t) || SIMPLE_DATE_RE.test(t) || ID_RE.test(t)) return false;
  const words = t.match(LATIN_WORD_RE) || [];
  if (words.length < 3) return false;
  // Mostly-Japanese text with a few latin words (brand names) is not English prose.
  return isMostlyLatin(t);
}

/**
 * True when a string has more Latin letters (counted inside latin words) than Japanese
 * characters. A tie counts as mostly Japanese. Shared by isTranslatableProse and the gloss rule
 * in applyTranslations so the two always agree.
 */
function isMostlyLatin(s) {
  if (typeof s !== 'string') return false;
  const jaChars = (s.match(JA_RE_G) || []).length;
  const latinChars = (s.match(LATIN_WORD_RE) || []).reduce((n, w) => n + w.length, 0);
  return latinChars > jaChars;
}

/** Keys whose values are technical and must never be translated or rewritten. */
function isSkippedKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.toLowerCase();
  if (k === 'url' || k.endsWith('url') || k === 'urls') return true;
  if (k === 'href' || k === 'id' || k === 'slug' || k === 'src' || k === 'token' || k === 'email') return true;
  if (k.startsWith('handle') || k.endsWith('handle')) return true;
  if (k === 'screenshotbase64' || k.startsWith('thumbnail') || k.startsWith('image')) return true;
  return false;
}

function isHistoryKey(key) {
  return typeof key === 'string' && key.toLowerCase() === 'history';
}

function wantedFor(direction) {
  if (direction === 'en') return isJapanese;
  if (direction === 'ja') return isTranslatableProse;
  throw new Error(`collectStrings: unknown direction "${direction}" (use 'en' or 'ja')`);
}

/**
 * Unique list of strings worth translating, in first-seen order.
 * direction 'en': strings containing Japanese. direction 'ja': English prose.
 */
function collectStrings(obj, direction) {
  const wanted = wantedFor(direction);
  const seen = new Set();
  const out = [];
  const visiting = new Set();
  function walk(v) {
    if (typeof v === 'string') {
      if (v.length <= MAX_STRING_LENGTH && v.trim() && !seen.has(v) && wanted(v)) {
        seen.add(v);
        out.push(v);
      }
      return;
    }
    if (!v || typeof v !== 'object' || visiting.has(v)) return;
    visiting.add(v);
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else {
      for (const key of Object.keys(v)) {
        if (isSkippedKey(key)) continue;
        if (isHistoryKey(key) && Array.isArray(v[key])) continue;
        walk(v[key]);
      }
    }
    visiting.delete(v);
  }
  walk(obj);
  return out;
}

function lookup(map, s) {
  if (!map) return undefined;
  if (map instanceof Map) return map.get(s);
  return Object.prototype.hasOwnProperty.call(map, s) ? map[s] : undefined;
}

/**
 * Deep copy of obj with translations applied.
 *   mode 'gloss'   s -> "s (map[s])" for mostly-Japanese s; map[s] when s is mostly Latin
 *   mode 'replace' s -> map[s]
 * Strings without a usable entry, and values under skipped keys, are copied unchanged.
 */
function applyTranslations(obj, map, mode) {
  if (mode !== 'gloss' && mode !== 'replace') {
    throw new Error(`applyTranslations: unknown mode "${mode}" (use 'gloss' or 'replace')`);
  }
  const visiting = new Set();
  function tr(s) {
    if (s.length > MAX_STRING_LENGTH) return s;
    const t = lookup(map, s);
    if (typeof t !== 'string' || !t.trim() || t === s) return s;
    // A mostly-English string with a few Japanese words is replaced, not glossed: its translation
    // repeats the whole sentence.
    if (mode === 'gloss' && !isMostlyLatin(s)) return `${s} (${t})`;
    return t;
  }
  function copy(v) {
    if (typeof v === 'string') return tr(v);
    if (!v || typeof v !== 'object') return v;
    if (visiting.has(v)) return null; // a cycle cannot be represented in JSON output
    visiting.add(v);
    let out;
    if (Array.isArray(v)) {
      out = v.map(copy);
    } else if (v instanceof Date) {
      out = new Date(v.getTime());
    } else {
      out = {};
      for (const key of Object.keys(v)) {
        const val = v[key];
        if (isSkippedKey(key) || (isHistoryKey(key) && Array.isArray(val))) {
          out[key] = cloneVerbatim(val);
        } else {
          out[key] = copy(val);
        }
      }
    }
    visiting.delete(v);
    return out;
  }
  return copy(obj);
}

function cloneVerbatim(v) {
  if (!v || typeof v !== 'object') return v;
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

/**
 * lang 'orig' (or anything unknown): obj unchanged.
 * lang 'en': Japanese strings glossed with their English translation.
 * lang 'ja': English prose replaced by Japanese; Japanese strings stay as they are.
 */
function localizeData(obj, lang, translations) {
  const t = translations && typeof translations === 'object' ? translations : {};
  if (lang === 'en') return applyTranslations(obj, t.en || {}, 'gloss');
  if (lang === 'ja') return applyTranslations(obj, t.ja || {}, 'replace');
  return obj;
}

module.exports = {
  isJapanese,
  isTranslatableProse,
  collectStrings,
  applyTranslations,
  localizeData,
  isSkippedKey,
  isMostlyLatin,
  MAX_STRING_LENGTH,
};
