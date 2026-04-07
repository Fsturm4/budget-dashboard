import * as XLSX from 'xlsx'

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

  const companyName = typeof rows[1]?.[0] === 'string' ? rows[1][0].trim() : null
  const dateRange   = typeof rows[2]?.[0] === 'string' ? rows[2][0].trim() : null

  // Matches "January 1-31, 2026" and "February 1-28, 2026" etc.
  // The dash may be a hyphen or en-dash depending on QB version.
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
// Returns an array of { rawLabel: string, amountCents: number }.
//
// Rules:
//   - Column A is the label, column B is the amount.
//   - Rows starting with "Total for" are sub-totals — skipped.
//   - SKIP_LABELS rows are calculated/header rows — skipped.
//   - Parent container rows with no numeric amount are skipped.
//   - Rows that map to the same category are summed at the applyMappings stage,
//     not here — extraction returns one entry per raw row.
export function extractLineItems(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })

  const items = []
  for (const row of rows) {
    const label  = row[0]
    const amount = row[1]

    if (typeof label !== 'string') continue
    const trimmed = label.trim()
    if (!trimmed)                           continue
    if (trimmed.startsWith('Total for'))    continue
    if (SKIP_LABELS.has(trimmed))           continue
    if (typeof amount !== 'number')         continue

    items.push({ rawLabel: trimmed, amountCents: Math.round(amount * 100) })
  }

  return items
}

// Applies the mappings table rules to a set of raw line items.
// mappings: array of { raw_label: string, category_slug: string }
//
// Returns:
//   { mapped: [{ categorySlug, amountCents }], unmappedLabels: [] }  — all mapped
//   { mapped: null, unmappedLabels: [string, ...] }                  — some unmapped
//
// Rows that share a category slug are summed (e.g. Sales + Refunds → net revenue).
// The caller must not write actuals if unmappedLabels is non-empty.
export function applyMappings(rawItems, mappings) {
  const ruleMap = new Map(mappings.map(m => [m.raw_label, m.category_slug]))

  const totals         = {}
  const unmappedLabels = []

  for (const { rawLabel, amountCents } of rawItems) {
    const slug = ruleMap.get(rawLabel)
    if (!slug) {
      if (!unmappedLabels.includes(rawLabel)) unmappedLabels.push(rawLabel)
      continue
    }
    totals[slug] = (totals[slug] ?? 0) + amountCents
  }

  if (unmappedLabels.length > 0) {
    return { mapped: null, unmappedLabels }
  }

  return {
    mapped: Object.entries(totals).map(([categorySlug, amountCents]) => ({
      categorySlug,
      amountCents,
    })),
    unmappedLabels: [],
  }
}

