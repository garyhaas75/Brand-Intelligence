#!/usr/bin/env node
'use strict'
// Codemod: routes the UI strings found by extract_ui_strings.js through t().
//
//   node scripts/apply_ui_i18n.js [--dry] [--report <file>]
//
// Rewrites dashboard/src/App.jsx and SiteBlueprint.jsx IN PLACE by splicing
// source text at AST node positions (no code generator, so the diff only touches
// the strings). Each component that gains a t() call gets `const t = useT()` at
// its top. A module-level helper function that renders strings gains a trailing
// `t = fmt` parameter (English by default) and its calls inside components pass
// t. Strings in module-level constants are left as English keys: wrap the use
// site with t(). Everything skipped is listed in the report.
const fs = require('fs')
const path = require('path')
const { analyze, SRC_DIR, FILES, TRANSLATOR } = require('./extract_ui_strings')

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const reportFile = args.includes('--report') ? args[args.indexOf('--report') + 1] : null

function indentAt(src, pos) {
  const ls = src.lastIndexOf('\n', pos - 1) + 1
  return src.slice(ls, pos).match(/^[ \t]*/)[0]
}

function transform(src, file) {
  const { ast, edits, report } = analyze(src, file)
  const out = [...edits]
  const comps = new Map(); const helpers = new Map()
  for (const e of edits) (e.owner.kind === 'component' ? comps : helpers).set(e.owner.name, e.owner.fn)

  // Theme hook already called useT in some files: alias ours.
  const programNames = new Set()
  for (const st of ast.program.body) {
    if (st.type === 'VariableDeclaration') st.declarations.forEach(d => d.id.type === 'Identifier' && programNames.add(d.id.name))
    if (st.type === 'FunctionDeclaration' && st.id) programNames.add(st.id.name)
  }
  const hook = programNames.has('useT') ? 'useTr' : 'useT'

  // Helpers: add a trailing `t = fmt` parameter; calls from components pass t.
  const helperParamCount = new Map()
  const unsafeHelpers = new Set()
  const traverse = require(path.join(__dirname, '..', 'dashboard', 'node_modules', '@babel/traverse')).default
  for (const [name, fn] of helpers) {
    const binding = fn.scope.parent.getBinding(name) || fn.parentPath.scope.getBinding(name)
    const refs = binding ? binding.referencePaths : []
    if (refs.some(r => !(r.parentPath.node.type === 'CallExpression' && r.parentPath.node.callee === r.node))) unsafeHelpers.add(name)
    if (fn.node.params.some(p => p.type === 'RestElement')) unsafeHelpers.add(name)
    helperParamCount.set(name, fn.node.params.length)
  }
  for (const name of unsafeHelpers) {
    for (const e of edits.filter(x => x.owner.kind === 'helper' && x.owner.name === name)) {
      report.push({ line: e.line, text: e.text, reason: `helper ${name} is used as a value, not only called: fix by hand` })
      out.splice(out.indexOf(e), 1)
    }
    helpers.delete(name)
  }
  for (const [name, fn] of helpers) {
    const params = fn.node.params
    if (params.length) {
      const lastP = params[params.length - 1]
      const bare = fn.node.type === 'ArrowFunctionExpression' && params.length === 1 && src[params[0].start - 1] !== '(' && src.slice(fn.node.start, params[0].start).trim() === (fn.node.async ? 'async' : '')
      if (bare) out.push({ start: params[0].start, end: lastP.end, code: `(${src.slice(params[0].start, lastP.end)}, ${TRANSLATOR} = fmt)` })
      else out.push({ start: lastP.end, end: lastP.end, code: `, ${TRANSLATOR} = fmt` })
    } else {
      const open = src.indexOf('(', fn.node.id ? fn.node.id.end : fn.node.start)
      out.push({ start: open + 1, end: open + 1, code: `${TRANSLATOR} = fmt` })
    }
  }
  traverse(ast, {
    CallExpression(p) {
      const c = p.node.callee
      if (c.type !== 'Identifier' || !helpers.has(c.name)) return
      if (p.node.arguments.length !== helperParamCount.get(c.name)) { report.push({ line: p.node.loc.start.line, text: c.name, reason: 'helper call with a different argument count: pass t by hand' }); return }
      let fn = p.getFunctionParent(); while (fn && fn.getFunctionParent()) fn = fn.getFunctionParent()
      const outerName = fn && (fn.node.id ? fn.node.id.name : fn.parentPath.node.type === 'VariableDeclarator' ? fn.parentPath.node.id.name : null)
      if (!outerName) { report.push({ line: p.node.loc.start.line, text: c.name, reason: 'helper called outside a component' }); return }
      if (/^[A-Z]/.test(outerName)) comps.set(outerName, fn)
      else if (!helpers.has(outerName)) { report.push({ line: p.node.loc.start.line, text: c.name, reason: `helper called from ${outerName} which has no t` }); return }
      const a = p.node.arguments
      const at = a.length ? a[a.length - 1].end : src.indexOf('(', c.end) + 1
      const ins = { start: at, end: at, code: a.length ? `, ${TRANSLATOR}` : TRANSLATOR }
      // A call inside a rewritten string (a template placeholder) is copied into
      // that rewrite's vars, so patch the copy instead of splicing inside it.
      const outer = out.find(e => e.text !== undefined && e.start <= p.node.start && e.end >= p.node.end)
      if (outer) {
        const callSrc = src.slice(p.node.start, p.node.end)
        outer.code = outer.code.split(callSrc).join(src.slice(p.node.start, at) + ins.code + src.slice(at, p.node.end))
      } else out.push(ins)
    },
  })

  // Components: const t = useT() at the top of the body.
  for (const [, fn] of comps) {
    const body = fn.node.body
    if (body.type === 'BlockStatement') {
      const first = body.body[0]
      const ind = first ? indentAt(src, first.start) : '  '
      out.push({ start: body.start + 1, end: body.start + 1, code: `\n${ind}const ${TRANSLATOR} = ${hook}()` })
    } else {
      const s = body.extra && body.extra.parenthesized ? body.extra.parenStart : body.start
      let e = body.end
      if (body.extra && body.extra.parenthesized) { e = src.indexOf(')', body.end) + 1 }
      out.push({ start: s, end: s, code: `{ const ${TRANSLATOR} = ${hook}(); return ` })
      out.push({ start: e, end: e, code: ' }' })
    }
  }

  // Import after the last import.
  if (out.length) {
    const imports = ast.program.body.filter(s => s.type === 'ImportDeclaration')
    const at = imports.length ? imports[imports.length - 1].end : 0
    const names = [hook === 'useT' ? 'useT' : 'useT as useTr']
    if (helpers.size) names.push('fmt')
    out.push({ start: at, end: at, code: `\nimport { ${names.join(', ')} } from './i18n.js'` })
  }

  // Apply from the end so positions stay valid. Insertions at the same point keep order.
  out.forEach((e, i) => { e.seq = i })
  out.sort((a, b) => b.start - a.start || b.end - a.end || b.seq - a.seq)
  let res = src
  for (const e of out) res = res.slice(0, e.start) + e.code + res.slice(e.end)
  return { code: res, edits: edits.length, report, components: [...comps.keys()], helpers: [...helpers.keys()] }
}

module.exports = { transform }

if (require.main === module) {
  const all = {}
  for (const f of FILES) {
    const p = path.join(SRC_DIR, f)
    const src = fs.readFileSync(p, 'utf8')
    if (/from '\.\/i18n\.js'/.test(src)) { console.log(`${f}: already converted, skipped`); continue }
    const r = transform(src, f)
    all[f] = { edits: r.edits, components: r.components, helpers: r.helpers, report: r.report }
    if (!dry) fs.writeFileSync(p, r.code)
    console.log(`${f}: ${r.edits} rewrites, ${r.components.length} components, helpers [${r.helpers.join(', ')}], ${r.report.length} for hand review`)
  }
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(all, null, 1))
}
