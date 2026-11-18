import { useEffect, useRef, useState } from 'react'
import './Strategy360.css'
import { useT, useLang, tEnum } from './i18n.js'

// The 360 web strategy for Japan-market brands: the executive readout at the top
// of the Action Plan tab. Every item is a recommendation built from competitor,
// marketplace, social and technology evidence. When the client's own site was not
// observed the panel says so and statuses read "confirm", never "missing". Don
// Quijote is the partner: it appears as a channel, never as a competitor. The
// theme object T comes in as a prop, like SiteBlueprint.jsx.

export const arr = v => (Array.isArray(v) ? v : [])
export const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
const cap = s => { const x = str(s); return x ? x[0].toUpperCase() + x.slice(1) : x }

export function tierLabel(t, tier) {
  switch (str(tier).toLowerCase()) {
    case 'marketplace': return t('Marketplaces')
    case 'mass': return t('Mass retail')
    case 'specialty': return t('Specialty')
    case 'niche': return t('Niche')
    case 'partner': return t('Partner')
    default: return t('Unclassified')
  }
}

// Status values the analysis writes as enums. Free text from data passes through.
export function statusLabel(t, v) {
  switch (str(v).trim().toLowerCase()) {
    case 'confirm': case 'unknown': case '': return t('Confirm')
    case 'not evidenced': return t('Not evidenced')
    case 'not observed': return t('Not observed')
    case 'yes': return t('Yes')
    case 'no': return t('No')
    case 'offered': return t('Offered')
    case 'observed': return t('Observed')
    default: return str(v)
  }
}

// Roadmap phases the analysis writes as "30 days" become "{n} days".
export function phaseLabel(t, v) {
  const m = str(v).trim().match(/^(\d+)\s*days?$/i)
  return m ? t('{n} days', { n: m[1] }) : str(v)
}

// Technology categories the stack reader uses as keys.
export function techCatLabel(t, k) {
  switch (str(k).toLowerCase()) {
    case 'payments': return t('Payments')
    case 'analytics': return t('Analytics')
    case 'search': return t('Search')
    case 'crm': return t('CRM')
    case 'reviews': return t('Reviews')
    case 'chat': return t('Chat')
    case 'loyalty': return t('Loyalty')
    case 'ads': return t('Ads')
    case 'platform': return t('Platform')
    default: return str(k)
  }
}

// Class that turns on Japanese line breaking (no mid-word breaks).
export const jaClass = lang => (lang === 'ja' ? ' s360-ja' : '')
export const colon = lang => (lang === 'ja' ? '：' : ': ')

export function levelLabel(t, v) {
  switch (str(v).toLowerCase()) {
    case 'high': return t('High')
    case 'medium': return t('Medium')
    case 'low': return t('Low')
    default: return tEnum(t, cap(v))
  }
}

export function SectionTitle({ T, children, sub }) {
  return (
    <div className="s360-title">
      <h3 style={{ color: T.text }}>{children}</h3>
      {sub && <p style={{ color: T.textMuted }}>{sub}</p>}
    </div>
  )
}

export function Chip({ T, children, strong, tone }) {
  const dark = T.bg === '#0f172a'
  const tones = {
    good: dark ? { background: 'rgba(16,185,129,0.16)', color: '#6ee7b7' } : { background: '#d1fae5', color: '#065f46' },
    warn: dark ? { background: 'rgba(245,158,11,0.16)', color: '#fcd34d' } : { background: '#fef3c7', color: '#92400e' },
    bad: dark ? { background: 'rgba(239,68,68,0.16)', color: '#fca5a5' } : { background: '#fee2e2', color: '#991b1b' },
    partner: dark ? { background: 'rgba(139,92,246,0.16)', color: '#c4b5fd' } : { background: '#ede9fe', color: '#5b21b6' },
    info: dark ? { background: 'rgba(59,130,246,0.16)', color: '#93c5fd' } : { background: '#dbeafe', color: '#1e40af' },
  }
  // Dark mode: light indigo fill with near-black ink (about 7:1); white on #818CF8 is only 3:1.
  const fill = strong ? (dark ? { background: '#818CF8', color: '#0F172A', borderColor: '#818CF8' } : { background: '#4F46E5', color: '#ffffff', borderColor: '#4F46E5' }) : null
  return <span className="s360-chip" style={{ color: T.textSub, borderColor: T.inputBorder, ...(tones[tone] || null), ...(fill || null) }}>{children}</span>
}

export function Evidence({ T, items }) {
  const t = useT()
  const { lang } = useLang()
  const xs = arr(items).map(str).filter(Boolean)
  if (!xs.length) return null
  return <p className="s360-ev" style={{ color: T.textMuted }}><strong>{t('Evidence')}{colon(lang).trim()}</strong> {xs.join(lang === 'ja' ? '、' : '; ')}</p>
}

export function Notice({ T, title, children, tone = 'warn' }) {
  const dark = T.bg === '#0f172a'
  const bg = tone === 'warn' ? (dark ? 'rgba(245,158,11,0.12)' : '#fffbeb') : (dark ? 'rgba(59,130,246,0.12)' : '#eff6ff')
  const bd = tone === 'warn' ? (dark ? '#b45309' : '#fcd34d') : (dark ? '#1d4ed8' : '#93c5fd')
  return (
    <div className="s360-notice" style={{ background: bg, borderColor: bd, color: T.textSub }}>
      <strong style={{ color: T.text }}>{title}</strong>
      {children && <span> {children}</span>}
    </div>
  )
}

const Box = ({ T, children, className = '' }) => <div className={`s360-box ${className}`} style={{ background: T.surface, borderColor: T.border }}>{children}</div>

function basisLine(t, b) {
  if (!b || typeof b !== 'object') return ''
  const n = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
  const parts = []
  if (n(b.players)) parts.push(t('{n} players', { n: b.players }))
  if (n(b.socialBrandsWithData)) parts.push(t('{n} brands with social data', { n: b.socialBrandsWithData }))
  if (n(b.techObserved)) parts.push(t('{n} sites with technology read', { n: b.techObserved }))
  if (n(b.parObserved)) parts.push(t('{n} sites in the par matrix', { n: b.parObserved }))
  if (n(b.marketplaceItems)) parts.push(t('{n} marketplace best sellers', { n: b.marketplaceItems }))
  if (n(b.reviews)) parts.push(t('{n} customer reviews', { n: b.reviews }))
  if (n(b.demandTerms)) parts.push(t('{n} search-demand terms', { n: b.demandTerms }))
  if (n(b.personas)) parts.push(t('{n} personas', { n: b.personas }))
  if (n(b.approvedNiche)) parts.push(t('{n} approved niche players', { n: b.approvedNiche }))
  return parts.length ? t('Built from {value}.', { value: parts.join(', ') }) : ''
}

// Wide tables scroll inside their own box so the page never scrolls sideways.
// A right-edge shadow shows while more columns sit off to the right.
export function ScrollBox({ T, children }) {
  const ref = useRef(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const check = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2)
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    if (ro) { ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild) }
    window.addEventListener('resize', check)
    return () => { el.removeEventListener('scroll', check); if (ro) ro.disconnect(); window.removeEventListener('resize', check) }
  }, [])
  const dark = T.bg === '#0f172a'
  return (
    <div className="s360-scrollwrap">
      <div ref={ref} className="s360-scroll" style={{ borderColor: T.border }}>{children}</div>
      {more && <div className="s360-fade" aria-hidden="true" style={{ background: `linear-gradient(to right, rgba(0,0,0,0), ${dark ? 'rgba(0,0,0,0.55)' : 'rgba(15,23,42,0.16)'})` }} />}
    </div>
  )
}

// The first column stays pinned while the rest scrolls.
export function ScrollTable({ T, head, rows, className = '' }) {
  return (
    <ScrollBox T={T}>
      <table className={`s360-table s360-pinned ${className}`}>
        <thead><tr>{head.map((h, i) => <th key={i} className={i === 0 ? 's360-pin' : undefined} style={{ color: T.textMuted, borderColor: T.border, background: T.surfaceAlt }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? 's360-pin' : undefined} style={{ color: T.textSub, borderColor: T.border, background: j === 0 ? T.surface : undefined }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </ScrollBox>
  )
}

export function Strategy360Panel({ T, data }) {
  const t = useT()
  const { lang } = useLang()
  if (!data || typeof data !== 'object') return null
  const tiers = arr(data.positioningByTier).filter(x => x && (x.whoWins || x.howTheyWin))
  const stand = arr(data.standOut).filter(x => x && x.move)
  const channels = arr(data.channelMap).filter(x => x && x.channel)
  const o2s = arr(data.onlineToStore).filter(x => x && x.tactic)
  const pp = data.partnerPlay && typeof data.partnerPlay === 'object' ? data.partnerPlay : null
  const tech = data.techLandscape && typeof data.techLandscape === 'object' ? data.techLandscape : null
  const gaps = arr(data.parGaps).filter(x => x && x.capability)
  const roadmap = arr(data.roadmap).filter(x => x && arr(x.actions).length)
  const qs = arr(data.openQuestions).map(str).filter(Boolean)
  const basis = basisLine(t, data.evidenceBasis)
  const role = r => {
    switch (str(r).toLowerCase()) {
      case 'acquire': return t('Acquire')
      case 'convert': return t('Convert')
      case 'retain': return t('Retain')
      case 'drive to store': return t('Drive to store')
      default: return str(r)
    }
  }
  const share = v => {
    const s = str(v).trim()
    const n = Number(s.replace('%', ''))
    if (s && Number.isFinite(n)) return `${Math.round(s.includes('%') || n > 1 ? n : n * 100)}%`
    return s
  }
  // Known status enums are translated; "confirm" shows once, never "Confirm: confirm".
  const statusChip = v => {
    const s = str(v).trim()
    if (!s) return null
    const low = s.toLowerCase()
    if (/^(yes|offered|observed)\b/.test(low)) return <Chip T={T} tone="good">{statusLabel(t, s)}</Chip>
    if (low === 'confirm' || low === 'unknown') return <Chip T={T} tone="warn">{t('Confirm')}</Chip>
    return <span className="s360-stack"><Chip T={T} tone="warn">{t('Confirm')}</Chip><span className="s360-sub" style={{ color: T.textMuted }}>{statusLabel(t, s)}</span></span>
  }

  return (
    <section className={`s360${jaClass(lang)}`} aria-label={t('360 Strategy')}>
      <div className="s360-head">
        <p className="s360-eyebrow" style={{ color: T.accent }}>{t('360 Strategy')}</p>
        <h2 style={{ color: T.text }}>{t('Best-in-class e-commerce in Japan: where to win')}</h2>
        {basis && <p className="s360-basis" style={{ color: T.textMuted }}>{basis}</p>}
      </div>
      {data.targetObserved === false && (
        <Notice T={T} title={t('Recommendations, not findings.')}>{t("The client's own site was not observed, so nothing here describes the current site. Anything marked Confirm needs the client team to check.")}</Notice>
      )}
      {data.stale === true && <Notice T={T} title={t('Stale.')}>{t('The last refresh failed, so this is the previous version of the strategy.')}</Notice>}

      {arr(data.executiveSummary).length > 0 && (
        <Box T={T} className="s360-exec">
          <SectionTitle T={T}>{t('Executive summary')}</SectionTitle>
          <ul className="s360-list" style={{ color: T.textSub }}>{arr(data.executiveSummary).map((x, i) => <li key={i}>{str(x)}</li>)}</ul>
        </Box>
      )}

      {tiers.length > 0 && (
        <>
          <SectionTitle T={T} sub={t('Who wins in each tier, how, and what it means for us.')}>{t('Positioning by tier')}</SectionTitle>
          <div className="s360-grid s360-fill">
            {tiers.map((x, i) => (
              <Box T={T} key={i}>
                <Chip T={T} tone="info">{tierLabel(t, x.tier)}</Chip>
                <p className="s360-k" style={{ color: T.textMuted }}>{t('Who wins')}</p>
                <p style={{ color: T.text, fontWeight: 600 }}>{str(x.whoWins)}</p>
                <p className="s360-k" style={{ color: T.textMuted }}>{t('How they win')}</p>
                <p style={{ color: T.textSub }}>{str(x.howTheyWin)}</p>
                {x.implication && <><p className="s360-k" style={{ color: T.textMuted }}>{t('What it means for us')}</p><p style={{ color: T.textSub }}>{str(x.implication)}</p></>}
                <Evidence T={T} items={x.evidence} />
              </Box>
            ))}
          </div>
        </>
      )}

      {stand.length > 0 && (
        <>
          <SectionTitle T={T} sub={t('Moves a marketplace cannot copy.')}>{t('How to stand out from the marketplaces')}</SectionTitle>
          <div className="s360-grid">
            {stand.map((x, i) => (
              <Box T={T} key={i}>
                <p style={{ color: T.text, fontWeight: 700 }}>{str(x.move)}</p>
                <p className="s360-k" style={{ color: T.textMuted }}>{t('Why marketplaces cannot match it')}</p>
                <p style={{ color: T.textSub }}>{str(x.whyMarketplacesCannot)}</p>
                <Evidence T={T} items={x.evidence} />
              </Box>
            ))}
          </div>
        </>
      )}

      {channels.length > 0 && (
        <>
          <SectionTitle T={T}>{t('Channel map')}</SectionTitle>
          <ScrollTable T={T} head={[t('Channel'), t('Role'), t('Current state'), t('Best in class'), t('Moves')]}
            rows={channels.map(x => [
              <strong key="c" style={{ color: T.text }}>{str(x.channel)}</strong>,
              x.role ? <Chip key="r" T={T}>{role(x.role)}</Chip> : '',
              str(x.currentState) || <span key="n" style={{ color: T.textMuted }}>{t('Not observed')}</span>,
              str(x.bestInClass),
              <ul key="m" className="s360-list tight">{arr(x.moves).map((m, i) => <li key={i}>{str(m)}</li>)}</ul>,
            ])} />
        </>
      )}

      {o2s.length > 0 && (
        <>
          <SectionTitle T={T} sub={t('Turning online attention into store visits.')}>{t('Online to store')}</SectionTitle>
          <div className="s360-grid">
            {o2s.map((x, i) => (
              <Box T={T} key={i}>
                <p style={{ color: T.text, fontWeight: 700 }}>{str(x.tactic)}</p>
                <div className="s360-chips">
                  <Chip T={T} strong={str(x.impact).toLowerCase() === 'high'}>{t('{level} impact', { level: levelLabel(t, x.impact) })}</Chip>
                  <Chip T={T}>{t('{level} effort', { level: levelLabel(t, x.effort) })}</Chip>
                </div>
                <p style={{ color: T.textSub }}>{str(x.howItWorks)}</p>
                {x.bestInClassExample && <p style={{ color: T.textSub }}><strong>{t('Best in class')}:</strong> {str(x.bestInClassExample)}</p>}
                <Evidence T={T} items={x.evidence} />
              </Box>
            ))}
          </div>
        </>
      )}

      {pp && (str(pp.summary) || arr(pp.moves).length > 0) && (
        <Box T={T} className="s360-partner">
          <SectionTitle T={T} sub={t('Don Quijote is our partner: a channel, never a competitor. The shop-in-shop is planned, not open.')}>{t('Partner play: Don Quijote')}</SectionTitle>
          {pp.summary && <p style={{ color: T.textSub }}>{str(pp.summary)}</p>}
          <div className="s360-two">
            {arr(pp.moves).length > 0 && <div><p className="s360-k" style={{ color: T.textMuted }}>{t('Moves')}</p><ul className="s360-list" style={{ color: T.textSub }}>{arr(pp.moves).map((m, i) => <li key={i}>{str(m)}</li>)}</ul></div>}
            {arr(pp.risks).length > 0 && <div><p className="s360-k" style={{ color: T.textMuted }}>{t('Risks')}</p><ul className="s360-list" style={{ color: T.textSub }}>{arr(pp.risks).map((m, i) => <li key={i}>{str(m)}</li>)}</ul></div>}
          </div>
        </Box>
      )}

      {tech && (str(tech.summary) || arr(tech.categories).length > 0) && (
        <>
          <SectionTitle T={T}>{t('Technology landscape')}</SectionTitle>
          {tech.summary && <p className="s360-p" style={{ color: T.textSub }}>{str(tech.summary)}</p>}
          {arr(tech.categories).length > 0 && (
            <ScrollTable T={T} head={[t('Category'), t('What the best players use'), t('Our status'), t('Recommendation')]}
              rows={arr(tech.categories).filter(c => c && c.category).map(c => [<strong key="c" style={{ color: T.text }}>{str(c.category)}</strong>, str(c.bestInClassUses), statusChip(c.ourStatus) || <span key="n" style={{ color: T.textMuted }}>{t('Not observed')}</span>, str(c.recommendation)])} />
          )}
        </>
      )}

      {gaps.length > 0 && (
        <>
          <SectionTitle T={T} sub={t('Capabilities most players offer that we have not been seen offering. Confirm before acting.')}>{t('Par gaps')}</SectionTitle>
          <ScrollTable T={T} head={[t('Capability'), t('Share of players offering it'), t('Our status'), t('Action')]}
            rows={gaps.map(g => [<strong key="c" style={{ color: T.text }}>{str(g.capability)}</strong>, share(g.parShare), statusChip(g.ourStatus) || <Chip key="s" T={T} tone="warn">{t('Confirm')}</Chip>, str(g.action)])} />
        </>
      )}

      {roadmap.length > 0 && (
        <>
          <SectionTitle T={T}>{t('Roadmap')}</SectionTitle>
          <div className="s360-roadmap">
            {roadmap.map((r, i) => (
              <Box T={T} key={i}>
                <p style={{ color: T.accent, fontWeight: 800 }}>{phaseLabel(t, r.phase)}</p>
                <ul className="s360-list" style={{ color: T.textSub }}>{arr(r.actions).map((a, j) => <li key={j}>{str(a)}</li>)}</ul>
              </Box>
            ))}
          </div>
        </>
      )}

      {qs.length > 0 && (
        <Box T={T}>
          <SectionTitle T={T} sub={t('Things only the client team can confirm. Each answer sharpens the plan.')}>{t('Questions for the client team to confirm')}</SectionTitle>
          <ol className="s360-list" style={{ color: T.textSub }}>{qs.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </Box>
      )}
    </section>
  )
}

export function Strategy360Missing({ T }) {
  const t = useT()
  return <Notice T={T} tone="info" title={t('360 Strategy not generated yet.')}>{t('It is built by Refresh all once the competitive, social and technology evidence is in.')}</Notice>
}
