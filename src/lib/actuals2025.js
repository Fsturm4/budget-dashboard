// 2025 full-year actuals in cents, as each company's QuickBooks Profit and Loss
// (January-December 2025, accrual basis) reported them on November 23, 2026.
// Every QuickBooks account sits in one dashboard category and is counted once.
// QuickBooks lists 9995 Penalties and Fees under Other Expenses; the dashboard
// keeps it in Operating Expenses, as it does for 2026.
export const ACTUALS_2025 = {
  turf_pro_net_revenue:        { tp: 22142139, ga:        0 },
  greenace_net_revenue:        { tp:        0, ga: 32226594 },
  supplies_and_materials:      { tp:   580503, ga:  7398196 },
  seed:                        { tp:        0, ga:   669019 },
  lawn_flags:                  { tp:    28321, ga:    21936 },
  subcontract_labor:           { tp: 14793400, ga:  2412500 },
  owner_wages:                 { tp:        0, ga:  8000000 },
  rent_and_lease:              { tp:  2600000, ga:    73100 },
  advertising_and_marketing:   { tp:   218900, ga:  2583863 },
  car_repairs_and_maintenance: { tp:        0, ga:   670617 },
  depreciation:                { tp:   325700, ga:   466600 },
  insurance_health:            { tp:        0, ga:   784874 },
  owner_payroll_taxes:         { tp:        0, ga:   653012 },
  office_expense:              { tp:   143083, ga:   399704 },
  gas_fuel:                    { tp:   110202, ga:   385326 },
  repairs_and_maintenance:     { tp:   453170, ga:        0 },
  insurance_auto:              { tp:   252700, ga:   161395 },
  telephone_and_internet:      { tp:   163100, ga:   192117 },
  insurance_general_liability: { tp:   134920, ga:   129304 },
  small_equipment:             { tp:        0, ga:   265374 },
  meals_and_entertainment:     { tp:    34804, ga:   141406 },
  payroll_fees:                { tp:    11000, ga:   154264 },
  postage:                     { tp:   144900, ga:        0 },
  supplies:                    { tp:   132717, ga:        0 },
  office_supplies:             { tp:    76444, ga:    40268 },
  tax_state:                   { tp:    45600, ga:    45600 },
  trash_removal:               { tp:    83380, ga:        0 },
  filing_fees:                 { tp:    15500, ga:    67000 },
  dues_and_subscriptions:      { tp:    59460, ga:        0 },
  professional_fees:           { tp:    46628, ga:        0 },
  bank_fees:                   { tp:     9140, ga:    28730 },
  tax_property:                { tp:    35075, ga:        0 },
  email:                       { tp:        0, ga:    29557 },
  education:                   { tp:        0, ga:    25500 },
  interest_paid:               { tp:        0, ga:    29644 },
  entertainment:               { tp:        0, ga:    18000 },
  licenses_and_permits:        { tp:        0, ga:    15389 },
  tax_excise:                  { tp:        0, ga:     9565 },
  payroll_taxes_non_owner:     { tp:     7118, ga:        0 },
  vehicle_registration:        { tp:        0, ga:     6000 },
  vehicle_expense:             { tp:   202000, ga:     3500 },
  penalties_and_fees:          { tp:        0, ga:    88000 },
  sep_ira_expense:             { tp:        0, ga:  2000000 },
  other_income_expense:        { tp:        0, ga:   281267 },
}

// Turf Pro checks to GreenAce in 2025: Subcontract Labor on Turf Pro's books and
// Sales on GreenAce's. Removed from the combined view only, so each company view
// still equals its own QuickBooks report.
const INTERCOMPANY_TRANSFERS_2025 = 12178800
const ELIMINATED_SLUGS = ['greenace_net_revenue', 'subcontract_labor']

// mode: 'tp' | 'ga' | 'combined'
export function actual2025Cents(slug, mode) {
  const row = ACTUALS_2025[slug]
  if (!row) return 0
  if (mode !== 'combined') return row[mode]
  return row.tp + row.ga - (ELIMINATED_SLUGS.includes(slug) ? INTERCOMPANY_TRANSFERS_2025 : 0)
}
