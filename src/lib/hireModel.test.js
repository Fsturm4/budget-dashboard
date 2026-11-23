import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectHire } from './hireModel.js'

// Full-Year Outlook with $67,620.40 of owner wages, the $20,000 SEP and $28,656 of rent already inside net income.
const OUTLOOK = { netIncome: 5865407, ownerWages: 6762040, sep: 2000000, rent: 2865600, depreciation: 132050 }

const ASSUMPTIONS = {
  hourlyRateCents:     3200,
  burdenPct:           20,
  ownerSalaryCents:    8000000,
  sepCents:            2000000,
  rentCents:           2055600,
  distributionsCents:  2000000,
  motherPaymentsCents: 1729872,
  loanPrincipalCents:  0,
  startingCashCents:   6000000,
  lineOfCreditCents:   1000000,
}

const at = (rate, hours) => projectHire(OUTLOOK, { ...ASSUMPTIONS, hourlyRateCents: rate }, hours)

test('technician cost is hours x wage x (1 + burden) at $30, $32 and $34', () => {
  assert.equal(at(3000, 900).technicianCost,  3240000)
  assert.equal(at(3200, 900).technicianCost,  3456000)
  assert.equal(at(3400, 900).technicianCost,  3672000)
  assert.equal(at(3000, 1440).technicianCost, 5184000)
  assert.equal(at(3200, 1440).technicianCost, 5529600)
  assert.equal(at(3400, 1440).technicianCost, 5875200)
  assert.equal(at(3200, 0).technicianCost,    0)
})

test('with no employee, net income is the outlook with owner salary and rent set to the planned amounts', () => {
  assert.equal(at(3200, 0).netIncome, 5865407 - (8000000 - 6762040) + (2865600 - 2055600))
  assert.equal(at(3200, 0).netIncome, 5437447)
})

test('planned rent replaces the rent in the outlook, whatever that was', () => {
  const beforeBudgetChange = projectHire(
    { ...OUTLOOK, netIncome: OUTLOOK.netIncome - 502916, rent: OUTLOOK.rent + 502916 }, ASSUMPTIONS, 0
  )
  assert.equal(beforeBudgetChange.netIncome, at(3200, 0).netIncome)
})

test('SEP is counted once whether or not the outlook already contains it', () => {
  const withoutSepCategory = projectHire(
    { ...OUTLOOK, netIncome: OUTLOOK.netIncome + 2000000, sep: 0 }, ASSUMPTIONS, 0
  )
  assert.equal(withoutSepCategory.netIncome, at(3200, 0).netIncome)
})

test('distributions, payments to mother and loan principal reduce cash but not net income', () => {
  const base = at(3200, 1440)
  const more = projectHire(
    OUTLOOK, { ...ASSUMPTIONS, distributionsCents: 3000000, motherPaymentsCents: 2000000, loanPrincipalCents: 500000 }, 1440
  )
  assert.equal(more.netIncome, base.netIncome)
  assert.equal(more.cashChange, base.cashChange - 1000000 - 270128 - 500000)
})

test('cash change is net income plus depreciation less cash-only obligations', () => {
  for (const hours of [0, 900, 1440]) {
    const s = at(3200, hours)
    assert.equal(s.cashChange, s.netIncome + 132050 - 2000000 - 1729872)
    assert.equal(s.yearEndCashLessDebt, 6000000 - 1000000 + s.cashChange)
  }
})

test('raising the wage lowers net income and cash by exactly the added technician cost', () => {
  const extra = 1440 * 200 * 1.2
  assert.equal(at(3400, 1440).netIncome,           at(3200, 1440).netIncome - extra)
  assert.equal(at(3400, 1440).cashChange,          at(3200, 1440).cashChange - extra)
  assert.equal(at(3400, 1440).yearEndCashLessDebt, at(3200, 1440).yearEndCashLessDebt - extra)
  assert.equal(at(3400, 0).netIncome,              at(3200, 0).netIncome)
})

test('debt carried is the shortfall of year-end cash against the line of credit, never negative', () => {
  assert.equal(at(3200, 0).debtCarried, 0)
  const short = projectHire(OUTLOOK, { ...ASSUMPTIONS, startingCashCents: 1000000 }, 1440)
  assert.equal(short.debtCarried, -short.yearEndCashLessDebt)
  assert.ok(short.debtCarried > 0)
})

test('new borrowing is only what the year uses beyond starting cash', () => {
  assert.equal(at(3200, 0).newBorrowing, 0)
  const short = projectHire(OUTLOOK, { ...ASSUMPTIONS, startingCashCents: 1000000 }, 1440)
  assert.equal(short.newBorrowing, short.debtCarried - 1000000)
  assert.equal(short.newBorrowing, -(1000000 + short.cashChange))
})

test('with no incremental benefits, old employee and cash figures are unchanged', () => {
  for (const hours of [0, 900, 1440]) {
    const result = projectHire(OUTLOOK, ASSUMPTIONS, hours, {
      addedRevenueCents: 0, subcontractorSavingsCents: 0, grossMarginPct: 60,
    })
    assert.equal(result.netIncome, at(3200, hours).netIncome)
    assert.equal(result.cashChange, at(3200, hours).cashChange)
    assert.equal(result.addedGrossProfitCents, 0)
  }
})

test('incremental new sales affect profit and cash only at the contribution margin, not full sales', () => {
  const baseline = at(3200, 900)
  const withRevenue = projectHire(OUTLOOK, ASSUMPTIONS, 900, {
    addedRevenueCents: 2500000, grossMarginPct: 60, subcontractorSavingsCents: 0,
  })
  assert.equal(withRevenue.addedRevenueCents, 2500000)
  assert.equal(withRevenue.addedGrossProfitCents, 1500000)
  assert.equal(withRevenue.netIncome, baseline.netIncome + 1500000)
  assert.equal(withRevenue.cashChange, baseline.cashChange + 1500000)
})

test('subcontractor savings increase projected net income and cash without reducing hire cost', () => {
  const baseline = at(3200, 900)
  const withSavings = projectHire(OUTLOOK, ASSUMPTIONS, 900, {
    addedRevenueCents: 0, grossMarginPct: 60, subcontractorSavingsCents: 500000,
  })
  assert.equal(withSavings.technicianCost, baseline.technicianCost)
  assert.equal(withSavings.subcontractorSavingsCents, 500000)
  assert.equal(withSavings.netIncome, baseline.netIncome + 500000)
  assert.equal(withSavings.yearEndCashLessDebt, baseline.yearEndCashLessDebt + 500000)
})

test('growth assumptions never artificially improve the no-employee scenario', () => {
  const baseline = at(3200, 0)
  const noHire = projectHire(OUTLOOK, ASSUMPTIONS, 0, {
    addedRevenueCents: 20000000, grossMarginPct: 100, subcontractorSavingsCents: 10000000,
  })
  assert.equal(noHire.netIncome, baseline.netIncome)
  assert.equal(noHire.addedGrossProfitCents, 0)
  assert.equal(noHire.subcontractorSavingsCents, 0)
})

test('new sales contribution uses bounded gross margins', () => {
  const tooHigh = projectHire(OUTLOOK, ASSUMPTIONS, 900, { addedRevenueCents: 100000, grossMarginPct: 150 })
  const tooLow = projectHire(OUTLOOK, ASSUMPTIONS, 900, { addedRevenueCents: 100000, grossMarginPct: -20 })
  assert.equal(tooHigh.addedGrossProfitCents, 100000)
  assert.equal(tooLow.addedGrossProfitCents, 0)
})
