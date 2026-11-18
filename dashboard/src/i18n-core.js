// Pure interface-translation helpers (no React, no JSON), shared by i18n.js and the tests.
const PLACEHOLDER = /\{(\w+)\}/g
const isNode = v => v !== null && typeof v === 'object'

// Fills {name} placeholders. Plain values become text (null, undefined and
// booleans render as nothing, as React would); if any value is a React node the
// result is a fragment so elements keep rendering as elements.
export function fmt(text, vars, h) {
  if (!vars) return text
  const names = Object.keys(vars)
  if (!names.length) return text
  if (!names.some(k => isNode(vars[k]))) {
    return text.replace(PLACEHOLDER, (m, k) => {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) return m
      const v = vars[k]
      return v == null || typeof v === 'boolean' ? '' : String(v)
    })
  }
  const parts = []
  let last = 0
  text.replace(PLACEHOLDER, (m, k, at) => {
    if (!Object.prototype.hasOwnProperty.call(vars, k)) return m
    if (at > last) parts.push(text.slice(last, at))
    const v = vars[k]
    if (!(v == null || typeof v === 'boolean')) parts.push(isNode(v) ? v : String(v))
    last = at + m.length
    return m
  })
  if (last < text.length) parts.push(text.slice(last))
  return h ? h(...parts) : parts.map(p => (isNode(p) ? '' : p)).join('')
}

// A key may carry a context suffix, 'Action Plan@@nav', so one English text can
// have a different Japanese per place. The suffix never renders.
const CONTEXT = /@@\w+$/
export const stripContext = text => text.replace(CONTEXT, '')

// Data values compared in code (priority 'high', speed 'slow', effort 'Quick
// Win') are never translated in the data. tEnum maps a known value to its
// display key at the render site; English and unknown values come back as is.
export const ENUM_LABELS = ['High', 'Medium', 'Low', 'Critical', 'Fast', 'Slow', 'Quick Win', '1-2 weeks', '1+ month',
  'Needs improvement', 'Strong', 'Moderate', 'Weak', 'Large', 'Small', 'Unknown', 'Yes', 'No', 'Positive', 'Negative', 'Neutral']
const ENUM_BY_LC = Object.fromEntries(ENUM_LABELS.map(k => [k.toLowerCase(), k]))
export function tEnum(t, value) {
  if (typeof value !== 'string' || typeof t !== 'function' || t.lang !== 'ja') return value
  const key = ENUM_BY_LC[value.trim().toLowerCase()]
  return key ? t(key) : value
}

// Pure translator: 'ja' looks text up in dict, anything else (or a miss)
// returns the English. onMissing(text) is called on a miss.
export function translate(lang, text, vars, dict, h, onMissing) {
  if (typeof text !== 'string') return text
  let out = stripContext(text)
  if (lang === 'ja') {
    const hit = dict && Object.prototype.hasOwnProperty.call(dict, text) ? dict[text] : null
    if (typeof hit === 'string' && hit) out = hit
    else if (onMissing) onMissing(text)
  }
  return fmt(out, vars, h)
}

