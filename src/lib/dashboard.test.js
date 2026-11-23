import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDashboard, outlookBreakdown } from './dashboard.js'

const CATEGORIES = [
  { slug: 'turf_pro_net_revenue', section: 'revenue' },
  { slug: 'office_expense',       section: 'opex'    },
  { slug: 'sep_ira_expense',      section: 'opex'    },
]

const MONTH_COLS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const budgetRow = (slug, monthly) => ({
  category_slug: slug,
  annual_budget_cents: monthly.reduce((sum, cents) => sum + cents, 0),
  ...Object.fromEntries(MONTH_COLS.map((col, i) => [`${col}_cents`, monthly[i]])),
})

// $20,000 SEP budgeted in December; revenue and office expense budgeted evenly.
const BUDGET = [
  budgetRow('turf_pro_net_revenue', Array(12).fill(1000000)),
  budgetRow('office_expense',       Array(12).fill(100000)),
  budgetRow('sep_ira_expense',      [...Array(11).fill(0), 2000000]),
]

const monthActuals = (month, sepCents = 0) => [
  { category_slug: 'turf_pro_net_revenue', month, amount_cents: 1000000 },
  { category_slug: 'office_expense',       month, amount_cents: 100000 },
  ...(sepCents ? [{ category_slug: 'sep_ira_expense', month, amount_cents: sepCents }] : []),
]
const throughMonth = (last, sepByMonth = {}) =>
  Array.from({ length: last }, (_, i) => monthActuals(i + 1, sepByMonth[i + 1])).flat()

const outlook = actuals => buildDashboard(actuals, BUDGET, CATEGORIES)

test('ordinary categories use actuals for uploaded months and budget for the rest', () => {
  const d = outlook(throughMonth(10))
  assert.equal(d.fullYearOutlook('office_expense'), 1200000)
  assert.equal(d.kpi.rev.ol, 12000000)
})

test('SEP not yet recorded: the December budget is counted once', () => {
  const d = outlook(throughMonth(10))
  assert.equal(d.fullYearOutlook('sep_ira_expense'), 2000000)
  assert.equal(d.kpi.opex.ol, 1200000 + 2000000)
  assert.equal(d.kpi.ni.ol, 12000000 - 1200000 - 2000000)
})

test('SEP recorded in November while budgeted in December is not counted twice', () => {
  const d = outlook(throughMonth(11, { 11: 2000000 }))
  assert.equal(d.fullYearOutlook('sep_ira_expense'), 2000000)
  assert.equal(d.kpi.opex.ol, 1200000 + 2000000)
})

test('SEP partly recorded: the outlook stays at the annual budget until the year closes', () => {
  assert.equal(outlook(throughMonth(11, { 11: 800000 })).fullYearOutlook('sep_ira_expense'), 2000000)
})

test('SEP recorded above budget shows what QuickBooks recorded', () => {
  assert.equal(outlook(throughMonth(11, { 11: 2300000 })).fullYearOutlook('sep_ira_expense'), 2300000)
})

test('once all twelve months are uploaded the outlook is QuickBooks actuals only', () => {
  assert.equal(outlook(throughMonth(12, { 11: 1500000 })).fullYearOutlook('sep_ira_expense'), 1500000)
  assert.equal(outlook(throughMonth(12)).fullYearOutlook('sep_ira_expense'), 0)
})

test('year-to-date figures are unchanged by the SEP rule', () => {
  const d = outlook(throughMonth(10))
  assert.equal(d.kpi.opex.ya, 1000000)
  assert.equal(d.kpi.opex.yb, 1000000)
  assert.equal(d.kpi.opex.an, 1200000 + 2000000)
})

// ── outlook breakdown ─────────────────────────────────────────────────────────

const FULL_CATEGORIES = [
  { slug: 'turf_pro_net_revenue',   section: 'revenue' },
  { slug: 'greenace_net_revenue',   section: 'revenue' },
  { slug: 'supplies_and_materials', section: 'cogs'    },
  { slug: 'subcontract_labor',      section: 'cogs'    },
  { slug: 'owner_wages',            section: 'opex'    },
  { slug: 'office_expense',         section: 'opex'    },
  { slug: 'sep_ira_expense',        section: 'opex'    },
  { slug: 'pending_opex',           section: 'opex'    },
  { slug: 'other_income_expense',   section: 'other'   },
]
const FULL_BUDGET = [
  budgetRow('turf_pro_net_revenue',   Array(12).fill(1000000)),
  budgetRow('greenace_net_revenue',   Array(12).fill(500000)),
  budgetRow('supplies_and_materials', Array(12).fill(300000)),
  budgetRow('subcontract_labor',      Array(12).fill(200000)),
  budgetRow('owner_wages',            [...Array(11).fill(400000), 1200000]),
  budgetRow('office_expense',         Array(12).fill(100000)),
  budgetRow('sep_ira_expense',        [...Array(11).fill(0), 2000000]),
  budgetRow('other_income_expense',   Array(12).fill(10000)),
]
const fullMonth = (month, sepCents = 0) => [
  { category_slug: 'turf_pro_net_revenue',   month, amount_cents: 1100000 },
  { category_slug: 'greenace_net_revenue',   month, amount_cents: 700000 },
  { category_slug: 'greenace_net_revenue',   month, amount_cents: -250000 }, // intercompany elimination
  { category_slug: 'supplies_and_materials', month, amount_cents: 280000 },
  { category_slug: 'subcontract_labor',      month, amount_cents: 450000 },
  { category_slug: 'subcontract_labor',      month, amount_cents: -250000 }, // intercompany elimination
  { category_slug: 'owner_wages',            month, amount_cents: 350000 },
  { category_slug: 'office_expense',         month, amount_cents: 120000 },
  { category_slug: 'pending_opex',           month, amount_cents: 3000 },
  { category_slug: 'other_income_expense',   month, amount_cents: -5000 },
  ...(sepCents ? [{ category_slug: 'sep_ira_expense', month, amount_cents: sepCents }] : []),
]
const fullThrough = (last, sepByMonth = {}) =>
  Array.from({ length: last }, (_, i) => fullMonth(i + 1, sepByMonth[i + 1])).flat()
const breakdownFor = actuals => {
  const dashboard = buildDashboard(actuals, FULL_BUDGET, FULL_CATEGORIES)
  return { dashboard, ...outlookBreakdown(dashboard) }
}
const COLUMNS = ['ytd', 'remaining', 'outlook', 'annual']

test('breakdown: every line has year-to-date plus remaining equal to the outlook', () => {
  for (const sepByMonth of [{}, { 11: 2000000 }, { 10: 800000 }, { 9: 2300000 }]) {
    const { sections, netIncome } = breakdownFor(fullThrough(11, sepByMonth))
    for (const line of [netIncome, ...sections, ...sections.flatMap(s => s.categories)]) {
      assert.equal(line.ytd + line.remaining, line.outlook)
    }
  }
})

test('breakdown: each section total equals the sum of its categories, in every column', () => {
  const { sections } = breakdownFor(fullThrough(10))
  for (const section of sections) {
    for (const column of COLUMNS) {
      assert.equal(section.categories.reduce((sum, line) => sum + line[column], 0), section[column], `${section.key} ${column}`)
    }
  }
})

test('breakdown: net income is revenue less COGS less operating expenses plus other, in every column', () => {
  const { sections, netIncome } = breakdownFor(fullThrough(10))
  const [revenue, cogs, opex, other] = sections
  for (const column of COLUMNS) {
    assert.equal(revenue[column] - cogs[column] - opex[column] + other[column], netIncome[column], column)
  }
})

test('breakdown: totals are the same figures the Overview cards use', () => {
  const { dashboard, sections, netIncome } = breakdownFor(fullThrough(10))
  assert.equal(sections[0].outlook, dashboard.kpi.rev.ol)
  assert.equal(sections[0].ytd,     dashboard.kpi.rev.ya)
  assert.equal(netIncome.outlook,   dashboard.kpi.ni.ol)
  assert.equal(netIncome.ytd,       dashboard.kpi.ni.ya)
  assert.equal(netIncome.annual,    dashboard.kpi.ni.an)
})

test('breakdown: SEP remaining shrinks as contributions are recorded, so it is counted once', () => {
  const sepLine = sepByMonth =>
    breakdownFor(fullThrough(11, sepByMonth)).sections[2].categories.find(line => line.slug === 'sep_ira_expense')
  assert.deepEqual(sepLine({}),              { slug: 'sep_ira_expense', label: 'SEP IRA Expense', ytd: 0,       remaining: 2000000, outlook: 2000000, annual: 2000000 })
  assert.deepEqual(sepLine({ 11: 2000000 }), { slug: 'sep_ira_expense', label: 'SEP IRA Expense', ytd: 2000000, remaining: 0,       outlook: 2000000, annual: 2000000 })
  assert.deepEqual(sepLine({ 10: 800000 }),  { slug: 'sep_ira_expense', label: 'SEP IRA Expense', ytd: 800000,  remaining: 1200000, outlook: 2000000, annual: 2000000 })
  assert.deepEqual(sepLine({ 9: 2300000 }),  { slug: 'sep_ira_expense', label: 'SEP IRA Expense', ytd: 2300000, remaining: 0,       outlook: 2300000, annual: 2000000 })
})

test('breakdown: once all twelve months are uploaded nothing remains and the outlook is actuals', () => {
  const { sections, netIncome } = breakdownFor(fullThrough(12, { 12: 1500000 }))
  for (const line of [netIncome, ...sections, ...sections.flatMap(s => s.categories)]) assert.equal(line.remaining, 0)
  assert.equal(sections[2].categories.find(line => line.slug === 'sep_ira_expense').outlook, 1500000)
})

test('breakdown: pending-review amounts appear as their own line; categories with nothing are left out', () => {
  const opex = breakdownFor(fullThrough(10)).sections[2]
  assert.equal(opex.categories.find(line => line.slug === 'pending_opex').ytd, 30000)
  assert.equal(opex.categories.find(line => line.slug === 'rent_and_lease'), undefined)
})
