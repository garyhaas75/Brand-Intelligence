import React, { useState, useEffect, useRef } from 'react'
import './App.css'

const API = '/api'

// Human-readable labels for Shopify taxonomy GIDs used by Anne Klein products.
const TAXONOMY_LABELS = {
  'gid://shopify/TaxonomyCategory/aa-1-10-2-1': 'Bolero Jackets',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-2': 'Bomber Jackets',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-3': 'Capes',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-5': 'Overcoats',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-6': 'Parkas',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-7': 'Pea Coats',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-9': 'Puffer Jackets',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-11': 'Sport Jackets / Blazers',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-13': 'Trench Coats',
  'gid://shopify/TaxonomyCategory/aa-1-10-2-17': 'Wrap Coats',
  'gid://shopify/TaxonomyCategory/aa-1-10-6': 'Vests',
  'gid://shopify/TaxonomyCategory/aa-1-13-1': 'Blouses',
  'gid://shopify/TaxonomyCategory/aa-1-13-2': 'Bodysuits',
  'gid://shopify/TaxonomyCategory/aa-1-13-3': 'Cardigans',
  'gid://shopify/TaxonomyCategory/aa-1-13-5': 'Overshirts',
  'gid://shopify/TaxonomyCategory/aa-1-13-7': 'Shirts',
  'gid://shopify/TaxonomyCategory/aa-1-13-12': 'Sweaters',
  'gid://shopify/TaxonomyCategory/aa-1-13-9': 'Tank Tops',
  'gid://shopify/TaxonomyCategory/aa-1-13-11': 'Tunics',
  'gid://shopify/TaxonomyCategory/aa-1-12-3': 'Chinos',
  'gid://shopify/TaxonomyCategory/aa-1-12-4': 'Jeans',
  'gid://shopify/TaxonomyCategory/aa-1-12-8': 'Leggings',
  'gid://shopify/TaxonomyCategory/aa-1-12-11': 'Trousers / Dress Pants',
  'gid://shopify/TaxonomyCategory/aa-1-19-1': 'Pant Suits',
  'gid://shopify/TaxonomyCategory/aa-1-19-2': 'Skirt Suits',
  'gid://shopify/TaxonomyCategory/aa-1-4': 'Dresses',
  'gid://shopify/TaxonomyCategory/aa-1-11': 'Outfit Sets',
  'gid://shopify/TaxonomyCategory/aa-1-15': 'Skirts',
  'gid://shopify/TaxonomyCategory/aa-8-1': 'Athletic Shoes',
  'gid://shopify/TaxonomyCategory/aa-8-3': 'Boots',
  'gid://shopify/TaxonomyCategory/aa-8-9': 'Flats',
  'gid://shopify/TaxonomyCategory/aa-8-10': 'Heels / Pumps',
  'gid://shopify/TaxonomyCategory/aa-8-6': 'Sandals',
  'gid://shopify/TaxonomyCategory/aa-8-8': 'Sneakers',
  'gid://shopify/TaxonomyCategory/aa-6-3': 'Bracelets',
  'gid://shopify/TaxonomyCategory/aa-6-4': 'Brooches & Lapel Pins',
  'gid://shopify/TaxonomyCategory/aa-6-5': 'Charms & Pendants',
  'gid://shopify/TaxonomyCategory/aa-6-6': 'Earrings',
  'gid://shopify/TaxonomyCategory/aa-6-7': 'Jewelry Sets',
  'gid://shopify/TaxonomyCategory/aa-6-8': 'Necklaces',
  'gid://shopify/TaxonomyCategory/aa-6-9': 'Rings',
  'gid://shopify/TaxonomyCategory/aa-6-11': 'Watches',
  'gid://shopify/TaxonomyCategory/aa-5-4-5': 'Clutch Bags',
  'gid://shopify/TaxonomyCategory/aa-5-4-7': 'Cross Body Bags',
  'gid://shopify/TaxonomyCategory/aa-5-4-9': 'Envelope Clutches',
  'gid://shopify/TaxonomyCategory/aa-5-4-12': 'Hobo Bags',
  'gid://shopify/TaxonomyCategory/aa-5-4-16': 'Satchel Bags',
  'gid://shopify/TaxonomyCategory/aa-5-4-18': 'Shopper / Tote Bags',
  'gid://shopify/TaxonomyCategory/aa-5-4-19': 'Shoulder Bags',
  'gid://shopify/TaxonomyCategory/aa-5-5-7': 'Wallets',
}

// Metafield slots per specific product type — used in SEO Product Intelligence UI.
const SPECIFIC_TYPE_FIELDS = {
  // Clothing
  blazer:       [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type'],['closure_type','Closure Type'],['lining','Lining']],
  coat:         [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type'],['closure_type','Closure Type']],
  dress:        [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type'],['neckline','Neckline'],['sleeve_length','Sleeve Length']],
  pants:        [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type'],['rise','Rise']],
  skirt:        [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type'],['length','Length']],
  suit:         [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type'],['lining','Lining']],
  sweater:      [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type']],
  top:          [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type'],['neckline','Neckline'],['sleeve_length','Sleeve Length']],
  // Shoes
  heels:        [['heel_height','Heel Height'],['heel_style','Heel Style'],['toe_shape','Toe Shape'],['closure_type','Closure Type']],
  boots:        [['heel_height','Heel Height'],['shaft_height','Shaft Height'],['closure_type','Closure Type']],
  sandals:      [['heel_style','Heel Style'],['strap_style','Strap Style'],['closure_type','Closure Type']],
  flats:        [['toe_shape','Toe Shape'],['closure_type','Closure Type']],
  sneakers:     [['closure_type','Closure Type']],
  // Jewelry
  earrings:     [['metal_finish','Metal Finish'],['stone_type','Stone Type'],['earring_back','Earring Back']],
  necklaces:    [['metal_finish','Metal Finish'],['stone_type','Stone Type'],['chain_length','Chain Length'],['clasp_type','Clasp Type']],
  bracelets:    [['metal_finish','Metal Finish'],['stone_type','Stone Type'],['clasp_type','Clasp Type']],
  rings:        [['metal_finish','Metal Finish'],['stone_type','Stone Type']],
  watches:      [['metal_finish','Metal Finish'],['band_material','Band Material'],['case_diameter','Case Diameter']],
  brooches:     [['metal_finish','Metal Finish'],['stone_type','Stone Type']],
  jewelry_sets: [['metal_finish','Metal Finish'],['stone_type','Stone Type']],
  // Handbags
  clutch:        [['exterior_material','Exterior Material'],['closure_type','Closure Type'],['strap_type','Strap / Carry Options']],
  crossbody:     [['exterior_material','Exterior Material'],['closure_type','Closure Type'],['strap_type','Strap / Carry Options']],
  tote:          [['exterior_material','Exterior Material'],['closure_type','Closure Type'],['strap_type','Strap / Carry Options']],
  satchel:       [['exterior_material','Exterior Material'],['closure_type','Closure Type'],['strap_type','Strap / Carry Options']],
  shoulder_bag:  [['exterior_material','Exterior Material'],['closure_type','Closure Type'],['strap_type','Strap / Carry Options']],
  handbag_generic:[['exterior_material','Exterior Material'],['closure_type','Closure Type'],['strap_type','Strap / Carry Options']],
  wallet:        [['exterior_material','Exterior Material'],['closure_type','Closure Type']],
  // Category group fallbacks
  clothing:  [['material','Material'],['care_instructions','Care Instructions'],['fit_type','Fit Type']],
  shoes:     [['heel_style','Heel Style'],['closure_type','Closure Type']],
  jewelry:   [['metal_finish','Metal Finish'],['stone_type','Stone Type']],
  handbags:  [['exterior_material','Exterior Material'],['closure_type','Closure Type'],['strap_type','Strap / Carry Options']],
}

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

function EmailTab({ inboxData, emailAnalysis, loadData }) {
  const [refreshing, setRefreshing] = useState(false)
  const inboxBrands = inboxData?.brands || []
  const analysis = emailAnalysis?.analysis || {}
  const totalReceived = inboxBrands.reduce((s, b) => s + (b.summary?.count || 0), 0)
  const brandsActive = inboxBrands.filter(b => b.emails?.length > 0).length

  async function refreshAnalysis() {
    setRefreshing(true)
    try {
      await fetch('/api/email-analysis/refresh', { method: 'POST' })
      if (loadData) await loadData()
    } finally {
      setRefreshing(false)
    }
  }

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
        <SectionHeader style={{ marginBottom: 0 }}>AK Email Strategy</SectionHeader>
        <button
          onClick={refreshAnalysis}
          disabled={refreshing}
          style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.7 : 1 }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh Analysis'}
        </button>
      </div>
      {analysis.akEmailStrategy && (
        <>
          <div style={{ height: 0 }} />
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
      const res = await fetch('/api/generate', {
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

function ContentTab({ content, catalog, campaigns, loadData, setCalItems }) {
  const [activeSection, setActiveSection] = useState('email')
  const [personaFilter, setPersonaFilter] = useState(null)
  const [linkingAsset, setLinkingAsset] = useState(null)
  const [linkedToast, setLinkedToast] = useState(null)
  const [regenerating, setRegenerating] = useState(false)
  const [schedulingAsset, setSchedulingAsset] = useState(null) // { key, channel, fields }
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleCampaignId, setScheduleCampaignId] = useState('')
  const [scheduleToast, setScheduleToast] = useState(null)
  const c = content?.content

  async function scheduleToCalendar() {
    if (!scheduleDate) return
    const { channel, fields } = schedulingAsset
    const camp = activeCampaigns.find(c => c.id === scheduleCampaignId)
    const res = await fetch('/api/calendar/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: scheduleDate,
        channel,
        status: 'brief',
        campaignId: scheduleCampaignId || null,
        personaTarget: fields.targetPersona || '',
        theme: fields.theme || fields.category || '',
        subjectLine: fields.subjectLine || '',
        previewText: fields.previewText || '',
        brief: fields.brief || fields.caption || '',
        notes: fields.imageryNotes || '',
      }),
    })
    const item = await res.json()
    if (setCalItems) setCalItems(prev => [...prev, item])
    setSchedulingAsset(null)
    setScheduleDate('')
    setScheduleCampaignId('')
    setScheduleToast(camp ? `Scheduled to ${camp.name}` : `Scheduled for ${scheduleDate}`)
    setTimeout(() => setScheduleToast(null), 2500)
  }

  async function regenerateContent() {
    setRegenerating(true)
    try {
      await fetch('/api/content-recommendations/regenerate', { method: 'POST' })
      if (loadData) await loadData()
    } finally {
      setRegenerating(false)
    }
  }
  const activeCampaigns = (campaigns || []).filter(c => c.status !== 'archived')

  async function linkToCampaign(campaignId, asset) {
    await fetch(`/api/campaigns/${campaignId}/link-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(asset),
    })
    const camp = activeCampaigns.find(c => c.id === campaignId)
    setLinkingAsset(null)
    setLinkedToast(camp?.name || 'Campaign')
    setTimeout(() => setLinkedToast(null), 2500)
  }

  const PERSONAS = ['The Polished Professional', 'The Emerging Leader', 'The Refined Rewinder', 'The Practical Multitasker']
  const PERSONA_COLORS = {
    'The Polished Professional': '#6366f1',
    'The Emerging Leader': '#10b981',
    'The Refined Rewinder': '#f59e0b',
    'The Practical Multitasker': '#ec4899',
  }

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
      {linkedToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#111827', color: '#fff', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 600, zIndex: 999, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
          Added to "{linkedToast}"
        </div>
      )}
      {scheduleToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 280, background: '#059669', color: '#fff', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 600, zIndex: 999, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
          📅 {scheduleToast}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
        <SectionHeader style={{ marginBottom: 0 }}>Generated Content Assets</SectionHeader>
        <button onClick={regenerateContent} disabled={regenerating}
          style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: regenerating ? 'not-allowed' : 'pointer', opacity: regenerating ? 0.7 : 1 }}>
          {regenerating ? 'Regenerating… (~4 min)' : 'Regenerate Content'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
              background: activeSection === s.id ? '#6366f1' : '#f3f4f6',
              color: activeSection === s.id ? '#fff' : '#374151' }}>
            {s.label} {s.count ? `(${s.count})` : ''}
          </button>
        ))}
      </div>

      {(activeSection === 'email' || activeSection === 'ig') && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', marginRight: 2 }}>PERSONA:</span>
          <button onClick={() => setPersonaFilter(null)}
            style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid #e5e7eb', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: personaFilter === null ? '#111827' : '#fff',
              color: personaFilter === null ? '#fff' : '#374151' }}>
            All
          </button>
          {PERSONAS.map(p => (
            <button key={p} onClick={() => setPersonaFilter(personaFilter === p ? null : p)}
              style={{ padding: '4px 12px', borderRadius: 20, border: `1px solid ${PERSONA_COLORS[p]}`, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: personaFilter === p ? PERSONA_COLORS[p] : '#fff',
                color: personaFilter === p ? '#fff' : PERSONA_COLORS[p] }}>
              {p}
            </button>
          ))}
        </div>
      )}

      {activeSection === 'email' && (c?.emailCampaigns?.emailCampaigns || []).filter(e => !personaFilter || e.targetPersona === personaFilter).map((e, i) => {
        const products = getProductsForCampaign(e.theme, e.brief, catalog)
        const pColor = PERSONA_COLORS[e.targetPersona] || '#9ca3af'
        return (
          <Card key={i} title={`Week ${e.week}${e.dayOfWeek ? ' · ' + e.dayOfWeek : ''}: ${e.theme}`} accent="#6366f1">
            {e.targetPersona && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ background: pColor, color: '#fff', borderRadius: 20, fontSize: 11, fontWeight: 700, padding: '3px 10px' }}>{e.targetPersona}</span>
              </div>
            )}
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
            <div style={{ display: 'flex', gap: 12, fontSize: 13, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>🎯 CTA: <strong>{e.ctaButton}</strong></span>
              <span>📅 {e.sendTiming}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Schedule to Calendar */}
                {schedulingAsset?.key === `email-${i}` ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', background: '#f0fdf4', border: '1px solid #6ee7b7', borderRadius: 8, padding: '4px 8px' }}>
                    <input type="date" value={scheduleDate} onChange={ev => setScheduleDate(ev.target.value)}
                      style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 6px', fontSize: 12 }} />
                    {activeCampaigns.length > 0 && (
                      <select value={scheduleCampaignId} onChange={ev => setScheduleCampaignId(ev.target.value)}
                        style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}>
                        <option value="">No campaign</option>
                        {activeCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    <button onClick={scheduleToCalendar} disabled={!scheduleDate}
                      style={{ padding: '2px 8px', borderRadius: 5, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Add</button>
                    <button onClick={() => setSchedulingAsset(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setSchedulingAsset({ key: `email-${i}`, channel: 'email', fields: e }); setScheduleDate(''); setScheduleCampaignId('') }}
                    style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #059669', background: '#fff', color: '#059669', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                    📅 Schedule
                  </button>
                )}
                {/* Add to Campaign */}
                {activeCampaigns.length > 0 && (
                  linkingAsset?.key === `email-${i}` ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <select onChange={ev => { if (ev.target.value) linkToCampaign(ev.target.value, { type: 'email', subjectLine: e.subjectLine, theme: e.theme, targetPersona: e.targetPersona, brief: e.brief }) }}
                        style={{ border: '1px solid #6366f1', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}
                        defaultValue="">
                        <option value="">— pick campaign —</option>
                        {activeCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button onClick={() => setLinkingAsset(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12 }}>✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setLinkingAsset({ key: `email-${i}` })}
                      style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #6366f1', background: '#fff', color: '#6366f1', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                      + Campaign
                    </button>
                  )
                )}
              </div>
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

      {activeSection === 'ig' && (c?.instagramCaptions?.instagramCaptions || []).filter(g => !personaFilter || g.targetPersona === personaFilter).map((g, i) => {
        const products = getProductsForCampaign(g.category, g.caption, catalog)
        const pColor = PERSONA_COLORS[g.targetPersona] || '#9ca3af'
        return (
          <Card key={i} title={g.category} accent="#ec4899">
            {g.targetPersona && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ background: pColor, color: '#fff', borderRadius: 20, fontSize: 11, fontWeight: 700, padding: '3px 10px' }}>{g.targetPersona}</span>
              </div>
            )}
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 10 }}>{g.caption}</div>
            {g.imageryNotes && (
              <div style={{ background: '#fdf2f8', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#9d174d', fontStyle: 'italic' }}>
                📸 {g.imageryNotes}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: products.length ? 14 : 0 }}>
              {(g.hashtags || []).map((h, j) => <Badge key={j} color="purple">{h}</Badge>)}
            </div>
            {g.notes && <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginBottom: 10 }}>{g.notes}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: products.length ? 14 : 0 }}>
              {/* Schedule to Calendar */}
              {schedulingAsset?.key === `ig-${i}` ? (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', background: '#f0fdf4', border: '1px solid #6ee7b7', borderRadius: 8, padding: '4px 8px' }}>
                  <input type="date" value={scheduleDate} onChange={ev => setScheduleDate(ev.target.value)}
                    style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 6px', fontSize: 12 }} />
                  {activeCampaigns.length > 0 && (
                    <select value={scheduleCampaignId} onChange={ev => setScheduleCampaignId(ev.target.value)}
                      style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}>
                      <option value="">No campaign</option>
                      {activeCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  <button onClick={scheduleToCalendar} disabled={!scheduleDate}
                    style={{ padding: '2px 8px', borderRadius: 5, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Add</button>
                  <button onClick={() => setSchedulingAsset(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12 }}>✕</button>
                </div>
              ) : (
                <button onClick={() => { setSchedulingAsset({ key: `ig-${i}`, channel: 'instagram', fields: g }); setScheduleDate(''); setScheduleCampaignId('') }}
                  style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #059669', background: '#fff', color: '#059669', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                  📅 Schedule
                </button>
              )}
              {/* Add to Campaign */}
              {activeCampaigns.length > 0 && (
                linkingAsset?.key === `ig-${i}` ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <select onChange={ev => { if (ev.target.value) linkToCampaign(ev.target.value, { type: 'ig', caption: g.caption, category: g.category, targetPersona: g.targetPersona }) }}
                      style={{ border: '1px solid #ec4899', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}
                      defaultValue="">
                      <option value="">— pick campaign —</option>
                      {activeCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button onClick={() => setLinkingAsset(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setLinkingAsset({ key: `ig-${i}` })}
                    style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #ec4899', background: '#fff', color: '#ec4899', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                    + Campaign
                  </button>
                )
              )}
            </div>
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
                  "…{p.visibility?.[c.brand]?.context?.substring(0, 200)}…"
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

// ─── Persona Card with Chat ───────────────────────────────────────────────────
function PersonaCard({ p, index, color, contentEmails = [], contentIg = [] }) {
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const chatEndRef = useRef(null)
  const occupations = Array.isArray(p.occupation) ? p.occupation.join(' · ') : p.occupation

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return
    const userMsg = { role: 'user', content: text }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setStreaming(true)
    setStreamText('')

    try {
      const res = await fetch('/api/persona-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaIndex: index, messages: next }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') break
          try {
            const { token, error } = JSON.parse(payload)
            if (error) { full = `Error: ${error}`; break }
            full += token
            setStreamText(full)
          } catch {}
        }
      }
      setMessages(prev => [...prev, { role: 'assistant', content: full }])
      setStreamText('')
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
    }
    setStreaming(false)
  }

  return (
    <Card accent={color}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#111827', marginBottom: 4 }}>{p.name}</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 2 }}>
            {[p.ageRange || p.age, p.income, p.location].filter(Boolean).join(' · ')}
          </div>
          {occupations && <div style={{ fontSize: 13, color: '#9ca3af' }}>{occupations}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
          <button onClick={() => { setChatOpen(o => !o); setMessages([]); setStreamText('') }}
            style={{ padding: '5px 14px', borderRadius: 8, border: `1px solid ${color}`, background: chatOpen ? color : '#fff', color: chatOpen ? '#fff' : color, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            {chatOpen ? 'Close Chat' : '💬 Chat'}
          </button>
          <div style={{ background: color, color: '#fff', borderRadius: 8, padding: '4px 14px', fontSize: 12, fontWeight: 700 }}>
            Persona {index + 1}
          </div>
        </div>
      </div>

      {/* Quote */}
      {p.quoteExample && (
        <div style={{ background: '#f9fafb', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 14, fontStyle: 'italic', color: '#374151', lineHeight: 1.6, borderLeft: `3px solid ${color}` }}>
          "{p.quoteExample}"
        </div>
      )}

      {/* Chat Panel */}
      {chatOpen && (
        <div style={{ border: `1px solid ${color}30`, borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ background: color, color: '#fff', padding: '8px 14px', fontSize: 12, fontWeight: 700 }}>
            Chatting with {p.name} · Responses reset on refresh
          </div>
          <div style={{ height: 260, overflowY: 'auto', padding: 14, background: '#fafafa', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && !streaming && (
              <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 60 }}>
                Ask {p.name} anything — about shopping, style, what she wants from a brand…
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.5,
                  background: m.role === 'user' ? color : '#fff',
                  color: m.role === 'user' ? '#fff' : '#374151',
                  border: m.role === 'assistant' ? '1px solid #e5e7eb' : 'none',
                }}>
                  {m.content}
                </div>
              </div>
            ))}
            {(streaming || streamText) && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.5, background: '#fff', color: '#374151', border: '1px solid #e5e7eb' }}>
                  {streamText || <span style={{ color: '#9ca3af' }}>…</span>}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 10, background: '#fff', borderTop: '1px solid #e5e7eb' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder={`Ask ${p.name} something…`}
              style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 12px', fontSize: 13, outline: 'none' }}
            />
            <button onClick={sendMessage} disabled={streaming || !input.trim()}
              style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: color, color: '#fff', cursor: streaming ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, opacity: streaming || !input.trim() ? 0.5 : 1 }}>
              Send
            </button>
          </div>
        </div>
      )}

      {/* 2-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20, marginBottom: 16 }}>
        <PersonaSection label="CORE VALUES"         items={p.values}            borderColor={color}     bullet />
        <PersonaSection label="FASHION GOALS"       items={p.fashionGoals}      borderColor="#d1d5db" />
        <PersonaSection label="PURCHASE MOTIVATORS" items={p.motivators}        borderColor={color} />
        <PersonaSection label="PAIN POINTS"         items={p.painPoints}        borderColor="#fca5a5" />
        <PersonaSection label="SHOPPING BEHAVIOR"   items={p.shoppingBehaviors} borderColor="#6ee7b7" />
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

      {p.annKleinFit && (
        <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', marginBottom: 4 }}>WHY ANNE KLEIN FITS</div>
          <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{p.annKleinFit}</p>
        </div>
      )}

      {p.preferredChannels?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: (contentEmails.length || contentIg.length) ? 16 : 0 }}>
          <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Preferred channels:</span>
          {p.preferredChannels.map((ch, j) => (
            <span key={j} style={{ fontSize: 12, background: '#f3f4f6', color: '#374151', borderRadius: 6, padding: '2px 10px' }}>{j + 1}. {ch}</span>
          ))}
        </div>
      )}

      {(contentEmails.length > 0 || contentIg.length > 0) && (
        <div style={{ borderTop: `1px solid ${color}30`, paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 10 }}>CONTENT ASSETS TARGETING THIS PERSONA</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {contentEmails.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#f5f3ff', borderRadius: 6, padding: '6px 10px' }}>
                <span style={{ fontSize: 12, color: '#6366f1' }}>📧</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>"{e.subjectLine}"</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{e.theme} · {e.sendTiming}</div>
                </div>
              </div>
            ))}
            {contentIg.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#fdf2f8', borderRadius: 6, padding: '6px 10px' }}>
                <span style={{ fontSize: 12, color: '#ec4899' }}>📸</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{g.category}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{g.caption?.slice(0, 90)}…</div>
                </div>
              </div>
            ))}
          </div>
          {!contentEmails.length && !contentIg.length && (
            <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No tagged content yet — re-run Module 5 to generate persona-targeted assets.</div>
          )}
        </div>
      )}
    </Card>
  )
}

function PersonasTab({ personas, content }) {
  const [suggestions, setSuggestions] = useState(null)
  const [suggesting, setSuggesting] = useState(false)

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

  async function discoverPersonas() {
    setSuggesting(true)
    try {
      const res = await fetch('/api/suggest-personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      setSuggestions(data.suggestions || [])
    } catch {}
    setSuggesting(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <SectionHeader>Customer Personas</SectionHeader>
        <button onClick={discoverPersonas} disabled={suggesting}
          style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #6366f1', background: '#fff', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: suggesting ? 0.6 : 1 }}>
          {suggesting ? 'Analyzing…' : '✨ Discover Adjacent Personas'}
        </button>
      </div>
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

      {suggestions && (
        <div style={{ marginBottom: 24 }}>
          <SectionHeader>Adjacent Persona Opportunities</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {suggestions.map((s, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, borderTop: '3px solid #8b5cf6' }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#111827', marginBottom: 4 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>{s.ageRange} · {s.income}</div>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 8, lineHeight: 1.5 }}>{s.rationale}</div>
                <div style={{ fontSize: 12, color: '#6366f1', background: '#ede9fe', borderRadius: 6, padding: '4px 10px', marginBottom: 8 }}>{s.keyDifference}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: s.opportunitySize === 'high' ? '#059669' : s.opportunitySize === 'medium' ? '#d97706' : '#6b7280', textTransform: 'uppercase' }}>
                  {s.opportunitySize} opportunity
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {personas.personas.map((p, i) => {
        const emails = (content?.content?.emailCampaigns?.emailCampaigns || []).filter(e => e.targetPersona === p.name)
        const ig = (content?.content?.instagramCaptions?.instagramCaptions || []).filter(g => g.targetPersona === p.name)
        return <PersonaCard key={i} p={p} index={i} color={PERSONA_COLORS[i % PERSONA_COLORS.length]} contentEmails={emails} contentIg={ig} />
      })}
    </div>
  )
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────
const CAMPAIGN_STATUSES = ['planning', 'active', 'complete', 'paused']
const STATUS_COLORS = { planning: '#6366f1', active: '#10b981', complete: '#6b7280', paused: '#f59e0b' }
const CHANNELS = ['email', 'instagram', 'site', 'hero', 'sms', 'other']

function CampaignsTab({ campaigns, setCampaigns, personas, content, setCalItems }) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({})
  const [generatingBrief, setGeneratingBrief] = useState(null)
  const [contentSuggestions, setContentSuggestions] = useState({}) // campaignId → { emails, ig }
  const personaNames = personas?.personas?.map(p => p.name) || []

  const PCOLS = { 'The Polished Professional': '#6366f1', 'The Emerging Leader': '#10b981', 'The Refined Rewinder': '#f59e0b', 'The Practical Multitasker': '#ec4899' }

  function openNew() {
    setForm({ name: '', status: 'planning', startDate: '', endDate: '', persona: personaNames[0] || '', styleGuide: { colorDirection: '', moodKeywords: [], avoidWords: [], heroImageDirection: '' } })
    setEditId(null)
    setShowForm(true)
  }

  function openEdit(c) {
    setForm(JSON.parse(JSON.stringify(c)))
    setEditId(c.id)
    setShowForm(true)
  }

  async function save() {
    const isNew = !editId
    const method = editId ? 'PUT' : 'POST'
    const url = editId ? `/api/campaigns/${editId}` : '/api/campaigns'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const saved = await res.json()
    setCampaigns(prev => editId ? prev.map(c => c.id === editId ? saved : c) : [...prev, saved])
    setShowForm(false)

    // Auto-create a calendar placeholder on the campaign start date
    if (isNew && saved.startDate && setCalItems) {
      const calRes = await fetch('/api/calendar/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: saved.startDate,
          channel: 'email',
          status: 'brief',
          campaignId: saved.id,
          personaTarget: saved.persona || '',
          theme: `${saved.name} — Launch`,
        }),
      })
      const calItem = await calRes.json()
      setCalItems(prev => [...prev, calItem])
    }

    // After creating a new campaign, surface matching content assets
    if (isNew && content?.content) {
      const persona = saved.persona
      const emails = (content.content.emailCampaigns?.emailCampaigns || [])
        .filter(e => !persona || !e.targetPersona || e.targetPersona === persona)
        .slice(0, 4)
      const ig = (content.content.instagramCaptions?.instagramCaptions || [])
        .filter(g => !persona || !g.targetPersona || g.targetPersona === persona)
        .slice(0, 3)
      if (emails.length || ig.length) {
        setContentSuggestions(prev => ({ ...prev, [saved.id]: { emails, ig } }))
      }
    }
  }

  async function pinContent(campaignId, asset) {
    await fetch(`/api/campaigns/${campaignId}/link-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(asset),
    })
    setCampaigns(prev => prev.map(c => {
      if (c.id !== campaignId) return c
      const linked = c.linkedContent || []
      const key = asset.type === 'email' ? asset.subjectLine : asset.caption?.slice(0, 80)
      if (linked.some(a => (a.type === 'email' ? a.subjectLine : a.caption?.slice(0, 80)) === key)) return c
      return { ...c, linkedContent: [...linked, asset] }
    }))
  }

  async function deleteCampaign(id) {
    if (!confirm('Delete this campaign?')) return
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
    setCampaigns(prev => prev.filter(c => c.id !== id))
  }

  async function generateBrief(id) {
    setGeneratingBrief(id)
    const res = await fetch(`/api/campaigns/${id}/generate-brief`, { method: 'POST' })
    const { brief } = await res.json()
    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, brief } : c))
    setGeneratingBrief(null)
  }

  const setFormIn = (path, val) => {
    const keys = path.split('.')
    setForm(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
      obj[keys[keys.length - 1]] = val
      return next
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <SectionHeader>Campaigns</SectionHeader>
        <button onClick={openNew} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          + New Campaign
        </button>
      </div>

      {/* Campaign Form */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 20 }}>{editId ? 'Edit Campaign' : 'New Campaign'}</div>
            {[
              { label: 'Campaign Name', key: 'name', type: 'text' },
              { label: 'Start Date', key: 'startDate', type: 'date' },
              { label: 'End Date', key: 'endDate', type: 'date' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>{f.label}</div>
                <input type={f.type} value={form[f.key] || ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Target Persona</div>
              <select value={form.persona || ''} onChange={e => setForm(p => ({ ...p, persona: e.target.value }))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                <option value="">— none —</option>
                {personaNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Status</div>
              <select value={form.status || 'planning'} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                {CAMPAIGN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10, marginTop: 4 }}>Style Guide</div>
            {[
              { label: 'Color Direction (e.g. "Navy, blush, bone")', key: 'styleGuide.colorDirection' },
              { label: 'Hero Image Direction (1 sentence)', key: 'styleGuide.heroImageDirection' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>{f.label}</div>
                <input value={(f.key.includes('.') ? form.styleGuide?.[f.key.split('.')[1]] : form[f.key]) || ''}
                  onChange={e => setFormIn(f.key, e.target.value)}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Mood Keywords (comma separated)</div>
              <input value={(form.styleGuide?.moodKeywords || []).join(', ')}
                onChange={e => setFormIn('styleGuide.moodKeywords', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Avoid Words (comma separated)</div>
              <input value={(form.styleGuide?.avoidWords || []).join(', ')}
                onChange={e => setFormIn('styleGuide.avoidWords', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={save} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {campaigns.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗂️</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No campaigns yet</div>
          <div style={{ fontSize: 13 }}>Create a campaign to group content under shared creative direction.</div>
        </div>
      )}

      {campaigns.map(c => (
        <Card key={c.id} accent={STATUS_COLORS[c.status] || '#6366f1'}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: '#111827', marginBottom: 4 }}>{c.name}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {[c.startDate, c.endDate].filter(Boolean).join(' → ')}
                {c.persona && <span> · {c.persona}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ background: STATUS_COLORS[c.status] + '20', color: STATUS_COLORS[c.status], borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>{c.status}</span>
              <button onClick={() => openEdit(c)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Edit</button>
              <button onClick={() => deleteCampaign(c.id)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>Delete</button>
            </div>
          </div>

          {c.styleGuide && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {c.styleGuide.colorDirection && <span style={{ fontSize: 12, background: '#f3f4f6', borderRadius: 6, padding: '3px 10px' }}>🎨 {c.styleGuide.colorDirection}</span>}
              {(c.styleGuide.moodKeywords || []).map((k, i) => <span key={i} style={{ fontSize: 12, background: '#ede9fe', color: '#6366f1', borderRadius: 6, padding: '3px 10px' }}>{k}</span>)}
              {(c.styleGuide.avoidWords || []).map((k, i) => <span key={i} style={{ fontSize: 12, background: '#fee2e2', color: '#ef4444', borderRadius: 6, padding: '3px 10px' }}>✕ {k}</span>)}
            </div>
          )}

          {c.brief ? (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 14, fontSize: 13, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{c.brief}</div>
          ) : (
            <button onClick={() => generateBrief(c.id)} disabled={generatingBrief === c.id}
              style={{ padding: '7px 16px', borderRadius: 8, border: '1px dashed #6366f1', background: '#fff', color: '#6366f1', cursor: 'pointer', fontSize: 13, opacity: generatingBrief === c.id ? 0.6 : 1 }}>
              {generatingBrief === c.id ? '✨ Generating brief…' : '✨ Generate Campaign Brief'}
            </button>
          )}

          {/* Pinned content assets */}
          {(c.linkedContent || []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>PINNED CONTENT</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {c.linkedContent.map((a, ai) => (
                  <div key={ai} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f9fafb', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
                    <span style={{ color: a.type === 'email' ? '#6366f1' : '#ec4899', fontWeight: 700 }}>{a.type === 'email' ? '📧' : '📸'}</span>
                    <span style={{ color: '#374151', flex: 1 }}>{a.type === 'email' ? `"${a.subjectLine}"` : a.caption?.slice(0, 80) + '…'}</span>
                    {a.targetPersona && <span style={{ color: PCOLS[a.targetPersona] || '#9ca3af', fontSize: 11, fontWeight: 600 }}>{a.targetPersona}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-suggested content (shown after new campaign creation) */}
          {contentSuggestions[c.id] && (
            <div style={{ marginTop: 14, border: '1px dashed #6366f1', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6366f1' }}>SUGGESTED CONTENT FOR THIS CAMPAIGN</div>
                <button onClick={() => setContentSuggestions(prev => { const n = { ...prev }; delete n[c.id]; return n })}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12 }}>dismiss</button>
              </div>
              {contentSuggestions[c.id].emails.map((e, ei) => (
                <div key={ei} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, background: '#f9fafb', borderRadius: 6, padding: '5px 10px' }}>
                  <span style={{ fontSize: 12, color: '#6366f1' }}>📧</span>
                  <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>"{e.subjectLine}" <span style={{ color: '#9ca3af' }}>· {e.theme}</span></span>
                  {e.targetPersona && <span style={{ fontSize: 11, color: PCOLS[e.targetPersona] || '#9ca3af', fontWeight: 600 }}>{e.targetPersona}</span>}
                  <button onClick={() => pinContent(c.id, { type: 'email', subjectLine: e.subjectLine, theme: e.theme, targetPersona: e.targetPersona, brief: e.brief })}
                    style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid #6366f1', background: '#fff', color: '#6366f1', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>Pin</button>
                </div>
              ))}
              {contentSuggestions[c.id].ig.map((g, gi) => (
                <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, background: '#f9fafb', borderRadius: 6, padding: '5px 10px' }}>
                  <span style={{ fontSize: 12, color: '#ec4899' }}>📸</span>
                  <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>{g.category} <span style={{ color: '#9ca3af' }}>· {g.caption?.slice(0, 60)}…</span></span>
                  {g.targetPersona && <span style={{ fontSize: 11, color: PCOLS[g.targetPersona] || '#9ca3af', fontWeight: 600 }}>{g.targetPersona}</span>}
                  <button onClick={() => pinContent(c.id, { type: 'ig', caption: g.caption, category: g.category, targetPersona: g.targetPersona })}
                    style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid #ec4899', background: '#fff', color: '#ec4899', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>Pin</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

// ─── Calendar Tab ─────────────────────────────────────────────────────────────
const CHANNEL_COLORS = { email: '#6366f1', instagram: '#ec4899', site: '#f59e0b', hero: '#3b82f6', sms: '#10b981', other: '#6b7280' }
const CHANNEL_ICONS  = { email: '📧', instagram: '📸', site: '🌐', hero: '🖼️', sms: '💬', other: '📌' }
const ITEM_STATUSES  = ['brief', 'ready', 'sent']
const STATUS_BG      = { brief: '#ede9fe', ready: '#d1fae5', sent: '#f3f4f6' }
const STATUS_FG      = { brief: '#6366f1', ready: '#059669', sent: '#6b7280' }

function getWeekDates(baseDate) {
  const d = new Date(baseDate)
  const day = d.getDay()
  const start = new Date(d)
  start.setDate(d.getDate() - day)
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(start)
    dt.setDate(start.getDate() + i)
    return dt
  })
}

function dateKey(d) {
  return d.toISOString().slice(0, 10)
}

function CalendarItemDrawer({ item, onClose, onSave, onDelete, campaigns, personas, catalog }) {
  const [draft, setDraft] = useState(JSON.parse(JSON.stringify(item)))
  const [saving, setSaving] = useState(false)
  const [genBrief, setGenBrief] = useState(false)
  const [genHero, setGenHero] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const personaNames = personas?.personas?.map(p => p.name) || []

  const allProducts = catalog?.products || []
  const filteredProducts = allProducts
    .filter(p => !productSearch || p.name?.toLowerCase().includes(productSearch.toLowerCase()) || p.category?.toLowerCase().includes(productSearch.toLowerCase()))
    .slice(0, 24)

  const isSelected = (p) => draft.selectedProducts?.some(s => s.href === p.href)

  function toggleProduct(p) {
    setDraft(prev => {
      const sel = prev.selectedProducts || []
      const exists = sel.some(s => s.href === p.href)
      return { ...prev, selectedProducts: exists ? sel.filter(s => s.href !== p.href) : [...sel, { name: p.name, href: p.href, image: p.image, price: p.price, category: p.category }] }
    })
  }

  async function save() {
    setSaving(true)
    const res = await fetch(`/api/calendar/item/${draft.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
    const saved = await res.json()
    onSave(saved)
    setSaving(false)
  }

  async function doGenBrief() {
    setSaving(true); setGenBrief(true)
    const res = await fetch(`/api/calendar/item/${draft.id}/generate-brief`, { method: 'POST' })
    const { brief } = await res.json()
    setDraft(p => ({ ...p, brief }))
    setSaving(false); setGenBrief(false)
  }

  async function doGenHero() {
    setSaving(true); setGenHero(true)
    const res = await fetch(`/api/calendar/item/${draft.id}/generate-hero-brief`, { method: 'POST' })
    const { heroImageBrief } = await res.json()
    setDraft(p => ({ ...p, heroImageBrief }))
    setSaving(false); setGenHero(false)
  }

  const iStyle = { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxSizing: 'border-box' }
  const taStyle = { ...iStyle, resize: 'vertical', minHeight: 70 }
  const Label = ({ children }) => <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4, marginTop: 12 }}>{children}</div>

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)' }} onClick={onClose} />
      <div style={{ width: 520, background: '#fff', overflowY: 'auto', boxShadow: '-4px 0 30px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column' }}>
        {/* Drawer header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9fafb' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            {CHANNEL_ICONS[draft.channel] || '📌'} {draft.theme || 'New Item'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { if (confirm('Delete this item?')) onDelete(draft.id) }} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>Delete</button>
            <button onClick={onClose} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Close</button>
            <button onClick={save} disabled={saving} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>

        <div style={{ padding: '16px 20px', flex: 1 }}>
          {/* Row: date + channel + status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div><Label>Date</Label><input type="date" value={draft.date || ''} onChange={e => setDraft(p => ({ ...p, date: e.target.value }))} style={iStyle} /></div>
            <div><Label>Channel</Label>
              <select value={draft.channel || 'email'} onChange={e => setDraft(p => ({ ...p, channel: e.target.value }))} style={iStyle}>
                {CHANNELS.map(c => <option key={c} value={c}>{CHANNEL_ICONS[c]} {c}</option>)}
              </select>
            </div>
            <div><Label>Status</Label>
              <select value={draft.status || 'brief'} onChange={e => setDraft(p => ({ ...p, status: e.target.value }))} style={iStyle}>
                {ITEM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <Label>Theme / Campaign Angle</Label>
          <input value={draft.theme || ''} onChange={e => setDraft(p => ({ ...p, theme: e.target.value }))} style={iStyle} placeholder="e.g. Spring Into Work — Monday-to-Friday formula" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><Label>Target Persona</Label>
              <select value={draft.personaTarget || ''} onChange={e => setDraft(p => ({ ...p, personaTarget: e.target.value }))} style={iStyle}>
                <option value="">— none —</option>
                {personaNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div><Label>Campaign</Label>
              <select value={draft.campaignId || ''} onChange={e => setDraft(p => ({ ...p, campaignId: e.target.value || null }))} style={iStyle}>
                <option value="">— none —</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><Label>Assigned To</Label><input value={draft.assignedTo || ''} onChange={e => setDraft(p => ({ ...p, assignedTo: e.target.value }))} style={iStyle} placeholder="Name or team" /></div>
          </div>

          {(draft.channel === 'email' || draft.channel === 'sms') && <>
            <Label>Subject Line</Label>
            <input value={draft.subjectLine || ''} onChange={e => setDraft(p => ({ ...p, subjectLine: e.target.value }))} style={iStyle} placeholder="Under 45 characters" />
            <Label>Preview Text</Label>
            <input value={draft.previewText || ''} onChange={e => setDraft(p => ({ ...p, previewText: e.target.value }))} style={iStyle} placeholder="Under 90 characters" />
          </>}

          {/* Brief */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>CONTENT BRIEF</div>
            <button onClick={doGenBrief} disabled={genBrief || saving}
              style={{ fontSize: 12, color: '#6366f1', border: '1px dashed #6366f1', background: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', opacity: genBrief ? 0.6 : 1 }}>
              {genBrief ? '✨ Generating…' : '✨ Generate Brief'}
            </button>
          </div>
          <textarea value={draft.brief || ''} onChange={e => setDraft(p => ({ ...p, brief: e.target.value }))} style={{ ...taStyle, minHeight: 100 }} placeholder="What to feature, key message, CTA, tone notes…" />

          {/* Hero image brief */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>HERO IMAGE BRIEF</div>
            <button onClick={doGenHero} disabled={genHero || saving}
              style={{ fontSize: 12, color: '#3b82f6', border: '1px dashed #3b82f6', background: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', opacity: genHero ? 0.6 : 1 }}>
              {genHero ? '✨ Generating…' : '✨ Generate Hero Brief'}
            </button>
          </div>
          <textarea value={draft.heroImageBrief || ''} onChange={e => setDraft(p => ({ ...p, heroImageBrief: e.target.value }))} style={taStyle} placeholder="Subject, setting, wardrobe, mood, AI image prompt…" />

          <Label>Notes</Label>
          <textarea value={draft.notes || ''} onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))} style={taStyle} placeholder="Internal notes…" />

          {/* Product Picker */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 8 }}>FEATURED PRODUCTS
              {draft.selectedProducts?.length > 0 && <span style={{ marginLeft: 8, background: '#6366f1', color: '#fff', borderRadius: 10, padding: '1px 8px', fontSize: 11 }}>{draft.selectedProducts.length} selected</span>}
            </div>
            {draft.selectedProducts?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {draft.selectedProducts.map(p => (
                  <div key={p.href} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#ede9fe', borderRadius: 8, padding: '4px 8px' }}>
                    {p.image && <img src={p.image} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} />}
                    <span style={{ fontSize: 12, color: '#6366f1', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span onClick={() => toggleProduct(p)} style={{ cursor: 'pointer', color: '#6366f1', fontWeight: 700, fontSize: 14 }}>×</span>
                  </div>
                ))}
              </div>
            )}
            <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search products by name or category…"
              style={{ ...iStyle, marginBottom: 8 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {filteredProducts.map(p => (
                <div key={p.href} onClick={() => toggleProduct(p)}
                  style={{ border: `2px solid ${isSelected(p) ? '#6366f1' : '#e5e7eb'}`, borderRadius: 8, padding: 6, cursor: 'pointer', background: isSelected(p) ? '#ede9fe' : '#fff', textAlign: 'center' }}>
                  {p.image && <img src={p.image} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 4, marginBottom: 4 }} />}
                  <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>${p.price}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CalendarTab({ calItems, setCalItems, campaigns, personas, catalog }) {
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date()
    const d = new Date(today)
    d.setDate(today.getDate() - today.getDay())
    return dateKey(d)
  })
  const [drawerItem, setDrawerItem] = useState(null)

  const weekDates = getWeekDates(new Date(weekStart + 'T12:00:00'))
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  function prevWeek() {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() - 7)
    setWeekStart(dateKey(d))
  }
  function nextWeek() {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + 7)
    setWeekStart(dateKey(d))
  }

  const monthLabel = weekDates[0].toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  async function addItem(date) {
    const res = await fetch('/api/calendar/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, channel: 'email', status: 'brief', theme: '' }),
    })
    const item = await res.json()
    setCalItems(prev => [...prev, item])
    setDrawerItem(item)
  }

  async function deleteItem(id) {
    await fetch(`/api/calendar/item/${id}`, { method: 'DELETE' })
    setCalItems(prev => prev.filter(i => i.id !== id))
    setDrawerItem(null)
  }

  function onSave(updated) {
    setCalItems(prev => prev.map(i => i.id === updated.id ? updated : i))
    setDrawerItem(updated)
  }

  const today = dateKey(new Date())

  return (
    <div>
      {/* Week nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <SectionHeader style={{ margin: 0 }}>Content Calendar</SectionHeader>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={prevWeek} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}>← Prev</button>
          <div style={{ fontWeight: 700, fontSize: 14, minWidth: 160, textAlign: 'center' }}>{monthLabel}</div>
          <button onClick={nextWeek} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Next →</button>
        </div>
      </div>

      {/* Campaign legend */}
      {campaigns?.filter(c => c.startDate && c.endDate).length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af' }}>CAMPAIGNS:</span>
          {campaigns.filter(c => c.startDate && c.endDate).map((c, ci) => (
            <span key={c.id} style={{ fontSize: 11, background: Object.values(STATUS_COLORS)[ci % 4] + '20', color: Object.values(STATUS_COLORS)[ci % 4], borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>{c.name}</span>
          ))}
        </div>
      )}

      {/* Week grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {weekDates.map((date, di) => {
          const dk = dateKey(date)
          const dayItems = calItems.filter(i => i.date === dk)
          const isToday = dk === today
          const activeCamps = (campaigns || []).filter(c => {
            if (!c.startDate || !c.endDate) return false
            return dk >= c.startDate && dk <= c.endDate
          })
          return (
            <div key={dk} style={{ minHeight: 120, background: '#fff', borderRadius: 10, border: `1px solid ${isToday ? '#6366f1' : '#e5e7eb'}`, padding: 8, display: 'flex', flexDirection: 'column' }}>
              {/* Campaign bands */}
              {activeCamps.map((c, ci) => (
                <div key={c.id} title={c.name}
                  style={{ height: 4, borderRadius: 2, marginBottom: 3, background: Object.values(STATUS_COLORS)[campaigns.indexOf(c) % 4] }} />
              ))}
              {/* Day header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>{DAY_NAMES[di]}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: isToday ? '#6366f1' : '#111827' }}>{date.getDate()}</div>
                </div>
                <button onClick={() => addItem(dk)}
                  style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', lineHeight: 1 }}>+</button>
              </div>

              {/* Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                {dayItems.map(item => (
                  <div key={item.id} onClick={() => setDrawerItem(item)}
                    style={{ background: (CHANNEL_COLORS[item.channel] || '#6b7280') + '18', borderLeft: `3px solid ${CHANNEL_COLORS[item.channel] || '#6b7280'}`, borderRadius: 5, padding: '4px 7px', cursor: 'pointer', fontSize: 11 }}>
                    <div style={{ fontWeight: 700, color: CHANNEL_COLORS[item.channel] || '#6b7280', textTransform: 'uppercase', fontSize: 10 }}>{item.channel}</div>
                    <div style={{ color: '#374151', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.theme || '(no theme)'}</div>
                    <div style={{ marginTop: 2 }}>
                      <span style={{ fontSize: 10, background: STATUS_BG[item.status], color: STATUS_FG[item.status], borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>{item.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Drawer */}
      {drawerItem && (
        <CalendarItemDrawer
          item={drawerItem}
          onClose={() => setDrawerItem(null)}
          onSave={onSave}
          onDelete={deleteItem}
          campaigns={campaigns}
          personas={personas}
          catalog={catalog}
        />
      )}
    </div>
  )
}

// ─── SEO Product Intelligence Tab ────────────────────────────────────────────
const SEO_FILTERS = [
  { id: 'all',          label: 'All' },
  { id: 'new_arrivals', label: 'New Arrivals' },
  { id: 'clothing',     label: 'Clothing' },
  { id: 'shoes',        label: 'Shoes' },
  { id: 'jewelry',      label: 'Jewelry' },
  { id: 'handbags',     label: 'Handbags' },
]

function SeoProductTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runLog, setRunLog] = useState(null)
  const [viewFilter, setViewFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [runFilter, setRunFilter] = useState('new_arrivals')
  const [runLimit, setRunLimit] = useState(50)
  const [forceReanalyze, setForceReanalyze] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [bulkApproving, setBulkApproving] = useState(false)
  const [expandedHref, setExpandedHref] = useState(null)
  const pollRef = useRef(null)
  const [shopifyConfig, setShopifyConfig] = useState(null)
  const [reanalyzingHref, setReanalyzingHref] = useState(null)
  const [pushing, setPushing] = useState(false)
  const [pushLog, setPushLog] = useState(null)

  useEffect(() => {
    fetch('/api/shopify/status').then(r => r.json()).then(setShopifyConfig).catch(() => {})
  }, [])

  async function loadData() {
    setLoading(true)
    const params = new URLSearchParams({ status: statusFilter, filter: viewFilter })
    const res = await fetch(`/api/seo-suggestions?${params}`)
    const d = await res.json()
    setData(d)
    setSelected(new Set())
    setLoading(false)
  }

  useEffect(() => { loadData() }, [statusFilter, viewFilter])

  async function runAnalysis() {
    setRunning(true)
    setRunLog(null)
    // Poll every 3s to update progress bar while the child process runs
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/seo-suggestions')
        const d = await r.json()
        setData(prev => prev ? { ...prev, totalAnalyzed: d.totalAnalyzed, totalProducts: d.totalProducts } : d)
      } catch {}
    }, 3000)
    const res = await fetch('/api/seo-suggestions/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: runFilter, limit: runLimit, force: forceReanalyze }),
    })
    clearInterval(pollRef.current)
    pollRef.current = null
    const result = await res.json()
    setRunLog(result)
    setRunning(false)
    loadData()
  }

  async function updateStatus(href, status) {
    await fetch('/api/seo-suggestions/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ href, status }),
    })
    setData(prev => ({ ...prev, products: prev.products.map(p => p.href === href ? { ...p, status } : p) }))
    setSelected(prev => { const s = new Set(prev); s.delete(href); return s; })
  }

  async function bulkApprove() {
    setBulkApproving(true)
    await fetch('/api/seo-suggestions/bulk-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hrefs: [...selected] }),
    })
    setBulkApproving(false)
    loadData()
  }

  async function pushToShopify(hrefs, dryRun = false) {
    setPushing(true)
    setPushLog(null)
    const res = await fetch('/api/seo-suggestions/push-shopify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hrefs, dryRun }),
    })
    const result = await res.json()
    setPushLog(result)
    setPushing(false)
    loadData()
  }

  async function reanalyzeOne(href) {
    setReanalyzingHref(href)
    try {
      const res = await fetch('/api/seo-suggestions/reanalyze-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ href }),
      })
      const result = await res.json()
      if (!result.ok) alert(`Re-analyze failed: ${result.output?.split('\n').pop() || 'unknown error'}`)
    } catch (err) {
      alert(`Re-analyze error: ${err.message}`)
    }
    setReanalyzingHref(null)
    loadData()
  }

  function toggleSelect(href) {
    setSelected(prev => { const s = new Set(prev); s.has(href) ? s.delete(href) : s.add(href); return s; })
  }
  function toggleSelectAll() {
    const all = (data?.products || []).map(p => p.href)
    setSelected(prev => prev.size === all.length ? new Set() : new Set(all))
  }

  const products = data?.products || []
  const totalAnalyzed = data?.totalAnalyzed || 0
  const totalProducts = data?.totalProducts || 0
  const pctDone = totalProducts > 0 ? Math.round((totalAnalyzed / totalProducts) * 100) : 0

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <SectionHeader>SEO Product Intelligence</SectionHeader>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            {totalAnalyzed} of {totalProducts} products analyzed ({pctDone}%)
          </div>
          <div style={{ marginTop: 6, width: 220, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pctDone}%`, background: '#6366f1', borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
        </div>

        {/* Run controls */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>FILTER</div>
            <select value={runFilter} onChange={e => setRunFilter(e.target.value)}
              style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
              {SEO_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>BATCH SIZE</div>
            <select value={runLimit} onChange={e => setRunLimit(Number(e.target.value))}
              style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
              {[25, 50, 100].map(n => <option key={n} value={n}>{n} products</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer', userSelect: 'none', paddingBottom: 2 }}>
            <input type="checkbox" checked={forceReanalyze} onChange={e => setForceReanalyze(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: '#f59e0b', cursor: 'pointer' }} />
            <span>Re-analyze existing</span>
          </label>
          <button onClick={runAnalysis} disabled={running}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: forceReanalyze ? '#f59e0b' : '#6366f1', color: '#fff', cursor: running ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, opacity: running ? 0.7 : 1 }}>
            {running ? '⚙️ Analyzing…' : forceReanalyze ? '🔄 Re-analyze Batch' : '✨ Analyze Next Batch'}
          </button>
          <a href="/api/seo-suggestions/export-csv" download
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
            ↓ Export CSV
          </a>
        </div>
      </div>

      {/* Shopify connection status banner */}
      {shopifyConfig && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 8, marginBottom: 14,
          background: shopifyConfig.configured ? '#f0fdf4' : '#fefce8',
          border: `1px solid ${shopifyConfig.configured ? '#bbf7d0' : '#fde68a'}` }}>
          <span style={{ fontSize: 16 }}>{shopifyConfig.configured ? '🟢' : '🔑'}</span>
          <div style={{ flex: 1, fontSize: 12 }}>
            {shopifyConfig.configured
              ? <><strong>Shopify connected</strong> — {shopifyConfig.domain} · API {shopifyConfig.apiVersion}</>
              : <><strong>Shopify not connected</strong> — Add <code style={{ background: '#fef9c3', padding: '1px 4px', borderRadius: 3 }}>SHOPIFY_STORE_DOMAIN</code> and <code style={{ background: '#fef9c3', padding: '1px 4px', borderRadius: 3 }}>SHOPIFY_ADMIN_API_TOKEN</code> to your .env to enable pushing</>}
          </div>
        </div>
      )}

      {/* Run log */}
      {runLog && (
        <div style={{ background: runLog.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${runLog.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: runLog.ok ? '#059669' : '#dc2626' }}>
            {runLog.ok ? `✓ Batch complete — ${runLog.totalAnalyzed} of ${runLog.totalProducts} products analyzed` : '✗ Analysis encountered errors'}
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, maxHeight: 120, overflowY: 'auto', color: '#6b7280' }}>{runLog.output}</pre>
        </div>
      )}

      {/* Push log */}
      {pushLog && (
        <div style={{ background: pushLog.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${pushLog.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: pushLog.ok ? '#059669' : '#dc2626' }}>
            {pushLog.ok
              ? `✓ Push complete — ${pushLog.pushed} pushed to Shopify${pushLog.errors ? `, ${pushLog.errors} errors` : ''}`
              : `✗ Push failed — ${pushLog.errors} errors`}
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, maxHeight: 120, overflowY: 'auto', color: '#6b7280' }}>{pushLog.output}</pre>
        </div>
      )}

      {/* View filter pills + status tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SEO_FILTERS.map(f => (
            <button key={f.id} onClick={() => setViewFilter(f.id)}
              style={{ padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: viewFilter === f.id ? '#6366f1' : '#f3f4f6', color: viewFilter === f.id ? '#fff' : '#374151' }}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['pending', 'approved', 'skipped'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, textTransform: 'capitalize', cursor: 'pointer',
                background: statusFilter === s ? { pending: '#ede9fe', approved: '#d1fae5', skipped: '#f3f4f6' }[s] : '#fff',
                color: statusFilter === s ? { pending: '#6366f1', approved: '#059669', skipped: '#6b7280' }[s] : '#9ca3af',
                border: '1px solid #e5e7eb' }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar — pending */}
      {statusFilter === 'pending' && products.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '8px 12px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <input type="checkbox" checked={selected.size === products.length && products.length > 0}
            onChange={toggleSelectAll} style={{ width: 16, height: 16, cursor: 'pointer' }} />
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {selected.size > 0 ? `${selected.size} selected` : `Select all ${products.length}`}
          </span>
          {selected.size > 0 && (
            <button onClick={bulkApprove} disabled={bulkApproving}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              {bulkApproving ? 'Approving…' : `✓ Approve ${selected.size}`}
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar — approved */}
      {statusFilter === 'approved' && products.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '8px 12px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <input type="checkbox" checked={selected.size === products.length && products.length > 0}
            onChange={toggleSelectAll} style={{ width: 16, height: 16, cursor: 'pointer' }} />
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {selected.size > 0 ? `${selected.size} selected` : `Select all ${products.length}`}
          </span>
          {selected.size > 0 && shopifyConfig?.configured && (
            <button onClick={() => pushToShopify([...selected])} disabled={pushing}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#0284c7', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, opacity: pushing ? 0.7 : 1 }}>
              {pushing ? '⏳ Pushing…' : `↑ Push ${selected.size} to Shopify`}
            </button>
          )}
          {selected.size > 0 && !shopifyConfig?.configured && (
            <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>🔑 Add Shopify credentials to push</span>
          )}
          {selected.size > 0 && shopifyConfig?.configured && (
            <button onClick={() => pushToShopify([...selected], true)} disabled={pushing}
              style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', cursor: 'pointer', fontSize: 12 }}>
              Dry run
            </button>
          )}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading…</div>}

      {!loading && products.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            {totalAnalyzed === 0 ? 'No products analyzed yet' : `No ${statusFilter} suggestions`}
          </div>
          <div style={{ fontSize: 13 }}>
            {totalAnalyzed === 0 ? 'Choose a filter and batch size above, then click Analyze Next Batch.' : `All products in this view have been reviewed.`}
          </div>
        </div>
      )}

      {/* Product rows */}
      {!loading && products.map(p => {
        const isExpanded = expandedHref === p.href
        const isSelected = selected.has(p.href)
        const isPushed = p.pushStatus === 'pushed'
        const isPushError = p.pushStatus === 'error'
        return (
          <div key={p.href} style={{ background: '#fff', border: `1px solid ${isSelected ? '#6366f1' : '#e5e7eb'}`, borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
            {/* Collapsed row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }}
              onClick={() => setExpandedHref(isExpanded ? null : p.href)}>
              {(statusFilter === 'pending' || statusFilter === 'approved') && (
                <input type="checkbox" checked={isSelected} onChange={e => { e.stopPropagation(); toggleSelect(p.href) }}
                  onClick={e => e.stopPropagation()} style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
              )}
              <div style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: '#f3f4f6' }}>
                {p.image ? <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👗</div>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {p.category} · {p.price}
                  {p.isNewArrival && <span style={{ marginLeft: 8, background: '#d1fae5', color: '#059669', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>NEW</span>}
                </div>
                {p.suggested?.meta_title && (
                  <div style={{ fontSize: 12, color: '#6366f1', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    → {p.suggested.meta_title}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, textTransform: 'capitalize',
                  background: { pending: '#ede9fe', approved: '#d1fae5', skipped: '#f3f4f6' }[p.status],
                  color: { pending: '#6366f1', approved: '#059669', skipped: '#6b7280' }[p.status] }}>
                  {p.status}
                </span>
                {p.status === 'pending' && <>
                  <button onClick={e => { e.stopPropagation(); updateStatus(p.href, 'approved') }}
                    style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>✓ Approve</button>
                  <button onClick={e => { e.stopPropagation(); updateStatus(p.href, 'skipped') }}
                    style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', cursor: 'pointer', fontSize: 11 }}>Skip</button>
                </>}
                <button onClick={e => { e.stopPropagation(); reanalyzeOne(p.href) }}
                  disabled={reanalyzingHref === p.href}
                  title="Re-analyze this product with the latest AI model"
                  style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #d1d5db', background: reanalyzingHref === p.href ? '#f3f4f6' : '#fff', color: '#6366f1', cursor: reanalyzingHref === p.href ? 'not-allowed' : 'pointer', fontSize: 11 }}>
                  {reanalyzingHref === p.href ? '⚙️' : '↻'}
                </button>
                {p.status !== 'pending' && (
                  <button onClick={e => { e.stopPropagation(); updateStatus(p.href, 'pending') }}
                    style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', cursor: 'pointer', fontSize: 11 }}>Undo</button>
                )}
                {p.status === 'approved' && shopifyConfig?.configured && !isPushed && (
                  <button onClick={e => { e.stopPropagation(); pushToShopify([p.href]) }} disabled={pushing}
                    style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#0284c7', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>↑ Push</button>
                )}
                {isPushed && (
                  <span style={{ fontSize: 11, color: '#0284c7', fontWeight: 700 }}>✓ Live</span>
                )}
                {isPushError && (
                  <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700 }} title={p.pushError}>⚠ Error</span>
                )}
                <span style={{ fontSize: 14, color: '#9ca3af', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▾</span>
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid #f3f4f6', padding: 16, background: '#fafafa' }}>
                {p.suggested?.image_insights && (
                  <div style={{ background: '#ede9fe', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, color: '#6366f1' }}>
                    <span style={{ fontWeight: 700 }}>🔍 Image insights: </span>{p.suggested.image_insights}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Meta Title</div>
                    <div style={{ fontSize: 12, color: '#d1d5db', textDecoration: 'line-through', marginBottom: 4 }}>{p.name}</div>
                    <div style={{ fontSize: 13, color: '#059669', fontWeight: 600, background: '#f0fdf4', borderRadius: 6, padding: '6px 10px' }}>
                      {p.suggested?.meta_title || '—'}
                      <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8, fontWeight: 400 }}>{(p.suggested?.meta_title || '').length}/60</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Tags</div>
                    <div style={{ fontSize: 11, color: '#d1d5db', textDecoration: 'line-through', marginBottom: 6 }}>{(p.current?.tags || []).join(', ') || '(none)'}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(p.suggested?.tags || []).map((t, i) => (
                        <span key={i} style={{ fontSize: 11, background: '#d1fae5', color: '#059669', borderRadius: 4, padding: '2px 8px' }}>{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Meta Description</div>
                  <div style={{ fontSize: 12, color: '#d1d5db', textDecoration: 'line-through', marginBottom: 6, lineHeight: 1.4 }}>
                    {(p.current?.description || '').substring(0, 160) || '(not set)'}
                  </div>
                  <div style={{ fontSize: 13, color: '#059669', background: '#f0fdf4', borderRadius: 6, padding: '8px 12px', lineHeight: 1.5 }}>
                    {p.suggested?.meta_description || '—'}
                    <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>{(p.suggested?.meta_description || '').length}/160</span>
                  </div>
                </div>
                {p.suggested?.alt_text && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Image Alt Text <span style={{ fontWeight: 400, textTransform: 'none', color: '#9ca3af' }}>(Shopify productUpdateMedia)</span></div>
                    <div style={{ fontSize: 13, color: '#059669', background: '#f0fdf4', borderRadius: 6, padding: '8px 12px', lineHeight: 1.5 }}>
                      {p.suggested.alt_text}
                      <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>{p.suggested.alt_text.length}/125</span>
                    </div>
                  </div>
                )}
                {p.suggested?.geo_description && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>GEO Description <span style={{ fontWeight: 400, textTransform: 'none', color: '#9ca3af' }}>(AI assistant discoverability)</span></div>
                    <div style={{ fontSize: 13, color: '#1d4ed8', background: '#eff6ff', borderRadius: 6, padding: '8px 12px', lineHeight: 1.6 }}>
                      {p.suggested.geo_description}
                    </div>
                  </div>
                )}
                {/* Category-specific Shopify metafields */}
                {p.categoryGroup && p.categoryGroup !== 'other' && (() => {
                  const s = p.suggested || {}
                  const typeKey = p.specificType || p.categoryGroup
                  const catFields = SPECIFIC_TYPE_FIELDS[typeKey] || SPECIFIC_TYPE_FIELDS[p.categoryGroup] || []
                  const visibleFields = catFields  // always show all slots
                  if (!s.shopify_taxonomy_gid && !s.shopify_category && catFields.every(([k]) => !s[k])) return null
                  return (
                    <div style={{ marginTop: 14, padding: '10px 12px', background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', marginBottom: 8 }}>
                        Shopify Taxonomy — {typeKey} metafields
                      </div>
                      {(s.shopify_taxonomy_gid || s.shopify_category) && (
                        <div style={{ fontSize: 12, marginBottom: 8 }}>
                          <span style={{ color: '#6b7280', fontWeight: 600 }}>Shopify category: </span>
                          {s.shopify_taxonomy_gid
                            ? <><span style={{ color: '#7c3aed', fontWeight: 700 }}>{TAXONOMY_LABELS[s.shopify_taxonomy_gid] || s.shopify_taxonomy_gid}</span>
                                <span style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: 10, marginLeft: 6 }}>{s.shopify_taxonomy_gid.replace('gid://shopify/TaxonomyCategory/', '')}</span></>
                            : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>re-analyze to get GID</span>}
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
                        {visibleFields.map(([key, label]) => (
                          <div key={key} style={{ background: '#fff', borderRadius: 6, padding: '6px 10px', border: '1px solid #e9d5ff' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                            <div style={{ fontSize: 12, color: s[key] ? '#374151' : '#d1d5db', fontStyle: s[key] ? 'normal' : 'italic' }}>{s[key] || 'not set — re-analyze'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                <div style={{ marginTop: 12 }}>
                  <a href={p.href} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#6366f1' }}>View on anneklein.com ↗</a>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function BrandGuidelinesTab({ guidelines }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [activeFormat, setActiveFormat] = useState('productDescription')
  const [activeSample, setActiveSample] = useState('blazers')

  const data = editing ? draft : guidelines

  if (!data?.brandVoice) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>No brand guidelines data found.</div>
  )

  const formatLabels = { productDescription: 'Product Description', emailSubjectLine: 'Email Subject', emailPreviewText: 'Email Preview Text', instagramCaption: 'Instagram Caption', heroHeadline: 'Hero Headline' }
  const sampleCategories = Object.keys(data.writingSamples || {})

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(guidelines)))
    setEditing(true)
    setSaveMsg(null)
  }

  function cancelEdit() {
    setDraft(null)
    setEditing(false)
    setSaveMsg(null)
  }

  async function saveEdit() {
    setSaving(true)
    try {
      const res = await fetch('/api/brand-guidelines', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveMsg('Saved!')
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setSaveMsg('Error saving — try again')
    }
    setSaving(false)
  }

  // Helpers for editing nested state
  function setIn(path, value) {
    const keys = path.split('.')
    setDraft(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
      obj[keys[keys.length - 1]] = value
      return next
    })
  }

  function setListItem(path, index, value) {
    const keys = path.split('.')
    setDraft(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (const k of keys) obj = obj[k]
      obj[index] = value
      return next
    })
  }

  function addListItem(path, value = '') {
    const keys = path.split('.')
    setDraft(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (const k of keys) obj = obj[k]
      obj.push(value)
      return next
    })
  }

  function removeListItem(path, index) {
    const keys = path.split('.')
    setDraft(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (const k of keys) obj = obj[k]
      obj.splice(index, 1)
      return next
    })
  }

  const iStyle = { border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', boxSizing: 'border-box', background: '#fff' }
  const taStyle = { ...iStyle, resize: 'vertical', minHeight: 60 }

  function ET({ val, path, multiline }) {
    if (!editing) return <span>{val}</span>
    return multiline
      ? <textarea style={taStyle} value={val} onChange={e => setIn(path, e.target.value)} />
      : <input style={iStyle} value={val} onChange={e => setIn(path, e.target.value)} />
  }

  function EList({ items, path, color }) {
    return (
      <div>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
            {editing
              ? <input style={{ ...iStyle, flex: 1 }} value={item} onChange={e => setListItem(path, i, e.target.value)} />
              : <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>{item}</span>}
            {editing && <button onClick={() => removeListItem(path, i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16, padding: '2px 4px' }}>×</button>}
          </div>
        ))}
        {editing && <button onClick={() => addListItem(path)} style={{ fontSize: 12, color: '#6366f1', border: '1px dashed #6366f1', background: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', marginTop: 4 }}>+ Add</button>}
      </div>
    )
  }

  function EPills({ items, path, bg, color }) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((k, i) => (
          <span key={i} style={{ background: bg, color, padding: '3px 10px', borderRadius: 12, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            {editing
              ? <input value={k} onChange={e => setListItem(path, i, e.target.value)} style={{ border: 'none', background: 'transparent', color, fontSize: 12, width: Math.max(60, k.length * 8), padding: 0 }} />
              : k}
            {editing && <span onClick={() => removeListItem(path, i)} style={{ cursor: 'pointer', fontWeight: 700, opacity: 0.6 }}>×</span>}
          </span>
        ))}
        {editing && <button onClick={() => addListItem(path)} style={{ background: bg, color, border: '1px dashed', borderRadius: 12, fontSize: 12, padding: '3px 10px', cursor: 'pointer' }}>+ Add</button>}
      </div>
    )
  }

  const { brandVoice, brandValues, brandHeritage, brandPillars, toneByChannel, targetCustomer, writingRules, keywords, copyFormats, writingSamples } = data

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {saveMsg && <span style={{ fontSize: 13, color: saveMsg.includes('Error') ? '#ef4444' : '#10b981', fontWeight: 600 }}>{saveMsg}</span>}
        {editing ? (
          <>
            <button onClick={cancelEdit} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button onClick={saveEdit} disabled={saving} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </>
        ) : (
          <button onClick={startEdit} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #6366f1', background: '#fff', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Edit Guidelines</button>
        )}
      </div>

      {/* Brand Voice */}
      <SectionHeader>Brand Voice</SectionHeader>
      <Card>
        <div style={{ fontSize: editing ? 13 : 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
          {editing ? <ET val={brandVoice.summary} path="brandVoice.summary" multiline /> : `"${brandVoice.summary}"`}
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
          Tone: {editing ? <ET val={brandVoice.tone} path="brandVoice.tone" /> : <strong>{brandVoice.tone}</strong>}
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>AK Is</div>
            {!editing && brandVoice.personality.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
                <span style={{ fontSize: 13, color: '#374151' }}>{p}</span>
              </div>
            ))}
            {editing && <EList items={brandVoice.personality} path="brandVoice.personality" />}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Writing Style</div>
            {!editing && brandVoice.writingStyle.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <span style={{ color: '#6366f1', fontWeight: 700 }}>→</span>
                <span style={{ fontSize: 13, color: '#374151' }}>{s}</span>
              </div>
            ))}
            {editing && <EList items={brandVoice.writingStyle} path="brandVoice.writingStyle" />}
          </div>
        </div>
      </Card>

      {/* Target Customer */}
      <SectionHeader>Target Customer</SectionHeader>
      <Card>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}><ET val={targetCustomer.name} path="targetCustomer.name" /></div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {editing ? (
                <>Age <ET val={targetCustomer.age} path="targetCustomer.age" /> · <ET val={targetCustomer.income} path="targetCustomer.income" /> · <ET val={targetCustomer.priceRange} path="targetCustomer.priceRange" /></>
              ) : `Age ${targetCustomer.age} · ${targetCustomer.income} · ${targetCustomer.priceRange}`}
            </div>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}><ET val={targetCustomer.description} path="targetCustomer.description" multiline /></div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Values</div>
            <EPills items={targetCustomer.values} path="targetCustomer.values" bg="#ede9fe" color="#6366f1" />
          </div>
          <div style={{ flex: 1, minWidth: 220, background: '#f9fafb', borderRadius: 8, padding: 16, borderLeft: '3px solid #6366f1' }}>
            <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Her Voice</div>
            <ET val={targetCustomer.quote} path="targetCustomer.quote" multiline />
          </div>
        </div>
      </Card>

      {/* Brand Values */}
      {brandValues?.length > 0 && (
        <>
          <SectionHeader>Brand Values</SectionHeader>
          <Card>
            {!editing && brandValues.map((v, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: i < brandValues.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                <span style={{ color: '#6366f1', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>◆</span>
                <span style={{ fontSize: 13, color: '#374151' }}>{v}</span>
              </div>
            ))}
            {editing && <EList items={brandValues} path="brandValues" />}
          </Card>
        </>
      )}

      {/* Brand Heritage */}
      {brandHeritage && (
        <>
          <SectionHeader>Brand Heritage</SectionHeader>
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Founded</div>
                  <ET val={brandHeritage.founded || ''} path="brandHeritage.founded" />
                  {' by '}
                  <ET val={brandHeritage.founder || ''} path="brandHeritage.founder" />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Legacy</div>
                  <span style={{ fontSize: 13, color: '#374151' }}><ET val={brandHeritage.legacy || ''} path="brandHeritage.legacy" multiline /></span>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Design Philosophy</div>
                  <span style={{ fontSize: 13, color: '#374151', fontStyle: editing ? 'normal' : 'italic' }}><ET val={brandHeritage.designPhilosophy || ''} path="brandHeritage.designPhilosophy" multiline /></span>
                </div>
              </div>
              <div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Modern Mission</div>
                  <span style={{ fontSize: 13, color: '#374151' }}><ET val={brandHeritage.modernMission || ''} path="brandHeritage.modernMission" multiline /></span>
                </div>
                {brandHeritage.keyFacts?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Key Facts</div>
                    {!editing && brandHeritage.keyFacts.map((f, i) => (
                      <div key={i} style={{ fontSize: 13, color: '#374151', padding: '4px 0', borderBottom: i < brandHeritage.keyFacts.length - 1 ? '1px solid #f3f4f6' : 'none' }}>• {f}</div>
                    ))}
                    {editing && <EList items={brandHeritage.keyFacts} path="brandHeritage.keyFacts" />}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Brand Pillars */}
      {brandPillars?.length > 0 && (
        <>
          <SectionHeader>Brand Pillars</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
            {brandPillars.map((p, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, borderTop: '3px solid #6366f1' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
                  {editing ? <input style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%' }} value={p.pillar} onChange={e => { const next = JSON.parse(JSON.stringify(draft)); next.brandPillars[i].pillar = e.target.value; setDraft(next); }} /> : p.pillar}
                </div>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                  {editing ? <textarea style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', minHeight: 50, resize: 'vertical' }} value={p.description} onChange={e => { const next = JSON.parse(JSON.stringify(draft)); next.brandPillars[i].description = e.target.value; setDraft(next); }} /> : p.description}
                </div>
                {p.inCopy && (
                  <div style={{ fontSize: 12, color: '#6366f1', background: '#ede9fe', borderRadius: 6, padding: '6px 10px' }}>
                    <span style={{ fontWeight: 700 }}>In copy: </span>
                    {editing ? <input style={{ border: 'none', background: 'transparent', color: '#6366f1', fontSize: 12, width: '80%' }} value={p.inCopy} onChange={e => { const next = JSON.parse(JSON.stringify(draft)); next.brandPillars[i].inCopy = e.target.value; setDraft(next); }} /> : p.inCopy}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Tone by Channel */}
      {toneByChannel && Object.keys(toneByChannel).length > 0 && (
        <>
          <SectionHeader>Tone by Channel</SectionHeader>
          <Card>
            {Object.entries(toneByChannel).map(([channel, guidance], i, arr) => (
              <div key={channel} style={{ display: 'flex', gap: 16, padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid #f3f4f6' : 'none', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 160, fontSize: 12, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 2 }}>{channel.replace(/([A-Z])/g, ' $1').trim()}</div>
                <div style={{ flex: 1, fontSize: 13, color: '#374151' }}>
                  {editing
                    ? <textarea style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', fontSize: 13, width: '100%', resize: 'vertical', minHeight: 40 }} value={guidance} onChange={e => { const next = JSON.parse(JSON.stringify(draft)); next.toneByChannel[channel] = e.target.value; setDraft(next); }} />
                    : guidance}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Writing Rules */}
      <SectionHeader>Writing Rules</SectionHeader>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <Card title="Do">
          {!editing && writingRules.dos.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', borderBottom: i < writingRules.dos.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
              <span style={{ color: '#10b981', fontWeight: 700, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 13, color: '#374151' }}>{d}</span>
            </div>
          ))}
          {editing && <EList items={writingRules.dos} path="writingRules.dos" />}
        </Card>
        <Card title="Don't">
          {!editing && writingRules.donts.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', borderBottom: i < writingRules.donts.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
              <span style={{ color: '#ef4444', fontWeight: 700, flexShrink: 0 }}>✕</span>
              <span style={{ fontSize: 13, color: '#374151' }}>{d}</span>
            </div>
          ))}
          {editing && <EList items={writingRules.donts} path="writingRules.donts" />}
        </Card>
      </div>

      {/* Keywords */}
      <SectionHeader>Keywords</SectionHeader>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <Card title="Use These Words">
          <EPills items={keywords.positive} path="keywords.positive" bg="#d1fae5" color="#065f46" />
        </Card>
        <Card title="Avoid These Words">
          <EPills items={keywords.negative} path="keywords.negative" bg="#fee2e2" color="#991b1b" />
        </Card>
        <Card title="SEO Keywords">
          <EPills items={keywords.seoKeywords} path="keywords.seoKeywords" bg="#ede9fe" color="#5b21b6" />
        </Card>
      </div>

      {/* Copy Formats */}
      <SectionHeader>Copy Formats</SectionHeader>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {Object.keys(formatLabels).map(f => (
            <button key={f} onClick={() => setActiveFormat(f)} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: activeFormat === f ? '#6366f1' : '#f3f4f6', color: activeFormat === f ? '#fff' : '#374151' }}>{formatLabels[f]}</button>
          ))}
        </div>
        {copyFormats[activeFormat] && (() => {
          const fmt = copyFormats[activeFormat]
          const fpath = `copyFormats.${activeFormat}`
          return (
            <div>
              {fmt.structure !== undefined && <div style={{ marginBottom: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Structure: </span><ET val={fmt.structure} path={`${fpath}.structure`} /></div>}
              {fmt.guidance !== undefined && <div style={{ marginBottom: 12 }}><span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Guidance: </span><ET val={fmt.guidance} path={`${fpath}.guidance`} multiline /></div>}
              {fmt.paragraphGuidance !== undefined && <div style={{ marginBottom: 6, fontSize: 13, color: '#374151' }}><strong>Paragraph: </strong><ET val={fmt.paragraphGuidance} path={`${fpath}.paragraphGuidance`} multiline /></div>}
              {fmt.bulletGuidance !== undefined && <div style={{ marginBottom: 12, fontSize: 13, color: '#374151' }}><strong>Bullets: </strong><ET val={fmt.bulletGuidance} path={`${fpath}.bulletGuidance`} multiline /></div>}
              {fmt.example && (
                <div style={{ background: '#f9fafb', borderRadius: 8, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>EXAMPLE — {fmt.example.title}</div>
                  <div style={{ fontSize: 13, color: '#374151', marginBottom: 8, fontStyle: editing ? 'normal' : 'italic' }}><ET val={fmt.example.paragraph} path={`${fpath}.example.paragraph`} multiline /></div>
                  <EList items={fmt.example.bullets || []} path={`${fpath}.example.bullets`} />
                </div>
              )}
              {fmt.examples && Array.isArray(fmt.examples) && fmt.examples.map((ex, i) => (
                <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  {typeof ex === 'string'
                    ? <ET val={ex} path={`${fpath}.examples.${i}`} />
                    : <div>
                        <div style={{ marginBottom: 4 }}><strong style={{ fontSize: 12, color: '#9ca3af' }}>Headline: </strong><ET val={ex.headline} path={`${fpath}.examples.${i}.headline`} /></div>
                        <div><strong style={{ fontSize: 12, color: '#9ca3af' }}>Subhead: </strong><ET val={ex.subhead} path={`${fpath}.examples.${i}.subhead`} /></div>
                      </div>}
                </div>
              ))}
              {fmt.donts && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', marginBottom: 6 }}>Avoid</div>
                  <EList items={fmt.donts} path={`${fpath}.donts`} />
                </div>
              )}
            </div>
          )
        })()}
      </Card>

      {/* Writing Samples */}
      <SectionHeader>Writing Samples</SectionHeader>
      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {sampleCategories.map(cat => (
            <button key={cat} onClick={() => setActiveSample(cat)} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: activeSample === cat ? '#6366f1' : '#f3f4f6', color: activeSample === cat ? '#fff' : '#374151', textTransform: 'capitalize' }}>{cat}</button>
          ))}
        </div>
        {(writingSamples[activeSample] || []).map((s, i) => (
          <div key={i} style={{ padding: '14px 0', borderBottom: i < writingSamples[activeSample].length - 1 ? '1px solid #f3f4f6' : 'none' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 6 }}><ET val={s.title} path={`writingSamples.${activeSample}.${i}.title`} /></div>
            <div style={{ marginBottom: 8 }}><ET val={s.paragraph} path={`writingSamples.${activeSample}.${i}.paragraph`} multiline /></div>
            <EList items={s.bullets} path={`writingSamples.${activeSample}.${i}.bullets`} />
          </div>
        ))}
      </Card>
    </div>
  )
}

const TABS = [
  { id: 'overview',   label: '🏠 Overview' },
  { id: 'calendar',   label: '📅 Calendar' },
  { id: 'campaigns',  label: '🗂️ Campaigns' },
  { id: 'catalog',    label: '👗 Catalog' },
  { id: 'site',       label: '🔍 Site Intel' },
  { id: 'email',      label: '📧 Email' },
  { id: 'social',     label: '📱 Social' },
  { id: 'seo',        label: '📊 SEO' },
  { id: 'seo-products', label: '🏷️ SEO Products' },
  { id: 'content',    label: '✍️ Content' },
  { id: 'price',      label: '💰 Pricing' },
  { id: 'ai',         label: '🤖 AI Search' },
  { id: 'personas',   label: '👥 Personas' },
  { id: 'brand',      label: '📘 Brand' },
]

export default function App() {
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [calItems, setCalItems] = useState([])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [siteIntel, catalog, siteAnalysis, emailIntel, socialIntel, seoIntel, content, inboxData, emailAnalysis, agenticSearch, priceIntel, personas, apifyUsage, brandGuidelines, campaignsData, calendarData] = await Promise.all([
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
        fetchEndpoint('/brand-guidelines'),
        fetchEndpoint('/campaigns'),
        fetchEndpoint('/calendar'),
      ])
      setData({ siteIntel, catalog, siteAnalysis, emailIntel, socialIntel, seoIntel, content, inboxData, emailAnalysis, agenticSearch, priceIntel, personas, apifyUsage, brandGuidelines })
      setCampaigns(Array.isArray(campaignsData) ? campaignsData : [])
      setCalItems(Array.isArray(calendarData) ? calendarData : [])
      setLastUpdated(new Date().toLocaleTimeString())
      setLoading(false)
    }
    load()
  }, [])

  async function reloadEmailAnalysis() {
    const emailAnalysis = await fetchEndpoint('/email-analysis')
    setData(prev => ({ ...prev, emailAnalysis }))
  }

  async function reloadContent() {
    const content = await fetchEndpoint('/content-recommendations')
    setData(prev => ({ ...prev, content }))
  }

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
            {tab === 'overview'  && <OverviewTab catalog={data.catalog} siteIntel={data.siteIntel} siteAnalysis={data.siteAnalysis} emailIntel={data.emailIntel} socialIntel={data.socialIntel} content={data.content} apifyUsage={data.apifyUsage} />}
            {tab === 'calendar'  && <CalendarTab calItems={calItems} setCalItems={setCalItems} campaigns={campaigns} personas={data.personas} catalog={data.catalog} />}
            {tab === 'campaigns' && <CampaignsTab campaigns={campaigns} setCampaigns={setCampaigns} personas={data.personas} content={data.content} setCalItems={setCalItems} />}
            {tab === 'catalog'   && <CatalogTab catalog={data.catalog} />}
            {tab === 'site'      && <SiteIntelTab siteIntel={data.siteIntel} siteAnalysis={data.siteAnalysis} />}
            {tab === 'email'     && <EmailTab inboxData={data.inboxData} emailAnalysis={data.emailAnalysis} loadData={reloadEmailAnalysis} />}
            {tab === 'social'    && <SocialTab socialIntel={data.socialIntel} />}
            {tab === 'seo'         && <SEOTab seoIntel={data.seoIntel} content={data.content} />}
            {tab === 'seo-products' && <SeoProductTab />}
            {tab === 'content'   && <ContentTab content={data.content} catalog={data.catalog} campaigns={campaigns} loadData={reloadContent} setCalItems={setCalItems} />}
            {tab === 'price'     && <PriceTab priceIntel={data.priceIntel} />}
            {tab === 'ai'        && <AgenticSearchTab agenticSearch={data.agenticSearch} />}
            {tab === 'personas'  && <PersonasTab personas={data.personas} content={data.content} />}
            {tab === 'brand'     && <BrandGuidelinesTab guidelines={data.brandGuidelines} />}
          </>
        )}
      </div>
    </div>
  )
}
