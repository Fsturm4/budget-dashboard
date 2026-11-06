import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { pendingReviewRows, heldByDefault, readReport, buildNewFigures, diffMonth, fingerprint, allowedCategories, monthAfterReplacement } from './reconcile.js'

function qbFile(company, period, lines) {
  const rows = [['Profit and Loss'], [company], [period], [null], [null, 'Total'], ...lines]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

// Made-up April: $2,587.00 moved from 6235 Insurance - Health to the new account 6233.
const APRIL = [
  ['Income'], ['4000 Sales', 10000], ['Total Income', 10000],
  ['Expenses'], ['6233 Insurance - General', 2587], ['6800 Office Expense', 1000], ['Total Expenses', 3587],
  ['Net Operating Income', 6413], ['Net Income', 6413],
]
const MAPPINGS = [
  { raw_label: '4000 Sales', category_slug: 'turf_pro_net_revenue' },
  { raw_label: '6235 Insurance - Health', category_slug: 'insurance_health' },
  { raw_label: '6240 Insurance - Liability', category_slug: 'insurance_general_liability' },
  { raw_label: '6800 Office Expense', category_slug: 'office_expense' },
]
const SECTIONS = { turf_pro_net_revenue: 'revenue', insurance_health: 'opex', insurance_general_liability: 'opex', office_expense: 'opex', subcontract_labor: 'cogs' }
const CATEGORIES = {
  turf_pro_net_revenue: { display_name: 'Turf Pro Net Revenue', section: 'revenue' },
  greenace_net_revenue: { display_name: 'GreenAce Net Revenue', section: 'revenue' },
  insurance_health: { display_name: 'Insurance - Health', section: 'opex' },
  insurance_general_liability: { display_name: 'Insurance - General Liability', section: 'opex' },
  office_expense: { display_name: 'Office Expense', section: 'opex' },
  subcontract_labor: { display_name: 'Subcontract Labor', section: 'cogs' },
  pending_opex: { display_name: 'Uncategorized – Pending Review', section: 'opex' },
}

test('reads a single-month report for the selected company', () => {
  const report = readReport(qbFile('Turf Pro, Inc.', 'April 1-30, 2026', APRIL), 'turf_pro', 2026)
  assert.equal(report.month, 4)
  assert.equal(report.qbNetIncomeCents, 641300)
  assert.equal(report.items.length, 3)
})

test('rejects the wrong company, other years, partial months and multi-month reports', () => {
  assert.match(readReport(qbFile('GreenAce Lawn Care, LLC', 'April 1-30, 2026', APRIL), 'turf_pro', 2026).error, /not the company you selected/)
  assert.match(readReport(qbFile('Turf Pro, Inc.', 'April 1-30, 2025', APRIL), 'turf_pro', 2026).error, /2025/)
  assert.match(readReport(qbFile('Turf Pro, Inc.', 'April 1-15, 2026', APRIL), 'turf_pro', 2026).error, /only part of April/)
  assert.match(readReport(qbFile('Turf Pro, Inc.', 'April 1-October 31, 2026', APRIL), 'turf_pro', 2026).error, /not a single month.*one QuickBooks report per month/)
  assert.match(readReport(qbFile('Turf Pro, Inc.', 'January - December 2026', APRIL), 'turf_pro', 2026).error, /not a single month/)
  assert.match(readReport(qbFile('Someone Else', 'April 2026', APRIL), 'turf_pro', 2026).error, /not a QuickBooks/)
})

test('rejects a report whose accounts do not add up to its own totals', () => {
  const broken = APRIL.map(r => (r[0] === 'Net Income' ? ['Net Income', 6000] : r))
  assert.match(readReport(qbFile('Turf Pro, Inc.', 'April 1-30, 2026', broken), 'turf_pro', 2026).error, /does not add up/)
})

test('an unmapped account stops the plan until it is approved; nothing is guessed', () => {
  const { items } = readReport(qbFile('Turf Pro, Inc.', 'April 1-30, 2026', APRIL), 'turf_pro', 2026)
  const blocked = buildNewFigures(items, MAPPINGS, SECTIONS, {})
  assert.deepEqual(blocked.unresolved.map(i => i.rawLabel), ['6233 Insurance - General'])
  assert.deepEqual(blocked.newMappings, [])

  const approved = buildNewFigures(items, MAPPINGS, SECTIONS, { '6233 Insurance - General': { action: 'map', categorySlug: 'insurance_general_liability' } })
  assert.equal(approved.unresolved.length, 0)
  assert.deepEqual(approved.newMappings, [{ raw_label: '6233 Insurance - General', qb_section: 'Expenses', category_slug: 'insurance_general_liability' }])
  assert.deepEqual(Object.fromEntries(approved.rows.map(r => [r.category_slug, r.amount_cents])),
    { turf_pro_net_revenue: 1000000, insurance_general_liability: 258700, office_expense: 100000 })
})

test('an account held in Pending Review goes to the pending line, with no new mapping', () => {
  const { items } = readReport(qbFile('Turf Pro, Inc.', 'April 1-30, 2026', APRIL), 'turf_pro', 2026)
  const plan = buildNewFigures(items, MAPPINGS, SECTIONS, { '6233 Insurance - General': { action: 'pending' } })
  assert.equal(plan.unresolved.length, 0)
  assert.equal(plan.newMappings.length, 0)
  assert.equal(plan.rows.find(r => r.category_slug === 'pending_opex').amount_cents, 258700)
})

test('differences are category-level, include added and removed categories, and keep net income', () => {
  const stored = [
    { id: 1, category_slug: 'turf_pro_net_revenue', amount_cents: 1000000, upload_id: 9 },
    { id: 2, category_slug: 'insurance_health', amount_cents: 258700, upload_id: 9 },
    { id: 3, category_slug: 'office_expense', amount_cents: 100000, upload_id: 9 },
  ]
  const { items } = readReport(qbFile('Turf Pro, Inc.', 'April 1-30, 2026', APRIL), 'turf_pro', 2026)
  const { rows } = buildNewFigures(items, MAPPINGS, SECTIONS, { '6233 Insurance - General': { action: 'map', categorySlug: 'insurance_general_liability' } })
  const lines = diffMonth(stored, rows, CATEGORIES, {})
  assert.deepEqual(lines.map(l => [l.slug, l.existing, l.updated, l.difference]),
    [['insurance_general_liability', 0, 258700, 258700], ['insurance_health', 258700, 0, -258700]])
  assert.equal(lines.reduce((sum, l) => sum + l.difference, 0), 0)
  assert.equal(diffMonth(stored, [
    { category_slug: 'turf_pro_net_revenue', amount_cents: 1000000 },
    { category_slug: 'insurance_health', amount_cents: 258700 },
    { category_slug: 'office_expense', amount_cents: 100000 },
  ], CATEGORIES, {}).length, 0)
})

test('rows set by an earlier correction are flagged with their reason', () => {
  const stored = [{ id: 5, category_slug: 'subcontract_labor', amount_cents: 515000, upload_id: null }]
  const [line] = diffMonth(stored, [{ category_slug: 'subcontract_labor', amount_cents: 500000 }], CATEGORIES, { subcontract_labor: 'CT Landscaping $5,000' })
  assert.equal(line.fromCorrection, true)
  assert.equal(line.correctionReason, 'CT Landscaping $5,000')
})

test('fingerprint matches the database format and ignores row order', () => {
  const rows = [{ id: 7, category_slug: 'b', amount_cents: 2 }, { id: 3, category_slug: 'a', amount_cents: 1 }]
  assert.equal(fingerprint(rows), 'a:3:1,b:7:2')
})

test('the other company stays as stored when computing a month after replacement', () => {
  const active = [
    { company: 'turf_pro', category_slug: 'x', amount_cents: 1 },
    { company: 'greenace', category_slug: 'y', amount_cents: 2 },
  ]
  const after = monthAfterReplacement(active, 'turf_pro', [{ category_slug: 'z', amount_cents: 9 }])
  assert.deepEqual(after.filter(r => r.company === 'greenace'), [active[1]])
  assert.deepEqual(after.filter(r => r.company === 'turf_pro').map(r => r.category_slug), ['z'])
})

test('approvals offer only categories from the same section; revenue only for the same company', () => {
  assert.deepEqual(allowedCategories(CATEGORIES, 'Expenses', 'turf_pro').map(c => c.slug).sort(),
    ['insurance_general_liability', 'insurance_health', 'office_expense'])
  assert.deepEqual(allowedCategories(CATEGORIES, 'Income', 'turf_pro').map(c => c.slug), ['turf_pro_net_revenue'])
  assert.deepEqual(allowedCategories(CATEGORIES, 'Cost of Goods Sold', 'turf_pro').map(c => c.slug), ['subcontract_labor'])
})

test('pending accounts are labelled as pending CPA review in the differences', () => {
  const [line] = diffMonth([{ id: 1, category_slug: 'pending_opex', amount_cents: 31500, upload_id: 9 }], [{ category_slug: 'pending_opex', amount_cents: 61500 }], CATEGORIES, {})
  assert.equal(line.label, 'Uncategorized – Pending Review (pending CPA review)')
  assert.equal(line.difference, 30000)
})

test('held accounts are classified unchanged, changed, removed or new — a $315 vs $615 difference is never hidden', () => {
  const stored = [{ raw_label: 'Uncategorized Expense', qb_section: 'Expenses', amount_cents: 31500 }, { raw_label: 'Old Item', qb_section: 'Expenses', amount_cents: 100 }]
  const rows = pendingReviewRows(stored, [{ rawLabel: 'Uncategorized Expense', qbSection: 'Expenses', amountCents: 61500 }, { rawLabel: 'Brand New', qbSection: 'Expenses', amountCents: 5 }])
  assert.deepEqual(rows.map(r => [r.label, r.status]), [['Uncategorized Expense', 'changed'], ['Old Item', 'removed'], ['Brand New', 'new']])
  assert.equal(pendingReviewRows(stored.slice(0, 1), [{ rawLabel: 'Uncategorized Expense', qbSection: 'Expenses', amountCents: 31500 }])[0].status, 'unchanged')
})

test('only accounts already held in Pending Review in every month they appear keep that status by default', () => {
  const reports = { 4: [{ rawLabel: 'Uncategorized Expense' }, { rawLabel: '6233 Insurance - General' }], 5: [{ rawLabel: 'Uncategorized Expense' }] }
  const held = { 4: [{ raw_label: 'Uncategorized Expense' }], 5: [] }
  assert.deepEqual(heldByDefault(reports, held, []), [])
  assert.deepEqual(heldByDefault({ 4: reports[4] }, held, []), ['Uncategorized Expense'])
  assert.deepEqual(heldByDefault({ 4: reports[4] }, held, [{ raw_label: 'Uncategorized Expense' }]), [])
})
