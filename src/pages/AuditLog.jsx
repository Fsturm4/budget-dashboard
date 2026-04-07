import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDollars } from '../lib/money.js'
import { COMPANY_LABELS, MONTH_LABELS } from '../lib/config.js'
import { TABLE_ROWS } from '../lib/trackerRows.js'

const CATEGORY_LABELS = Object.fromEntries(
  TABLE_ROWS.filter(r => r.type === 'input').map(r => [r.slug, r.label])
)

// ── display helpers ───────────────────────────────────────────────────────────

function eventLabel(item) {
  if (item._type === 'correction')               return 'Correction'
  if (item.source === 'qb_initialization')       return 'Initialization'
  if (item.status === 'success')                 return 'Success'
  if (item.status === 'failed_unmapped')         return 'Failed — Unmapped Items'
  if (item.status === 'failed_duplicate')        return 'Failed — Duplicate'
  return item.status
}

function eventBadgeClass(item) {
  if (item._type === 'correction')               return 'audit-badge--correction'
  if (item.source === 'qb_initialization')       return 'audit-badge--init'
  if (item.status === 'success')                 return 'audit-badge--success'
  if (item.status === 'failed_unmapped')         return 'audit-badge--failed'
  if (item.status === 'failed_duplicate')        return 'audit-badge--duplicate'
  return ''
}

function eventCardClass(item) {
  if (item._type === 'correction')               return 'audit-card--correction'
  if (item.source === 'qb_initialization')       return 'audit-card--init'
  if (item.status === 'success')                 return 'audit-card--success'
  if (item.status === 'failed_unmapped')         return 'audit-card--failed'
  if (item.status === 'failed_duplicate')        return 'audit-card--duplicate'
  return ''
}

function isExpandable(item) {
  if (item._type === 'correction')     return false  // all info shown inline
  if (item.status === 'failed_duplicate') return false
  if (item.source === 'qb_initialization') return false
  return true
}

function formatEventDate(isoString) {
  return new Date(isoString).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function AuditLog() {
  const navigate = useNavigate()

  const [events,     setEvents]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [rawCache,   setRawCache]   = useState(new Map())

  useEffect(() => {
    Promise.all([
      supabase.from('uploads').select('*').order('created_at', { ascending: false }),
      supabase
        .from('corrections')
        .select('*, actuals!corrections_original_actual_id_fkey(upload_id, month, company, year, amount_cents)')
        .order('created_at', { ascending: false }),
    ]).then(([uploadsRes, correctionsRes]) => {
      if (uploadsRes.error || correctionsRes.error) {
        setFetchError('Could not load audit log. Check your connection and try refreshing.')
        setLoading(false)
        return
      }

      const uploadItems = (uploadsRes.data ?? []).map(u => ({ ...u, _type: 'upload' }))
      const correctionItems = (correctionsRes.data ?? []).map(c => ({ ...c, _type: 'correction' }))

      // Merge and sort newest first by created_at
      const merged = [...uploadItems, ...correctionItems].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      )
      setEvents(merged)
      setLoading(false)
    })
  }, [])

  async function handleToggleExpand(item) {
    if (!isExpandable(item)) return
    const id = item.id

    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (rawCache.has(id)) return

    setRawCache(prev => new Map(prev).set(id, 'loading'))
    const { data, error } = await supabase
      .from('raw_uploads')
      .select('raw_label, amount_cents')
      .eq('upload_id', id)
      .order('raw_label')
    setRawCache(prev => new Map(prev).set(id, error ? 'error' : (data ?? [])))
  }

  if (loading)    return <div className="page"><p className="audit-status">Loading…</p></div>
  if (fetchError) return <div className="page"><p className="audit-error">{fetchError}</p></div>
  if (events.length === 0) {
    return (
      <div className="page audit-page">
        <h1>Audit Log</h1>
        <p className="audit-empty">No events recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="page audit-page">
      <h1>Audit Log</h1>
      <p className="audit-subtitle">
        {events.length} event{events.length !== 1 ? 's' : ''} — newest first
      </p>

      <div className="audit-list">
        {events.map(item => {
          const isExpanded  = expandedId === item.id
          const expandable  = isExpandable(item)
          const rawItems    = rawCache.get(item.id)

          // ── correction card ──────────────────────────────────────────────
          if (item._type === 'correction') {
            const companyName = COMPANY_LABELS[item.company] ?? item.company
            const monthLabel  = MONTH_LABELS[item.month - 1]
            const catLabel    = CATEGORY_LABELS[item.category_slug] ?? item.category_slug
            return (
              <div key={`correction-${item.id}`} className={`audit-card ${eventCardClass(item)}`}>
                <div className="audit-card-header">
                  <div className="audit-card-left">
                    <span className={`audit-badge ${eventBadgeClass(item)}`}>
                      {eventLabel(item)}
                    </span>
                    <span className="audit-card-title">
                      {companyName} — {monthLabel} {item.year}
                    </span>
                  </div>
                  <span className="audit-card-date">{formatEventDate(item.created_at)}</span>
                </div>
                <div className="audit-correction-detail">
                  <div className="audit-correction-row">
                    <span className="audit-correction-key">Category</span>
                    <span className="audit-correction-val">{catLabel}</span>
                  </div>
                  <div className="audit-correction-row">
                    <span className="audit-correction-key">Original amount</span>
                    <span className="audit-correction-val audit-correction-original">
                      {item.actuals?.amount_cents != null
                        ? formatDollars(item.actuals.amount_cents)
                        : '—'}
                    </span>
                  </div>
                  <div className="audit-correction-row">
                    <span className="audit-correction-key">Corrected amount</span>
                    <span className="audit-correction-val">
                      {formatDollars(item.corrected_amount_cents)}
                    </span>
                  </div>
                  <div className="audit-correction-row">
                    <span className="audit-correction-key">Reason</span>
                    <span className="audit-correction-val">{item.reason}</span>
                  </div>
                </div>
              </div>
            )
          }

          // ── upload card ──────────────────────────────────────────────────
          const companyName = COMPANY_LABELS[item.company] ?? item.company
          const monthLabel  = MONTH_LABELS[item.month - 1]

          return (
            <div key={`upload-${item.id}`} className={`audit-card ${eventCardClass(item)}`}>
              <div className="audit-card-header">
                <div className="audit-card-left">
                  <span className={`audit-badge ${eventBadgeClass(item)}`}>
                    {eventLabel(item)}
                  </span>
                  <span className="audit-card-title">
                    {companyName} — {monthLabel} {item.year}
                  </span>
                </div>
                <span className="audit-card-date">
                  {formatEventDate(item.created_at)}
                </span>
              </div>

              {item.status === 'failed_unmapped' && (
                <div className="audit-unmapped">
                  {item.unmapped_labels?.length > 0 ? (
                    <>
                      <p className="audit-unmapped-heading">
                        These QuickBooks labels had no mapping rule. No actuals were written.
                      </p>
                      <ul className="audit-unmapped-list">
                        {item.unmapped_labels.map(label => (
                          <li key={label}><code>{label}</code></li>
                        ))}
                      </ul>
                      <p className="audit-unmapped-action">
                        Add a mapping rule in Settings → Mappings, then re-upload.
                      </p>
                    </>
                  ) : (
                    <p className="audit-unmapped-heading">
                      Upload failed — unmapped items. Check raw line items below.
                    </p>
                  )}
                </div>
              )}

              {item.status === 'failed_duplicate' && (
                <p className="audit-card-note">
                  Blocked before any file was read — actuals already existed for this month.
                  No data was written.
                </p>
              )}

              {item.source === 'qb_initialization' && (
                <p className="audit-card-note">
                  One-time initialization record. Data was loaded from QuickBooks P&amp;L exports
                  during database setup, not through the dashboard upload workflow.
                </p>
              )}

              <div className="audit-card-footer">
                {expandable && (
                  <button
                    className="audit-expand-btn"
                    onClick={() => handleToggleExpand(item)}
                  >
                    {isExpanded ? '▲ Hide raw line items' : '▼ Show raw line items'}
                  </button>
                )}
                {item.status === 'success' && (
                  <button
                    className="audit-correct-btn"
                    onClick={() =>
                      navigate(
                        `/correction?company=${item.company}&month=${item.month}&year=${item.year}`
                      )
                    }
                  >
                    Correct this month →
                  </button>
                )}
              </div>

              {isExpanded && expandable && (
                <div className="audit-raw">
                  {rawItems === 'loading' && (
                    <p className="audit-raw-status">Loading raw line items…</p>
                  )}
                  {rawItems === 'error' && (
                    <p className="audit-raw-status audit-raw-error">
                      Could not load raw line items.
                    </p>
                  )}
                  {Array.isArray(rawItems) && rawItems.length === 0 && (
                    <p className="audit-raw-status">No raw line items recorded for this event.</p>
                  )}
                  {Array.isArray(rawItems) && rawItems.length > 0 && (
                    <>
                      <p className="audit-raw-heading">
                        Raw QuickBooks line items extracted before mapping
                        {item.status === 'failed_unmapped' ? ' — unmapped labels highlighted' : ''}
                      </p>
                      <table className="audit-raw-table">
                        <thead>
                          <tr>
                            <th>QuickBooks Label</th>
                            <th className="audit-raw-th-num">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rawItems.map((raw, i) => {
                            const isUnmapped =
                              item.status === 'failed_unmapped' &&
                              item.unmapped_labels?.includes(raw.raw_label)
                            return (
                              <tr key={i} className={isUnmapped ? 'audit-raw-row--unmapped' : ''}>
                                <td>
                                  <code>{raw.raw_label}</code>
                                  {isUnmapped && (
                                    <span className="audit-raw-unmapped-tag"> unmapped</span>
                                  )}
                                </td>
                                <td className="audit-raw-num">
                                  {formatDollars(raw.amount_cents)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

