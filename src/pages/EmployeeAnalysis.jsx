import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatDollars, toCents } from '../lib/money.js'
import { DASHBOARD_YEAR, ACTUALS_STATUS } from '../lib/config.js'
import { buildDashboard } from '../lib/dashboard.js'
import { projectHire, profitNeeded } from '../lib/hireModel.js'

const HIRE_YEAR   = DASHBOARD_YEAR + 1
const STORAGE_KEY = 'employee-analysis-assumptions-v2'

const OPTIONS = [
  { label: 'No employee',        hours: 0 },
  { label: 'Part-time seasonal', hours: 900,  benefitKey: 'partTimeBenefit' },
  { label: 'Full-time seasonal', hours: 1440, benefitKey: 'fullTimeBenefit' },
]

const DEFAULT_ASSUMPTIONS = {
  hourlyRate:     '32',
  burdenPct:      '20',
  ownerSalary:    '80000',
  sep:            '20000',
  rent:           '20556',
  distributions:  '20000',
  motherPayments: '17298.72',
  loanPrincipal:  '0',
  startingCash:   '',
  lineOfCredit:   '',
  partTimeBenefit: '0',
  fullTimeBenefit: '0',
  desiredNetIncome: '30000',
}

const ASSUMPTION_FIELDS = [
  { key: 'burdenPct',      label: 'Employer payroll burden (%)',   note: 'Estimate' },
  { key: 'distributions',  label: 'Personal distributions ($)',    note: 'Cash only — not in the outlook' },
  { key: 'motherPayments', label: 'Payments to mother ($)',        note: 'Cash only — not in the outlook; treatment pending CPA' },
  { key: 'loanPrincipal',  label: 'Other loan principal ($)',      note: 'Cash only — not in the outlook' },
  { key: 'startingCash',   label: `Cash on January 1, ${HIRE_YEAR} ($)`,           note: 'Manual entry — not from QuickBooks' },
  { key: 'lineOfCredit',   label: `Line of credit owed January 1, ${HIRE_YEAR} ($)`, note: 'Manual entry — not from QuickBooks' },
]

// Expenses already inside the Full-Year Outlook that are replaced by a planned amount.
const SUBSTITUTED_EXPENSES = [
  { key: 'ownerSalary', outlookKey: 'ownerWages', centsKey: 'ownerSalaryCents', label: 'Owner salary' },
  { key: 'sep',         outlookKey: 'sep',        centsKey: 'sepCents',         label: 'Owner SEP IRA' },
  { key: 'rent',        outlookKey: 'rent',       centsKey: 'rentCents',        label: 'Rent & Lease', note: '$1,650 rent + $63 storage a month' },
]

// Planning check only: an employer SEP contribution is generally limited to 25% of the salary it is based on.
const SEP_SHARE_OF_SALARY = 0.25

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
  const setNonnegativeDollars = (key, value) => {
    if (Number.isFinite(Number(value)) && Number(value) >= 0) setInput(key, value)
  }

  const outlook = {
    netIncome:    dashboard.kpi.ni.ol,
    ownerWages:   dashboard.fullYearOutlook('owner_wages'),
    sep:          dashboard.fullYearOutlook('sep_ira_expense'),
    rent:         dashboard.fullYearOutlook('rent_and_lease'),
    depreciation: dashboard.fullYearOutlook('depreciation'),
  }

  const balancesEntered = inputs.startingCash !== '' && inputs.lineOfCredit !== ''
  const assumptions = {
    hourlyRateCents:     toCents(inputs.hourlyRate),
    burdenPct:           Number(inputs.burdenPct),
    ownerSalaryCents:    toCents(inputs.ownerSalary),
    sepCents:            toCents(inputs.sep),
    rentCents:           toCents(inputs.rent),
    distributionsCents:  toCents(inputs.distributions),
    motherPaymentsCents: toCents(inputs.motherPayments),
    loanPrincipalCents:  toCents(inputs.loanPrincipal),
    startingCashCents:   toCents(inputs.startingCash),
    lineOfCreditCents:   toCents(inputs.lineOfCredit),
  }

  const scenarios = OPTIONS.map(option => {
    const hireBenefitCents = toCents(inputs[option.benefitKey] ?? 0)
    return { ...option, hireBenefitCents, ...projectHire(outlook, assumptions, option.hours, hireBenefitCents) }
  })
  const noEmployee = scenarios[0]
  const hires      = scenarios.slice(1)
  const lineOfCreditOwed = assumptions.lineOfCreditCents > 0
  const desiredNetIncomeCents = toCents(inputs.desiredNetIncome)

  const negative    = cents => cents < 0 ? 'employee-negative' : undefined
  const signed      = cents => `${cents > 0 ? '+' : ''}${formatDollars(cents)}`

  const plannedSepLimit = Math.round(assumptions.ownerSalaryCents * SEP_SHARE_OF_SALARY)
  const outlookSepLimit = Math.round(outlook.ownerWages * SEP_SHARE_OF_SALARY)
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
        <table className="settings-table employee-table employee-start-table">
          <thead>
            <tr>
              <th></th>
              <th>In the {DASHBOARD_YEAR} outlook</th>
              <th>Planned for {HIRE_YEAR} (editable)</th>
              <th>Effect on net income</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{DASHBOARD_YEAR} Full-Year Outlook net income<small>Same figure as the Overview</small></td>
              <td></td>
              <td></td>
              <td>{formatDollars(outlook.netIncome)}</td>
            </tr>
            {SUBSTITUTED_EXPENSES.map(({ key, outlookKey, centsKey, label, note }) => (
              <tr key={key}>
                <td>{label}{note && <small>{note}</small>}</td>
                <td>{formatDollars(outlook[outlookKey])}</td>
                <td>
                  <input
                    type="number" min="0" aria-label={`${label}, planned for ${HIRE_YEAR}`}
                    value={inputs[key]}
                    onChange={e => setInput(key, e.target.value)}
                  />
                </td>
                <td>{signed(outlook[outlookKey] - assumptions[centsKey])}</td>
              </tr>
            ))}
            <tr>
              <td>{HIRE_YEAR} net income before any hire</td>
              <td></td>
              <td></td>
              <td className={negative(noEmployee.netIncome)}><strong>{formatDollars(noEmployee.netIncome)}</strong></td>
            </tr>
          </tbody>
        </table>
        <p className="employee-start-note">
          Planned amounts replace the amounts in the outlook for the {HIRE_YEAR} projection only.
          They are saved in this browser and never change the {DASHBOARD_YEAR} Budget or outlook.
        </p>
        {assumptions.sepCents > plannedSepLimit && (
          <p className="employee-warning">
            Planned SEP of {formatDollars(assumptions.sepCents)} is above 25% of the planned salary
            ({formatDollars(plannedSepLimit)}). The amount is left as you entered it; confirm the limit with your CPA.
          </p>
        )}
        {outlook.sep > outlookSepLimit && (
          <p className="employee-start-note">
            For reference: the {DASHBOARD_YEAR} outlook is a forecast and currently shows {formatDollars(outlook.ownerWages)} of
            owner wages, 25% of which is {formatDollars(outlookSepLimit)}, alongside {formatDollars(outlook.sep)} of SEP.
            This is not a finding about {DASHBOARD_YEAR}; it clears if owner wages for the year finish at or
            above {formatDollars(Math.round(outlook.sep / SEP_SHARE_OF_SALARY))}.
          </p>
        )}
      </section>

      <section className="overview-section employee-assumptions">
        <h2 className="overview-section-title">Other assumptions — editable, not QuickBooks data</h2>
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
        <h2 className="overview-section-title">What the hire could bring in — optional</h2>
        <table className="settings-table employee-table employee-start-table">
          <thead>
            <tr>
              <th></th>
              {hires.map(s => <th key={s.label}>{s.label} ({s.hours.toLocaleString('en-US')} hours)</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Additional annual profit / savings from hiring ($)
                <small>After additional materials and other direct costs, before the employee's wages and payroll burden</small>
              </td>
              {hires.map(s => (
                <td key={s.label}>
                  <input
                    type="number" min="0" step="0.01" aria-label={`Additional annual profit or savings from hiring, ${s.label}`}
                    value={inputs[s.benefitKey]}
                    onChange={e => setNonnegativeDollars(s.benefitKey, e.target.value)}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="employee-start-note">
          Your own estimate of the combined benefit: profit on new work plus savings on work now paid to
          subcontractors. Left at $0, the projection assumes the hire brings in nothing. Do not subtract the
          employee's cost here; it is calculated separately.
        </p>
      </section>

      <section className="overview-section">
        <h2 className="overview-section-title">{HIRE_YEAR} projection</h2>
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
              <td>Starting cash<small>As you entered it — not from QuickBooks</small></td>
              {scenarios.map(s => balanceCell(s.label, assumptions.startingCashCents, false))}
            </tr>
            <tr>
              <td>Annual employee cost<small>Wages plus estimated employer burden</small></td>
              {scenarios.map(s => <td key={s.label}>{formatDollars(s.technicianCost)}</td>)}
            </tr>
            <tr className="employee-key-row">
              <td>Projected net income<small>Accounting profit, including any profit or savings entered above</small></td>
              {scenarios.map(s => <td key={s.label} className={negative(s.netIncome)}>{formatDollars(s.netIncome)}</td>)}
            </tr>
            <tr>
              <td>Cash gained or used during {HIRE_YEAR}<small>Net income, plus depreciation, less distributions, payments to mother and loan principal</small></td>
              {scenarios.map(s => <td key={s.label} className={negative(s.cashChange)}>{signed(s.cashChange)}</td>)}
            </tr>
            <tr className="employee-key-row">
              <td>
                Projected cash remaining at year-end
                <small>
                  {lineOfCreditOwed
                    ? `After repaying the ${formatDollars(assumptions.lineOfCreditCents)} line of credit owed on January 1`
                    : 'Starting cash plus cash gained or used'}
                </small>
              </td>
              {scenarios.map(s => balancesEntered
                ? (
                  <td key={s.label} className={negative(s.yearEndCashLessDebt)}>
                    {formatDollars(s.yearEndCashLessDebt)}
                    {s.debtCarried > 0 && <small>Projected funding shortfall, not a bank balance</small>}
                  </td>
                )
                : <td key={s.label}>—</td>
              )}
            </tr>
          </tbody>
        </table>
        {!balancesEntered && (
          <p className="employee-start-note">Enter starting cash and the line of credit owed to see the cash rows.</p>
        )}
        <details className="employee-details">
          <summary>Borrowing and line of credit details</summary>
          <table className="settings-table employee-table">
            <tbody>
              <tr>
                <td>Line of credit owed January 1, {HIRE_YEAR}</td>
                {scenarios.map(s => balanceCell(s.label, assumptions.lineOfCreditCents, false))}
              </tr>
              <tr>
                <td>New borrowing needed by year-end<small>Estimate — cash used beyond the starting cash you entered</small></td>
                {scenarios.map(s => balanceCell(s.label, s.newBorrowing, s.newBorrowing > 0))}
              </tr>
              <tr>
                <td>Projected funding shortfall at year-end<small>What year-end cash would not cover, including the line of credit</small></td>
                {scenarios.map(s => balanceCell(s.label, s.debtCarried, s.debtCarried > 0))}
              </tr>
            </tbody>
          </table>
        </details>
      </section>

      <section className="overview-section">
        <h2 className="overview-section-title">How much additional profit do I need?</h2>
        <label className="employee-field employee-target">
          <span>Desired annual net income ($)</span>
          <input
            type="number" min="0" step="0.01"
            value={inputs.desiredNetIncome}
            onChange={e => setNonnegativeDollars('desiredNetIncome', e.target.value)}
          />
          <small>Comparison only — does not change the projection</small>
        </label>
        <table className="settings-table employee-table">
          <thead>
            <tr>
              <th></th>
              {scenarios.map(s => <th key={s.label}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Current projected net income<small>Same figure as the {HIRE_YEAR} projection</small></td>
              {scenarios.map(s => <td key={s.label} className={negative(s.netIncome)}>{formatDollars(s.netIncome)}</td>)}
            </tr>
            <tr className="employee-key-row">
              <td>Additional annual profit needed to reach the target</td>
              {scenarios.map(s => <td key={s.label}>{formatDollars(profitNeeded(desiredNetIncomeCents, s.netIncome))}</td>)}
            </tr>
          </tbody>
        </table>
        <p className="employee-start-note">
          Reaching the target may also resolve a projected cash shortfall, provided the additional profit is
          collected during the year.
        </p>
      </section>

      <section className="overview-section">
        <h2 className="overview-section-title">Does the hire pay for itself?</h2>
        <table className="settings-table employee-table">
          <thead>
            <tr>
              <th></th>
              {hires.map(s => <th key={s.label}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Annual employee cost</td>
              {hires.map(s => <td key={s.label}>{formatDollars(s.technicianCost)}</td>)}
            </tr>
            <tr>
              <td>Additional profit / savings you entered</td>
              {hires.map(s => <td key={s.label}>{formatDollars(s.hireBenefitCents)}</td>)}
            </tr>
            <tr className="employee-key-row">
              <td>Result</td>
              {hires.map(s => s.costNotCovered > 0
                ? <td key={s.label} className="employee-negative">{formatDollars(s.costNotCovered)} of the cost not covered</td>
                : <td key={s.label} className="employee-positive">Cost covered — surplus of {formatDollars(s.benefitSurplus)}</td>
              )}
            </tr>
          </tbody>
        </table>
      </section>

      <section className="overview-section employee-notes">
        <h2 className="overview-section-title">How to read this</h2>
        <ul>
          <li>
            <strong>This is a planning estimate, not a guarantee that a hire is affordable.</strong> Year-end
            cash does not show whether payroll can be covered week by week during the season. Drawing on the
            line of credit during the season and repaying it is not modeled.
          </li>
          <li>
            <strong>A negative year-end figure is a projected funding shortfall, not a bank balance.</strong> It
            is the amount that would have to be borrowed, or repaid from {HIRE_YEAR + 1} revenue, under these
            assumptions.
          </li>
          <li>
            <strong>Cash figures are built from what you typed in.</strong> Starting cash and the line of credit
            are manual entries, so they are only as current as the balance you used; a prior year-end balance
            is a reference, not a confirmed January 1, {HIRE_YEAR} balance. No balance sheet or bank data is imported.
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
            <strong>Owner salary, SEP and rent are counted once.</strong> The amounts already inside the outlook
            are taken out and the planned amounts put in; the Starting point table shows each one side by side.
            This changes the {HIRE_YEAR} projection only, not any {DASHBOARD_YEAR} figure. No other
            adjustment is made for {HIRE_YEAR}.
          </li>
          <li>
            <strong>Payments to your mother</strong> are treated as cash only, following the current QuickBooks
            classification. Nothing is taken out of Rent &amp; Lease for them. If your CPA decides they are an
            expense, net income falls by that amount and cash is unchanged.
          </li>
          <li>
            <strong>Profit and savings are credited to the hire only if you enter them.</strong> The amount
            is your own estimate, is added in full to net income and cash, and is assumed to be collected
            within {HIRE_YEAR}. Less physical load on you, rounds finished on schedule,
            coverage if you are sick or injured, and time for sales and management are real benefits but are
            not given a dollar value here.
          </li>
        </ul>
      </section>
    </div>
  )
}
