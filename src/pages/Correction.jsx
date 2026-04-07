import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDollars, toCents } from '../lib/money.js'
import { COMPANY_LABELS, MONTH_LABELS, ACTUALS_STATUS, DASHBOARD_YEAR } from '../lib/config.js'
import { TABLE_ROWS } from '../lib/trackerRows.js'

// Input rows in display order — used to build the category selector.
const INPUT_ROWS = TABLE_ROWS.filter(r => r.type === 'input')

// Validates that the corrected amount string is a parseable dollar amount.
// Accepts whole dollars or decimals: "1234", "1234.56", "-200".
function parseDollarInput(raw) {
  const cleaned = raw.trim().replace(/^\$/, '').replace(/,/g, '')
  const n = parseFloat(cleaned)
  if (isNaN(n)) return null
  return toCents(n)
}

export default function Correction() {
  const navigate       = useNavigate()
  const [params]       = useSearchParams()

  // Pre-fill from query params set by the Audit Log "Correct this month" button.
  const paramCompany = params.get('company') ?? ''
  const paramMonth   = params.get('month')   ?? ''
  const paramYear    = params.get('year')    ?? String(DASHBOARD_YEAR)

  const [company,        setCompany]        = useState(paramCompany)
  const [month,          setMonth]          = useState(paramMonth)
  const [categorySlug,   setCategorySlug]   = useState('')
  const [currentActual,  setCurrentActual]  = useState(null) // actuals row or 'none' or 'loading'
  const [correctedInput, setCorrectedInput] = useState('')
  const [reason,         setReason]         = useState('')
  const [step,           setStep]           = useState('form')  // form | preview | submitting
  const [submitError,    setSubmitError]     = useState(null)

  // Load current active actual when company + month + category are all set.
  useEffect(() => {
    if (!company || !month || !categorySlug) {
      setCurrentActual(null)
      return
    }
    setCurrentActual('loading')
    supabase
      .from('actuals')
      .select('id, amount_cents')
      .eq('company',       company)
      .eq('year',          parseInt(paramYear))
      .eq('month',         parseInt(month))
      .eq('category_slug', categorySlug)
      .eq('status',        ACTUALS_STATUS.ACTIVE)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { setCurrentActual(null); return }
        setCurrentActual(data ?? 'none')
      })
  }, [company, month, categorySlug])

  const correctedCents = parseDollarInput(correctedInput)
  const monthLabel     = month   ? MONTH_LABELS[parseInt(month) - 1]  : ''
  const companyLabel   = company ? (COMPANY_LABELS[company] ?? company) : ''
  const categoryLabel  = categorySlug
    ? (INPUT_ROWS.find(r => r.slug === categorySlug)?.label ?? categorySlug)
    : ''

  const canPreview =
    company &&
    month &&
    categorySlug &&
    currentActual &&
    currentActual !== 'loading' &&
    currentActual !== 'none' &&
    correctedCents !== null &&
    reason.trim().length > 0

  async function handleSubmit() {
    if (!canPreview || typeof currentActual !== 'object') return
    setStep('submitting')
    setSubmitError(null)

    // Correction writes in a single transaction via RPC:
    //   1. Set original actuals row status to 'superseded'
    //   2. Insert new actuals row with corrected amount (status='active')
    //   3. Insert corrections record with reason and link to original
    const { error } = await supabase.rpc('apply_correction', {
      p_original_actual_id:     currentActual.id,
      p_category_slug:          categorySlug,
      p_company:                company,
      p_year:                   parseInt(paramYear),
      p_month:                  parseInt(month),
      p_corrected_amount_cents: correctedCents,
      p_reason:                 reason.trim(),
    })

    if (error) {
      setSubmitError(`Correction failed: ${error.message}. Nothing was changed — try again.`)
      setStep('preview')
      return
    }

    navigate('/audit')
  }

  return (
    <div className="page correction-page">
      <button className="correction-back" onClick={() => navigate('/audit')}>
        ← Back to Audit Log
      </button>
      <h1>Correct an Actual</h1>
      <p className="correction-note">
        Corrections do not overwrite existing data. The original actuals row is
        preserved with status "superseded" and a new row is written with the
        corrected amount. Both are visible in the Audit Log.
      </p>

      {submitError && <p className="correction-error">{submitError}</p>}

      {step === 'form' && (
        <div className="correction-form">

          {/* Company */}
          <label className="correction-label">
            Company
            <select
              className="correction-select"
              value={company}
              onChange={e => { setCompany(e.target.value); setCategorySlug(''); setCurrentActual(null) }}
            >
              <option value="">Select company…</option>
              <option value="turf_pro">Turf Pro, Inc.</option>
              <option value="greenace">GreenAce Lawn Care, LLC</option>
            </select>
          </label>

          {/* Month */}
          <label className="correction-label">
            Month
            <select
              className="correction-select"
              value={month}
              onChange={e => { setMonth(e.target.value); setCurrentActual(null) }}
            >
              <option value="">Select month…</option>
              {MONTH_LABELS.map((label, i) => (
                <option key={i + 1} value={i + 1}>{label} {paramYear}</option>
              ))}
            </select>
          </label>

          {/* Category */}
          <label className="correction-label">
            Category
            <select
              className="correction-select"
              value={categorySlug}
              onChange={e => { setCategorySlug(e.target.value); setCurrentActual(null) }}
            >
              <option value="">Select category…</option>
              {INPUT_ROWS.map(row => (
                <option key={row.slug} value={row.slug}>{row.label}</option>
              ))}
            </select>
          </label>

          {/* Current actual lookup result */}
          {currentActual === 'loading' && (
            <p className="correction-lookup">Looking up current actual…</p>
          )}
          {currentActual === 'none' && (
            <p className="correction-lookup correction-lookup--none">
              No active actual found for this company, month, and category.
              There is nothing to correct.
            </p>
          )}
          {currentActual && currentActual !== 'loading' && currentActual !== 'none' && (
            <div className="correction-current">
              <span className="correction-current-label">Current actual</span>
              <span className="correction-current-value">
                {formatDollars(currentActual.amount_cents)}
              </span>
            </div>
          )}

          {/* Corrected amount */}
          <label className="correction-label">
            Corrected amount
            <input
              type="text"
              className="correction-input"
              placeholder="e.g. 1234.56"
              value={correctedInput}
              onChange={e => setCorrectedInput(e.target.value)}
              disabled={!currentActual || currentActual === 'loading' || currentActual === 'none'}
            />
            {correctedInput && correctedCents === null && (
              <span className="correction-input-error">Enter a valid dollar amount</span>
            )}
          </label>

          {/* Reason */}
          <label className="correction-label">
            Reason <span className="correction-required">(required)</span>
            <textarea
              className="correction-textarea"
              placeholder="Describe what was wrong and why this correction is accurate"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
            />
          </label>

          <button
            className="correction-preview-btn"
            disabled={!canPreview}
            onClick={() => setStep('preview')}
          >
            Review correction
          </button>
        </div>
      )}

      {/* Preview */}
      {(step === 'preview' || step === 'submitting') && currentActual && typeof currentActual === 'object' && (
        <div className="correction-preview">
          <p className="correction-preview-heading">Review before confirming</p>

          <table className="correction-preview-table">
            <tbody>
              <tr>
                <th>Company</th>
                <td>{companyLabel}</td>
              </tr>
              <tr>
                <th>Month</th>
                <td>{monthLabel} {paramYear}</td>
              </tr>
              <tr>
                <th>Category</th>
                <td>{categoryLabel}</td>
              </tr>
              <tr>
                <th>Current amount</th>
                <td className="correction-preview-original">
                  {formatDollars(currentActual.amount_cents)}
                </td>
              </tr>
              <tr>
                <th>Corrected amount</th>
                <td className="correction-preview-corrected">
                  {formatDollars(correctedCents)}
                </td>
              </tr>
              <tr>
                <th>Reason</th>
                <td>{reason.trim()}</td>
              </tr>
            </tbody>
          </table>

          <p className="correction-preview-note">
            The original row will be preserved as "superseded." The corrected
            amount will become the active figure. Both are visible in the Audit Log.
            This cannot be undone inline — a further correction would be required.
          </p>

          <div className="correction-preview-actions">
            <button
              className="correction-back-btn"
              disabled={step === 'submitting'}
              onClick={() => setStep('form')}
            >
              ← Edit
            </button>
            <button
              className="correction-confirm-btn"
              disabled={step === 'submitting'}
              onClick={handleSubmit}
            >
              {step === 'submitting' ? 'Saving…' : 'Confirm correction'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
