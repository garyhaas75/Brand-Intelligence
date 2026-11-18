// Interface translation. The English text is the key: t('Refresh') looks the
// string up in i18n/ja.json when the language is 'ja' and otherwise returns the
// English exactly as written, so 'en' and 'orig' render what the app always did.
// {name} placeholders are filled from vars in both the English and the Japanese.
// The list of keys lives in i18n/ui.en.json (scripts/extract_ui_strings.js).
import React from 'react'
import ja from './i18n/ja.json'
import uiEn from './i18n/ui.en.json'
import { fmt as fmtCore, translate as translateCore, tEnum, stripContext } from './i18n-core.js'

export { tEnum }

// One language switch for data and interface: 'en' | 'ja' | 'orig'.
export const LangContext = React.createContext({ lang: 'orig', onTranslationsHeader: () => {} })
export const useLang = () => React.useContext(LangContext)

// Test-only pseudo dictionary: VITE_I18N_PSEUDO=1 builds map every key to
// '[JA] ' + English so coverage can be measured. Never set for a real build.
const DICT = import.meta.env.VITE_I18N_PSEUDO ? Object.fromEntries(uiEn.map(e => [e.text, '[JA] ' + stripContext(e.text)])) : ja

const h = (...parts) => React.createElement(React.Fragment, null, ...parts)
const warned = new Set()
const onMissing = text => {
  if (!import.meta.env.DEV || warned.has(text)) return
  warned.add(text)
  console.warn('[i18n] missing ja string:', text)
}
// {name} placeholders filled; React nodes in vars keep rendering as nodes.
export const fmt = (text, vars) => fmtCore(text, vars, h)
export const translate = (lang, text, vars) => translateCore(lang, text, vars, DICT, h, onMissing)

const cache = {}
// The translator for a language, one stable function per language. App, which
// owns the language state and provides LangContext, uses this directly.
export function tFor(lang) {
  if (!cache[lang]) { cache[lang] = (text, vars) => translate(lang, text, vars); cache[lang].lang = lang }
  return cache[lang]
}
// The hook only reads context, so it is safe wherever a component calls it.
export function useT() {
  return tFor(useLang().lang)
}
