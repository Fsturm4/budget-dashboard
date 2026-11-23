import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDashboard } from './dashboard.js'

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
