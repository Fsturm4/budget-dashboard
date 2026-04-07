// Canonical display order for the line-item table — section headers, input
// rows, and derived rows — matching the workbook layout.
// Used by MonthlyTracker (actuals vs budget) and Budget2026 (budget reference).

const H = 'higher_is_better'
const L = 'lower_is_better'

export const TABLE_ROWS = [
  { type: 'section', label: 'Revenue' },
  { type: 'input',   slug: 'turf_pro_net_revenue',       label: 'Turf Pro Net Revenue',                     varDir: H },
  { type: 'input',   slug: 'greenace_net_revenue',        label: 'GreenAce Net Revenue',                     varDir: H },
  { type: 'derived', key: 'total_rev',                    label: 'Total Net Revenue',                        varDir: H },

  { type: 'section', label: 'Cost of Goods Sold' },
  { type: 'input',   slug: 'supplies_and_materials',      label: 'Supplies & Materials',                     varDir: L },
  { type: 'input',   slug: 'seed',                        label: 'Seed',                                     varDir: L },
  { type: 'input',   slug: 'lawn_flags',                  label: 'Lawn Flags',                               varDir: L },
  { type: 'input',   slug: 'subcontract_labor',           label: 'Subcontract Labor',                        varDir: L },
  { type: 'derived', key: 'total_cogs',                   label: 'Total COGS',                               varDir: L },
  { type: 'derived', key: 'gross_profit',                 label: 'Gross Profit',                             varDir: H },

  { type: 'section', label: 'Operating Expenses' },
  { type: 'input',   slug: 'owner_wages',                 label: 'Owner Wages',                              varDir: L },
  { type: 'input',   slug: 'rent_and_lease',              label: 'Rent & Lease',                             varDir: L },
  { type: 'input',   slug: 'advertising_and_marketing',   label: 'Advertising & Marketing',                  varDir: L },
  { type: 'input',   slug: 'car_repairs_and_maintenance', label: 'Car Repairs & Maintenance (Auto & Truck)', varDir: L },
  { type: 'input',   slug: 'depreciation',                label: 'Depreciation',                             varDir: L },
  { type: 'input',   slug: 'insurance_health',            label: 'Insurance - Health',                       varDir: L },
  { type: 'input',   slug: 'owner_payroll_taxes',         label: 'Owner Payroll Taxes',                      varDir: L },
  { type: 'input',   slug: 'office_expense',              label: 'Office Expense',                           varDir: L },
  { type: 'input',   slug: 'gas_fuel',                    label: 'Gas / Fuel',                               varDir: L },
  { type: 'input',   slug: 'repairs_and_maintenance',     label: 'Repairs & Maintenance (House)',             varDir: L },
  { type: 'input',   slug: 'insurance_auto',              label: 'Insurance - Auto',                         varDir: L },
  { type: 'input',   slug: 'telephone_and_internet',      label: 'Telephone & Internet',                     varDir: L },
  { type: 'input',   slug: 'insurance_general_liability', label: 'Insurance - General Liability',            varDir: L },
  { type: 'input',   slug: 'small_equipment',             label: 'Small Equipment',                          varDir: L },
  { type: 'input',   slug: 'meals_and_entertainment',     label: 'Meals & Entertainment',                    varDir: L },
  { type: 'input',   slug: 'payroll_fees',                label: 'Payroll Fees',                             varDir: L },
  { type: 'input',   slug: 'postage',                     label: 'Postage',                                  varDir: L },
  { type: 'input',   slug: 'supplies',                    label: 'Supplies',                                 varDir: L },
  { type: 'input',   slug: 'office_supplies',             label: 'Office Supplies',                          varDir: L },
  { type: 'input',   slug: 'tax_state',                   label: 'Tax - State',                              varDir: L },
  { type: 'input',   slug: 'trash_removal',               label: 'Trash Removal',                            varDir: L },
  { type: 'input',   slug: 'filing_fees',                 label: 'Filing Fees',                              varDir: L },
  { type: 'input',   slug: 'dues_and_subscriptions',      label: 'Dues & Subscriptions',                     varDir: L },
  { type: 'input',   slug: 'professional_fees',           label: 'Professional Fees',                        varDir: L },
  { type: 'input',   slug: 'bank_fees',                   label: 'Bank Fees',                                varDir: L },
  { type: 'input',   slug: 'tax_property',                label: 'Tax - Property',                           varDir: L },
  { type: 'input',   slug: 'email',                       label: 'Email',                                    varDir: L },
  { type: 'input',   slug: 'education',                   label: 'Education',                                varDir: L },
  { type: 'input',   slug: 'interest_paid',               label: 'Interest Paid',                            varDir: L },
  { type: 'input',   slug: 'entertainment',               label: 'Entertainment',                            varDir: L },
  { type: 'input',   slug: 'licenses_and_permits',        label: 'Licenses & Permits',                       varDir: L },
  { type: 'input',   slug: 'tax_excise',                  label: 'Tax - Excise',                             varDir: L },
  { type: 'input',   slug: 'payroll_taxes_non_owner',     label: 'Payroll Taxes (non-owner)',                 varDir: L },
  { type: 'input',   slug: 'vehicle_registration',        label: 'Vehicle Registration',                     varDir: L },
  { type: 'input',   slug: 'vehicle_expense',             label: 'Vehicle Expense',                          varDir: L },
  { type: 'input',   slug: 'penalties_and_fees',          label: 'Penalties & Fees',                         varDir: L },
  { type: 'derived', key: 'total_opex',                   label: 'Total Operating Expenses',                 varDir: L },
  { type: 'derived', key: 'noi',                          label: 'Net Operating Income',                     varDir: H },

  { type: 'section', label: 'Other' },
  { type: 'input',   slug: 'other_income_expense',        label: 'Other Income / (Expense)',                 varDir: H },
  { type: 'derived', key: 'net_income',                   label: 'Net Income',                               varDir: H },
]

// Slug membership by section — drives section-total computation for derived rows.
export const SECTION_SLUGS = {
  revenue: ['turf_pro_net_revenue', 'greenace_net_revenue'],
  cogs:    ['supplies_and_materials', 'seed', 'lawn_flags', 'subcontract_labor'],
  opex: [
    'owner_wages', 'rent_and_lease', 'advertising_and_marketing',
    'car_repairs_and_maintenance', 'depreciation', 'insurance_health',
    'owner_payroll_taxes', 'office_expense', 'gas_fuel', 'repairs_and_maintenance',
    'insurance_auto', 'telephone_and_internet', 'insurance_general_liability',
    'small_equipment', 'meals_and_entertainment', 'payroll_fees', 'postage',
    'supplies', 'office_supplies', 'tax_state', 'trash_removal', 'filing_fees',
    'dues_and_subscriptions', 'professional_fees', 'bank_fees', 'tax_property',
    'email', 'education', 'interest_paid', 'entertainment', 'licenses_and_permits',
    'tax_excise', 'payroll_taxes_non_owner', 'vehicle_registration', 'vehicle_expense',
    'penalties_and_fees',
  ],
  other: ['other_income_expense'],
}
