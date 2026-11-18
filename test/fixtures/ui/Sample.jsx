// Fixture for test/ui_i18n.test.js: what the extractor must keep and ignore.
import { useState } from 'react'

const TABS = [{ id: 'overview', label: 'Overview tab' }]

function scoreSeo(seo) {
  const signals = []
  if (!seo.metaDescription) signals.push({ field: 'Meta Description', rec: 'No meta description: Google picks random text' })
  else signals.push({ field: 'Meta Description', rec: `Too short (${seo.metaDescription.length} chars)` })
  return signals
}

export function Sample({ comps, x, seo, loading }) {
  const [msg, setErrorMsg] = useState(null)
  const level = 'high'
  console.log('console only message')
  if (!comps) throw new Error('Thrown, never shown')
  const n = comps.length
  const save = () => setErrorMsg('Could not save the profile')
  return (
    <div className="card-title" style={{ border: '1px solid #ddd' }}>
      <h2>Competitor overview</h2>
      <p>Identified Competitors ({n})</p>
      <input placeholder="Search brands" aria-label="Close panel" />
      <a href="https://example.com/">Instagram</a>
      <span>TikTok</span>
      {loading ? 'Loading data...' : 'Nothing yet'}
      {x === 'Compared Value' && <b>{level}</b>}
      {['Signal', 'Current Value'].map(h => <th key={h}>{h}</th>)}
      {TABS.map(tb => <i key={tb.id}>{tb.label}</i>)}
      {scoreSeo(seo).map(s => <em key={s.field}>{s.rec}</em>)}
      <button onClick={save} data-k={localStorage.getItem('Stored Key')}>{msg}</button>
      <small>{fetch('site_intelligence') && null}</small>
      <span>{t('Already wrapped')}</span>
    </div>
  )
}
