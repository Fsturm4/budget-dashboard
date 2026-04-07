import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatDollars } from '../lib/money.js'
import { DASHBOARD_YEAR, MONTH_LABELS, VARIANCE_THRESHOLD_PCT, ACTUALS_STATUS } from '../lib/config.js'

const MONTH_COLS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

import { TABLE_ROWS, SECTION_SLUGS } from '../lib/trackerRows.js'

// Variance direction shorthand used in TABLE_ROWS
const H = 'higher_is_better'
const L = 'lower_is_better'

// ── computation ───────────────────────────────────────────────────────────────

function computeRows(actuals, budgetRows, month, companyMode) {
  // Monthly budget cents per slug for the selected month
  const budgetBySlug = new Map(
    budgetRows.map(b => [b.category_slug, b[`${MONTH_COLS[month - 1]}_cents`] ?? 0])
  )

  // Actuals: slug → company → cents
  const bySlugCompany = new Map()
  for (const row of actuals) {
    const byCompany = bySlugCompany.get(row.category_slug) ?? new Map()
    byCompany.set(row.company, (byCompany.get(row.company) ?? 0) + row.amount_cents)
    bySlugCompany.set(row.category_slug, byCompany)
  }

  // Actual cents for a slug given the current company mode.
  // Combined: sum both companies. Per-company: one company's value only.
  function getActual(slug) {
    const byCompany = bySlugCompany.get(slug) ?? new Map()
    if (companyMode === 'combined') {
      return [...byCompany.values()].reduce((s, v) => s + v, 0)
    }
    return byCompany.get(companyMode) ?? 0
  }

  function getBudget(slug) { return budgetBySlug.get(slug) ?? 0 }

  // Whether to show budget and variance for an input slug.
  // Budget is meaningful for all slugs in combined mode. In per-company mode,
  // revenue slugs have company-specific budgets (turf_pro_net_revenue and
  // greenace_net_revenue are distinct budget rows), but all expense and COGS
  // slugs have combined-only budgets — showing them against a per-company
  // actual would produce a meaningless comparison, so they are hidden.
  function slugShowsBudget(slug) {
    if (companyMode === 'combined') return true
    if (companyMode === 'turf_pro') return slug === 'turf_pro_net_revenue'
    if (companyMode === 'greenace') return slug === 'greenace_net_revenue'
    return false
  }

  // Section actual totals (always computed — actual amounts are always shown)
  const sa = {}
  for (const [section, slugs] of Object.entries(SECTION_SLUGS)) {
    sa[section] = slugs.reduce((sum, sl) => sum + getActual(sl), 0)
  }

  // Section budget totals (null when not meaningful for current mode).
  // In combined mode: full combined budget for all sections.
  // In per-company mode: only the one company's revenue budget is meaningful.
  const sb = {}
  for (const [section, slugs] of Object.entries(SECTION_SLUGS)) {
    if (companyMode === 'combined') {
      sb[section] = slugs.reduce((sum, sl) => sum + getBudget(sl), 0)
    } else if (section === 'revenue') {
      const slug = companyMode === 'turf_pro' ? 'turf_pro_net_revenue' : 'greenace_net_revenue'
      sb[section] = getBudget(slug)
    } else {
      sb[section] = null
    }
  }

  // Derived values — computed from section totals, never stored
  const gpActual = sa.revenue - sa.cogs
  const gpBudget = sb.revenue !== null && sb.cogs !== null ? sb.revenue - sb.cogs : null

  const noiActual = gpActual - sa.opex
  const noiBudget = gpBudget !== null && sb.opex !== null ? gpBudget - sb.opex : null

  const niActual = noiActual + sa.other
  const niBudget = noiBudget !== null && sb.other !== null ? noiBudget + sb.other : null

  const derivedMap = {
    total_rev:   { actual: sa.revenue,  budget: sb.revenue  },
    total_cogs:  { actual: sa.cogs,     budget: sb.cogs     },
    gross_profit:{ actual: gpActual,    budget: gpBudget    },
    total_opex:  { actual: sa.opex,     budget: sb.opex     },
    noi:         { actual: noiActual,   budget: noiBudget   },
    net_income:  { actual: niActual,    budget: niBudget    },
  }

  return TABLE_ROWS.map((row, idx) => {
    if (row.type === 'section') return { ...row, idx }
    if (row.type === 'derived') {
      const d = derivedMap[row.key]
      return { ...row, idx, actual: d.actual, budget: d.budget }
    }
    // input row
    const showBudget = slugShowsBudget(row.slug)
    return {
      ...row,
      idx,
      actual: getActual(row.slug),
      budget: showBudget ? getBudget(row.slug) : null,
    }
  })
}

function varColor(actual, budget, varDir) {
  if (budget === null || budget === 0) return 'neutral'
  const pct      = (actual - budget) / Math.abs(budget)
  const favorable = varDir === H ? pct : -pct
  if (favorable >  VARIANCE_THRESHOLD_PCT) return 'green'
  if (favorable < -VARIANCE_THRESHOLD_PCT) return 'red'
  return 'neutral'
}

// ── page ──────────────────────────────────────────────────────────────────────

const COMPANY_OPTIONS = [
  { value: 'combined',  label: 'Combined'  },
  { value: 'turf_pro',  label: 'Turf Pro'  },
  { value: 'greenace',  label: 'GreenAce'  },
]

export default function MonthlyTracker() {
  const [month,       setMonth]       = useState('1')
  const [companyMode, setCompanyMode] = useState('combined')
  const [actuals,     setActuals]     = useState([])
  const [budgetRows,  setBudgetRows]  = useState([])
  const [hasActuals,  setHasActuals]  = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState(null)

  // Budget is fixed for the year — load once on mount.
  useEffect(() => {
    supabase
      .from('budget')
      .select('*')
      .eq('year', DASHBOARD_YEAR)
      .then(({ data, error }) => {
        if (!error && data) setBudgetRows(data)
      })
  }, [])

  // Actuals change when the selected month changes — re-fetch on each change.
  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    supabase
      .from('actuals')
      .select('category_slug, company, amount_cents')
      .eq('year',   DASHBOARD_YEAR)
      .eq('month',  parseInt(month))
      .eq('status', ACTUALS_STATUS.ACTIVE)
      .then(({ data, error }) => {
        if (error) {
          setFetchError('Could not load actuals. Check your connection and try refreshing.')
          setLoading(false)
          return
        }
        setActuals(data ?? [])
        setHasActuals((data ?? []).length > 0)
        setLoading(false)
      })
  }, [month])

  // Rows are computed client-side from fetched data.
  // Company mode change does not trigger a fetch — same actuals, different aggregation.
  const rows = (!loading && budgetRows.length > 0)
    ? computeRows(actuals, budgetRows, parseInt(month), companyMode)
    : []

  const monthLabel = MONTH_LABELS[parseInt(month) - 1]

  return (
    <div className="page tracker-page">

      {/* ── controls ──────────────────────────────────────────────────────── */}
      <div className="tracker-controls">
        <select
          className="tracker-month-select"
          value={month}
          onChange={e => setMonth(e.target.value)}
        >
          {MONTH_LABELS.map((label, i) => (
            <option key={i + 1} value={i + 1}>{label} {DASHBOARD_YEAR}</option>
          ))}
        </select>

        <div className="tracker-toggle" role="group" aria-label="Company view">
          {COMPANY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`tracker-toggle-btn ${companyMode === opt.value ? 'tracker-toggle-btn--active' : ''}`}
              onClick={() => setCompanyMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {fetchError && <p className="tracker-error">{fetchError}</p>}
      {loading    && <p className="tracker-status">Loading…</p>}

      {!loading && !fetchError && !hasActuals && (
        <div className="tracker-no-actuals">
          <p className="tracker-no-actuals-msg">
            No actuals have been uploaded for {monthLabel} {DASHBOARD_YEAR}.
          </p>
          <p className="tracker-no-actuals-sub">
            Upload both company P&amp;L files to see actuals for this month.
          </p>
          <a href="/upload" className="tracker-upload-link">Go to Upload →</a>
        </div>
      )}

      {!loading && !fetchError && companyMode !== 'combined' && (
        <p className="tracker-note">
          In per-company view, budget and variance are shown only for that company's
          revenue row. Expense and COGS budgets are combined-only and are not shown
          per company.
        </p>
      )}

      {/* ── table ─────────────────────────────────────────────────────────── */}
      {!loading && !fetchError && hasActuals && (
        <div className="tracker-table-wrapper">
          <table className="tracker-table">
            <thead>
              <tr>
                <th className="tracker-th-name">Category</th>
                <th className="tracker-th-num">Actual</th>
                <th className="tracker-th-num">Budget</th>
                <th className="tracker-th-num">Variance $</th>
                <th className="tracker-th-num">Variance %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                if (row.type === 'section') {
                  return (
                    <tr key={row.idx} className="tracker-section-row">
                      <td colSpan="5">{row.label}</td>
                    </tr>
                  )
                }

                const isDerived   = row.type === 'derived'
                const showBudget  = row.budget !== null
                const varDollar   = showBudget ? row.actual - row.budget : null
                const varPct      = showBudget && row.budget !== 0 ? varDollar / Math.abs(row.budget) : null
                const color       = showBudget ? varColor(row.actual, row.budget, row.varDir) : 'neutral'

                // In per-company mode, derived rows where no budget comparison is
                // available are marked with * to distinguish them from input rows
                // that also show em dashes (which have a combined budget but it is
                // not shown per-company). The asterisk means: actual is real and
                // computed correctly, but no per-company budget exists to compare it to.
                const needsAsterisk = isDerived && !showBudget && companyMode !== 'combined'

                const varDollarStr = varDollar !== null
                  ? `${varDollar >= 0 ? '+' : ''}${formatDollars(varDollar)}`
                  : '—'

                const varPctStr = varPct !== null
                  ? `${varPct >= 0 ? '+' : ''}${(varPct * 100).toFixed(1)}%`
                  : '—'

                return (
                  <tr key={row.idx} className={isDerived ? 'tracker-derived-row' : 'tracker-input-row'}>
                    <td className={`tracker-td-name ${isDerived ? 'tracker-td-name--derived' : ''}`}>
                      {row.label}{needsAsterisk ? <span className="tracker-asterisk"> *</span> : null}
                    </td>
                    <td className="tracker-td-num">{formatDollars(row.actual)}</td>
                    <td className="tracker-td-num tracker-td-budget">
                      {showBudget ? formatDollars(row.budget) : '—'}
                    </td>
                    <td className={`tracker-td-num tracker-td-var tracker-td-var--${color}`}>
                      {varDollarStr}
                    </td>
                    <td className={`tracker-td-num tracker-td-var tracker-td-var--${color}`}>
                      {varPctStr}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {companyMode !== 'combined' && (
            <p className="tracker-footnote">
              * Computed from per-company actuals. No per-company budget comparison available.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
