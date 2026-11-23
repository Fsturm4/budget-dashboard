import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTUALS_2025, actual2025Cents } from './actuals2025.js'
import { TABLE_ROWS, SECTION_SLUGS } from './trackerRows.js'

const sectionTotal = (section, mode) =>
  SECTION_SLUGS[section].reduce((sum, slug) => sum + actual2025Cents(slug, mode), 0)
const netIncome = mode =>
  sectionTotal('revenue', mode) - sectionTotal('cogs', mode) - sectionTotal('opex', mode) + sectionTotal('other', mode)

// Totals printed on the QuickBooks Profit and Loss reports, January-December 2025.
test('Turf Pro equals its QuickBooks report', () => {
  assert.equal(sectionTotal('revenue', 'tp'), 22142139)
  assert.equal(sectionTotal('cogs', 'tp'),    15402224)
  assert.equal(sectionTotal('opex', 'tp'),     5305541)
  assert.equal(netIncome('tp'),                1434374)
})

test('GreenAce equals its QuickBooks report', () => {
  assert.equal(sectionTotal('revenue', 'ga'), 32226594)
  assert.equal(sectionTotal('cogs', 'ga'),    10501651)
  // QuickBooks: Total Expenses 173,797.09 plus 880.00 Penalties and Fees listed under Other Expenses.
  assert.equal(sectionTotal('opex', 'ga'),    17379709 + 88000)
  assert.equal(sectionTotal('other', 'ga'),     281267)
  assert.equal(netIncome('ga'),                4538501)
})

test('combined net income is the sum of the two reports; the elimination changes revenue and COGS only', () => {
  assert.equal(netIncome('combined'), 1434374 + 4538501)
  assert.equal(sectionTotal('revenue', 'combined'), 22142139 + 32226594 - 12178800)
  assert.equal(sectionTotal('cogs', 'combined'),    15402224 + 10501651 - 12178800)
  assert.equal(sectionTotal('opex', 'combined'),    sectionTotal('opex', 'tp') + sectionTotal('opex', 'ga'))
})

test('every 2025 figure has a row on the page, so nothing is omitted', () => {
  const rowSlugs = TABLE_ROWS.filter(r => r.type === 'input').map(r => r.slug)
  for (const slug of Object.keys(ACTUALS_2025)) assert.ok(rowSlugs.includes(slug), slug)
})
