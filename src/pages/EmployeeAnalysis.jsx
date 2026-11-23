import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatDollars, toCents } from '../lib/money.js'
import { DASHBOARD_YEAR, ACTUALS_STATUS } from '../lib/config.js'
import { buildDashboard } from '../lib/dashboard.js'
import { projectHire } from '../lib/hireModel.js'

const HIRE_YEAR   = DASHBOARD_YEAR + 1
const STORAGE_KEY = 'employee-analysis-assumptions-v2'

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
  rent:           '20556',
  distributions:  '20000',
  motherPayments: '17298.72',
  loanPrincipal:  '0',
  startingCash:   '',
  lineOfCredit:   '',
  partTimeAddedRevenue: '0',
  partTimeSubSavings: '0',
  fullTimeAddedRevenue: '0',
  fullTimeSubSavings: '0',
  addedRevenueMargin: '60',
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

  const scenarioBenefits = [
    {},
    { addedRevenueCents: toCents(inputs.partTimeAddedRevenue), subcontractorSavingsCents: toCents(inputs.partTimeSubSavings), grossMarginPct: Number(inputs.addedRevenueMargin) },
    { addedRevenueCents: toCents(inputs.fullTimeAddedRevenue), subcontractorSavingsCents: toCents(inputs.fullTimeSubSavings), grossMarginPct: Number(inputs.addedRevenueMargin) },
  ]
  const scenarios = OPTIONS.map((option, index) => ({
    ...option, ...projectHire(outlook, assumptions, option.hours, scenarioBenefits[index]),
  }))
  const noEmployee = scenarios[0]

  const negative    = cents => cents < 0 ? 'employee-negative' : undefined
  const signed      = cents => `${cents > 0 ? '+' : ''}${formatDollars(cents)}`

  const plannedSepLimit = Math.round(assumptions.ownerSalaryCents * SEP_SHARE_OF_SALARY)
  const outlookSepLimit = Math.round(outlook.ownerWages * SEP_SHARE_OF_SALARY)
  const balanceCell = (key, cents, isBad, emph = false) => balancesEntered
    ? <td key={key} className={`${isBad ? 'employee-negative' : ''} ${emph ? 'employee-key-value' : ''}`}>{formatDollars(cents)}</td>
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

      <section className="overview-section employee-benefit-section">
        <h2 className="overview-section-title">What could hiring add?</h2>
        <p className="employee-start-note">
          Enter only annual new sales and subcontractor costs avoided because of the hire.
          Zero means no additional benefit. These estimates affect the hiring scenarios only, not QuickBooks or your 2026 outlook.
        </p>
        <div className="employee-benefit-grid">
          <div className="employee-benefit-heading"></div>
          <strong>Part-time (900 hours)</strong>
          <strong>Full-time (1,440 hours)</strong>
          <label htmlFor="partTimeAddedRevenue">Additional annual revenue ($)</label>
          <input id="partTimeAddedRevenue" type="number" min="0" value={inputs.partTimeAddedRevenue} onChange={e => setInput('partTimeAddedRevenue', e.target.value)} />
          <input aria-label="Full-time additional annual revenue" type="number" min="0" value={inputs.fullTimeAddedRevenue} onChange={e => setInput('fullTimeAddedRevenue', e.target.value)} />
          <label htmlFor="partTimeSubSavings">Annual subcontractor savings ($)</label>
          <input id="partTimeSubSavings" type="number" min="0" value={inputs.partTimeSubSavings} onChange={e => setInput('partTimeSubSavings', e.target.value)} />
          <input aria-label="Full-time annual subcontractor savings" type="number" min="0" value={inputs.fullTimeSubSavings} onChange={e => setInput('fullTimeSubSavings', e.target.value)} />
        </div>
        <label className="employee-benefit-margin">
          <span>Profit margin on additional revenue (%)</span>
          <input type="number" min="0" max="100" value={inputs.addedRevenueMargin} onChange={e => setInput('addedRevenueMargin', e.target.value)} />
        </label>
        <p className="employee-start-note">
          For example, $10,000 in new sales at a 60% contribution margin adds $6,000 before the employee's wages.
          The 60% is an editable illustration, not a verified Turf Pro margin.
          Don't count the same subcontracted work as both new sales and avoided subcontractor expense.
        </p>
      </section>

      <section className="overview-section">
        <h2 className="overview-section-title">{HIRE_YEAR} comparison</h2>
        <p className="employee-start-note">All amounts are estimates. Starting cash and LOC are the figures you entered above; additional hiring benefits are zero unless you change them.</p>
        <div className="employee-table-scroll">
          <table className="settings-table employee-table employee-comparison-table">
            <thead>
              <tr>
                <th></th>
                {scenarios.map(s => <th key={s.label}>{s.label}{s.hours > 0 && ` (${s.hours.toLocaleString('en-US')} hours)`}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Starting cash<small>Same for each scenario</small></td>
                {scenarios.map(s => balanceCell(s.label, assumptions.startingCashCents, false))}
              </tr>
              <tr>
                <td>Annual cost of employee<small>Wages + estimated employer burden</small></td>
                {scenarios.map(s => <td key={s.label}>{formatDollars(s.technicianCost)}</td>)}
              </tr>
              <tr>
                <td>Additional revenue<small>Annual sales attributable to hiring</small></td>
                {scenarios.map(s => <td key={s.label}>{formatDollars(s.addedRevenueCents)}</td>)}
              </tr>
              <tr>
                <td>Profit from additional revenue<small>After the direct costs of new work</small></td>
                {scenarios.map(s => <td key={s.label}>{formatDollars(s.addedGrossProfitCents)}</td>)}
              </tr>
              <tr>
                <td>Subcontractor savings<small>Existing costs no longer incurred</small></td>
                {scenarios.map(s => <td key={s.label}>{formatDollars(s.subcontractorSavingsCents)}</td>)}
              </tr>
              <tr className="employee-key-row">
                <td>Projected business net profit<small>After owner salary, SEP, rent and employee cost</small></td>
                {scenarios.map(s => <td key={s.label} className={negative(s.netIncome)}>{formatDollars(s.netIncome)}</td>)}
              </tr>
              <tr>
                <td>Cash added or used during the year<small>Profit + depreciation − personal distributions − purchase payments − principal</small></td>
                {scenarios.map(s => <td key={s.label} className={negative(s.cashChange)}>{s.cashChange > 0 ? '+' : ''}{formatDollars(s.cashChange)}</td>)}
              </tr>
              <tr className="employee-key-row">
                <td>Projected year-end cash after LOC<small>Starting cash + annual cash change − starting LOC balance; not an actual bank balance</small></td>
                {scenarios.map(s => balanceCell(s.label, s.yearEndCashLessDebt, s.yearEndCashLessDebt < 0, true))}
              </tr>
            </tbody>
          </table>
        </div>
        <details className="employee-detail">
          <summary>Additional borrowing and calculation details</summary>
          <div className="employee-table-scroll">
            <table className="settings-table employee-table">
              <thead>
                <tr><th></th>{scenarios.map(s => <th key={s.label}>{s.label}</th>)}</tr>
              </thead>
              <tbody>
                <tr>
                  <td>New borrowing needed by year-end<small>Annual cash shortfall beyond starting cash; does not show peak seasonal borrowing</small></td>
                  {scenarios.map(s => balanceCell(s.label, s.newBorrowing, s.newBorrowing > 0))}
                </tr>
                <tr>
                  <td>Starting line of credit owed</td>
                  {scenarios.map(s => balanceCell(s.label, assumptions.lineOfCreditCents, false))}
                </tr>
                <tr>
                  <td>Year-end cash less line of credit<small>Does not prove you can meet payroll every month</small></td>
                  {scenarios.map(s => balanceCell(s.label, s.yearEndCashLessDebt, s.yearEndCashLessDebt < 0))}
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <p className="employee-start-note">
          A positive year-end cash estimate does not guarantee you can cover payroll throughout the season.
          This calculation excludes receivables and payables timing, vehicle/equipment purchases, and any employee SEP benefit not entered elsewhere.
        </p>
      </section>

      <section className="overview-section employee-notes">
        <h2 className="overview-section-title">How to read this</h2>
        <ul>
          <li>
            <strong>Seasonal borrowing is not the test; year-end debt is.</strong> Drawing on the line of credit
            during the season and repaying it is not modeled and does not count against a hire. A negative
            year-end figure means year-end cash would not cover the line of credit, so the balance would
            have to be repaid from {HIRE_YEAR + 1} revenue. A positive figure means the cash is there to
            repay it, not that it has been repaid.
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
            <strong>Hiring benefits are optional scenarios.</strong> Added revenue is included at the editable contribution
            margin; subcontractor savings are added separately. Both default to zero, and neither is a guarantee.
            Less physical load on you, rounds finished on schedule, coverage if you are sick or injured,
            and time for sales and management may also matter but are not assigned a dollar value.
          </li>
        </ul>
      </section>
    </div>
  )
}
