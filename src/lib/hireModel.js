// One hiring option for the year after the dashboard year. All money in integer cents.
// Starts from the Full-Year Outlook net income. Owner wages, SEP and Rent & Lease in
// the outlook are replaced by the planned amounts so each is counted once.
// Distributions, payments to mother and loan principal reduce cash only.
export function projectHire(outlook, assumptions, hours) {
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

  const cashChange = netIncome + outlook.depreciation
    - distributionsCents - motherPaymentsCents - loanPrincipalCents

  const yearEndCashLessDebt = startingCashCents - lineOfCreditCents + cashChange

  return {
    technicianCost,
    netIncome,
    cashChange,
    yearEndCashLessDebt,
    newBorrowing: Math.max(0, -(startingCashCents + cashChange)),
    debtCarried:  Math.max(0, -yearEndCashLessDebt),
  }
}
