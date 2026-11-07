import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDollars } from '../lib/money.js'
import { COMPANY_LABELS, MONTH_LABELS, ACTUALS_STATUS, DASHBOARD_YEAR } from '../lib/config.js'
import {
  readReport, buildNewFigures, diffMonth, fingerprint, monthAfterReplacement, allowedCategories, SECTION_LABEL,
  pendingReviewRows, heldByDefault,
} from '../lib/reconcile.js'
import { computeRows } from './MonthlyTracker.jsx'

const SUMMARY_ROWS = [
  ['total_rev', 'Total revenue'], ['total_cogs', 'COGS'], ['gross_profit', 'Gross profit'],
  ['total_opex', 'Operating expenses'], ['noi', 'Net operating income'], ['net_income', 'Net income'],
]

const signed = cents => (cents > 0 ? '+' : cents < 0 ? '−' : '') + formatDollars(Math.abs(cents))
const percent = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—')

// Existing vs updated dashboard totals for one view (one company, or combined), from the
// dashboard's own computeRows.
function summarize(allActive, newActive, elims, month, mode) {
  const read = actuals => Object.fromEntries(
    computeRows(actuals, elims, [], month, mode).filter(r => r.type === 'derived').map(r => [r.key, r.actual]))
  const before = read(allActive)
  const after  = read(newActive)
  return { before, after }
}

function SummaryTable({ title, before, after }) {
  return (
    <div className="rc-summary">
      <h4>{title}</h4>
      <table className="rc-table">
        <thead><tr><th></th><th>Existing</th><th>Updated</th><th>Change</th></tr></thead>
        <tbody>
          {SUMMARY_ROWS.map(([key, label]) => {
            const change = after[key] - before[key]
            return (
              <tr key={key} className={key === 'net_income' && change !== 0 ? 'rc-row--alert' : ''}>
                <td>{label}</td><td>{formatDollars(before[key])}</td><td>{formatDollars(after[key])}</td>
                <td className={change === 0 ? 'rc-zero' : ''}>{change === 0 ? '—' : signed(change)}</td>
              </tr>
            )
          })}
          <tr>
            <td>Gross margin</td><td>{percent(before.gross_profit, before.total_rev)}</td>
            <td>{percent(after.gross_profit, after.total_rev)}</td><td></td>
          </tr>
          <tr>
            <td>Net margin</td><td>{percent(before.net_income, before.total_rev)}</td>
            <td>{percent(after.net_income, after.total_rev)}</td><td></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const PENDING_STATUS = {
  unchanged: 'Unchanged — kept in Pending Review, still counted in the totals',
  changed:   'Amount changed — compare with QuickBooks before confirming',
  removed:   'No longer in the QuickBooks report — this pending item will be closed (kept in history)',
  new:       'New in this report — held in Pending Review',
}

function PendingNotice({ view }) {
  const rows = pendingReviewRows(view.data.pending, view.plan.pendingItems)
  if (rows.length === 0) return null
  return (
    <div className="rc-pending">
      <h4>Pending CPA review (not reclassified)</h4>
      <table className="rc-table">
        <thead><tr><th>QuickBooks account</th><th>Held now</th><th>In this report</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className={r.status === 'changed' ? 'rc-row--alert' : ''}>
              <td>{r.label}</td>
              <td>{r.existing === null ? '—' : formatDollars(r.existing)}</td>
              <td>{r.updated === null ? '—' : formatDollars(r.updated)}</td>
              <td>{PENDING_STATUS[r.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MonthPreview({ company, view, onAck }) {
  const { month, diff, summaryCompany, summaryCombined, niChange, flagged, ack } = view
  const label = `${COMPANY_LABELS[company]} — ${MONTH_LABELS[month - 1]} ${DASHBOARD_YEAR}`
  if (view.plan.unresolved.length > 0) {
    return (
      <section className="rc-card">
        <h3>{label}</h3>
        <p className="rc-muted">The preview appears once every account listed above has been decided, so it is never shown with figures missing.</p>
      </section>
    )
  }
  if (diff.length === 0) {
    return (
      <section className="rc-card">
        <h3>{label}</h3>
        <p className="rc-muted">No differences from the stored figures. This month will not be changed.</p>
        <PendingNotice view={view} />
      </section>
    )
  }
  return (
    <section className="rc-card">
      <h3>{label}</h3>
      {niChange !== 0 && (
        <p className="rc-alert">
          Net income changes by {signed(niChange)}. Ordinary reclassifications should not change net income — check the
          differences below before confirming.
        </p>
      )}
      <table className="rc-table">
        <thead>
          <tr><th>Company</th><th>Month</th><th>Category</th><th>Section</th><th>Existing</th><th>Updated (QuickBooks)</th><th>Difference</th></tr>
        </thead>
        <tbody>
          {diff.map(line => (
            <tr key={line.slug}>
              <td>{COMPANY_LABELS[company]}</td><td>{MONTH_LABELS[month - 1]}</td>
              <td>
                {line.label}
                {line.fromCorrection && (
                  <span className="rc-flag">Set by an earlier correction{line.correctionReason ? `: ${line.correctionReason}` : ''}</span>
                )}
              </td>
              <td>{SECTION_LABEL[line.section]}</td>
              <td>{formatDollars(line.existing)}</td><td>{formatDollars(line.updated)}</td>
              <td className={line.difference > 0 ? 'rc-up' : 'rc-down'}>{signed(line.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PendingNotice view={view} />
      <div className="rc-summaries">
        <SummaryTable title={`${COMPANY_LABELS[company]} totals`} {...summaryCompany} />
        <SummaryTable title="Combined totals (after intercompany eliminations)" {...summaryCombined} />
      </div>
      {flagged.length > 0 && (
        <label className="rc-check">
          <input type="checkbox" checked={!!ack.corrections} onChange={e => onAck(month, 'corrections', e.target.checked)} />
          I understand this replaces {flagged.length === 1 ? 'a figure' : 'figures'} set by an earlier correction
          ({flagged.map(l => l.label).join(', ')}). The correction stays in the Audit Log.
        </label>
      )}
      {niChange !== 0 && (
        <label className="rc-check">
          <input type="checkbox" checked={!!ack.netIncome} onChange={e => onAck(month, 'netIncome', e.target.checked)} />
          I reviewed the net income change of {signed(niChange)} and it matches the corrected QuickBooks report.
        </label>
      )}
      <label className="rc-check">
        <input type="checkbox" checked={!!ack.reviewed} onChange={e => onAck(month, 'reviewed', e.target.checked)} />
        I reviewed the differences for {MONTH_LABELS[month - 1]}.
      </label>
    </section>
  )
}

function UnmappedPanel({ company, accounts, categories, approvals, setApprovals }) {
  if (accounts.length === 0) return null
  const set = (rawLabel, value) => setApprovals(prev => ({ ...prev, [rawLabel]: value }))
  return (
    <section className="rc-card rc-card--stop">
      <h3>Accounts that need your decision</h3>
      <p>
        These QuickBooks accounts have no saved mapping for {COMPANY_LABELS[company]}. Nothing can be replaced until each one is
        approved. Choose the dashboard category it belongs in (it becomes a saved mapping), or hold it in Pending Review.
      </p>
      <table className="rc-table">
        <thead><tr><th>QuickBooks account (exact name)</th><th>QuickBooks section</th><th>Months</th><th>Decision</th></tr></thead>
        <tbody>
          {accounts.map(account => {
            const choice = approvals[account.rawLabel]
            return (
              <tr key={account.rawLabel}>
                <td><strong>{account.rawLabel}</strong></td>
                <td>{account.qbSection}</td>
                <td>{account.months.map(m => `${MONTH_LABELS[m.month - 1]} ${formatDollars(m.amountCents)}`).join(', ')}</td>
                <td>
                  <select
                    aria-label={`Decision for ${account.rawLabel}`}
                    value={choice?.action === 'pending' ? '__pending' : (choice?.categorySlug ?? '')}
                    onChange={e => {
                      const value = e.target.value
                      if (!value) set(account.rawLabel, undefined)
                      else if (value === '__pending') set(account.rawLabel, { action: 'pending' })
                      else set(account.rawLabel, { action: 'map', categorySlug: value })
                    }}
                  >
                    <option value="">Choose…</option>
                    {allowedCategories(categories, account.qbSection, company).map(c => (
                      <option key={c.slug} value={c.slug}>Map to {c.label}</option>
                    ))}
                    <option value="__pending">Hold in Pending Review (pending CPA review)</option>
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function History({ categories, refreshKey, onChanged }) {
  const [rows, setRows]       = useState([])
  const [open, setOpen]       = useState(null)
  const [reason, setReason]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    supabase
      .from('actuals_replacements')
      .select('*, actuals_replacement_months(month, actuals_replacement_lines(category_slug, before_cents, after_cents))')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setMessage(`Could not load replacement history: ${error.message}`); return }
        setRows(data)
      })
  }, [refreshKey])

  async function restore(id) {
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.rpc('restore_actuals_replacement', { p_replacement_id: id, p_reason: reason.trim() })
    setBusy(false)
    if (error) { setMessage(`Restore failed: ${error.message}`); return }
    setOpen(null); setReason('')
    onChanged()
  }

  if (rows.length === 0) return message ? <p className="rc-alert">{message}</p> : <p className="rc-muted">No replacements yet.</p>
  return (
    <div>
      {message && <p className="rc-alert">{message}</p>}
      {rows.map(r => {
        const months = r.actuals_replacement_months.map(m => m.month).sort((a, b) => a - b)
        return (
          <details key={r.id} className="rc-card rc-history">
            <summary>
              #{r.id} · {new Date(r.created_at).toLocaleString()} · {COMPANY_LABELS[r.company]} ·
              {' '}{months.map(m => MONTH_LABELS[m - 1].slice(0, 3)).join(', ')} {r.year} ·
              {' '}<span className={r.status === 'restored' ? 'rc-badge rc-badge--restored' : 'rc-badge'}>{r.status === 'restored' ? 'Restored' : 'Applied'}</span>
            </summary>
            <p className="rc-muted">File: {r.file_names} · Reason: {r.reason}</p>
            {r.status === 'restored' && <p className="rc-muted">Restored {new Date(r.restored_at).toLocaleString()}: {r.restore_reason}</p>}
            <table className="rc-table">
              <thead><tr><th>Month</th><th>Category</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {r.actuals_replacement_months.flatMap(m => m.actuals_replacement_lines.map(l => ({ ...l, month: m.month }))).sort((a, b) => a.month - b.month).map(l => (
                  <tr key={`${l.month}-${l.category_slug}`}>
                    <td>{MONTH_LABELS[l.month - 1]}</td><td>{categories[l.category_slug]?.display_name ?? l.category_slug}</td>
                    <td>{formatDollars(l.before_cents ?? 0)}</td><td>{formatDollars(l.after_cents ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.status === 'applied' && (open === r.id ? (
              <div className="rc-restore">
                <input
                  type="text" placeholder="Reason for restoring (required)" value={reason}
                  onChange={e => setReason(e.target.value)}
                />
                <button disabled={busy || !reason.trim()} onClick={() => restore(r.id)}>
                  {busy ? 'Restoring…' : 'Restore the previous figures'}
                </button>
                <button onClick={() => setOpen(null)}>Cancel</button>
              </div>
            ) : (
              <button className="rc-secondary" onClick={() => { setOpen(r.id); setReason(''); setMessage(null) }}>Restore previous version…</button>
            ))}
          </details>
        )
      })}
    </div>
  )
}

export default function Reconcile() {
  const [company, setCompany]       = useState('')
  const [categories, setCategories] = useState({})
  const [mappings, setMappings]     = useState([])
  const [files, setFiles]           = useState([])           // { key, name, report }
  const [monthData, setMonthData]   = useState({})           // month -> { allActive, elims, reasons } | { error }
  const [approvals, setApprovals]   = useState({})
  const [acks, setAcks]             = useState({})           // month -> { reviewed, corrections, netIncome }
  const [reason, setReason]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)
  const [done, setDone]             = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [loadError, setLoadError]   = useState(null)

  useEffect(() => {
    supabase.from('categories').select('slug, display_name, section').then(({ data, error }) => {
      if (error) { setLoadError('Could not load categories. Refresh the page.'); return }
      setCategories(Object.fromEntries(data.map(c => [c.slug, c])))
    })
  }, [])

  useEffect(() => {
    setFiles([]); setMonthData({}); setApprovals({}); setAcks({}); setError(null)
    if (!company) { setMappings([]); return }
    supabase.from('mappings').select('raw_label, category_slug').eq('company', company).then(({ data, error }) => {
      if (error) { setLoadError('Could not load account mappings. Refresh the page.'); return }
      setMappings(data)
    })
  }, [company])

  // Load what is stored for each month that has a readable report.
  const readMonths = [...new Set(files.filter(f => f.report.month).map(f => f.report.month))]
  useEffect(() => {
    for (const month of readMonths.filter(m => !monthData[m])) {
      setMonthData(prev => ({ ...prev, [month]: { loading: true } }))
      Promise.all([
        supabase.from('actuals').select('id, category_slug, company, amount_cents, upload_id')
          .eq('year', DASHBOARD_YEAR).eq('month', month).eq('status', ACTUALS_STATUS.ACTIVE),
        supabase.from('active_intercompany_eliminations').select('category_slug, amount_cents')
          .eq('year', DASHBOARD_YEAR).eq('month', month),
        supabase.from('corrections').select('category_slug, reason, created_at')
          .eq('company', company).eq('year', DASHBOARD_YEAR).eq('month', month).order('created_at', { ascending: true }),
        supabase.from('pending_items').select('raw_label, qb_section, amount_cents')
          .eq('company', company).eq('year', DASHBOARD_YEAR).eq('month', month).eq('status', 'pending'),
      ]).then(([actualsRes, elimsRes, correctionsRes, pendingRes]) => {
        if (actualsRes.error || elimsRes.error || correctionsRes.error || pendingRes.error) {
          setMonthData(prev => ({ ...prev, [month]: { error: 'Could not load the stored figures. Try again.' } }))
          return
        }
        const reasons = Object.fromEntries(correctionsRes.data.map(c => [c.category_slug, c.reason]))
        setMonthData(prev => ({ ...prev, [month]: { allActive: actualsRes.data, elims: elimsRes.data, reasons, pending: pendingRes.data } }))
      })
    }
  }, [readMonths.join(',')])

  async function addFiles(fileList) {
    setDone(null)
    const added = []
    for (const file of fileList) {
      let report
      try { report = readReport(await file.arrayBuffer(), company, DASHBOARD_YEAR) }
      catch { report = { error: 'This file could not be read as an Excel workbook.' } }
      added.push({ key: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, report })
    }
    setFiles(prev => [...prev, ...added.filter(a => !prev.some(p => p.key === a.key))])
  }

  const sectionBySlug = useMemo(() => Object.fromEntries(Object.entries(categories).map(([s, c]) => [s, c.section])), [categories])

  // Accounts already held in Pending Review keep that status unless you choose otherwise.
  const reportsByMonth = Object.fromEntries(files.filter(f => f.report.month && monthData[f.report.month]?.pending).map(f => [f.report.month, f.report.items]))
  const storedPendingByMonth = Object.fromEntries(Object.entries(monthData).filter(([, d]) => d.pending).map(([m, d]) => [m, d.pending]))
  const effectiveApprovals = {
    ...Object.fromEntries(heldByDefault(reportsByMonth, storedPendingByMonth, mappings).map(label => [label, { action: 'pending' }])),
    ...approvals,
  }

  // One entry per month, with every number the preview and the database call need.
  const filesByMonth = {}
  for (const f of files.filter(f => f.report.month)) (filesByMonth[f.report.month] ??= []).push(f)
  const conflicts = Object.entries(filesByMonth).filter(([, list]) => list.length > 1)
  const problemFiles = files.filter(f => f.report.error)

  const views = Object.entries(filesByMonth)
    .filter(([, list]) => list.length === 1)
    .map(([m, [file]]) => ({ month: parseInt(m), file }))
    .sort((a, b) => a.month - b.month)
    .map(({ month, file }) => {
      const data = monthData[month]
      if (!data || data.loading || data.error) return { month, file, data }
      const stored = data.allActive.filter(r => r.company === company)
      if (stored.length === 0)
        return { month, file, data, missing: true }
      const plan = buildNewFigures(file.report.items, mappings, sectionBySlug, effectiveApprovals)
      const diff = diffMonth(stored, plan.rows, categories, data.reasons)
      const newActive = monthAfterReplacement(data.allActive, company, plan.rows)
      const summaryCompany  = summarize(stored, newActive.filter(r => r.company === company), data.elims, month, company)
      const summaryCombined = summarize(data.allActive, newActive, data.elims, month, 'combined')
      return {
        month, file, data, stored, plan, diff, summaryCompany, summaryCombined,
        niChange: summaryCombined.after.net_income - summaryCombined.before.net_income,
        flagged: diff.filter(l => l.fromCorrection),
        ack: acks[month] ?? {},
      }
    })

  const unresolvedByLabel = {}
  for (const v of views.filter(v => v.plan)) {
    for (const item of v.plan.unresolved) {
      const entry = (unresolvedByLabel[item.rawLabel] ??= { rawLabel: item.rawLabel, qbSection: item.qbSection, months: [] })
      entry.months.push({ month: v.month, amountCents: item.amountCents })
    }
  }
  // Keep approved rows visible after they resolve, so a decision can be changed.
  for (const v of views.filter(v => v.plan)) {
    for (const item of v.file.report.items) {
      if (effectiveApprovals[item.rawLabel] && !mappings.some(m => m.raw_label === item.rawLabel)) {
        const entry = (unresolvedByLabel[item.rawLabel] ??= { rawLabel: item.rawLabel, qbSection: item.qbSection, months: [] })
        if (!entry.months.some(m => m.month === v.month)) entry.months.push({ month: v.month, amountCents: item.amountCents })
      }
    }
  }
  const accounts = Object.values(unresolvedByLabel)
  const unresolvedCount = views.reduce((n, v) => n + (v.plan?.unresolved.length ?? 0), 0)
  const changed = views.filter(v => v.diff?.length > 0)

  const loading = views.some(v => v.data?.loading || !v.data)
  const blockers = []
  if (!company) blockers.push('Choose a company.')
  if (files.length === 0) blockers.push('Upload at least one corrected QuickBooks report.')
  if (problemFiles.length > 0) blockers.push('Remove the files that could not be used.')
  if (conflicts.length > 0) blockers.push('Two files cover the same month — remove one.')
  if (views.some(v => v.data?.error || v.missing)) blockers.push('A month has no stored figures to replace (use Upload for new months).')
  if (unresolvedCount > 0) blockers.push('Decide every account listed above.')
  if (!loading && files.length > 0 && problemFiles.length === 0 && conflicts.length === 0 && unresolvedCount === 0 && changed.length === 0 && !views.some(v => v.missing))
    blockers.push('The reports match the stored figures, so there is nothing to replace.')
  for (const v of changed) {
    if (!v.ack.reviewed) blockers.push(`Confirm you reviewed ${MONTH_LABELS[v.month - 1]}.`)
    if (v.flagged.length > 0 && !v.ack.corrections) blockers.push(`Acknowledge the earlier correction in ${MONTH_LABELS[v.month - 1]}.`)
    if (v.niChange !== 0 && !v.ack.netIncome) blockers.push(`Acknowledge the net income change in ${MONTH_LABELS[v.month - 1]}.`)
  }
  if (changed.length > 0 && !reason.trim()) blockers.push('Enter a reason for the replacement.')

  const setAck = (month, key, value) => setAcks(prev => ({ ...prev, [month]: { ...prev[month], [key]: value } }))

  async function confirm() {
    setSubmitting(true)
    setError(null)
    const newMappings = [...new Map(changed.flatMap(v => v.plan.newMappings).map(m => [m.raw_label, m])).values()]
    const months = changed.map(v => ({
      month: v.month,
      qb_net_income_cents: v.file.report.qbNetIncomeCents,
      raw_items: v.file.report.items.map(i => ({ raw_label: i.rawLabel, qb_section: i.qbSection, amount_cents: i.amountCents })),
      pending: v.plan.pendingItems.map(i => ({ raw_label: i.rawLabel, qb_section: i.qbSection, amount_cents: i.amountCents })),
      expected_fingerprint: fingerprint(v.stored),
      expected_after: v.plan.rows,
      acknowledged_corrections: v.flagged.map(l => l.slug),
    }))
    const { error: rpcError } = await supabase.rpc('replace_company_actuals', {
      p_company: company, p_year: DASHBOARD_YEAR,
      p_file_names: changed.map(v => v.file.name).join(', '), p_reason: reason.trim(),
      p_months: months, p_new_mappings: newMappings,
    })
    setSubmitting(false)
    if (rpcError) { setError(`${rpcError.message} Nothing was changed.`); return }
    setDone(`Replaced ${COMPANY_LABELS[company]} for ${changed.map(v => MONTH_LABELS[v.month - 1]).join(', ')} ${DASHBOARD_YEAR}. The previous figures are kept and can be restored below.`)
    setFiles([]); setMonthData({}); setApprovals({}); setAcks({}); setReason('')
    setHistoryKey(k => k + 1)
    supabase.from('mappings').select('raw_label, category_slug').eq('company', company).then(({ data }) => data && setMappings(data))
  }

  return (
    <div className="page rc-page">
      <h1>Reconcile / Replace Actuals</h1>
      <p className="rc-muted">
        Replace one company's stored figures for existing months with a corrected QuickBooks Profit &amp; Loss. Nothing is saved until you
        review the differences and confirm. The other company is never touched, and the previous figures are always kept.
      </p>
      {loadError && <p className="rc-alert">{loadError}</p>}
      {done && <p className="rc-success">{done} <Link to="/audit">See the Audit Log</Link></p>}

      <section className="rc-card">
        <h3>1. Company and reports</h3>
        <label className="rc-field">Company
          <select value={company} onChange={e => setCompany(e.target.value)}>
            <option value="">Select company…</option>
            <option value="turf_pro">{COMPANY_LABELS.turf_pro}</option>
            <option value="greenace">{COMPANY_LABELS.greenace}</option>
          </select>
        </label>
        <label className="rc-field">Corrected QuickBooks P&amp;L (.xlsx), one report per month
          <input
            type="file" accept=".xlsx" multiple disabled={!company}
            onChange={e => { addFiles([...e.target.files]); e.target.value = '' }}
          />
        </label>
        <p className="rc-muted">
          Each report must cover one whole month. A report with several months cannot be split reliably, so it is rejected rather
          than estimated — upload one report per month.
        </p>
        {files.length > 0 && (
          <ul className="rc-files">
            {files.map(f => (
              <li key={f.key}>
                <strong>{f.name}</strong>{' '}
                {f.report.error
                  ? <span className="rc-down">{f.report.error}</span>
                  : <span>{MONTH_LABELS[f.report.month - 1]} {f.report.year}</span>}
                <button className="rc-link" onClick={() => setFiles(prev => prev.filter(p => p.key !== f.key))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {conflicts.map(([m, list]) => (
          <p key={m} className="rc-alert">
            {MONTH_LABELS[m - 1]} was uploaded more than once ({list.map(f => f.name).join(', ')}). Remove one of them.
          </p>
        ))}
      </section>

      <UnmappedPanel company={company} accounts={accounts} categories={categories} approvals={effectiveApprovals} setApprovals={setApprovals} />

      {views.map(v => (
        v.data?.error ? <p key={v.month} className="rc-alert">{MONTH_LABELS[v.month - 1]}: {v.data.error}</p>
        : v.missing ? <p key={v.month} className="rc-alert">{MONTH_LABELS[v.month - 1]}: no stored figures for {COMPANY_LABELS[company]}. Use Upload for a new month.</p>
        : v.plan ? <MonthPreview key={v.month} company={company} view={v} onAck={setAck} />
        : <p key={v.month} className="rc-muted">Loading {MONTH_LABELS[v.month - 1]}…</p>
      ))}

      {changed.length > 0 && (
        <section className="rc-card">
          <h3>2. Confirm</h3>
          <label className="rc-field">Reason (kept in the audit trail)
            <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Six transactions recategorized in QuickBooks" />
          </label>
          {error && <p className="rc-alert">{error}</p>}
          {blockers.length > 0 && <ul className="rc-blockers">{[...new Set(blockers)].map(b => <li key={b}>{b}</li>)}</ul>}
          <button className="rc-primary" disabled={submitting || blockers.length > 0} onClick={confirm}>
            {submitting ? 'Replacing…' : `Replace ${changed.length} month${changed.length > 1 ? 's' : ''} for ${COMPANY_LABELS[company]}`}
          </button>
        </section>
      )}
      {changed.length === 0 && blockers.length > 0 && files.length > 0 && (
        <ul className="rc-blockers">{[...new Set(blockers)].map(b => <li key={b}>{b}</li>)}</ul>
      )}

      <h2>Replacement history</h2>
      <History categories={categories} refreshKey={historyKey} onChanged={() => setHistoryKey(k => k + 1)} />
    </div>
  )
}
