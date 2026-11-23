const MONTH_COLS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const SEASON_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11]

// Monthly section totals for the dashboard year, using the Overview's outlook rule:
// actuals (with intercompany eliminations) for uploaded months, monthly budget for the rest.
export function buildBaseline(actuals, budgetRows, categories) {
  const sectionBySlug = new Map(categories.map(c => [c.slug, c.section]))
  const actualMonths  = new Set(actuals.map(r => r.month))
  const months = Array.from({ length: 12 }, () => (
    { revenue: 0, cogs: 0, opex: 0, other: 0, ownerWages: 0, depreciation: 0 }
  ))

  const add = (slug, month, cents) => {
    const totals = months[month - 1]
    totals[sectionBySlug.get(slug)] += cents
    if (slug === 'owner_wages')  totals.ownerWages   += cents
    if (slug === 'depreciation') totals.depreciation += cents
  }

  for (const row of actuals) add(row.category_slug, row.month, row.amount_cents)
  for (const row of budgetRows) {
    MONTH_COLS.forEach((col, i) => {
      if (!actualMonths.has(i + 1)) add(row.category_slug, i + 1, row[`${col}_cents`] ?? 0)
    })
  }

  return { months, actualMonths: [...actualMonths].sort((a, b) => a - b) }
}

// One hiring option projected onto the baseline year. All money in integer cents.
// Owner wages in the baseline are replaced by the assumed salary so they count once.
// Distributions, payments to mother and loan principal reduce cash only.
export function projectScenario({ months }, assumptions, hours) {
  const {
    hourlyRateCents, burdenPct, ownerSalaryCents, sepCents, distributionsCents,
    motherPaymentsCents, loanPrincipalCents, startingCashCents, customers,
  } = assumptions

  const technicianCost = Math.round(hours * hourlyRateCents * (1 + burdenPct / 100))
  const incomeBeforeOwnerPay = m => m.revenue - m.cogs - m.opex + m.other + m.ownerWages
  const total = valueOf => months.reduce((sum, m) => sum + valueOf(m), 0)

  const netIncome = total(incomeBeforeOwnerPay) - ownerSalaryCents - sepCents - technicianCost

  const monthlyOwnerAndDebt =
    (ownerSalaryCents + sepCents + distributionsCents + motherPaymentsCents + loanPrincipalCents) / 12
  let cash = startingCashCents
  const cashByMonth = months.map((m, i) => {
    cash += incomeBeforeOwnerPay(m) + m.depreciation - monthlyOwnerAndDebt
    if (SEASON_MONTHS.includes(i + 1)) cash -= technicianCost / SEASON_MONTHS.length
    return Math.round(cash)
  })
  const lowestCash = Math.min(...cashByMonth)

  const grossProfitPerCustomer = total(m => m.revenue - m.cogs) / customers

  return {
    technicianCost,
    netIncome,
    cashChange:      cashByMonth[11] - startingCashCents,
    yearEndCash:     cashByMonth[11],
    lowestCash,
    lowestCashMonth: cashByMonth.indexOf(lowestCash) + 1,
    customersNeeded: Math.ceil(technicianCost / grossProfitPerCustomer),
  }
}
