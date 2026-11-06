import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase.js'
import { DASHBOARD_YEAR, MONTH_LABELS, ACTUALS_STATUS } from '../lib/config.js'
import { buildExportWorkbook, exportFileName } from '../lib/trackerExport.js'

const ALL_MONTHS = MONTH_LABELS.map((_, i) => i + 1)

// Loads the same tables the Monthly Tracker reads (actuals, intercompany eliminations, budget),
// plus pending accounts and upload dates for the Data Notes sheet.
async function loadExportData() {
  const [monthResults, budget, pending, uploads] = await Promise.all([
    Promise.all(ALL_MONTHS.map(m => Promise.all([
      supabase.from('actuals').select('category_slug, company, amount_cents')
        .eq('year', DASHBOARD_YEAR).eq('month', m).eq('status', ACTUALS_STATUS.ACTIVE),
      supabase.from('active_intercompany_eliminations').select('category_slug, company, amount_cents')
        .eq('year', DASHBOARD_YEAR).eq('month', m),
    ]))),
    supabase.from('budget').select('*').eq('year', DASHBOARD_YEAR),
    supabase.from('pending_items').select('company, year, month, qb_section, raw_label, amount_cents').eq('status', 'pending'),
    supabase.from('uploads').select('company, month, source, created_at').eq('year', DASHBOARD_YEAR).eq('status', 'success'),
  ])
  const failed = [budget, pending, uploads, ...monthResults.flat()].some(res => res.error)
  if (failed) throw new Error('load failed')
  return {
    monthData: new Map(ALL_MONTHS.map((m, i) => [m, { actuals: monthResults[i][0].data, eliminations: monthResults[i][1].data }])),
    budgetRows: budget.data,
    pendingItems: pending.data,
    uploads: uploads.data,
  }
}

export default function ExportMenu({ month, companyMode, computeRows }) {
  const [open,      setOpen]      = useState(false)
  const [data,      setData]      = useState(null)
  const [error,     setError]     = useState(null)
  const [choice,    setChoice]    = useState('current')
  const [pickMonth, setPickMonth] = useState(1)
  const [rangeFrom, setRangeFrom] = useState(1)
  const [rangeTo,   setRangeTo]   = useState(1)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function closeOnOutsideClick(e) {
      if (!rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [open])

  function toggleMenu() {
    if (open) { setOpen(false); return }
    setOpen(true)
    setError(null)
    loadExportData()
      .then(loaded => {
        const available = ALL_MONTHS.filter(m => loaded.monthData.get(m).actuals.length > 0)
        if (available.length > 0) {
          setPickMonth(available[available.length - 1])
          setRangeFrom(available[0])
          setRangeTo(available[available.length - 1])
        }
        setData(loaded)
      })
      .catch(() => setError('Could not load data for export. Check your connection and try again.'))
  }

  const available = data ? ALL_MONTHS.filter(m => data.monthData.get(m).actuals.length > 0) : []

  const monthsByChoice = {
    current: [parseInt(month)],
    select:  [pickMonth],
    range:   ALL_MONTHS.filter(m => m >= Math.min(rangeFrom, rangeTo) && m <= Math.max(rangeFrom, rangeTo)),
    all:     available,
  }
  const months = monthsByChoice[choice]
  const canDownload = data !== null && months.some(m => available.includes(m))

  function download() {
    const workbook = buildExportWorkbook({
      months, companyMode, computeRows, exportedAt: new Date(),
      monthData: data.monthData, budgetRows: data.budgetRows, pendingItems: data.pendingItems, uploads: data.uploads,
    })
    XLSX.writeFile(workbook, exportFileName(months, companyMode))
    setOpen(false)
  }

  const monthOptions = list => list.map(m => <option key={m} value={m}>{MONTH_LABELS[m - 1]} {DASHBOARD_YEAR}</option>)
  const radio = (value, label) => (
    <label className="export-option">
      <input type="radio" name="export-choice" checked={choice === value} onChange={() => setChoice(value)} />
      {label}
    </label>
  )

  return (
    <div className="export-menu" ref={rootRef}>
      <button className="export-btn" onClick={toggleMenu}>Export to Excel ▾</button>

      {open && (
        <div className="export-panel">
          {error && <p className="export-note">{error}</p>}
          {!error && !data && <p className="export-note">Loading…</p>}
          {data && (
            <>
              {radio('current', `Current month (${MONTH_LABELS[parseInt(month) - 1]})`)}
              {radio('select', 'Select month')}
              {choice === 'select' && (
                <select className="export-select" value={pickMonth} onChange={e => setPickMonth(parseInt(e.target.value))}>
                  {monthOptions(available)}
                </select>
              )}
              {radio('range', 'Date range')}
              {choice === 'range' && (
                <div className="export-range">
                  <select className="export-select" value={rangeFrom} onChange={e => setRangeFrom(parseInt(e.target.value))}>
                    {monthOptions(available)}
                  </select>
                  <span>to</span>
                  <select className="export-select" value={rangeTo} onChange={e => setRangeTo(parseInt(e.target.value))}>
                    {monthOptions(available)}
                  </select>
                </div>
              )}
              {radio('all', `All available months (${available.length})`)}
              <p className="export-note">
                View: {companyMode === 'combined' ? 'Combined' : companyMode === 'turf_pro' ? 'Turf Pro' : 'GreenAce'}
                {' '}(follows the toggle above)
              </p>
              {!canDownload && <p className="export-note">No actuals for the selected period.</p>}
              <button className="export-download-btn" disabled={!canDownload} onClick={download}>Download .xlsx</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
