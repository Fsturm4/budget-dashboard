import { useState } from 'react'
import { formatDollars } from '../lib/money.js'
import { TABLE_ROWS, SECTION_SLUGS } from '../lib/trackerRows.js'

// 2025 full-year actuals in whole dollars.
// Source: workbook "2025 Actuals" tab — QuickBooks P&L exports January–December 2025.
// Intercompany transfers eliminated. "Vehicle Expense" slug combines the workbook's
// "Auto & Truck" line (TP: $2,020) and "Vehicle Expense" line (GA: $35).
// "Other Income / (Expense)" is the net of interest income ($2,813) minus the
// other-section penalties adjustment ($880) = $1,933 combined.
// These figures are static historical reference — they cannot be changed by any
// operational workflow and do not require a database query.
const ACTUALS_2025 = {
  turf_pro_net_revenue:        { tp: 221421, ga:      0, combined: 221421 },
  greenace_net_revenue:        { tp:      0, ga: 200478, combined: 200478 },
  supplies_and_materials:      { tp:   5805, ga:  73982, combined:  79787 },
  seed:                        { tp:      0, ga:   6690, combined:   6690 },
  lawn_flags:                  { tp:    283, ga:    219, combined:    502 },
  subcontract_labor:           { tp:  26146, ga:  24125, combined:  50271 },
  owner_wages:                 { tp:      0, ga:  79051, combined:  79051 },
  rent_and_lease:              { tp:  26000, ga:  24731, combined:  50731 },
  advertising_and_marketing:   { tp:   2189, ga:  25839, combined:  28028 },
  car_repairs_and_maintenance: { tp:      0, ga:   6706, combined:   6706 },
  depreciation:                { tp:   3257, ga:   4666, combined:   7923 },
  insurance_health:            { tp:      0, ga:   7849, combined:   7849 },
  owner_payroll_taxes:         { tp:     71, ga:   7479, combined:   7550 },
  office_expense:              { tp:   1431, ga:   3997, combined:   5428 },
  gas_fuel:                    { tp:   1102, ga:   3853, combined:   4955 },
  repairs_and_maintenance:     { tp:   4532, ga:      0, combined:   4532 },
  insurance_auto:              { tp:   2527, ga:   1614, combined:   4141 },
  telephone_and_internet:      { tp:   1631, ga:   1921, combined:   3552 },
  insurance_general_liability: { tp:   1349, ga:   1293, combined:   2642 },
  small_equipment:             { tp:      0, ga:   2505, combined:   2505 },
  meals_and_entertainment:     { tp:    348, ga:   1414, combined:   1762 },
  payroll_fees:                { tp:    110, ga:   1543, combined:   1653 },
  postage:                     { tp:   1449, ga:      0, combined:   1449 },
  supplies:                    { tp:   1327, ga:      0, combined:   1327 },
  office_supplies:             { tp:    764, ga:    403, combined:   1167 },
  tax_state:                   { tp:    456, ga:    456, combined:    912 },
  trash_removal:               { tp:    834, ga:      0, combined:    834 },
  filing_fees:                 { tp:    155, ga:    670, combined:    825 },
  dues_and_subscriptions:      { tp:    595, ga:      0, combined:    595 },
  professional_fees:           { tp:    466, ga:      0, combined:    466 },
  bank_fees:                   { tp:     91, ga:    287, combined:    378 },
  tax_property:                { tp:    351, ga:      0, combined:    351 },
  email:                       { tp:      0, ga:    296, combined:    296 },
  education:                   { tp:      0, ga:    255, combined:    255 },
  interest_paid:               { tp:      0, ga:    507, combined:    507 },
  entertainment:               { tp:      0, ga:    180, combined:    180 },
  licenses_and_permits:        { tp:      0, ga:    154, combined:    154 },
  tax_excise:                  { tp:      0, ga:     96, combined:     96 },
  payroll_taxes_non_owner:     { tp:     71, ga:      0, combined:     71 },
  vehicle_registration:        { tp:      0, ga:     60, combined:     60 },
  vehicle_expense:             { tp:   2020, ga:     35, combined:   2055 },
  penalties_and_fees:          { tp:      0, ga:    880, combined:    880 },
  other_income_expense:        { tp:      0, ga:   1933, combined:   1933 },
}

const COMPANY_OPTIONS = [
  { value: 'combined', label: 'Combined'  },
  { value: 'tp',       label: 'Turf Pro'  },
  { value: 'ga',       label: 'GreenAce'  },
]

function getCents(slug, mode) {
  const row = ACTUALS_2025[slug]
  if (!row) return 0
  return (row[mode] ?? 0) * 100
}

function computeRows(mode) {
  const getSection = (slugs) => slugs.reduce((s, sl) => s + getCents(sl, mode), 0)

  const sa = {}
  for (const [sec, slugs] of Object.entries(SECTION_SLUGS)) {
    sa[sec] = getSection(slugs)
  }

  const gpActual  = sa.revenue - sa.cogs
  const noiActual = gpActual - sa.opex
  const niActual  = noiActual + sa.other

  const derivedMap = {
    total_rev:   sa.revenue,
    total_cogs:  sa.cogs,
    gross_profit: gpActual,
    total_opex:  sa.opex,
    noi:         noiActual,
    net_income:  niActual,
  }

  return TABLE_ROWS.map((row, idx) => {
    if (row.type === 'section') return { ...row, idx }
    if (row.type === 'derived') return { ...row, idx, actual: derivedMap[row.key] }
    return { ...row, idx, actual: getCents(row.slug, mode) }
  })
}

export default function Actuals2025() {
  const [mode, setMode] = useState('combined')
  const rows = computeRows(mode)

  return (
    <div className="page ref-page">
      <h1>2025 Actuals</h1>
      <p className="ref-note">
        Full-year 2025 actuals — annual totals only. Monthly detail is not available
        from the workbook source. Figures are from QuickBooks P&L exports
        January–December 2025 with intercompany transfers eliminated.
      </p>

      <div className="tracker-controls" style={{ marginBottom: '1.25rem' }}>
        <div className="tracker-toggle" role="group" aria-label="Company view">
          {COMPANY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`tracker-toggle-btn ${mode === opt.value ? 'tracker-toggle-btn--active' : ''}`}
              onClick={() => setMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ref-table-wrapper">
        <table className="ref-table">
          <thead>
            <tr>
              <th className="ref-th-name">Category</th>
              <th className="ref-th-num ref-th-annual">2025 Annual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              if (row.type === 'section') {
                return (
                  <tr key={row.idx} className="ref-section-row">
                    <td colSpan="2">{row.label}</td>
                  </tr>
                )
              }
              const isDerived = row.type === 'derived'
              return (
                <tr key={row.idx} className={isDerived ? 'ref-derived-row' : 'ref-input-row'}>
                  <td className={`ref-td-name ${isDerived ? 'ref-td-name--derived' : ''}`}>
                    {row.label}
                  </td>
                  <td className="ref-td-num ref-td-annual">
                    {row.actual === 0 ? '—' : formatDollars(row.actual)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
