import * as XLSX from 'xlsx'
import { DASHBOARD_YEAR, MONTH_LABELS, COMPANY_LABELS } from './config.js'
import { TABLE_ROWS, SECTION_SLUGS } from './trackerRows.js'

// Builds the Monthly Tracker Excel workbook. Every figure comes from computeRows (the Tracker's own
// calculation, passed in) or from the same rows the Tracker fetches — nothing is recomputed here.
// A month with no actuals for the selected view is left blank, never written as zero.

const MONEY   = '$#,##0.00;($#,##0.00)'
const PERCENT = '0.0%'

const INPUT_ROWS    = TABLE_ROWS.filter(r => r.type === 'input')
const LABEL_OF      = Object.fromEntries(INPUT_ROWS.map(r => [r.slug, r.label]))
const ORDER_OF      = Object.fromEntries(INPUT_ROWS.map((r, i) => [r.slug, i]))
const SECTION_LABEL = { revenue: 'Revenue', cogs: 'Cost of Goods Sold', opex: 'Operating Expenses', other: 'Other' }
const SECTION_OF    = Object.fromEntries(
  Object.entries(SECTION_SLUGS).flatMap(([section, slugs]) => slugs.map(slug => [slug, SECTION_LABEL[section]]))
)

const VIEW_LABEL = {
  combined: 'Combined (Turf Pro + GreenAce, intercompany eliminated)',
  turf_pro: 'Turf Pro only',
  greenace: 'GreenAce only',
}
const VIEW_SLUG    = { combined: 'combined', turf_pro: 'turf-pro', greenace: 'greenace' }
const SOURCE_LABEL = { quickbooks_upload: 'QuickBooks upload', qb_initialization: 'Initialization', reconciliation: 'QuickBooks reconciliation' }

const money     = cents => ({ t: 'n', v: cents / 100, z: MONEY })
const monthName = m => `${MONTH_LABELS[m - 1]} ${DASHBOARD_YEAR}`
const monthAbbr = m => `${MONTH_LABELS[m - 1].slice(0, 3)} ${DASHBOARD_YEAR}`
const plural    = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function sheetFrom(rows, widths, filterFromRow) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map(wch => ({ wch }))
  if (filterFromRow !== undefined) {
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: filterFromRow, c: 0 }, e: { r: rows.length - 1, c: widths.length - 1 } }) }
  }
  return ws
}

export function exportFileName(months, companyMode) {
  const pad    = m => `${DASHBOARD_YEAR}-${String(m).padStart(2, '0')}`
  const period = months.length === 1 ? pad(months[0]) : `${pad(months[0])}_to_${pad(months[months.length - 1])}`
  return `budget-export_${VIEW_SLUG[companyMode]}_${period}.xlsx`
}

export function buildExportWorkbook({ months, companyMode, monthData, budgetRows, pendingItems, uploads, computeRows, exportedAt }) {
  const companiesWithActuals = new Map(months.map(m => [m, new Set(monthData.get(m).actuals.map(r => r.company))]))
  const hasActuals = m => companyMode === 'combined' ? companiesWithActuals.get(m).size > 0 : companiesWithActuals.get(m).has(companyMode)
  const isPartial  = m => companyMode === 'combined' && companiesWithActuals.get(m).size === 1

  const computed = new Map(months.map(m => {
    const { actuals, eliminations } = monthData.get(m)
    return [m, computeRows(actuals, eliminations, budgetRows, m, companyMode)]
  }))
  const actualMonths  = months.filter(hasActuals)
  const missingMonths = months.filter(m => !hasActuals(m))
  const partialMonths = months.filter(isPartial)

  // ── Sheet 1: Monthly Summary (actuals) ──────────────────────────────────────
  const lines = new Map()
  for (const m of actualMonths) {
    for (const row of computed.get(m)) {
      const line = lines.get(row.idx) ?? { row, values: new Map() }
      if (row.type !== 'section') line.values.set(m, row.actual)
      lines.set(row.idx, line)
    }
  }
  const sortKey = idx => typeof idx === 'string' ? parseInt(idx) - 0.5 : idx
  const summaryLines = [...lines.values()]
    .filter(({ row, values }) => !(row.pending && [...values.values()].every(v => v === 0)))
    .sort((a, b) => sortKey(a.row.idx) - sortKey(b.row.idx))

  const monthHeader = m => hasActuals(m)
    ? monthAbbr(m) + (isPartial(m) ? ` (partial: ${companiesWithActuals.get(m).has('turf_pro') ? 'Turf Pro' : 'GreenAce'} only)` : '')
    : `${monthAbbr(m)} (no actuals)`

  const summaryRows = [
    ['Monthly Summary — ACTUAL results (QuickBooks)'],
    [`View: ${VIEW_LABEL[companyMode]}`],
    ['Blank month = no actuals uploaded for this view (not zero activity). Budget figures are on the Budget vs Actual sheet.'],
    [],
    ['Category', ...months.map(monthHeader), `Total (${plural(actualMonths.length, 'month')} with actuals)`],
    ...summaryLines.map(({ row, values }) => {
      if (row.type === 'section') return [row.label]
      const total = actualMonths.reduce((sum, m) => sum + (values.get(m) ?? 0), 0)
      return [row.label, ...months.map(m => hasActuals(m) ? money(values.get(m) ?? 0) : null), money(total)]
    }),
  ]
  const summary = sheetFrom(summaryRows, [44, ...months.map(() => 22), 26])

  // ── Sheet 2: Detailed Monthly Data ─────────────────────────────────────────
  const inView  = r => companyMode === 'combined' || r.company === companyMode
  const byOrder = (a, b) => ORDER_OF[a.slug] - ORDER_OF[b.slug] || a.company.localeCompare(b.company)
  const detailLine = (m, company, section, label, lineType, basis, cents) =>
    [DASHBOARD_YEAR, m, MONTH_LABELS[m - 1], company, section, label, lineType, basis, money(cents)]

  const detailRows = []
  for (const m of months) {
    const { actuals, eliminations } = monthData.get(m)
    if (hasActuals(m)) {
      actuals
        .filter(r => inView(r) && r.category_slug in ORDER_OF)
        .map(r => ({ slug: r.category_slug, company: r.company, cents: r.amount_cents }))
        .sort(byOrder)
        .forEach(r => detailRows.push(detailLine(m, COMPANY_LABELS[r.company], SECTION_OF[r.slug], LABEL_OF[r.slug],
          r.slug.startsWith('pending_') ? 'Pending review' : 'Category', 'Actual', r.cents)))

      if (companyMode === 'combined') {
        const eliminated = new Map()
        for (const e of eliminations) {
          const key = `${e.company}|${e.category_slug}`
          const prev = eliminated.get(key) ?? { slug: e.category_slug, company: e.company, cents: 0 }
          eliminated.set(key, { ...prev, cents: prev.cents + e.amount_cents })
        }
        ;[...eliminated.values()].filter(e => e.slug in ORDER_OF).sort(byOrder)
          .forEach(e => detailRows.push(detailLine(m, COMPANY_LABELS[e.company], SECTION_OF[e.slug], LABEL_OF[e.slug],
            'Intercompany elimination', 'Actual', e.cents)))
      }
    }
    computed.get(m)
      .filter(row => row.type === 'input' && !row.pending && row.budget !== null)
      .forEach(row => detailRows.push(detailLine(m, companyMode === 'combined' ? 'Combined' : COMPANY_LABELS[companyMode],
        SECTION_OF[row.slug], row.label, 'Category', 'Budget', row.budget)))
  }
  const detailHeader = ['Year', 'Month #', 'Month', 'Company', 'Section', 'Category', 'Line Type', 'Basis (Actual / Budget)', 'Amount']
  const detail = sheetFrom([detailHeader, ...detailRows], [8, 9, 12, 28, 22, 40, 26, 22, 16], 0)

  // ── Sheet 3: Budget vs. Actual ─────────────────────────────────────────────
  const varianceRows = []
  for (const m of actualMonths) {
    let section = ''
    for (const row of computed.get(m)) {
      if (row.type === 'section') { section = row.label; continue }
      if (row.type === 'elimination' || row.budget === null || (row.pending && row.actual === 0)) continue
      const variance = row.actual - row.budget
      varianceRows.push([
        DASHBOARD_YEAR, m, MONTH_LABELS[m - 1], section, row.label, row.type === 'derived' ? 'Subtotal' : 'Category',
        money(row.actual), money(row.budget), money(variance),
        row.budget !== 0 ? { t: 'n', v: variance / Math.abs(row.budget), z: PERCENT } : null,
      ])
    }
  }
  const varianceHeader = ['Year', 'Month #', 'Month', 'Section', 'Category', 'Line Type', 'Actual', 'Budget', 'Variance $ (Actual − Budget)', 'Variance %']
  const variance = sheetFrom([
    [`Budget vs. Actual — ${VIEW_LABEL[companyMode]}`],
    companyMode === 'combined'
      ? ['Budget and variance are shown for every category. Variance % is blank where the budget is $0.']
      : ["Per-company view: budget exists only for that company's net revenue row, so only that row (and no expense, COGS or subtotal rows) is compared."],
    [],
    varianceHeader,
    ...varianceRows,
  ], [8, 9, 12, 22, 40, 12, 16, 16, 28, 12], 3)

  // ── Sheet 4: Data Notes ────────────────────────────────────────────────────
  const latestUpload = new Map()
  for (const u of uploads) {
    const key = `${u.month}|${u.company}`
    if (!latestUpload.has(key) || u.created_at > latestUpload.get(key).created_at) latestUpload.set(key, u)
  }
  const pendingInScope = pendingItems.filter(p =>
    p.year === DASHBOARD_YEAR && months.includes(p.month) && (companyMode === 'combined' || p.company === companyMode))

  const periodText = months.length === 1 ? monthName(months[0]) : `${monthName(months[0])} – ${monthName(months[months.length - 1])}`
  const monthList  = list => list.length ? list.map(monthAbbr).join(', ') : 'None'

  const notes = [
    ['Data Notes'],
    [],
    ['Report',                'Turf Pro / GreenAce Budget Dashboard — Monthly Tracker export'],
    ['Date exported',         exportedAt.toLocaleString('en-US', { timeZoneName: 'short' })],
    ['Company view',          VIEW_LABEL[companyMode]],
    ['Period requested',      periodText],
    ['Months with actuals',   `${monthList(actualMonths)} (${plural(actualMonths.length, 'month')})`],
    ['Months WITHOUT actuals', `${monthList(missingMonths)} — shown blank on the Monthly Summary, not as zero`],
    ['Months with one company only', companyMode === 'combined' ? `${monthList(partialMonths)}${partialMonths.length ? ' — combined figures are incomplete for these months' : ''}` : 'Not applicable to a single-company view'],
    [],
    ['Sources'],
    ['Actuals',               "Dashboard database table 'actuals' (active rows only), loaded from QuickBooks P&L files. Corrections replace the original figure; superseded rows are not exported."],
    ['Budget',                `Dashboard 'budget' table for ${DASHBOARD_YEAR} (original monthly budget by category). Budget revisions are not applied, matching the Monthly Tracker.`],
    ['Intercompany',          companyMode === 'combined'
      ? "Turf Pro → GreenAce transfers are removed as separate 'Intercompany elimination' lines (negative amounts) inside Total Net Revenue and Total COGS, matching the Monthly Tracker. Summing every Actual row on the Detailed Monthly Data sheet, eliminations included, gives the same section totals."
      : 'Company views keep the QuickBooks figures; no intercompany eliminations are applied (same as the Monthly Tracker).'],
    ['Sign convention',       "Revenue, COGS and expenses are positive amounts. 'Other Income / (Expense)' is signed (income +, expense −). Eliminations are negative."],
    ['Totals',                `The Total column adds only the months with actuals in this export. It is a total of the selected months, not a full-year figure${months.length < 12 ? ' (fewer than 12 months are selected)' : ''}. Budget amounts are not summed.`],
    ['Not included',          `Customer-level data, Employee Analysis, and ${DASHBOARD_YEAR - 1} actuals (the ${DASHBOARD_YEAR - 1} Actuals page is a fixed reference table, not stored in the database).`],
    [],
    ['Actuals source by month'],
    ['Month', 'Company', 'Source', 'Uploaded'],
    ...actualMonths.flatMap(m => ['turf_pro', 'greenace']
      .filter(c => companyMode === 'combined' || c === companyMode)
      .map(c => {
        const u = latestUpload.get(`${m}|${c}`)
        return [monthName(m), COMPANY_LABELS[c], u ? (SOURCE_LABEL[u.source] ?? u.source) : 'No upload record', u ? u.created_at.slice(0, 10) : '']
      })),
    [],
    ['Accounts pending review'],
    pendingInScope.length
      ? ['Included in the "Uncategorized – Pending Review" lines and in section totals until reclassified in the dashboard. Amounts are as shown in QuickBooks.']
      : ['None for the selected months and view.'],
    ...(pendingInScope.length ? [['Month', 'Company', 'QuickBooks section', 'QuickBooks account', 'Amount']] : []),
    ...pendingInScope
      .sort((a, b) => a.month - b.month || a.company.localeCompare(b.company))
      .map(p => [monthName(p.month), COMPANY_LABELS[p.company], p.qb_section, p.raw_label, money(p.amount_cents)]),
  ]
  const notesSheet = sheetFrom(notes, [30, 60, 30, 34, 16])

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, summary,    'Monthly Summary')
  XLSX.utils.book_append_sheet(workbook, detail,     'Detailed Monthly Data')
  XLSX.utils.book_append_sheet(workbook, variance,   'Budget vs Actual')
  XLSX.utils.book_append_sheet(workbook, notesSheet, 'Data Notes')
  return workbook
}
