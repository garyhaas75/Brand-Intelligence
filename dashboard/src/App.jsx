import React, { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const API = '/api'

// ─── Theme ─────────────────────────────────────────────────────────────────────
const LIGHT_T = {
  bg: '#f9fafb', surface: '#ffffff', surfaceAlt: '#f3f4f6', border: '#e5e7eb',
  borderAlt: '#f3f4f6', text: '#111827', textSub: '#374151', textMuted: '#6b7280',
  textFaint: '#9ca3af', accent: '#6366f1', accentText: '#ffffff', navBg: '#111827',
  navText: '#ffffff', tabBg: '#ffffff', tabBorder: '#e5e7eb', inputBg: '#ffffff',
  inputBorder: '#d1d5db', codeBg: '#f3f4f6', stripeBg: '#fafafa',
}
const DARK_T = {
  bg: '#0f172a', surface: '#1e293b', surfaceAlt: '#0f172a', border: '#334155',
  borderAlt: '#1e293b', text: '#f1f5f9', textSub: '#cbd5e1', textMuted: '#94a3b8',
  textFaint: '#64748b', accent: '#818cf8', accentText: '#ffffff', navBg: '#020617',
  navText: '#f1f5f9', tabBg: '#1e293b', tabBorder: '#334155', inputBg: '#1e293b',
  inputBorder: '#475569', codeBg: '#111827', stripeBg: '#0f172a',
}
const ThemeContext = React.createContext(LIGHT_T)
const useT = () => React.useContext(ThemeContext)

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'profile', label: 'Brand Profile' },
  { id: 'competitive', label: 'Competitive Analysis' },
  { id: 'personas', label: 'Personas' },
  { id: 'social', label: 'Social Audit' },
  { id: 'website', label: 'Website Audit' },
  { id: 'search', label: 'Search & SEO / GEO' },
  { id: 'action', label: 'Action Plan' },
]

// ─── Shared components ─────────────────────────────────────────────────────────
function Card({ children, style }) {
  const T = useT()
  return <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, ...style }}>{children}</div>
}

function Badge({ label, color = 'gray' }) {
  const colors = {
    green: { bg: '#d1fae5', text: '#065f46' }, yellow: { bg: '#fef3c7', text: '#92400e' },
    red: { bg: '#fee2e2', text: '#991b1b' }, blue: { bg: '#dbeafe', text: '#1e40af' },
    purple: { bg: '#ede9fe', text: '#5b21b6' }, gray: { bg: '#f3f4f6', text: '#374151' },
  }
  const c = colors[color] || colors.gray
  return <span style={{ display: 'inline-block', background: c.bg, color: c.text, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
}

function HealthBadge({ status }) {
  const map = { fresh: ['Fresh', 'green'], stale: ['Stale', 'yellow'], needs_refresh: ['Needs Refresh', 'red'], never_run: ['Never Run', 'gray'] }
  const [label, color] = map[status] || map.never_run
  return <Badge label={label} color={color} />
}

function ImpactBadge({ impact }) {
  const map = { high: 'red', medium: 'yellow', low: 'green' }
  return <Badge label={impact || 'medium'} color={map[impact] || 'gray'} />
}

function Section({ title, children, action }) {
  const T = useT()
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ message, cta, onCta }) {
  const T = useT()
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px', color: T.textMuted }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
      <p style={{ fontSize: 15, marginBottom: 16 }}>{message}</p>
      {cta && <button onClick={onCta} style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{cta}</button>}
    </div>
  )
}

function Spinner() {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}><div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>
}

function RefreshButton({ onClick, loading, label = 'Refresh' }) {
  const T = useT()
  return (
    <button onClick={onClick} disabled={loading} style={{ background: loading ? '#dbeafe' : 'none', border: `1px solid ${loading ? '#93c5fd' : T.border}`, borderRadius: 8, padding: '6px 14px', fontSize: 13, color: loading ? '#1e40af' : T.textSub, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none' }}>↻</span>
      {loading ? 'Running...' : label}
    </button>
  )
}

function RunningBanner({ moduleLabel, detail }) {
  return (
    <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 10, padding: '14px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontSize: 22, display: 'inline-block', animation: 'spin 1.2s linear infinite', flexShrink: 0 }}>⟳</span>
      <div>
        <p style={{ color: '#1e40af', fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{moduleLabel} — Running</p>
        <p style={{ color: '#1e3a8a', fontSize: 13 }}>{detail || 'This typically takes 2–5 minutes. Results will load automatically when complete.'}</p>
      </div>
    </div>
  )
}

// ─── Add Brand Modal ────────────────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { key: 'discovery',            label: 'Brand Discovery',      file: null },
  { key: 'competitive_analysis', label: 'Competitive Analysis', file: 'competitive_analysis' },
  { key: 'site_intelligence',    label: 'Website Audit',        file: 'site_intelligence' },
  { key: 'social_intelligence',  label: 'Social Audit',         file: 'social_intelligence' },
  { key: 'search_seo',           label: 'Search & SEO / GEO',   file: 'search_seo' },
  { key: 'personas',             label: 'Personas',             file: 'personas' },
  { key: 'action_plan',          label: 'Action Plan',          file: 'action_plan' },
]

function AddBrandModal({ onClose, onAdded }) {
  const T = useT()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [discoverySlug, setDiscoverySlug] = useState(null)
  const [moduleStatus, setModuleStatus] = useState([])
  const [discoveryDone, setDiscoveryDone] = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function handleAdd() {
    if (!url) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/brands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add brand')
      setDiscoverySlug(data.slug)
      startPolling(data.slug)
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  function startPolling(slug) {
    pollRef.current = setInterval(async () => {
      try {
        const [brandsRes, statusRes] = await Promise.all([
          fetch(`${API}/brands`).then(r => r.json()),
          fetch(`${API}/brands/${slug}/status`).then(r => r.json()),
        ])
        const brand = (brandsRes.brands || []).find(b => b.slug === slug)
        if (brand?.discoveryStatus === 'complete' || brand?.discoveryStatus === 'failed') setDiscoveryDone(true)
        setModuleStatus(statusRes.modules || [])

        // All steps done when action_plan file exists
        const allDone = (statusRes.modules || []).find(m => m.module === 'action_plan')?.exists
        if (allDone) {
          clearInterval(pollRef.current)
          setTimeout(() => { onAdded(slug) }, 1200)
        }
      } catch {}
    }, 3000)
  }

  function getStepState(step, idx) {
    if (step.key === 'discovery') return discoveryDone ? 'done' : loading ? 'running' : 'pending'
    const mod = moduleStatus.find(m => m.module === step.file)
    if (mod?.exists) return 'done'
    // If previous step is done and this one isn't, mark as running
    const prevFile = PIPELINE_STEPS[idx - 1]?.file
    const prevDone = idx === 1 ? discoveryDone : moduleStatus.find(m => m.module === prevFile)?.exists
    return prevDone ? 'running' : 'pending'
  }

  const isInProgress = !!discoverySlug
  const doneCount = PIPELINE_STEPS.filter((s, i) => getStepState(s, i) === 'done').length
  const progressPct = Math.round((doneCount / PIPELINE_STEPS.length) * 100)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: T.surface, borderRadius: 16, padding: 32, width: isInProgress ? 520 : 480, maxWidth: '90vw' }}>
        <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{isInProgress ? 'Running Analysis Pipeline' : 'Add Brand'}</h2>

        {!isInProgress ? (
          <>
            <p style={{ color: T.textMuted, fontSize: 14, marginBottom: 24 }}>Enter the brand's website URL. We'll automatically discover the brand, identify competitors, and run the full analysis pipeline.</p>
            <input
              type="url"
              placeholder="https://www.brandname.com"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 15, marginBottom: 8, boxSizing: 'border-box' }}
              autoFocus
            />
            {error && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={handleAdd} disabled={loading || !url} style={{ flex: 1, background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: loading || !url ? 0.7 : 1 }}>
                {loading ? 'Starting discovery...' : 'Add Brand'}
              </button>
              <button onClick={onClose} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 20px', fontSize: 14, color: T.textSub, cursor: 'pointer' }}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 20 }}>This takes 8–12 minutes. You can close this window — the pipeline continues in the background.</p>

            {/* Progress bar */}
            <div style={{ background: T.surfaceAlt, borderRadius: 8, height: 8, marginBottom: 20, overflow: 'hidden' }}>
              <div style={{ background: T.accent, height: '100%', width: `${progressPct}%`, borderRadius: 8, transition: 'width 0.6s ease' }} />
            </div>

            {/* Steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {PIPELINE_STEPS.map((step, i) => {
                const state = getStepState(step, i)
                const icons = { done: '✓', running: '⟳', pending: '○' }
                const colors = { done: '#059669', running: T.accent, pending: T.textFaint }
                const bgColors = { done: '#d1fae5', running: '#ede9fe', pending: T.surfaceAlt }
                return (
                  <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, background: bgColors[state], transition: 'background 0.4s' }}>
                    <span style={{ fontSize: 16, color: colors[state], fontWeight: 800, width: 20, textAlign: 'center', animation: state === 'running' ? 'spin 1s linear infinite' : 'none' }}>{icons[state]}</span>
                    <span style={{ fontSize: 14, fontWeight: state === 'running' ? 700 : 400, color: state === 'pending' ? T.textFaint : T.text }}>{step.label}</span>
                    {state === 'done' && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#059669', fontWeight: 600 }}>Done</span>}
                    {state === 'running' && <span style={{ marginLeft: 'auto', fontSize: 11, color: T.accent, fontWeight: 600 }}>Running...</span>}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => { onAdded(discoverySlug) }} style={{ flex: 1, background: T.surfaceAlt, color: T.textSub, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
                Open Dashboard Now →
              </button>
              <button onClick={onClose} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 20px', fontSize: 14, color: T.textSub, cursor: 'pointer' }}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Portfolio Tab ──────────────────────────────────────────────────────────────
function PortfolioTab({ brands, onSelectBrand, onAddBrand, onRefresh }) {
  const T = useT()

  if (brands.length === 0) {
    return <EmptyState message="No brands tracked yet. Add your first brand to begin the analysis pipeline." cta="Add Brand" onCta={onAddBrand} />
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
        {brands.map(brand => (
          <Card key={brand.slug}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h3 style={{ color: T.text, fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{brand.name}</h3>
                <p style={{ color: T.textMuted, fontSize: 13 }}>{brand.industry || 'Industry unknown'}</p>
              </div>
              <HealthBadge status={brand.healthStatus} />
            </div>
            <p style={{ color: T.textFaint, fontSize: 12, marginBottom: 16 }}>{brand.url}</p>
            {brand.discoveryStatus === 'running' && (
              <div style={{ background: '#dbeafe', color: '#1e40af', fontSize: 12, padding: '6px 12px', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Pipeline running...
              </div>
            )}
            {brand.discoveryStatus === 'failed' && (
              <div style={{ background: '#fee2e2', color: '#991b1b', fontSize: 12, padding: '6px 12px', borderRadius: 8, marginBottom: 12 }}>
                ⚠ Discovery failed — check brand URL and try again
              </div>
            )}
            {/* Pipeline progress steps */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {PIPELINE_STEPS.map(step => {
                  const mod = brand.moduleStatus?.find(m => m.module === step.file)
                  const done = step.key === 'discovery' ? brand.discoveryStatus === 'complete' : mod?.exists
                  return (
                    <div key={step.key} title={step.label} style={{ flex: 1, height: 4, borderRadius: 2, background: done ? '#6366f1' : T.surfaceAlt, transition: 'background 0.3s' }} />
                  )
                })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PIPELINE_STEPS.slice(1).map(step => {
                  const mod = brand.moduleStatus?.find(m => m.module === step.file)
                  return (
                    <span key={step.key} style={{ fontSize: 10, color: mod?.exists ? '#059669' : T.textFaint, background: mod?.exists ? '#d1fae5' : T.surfaceAlt, padding: '2px 7px', borderRadius: 4, fontWeight: mod?.exists ? 600 : 400 }}>
                      {mod?.exists ? '✓' : '○'} {step.label}
                    </span>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onSelectBrand(brand.slug)} style={{ flex: 1, background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Open</button>
              <button onClick={() => onRefresh(brand.slug)} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 13, color: T.textSub, cursor: 'pointer' }}>↻ Refresh All</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ─── Brand Profile Tab ──────────────────────────────────────────────────────────
function BrandProfileTab({ slug, onRefresh, running }) {
  const T = useT()
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [newCompUrl, setNewCompUrl] = useState('')
  const [newCompName, setNewCompName] = useState('')
  const [guidelines, setGuidelines] = useState(null)
  const [guidelinesRunning, setGuidelinesRunning] = useState(false)
  const [guidelinesLog, setGuidelinesLog] = useState([])

  useEffect(() => {
    if (!slug) return
    fetch(`${API}/brands/${slug}/profile`).then(r => r.json()).then(d => { setData(d); setForm(d) }).catch(() => {})
    fetch(`${API}/brands/${slug}/brand_guidelines`).then(r => r.json()).then(setGuidelines).catch(() => {})
  }, [slug])

  async function processStyleGuide() {
    setGuidelinesRunning(true)
    setGuidelinesLog([])
    const resp = await fetch(`${API}/brands/${slug}/process_style_guide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()
      lines.forEach(line => {
        if (line.startsWith('data: ')) {
          const msg = line.slice(6)
          if (msg.startsWith('__DONE__')) {
            const exitOk = msg.includes('exit=0')
            setGuidelinesRunning(false)
            if (exitOk) fetch(`${API}/brands/${slug}/brand_guidelines`).then(r => r.json()).then(setGuidelines).catch(() => {})
          } else {
            setGuidelinesLog(prev => [...prev.slice(-20), msg])
          }
        }
      })
    }
    setGuidelinesRunning(false)
  }

  async function save() {
    setSaving(true)
    await fetch(`${API}/brands/${slug}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setData(form); setEditing(false); setSaving(false)
  }

  async function saveAndReanalyze() {
    setSaving(true)
    await fetch(`${API}/brands/${slug}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setData(form); setEditing(false); setSaving(false)
    onRefresh('competitive_analysis')
    onRefresh('site_intelligence')
    onRefresh('social_intelligence')
  }

  async function addCompetitorAndReanalyze() {
    if (!newCompUrl || !newCompName) return
    const newEntry = { name: newCompName, url: newCompUrl, discoveredAt: new Date().toISOString() }
    const updated = { ...form, identifiedCompetitors: [...(form.identifiedCompetitors || []), newEntry] }
    setForm(updated); setData(updated)
    setNewCompUrl(''); setNewCompName('')
    await fetch(`${API}/brands/${slug}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
    onRefresh('competitive_analysis')
    onRefresh('site_intelligence')
    onRefresh('social_intelligence')
  }

  function removeCompetitor(url) {
    setForm({ ...form, identifiedCompetitors: (form.identifiedCompetitors || []).filter(c => c.url !== url) })
  }

  if (!data) return <Spinner />

  const archetypes = ['The Hero', 'The Caregiver', 'The Explorer', 'The Sage', 'The Creator', 'The Ruler', 'The Jester', 'The Lover', 'The Outlaw', 'The Magician', 'The Everyman', 'The Innocent']

  return (
    <div style={{ maxWidth: 800 }}>
      {running && <RunningBanner moduleLabel="Analysis" detail="Competitor scraping and analysis is running. Competitive, Website, and Social tabs will update when complete." />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700 }}>Brand Profile</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {editing
            ? <><button onClick={saveAndReanalyze} disabled={saving || running} style={{ background: running ? '#a5b4fc' : '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: saving || running ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving...' : 'Save & Re-analyze'}</button>
                <button onClick={save} disabled={saving} style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Saving...' : 'Save Changes'}</button>
                <button onClick={() => { setEditing(false); setForm(data) }} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 13, color: T.textSub, cursor: 'pointer' }}>Cancel</button></>
            : <><button onClick={() => setEditing(true)} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 13, color: T.textSub, cursor: 'pointer' }}>Edit</button>
                <RefreshButton onClick={() => onRefresh('competitive_analysis')} loading={running} label="Re-discover" /></>
          }
        </div>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[['Brand Name', 'name'], ['Website URL', 'url'], ['Industry', 'industry'], ['Tagline', 'tagline']].map(([label, key]) => (
            <div key={key}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>{label}</label>
              {editing && key !== 'url'
                ? <input value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 14, boxSizing: 'border-box' }} />
                : <p style={{ color: T.text, fontSize: 14, marginTop: 2 }}>{data[key] || <span style={{ color: T.textFaint }}>Not set</span>}</p>
              }
            </div>
          ))}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Positioning</label>
            {editing
              ? <textarea value={form.positioning || ''} onChange={e => setForm({ ...form, positioning: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
              : <p style={{ color: T.text, fontSize: 14 }}>{data.positioning || <span style={{ color: T.textFaint }}>Not set</span>}</p>
            }
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Brand Archetype</label>
            {editing
              ? <select value={form.brandArchetype || ''} onChange={e => setForm({ ...form, brandArchetype: e.target.value })} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 14 }}>
                  <option value="">Select...</option>
                  {archetypes.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              : <p style={{ color: T.text, fontSize: 14 }}>{data.brandArchetype || <span style={{ color: T.textFaint }}>Not set</span>}</p>
            }
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Social Handles</label>
            {editing
              ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <input placeholder="Instagram handle" value={form.social?.instagram || ''} onChange={e => setForm({ ...form, social: { ...form.social, instagram: e.target.value } })} style={{ flex: 1, minWidth: 160, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
                  <input placeholder="TikTok handle" value={form.social?.tiktok || ''} onChange={e => setForm({ ...form, social: { ...form.social, tiktok: e.target.value } })} style={{ flex: 1, minWidth: 160, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
                  <input placeholder="Facebook page handle" value={form.social?.facebook || ''} onChange={e => setForm({ ...form, social: { ...form.social, facebook: e.target.value } })} style={{ flex: 1, minWidth: 160, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
                  <input placeholder="Twitter/X handle" value={form.social?.twitter || ''} onChange={e => setForm({ ...form, social: { ...form.social, twitter: e.target.value } })} style={{ flex: 1, minWidth: 160, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
                </div>
              : <p style={{ color: T.text, fontSize: 14 }}>
                  {[
                    data.social?.instagram ? `@${data.social.instagram} (IG)` : '',
                    data.social?.tiktok ? `@${data.social.tiktok} (TT)` : '',
                    data.social?.facebook ? `${data.social.facebook} (FB)` : '',
                    data.social?.twitter ? `@${data.social.twitter} (X)` : '',
                  ].filter(Boolean).join(' · ') || <span style={{ color: T.textFaint }}>Not set</span>}
                </p>
            }
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>Identified Competitors ({(form.identifiedCompetitors || []).length})</h3>
          {!editing && <p style={{ color: T.textFaint, fontSize: 12 }}>Edit URLs/handles above, then click Save & Re-analyze to re-scrape with corrected data.</p>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                {['Competitor', 'Website URL', 'Instagram', 'TikTok', 'Facebook', editing ? 'Remove' : ''].filter(Boolean).map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(editing ? form : data).identifiedCompetitors?.map((c, idx) => (
                <tr key={c.url || idx} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: T.text, minWidth: 140 }}>
                    {editing
                      ? <input value={c.name} onChange={e => { const comps = [...form.identifiedCompetitors]; comps[idx] = { ...c, name: e.target.value }; setForm({ ...form, identifiedCompetitors: comps }) }} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
                      : c.name
                    }
                  </td>
                  <td style={{ padding: '10px 12px', color: T.textMuted, minWidth: 200 }}>
                    {editing
                      ? <input value={c.url || ''} onChange={e => { const comps = [...form.identifiedCompetitors]; comps[idx] = { ...c, url: e.target.value }; setForm({ ...form, identifiedCompetitors: comps }) }} placeholder="https://..." style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 12 }} />
                      : <a href={c.url} target="_blank" rel="noreferrer" style={{ color: T.accent, textDecoration: 'none', fontSize: 12 }}>{c.url?.replace(/^https?:\/\/(www\.)?/, '') || '—'}</a>
                    }
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 140 }}>
                    {editing
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: T.textMuted, fontSize: 13 }}>@</span>
                          <input value={c.instagramHandle || ''} onChange={e => { const comps = [...form.identifiedCompetitors]; comps[idx] = { ...c, instagramHandle: e.target.value.replace(/^@/, '') }; setForm({ ...form, identifiedCompetitors: comps }) }} placeholder="handle" style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 12 }} />
                        </div>
                      : c.instagramHandle
                          ? <a href={`https://instagram.com/${c.instagramHandle}`} target="_blank" rel="noreferrer" style={{ color: T.accent, textDecoration: 'none', fontSize: 12 }}>@{c.instagramHandle}</a>
                          : <span style={{ color: T.textFaint, fontSize: 12 }}>Not set</span>
                    }
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 130 }}>
                    {editing
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: T.textMuted, fontSize: 13 }}>@</span>
                          <input value={c.tiktokHandle || ''} onChange={e => { const comps = [...form.identifiedCompetitors]; comps[idx] = { ...c, tiktokHandle: e.target.value.replace(/^@/, '') }; setForm({ ...form, identifiedCompetitors: comps }) }} placeholder="handle" style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 12 }} />
                        </div>
                      : c.tiktokHandle
                          ? <a href={`https://tiktok.com/@${c.tiktokHandle}`} target="_blank" rel="noreferrer" style={{ color: T.accent, textDecoration: 'none', fontSize: 12 }}>@{c.tiktokHandle}</a>
                          : <span style={{ color: T.textFaint, fontSize: 12 }}>Not set</span>
                    }
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 130 }}>
                    {editing
                      ? <input value={c.facebookHandle || ''} onChange={e => { const comps = [...form.identifiedCompetitors]; comps[idx] = { ...c, facebookHandle: e.target.value }; setForm({ ...form, identifiedCompetitors: comps }) }} placeholder="page handle" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 12 }} />
                      : c.facebookHandle
                          ? <a href={`https://facebook.com/${c.facebookHandle}`} target="_blank" rel="noreferrer" style={{ color: T.accent, textDecoration: 'none', fontSize: 12 }}>{c.facebookHandle}</a>
                          : <span style={{ color: T.textFaint, fontSize: 12 }}>Not set</span>
                    }
                  </td>
                  {editing && (
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={() => removeCompetitor(c.url)} style={{ background: 'none', border: `1px solid #fca5a5`, borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '4px 10px' }}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
          <input placeholder="Competitor name" value={newCompName} onChange={e => setNewCompName(e.target.value)} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
          <input placeholder="https://www.competitor.com" value={newCompUrl} onChange={e => setNewCompUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCompetitorAndReanalyze()} style={{ flex: 2, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
          <button onClick={addCompetitorAndReanalyze} disabled={!newCompName || !newCompUrl || running} style={{ background: running ? '#a5b4fc' : '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: (!newCompName || !newCompUrl || running) ? 'not-allowed' : 'pointer', opacity: (!newCompName || !newCompUrl || running) ? 0.5 : 1 }}>{running ? 'Running...' : 'Add & Re-analyze'}</button>
        </div>
      </Card>

      {/* ── Brand Guidelines ── */}
      <Card style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>Brand Guidelines</h3>
            <p style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>Processed from your style guide PDF — informs all audit recommendations.</p>
          </div>
          <button onClick={processStyleGuide} disabled={guidelinesRunning} style={{ background: guidelinesRunning ? T.surfaceAlt : T.accent, color: guidelinesRunning ? T.textMuted : '#fff', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: guidelinesRunning ? 'not-allowed' : 'pointer' }}>
            {guidelinesRunning ? 'Processing…' : guidelines ? 'Reprocess Style Guide' : 'Process Style Guide'}
          </button>
        </div>

        {guidelinesLog.length > 0 && (
          <div style={{ background: T.surfaceAlt, borderRadius: 8, padding: '10px 14px', marginBottom: 14, maxHeight: 140, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, color: T.textSub }}>
            {guidelinesLog.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}

        {!guidelines && !guidelinesRunning && (
          <div style={{ background: T.surfaceAlt, borderRadius: 8, padding: '16px 18px', textAlign: 'center' }}>
            <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 8 }}>No style guide processed yet.</p>
            <p style={{ color: T.textFaint, fontSize: 12 }}>Place your PDF at <code style={{ background: T.border, padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>data/brands/{slug}/style_guide.pdf</code> then click "Process Style Guide" above.</p>
            <p style={{ color: T.textFaint, fontSize: 12, marginTop: 4 }}>Or the script will check <code style={{ background: T.border, padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>~/Downloads/ToysRUs_2026_HolidayTentpoles Style Guide.pdf</code> automatically.</p>
          </div>
        )}

        {guidelines && (
          <div>
            {guidelines.extractionNote && <p style={{ color: T.textFaint, fontSize: 11, marginBottom: 12, fontStyle: 'italic' }}>{guidelines.extractionNote}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {guidelines.brandVoice?.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Brand Voice</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {guidelines.brandVoice.map(v => <span key={v} style={{ background: '#ede9fe', color: '#5b21b6', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{v}</span>)}
                  </div>
                </div>
              )}
              {guidelines.messagingPillars?.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Messaging Pillars</p>
                  <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                    {guidelines.messagingPillars.map((p, i) => <li key={i} style={{ fontSize: 12, color: T.textSub, marginBottom: 4 }}>{p}</li>)}
                  </ul>
                </div>
              )}
              {guidelines.tentpoles?.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Campaign Tentpoles</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {guidelines.tentpoles.map(t => <span key={t.name} style={{ background: '#fef3c7', color: '#92400e', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{t.name}</span>)}
                  </div>
                </div>
              )}
              {guidelines.targetAudience && guidelines.targetAudience !== 'Not specified' && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Target Audience</p>
                  <p style={{ fontSize: 12, color: T.textSub }}>{guidelines.targetAudience}</p>
                </div>
              )}
              {(guidelines.doList?.length > 0 || guidelines.dontList?.length > 0) && (
                <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {guidelines.doList?.length > 0 && (
                    <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Always Do</p>
                      <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                        {guidelines.doList.map((d, i) => <li key={i} style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>{d}</li>)}
                      </ul>
                    </div>
                  )}
                  {guidelines.dontList?.length > 0 && (
                    <div style={{ background: '#fff1f2', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#9f1239', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Never Do</p>
                      <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                        {guidelines.dontList.map((d, i) => <li key={i} style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>{d}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {guidelines.visualDirection && guidelines.visualDirection !== 'Not specified' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Visual Direction</p>
                  <p style={{ fontSize: 12, color: T.textSub }}>{guidelines.visualDirection}</p>
                </div>
              )}
            </div>
            <p style={{ fontSize: 11, color: T.textFaint, marginTop: 14 }}>Processed from {guidelines.sourceFile} on {new Date(guidelines.processedAt).toLocaleDateString()}</p>
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Competitive Analysis Tab ───────────────────────────────────────────────────
function CompetitiveTab({ slug, onRefresh, running, dataVersion }) {
  const T = useT()
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!slug) return
    fetch(`${API}/brands/${slug}/competitive_analysis`).then(r => r.json()).then(setData).catch(() => {})
  }, [slug, dataVersion])

  if (!data) return <EmptyState message="Competitive analysis not yet generated." cta="Run Competitive Analysis" onCta={() => onRefresh('competitive_analysis')} />

  const pricingColors = { budget: 'green', mid: 'blue', premium: 'purple', luxury: 'red' }

  return (
    <div>
      {running && <RunningBanner moduleLabel="Competitive Analysis" detail="Scraping competitor sites and analyzing strengths, opportunities, and positioning with Claude." />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700 }}>Competitive Analysis</h2>
        <RefreshButton onClick={() => onRefresh('competitive_analysis')} loading={running} />
      </div>

      {data.positioningMap?.narrative && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Positioning Landscape</h3>
          <p style={{ color: T.textSub, fontSize: 14, lineHeight: 1.7 }}>{data.positioningMap.narrative}</p>
          {data.positioningMap.whiteSpaceOpportunities?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>White Space Opportunities</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {data.positioningMap.whiteSpaceOpportunities.map((o, i) => (
                  <span key={i} style={{ background: '#ede9fe', color: '#5b21b6', fontSize: 12, padding: '4px 12px', borderRadius: 20 }}>{o}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {data.topAssortmentGaps?.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Top Assortment Gaps</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.topAssortmentGaps.map((g, i) => (
              <span key={i} style={{ background: '#fef3c7', color: '#92400e', fontSize: 12, padding: '4px 12px', borderRadius: 20 }}>{g}</span>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
        {(data.competitors || []).map(comp => (
          <Card key={comp.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ color: T.text, fontSize: 16, fontWeight: 700 }}>{comp.name}</h3>
                <p style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>{comp.url}</p>
              </div>
              <Badge label={comp.pricingTier || 'mid'} color={pricingColors[comp.pricingTier] || 'gray'} />
            </div>
            {comp.positioningStatement && <p style={{ color: T.textSub, fontSize: 13, fontStyle: 'italic', marginBottom: 12, borderLeft: `3px solid ${T.accent}`, paddingLeft: 10 }}>{comp.positioningStatement}</p>}
            {comp.botBlocked && <div style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, padding: '4px 10px', borderRadius: 6, marginBottom: 10 }}>⚠ Bot-protected — limited data</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#065f46', marginBottom: 6, textTransform: 'uppercase' }}>Strengths</p>
                <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                  {(comp.strengths || []).map((s, i) => <li key={i} style={{ fontSize: 13, color: T.textSub, marginBottom: 4, lineHeight: 1.4 }}>{s}</li>)}
                </ul>
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 6, textTransform: 'uppercase' }}>Opportunities</p>
                <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                  {(comp.opportunities || []).map((o, i) => <li key={i} style={{ fontSize: 13, color: T.textSub, marginBottom: 4, lineHeight: 1.4 }}>{o}</li>)}
                </ul>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ─── Personas Tab ───────────────────────────────────────────────────────────────
function PersonasTab({ slug, onRefresh, running, dataVersion }) {
  const T = useT()
  const [data, setData] = useState(null)
  const [activePersona, setActivePersona] = useState(0)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => {
    if (!slug) return
    fetch(`${API}/brands/${slug}/personas`).then(r => r.json()).then(d => { setData(d); setActivePersona(0); setChatMessages([]) }).catch(() => {})
  }, [slug, dataVersion])

  useEffect(() => {
    if (chatMessages.length > 0) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  async function sendChat() {
    if (!chatInput.trim() || streaming) return
    const userMsg = { role: 'user', content: chatInput }
    setChatMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', streaming: true }])
    setChatInput(''); setStreaming(true)

    const res = await fetch(`${API}/brands/${slug}/persona-chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaIndex: activePersona, messages: [...chatMessages, userMsg] }),
    })
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let text = ''
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      for (const line of decoder.decode(value).split('\n')) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6)
          if (payload === '[DONE]') break
          try { const { token } = JSON.parse(payload); text += token; setChatMessages(prev => { const msgs = [...prev]; msgs[msgs.length - 1] = { role: 'assistant', content: text }; return msgs }) } catch {}
        }
      }
    }
    setStreaming(false)
  }

  async function loadSuggestions() {
    setLoadingSuggestions(true)
    const res = await fetch(`${API}/brands/${slug}/suggest-personas`, { method: 'POST' })
    const d = await res.json(); setSuggestions(d.suggestions || []); setLoadingSuggestions(false)
  }

  if (!data) return <EmptyState message="Personas not yet generated." cta="Generate Personas" onCta={() => onRefresh('personas')} />

  const persona = data.personas?.[activePersona]

  return (
    <div>
      {running && <RunningBanner moduleLabel="Customer Personas" detail="Generating personas from competitive, social, and site intelligence using Claude Opus." />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700 }}>Customer Personas</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={loadSuggestions} disabled={loadingSuggestions} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 14px', fontSize: 13, color: T.textSub, cursor: 'pointer' }}>{loadingSuggestions ? 'Analyzing...' : '+ Suggest Adjacent'}</button>
          <RefreshButton onClick={() => onRefresh('personas')} loading={running} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {data.personas?.map((p, i) => (
          <button key={i} onClick={() => { setActivePersona(i); setChatMessages([]) }} style={{ padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: i === activePersona ? 700 : 400, background: i === activePersona ? T.accent : T.surfaceAlt, color: i === activePersona ? '#fff' : T.textSub, border: 'none', cursor: 'pointer' }}>
            {p.name}
          </button>
        ))}
      </div>

      {persona && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <Card style={{ marginBottom: 20 }}>
              <h3 style={{ color: T.accent, fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{persona.name}</h3>
              <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>{persona.ageRange} · {persona.income} · {persona.location}</p>
              <p style={{ fontSize: 13, color: T.textSub, fontStyle: 'italic', marginBottom: 16, borderLeft: `3px solid ${T.accent}`, paddingLeft: 10 }}>"{persona.quoteExample}"</p>
              {[['Occupation', persona.occupation], ['Lifestyle', persona.lifestyle], ['Values', persona.values], ['Fashion Goals', persona.fashionGoals], ['Pain Points', persona.painPoints], ['Motivators', persona.motivators]].map(([label, items]) => items?.length ? (
                <div key={label} style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>{label}</p>
                  <p style={{ fontSize: 13, color: T.textSub }}>
                    {Array.isArray(items) ? items.join(' · ') : items}
                  </p>
                </div>
              ) : null)}
              {persona.brandFit && (
                <div style={{ marginTop: 12, background: '#ede9fe', borderRadius: 8, padding: '10px 14px' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#5b21b6', marginBottom: 4 }}>Brand Fit</p>
                  <p style={{ fontSize: 13, color: '#4c1d95' }}>{persona.brandFit}</p>
                </div>
              )}
            </Card>
          </div>

          <div style={{ position: 'sticky', top: 80, alignSelf: 'flex-start' }}>
            <Card style={{ display: 'flex', flexDirection: 'column', maxHeight: 480 }}>
              <div style={{ marginBottom: 12 }}>
                <h3 style={{ color: T.text, fontSize: 14, fontWeight: 700 }}>Chat with {persona.name}</h3>
                <p style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>Ask about shopping habits, preferences, or brand reactions.</p>
              </div>
              <div style={{ flex: 1, height: 300, overflowY: 'auto', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
                {chatMessages.length === 0 && <p style={{ color: T.textFaint, fontSize: 13, textAlign: 'center', marginTop: 60 }}>Start a conversation...</p>}
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', background: msg.role === 'user' ? T.accent : T.surfaceAlt, color: msg.role === 'user' ? '#fff' : T.text, padding: '8px 12px', borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px', fontSize: 13, lineHeight: 1.5, border: msg.role === 'assistant' ? `1px solid ${T.border}` : 'none' }}>
                    {msg.content || (msg.streaming ? <span style={{ opacity: 0.4 }}>●</span> : '')}{msg.streaming && msg.content && <span style={{ opacity: 0.4 }}> ●</span>}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder={`Ask ${persona.name}...`} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
                <button onClick={sendChat} disabled={streaming || !chatInput.trim()} style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: streaming || !chatInput.trim() ? 0.6 : 1 }}>Send</button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {suggestions && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ color: T.text, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Adjacent Segments to Consider</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {suggestions.map((s, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <h4 style={{ color: T.text, fontSize: 14, fontWeight: 700 }}>{s.name}</h4>
                  <Badge label={s.opportunitySize} color={s.opportunitySize === 'high' ? 'red' : s.opportunitySize === 'medium' ? 'yellow' : 'green'} />
                </div>
                <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 8 }}>{s.ageRange} · {s.income}</p>
                <p style={{ fontSize: 13, color: T.textSub, marginBottom: 8 }}>{s.rationale}</p>
                <p style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>{s.keyDifference}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Social Audit Tab ───────────────────────────────────────────────────────────
function SocialAuditTab({ slug, onRefresh, running, dataVersion }) {
  const T = useT()
  const [data, setData] = useState(null)
  const [expandedBrand, setExpandedBrand] = useState(null)
  const [platformTab, setPlatformTab] = useState('instagram')

  useEffect(() => {
    if (!slug) return
    fetch(`${API}/brands/${slug}/social_intelligence`).then(r => r.json()).then(setData).catch(() => {})
  }, [slug, dataVersion])

  function Sparkline({ data: points, width = 120, height = 36 }) {
    if (!points?.length || points.length < 2) return <span style={{ color: T.textFaint, fontSize: 11 }}>—</span>
    const values = points.map(p => p.avgEngagement)
    const max = Math.max(...values) || 1
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - (v / max) * (height - 4) - 2}`).join(' ')
    return <svg width={width} height={height} style={{ overflow: 'visible', display: 'block' }}><polyline points={pts} fill="none" stroke={T.accent} strokeWidth={2} strokeLinejoin="round" /></svg>
  }

  function relativeTime(iso) {
    if (!iso) return ''
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 60) return `${m || 1}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d}d ago`
    const mo = Math.floor(d / 30)
    if (mo < 12) return `${mo}mo ago`
    return `${Math.floor(mo / 12)}y ago`
  }

  const GRAD_PAIRS = [
    ['#f97316', '#ec4899'], ['#6366f1', '#8b5cf6'], ['#0ea5e9', '#14b8a6'],
    ['#f59e0b', '#ef4444'], ['#10b981', '#3b82f6'], ['#a855f7', '#ec4899'],
    ['#06b6d4', '#6366f1'], ['#84cc16', '#0ea5e9'],
  ]

  function InstagramCard({ post, brandName, handle, brandIdx = 0 }) {
    const engagement = (post.likes || 0) + (post.comments || 0)
    const initial = (brandName || handle || 'B')[0].toUpperCase()
    const [g1, g2] = GRAD_PAIRS[brandIdx % GRAD_PAIRS.length]
    return (
      <div style={{ width: 240, minWidth: 240, background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg, ${g1}, ${g2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{initial}</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{handle ? `@${handle}` : brandName}</span>
          <span style={{ fontSize: 16, color: T.textFaint, letterSpacing: 1 }}>···</span>
        </div>
        {/* Image area */}
        <div style={{ width: '100%', aspectRatio: '1/1', background: `linear-gradient(135deg, ${g1}22, ${g2}22)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          {post.imageUrl
            ? <img src={post.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />
            : <span style={{ fontSize: 52, fontWeight: 900, color: `${g1}55`, userSelect: 'none' }}>{initial}</span>
          }
          {engagement > 0 && <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12 }}>{engagement >= 1000 ? `${(engagement/1000).toFixed(1)}k` : engagement}</span>}
        </div>
        {/* Engagement row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px 4px' }}>
          <span style={{ fontSize: 12, color: T.text }}>♥ {(post.likes || 0).toLocaleString()}</span>
          <span style={{ fontSize: 12, color: T.text }}>💬 {(post.comments || 0).toLocaleString()}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textFaint }}>{relativeTime(post.timestamp)}</span>
        </div>
        {/* Caption */}
        <div style={{ padding: '0 12px 10px' }}>
          <p style={{ fontSize: 12, color: T.textSub, lineHeight: 1.5, margin: 0 }}>
            {post.caption
              ? <>{brandName && <strong style={{ color: T.text }}>{handle || brandName} </strong>}{post.caption.slice(0, 100)}{post.caption.length > 100 ? '…' : ''}</>
              : <span style={{ color: T.textFaint, fontStyle: 'italic' }}>No caption</span>}
          </p>
          {post.postUrl && <a href={post.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.accent, textDecoration: 'none', display: 'block', marginTop: 4 }}>View post ↗</a>}
        </div>
      </div>
    )
  }

  const THEME_COLORS = ['#dbeafe', '#d1fae5', '#ede9fe', '#fef3c7', '#fee2e2', '#f0fdf4', '#fdf4ff']
  const THEME_TEXT   = ['#1e40af', '#065f46', '#5b21b6', '#92400e', '#991b1b', '#14532d', '#7e22ce']
  const PLATFORM_LABELS = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' }
  const FORMAT_COLORS = { Reels: '#ede9fe', Carousel: '#dbeafe', Story: '#d1fae5', Video: '#fef3c7', Post: '#f0fdf4' }
  const FORMAT_TEXT   = { Reels: '#5b21b6', Carousel: '#1e40af', Story: '#065f46', Video: '#92400e', Post: '#14532d' }
  // Brand colors for share-of-engagement bars (target always purple)
  const BRAND_BAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316']

  if (!data) return <EmptyState message="Social audit not yet generated." cta="Run Social Audit" onCta={() => onRefresh('social_intelligence')} />

  const target = data.brands?.find(b => b.role === 'target')
  const competitors = data.brands?.filter(b => b.role === 'competitor') || []
  const allBrands = data.brands || []

  // Platform availability
  const hasTiktok = allBrands.some(b => b.tiktokData)
  const hasFacebook = allBrands.some(b => b.facebookData)
  const availablePlatforms = ['instagram', hasTiktok && 'tiktok', hasFacebook && 'facebook'].filter(Boolean)

  function getPlatformData(brand, platform) {
    if (platform === 'tiktok') return brand.tiktokData || null
    if (platform === 'facebook') return brand.facebookData || null
    return { summary: brand.summary, topPosts: brand.topPosts || [], contentThemes: brand.contentThemes, monthlyTrend: brand.monthlyTrend }
  }

  function getPlatformHandle(brand, platform) {
    if (platform === 'tiktok') return brand.tiktokHandle ? { label: `@${brand.tiktokHandle}`, url: `https://tiktok.com/@${brand.tiktokHandle}` } : null
    if (platform === 'facebook') return brand.facebookHandle ? { label: brand.facebookHandle, url: `https://facebook.com/${brand.facebookHandle}` } : null
    return brand.handle ? { label: `@${brand.handle}`, url: `https://instagram.com/${brand.handle}` } : null
  }

  // Build leaderboard: all brands ranked by avg engagement on current platform
  const leaderboard = allBrands
    .map(b => ({ b, pd: getPlatformData(b, platformTab), isTarget: b.role === 'target' }))
    .filter(x => x.pd?.summary?.avgEngagement > 0)
    .sort((a, b) => b.pd.summary.avgEngagement - a.pd.summary.avgEngagement)

  const targetRank = leaderboard.findIndex(x => x.isTarget) + 1
  const leader = leaderboard[0]
  const targetPd = target ? getPlatformData(target, platformTab) : null
  const targetAvgEng = targetPd?.summary?.avgEngagement || 0

  // Share of engagement: total engagement = sum of (avgEngagement * postCount) per brand
  const engScores = allBrands.map(b => {
    const pd = getPlatformData(b, platformTab)
    return { b, score: (pd?.summary?.avgEngagement || 0) * (pd?.summary?.postCount || 1) }
  }).filter(x => x.score > 0)
  const totalEngScore = engScores.reduce((s, x) => s + x.score, 0)

  // Market KPI: avg competitor posting frequency
  const compFreqs = competitors.map(c => getPlatformData(c, platformTab)?.summary?.postingFrequencyPerWeek || 0).filter(v => v > 0)
  const avgCompFreq = compFreqs.length > 0 ? (compFreqs.reduce((s, v) => s + v, 0) / compFreqs.length).toFixed(1) : null
  const targetFreq = targetPd?.summary?.postingFrequencyPerWeek || 0

  // Best platform for target (most engagement)
  const platformEngScores = availablePlatforms.map(p => ({ p, eng: getPlatformData(target, p)?.summary?.avgEngagement || 0 }))
  const bestPlatform = platformEngScores.sort((a, b) => b.eng - a.eng)[0]

  function splitGapCard(text) {
    const dashIdx = text.indexOf(' — ')
    const colonIdx = text.search(/:\s/)
    const periodIdx = text.indexOf('. ')
    const splitAt = [dashIdx, colonIdx, periodIdx].filter(i => i > 10 && i < text.length - 10).sort((a, b) => a - b)[0]
    if (splitAt !== undefined) return [text.slice(0, splitAt).replace(/[:—]\s*$/, ''), text.slice(splitAt).replace(/^[—:\s.]+/, '')]
    return [text.slice(0, 80), text.slice(80)]
  }

  return (
    <div>
      {running && <RunningBanner moduleLabel="Social Media Audit" detail="Scraping Instagram, TikTok, and Facebook via Apify — detecting handles, analyzing themes, engagement, and gaps." />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700 }}>Social Intelligence</h2>
        <RefreshButton onClick={() => onRefresh('social_intelligence')} loading={running} />
      </div>

      {/* Platform tabs */}
      {availablePlatforms.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {availablePlatforms.map(p => (
            <button key={p} onClick={() => { setPlatformTab(p); setExpandedBrand(null) }} style={{ padding: '7px 18px', borderRadius: 20, fontSize: 13, fontWeight: platformTab === p ? 700 : 400, background: platformTab === p ? T.accent : T.surfaceAlt, color: platformTab === p ? '#fff' : T.textSub, border: platformTab === p ? 'none' : `1px solid ${T.border}`, cursor: 'pointer' }}>
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      )}

      {/* ── Section 1: Market Intelligence KPIs ── */}
      {(leader || targetRank > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          {/* Market Leader */}
          <Card style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Market Leader</p>
            {leader ? (
              <>
                <p style={{ fontSize: 16, fontWeight: 800, color: leader.isTarget ? T.accent : T.text, lineHeight: 1.2 }}>{leader.b.name}{leader.isTarget ? ' ★' : ''}</p>
                <p style={{ fontSize: 13, color: T.textSub, marginTop: 4 }}>{leader.pd.summary.avgEngagement.toLocaleString()} avg eng</p>
                {leader.isTarget && <p style={{ fontSize: 11, color: '#059669', fontWeight: 600, marginTop: 4 }}>You lead this market</p>}
              </>
            ) : <p style={{ color: T.textFaint, fontSize: 13 }}>No data yet</p>}
          </Card>
          {/* Your Rank */}
          <Card style={{ padding: '16px 18px', background: targetRank === 1 ? '#f0fdf4' : targetRank > 0 && targetRank <= 3 ? '#fefce8' : T.surface, border: targetRank === 1 ? '1px solid #86efac' : `1px solid ${T.border}` }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Your Rank</p>
            {targetRank > 0 ? (
              <>
                <p style={{ fontSize: 28, fontWeight: 900, color: targetRank === 1 ? '#059669' : targetRank <= 3 ? '#d97706' : T.text, lineHeight: 1 }}>#{targetRank}</p>
                <p style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}>of {leaderboard.length} brands on {PLATFORM_LABELS[platformTab]}</p>
                {leader && !leader.isTarget && targetAvgEng > 0 && <p style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{(leader.pd.summary.avgEngagement / targetAvgEng).toFixed(1)}× behind leader</p>}
              </>
            ) : (
              <>
                <p style={{ fontSize: 15, fontWeight: 700, color: T.textFaint }}>Unranked</p>
                <p style={{ fontSize: 12, color: T.textFaint, marginTop: 4 }}>No {PLATFORM_LABELS[platformTab]} data</p>
              </>
            )}
          </Card>
          {/* Best Platform for You */}
          <Card style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Best Platform</p>
            {bestPlatform?.eng > 0 ? (
              <>
                <p style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{PLATFORM_LABELS[bestPlatform.p]}</p>
                <p style={{ fontSize: 13, color: T.textSub, marginTop: 4 }}>{bestPlatform.eng.toLocaleString()} avg engagement</p>
              </>
            ) : (
              <p style={{ fontSize: 13, color: T.textFaint }}>Run audit to see</p>
            )}
          </Card>
          {/* Posting Frequency vs Market */}
          <Card style={{ padding: '16px 18px', background: avgCompFreq && targetFreq < parseFloat(avgCompFreq) ? '#fff7ed' : T.surface, border: avgCompFreq && targetFreq < parseFloat(avgCompFreq) ? '1px solid #fed7aa' : `1px solid ${T.border}` }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Posting Frequency</p>
            {avgCompFreq ? (
              <>
                <p style={{ fontSize: 22, fontWeight: 800, color: T.text, lineHeight: 1 }}>{targetFreq || '—'}<span style={{ fontSize: 12, fontWeight: 400, color: T.textMuted }}>/wk</span></p>
                <p style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}>vs {avgCompFreq}/wk competitor avg</p>
                {targetFreq > 0 && targetFreq < parseFloat(avgCompFreq) && (
                  <p style={{ fontSize: 11, color: '#c2410c', fontWeight: 600, marginTop: 4 }}>Below market average</p>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: T.textFaint }}>No frequency data</p>
            )}
          </Card>
        </div>
      )}

      {/* ── Section 2: Competitive Leaderboard ── */}
      {leaderboard.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Market Leaderboard — {PLATFORM_LABELS[platformTab]}</h3>
          <p style={{ color: T.textMuted, fontSize: 12, marginBottom: 16 }}>All brands ranked by average engagement. Click any row to see their top posts.</p>
          <div style={{ overflowX: 'auto' }}>
            {leaderboard.map(({ b, pd, isTarget }, idx) => {
              const isOpen = expandedBrand === b.id
              const postsToShow = pd?.topPosts?.length > 0 ? pd.topPosts : (platformTab === 'instagram' ? b.recentPosts || [] : [])
              const handle = getPlatformHandle(b, platformTab)
              const maxEng = leaderboard[0]?.pd?.summary?.avgEngagement || 1
              const barPct = Math.round((pd.summary.avgEngagement / maxEng) * 100)
              return (
                <div key={b.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <button
                    onClick={() => setExpandedBrand(isOpen ? null : b.id)}
                    style={{ width: '100%', background: isTarget ? (isOpen ? '#ede9fe' : '#f5f3ff') : isOpen ? T.surfaceAlt : 'transparent', border: 'none', padding: '12px 16px', cursor: 'pointer', textAlign: 'left', display: 'grid', gridTemplateColumns: '32px 160px 1fr 90px 90px 80px 24px', alignItems: 'center', gap: 12 }}
                  >
                    {/* Rank */}
                    <span style={{ fontSize: 14, fontWeight: 800, color: idx === 0 ? '#d97706' : idx === 1 ? '#9ca3af' : idx === 2 ? '#b45309' : T.textMuted, textAlign: 'center' }}>
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                    </span>
                    {/* Name */}
                    <span style={{ fontWeight: isTarget ? 800 : 600, fontSize: 13, color: isTarget ? T.accent : T.text, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {b.name}{isTarget && <span style={{ fontSize: 10, background: T.accent, color: '#fff', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>YOU</span>}
                    </span>
                    {/* Engagement bar */}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: T.border, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: isTarget ? T.accent : '#0ea5e9', borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.text, minWidth: 50, textAlign: 'right' }}>{pd.summary.avgEngagement.toLocaleString()}</span>
                    </span>
                    {/* Posts/week */}
                    <span style={{ fontSize: 12, color: T.textSub, textAlign: 'center' }}>
                      {pd.summary.postingFrequencyPerWeek ? `${pd.summary.postingFrequencyPerWeek}/wk` : '—'}
                    </span>
                    {/* Handle */}
                    <span>
                      {handle
                        ? <a href={handle.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: T.accent, fontSize: 11, textDecoration: 'none' }}>{handle.label} ↗</a>
                        : <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>No handle</span>}
                    </span>
                    {/* Trend sparkline */}
                    <span><Sparkline data={pd.monthlyTrend} width={70} height={22} /></span>
                    <span style={{ fontSize: 14, color: T.textMuted }}>{isOpen ? '▲' : '▼'}</span>
                  </button>
                  {/* Expanded posts panel */}
                  {isOpen && (
                    <div style={{ padding: '8px 16px 16px', background: isTarget ? '#f5f3ff' : T.surfaceAlt }}>
                      {pd.contentThemes?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                          {pd.contentThemes.slice(0, 4).map((t, i) => (
                            <span key={t.theme} style={{ background: THEME_COLORS[i % THEME_COLORS.length], color: THEME_TEXT[i % THEME_TEXT.length], fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
                              {t.theme} × {t.count}
                            </span>
                          ))}
                        </div>
                      )}
                      {postsToShow.length > 0 ? (
                        <>
                          <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Top Posts</p>
                          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
                            {postsToShow.slice(0, 3).map((post, i) => <InstagramCard key={i} post={post} brandName={b.name} handle={getPlatformHandle(b, platformTab)?.label?.replace('@', '')} brandIdx={idx} />)}
                          </div>
                        </>
                      ) : (
                        <p style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>
                          {handle ? 'No post data scraped yet — re-run audit.' : `No ${PLATFORM_LABELS[platformTab]} handle set. Add it in Brand Profile → Competitors and re-run.`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p style={{ color: T.textFaint, fontSize: 11, marginTop: 12 }}>Click any row to expand top posts. To edit handles, go to Brand Profile → Competitors.</p>
        </Card>
      )}

      {/* ── Section 3: Share of Engagement ── */}
      {engScores.length > 1 && totalEngScore > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Share of Engagement</h3>
          <p style={{ color: T.textMuted, fontSize: 12, marginBottom: 16 }}>Estimated share based on avg engagement × post volume on {PLATFORM_LABELS[platformTab]}.</p>
          {engScores
            .sort((a, b) => b.score - a.score)
            .map(({ b, score }, i) => {
              const pct = Math.round((score / totalEngScore) * 100)
              const isTarget = b.role === 'target'
              const color = isTarget ? T.accent : BRAND_BAR_COLORS[(i + 1) % BRAND_BAR_COLORS.length]
              return (
                <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 40px', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: isTarget ? 700 : 400, color: isTarget ? T.accent : T.text, textAlign: 'right', paddingRight: 4 }}>
                    {b.name}{isTarget && ' ★'}
                  </span>
                  <div style={{ height: 18, background: T.border, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, minWidth: pct > 0 ? 4 : 0 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textSub }}>{pct}%</span>
                </div>
              )
            })}
        </Card>
      )}

      {/* ── Section 4: Platform Coverage Matrix ── */}
      {allBrands.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Platform Coverage</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', width: 160 }}>Brand</th>
                  {['instagram', 'tiktok', 'facebook'].map(p => (
                    <th key={p} style={{ padding: '10px 16px', textAlign: 'center', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{PLATFORM_LABELS[p]}</th>
                  ))}
                  <th style={{ padding: '10px 16px', textAlign: 'center', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Platforms</th>
                </tr>
              </thead>
              <tbody>
                {[target, ...competitors].filter(Boolean).map(b => {
                  const isTarget = b.role === 'target'
                  const hasIg = !!(b.handle || b.instagramHandle)
                  const hasTt = !!(b.tiktokHandle)
                  const hasFb = !!(b.facebookHandle)
                  const count = [hasIg, hasTt, hasFb].filter(Boolean).length
                  return (
                    <tr key={b.id || b.name} style={{ borderTop: `1px solid ${T.border}`, background: isTarget ? '#f5f3ff' : 'transparent' }}>
                      <td style={{ padding: '10px 16px', fontWeight: isTarget ? 700 : 400, color: isTarget ? T.accent : T.text }}>
                        {b.name}{isTarget && ' ★'}
                      </td>
                      {[hasIg, hasTt, hasFb].map((has, i) => (
                        <td key={i} style={{ padding: '10px 16px', textAlign: 'center' }}>
                          {has
                            ? <span style={{ fontSize: 16, color: '#059669' }}>✓</span>
                            : <span style={{ fontSize: 14, color: T.border }}>✗</span>}
                        </td>
                      ))}
                      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, background: count === 3 ? '#d1fae5' : count === 2 ? '#fef3c7' : '#f3f4f6', color: count === 3 ? '#065f46' : count === 2 ? '#92400e' : '#6b7280', padding: '2px 10px', borderRadius: 12 }}>
                          {count}/3
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Section 5: Competitive Theme Heatmap ── */}
      {allBrands.length > 0 && allBrands.some(b => b.contentThemes?.length > 0) && (() => {
        const ALL_THEMES = ['Product Showcase', 'Lifestyle', 'User Generated', 'Promotional', 'Behind the Scenes', 'Seasonal', 'Brand Story']
        const brandsWithData = allBrands.filter(b => b.contentThemes?.length > 0)
        if (brandsWithData.length === 0) return null
        // Build lookup: brand.id → theme → count
        const themeMap = {}
        brandsWithData.forEach(b => {
          themeMap[b.id] = {}
          b.contentThemes.forEach(t => { themeMap[b.id][t.theme] = t.count })
        })
        return (
          <Card style={{ marginBottom: 24 }}>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Content Theme Coverage</h3>
            <p style={{ color: T.textMuted, fontSize: 12, marginBottom: 16 }}>How many posts each brand publishes per theme. Darker = more content.</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', minWidth: 150 }}>Theme</th>
                    {brandsWithData.map(b => (
                      <th key={b.id} style={{ padding: '8px 8px', textAlign: 'center', color: b.role === 'target' ? T.accent : T.textMuted, fontSize: 11, fontWeight: b.role === 'target' ? 800 : 600, maxWidth: 80 }}>
                        {b.name.slice(0, 10)}{b.role === 'target' ? ' ★' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_THEMES.map(theme => (
                    <tr key={theme} style={{ borderTop: `1px solid ${T.border}` }}>
                      <td style={{ padding: '8px 12px', color: T.textSub, fontSize: 12 }}>{theme}</td>
                      {brandsWithData.map(b => {
                        const count = themeMap[b.id]?.[theme] || 0
                        const isTarget = b.role === 'target'
                        const bg = count === 0 ? 'transparent' : count <= 5 ? (isTarget ? '#ede9fe' : '#dbeafe') : count <= 15 ? (isTarget ? '#c4b5fd' : '#93c5fd') : (isTarget ? '#7c3aed' : '#2563eb')
                        const textColor = count === 0 ? T.textFaint : count <= 15 ? T.text : '#fff'
                        return (
                          <td key={b.id} style={{ padding: '8px 8px', textAlign: 'center', background: bg, fontWeight: count > 0 ? 700 : 400, color: textColor, borderLeft: isTarget ? `2px solid ${T.accent}22` : 'none' }}>
                            {count > 0 ? count : <span style={{ color: T.border }}>—</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      })()}

      {/* ── Section 6: White Space Opportunities ── */}
      {data.whiteSpaceOpportunities?.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Untapped Territory</h3>
          <p style={{ color: T.textMuted, fontSize: 12, marginBottom: 16 }}>Content areas with low competition where you can own the conversation.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {data.whiteSpaceOpportunities.map((opp, i) => (
              <div key={i} style={{ background: T.surfaceAlt, borderRadius: 10, padding: '14px 16px', borderLeft: '3px solid #059669' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: T.text, flex: 1 }}>{opp.theme}</span>
                  {opp.priority === 'high' && <span style={{ fontSize: 10, fontWeight: 700, background: '#dcfce7', color: '#065f46', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>High Priority</span>}
                  {opp.suggestedFormat && <span style={{ fontSize: 10, fontWeight: 700, background: FORMAT_COLORS[opp.suggestedFormat] || '#f3f4f6', color: FORMAT_TEXT[opp.suggestedFormat] || '#374151', padding: '2px 8px', borderRadius: 10 }}>{opp.suggestedFormat}</span>}
                </div>
                {opp.description && <p style={{ fontSize: 12, color: T.textSub, lineHeight: 1.5, marginBottom: 6 }}>{opp.description}</p>}
                {opp.brandAlignment && <p style={{ fontSize: 11, color: '#059669', fontStyle: 'italic' }}>Brand fit: {opp.brandAlignment}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Section 7: Competitive Playbook ── */}
      {data.competitionStrategy?.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Your Competitive Playbook</h3>
          <p style={{ color: T.textMuted, fontSize: 12, marginBottom: 16 }}>Tactical moves to carve out a distinct lane — informed by what competitors are doing and your brand direction.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {data.competitionStrategy.map((s, i) => (
              <div key={i} style={{ background: T.surfaceAlt, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${T.accent}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: T.text, flex: 1 }}>{s.tactic}</span>
                  {s.priority === 'high' && <span style={{ fontSize: 10, fontWeight: 700, background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>High</span>}
                  {s.priority === 'medium' && <span style={{ fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>Medium</span>}
                </div>
                {s.rationale && <p style={{ fontSize: 12, color: T.textSub, lineHeight: 1.5, marginBottom: 6 }}>{s.rationale}</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {s.competitorInspiration && <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10 }}>Inspired by: {s.competitorInspiration}</span>}
                  {s.brandAlignment && <span style={{ fontSize: 11, color: T.accent, fontStyle: 'italic' }}>Brand fit: {s.brandAlignment}</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Section 8: Your Brand Deep Dive ── */}
      {target && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <h3 style={{ color: T.text, fontSize: 16, fontWeight: 700 }}>{target.name} — Deep Dive</h3>
              <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                {target.handle && <a href={`https://instagram.com/${target.handle}`} target="_blank" rel="noreferrer" style={{ color: T.accent, fontSize: 12, textDecoration: 'none' }}>IG: @{target.handle} ↗</a>}
                {target.tiktokHandle && <a href={`https://tiktok.com/@${target.tiktokHandle}`} target="_blank" rel="noreferrer" style={{ color: T.accent, fontSize: 12, textDecoration: 'none' }}>TT: @{target.tiktokHandle} ↗</a>}
                {target.facebookHandle && <a href={`https://facebook.com/${target.facebookHandle}`} target="_blank" rel="noreferrer" style={{ color: T.accent, fontSize: 12, textDecoration: 'none' }}>FB: {target.facebookHandle} ↗</a>}
              </div>
              {(target.error || target.partialData) && (
                <div style={{ background: '#fef3c7', color: '#92400e', fontSize: 12, padding: '4px 10px', borderRadius: 6, marginTop: 8, display: 'inline-block' }}>⚠ {target.error || 'Partial data — limited access'}</div>
              )}
            </div>
            {target.monthlyTrend?.length > 1 && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 11, color: T.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>12-Month Engagement</p>
                <Sparkline data={target.monthlyTrend} width={160} height={44} />
              </div>
            )}
          </div>

          {/* Key metrics */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderRadius: 10, overflow: 'hidden', border: `1px solid ${T.border}` }}>
            {[
              ['Avg Engagement', target.summary?.avgEngagement?.toLocaleString() || '0'],
              ['Posts Analyzed', target.summary?.postCount || 0],
              ['Posts / Week', target.summary?.postingFrequencyPerWeek || 0],
              ['Followers', target.summary?.followersEstimate || '—'],
              ...(target.engagementRate != null ? [['Eng. Rate', `${target.engagementRate}%`]] : []),
            ].map(([label, val], i, arr) => (
              <div key={label} style={{ flex: 1, padding: '14px 12px', borderRight: i < arr.length - 1 ? `1px solid ${T.border}` : 'none', textAlign: 'center' }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{val}</p>
                <p style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{label}</p>
              </div>
            ))}
          </div>

          {/* Posting pattern */}
          {target.postingPattern && Object.values(target.postingPattern.dayBreakdown || {}).some(v => v > 0) && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Posting Pattern{target.postingPattern.bestDay ? <span style={{ color: T.text, fontWeight: 400, textTransform: 'none' }}> — Most active on {target.postingPattern.bestDay}</span> : ''}
              </p>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 44 }}>
                {['mon','tue','wed','thu','fri','sat','sun'].map(day => {
                  const val = target.postingPattern.dayBreakdown[day] || 0
                  const maxVal = Math.max(...Object.values(target.postingPattern.dayBreakdown)) || 1
                  const h = Math.max(4, Math.round((val / maxVal) * 40))
                  return (
                    <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <div style={{ width: '100%', height: h, background: val > 0 ? T.accent : T.border, borderRadius: 3, opacity: val > 0 ? 1 : 0.3 }} />
                      <span style={{ fontSize: 9, color: T.textMuted, textTransform: 'uppercase' }}>{day}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Content themes */}
          {target.contentThemes?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Content Themes</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {target.contentThemes.map((t, i) => (
                  <span key={t.theme} style={{ background: THEME_COLORS[i % THEME_COLORS.length], color: THEME_TEXT[i % THEME_TEXT.length], fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20 }}>
                    {t.theme} <span style={{ opacity: 0.7, fontWeight: 400 }}>× {t.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top hashtags */}
          {target.topHashtags?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Top Hashtags</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {target.topHashtags.slice(0, 15).map(h => (
                  <span key={h.tag} style={{ background: T.surfaceAlt, color: T.textSub, fontSize: 12, padding: '3px 10px', borderRadius: 20, border: `1px solid ${T.border}` }}>{h.tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Top posts */}
          {(target.topPosts || target.recentPosts)?.filter(p => p.caption || p.likes > 0).length > 0 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Top Performing Posts</p>
              <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
                {(target.topPosts?.length > 0 ? target.topPosts : target.recentPosts).slice(0, 3).filter(p => p.caption || p.likes > 0).map((post, i) => (
                  <InstagramCard key={i} post={post} brandName={target.name} handle={target.handle} brandIdx={0} />
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── Section 9: Content Gap Opportunities ── */}
      {target?.contentGaps?.length > 0 && (
        <Card>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Content Gap Opportunities</h3>
          <p style={{ color: T.textMuted, fontSize: 12, marginBottom: 16 }}>Areas where competitors outperform you — ranked by opportunity size.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {target.contentGaps.map((gap, i) => {
              if (gap && typeof gap === 'object') {
                return (
                  <div key={i} style={{ background: T.surfaceAlt, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${T.accent}` }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {gap.platform && <span style={{ fontSize: 11, background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{PLATFORM_LABELS[gap.platform] || gap.platform}</span>}
                      {gap.contentFormat && <span style={{ fontSize: 11, background: FORMAT_COLORS[gap.contentFormat] || '#f3f4f6', color: FORMAT_TEXT[gap.contentFormat] || '#374151', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{gap.contentFormat}</span>}
                      {gap.competitor && <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10 }}>{gap.competitor} does this</span>}
                    </div>
                    <p style={{ color: T.text, fontSize: 13, fontWeight: 700, marginBottom: 6, lineHeight: 1.4 }}>{gap.headline}</p>
                    {gap.detail && <p style={{ color: T.textSub, fontSize: 12, lineHeight: 1.6 }}>{gap.detail}</p>}
                  </div>
                )
              }
              const [headline, detail] = splitGapCard(gap)
              return (
                <div key={i} style={{ background: T.surfaceAlt, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${T.accent}` }}>
                  <p style={{ color: T.text, fontSize: 13, fontWeight: 700, marginBottom: 6, lineHeight: 1.4 }}>{headline}</p>
                  {detail && <p style={{ color: T.textSub, fontSize: 12, lineHeight: 1.6 }}>{detail}</p>}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Website Audit Tab ──────────────────────────────────────────────────────────
function LighthouseScore({ label, score }) {
  const T = useT()
  const color = score >= 90 ? '#059669' : score >= 50 ? '#d97706' : '#dc2626'
  const bg = score >= 90 ? '#d1fae5' : score >= 50 ? '#fef3c7' : '#fee2e2'
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: bg, border: `3px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 6px', fontWeight: 800, fontSize: 16, color }}>{score}</div>
      <p style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
    </div>
  )
}

function WebsiteAuditTab({ slug, onRefresh, running, dataVersion }) {
  const T = useT()
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!slug) return
    fetch(`${API}/brands/${slug}/site_intelligence`).then(r => r.json()).then(setData).catch(() => {})
  }, [slug, dataVersion])

  if (!data) return <EmptyState message="Website audit not yet generated." cta="Run Website Audit" onCta={() => onRefresh('site_intelligence')} />

  const target = data.brands?.find(b => b.role === 'target') || {}
  const competitors = data.brands?.filter(b => b.role === 'competitor') || []
  const lh = data.lighthouseAudit
  const cv = data.crawlerVisibility
  const na = data.navigationAnalysis
  const pcr = data.productContentReview

  return (
    <div>
      {running && <RunningBanner moduleLabel="Website Audit" detail="Scraping brand and competitor sites with screenshots, running Lighthouse, then analyzing with Claude vision." />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700 }}>Website Audit</h2>
        <RefreshButton onClick={() => onRefresh('site_intelligence')} loading={running} />
      </div>

      {lh?.scores && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>Lighthouse Technical Audit</h3>
            {data.hasScreenshot && <span style={{ fontSize: 12, color: '#059669', background: '#d1fae5', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>Visual analysis included</span>}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: lh.topIssues?.length ? 20 : 0 }}>
            <LighthouseScore label="SEO" score={lh.scores.seo} />
            <LighthouseScore label="Performance" score={lh.scores.performance} />
            <LighthouseScore label="Accessibility" score={lh.scores.accessibility} />
            <LighthouseScore label="Best Practices" score={lh.scores.bestPractices} />
          </div>
          {lh.topIssues?.length > 0 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Top Issues to Fix</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lh.topIssues.slice(0, 8).map((issue, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, background: issue.score < 50 ? '#fee2e2' : '#fef3c7', color: issue.score < 50 ? '#dc2626' : '#d97706', padding: '2px 8px', borderRadius: 12, minWidth: 36, textAlign: 'center' }}>{issue.score}</span>
                    <span style={{ fontSize: 13, color: T.textSub }}>{issue.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {(data.topOpportunities || []).length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Top Opportunities</h3>
          {data.topOpportunities.slice(0, 5).map((opp, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderBottom: i < 4 ? `1px solid ${T.border}` : 'none' }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: T.accent, minWidth: 28 }}>{opp.rank || i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: T.text, fontSize: 14 }}>{opp.title}</span>
                  <ImpactBadge impact={opp.impact} />
                </div>
                <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.5 }}>{opp.description}</p>
              </div>
            </div>
          ))}
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {cv && (
          <Card>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Crawler & AI Visibility</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>{cv.heroTextIsLive ? '✓' : '✗'}</span>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Hero text is {cv.heroTextIsLive ? 'live HTML' : 'image-embedded'}</p>
                <p style={{ fontSize: 12, color: T.textMuted }}>{cv.heroTextIsLive ? 'Visible to crawlers and AI agents' : 'Invisible to crawlers — SEO risk'}</p>
              </div>
            </div>
            {cv.contentInImagesLevel && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>Content in Images</p>
                <Badge label={`${cv.contentInImagesLevel} image content`} color={cv.contentInImagesLevel === 'low' ? 'green' : cv.contentInImagesLevel === 'medium' ? 'yellow' : 'red'} />
              </div>
            )}
            {cv.aiReadabilityNote && <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.5 }}>{cv.aiReadabilityNote}</p>}
          </Card>
        )}
        {na && (
          <Card>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Navigation Analysis</h3>
            {na.depth && <Badge label={`${na.depth} navigation`} color={na.depth === 'deep' ? 'green' : na.depth === 'moderate' ? 'yellow' : 'gray'} />}
            {na.topCategories?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Top Categories</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {na.topCategories.slice(0, 8).map(c => <span key={c} style={{ fontSize: 12, background: T.surfaceAlt, color: T.textSub, padding: '3px 10px', borderRadius: 20, border: `1px solid ${T.border}` }}>{c}</span>)}
                </div>
              </div>
            )}
            {na.missingCategories?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Missing Categories</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {na.missingCategories.slice(0, 6).map(c => <span key={c} style={{ fontSize: 12, background: '#fee2e2', color: '#dc2626', padding: '3px 10px', borderRadius: 20 }}>{c}</span>)}
                </div>
              </div>
            )}
            {na.notes && <p style={{ fontSize: 12, color: T.textMuted, marginTop: 10 }}>{na.notes}</p>}
          </Card>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {data.messagingGaps?.length > 0 && (
          <Card>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Messaging Gaps</h3>
            {data.messagingGaps.slice(0, 4).map((g, i) => (
              <div key={i} style={{ borderLeft: `3px solid #f59e0b`, paddingLeft: 12, marginBottom: 12 }}>
                <p style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>{g.gap}</p>
                {g.competitorExample && <p style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>{g.competitorExample}</p>}
              </div>
            ))}
          </Card>
        )}
        {data.ctaEffectiveness && (
          <Card>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>CTA Effectiveness</h3>
            {data.ctaEffectiveness.rating && <Badge label={data.ctaEffectiveness.rating === 'needs improvement' ? 'Needs Improvement' : data.ctaEffectiveness.rating} color={data.ctaEffectiveness.rating === 'strong' ? 'green' : data.ctaEffectiveness.rating === 'moderate' ? 'yellow' : 'red'} />}
            <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>{data.ctaEffectiveness.observations}</p>
            {data.ctaEffectiveness.recommendation && <p style={{ color: T.accent, fontSize: 13, marginTop: 8, fontWeight: 600 }}>→ {data.ctaEffectiveness.recommendation}</p>}
          </Card>
        )}
      </div>

      {pcr && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Product Content Review</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {pcr.brandsCovered?.length > 0 && (
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Brands / Lines</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {pcr.brandsCovered.slice(0, 10).map(b => <span key={b} style={{ fontSize: 12, background: T.surfaceAlt, color: T.textSub, padding: '3px 10px', borderRadius: 20, border: `1px solid ${T.border}` }}>{b}</span>)}
                </div>
              </div>
            )}
            {pcr.ageGroupCoverage?.length > 0 && (
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Audience / Age Groups</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {pcr.ageGroupCoverage.map(a => <span key={a} style={{ fontSize: 12, background: '#ede9fe', color: '#7c3aed', padding: '3px 10px', borderRadius: 20 }}>{a}</span>)}
                </div>
              </div>
            )}
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Price Visibility</p>
              {pcr.priceVisibility && <Badge label={pcr.priceVisibility} color={pcr.priceVisibility === 'visible' ? 'green' : pcr.priceVisibility === 'partial' ? 'yellow' : 'red'} />}
              {pcr.contentGaps?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>Content Gaps</p>
                  <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                    {pcr.contentGaps.slice(0, 4).map((g, i) => <li key={i} style={{ fontSize: 12, color: T.textSub, marginBottom: 3 }}>{g}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {competitors.length > 0 && (
        <Card>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Navigation Comparison</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', color: T.textMuted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>Brand</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', color: T.textMuted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>Hero Headline</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', color: T.textMuted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>Top Nav Categories</th>
                </tr>
              </thead>
              <tbody>
                {[target, ...competitors].filter(b => b.name).map(b => (
                  <tr key={b.name} style={{ borderTop: `1px solid ${T.border}`, background: b.role === 'target' ? '#ede9fe22' : 'transparent' }}>
                    <td style={{ padding: '12px 16px', fontWeight: b.role === 'target' ? 700 : 400, color: T.text }}>{b.name}{b.role === 'target' && ' ★'}</td>
                    <td style={{ padding: '12px 16px', color: T.textSub, fontStyle: 'italic', maxWidth: 200 }}>{b.heroContent?.headline || '—'}</td>
                    <td style={{ padding: '12px 16px', color: T.textSub }}>{(b.featuredCategories || []).slice(0, 6).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Search & SEO / GEO Tab ─────────────────────────────────────────────────────
const KW_CATEGORIES = [
  { key: 'brandTerms', label: 'Brand' },
  { key: 'categoryTerms', label: 'Categories' },
  { key: 'ageGroupTerms', label: 'Age Groups' },
  { key: 'occasionTerms', label: 'Occasions' },
  { key: 'topBrands', label: 'Top Brands' },
  { key: 'localTerms', label: 'Local' },
  { key: 'competitorGapTerms', label: 'Gap Terms' },
  { key: 'aiDiscoveryQueries', label: 'AI Queries' },
]

function computePageSeoScore(seoPage, brandName) {
  const signals = []
  let totalScore = 0
  const seo = seoPage || {}
  // Title tag (25 pts) — detect brand-name-only vs genuinely short vs good
  if (!seo.titleTag) {
    signals.push({ field: 'Title Tag', value: '—', pts: 0, max: 25, status: 'fail', rec: 'No title tag at all — this is the headline Google shows in search results. Without it Google guesses, often using random text. Add a 50–60 character title describing what you sell and where.' })
  } else {
    const bn = (brandName || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const tl = seo.titleTag.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const isBrandOnly = seo.titleTag.length < 35 && bn && tl === bn
    if (isBrandOnly) {
      totalScore += 10
      signals.push({ field: 'Title Tag', value: seo.titleTag, pts: 10, max: 25, status: 'warn', rec: `Your title just says the brand name — shoppers who don't already know you will scroll past. Add what you sell and where: e.g. "${seo.titleTag} Lebanon | Toys, LEGO, Barbie & More"` })
    } else if (seo.titleTag.length < 30) {
      totalScore += 5
      signals.push({ field: 'Title Tag', value: seo.titleTag, pts: 5, max: 25, status: 'warn', rec: `Title is too short (${seo.titleTag.length} chars) — aim for 50–60 characters that describe what you sell and where you operate` })
    } else if (seo.titleTag.length <= 60) {
      totalScore += 25
      signals.push({ field: 'Title Tag', value: seo.titleTag, pts: 25, max: 25, status: 'pass', rec: '' })
    } else {
      totalScore += 15
      signals.push({ field: 'Title Tag', value: seo.titleTag, pts: 15, max: 25, status: 'warn', rec: `Title is too long (${seo.titleTag.length} chars) — Google cuts it off at around 60 characters in search results, hiding key info from shoppers` })
    }
  }
  // Meta description (20 pts)
  if (!seo.metaDescription) {
    signals.push({ field: 'Meta Description', value: '—', pts: 0, max: 20, status: 'fail', rec: 'No meta description — this is the text snippet under your link in Google results. Without it, Google picks random body text, which looks unprofessional and gets fewer clicks. Write 140–160 characters that make people want to visit.' })
  } else if (seo.metaDescription.length < 120) {
    totalScore += 10
    signals.push({ field: 'Meta Description', value: seo.metaDescription, pts: 10, max: 20, status: 'warn', rec: `Too short (${seo.metaDescription.length} chars) — aim for 140–160 characters so Google shows your full message` })
  } else if (seo.metaDescription.length <= 160) {
    totalScore += 20
    signals.push({ field: 'Meta Description', value: seo.metaDescription, pts: 20, max: 20, status: 'pass', rec: '' })
  } else {
    totalScore += 12
    signals.push({ field: 'Meta Description', value: seo.metaDescription, pts: 12, max: 20, status: 'warn', rec: `Too long (${seo.metaDescription.length} chars) — Google will cut it off; trim to 160 characters` })
  }
  // H1 (20 pts)
  if (!seo.h1) {
    signals.push({ field: 'H1 Heading', value: '—', pts: 0, max: 20, status: 'fail', rec: 'No H1 heading — every page should have one main headline containing your key topic. Search engines use it to understand what the page is about; missing it wastes a prime ranking opportunity.' })
  } else {
    totalScore += 20
    signals.push({ field: 'H1 Heading', value: seo.h1, pts: 20, max: 20, status: 'pass', rec: '' })
  }
  // Canonical (10 pts)
  if (!seo.canonicalTag) {
    totalScore += 5
    signals.push({ field: 'Canonical Tag', value: '—', pts: 5, max: 10, status: 'warn', rec: 'No canonical tag — when Google finds the same product at multiple URLs (e.g. with filters or sorting applied), it splits your ranking power across duplicates. One line of code tells Google which version to credit.' })
  } else {
    totalScore += 10
    signals.push({ field: 'Canonical Tag', value: seo.canonicalTag.slice(0, 60), pts: 10, max: 10, status: 'pass', rec: '' })
  }
  // Schema (15 pts)
  const hasRichSchema = seo.schemaMarkup?.some(s => /product|offer|breadcrumb|itemlist|faq/i.test(s))
  if (!seo.schemaMarkup?.length) {
    signals.push({ field: 'Schema Markup', value: 'None', pts: 0, max: 15, status: 'fail', rec: 'No structured data — adding product and organization markup helps Google display star ratings, prices, and breadcrumbs directly in search results, increasing click-through rate without any extra ad spend.' })
  } else if (!hasRichSchema) {
    totalScore += 8
    signals.push({ field: 'Schema Markup', value: seo.schemaMarkup.join(', '), pts: 8, max: 15, status: 'warn', rec: 'Only basic markup present — adding product schema lets Google show prices and availability directly in search results ("rich results"), which can significantly increase clicks compared to plain text results.' })
  } else {
    totalScore += 15
    signals.push({ field: 'Schema Markup', value: seo.schemaMarkup.join(', '), pts: 15, max: 15, status: 'pass', rec: '' })
  }
  // Page speed (10 pts)
  const speedPts = { fast: 10, medium: 5, slow: 0 }[seo.pageSpeedSignal] ?? 3
  totalScore += speedPts
  if (speedPts < 10) {
    signals.push({ field: 'Page Speed', value: seo.pageSpeedSignal || 'unknown', pts: speedPts, max: 10, status: speedPts === 0 ? 'fail' : 'warn', rec: seo.pageSpeedSignal === 'slow' ? 'Page loads slowly — Google uses speed as a direct ranking factor, especially on mobile. Every second of delay loses roughly 7% of visitors before they even see your products.' : 'Medium speed — consider image compression and reducing JavaScript to improve rankings and reduce bounce rate.' })
  } else {
    signals.push({ field: 'Page Speed', value: 'fast', pts: 10, max: 10, status: 'pass', rec: '' })
  }
  return { totalScore, signals }
}

function SearchSeoTab({ slug, onRefresh, running, dataVersion }) {
  const T = useT()
  const [data, setData] = useState(null)
  const [view, setView] = useState('seo')
  const [kwCat, setKwCat] = useState('brandTerms')
  const [kwFilter, setKwFilter] = useState('all')
  const [expandedCluster, setExpandedCluster] = useState(null)
  const [showAllKeywords, setShowAllKeywords] = useState(false)
  const [geoAgent, setGeoAgent] = useState('claude')
  const [expandedPage, setExpandedPage] = useState(null)

  useEffect(() => {
    if (!slug) return
    fetch(`${API}/brands/${slug}/search_seo`).then(r => r.json()).then(setData).catch(() => {})
  }, [slug, dataVersion])

  if (!data) return <EmptyState message="Search & SEO analysis not yet generated." cta="Run Search & SEO Analysis" onCta={() => onRefresh('search_seo')} />

  const seo = data.onPageSeo || {}
  const geo = data.geoSection || {}
  const kw = data.keywordUniverse || {}
  const ki = data.keywordIntelligence || null
  const INTENT_COLORS = { transactional: '#059669', commercial: '#2563eb', informational: '#d97706', navigational: '#6b7280' }
  const COMPETITION_COLORS = { low: '#059669', medium: '#d97706', high: '#dc2626' }
  const OPPORTUNITY_COLORS = { high: '#7c3aed', medium: '#2563eb', low: '#6b7280' }
  const CONTENT_TYPE_LABELS = { 'category-page': 'Category Page', 'blog-post': 'Blog / Guide', 'landing-page': 'Landing Page', 'faq-page': 'FAQ Page', 'product-page': 'Product Page' }
  const speedColors = { fast: 'green', medium: 'yellow', slow: 'red', unknown: 'gray' }
  const byAgent = geo.byAgent || {}
  const agents = Object.keys(byAgent)
  const activeAgentData = byAgent[geoAgent] || {}

  return (
    <div>
      {running && <RunningBanner moduleLabel="Search & SEO / GEO" detail="Generating 200-term keyword universe, scraping on-page SEO signals, and querying AI agents for GEO visibility." />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['seo', 'keywords', 'geo'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: v === view ? 700 : 400, background: v === view ? T.accent : T.surfaceAlt, color: v === view ? '#fff' : T.textSub, border: 'none', cursor: 'pointer' }}>
              {v === 'seo' ? 'On-Page SEO' : v === 'keywords' ? `Keywords${kw.totalCount ? ` (${kw.totalCount})` : ''}` : 'GEO (AI Visibility)'}
            </button>
          ))}
        </div>
        <RefreshButton onClick={() => onRefresh('search_seo')} loading={running} />
      </div>

      {view === 'seo' && (() => {
        const brandName = data.brandName || data.brandSlug?.replace(/-/g, ' ') || ''
        const { totalScore, signals } = computePageSeoScore(seo, brandName)
        const scoreColor = totalScore >= 75 ? '#059669' : totalScore >= 50 ? '#d97706' : '#dc2626'

        const pageTypeColor = { homepage: 'purple', category: 'blue', product: 'green' }
        const pageTypeLabel = { homepage: 'Homepage', category: 'Category Page', product: 'Product Page' }

        return (
          <div>

            {/* ── Priority Actions ── */}
            {data.priorityActions?.length > 0 && (
              <Card style={{ marginBottom: 20, borderLeft: '4px solid #6366f1' }}>
                <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Priority Actions</h3>
                <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 20 }}>Ranked by business impact across all SEO signals — homepage, category pages, product pages, sitemap, and competitor comparison.</p>
                {data.priorityActions.map((action, i) => (
                  <div key={i} style={{ display: 'flex', gap: 16, paddingBottom: 16, marginBottom: 16, borderBottom: i < data.priorityActions.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: T.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: T.accent, flexShrink: 0 }}>{action.rank}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <ImpactBadge impact={(action.impact || 'medium').toLowerCase()} />
                        <span style={{ fontSize: 11, color: T.textMuted, background: T.surfaceAlt, padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>{action.effort || '—'}</span>
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 4 }}>{action.action}</p>
                      <p style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6 }}>{action.why}</p>
                    </div>
                  </div>
                ))}
              </Card>
            )}

            {/* ── Homepage SEO Health Score ── */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 24 }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Homepage SEO Score</p>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 52, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{totalScore}</span>
                    <span style={{ fontSize: 20, color: T.textMuted, fontWeight: 400 }}>/100</span>
                  </div>
                  <p style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Based on 6 on-page signals</p>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Issues to Fix</p>
                  {signals.filter(s => s.status !== 'pass').length === 0
                    ? <p style={{ fontSize: 13, color: '#059669' }}>All signals passing</p>
                    : signals.filter(s => s.status !== 'pass').map((s, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: s.status === 'fail' ? '#dc2626' : '#d97706', fontWeight: 700, minWidth: 28 }}>{s.status === 'fail' ? '✗' : '!'}</span>
                          <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.4 }}><strong>{s.field}:</strong> {s.rec}</p>
                        </div>
                      ))
                  }
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: T.surfaceAlt }}>
                    {['Signal', 'Current Value', 'Score', 'What This Means'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: T.text }}>{s.field}</td>
                      <td style={{ padding: '10px 14px', color: s.value === '—' ? T.textFaint : T.textSub, maxWidth: 200, wordBreak: 'break-word', fontStyle: s.value === '—' ? 'italic' : 'normal' }}>{s.value.length > 70 ? s.value.slice(0, 70) + '…' : s.value}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, background: s.status === 'pass' ? '#d1fae5' : s.status === 'warn' ? '#fef3c7' : '#fee2e2', color: s.status === 'pass' ? '#059669' : s.status === 'warn' ? '#d97706' : '#dc2626', padding: '3px 10px', borderRadius: 12 }}>{s.pts}/{s.max}</span>
                      </td>
                      <td style={{ padding: '10px 14px', color: T.textMuted, fontSize: 12, lineHeight: 1.5 }}>{s.rec || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* ── Multi-Page Analysis ── */}
            {data.pageAnalyses?.length > 1 && (
              <Card style={{ marginBottom: 20 }}>
                <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Multi-Page SEO Analysis</h3>
                <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>
                  We checked your homepage, category pages, and product pages. Issues appearing across multiple page types signal a site-wide problem, not just a homepage fix.
                </p>
                {data.pageAnalyses.map((page, i) => {
                  const { totalScore: pgScore } = computePageSeoScore(page, brandName)
                  const pgColor = pgScore >= 75 ? 'green' : pgScore >= 50 ? 'yellow' : 'red'
                  const isOpen = expandedPage === i
                  const { signals: pgSignals } = computePageSeoScore(page, brandName)
                  const shortUrl = (page.url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 55) || '/'
                  return (
                    <div key={i} style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12, marginTop: 12 }}>
                      <button onClick={() => setExpandedPage(isOpen ? null : i)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                        <Badge label={pageTypeLabel[page.pageType] || page.pageType} color={pageTypeColor[page.pageType] || 'gray'} />
                        <span style={{ flex: 1, fontSize: 13, color: T.textSub, fontFamily: 'monospace' }}>{shortUrl || '/'}</span>
                        {page.error ? <Badge label="Could not scrape" color="gray" /> : <Badge label={`${pgScore}/100`} color={pgColor} />}
                        <span style={{ color: T.textFaint, fontSize: 12, marginLeft: 4 }}>{isOpen ? '▲' : '▼'}</span>
                      </button>
                      {isOpen && (
                        <div style={{ marginTop: 12 }}>
                          {page.error
                            ? <p style={{ fontSize: 13, color: T.textMuted, fontStyle: 'italic', padding: '8px 0' }}>Could not scrape this page — it may be JavaScript-rendered or bot-protected. Search engines may see the same empty content.</p>
                            : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr style={{ background: T.surfaceAlt }}>
                                    {['Signal', 'Value', 'Score', 'Recommendation'].map(h => (
                                      <th key={h} style={{ padding: '6px 12px', textAlign: 'left', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {pgSignals.map((s, j) => (
                                    <tr key={j} style={{ borderTop: `1px solid ${T.border}` }}>
                                      <td style={{ padding: '8px 12px', fontWeight: 600, color: T.text, whiteSpace: 'nowrap' }}>{s.field}</td>
                                      <td style={{ padding: '8px 12px', color: s.value === '—' ? T.textFaint : T.textSub, maxWidth: 180, wordBreak: 'break-word', fontStyle: s.value === '—' ? 'italic' : 'normal' }}>{s.value.length > 60 ? s.value.slice(0, 60) + '…' : s.value}</td>
                                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, background: s.status === 'pass' ? '#d1fae5' : s.status === 'warn' ? '#fef3c7' : '#fee2e2', color: s.status === 'pass' ? '#059669' : s.status === 'warn' ? '#d97706' : '#dc2626', padding: '2px 8px', borderRadius: 12 }}>{s.pts}/{s.max}</span>
                                      </td>
                                      <td style={{ padding: '8px 12px', color: T.textMuted, lineHeight: 1.4 }}>{s.rec || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )
                          }
                        </div>
                      )}
                    </div>
                  )
                })}
              </Card>
            )}

            {/* ── Sitemap Analysis ── */}
            {data.sitemapAnalysis && (
              <Card style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: data.sitemapAnalysis.issues?.length ? 16 : 0 }}>
                  <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>Sitemap</h3>
                  <Badge label={data.sitemapAnalysis.found ? 'Found' : 'Missing'} color={data.sitemapAnalysis.found ? 'green' : 'red'} />
                  {data.sitemapAnalysis.found && data.sitemapAnalysis.totalUrls > 0 && (
                    <span style={{ fontSize: 12, color: T.textMuted }}>
                      {data.sitemapAnalysis.totalUrls} URLs
                      {data.sitemapAnalysis.byType?.product > 0 && ` · ${data.sitemapAnalysis.byType.product} products`}
                      {data.sitemapAnalysis.byType?.collection > 0 && ` · ${data.sitemapAnalysis.byType.collection} categories`}
                    </span>
                  )}
                </div>
                {data.sitemapAnalysis.issues?.length > 0 && (
                  <div>
                    {data.sitemapAnalysis.issues.map((issue, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                        <span style={{ color: data.sitemapAnalysis.found ? '#d97706' : '#dc2626', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{data.sitemapAnalysis.found ? '!' : '✗'}</span>
                        <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.5 }}>{issue}</p>
                      </div>
                    ))}
                  </div>
                )}
                {data.sitemapAnalysis.found && !data.sitemapAnalysis.issues?.length && (
                  <p style={{ fontSize: 13, color: '#059669', marginTop: 4 }}>Sitemap looks healthy — all major URL types present and listed in robots.txt.</p>
                )}
              </Card>
            )}

            {/* ── Competitor SEO Comparison ── */}
            {data.competitors?.length > 0 && (
              <Card style={{ marginBottom: 20 }}>
                <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Competitor SEO Comparison</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: T.surfaceAlt }}>
                        {['Competitor', 'Title Tag', 'H1', 'Schema', 'Speed'].map(h => (
                          <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderTop: `1px solid ${T.border}`, background: '#ede9fe22' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: T.text }}>{data.onPageSeo?.url?.replace(/https?:\/\/(www\.)?/, '').split('/')[0]} ★</td>
                        <td style={{ padding: '10px 14px', color: seo.titleTag ? T.text : T.textFaint, fontStyle: seo.titleTag ? 'normal' : 'italic' }}>{seo.titleTag?.slice(0, 40) || 'Missing'}</td>
                        <td style={{ padding: '10px 14px' }}><Badge label={seo.h1 ? 'Yes' : 'Missing'} color={seo.h1 ? 'green' : 'red'} /></td>
                        <td style={{ padding: '10px 14px', color: T.textSub }}>{seo.schemaMarkup?.join(', ') || '—'}</td>
                        <td style={{ padding: '10px 14px' }}><Badge label={seo.pageSpeedSignal || 'unknown'} color={speedColors[seo.pageSpeedSignal] || 'gray'} /></td>
                      </tr>
                      {data.competitors.map((c, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                          <td style={{ padding: '10px 14px', color: T.text }}>{c.name}</td>
                          <td style={{ padding: '10px 14px', color: c.titleTag ? T.textSub : T.textFaint, fontStyle: c.titleTag ? 'normal' : 'italic' }}>{c.titleTag?.slice(0, 40) || 'Not found'}</td>
                          <td style={{ padding: '10px 14px' }}><Badge label={c.h1 ? 'Yes' : 'Missing'} color={c.h1 ? 'green' : 'red'} /></td>
                          <td style={{ padding: '10px 14px', color: T.textSub }}>{c.schemaMarkup?.join(', ') || '—'}</td>
                          <td style={{ padding: '10px 14px' }}><Badge label={c.pageSpeedSignal || 'unknown'} color={speedColors[c.pageSpeedSignal] || 'gray'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ── Competitor Benchmarks ── */}
            {data.competitorBenchmarks?.length > 0 && (
              <Card>
                <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Where Competitors Outperform You</h3>
                <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 20 }}>Real examples from your competitors showing what better SEO looks like — and what it costs you to fall behind.</p>
                {data.competitorBenchmarks.map((b, i) => (
                  <div key={i} style={{ paddingBottom: 20, marginBottom: 20, borderBottom: i < data.competitorBenchmarks.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Badge label={b.signal} color="yellow" />
                      <span style={{ fontSize: 12, color: T.textMuted }}>→</span>
                      <Badge label={b.competitorName} color="blue" />
                      <span style={{ fontSize: 12, color: T.textMuted }}>does this better</span>
                    </div>
                    <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.6, marginBottom: 12 }}>{b.callout}</p>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                      <div>
                        <p style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Their Value</p>
                        <p style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>{b.competitorValue || '—'}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Your Value</p>
                        <p style={{ fontSize: 13, color: b.targetValue ? '#d97706' : '#dc2626', fontWeight: 600, fontStyle: b.targetValue ? 'normal' : 'italic' }}>{b.targetValue || 'Missing'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )
      })()}

      {view === 'keywords' && (
        <div>
          {!ki && (
            <Card style={{ marginBottom: 16, borderLeft: '4px solid #d97706' }}>
              <p style={{ color: T.textSub, fontSize: 13 }}>Keyword intelligence not yet generated. Re-run Search & SEO analysis to unlock opportunity clusters, content gaps, and ranked recommendations.</p>
            </Card>
          )}

          {ki && (() => {
            const summary = ki.opportunitySummary || {}
            const clusters = ki.clusters || []
            const gaps = ki.topContentGaps || []
            const filterBtns = [
              { key: 'all', label: 'All Clusters' },
              { key: 'quickwins', label: `Quick Wins (${clusters.filter(c => c.isQuickWin).length})` },
              { key: 'gaps', label: `Content Gaps (${clusters.filter(c => !c.hasExistingPage).length})` },
              { key: 'high', label: `High Opportunity (${clusters.filter(c => c.opportunity === 'high').length})` },
            ]
            const filtered = clusters.filter(c => {
              if (kwFilter === 'quickwins') return c.isQuickWin
              if (kwFilter === 'gaps') return !c.hasExistingPage
              if (kwFilter === 'high') return c.opportunity === 'high'
              return true
            })
            return (
              <>
                {/* Opportunity Summary Bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Quick Wins', value: summary.quickWins ?? clusters.filter(c => c.isQuickWin).length, color: '#059669', desc: 'Existing pages to optimize' },
                    { label: 'Content to Create', value: summary.contentToCreate ?? clusters.filter(c => !c.hasExistingPage && c.opportunity !== 'low').length, color: '#2563eb', desc: 'New pages needed' },
                    { label: 'Content Gaps', value: summary.contentGaps ?? gaps.length, color: '#dc2626', desc: 'High-value missed searches' },
                    { label: 'Total Opportunities', value: summary.totalOpportunities ?? clusters.length, color: '#7c3aed', desc: 'Keyword clusters identified' },
                  ].map(s => (
                    <Card key={s.label} style={{ textAlign: 'center', padding: 16 }}>
                      <p style={{ fontSize: 32, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.value}</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>{s.label}</p>
                      <p style={{ fontSize: 11, color: T.textMuted }}>{s.desc}</p>
                    </Card>
                  ))}
                </div>

                {/* Top Content Gaps */}
                {gaps.length > 0 && (
                  <Card style={{ marginBottom: 20 }}>
                    <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Top Content Gaps</h3>
                    <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 16 }}>High-value searches where your site has no matching page — each is a missed ranking opportunity.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {gaps.map((g, i) => (
                        <div key={i} style={{ borderLeft: '4px solid #dc2626', paddingLeft: 14, paddingTop: 4, paddingBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{g.title}</span>
                            <span style={{ fontSize: 11, background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{g.estimatedMonthlySearches} searches/mo</span>
                            <span style={{ fontSize: 11, background: T.surfaceAlt, color: T.textSub, padding: '2px 8px', borderRadius: 10 }}>{CONTENT_TYPE_LABELS[g.recommendedContentType] || g.recommendedContentType}</span>
                          </div>
                          <p style={{ fontSize: 13, color: T.textSub, marginBottom: 6 }}>{g.description}</p>
                          {(g.exampleKeywords || []).length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {g.exampleKeywords.map(k => (
                                <span key={k} style={{ fontSize: 11, background: T.surfaceAlt, color: T.textSub, padding: '3px 10px', borderRadius: 10, border: `1px solid ${T.border}` }}>{k}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Keyword Clusters */}
                <Card style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>Keyword Clusters by Opportunity</h3>
                    <span style={{ fontSize: 12, color: T.textMuted }}>{filtered.length} of {clusters.length} clusters</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                    {filterBtns.map(f => (
                      <button key={f.key} onClick={() => setKwFilter(f.key)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: kwFilter === f.key ? 700 : 400, background: kwFilter === f.key ? T.accent : T.surfaceAlt, color: kwFilter === f.key ? '#fff' : T.textSub, border: kwFilter === f.key ? 'none' : `1px solid ${T.border}`, cursor: 'pointer' }}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filtered.map(c => {
                      const isOpen = expandedCluster === c.id
                      return (
                        <div key={c.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
                          <button onClick={() => setExpandedCluster(isOpen ? null : c.id)} style={{ width: '100%', background: isOpen ? T.surfaceAlt : T.surface, border: 'none', padding: '12px 16px', cursor: 'pointer', textAlign: 'left' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: T.text, flex: 1 }}>{c.name}</span>
                              {c.isQuickWin && <span style={{ fontSize: 11, background: '#ecfdf5', color: '#059669', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>Quick Win</span>}
                              {!c.hasExistingPage && <span style={{ fontSize: 11, background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>No Page</span>}
                              <span style={{ fontSize: 11, background: `${OPPORTUNITY_COLORS[c.opportunity]}22`, color: OPPORTUNITY_COLORS[c.opportunity], padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                                {c.opportunity?.charAt(0).toUpperCase() + c.opportunity?.slice(1)} Opportunity
                              </span>
                              <span style={{ fontSize: 11, background: `${COMPETITION_COLORS[c.competition]}22`, color: COMPETITION_COLORS[c.competition], padding: '2px 8px', borderRadius: 10 }}>
                                {c.competition?.charAt(0).toUpperCase() + c.competition?.slice(1)} Competition
                              </span>
                              <span style={{ fontSize: 11, background: T.surfaceAlt, color: T.textSub, padding: '2px 8px', borderRadius: 10, border: `1px solid ${T.border}` }}>
                                {c.intent}
                              </span>
                              <span style={{ fontSize: 12, color: T.textMuted }}>{c.estimatedMonthlySearches} searches/mo</span>
                              <span style={{ fontSize: 16, color: T.textMuted, marginLeft: 4 }}>{isOpen ? '▲' : '▼'}</span>
                            </div>
                          </button>
                          {isOpen && (
                            <div style={{ padding: '14px 16px', borderTop: `1px solid ${T.border}`, background: T.surface }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                                <div>
                                  <p style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Content Gap</p>
                                  <p style={{ fontSize: 13, color: T.textSub }}>{c.contentGap}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Recommended Action</p>
                                  <p style={{ fontSize: 13, color: T.textSub }}>{c.recommendation}</p>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, background: T.surfaceAlt, color: T.textSub, padding: '2px 8px', borderRadius: 10, border: `1px solid ${T.border}` }}>
                                  {CONTENT_TYPE_LABELS[c.contentType] || c.contentType}
                                </span>
                                {(c.keywords || []).map(k => (
                                  <span key={k} style={{ fontSize: 11, background: T.surfaceAlt, color: T.textSub, padding: '3px 10px', borderRadius: 10, border: `1px solid ${T.border}` }}>{k}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {filtered.length === 0 && <p style={{ color: T.textFaint, fontSize: 13, padding: 8 }}>No clusters match this filter.</p>}
                  </div>
                </Card>
              </>
            )
          })()}

          {/* Browse All Keywords (existing) */}
          <Card style={{ marginBottom: 16 }}>
            <button onClick={() => setShowAllKeywords(!showAllKeywords)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>Browse All Keywords</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {kw.totalCount > 0 && <span style={{ fontSize: 13, color: T.textMuted }}>{kw.totalCount} total terms</span>}
                  <span style={{ fontSize: 16, color: T.textMuted }}>{showAllKeywords ? '▲' : '▼'}</span>
                </div>
              </div>
            </button>
            {showAllKeywords && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
                  {KW_CATEGORIES.map(({ key, label }) => {
                    const count = (kw[key] || []).length
                    if (!count) return null
                    return (
                      <button key={key} onClick={() => setKwCat(key)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: kwCat === key ? 700 : 400, background: kwCat === key ? T.accent : T.surfaceAlt, color: kwCat === key ? '#fff' : T.textSub, border: kwCat === key ? 'none' : `1px solid ${T.border}`, cursor: 'pointer' }}>
                        {label} <span style={{ opacity: 0.7 }}>({count})</span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(kw[kwCat] || []).map(k => (
                    <span key={k} style={{ background: T.surfaceAlt, color: T.textSub, fontSize: 12, padding: '5px 14px', borderRadius: 20, border: `1px solid ${T.border}` }}>{k}</span>
                  ))}
                  {!(kw[kwCat] || []).length && <p style={{ color: T.textFaint, fontSize: 13 }}>No terms in this category yet.</p>}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {view === 'geo' && (
        <div>
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap' }}>
              {agents.map(agent => {
                const agentData = byAgent[agent] || {}
                const score = agentData.visibilityScore ?? 0
                return (
                  <div key={agent} style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{agent === 'claude' ? 'Claude' : 'Perplexity'}</p>
                    <p style={{ fontSize: 48, fontWeight: 800, color: score >= 60 ? '#059669' : score >= 30 ? '#d97706' : '#dc2626', lineHeight: 1 }}>{score}%</p>
                    <p style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>AI visibility</p>
                  </div>
                )
              })}
              {agents.length > 1 && (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Combined</p>
                  <p style={{ fontSize: 48, fontWeight: 800, color: (geo.combinedScore ?? 0) >= 60 ? '#059669' : (geo.combinedScore ?? 0) >= 30 ? '#d97706' : '#dc2626', lineHeight: 1 }}>{geo.combinedScore ?? 0}%</p>
                  <p style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>avg score</p>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 200 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Improvement Opportunities</p>
                <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                  {(geo.gapRecommendations || []).slice(0, 5).map((r, i) => <li key={i} style={{ fontSize: 13, color: T.textSub, marginBottom: 6, lineHeight: 1.4 }}>{r}</li>)}
                </ul>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>Query-Level Visibility</h3>
              {agents.length > 1 && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {agents.map(a => (
                    <button key={a} onClick={() => setGeoAgent(a)} style={{ padding: '5px 14px', borderRadius: 8, fontSize: 13, fontWeight: geoAgent === a ? 700 : 400, background: geoAgent === a ? T.accent : T.surfaceAlt, color: geoAgent === a ? '#fff' : T.textSub, border: 'none', cursor: 'pointer' }}>
                      {a === 'claude' ? 'Claude' : 'Perplexity'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  {['Query', 'Category', 'Mentioned?', 'Sentiment', 'Competitors Also Mentioned'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(activeAgentData.queries || geo.queries || []).map((q, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${T.border}`, background: !q.brandMentioned ? '#fee2e211' : 'transparent' }}>
                    <td style={{ padding: '10px 14px', color: T.text, maxWidth: 220 }}>{q.query}</td>
                    <td style={{ padding: '10px 14px', color: T.textMuted }}>{q.category}</td>
                    <td style={{ padding: '10px 14px' }}><Badge label={q.brandMentioned ? 'Yes' : 'No'} color={q.brandMentioned ? 'green' : 'red'} /></td>
                    <td style={{ padding: '10px 14px' }}>{q.sentiment !== 'not_mentioned' && <Badge label={q.sentiment} color={q.sentiment === 'positive' ? 'green' : q.sentiment === 'negative' ? 'red' : 'gray'} />}</td>
                    <td style={{ padding: '10px 14px', color: T.textMuted, fontSize: 12 }}>{(q.competitorMentions || []).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  )
}

// ─── Action Plan Tab ────────────────────────────────────────────────────────────
function ActionPlanTab({ slug, brandName, onRefresh, running, dataVersion }) {
  const T = useT()
  const [data, setData] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [shareUrl, setShareUrl] = useState('')

  useEffect(() => {
    if (!slug) return
    fetch(`${API}/brands/${slug}/action_plan`).then(r => r.json()).then(setData).catch(() => {})
  }, [slug, dataVersion])

  async function exportPdf() {
    setExporting(true)
    try {
      const res = await fetch(`${API}/brands/${slug}/export/pdf`, { method: 'POST' })
      if (!res.ok) throw new Error('PDF export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${slug}-brand-intelligence.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { alert(e.message) }
    setExporting(false)
  }

  async function copyShareLink() {
    const res = await fetch(`${API}/brands/${slug}/export/share-link`, { method: 'POST' })
    const d = await res.json()
    setShareUrl(d.shareUrl)
    await navigator.clipboard.writeText(d.shareUrl).catch(() => {})
  }

  if (!data) return <EmptyState message="Action plan not yet generated." cta="Generate Action Plan" onCta={() => onRefresh('action_plan')} />

  const moduleSourceColors = { competitive: 'purple', social: 'blue', website: 'yellow', search: 'green', personas: 'red' }

  return (
    <div>
      {running && <RunningBanner moduleLabel="Action Plan" detail="Synthesizing all module outputs into a prioritized executive summary and roadmap using Claude Opus. This takes 2–3 minutes." />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700 }}>Action Plan</h2>
          {data.generatedAt && <p style={{ color: T.textFaint, fontSize: 12, marginTop: 4 }}>Generated {new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={exportPdf} disabled={exporting} style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: exporting ? 0.6 : 1 }}>
            {exporting ? 'Generating PDF...' : '↓ Export PDF'}
          </button>
          <button onClick={copyShareLink} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 13, color: T.textSub, cursor: 'pointer' }}>
            🔗 Share Link
          </button>
          <RefreshButton onClick={() => onRefresh('action_plan')} loading={running} label="Regenerate" />
        </div>
      </div>

      {shareUrl && (
        <div style={{ background: '#d1fae5', color: '#065f46', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13 }}>
          ✓ Share link copied: <a href={shareUrl} target="_blank" rel="noreferrer" style={{ color: '#065f46', fontWeight: 600 }}>{shareUrl}</a>
        </div>
      )}

      {data.executiveSummary && (
        <Card style={{ marginBottom: 24, borderLeft: `4px solid ${T.accent}`, background: `linear-gradient(135deg, ${T.surface} 0%, ${T.surfaceAlt} 100%)` }}>
          <h3 style={{ color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Executive Summary</h3>
          <p style={{ color: T.text, fontSize: 16, lineHeight: 1.85, fontWeight: 400 }}>{data.executiveSummary}</p>
        </Card>
      )}

      {(data.immediateWins || []).length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Immediate Wins <span style={{ color: T.textMuted, fontWeight: 400, fontSize: 13 }}>— top 5 by impact/effort ratio</span></h3>
          {data.immediateWins.map((win, i) => (
            <div key={i} style={{ display: 'flex', gap: 16, padding: '16px 0', borderBottom: i < data.immediateWins.length - 1 ? `1px solid ${T.border}` : 'none', alignItems: 'flex-start' }}>
              <span style={{ width: 32, height: 32, background: i === 0 ? T.accent : T.surfaceAlt, color: i === 0 ? '#fff' : T.textMuted, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>{win.rank}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: T.text, fontSize: 14 }}>{win.title}</span>
                  <ImpactBadge impact={win.impact} />
                  <Badge label={`${win.effort} effort`} color="gray" />
                  {win.sourceModule && <Badge label={win.sourceModule} color={moduleSourceColors[win.sourceModule] || 'gray'} />}
                </div>
                <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.6 }}>{win.description}</p>
              </div>
            </div>
          ))}
        </Card>
      )}

      {data.roadmap && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          {[['day30', '30 Days', '#6366f1', '#ede9fe', '#4c1d95'], ['day60', '60 Days', '#7c3aed', '#f5f3ff', '#5b21b6'], ['day90', '90 Days', '#8b5cf6', '#faf5ff', '#6b21a8']].map(([key, label, color, bgColor, textColor]) => (
            <div key={key} style={{ background: bgColor, borderRadius: 12, padding: 20, border: `1px solid ${color}22` }}>
              <h4 style={{ color, fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>{label}</h4>
              {(data.roadmap[key] || []).map((item, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 8, padding: '10px 14px', marginBottom: 10, borderLeft: `3px solid ${color}` }}>
                  <p style={{ color: textColor, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{item.action}</p>
                  <p style={{ color: '#6b7280', fontSize: 11 }}>{item.owner}</p>
                  <p style={{ color: '#6b7280', fontSize: 11, fontStyle: 'italic' }}>{item.metric}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {(data.competitiveGapsToClose || []).length > 0 && (
          <Card>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Competitive Gaps to Close</h3>
            {data.competitiveGapsToClose.map((gap, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: i < data.competitiveGapsToClose.length - 1 ? `1px solid ${T.border}` : 'none', alignItems: 'flex-start' }}>
                <Badge label={gap.priority} color={gap.priority === 'high' ? 'red' : gap.priority === 'medium' ? 'yellow' : 'green'} />
                <div>
                  <p style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>{gap.gap}</p>
                  {gap.competitor && <p style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>vs. {gap.competitor}</p>}
                </div>
              </div>
            ))}
          </Card>
        )}

        {(data.opportunitiesRanked || []).length > 0 && (
          <Card>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Top Opportunities</h3>
            {data.opportunitiesRanked.map((opp, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: i < data.opportunitiesRanked.length - 1 ? `1px solid ${T.border}` : 'none', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: T.accent, minWidth: 24, lineHeight: 1.2 }}>{opp.rank}</span>
                <div>
                  <p style={{ color: T.text, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{opp.opportunity}</p>
                  <p style={{ color: T.textMuted, fontSize: 12, lineHeight: 1.5 }}>{opp.estimatedImpact}</p>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}

// ─── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [darkMode, setDarkMode] = useState(false)
  const T = darkMode ? DARK_T : LIGHT_T
  const [tab, setTab] = useState('portfolio')
  const [brands, setBrands] = useState([])
  const [activeBrand, setActiveBrand] = useState(null)
  const [showAddBrand, setShowAddBrand] = useState(false)
  const [refreshingAt, setRefreshingAt] = useState({})   // module → trigger timestamp
  const [moduleVersions, setModuleVersions] = useState({}) // module → version counter (increments on completion)
  const fetchIdRef = useRef(0)
  const pollRef = useRef(null)
  const modulePollRefs = useRef({}) // module → intervalId

  async function loadBrands() {
    const res = await fetch(`${API}/brands`)
    const d = await res.json()
    setBrands(d.brands || [])
    return d.brands || []
  }

  useEffect(() => { loadBrands() }, [])

  // Poll if any brand is in 'running' state
  useEffect(() => {
    const hasRunning = brands.some(b => b.discoveryStatus === 'running')
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const updated = await loadBrands()
        if (!updated.some(b => b.discoveryStatus === 'running')) {
          clearInterval(pollRef.current); pollRef.current = null
        }
      }, 5000)
    }
    return () => { if (!hasRunning && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [brands])

  function selectBrand(slug) {
    setActiveBrand(slug); setTab('profile')
  }

  async function handleBrandAdded(slug) {
    setShowAddBrand(false)
    await loadBrands()
    setActiveBrand(slug); setTab('profile')
  }

  async function handleRefreshAll(slug) {
    await fetch(`${API}/brands/${slug}/refresh/all`, { method: 'POST' })
    await loadBrands()
  }

  async function handleRefreshModule(module) {
    if (!activeBrand) return
    const triggerTime = Date.now()
    setRefreshingAt(r => ({ ...r, [module]: triggerTime }))
    await fetch(`${API}/brands/${activeBrand}/refresh/${module}`, { method: 'POST' })
    // Poll status until lastRefreshed > triggerTime, then mark done and bump version
    const slug = activeBrand
    const POLL_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes max
    if (modulePollRefs.current[module]) clearInterval(modulePollRefs.current[module])
    modulePollRefs.current[module] = setInterval(async () => {
      try {
        // Timeout: if it's been running > 10 min, assume failure and clear
        if (Date.now() - triggerTime > POLL_TIMEOUT_MS) {
          clearInterval(modulePollRefs.current[module])
          delete modulePollRefs.current[module]
          setRefreshingAt(r => { const n = { ...r }; delete n[module]; return n })
          return
        }
        const res = await fetch(`${API}/brands/${slug}/status`)
        const s = await res.json()
        const mod = s.modules?.find(m => m.module === module)
        if (mod?.lastRefreshed && new Date(mod.lastRefreshed).getTime() > triggerTime) {
          clearInterval(modulePollRefs.current[module])
          delete modulePollRefs.current[module]
          setRefreshingAt(r => { const n = { ...r }; delete n[module]; return n })
          setModuleVersions(v => ({ ...v, [module]: (v[module] || 0) + 1 }))
        }
      } catch {}
    }, 4000)
  }

  const activeBrandData = brands.find(b => b.slug === activeBrand)
  const nonPortfolioTabs = TABS.filter(t => t.id !== 'portfolio')

  return (
    <ThemeContext.Provider value={T}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        @keyframes spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
      `}</style>

      <div style={{ minHeight: '100vh', background: T.bg }}>
        {/* Nav */}
        <nav style={{ background: T.navBg, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16, height: 56, position: 'sticky', top: 0, zIndex: 100 }}>
          <span style={{ color: T.navText, fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', marginRight: 8 }}>Brand Intelligence</span>

          {/* Brand switcher */}
          <select
            value={activeBrand || ''}
            onChange={e => { if (e.target.value) { setActiveBrand(e.target.value); setTab('profile') } else { setActiveBrand(null); setTab('portfolio') } }}
            style={{ background: 'rgba(255,255,255,0.1)', color: T.navText, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
          >
            <option value="">All Brands</option>
            {brands.map(b => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>

          <button onClick={() => setShowAddBrand(true)} style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Add Brand</button>

          <div style={{ flex: 1 }} />

          {/* Tab nav (only show brand tabs when a brand is selected) */}
          <div style={{ display: 'flex', gap: 2 }}>
            <button onClick={() => { setActiveBrand(null); setTab('portfolio') }} style={{ background: tab === 'portfolio' && !activeBrand ? 'rgba(255,255,255,0.15)' : 'none', color: T.navText, border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', opacity: tab === 'portfolio' ? 1 : 0.6 }}>Portfolio</button>
            {activeBrand && nonPortfolioTabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ background: tab === t.id ? 'rgba(255,255,255,0.15)' : 'none', color: T.navText, border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer', opacity: tab === t.id ? 1 : 0.6 }}>{t.label}</button>
            ))}
          </div>

          <button onClick={() => setDarkMode(d => !d)} style={{ background: 'none', border: 'none', color: T.navText, fontSize: 18, cursor: 'pointer', opacity: 0.7, padding: 4 }}>{darkMode ? '☀' : '🌙'}</button>
        </nav>

        {/* Brand sub-header */}
        {activeBrandData && (
          <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: T.text, fontWeight: 700, fontSize: 15 }}>{activeBrandData.name}</span>
            {activeBrandData.industry && <span style={{ color: T.textMuted, fontSize: 13 }}>{activeBrandData.industry}</span>}
            <HealthBadge status={activeBrandData.healthStatus} />
            {activeBrandData.discoveryStatus === 'running' && <span style={{ color: '#3b82f6', fontSize: 12, fontWeight: 600 }}>🔍 Discovery running...</span>}
          </div>
        )}

        {/* Main content */}
        <main style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
          {tab === 'portfolio' && (
            <PortfolioTab brands={brands} onSelectBrand={selectBrand} onAddBrand={() => setShowAddBrand(true)} onRefresh={handleRefreshAll} />
          )}
          {tab === 'profile' && activeBrand && <BrandProfileTab slug={activeBrand} onRefresh={handleRefreshModule} running={!!(refreshingAt['competitive_analysis'] || refreshingAt['site_intelligence'] || refreshingAt['social_intelligence'])} />}
          {tab === 'competitive' && activeBrand && <CompetitiveTab slug={activeBrand} onRefresh={handleRefreshModule} running={!!refreshingAt['competitive_analysis']} dataVersion={moduleVersions['competitive_analysis'] || 0} />}
          {tab === 'personas' && activeBrand && <PersonasTab slug={activeBrand} onRefresh={handleRefreshModule} running={!!refreshingAt['personas']} dataVersion={moduleVersions['personas'] || 0} />}
          {tab === 'social' && activeBrand && <SocialAuditTab slug={activeBrand} onRefresh={handleRefreshModule} running={!!refreshingAt['social_intelligence']} dataVersion={moduleVersions['social_intelligence'] || 0} />}
          {tab === 'website' && activeBrand && <WebsiteAuditTab slug={activeBrand} onRefresh={handleRefreshModule} running={!!refreshingAt['site_intelligence']} dataVersion={moduleVersions['site_intelligence'] || 0} />}
          {tab === 'search' && activeBrand && <SearchSeoTab slug={activeBrand} onRefresh={handleRefreshModule} running={!!refreshingAt['search_seo']} dataVersion={moduleVersions['search_seo'] || 0} />}
          {tab === 'action' && activeBrand && <ActionPlanTab slug={activeBrand} brandName={activeBrandData?.name} onRefresh={handleRefreshModule} running={!!refreshingAt['action_plan']} dataVersion={moduleVersions['action_plan'] || 0} />}
          {!activeBrand && tab !== 'portfolio' && (
            <EmptyState message="Select a brand to view this section." cta="Go to Portfolio" onCta={() => setTab('portfolio')} />
          )}
        </main>
      </div>

      {showAddBrand && <AddBrandModal onClose={() => setShowAddBrand(false)} onAdded={handleBrandAdded} />}
    </ThemeContext.Provider>
  )
}
