// One hiring option for the year after the dashboard year. All money in integer cents.
// Starts from the Full-Year Outlook net income. Owner wages, SEP and Rent & Lease in
// the outlook are replaced by the planned amounts so each is counted once.
// Distributions, payments to mother and loan principal reduce cash only.
// Additional revenue counts at its contribution margin; subcontractor savings count in full.
const NO_BENEFITS = { additionalRevenueCents: 0, subcontractorSavingsCents: 0, contributionMarginPct: 0 }

export function projectHire(outlook, assumptions, hours, benefits = NO_BENEFITS) {
  const {
    hourlyRateCents, burdenPct, ownerSalaryCents, sepCents, rentCents, distributionsCents,
    motherPaymentsCents, loanPrincipalCents, startingCashCents, lineOfCreditCents,
  } = assumptions

  const { additionalRevenueCents, subcontractorSavingsCents, contributionMarginPct } = benefits
  const margin = contributionMarginPct / 100

  const technicianCost = Math.round(hours * hourlyRateCents * (1 + burdenPct / 100))
  const hireBenefit    = Math.round(additionalRevenueCents * margin) + subcontractorSavingsCents
  const costNotCovered = Math.max(0, technicianCost - hireBenefit)
  const revenueFor     = cost => margin > 0 ? Math.round(cost / margin) : null

  const netIncome = outlook.netIncome
    + outlook.ownerWages - ownerSalaryCents
    + outlook.sep - sepCents
    + outlook.rent - rentCents
    - technicianCost
    + hireBenefit

  const cashChange = netIncome + outlook.depreciation
    - distributionsCents - motherPaymentsCents - loanPrincipalCents

  const yearEndCashLessDebt = startingCashCents - lineOfCreditCents + cashChange

  return {
    technicianCost,
    hireBenefit,
    costNotCovered,
    benefitSurplus:        Math.max(0, hireBenefit - technicianCost),
    revenueToCoverCost:    revenueFor(Math.max(0, technicianCost - subcontractorSavingsCents)),
    revenueStillNeeded:    revenueFor(costNotCovered),
    netIncome,
    cashChange,
    yearEndCashLessDebt,
    newBorrowing: Math.max(0, -(startingCashCents + cashChange)),
    debtCarried:  Math.max(0, -yearEndCashLessDebt),
  }
}
