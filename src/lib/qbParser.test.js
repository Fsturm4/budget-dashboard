import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { extractLineItems, applyMappings } from './qbParser.js'

function qbFile(rows) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

// A fictional company and chart of accounts.
const HEADER = [
  ['Profit and Loss'],
  ['Example Lawn Co.'],
  ['September 2026'],
  [null],
  [null, 'Total'],
]

// Nested groups, a refund, a zero balance, a parent account with its own
// posting, Other Income/Expenses, and the "Total Income" subtotal form.
const SAMPLE_LAYOUT = [
  ...HEADER,
  ['Income'],
  ['4100 Lawn Service Income', 8400],
  ['4190 Customer Refunds', -312.75],
  ['Total Income', 8087.25],
  ['Cost of Goods Sold'],
  ['5100 Crew Labor'],
  ['5110 Contract Crew', 1450],
  ['5120 Seasonal Crew', 0],
  ['Total for 5100 Crew Labor', 1450],
  ['5200 Granular Product', 960],
  ['Total Cost of Goods Sold', 2410],
  ['Gross Profit', 5677.25],
  ['Expenses'],
  ['6610 Bookkeeping Fees', 425],
  ['6700 Truck Costs', 80],
  ['6710 Diesel', 215.6],
  ['6720 Tires', 54.4],
  ['Total for 6700 Truck Costs', 350],
  ['Total Expenses', 775],
  ['Net Operating Income', 4902.25],
  ['Other Income'],
  ['7010 Bank Interest', 3.15],
  ['Total Other Income', 3.15],
  ['Other Expenses'],
  ['8010 Late Fees', 18],
  ['Total Other Expenses', 18],
  ['Net Other Income', -14.85],
  ['Net Income', 4887.4],
]

test('section subtotals are kept as QB totals, not line items', () => {
  const { items, qbTotals, mismatches } = extractLineItems(qbFile(SAMPLE_LAYOUT))

  assert.deepEqual(mismatches, [])
  assert.deepEqual(qbTotals, [
    { label: 'Total Income',             amountCents: 808725 },
    { label: 'Total Cost of Goods Sold', amountCents: 241000 },
    { label: 'Total Expenses',           amountCents: 77500 },
    { label: 'Total Other Income',       amountCents: 315 },
    { label: 'Total Other Expenses',     amountCents: 1800 },
    { label: 'Net Income',               amountCents: 488740 },
  ])
  assert.ok(items.every(item => !item.rawLabel.startsWith('Total') && !item.rawLabel.startsWith('Net ')))
})

test('account amounts are preserved, including refunds, zero balances and parent postings', () => {
  const { items } = extractLineItems(qbFile(SAMPLE_LAYOUT))
  const byLabel = Object.fromEntries(items.map(item => [item.rawLabel, item.amountCents]))

  assert.equal(byLabel['4190 Customer Refunds'], -31275)
  assert.equal(byLabel['5120 Seasonal Crew'], 0)
  assert.equal(byLabel['6700 Truck Costs'], 8000)
  assert.equal(byLabel['6610 Bookkeeping Fees'], 42500)
  assert.equal(items.length, 11)
})

test('older "Total for Income" subtotal form still reconciles', () => {
  const rows = SAMPLE_LAYOUT.map(([label, amount]) =>
    typeof label === 'string' && /^Total (Income|Cost of Goods Sold|Expenses|Other Income|Other Expenses)$/.test(label)
      ? [label.replace('Total ', 'Total for '), amount]
      : [label, amount]
  )
  const { items, mismatches } = extractLineItems(qbFile(rows))

  assert.deepEqual(mismatches, [])
  assert.equal(items.length, 11)
})

test('a parent row counted alongside its children fails reconciliation', () => {
  const rows = SAMPLE_LAYOUT.map(([label, amount]) =>
    label === '5100 Crew Labor' ? [label, 1450] : [label, amount]
  )
  const { mismatches } = extractLineItems(qbFile(rows))

  assert.equal(mismatches.length, 2)
  assert.match(mismatches[0], /^Total Cost of Goods Sold is \$2,410\.00 in QuickBooks but the accounts add up to \$3,860\.00$/)
  assert.match(mismatches[1], /^Net Income/)
})

test('an account whose amount is not a number fails reconciliation instead of being dropped', () => {
  const rows = SAMPLE_LAYOUT.map(([label, amount]) =>
    label === '6610 Bookkeeping Fees' ? [label, '425.00'] : [label, amount]
  )
  const { mismatches } = extractLineItems(qbFile(rows))

  assert.match(mismatches[0], /^Total Expenses is \$775\.00 in QuickBooks but the accounts add up to \$350\.00$/)
})

test('a file with no Net Income row is not imported unchecked', () => {
  const { mismatches } = extractLineItems(qbFile(SAMPLE_LAYOUT.filter(([label]) => label !== 'Net Income')))

  assert.deepEqual(mismatches, ['No Net Income row was found, so the file could not be checked against QuickBooks totals'])
})

test('mapped accounts are summed by category and subtotals no longer need a mapping', () => {
  const { items } = extractLineItems(qbFile(SAMPLE_LAYOUT))
  const mappings = [
    ['4100 Lawn Service Income', 'revenue'], ['4190 Customer Refunds', 'revenue'],
    ['5110 Contract Crew', 'labor'], ['5120 Seasonal Crew', 'labor'], ['5200 Granular Product', 'materials'],
    ['6610 Bookkeeping Fees', 'professional_fees'],
    ['6700 Truck Costs', 'vehicle'], ['6710 Diesel', 'vehicle'], ['6720 Tires', 'vehicle'],
    ['7010 Bank Interest', 'other_income'], ['8010 Late Fees', 'other_expense'],
  ].map(([raw_label, category_slug]) => ({ raw_label, category_slug }))

  const result = applyMappings(items, mappings)

  assert.deepEqual(result.unmappedLabels, [])
  assert.deepEqual(Object.fromEntries(result.mapped.map(r => [r.categorySlug, r.amountCents])), {
    revenue: 808725, labor: 145000, materials: 96000, professional_fees: 42500,
    vehicle: 35000, other_income: 315, other_expense: 1800,
  })
})

test('a genuinely unmapped account still blocks the import', () => {
  const rows = [
    ...HEADER,
    ['Expenses'],
    ['6610 Bookkeeping Fees', 425],
    ['8999 Unassigned Expense', 233.1],
    ['Total Expenses', 658.1],
    ['Net Income', -658.1],
  ]
  const { items, mismatches } = extractLineItems(qbFile(rows))
  const result = applyMappings(items, [{ raw_label: '6610 Bookkeeping Fees', category_slug: 'professional_fees' }])

  assert.deepEqual(mismatches, [])
  assert.equal(result.mapped, null)
  assert.deepEqual(result.unmappedLabels, ['8999 Unassigned Expense'])
})

// Same layout as a real export where an account group shares its section's
// name: a "Cost of Goods Sold" group (holding a flags account) inside the
// Cost of Goods Sold section, each with its own "Total Cost of Goods Sold".
const NESTED_GROUP_LAYOUT = [
  ...HEADER,
  ['Income'],
  ['4100 Lawn Service Income', 9200],
  ['Total Income', 9200],
  ['Cost of Goods Sold'],
  ['5110 Contract Crew', 3400],
  ['Cost of Goods Sold'],
  ['5210 Marking Flags', 410],
  ['Total Cost of Goods Sold', 410],
  ['Total Cost of Goods Sold', 3810],
  ['Gross Profit', 5390],
  ['Expenses'],
  ['6610 Bookkeeping Fees', 120],
  ['Total Expenses', 120],
  ['Net Operating Income', 5270],
  ['Other Expenses'],
  ['8010 Late Fees', 25],
  ['Total Other Expenses', 25],
  ['Net Other Income', -25],
  ['Net Income', 5245],
]

test('an account group named like its section reconciles and is counted once', () => {
  const { items, qbTotals, mismatches } = extractLineItems(qbFile(NESTED_GROUP_LAYOUT))

  assert.deepEqual(mismatches, [])
  assert.deepEqual(items.map(i => [i.rawLabel, i.amountCents]), [
    ['4100 Lawn Service Income', 920000],
    ['5110 Contract Crew', 340000],
    ['5210 Marking Flags', 41000],
    ['6610 Bookkeeping Fees', 12000],
    ['8010 Late Fees', 2500],
  ])
  assert.deepEqual(qbTotals.map(t => [t.label, t.amountCents]), [
    ['Total Income', 920000],
    ['Total Cost of Goods Sold', 381000],
    ['Total Expenses', 12000],
    ['Total Other Expenses', 2500],
    ['Net Income', 524500],
  ])
})

test('a wrong account-group subtotal still fails reconciliation', () => {
  const rows = NESTED_GROUP_LAYOUT.map((row, i) => i === NESTED_GROUP_LAYOUT.findIndex(r => r[0] === 'Total Cost of Goods Sold') ? [row[0], 400] : row)

  const { mismatches } = extractLineItems(qbFile(rows))

  assert.deepEqual(mismatches, ['The "Cost of Goods Sold" account group is $400.00 in QuickBooks but its accounts add up to $410.00'])
})
