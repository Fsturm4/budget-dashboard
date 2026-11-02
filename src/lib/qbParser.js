import * as XLSX from 'xlsx'
import { formatDollars } from './money.js'

// QB P&L exports contain calculated summary rows and section headers that are
// not mappable line items. Skip all of these during extraction.
const SKIP_LABELS = new Set([
  'Profit and Loss',
  'Income',
  'Cost of Goods Sold',
  'Expenses',
  'Other Income',
  'Other Expenses',
  'Gross Profit',
  'Net Operating Income',
  'Net Income',
  'Net Other Income',
])

// How each QB section header contributes to Net Income.
const SECTION_NET_SIGN = {
  'Income':             1,
  'Cost of Goods Sold': -1,
  'Expenses':           -1,
  'Other Income':       1,
  'Other Expenses':     -1,
}

// Rows that close a QB section, in both the "Total Income" and "Total for Income" forms.
const SECTION_TOTAL_LABELS = Object.fromEntries(
  Object.keys(SECTION_NET_SIGN).flatMap(section => [
    [`Total ${section}`,     section],
    [`Total for ${section}`, section],
  ])
)

// Maps the exact company name string from QB row 2 to an internal slug.
// Handles the "GeenAce" typo present in the actual QB exports.
const QB_COMPANY_TO_SLUG = {
  'Turf Pro, Inc.':          'turf_pro',
  'GeenAce Lawn Care, LLC':  'greenace',
  'GreenAce Lawn Care, LLC': 'greenace',
}

const MONTH_NAME_TO_NUMBER = {
  January: 1, February: 2, March: 3,     April: 4,
  May: 5,     June: 6,     July: 7,      August: 8,
  September: 9, October: 10, November: 11, December: 12,
}

// Reads the QB file header rows and returns the company slug, month, and year
// embedded in the file. Used to validate a dropped file against the selected
// upload slot before any mapping or extraction runs.
//
// Returns { companySlug, companyName, month, year } — any field may be null
// if the file does not match the expected QB P&L format.
export function extractFileHeader(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })

  let companyName = null
  let dateRange   = null

  for (const row of rows.slice(0, 5)) {
    const cell = typeof row[0] === 'string' ? row[0].trim() : null
    if (!cell) continue
    if (!companyName && QB_COMPANY_TO_SLUG[cell] !== undefined) companyName = cell
    if (!dateRange   && /^(\w+)(?:\s+\d+[-\u2013]\d+,)?\s+(\d{4})/.test(cell)) dateRange = cell
  }

  const dateMatch = dateRange?.match(/^(\w+)(?:\s+\d+[-\u2013]\d+,)?\s+(\d{4})/)

  return {
    companySlug:  companyName ? (QB_COMPANY_TO_SLUG[companyName] ?? null) : null,
    companyName,
    month: dateMatch ? (MONTH_NAME_TO_NUMBER[dateMatch[1]] ?? null) : null,
    year:  dateMatch ? parseInt(dateMatch[2]) : null,
  }
}
// Extracts raw line items from a QB P&L xlsx file.
// Accepts an ArrayBuffer (from file.arrayBuffer() in the browser).
// Returns {
//   items:      [{ rawLabel, amountCents, qbSection }]  — account-level rows only
//   qbTotals:   [{ label, amountCents }]     — QB section totals and Net Income, kept for reconciliation
//   mismatches: [string]                     — reconciliation failures; non-empty means do not import
// }
//
// Rules:
//   - Column A is the label, column B is the amount.
//   - Section totals ("Total Income", "Total Expenses", ...) and Net Income are
//     not line items; each is compared against the sum of the accounts it covers.
//   - Rows starting with "Total for" are group sub-totals — skipped. A parent
//     account's own amount row is kept; its "Total for" row is not, so parent
//     and children are counted once.
//   - SKIP_LABELS rows are calculated/header rows — skipped.
//   - Parent container rows with no numeric amount are skipped.
//   - Rows that map to the same category are summed at the applyMappings stage,
//     not here — extraction returns one entry per raw row.
export function extractLineItems(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })

  const items       = []
  const qbTotals    = []
  const mismatches  = []
  const sectionSums = {}
  let   section     = null

  for (const row of rows) {
    const label  = row[0]
    const amount = row[1]

    if (typeof label !== 'string') continue
    const trimmed = label.trim()
    if (!trimmed)                                   continue
    if (SECTION_NET_SIGN[trimmed] !== undefined)  { section = trimmed; continue }
    if (typeof amount !== 'number')                 continue

    const amountCents = Math.round(amount * 100)

    const totalOf = SECTION_TOTAL_LABELS[trimmed]
    if (totalOf) {
      qbTotals.push({ label: trimmed, amountCents })
      const importedCents = sectionSums[totalOf] ?? 0
      if (importedCents !== amountCents)
        mismatches.push(`${trimmed} is ${formatDollars(amountCents)} in QuickBooks but the accounts add up to ${formatDollars(importedCents)}`)
      section = null
      continue
    }

    if (trimmed === 'Net Income') {
      qbTotals.push({ label: trimmed, amountCents })
      const importedCents = Object.entries(sectionSums)
        .reduce((net, [name, cents]) => net + SECTION_NET_SIGN[name] * cents, 0)
      if (importedCents !== amountCents)
        mismatches.push(`Net Income is ${formatDollars(amountCents)} in QuickBooks but the accounts add up to ${formatDollars(importedCents)}`)
      continue
    }

    if (trimmed.startsWith('Total for'))    continue
    if (SKIP_LABELS.has(trimmed))           continue

    if (section) sectionSums[section] = (sectionSums[section] ?? 0) + amountCents
    else mismatches.push(`"${trimmed}" is not inside an Income, Cost of Goods Sold, Expenses, Other Income or Other Expenses section`)

    items.push({ rawLabel: trimmed, amountCents, qbSection: section })
  }

  if (!qbTotals.some(total => total.label === 'Net Income'))
    mismatches.push('No Net Income row was found, so the file could not be checked against QuickBooks totals')

  return { items, qbTotals, mismatches }
}

// The dashboard section that holds each QuickBooks P&L section.
export const QB_SECTION_TO_DASHBOARD = {
  'Income':             'revenue',
  'Cost of Goods Sold': 'cogs',
  'Expenses':           'opex',
  'Other Income':       'other',
  'Other Expenses':     'other',
}

// The dashboard's single Other bucket is signed (income +, expense −), but QB
// shows Other Expenses as positive amounts.
function dashboardCents({ qbSection, amountCents }, dashboardSection) {
  return qbSection === 'Other Expenses' && dashboardSection === 'other' ? -amountCents : amountCents
}

// Applies the mappings table rules to a set of raw line items.
// mappings:      array of { raw_label: string, category_slug: string }
// sectionBySlug: { [category_slug]: 'revenue' | 'cogs' | 'opex' | 'other' }
//
// Returns {
//   mapped:        [{ categorySlug, amountCents }]       — mapped accounts, summed per category
//   unmappedItems: [{ rawLabel, amountCents, qbSection }] — accounts with no mapping rule
// }
//
// Rows that share a category slug are summed (e.g. Sales + Refunds → net revenue).
// The caller must not write actuals while unmappedItems is non-empty, unless
// each one has been explicitly approved for Pending Review (see pendingActuals).
export function applyMappings(rawItems, mappings, sectionBySlug) {
  const ruleMap = new Map(mappings.map(m => [m.raw_label, m.category_slug]))

  const totals        = {}
  const unmappedItems = []

  for (const item of rawItems) {
    const slug = ruleMap.get(item.rawLabel)
    if (!slug) {
      unmappedItems.push(item)
      continue
    }
    totals[slug] = (totals[slug] ?? 0) + dashboardCents(item, sectionBySlug[slug])
  }

  return {
    mapped: Object.entries(totals).map(([categorySlug, amountCents]) => ({
      categorySlug,
      amountCents,
    })),
    unmappedItems,
  }
}

// Pending Review lines for approved unmapped accounts: one per dashboard
// section, in that section's "pending_" category.
export function pendingActuals(unmappedItems) {
  const totals = {}
  for (const item of unmappedItems) {
    const section = QB_SECTION_TO_DASHBOARD[item.qbSection]
    const slug    = `pending_${section}`
    totals[slug]  = (totals[slug] ?? 0) + dashboardCents(item, section)
  }
  return Object.entries(totals).map(([categorySlug, amountCents]) => ({ categorySlug, amountCents }))
}

