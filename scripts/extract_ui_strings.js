#!/usr/bin/env node
'use strict'
// Finds every user-visible English interface string in dashboard/src/*.jsx.
//
//   node scripts/extract_ui_strings.js          writes dashboard/src/i18n/ui.en.json
//   node scripts/extract_ui_strings.js --check  prints the count, writes nothing
//
// analyze(src, file) is also the engine of scripts/apply_ui_i18n.js: besides the
// string list it returns the exact source edits that route each string through
// t(). It recognises strings already inside t('...') calls, so running it after
// the codemod gives the same list.
//
// A string counts when it is rendered: JSX text (mixed with simple expressions it
// becomes one key with {placeholders}), text attributes, literals in JSX
// expressions and their ternary branches, values of label-like object keys,
// arguments of user-facing setters (setError, setMsg...) and alert/confirm, and
// literals assigned or returned inside components. Ignored: anything compared in
// code, class names, styles, URLs, keys, ids, console and Error messages, single
// lowercase tokens (enum values) and the brand names that stay in English.
const fs = require('fs')
const path = require('path')

const NM = path.join(__dirname, '..', 'dashboard', 'node_modules')
const parser = require(path.join(NM, '@babel/parser'))
const traverse = require(path.join(NM, '@babel/traverse')).default

const SRC_DIR = path.join(__dirname, '..', 'dashboard', 'src')
const OUT = path.join(SRC_DIR, 'i18n', 'ui.en.json')
const FILES = ['App.jsx', 'SiteBlueprint.jsx']

const DOM_TEXT_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'label', 'alt', 'aria-description'])
// Props of our own components that never carry prose.
const NON_TEXT_PROPS = new Set(['className', 'style', 'key', 'id', 'href', 'src', 'type', 'color', 'variant', 'size', 'slug', 'tab',
  'module', 'to', 'role', 'htmlFor', 'target', 'rel', 'method', 'value', 'name', 'status', 'impact', 'kind', 'lang', 'theme', 'align',
  'icon', 'file', 'field', 'mode', 'width', 'height', 'brand', 'level', 'accent', 'bg', 'fg', 'tone', 'priority', 'effort', 'confidence'])
const UI_KEYS = new Set(['label', 'title', 'text', 'desc', 'description', 'message', 'msg', 'hint', 'note', 'tip', 'why', 'how', 'rec',
  'recommendation', 'explanation', 'detail', 'details', 'intro', 'heading', 'subtitle', 'sub', 'subLabel', 'placeholder', 'cta', 'body',
  'summary', 'tooltip', 'caption', 'empty', 'field', 'what', 'lead', 'blurb', 'help', 'question', 'answer', 'badge', 'headline',
  'action', 'outcome', 'nav', 'reason', 'example', 'meaning', 'impactText', 'short', 'long', 'chapter', 'kicker', 'legend', 'unit', 'verdict'])
const PROPER_NOUNS = new Set(['Toys R Us', 'Toys"R"Us', 'ToysRUs', 'LINE', 'Instagram', 'TikTok', 'Facebook', 'X', 'YouTube',
  'Rakuten', 'Amazon', 'Google', 'Pinterest', 'Shopify', 'Claude', 'ChatGPT', 'Perplexity', 'Gemini'])
const SETTER = /^set[A-Z]\w*(Error|Err|Msg|Message|Status|Notice|Toast|Label|Text|Note|Hint|Warning|Info)$/
const USER_DIALOGS = new Set(['alert', 'confirm', 'prompt'])
const NON_UI_CALLEES = new Set(['fetch', 'Error', 'TypeError', 'RangeError', 'require', 'encodeURIComponent', 'decodeURIComponent',
  'URL', 'URLSearchParams', 'RegExp', 'Date', 'Number', 'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'storeKey', 'useState',
  'useRef', 'Set', 'Map'])
const NON_UI_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'split', 'replace', 'replaceAll', 'match', 'test', 'indexOf',
  'lastIndexOf', 'join', 'get', 'set', 'has', 'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll', 'padStart',
  'padEnd', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'addEventListener', 'removeEventListener', 'open', 'append',
  'getAttribute', 'setAttribute', 'createElement', 'localeCompare', 'search', 'find', 'filter', 'some', 'every'])
const NON_UI_VARS = /(key|url|uri|id|ids|class|classname|color|colour|bg|slug|module|status|mode|type|kind|sort|tab|lang|href|src|path|font|size|width|height|border|shadow|regex|re|pattern|endpoint|query|param|params|file|field|format)$/i

const TRANSLATOR = 't'

// Babel's own JSX whitespace rule (cleanJSXElementLiteralChild).
function cleanJSX(value) {
  const lines = value.split(/\r\n|\n|\r/)
  let lastNonEmpty = 0
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) lastNonEmpty = i
  let str = ''
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, ' ')
    if (i !== 0) line = line.replace(/^[ ]+/, '')
    if (i !== lines.length - 1) line = line.replace(/[ ]+$/, '')
    if (line) { if (i !== lastNonEmpty) line += ' '; str += line }
  }
  return str
}
const wsTrim = s => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
const hasLetters = s => /[A-Za-z]/.test(s.replace(/\{\w+\}/g, ''))

function looksUI(s) {
  const v = wsTrim(s)
  if (!v || !hasLetters(v)) return false
  if (PROPER_NOUNS.has(v)) return false
  if (/^(https?:|mailto:|tel:|data:|\/|\.{1,2}\/|#|www\.)/i.test(v)) return false
  if (/^[a-z0-9_.:\-/@?=&%+]+$/.test(v)) return false // ids, enum values, class names, paths
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(v)) return false // camelCase identifiers
  if (/^[A-Z0-9_]+$/.test(v)) return false // CONSTANT_LIKE and acronyms alone
  if (/rgba?\(|hsla?\(|var\(--|\b\d+(\.\d+)?(px|em|rem|vh|vw|ms)\b|^#[0-9a-f]{3,8}$|\bsolid\b|cubic-bezier|!important/i.test(v)) return false
  if (/^[\w.-]+\.(js|jsx|json|css|png|jpe?g|svg|pdf|html?)$/i.test(v)) return false
  return true
}

function q(s) {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + "'"
}

function calleeName(callee) {
  if (!callee) return ''
  if (callee.type === 'Identifier') return callee.name
  if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed) return callee.property.name
  return ''
}
function calleeRoot(callee) {
  let c = callee
  while (c && (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression')) c = c.object
  return c && c.type === 'Identifier' ? c.name : ''
}

// Placeholder name for an interpolated expression.
function nameFor(expr) {
  if (!expr) return 'value'
  if (expr.type === 'Identifier') return expr.name
  if ((expr.type === 'MemberExpression' || expr.type === 'OptionalMemberExpression') && !expr.computed && expr.property.type === 'Identifier') return expr.property.name
  if ((expr.type === 'CallExpression' || expr.type === 'OptionalCallExpression')) {
    const c = expr.callee
    if ((c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && !c.computed) {
      if (/^(toLocaleString|toFixed|toString|trim|toUpperCase|toLowerCase|join|slice)$/.test(c.property.name)) return nameFor(c.object)
      return c.property.name
    }
    if (c.type === 'Identifier' && expr.arguments[0]) return nameFor(expr.arguments[0])
    if (c.type === 'Identifier') return c.name
  }
  if (expr.type === 'TSNonNullExpression') return nameFor(expr.expression)
  return 'value'
}
function makeNamer() {
  const bySrc = new Map(); const used = new Set()
  return (expr, src) => {
    if (bySrc.has(src)) return bySrc.get(src)
    let base = nameFor(expr)
    if (!/^[A-Za-z_]\w*$/.test(base)) base = 'value'
    let n = base; let i = 2
    while (used.has(n)) n = base + i++
    used.add(n); bySrc.set(src, n)
    return n
  }
}
function varsCode(entries) {
  if (!entries.length) return ''
  return ', { ' + entries.map(([n, s]) => (n === s ? n : `${n}: ${s}`)).join(', ') + ' }'
}

// Literal values compared anywhere in the file: those are enum values, never
// translated even when they look like English.
function comparedValues(ast) {
  const out = new Set()
  const add = n => { if (n && n.type === 'StringLiteral') out.add(n.value) }
  traverse(ast, {
    BinaryExpression(p) { if (/^[!=]==?$/.test(p.node.operator)) { add(p.node.left); add(p.node.right) } },
    SwitchCase(p) { add(p.node.test) },
    CallExpression(p) {
      const c = p.node.callee
      if (calleeName(c) === 'includes' && c.object && c.object.type === 'ArrayExpression') c.object.elements.forEach(add)
    },
  })
  return out
}

// Module-level owner of a node: { kind: 'component'|'helper'|'module', name, fn }.
function ownerOf(p) {
  let fn = p.getFunctionParent()
  if (!fn) return { kind: 'module' }
  let outer = fn
  while (outer.getFunctionParent()) outer = outer.getFunctionParent()
  let name = null
  const par = outer.parentPath
  if (outer.node.type === 'FunctionDeclaration' && outer.node.id) name = outer.node.id.name
  else if (par && par.node.type === 'VariableDeclarator' && par.node.id.type === 'Identifier') name = par.node.id.name
  const topLevel = outer.node.type === 'FunctionDeclaration'
    ? (par.node.type === 'Program' || /^Export/.test(par.node.type))
    : (par && par.node.type === 'VariableDeclarator' && par.parentPath.parentPath && (par.parentPath.parentPath.node.type === 'Program' || /^Export/.test(par.parentPath.parentPath.node.type)))
  if (!topLevel || !name) return { kind: 'nested', name, fn: outer }
  return { kind: /^[A-Z]/.test(name) ? 'component' : 'helper', name, fn: outer }
}

// Is the literal at path p rendered? Returns a role or null.
function renderedRole(p, file) {
  let cur = p
  for (;;) {
    const par = cur.parentPath
    if (!par) return null
    const n = par.node
    if (n.type === 'ConditionalExpression' && n.test !== cur.node) { cur = par; continue }
    if (n.type === 'LogicalExpression' && (n.right === cur.node || n.operator !== '&&')) { cur = par; continue }
    if (n.type === 'ParenthesizedExpression') { cur = par; continue }
    break
  }
  const par = cur.parentPath
  const n = par.node
  if (n.type === 'JSXExpressionContainer') {
    const gp = par.parentPath.node
    if (gp.type === 'JSXAttribute') return attrRole(gp, par.parentPath.parentPath.node, file)
    return 'jsx'
  }
  if (n.type === 'JSXAttribute') return attrRole(n, par.parentPath.node, file)
  if (n.type === 'ObjectProperty' && n.value === cur.node && !n.computed) {
    const k = n.key.type === 'Identifier' ? n.key.name : n.key.value
    if (UI_KEYS.has(k)) return 'prop'
    // Display names in module-level option lists (LANGS: { name: 'English' }).
    if (k === 'name' && !cur.getFunctionParent() && /^[A-Z][a-z]+( [a-z]+)*$/.test(cur.node.value || '')) return 'prop'
    return null
  }
  if (n.type === 'ArrayExpression') {
    // Literal lists rendered with .map: table headers, field labels.
    let a = par
    while (a.parentPath && a.parentPath.node.type === 'ArrayExpression') a = a.parentPath
    const m = a.parentPath && a.parentPath.node
    if (m && (m.type === 'MemberExpression' || m.type === 'OptionalMemberExpression') && m.object === a.node && !m.computed && m.property.name === 'map' &&
        a.parentPath.parentPath.node.type === 'CallExpression' && a.parentPath.parentPath.node.callee === m) return 'list'
    return null
  }
  if ((n.type === 'CallExpression') && n.arguments.includes(cur.node)) {
    const name = calleeName(n.callee)
    if (SETTER.test(name) || (USER_DIALOGS.has(name) && ['Identifier', 'MemberExpression'].includes(n.callee.type) && (n.callee.type === 'Identifier' || calleeRoot(n.callee) === 'window'))) return 'setter'
    return null
  }
  if (n.type === 'VariableDeclarator' && n.init === cur.node) {
    if (n.id.type !== 'Identifier' || NON_UI_VARS.test(n.id.name)) return null
    return 'var'
  }
  if (n.type === 'AssignmentExpression' && n.right === cur.node) {
    const l = n.left
    const nm = l.type === 'Identifier' ? l.name : (l.type === 'MemberExpression' && !l.computed ? l.property.name : '')
    if (!nm || NON_UI_VARS.test(nm) || /^(textContent|innerText|innerHTML|title)$/.test(nm) && l.type === 'MemberExpression') return null
    return 'var'
  }
  if (n.type === 'ReturnStatement' || (n.type === 'ArrowFunctionExpression' && n.body === cur.node)) return 'return'
  return null
}
function attrRole(attr, opening, file) {
  const name = attr.name.type === 'JSXIdentifier' ? attr.name.name : `${attr.name.namespace.name}:${attr.name.name.name}`
  if (DOM_TEXT_ATTRS.has(name)) return 'attr'
  const tag = opening && opening.name && opening.name.type === 'JSXIdentifier' ? opening.name.name : ''
  if (/^[A-Z]/.test(tag) && !NON_TEXT_PROPS.has(name) && !/^on[A-Z]|^aria-|^data-/.test(name)) return 'attr'
  void file
  return null
}

// Excluded by context: inside a non-UI call, a style/className attribute, an
// import, an object key, a member property, or an existing t() call.
function excludedContext(p) {
  let cur = p
  while (cur && cur.parentPath) {
    const par = cur.parentPath
    const n = par.node
    if (n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' && n.source) return 'import'
    if (n.type === 'JSXAttribute') {
      const nm = n.name.name
      if (nm === 'className' || nm === 'style' || nm === 'key' || nm === 'id' || nm === 'href' || nm === 'src' || nm === 'htmlFor') return 'attr:' + nm
    }
    if ((n.type === 'CallExpression' || n.type === 'NewExpression' || n.type === 'OptionalCallExpression') && n.arguments.includes(cur.node)) {
      const nm = calleeName(n.callee)
      if (nm === TRANSLATOR && n.callee.type === 'Identifier') return 't'
      if (calleeRoot(n.callee) === 'console' || calleeRoot(n.callee) === 'JSON' || calleeRoot(n.callee) === 'localStorage' || calleeRoot(n.callee) === 'Object') return 'call'
      if (NON_UI_CALLEES.has(nm) || (n.callee.type !== 'Identifier' && NON_UI_METHODS.has(nm))) return 'call'
    }
    if (n.type === 'ThrowStatement') return 'throw'
    if (n.type === 'ObjectProperty' && n.key === cur.node) return 'key'
    if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && n.property === cur.node) return 'member'
    if (n.type === 'TaggedTemplateExpression') return 'tagged'
    if (/Function|Statement$|^Program$|^JSXElement$|^JSXFragment$/.test(n.type) && n.type !== 'ReturnStatement') return null
    cur = par
  }
  return null
}

function analyze(src, file) {
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'], ranges: false })
  const compared = comparedValues(ast)
  const strings = [] // { text, line, kind, owner }
  const edits = [] // { start, end, code, owner, line, text }
  const report = []
  const lineOf = pos => src.slice(0, pos).split('\n').length
  const add = (text, pos, kind) => strings.push({ text, line: lineOf(pos), kind })

  const conflict = p => {
    const b = p.scope.getBinding(TRANSLATOR)
    return b && b.scope.path.node.type !== 'Program'
  }
  const pushEdit = (p, start, end, code, text) => {
    const owner = ownerOf(p)
    if (owner.kind === 'module') { report.push({ line: lineOf(start), text, reason: 'module-level constant: translate at the use site' }); return }
    if (owner.kind === 'nested') { report.push({ line: lineOf(start), text, reason: 'inside a nested non-component function' }); return }
    if (conflict(p)) { report.push({ line: lineOf(start), text, reason: `a local "${TRANSLATOR}" shadows the translator here` }); return }
    edits.push({ start, end, code, owner, line: lineOf(start), text })
  }

  // 1. Existing t('...') calls (makes the extractor idempotent after the codemod).
  traverse(ast, {
    CallExpression(p) {
      const n = p.node
      if (n.callee.type === 'Identifier' && n.callee.name === TRANSLATOR && n.arguments[0]) {
        // t('key') or t(cond ? 'one' : 'many', vars)
        const keys = a => a.type === 'StringLiteral' ? [a.value] : a.type === 'ConditionalExpression' ? [...keys(a.consequent), ...keys(a.alternate)] : []
        for (const k of keys(n.arguments[0])) add(k, n.start, 't')
      }
    },
  })

  // 2. JSX children runs: text plus simple expressions becomes one key.
  const handledText = new Set()
  const simpleExpr = e => !['JSXElement', 'JSXFragment', 'ConditionalExpression', 'LogicalExpression', 'JSXEmptyExpression',
    'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'ObjectExpression', 'TemplateLiteral'].includes(e.type) &&
    !((e.type === 'CallExpression' || e.type === 'OptionalCallExpression') && /^(map|filter|flatMap|reduce)$/.test(calleeName(e.callee))) &&
    !(e.type === 'CallExpression' && e.callee.type === 'Identifier' && e.callee.name === TRANSLATOR)
  const visitChildren = p => {
    const kids = p.node.children
    const kidPaths = p.get('children')
    let run = []
    const flush = () => {
      // drop whitespace-only edges
      while (run.length && run[0].kind !== 'var' && !wsTrim(run[0].clean)) run.shift()
      while (run.length && run[run.length - 1].kind !== 'var' && !wsTrim(run[run.length - 1].clean)) run.pop()
      const r = run; run = []
      if (!r.length || !r.some(x => x.kind !== 'var' && hasLetters(x.clean))) return
      const first = r[0]; const last = r[r.length - 1]
      let start = first.node.start; let end = last.node.end
      const namer = makeNamer(); const vars = []
      let key = ''
      r.forEach((x, i) => {
        if (x.kind === 'var') {
          const s = src.slice(x.expr.start, x.expr.end)
          const n = namer(x.expr, s)
          if (!vars.some(v => v[0] === n)) vars.push([n, s])
          key += `{${n}}`
          return
        }
        if (x.kind === 'text') {
          let raw = src.slice(x.node.start, x.node.end)
          let value = x.node.value
          if (i === 0) { const lead = raw.match(/^[ \t\r\n]*/)[0]; start += lead.length; raw = raw.slice(lead.length); value = value.replace(/^[ \t\r\n]*/, '') }
          if (i === r.length - 1) { const trail = raw.match(/[ \t\r\n]*$/)[0]; end -= trail.length; value = value.replace(/[ \t\r\n]*$/, '') }
          key += cleanJSX(value)
        } else key += x.clean // string literal child
      })
      if (/[{}]/.test(key.replace(/\{\w+\}/g, ''))) { report.push({ line: lineOf(start), text: key, reason: 'braces in text' }); return }
      const core = wsTrim(key)
      if (core !== key) { report.push({ line: lineOf(start), text: key, reason: 'unexpected edge whitespace' }); return }
      if (PROPER_NOUNS.has(core)) return
      r.forEach(x => { if (x.kind !== 'var') handledText.add(x.node) })
      add(core, start, vars.length ? 'jsx-mixed' : 'jsx-text')
      pushEdit(kidPaths[r[0].idx], start, end, `{${TRANSLATOR}(${q(core)}${varsCode(vars)})}`, core)
    }
    kids.forEach((k, idx) => {
      if (k.type === 'JSXText') run.push({ kind: 'text', node: k, clean: cleanJSX(k.value), idx })
      else if (k.type === 'JSXExpressionContainer' && k.expression.type === 'StringLiteral') run.push({ kind: 'lit', node: k, clean: k.expression.value, idx })
      else if (k.type === 'JSXExpressionContainer' && simpleExpr(k.expression)) run.push({ kind: 'var', node: k, expr: k.expression, idx })
      else flush()
    })
    flush()
  }
  traverse(ast, { JSXElement: visitChildren, JSXFragment: visitChildren })

  // 3. Literals (strings and templates) in rendered positions.
  const literal = (p, text, start, end, code) => {
    if (p.node.type === 'StringLiteral' && p.parentPath.node.type === 'JSXExpressionContainer' && p.parentPath.parentPath.node.type !== 'JSXAttribute' && handledText.has(p.parentPath.node)) return
    if (compared.has(text)) return
    const ex = excludedContext(p)
    if (ex) return
    const role = renderedRole(p, file)
    if (!role) return
    if (!looksUI(text)) return
    if (role !== 'attr' && role !== 'jsx' && role !== 'setter' && !/\s/.test(wsTrim(text)) && !/^[A-Z]/.test(wsTrim(text))) return
    add(text, start, 'lit:' + role)
    pushEdit(p, start, end, code, text)
  }
  traverse(ast, {
    StringLiteral(p) {
      const n = p.node
      const inAttr = p.parentPath.node.type === 'JSXAttribute'
      const text = n.value
      const code = inAttr ? `{${TRANSLATOR}(${q(text)})}` : `${TRANSLATOR}(${q(text)})`
      if (wsTrim(text) !== text && !inAttr) {
        // keep surrounding spaces outside the key
        const lead = text.match(/^[ \t\r\n]*/)[0]; const trail = text.match(/[ \t\r\n]*$/)[0]; const core = wsTrim(text)
        if (!core) return
        const c = `${q(lead)} + ${TRANSLATOR}(${q(core)}) + ${q(trail)}`.replace(/^'' \+ /, '').replace(/ \+ ''$/, '')
        if (compared.has(text) || compared.has(core)) return
        if (excludedContext(p)) return
        const role = renderedRole(p, file)
        if (!role || !looksUI(core)) return
        if (role !== 'attr' && role !== 'jsx' && role !== 'setter' && !/\s/.test(core) && !/^[A-Z]/.test(core)) return
        add(core, n.start, 'lit:' + role)
        pushEdit(p, n.start, n.end, role === 'jsx' ? `(${c})` : c, core)
        return
      }
      literal(p, text, n.start, n.end, code)
    },
    TemplateLiteral(p) {
      const n = p.node
      if (p.parentPath.node.type === 'TaggedTemplateExpression') return
      const namer = makeNamer(); const vars = []
      let key = ''
      for (let i = 0; i < n.quasis.length; i++) {
        key += n.quasis[i].value.cooked
        if (i < n.expressions.length) {
          const e = n.expressions[i]
          const s = src.slice(e.start, e.end)
          const nm = namer(e, s)
          if (!vars.some(v => v[0] === nm)) vars.push([nm, s])
          key += `{${nm}}`
        }
      }
      if (/[{}]/.test(n.quasis.map(x => x.value.cooked).join(''))) return
      const core = wsTrim(key)
      if (!core || !hasLetters(core)) return
      if (core !== key) {
        // Leading or trailing space in a template: keep it as written around the call.
        const lead = key.match(/^[ \t\r\n]*/)[0]; const trail = key.match(/[ \t\r\n]*$/)[0]
        const c = `${q(lead)} + ${TRANSLATOR}(${q(core)}${varsCode(vars)}) + ${q(trail)}`.replace(/^'' \+ /, '').replace(/ \+ ''$/, '')
        literal(p, core, n.start, n.end, p.parentPath.node.type === 'JSXExpressionContainer' && p.parentPath.parentPath.node.type === 'JSXAttribute' ? c : `(${c})`)
        return
      }
      const inAttr = p.parentPath.node.type === 'JSXAttribute'
      literal(p, core, n.start, n.end, inAttr ? `{${TRANSLATOR}(${q(core)}${varsCode(vars)})}` : `${TRANSLATOR}(${q(core)}${varsCode(vars)})`)
    },
  })

  // Drop edits nested inside another edit (the outer one wins).
  edits.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept = []
  for (const e of edits) {
    const prev = kept[kept.length - 1]
    if (prev && e.start < prev.end) { report.push({ line: e.line, text: e.text, reason: 'nested inside another rewrite: ' + prev.text.slice(0, 40) }); continue }
    kept.push(e)
  }
  return { ast, strings, edits: kept, report }
}

function collect(files = FILES, dir = SRC_DIR) {
  const seen = new Map()
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const s of analyze(src, f).strings) {
      if (!seen.has(s.text)) seen.set(s.text, `${f}:${s.line}`)
    }
  }
  // Display labels for data enum values (tEnum in i18n-core.js).
  const core = fs.readFileSync(path.join(dir, 'i18n-core.js'), 'utf8')
  const m = core.match(/ENUM_LABELS = \[([^\]]*)\]/)
  if (m) for (const [, v] of m[1].matchAll(/'([^']+)'/g)) if (!seen.has(v)) seen.set(v, 'i18n-core.js:' + (core.slice(0, m.index).split('\n').length))
  return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([text, at]) => ({ text, at }))
}

module.exports = { analyze, collect, looksUI, cleanJSX, PROPER_NOUNS, OUT, SRC_DIR, FILES, TRANSLATOR }

if (require.main === module) {
  const list = collect()
  if (!process.argv.includes('--check')) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(list, null, 1) + '\n')
  }
  console.log(`${list.length} UI strings${process.argv.includes('--check') ? '' : ' written to ' + path.relative(process.cwd(), OUT)}`)
}
