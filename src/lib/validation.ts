export function validateRequired(value: string | undefined | null, fieldName: string): string | null {
  if (!value || value.trim() === '') return `${fieldName} is required`
  return null
}

export function validatePositiveNumber(value: number | undefined | null, fieldName: string): string | null {
  if (value === undefined || value === null) return `${fieldName} is required`
  if (value <= 0) return `${fieldName} must be greater than zero`
  return null
}

export function validateNonNegative(value: number | undefined | null, fieldName: string): string | null {
  if (value === undefined || value === null) return null
  if (value < 0) return `${fieldName} must not be negative`
  return null
}

export function validateEmail(email: string | undefined | null): string | null {
  if (!email) return 'Email is required'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email format'
  return null
}
