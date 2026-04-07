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

  if (loading)    return <div className="page"><p className="ref-status">Loading…</p></div>
  if (fetchError) return <div className="page"><p className="ref-error">{fetchError}</p></div>

  return (
    <div className="page ref-page">
      <h1>2026 Budget</h1>
      <p className="ref-note">
        Original annual budget and monthly distribution for all tracked categories.
        Read-only — no editing in version 1.
      </p>

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
                  {row.monthly.map((cents, i) => (
                    <td key={i} className="ref-td-num">{fmt(cents)}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
