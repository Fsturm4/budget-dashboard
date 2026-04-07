import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase.js'
import { formatDollars } from '../lib/money.js'
import { DASHBOARD_YEAR, MONTH_LABELS, VARIANCE_THRESHOLD_PCT, ACTUALS_STATUS } from '../lib/config.js'

const MONTH_COLS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const SHORT_MONTHS = MONTH_LABELS.map(m => m.slice(0, 3))

// ── computation ───────────────────────────────────────────────────────────────
// All derived values — Gross Profit, NOI, Net Income — are computed here from
// stored input rows. None of these values are read from the database.

function buildDashboard(actuals, budgetRows, categories) {
  // slug → { annual, monthly: number[12] }
  const budgetBySlug = new Map(
    budgetRows.map(b => [b.category_slug, {
      annual:  b.annual_budget_cents,
      monthly: MONTH_COLS.map(col => b[`${col}_cents`] ?? 0),
    }])
  )

  // slug → month → total cents (sums both companies for combined view)
  const bySlugMonth = new Map()
  for (const row of actuals) {
    const byMonth = bySlugMonth.get(row.category_slug) ?? new Map()
    byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.amount_cents)
    bySlugMonth.set(row.category_slug, byMonth)
  }

  const actualizedMonths     = new Set(actuals.map(r => r.month))
  const sortedActualMonths   = [...actualizedMonths].sort((a, b) => a - b)

  const bySection = s => categories.filter(c => c.section === s).map(c => c.slug)
  const revSlugs   = bySection('revenue')
  const cogsSlugs  = bySection('cogs')
  const opexSlugs  = bySection('opex')
  const otherSlugs = bySection('other')

  const getActual        = (slug, m) => bySlugMonth.get(slug)?.get(m) ?? 0
  const getMonthlyBudget = (slug, m) => budgetBySlug.get(slug)?.monthly[m - 1] ?? 0
  const getAnnualBudget  = (slug)    => budgetBySlug.get(slug)?.annual ?? 0

  const ytdActual = slug => sortedActualMonths.reduce((s, m) => s + getActual(slug, m), 0)
  const ytdBudget = slug => sortedActualMonths.reduce((s, m) => s + getMonthlyBudget(slug, m), 0)

  // Full-year outlook: actuals for uploaded months, monthly budget for the rest.
  const fullYearOutlook = slug => {
    let total = 0
    for (let m = 1; m <= 12; m++) {
      total += actualizedMonths.has(m) ? getActual(slug, m) : getMonthlyBudget(slug, m)
    }
    return total
  }

  const sumYtdActual = slugs => slugs.reduce((s, sl) => s + ytdActual(sl), 0)
  const sumYtdBudget = slugs => slugs.reduce((s, sl) => s + ytdBudget(sl), 0)
  const sumOutlook   = slugs => slugs.reduce((s, sl) => s + fullYearOutlook(sl), 0)
  const sumAnnual    = slugs => slugs.reduce((s, sl) => s + getAnnualBudget(sl), 0)

  const sumActualMonth = (slugs, m) => slugs.reduce((s, sl) => s + getActual(sl, m), 0)
  const sumBudgetMonth = (slugs, m) => slugs.reduce((s, sl) => s + getMonthlyBudget(sl, m), 0)

  // Input section totals (stored rows, read directly)
  const rev  = { ya: sumYtdActual(revSlugs),   yb: sumYtdBudget(revSlugs),   ol: sumOutlook(revSlugs),   an: sumAnnual(revSlugs)   }
  const cogs = { ya: sumYtdActual(cogsSlugs),  yb: sumYtdBudget(cogsSlugs),  ol: sumOutlook(cogsSlugs),  an: sumAnnual(cogsSlugs)  }
  const opex = { ya: sumYtdActual(opexSlugs),  yb: sumYtdBudget(opexSlugs),  ol: sumOutlook(opexSlugs),  an: sumAnnual(opexSlugs)  }
  const other= { ya: sumYtdActual(otherSlugs), yb: sumYtdBudget(otherSlugs), ol: sumOutlook(otherSlugs), an: sumAnnual(otherSlugs) }

  // Derived totals — computed, never stored
  const gp  = { ya: rev.ya - cogs.ya, yb: rev.yb - cogs.yb, ol: rev.ol - cogs.ol, an: rev.an - cogs.an }
  const noi  = { ya: gp.ya  - opex.ya, yb: gp.yb  - opex.yb, ol: gp.ol  - opex.ol, an: gp.an  - opex.an }
  const ni   = { ya: noi.ya + other.ya, yb: noi.yb + other.yb, ol: noi.ol + other.ol, an: noi.an + other.an }

  // 12-month chart data points
  const chartData = Array.from({ length: 12 }, (_, i) => {
    const m   = i + 1
    const has = actualizedMonths.has(m)
    return {
      month:      SHORT_MONTHS[i],
      revActual:  has ? sumActualMonth(revSlugs, m) : undefined,
      revBudget:  sumBudgetMonth(revSlugs, m),
      // NOI = Revenue - COGS - OpEx per month (Other Income excluded, matching the KPI definition)
      noiActual:  has ? sumActualMonth(revSlugs, m) - sumActualMonth(cogsSlugs, m) - sumActualMonth(opexSlugs, m) : undefined,
      noiBudget:  sumBudgetMonth(revSlugs, m) - sumBudgetMonth(cogsSlugs, m) - sumBudgetMonth(opexSlugs, m),
    }
  })

  return { kpi: { rev, cogs, gp, opex, noi, ni }, chartData, actualizedMonths: sortedActualMonths }
}

function varColor(actualCents, budgetCents, higherIsBetter) {
  if (budgetCents === 0) return 'neutral'
  const pct = (actualCents - budgetCents) / Math.abs(budgetCents)
  const favorable = higherIsBetter ? pct : -pct
  if (favorable >  VARIANCE_THRESHOLD_PCT) return 'green'
  if (favorable < -VARIANCE_THRESHOLD_PCT) return 'red'
  return 'neutral'
}

function buildContextLine(months) {
  if (months.length === 0) return `No actuals uploaded yet — showing ${DASHBOARD_YEAR} budget`
  if (months.length === 12) return `Based on full-year ${DASHBOARD_YEAR} actuals`

  const shortLabels    = months.map(m => MONTH_LABELS[m - 1].slice(0, 3))
  const isConsecutive  = months.every((m, i) => i === 0 || m === months[i - 1] + 1)
  const actualRange    = isConsecutive && months.length > 1
    ? `${shortLabels[0]}–${shortLabels[shortLabels.length - 1]}`
    : shortLabels.join(', ')

  const lastActual = months[months.length - 1]
  const firstRem   = lastActual + 1
  const remainStr  = firstRem <= 12
    ? `${MONTH_LABELS[firstRem - 1].slice(0, 3)}–Dec ${DASHBOARD_YEAR} budget`
    : ''

  return `Based on ${actualRange} ${DASHBOARD_YEAR} actuals${remainStr ? ` + ${remainStr}` : ''}`
}

// ── sub-components (local, not exported) ──────────────────────────────────────

function KpiCard({ label, ytdActual, ytdBudget, higherIsBetter }) {
  const varDollar = ytdActual - ytdBudget
  const varPct    = ytdBudget !== 0 ? varDollar / Math.abs(ytdBudget) : null
  const color     = varColor(ytdActual, ytdBudget, higherIsBetter)

  return (
    <div className={`kpi-card kpi-card--${color}`}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-actual">{formatDollars(ytdActual)}</p>
      <p className="kpi-budget-row">
        <span className="kpi-budget-label">Budget</span>
        <span className="kpi-budget-value">{formatDollars(ytdBudget)}</span>
      </p>
      <p className={`kpi-variance kpi-variance--${color}`}>
        {varDollar >= 0 ? '+' : ''}{formatDollars(varDollar)}
        {varPct !== null && (
          <span className="kpi-var-pct"> ({varPct >= 0 ? '+' : ''}{(varPct * 100).toFixed(1)}%)</span>
        )}
      </p>
    </div>
  )
}

function OutlookCard({ label, outlookCents, annualBudgetCents }) {
  const varDollar = outlookCents - annualBudgetCents
  const varPct    = annualBudgetCents !== 0 ? varDollar / Math.abs(annualBudgetCents) : null
  const color     = varColor(outlookCents, annualBudgetCents, true)

  return (
    <div className={`outlook-card outlook-card--${color}`}>
      <p className="outlook-label">{label}</p>
      <p className="outlook-amount">{formatDollars(outlookCents)}</p>
      <p className="outlook-budget-row">
        <span className="outlook-budget-label">Annual budget</span>
        <span className="outlook-budget-value">{formatDollars(annualBudgetCents)}</span>
      </p>
      <p className={`outlook-variance outlook-variance--${color}`}>
        {varDollar >= 0 ? '+' : ''}{formatDollars(varDollar)}
        {varPct !== null && (
          <span className="outlook-var-pct"> ({varPct >= 0 ? '+' : ''}{(varPct * 100).toFixed(1)}%)</span>
        )}
      </p>
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      {payload.map(p => p.value !== undefined && (
        <p key={p.name} className="chart-tooltip-row" style={{ color: p.color }}>
          {p.name}: {formatDollars(p.value)}
        </p>
      ))}
    </div>
  )
}

const yFmt = v => {
  const d   = Math.abs(v / 100)
  const sgn = v < 0 ? '-' : ''
  return d >= 1000 ? `${sgn}$${Math.round(d / 1000)}k` : `${sgn}$${Math.round(d)}`
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function Overview() {
  const [dashData,   setDashData]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [fetchError, setFetchError] = useState(null)

  // Single fetch on mount — three parallel queries, all required before render.
  // Fail-fast: any query error surfaces immediately with a plain message.
  useEffect(() => {
    Promise.all([
      supabase
        .from('actuals')
        .select('category_slug, month, amount_cents')
        .eq('year', DASHBOARD_YEAR)
        .eq('status', ACTUALS_STATUS.ACTIVE),
      supabase
        .from('budget')
        .select('*')
        .eq('year', DASHBOARD_YEAR),
      supabase
        .from('categories')
        .select('slug, section'),
    ]).then(([ar, br, cr]) => {
      if (ar.error || br.error || cr.error) {
        setFetchError('Could not load dashboard data. Check your connection and try refreshing.')
        setLoading(false)
        return
      }
      setDashData(buildDashboard(ar.data, br.data, cr.data))
      setLoading(false)
    })
  }, [])

  if (loading)    return <div className="page"><p className="overview-status">Loading…</p></div>
  if (fetchError) return <div className="page"><p className="overview-error">{fetchError}</p></div>

  const { kpi, chartData, actualizedMonths } = dashData
  const contextLine = buildContextLine(actualizedMonths)

  return (
    <div className="page overview-page">

      {/* ── context line ────────────────────────────────────────────────── */}
      <p className="overview-context">{contextLine}</p>

      {/* ── KPI cards ───────────────────────────────────────────────────── */}
      <section className="overview-section">
        <h2 className="overview-section-title">Year to Date</h2>
        <div className="kpi-grid">
          <KpiCard label="Total Net Revenue"        ytdActual={kpi.rev.ya}  ytdBudget={kpi.rev.yb}  higherIsBetter={true}  />
          <KpiCard label="Total COGS"               ytdActual={kpi.cogs.ya} ytdBudget={kpi.cogs.yb} higherIsBetter={false} />
          <KpiCard label="Gross Profit"             ytdActual={kpi.gp.ya}   ytdBudget={kpi.gp.yb}   higherIsBetter={true}  />
          <KpiCard label="Total Operating Expenses" ytdActual={kpi.opex.ya} ytdBudget={kpi.opex.yb} higherIsBetter={false} />
          <KpiCard label="Net Operating Income"     ytdActual={kpi.noi.ya}  ytdBudget={kpi.noi.yb}  higherIsBetter={true}  />
          <KpiCard label="Net Income"               ytdActual={kpi.ni.ya}   ytdBudget={kpi.ni.yb}   higherIsBetter={true}  />
        </div>
      </section>

      {/* ── monthly chart ───────────────────────────────────────────────── */}
      {/* Single chart, shared Y-axis. Four series per month: Revenue Actual,
          Revenue Budget, NOI Actual, NOI Budget. NOI budget bars in low months
          are correctly small — that reflects the data, not a rendering issue. */}
      <section className="overview-section">
        <h2 className="overview-section-title">Monthly Performance</h2>
        <div className="chart-panel">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} barGap={2} barCategoryGap="30%">
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={yFmt} tick={{ fontSize: 11 }} width={52} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revActual" name="Revenue — Actual" fill="#1d4ed8" radius={[2,2,0,0]} />
              <Bar dataKey="revBudget" name="Revenue — Budget" fill="#bfdbfe" radius={[2,2,0,0]} />
              <Bar dataKey="noiActual" name="NOI — Actual"     fill="#15803d" radius={[2,2,0,0]} />
              <Bar dataKey="noiBudget" name="NOI — Budget"     fill="#bbf7d0" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── full-year outlook ───────────────────────────────────────────── */}
      <section className="overview-section">
        <h2 className="overview-section-title">Full-Year Outlook</h2>
        <p className="overview-outlook-note">{contextLine}</p>
        <div className="outlook-grid">
          <OutlookCard label="Revenue"      outlookCents={kpi.rev.ol} annualBudgetCents={kpi.rev.an} />
          <OutlookCard label="Gross Profit" outlookCents={kpi.gp.ol}  annualBudgetCents={kpi.gp.an}  />
          <OutlookCard label="Net Income"   outlookCents={kpi.ni.ol}  annualBudgetCents={kpi.ni.an}  />
        </div>
      </section>

    </div>
  )
}
