import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase.js'
import { DASHBOARD_YEAR, MONTH_LABELS, COMPANY_LABELS, ACTUALS_STATUS } from '../lib/config.js'
import { TABLE_ROWS } from '../lib/trackerRows.js'

const INPUT_ROWS    = TABLE_ROWS.filter(r => r.type === 'input')
const CAT_LABELS    = Object.fromEntries(INPUT_ROWS.map(r => [r.slug, r.label]))
const MONTH_COLS    = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

// ── CSV download helper ───────────────────────────────────────────────────────

function downloadCsv(filename, rows) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const lines   = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => `"${(row[h] ?? '').toString().replace(/"/g, '""')}"`).join(',')
    ),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

// ── per-section components ────────────────────────────────────────────────────

function ExportSection() {
  const [busy, setBusy] = useState(null)  // which download is in progress

  async function downloadActualsCsv() {
    setBusy('actuals-csv')
    const { data } = await supabase
      .from('actuals')
      .select('category_slug, company, month, amount_cents')
      .eq('year',   DASHBOARD_YEAR)
      .eq('status', ACTUALS_STATUS.ACTIVE)
      .order('month').order('company').order('category_slug')
    if (data) downloadCsv(`actuals_${DASHBOARD_YEAR}.csv`, data.map(r => ({
      Month:         `${MONTH_LABELS[r.month - 1]} ${DASHBOARD_YEAR}`,
      Company:       COMPANY_LABELS[r.company] ?? r.company,
      Category:      CAT_LABELS[r.category_slug] ?? r.category_slug,
      'Amount ($)':  (r.amount_cents / 100).toFixed(2),
    })))
    setBusy(null)
  }

  async function downloadActualsXlsx() {
    setBusy('actuals-xlsx')
    const { data } = await supabase
      .from('actuals')
      .select('category_slug, company, month, amount_cents')
      .eq('year',   DASHBOARD_YEAR)
      .eq('status', ACTUALS_STATUS.ACTIVE)
      .order('month').order('company').order('category_slug')
    if (data) {
      const rows = data.map(r => ({
        Month:         `${MONTH_LABELS[r.month - 1]} ${DASHBOARD_YEAR}`,
        Company:       COMPANY_LABELS[r.company] ?? r.company,
        Category:      CAT_LABELS[r.category_slug] ?? r.category_slug,
        'Amount ($)':  r.amount_cents / 100,
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Actuals')
      XLSX.writeFile(wb, `actuals_${DASHBOARD_YEAR}.xlsx`)
    }
    setBusy(null)
  }

  async function downloadUploadLog() {
    setBusy('uploads')
    const { data } = await supabase.from('uploads').select('*').order('created_at', { ascending: false })
    if (data) downloadCsv('upload_log.csv', data.map(u => ({
      Date:              new Date(u.created_at).toLocaleString('en-US'),
      Company:           COMPANY_LABELS[u.company] ?? u.company,
      Month:             MONTH_LABELS[u.month - 1],
      Year:              u.year,
      Status:            u.status,
      Source:            u.source,
      'Unmapped Labels': (u.unmapped_labels ?? []).join('; '),
    })))
    setBusy(null)
  }

  async function downloadBudget() {
    setBusy('budget')
    const { data } = await supabase.from('budget').select('*').eq('year', DASHBOARD_YEAR)
    if (data) downloadCsv(`budget_${DASHBOARD_YEAR}.csv`, data.map(b => ({
      Category:        CAT_LABELS[b.category_slug] ?? b.category_slug,
      'Annual ($)':    (b.annual_budget_cents / 100).toFixed(2),
      ...Object.fromEntries(
        MONTH_COLS.map((col, i) => [MONTH_LABELS[i].slice(0, 3) + ' ($)', (b[`${col}_cents`] / 100).toFixed(2)])
      ),
    })))
    setBusy(null)
  }

  async function downloadAssumptions() {
    setBusy('assumptions')
    const { data } = await supabase.from('assumptions').select('*').order('assumption_key').order('created_at', { ascending: false })
    if (data) {
      // Latest per key only
      const seen = new Set()
      const latest = data.filter(r => { if (seen.has(r.assumption_key)) return false; seen.add(r.assumption_key); return true })
      downloadCsv('assumptions.csv', latest.map(r => ({
        'Display Name': r.display_name,
        Value:          r.value_text,
        Notes:          r.notes ?? '',
        'As Of':        new Date(r.created_at).toLocaleString('en-US'),
      })))
    }
    setBusy(null)
  }

  const btn = (label, key, onClick) => (
    <button
      key={key}
      className="settings-export-btn"
      disabled={busy === key}
      onClick={onClick}
    >
      {busy === key ? 'Downloading…' : label}
    </button>
  )

  return (
    <div className="settings-section">
      <p className="settings-section-note">
        Export current data as a backup after each monthly close. These files are your
        primary recovery record on the Supabase free tier.
      </p>
      <div className="settings-export-grid">
        <div className="settings-export-group">
          <p className="settings-export-group-label">Actuals {DASHBOARD_YEAR}</p>
          {btn('Download CSV',  'actuals-csv',  downloadActualsCsv)}
          {btn('Download Excel','actuals-xlsx', downloadActualsXlsx)}
        </div>
        <div className="settings-export-group">
          <p className="settings-export-group-label">Upload Log</p>
          {btn('Download CSV', 'uploads', downloadUploadLog)}
        </div>
        <div className="settings-export-group">
          <p className="settings-export-group-label">Budget {DASHBOARD_YEAR}</p>
          {btn('Download CSV', 'budget', downloadBudget)}
        </div>
        <div className="settings-export-group">
          <p className="settings-export-group-label">Assumptions</p>
          {btn('Download CSV', 'assumptions', downloadAssumptions)}
        </div>
      </div>
    </div>
  )
}

function AssumptionsSection() {
  const [allRows,      setAllRows]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [editingKey,   setEditingKey]   = useState(null)
  const [editValue,    setEditValue]    = useState('')
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState(null)

  useEffect(() => { load() }, [])

  function load() {
    setLoading(true)
    supabase
      .from('assumptions')
      .select('*')
      .order('assumption_key')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setAllRows(data ?? []); setLoading(false) })
  }

  // Latest row per assumption_key — the current active value.
  const current = (() => {
    const seen = new Set()
    return (allRows).filter(r => {
      if (seen.has(r.assumption_key)) return false
      seen.add(r.assumption_key)
      return true
    })
  })()

  async function handleSave(row) {
    if (!editValue.trim()) return
    setSaving(true)
    setSaveError(null)
    const { error } = await supabase.from('assumptions').insert({
      assumption_key: row.assumption_key,
      display_name:   row.display_name,
      value_text:     editValue.trim(),
      notes:          row.notes,
    })
    if (error) { setSaveError(error.message); setSaving(false); return }
    setEditingKey(null)
    setSaving(false)
    load()
  }

  if (loading) return <p className="settings-status">Loading…</p>

  return (
    <div className="settings-section">
      <p className="settings-section-note">
        Saving a new value inserts a versioned row — the previous value is preserved.
        History is visible in the assumptions CSV export.
      </p>
      {saveError && <p className="settings-error">{saveError}</p>}
      <table className="settings-table">
        <thead>
          <tr>
            <th>Assumption</th>
            <th>Current Value</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {current.map(row => (
            <tr key={row.assumption_key}>
              <td className="settings-td-name">{row.display_name}</td>
              <td className="settings-td-value">
                {editingKey === row.assumption_key ? (
                  <input
                    className="settings-inline-input"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    autoFocus
                  />
                ) : (
                  row.value_text
                )}
              </td>
              <td className="settings-td-notes">{row.notes ?? ''}</td>
              <td className="settings-td-actions">
                {editingKey === row.assumption_key ? (
                  <>
                    <button
                      className="settings-save-btn"
                      disabled={saving}
                      onClick={() => handleSave(row)}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="settings-cancel-btn"
                      onClick={() => setEditingKey(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="settings-edit-btn"
                    onClick={() => { setEditingKey(row.assumption_key); setEditValue(row.value_text) }}
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MappingsSection() {
  const [mappings,        setMappings]        = useState([])
  const [loading,         setLoading]         = useState(true)
  const [mappingCompany,  setMappingCompany]  = useState('turf_pro')
  const [editingId,       setEditingId]       = useState(null)
  const [editCategory,    setEditCategory]    = useState('')
  const [newRawLabel,     setNewRawLabel]     = useState('')
  const [newCategorySlug, setNewCategorySlug] = useState('')
  const [saving,          setSaving]          = useState(false)
  const [saveError,       setSaveError]       = useState(null)

  useEffect(() => { load() }, [])

  function load() {
    setLoading(true)
    supabase
      .from('mappings')
      .select('*')
      .order('company').order('raw_label')
      .then(({ data }) => { setMappings(data ?? []); setLoading(false) })
  }

  const filtered = mappings.filter(m => m.company === mappingCompany)

  async function handleSaveEdit(mapping) {
    setSaving(true); setSaveError(null)
    const { error } = await supabase
      .from('mappings')
      .upsert(
        { company: mapping.company, raw_label: mapping.raw_label, category_slug: editCategory },
        { onConflict: 'company,raw_label' }
      )
    if (error) { setSaveError(error.message); setSaving(false); return }
    setEditingId(null)
    setSaving(false)
    load()
  }

  async function handleAddMapping() {
    const label = newRawLabel.trim()
    if (!label || !newCategorySlug) return
    setSaving(true); setSaveError(null)
    const { error } = await supabase
      .from('mappings')
      .upsert(
        { company: mappingCompany, raw_label: label, category_slug: newCategorySlug },
        { onConflict: 'company,raw_label' }
      )
    if (error) { setSaveError(error.message); setSaving(false); return }
    setNewRawLabel(''); setNewCategorySlug('')
    setSaving(false)
    load()
  }

  if (loading) return <p className="settings-status">Loading…</p>

  return (
    <div className="settings-section">
      <p className="settings-section-note">
        Mappings translate QuickBooks line item labels to dashboard categories.
        Adding a mapping for an existing label replaces the current mapping.
        New labels that appear in future uploads can be added here before re-uploading.
      </p>
      {saveError && <p className="settings-error">{saveError}</p>}

      <div className="tracker-toggle" style={{ marginBottom: '1rem' }} role="group">
        {[['turf_pro','Turf Pro'],['greenace','GreenAce']].map(([val, label]) => (
          <button
            key={val}
            className={`tracker-toggle-btn ${mappingCompany === val ? 'tracker-toggle-btn--active' : ''}`}
            onClick={() => { setMappingCompany(val); setEditingId(null) }}
          >
            {label}
          </button>
        ))}
      </div>

      <table className="settings-table">
        <thead>
          <tr>
            <th>QuickBooks Label</th>
            <th>Dashboard Category</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(m => (
            <tr key={m.id}>
              <td className="settings-td-name"><code>{m.raw_label}</code></td>
              <td className="settings-td-value">
                {editingId === m.id ? (
                  <select
                    className="settings-inline-select"
                    value={editCategory}
                    onChange={e => setEditCategory(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {INPUT_ROWS.map(r => (
                      <option key={r.slug} value={r.slug}>{r.label}</option>
                    ))}
                  </select>
                ) : (
                  CAT_LABELS[m.category_slug] ?? m.category_slug
                )}
              </td>
              <td className="settings-td-actions">
                {editingId === m.id ? (
                  <>
                    <button className="settings-save-btn" disabled={saving} onClick={() => handleSaveEdit(m)}>
                      {saving ? '…' : 'Save'}
                    </button>
                    <button className="settings-cancel-btn" onClick={() => setEditingId(null)}>Cancel</button>
                  </>
                ) : (
                  <button className="settings-edit-btn" onClick={() => { setEditingId(m.id); setEditCategory(m.category_slug) }}>
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
          {/* Add new mapping row */}
          <tr className="settings-add-row">
            <td>
              <input
                className="settings-inline-input"
                placeholder="Exact QuickBooks label"
                value={newRawLabel}
                onChange={e => setNewRawLabel(e.target.value)}
              />
            </td>
            <td>
              <select
                className="settings-inline-select"
                value={newCategorySlug}
                onChange={e => setNewCategorySlug(e.target.value)}
              >
                <option value="">Select category…</option>
                {INPUT_ROWS.map(r => (
                  <option key={r.slug} value={r.slug}>{r.label}</option>
                ))}
              </select>
            </td>
            <td>
              <button
                className="settings-save-btn"
                disabled={saving || !newRawLabel.trim() || !newCategorySlug}
                onClick={handleAddMapping}
              >
                {saving ? '…' : 'Add'}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'export',      label: 'Export'      },
  { key: 'assumptions', label: 'Assumptions' },
  { key: 'mappings',    label: 'Mappings'    },
]

export default function Settings() {
  const [tab, setTab] = useState('export')

  return (
    <div className="page settings-page">
      <h1>Settings</h1>

      <div className="settings-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`settings-tab ${tab === t.key ? 'settings-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'export'      && <ExportSection />}
      {tab === 'assumptions' && <AssumptionsSection />}
      {tab === 'mappings'    && <MappingsSection />}
    </div>
  )
}
