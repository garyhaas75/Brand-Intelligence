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
              <button onClick={() => onRefresh(brand.slug)} disabled={brand.discoveryStatus === 'running'} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 13, color: brand.discoveryStatus === 'running' ? T.textFaint : T.textSub, cursor: brand.discoveryStatus === 'running' ? 'not-allowed' : 'pointer' }}>{brand.discoveryStatus === 'running' ? '⟳ Running…' : '↻ Refresh All'}</button>
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
  const [pdfUploading, setPdfUploading] = useState(false)
  const [pendingCompetitors, setPendingCompetitors] = useState(false)

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

  function addCompetitorToList() {
    if (!newCompUrl || !newCompName) return
    const newEntry = { name: newCompName, url: newCompUrl, discoveredAt: new Date().toISOString() }
    const updated = { ...form, identifiedCompetitors: [...(form.identifiedCompetitors || []), newEntry] }
    setForm(updated)
    setNewCompUrl(''); setNewCompName('')
    setPendingCompetitors(true)
  }

  async function saveCompetitorsAndRun() {
    setSaving(true)
    await fetch(`${API}/brands/${slug}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setData(form); setSaving(false); setPendingCompetitors(false)
    onRefresh('competitive_analysis')
    onRefresh('site_intelligence')
    onRefresh('social_intelligence')
  }

  async function removeCompetitor(url) {
    const updated = { ...form, identifiedCompetitors: (form.identifiedCompetitors || []).filter(c => c.url !== url) }
    setForm(updated)
    await fetch(`${API}/brands/${slug}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
    setData(updated)
  }

  async function uploadPdf(file) {
    setPdfUploading(true)
    const fd = new FormData()
    fd.append('pdf', file)
    await fetch(`${API}/brands/${slug}/upload_style_guide`, { method: 'POST', body: fd })
    setPdfUploading(false)
    processStyleGuide()
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
          {pendingCompetitors && <button onClick={saveCompetitorsAndRun} disabled={running || saving} style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : '✓ Save & Run Analysis'}</button>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                {['Competitor', 'Website URL', 'Instagram', 'TikTok', 'Facebook', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.identifiedCompetitors?.map((c, idx) => {
                const update = (field, val) => { const comps = [...form.identifiedCompetitors]; comps[idx] = { ...c, [field]: val }; setForm({ ...form, identifiedCompetitors: comps }); setPendingCompetitors(true) }
                return (
                <tr key={c.url || idx} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ padding: '10px 12px', minWidth: 140 }}>
                    <input value={c.name} onChange={e => update('name', e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13, fontWeight: 600 }} />
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 200 }}>
                    <input value={c.url || ''} onChange={e => update('url', e.target.value)} placeholder="https://..." style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 12 }} />
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 140 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: T.textMuted, fontSize: 13 }}>@</span>
                      <input value={c.instagramHandle || ''} onChange={e => update('instagramHandle', e.target.value.replace(/^@/, ''))} placeholder="handle" style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 12 }} />
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 130 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: T.textMuted, fontSize: 13 }}>@</span>
                      <input value={c.tiktokHandle || ''} onChange={e => update('tiktokHandle', e.target.value.replace(/^@/, ''))} placeholder="handle" style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 12 }} />
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 130 }}>
                    <input value={c.facebookHandle || ''} onChange={e => update('facebookHandle', e.target.value)} placeholder="page handle" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 12 }} />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <button onClick={() => removeCompetitor(c.url)} style={{ background: 'none', border: `1px solid #fca5a5`, borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '4px 10px' }}>✕</button>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
          <input placeholder="Competitor name" value={newCompName} onChange={e => setNewCompName(e.target.value)} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
          <input placeholder="https://www.competitor.com" value={newCompUrl} onChange={e => setNewCompUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCompetitorToList()} style={{ flex: 2, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.inputBorder}`, background: T.inputBg, color: T.text, fontSize: 13 }} />
          <button onClick={addCompetitorToList} disabled={!newCompName || !newCompUrl} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: (!newCompName || !newCompUrl) ? 'not-allowed' : 'pointer', opacity: (!newCompName || !newCompUrl) ? 0.5 : 1 }}>+ Add</button>
        </div>
        {pendingCompetitors && (
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveCompetitorsAndRun} disabled={running || saving} style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : '✓ Save & Run Analysis'}
            </button>
          </div>
        )}
      </Card>

      {/* ── Brand Guidelines ── */}
      <Card style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ color: T.text, fontSize: 15, fontWeight: 700 }}>Brand Guidelines</h3>
            <p style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>Processed from your style guide PDF — informs all audit recommendations.</p>
          </div>
          {guidelines && <button onClick={processStyleGuide} disabled={guidelinesRunning} style={{ background: guidelinesRunning ? T.surfaceAlt : T.accent, color: guidelinesRunning ? T.textMuted : '#fff', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: guidelinesRunning ? 'not-allowed' : 'pointer' }}>
            {guidelinesRunning ? 'Processing…' : 'Reprocess'}
          </button>}
        </div>

        {guidelinesLog.length > 0 && (
          <div style={{ background: T.surfaceAlt, borderRadius: 8, padding: '10px 14px', marginBottom: 14, maxHeight: 140, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, color: T.textSub }}>
            {guidelinesLog.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}

        {!guidelines && !guidelinesRunning && (
          <label onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent }} onDragLeave={e => e.currentTarget.style.borderColor = T.border} onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; const f = e.dataTransfer.files[0]; if (f) uploadPdf(f) }} style={{ display: 'block', border: `2px dashed ${T.border}`, borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer' }}>
            <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) uploadPdf(e.target.files[0]) }} />
            <p style={{ fontSize: 28, marginBottom: 8 }}>📄</p>
            <p style={{ color: T.text, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{pdfUploading ? 'Uploading…' : 'Drop your brand guidelines PDF here'}</p>
            <p style={{ color: T.textMuted, fontSize: 12 }}>or click to browse</p>
          </label>
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
          <button key={i} onClick={() => { setActivePersona(i); setChatMessages([]) }} style={{ padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: i === activePersona ? 700 : 600, background: i === activePersona ? T.accent : T.surface, color: i === activePersona ? '#fff' : T.text, border: `1px solid ${i === activePersona ? T.accent : T.border}`, cursor: 'pointer' }}>
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
  const [auditProgress, setAuditProgress] = useState(null)

  useEffect(() => {
    if (!slug) return
    fetch(`${API}/brands/${slug}/social_intelligence`).then(r => r.json()).then(setData).catch(() => {})
  }, [slug, dataVersion])

  useEffect(() => {
    if (!running || !slug) { setAuditProgress(null); return }
    const poll = () => fetch(`${API}/brands/${slug}/audit-progress`).then(r => r.json()).then(setAuditProgress).catch(() => {})
    poll()
    const id = setInterval(poll, 4000)
    return () => clearInterval(id)
  }, [running, slug])

  const GRAD_PAIRS = [
    ['#f97316', '#ec4899'], ['#6366f1', '#8b5cf6'], ['#0ea5e9', '#14b8a6'],
    ['#f59e0b', '#ef4444'], ['#10b981', '#3b82f6'], ['#a855f7', '#ec4899'],
  ]

  const PLATFORM_ICONS = { instagram: '📸', tiktok: '🎵', facebook: '👥' }
  const PLATFORM_LABELS = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' }

  function relativeTime(iso) {
    if (!iso) return ''
    const diff = Date.now() - new Date(iso).getTime()
    const d = Math.floor(diff / 86400000)
    if (d < 30) return `${d}d ago`
    const mo = Math.floor(d / 30)
    if (mo < 12) return `${mo}mo ago`
    return `${Math.floor(mo / 12)}y ago`
  }

  if (!data) return <EmptyState message="Social audit not yet generated." cta="Run Social Audit" onCta={() => onRefresh('social_intelligence')} />

  const target = data.brands?.find(b => b.role === 'target')
  const allBrands = data.brands || []

  // Per-brand: compute best engagement across all platforms + social links
  const brandRows = allBrands.map((b, idx) => {
    const igEng = b.summary?.avgEngagement || 0
    const ttEng = b.tiktokData?.summary?.avgEngagement || 0
    const fbEng = b.facebookData?.summary?.avgEngagement || 0
    const bestEng = Math.max(igEng, ttEng, fbEng)
    const bestPlatform = bestEng === ttEng && ttEng > 0 ? 'tiktok' : bestEng === fbEng && fbEng > 0 ? 'facebook' : igEng > 0 ? 'instagram' : null
    const igPosts = b.summary?.postCount || 0
    const ttPosts = b.tiktokData?.summary?.postCount || 0
    const fbPosts = b.facebookData?.summary?.postCount || 0
    const totalPosts = igPosts + ttPosts + fbPosts
    const igFreq = b.summary?.postingFrequencyPerWeek || 0
    const ttFreq = b.tiktokData?.summary?.postingFrequencyPerWeek || 0
    const totalFreq = Math.round((igFreq + ttFreq) * 10) / 10
    const themes = [
      ...(b.contentThemes || []),
      ...(b.tiktokData?.contentThemes || []),
    ].reduce((acc, t) => { const ex = acc.find(x => x.theme === t.theme); if (ex) ex.count += t.count; else acc.push({ ...t }); return acc; }, [])
      .sort((a, bb) => bb.count - a.count)
    return {
      b, idx, isTarget: b.role === 'target',
      igEng, ttEng, fbEng, bestEng, bestPlatform,
      totalPosts, totalFreq, themes,
      igHandle: b.handle ? { label: `@${b.handle}`, url: `https://instagram.com/${b.handle}` } : null,
      ttHandle: b.tiktokHandle ? { label: `@${b.tiktokHandle}`, url: `https://tiktok.com/@${b.tiktokHandle}` } : null,
      fbHandle: b.facebookHandle ? { label: b.facebookHandle, url: `https://facebook.com/${b.facebookHandle}` } : null,
    }
  }).sort((a, bb) => (bb.isTarget ? -1 : 0) - (a.isTarget ? -1 : 0) || bb.bestEng - a.bestEng)

  const targetRow = brandRows.find(r => r.isTarget)
  const competitorRows = brandRows.filter(r => !r.isTarget)
  const marketLeader = competitorRows.sort((a, b) => b.bestEng - a.bestEng)[0]

  // Best posts across ALL brands and platforms, sorted by engagement
  const allTopPosts = allBrands.flatMap((b, bi) => [
    ...(b.topPosts || []).map(p => ({ ...p, brandName: b.name, handle: b.handle, platform: 'instagram', brandIdx: bi })),
    ...(b.tiktokData?.topPosts || []).map(p => ({ ...p, brandName: b.name, handle: b.tiktokHandle, platform: 'tiktok', brandIdx: bi })),
    ...(b.facebookData?.topPosts || []).filter(p => (p.likes || 0) + (p.comments || 0) > 2).map(p => ({ ...p, brandName: b.name, handle: b.facebookHandle, platform: 'facebook', brandIdx: bi })),
  ]).filter(p => (p.likes || 0) + (p.comments || 0) > 0)
    .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
    .slice(0, 9)

  // Strategy items mapped to business outcomes
  const OUTCOME_MAP = [
    { key: 'discovery', label: 'Discovery', color: '#7c3aed', bg: '#ede9fe', keywords: ['hashtag', 'discover', 'reach', 'trend', 'explore', 'seo', 'search', 'new audience', 'organic'] },
    { key: 'awareness', label: 'Brand Awareness', color: '#0369a1', bg: '#e0f2fe', keywords: ['brand', 'awareness', 'storytell', 'consistent', 'identity', 'voice', 'community', 'engag', 'follow'] },
    { key: 'traffic', label: 'Site Traffic', color: '#065f46', bg: '#d1fae5', keywords: ['traffic', 'click', 'link', 'shop', 'product', 'website', 'convert', 'sale', 'promot', 'cta'] },
  ]
  function getOutcome(text) {
    const t = (text || '').toLowerCase()
    for (const o of OUTCOME_MAP) {
      if (o.keywords.some(k => t.includes(k))) return o
    }
    return { key: 'action', label: 'Action', color: '#374151', bg: '#f3f4f6' }
  }

  const strategyItems = [
    ...(data.whiteSpaceOpportunities || []).slice(0, 3).map(o => ({ headline: o.theme, detail: o.description, source: 'opportunity' })),
    ...(data.competitionStrategy || []).filter(s => s.priority === 'high').slice(0, 5).map(s => ({ headline: s.tactic, detail: s.rationale || s.detail, competitor: s.competitorInspiration || s.competitor, source: 'strategy' })),
  ]

  return (
    <div>
      {/* Running indicator */}
      {running && (
        <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 10, padding: '14px 20px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <span style={{ fontSize: 22, display: 'inline-block', animation: 'spin 1.2s linear infinite', flexShrink: 0, marginTop: 2 }}>⟳</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <p style={{ color: '#1e40af', fontSize: 14, fontWeight: 700, margin: 0 }}>Social Media Audit — Running</p>
                {auditProgress?.stepIdx > 0 && <span style={{ color: '#1e40af', fontSize: 12, fontWeight: 600 }}>{auditProgress.stepIdx} / {auditProgress.totalSteps}</span>}
              </div>
              <p style={{ color: '#1e3a8a', fontSize: 13, margin: '0 0 10px' }}>{auditProgress?.step || 'Scraping Instagram, TikTok, and Facebook for all brands...'}</p>
              {auditProgress?.stepIdx > 0 && (
                <div style={{ height: 5, borderRadius: 3, background: '#bfdbfe', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((auditProgress.stepIdx / auditProgress.totalSteps) * 100)}%`, background: '#3b82f6', transition: 'width 0.6s ease' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700, marginBottom: 2 }}>Social Intelligence</h2>
          <p style={{ fontSize: 13, color: T.textSub }}>Competitive social landscape across all channels</p>
        </div>
        <RefreshButton onClick={() => onRefresh('social_intelligence')} loading={running} />
      </div>

      {/* ── Section 1: 3 KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
        <Card style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Market Leader</p>
          {marketLeader ? (
            <>
              <p style={{ fontSize: 17, fontWeight: 800, color: T.text, lineHeight: 1.2, marginBottom: 4 }}>{marketLeader.b.name}</p>
              <p style={{ fontSize: 13, color: T.textSub }}>{marketLeader.bestEng.toLocaleString()} avg engagement · {PLATFORM_LABELS[marketLeader.bestPlatform] || 'Social'}</p>
              {marketLeader.igHandle && <a href={marketLeader.igHandle.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.accent, textDecoration: 'none' }}>{marketLeader.igHandle.label} ↗</a>}
            </>
          ) : <p style={{ color: T.textFaint, fontSize: 13 }}>No data yet</p>}
        </Card>

        <Card style={{ padding: '16px 20px', background: targetRow?.bestEng > 0 ? T.surface : '#fffbeb', border: targetRow?.bestEng > 0 ? `1px solid ${T.border}` : '1px solid #fde68a' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Your Best Channel</p>
          {targetRow?.bestEng > 0 ? (
            <>
              <p style={{ fontSize: 17, fontWeight: 800, color: T.accent, lineHeight: 1.2, marginBottom: 4 }}>{PLATFORM_LABELS[targetRow.bestPlatform]}</p>
              <p style={{ fontSize: 13, color: T.textSub }}>{targetRow.bestEng.toLocaleString()} avg engagement</p>
              {targetRow.bestPlatform === 'tiktok' && targetRow.ttHandle && <a href={targetRow.ttHandle.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.accent, textDecoration: 'none' }}>{targetRow.ttHandle.label} ↗</a>}
              {targetRow.bestPlatform === 'instagram' && targetRow.igHandle && <a href={targetRow.igHandle.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.accent, textDecoration: 'none' }}>{targetRow.igHandle.label} ↗</a>}
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>Instagram restricted</p>
              <p style={{ fontSize: 12, color: '#78350f' }}>TikTok is your best scraped channel. Competitor Instagram data is available.</p>
            </>
          )}
        </Card>

        <Card style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Content Volume</p>
          <p style={{ fontSize: 17, fontWeight: 800, color: T.text, lineHeight: 1.2, marginBottom: 4 }}>
            {allBrands.reduce((s, b) => s + (b.summary?.postCount || 0) + (b.tiktokData?.summary?.postCount || 0), 0).toLocaleString()} posts scraped
          </p>
          <p style={{ fontSize: 13, color: T.textSub }}>{allBrands.length} brands · {allBrands.filter(b => b.tiktokData).length} on TikTok · {allBrands.filter(b => b.summary?.postCount > 0).length} on Instagram</p>
        </Card>
      </div>

      {/* ── Section 2: Competitive Presence ── */}
      <Card style={{ marginBottom: 28, padding: '20px 24px' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Competitive Presence</p>
        <p style={{ fontSize: 13, color: T.textSub, marginBottom: 20 }}>Avg engagement per post by channel — click any handle to view the account</p>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
          {['Brand', '📸 Instagram', '🎵 TikTok', '👥 Facebook', 'Top Theme'].map(h => (
            <span key={h} style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
          ))}
        </div>

        {brandRows.map((row, i) => {
          const [g1, g2] = GRAD_PAIRS[row.idx % GRAD_PAIRS.length]
          return (
            <div key={row.b.slug || i} style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr', gap: 8, alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${T.border}`, background: row.isTarget ? `${T.accent}08` : 'transparent', borderRadius: row.isTarget ? 8 : 0, paddingLeft: row.isTarget ? 8 : 0 }}>
              {/* Brand */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: `linear-gradient(135deg, ${g1}, ${g2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                  {row.b.name[0]}
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: row.isTarget ? 800 : 600, color: row.isTarget ? T.accent : T.text, marginBottom: 0 }}>{row.b.name}{row.isTarget ? ' ★' : ''}</p>
                  {row.totalFreq > 0 && <p style={{ fontSize: 11, color: T.textMuted }}>{row.totalFreq}/wk avg</p>}
                </div>
              </div>
              {/* Instagram */}
              <div>
                {row.igEng > 0 ? (
                  <>
                    <p style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>{row.igEng.toLocaleString()}</p>
                    {row.igHandle && <a href={row.igHandle.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.accent, textDecoration: 'none' }}>{row.igHandle.label} ↗</a>}
                  </>
                ) : row.igHandle ? (
                  <a href={row.igHandle.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.textMuted, textDecoration: 'none' }}>{row.igHandle.label} ↗</a>
                ) : <span style={{ fontSize: 13, color: T.textFaint }}>—</span>}
              </div>
              {/* TikTok */}
              <div>
                {row.ttEng > 0 ? (
                  <>
                    <p style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>{row.ttEng.toLocaleString()}</p>
                    {row.ttHandle && <a href={row.ttHandle.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.accent, textDecoration: 'none' }}>{row.ttHandle.label} ↗</a>}
                  </>
                ) : row.ttHandle ? (
                  <a href={row.ttHandle.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.textMuted, textDecoration: 'none' }}>{row.ttHandle.label} ↗</a>
                ) : <span style={{ fontSize: 13, color: T.textFaint }}>—</span>}
              </div>
              {/* Facebook */}
              <div>
                {row.fbHandle ? (
                  <a href={row.fbHandle.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.textMuted, textDecoration: 'none' }}>{row.fbHandle.label} ↗</a>
                ) : <span style={{ fontSize: 13, color: T.textFaint }}>—</span>}
              </div>
              {/* Top theme */}
              <div>
                {row.themes[0] ? (
                  <span style={{ fontSize: 11, background: '#dbeafe', color: '#1e40af', padding: '3px 8px', borderRadius: 10, fontWeight: 600 }}>{row.themes[0].theme}</span>
                ) : <span style={{ fontSize: 12, color: T.textFaint }}>—</span>}
              </div>
            </div>
          )
        })}
      </Card>

      {/* ── Section 3: What's Working ── */}
      {allTopPosts.length > 0 && (
        <Card style={{ marginBottom: 28, padding: '20px 24px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>What's Working</p>
          <p style={{ fontSize: 13, color: T.textSub, marginBottom: 20 }}>Highest performing posts across all brands and channels</p>
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
            {allTopPosts.map((post, i) => {
              const [g1, g2] = GRAD_PAIRS[post.brandIdx % GRAD_PAIRS.length]
              const engagement = (post.likes || 0) + (post.comments || 0)
              const isTikTok = post.platform === 'tiktok'
              return (
                <div key={i} style={{ width: 200, minWidth: 200, background: T.surface, borderRadius: 12, border: isTikTok ? '1px solid #ff2b5433' : `1px solid ${T.border}`, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: isTikTok ? '#0f0f0f' : T.surface, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: `linear-gradient(135deg, ${g1}, ${g2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{post.brandName[0]}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isTikTok ? '#fff' : T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.brandName}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, background: isTikTok ? '#ff2b54' : '#e0e7ff', color: isTikTok ? '#fff' : '#3730a3', padding: '2px 6px', borderRadius: 6 }}>{PLATFORM_ICONS[post.platform]} {PLATFORM_LABELS[post.platform]}</span>
                  </div>
                  <div style={{ width: '100%', aspectRatio: '1/1', background: isTikTok ? '#1a1a1a' : `linear-gradient(135deg, ${g1}22, ${g2}22)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    {post.imageUrl
                      ? <img src={post.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />
                      : <span style={{ fontSize: isTikTok ? 28 : 36, userSelect: 'none' }}>{isTikTok ? '▶' : post.brandName[0]}</span>}
                    <span style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10 }}>{engagement >= 1000 ? `${(engagement / 1000).toFixed(1)}k` : engagement}</span>
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: T.text }}>♥ {(post.likes || 0).toLocaleString()}</span>
                      <span style={{ fontSize: 11, color: T.text }}>💬 {(post.comments || 0).toLocaleString()}</span>
                    </div>
                    {post.caption && <p style={{ fontSize: 11, color: T.textSub, lineHeight: 1.4, margin: '0 0 4px' }}>{post.caption.slice(0, 80)}{post.caption.length > 80 ? '…' : ''}</p>}
                    {post.postUrl && <a href={post.postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.accent, textDecoration: 'none' }}>View post ↗</a>}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ── Section 4: Where TRU Can Win ── */}
      {strategyItems.length > 0 && (
        <Card style={{ marginBottom: 24, padding: '20px 24px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Where {target?.name || 'You'} Can Win</p>
          <p style={{ fontSize: 13, color: T.textSub, marginBottom: 20 }}>Opportunities ranked by impact on discovery, brand awareness, and site traffic</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
            {strategyItems.map((item, i) => {
              const outcome = getOutcome((item.headline || '') + ' ' + (item.detail || ''))
              return (
                <div key={i} style={{ background: T.surfaceAlt, borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${outcome.color}` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: outcome.color, background: outcome.bg, padding: '2px 8px', borderRadius: 10, display: 'inline-block', marginBottom: 8 }}>{outcome.label}</span>
                  <p style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4, lineHeight: 1.4 }}>{item.headline}</p>
                  {item.detail && <p style={{ fontSize: 12, color: T.textSub, lineHeight: 1.6 }}>{item.detail.slice(0, 320)}{item.detail.length > 320 ? '…' : ''}</p>}
                  {item.competitor && <p style={{ fontSize: 11, color: T.textMuted, marginTop: 6, fontWeight: 600 }}>See how: {item.competitor}</p>}
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
            <button key={v} onClick={() => setView(v)} style={{ padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: v === view ? 700 : 600, background: v === view ? T.accent : T.surface, color: v === view ? '#fff' : T.text, border: `1px solid ${v === view ? T.accent : T.border}`, cursor: 'pointer' }}>
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
                      <button key={f.key} onClick={() => setKwFilter(f.key)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: kwFilter === f.key ? 700 : 600, background: kwFilter === f.key ? T.accent : T.surface, color: kwFilter === f.key ? '#fff' : T.text, border: `1px solid ${kwFilter === f.key ? T.accent : T.border}`, cursor: 'pointer' }}>
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
                      <button key={key} onClick={() => setKwCat(key)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: kwCat === key ? 700 : 600, background: kwCat === key ? T.accent : T.surface, color: kwCat === key ? '#fff' : T.text, border: `1px solid ${kwCat === key ? T.accent : T.border}`, cursor: 'pointer' }}>
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
  const [compData, setCompData] = useState(null)
  const [socialData, setSocialData] = useState(null)
  const [siteData, setSiteData] = useState(null)
  const [seoData, setSeoData] = useState(null)
  const [personasData, setPersonasData] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [shareUrl, setShareUrl] = useState('')

  useEffect(() => {
    if (!slug) return
    Promise.allSettled([
      fetch(`${API}/brands/${slug}/action_plan`).then(r => r.json()),
      fetch(`${API}/brands/${slug}/competitive_analysis`).then(r => r.json()),
      fetch(`${API}/brands/${slug}/social_intelligence`).then(r => r.json()),
      fetch(`${API}/brands/${slug}/site_intelligence`).then(r => r.json()),
      fetch(`${API}/brands/${slug}/search_seo`).then(r => r.json()),
      fetch(`${API}/brands/${slug}/personas`).then(r => r.json()),
    ]).then(([ap, comp, soc, site, seo, per]) => {
      if (ap.status === 'fulfilled') setData(ap.value)
      if (comp.status === 'fulfilled') setCompData(comp.value)
      if (soc.status === 'fulfilled') setSocialData(soc.value)
      if (site.status === 'fulfilled') setSiteData(site.value)
      if (seo.status === 'fulfilled') setSeoData(seo.value)
      if (per.status === 'fulfilled') setPersonasData(per.value)
    })
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

  // SectionHeader per spec
  function SectionHeader({ label, title }) {
    return (
      <div style={{ marginTop: 48, marginBottom: 24 }}>
        <div style={{ height: 1, background: T.border, marginBottom: 16 }} />
        <p style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</p>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{title}</h2>
      </div>
    )
  }

  // Module status pills
  const modulePills = [
    { label: 'Competitive', has: !!compData },
    { label: 'Social', has: !!socialData },
    { label: 'Website', has: !!siteData },
    { label: 'SEO', has: !!seoData },
    { label: 'Personas', has: !!personasData },
  ]

  // Placeholder for missing data
  function NoData() {
    return (
      <div style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 8, padding: '16px 20px' }}>
        <p style={{ color: T.textFaint, fontSize: 13, fontStyle: 'italic', margin: 0 }}>Data not yet generated for this section. Run the analysis to populate.</p>
      </div>
    )
  }

  // Rank circle color
  function rankCircleStyle(rank) {
    const bg = rank === 1 ? T.accent : rank === 2 ? '#7c3aed' : rank === 3 ? '#2563eb' : T.surfaceAlt
    const color = rank <= 3 ? '#fff' : T.textMuted
    return { width: 32, height: 32, background: bg, color, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 }
  }

  // Pill tag helper
  function Pill({ text, color }) {
    const colors = {
      blue: { bg: '#dbeafe', text: '#1e40af' },
      green: { bg: '#d1fae5', text: '#065f46' },
      red: { bg: '#fee2e2', text: '#991b1b' },
      purple: { bg: '#ede9fe', text: '#5b21b6' },
      gray: { bg: '#f3f4f6', text: '#374151' },
    }
    const c = colors[color] || colors.gray
    return <span style={{ display: 'inline-block', background: c.bg, color: c.text, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{text}</span>
  }

  // Sub-label style
  const subLabel = { color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, marginTop: 20 }
  const thSt = { padding: '8px 12px', textAlign: 'left', color: T.textMuted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }
  const tdSt = { padding: '10px 12px', color: T.textSub, fontSize: 13, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }

  // keyword category definitions with explanations
  const KW_CATEGORIES = [
    {
      key: 'categoryTerms',
      label: 'Category Keywords',
      color: 'blue',
      accentColor: '#1d4ed8',
      accentBg: '#eff6ff',
      why: 'These are the highest-opportunity keywords in your market. Shoppers who don\'t know which store to use type these — ranking here means reaching customers before your competitors do.',
      how: 'Add these to your homepage headings, main category page titles, and meta descriptions. Each major category should have its own dedicated page optimized around these terms.',
    },
    {
      key: 'ageGroupTerms',
      label: 'Age Group Keywords',
      color: 'blue',
      accentColor: '#0369a1',
      accentBg: '#f0f9ff',
      why: 'Parents shop by age. "Toys for 3 year olds" and "gifts for 8 year old" are among the most common toy searches — parents want to know something is right for their child\'s stage.',
      how: 'Create age-based landing pages (e.g. "Toys for 3-5 Year Olds"). Add age ranges to product descriptions and category page copy. Competitors who do this consistently outrank stores that don\'t.',
    },
    {
      key: 'occasionTerms',
      label: 'Occasion & Gift Keywords',
      color: 'green',
      accentColor: '#065f46',
      accentBg: '#f0fdf4',
      why: 'Gift-driven searches spike around birthdays, holidays, Eid, and back-to-school. Shoppers searching "birthday gift for 7 year old" are ready to buy — these are high-conversion terms.',
      how: 'Build seasonal landing pages for key occasions (Eid gifts, Christmas toys, birthday gifts by age). Update hero banners 2-3 weeks before each occasion. These pages can rank year-round and convert strongly in-season.',
    },
    {
      key: 'topBrands',
      label: 'Brand Keywords',
      color: 'purple',
      accentColor: '#5b21b6',
      accentBg: '#f5f3ff',
      why: 'Shoppers searching for "LEGO Lebanon" or "Barbie toys Beirut" are brand-loyal and high-intent. If your site isn\'t optimized for brand names you carry, you lose these customers to competitors who are.',
      how: 'Ensure every brand you carry has its own category page with the brand name in the title, H1, and URL. Add brand logos and descriptions. Cross-link between brand pages and product listings.',
    },
    {
      key: 'brandTerms',
      label: 'Your Brand Keywords',
      color: 'purple',
      accentColor: '#7c3aed',
      accentBg: '#faf5ff',
      why: 'Searches where people already know your name. These should be the easiest rankings to own — but if your website isn\'t properly optimized, competitors can appear above you for your own brand name.',
      how: 'Ensure your brand name appears in the homepage title tag, H1, and meta description. Claim and fully complete your Google Business Profile. Keep your NAP (Name, Address, Phone) consistent across all platforms.',
    },
    {
      key: 'localTerms',
      label: 'Local & Lebanon-Specific Keywords',
      color: 'gray',
      accentColor: '#374151',
      accentBg: '#f9fafb',
      why: 'Shoppers in Lebanon searching "toy store Beirut" or "toys Lebanon delivery" are looking for a local option. These searches have strong purchase intent and are often underserved — a huge opportunity.',
      how: 'Add Lebanon and city-specific language to your homepage and contact page. Set up Google Business Profile with accurate location. Create content that references local delivery, local occasions (Eid, Lebanese holidays), and local pricing.',
    },
    {
      key: 'competitorGapTerms',
      label: 'Competitor Gap Keywords',
      color: 'red',
      accentColor: '#b91c1c',
      accentBg: '#fff5f5',
      why: 'These are terms your competitors currently rank for but you don\'t. Every search on this list is a customer you\'re losing right now. They represent the fastest path to incremental traffic.',
      how: 'Audit which competitors rank for each term, then create or improve pages that target those specific keywords. Even ranking on page 1 for 20% of these terms can meaningfully move your organic traffic.',
    },
    {
      key: 'aiDiscoveryQueries',
      label: 'AI Search Queries',
      color: 'blue',
      accentColor: '#0284c7',
      accentBg: '#f0f9ff',
      why: 'These are the questions people ask ChatGPT, Google AI Overview, and Perplexity when looking for toy recommendations. AI assistants are increasingly the first stop for shopping decisions — appearing in these answers builds brand awareness with buyers who haven\'t decided yet.',
      how: 'Write blog posts or FAQ pages that directly answer these questions (e.g. "Best toys for a 5-year-old in Lebanon"). Clear, structured answers with your brand name are more likely to be cited by AI. This is a long-term investment that compounds over time.',
    },
  ]

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {running && <RunningBanner moduleLabel="Action Plan" detail="Synthesizing all module outputs into a prioritized executive summary and roadmap using Claude Opus. This takes 2–3 minutes." />}

      {/* ── COVER HEADER ── */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '28px 32px', marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ color: T.text, fontSize: 24, fontWeight: 800, margin: 0 }}>{brandName || 'Brand'}</h1>
            <p style={{ color: T.textMuted, fontSize: 16, fontWeight: 400, marginTop: 6, marginBottom: 6 }}>Brand Intelligence Report</p>
            <p style={{ color: T.textFaint, fontSize: 12 }}>
              {data.generatedAt
                ? `Generated ${new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                : `Report date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <button onClick={exportPdf} disabled={exporting} style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: exporting ? 0.6 : 1 }}>
              {exporting ? 'Generating PDF...' : '↓ Export PDF'}
            </button>
            <button onClick={copyShareLink} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 16px', fontSize: 13, color: T.textSub, cursor: 'pointer' }}>
              Share Link
            </button>
            <RefreshButton onClick={() => onRefresh('action_plan')} loading={running} label="Regenerate" />
          </div>
        </div>
        {shareUrl && (
          <div style={{ background: '#d1fae5', color: '#065f46', borderRadius: 8, padding: '10px 16px', marginTop: 16, fontSize: 13 }}>
            Share link copied: <a href={shareUrl} target="_blank" rel="noreferrer" style={{ color: '#065f46', fontWeight: 600 }}>{shareUrl}</a>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          {modulePills.map(p => (
            <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600, color: T.textSub }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.has ? '#10b981' : '#9ca3af', flexShrink: 0 }} />
              {p.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── 1. EXECUTIVE SUMMARY ── */}
      <SectionHeader label="Overview" title="Executive Summary" />
      <Card style={{ borderLeft: `4px solid ${T.accent}` }}>
        {data.executiveSummary
          ? <p style={{ color: T.text, fontSize: 15, lineHeight: 1.85, fontWeight: 400, margin: 0 }}>{data.executiveSummary}</p>
          : <NoData />}
      </Card>

      {/* ── 2. YOUR CUSTOMERS ── */}
      <SectionHeader label="Chapter 1" title="Your Customers — Who You're Selling To" />
      <p style={{ color: T.textSub, fontSize: 14, lineHeight: 1.75, marginTop: -8, marginBottom: 24 }}>
        Every decision in this report connects back to these customers. Understanding who they are — what they worry about, what drives them to buy, and where they spend their time — is the foundation for everything that follows.
      </p>
      {personasData && (personasData.personas || []).length > 0 ? (
        <>
          {personasData.summaryInsights && (
            <Card style={{ marginBottom: 20, borderLeft: `4px solid ${T.accent}` }}>
              <p style={{ color: T.text, fontSize: 14, lineHeight: 1.75, margin: 0 }}>{personasData.summaryInsights}</p>
            </Card>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {personasData.personas.map((persona, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                  <div>
                    <h3 style={{ color: T.text, fontSize: 18, fontWeight: 800, margin: 0 }}>{persona.name}</h3>
                    <p style={{ color: T.textMuted, fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                      {[persona.ageRange, persona.income, persona.location].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {(persona.occupation || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(Array.isArray(persona.occupation) ? persona.occupation : [persona.occupation]).map((o, j) => <Pill key={j} text={o} color="gray" />)}
                    </div>
                  )}
                </div>
                {persona.quoteExample && (
                  <p style={{ color: T.textMuted, fontSize: 14, fontStyle: 'italic', borderLeft: `3px solid ${T.accent}`, paddingLeft: 14, margin: '0 0 16px', lineHeight: 1.6 }}>"{persona.quoteExample}"</p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  {(persona.painPoints || []).length > 0 && (
                    <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ color: '#ef4444', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>What frustrates them</p>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {persona.painPoints.map((p, j) => <li key={j} style={{ color: '#7f1d1d', fontSize: 12, lineHeight: 1.55, marginBottom: 3 }}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  {(persona.motivators || []).length > 0 && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ color: '#10b981', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>What drives them to buy</p>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {persona.motivators.map((m, j) => <li key={j} style={{ color: '#14532d', fontSize: 12, lineHeight: 1.55, marginBottom: 3 }}>{m}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
                {(persona.shoppingBehaviors || []).length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>How they shop</p>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {persona.shoppingBehaviors.map((b, j) => <li key={j} style={{ color: T.textSub, fontSize: 13, lineHeight: 1.55, marginBottom: 3 }}>{b}</li>)}
                    </ul>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: persona.brandFit ? 12 : 0 }}>
                  {(persona.contentTopics || []).length > 0 && (
                    <div>
                      <p style={{ color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Content they engage with</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {persona.contentTopics.map((t, j) => <Pill key={j} text={t} color="blue" />)}
                      </div>
                    </div>
                  )}
                  {(persona.preferredChannels || []).length > 0 && (
                    <div>
                      <p style={{ color: T.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Where they spend time</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {persona.preferredChannels.map((ch, j) => <Pill key={j} text={ch} color="purple" />)}
                      </div>
                    </div>
                  )}
                </div>
                {persona.brandFit && (
                  <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.65, marginTop: 12, marginBottom: 0, padding: '10px 14px', background: `${T.accent}0a`, borderRadius: 8, borderLeft: `3px solid ${T.accent}` }}><strong>Brand fit:</strong> {persona.brandFit}</p>
                )}
              </Card>
            ))}
          </div>
        </>
      ) : <NoData />}

      {/* ── 3. THE COMPETITION ── */}
      <SectionHeader label="Chapter 2" title="The Competition — Who You're Up Against" />
      <p style={{ color: T.textSub, fontSize: 14, lineHeight: 1.75, marginTop: -8, marginBottom: 24 }}>
        These are the brands competing for the same customers described above. Understanding their positioning — what they stand for, where they're strong, and where they leave gaps — reveals exactly where you can differentiate.
      </p>
      {compData ? (
        <>
          {compData.positioningMap?.narrative && (
            <Card style={{ marginBottom: 20, borderLeft: `4px solid #7c3aed` }}>
              <p style={{ color: T.text, fontSize: 14, lineHeight: 1.8, margin: 0 }}>{compData.positioningMap.narrative}</p>
            </Card>
          )}
          {(compData.competitors || []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {compData.competitors.map((c, i) => (
                <Card key={i} style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <p style={{ color: T.text, fontSize: 16, fontWeight: 700, margin: 0 }}>{c.name}</p>
                      {c.positioningStatement && <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.6, marginTop: 4, marginBottom: 0 }}>{c.positioningStatement}</p>}
                    </div>
                    {c.pricingTier && <Badge label={c.pricingTier} color="blue" />}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                    {(c.strengths || []).length > 0 && (
                      <div>
                        <p style={{ color: '#10b981', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Where they're strong</p>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {c.strengths.map((s, j) => <li key={j} style={{ color: '#065f46', fontSize: 12, lineHeight: 1.6, marginBottom: 3 }}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {(c.weaknesses || []).length > 0 && (
                      <div>
                        <p style={{ color: '#ef4444', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Where they're vulnerable</p>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {c.weaknesses.map((w, j) => <li key={j} style={{ color: '#991b1b', fontSize: 12, lineHeight: 1.6, marginBottom: 3 }}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ) : <NoData />}
        </>
      ) : <NoData />}

      {/* ── 4. SOCIAL — WHAT'S WORKING ── */}
      <SectionHeader label="Chapter 3" title="Social Media — What's Working in This Market" />
      <p style={{ color: T.textSub, fontSize: 14, lineHeight: 1.75, marginTop: -8, marginBottom: 24 }}>
        Across Instagram and TikTok, your competitors are building audiences and driving purchase intent. Here's what's resonating with your customers right now — and where the gaps are that you can own.
      </p>
      {socialData ? (
        <>
          {(socialData.brands || []).length > 0 && (
            <Card style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px 10px', borderBottom: `1px solid ${T.border}` }}>
                <p style={{ color: T.text, fontSize: 13, fontWeight: 700, margin: 0 }}>Engagement by Brand & Platform</p>
                <p style={{ color: T.textMuted, fontSize: 12, marginTop: 2, marginBottom: 0 }}>Average engagement per post — the higher this number, the more the audience actively responds</p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={thSt}>Brand</th>
                      <th style={{ ...thSt, textAlign: 'right' }}>Instagram Posts</th>
                      <th style={{ ...thSt, textAlign: 'right' }}>Instagram Avg Engagement</th>
                      <th style={{ ...thSt, textAlign: 'right' }}>TikTok Avg Engagement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {socialData.brands.map((brand, i) => {
                      const igPosts = brand.summary?.postCount ?? brand.instagramData?.summary?.postCount ?? null
                      const igEng = brand.summary?.avgEngagement ?? brand.instagramData?.summary?.avgEngagement ?? null
                      const ttEng = brand.tiktokData?.summary?.avgEngagement ?? null
                      const isTarget = brand.role === 'target' || brand.role === 'client'
                      return (
                        <tr key={i} style={{ background: isTarget ? `${T.accent}12` : 'transparent' }}>
                          <td style={{ ...tdSt, fontWeight: isTarget ? 700 : 400, color: isTarget ? T.text : T.textSub }}>
                            {brand.name}
                            {isTarget && <span style={{ color: T.accent, fontSize: 10, marginLeft: 6, fontWeight: 700, background: `${T.accent}20`, padding: '1px 6px', borderRadius: 10 }}>YOU</span>}
                          </td>
                          <td style={{ ...tdSt, textAlign: 'right' }}>{igPosts != null ? igPosts.toLocaleString() : '—'}</td>
                          <td style={{ ...tdSt, textAlign: 'right' }}>{igEng != null ? (typeof igEng === 'number' ? igEng.toLocaleString() : igEng) : '—'}</td>
                          <td style={{ ...tdSt, textAlign: 'right' }}>{ttEng != null ? (typeof ttEng === 'number' ? ttEng.toLocaleString() : ttEng) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {(socialData.whiteSpaceOpportunities || []).length > 0 && (
            <>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 4, marginTop: 24 }}>Content gaps no competitor is filling</p>
              <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>These are topics your customers want content about that nobody in this market is creating — first-mover advantage is available.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {socialData.whiteSpaceOpportunities.map((opp, i) => (
                  <Card key={i} style={{ padding: '16px 20px' }}>
                    <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{opp.theme}</p>
                    <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.65, marginBottom: (opp.platforms || []).length > 0 || opp.rationale ? 10 : 0 }}>{opp.description}</p>
                    {opp.rationale && <p style={{ color: T.textMuted, fontSize: 12, lineHeight: 1.55, marginBottom: (opp.platforms || []).length > 0 ? 8 : 0 }}>{opp.rationale}</p>}
                    {(opp.platforms || []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {opp.platforms.map((pl, j) => <Pill key={j} text={pl} color="blue" />)}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}

          {(socialData.competitionStrategy || []).length > 0 && (
            <>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 4, marginTop: 28 }}>Tactics to compete and win</p>
              <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>Specific moves — inspired by what's working for competitors — that are available to you right now.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {socialData.competitionStrategy.map((s, i) => (
                  <Card key={i} style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: s.rationale ? 6 : 0 }}>
                      <p style={{ color: T.text, fontSize: 13, fontWeight: 700, margin: 0, flex: 1 }}>{s.tactic}</p>
                      {s.priority && <Badge label={s.priority} color={s.priority === 'high' || s.priority === 'critical' ? 'red' : s.priority === 'medium' ? 'yellow' : 'gray'} />}
                    </div>
                    {s.rationale && <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.6, marginBottom: s.competitorInspiration ? 6 : 0 }}>{s.rationale}</p>}
                    {s.competitorInspiration && <p style={{ color: T.textMuted, fontSize: 12, margin: 0 }}><strong>Inspired by:</strong> {s.competitorInspiration}</p>}
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      ) : <NoData />}

      {/* ── 5. YOUR DIGITAL PRESENCE ── */}
      <SectionHeader label="Chapter 4" title="Your Digital Presence — Where You're Losing Customers" />
      <p style={{ color: T.textSub, fontSize: 14, lineHeight: 1.75, marginTop: -8, marginBottom: 24 }}>
        A customer who lands on your website has already found you — but the site has to convert them. This section surfaces the specific gaps that are costing you sales today: missing customer segments, content your competitors have that you don't, and messaging that isn't landing.
      </p>
      {siteData ? (
        <>
          {/* Invisible to Google / AI */}
          {siteData.crawlerVisibility?.heroTextIsLive === false && (
            <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
              <p style={{ color: '#9a3412', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Critical: Your homepage hero is invisible to Google and AI</p>
              <p style={{ color: '#7c2d12', fontSize: 13, lineHeight: 1.65, margin: 0 }}>{siteData.crawlerVisibility.aiReadabilityNote}</p>
            </div>
          )}

          {/* Missing customer segments — the product content review reframed */}
          {siteData.productContentReview && (
            <Card style={{ marginBottom: 20, padding: '20px 24px' }}>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Customer segments you're not serving</p>
              <p style={{ color: T.textMuted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                Your website currently covers{' '}
                {(siteData.productContentReview.ageGroupCoverage || []).length > 0
                  ? `ages ${siteData.productContentReview.ageGroupCoverage.join(', ')}`
                  : 'a limited age range'}{' '}
                and{' '}
                {(siteData.productContentReview.brandsCovered || []).length > 0
                  ? `${siteData.productContentReview.brandsCovered.length} featured brands`
                  : 'a limited brand selection'}.{' '}
                {siteData.productContentReview.priceVisibility === 'hidden'
                  ? 'Pricing is not visible — shoppers who need to know "can I afford this?" before clicking deeper will leave without converting.'
                  : ''}
              </p>
              {(siteData.productContentReview.contentGaps || []).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {siteData.productContentReview.contentGaps.map((gap, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 14px', background: '#fff5f5', borderRadius: 8, borderLeft: '3px solid #f87171' }}>
                      <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 14, flexShrink: 0, marginTop: 1 }}>✗</span>
                      <p style={{ color: '#7f1d1d', fontSize: 13, lineHeight: 1.55, margin: 0 }}>{gap}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Messaging gaps — what you're not saying */}
          {(siteData.messagingGaps || []).length > 0 && (
            <Card style={{ marginBottom: 20, padding: '20px 24px' }}>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>What your messaging isn't saying</p>
              <p style={{ color: T.textMuted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>These are value messages competitors communicate that you currently don't — each one is a reason a customer might choose them over you.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {siteData.messagingGaps.map((mg, i) => (
                  <div key={i} style={{ padding: '12px 16px', background: T.surfaceAlt, borderRadius: 8, borderLeft: `3px solid ${T.border}` }}>
                    <p style={{ color: T.text, fontSize: 13, fontWeight: 700, marginBottom: mg.competitorExample || mg.recommendation ? 6 : 0 }}>{mg.gap}</p>
                    {mg.competitorExample && <p style={{ color: T.textMuted, fontSize: 12, marginBottom: mg.recommendation ? 4 : 0 }}>Competitor example: {mg.competitorExample}</p>}
                    {mg.recommendation && <p style={{ color: T.accent, fontSize: 12, fontWeight: 600, margin: 0 }}>Fix: {mg.recommendation}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Navigation gaps */}
          {(siteData.navGaps || []).length > 0 && (
            <Card style={{ marginBottom: 20, padding: '20px 24px' }}>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Navigation categories your competitors have that you don't</p>
              <p style={{ color: T.textMuted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>When a customer arrives looking for something your navigation doesn't clearly offer, they leave. These are the specific categories where competitors are capturing traffic you're missing.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {siteData.navGaps.map((gap, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', background: T.surfaceAlt, borderRadius: 8 }}>
                    <Badge label={gap.priority || 'medium'} color={gap.priority === 'high' ? 'red' : gap.priority === 'low' ? 'green' : 'yellow'} />
                    <div style={{ flex: 1 }}>
                      <span style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>{gap.category}</span>
                      {(gap.competitorsWithIt || []).length > 0 && <span style={{ color: T.textMuted, fontSize: 12, marginLeft: 8 }}>— available at {gap.competitorsWithIt.join(', ')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Hero strengths and gaps */}
          {siteData.heroMessagingAnalysis && ((siteData.heroMessagingAnalysis.targetStrengths || []).length > 0 || (siteData.heroMessagingAnalysis.targetGaps || []).length > 0) && (
            <Card style={{ marginBottom: 20, padding: '20px 24px' }}>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Homepage first impression — what's working and what's not</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {(siteData.heroMessagingAnalysis.targetStrengths || []).length > 0 && (
                  <div>
                    <p style={{ color: '#10b981', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>What's landing</p>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {siteData.heroMessagingAnalysis.targetStrengths.map((s, i) => <li key={i} style={{ color: '#065f46', fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {(siteData.heroMessagingAnalysis.targetGaps || []).length > 0 && (
                  <div>
                    <p style={{ color: '#ef4444', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>What's missing</p>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {siteData.heroMessagingAnalysis.targetGaps.map((g, i) => <li key={i} style={{ color: '#991b1b', fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>{g}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              {(siteData.heroMessagingAnalysis.competitorBestPractices || []).length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
                  <p style={{ color: '#3b82f6', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>What competitors do better</p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {siteData.heroMessagingAnalysis.competitorBestPractices.map((b, i) => <li key={i} style={{ color: '#1e40af', fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>{b}</li>)}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* Top opportunities from site */}
          {(siteData.topOpportunities || []).length > 0 && (
            <Card style={{ padding: '20px 24px' }}>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Highest-impact site improvements</p>
              <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>Ranked by potential to increase traffic and conversions.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {siteData.topOpportunities.map((opp, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 16px', background: T.surfaceAlt, borderRadius: 10, border: `1px solid ${T.border}`, alignItems: 'flex-start' }}>
                    <span style={rankCircleStyle(opp.rank || i + 1)}>{opp.rank || i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: opp.description ? 4 : 0 }}>
                        <p style={{ color: T.text, fontSize: 13, fontWeight: 700, margin: 0 }}>{opp.title || opp.opportunity}</p>
                        {opp.impact && <ImpactBadge impact={opp.impact} />}
                      </div>
                      {opp.description && <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.6, margin: 0 }}>{opp.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : <NoData />}

      {/* ── 6. SEARCH — HOW CUSTOMERS FIND YOU ── */}
      <SectionHeader label="Chapter 5" title="Search — How Customers Find You (and Why You're Missing Them)" />
      <p style={{ color: T.textSub, fontSize: 14, lineHeight: 1.75, marginTop: -8, marginBottom: 24 }}>
        Search is where purchase intent meets your brand. Every keyword below is a real query someone typed looking for what you sell. The ones you don't rank for are customers going directly to a competitor. Understanding these categories is the first step to closing that gap.
      </p>
      {seoData ? (
        <>
          {/* Keyword categories — each with explanation */}
          {seoData.keywordUniverse && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
              {KW_CATEGORIES.map(({ key, label, accentColor, accentBg, why, how }) => {
                const terms = seoData.keywordUniverse[key] || []
                if (!terms.length) return null
                return (
                  <div key={key} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ background: accentBg, borderBottom: `1px solid ${T.border}`, padding: '14px 20px' }}>
                      <p style={{ color: accentColor, fontSize: 13, fontWeight: 800, margin: 0, marginBottom: 4 }}>{label}</p>
                      <p style={{ color: accentColor, fontSize: 13, lineHeight: 1.65, margin: 0, opacity: 0.85 }}>{why}</p>
                    </div>
                    <div style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
                        {terms.map((t, i) => (
                          <span key={i} style={{ background: accentBg, color: accentColor, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20, border: `1px solid ${accentColor}22` }}>{t}</span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: T.surfaceAlt, borderRadius: 8, padding: '10px 14px' }}>
                        <span style={{ color: T.accent, fontWeight: 700, fontSize: 14, flexShrink: 0 }}>→</span>
                        <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.6, margin: 0 }}><strong>How to use these:</strong> {how}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Priority SEO Actions */}
          {(seoData.priorityActions || []).length > 0 && (
            <>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Priority actions to improve your search ranking</p>
              <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>These are the specific technical and content changes that will have the biggest impact on how many customers find you through search.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {seoData.priorityActions.map((act, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14, padding: '14px 18px', background: T.surfaceAlt, borderRadius: 10, border: `1px solid ${T.border}`, alignItems: 'flex-start' }}>
                    <span style={rankCircleStyle(act.rank || i + 1)}>{act.rank || i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: act.why ? 6 : 0 }}>
                        <p style={{ color: T.text, fontSize: 13, fontWeight: 700, margin: 0 }}>{act.action}</p>
                        {act.impact && <ImpactBadge impact={act.impact} />}
                        {act.effort && <Badge label={`${act.effort} effort`} color="gray" />}
                      </div>
                      {act.why && <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.6, margin: 0 }}>{act.why}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* On-page SEO scorecard */}
          {(seoData.pageAnalyses || []).length > 0 && (
            <>
              <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>On-page SEO scorecard</p>
              <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 12 }}>Each ✗ is a missed signal Google uses to rank pages. Title tags and H1s are the single highest-impact fixes.</p>
              <Card style={{ marginBottom: 0, padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={thSt}>Page</th>
                        <th style={{ ...thSt, textAlign: 'center' }}>Title Tag</th>
                        <th style={{ ...thSt, textAlign: 'center' }}>H1 Heading</th>
                        <th style={{ ...thSt, textAlign: 'center' }}>Meta Description</th>
                        <th style={{ ...thSt, textAlign: 'center' }}>Schema</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seoData.pageAnalyses.map((pg, i) => {
                        const check = (v) => v && v !== '' && v !== null
                        const cell = (ok) => ({ ...tdSt, textAlign: 'center', color: ok ? '#10b981' : '#ef4444', fontWeight: 700, fontSize: 14 })
                        return (
                          <tr key={i}>
                            <td style={{ ...tdSt, maxWidth: 200, wordBreak: 'break-all', fontSize: 11 }}>{pg.url || pg.pageType}</td>
                            <td style={cell(check(pg.titleTag))}>{check(pg.titleTag) ? '✓' : '✗'}</td>
                            <td style={cell(check(pg.h1))}>{check(pg.h1) ? '✓' : '✗'}</td>
                            <td style={cell(check(pg.metaDescription))}>{check(pg.metaDescription) ? '✓' : '✗'}</td>
                            <td style={cell((pg.schemaMarkup || []).length > 0)}>{(pg.schemaMarkup || []).length > 0 ? '✓' : '✗'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      ) : <NoData />}

      {/* ── 7. YOUR OPPORTUNITIES ── */}
      <SectionHeader label="Chapter 6" title="Where You Can Win — Your Biggest Opportunities" />
      <p style={{ color: T.textSub, fontSize: 14, lineHeight: 1.75, marginTop: -8, marginBottom: 24 }}>
        Everything in this report points here. These are the specific moves — drawn from the competitive gaps, content voids, SEO weaknesses, and customer insights above — that represent your clearest path to growth.
      </p>

      {/* Strategic opportunities */}
      {(data.opportunitiesRanked || []).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
          {data.opportunitiesRanked.map((opp, i) => (
            <Card key={i} style={{ padding: '20px 24px', borderLeft: `4px solid ${T.accent}` }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 32, fontWeight: 900, color: T.accent, lineHeight: 1, flexShrink: 0, minWidth: 36, marginTop: 2 }}>{opp.rank}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ color: T.text, fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{opp.opportunity}</p>
                  {opp.rationale && <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.7, marginBottom: opp.estimatedImpact ? 10 : 0 }}>{opp.rationale}</p>}
                  {opp.estimatedImpact && (
                    ['high', 'medium', 'low'].includes(String(opp.estimatedImpact).toLowerCase())
                      ? <ImpactBadge impact={String(opp.estimatedImpact).toLowerCase()} />
                      : <p style={{ color: T.textMuted, fontSize: 12, fontStyle: 'italic', margin: 0 }}>{opp.estimatedImpact}</p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Competitive gaps */}
      {(data.competitiveGapsToClose || []).length > 0 && (
        <>
          <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 4, marginTop: 8 }}>Competitive gaps to close</p>
          <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>Specific areas where competitors currently have an advantage — each one is an opportunity to level the playing field.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {data.competitiveGapsToClose.map((gap, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 16px', background: T.surfaceAlt, borderRadius: 10, border: `1px solid ${T.border}`, alignItems: 'flex-start' }}>
                <Badge label={gap.priority || 'medium'} color={gap.priority === 'high' ? 'red' : gap.priority === 'low' ? 'green' : 'yellow'} />
                <div style={{ flex: 1 }}>
                  <p style={{ color: T.text, fontSize: 13, fontWeight: 600, margin: 0, marginBottom: gap.competitor ? 3 : 0 }}>{gap.gap}</p>
                  {gap.competitor && <p style={{ color: T.textMuted, fontSize: 12, margin: 0 }}>Currently an advantage for {gap.competitor}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Immediate wins */}
      {(data.immediateWins || []).length > 0 && (
        <>
          <p style={{ color: T.text, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Start here — immediate wins</p>
          <p style={{ color: T.textMuted, fontSize: 13, marginBottom: 16 }}>High-impact actions that can be completed quickly with resources you already have.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.immediateWins.map((win, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, padding: '18px 20px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, alignItems: 'flex-start' }}>
                <span style={rankCircleStyle(win.rank || i + 1)}>{win.rank || i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: T.text, fontSize: 14 }}>{win.title}</span>
                    <ImpactBadge impact={win.impact} />
                    {win.effort && <Badge label={`${win.effort} effort`} color="gray" />}
                  </div>
                  <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.65, margin: 0 }}>{win.description}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(data.opportunitiesRanked || []).length === 0 && (data.competitiveGapsToClose || []).length === 0 && (data.immediateWins || []).length === 0 && <NoData />}

      <div style={{ height: 48 }} />
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
    // Wait briefly so the child process has time to flip discoveryStatus to 'running'
    await new Promise(r => setTimeout(r, 1500))
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
