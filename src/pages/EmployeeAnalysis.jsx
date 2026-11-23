import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatDollars, toCents } from '../lib/money.js'
import { DASHBOARD_YEAR, ACTUALS_STATUS } from '../lib/config.js'
import { buildDashboard } from '../lib/dashboard.js'
import { projectHire } from '../lib/hireModel.js'

const HIRE_YEAR   = DASHBOARD_YEAR + 1
const STORAGE_KEY = 'employee-analysis-assumptions'

const OPTIONS = [
  { label: 'No employee',        hours: 0 },
  { label: 'Part-time seasonal', hours: 900 },
  { label: 'Full-time seasonal', hours: 1440 },
]

const DEFAULT_ASSUMPTIONS = {
  hourlyRate:     '32',
  burdenPct:      '20',
  ownerSalary:    '80000',
  sep:            '20000',
  distributions:  '20000',
  motherPayments: '17280',
  loanPrincipal:  '0',
  startingCash:   '',
  lineOfCredit:   '',
}

const ASSUMPTION_FIELDS = [
  { key: 'burdenPct',      label: 'Employer payroll burden (%)',   note: 'Estimate' },
  { key: 'ownerSalary',    label: 'Owner salary ($)' },
  { key: 'sep',            label: 'Owner SEP IRA ($)' },
  { key: 'distributions',  label: 'Personal distributions ($)',    note: 'Cash only' },
  { key: 'motherPayments', label: 'Payments to mother ($)',        note: 'Cash only — treatment pending CPA' },
  { key: 'loanPrincipal',  label: 'Other loan principal ($)',      note: 'Cash only — manual entry' },
  { key: 'startingCash',   label: `Cash on January 1, ${HIRE_YEAR} ($)`,           note: 'Manual entry — not from QuickBooks' },
  { key: 'lineOfCredit',   label: `Line of credit owed January 1, ${HIRE_YEAR} ($)`, note: 'Manual entry — not from QuickBooks' },
]

function yearEndVerdict(scenario, balancesEntered) {
  if (!balancesEntered) return { text: 'Enter cash and line of credit', color: 'neutral' }
  if (scenario.debtCarried > 0) {
    return { text: `Carries ${formatDollars(scenario.debtCarried)} of debt into ${HIRE_YEAR + 1}`, color: 'red' }
  }
  return { text: `No debt carried into ${HIRE_YEAR + 1}`, color: 'green' }
}

export default function EmployeeAnalysis() {
  const [dashboard,  setDashboard]  = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [inputs,     setInputs]     = useState(() => ({
    ...DEFAULT_ASSUMPTIONS,
    ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
  }))

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs)) }, [inputs])

  // Same four queries and the same calculation as the Overview's Full-Year Outlook.
  useEffect(() => {
    Promise.all([
      supabase.from('actuals').select('category_slug, month, amount_cents')
        .eq('year', DASHBOARD_YEAR).eq('status', ACTUALS_STATUS.ACTIVE),
      supabase.from('active_intercompany_eliminations').select('category_slug, month, amount_cents')
        .eq('year', DASHBOARD_YEAR),
      supabase.from('budget').select('*').eq('year', DASHBOARD_YEAR),
      supabase.from('categories').select('slug, section'),
    ]).then(([ar, er, br, cr]) => {
      if (ar.error || er.error || br.error || cr.error) {
        setFetchError('Could not load dashboard data. Check your connection and try refreshing.')
        return
      }
      setDashboard(buildDashboard([...ar.data, ...er.data], br.data, cr.data))
    })
  }, [])

  if (fetchError) return <div className="page"><p className="overview-error">{fetchError}</p></div>
  if (!dashboard) return <div className="page"><p className="overview-status">Loading…</p></div>

  const setInput = (key, value) => setInputs(current => ({ ...current, [key]: value }))

  const outlook = {
    netIncome:    dashboard.kpi.ni.ol,
    ownerWages:   dashboard.fullYearOutlook('owner_wages'),
    sep:          dashboard.fullYearOutlook('sep_ira_expense'),
    depreciation: dashboard.fullYearOutlook('depreciation'),
  }

  const balancesEntered = inputs.startingCash !== '' && inputs.lineOfCredit !== ''
  const assumptions = {
    hourlyRateCents:     toCents(inputs.hourlyRate),
    burdenPct:           Number(inputs.burdenPct),
    ownerSalaryCents:    toCents(inputs.ownerSalary),
    sepCents:            toCents(inputs.sep),
    distributionsCents:  toCents(inputs.distributions),
    motherPaymentsCents: toCents(inputs.motherPayments),
    loanPrincipalCents:  toCents(inputs.loanPrincipal),
    startingCashCents:   toCents(inputs.startingCash),
    lineOfCreditCents:   toCents(inputs.lineOfCredit),
  }

  const scenarios = OPTIONS.map(option => ({ ...option, ...projectHire(outlook, assumptions, option.hours) }))
  const noEmployee = scenarios[0]

  const negative    = cents => cents < 0 ? 'employee-negative' : undefined
  const balanceCell = (key, cents, isBad) => balancesEntered
    ? <td key={key} className={isBad ? 'employee-negative' : undefined}>{formatDollars(cents)}</td>
    : <td key={key}>—</td>

  const monthCount = dashboard.actualizedMonths.length

  return (
    <div className="page employee-page">
      <h1>Employee Analysis — {HIRE_YEAR} technician hire</h1>
      <p className="overview-context">
        Starts from the {DASHBOARD_YEAR} Full-Year Outlook on the Overview
        ({monthCount} month{monthCount !== 1 ? 's' : ''} of QuickBooks actuals{monthCount < 12 ? ', budget for the rest' : ''})
        and assumes revenue and operations continue at that level in {HIRE_YEAR}. An estimate, not a {HIRE_YEAR} budget.
      </p>

      <section className="overview-section">
        <h2 className="overview-section-title">Starting point</h2>
        <table className="settings-table employee-table">
          <tbody>
            <tr>
              <td>{DASHBOARD_YEAR} Full-Year Outlook net income<small>Same figure as the Overview</small></td>
              <td>{formatDollars(outlook.netIncome)}</td>
            </tr>
            <tr>
              <td>
                Owner salary adjustment
                <small>{formatDollars(outlook.ownerWages)} in the outlook, {formatDollars(assumptions.ownerSalaryCents)} planned</small>
              </td>
              <td>{formatDollars(outlook.ownerWages - assumptions.ownerSalaryCents)}</td>
            </tr>
            <tr>
              <td>
                Owner SEP IRA adjustment
                <small>{formatDollars(outlook.sep)} in the outlook, {formatDollars(assumptions.sepCents)} planned</small>
              </td>
              <td>{formatDollars(outlook.sep - assumptions.sepCents)}</td>
            </tr>
            <tr>
              <td>{HIRE_YEAR} net income before any hire</td>
              <td className={negative(noEmployee.netIncome)}><strong>{formatDollars(noEmployee.netIncome)}</strong></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="overview-section employee-assumptions">
        <h2 className="overview-section-title">Assumptions — editable, not QuickBooks data</h2>
        <label className="employee-wage">
          <span>Technician hourly wage</span>
          <input
            type="range" min="30" max="34" step="0.5"
            value={inputs.hourlyRate}
            onChange={e => setInput('hourlyRate', e.target.value)}
          />
          <strong>${Number(inputs.hourlyRate).toFixed(2)}</strong>
        </label>
        <div className="employee-fields">
          {ASSUMPTION_FIELDS.map(({ key, label, note }) => (
            <label key={key} className="employee-field">
              <span>{label}</span>
              <input
                type="number" min="0"
                value={inputs[key]}
                onChange={e => setInput(key, e.target.value)}
              />
              {note && <small>{note}</small>}
            </label>
          ))}
        </div>
      </section>

      <section className="overview-section">
        <h2 className="overview-section-title">{HIRE_YEAR} comparison</h2>
        <table className="settings-table employee-table">
          <thead>
            <tr>
              <th></th>
              {scenarios.map(s => (
                <th key={s.label}>{s.label}{s.hours > 0 && ` (${s.hours.toLocaleString('en-US')} hours)`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Annual cost of the hire<small>Wages plus estimated employer burden</small></td>
              {scenarios.map(s => <td key={s.label}>{formatDollars(s.technicianCost)}</td>)}
            </tr>
            <tr>
              <td>Projected net income<small>Accounting profit, QuickBooks classifications</small></td>
              {scenarios.map(s => <td key={s.label} className={negative(s.netIncome)}>{formatDollars(s.netIncome)}</td>)}
            </tr>
            <tr>
              <td>Estimated cash generated or used<small>Net income, plus depreciation, less distributions, payments to mother and loan principal</small></td>
              {scenarios.map(s => <td key={s.label} className={negative(s.cashChange)}>{formatDollars(s.cashChange)}</td>)}
            </tr>
            <tr>
              <td>New borrowing needed by year-end<small>Estimate — cash used beyond the starting cash you entered</small></td>
              {scenarios.map(s => balanceCell(s.label, s.newBorrowing, s.newBorrowing > 0))}
            </tr>
            <tr>
              <td>Year-end cash less line of credit<small>Estimate — starting cash, less line of credit owed, plus cash generated or used</small></td>
              {scenarios.map(s => balanceCell(s.label, s.yearEndCashLessDebt, s.yearEndCashLessDebt < 0))}
            </tr>
            <tr>
              <td>Year-end result</td>
              {scenarios.map(s => {
                const { text, color } = yearEndVerdict(s, balancesEntered)
                return <td key={s.label} className={`employee-verdict employee-verdict--${color}`}>{text}</td>
              })}
            </tr>
          </tbody>
        </table>
      </section>

      <section className="overview-section employee-notes">
        <h2 className="overview-section-title">How to read this</h2>
        <ul>
          <li>
            <strong>Seasonal borrowing is not the test; year-end debt is.</strong> Drawing on the line of credit
            during the season and repaying it is not modeled and does not count against a hire. A negative
            year-end figure means the season would end with debt that {HIRE_YEAR + 1} revenue has to repay.
          </li>
          <li>
            <strong>Cash figures are estimates, not bank balances.</strong> They are built from the
            profit-and-loss outlook and the starting cash and line of credit you typed in. No balance sheet
            or bank data is imported.
          </li>
          <li>
            <strong>Net income is not cash.</strong> Distributions, payments to your mother and loan principal
            never reduce net income, but they do leave the bank account.
          </li>
          <li>
            <strong>Cost of the hire</strong> is hours × wage × (1 + burden). The burden is an estimate for
            employer payroll taxes, unemployment and workers' compensation. Not included because not confirmed:
            health or other benefits, paid time off, overtime, a SEP contribution for the employee, equipment,
            vehicle or training.
          </li>
          <li>
            <strong>Owner salary and SEP are counted once.</strong> The amounts already inside the outlook are
            taken out and the planned amounts put in; the Starting point table shows each adjustment.
            No other {HIRE_YEAR} adjustment is made.
          </li>
          <li>
            <strong>Payments to your mother</strong> are treated as cash only, following the current QuickBooks
            classification. Nothing is taken out of Rent &amp; Lease for them. If your CPA decides they are an
            expense, net income falls by that amount and cash is unchanged.
          </li>
          <li>
            <strong>No revenue is credited to the hire.</strong> Less physical load on you, rounds finished on
            schedule, coverage if you are sick or injured, and time for sales and management are real benefits
            but are not given a dollar value here.
          </li>
        </ul>
      </section>
    </div>
  )
}
