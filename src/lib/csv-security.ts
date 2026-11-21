/**
 * CSV Security Library — ProcureLens
 *
 * Zero-trust defense layers for CSV import:
 * 1. CSV injection defense (formula injection, tab/CR injection)
 * 2. XSS / HTML tag sanitization
 * 3. Numeric sanity checks (NaN, Infinity, negative overflow, range)
 * 4. Schema verification for strictly typed primitives
 * 5. Multi-tenant fence (organizationId cross-boundary check)
 * 6. Rejected row preservation with explicit error codes + field names + row indices
 * 7. CSV error export helper (exportRejectedRowsToCsv)
 */

// ─── Error Codes ──────────────────────────────────────────────────────────────

export const CSV_ERROR_CODES = {
  CSV_INJECTION: 'CSV_INJECTION',
  XSS_DETECTED: 'XSS_DETECTED',
  INVALID_NUMBER: 'INVALID_NUMBER',
  NUMBER_OUT_OF_RANGE: 'NUMBER_OUT_OF_RANGE',
  NEGATIVE_VALUE: 'NEGATIVE_VALUE',
  MISSING_REQUIRED: 'MISSING_REQUIRED',
  WRONG_TYPE: 'WRONG_TYPE',
  CROSS_ORG_VIOLATION: 'CROSS_ORG_VIOLATION',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  VALUE_TOO_LONG: 'VALUE_TOO_LONG',
} as const

export type CsvErrorCode = (typeof CSV_ERROR_CODES)[keyof typeof CSV_ERROR_CODES]

// ─── Error Shape ──────────────────────────────────────────────────────────────

export interface CsvFieldError {
  code: CsvErrorCode
  field: string
  message: string
  rawValue?: unknown
}

export interface RejectedRow {
  /** 1-based row index in the source CSV (including header = row 1) */
  rowIndex: number
  /** Original raw data from the parsed CSV (before sanitization) */
  raw: Record<string, string>
  errors: CsvFieldError[]
}

// ─── 1. CSV Injection Defense ─────────────────────────────────────────────────

/**
 * Characters that trigger formula execution in spreadsheet apps when they appear
 * at the start of a cell value: =, +, -, @, TAB (0x09), CR (0x0D)
 */
const INJECTION_PREFIX_RE = /^[=+\-@\t\r]/

/**
 * Sanitize a single string cell against CSV injection.
 * Strategy: prefix-escape with a single quote (Excel / LibreOffice convention)
 * so the value is preserved but not executed.
 * Returns the sanitized string and a flag indicating whether it was modified.
 */
export function sanitizeCsvInjection(value: string): { value: string; wasInjection: boolean } {
  if (typeof value !== 'string') return { value: String(value), wasInjection: false }
  const trimmed = value.trim()
  if (INJECTION_PREFIX_RE.test(trimmed)) {
    // Strip the leading dangerous character(s) rather than passing them through
    const stripped = trimmed.replace(/^[=+\-@\t\r]+/, '').trim()
    return { value: stripped, wasInjection: true }
  }
  return { value: trimmed, wasInjection: false }
}

// ─── 2. XSS / HTML Sanitization ───────────────────────────────────────────────

const HTML_TAG_RE = /<[^>]*>/g
const DANGEROUS_PROTO_RE = /^(javascript|data|vbscript):/i

/**
 * Strip HTML tags and dangerous protocol prefixes from a string.
 * Returns the cleaned value and whether anything was removed.
 */
export function sanitizeXss(value: string): { value: string; hadXss: boolean } {
  if (typeof value !== 'string') return { value: String(value), hadXss: false }
  const before = value
  let cleaned = value.replace(HTML_TAG_RE, '')
  if (DANGEROUS_PROTO_RE.test(cleaned.trim())) {
    cleaned = ''
  }
  return { value: cleaned, hadXss: cleaned !== before }
}

// ─── 3. Numeric Sanity Checks ─────────────────────────────────────────────────

export interface NumericOptions {
  fieldName: string
  min?: number
  max?: number
  allowZero?: boolean
}

export interface NumericResult {
  value: number | null
  error: CsvFieldError | null
}

/**
 * Parse and validate a numeric CSV cell.
 * - Strips currency symbols ($, ₹, €, £), commas, and trailing %
 * - Rejects NaN, ±Infinity, values below min/max
 */
export function parseAndValidateNumber(raw: string, opts: NumericOptions): NumericResult {
  const { fieldName, min, max, allowZero = true } = opts
  if (raw === undefined || raw === null || raw.trim() === '') {
    return { value: null, error: null } // empty = not provided, let schema check handle required
  }

  // Strip common currency / percentage chars
  const cleaned = raw.trim().replace(/[,$₹€£%]/g, '').trim()
  const num = Number(cleaned)

  if (!isFinite(num) || isNaN(num)) {
    return {
      value: null,
      error: {
        code: CSV_ERROR_CODES.INVALID_NUMBER,
        field: fieldName,
        message: `"${fieldName}" must be a valid finite number; got "${raw}"`,
        rawValue: raw,
      },
    }
  }

  if (!allowZero && num === 0) {
    return {
      value: null,
      error: {
        code: CSV_ERROR_CODES.NEGATIVE_VALUE,
        field: fieldName,
        message: `"${fieldName}" must be greater than zero; got 0`,
        rawValue: raw,
      },
    }
  }

  if (min !== undefined && num < min) {
    return {
      value: null,
      error: {
        code: num < 0 ? CSV_ERROR_CODES.NEGATIVE_VALUE : CSV_ERROR_CODES.NUMBER_OUT_OF_RANGE,
        field: fieldName,
        message: `"${fieldName}" must be ≥ ${min}; got ${num}`,
        rawValue: raw,
      },
    }
  }

  if (max !== undefined && num > max) {
    return {
      value: null,
      error: {
        code: CSV_ERROR_CODES.NUMBER_OUT_OF_RANGE,
        field: fieldName,
        message: `"${fieldName}" must be ≤ ${max}; got ${num}`,
        rawValue: raw,
      },
    }
  }

  return { value: num, error: null }
}

// ─── 4. Schema Verification ───────────────────────────────────────────────────

export type FieldType = 'string' | 'number' | 'boolean'

export interface FieldSchema {
  name: string
  type: FieldType
  required?: boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  allowZero?: boolean
}

export interface SchemaVerificationResult {
  valid: boolean
  errors: CsvFieldError[]
  sanitized: Record<string, unknown>
}

/**
 * Verify that a parsed (and injection-cleaned) row conforms to the given schema.
 * Returns strictly typed primitives ready for database persistence.
 */
export function verifySchema(
  row: Record<string, string>,
  schema: FieldSchema[]
): SchemaVerificationResult {
  const errors: CsvFieldError[] = []
  const sanitized: Record<string, unknown> = {}

  for (const field of schema) {
    const rawValue = row[field.name]

    if (field.required && (rawValue === undefined || rawValue === null || rawValue.trim() === '')) {
      errors.push({
        code: CSV_ERROR_CODES.MISSING_REQUIRED,
        field: field.name,
        message: `"${field.name}" is required but was empty`,
        rawValue,
      })
      continue
    }

    if (!rawValue || rawValue.trim() === '') {
      sanitized[field.name] = field.type === 'number' ? null : ''
      continue
    }

    if (field.type === 'number') {
      const { value, error } = parseAndValidateNumber(rawValue, {
        fieldName: field.name,
        min: field.min,
        max: field.max,
        allowZero: field.allowZero,
      })
      if (error) {
        errors.push(error)
      } else {
        sanitized[field.name] = value
      }
    } else if (field.type === 'string') {
      const val = rawValue.trim()
      if (field.maxLength && val.length > field.maxLength) {
        errors.push({
          code: CSV_ERROR_CODES.VALUE_TOO_LONG,
          field: field.name,
          message: `"${field.name}" exceeds max length of ${field.maxLength} chars (got ${val.length})`,
          rawValue,
        })
      } else {
        sanitized[field.name] = val
      }
    } else if (field.type === 'boolean') {
      const lower = rawValue.trim().toLowerCase()
      if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lower)) {
        errors.push({
          code: CSV_ERROR_CODES.WRONG_TYPE,
          field: field.name,
          message: `"${field.name}" must be a boolean (true/false/yes/no); got "${rawValue}"`,
          rawValue,
        })
      } else {
        sanitized[field.name] = ['true', '1', 'yes'].includes(lower)
      }
    }
  }

  return { valid: errors.length === 0, errors, sanitized }
}

// ─── 5. Multi-Tenant Fence ─────────────────────────────────────────────────────

/**
 * Verify that every record in a batch belongs to the active organization.
 * Returns a list of cross-organization violations as rejected rows.
 *
 * @param records - Array of records (already schema-verified), each must expose organizationId
 * @param activeOrgId - The organization ID of the authenticated session
 * @param rowOffset - Row offset (1 = header row consumed), used for rowIndex reporting
 */
export function enforceTenantBoundary(
  records: Array<{ rowIndex: number; data: Record<string, unknown> }>,
  activeOrgId: string
): { passed: typeof records; rejected: RejectedRow[] } {
  const passed: typeof records = []
  const rejected: RejectedRow[] = []

  for (const record of records) {
    const recordOrgId = record.data.organizationId as string | undefined
    if (recordOrgId && recordOrgId !== activeOrgId) {
      rejected.push({
        rowIndex: record.rowIndex,
        raw: Object.fromEntries(
          Object.entries(record.data).map(([k, v]) => [k, String(v ?? '')])
        ),
        errors: [
          {
            code: CSV_ERROR_CODES.CROSS_ORG_VIOLATION,
            field: 'organizationId',
            message: `Record organizationId "${recordOrgId}" does not match active org "${activeOrgId}". Cross-organization import rejected.`,
            rawValue: recordOrgId,
          },
        ],
      })
    } else {
      passed.push(record)
    }
  }

  return { passed, rejected }
}

// ─── 6. Full Row Sanitization Pipeline ────────────────────────────────────────

export interface SanitizedRowResult {
  rowIndex: number
  sanitized: Record<string, string>
  injectionFields: string[]
  xssFields: string[]
}

/**
 * Run the full sanitization pipeline on a raw CSV row:
 *  1. XSS stripping per field
 *  2. CSV injection escaping per field
 *
 * Returns cleaned row + lists of which fields were affected.
 */
export function sanitizeRow(
  rawRow: Record<string, string>,
  rowIndex: number
): SanitizedRowResult {
  const sanitized: Record<string, string> = {}
  const injectionFields: string[] = []
  const xssFields: string[] = []

  for (const [key, rawVal] of Object.entries(rawRow)) {
    const strVal = rawVal === undefined || rawVal === null ? '' : String(rawVal)

    // Step 1: XSS
    const { value: afterXss, hadXss } = sanitizeXss(strVal)
    if (hadXss) xssFields.push(key)

    // Step 2: CSV injection
    const { value: afterInject, wasInjection } = sanitizeCsvInjection(afterXss)
    if (wasInjection) injectionFields.push(key)

    sanitized[key] = afterInject
  }

  return { rowIndex, sanitized, injectionFields, xssFields }
}

// ─── 7. CSV Error Export Helper ───────────────────────────────────────────────

/**
 * Convert rejected rows to a downloadable CSV string.
 * Appends an "Error Details" column describing all errors for each row.
 *
 * Usage: const csv = exportRejectedRowsToCsv(rejectedRows)
 *        // Then trigger a Blob download in the browser
 */
export function exportRejectedRowsToCsv(rejectedRows: RejectedRow[]): string {
  if (rejectedRows.length === 0) return ''

  // Collect all field names from raw data
  const fieldNames = Array.from(
    new Set(rejectedRows.flatMap((r) => Object.keys(r.raw)))
  )

  // Build header: original fields + Row Index + Error Details
  const headers = ['Row Index', ...fieldNames, 'Error Details']

  const escapeCell = (val: string): string => {
    // RFC 4180 CSV escaping: wrap in quotes if contains comma, quote, or newline
    const str = val === null || val === undefined ? '' : String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const rows = rejectedRows.map((row) => {
    const errorDetail = row.errors
      .map((e) => `[${e.code}] ${e.field}: ${e.message}`)
      .join(' | ')

    const cells = [
      escapeCell(String(row.rowIndex)),
      ...fieldNames.map((f) => escapeCell(row.raw[f] ?? '')),
      escapeCell(errorDetail),
    ]
    return cells.join(',')
  })

  return [headers.map(escapeCell).join(','), ...rows].join('\r\n')
}

/**
 * Trigger a browser download of rejected rows as a CSV file.
 */
export function downloadRejectedRowsCsv(rejectedRows: RejectedRow[], filename = 'rejected-rows.csv'): void {
  const csvContent = exportRejectedRowsToCsv(rejectedRows)
  if (!csvContent) return

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ─── Quotation Row Schema ──────────────────────────────────────────────────────

/**
 * Canonical schema for quotation CSV rows — used by both the UI importer
 * and the Python CLI validator.
 */
export const QUOTATION_ROW_SCHEMA: FieldSchema[] = [
  { name: 'supplierName',    type: 'string', required: true,  maxLength: 200 },
  { name: 'productName',     type: 'string', required: true,  maxLength: 300 },
  { name: 'quantity',        type: 'number', required: true,  min: 0.001, allowZero: false },
  { name: 'unitPrice',       type: 'number', required: true,  min: 0 },
  { name: 'gstPercentage',   type: 'number', required: false, min: 0, max: 100 },
  { name: 'deliveryCharges', type: 'number', required: false, min: 0 },
  { name: 'deliveryDays',    type: 'number', required: false, min: 0 },
  { name: 'paymentTerms',    type: 'string', required: false, maxLength: 200 },
  { name: 'qualityRating',   type: 'number', required: false, min: 1, max: 5 },
]
