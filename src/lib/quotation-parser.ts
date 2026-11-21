/**
 * ProcureLens - RFC 4180 Compliant Quotation CSV Parser & Calculation Engine
 *
 * Implements:
 * - RFC 4180 standard compliance (quoted cells, escaped quotes `""`, multiline cells, CRLF/LF)
 * - Auto-detection of delimiters (`,`, `;`, `\t`, `|`)
 * - Header auto-detection and custom column mapping
 * - Data normalization (currency symbols $/₹/€/£/¥, % stripping, number parsing, whitespace trimming)
 * - Real-time calculation:
 *     Subtotal = Quantity * Unit price
 *     Tax amount = Subtotal * (GST % / 100)
 *     Delivery charges
 *     Total quotation cost = Subtotal + Tax amount + Delivery charges
 * - Record validation:
 *     Quantity > 0
 *     Unit price >= 0
 *     GST % >= 0 and <= 100
 *     Delivery charges >= 0
 *     Delivery days >= 0
 *     Quality rating between 1 and 5 (or empty)
 * - Duplicate detection (intra-file and existing quotation checks)
 * - Per-row and per-cell error and warning reporting
 * - Supplier grouping and financial aggregation
 */

// ---------------------------------------------------------------------------
// 1. Types & Interfaces
// ---------------------------------------------------------------------------

export type QuotationFieldKey =
  | 'supplierName'
  | 'productName'
  | 'quantity'
  | 'unitPrice'
  | 'gstPercentage'
  | 'deliveryCharges'
  | 'deliveryDays'
  | 'paymentTerms'
  | 'qualityRating'

export interface FieldDefinition {
  key: QuotationFieldKey
  label: string
  description: string
  required: boolean
  aliases: string[]
  type: 'string' | 'number'
  defaultValue?: string | number | null
}

export const SUPPORTED_FIELDS: FieldDefinition[] = [
  {
    key: 'supplierName',
    label: 'Supplier Name',
    description: 'Name of the vendor or supplier providing the quotation',
    required: true,
    aliases: [
      'supplier',
      'supplier name',
      'supplier_name',
      'vendor',
      'vendor name',
      'vendor_name',
      'company',
      'company name',
      'provider',
      'seller',
      'party',
      'party name',
    ],
    type: 'string',
  },
  {
    key: 'productName',
    label: 'Product / Item Name',
    description: 'Product, item, material, or service description',
    required: true,
    aliases: [
      'product',
      'product name',
      'product_name',
      'item',
      'item name',
      'item_name',
      'description',
      'product description',
      'item description',
      'material',
      'part name',
      'service',
    ],
    type: 'string',
  },
  {
    key: 'quantity',
    label: 'Quantity',
    description: 'Number of units offered (must be > 0)',
    required: true,
    aliases: [
      'quantity',
      'qty',
      'count',
      'units',
      'volume',
      'order quantity',
      'quant',
      'pieces',
      'pcs',
    ],
    type: 'number',
  },
  {
    key: 'unitPrice',
    label: 'Unit Price',
    description: 'Price per individual unit before taxes (must be >= 0)',
    required: true,
    aliases: [
      'unit price',
      'unit_price',
      'price',
      'rate',
      'unit rate',
      'unit cost',
      'cost',
      'price/unit',
      'rate/unit',
      'item price',
      'price per unit',
    ],
    type: 'number',
  },
  {
    key: 'gstPercentage',
    label: 'GST / Tax (%)',
    description: 'Applicable GST / VAT / Sales Tax percentage (0% to 100%)',
    required: false,
    aliases: [
      'gst',
      'gst %',
      'gst percentage',
      'gst_percentage',
      'gst_percent',
      'tax',
      'tax %',
      'tax rate',
      'tax percentage',
      'tax_percentage',
      'vat',
      'vat %',
      'vat percentage',
    ],
    type: 'number',
    defaultValue: 0,
  },
  {
    key: 'deliveryCharges',
    label: 'Delivery Charges',
    description: 'Freight, shipping, or transportation cost (must be >= 0)',
    required: false,
    aliases: [
      'delivery charges',
      'delivery_charges',
      'shipping',
      'shipping cost',
      'shipping charges',
      'freight',
      'freight charges',
      'freight cost',
      'delivery cost',
      'transport',
      'transportation',
      'logistics cost',
    ],
    type: 'number',
    defaultValue: 0,
  },
  {
    key: 'deliveryDays',
    label: 'Delivery Days',
    description: 'Estimated lead time in days to fulfill and deliver (>= 0)',
    required: false,
    aliases: [
      'delivery days',
      'delivery_days',
      'lead time',
      'lead_time',
      'lead time (days)',
      'turnaround',
      'eta days',
      'delivery time',
      'days to deliver',
      'days',
    ],
    type: 'number',
    defaultValue: null,
  },
  {
    key: 'paymentTerms',
    label: 'Payment Terms',
    description: 'Agreed commercial payment terms (e.g. Net 30, Advance, COD)',
    required: false,
    aliases: [
      'payment terms',
      'payment_terms',
      'terms',
      'credit terms',
      'payment condition',
      'pay terms',
      'terms of payment',
    ],
    type: 'string',
    defaultValue: 'Net 30',
  },
  {
    key: 'qualityRating',
    label: 'Quality Rating',
    description: 'Historical or evaluated supplier quality rating (1 to 5 stars)',
    required: false,
    aliases: [
      'quality rating',
      'quality_rating',
      'rating',
      'score',
      'quality score',
      'vendor rating',
      'supplier rating',
      'stars',
    ],
    type: 'number',
    defaultValue: null,
  },
]

export type ColumnMapping = Record<QuotationFieldKey, number | null>

export interface CellValidationError {
  field: QuotationFieldKey | string
  columnName?: string
  columnIndex?: number
  value: unknown
  message: string
  severity: 'error' | 'warning'
}

export interface QuotationCalculations {
  subtotal: number
  gstPercentage: number
  taxAmount: number
  deliveryCharges: number
  totalCost: number
  effectiveUnitCost: number
}

export interface ParsedQuotationItemData {
  supplierName: string
  productName: string
  quantity: number
  unitPrice: number
  gstPercentage: number
  deliveryCharges: number
  deliveryDays: number | null
  paymentTerms: string
  qualityRating: number | null
  unit?: string
  notes?: string
}

export interface ParsedRowResult {
  /** 1-based human-readable row index in CSV file */
  rowNumber: number
  /** 0-based array index */
  index: number
  rawValues: Record<string, string>
  parsedData: ParsedQuotationItemData | null
  calculated: QuotationCalculations | null
  isValid: boolean
  errors: CellValidationError[]
  warnings: CellValidationError[]
  isDuplicate?: boolean
  duplicateDetails?: string
}

export interface SupplierQuotationGroup {
  supplierName: string
  supplierRating: number | null
  paymentTerms: string
  maxDeliveryDays: number | null
  items: ParsedRowResult[]
  totalSubtotal: number
  totalTaxAmount: number
  totalDeliveryCharges: number
  totalQuotationCost: number
  itemCount: number
}

export interface QuotationParseResult {
  headers: string[]
  detectedDelimiter: string
  columnMapping: ColumnMapping
  totalRows: number
  validRows: ParsedRowResult[]
  invalidRows: ParsedRowResult[]
  rows: ParsedRowResult[]
  supplierGroups: SupplierQuotationGroup[]
  summary: {
    totalRows: number
    validCount: number
    warningCount: number
    errorCount: number
    uniqueSuppliers: string[]
    totalEstimatedValue: number
    hasCriticalErrors: boolean
  }
}

export interface ExistingQuotationRecord {
  supplierName: string
  productName?: string
  purchaseRequestId?: string
}

export interface ParseOptions {
  delimiter?: ',' | ';' | '\t' | '|' | 'auto'
  trimWhitespace?: boolean
  customMapping?: Partial<Record<QuotationFieldKey, number | string | null>>
  existingQuotations?: ExistingQuotationRecord[]
  allowDuplicates?: boolean
  defaultGstPercentage?: number
  defaultDeliveryCharges?: number
  defaultPaymentTerms?: string
}

// ---------------------------------------------------------------------------
// 2. RFC 4180 CSV Tokenizer & Low-level Parser
// ---------------------------------------------------------------------------

/**
 * Auto-detects the delimiter in a CSV sample text by analyzing occurrences
 * outside of quoted substrings across the first non-empty lines.
 */
export function detectDelimiter(text: string): string {
  const candidates: Array<',' | ';' | '\t' | '|'> = [',', ';', '\t', '|']
  const sampleLines = text
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 10)

  if (sampleLines.length === 0) return ','

  let bestDelimiter = ','
  let maxScore = -1

  for (const delimiter of candidates) {
    let consistentCount = -1
    let isConsistent = true
    let totalOccurrences = 0

    for (const line of sampleLines) {
      // Count delimiters outside quotes
      let inQuotes = false
      let count = 0
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === delimiter && !inQuotes) {
          count++
        }
      }

      totalOccurrences += count
      if (consistentCount === -1) {
        consistentCount = count
      } else if (consistentCount !== count) {
        isConsistent = false
      }
    }

    // Score favors consistent column counts > 0
    let score = totalOccurrences
    if (isConsistent && consistentCount > 0) {
      score += 1000 * consistentCount
    }

    if (score > maxScore && totalOccurrences > 0) {
      maxScore = score
      bestDelimiter = delimiter
    }
  }

  return bestDelimiter
}

/**
 * RFC 4180 state-machine CSV parser.
 * Handles:
 * - Escaped double quotes ("") inside quotes
 * - Commas, semicolons, tabs, and pipes
 * - Multiline cells (newlines inside quoted strings preserved)
 * - Strips UTF-8 BOM
 * - Preserves exact row counts and reports parse anomalies
 */
export function parseCsvToRawRows(
  csvContent: string,
  delimiter: string = ','
): string[][] {
  if (!csvContent || csvContent.trim().length === 0) {
    return []
  }

  // Strip UTF-8 BOM if present
  let cleanContent = csvContent
  if (cleanContent.charCodeAt(0) === 0xfeff) {
    cleanContent = cleanContent.slice(1)
  }

  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  let i = 0
  const len = cleanContent.length

  while (i < len) {
    const char = cleanContent[i]

    if (inQuotes) {
      if (char === '"') {
        // Look ahead for escaped double quote ("")
        if (i + 1 < len && cleanContent[i + 1] === '"') {
          currentField += '"'
          i += 2
          continue
        } else {
          // Closing quote
          inQuotes = false
          i++
          continue
        }
      } else {
        // Any character inside quotes (including \r and \n) is added literally
        currentField += char
        i++
        continue
      }
    } else {
      // Outside of quotes
      if (char === '"') {
        inQuotes = true
        i++
        continue
      } else if (char === delimiter) {
        // Field delimiter
        currentRow.push(currentField)
        currentField = ''
        i++
        continue
      } else if (char === '\r') {
        // Handle CRLF or standalone CR
        currentRow.push(currentField)
        currentField = ''
        rows.push(currentRow)
        currentRow = []

        if (i + 1 < len && cleanContent[i + 1] === '\n') {
          i += 2
        } else {
          i++
        }
        continue
      } else if (char === '\n') {
        // Line feed
        currentRow.push(currentField)
        currentField = ''
        rows.push(currentRow)
        currentRow = []
        i++
        continue
      } else {
        currentField += char
        i++
        continue
      }
    }
  }

  // Handle final field and row
  if (currentField.length > 0 || inQuotes || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  // Filter out trailing completely empty rows
  while (
    rows.length > 0 &&
    rows[rows.length - 1].every((cell) => cell.trim().length === 0)
  ) {
    rows.pop()
  }

  return rows
}

// ---------------------------------------------------------------------------
// 3. Header Auto-Detection & Column Mapping
// ---------------------------------------------------------------------------

function normalizeHeaderString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[_\-./()[\]:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Automatically inspects the first row (headers) and maps columns to supported fields.
 */
export function detectColumnMapping(
  headers: string[],
  customMapping?: Partial<Record<QuotationFieldKey, number | string | null>>
): ColumnMapping {
  const mapping: ColumnMapping = {
    supplierName: null,
    productName: null,
    quantity: null,
    unitPrice: null,
    gstPercentage: null,
    deliveryCharges: null,
    deliveryDays: null,
    paymentTerms: null,
    qualityRating: null,
  }

  const normalizedHeaders = headers.map((h) => normalizeHeaderString(h))
  const assignedColumnIndices = new Set<number>()

  // 1. Process custom overrides first if provided
  if (customMapping) {
    for (const [key, val] of Object.entries(customMapping)) {
      const fieldKey = key as QuotationFieldKey
      if (typeof val === 'number' && val >= 0 && val < headers.length) {
        mapping[fieldKey] = val
        assignedColumnIndices.add(val)
      } else if (typeof val === 'string') {
        const normVal = normalizeHeaderString(val)
        const colIdx = normalizedHeaders.findIndex((h) => h === normVal)
        if (colIdx !== -1) {
          mapping[fieldKey] = colIdx
          assignedColumnIndices.add(colIdx)
        }
      }
    }
  }

  // 2. Auto-detect remaining unassigned fields
  for (const field of SUPPORTED_FIELDS) {
    if (mapping[field.key] !== null) continue

    let bestColIdx: number | null = null
    let highestScore = 0

    normalizedHeaders.forEach((normHeader, colIdx) => {
      if (assignedColumnIndices.has(colIdx)) return

      // Exact match with field key or label
      if (normHeader === field.key.toLowerCase() || normHeader === field.label.toLowerCase()) {
        const score = 100
        if (score > highestScore) {
          highestScore = score
          bestColIdx = colIdx
        }
      }

      // Check aliases
      for (const alias of field.aliases) {
        const normAlias = normalizeHeaderString(alias)
        if (normHeader === normAlias) {
          const score = 95
          if (score > highestScore) {
            highestScore = score
            bestColIdx = colIdx
          }
        } else if (
          normHeader.includes(normAlias) ||
          (normAlias.length > 4 && normAlias.includes(normHeader))
        ) {
          const score = 70
          if (score > highestScore) {
            highestScore = score
            bestColIdx = colIdx
          }
        }
      }
    })

    if (bestColIdx !== null && highestScore >= 70) {
      mapping[field.key] = bestColIdx
      assignedColumnIndices.add(bestColIdx)
    }
  }

  return mapping
}

// ---------------------------------------------------------------------------
// 4. Data Normalization & Sanitization
// ---------------------------------------------------------------------------

/**
 * Trims whitespace, collapses internal whitespace, and cleans unprintable characters.
 */
export function normalizeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  let str = String(value).trim()
  // Strip control chars except standard newlines/tabs
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  return str
}

/**
 * Cleans currency symbols ($/₹/€/£/¥/Rs/INR), thousand commas, percentage signs (%),
 * and normalizes decimal separators.
 */
export function cleanNumericString(value: unknown): string {
  if (value === null || value === undefined) return ''
  let str = String(value).trim()

  // Remove currency symbols & words: $, ₹, €, £, ¥, Rs., Rs, INR, USD, EUR, etc.
  str = str.replace(/[$₹€£¥]/g, '')
  str = str.replace(/\brs\.?\s*/gi, '')
  str = str.replace(/\b(inr|usd|eur|gbp|aud|cad)\b/gi, '')

  // Remove percentage sign
  str = str.replace(/%/g, '')

  // Detect and handle European style decimals (e.g., 1.250,50 -> 1250.50)
  if (/^\d{1,3}(\.\d{3})+(,\d+)$/.test(str.trim())) {
    str = str.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+(,\d{1,2})$/.test(str.trim())) {
    // Single comma decimal (e.g. 12,50)
    str = str.replace(',', '.')
  } else {
    // Standard thousands separator (e.g. 1,000,000.50 or Indian 1,00,000.00)
    str = str.replace(/,/g, '')
  }

  // Remove spaces
  str = str.replace(/\s+/g, '')

  return str
}

/**
 * Parses numeric input with validation. Returns null if invalid or blank.
 */
export function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const cleaned = cleanNumericString(value)
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null
  const num = Number(cleaned)
  return isFinite(num) ? num : null
}

/**
 * Parses quality rating between 1 and 5.
 * Supports numbers, fractional ratings (4.5), star strings (e.g. "4/5", "4.5 out of 5").
 */
export function parseQualityRating(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  if (str === '') return null

  // Match pattern "X / 5" or "X out of 5"
  const fractionMatch = str.match(/^([\d.]+)\s*(?:\/|\bout of\b)\s*5$/i)
  if (fractionMatch) {
    const val = Number(fractionMatch[1])
    return isFinite(val) ? Math.round(val * 10) / 10 : null
  }

  // Count star characters (★)
  const starCount = (str.match(/★/g) || []).length
  if (starCount > 0 && starCount <= 5) {
    return starCount
  }

  const num = parseNumeric(str)
  if (num !== null) {
    return Math.round(num * 10) / 10
  }

  return null
}

// ---------------------------------------------------------------------------
// 5. Accurate Calculation Engine
// ---------------------------------------------------------------------------

/**
 * Precision-safe currency rounding to 2 decimal places.
 */
export function roundCurrency(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

/**
 * Computes exact financial metrics for a quotation row:
 * - Subtotal = Quantity * Unit price
 * - Tax amount = Subtotal * (GST % / 100)
 * - Delivery charges
 * - Total quotation cost = Subtotal + Tax amount + Delivery charges
 * - Effective unit cost = Total quotation cost / Quantity
 */
export function calculateQuotationItem(
  quantity: number,
  unitPrice: number,
  gstPercentage: number = 0,
  deliveryCharges: number = 0
): QuotationCalculations {
  const safeQty = Math.max(0, quantity)
  const safeUnitPrice = Math.max(0, unitPrice)
  const safeGst = Math.max(0, Math.min(100, gstPercentage))
  const safeDelivery = Math.max(0, deliveryCharges)

  const subtotal = roundCurrency(safeQty * safeUnitPrice)
  const taxAmount = roundCurrency(subtotal * (safeGst / 100))
  const totalCost = roundCurrency(subtotal + taxAmount + safeDelivery)
  const effectiveUnitCost = safeQty > 0 ? roundCurrency(totalCost / safeQty) : safeUnitPrice

  return {
    subtotal,
    gstPercentage: safeGst,
    taxAmount,
    deliveryCharges: safeDelivery,
    totalCost,
    effectiveUnitCost,
  }
}

// ---------------------------------------------------------------------------
// 6. Record Validation & Parsing Engine
// ---------------------------------------------------------------------------

/**
 * Validates and parses a single extracted quotation row against business rules.
 */
export function validateAndParseRow(
  rawRow: string[],
  headers: string[],
  mapping: ColumnMapping,
  rowNumber: number,
  index: number,
  options: ParseOptions = {}
): ParsedRowResult {
  const errors: CellValidationError[] = []
  const warnings: CellValidationError[] = []
  const rawValues: Record<string, string> = {}

  headers.forEach((h, colIdx) => {
    rawValues[h || `Col_${colIdx + 1}`] = rawRow[colIdx] ?? ''
  })

  const getMappedValue = (fieldKey: QuotationFieldKey): string => {
    const colIdx = mapping[fieldKey]
    if (colIdx === null || colIdx === undefined || colIdx >= rawRow.length) {
      return ''
    }
    return rawRow[colIdx] ?? ''
  }

  const getColName = (fieldKey: QuotationFieldKey): string => {
    const colIdx = mapping[fieldKey]
    if (colIdx !== null && colIdx !== undefined && colIdx < headers.length) {
      return headers[colIdx] || fieldKey
    }
    return fieldKey
  }

  // 1. Supplier Name (Required)
  const rawSupplier = getMappedValue('supplierName')
  const supplierName = normalizeString(rawSupplier)
  if (!supplierName) {
    errors.push({
      field: 'supplierName',
      columnName: getColName('supplierName'),
      columnIndex: mapping.supplierName ?? undefined,
      value: rawSupplier,
      message: 'Supplier name is required and cannot be empty.',
      severity: 'error',
    })
  }

  // 2. Product Name (Required)
  const rawProduct = getMappedValue('productName')
  const productName = normalizeString(rawProduct)
  if (!productName) {
    errors.push({
      field: 'productName',
      columnName: getColName('productName'),
      columnIndex: mapping.productName ?? undefined,
      value: rawProduct,
      message: 'Product / item name is required and cannot be empty.',
      severity: 'error',
    })
  }

  // 3. Quantity (Required, > 0)
  const rawQty = getMappedValue('quantity')
  const parsedQty = parseNumeric(rawQty)
  let quantity = 0

  if (rawQty.trim() === '' || parsedQty === null) {
    errors.push({
      field: 'quantity',
      columnName: getColName('quantity'),
      columnIndex: mapping.quantity ?? undefined,
      value: rawQty,
      message: 'Quantity is required and must be a valid number.',
      severity: 'error',
    })
  } else if (parsedQty <= 0) {
    errors.push({
      field: 'quantity',
      columnName: getColName('quantity'),
      columnIndex: mapping.quantity ?? undefined,
      value: rawQty,
      message: `Quantity must be greater than 0 (received: ${parsedQty}).`,
      severity: 'error',
    })
  } else {
    quantity = parsedQty
  }

  // 4. Unit Price (Required, >= 0)
  const rawUnitPrice = getMappedValue('unitPrice')
  const parsedPrice = parseNumeric(rawUnitPrice)
  let unitPrice = 0

  if (rawUnitPrice.trim() === '' || parsedPrice === null) {
    errors.push({
      field: 'unitPrice',
      columnName: getColName('unitPrice'),
      columnIndex: mapping.unitPrice ?? undefined,
      value: rawUnitPrice,
      message: 'Unit price is required and must be a valid number.',
      severity: 'error',
    })
  } else if (parsedPrice < 0) {
    errors.push({
      field: 'unitPrice',
      columnName: getColName('unitPrice'),
      columnIndex: mapping.unitPrice ?? undefined,
      value: rawUnitPrice,
      message: `Unit price cannot be negative (received: ${parsedPrice}).`,
      severity: 'error',
    })
  } else {
    unitPrice = parsedPrice
  }

  // 5. GST Percentage (Optional, >= 0 and <= 100)
  const rawGst = getMappedValue('gstPercentage')
  let gstPercentage = options.defaultGstPercentage ?? 0

  if (rawGst.trim() !== '') {
    const parsedGst = parseNumeric(rawGst)
    if (parsedGst === null) {
      warnings.push({
        field: 'gstPercentage',
        columnName: getColName('gstPercentage'),
        columnIndex: mapping.gstPercentage ?? undefined,
        value: rawGst,
        message: 'Invalid GST % value format; defaulted to 0%.',
        severity: 'warning',
      })
    } else if (parsedGst < 0 || parsedGst > 100) {
      errors.push({
        field: 'gstPercentage',
        columnName: getColName('gstPercentage'),
        columnIndex: mapping.gstPercentage ?? undefined,
        value: rawGst,
        message: `GST percentage must be between 0% and 100% (received: ${parsedGst}%).`,
        severity: 'error',
      })
    } else {
      gstPercentage = parsedGst
    }
  } else if (mapping.gstPercentage !== null) {
    warnings.push({
      field: 'gstPercentage',
      columnName: getColName('gstPercentage'),
      columnIndex: mapping.gstPercentage ?? undefined,
      value: '',
      message: 'GST % not specified; defaulted to 0%.',
      severity: 'warning',
    })
  }

  // 6. Delivery Charges (Optional, >= 0)
  const rawDelivery = getMappedValue('deliveryCharges')
  let deliveryCharges = options.defaultDeliveryCharges ?? 0

  if (rawDelivery.trim() !== '') {
    const parsedDelivery = parseNumeric(rawDelivery)
    if (parsedDelivery === null) {
      warnings.push({
        field: 'deliveryCharges',
        columnName: getColName('deliveryCharges'),
        columnIndex: mapping.deliveryCharges ?? undefined,
        value: rawDelivery,
        message: 'Invalid delivery charges format; defaulted to $0.',
        severity: 'warning',
      })
    } else if (parsedDelivery < 0) {
      errors.push({
        field: 'deliveryCharges',
        columnName: getColName('deliveryCharges'),
        columnIndex: mapping.deliveryCharges ?? undefined,
        value: rawDelivery,
        message: `Delivery charges cannot be negative (received: ${parsedDelivery}).`,
        severity: 'error',
      })
    } else {
      deliveryCharges = parsedDelivery
    }
  }

  // 7. Delivery Days (Optional, integer >= 0)
  const rawDays = getMappedValue('deliveryDays')
  let deliveryDays: number | null = null

  if (rawDays.trim() !== '') {
    const parsedDays = parseNumeric(rawDays)
    if (parsedDays === null || parsedDays < 0) {
      errors.push({
        field: 'deliveryDays',
        columnName: getColName('deliveryDays'),
        columnIndex: mapping.deliveryDays ?? undefined,
        value: rawDays,
        message: `Delivery days must be a non-negative number (received: ${rawDays}).`,
        severity: 'error',
      })
    } else {
      deliveryDays = Math.round(parsedDays)
      if (parsedDays !== deliveryDays) {
        warnings.push({
          field: 'deliveryDays',
          columnName: getColName('deliveryDays'),
          columnIndex: mapping.deliveryDays ?? undefined,
          value: rawDays,
          message: `Delivery days rounded to ${deliveryDays} days.`,
          severity: 'warning',
        })
      }
    }
  }

  // 8. Payment Terms (Optional string)
  const rawTerms = getMappedValue('paymentTerms')
  const paymentTerms = normalizeString(rawTerms) || options.defaultPaymentTerms || 'Net 30'

  // 9. Quality Rating (Optional, between 1 and 5)
  const rawRating = getMappedValue('qualityRating')
  let qualityRating: number | null = null

  if (rawRating.trim() !== '') {
    const parsedRating = parseQualityRating(rawRating)
    if (parsedRating === null || parsedRating < 1 || parsedRating > 5) {
      errors.push({
        field: 'qualityRating',
        columnName: getColName('qualityRating'),
        columnIndex: mapping.qualityRating ?? undefined,
        value: rawRating,
        message: `Quality rating must be between 1.0 and 5.0 (received: ${rawRating}).`,
        severity: 'error',
      })
    } else {
      qualityRating = parsedRating
    }
  }

  const isValid = errors.length === 0

  let parsedData: ParsedQuotationItemData | null = null
  let calculated: QuotationCalculations | null = null

  if (isValid) {
    calculated = calculateQuotationItem(
      quantity,
      unitPrice,
      gstPercentage,
      deliveryCharges
    )

    parsedData = {
      supplierName,
      productName,
      quantity,
      unitPrice,
      gstPercentage,
      deliveryCharges,
      deliveryDays,
      paymentTerms,
      qualityRating,
    }
  }

  return {
    rowNumber,
    index,
    rawValues,
    parsedData,
    calculated,
    isValid,
    errors,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// 7. Duplicate Detection Engine
// ---------------------------------------------------------------------------

/**
 * Checks for intra-file duplicates (same supplier + same product) and
 * existing quotation database records.
 */
export function checkDuplicates(
  rows: ParsedRowResult[],
  existingQuotations: ExistingQuotationRecord[] = [],
  allowDuplicates: boolean = false
): void {
  const seenItems = new Map<string, number>() // key -> first rowNumber seen

  for (const row of rows) {
    if (!row.parsedData) continue

    const suppNorm = normalizeString(row.parsedData.supplierName).toLowerCase()
    const prodNorm = normalizeString(row.parsedData.productName).toLowerCase()
    const itemKey = `${suppNorm}:::${prodNorm}`

    // 1. Intra-file duplicate check
    if (seenItems.has(itemKey)) {
      const prevRow = seenItems.get(itemKey)!
      row.isDuplicate = true
      row.duplicateDetails = `Duplicate item in file: "${row.parsedData.productName}" for supplier "${row.parsedData.supplierName}" was already defined on row ${prevRow}.`

      if (allowDuplicates) {
        row.warnings.push({
          field: 'productName',
          value: row.parsedData.productName,
          message: row.duplicateDetails,
          severity: 'warning',
        })
      } else {
        row.isValid = false
        row.errors.push({
          field: 'productName',
          value: row.parsedData.productName,
          message: row.duplicateDetails,
          severity: 'error',
        })
      }
    } else {
      seenItems.set(itemKey, row.rowNumber)
    }

    // 2. Existing database quotation check
    const existingMatch = existingQuotations.find((ex) => {
      const exSuppNorm = normalizeString(ex.supplierName).toLowerCase()
      if (exSuppNorm !== suppNorm) return false
      if (ex.productName) {
        return normalizeString(ex.productName).toLowerCase() === prodNorm
      }
      return true
    })

    if (existingMatch) {
      const detail = existingMatch.productName
        ? `Quotation for supplier "${row.parsedData.supplierName}" and item "${row.parsedData.productName}" already exists in the database.`
        : `A quotation from supplier "${row.parsedData.supplierName}" already exists for this purchase request.`

      row.warnings.push({
        field: 'supplierName',
        value: row.parsedData.supplierName,
        message: detail,
        severity: 'warning',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Supplier Grouping & Financial Aggregation
// ---------------------------------------------------------------------------

/**
 * Groups valid parsed quotation rows by supplier and aggregates financial totals.
 */
export function groupItemsBySupplier(
  validRows: ParsedRowResult[]
): SupplierQuotationGroup[] {
  const groupsMap = new Map<string, SupplierQuotationGroup>()

  for (const row of validRows) {
    if (!row.parsedData || !row.calculated) continue

    const normSupplier = normalizeString(row.parsedData.supplierName).toLowerCase()
    let group = groupsMap.get(normSupplier)

    if (!group) {
      group = {
        supplierName: row.parsedData.supplierName,
        supplierRating: row.parsedData.qualityRating,
        paymentTerms: row.parsedData.paymentTerms,
        maxDeliveryDays: row.parsedData.deliveryDays,
        items: [],
        totalSubtotal: 0,
        totalTaxAmount: 0,
        totalDeliveryCharges: 0,
        totalQuotationCost: 0,
        itemCount: 0,
      }
      groupsMap.set(normSupplier, group)
    }

    group.items.push(row)
    group.itemCount++
    group.totalSubtotal = roundCurrency(group.totalSubtotal + row.calculated.subtotal)
    group.totalTaxAmount = roundCurrency(group.totalTaxAmount + row.calculated.taxAmount)
    group.totalDeliveryCharges = roundCurrency(
      group.totalDeliveryCharges + row.calculated.deliveryCharges
    )
    group.totalQuotationCost = roundCurrency(
      group.totalQuotationCost + row.calculated.totalCost
    )

    // Update max delivery days
    if (row.parsedData.deliveryDays !== null) {
      if (group.maxDeliveryDays === null || row.parsedData.deliveryDays > group.maxDeliveryDays) {
        group.maxDeliveryDays = row.parsedData.deliveryDays
      }
    }

    // Retain non-null quality rating
    if (row.parsedData.qualityRating !== null && group.supplierRating === null) {
      group.supplierRating = row.parsedData.qualityRating
    }
  }

  return Array.from(groupsMap.values())
}

// ---------------------------------------------------------------------------
// 9. Main End-to-End Quotation CSV Parser
// ---------------------------------------------------------------------------

/**
 * Parses raw CSV text into structured, validated, calculated quotation items.
 */
export function parseQuotationCsv(
  csvContent: string,
  options: ParseOptions = {}
): QuotationParseResult {
  const detectedDelimiter =
    options.delimiter && options.delimiter !== 'auto'
      ? options.delimiter
      : detectDelimiter(csvContent)

  const rawRows = parseCsvToRawRows(csvContent, detectedDelimiter)

  if (rawRows.length === 0) {
    return {
      headers: [],
      detectedDelimiter,
      columnMapping: {
        supplierName: null,
        productName: null,
        quantity: null,
        unitPrice: null,
        gstPercentage: null,
        deliveryCharges: null,
        deliveryDays: null,
        paymentTerms: null,
        qualityRating: null,
      },
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      rows: [],
      supplierGroups: [],
      summary: {
        totalRows: 0,
        validCount: 0,
        warningCount: 0,
        errorCount: 0,
        uniqueSuppliers: [],
        totalEstimatedValue: 0,
        hasCriticalErrors: false,
      },
    }
  }

  // Row 0 is the header row
  const rawHeaders = rawRows[0]
  const headers = rawHeaders.map((h, i) => (h.trim() ? h.trim() : `Column ${i + 1}`))

  // Detect or apply column mapping
  const columnMapping = detectColumnMapping(headers, options.customMapping)

  // Data rows start from row index 1 (line 2 in CSV)
  const dataRows = rawRows.slice(1)
  const parsedRows: ParsedRowResult[] = []

  dataRows.forEach((row, idx) => {
    // Skip row if completely empty
    if (row.every((cell) => cell.trim().length === 0)) {
      return
    }

    const rowNumber = idx + 2 // 1-based, accounting for header
    const parsedRow = validateAndParseRow(
      row,
      headers,
      columnMapping,
      rowNumber,
      idx,
      options
    )
    parsedRows.push(parsedRow)
  })

  // Duplicate checks
  checkDuplicates(
    parsedRows,
    options.existingQuotations ?? [],
    options.allowDuplicates ?? false
  )

  const validRows = parsedRows.filter((r) => r.isValid)
  const invalidRows = parsedRows.filter((r) => !r.isValid)
  const supplierGroups = groupItemsBySupplier(validRows)

  const uniqueSuppliers = Array.from(
    new Set(
      validRows
        .map((r) => r.parsedData?.supplierName)
        .filter((s): s is string => Boolean(s))
    )
  )

  const totalEstimatedValue = roundCurrency(
    supplierGroups.reduce((acc, g) => acc + g.totalQuotationCost, 0)
  )

  const warningCount = parsedRows.reduce((acc, r) => acc + r.warnings.length, 0)
  const errorCount = parsedRows.reduce((acc, r) => acc + r.errors.length, 0)

  return {
    headers,
    detectedDelimiter,
    columnMapping,
    totalRows: parsedRows.length,
    validRows,
    invalidRows,
    rows: parsedRows,
    supplierGroups,
    summary: {
      totalRows: parsedRows.length,
      validCount: validRows.length,
      warningCount,
      errorCount,
      uniqueSuppliers,
      totalEstimatedValue,
      hasCriticalErrors: invalidRows.length > 0,
    },
  }
}

// ---------------------------------------------------------------------------
// 10. Sample CSV Template Generator
// ---------------------------------------------------------------------------

/**
 * Generates an RFC 4180 compliant CSV string for template downloads.
 */
export function generateSampleQuotationCsv(): string {
  const headers = [
    'Supplier Name',
    'Product Name',
    'Quantity',
    'Unit Price',
    'GST %',
    'Delivery Charges',
    'Delivery Days',
    'Payment Terms',
    'Quality Rating',
  ]

  const rows = [
    [
      'Acme Industrial Supplies',
      'High Precision Ball Bearings (10mm)',
      '100',
      '45.50',
      '18',
      '250.00',
      '7',
      'Net 30',
      '4.8',
    ],
    [
      'Acme Industrial Supplies',
      'Stainless Steel Hex Bolts M8 x 40mm',
      '500',
      '3.20',
      '18',
      '0.00',
      '7',
      'Net 30',
      '4.8',
    ],
    [
      'Apex Tech Solutions',
      'High Precision Ball Bearings (10mm)',
      '100',
      '42.00',
      '12',
      '300.00',
      '5',
      'Net 15',
      '4.5',
    ],
    [
      'Apex Tech Solutions',
      'Stainless Steel Hex Bolts M8 x 40mm',
      '500',
      '3.50',
      '12',
      '50.00',
      '5',
      'Net 15',
      '4.5',
    ],
    [
      'Global Dynamics Corp',
      'High Precision Ball Bearings (10mm)',
      '100',
      '48.00',
      '18',
      '150.00',
      '10',
      'Advance',
      '4.2',
    ],
  ]

  const escapeCell = (cell: string) => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`
    }
    return cell
  }

  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ]

  return lines.join('\r\n')
}
