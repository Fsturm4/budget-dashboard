import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatDollars, toCents } from '../lib/money.js'
import { DASHBOARD_YEAR, MONTH_LABELS, ACTUALS_STATUS } from '../lib/config.js'

// Turf Pro checks to GreenAce, each recorded once by record_intercompany_transfer, which writes
// the matching Turf Pro Subcontract Labor and GreenAce Net Revenue eliminations for combined views.

const EMPTY_FORM = {
  month: '', checkNumber: '', checkDate: '', amount: '',
  depositDate: '', depositReference: '', depositAmount: '', note: '',
}

const STATUS_LABELS = {
  active:                 'Active',
  awaiting_period_review: 'Awaiting period review',
  voided:                 'Voided',
}

function dollarsToCents(input) {
  const n = parseFloat(input.trim().replace(/^\$/, '').replace(/,/g, ''))
  return isNaN(n) ? null : toCents(n)
}

export default function Intercompany() {
  const [months,     setMonths]     = useState([])
  const [transfers,  setTransfers]  = useState([])
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [voidId,     setVoidId]     = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState(null)

  function load() {
    Promise.all([
      supabase.from('actuals').select('company, category_slug, month, amount_cents')
        .eq('year', DASHBOARD_YEAR).eq('status', ACTUALS_STATUS.ACTIVE),
      supabase.from('intercompany_transfers').select('*').eq('year', DASHBOARD_YEAR).order('check_date').order('id'),
      supabase.from('intercompany_reviewed_months').select('month').eq('year', DASHBOARD_YEAR),
    ]).then(([actualsRes, transfersRes, reviewedRes]) => {
      if (actualsRes.error || transfersRes.error || reviewedRes.error) return
      const reviewed = new Set(reviewedRes.data.map(r => r.month))
      const byMonth = new Map()
      for (const a of actualsRes.data) {
        const m = byMonth.get(a.month) ?? { month: a.month, subcontract: 0, revenue: 0, recorded: 0 }
        if (a.company === 'turf_pro' && a.category_slug === 'subcontract_labor')    m.subcontract += a.amount_cents
        if (a.company === 'greenace' && a.category_slug === 'greenace_net_revenue') m.revenue     += a.amount_cents
        byMonth.set(a.month, m)
      }
      for (const t of transfersRes.data) {
        if (t.status !== 'voided' && byMonth.has(t.month)) byMonth.get(t.month).recorded += t.amount_cents
      }
      setMonths([...byMonth.values()].sort((a, b) => a.month - b.month).map(m => ({
        ...m,
        status: m.recorded > 0 ? 'Transfers recorded' : reviewed.has(m.month) ? 'None this month' : 'Not reviewed',
      })))
      setTransfers(transfersRes.data)
    })
  }
  useEffect(load, [])

  async function run(rpc, args) {
    setSaving(true)
    setSaveError(null)
    const { error } = await supabase.rpc(rpc, args)
    setSaving(false)
    if (error) {
      setSaveError(`${error.message}. Nothing was changed.`)
      return false
    }
    load()
    return true
  }

  async function handleRecord() {
    const ok = await run('record_intercompany_transfer', {
      p_year:                 DASHBOARD_YEAR,
      p_month:                parseInt(form.month),
      p_check_number:         form.checkNumber,
      p_check_date:           form.checkDate,
      p_amount_cents:         dollarsToCents(form.amount),
      p_deposit_date:         form.depositDate,
      p_deposit_reference:    form.depositReference,
      p_deposit_amount_cents: dollarsToCents(form.depositAmount),
      p_note:                 form.note,
    })
    if (ok) setForm(EMPTY_FORM)
  }

  async function handleVoid(id) {
    if (await run('void_intercompany_transfer', { p_transfer_id: id, p_reason: voidReason.trim() })) setVoidId(null)
  }

  const field = key => ({ value: form[key], onChange: e => setForm({ ...form, [key]: e.target.value }) })
  const canRecord =
    form.month && form.checkNumber.trim() && form.checkDate && dollarsToCents(form.amount) > 0 &&
    form.depositDate && form.depositReference.trim() && dollarsToCents(form.depositAmount) > 0

  if (months.length === 0) return null

  return (
    <div className="audit-raw audit-intercompany">
      <p className="audit-raw-heading">
        Intercompany transfers — Turf Pro checks to GreenAce, eliminated in combined views only.
        Company views keep the QuickBooks figures.
      </p>

      <table className="audit-raw-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="audit-raw-th-num">Turf Pro Subcontract Labor</th>
            <th className="audit-raw-th-num">Transfers recorded</th>
            <th className="audit-raw-th-num">Outside contractors</th>
            <th className="audit-raw-th-num">GreenAce Net Revenue</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {months.map(m => (
            <tr key={m.month}>
              <td>{MONTH_LABELS[m.month - 1]}</td>
              <td className="audit-raw-num">{formatDollars(m.subcontract)}</td>
              <td className="audit-raw-num">{formatDollars(m.recorded)}</td>
              <td className="audit-raw-num">{formatDollars(m.subcontract - m.recorded)}</td>
              <td className="audit-raw-num">{formatDollars(m.revenue)}</td>
              <td>
                {m.status}{' '}
                {m.status === 'Not reviewed' && (
                  <button className="audit-expand-btn" disabled={saving}
                    onClick={() => run('mark_intercompany_month_reviewed', { p_year: DASHBOARD_YEAR, p_month: m.month })}>
                    Mark none this month
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {transfers.length > 0 && (
        <table className="audit-raw-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Check</th>
              <th className="audit-raw-th-num">Amount</th>
              <th>GreenAce deposit</th>
              <th>Note</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map(t => (
              <tr key={t.id}>
                <td>{MONTH_LABELS[t.month - 1]}</td>
                <td>{t.check_number}, {t.check_date}</td>
                <td className="audit-raw-num">{formatDollars(t.amount_cents)}</td>
                <td>{t.deposit_date}, {t.deposit_reference}, {formatDollars(t.deposit_amount_cents)} total</td>
                <td>{t.note}</td>
                <td>
                  {STATUS_LABELS[t.status]}
                  {t.status === 'voided' && <> — {t.void_reason}</>}{' '}
                  {t.status === 'awaiting_period_review' && (
                    <button className="audit-expand-btn" disabled={saving}
                      onClick={() => run('confirm_intercompany_period', { p_transfer_id: t.id })}>
                      Confirm {MONTH_LABELS[t.month - 1]}
                    </button>
                  )}
                  {t.status !== 'voided' && voidId !== t.id && (
                    <button className="audit-expand-btn" onClick={() => { setVoidId(t.id); setVoidReason('') }}>Void</button>
                  )}
                  {voidId === t.id && (
                    <>
                      <input type="text" placeholder="Reason (required)" value={voidReason}
                        onChange={e => setVoidReason(e.target.value)} />{' '}
                      <button className="audit-expand-btn" disabled={saving || !voidReason.trim()}
                        onClick={() => handleVoid(t.id)}>Confirm void</button>{' '}
                      <button className="audit-expand-btn" onClick={() => setVoidId(null)}>Cancel</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="audit-raw-heading">Record a Turf Pro check to GreenAce</p>
      <div className="audit-intercompany-form">
        <select {...field('month')}>
          <option value="">Reporting month…</option>
          {months.map(m => <option key={m.month} value={m.month}>{MONTH_LABELS[m.month - 1]} {DASHBOARD_YEAR}</option>)}
        </select>
        <input type="text" placeholder="Check number" {...field('checkNumber')} />
        <label>Check date <input type="date" {...field('checkDate')} /></label>
        <input type="text" placeholder="Amount" {...field('amount')} />
        <label>Deposit date <input type="date" {...field('depositDate')} /></label>
        <input type="text" placeholder="Deposit reference" {...field('depositReference')} />
        <input type="text" placeholder="Deposit total" {...field('depositAmount')} />
        <input type="text" placeholder="Note (optional)" {...field('note')} />
        <button className="audit-expand-btn" disabled={saving || !canRecord} onClick={handleRecord}>
          {saving ? 'Saving…' : 'Record transfer'}
        </button>
      </div>
      {saveError && <p className="audit-raw-status audit-raw-error">{saveError}</p>}
    </div>
  )
}
