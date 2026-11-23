import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectHire } from './hireModel.js'

// Full-Year Outlook with $67,620.40 of owner wages and the $20,000 SEP already inside net income.
const OUTLOOK = { netIncome: 5701391, ownerWages: 6762040, sep: 2000000, depreciation: 132050 }

const ASSUMPTIONS = {
  hourlyRateCents:     3200,
  burdenPct:           20,
  ownerSalaryCents:    8000000,
  sepCents:            2000000,
  distributionsCents:  2000000,
  motherPaymentsCents: 1728000,
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

test('with no employee, net income is the outlook with owner salary raised to the planned amount', () => {
  assert.equal(at(3200, 0).netIncome, 5701391 - (8000000 - 6762040))
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
  assert.equal(more.cashChange, base.cashChange - 1000000 - 272000 - 500000)
})

test('cash change is net income plus depreciation less cash-only obligations', () => {
  for (const hours of [0, 900, 1440]) {
    const s = at(3200, hours)
    assert.equal(s.cashChange, s.netIncome + 132050 - 2000000 - 1728000)
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
