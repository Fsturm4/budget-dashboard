// All dollar amounts in the app are stored and computed as integer cents.
// Convert to cents at entry points, back to dollars only at display.

const formatter = new Intl.NumberFormat('en-US', {
  style:    'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// Dollar string or number → integer cents. Rounds half-up.
export function toCents(dollars) {
  return Math.round(Number(dollars) * 100)
}

// Integer cents → floating point dollars.
export function fromCents(cents) {
  return cents / 100
}

// Integer cents → formatted currency string, e.g. "$1,234.56" or "($1,234.56)".
export function formatDollars(cents) {
  return formatter.format(cents / 100)
}

// Variance percentage as a decimal. Returns null if budget is zero.
export function variancePct(actualCents, budgetCents) {
  if (budgetCents === 0) return null
  return (actualCents - budgetCents) / Math.abs(budgetCents)
}
