import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { DASHBOARD_YEAR } from '../lib/config.js'
import { TABLE_ROWS, SECTION_SLUGS } from '../lib/trackerRows.js'

const MONTH_COLS  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const MONTH_HEADS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Compact whole-dollar format for the wide budget table.
// Zero budget months show em dash (Owner Wages Jan–Apr, Insurance lump months, etc.)
function fmt(cents) {
  if (cents === 0) return '—'
  const d   = Math.round(cents / 100)
  const abs = Math.abs(d)
  const sgn = d < 0 ? '-' : ''
  return `${sgn}$${abs.toLocaleString('en-US')}`
}

function computeBudgetRows(budgetRows) {
  // slug → { annual, monthly: number[12] } in cents
  const bySlug = new Map(
    budgetRows.map(b => [b.category_slug, {
      annual:  b.annual_budget_cents,
      monthly: MONTH_COLS.map(col => b[`${col}_cents`] ?? 0),
    }])
  )

  const get       = (slug, col) => bySlug.get(slug)?.[col] ?? 0
  const getAnnual = (slug)      => get(slug, 'annual')
  const getMo     = (slug, i)   => get(slug, 'monthly')[i] ?? 0

  const sumAnnual = slugs => slugs.reduce((s, sl) => s + getAnnual(sl), 0)
  const sumMo     = (slugs, i) => slugs.reduce((s, sl) => s + getMo(sl, i), 0)

  const sa = {}  // section annuals
  const sm = {}  // section monthly arrays
  for (const [sec, slugs] of Object.entries(SECTION_SLUGS)) {
    sa[sec] = sumAnnual(slugs)
    sm[sec] = Array.from({ length: 12 }, (_, i) => sumMo(slugs, i))
  }

  // Derived values per column (annual + 12 monthly)
  const derived = {
    total_rev:   { annual: sa.revenue, monthly: sm.revenue },
    total_cogs:  { annual: sa.cogs,    monthly: sm.cogs    },
    gross_profit:{ annual: sa.revenue - sa.cogs, monthly: sm.revenue.map((v, i) => v - sm.cogs[i]) },
    total_opex:  { annual: sa.opex,    monthly: sm.opex    },
    noi:         {
      annual:  sa.revenue - sa.cogs - sa.opex,
      monthly: sm.revenue.map((v, i) => v - sm.cogs[i] - sm.opex[i]),
    },
    net_income:  {
      annual:  sa.revenue - sa.cogs - sa.opex + sa.other,
      monthly: sm.revenue.map((v, i) => v - sm.cogs[i] - sm.opex[i] + sm.other[i]),
    },
  }

  return TABLE_ROWS.map((row, idx) => {
    if (row.type === 'section') return { ...row, idx }
    if (row.type === 'derived') {
      const d = derived[row.key]
      return { ...row, idx, annual: d.annual, monthly: d.monthly }
    }
    const annual  = getAnnual(row.slug)
    const monthly = Array.from({ length: 12 }, (_, i) => getMo(row.slug, i))
    return { ...row, idx, annual, monthly }
  })
}

export default function Budget2026() {
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [showVariance,  setShowVariance]  = useState(false)
  const [actualsData,   setActualsData]   = useState(null)

  useEffect(() => {
    supabase
      .from('budget')
      .select('*')
      .eq('year', DASHBOARD_YEAR)
      .then(({ data, error }) => {
        if (error) {
          setFetchError('Could not load budget data. Check your connection and try refreshing.')
          setLoading(false)
          return
        }
        setRows(computeBudgetRows(data ?? []))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    Promise.all([
      supabase.from('actuals').select('category_slug,month,amount_cents')
        .eq('year', DASHBOARD_YEAR).eq('status', 'active'),
      supabase.from('categories').select('slug,variance_direction'),
    ]).then(([{ data: aData, error: aErr }, { data: cData, error: cErr }]) => {
      if (aErr || cErr) return
      const map    = {}
      const closed = new Set()
      for (const r of aData ?? []) {
        const key = `${r.category_slug}-${r.month}`
        map[key]  = (map[key] ?? 0) + r.amount_cents
        closed.add(r.month - 1)
      }
      const dirs = {}
      for (const r of cData ?? []) dirs[r.slug] = r.variance_direction
      setActualsData({ map, closed, dirs })
    })
  }, [])

  if (loading)    return <div className="page"><p className="ref-status">Loading…</p></div>
  if (fetchError) return <div className="page"><p className="ref-error">{fetchError}</p></div>

  return (
    <div className="page ref-page">
      <h1>2026 Budget</h1>
      <p className="ref-note">
        Original annual budget and monthly distribution for all tracked categories.
        Read-only — no editing in version 1.
      </p>
<div style={{ margin: '12px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
          <input
            type="checkbox"
            checked={showVariance}
            onChange={e => setShowVariance(e.target.checked)}
          />
          Show vs Actuals
        </label>
      </div>
      
<div className="ref-table-wrapper">
        <table className="ref-table budget-table">
          <thead>
            <tr>
              <th className="ref-th-name">Category</th>
              <th className="ref-th-num ref-th-annual">Annual</th>
              {MONTH_HEADS.map(m => <th key={m} className="ref-th-num">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              if (row.type === 'section') {
                return (
                  <tr key={row.idx} className="ref-section-row">
                    <td colSpan={14}>{row.label}</td>
                  </tr>
                )
              }
              const isDerived = row.type === 'derived'
              return (
                <tr key={row.idx} className={isDerived ? 'ref-derived-row' : 'ref-input-row'}>
                  <td className={`ref-td-name ${isDerived ? 'ref-td-name--derived' : ''}`}>
                    {row.label}
                  </td>
                  <td className="ref-td-num ref-td-annual">{fmt(row.annual)}</td>
                  {row.monthly.map((cents, i) => {
                    const canShow = showVariance && actualsData && actualsData.closed.has(i) && row.slug && cents !== 0
                    if (!canShow) return <td key={i} className="ref-td-num">{fmt(cents)}</td>
                    const actual  = actualsData.map[`${row.slug}-${i + 1}`] ?? 0
                    const diff    = actual - cents
                    const dir     = actualsData.dirs[row.slug]
                    const good    = dir === 'higher_is_better' ? diff >= 0 : diff <= 0
                    const bg      = diff === 0 ? '' : good ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'
                    const pct     = Math.round((diff / Math.abs(cents)) * 100)
                    const pctStr  = (diff >= 0 ? '+' : '') + pct + '%'
                    const pctClr  = diff === 0 ? '#888' : good ? '#16a34a' : '#dc2626'
                    return (
                      <td key={i} className="ref-td-num" style={{ background: bg }}>
                        {fmt(cents)}
                        <div style={{ fontSize: '0.7em', color: pctClr, marginTop: '1px' }}>{pctStr}</div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
