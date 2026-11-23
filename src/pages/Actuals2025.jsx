import { useState } from 'react'
import { formatDollars } from '../lib/money.js'
import { TABLE_ROWS, SECTION_SLUGS } from '../lib/trackerRows.js'
import { actual2025Cents } from '../lib/actuals2025.js'

const COMPANY_OPTIONS = [
  { value: 'combined', label: 'Combined'  },
  { value: 'tp',       label: 'Turf Pro'  },
  { value: 'ga',       label: 'GreenAce'  },
]

function computeRows(mode) {
  const getSection = (slugs) => slugs.reduce((s, sl) => s + actual2025Cents(sl, mode), 0)

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
    return { ...row, idx, actual: actual2025Cents(row.slug, mode) }
  })
}

export default function Actuals2025() {
  const [mode, setMode] = useState('combined')
  const rows = computeRows(mode)

  return (
    <div className="page ref-page">
      <h1>2025 Actuals</h1>
      <p className="ref-note">
        Full-year 2025 actuals — annual totals only. Figures are the QuickBooks
        Profit and Loss reports for January–December 2025 as of November 23, 2026.
        The Turf Pro and GreenAce views equal each company's report; the Combined
        view removes the $121,788 of intercompany transfers.
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
