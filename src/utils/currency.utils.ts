/**
 * ProcureLens — Currency Utilities
 */

/**
 * Formats a numeric value into a localized currency string.
 */
export function formatCurrency(amount: number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return '—'
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

/**
 * Precision-safe currency rounding to 2 decimal places.
 */
export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Calculates percentage difference between two amounts.
 */
export function calculateSavingsPercentage(benchmark: number, compared: number): number {
  if (benchmark <= 0 || compared <= 0) return 0
  const diff = benchmark - compared
  return Math.max(0, roundCurrency((diff / benchmark) * 100))
}
