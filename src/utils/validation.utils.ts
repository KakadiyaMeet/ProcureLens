/**
 * ProcureLens — Input Validation Utilities
 */

export function validateRequired(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return `${fieldName} is required.`
  }
  return null
}

export function validatePositiveNumber(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === '') {
    return `${fieldName} is required.`
  }
  const num = typeof value === 'string' ? parseFloat(value) : (value as number)
  if (isNaN(num) || num <= 0) {
    return `${fieldName} must be greater than zero.`
  }
  return null
}

export function validateNonNegative(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === '') {
    return `${fieldName} is required.`
  }
  const num = typeof value === 'string' ? parseFloat(value) : (value as number)
  if (isNaN(num) || num < 0) {
    return `${fieldName} cannot be negative.`
  }
  return null
}

export function validateEmail(value: string): string | null {
  if (!value || !value.trim()) return 'Email is required.'
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(value.trim())) {
    return 'Please enter a valid email address.'
  }
  return null
}
