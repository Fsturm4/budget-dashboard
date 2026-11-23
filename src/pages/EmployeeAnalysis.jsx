import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatDollars, toCents } from '../lib/money.js'
import { DASHBOARD_YEAR, MONTH_LABELS, ACTUALS_STATUS } from '../lib/config.js'
import { buildBaseline, projectScenario } from '../lib/hireModel.js'

const HIRE_YEAR   = DASHBOARD_YEAR + 1
const STORAGE_KEY = 'employee-analysis-assumptions'

const DEFAULT_ASSUMPTIONS = {
  hourlyRate:     '32',
  burdenPct:      '20',
  partTimeHours:  '900',
  fullTimeHours:  '1440',
  ownerSalary:    '80000',
  sep:            '20000',
  distributions:  '20000',
  motherPayments: '17280',
  loanPrincipal:  '0',
  customers:      '520',
  startingCash:   '',
  reserve:        '',
}

const ASSUMPTION_FIELDS = [
  { key: 'burdenPct',      label: 'Employer payroll burden (%)' },
  { key: 'partTimeHours',  label: 'Part-time hours per year' },
  { key: 'fullTimeHours',  label: 'Full-time seasonal hours per year' },
  { key: 'ownerSalary',    label: 'Owner salary ($)' },
  { key: 'sep',            label: 'Owner SEP IRA contribution ($)' },
  { key: 'distributions',  label: 'Owner distributions ($)',       note: 'Cash only' },
  { key: 'motherPayments', label: 'Payments to mother ($)',        note: 'Cash only — treatment pending CPA' },
  { key: 'loanPrincipal',  label: 'Other loan principal ($)',      note: 'Cash only — manual entry' },
  { key: 'customers',      label: 'Current customers',             note: 'Manual entry' },
  { key: 'startingCash',   label: `Cash on January 1, ${HIRE_YEAR} ($)`, note: 'Manual entry — not from QuickBooks' },
  { key: 'reserve',        label: 'Operating reserve to keep ($)',       note: 'Manual entry — not from QuickBooks' },
]

function verdict(scenario, reserveCents, cashEntered) {
  if (!cashEntered)                        return { text: 'Enter starting cash and reserve', color: 'neutral' }
  if (scenario.lowestCash < 0)             return { text: 'Runs out of cash',                color: 'red' }
  if (scenario.lowestCash < reserveCents)  return { text: 'Dips below reserve',              color: 'red' }
  return { text: 'Stays above reserve', color: 'green' }
}

export default function EmployeeAnalysis() {
  const [baseline,   setBaseline]   = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [inputs,     setInputs]     = useState(() => ({
    ...DEFAULT_ASSUMPTIONS,
    ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
  }))

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs)) }, [inputs])

  // Same four queries as the Overview: combined actuals, intercompany eliminations, budget, categories.
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
      setBaseline(buildBaseline([...ar.data, ...er.data], br.data, cr.data))
    })
  }, [])

  if (fetchError) return <div className="page"><p className="overview-error">{fetchError}</p></div>
  if (!baseline)  return <div className="page"><p className="overview-status">Loading…</p></div>

  const setInput = (key, value) => setInputs(current => ({ ...current, [key]: value }))

  const cashEntered  = inputs.startingCash !== '' && inputs.reserve !== ''
  const reserveCents = toCents(inputs.reserve)
  const assumptions  = {
    hourlyRateCents:     toCents(inputs.hourlyRate),
    burdenPct:           Number(inputs.burdenPct),
    ownerSalaryCents:    toCents(inputs.ownerSalary),
    sepCents:            toCents(inputs.sep),
    distributionsCents:  toCents(inputs.distributions),
    motherPaymentsCents: toCents(inputs.motherPayments),
    loanPrincipalCents:  toCents(inputs.loanPrincipal),
    startingCashCents:   toCents(inputs.startingCash),
    customers:           Number(inputs.customers),
  }

  const scenarios = [
    { label: 'No additional employee',        hours: 0 },
    { label: 'Part-time technician',          hours: Number(inputs.partTimeHours) },
    { label: 'Full-time seasonal technician', hours: Number(inputs.fullTimeHours) },
  ].map(option => ({ ...option, ...projectScenario(baseline, assumptions, option.hours) }))

  const cashCell = cents => cashEntered ? formatDollars(cents) : '—'
  const negative = cents => cents < 0 ? 'employee-negative' : undefined

  const actualCount = baseline.actualMonths.length

  return (
    <div className="page employee-page">
      <h1>Employee Analysis — {HIRE_YEAR} technician hire</h1>
      <p className="overview-context">
        {HIRE_YEAR} projection = {DASHBOARD_YEAR} combined QuickBooks figures carried forward
        ({actualCount} month{actualCount !== 1 ? 's' : ''} of actuals{actualCount < 12 ? ', budget for the rest' : ''};
        intercompany transfers eliminated), with owner pay replaced by the assumptions below.
        This is an estimate, not a {HIRE_YEAR} budget.
      </p>

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
              {scenarios.map(s => <th key={s.label}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Annual technician cost<small>Wages plus employer burden</small></td>
              {scenarios.map(s => <td key={s.label}>{formatDollars(s.technicianCost)}</td>)}
            </tr>
            <tr>
              <td>Projected net income<small>Accounting profit, QuickBooks basis</small></td>
              {scenarios.map(s => <td key={s.label} className={negative(s.netIncome)}>{formatDollars(s.netIncome)}</td>)}
            </tr>
            <tr>
              <td>Change in cash during {HIRE_YEAR}<small>Net income, plus depreciation, less distributions, payments to mother and loan principal</small></td>
              {scenarios.map(s => <td key={s.label} className={negative(s.cashChange)}>{formatDollars(s.cashChange)}</td>)}
            </tr>
            <tr>
              <td>Year-end cash balance<small>Depends on manually entered starting cash</small></td>
              {scenarios.map(s => <td key={s.label} className={cashEntered ? negative(s.yearEndCash) : undefined}>{cashCell(s.yearEndCash)}</td>)}
            </tr>
            <tr>
              <td>Lowest cash balance<small>Lowest month-end; depends on starting cash</small></td>
              {scenarios.map(s => (
                <td key={s.label} className={cashEntered ? negative(s.lowestCash) : undefined}>
                  {cashCell(s.lowestCash)}
                  {cashEntered && <small>{MONTH_LABELS[s.lowestCashMonth - 1]}</small>}
                </td>
              ))}
            </tr>
            <tr>
              <td>Cash above operating reserve<small>Lowest cash balance minus the reserve you entered</small></td>
              {scenarios.map(s => (
                <td key={s.label} className={cashEntered ? negative(s.lowestCash - reserveCents) : undefined}>
                  {cashCell(s.lowestCash - reserveCents)}
                </td>
              ))}
            </tr>
            <tr>
              <td>Customer growth required<small>Net new customers whose gross profit covers the technician</small></td>
              {scenarios.map(s => <td key={s.label}>{s.hours === 0 ? '—' : `about ${s.customersNeeded}`}</td>)}
            </tr>
            <tr>
              <td>Cash verdict</td>
              {scenarios.map(s => {
                const { text, color } = verdict(s, reserveCents, cashEntered)
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
            <strong>Net income is not cash.</strong> Distributions, payments to your mother and loan principal never
            reduce net income, but they do leave the bank account. A hire can show positive net income and still
            pull cash below your reserve.
          </li>
          <li>
            <strong>Technician cost</strong> is hours × wage × (1 + burden), paid evenly March through November.
            The burden is an estimate for employer payroll taxes, unemployment and workers' compensation.
            Not included: health or other benefits, paid time off, overtime, a SEP contribution for the employee,
            equipment, vehicle or training costs.
          </li>
          <li>
            <strong>Owner pay is counted once.</strong> Owner wages already in the {DASHBOARD_YEAR} figures are
            removed and replaced by the salary above. The SEP contribution is added as an expense because no SEP
            account appears in the QuickBooks categories. Salary, SEP, distributions, payments to your mother and
            loan principal are spread evenly across twelve months.
          </li>
          <li>
            <strong>Payments to your mother</strong> are treated as cash only, matching how QuickBooks books them
            today. This is pending your CPA; if they become an expense, net income falls by that amount and cash
            is unchanged.
          </li>
          <li>
            <strong>Monthly cash timing</strong> follows the {DASHBOARD_YEAR} month-by-month QuickBooks pattern.
            Starting cash and the operating reserve are your own entries and are not verified against a bank or
            QuickBooks balance.
          </li>
          <li>
            <strong>Customer growth required</strong> uses {DASHBOARD_YEAR} gross profit per current customer.
            It assumes no added marketing cost to win those customers and counts growth beyond replacing normal
            cancellations.
          </li>
          <li>
            <strong>No revenue is credited to the hire.</strong> The reasons to hire — less physical load on you,
            application rounds finished on schedule, coverage if you are sick or injured, time for sales and
            management, a business less dependent on one person — are real but are not given a dollar value here.
          </li>
        </ul>
      </section>
    </div>
  )
}
