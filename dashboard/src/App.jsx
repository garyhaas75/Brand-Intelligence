import { useState, useEffect } from 'react'
import './App.css'

const API = 'http://localhost:3001/api'

async function fetchEndpoint(path) {
  try {
    const res = await fetch(`${API}${path}`)
    if (!res.ok) return null
    const data = await res.json()
    return Object.keys(data).length ? data : null
  } catch {
    return null
  }
}

function Badge({ color, children }) {
  const colors = {
    green:  { bg: '#d1fae5', text: '#065f46' },
    red:    { bg: '#fee2e2', text: '#991b1b' },
    yellow: { bg: '#fef3c7', text: '#92400e' },
    blue:   { bg: '#dbeafe', text: '#1e40af' },
    purple: { bg: '#ede9fe', text: '#5b21b6' },
    gray:   { bg: '#f3f4f6', text: '#374151' },
  }
  const c = colors[color] || colors.gray
  return (
    <span style={{ background: c.bg, color: c.text, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function Card({ title, subtitle, children, accent }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', marginBottom: 20, borderLeft: accent ? `4px solid ${accent}` : undefined }}>
      {title && <div style={{ fontWeight: 700, fontSize: 16, marginBottom: subtitle ? 2 : 12, color: '#111827' }}>{title}</div>}
      {subtitle && <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>{subtitle}</div>}
      {children}
    </div>
  )
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ textAlign: 'center', padding: '16px 20px', background: '#f9fafb', borderRadius: 10, flex: 1, minWidth: 100 }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || '#111827', lineHeight: 1 }}>{value ?? '—'}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ children }) {
  return <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: '32px 0 16px', borderBottom: '2px solid #f3f4f6', paddingBottom: 10 }}>{children}</h2>
}

function OverviewTab({ catalog, siteIntel, siteAnalysis, emailIntel, socialIntel, content, apifyUsage }) {
  const brandStatus = (siteIntel?.brands || []).map(b => ({
    name: b.name,
    navCount: b.navigation?.length || 0,
    botBlocked: b.botBlocked,
    error: !!b.error,
  }))

  const emailSubmitted = (emailIntel?.signups || []).filter(s => s.status === 'submitted').length
  const ckEngagement = socialIntel?.brands?.find(b => b.id === 'calvin_klein')?.summary?.avgEngagement
  const akEngagement = socialIntel?.brands?.find(b => b.id === 'anne_klein')?.summary?.avgEngagement

  return (
    <div>
      <SectionHeader>Platform Status</SectionHeader>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Products Scraped" value={catalog?.totalProducts?.toLocaleString()} sub="AK catalog" color="#6366f1" />
        <Stat label="Category Gaps" value={siteIntel?.categoryGapAnalysis?.gaps?.length} sub="vs competitors" color="#f59e0b" />
        <Stat label="Email Signups" value={`${emailSubmitted}/5`} sub="competitors" color="#10b981" />
        <Stat label="CK Engagement" value={ckEngagement ? (ckEngagement / 1000).toFixed(0) + 'K' : '—'} sub="avg/post" color="#ef4444" />
        <Stat label="AK Engagement" value={akEngagement || 0} sub="avg/post" color="#6b7280" />
        <Stat label="Content Assets" value={
          (content?.content?.emailCampaigns?.emailCampaigns?.length || 0) +
          (content?.content?.heroHeadlines?.heroHeadlines?.length || 0) +
          (content?.content?.instagramCaptions?.instagramCaptions?.length || 0)
        } sub="generated" color="#8b5cf6" />
      </div>

      <SectionHeader>Competitor Scrape Status</SectionHeader>
      <Card>
        {brandStatus.map(b => (
          <div key={b.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{b.name}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#6b7280' }}>{b.navCount} nav items</span>
              {b.botBlocked && <Badge color="red">Bot-blocked</Badge>}
              {b.error && !b.botBlocked && <Badge color="yellow">Error</Badge>}
              {!b.botBlocked && !b.error && b.navCount > 0 && <Badge color="green">✓ Scraped</Badge>}
            </div>
          </div>
        ))}
      </Card>

      {apifyUsage && (
        <>
          <SectionHeader>Apify Usage</SectionHeader>
          <Card>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <Stat label="Plan" value={apifyUsage.planId?.toUpperCase()} color="#6366f1" />
              {apifyUsage.monthlyUsageCreditsCents != null && apifyUsage.monthlyBasePriceCents != null && (
                <>
                  <Stat
                    label="Credits Used"
                    value={`$${(apifyUsage.monthlyUsageCreditsCents / 100).toFixed(2)}`}
                    sub={`of $${(apifyUsage.monthlyBasePriceCents / 100).toFixed(0)}/mo`}
                    color={apifyUsage.monthlyUsageCreditsCents / apifyUsage.monthlyBasePriceCents > 0.8 ? '#ef4444' : apifyUsage.monthlyUsageCreditsCents / apifyUsage.monthlyBasePriceCents > 0.5 ? '#f59e0b' : '#10b981'}
                  />
                  <Stat label="Remaining" value={`$${Math.max(0, (apifyUsage.monthlyBasePriceCents - apifyUsage.monthlyUsageCreditsCents) / 100).toFixed(2)}`} sub="this month" color="#6b7280" />
                </>
              )}
            </div>
            {apifyUsage.monthlyUsageCreditsCents != null && apifyUsage.monthlyBasePriceCents != null && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                  <span>Monthly usage</span>
                  <span>{Math.round(apifyUsage.monthlyUsageCreditsCents / apifyUsage.monthlyBasePriceCents * 100)}%</span>
                </div>
                <div style={{ background: '#f3f4f6', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 6,
                    width: `${Math.min(100, apifyUsage.monthlyUsageCreditsCents / apifyUsage.monthlyBasePriceCents * 100)}%`,
                    background: apifyUsage.monthlyUsageCreditsCents / apifyUsage.monthlyBasePriceCents > 0.8 ? '#ef4444' : apifyUsage.monthlyUsageCreditsCents / apifyUsage.monthlyBasePriceCents > 0.5 ? '#f59e0b' : '#10b981',
                  }} />
                </div>
                {apifyUsage.monthlyUsageCreditsCents / apifyUsage.monthlyBasePriceCents > 0.8 && (
                  <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6, fontWeight: 600 }}>Warning: over 80% of monthly credits used. Consider upgrading your plan.</div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      <SectionHeader>Top Positioning Opportunity</SectionHeader>
      {siteAnalysis?.messagingAnalysis?.positioningOpportunity && (
        <Card accent="#6366f1">
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#374151', margin: 0 }}>
            {siteAnalysis.messagingAnalysis.positioningOpportunity}
          </p>
        </Card>
      )}

      <SectionHeader>Catalog Health Warning</SectionHeader>
      {siteAnalysis?.catalogAnalysis?.catalogHealth && (
        <Card accent="#f59e0b">
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#374151', margin: 0 }}>
            {siteAnalysis.catalogAnalysis.catalogHealth}
          </p>
        </Card>
      )}
    </div>
  )
}

function CatalogTab({ catalog }) {
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('All')

  if (!catalog?.products) return <div style={{ padding: 40, color: '#6b7280', textAlign: 'center' }}>No catalog data. Run npm run scrape:products</div>

  const newArrivalCount = catalog.products.filter(p => p.isNewArrival).length
  const categories = ['All', `New Arrivals (${newArrivalCount})`, ...Object.keys(catalog.categoryCounts || {}).sort((a, b) => catalog.categoryCounts[b] - catalog.categoryCounts[a])]
  const filtered = catalog.products.filter(p => {
    if (filterCat === 'All') return true
    if (filterCat.startsWith('New Arrivals')) return p.isNewArrival
    return p.category === filterCat
  }).filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 200)

  return (
    <div>
      <SectionHeader>Product Catalog</SectionHeader>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Total Products" value={catalog.totalProducts?.toLocaleString()} color="#6366f1" />
        <Stat label="Min Price" value={catalog.priceStats?.min} color="#10b981" />
        <Stat label="Max Price" value={catalog.priceStats?.max} color="#ef4444" />
        <Stat label="Avg Price" value={catalog.priceStats?.avg} color="#f59e0b" />
      </div>

      <Card title="Category Breakdown">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(catalog.categoryCounts || {}).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
            <div key={cat} onClick={() => setFilterCat(cat === filterCat ? 'All' : cat)}
              style={{ background: filterCat === cat ? '#6366f1' : '#f3f4f6', color: filterCat === cat ? '#fff' : '#374151', padding: '4px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
              {cat} <strong>({count})</strong>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search products..." style={{ flex: 1, padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          style={{ padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>Showing {filtered.length} of {catalog.products.filter(p => filterCat === 'All' || p.category === filterCat).length} products</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {filtered.map(p => (
          <div key={p.id} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, lineHeight: 1.4 }}>{p.name}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <Badge color="blue">{p.category}</Badge>
              {p.isNewArrival && <Badge color="green">New</Badge>}
              {p.onSale && <Badge color="red">Sale</Badge>}
            </div>
            <div style={{ fontSize: 13, color: '#374151' }}>
              <strong>{p.price}</strong>
              {p.originalPrice && <span style={{ color: '#9ca3af', textDecoration: 'line-through', marginLeft: 6 }}>{p.originalPrice}</span>}
            </div>
            {p.colors.length > 0 && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Colors: {p.colors.slice(0, 3).join(', ')}{p.colors.length > 3 ? ` +${p.colors.length - 3}` : ''}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function SiteIntelTab({ siteIntel, siteAnalysis }) {
  if (!siteIntel) return <div style={{ padding: 40, color: '#6b7280', textAlign: 'center' }}>No site intelligence data. Run npm run scrape:sites</div>

  const realGaps = (siteIntel.categoryGapAnalysis?.gaps || []).filter(g =>
    !g.category.includes('{') && !g.category.includes('.cls') && g.category.length < 50 && g.category !== 'SHOP NOW' && !/^United States/.test(g.category)
  )

  return (
    <div>
      <SectionHeader>Competitor Navigation</SectionHeader>
      {(siteIntel.brands || []).map(brand => (
        <Card key={brand.id} title={brand.name} subtitle={brand.url}
          accent={brand.id === 'anne_klein' ? '#6366f1' : brand.botBlocked ? '#ef4444' : '#10b981'}>
          {brand.botBlocked && <Badge color="red">Bot-blocked — use Apify</Badge>}
          {brand.error && !brand.botBlocked && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>⚠ {brand.error.substring(0, 120)}</div>}
          {brand.heroContent?.headline && (
            <div style={{ fontSize: 13, fontStyle: 'italic', color: '#374151', marginBottom: 8, padding: '8px 12px', background: '#f9fafb', borderRadius: 6 }}>
              Hero: "{brand.heroContent.headline}"
            </div>
          )}
          {brand.featuredCategories?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {brand.featuredCategories.slice(0, 30).map((c, i) => (
                <span key={i} style={{ background: '#f3f4f6', color: '#374151', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{c}</span>
              ))}
            </div>
          )}
          {brand.promoBanners?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>PROMO BANNERS</div>
              {brand.promoBanners.slice(0, 3).map((p, i) => (
                <div key={i} style={{ fontSize: 12, color: '#374151', padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}>"{p}"</div>
              ))}
            </div>
          )}
        </Card>
      ))}

      <SectionHeader>Category Gaps ({realGaps.length} found)</SectionHeader>
      <Card subtitle="Categories on competitor sites not present on anneklein.com">
        {realGaps.map((g, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f9fafb' }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{g.category}</span>
            <div style={{ display: 'flex', gap: 4 }}>{g.seenAt.map(b => <Badge key={b} color="blue">{b}</Badge>)}</div>
          </div>
        ))}
      </Card>

      <SectionHeader>Claude's Nav Recommendations</SectionHeader>
      {(siteAnalysis?.navigationAnalysis?.navigationRecommendations || []).map((rec, i) => (
        <Card key={i} accent="#6366f1">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ background: '#6366f1', color: '#fff', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: '#374151' }}>{rec}</p>
          </div>
        </Card>
      ))}

      <SectionHeader>Top Missing Categories (Claude Analysis)</SectionHeader>
      {(siteAnalysis?.navigationAnalysis?.missingCategories || []).map((cat, i) => (
        <Card key={i} accent="#f59e0b" title={typeof cat === 'string' ? cat : cat.category}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: '#374151' }}>
            {typeof cat === 'object' ? cat.rationale : ''}
          </p>
        </Card>
      ))}
    </div>
  )
}

function EmailTab({ inboxData, emailAnalysis }) {
  const inboxBrands = inboxData?.brands || []
  const analysis = emailAnalysis?.analysis || {}
  const totalReceived = inboxBrands.reduce((s, b) => s + (b.summary?.count || 0), 0)
  const brandsActive = inboxBrands.filter(b => b.emails?.length > 0).length

  const gradeColor = g => g === 'A' ? '#10b981' : g === 'B' ? '#f59e0b' : g === 'C' ? '#ef4444' : '#9ca3af'
  const categoryColor = c => {
    if (c === 'Welcome') return '#6366f1'
    if (c === 'Rewards') return '#f59e0b'
    if (c === 'Promotion') return '#10b981'
    if (c === 'Product Launch') return '#3b82f6'
    if (c === 'Urgency') return '#ef4444'
    if (c === 'Editorial') return '#8b5cf6'
    return '#9ca3af'
  }

  if (!inboxBrands.length) return (
    <div style={{ padding: 40, color: '#6b7280', textAlign: 'center' }}>
      No inbox data. Run <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>npm run check:inbox</code>
    </div>
  )

  const welcomeBenchmark = analysis.emailTypeAnalysis?.welcome?.benchmark || []

  return (
    <div>
      {/* AK Strategy — top of page */}
      {analysis.akEmailStrategy && (
        <>
          <SectionHeader>AK Email Strategy</SectionHeader>
          <Card accent="#6366f1">
            {analysis.akEmailStrategy.programGaps?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>PROGRAM GAPS</div>
                {analysis.akEmailStrategy.programGaps.map((g, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ color: '#ef4444', fontWeight: 700, flexShrink: 0 }}>✕</span>
                    <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.5 }}>{g}</p>
                  </div>
                ))}
              </div>
            )}
            {analysis.akEmailStrategy.emailCalendarSuggestion && (
              <div style={{ marginBottom: 14, background: '#f0fdf4', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', marginBottom: 4 }}>RECOMMENDED EMAIL CADENCE</div>
                <p style={{ margin: 0, fontSize: 14, color: '#065f46', lineHeight: 1.6 }}>{analysis.akEmailStrategy.emailCalendarSuggestion}</p>
              </div>
            )}
            {analysis.akEmailStrategy.priorityActions?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>PRIORITY ACTIONS</div>
                {analysis.akEmailStrategy.priorityActions.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ background: '#6366f1', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                    <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{a}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* Email type analysis — welcome benchmark */}
      {welcomeBenchmark.length > 0 && (
        <>
          <SectionHeader>Welcome Email Benchmark</SectionHeader>
          {welcomeBenchmark.map((b, i) => (
            <Card key={i} accent={gradeColor(b.grade)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{b.brand}</span>
                  {b.subjectLine && <div style={{ fontSize: 13, fontStyle: 'italic', color: '#374151', marginTop: 2 }}>"{b.subjectLine}"</div>}
                </div>
                {b.grade && (
                  <span style={{ background: gradeColor(b.grade), color: '#fff', borderRadius: 6, padding: '2px 10px', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{b.grade}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: b.tactic ? 8 : 0 }}>
                {b.offer && b.offer !== 'none' && b.offer !== 'None' && <Badge color="green">{b.offer}</Badge>}
                {b.loyaltyPush && !['no', 'none', 'not detected'].includes(b.loyaltyPush?.toLowerCase()) && <Badge color="purple">Loyalty push</Badge>}
              </div>
              {b.tactic && <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>{b.tactic}</div>}
            </Card>
          ))}
          {analysis.emailTypeAnalysis?.welcome?.akRecommendation && (
            <Card accent="#10b981">
              <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', marginBottom: 4 }}>AK WELCOME RECOMMENDATION</div>
              <p style={{ margin: 0, fontSize: 14, color: '#065f46', lineHeight: 1.6 }}>{analysis.emailTypeAnalysis.welcome.akRecommendation}</p>
            </Card>
          )}
        </>
      )}

      {/* Per-brand inbox cards */}
      <SectionHeader>Competitor Email Intelligence</SectionHeader>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Monitoring {inboxBrands.length} brands · {totalReceived} emails received · {brandsActive} active
        {!analysis.akEmailStrategy && <span> · Run <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>npm run analyze:inbox</code> for strategy</span>}
      </div>

      {inboxBrands.map(brand => {
        const emailCount = brand.emails?.length || 0
        const hasEmail = emailCount > 0
        const voiceEntry = (analysis.brandVoiceNotes || []).find(b => b.brand === brand.name)
        const accentColor = hasEmail ? '#6366f1' : '#e5e7eb'

        return (
          <Card key={brand.name} accent={accentColor}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{brand.name}</div>
                {brand.url && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{brand.url}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <Badge color={hasEmail ? 'green' : 'gray'}>{hasEmail ? `${emailCount} email${emailCount > 1 ? 's' : ''} received` : 'No emails yet'}</Badge>
              </div>
            </div>

            {hasEmail ? (
              <>
                {/* Category type breakdown */}
                {brand.summary?.categories && Object.keys(brand.summary.categories).length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {Object.entries(brand.summary.categories).map(([cat, count]) => (
                      <span key={cat} style={{ background: categoryColor(cat) + '22', color: categoryColor(cat), border: `1px solid ${categoryColor(cat)}44`, borderRadius: 10, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
                        {cat} ({count})
                      </span>
                    ))}
                  </div>
                )}

                {/* All emails list */}
                <div>
                  {brand.emails.map((e, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: i < brand.emails.length - 1 ? '1px solid #f3f4f6' : 'none', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          {e.category && (
                            <span style={{ background: categoryColor(e.category) + '22', color: categoryColor(e.category), borderRadius: 8, padding: '1px 7px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                              {e.category}
                            </span>
                          )}
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{e.subject}</span>
                        </div>
                        {e.snippet && (
                          <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.4 }}>
                            {e.snippet.replace(/\s*͏\s*/g, ' ').replace(/&#39;/g, "'").trim().substring(0, 140)}
                          </div>
                        )}
                      </div>
                      {e.offer && <Badge color="green" style={{ flexShrink: 0 }}>{e.offer}</Badge>}
                    </div>
                  ))}
                </div>

                {/* Brand voice */}
                {voiceEntry && (
                  <div style={{ background: '#ede9fe', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#5b21b6', marginTop: 10 }}>
                    <strong>Voice ({voiceEntry.tone}):</strong> {voiceEntry.observation}
                    {voiceEntry.vsAK && <div style={{ marginTop: 4, fontSize: 12, color: '#7c3aed' }}><strong>vs AK:</strong> {voiceEntry.vsAK}</div>}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#9ca3af', padding: '4px 0' }}>No emails received yet.</div>
            )}
          </Card>
        )
      })}

      {/* Subject line tactics */}
      {analysis.subjectLineTactics?.length > 0 && (
        <>
          <SectionHeader>Subject Line Tactics</SectionHeader>
          {analysis.subjectLineTactics.map((t, i) => (
            <Card key={i} accent={t.useForAK?.toLowerCase().startsWith('yes') ? '#10b981' : '#e5e7eb'}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{t.tactic}</span>
                  {t.emailType && (
                    <span style={{ background: categoryColor(t.emailType) + '22', color: categoryColor(t.emailType), borderRadius: 8, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                      {t.emailType}
                    </span>
                  )}
                </div>
                <Badge color={t.useForAK?.toLowerCase().startsWith('yes') ? 'green' : 'gray'}>
                  {t.useForAK?.toLowerCase().startsWith('yes') ? 'Use for AK' : 'Skip'}
                </Badge>
              </div>
              <div style={{ fontSize: 13, fontStyle: 'italic', color: '#374151', marginBottom: 4 }}>
                "{t.example}" <span style={{ fontSize: 12, color: '#9ca3af' }}>— {t.brand}</span>
              </div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>{t.useForAK}</div>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}

function SocialTab({ socialIntel }) {
  if (!socialIntel?.brands) return <div style={{ padding: 40, color: '#6b7280', textAlign: 'center' }}>No social data. Run npm run module2</div>

  const intel = socialIntel.competitiveIntel || {}

  return (
    <div>
      <SectionHeader>Instagram Intelligence</SectionHeader>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="AK Avg Engagement" value={intel.akAvgEngagement || 0} color={intel.akAvgEngagement ? '#10b981' : '#ef4444'} />
        <Stat label="Competitor Avg" value={intel.competitorAvgEngagement?.toLocaleString()} color="#6366f1" />
        <Stat label="Engagement Gap" value={intel.engagementGap?.toLocaleString()} color="#f59e0b" sub="competitors ahead" />
      </div>

      {(socialIntel.brands || []).map(b => (
        <Card key={b.id} title={`${b.name} (@${b.handle})`}
          accent={b.id === 'anne_klein' ? '#6366f1' : '#e5e7eb'}>
          {b.error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>Error: {b.error.substring(0, 100)}</div>}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="Posts" value={b.summary?.postCount || 0} />
            <Stat label="Avg Engagement" value={b.summary?.avgEngagement?.toLocaleString() || 0} color="#6366f1" />
          </div>

          {b.summary?.themes?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>CONTENT THEMES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {b.summary.themes.map((t, i) => (
                  <span key={i} style={{ background: '#f3f4f6', color: '#374151', padding: '3px 10px', borderRadius: 12, fontSize: 12 }}>
                    {t.theme} <strong>({t.count})</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {b.summary?.topHashtags?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>TOP HASHTAGS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {b.summary.topHashtags.slice(0, 10).map((h, i) => (
                  <Badge key={i} color="blue">#{h.tag}</Badge>
                ))}
              </div>
            </div>
          )}

          {b.summary?.recentCaptions?.filter(c => c.caption).length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>RECENT POSTS</div>
              {b.summary.recentCaptions.filter(c => c.caption).slice(0, 3).map((c, i) => (
                <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6 }}>"{c.caption.substring(0, 140)}{c.caption.length > 140 ? '…' : ''}"</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>❤️ {c.likes?.toLocaleString()} · 💬 {c.comments}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}

      {intel.competitorHashtagsNotUsedByAK?.length > 0 && (
        <>
          <SectionHeader>Hashtags Competitors Use That AK Doesn't</SectionHeader>
          <Card>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {intel.competitorHashtagsNotUsedByAK.slice(0, 20).map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Badge color="purple">#{h.tag}</Badge>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>{h.brand}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function SEOTab({ seoIntel, content }) {
  if (!seoIntel?.queryAnalysis?.totalQueries) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>GSC Data Not Available</div>
        <div style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.7, maxWidth: 480, margin: '0 auto' }}>
          The Google Search Console credentials don't have permission for anneklein.com yet.<br /><br />
          <strong>Fix:</strong> Add <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>garyclaudeai@gmail.com</code> as a verified user in GSC (Settings → Users & permissions), then run <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>npm run module4</code>.
        </div>
      </div>
    )
  }

  const qa = seoIntel.queryAnalysis

  return (
    <div>
      <SectionHeader>Search Performance</SectionHeader>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Total Clicks" value={qa.totalClicks?.toLocaleString()} color="#10b981" />
        <Stat label="Impressions" value={qa.totalImpressions?.toLocaleString()} color="#6366f1" />
        <Stat label="Avg CTR" value={qa.avgCTR + '%'} color="#f59e0b" />
        <Stat label="Branded Clicks" value={qa.brandedClickShare + '%'} color="#8b5cf6" />
        <Stat label="Quick Wins" value={qa.quickWins?.length} sub="pos 4–15" color="#ef4444" />
        <Stat label="CTR Opps" value={qa.ctrOpportunities?.length} sub="low CTR" color="#f59e0b" />
      </div>

      {qa.top50Queries?.length > 0 && (
        <>
          <SectionHeader>Top Queries</SectionHeader>
          <Card>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  {['Query', 'Clicks', 'Impressions', 'CTR', 'Position', 'Type'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {qa.top50Queries.slice(0, 25).map((q, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '7px 8px', fontWeight: 500 }}>{q.query}</td>
                    <td style={{ padding: '7px 8px', color: '#10b981', fontWeight: 600, whiteSpace: 'nowrap' }}>{q.clicks}</td>
                    <td style={{ padding: '7px 8px', color: '#6b7280', whiteSpace: 'nowrap' }}>{q.impressions?.toLocaleString()}</td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{q.ctr}%</td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{q.position}</td>
                    <td style={{ padding: '7px 8px' }}><Badge color={q.type === 'branded' ? 'purple' : q.type === 'transactional' ? 'green' : 'gray'}>{q.type}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
        </>
      )}

      {qa.quickWins?.length > 0 && (
        <>
          <SectionHeader>Quick Wins (Position 4–15)</SectionHeader>
          <Card subtitle="High impressions, achievable ranking — small content changes could move these to page 1">
            {qa.quickWins.slice(0, 15).map((q, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{q.query}</span>
                <div style={{ display: 'flex', gap: 12, fontSize: 13, color: '#6b7280' }}>
                  <span>pos <strong>{q.position}</strong></span>
                  <span>{q.impressions?.toLocaleString()} impr</span>
                  <span>{q.ctr}% CTR</span>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {content?.content?.seoQuickWins?.seoQuickWins?.length > 0 && (
        <>
          <SectionHeader>Claude's SEO Action Plan</SectionHeader>
          {content.content.seoQuickWins.seoQuickWins.map((w, i) => (
            <Card key={i} title={w.keyword} accent="#10b981">
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>PAGE TO OPTIMIZE: </span>
                <span style={{ fontSize: 13 }}>{w.currentPage}</span>
              </div>
              <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 2 }}>TITLE TAG</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{w.titleTag}</div>
              </div>
              <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 2 }}>META DESCRIPTION</div>
                <div style={{ fontSize: 13, color: '#374151' }}>{w.metaDescription}</div>
              </div>
              {w.contentAdditions?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>ON-PAGE ADDITIONS</div>
                  {w.contentAdditions.map((a, j) => (
                    <div key={j} style={{ fontSize: 13, color: '#374151', padding: '3px 0 3px 12px', borderLeft: '3px solid #10b981', marginBottom: 4 }}>{a}</div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  )
}

const CATEGORY_KEYWORDS = [
  { keywords: ['blazer', 'jacket', 'suit'], category: 'Blazers & Jackets' },
  { keywords: ['dress', 'jumpsuit'], category: 'Dresses & Jumpsuits' },
  { keywords: ['heel', 'pump'], category: 'Heels' },
  { keywords: ['boot'], category: 'Boots' },
  { keywords: ['flat', 'loafer'], category: 'Flats & Loafers' },
  { keywords: ['sandal', 'slide'], category: 'Sandals & Slides' },
  { keywords: ['shoe', 'footwear'], category: 'Shoes' },
  { keywords: ['jewelry', 'necklace', 'earring', 'bracelet', 'watch'], category: 'Jewelry' },
  { keywords: ['bag', 'handbag', 'tote', 'purse'], category: 'Handbags' },
  { keywords: ['top', 'blouse', 'shirt'], category: 'Tops' },
  { keywords: ['pant', 'trouser', 'bottom', 'skirt'], category: 'Clothing' },
  { keywords: ['sweater', 'knit'], category: 'Sweaters' },
  { keywords: ['coat', 'outerwear'], category: 'Outerwear' },
]

function getProductsForCampaign(theme, brief, catalog, count = 4) {
  if (!catalog?.products) return []
  const text = ((theme || '') + ' ' + (brief || '')).toLowerCase()
  let targetCategory = null
  for (const { keywords, category } of CATEGORY_KEYWORDS) {
    if (keywords.some(kw => text.includes(kw))) { targetCategory = category; break }
  }
  const pool = catalog.products.filter(p =>
    p.image && (targetCategory ? (p.category === targetCategory || p.allCategories?.includes(targetCategory)) : true)
  )
  return pool.slice(0, count)
}

function ProductCard({ product }) {
  return (
    <a href={product.href} target="_blank" rel="noreferrer"
      style={{ textDecoration: 'none', color: 'inherit', display: 'block', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', transition: 'box-shadow 0.15s' }}>
      <img src={product.image} alt={product.name}
        style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block', background: '#f9fafb' }}
        onError={e => { e.target.style.display = 'none' }} />
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, marginBottom: 4, color: '#111827' }}>{product.name}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6366f1' }}>{product.price}</div>
        {product.onSale && <Badge color="red">Sale</Badge>}
      </div>
    </a>
  )
}

function ContentGeneratorPanel() {
  const CONTENT_TYPES = [
    'Email campaign',
    'Instagram caption',
    'Hero headline',
    'Product description',
    'Blog post outline',
    'Promotional banner copy',
    'SMS/text message',
    'Ad copy',
  ]
  const [contentType, setContentType] = useState(CONTENT_TYPES[0])
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function generate() {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType, prompt }),
      })
      const data = await res.json()
      if (data.error) setError(data.error)
      else setResult(data.content)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <div style={{ background: '#f0f0ff', border: '2px solid #6366f1', borderRadius: 12, padding: '20px 24px', marginBottom: 28 }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: '#4338ca', marginBottom: 4 }}>On-Demand Content Generator</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Claude generates content grounded in AK brand intel and competitive landscape.</div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={contentType} onChange={e => setContentType(e.target.value)}
          style={{ padding: '8px 14px', border: '1px solid #c4b5fd', borderRadius: 8, fontSize: 14, background: '#fff', minWidth: 200 }}>
          {CONTENT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder="Describe what you need… e.g. 'Write a welcome email for new subscribers with a 15% off offer, focusing on professional workwear'"
        rows={3}
        style={{ width: '100%', padding: '10px 14px', border: '1px solid #c4b5fd', borderRadius: 8, fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }} />

      <button onClick={generate} disabled={loading || !prompt.trim()}
        style={{ padding: '10px 24px', background: loading || !prompt.trim() ? '#a5b4fc' : '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer' }}>
        {loading ? 'Generating…' : 'Generate with Claude'}
      </button>

      {error && (
        <div style={{ marginTop: 16, background: '#fee2e2', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#991b1b' }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>GENERATED {contentType.toUpperCase()}</div>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px 18px', fontSize: 14, lineHeight: 1.7, color: '#111827', whiteSpace: 'pre-wrap' }}>
            {result}
          </div>
          <button onClick={() => { navigator.clipboard?.writeText(result) }}
            style={{ marginTop: 8, padding: '6px 14px', background: '#f3f4f6', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
            Copy to clipboard
          </button>
        </div>
      )}
    </div>
  )
}

function ContentTab({ content, catalog }) {
  const [activeSection, setActiveSection] = useState('email')
  const c = content?.content

  const sections = [
    { id: 'email',    label: '📧 Email Campaigns',    count: c?.emailCampaigns?.emailCampaigns?.length },
    { id: 'hero',     label: '🏠 Hero Headlines',     count: c?.heroHeadlines?.heroHeadlines?.length },
    { id: 'ig',       label: '📱 Instagram',          count: c?.instagramCaptions?.instagramCaptions?.length },
    { id: 'seo',      label: '🔍 SEO Descriptions',   count: c?.collectionDescriptions?.collectionDescriptions?.length },
    { id: 'calendar', label: '📅 Editorial Calendar', count: c?.editorialCalendar?.editorialCalendar?.length },
  ]

  return (
    <div>
      <ContentGeneratorPanel />

      {!c ? (
        <div style={{ padding: 40, color: '#6b7280', textAlign: 'center' }}>No scheduled content data. Run <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>npm run module5</code></div>
      ) : (
      <>
      <SectionHeader>Generated Content Assets</SectionHeader>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
              background: activeSection === s.id ? '#6366f1' : '#f3f4f6',
              color: activeSection === s.id ? '#fff' : '#374151' }}>
            {s.label} {s.count ? `(${s.count})` : ''}
          </button>
        ))}
      </div>

      {activeSection === 'email' && (c?.emailCampaigns?.emailCampaigns || []).map((e, i) => {
        const products = getProductsForCampaign(e.theme, e.brief, catalog)
        return (
          <Card key={i} title={`Week ${e.week}${e.dayOfWeek ? ' · ' + e.dayOfWeek : ''}: ${e.theme}`} accent="#6366f1">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>SUBJECT LINE</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>"{e.subjectLine}"</div>
              </div>
              <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>PREVIEW TEXT</div>
                <div style={{ fontSize: 13, color: '#374151' }}>{e.previewText}</div>
              </div>
            </div>
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>BRIEF</div>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{e.brief}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 13, marginBottom: products.length ? 14 : 0 }}>
              <span>🎯 CTA: <strong>{e.ctaButton}</strong></span>
              <span>📅 {e.sendTiming}</span>
            </div>
            {products.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>SUGGESTED PRODUCTS</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {products.map(p => <ProductCard key={p.id} product={p} />)}
                </div>
              </div>
            )}
          </Card>
        )
      })}

      {activeSection === 'hero' && (c?.heroHeadlines?.heroHeadlines || []).map((h, i) => (
        <Card key={i} accent="#8b5cf6">
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', marginBottom: 10, lineHeight: 1.3 }}>"{h.headline}"</div>
          <div style={{ fontSize: 14, color: '#374151', marginBottom: 10, lineHeight: 1.6 }}>{h.subhead}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
            <Badge color="purple">CTA: {h.cta}</Badge>
            <span style={{ color: '#6b7280' }}>{h.bestFor}</span>
          </div>
        </Card>
      ))}

      {activeSection === 'ig' && (c?.instagramCaptions?.instagramCaptions || []).map((g, i) => {
        const products = getProductsForCampaign(g.category, g.caption, catalog)
        return (
          <Card key={i} title={g.category} accent="#ec4899">
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 10 }}>{g.caption}</div>
            {g.imageryNotes && (
              <div style={{ background: '#fdf2f8', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#9d174d', fontStyle: 'italic' }}>
                📸 {g.imageryNotes}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: products.length ? 14 : 0 }}>
              {(g.hashtags || []).map((h, j) => <Badge key={j} color="purple">{h}</Badge>)}
            </div>
            {g.notes && <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginBottom: products.length ? 12 : 0 }}>{g.notes}</div>}
            {products.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>SUGGESTED PRODUCTS</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {products.map(p => <ProductCard key={p.id} product={p} />)}
                </div>
              </div>
            )}
          </Card>
        )
      })}

      {activeSection === 'seo' && (c?.collectionDescriptions?.collectionDescriptions || []).map((d, i) => (
        <Card key={i} title={d.collection} accent="#10b981">
          <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
            <Badge color="green">KW: {d.primaryKeyword}</Badge>
            {d.secondaryKeyword && <Badge color="blue">Secondary: {d.secondaryKeyword}</Badge>}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.7 }}>{d.description}</p>
        </Card>
      ))}

      {activeSection === 'calendar' && (c?.editorialCalendar?.editorialCalendar || []).map((w, i) => (
        <Card key={i} title={`Week ${w.week}${w.dates ? ': ' + w.dates : ''}`} subtitle={w.theme} accent="#f59e0b">
          {w.email && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>📧 EMAIL</div>
              <div style={{ fontSize: 13, color: '#374151' }}>
                <strong>{typeof w.email === 'object' ? w.email.subjectLine || w.email.subject : w.email}</strong>
                {typeof w.email === 'object' && w.email.focus && <span style={{ color: '#6b7280' }}> — {w.email.focus}</span>}
              </div>
            </div>
          )}
          {w.instagram?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>📱 INSTAGRAM</div>
              {(Array.isArray(w.instagram) ? w.instagram : [w.instagram]).map((post, j) => (
                <div key={j} style={{ fontSize: 13, color: '#374151', padding: '3px 0', borderBottom: '1px solid #f9fafb' }}>
                  {typeof post === 'object' ? `[${post.format || post.type || 'Post'}] ${post.idea || post.description || ''}` : post}
                </div>
              ))}
            </div>
          )}
          {w.hero && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>🏠 WEBSITE HERO</div>
              <div style={{ fontSize: 13, color: '#374151' }}>
                {typeof w.hero === 'object' ? (w.hero.headline || w.hero.collection || '') : w.hero}
              </div>
            </div>
          )}
        </Card>
      ))}
      </>
      )}
    </div>
  )
}

function PriceTab({ priceIntel }) {
  if (!priceIntel?.akProductsTracked) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>💰</div>
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Price Intelligence Not Run Yet</div>
      <div style={{ color: '#6b7280', fontSize: 14, maxWidth: 480, margin: '0 auto' }}>
        Run <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>npm run price:track</code> to start monitoring AK sale events and competitor promotions.
      </div>
    </div>
  )

  const { akSaleRate, akAvgSaleDepth, akProductsTracked, akOnSaleCount,
          categorySaleRates, changes, competitorPromos, saleRateHistory } = priceIntel
  const saleColor = akSaleRate > 30 ? '#ef4444' : akSaleRate > 15 ? '#f59e0b' : '#10b981'

  return (
    <div>
      <SectionHeader>AK Sale Activity</SectionHeader>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Products on Sale" value={`${akSaleRate}%`} sub={`${akOnSaleCount} of ${akProductsTracked}`} color={saleColor} />
        <Stat label="Avg Discount" value={`${akAvgSaleDepth}%`} sub="when on sale" color="#f59e0b" />
        <Stat label="New Sales Today" value={changes?.newSaleItems?.length ?? '—'} sub="just went on sale" color="#ef4444" />
        <Stat label="Ended Sales" value={changes?.endedSaleItems?.length ?? '—'} sub="came off sale" color="#6b7280" />
      </div>

      {/* Sale rate trend */}
      {saleRateHistory?.length > 1 && (
        <>
          <SectionHeader>Sale Rate Over Time</SectionHeader>
          <Card subtitle="% of AK products on sale each day tracked">
            {saleRateHistory.slice(-14).map((h, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{h.date}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: h.rate > 30 ? '#ef4444' : h.rate > 15 ? '#f59e0b' : '#10b981' }}>{h.rate}%</span>
                </div>
                <div style={{ background: '#f3f4f6', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: h.rate > 30 ? '#ef4444' : h.rate > 15 ? '#f59e0b' : '#10b981', height: '100%', width: `${Math.min(h.rate, 100)}%`, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Category sale breakdown */}
      {categorySaleRates?.length > 0 && (
        <>
          <SectionHeader>Sale Rate by Category</SectionHeader>
          <Card>
            {categorySaleRates.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{c.category.replace(/-/g, ' ')}</span>
                  <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>{c.onSale}/{c.total} items</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {c.avgDepth > 0 && <span style={{ fontSize: 12, color: '#6b7280' }}>avg {c.avgDepth}% off</span>}
                  <Badge color={c.rate > 30 ? 'red' : c.rate > 10 ? 'yellow' : 'green'}>{c.rate}% on sale</Badge>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Price changes */}
      {(changes?.newSaleItems?.length > 0 || changes?.endedSaleItems?.length > 0 || changes?.priceChanges?.length > 0) && (
        <>
          <SectionHeader>Price Changes Since Last Run</SectionHeader>
          {changes.newSaleItems?.length > 0 && (
            <Card title={`${changes.newSaleItems.length} Items Just Went On Sale`} accent="#ef4444">
              {changes.newSaleItems.slice(0, 10).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>{p.title}</span>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 13, textDecoration: 'line-through', color: '#9ca3af' }}>${p.compareAtPrice}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>${p.price}</span>
                    <Badge color="red">{p.saleDepth}% off</Badge>
                  </div>
                </div>
              ))}
              {changes.newSaleItems.length > 10 && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>+{changes.newSaleItems.length - 10} more</div>}
            </Card>
          )}
          {changes.endedSaleItems?.length > 0 && (
            <Card title={`${changes.endedSaleItems.length} Items Came Off Sale`} accent="#6b7280">
              {changes.endedSaleItems.slice(0, 8).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 13, color: '#374151' }}>{p.title}</span>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>back to ${p.price}</span>
                </div>
              ))}
            </Card>
          )}
          {changes.priceChanges?.length > 0 && (
            <Card title={`${changes.priceChanges.length} Price Changes`} accent="#f59e0b">
              {changes.priceChanges.slice(0, 8).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 13, color: '#374151' }}>{p.title}</span>
                  <span style={{ fontSize: 13, color: p.delta < 0 ? '#10b981' : '#ef4444' }}>
                    ${p.prevPrice} → ${p.price} ({p.delta > 0 ? '+' : ''}{p.delta})
                  </span>
                </div>
              ))}
            </Card>
          )}
          {changes.note && <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16, fontStyle: 'italic' }}>{changes.note}</div>}
        </>
      )}

      {/* Competitor promos */}
      <SectionHeader>Competitor Promotions</SectionHeader>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Extracted from site banners during last scrape · run <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>npm run scrape:sites</code> to refresh
      </div>
      {(competitorPromos || []).map((p, i) => (
        <Card key={i} accent={p.hasPromo ? (p.maxDiscount >= 40 ? '#ef4444' : '#f59e0b') : '#e5e7eb'}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: p.hasPromo ? 10 : 0 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{p.brand}</div>
              {p.scrapedAt && <div style={{ fontSize: 11, color: '#9ca3af' }}>scraped {new Date(p.scrapedAt).toLocaleDateString()}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {p.hasPromo
                ? <Badge color={p.maxDiscount >= 40 ? 'red' : 'yellow'}>{p.maxDiscount ? `Up to ${p.maxDiscount}% off` : 'Promo active'}</Badge>
                : <Badge color="gray">No active promo</Badge>}
            </div>
          </div>
          {p.promoBanners?.map((banner, j) => (
            <div key={j} style={{ fontSize: 13, color: '#374151', padding: '4px 0', borderBottom: '1px solid #f9fafb' }}>
              "{banner}"
            </div>
          ))}
        </Card>
      ))}
    </div>
  )
}

function AgenticSearchTab({ agenticSearch }) {
  if (!agenticSearch?.scores) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>AI Search Visibility Not Run Yet</div>
      <div style={{ color: '#6b7280', fontSize: 14, maxWidth: 480, margin: '0 auto' }}>
        Run <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>npm run agentic:search</code> to test how Anne Klein appears when AI assistants answer shopping queries.
      </div>
    </div>
  )

  const { scores, geoRecommendations, queryResults } = agenticSearch
  const visColor = scores.visibilityRate >= 60 ? '#10b981' : scores.visibilityRate >= 30 ? '#f59e0b' : '#ef4444'

  return (
    <div>
      <SectionHeader>AI Search Visibility Scores</SectionHeader>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="Visibility Rate" value={`${scores.visibilityRate}%`} sub={`${scores.queriesMentioned}/${scores.queriesTested} queries`} color={visColor} />
        <Stat label="Top of Mind" value={`${scores.topOfMindRate}%`} sub="mentioned first" color="#6366f1" />
        <Stat label="Positive Sentiment" value={`${scores.positiveRateWhenMentioned}%`} sub="when mentioned" color="#10b981" />
        <Stat label="Visibility Gaps" value={scores.gaps?.length} sub="queries AK missed" color="#ef4444" />
      </div>

      {/* Competitor comparison bar chart */}
      <SectionHeader>AI Visibility vs Competitors</SectionHeader>
      <Card subtitle={`Tested across ${scores.queriesTested} shopping queries · Model: Claude Sonnet`}>
        {[{ brand: 'Anne Klein', rate: scores.visibilityRate, mentions: scores.queriesMentioned }, ...(scores.competitorVisibility || [])].map((c, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: c.brand === 'Anne Klein' ? 700 : 500, color: c.brand === 'Anne Klein' ? '#6366f1' : '#374151' }}>{c.brand}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: c.rate >= 60 ? '#10b981' : c.rate >= 30 ? '#f59e0b' : '#9ca3af' }}>{c.rate}%</span>
            </div>
            <div style={{ background: '#f3f4f6', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ background: c.brand === 'Anne Klein' ? '#6366f1' : '#d1d5db', height: '100%', width: `${c.rate}%`, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
          </div>
        ))}
      </Card>

      {/* Competitor drivers — what's making them rank */}
      <SectionHeader>What's Driving Competitor Rankings</SectionHeader>
      <Card subtitle="Why AI assistants recommend each competitor — inferred from query responses">
        {(scores.competitorVisibility || []).filter(c => c.rate > 0).map((c, i) => {
          const appearances = (queryResults || []).filter(r => r.visibility?.[c.brand]?.mentioned)
          const catCounts = {}
          appearances.forEach(r => { catCounts[r.category] = (catCounts[r.category] || 0) + 1 })
          const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
          const positiveContexts = appearances
            .filter(r => r.visibility?.[c.brand]?.sentiment === 'positive' && r.visibility?.[c.brand]?.context)
            .slice(0, 1)
          const sentimentPos = appearances.filter(r => r.visibility?.[c.brand]?.sentiment === 'positive').length
          const sentimentPct = appearances.length ? Math.round(sentimentPos / appearances.length * 100) : 0
          return (
            <div key={c.brand} style={{ padding: '14px 0', borderBottom: i < (scores.competitorVisibility.filter(x => x.rate > 0).length - 1) ? '1px solid #f3f4f6' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{c.brand}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Badge color={c.rate >= 60 ? 'green' : c.rate >= 30 ? 'yellow' : 'gray'}>{c.rate}% visible</Badge>
                  <Badge color={sentimentPct >= 60 ? 'green' : sentimentPct >= 30 ? 'yellow' : 'gray'}>{sentimentPct}% positive</Badge>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: positiveContexts.length ? 8 : 0 }}>
                {topCats.map(([cat, count]) => (
                  <span key={cat} style={{ background: '#f3f4f6', color: '#374151', padding: '3px 10px', borderRadius: 12, fontSize: 12 }}>
                    {cat} <strong>({count}/{appearances.length})</strong>
                  </span>
                ))}
              </div>
              {positiveContexts.map((p, j) => (
                <div key={j} style={{ fontSize: 12, color: '#6b7280', background: '#f9fafb', borderRadius: 6, padding: '6px 10px', lineHeight: 1.5, fontStyle: 'italic' }}>
                  "…{p.context.substring(0, 200)}…"
                  <span style={{ display: 'block', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>from query: "{p.query}"</span>
                </div>
              ))}
            </div>
          )
        })}
      </Card>

      {/* Per-category breakdown */}
      <SectionHeader>Visibility by Query Type</SectionHeader>
      <Card>
        {(scores.categoryBreakdown || []).map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{c.category}</span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>{c.mentioned}/{c.total} queries</span>
              <Badge color={c.visibilityRate >= 60 ? 'green' : c.visibilityRate >= 30 ? 'yellow' : 'red'}>{c.visibilityRate}%</Badge>
            </div>
          </div>
        ))}
      </Card>

      {/* Visibility gaps */}
      {scores.gaps?.length > 0 && (
        <>
          <SectionHeader>Visibility Gaps — AK Missing, Competitors Present</SectionHeader>
          <Card subtitle="These are queries where AI assistants recommend competitors but not Anne Klein">
            {scores.gaps.map((g, i) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827', marginBottom: 4 }}>"{g.query}"</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>{g.category} ·</span>
                  {g.competitorsPresent.map(b => <Badge key={b} color="blue">{b}</Badge>)}
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>mentioned instead</span>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* GEO recommendations */}
      {geoRecommendations?.length > 0 && (
        <>
          <SectionHeader>GEO Recommendations (Generative Engine Optimization)</SectionHeader>
          {geoRecommendations.map((r, i) => (
            <Card key={i} title={r.title} accent={r.priority === 'high' ? '#ef4444' : '#f59e0b'}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Badge color={r.priority === 'high' ? 'red' : 'yellow'}>{r.priority} priority</Badge>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>ACTION</div>
                <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{r.action}</p>
              </div>
              <div style={{ background: '#f9fafb', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                <strong>Why:</strong> {r.rationale}
              </div>
            </Card>
          ))}
        </>
      )}

      {/* Query-level detail */}
      <SectionHeader>All Query Results</SectionHeader>
      <Card subtitle="Full breakdown of how AK and competitors appeared in each AI search query">
        {(queryResults || []).filter(r => !r.error).map((r, i) => (
          <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ flex: 1, marginRight: 12 }}>
                <span style={{ fontSize: 12, color: '#9ca3af', marginRight: 6 }}>[{r.category}]</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{r.query}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <Badge color={r.akMentioned ? (r.akTopOfMind ? 'green' : 'blue') : 'red'}>
                  {r.akMentioned ? (r.akTopOfMind ? 'AK #1' : `AK #${r.akPosition}`) : 'AK absent'}
                </Badge>
              </div>
            </div>
            {r.akMentioned && r.visibility?.['Anne Klein']?.context && (
              <div style={{ fontSize: 12, color: '#6b7280', background: '#f0fdf4', borderRadius: 6, padding: '6px 10px', marginBottom: 4, lineHeight: 1.5 }}>
                "…{r.visibility['Anne Klein'].context.substring(0, 150)}…"
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {r.competitorsMentioned?.map(b => <Badge key={b} color="gray">{b}</Badge>)}
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

function PersonaSection({ label, items, borderColor, bullet }) {
  if (!items?.length) return null
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</div>
      {items.map((item, j) => (
        <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
          {bullet
            ? <div style={{ width: 6, height: 6, borderRadius: '50%', background: borderColor, flexShrink: 0, marginTop: 5 }} />
            : <div style={{ width: 3, borderRadius: 2, background: borderColor, flexShrink: 0, alignSelf: 'stretch', minHeight: 16 }} />
          }
          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{item}</div>
        </div>
      ))}
    </div>
  )
}

function PersonasTab({ personas }) {
  if (!personas?.personas?.length) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Customer Personas Not Generated Yet</div>
      <div style={{ color: '#6b7280', fontSize: 14, maxWidth: 480, margin: '0 auto' }}>
        Run <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>npm run personas</code> to generate AI-driven customer personas from all available brand intelligence.
      </div>
    </div>
  )

  const PERSONA_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981']

  return (
    <div>
      <SectionHeader>Customer Personas</SectionHeader>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        AI-generated from competitive intel, product catalog, social data, and email intelligence.
        {personas.generatedAt && <span> Last updated {new Date(personas.generatedAt).toLocaleDateString()}.</span>}
      </div>

      {personas.summaryInsights?.length > 0 && (
        <Card title="Key Cross-Persona Insights" accent="#6366f1">
          {personas.summaryInsights.map((insight, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ background: '#6366f1', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
              <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>{insight}</p>
            </div>
          ))}
        </Card>
      )}

      {personas.personas.map((p, i) => {
        const color = PERSONA_COLORS[i % PERSONA_COLORS.length]
        const occupations = Array.isArray(p.occupation) ? p.occupation.join(' · ') : p.occupation
        return (
          <Card key={i} accent={color}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 20, color: '#111827', marginBottom: 4 }}>{p.name}</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 2 }}>
                  {[p.ageRange || p.age, p.income, p.location].filter(Boolean).join(' · ')}
                </div>
                {occupations && <div style={{ fontSize: 13, color: '#9ca3af' }}>{occupations}</div>}
              </div>
              <div style={{ background: color, color: '#fff', borderRadius: 8, padding: '4px 14px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                Persona {i + 1}
              </div>
            </div>

            {/* Quote */}
            {p.quoteExample && (
              <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 14, fontStyle: 'italic', color: '#374151', lineHeight: 1.6, borderLeft: `3px solid ${color}` }}>
                "{p.quoteExample}"
              </div>
            )}

            {/* 2-column grid — stacks on narrow viewports */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20, marginBottom: 16 }}>
              <PersonaSection label="CORE VALUES"        items={p.values}            borderColor={color}     bullet />
              <PersonaSection label="FASHION GOALS"      items={p.fashionGoals}      borderColor="#d1d5db" />
              <PersonaSection label="PURCHASE MOTIVATORS" items={p.motivators}       borderColor={color} />
              <PersonaSection label="PAIN POINTS"        items={p.painPoints}        borderColor="#fca5a5" />
              <PersonaSection label="SHOPPING BEHAVIOR"  items={p.shoppingBehaviors} borderColor="#6ee7b7" />
              {p.contentTopics?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.05em', marginBottom: 8 }}>CONTENT THAT RESONATES</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {p.contentTopics.map((t, j) => (
                      <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, marginTop: 5 }} />
                        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{t}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* AK Fit */}
            {p.annKleinFit && (
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', marginBottom: 4 }}>WHY ANNE KLEIN FITS</div>
                <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{p.annKleinFit}</p>
              </div>
            )}

            {/* Preferred Channels */}
            {p.preferredChannels?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Preferred channels:</span>
                {p.preferredChannels.map((ch, j) => (
                  <span key={j} style={{ fontSize: 12, background: '#f3f4f6', color: '#374151', borderRadius: 6, padding: '2px 10px' }}>{j + 1}. {ch}</span>
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

const TABS = [
  { id: 'overview',  label: '🏠 Overview' },
  { id: 'catalog',   label: '👗 Catalog' },
  { id: 'site',      label: '🔍 Site Intel' },
  { id: 'email',     label: '📧 Email' },
  { id: 'social',    label: '📱 Social' },
  { id: 'seo',       label: '📊 SEO' },
  { id: 'content',   label: '✍️ Content' },
  { id: 'price',     label: '💰 Pricing' },
  { id: 'ai',        label: '🤖 AI Search' },
  { id: 'personas',  label: '👥 Personas' },
]

export default function App() {
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [siteIntel, catalog, siteAnalysis, emailIntel, socialIntel, seoIntel, content, inboxData, emailAnalysis, agenticSearch, priceIntel, personas, apifyUsage] = await Promise.all([
        fetchEndpoint('/site-intelligence'),
        fetchEndpoint('/product-catalog'),
        fetchEndpoint('/site-analysis'),
        fetchEndpoint('/email-intelligence'),
        fetchEndpoint('/social-intelligence'),
        fetchEndpoint('/seo-intelligence'),
        fetchEndpoint('/content-recommendations'),
        fetchEndpoint('/email-inbox'),
        fetchEndpoint('/email-analysis'),
        fetchEndpoint('/agentic-search'),
        fetchEndpoint('/price-intelligence'),
        fetchEndpoint('/personas'),
        fetchEndpoint('/apify-usage'),
      ])
      setData({ siteIntel, catalog, siteAnalysis, emailIntel, socialIntel, seoIntel, content, inboxData, emailAnalysis, agenticSearch, priceIntel, personas, apifyUsage })
      setLastUpdated(new Date().toLocaleTimeString())
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#f9fafb', minHeight: '100vh' }}>
      <div style={{ background: '#111827', color: '#fff', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px' }}>ANNE KLEIN</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>Brand Intelligence Platform</div>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {loading ? 'Loading data…' : `Updated ${lastUpdated}`}
        </div>
      </div>

      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 32px', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '14px 16px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
              color: tab === t.id ? '#6366f1' : '#6b7280',
              borderBottom: tab === t.id ? '2px solid #6366f1' : '2px solid transparent',
              whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#6b7280' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div>Loading intelligence data…</div>
          </div>
        ) : (
          <>
            {tab === 'overview' && <OverviewTab catalog={data.catalog} siteIntel={data.siteIntel} siteAnalysis={data.siteAnalysis} emailIntel={data.emailIntel} socialIntel={data.socialIntel} content={data.content} apifyUsage={data.apifyUsage} />}
            {tab === 'catalog'  && <CatalogTab catalog={data.catalog} />}
            {tab === 'site'     && <SiteIntelTab siteIntel={data.siteIntel} siteAnalysis={data.siteAnalysis} />}
            {tab === 'email'    && <EmailTab inboxData={data.inboxData} emailAnalysis={data.emailAnalysis} />}
            {tab === 'social'   && <SocialTab socialIntel={data.socialIntel} />}
            {tab === 'seo'      && <SEOTab seoIntel={data.seoIntel} content={data.content} />}
            {tab === 'content'  && <ContentTab content={data.content} catalog={data.catalog} />}
            {tab === 'price'    && <PriceTab priceIntel={data.priceIntel} />}
            {tab === 'ai'       && <AgenticSearchTab agenticSearch={data.agenticSearch} />}
            {tab === 'personas' && <PersonasTab personas={data.personas} />}
          </>
        )}
      </div>
    </div>
  )
}
