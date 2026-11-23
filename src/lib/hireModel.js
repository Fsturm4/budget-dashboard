// One hiring option for the year after the dashboard year. All money in integer cents.
// Starts from the Full-Year Outlook net income. Owner wages, SEP and Rent & Lease in
// the outlook are replaced by the planned amounts so each is counted once.
// Distributions, payments to mother and loan principal reduce cash only.
// Revenue and subcontractor savings entered for a hire are incremental to the
// baseline, and never apply to the "No employee" scenario.
export function projectHire(outlook, assumptions, hours, benefits = {}) {
  const {
    hourlyRateCents, burdenPct, ownerSalaryCents, sepCents, rentCents, distributionsCents,
    motherPaymentsCents, loanPrincipalCents, startingCashCents, lineOfCreditCents,
  } = assumptions

  const technicianCost = Math.round(hours * hourlyRateCents * (1 + burdenPct / 100))
  const addedRevenueCents = hours > 0 ? Math.max(0, benefits.addedRevenueCents ?? 0) : 0
  const subcontractorSavingsCents = hours > 0 ? Math.max(0, benefits.subcontractorSavingsCents ?? 0) : 0
  const grossMarginPct = Math.min(100, Math.max(0, Number(benefits.grossMarginPct ?? 0)))
  // The direct costs of new work are NOT already in the baseline outlook.
  const addedGrossProfitCents = Math.round(addedRevenueCents * grossMarginPct / 100)

  const netIncome = outlook.netIncome
    + outlook.ownerWages - ownerSalaryCents
    + outlook.sep - sepCents
    + outlook.rent - rentCents
    - technicianCost + addedGrossProfitCents + subcontractorSavingsCents

  const cashChange = netIncome + outlook.depreciation
    - distributionsCents - motherPaymentsCents - loanPrincipalCents

  const yearEndCashLessDebt = startingCashCents - lineOfCreditCents + cashChange

  return {
    technicianCost,
    addedRevenueCents,
    addedGrossProfitCents,
    subcontractorSavingsCents,
    netIncome,
    cashChange,
    yearEndCashLessDebt,
    newBorrowing: Math.max(0, -(startingCashCents + cashChange)),
    debtCarried:  Math.max(0, -yearEndCashLessDebt),
  }
}
