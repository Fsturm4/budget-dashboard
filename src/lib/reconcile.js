import * as XLSX from 'xlsx'
import { extractFileHeader, extractLineItems, applyMappings, pendingActuals, QB_SECTION_TO_DASHBOARD } from './qbParser.js'
import { MONTH_LABELS } from './config.js'

const SINGLE_MONTH_LINE = /^(\w+)\s+(\d+)[-–](\d+),\s+(\d{4})$/

// Reads one corrected QuickBooks P&L and returns the single month it covers, or an error.
// The importer reads column A (label) and B (amount) only, so a report with a column per month
// cannot be split: the user must upload one report per month instead of the app estimating.
export function readReport(arrayBuffer, selectedCompany, year) {
  const header = extractFileHeader(arrayBuffer)
  if (!header.companySlug)
    return { error: 'This is not a QuickBooks Profit & Loss export the dashboard can read (company name not found in the header).' }
  if (header.companySlug !== selectedCompany)
    return { error: `This report is for ${header.companyName}, not the company you selected.` }

  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null })
  const dateLine = rows.slice(0, 5).map(r => (typeof r[0] === 'string' ? r[0].trim() : '')).find(c => /\d{4}/.test(c) && /^[A-Za-z]/.test(c))
  if (!header.month || !header.year)
    return { error: `The report period${dateLine ? ` "${dateLine}"` : ''} is not a single month. Reports spanning several months cannot be split reliably, so upload one QuickBooks report per month.` }
  if (header.year !== year)
    return { error: `This report is for ${header.year}; the dashboard year is ${year}.` }

  const range = dateLine?.match(SINGLE_MONTH_LINE)
  if (range) {
    const daysInMonth = new Date(header.year, header.month, 0).getDate()
    if (parseInt(range[2]) !== 1 || parseInt(range[3]) !== daysInMonth)
      return { error: `The report covers only part of ${MONTH_LABELS[header.month - 1]} ("${dateLine}"). Export the whole month.` }
  }

  const { items, qbTotals, mismatches } = extractLineItems(arrayBuffer)
  if (mismatches.length > 0)
    return { error: `This report does not add up, so it was not used: ${mismatches.join('; ')}.` }
  const netIncome = qbTotals.find(t => t.label === 'Net Income')
  return { month: header.month, year: header.year, items, qbNetIncomeCents: netIncome.amountCents }
}

// Turns a report's raw lines into the figures the database will store, using the saved mappings
// plus the accounts the user has explicitly approved. Nothing is guessed: any account that is
// neither mapped nor approved is returned in `unresolved`.
//   approvals: { [rawLabel]: { action: 'map', categorySlug } | { action: 'pending' } }
export function buildNewFigures(items, mappings, sectionBySlug, approvals) {
  const approvedMappings = Object.entries(approvals)
    .filter(([, a]) => a.action === 'map' && a.categorySlug)
    .map(([raw_label, a]) => ({ raw_label, category_slug: a.categorySlug }))
  const { mapped, unmappedItems } = applyMappings(items, [...mappings, ...approvedMappings], sectionBySlug)

  const isPending = item => approvals[item.rawLabel]?.action === 'pending'
  const pendingItems = unmappedItems.filter(isPending)
  const unresolved   = unmappedItems.filter(item => !isPending(item))
  const rows = [...mapped, ...pendingActuals(pendingItems)]
    .map(r => ({ category_slug: r.categorySlug, amount_cents: r.amountCents }))

  // Mappings that are new in this call (not already saved).
  const saved = new Set(mappings.map(m => m.raw_label))
  const newMappings = items
    .filter(item => !saved.has(item.rawLabel) && approvals[item.rawLabel]?.action === 'map' && approvals[item.rawLabel].categorySlug)
    .map(item => ({ raw_label: item.rawLabel, qb_section: item.qbSection, category_slug: approvals[item.rawLabel].categorySlug }))

  return { rows, unresolved, pendingItems, newMappings }
}

// The same text the database computes, from the rows the page displays, so a preview can only be
// confirmed against exactly the stored figures it was made from.
export function fingerprint(storedRows) {
  return [...storedRows].sort((a, b) => a.id - b.id)
    .map(r => `${r.category_slug}:${r.id}:${r.amount_cents}`).join(',')
}

// Category-level differences between the stored month and the new figures (missing = $0).
//   stored: [{ id, category_slug, amount_cents, upload_id }]   newRows: [{ category_slug, amount_cents }]
//   categories: { [slug]: { display_name, section } }   correctionReasons: { [slug]: reason }
export function diffMonth(stored, newRows, categories, correctionReasons) {
  const before = new Map(stored.map(r => [r.category_slug, r]))
  const after  = new Map(newRows.map(r => [r.category_slug, r.amount_cents]))
  const slugs  = new Set([...before.keys(), ...after.keys()])
  const order  = { revenue: 0, cogs: 1, opex: 2, other: 3 }

  return [...slugs]
    .map(slug => {
      const existing = before.get(slug)?.amount_cents ?? 0
      const updated  = after.get(slug) ?? 0
      return {
        slug,
        label:    categories[slug]?.display_name ?? slug,
        section:  categories[slug]?.section ?? 'opex',
        existing,
        updated,
        difference: updated - existing,
        fromCorrection: before.has(slug) && before.get(slug).upload_id === null,
        correctionReason: correctionReasons[slug] ?? null,
      }
    })
    .filter(line => line.difference !== 0)
    .sort((a, b) => order[a.section] - order[b.section] || a.label.localeCompare(b.label))
}

// What the month's active actuals would look like after the replacement.
export function monthAfterReplacement(allActive, company, newRows) {
  return [...allActive.filter(r => r.company !== company), ...newRows.map(r => ({ ...r, company }))]
}

export const SECTION_LABEL = { revenue: 'Revenue', cogs: 'COGS', opex: 'Operating Expenses', other: 'Other' }

// Categories an unmapped QuickBooks account may be approved into: same dashboard section,
// never a Pending Review line, and revenue only for the same company.
export function allowedCategories(categories, qbSection, company) {
  const section = QB_SECTION_TO_DASHBOARD[qbSection]
  return Object.entries(categories)
    .filter(([slug, c]) => c.section === section && !slug.startsWith('pending_')
      && (section !== 'revenue' || slug === `${company}_net_revenue`))
    .map(([slug, c]) => ({ slug, label: c.display_name }))
}
