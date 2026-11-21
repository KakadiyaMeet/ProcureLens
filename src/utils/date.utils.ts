/**
 * ProcureLens — Date Formatting & Relative Utilities
 */

/**
 * Formats an ISO string or Date into a human-readable format (e.g., Nov 19, 2026).
 */
export function formatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '—'
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(date.getTime())) return '—'

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Formats an ISO string into Date + Time format.
 */
export function formatDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '—'
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(date.getTime())) return '—'

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Returns remaining days until a deadline or date. Negative values indicate overdue.
 */
export function getDaysRemaining(targetDate: string | Date | null | undefined): number | null {
  if (!targetDate) return null
  const date = typeof targetDate === 'string' ? new Date(targetDate) : targetDate
  if (isNaN(date.getTime())) return null

  const now = new Date()
  const diffTime = date.getTime() - now.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}
