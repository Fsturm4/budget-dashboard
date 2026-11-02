import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { extractFileHeader, extractLineItems, applyMappings, pendingActuals } from '../lib/qbParser.js'
import { formatDollars } from '../lib/money.js'
import {
  COMPANIES, COMPANY_LABELS, MONTH_LABELS,
  UPLOAD_STATUS, UPLOAD_SOURCE, ACTUALS_STATUS, DASHBOARD_YEAR,
} from '../lib/config.js'

const STEP = {
  SELECT:     'select',     // selecting month
  CHECKING:   'checking',   // duplicate check in flight
  BLOCKED:    'blocked',    // actuals already exist for this month
  READY:      'ready',      // waiting for both files
  UNMAPPED:   'unmapped',   // mapping failed — failure screen
  PREVIEW:    'preview',    // both files mapped — waiting for confirm
  CONFIRMING: 'confirming', // RPC in flight
}

// A file slot tracks the state of one company's dropped file.
// null = not yet dropped. { valid, rawItems, error } once a file is provided.
function emptySlot() { return null }

export default function Upload() {
  const navigate = useNavigate()
  const tpInputRef = useRef(null)
  const gaInputRef = useRef(null)

  const [month,         setMonth]         = useState('')
  const [step,          setStep]          = useState(STEP.SELECT)
  const [blockReason,   setBlockReason]   = useState(null)

  // Per-company file state
  const [tpSlot, setTpSlot] = useState(emptySlot())
  const [gaSlot, setGaSlot] = useState(emptySlot())

  // Processing results — set when both files map successfully
  const [tpMapped,       setTpMapped]       = useState([])
  const [gaMapped,       setGaMapped]       = useState([])
  const [unmappedIssues, setUnmappedIssues] = useState([]) // [{company, items}]
  const [approvedKeys,   setApprovedKeys]   = useState(new Set()) // `${company}|${rawLabel}` approved for Pending Review
  const [tpPending,      setTpPending]      = useState([])
  const [gaPending,      setGaPending]      = useState([])

  // Shared reference data loaded once on mount
  const [mappings,         setMappings]         = useState([])
  const [categoryNames,    setCategoryNames]    = useState({})
  const [categorySections, setCategorySections] = useState({})
  const [refDataReady,  setRefDataReady]  = useState(false) // gate: both must load before files are accepted
  const [error,         setError]         = useState(null)

  // Load categories and mappings before the page accepts any files.
  // refDataReady stays false until both fetches resolve successfully.
  // Files dropped before this point would run applyMappings against an empty
  // mappings array and produce false unmapped failures for every label.
  useEffect(() => {
    Promise.all([
      supabase.from('categories').select('slug, display_name, section'),
      supabase.from('mappings').select('company, raw_label, category_slug'),
    ]).then(([catRes, mapRes]) => {
      if (catRes.data) {
        setCategoryNames(Object.fromEntries(catRes.data.map(c => [c.slug, c.display_name])))
        setCategorySections(Object.fromEntries(catRes.data.map(c => [c.slug, c.section])))
      }
      if (mapRes.data)
        setMappings(mapRes.data)
      if (!catRes.error && !mapRes.error)
        setRefDataReady(true)
    })
  }, [])

  // Duplicate check runs when month changes.
  // Checks both companies — if either has active actuals, the whole month is blocked.
  useEffect(() => {
    if (!month) {
      setStep(STEP.SELECT)
      return
    }
    setError(null)
    setBlockReason(null)
    setTpSlot(emptySlot())
    setGaSlot(emptySlot())
    setUnmappedIssues([])
    setStep(STEP.CHECKING)

    supabase
      .from('actuals')
      .select('company')
      .in('company', [COMPANIES.TURF_PRO, COMPANIES.GREENACE])
      .eq('year', DASHBOARD_YEAR)
      .eq('month', parseInt(month))
      .eq('status', ACTUALS_STATUS.ACTIVE)
      .then(({ data, error: err }) => {
        if (err) {
          setError('Could not check for existing data. Try again.')
          setStep(STEP.SELECT)
          return
        }
        if (data.length > 0) {
          const names = [...new Set(data.map(r => COMPANY_LABELS[r.company]))].join(' and ')
          setBlockReason(
            `${names} already has actuals for ${MONTH_LABELS[parseInt(month) - 1]} ${DASHBOARD_YEAR}. ` +
            `Use the Audit Log to open the correction workflow.`
          )
          setStep(STEP.BLOCKED)
        } else {
          setStep(STEP.READY)
        }
      })
  }, [month])

  // Validates a dropped file against the expected company and selected month/year.
  // If valid, extracts raw line items and stores them in the slot.
  // Once both slots are valid, triggers mapping immediately.
  // Guard: does nothing if reference data has not finished loading — prevents
  // false unmapped failures from running applyMappings against an empty table.
  async function handleFile(company, file, currentOtherSlot) {
    if (!refDataReady) return
    const isTP = company === COMPANIES.TURF_PRO
    const setSlot = isTP ? setTpSlot : setGaSlot

    if (!file.name.endsWith('.xlsx')) {
      setSlot({ valid: false, rawItems: [], error: 'File must be a .xlsx QuickBooks P&L export.' })
      return
    }

    let buffer
    try {
      buffer = await file.arrayBuffer()
    } catch {
      setSlot({ valid: false, rawItems: [], error: 'Could not read this file.' })
      return
    }

    // Validate file header before any further processing.
    const header = extractFileHeader(buffer)

    if (!header.companySlug) {
      setSlot({ valid: false, rawItems: [], error: 'Could not read the company name from this file. Is this a QuickBooks P&L export?' })
      return
    }
    if (header.companySlug !== company) {
      setSlot({
        valid: false, rawItems: [],
        error: `Wrong company: this file is for ${COMPANY_LABELS[header.companySlug]}.`,
      })
      return
    }
    if (header.month !== parseInt(month) || header.year !== DASHBOARD_YEAR) {
      const fileLabel = header.month
        ? `${MONTH_LABELS[header.month - 1]} ${header.year}`
        : 'an unrecognised period'
      setSlot({
        valid: false, rawItems: [],
        error: `Wrong period: this file covers ${fileLabel}, but you selected ${MONTH_LABELS[parseInt(month) - 1]} ${DASHBOARD_YEAR}.`,
      })
      return
    }

    const { items: rawItems, qbTotals, mismatches } = extractLineItems(buffer)
    if (mismatches.length > 0) {
      setSlot({ valid: false, rawItems: [], error: `Does not reconcile to QuickBooks: ${mismatches.join('; ')}.` })
      return
    }
    const newSlot  = { valid: true, rawItems, qbTotals, error: null }
    setSlot(newSlot)

    // If the other company's slot is already valid, both are ready — run mapping now.
    // Pass raw items directly to avoid stale state closure.
    if (currentOtherSlot?.valid) {
      const tpRaw = isTP ? rawItems          : currentOtherSlot.rawItems
      const gaRaw = isTP ? currentOtherSlot.rawItems : rawItems
      runMapping(tpRaw, gaRaw)
    }
  }

  function runMapping(tpRawItems, gaRawItems) {
    setError(null)

    const tpMappings = mappings.filter(m => m.company === COMPANIES.TURF_PRO)
    const gaMappings = mappings.filter(m => m.company === COMPANIES.GREENACE)

    const tpResult = applyMappings(tpRawItems, tpMappings, categorySections)
    const gaResult = applyMappings(gaRawItems, gaMappings, categorySections)

    setTpMapped(tpResult.mapped)
    setGaMapped(gaResult.mapped)
    setTpPending([])
    setGaPending([])

    const issues = []
    if (tpResult.unmappedItems.length > 0)
      issues.push({ company: COMPANIES.TURF_PRO, items: tpResult.unmappedItems })
    if (gaResult.unmappedItems.length > 0)
      issues.push({ company: COMPANIES.GREENACE, items: gaResult.unmappedItems })

    if (issues.length > 0) {
      // Failure path: write audit records then show the failure screen.
      // writeFailedAuditRecords is sequential (not atomic) — this is intentional
      // and acceptable because no financial data is written on this path.
      // The only risk is a partial audit event (upload record created but
      // raw_uploads write fails), which leaves an incomplete record in the
      // audit log but does not affect any actuals.
      writeFailedAuditRecords(issues, tpRawItems, gaRawItems)
      setApprovedKeys(new Set())
      setUnmappedIssues(issues)
      setStep(STEP.UNMAPPED)
      return
    }

    setStep(STEP.PREVIEW)
  }

  function toggleApproved(key) {
    setApprovedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Called only once every unmapped account has been individually approved.
  function importWithPending() {
    const itemsFor = company => unmappedIssues.find(issue => issue.company === company)?.items ?? []
    setTpPending(itemsFor(COMPANIES.TURF_PRO))
    setGaPending(itemsFor(COMPANIES.GREENACE))
    setStep(STEP.PREVIEW)
  }

  // Writes failed_unmapped upload records and raw line items for companies with
  // unmapped labels. Sequential inserts — not atomic — because no financial data
  // is written here. A partial failure (upload record created, raw_uploads write
  // fails) leaves an incomplete audit event, which is visible and recoverable,
  // but does not produce false financial state. Actuals are never touched.
  async function writeFailedAuditRecords(issues, tpRawItems, gaRawItems) {
    for (const issue of issues) {
      const rawItems = issue.company === COMPANIES.TURF_PRO ? tpRawItems : gaRawItems
      const { data: upload } = await supabase
        .from('uploads')
        .insert({
          company:         issue.company,
          year:            DASHBOARD_YEAR,
          month:           parseInt(month),
          status:          UPLOAD_STATUS.FAILED_UNMAPPED,
          source:          UPLOAD_SOURCE.QB_UPLOAD,
          unmapped_labels: issue.items.map(item => item.rawLabel),
        })
        .select('id')
        .single()

      if (upload) {
        await supabase.from('raw_uploads').insert(
          rawItems.map(item => ({
            upload_id:    upload.id,
            raw_label:    item.rawLabel,
            amount_cents: item.amountCents,
          }))
        )
      }
    }
  }

  const tpRows = [...tpMapped, ...pendingActuals(tpPending)]
  const gaRows = [...gaMapped, ...pendingActuals(gaPending)]

  // Confirm handler: single RPC call writes uploads, raw_uploads, actuals and
  // pending accounts in one database transaction. If the RPC fails, nothing is written.
  async function handleConfirm() {
    setStep(STEP.CONFIRMING)
    setError(null)

    const pendingPayload = items => items.map(i => ({ raw_label: i.rawLabel, qb_section: i.qbSection, amount_cents: i.amountCents }))
    const { error: rpcError } = await supabase.rpc('upload_monthly_actuals', {
      p_year:          DASHBOARD_YEAR,
      p_month:         parseInt(month),
      p_tp_raw_items:  tpSlot.rawItems.map(i => ({ raw_label: i.rawLabel, amount_cents: i.amountCents })),
      p_ga_raw_items:  gaSlot.rawItems.map(i => ({ raw_label: i.rawLabel, amount_cents: i.amountCents })),
      p_tp_actuals:    tpRows.map(r => ({ category_slug: r.categorySlug, amount_cents: r.amountCents })),
      p_ga_actuals:    gaRows.map(r => ({ category_slug: r.categorySlug, amount_cents: r.amountCents })),
      ...(tpPending.length + gaPending.length > 0 && {
        p_tp_pending: pendingPayload(tpPending),
        p_ga_pending: pendingPayload(gaPending),
      }),
    })

    if (rpcError) {
      setError(`Upload failed: ${rpcError.message}. Nothing was written — try again.`)
      setStep(STEP.PREVIEW)
      return
    }

    navigate('/')
  }

  const monthLabel = month ? MONTH_LABELS[parseInt(month) - 1] : ''

  return (
    <div className="page upload-page">
      <h1>Upload QuickBooks P&amp;L</h1>

      {/* ── month selector ────────────────────────────────────────────────── */}
      <div className="upload-selectors">
        <label className="upload-label">
          Month
          <select
            className="upload-select"
            value={month}
            onChange={e => setMonth(e.target.value)}
          >
            <option value="">Select month…</option>
            {MONTH_LABELS.map((label, i) => (
              <option key={i + 1} value={i + 1}>{label} {DASHBOARD_YEAR}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="upload-error">{error}</p>}

      {step === STEP.CHECKING && (
        <p className="upload-status">Checking…</p>
      )}

      {/* ── duplicate blocked ─────────────────────────────────────────────── */}
      {step === STEP.BLOCKED && (
        <div className="upload-blocked">
          <p>{blockReason}</p>
        </div>
      )}

      {/* ── two file drop zones ───────────────────────────────────────────── */}
      {(step === STEP.READY || step === STEP.PREVIEW || step === STEP.UNMAPPED) && (
        <>
          {!refDataReady && (
            <p className="upload-status">Loading reference data…</p>
          )}
          {refDataReady && (
          <div className="upload-zones">
          {[
            { company: COMPANIES.TURF_PRO,  slot: tpSlot, inputRef: tpInputRef, setSlot: setTpSlot, otherSlot: gaSlot },
            { company: COMPANIES.GREENACE,  slot: gaSlot, inputRef: gaInputRef, setSlot: setGaSlot, otherSlot: tpSlot },
          ].map(({ company, slot, inputRef, otherSlot }) => (
            <div key={company} className="upload-zone-wrapper">
              <p className="upload-zone-label">{COMPANY_LABELS[company]}</p>
              <div
                className={`upload-dropzone ${slot?.valid ? 'upload-dropzone--valid' : ''} ${slot?.error ? 'upload-dropzone--error' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file) handleFile(company, file, otherSlot)
                }}
                onClick={() => inputRef.current?.click()}
              >
                {!slot && (
                  <>
                    <p className="upload-dropzone-main">Drop file here</p>
                    <p className="upload-dropzone-sub">or click to browse — .xlsx only</p>
                  </>
                )}
                {slot?.valid && (
                  <p className="upload-dropzone-main upload-dropzone--ok">✓ File accepted</p>
                )}
                {slot?.error && (
                  <p className="upload-dropzone-main upload-dropzone--err">{slot.error}</p>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files[0]
                    if (file) handleFile(company, file, otherSlot)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
          ))}
        </div>
          )}
        </>
      )}

      {/* ── unmapped failure ──────────────────────────────────────────────── */}
      {step === STEP.UNMAPPED && (
        <div className="upload-unmapped">
          <p className="upload-unmapped-headline">
            Upload blocked — {monthLabel} {DASHBOARD_YEAR}
          </p>
          <p>
            The following QuickBooks line items have no mapping rule and could not be
            matched to a dashboard category. No actuals were written.
          </p>
          {unmappedIssues.map(({ company, items }) => (
            <div key={company}>
              <p className="upload-unmapped-company">{COMPANY_LABELS[company]}</p>
              <ul className="upload-unmapped-list">
                {items.map((item, index) => {
                  const key = `${company}|${index}`
                  return (
                    <li key={key}>
                      <label>
                        <input
                          type="checkbox"
                          checked={approvedKeys.has(key)}
                          onChange={() => toggleApproved(key)}
                        />{' '}
                        <code>{item.rawLabel}</code> — {item.qbSection}, {formatDollars(item.amountCents)} —
                        import as Uncategorized / Pending Review
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          <p>
            Go to <strong>Settings → Mappings</strong>, add a rule for each label above,
            then re-upload both files for this month. Or, if an account should stay
            unclassified for now, tick it above to import it as Pending Review. It is
            counted in its own QuickBooks section and can be reclassified later from
            the Audit Log.
          </p>
          <button
            className="upload-confirm-btn"
            disabled={approvedKeys.size !== unmappedIssues.reduce((n, issue) => n + issue.items.length, 0)}
            onClick={importWithPending}
          >
            Continue with these accounts as Pending Review
          </button>
          <p className="upload-unmapped-audit">
            The raw line items from this attempt are recorded in the{' '}
            <a href="/audit">Audit Log</a>.
          </p>
        </div>
      )}

      {/* ── combined preview ─────────────────────────────────────────────── */}
      {step === STEP.PREVIEW && (
        <div className="upload-preview">
          <p className="upload-preview-headline">
            Review before saving — {monthLabel} {DASHBOARD_YEAR}
          </p>
          <p className="upload-preview-sub">
            Both files mapped successfully. Confirm to write all actuals in a single
            transaction. Nothing is saved until you confirm.
          </p>
          {tpPending.length + gaPending.length > 0 && (
            <p className="upload-preview-sub">
              Pending Review:{' '}
              {[...tpPending, ...gaPending].map(item => `${item.rawLabel} (${formatDollars(item.amountCents)})`).join(', ')}.
              These will be listed in the Audit Log until reclassified.
            </p>
          )}

          {[
            { company: COMPANIES.TURF_PRO,  rows: tpRows, qbTotals: tpSlot.qbTotals },
            { company: COMPANIES.GREENACE,  rows: gaRows, qbTotals: gaSlot.qbTotals },
          ].map(({ company, rows, qbTotals }) => (
            <div key={company} className="upload-preview-section">
              <p className="upload-preview-company">{COMPANY_LABELS[company]}</p>
              <table className="upload-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="col-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.categorySlug}>
                      <td>{categoryNames[row.categorySlug] ?? row.categorySlug}</td>
                      <td className="col-right">{formatDollars(row.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="upload-table">
                <thead>
                  <tr>
                    <th>QuickBooks total (reconciled)</th>
                    <th className="col-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {qbTotals.map(total => (
                    <tr key={total.label}>
                      <td>{total.label}</td>
                      <td className="col-right">{formatDollars(total.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <button className="upload-confirm-btn" onClick={handleConfirm}>
            Confirm and save both companies
          </button>
        </div>
      )}

      {step === STEP.CONFIRMING && (
        <p className="upload-status">Saving…</p>
      )}
    </div>
  )
}
