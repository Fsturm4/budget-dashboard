// One hiring option for the year after the dashboard year. All money in integer cents.
// Starts from the Full-Year Outlook net income. Owner wages, SEP and Rent & Lease in
// the outlook are replaced by the planned amounts so each is counted once.
// Distributions, payments to mother and loan principal reduce cash only.
// hireBenefitCents is the profit or savings the hire brings in, before the technician's own cost.
export function projectHire(outlook, assumptions, hours, hireBenefitCents = 0) {
  const {
    hourlyRateCents, burdenPct, ownerSalaryCents, sepCents, rentCents, distributionsCents,
    motherPaymentsCents, loanPrincipalCents, startingCashCents, lineOfCreditCents,
  } = assumptions

  const technicianCost = Math.round(hours * hourlyRateCents * (1 + burdenPct / 100))

  const netIncome = outlook.netIncome
    + outlook.ownerWages - ownerSalaryCents
    + outlook.sep - sepCents
    + outlook.rent - rentCents
    - technicianCost
    + hireBenefitCents

  const cashChange = netIncome + outlook.depreciation
    - distributionsCents - motherPaymentsCents - loanPrincipalCents

  const yearEndCashLessDebt = startingCashCents - lineOfCreditCents + cashChange

  return {
    technicianCost,
    costNotCovered: Math.max(0, technicianCost - hireBenefitCents),
    benefitSurplus: Math.max(0, hireBenefitCents - technicianCost),
    netIncome,
    cashChange,
    yearEndCashLessDebt,
    newBorrowing: Math.max(0, -(startingCashCents + cashChange)),
    debtCarried:  Math.max(0, -yearEndCashLessDebt),
  }
}

// Comparison only: what a scenario still lacks against a net income target. Never negative.
export function profitNeeded(desiredNetIncomeCents, netIncomeCents) {
  return Math.max(0, desiredNetIncomeCents - netIncomeCents)
}
