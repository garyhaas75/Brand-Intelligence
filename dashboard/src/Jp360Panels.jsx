import { useState } from 'react'
import './Strategy360.css'
import { useT, useLang } from './i18n.js'
import { arr, str, tierLabel, levelLabel, techCatLabel, jaClass, colon, SectionTitle, Chip, Notice, ScrollTable, ScrollBox } from './Strategy360.jsx'

// Japan 360 panels for the Competitive, Website and Social tabs: players by tier
// with the partner kept apart, the par matrix, niche candidate approvals, the
// technology stack and the social tier insights. Japan-market brands only; the
// caller decides. Nothing here ranks Don Quijote, which is the partner.

const TIER_ORDER = ['marketplace', 'mass', 'specialty', 'niche', 'unknown']
const tierIdx = p => { const i = TIER_ORDER.indexOf(str(p && p.tier).toLowerCase()); return i < 0 ? TIER_ORDER.length : i }
const isPartner = p => str(p && p.relationship).toLowerCase() === 'partner'
const isSelf = p => str(p && p.role).toLowerCase() === 'target' || str(p && p.relationship).toLowerCase() === 'self'
const numFmt = (lang, v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? new Intl.NumberFormat(lang === 'ja' ? 'ja-JP' : 'en-US', { maximumFractionDigits: d }).format(v) : '')
const compact = (lang, v) => (typeof v === 'number' && Number.isFinite(v) ? new Intl.NumberFormat(lang === 'ja' ? 'ja-JP' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : '')

// Player name with its tier chip on its own line underneath.
function NameCell({ T, p, name }) {
  return <span className="s360-namecell"><strong style={{ color: T.text }}>{name || p.name}</strong><RelBadge T={T} p={p} /></span>
}

// Niche candidate kinds (analysis/niche_discovery.js KINDS) plus older free labels.
function kindLabel(t, k) {
  switch (str(k).trim().toLowerCase()) {
    case 'maker': return t('Maker')
    case 'd2c': return t('Direct-to-consumer brand')
    case 'character': return t('Character brand')
    case 'educational': return t('Educational')
    case 'collectible': return t('Collectibles')
    case 'gacha': return t('Gacha')
    case 'shop': case 'online shop': return t('Shop')
    case 'specialty store': return t('Specialty store')
    case 'brand': return t('Brand')
    case 'other': return t('Other')
    default: return str(k)
  }
}

// Evidence sources niche discovery writes.
function sourceLabel(t, v) {
  switch (str(v).trim().toLowerCase()) {
    case 'marketplace': return t('Marketplace')
    case 'search': return t('Search')
    case 'social': return t('Social')
    default: return str(v)
  }
}

// Social cadence written by the audit as "N per week" or "N to M per week".
export function cadenceLabel(t, lang, v) {
  const m = str(v).trim().match(/^(\d+(?:\.\d+)?)(?:\s*(?:to|-|〜)\s*(\d+(?:\.\d+)?))?\s*(?:posts?\s*)?per week$/i)
  if (!m) return str(v)
  const n = m[2] ? `${m[1]}${lang === 'ja' ? '〜' : ' to '}${m[2]}` : m[1]
  return t('{n} per week', { n })
}

function RelBadge({ T, p }) {
  const t = useT()
  if (isSelf(p)) return <Chip T={T} strong>{t('Us')}</Chip>
  if (isPartner(p)) return <Chip T={T} tone="partner">{t('Partner')}</Chip>
  return <Chip T={T} tone="info">{tierLabel(t, p && p.tier)}</Chip>
}

// ─── Players by tier ────────────────────────────────────────────────────────
export function TierPlayers({ T, players }) {
  const t = useT()
  const { lang } = useLang()
  const list = arr(players).filter(p => p && p.name && !isSelf(p))
  if (!list.length) return null
  const partners = list.filter(isPartner)
  const groups = TIER_ORDER.map(tier => ({ tier, items: list.filter(p => !isPartner(p) && (str(p.tier).toLowerCase() || 'unknown') === tier) })).filter(g => g.items.length)
  const obs = p => (p.observed === false || p.observed === 0 ? <Chip T={T} tone="warn">{t('Not observed')}</Chip> : null)
  return (
    <section className={`s360 s360-block${jaClass(lang)}`}>
      <SectionTitle T={T} sub={t('Every player we track, grouped by how they compete. The partner is shown on its own and never scored.')}>{t('Players by tier')}</SectionTitle>
      <div className="s360-grid s360-fill">
        {groups.map(g => (
          <div key={g.tier} className="s360-box" style={{ background: T.surface, borderColor: T.border }}>
            <p className="s360-k" style={{ color: T.textMuted }}>{tierLabel(t, g.tier)} ({g.items.length})</p>
            <ul className="s360-plain">{g.items.map(p => <li key={p.name} style={{ color: T.text }}>{p.name} {obs(p)}</li>)}</ul>
          </div>
        ))}
        {partners.length > 0 && (
          <div className="s360-box" style={{ background: T.surface, borderColor: T.border, borderStyle: 'dashed' }}>
            <p className="s360-k" style={{ color: T.textMuted }}>{t('Partner')}</p>
            <ul className="s360-plain">{partners.map(p => <li key={p.name} style={{ color: T.text }}>{p.name} <Chip T={T} tone="partner">{t('Partner, not a competitor')}</Chip></li>)}</ul>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Par matrix ─────────────────────────────────────────────────────────────
export function ParMatrix({ T, data }) {
  const t = useT()
  const { lang } = useLang()
  const [sel, setSel] = useState(null)
  if (!data || typeof data !== 'object') return null
  const caps = arr(data.capabilities).filter(c => c && c.key)
  const players = arr(data.players).filter(p => p && p.name)
  if (!caps.length || !players.length) return null
  const cols = [...players].sort((a, b) => (isSelf(b) - isSelf(a)) || (isPartner(a) - isPartner(b)) || (tierIdx(a) - tierIdx(b)))
  const par = data.par && typeof data.par === 'object' ? data.par : {}
  const gapKeys = new Set(arr(data.gaps).map(g => g && g.key).filter(Boolean))
  const capLabel = c => (lang === 'ja' && c.labelJa) || c.label || c.key
  const mark = s => (s === 'yes' ? '✓' : s === 'no' ? '✕' : '?')
  const word = s => (s === 'yes' ? t('Yes') : s === 'no' ? t('No') : t('Unknown'))
  const dark = T.bg === '#0f172a'
  const cellBg = s => (s === 'yes' ? (dark ? 'rgba(16,185,129,0.16)' : '#d1fae5') : s === 'no' ? (dark ? 'rgba(239,68,68,0.14)' : '#fee2e2') : 'transparent')
  const cellInk = s => (s === 'yes' ? (dark ? '#6ee7b7' : '#065f46') : s === 'no' ? (dark ? '#fca5a5' : '#991b1b') : (dark ? '#cbd5e1' : T.textMuted))
  const selCell = sel && players.find(p => p.name === sel.p)?.cells?.[sel.k]
  const selCap = sel && caps.find(c => c.key === sel.k)
  return (
    <section className={`s360 s360-block${jaClass(lang)}`}>
      <SectionTitle T={T} sub={t('Which players offer each capability. Tap a cell for the evidence. Our column says Confirm wherever we have not been seen offering it.')}>{t('Par matrix')}</SectionTitle>
      <div className="s360-legend" style={{ color: T.textMuted }}>
        <span>✓ {t('Yes')}</span><span>✕ {t('No')}</span><span>? {t('Unknown')}</span>
        <span><span className="s360-swatch" style={{ background: dark ? 'rgba(245,158,11,0.25)' : '#fef3c7' }} /> {t('Gap: most players offer it, we have not been seen offering it')}</span>
      </div>
      <ScrollBox T={T}>
        <table className="s360-table s360-matrix">
          <thead>
            <tr>
              <th className="s360-sticky" style={{ background: T.surfaceAlt, color: T.textMuted, borderColor: T.border }}>{t('Capability')}</th>
              <th className="s360-share" style={{ background: T.surfaceAlt, color: T.textMuted, borderColor: T.border }}>{t('Par share')}</th>
              {cols.map(p => (
                <th key={p.name} className="s360-col" style={{ background: T.surfaceAlt, color: isSelf(p) ? T.text : T.textMuted, borderColor: T.border }}>
                  <span className="s360-colname">{p.name}</span>
                  <RelBadge T={T} p={p} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {caps.map(c => {
              const pc = par[c.key] || {}
              const gap = gapKeys.has(c.key)
              const rowBg = gap ? (dark ? 'rgba(245,158,11,0.10)' : '#fffbeb') : undefined
              return (
                <tr key={c.key} style={{ background: rowBg }}>
                  <th scope="row" className="s360-sticky" style={{ background: gap ? (dark ? '#3b2f1a' : '#fffbeb') : T.surface, color: T.text, borderColor: T.border }}>
                    <span className="s360-capname">{capLabel(c)}</span>{gap && <span className="s360-gapline"><Chip T={T} tone="warn">{t('Gap')}</Chip></span>}
                  </th>
                  <td style={{ color: T.textSub, borderColor: T.border, fontVariantNumeric: 'tabular-nums' }}>{typeof pc.yesShare === 'number' ? `${Math.round(pc.yesShare * 100)}%` : '-'}</td>
                  {cols.map(p => {
                    const cell = (p.cells && p.cells[c.key]) || {}
                    const s = ['yes', 'no'].includes(cell.status) ? cell.status : 'unknown'
                    const tip = [word(s), str(cell.evidence), str(cell.detail)].filter(Boolean).join(': ')
                    const confirm = isSelf(p) && s !== 'yes'
                    const on = sel && sel.p === p.name && sel.k === c.key
                    return (
                      <td key={p.name} style={{ borderColor: T.border, padding: 0 }}>
                        <button type="button" className="s360-cell" title={tip} aria-label={`${p.name}, ${capLabel(c)}: ${tip}`} aria-pressed={on}
                          onClick={() => setSel(on ? null : { p: p.name, k: c.key })}
                          style={{ background: cellBg(s), color: cellInk(s), outline: on ? `2px solid ${T.accent}` : 'none' }}>
                          {confirm ? <Chip T={T} tone="warn">{t('Confirm')}</Chip> : mark(s)}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </ScrollBox>
      {sel && selCap && (
        <div className="s360-box s360-detail" style={{ background: T.surface, borderColor: T.accent }} role="status">
          <p style={{ color: T.text, fontWeight: 700 }}>{sel.p}{colon(lang)}{capLabel(selCap)}</p>
          <p style={{ color: T.textSub }}>{word(selCell?.status)}{selCell?.amountYen ? ` (¥${numFmt(lang, selCell.amountYen)})` : ''}</p>
          {selCell?.evidence && <p style={{ color: T.textSub }}>{str(selCell.evidence)}</p>}
          {selCell?.detail && <p style={{ color: T.textMuted }}>{str(selCell.detail)}</p>}
          {selCell?.url && <p className="s360-url"><a href={selCell.url} target="_blank" rel="noreferrer" style={{ color: T.accent }}>{selCell.url}</a></p>}
          {!selCell?.evidence && !selCell?.detail && <p style={{ color: T.textMuted }}>{t('No evidence was found on the pages read.')}</p>}
        </div>
      )}
    </section>
  )
}

// ─── Niche candidates ───────────────────────────────────────────────────────
export function NicheApprovals({ T, slug, data, api = '/api' }) {
  const t = useT()
  const { lang } = useLang()
  const [doc, setDoc] = useState(data)
  const [busy, setBusy] = useState({})
  const [err, setErr] = useState('')
  const [seen, setSeen] = useState(data)
  if (seen !== data) { setSeen(data); setDoc(data) }
  if (!doc || typeof doc !== 'object') return null
  const cands = arr(doc.candidates).filter(c => c && c.id)
  if (!cands.length) return null
  const pending = cands.filter(c => !c.status || c.status === 'pending' || c.status === 'proposed')
  const decided = cands.filter(c => !pending.includes(c))

  async function decide(id, decision) {
    const before = doc
    setErr('')
    setBusy(b => ({ ...b, [id]: true }))
    setDoc(d => ({ ...d, candidates: arr(d.candidates).map(c => (c.id === id ? { ...c, status: decision === 'approve' ? 'approved' : 'rejected' } : c)) }))
    try {
      const res = await fetch(`${api}/brands/${slug}/niche-decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision }) })
      let body = null
      try { body = await res.json() } catch { body = null }
      if (!res.ok) {
        setDoc(before)
        if (res.status === 409) setErr(t('A full refresh is running for this brand. Decide after it finishes.'))
        else if (res.status === 400) setErr(t('That decision was not accepted: {reason}', { reason: str(body && body.error) || t('unknown reason') }))
        else setErr(t('The decision could not be saved. Try again.'))
      } else if (body && body.candidates && typeof body.candidates === 'object') {
        setDoc(body.candidates)
      }
    } catch {
      setDoc(before)
      setErr(t('The decision could not be saved. Try again.'))
    }
    setBusy(b => ({ ...b, [id]: false }))
  }

  // Dark mode accent is #818CF8: near-black ink on it (about 7:1), white would be 3:1.
  const dark = T.bg === '#0f172a'
  const btn = (primary) => ({ background: primary ? T.accent : 'transparent', color: primary ? (dark ? '#0F172A' : '#ffffff') : T.textSub, border: `1px solid ${primary ? T.accent : T.inputBorder}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 40 })
  const statusChip = c => (c.status === 'approved' ? <Chip T={T} tone="good">{t('Approved')}</Chip> : c.status === 'rejected' ? <Chip T={T} tone="bad">{t('Rejected')}</Chip> : null)
  return (
    <section className={`s360 s360-block${jaClass(lang)}`}>
      <SectionTitle T={T} sub={t('Niche brands found in marketplace, search and social evidence. Approved ones join the next run; nothing is scanned until you approve it.')}>{t('Niche candidates to review')}</SectionTitle>
      {err && <div role="alert"><Notice T={T} title={t('Not saved.')}>{err}</Notice></div>}
      {pending.length === 0 && <p style={{ color: T.textMuted, fontSize: 13 }}>{t('Nothing waiting for a decision.')}</p>}
      <div className="s360-grid">
        {pending.map(c => (
          <div key={c.id} className="s360-box" style={{ background: T.surface, borderColor: T.border }}>
            <p style={{ color: T.text, fontWeight: 700 }}>{c.name}{c.nameJa && c.nameJa !== c.name ? <span style={{ color: T.textMuted, fontWeight: 500 }}> {c.nameJa}</span> : null}</p>
            <div className="s360-chips">{c.kind && <Chip T={T}>{kindLabel(t, c.kind)}</Chip>}</div>
            {c.url && <p className="s360-url"><a href={c.url} target="_blank" rel="noreferrer" style={{ color: T.accent }}>{c.url}</a></p>}
            {c.whyInteresting && <p style={{ color: T.textSub }}>{str(c.whyInteresting)}</p>}
            {arr(c.evidence).length > 0 && (
              <ul className="s360-list tight" style={{ color: T.textMuted }}>
                {arr(c.evidence).slice(0, 4).map((e, i) => <li key={i}><strong>{sourceLabel(t, e && e.source)}</strong>{e && e.text ? `${colon(lang)}${str(e.text)}` : ''}</li>)}
              </ul>
            )}
            <div className="s360-actions">
              <button type="button" disabled={!!busy[c.id]} onClick={() => decide(c.id, 'approve')} style={btn(true)}>{t('Approve')}</button>
              <button type="button" disabled={!!busy[c.id]} onClick={() => decide(c.id, 'reject')} style={btn(false)}>{t('Reject')}</button>
            </div>
          </div>
        ))}
      </div>
      {decided.length > 0 && (
        <div className="s360-decided">
          <p className="s360-k" style={{ color: T.textMuted }}>{t('Decided')}</p>
          <ul className="s360-plain">{decided.map(c => <li key={c.id} style={{ color: T.textSub }}>{c.name} {statusChip(c)}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

// ─── Technology stack ───────────────────────────────────────────────────────
const vendors = v => {
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object' ? x.name || x.vendor || '' : str(x))).filter(Boolean).join(', ')
  if (v && typeof v === 'object') return str(v.name || v.vendor)
  return str(v)
}

export function TechStackTable({ T, data }) {
  const t = useT()
  const { lang } = useLang()
  if (!data || typeof data !== 'object') return null
  const players = arr(data.players).filter(p => p && p.name)
  if (!players.length) return null
  const rows = [...players].sort((a, b) => (isSelf(b) - isSelf(a)) || (isPartner(a) - isPartner(b)) || (tierIdx(a) - tierIdx(b)))
  const dash = <span style={{ color: T.textFaint }}>-</span>
  const ps = data.summary && data.summary.platformShare
  const most = data.summary && data.summary.mostCommon
  const app = a => {
    if (!a || typeof a !== 'object') return ''
    return [a.ios && 'iOS', a.android && 'Android'].filter(Boolean).join(', ')
  }
  return (
    <section className={`s360 s360-block${jaClass(lang)}`}>
      <SectionTitle T={T} sub={t('What each site runs on, read from its public pages. A dash means it was not seen, not that it is absent.')}>{t('Technology stack')}</SectionTitle>
      {(ps || most) && (
        <p className="s360-p" style={{ color: T.textSub }}>
          {most && typeof most === 'object' && Object.entries(most).filter(([, v]) => v).slice(0, 6).map(([k, v]) => `${techCatLabel(t, k)}${colon(lang)}${vendors(v)}`).join(' · ')}
        </p>
      )}
      {/* CRM, chat and loyalty share one column and structured data is left to the report, so the table fits at 1440. */}
      <ScrollTable T={T} className="s360-tech" head={[t('Player'), t('Platform'), t('Payments'), t('Search'), t('Reviews'), t('CRM, chat, loyalty'), t('App'), t('Observed')]}
        rows={rows.map(p => {
          const c = p.categories || {}
          const plat = p.platform && p.platform.name ? <span key="pl">{p.platform.name}{p.platform.confidence ? <span className="s360-sub" style={{ color: T.textMuted }}>{t('{level} confidence', { level: levelLabel(t, p.platform.confidence) })}</span> : null}</span> : ''
          const other = [['crm', c.crm], ['chat', c.chat], ['loyalty', c.loyalty]].filter(([, v]) => vendors(v))
          const observed = !(p.observed === false || p.observed === 0)
          return [
            <NameCell key="n" T={T} p={p} />,
            plat || dash, vendors(c.payments) || dash, vendors(c.search) || dash, vendors(c.reviews) || dash,
            other.length ? <span key="ot" className="s360-lines">{other.map(([k, v]) => <span key={k}><span style={{ color: T.textMuted }}>{techCatLabel(t, k)}{colon(lang)}</span>{vendors(v)}</span>)}</span> : dash,
            app(p.app) || dash,
            observed ? <Chip key="o" T={T} tone="good">{t('Observed')}{p.stale ? `, ${t('Stale')}` : ''}</Chip> : <Chip key="o" T={T} tone="warn">{t('Not observed')}</Chip>,
          ]
        })} />
    </section>
  )
}

// ─── Social depth (schemaVersion 2) ─────────────────────────────────────────
const PLATFORMS = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'], ['x', 'X'], ['youtube', 'YouTube'], ['line', 'LINE']]

export function SocialDepth({ T, data }) {
  const t = useT()
  const { lang } = useLang()
  if (!data || typeof data !== 'object' || !(Number(data.schemaVersion) >= 2)) return null
  const brands = arr(data.brands).filter(b => b && b.name)
  const sorted = [...brands].sort((a, b) => (isSelf(b) - isSelf(a)) || (isPartner(a) - isPartner(b)) || (tierIdx(a) - tierIdx(b)))
  const rows = []
  const skipped = []
  for (const b of sorted) {
    const plats = b.platforms && typeof b.platforms === 'object' ? b.platforms : {}
    for (const [k, label] of PLATFORMS) {
      const p = plats[k]
      if (!p) continue
      if (p.budgetSkipped || (!p.posts && p.reason)) skipped.push({ brand: b.name, platform: label, why: p.budgetSkipped ? t('Apify budget cap reached') : str(p.reason) })
      if (!p.handle && !p.followers && !p.posts && !p.budgetSkipped) continue
      rows.push([
        <NameCell key="b" T={T} p={b} />,
        <span key="p" className="s360-nowrap">{label}{p.handle ? <span style={{ color: T.textMuted }}> @{str(p.handle).replace(/^@/, '')}</span> : null}</span>,
        compact(lang, p.followers) || '-',
        typeof p.engagementRate === 'number' ? `${numFmt(lang, p.engagementRate, 2)}%` : '-',
        typeof p.postsPerWeek === 'number' ? numFmt(lang, p.postsPerWeek, 1) : '-',
        arr(p.topFormats).slice(0, 3).map(f => `${str(f.format)}${typeof f.share === 'number' ? ` ${Math.round(f.share * (f.share <= 1 ? 100 : 1))}%` : ''}`).join(', ') || '-',
        p.budgetSkipped ? <Chip key="s" T={T} tone="warn">{t('Skipped: budget')}</Chip> : p.posts ? <Chip key="s" T={T} tone="good">{t('{n} posts', { n: p.posts })}</Chip> : <Chip key="s" T={T}>{t('No posts read')}</Chip>,
      ])
    }
    if (b.noBrandAccount) skipped.push({ brand: b.name, platform: '', why: t('No brand account found') })
  }
  const ti = arr(data.tierInsights).filter(x => x && (x.summary || x.formats))
  const diff = data.differentiation && typeof data.differentiation === 'object' ? data.differentiation : {}
  const niche = arr(diff.nichePlaybook).filter(x => x && x.move)
  const stand = arr(diff.standOutFromMarketplaces).filter(x => x && x.move)
  const pp = arr(data.partnerPlay).filter(x => x && x.idea)
  const cov = data.coverage && typeof data.coverage === 'object' ? data.coverage : null
  const budget = cov && cov.budget && typeof cov.budget === 'object' ? cov.budget : null
  const usd = v => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : '-')
  const brandsLine = xs => arr(xs).map(str).filter(Boolean).join(', ')
  return (
    <section className={`s360 s360-block${jaClass(lang)}`}>
      {cov && (
        <div className="s360-box" style={{ background: T.surface, borderColor: T.border }}>
          <SectionTitle T={T}>{t('Coverage')}</SectionTitle>
          <div className="s360-kpis">
            {typeof cov.brandsTotal === 'number' && <div><p className="s360-big" style={{ color: T.text }}>{numFmt(lang, cov.brandsWithData)} / {numFmt(lang, cov.brandsTotal)}</p><p style={{ color: T.textMuted }}>{t('Brands with social data')}</p></div>}
            {budget && <div><p className="s360-big" style={{ color: T.text }}>{usd(budget.runSpentUsd)} / {usd(budget.capUsd)}</p><p style={{ color: T.textMuted }}>{t('Apify spend this run: {spent} of {cap} cap', { spent: usd(budget.runSpentUsd), cap: usd(budget.capUsd) })}{typeof budget.socialSpentUsd === 'number' ? ` ${t('(social {usd})', { usd: usd(budget.socialSpentUsd) })}` : ''}</p></div>}
            {skipped.length > 0 && <div><p className="s360-big" style={{ color: T.text }}>{numFmt(lang, skipped.length)}</p><p style={{ color: T.textMuted }}>{t('Platforms skipped or empty')}</p></div>}
          </div>
          {cov.budgetStop && <Notice T={T} title={t('Budget cap reached.')}>{t('The run stopped paying for social scrapes at the cap; the rest are marked skipped.')}</Notice>}
          {skipped.length > 0 && (
            <details className="s360-details">
              <summary style={{ color: T.accent }}>{t('Show skipped platforms ({n})', { n: skipped.length })}</summary>
              <ul className="s360-list tight" style={{ color: T.textSub }}>{skipped.map((s, i) => <li key={i}><strong>{s.brand}</strong>{s.platform ? ` · ${s.platform}` : ''}: {s.why}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <SectionTitle T={T} sub={t('Engagement is interactions per post as a percent of followers. A dash means it was not available.')}>{t('Platform metrics by brand')}</SectionTitle>
          <ScrollTable T={T} head={[t('Brand'), t('Platform'), t('Followers'), t('Engagement'), t('Posts per week'), t('Top formats'), t('Status')]} rows={rows} />
        </>
      )}

      {ti.length > 0 && (
        <>
          <SectionTitle T={T}>{t('What each tier does on social')}</SectionTitle>
          <div className="s360-grid s360-fill">
            {ti.map((x, i) => (
              <div key={i} className="s360-box" style={{ background: T.surface, borderColor: T.border }}>
                <div className="s360-chips">
                  <Chip T={T} tone="info">{tierLabel(t, x.tier)}</Chip>
                  {str(x.evidenceStrength).toLowerCase() === 'thin' && <Chip T={T} tone="warn">{t('Evidence is thin')}</Chip>}
                </div>
                <p style={{ color: T.textSub }}>{str(x.summary)}</p>
                <dl className="s360-dl" style={{ color: T.textSub }}>
                  {x.formats && <><dt style={{ color: T.textMuted }}>{t('Formats')}</dt><dd>{str(x.formats)}</dd></>}
                  {x.cadence && <><dt style={{ color: T.textMuted }}>{t('Cadence')}</dt><dd>{cadenceLabel(t, lang, x.cadence)}</dd></>}
                  {x.typicalEngagement && <><dt style={{ color: T.textMuted }}>{t('Typical engagement')}</dt><dd>{str(x.typicalEngagement)}</dd></>}
                </dl>
                {brandsLine(x.evidenceBrands) && <p className="s360-ev" style={{ color: T.textMuted }}><strong>{t('Evidence')}{colon(lang).trim()}</strong> {brandsLine(x.evidenceBrands)}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {(niche.length > 0 || stand.length > 0) && (
        <div className="s360-two">
          {stand.length > 0 && (
            <div>
              <SectionTitle T={T}>{t('Stand out from the marketplaces')}</SectionTitle>
              {stand.map((x, i) => (
                <div key={i} className="s360-box" style={{ background: T.surface, borderColor: T.border, marginBottom: 10 }}>
                  <p style={{ color: T.text, fontWeight: 700 }}>{str(x.move)}{x.platform ? <span style={{ color: T.textMuted, fontWeight: 500 }}> · {str(x.platform)}</span> : null}</p>
                  {x.why && <p style={{ color: T.textSub }}>{str(x.why)}</p>}
                  {brandsLine(x.evidenceBrands) && <p className="s360-ev" style={{ color: T.textMuted }}><strong>{t('Evidence')}{colon(lang).trim()}</strong> {brandsLine(x.evidenceBrands)}</p>}
                </div>
              ))}
            </div>
          )}
          {niche.length > 0 && (
            <div>
              <SectionTitle T={T}>{t('Niche playbook')}</SectionTitle>
              {niche.map((x, i) => (
                <div key={i} className="s360-box" style={{ background: T.surface, borderColor: T.border, marginBottom: 10 }}>
                  <p style={{ color: T.text, fontWeight: 700 }}>{str(x.move)}</p>
                  {brandsLine(x.evidenceBrands) && <p className="s360-ev" style={{ color: T.textMuted }}><strong>{t('Evidence')}{colon(lang).trim()}</strong> {brandsLine(x.evidenceBrands)}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {pp.length > 0 && (
        <div className="s360-box s360-partner" style={{ background: T.surface, borderColor: T.border, borderStyle: 'dashed' }}>
          <SectionTitle T={T} sub={t('Social ideas with Don Quijote, our partner.')}>{t('Partner play on social')}</SectionTitle>
          {pp.map((x, i) => (
            <div key={i} className="s360-item" style={{ borderColor: T.border }}>
              <p style={{ color: T.text, fontWeight: 700 }}>{str(x.idea)}{x.platform ? <span style={{ color: T.textMuted, fontWeight: 500 }}> · {str(x.platform)}</span> : null}</p>
              {x.how && <p style={{ color: T.textSub }}>{str(x.how)}</p>}
              {brandsLine(x.evidenceBrands) && <p className="s360-ev" style={{ color: T.textMuted }}><strong>{t('Evidence')}{colon(lang).trim()}</strong> {brandsLine(x.evidenceBrands)}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
