import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBaseline, projectScenario } from './hireModel.js'

const CATEGORIES = [
  { slug: 'turf_pro_net_revenue',   section: 'revenue' },
  { slug: 'greenace_net_revenue',   section: 'revenue' },
  { slug: 'subcontract_labor',      section: 'cogs'    },
  { slug: 'owner_wages',            section: 'opex'    },
  { slug: 'depreciation',           section: 'opex'    },
  { slug: 'office_expense',         section: 'opex'    },
  { slug: 'other_income_expense',   section: 'other'   },
]

const budgetRow = (slug, monthlyCents) => ({
  category_slug: slug,
  ...Object.fromEntries(
    ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map(m => [`${m}_cents`, monthlyCents])
  ),
})

// January is uploaded; February–December come from budget.
const ACTUALS = [
  { category_slug: 'turf_pro_net_revenue', month: 1, amount_cents: 5000000 },
  { category_slug: 'greenace_net_revenue', month: 1, amount_cents: 2000000 },
  { category_slug: 'greenace_net_revenue', month: 1, amount_cents: -1500000 }, // intercompany elimination
  { category_slug: 'subcontract_labor',    month: 1, amount_cents: 1600000 },
  { category_slug: 'subcontract_labor',    month: 1, amount_cents: -1500000 }, // intercompany elimination
  { category_slug: 'owner_wages',          month: 1, amount_cents: 600000 },
]
const BUDGET = [
  budgetRow('turf_pro_net_revenue', 3000000),
  budgetRow('subcontract_labor',    1000000),
  budgetRow('owner_wages',           500000),
  budgetRow('depreciation',           60000),
  budgetRow('office_expense',        100000),
  budgetRow('other_income_expense',   10000),
]

const ASSUMPTIONS = {
  hourlyRateCents:     3200,
  burdenPct:           20,
  ownerSalaryCents:    8000000,
  sepCents:            2000000,
  distributionsCents:  2000000,
  motherPaymentsCents: 1728000,
  loanPrincipalCents:  0,
  startingCashCents:   5000000,
  customers:           520,
}

const baseline = buildBaseline(ACTUALS, BUDGET, CATEGORIES)

test('baseline uses actuals for uploaded months and budget for the rest', () => {
  assert.deepEqual(baseline.actualMonths, [1])
  assert.deepEqual(baseline.months[0], {
    revenue: 5500000, cogs: 100000, opex: 600000, other: 0, ownerWages: 600000, depreciation: 0,
  })
  assert.deepEqual(baseline.months[1], {
    revenue: 3000000, cogs: 1000000, opex: 660000, other: 10000, ownerWages: 500000, depreciation: 60000,
  })
})

test('technician cost is hours x rate x (1 + burden)', () => {
  assert.equal(projectScenario(baseline, ASSUMPTIONS, 900).technicianCost,  3456000)
  assert.equal(projectScenario(baseline, ASSUMPTIONS, 1440).technicianCost, 5529600)
  assert.equal(projectScenario(baseline, ASSUMPTIONS, 0).technicianCost,    0)
})

test('owner salary and SEP count once; distributions and loan principal do not touch net income', () => {
  // Income before owner pay: Jan 5,400,000 + 11 x 1,850,000 = 25,750,000
  const none = projectScenario(baseline, ASSUMPTIONS, 0)
  assert.equal(none.netIncome, 25750000 - 8000000 - 2000000)

  const moreDraws = projectScenario(
    baseline, { ...ASSUMPTIONS, distributionsCents: 9000000, loanPrincipalCents: 1200000 }, 0
  )
  assert.equal(moreDraws.netIncome, none.netIncome)
  assert.equal(moreDraws.cashChange, none.cashChange - 7000000 - 1200000)
})

test('annual cash change reconciles to net income plus depreciation less cash-only outflows', () => {
  for (const hours of [0, 900, 1440]) {
    const s = projectScenario(baseline, ASSUMPTIONS, hours)
    assert.equal(s.cashChange, s.netIncome + 11 * 60000 - 2000000 - 1728000)
    assert.equal(s.yearEndCash, 5000000 + s.cashChange)
  }
})

test('raising the wage lowers net income and cash by the same technician cost', () => {
  const at32 = projectScenario(baseline, ASSUMPTIONS, 1440)
  const at34 = projectScenario(baseline, { ...ASSUMPTIONS, hourlyRateCents: 3400 }, 1440)
  const extra = 1440 * 200 * 1.2
  assert.equal(at34.technicianCost, at32.technicianCost + extra)
  assert.equal(at34.netIncome,      at32.netIncome - extra)
  assert.equal(at34.yearEndCash,    at32.yearEndCash - extra)
  assert.ok(at34.customersNeeded > at32.customersNeeded)
})

test('lowest cash is the lowest month-end balance', () => {
  const lean = projectScenario(baseline, { ...ASSUMPTIONS, startingCashCents: 0, distributionsCents: 30000000 }, 1440)
  assert.equal(lean.lowestCash, lean.yearEndCash)
  assert.equal(lean.lowestCashMonth, 12)
})

test('customers needed covers technician cost from gross profit per customer', () => {
  // Gross profit: Jan 5,400,000 + 11 x 2,000,000 = 27,400,000 over 520 customers
  const s = projectScenario(baseline, ASSUMPTIONS, 900)
  assert.equal(s.customersNeeded, Math.ceil(3456000 / (27400000 / 520)))
})
