import { useState } from 'react'
import './SiteBlueprint.css'
import { useT, tEnum, fmt } from './i18n.js'

// Website blueprint panels for the Website Audit tab. Everything here is a
// recommendation built from competitor and market evidence. When the target's
// own site was not observed the copy says so plainly and never claims anything
// about the current site. The theme object T comes in as a prop so this file
// exports components only (react-refresh rule) and does not reach into App.jsx.

const GROUPS = [
  { key: 'navigation', title: 'Navigation' },
  { key: 'homepage', title: 'Homepage' },
  { key: 'productAndCategoryPages', title: 'Product and category pages' },
  { key: 'searchAndDiscovery', title: 'Search and discovery' },
  { key: 'trustAndService', title: 'Trust and service' },
  { key: 'seoAndAiVisibility', title: 'SEO and AI visibility' },
]

const arr = v => (Array.isArray(v) ? v : [])
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v))

function evidenceLine(eb, t = fmt) {
  if (!eb || typeof eb !== 'object') return ''
  const parts = []
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const total = num(eb.competitorsTotal), scraped = num(eb.competitorsScraped)
  if (total) parts.push(`${scraped ?? 0} of ${total} competitor sites`)
  if (num(eb.marketplaceItems)) parts.push(t(eb.marketplaceItems === 1 ? '{n} marketplace best seller' : '{n} marketplace best sellers', { n: eb.marketplaceItems }))
  if (num(eb.reviewsAnalyzed)) parts.push(t(eb.reviewsAnalyzed === 1 ? '{n} customer review' : '{n} customer reviews', { n: eb.reviewsAnalyzed }))
  if (num(eb.demandTerms)) parts.push(t(eb.demandTerms === 1 ? '{n} search-demand term' : '{n} search-demand terms', { n: eb.demandTerms }))
  if (num(eb.personas)) parts.push(t(eb.personas === 1 ? '{n} persona' : '{n} personas', { n: eb.personas }))
  if (!parts.length) return ''
  const last = parts.pop()
  return t('Built from {value}.', { value: parts.length ? `${parts.join(', ')} and ${last}` : last })
}

// Small text labels so priority, effort and confidence never rely on colour.
function Levels({ T, item }) {
  const t = useT()
  const labels = [
    item.priority && { text: t('{priority} priority', { priority: tEnum(t, cap(item.priority)) }), strong: str(item.priority).toLowerCase() === 'high' },
    item.effort && { text: t('{effort} effort', { effort: tEnum(t, cap(item.effort)) }) },
    item.confidence && { text: t('{confidence} confidence', { confidence: tEnum(t, cap(item.confidence)) }) },
  ].filter(Boolean)
  if (!labels.length) return null
  // High priority is filled so it stands out; the text still says it. AA pairs:
  // light #4F46E5 / white 6.29:1, dark #818CF8 / #0F172A 5.98:1.
  const dark = T.bg === '#0f172a'
  const fill = dark ? { background: '#818CF8', color: '#0F172A', border: '1px solid #818CF8' } : { background: '#4F46E5', color: '#ffffff', border: '1px solid #4F46E5' }
  return (
    <span className="bp-levels">
      {labels.map(l => (
        <span key={l.text} style={{ fontSize: 12, fontWeight: l.strong ? 700 : 600, color: T.textSub, border: `1px solid ${T.inputBorder}`, borderRadius: 6, padding: '1px 8px', whiteSpace: 'nowrap', ...(l.strong ? fill : null) }}>{l.text}</span>
      ))}
    </span>
  )
}
const cap = s => { const t = str(s); return t ? t[0].toUpperCase() + t.slice(1) : t }

function Chips({ T, list, label: labelProp }) {
  const t = useT()
  const label = labelProp ?? t('Evidence')
  const items = arr(list).map(str).filter(Boolean)
  if (!items.length) return null
  return (
    <div className="bp-chips" aria-label={label}>
      <span style={{ fontSize: 12, color: T.textSub, fontWeight: 600 }}>{label}:</span>
      {items.map((e, i) => (
        <span key={i} style={{ fontSize: 12, background: T.surfaceAlt, color: T.textSub, border: `1px solid ${T.border}`, borderRadius: 20, padding: '2px 10px' }}>{e}</span>
      ))}
    </div>
  )
}

function Group({ T, title, count, open, children }) {
  const t = useT()
  return (
    <details className="bp-group" open={open} style={{ borderTop: `1px solid ${T.border}` }}>
      <summary className="bp-sum" style={{ color: T.text }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 13, color: T.textSub, fontWeight: 500 }}>{t(count === 1 ? '{n} item' : '{n} items', { n: count })}</span>
      </summary>
      <div className="bp-body">{children}</div>
    </details>
  )
}

function Row({ T, title, children, item }) {
  return (
    <div className="bp-row" style={{ borderLeft: `3px solid ${T.accent}`, background: T.surfaceAlt }}>
      <div className="bp-row-head">
        <p style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{title}</p>
        {item && <Levels T={T} item={item} />}
      </div>
      {children}
    </div>
  )
}

const P = ({ T, children, label }) => children ? (
  <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.6, marginTop: 4 }}>
    {label && <strong style={{ color: T.text }}>{label}: </strong>}{children}
  </p>
) : null

export function BlueprintPanel({ T, data }) {
  const t = useT()
  const bp = data?.blueprint || {}
  const groups = GROUPS.map(g => ({ ...g, items: arr(bp[g.key]) })).filter(g => g.items.length)
  const seasonal = arr(bp.seasonalCalendar)
  const practices = arr(data?.bestPractices)
  const roadmap = arr(data?.roadmap)
  const ev = evidenceLine(data?.evidenceBasis, t)
  const firstKey = groups[0]?.key || (seasonal.length ? 'seasonal' : practices.length ? 'practices' : 'roadmap')

  return (
    <section aria-labelledby="bp-title" className="bp-wrap" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
      <div className="bp-title-row">
        <h3 id="bp-title" style={{ color: T.text, fontSize: 17, fontWeight: 700 }}>{t('Website blueprint')}</h3>
        {data?.mode === 'audit-informed' && <span style={{ fontSize: 12, color: T.textSub, border: `1px solid ${T.inputBorder}`, borderRadius: 6, padding: '1px 8px' }}>{t('Informed by a manual capture')}</span>}
        {data?.stale && <span style={{ fontSize: 12, color: T.textSub, border: `1px solid ${T.inputBorder}`, borderRadius: 6, padding: '1px 8px' }}>{t('From an earlier run')}</span>}
      </div>

      {data?.targetObserved === false && (
        <p className="bp-note" style={{ background: T.surfaceAlt, borderLeft: `3px solid ${T.accent}`, color: T.text }}>
          {str(data.targetNote) || t('The brand site was not observed. Everything below is a recommendation built from competitor and market evidence, not a finding about the current site.')}
        </p>
      )}
      {ev && <p style={{ fontSize: 13, color: T.textSub, marginTop: 12 }}>{ev}</p>}
      {data?.summary && <p style={{ fontSize: 14, color: T.text, lineHeight: 1.7, marginTop: 12, marginBottom: 16 }}>{str(data.summary)}</p>}

      {groups.map(g => (
        <Group key={g.key} T={T} title={t(g.title)} count={g.items.length} open={firstKey === g.key}>
          {g.items.map((it, i) => (
            <Row key={i} T={T} title={str(it.item)} item={it}>
              <P T={T}>{str(it.rationale)}</P>
              <Chips T={T} list={it.evidence} />
            </Row>
          ))}
        </Group>
      ))}

      {seasonal.length > 0 && (
        <Group T={T} title={t('Seasonal calendar')} count={seasonal.length} open={firstKey === 'seasonal'}>
          {seasonal.map((s, i) => (
            <Row key={i} T={T} title={str(s.moment)}>
              <P T={T} label={t('When')}>{str(s.timing)}</P>
              <P T={T} label={t('Action')}>{str(s.action)}</P>
              <Chips T={T} list={s.evidence} />
            </Row>
          ))}
        </Group>
      )}

      {practices.length > 0 && (
        <Group T={T} title={t('Best practices')} count={practices.length} open={firstKey === 'practices'}>
          {practices.map((p, i) => (
            <Row key={i} T={T} title={str(p.practice)} item={p}>
              <P T={T}>{str(p.whyItWorks)}</P>
              <P T={T} label={t('How to apply')}>{str(p.howToApply)}</P>
              <Chips T={T} list={p.whoDoesIt} label={t('Who does it')} />
            </Row>
          ))}
        </Group>
      )}

      {roadmap.length > 0 && (
        <Group T={T} title={t('Roadmap')} count={roadmap.length} open={firstKey === 'roadmap'}>
          {roadmap.map((r, i) => (
            <Row key={i} T={T} title={str(r.phase)}>
              <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {arr(r.actions).map((a, j) => <li key={j} style={{ fontSize: 13, color: T.textSub, lineHeight: 1.6, marginBottom: 4 }}>{str(a)}</li>)}
              </ol>
            </Row>
          ))}
        </Group>
      )}
    </section>
  )
}

const storeKey = slug => `brand_intel_verify_${slug}`
function readChecked(slug) {
  try {
    const v = JSON.parse(window.localStorage.getItem(storeKey(slug)) || '[]')
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
  } catch { return [] }
}
function writeChecked(slug, list) {
  try { window.localStorage.setItem(storeKey(slug), JSON.stringify(list)) } catch { /* storage blocked: keep it for this session only */ }
}

// A tick is keyed by the item's stable id (never translated), falling back to
// the check text for data written before ids existed.
const tickKey = it => str(it.id) || str(it.check)

// Render with key={slug} so a brand switch starts from that brand's saved state.
export function VerifyFirstPanel({ T, slug, items }) {
  const t = useT()
  const list = arr(items).filter(it => it && it.check)
  const [checked, setChecked] = useState(() => {
    // Drop ticks for items no longer in this blueprint so old ones do not pile up.
    const stored = readChecked(slug)
    const live = new Set(list.map(tickKey))
    const kept = stored.filter(k => live.has(k))
    if (list.length && kept.length !== stored.length) writeChecked(slug, kept)
    return kept
  })
  if (!list.length) return null
  const done = list.filter(it => checked.includes(tickKey(it))).length
  const toggle = check => {
    const next = checked.includes(check) ? checked.filter(c => c !== check) : [...checked, check]
    setChecked(next)
    writeChecked(slug, next)
  }

  return (
    <section aria-labelledby="vf-title" className="bp-wrap" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
      <div className="bp-title-row">
        <h3 id="vf-title" style={{ color: T.text, fontSize: 17, fontWeight: 700 }}>{t('Verify first')}</h3>
        <span aria-live="polite" style={{ fontSize: 13, fontWeight: 600, color: T.textSub }}>{t('{done} of {length} checked', { done, length: list.length })}</span>
      </div>
      <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.6, marginTop: 6, marginBottom: 12 }}>
        {t('Confirm these on the live site with the team that runs it. Each answer turns a recommendation into a finding.')}
      </p>
      <ul className="vf-list">
        {list.map((it, i) => {
          const check = str(it.check)
          const k = tickKey(it)
          const id = `vf-${i}`
          const on = checked.includes(k)
          return (
            <li key={k} style={{ borderTop: `1px solid ${T.border}` }}>
              <label htmlFor={id} className="vf-label" style={{ color: on ? T.textMuted : T.text }}>
                <input id={id} type="checkbox" checked={on} onChange={() => toggle(k)} style={{ accentColor: T.accent }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{on && <span aria-hidden="true">✓ </span>}{check}</span>
              </label>
              <div className="vf-detail">
                {it.how && <P T={T} label={t('Where to look')}>{str(it.how)}</P>}
                {(it.ifMissing || it.ifPresent) && (
                  <details>
                    <summary className="bp-sum bp-sum-sm" style={{ color: T.text }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{t('If missing / If present')}</span>
                    </summary>
                    <P T={T} label={t('If missing')}>{str(it.ifMissing)}</P>
                    <P T={T} label={t('If present')}>{str(it.ifPresent)}</P>
                  </details>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// One line above the audit details when the target site was not observed.
export function BenchmarkNotice({ T, note }) {
  const t = useT()
  return (
    <p role="note" className="bp-note" style={{ background: T.surfaceAlt, borderLeft: `3px solid ${T.accent}`, color: T.text, marginBottom: 24 }}>
      <strong>{t('Recommendations, not findings.')} </strong>
      {str(note) || t('The brand site was not observed, so this audit is built from competitor and market evidence.')}
    </p>
  )
}

export function BlueprintMissing({ T }) {
  const t = useT()
  return <p className="bp-note" style={{ background: T.surfaceAlt, borderLeft: `3px solid ${T.accent}`, color: T.text, marginTop: 0, marginBottom: 24 }}>{t('The website blueprint is generated at the end of a full refresh.')}</p>
}
