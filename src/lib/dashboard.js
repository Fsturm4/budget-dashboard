import { MONTH_LABELS } from './config.js'
import { TABLE_ROWS, SECTION_SLUGS } from './trackerRows.js'

// Categories budgeted as one annual payment that QuickBooks may record in a
// different month from the budgeted one. While the year is still open their
// outlook is the larger of actuals to date and the annual budget, so the
// payment is counted once whichever month it lands in.
const ANNUAL_PAYMENT_SLUGS = ['sep_ira_expense']

const MONTH_COLS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const SHORT_MONTHS = MONTH_LABELS.map(m => m.slice(0, 3))

// ── computation ───────────────────────────────────────────────────────────────
// All derived values — Gross Profit, NOI, Net Income — are computed here from
// stored input rows. None of these values are read from the database.

export function buildDashboard(actuals, budgetRows, categories) {
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
    if (ANNUAL_PAYMENT_SLUGS.includes(slug) && actualizedMonths.size < 12) {
      return Math.max(ytdActual(slug), getAnnualBudget(slug))
    }
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

  // One category's outlook line. Remaining is whatever the outlook adds to actuals
  // to date, so year-to-date plus remaining always equals the outlook.
  const categoryLine = slug => outlookLine(ytdActual(slug), fullYearOutlook(slug), getAnnualBudget(slug))

  return {
    kpi: { rev, cogs, gp, opex, other, noi, ni },
    chartData,
    actualizedMonths: sortedActualMonths,
    fullYearOutlook,
    categoryLine,
  }
}

const outlookLine = (ytd, outlook, annual) => ({ ytd, remaining: outlook - ytd, outlook, annual })

const BREAKDOWN_SECTIONS = [
  { key: 'revenue', kpiKey: 'rev',   label: 'Revenue',                  higherIsBetter: true  },
  { key: 'cogs',    kpiKey: 'cogs',  label: 'Cost of goods sold',       higherIsBetter: false },
  { key: 'opex',    kpiKey: 'opex',  label: 'Operating expenses',       higherIsBetter: false },
  { key: 'other',   kpiKey: 'other', label: 'Other income / (expense)', higherIsBetter: true  },
]

// The Full-Year Outlook laid out by section and category: year-to-date actual,
// remaining budget, outlook and annual budget. Reads a buildDashboard result, so
// every page shows the same outlook.
export function outlookBreakdown(dashboard) {
  const labelBySlug = new Map(TABLE_ROWS.filter(row => row.slug).map(row => [row.slug, row.label]))
  const sectionLine = totals => outlookLine(totals.ya, totals.ol, totals.an)

  const sections = BREAKDOWN_SECTIONS.map(({ key, kpiKey, label, higherIsBetter }) => ({
    key,
    label,
    higherIsBetter,
    ...sectionLine(dashboard.kpi[kpiKey]),
    categories: SECTION_SLUGS[key]
      .map(slug => ({ slug, label: labelBySlug.get(slug), ...dashboard.categoryLine(slug) }))
      .filter(line => line.ytd !== 0 || line.remaining !== 0 || line.annual !== 0),
  }))

  return { sections, netIncome: sectionLine(dashboard.kpi.ni) }
}
