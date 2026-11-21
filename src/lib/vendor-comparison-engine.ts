/**
 * ProcureLens - Deterministic Smart Vendor Comparison Engine
 *
 * Zero-AI, 100% deterministic multi-criteria vendor evaluation engine.
 *
 * Implements Requirements (1-10):
 * 1. Compares quotations belonging strictly to the same Purchase Request.
 * 2. Verifies product specifications, units, currencies, and quantities across
 *    quotations and against the Purchase Request (`isComparable`, `warnings`, `mismatches`).
 * 3. Precision-safe total purchase cost calculation (items subtotal + tax + delivery).
 * 4. Score normalization (0 to 100) for Cost, Delivery, Quality, Payment Terms, Reliability
 *    with explicit, non-hallucinated handling of missing fields.
 * 5. Standard weights: Cost 40%, Delivery 25%, Quality 20%, Payment Terms 10%, Reliability 5%
 *    (with optional custom weight normalization).
 * 6. Weighted final score:
 *    Final = (Cost * 0.40) + (Delivery * 0.25) + (Quality * 0.20) + (PaymentTerms * 0.10) + (Reliability * 0.05)
 * 7. Deterministic supplier ranking (1st, 2nd, 3rd, ...) with explicit tie-breakers.
 * 8. Individual scoring explanation generator per supplier with exact point breakdown.
 * 9. DeepSpace persistence service for saving results into the `comparisons` collection.
 */

import type { Comparison, ComparisonStatus } from '@/schemas/comparisons-schema'
import type { PurchaseRequest } from '@/schemas/purchase-requests-schema'
import type { Quotation } from '@/schemas/quotations-schema'
import type { QuotationItem } from '@/schemas/quotation-items-schema'
import type { Supplier } from '@/schemas/suppliers-schema'

// ---------------------------------------------------------------------------
// 1. Constants & Scoring Configuration
// ---------------------------------------------------------------------------

export type FactorKey = 'cost' | 'delivery' | 'quality' | 'paymentTerms' | 'reliability'

export interface ComparisonWeights {
  cost: number
  delivery: number
  quality: number
  paymentTerms: number
  reliability: number
}

/**
 * Standard deterministic evaluation weights (sum = 1.00 / 100%).
 */
export const DEFAULT_COMPARISON_WEIGHTS: Readonly<ComparisonWeights> = Object.freeze({
  cost: 0.4,
  delivery: 0.25,
  quality: 0.2,
  paymentTerms: 0.1,
  reliability: 0.05,
})

/**
 * Disclosed neutral score applied when an optional non-cost evaluation
 * attribute (delivery days, quality rating, payment terms, reliability) is missing.
 * Missing pricing is never given a neutral reward (scores 0).
 */
export const DEFAULT_MISSING_NEUTRAL_SCORE = 50

export const MISSING_VALUE_LABEL = 'Unrated / Missing'

export interface PaymentTermsTier {
  key: string
  label: string
  days: number | null
  score: number
  description: string
}

/**
 * Standard credit ladder for payment terms scoring (0 to 100).
 */
export const PAYMENT_TERMS_LADDER: readonly PaymentTermsTier[] = Object.freeze([
  { key: 'net_90', label: 'Net 90', days: 90, score: 100, description: '90 days post-invoice credit (highest buyer liquidity)' },
  { key: 'net_60', label: 'Net 60', days: 60, score: 85, description: '60 days post-invoice credit' },
  { key: 'net_45', label: 'Net 45', days: 45, score: 75, description: '45 days post-invoice credit' },
  { key: 'net_30', label: 'Net 30', days: 30, score: 60, description: '30 days standard commercial credit' },
  { key: 'net_15', label: 'Net 15', days: 15, score: 45, description: '15 days short-term credit' },
  { key: 'immediate', label: 'Immediate', days: 0, score: 30, description: 'Due on receipt / Cash on delivery (COD)' },
  { key: 'advance', label: 'Advance', days: -1, score: 15, description: 'Advance payment / Prepayment required' },
])

export const TIE_BREAKER_HIERARCHY: readonly string[] = Object.freeze([
  '1. Higher Final Weighted Score (0-100)',
  '2. Lower Total Purchase Cost (highest-weighted procurement factor)',
  '3. Faster Delivery Time (fewer delivery days)',
  '4. Higher Quality Rating (0-5 scale)',
  '5. Better Payment Terms Score (credit ladder)',
  '6. Higher Supplier Reliability Score (0-100)',
  '7. Deterministic alphabetical Supplier Name, then Quotation ID',
])

export const FACTOR_LABELS: Readonly<Record<FactorKey, string>> = Object.freeze({
  cost: 'Total Cost',
  delivery: 'Delivery Time',
  quality: 'Quality Rating',
  paymentTerms: 'Payment Terms',
  reliability: 'Supplier Reliability',
})

// ---------------------------------------------------------------------------
// 2. Input & Output Interfaces
// ---------------------------------------------------------------------------

export interface DeepSpaceRecord<T> {
  recordId: string
  data: T
}

export interface PurchaseRequestInput {
  id: string
  organizationId?: string
  title: string
  description?: string
  category?: string
  quantity?: number
  unit?: string
  estimatedBudget?: number
  requiredByDate?: string
  status?: string
}

export interface ComparisonQuotationItemInput {
  id?: string
  description: string
  quantity?: number
  unitPrice?: number
  totalPrice?: number
  unit?: string
  specifications?: string
  gstPercentage?: number
  taxAmount?: number
  deliveryCharges?: number
  qualityRating?: number | null
}

export interface ComparisonSupplierInput {
  id: string
  name: string
  rating?: number | null
  status?: string
  category?: string
  email?: string
  /** Optional on-time delivery rate percentage (0 to 100). */
  onTimeDeliveryRate?: number | null
  /** Optional explicit reliability score (0 to 100). */
  reliabilityScore?: number | null
  /** Optional count of completed orders for provenance display. */
  completedOrders?: number | null
}

export interface ComparisonQuotationInput {
  quotationId: string
  purchaseRequestId: string
  organizationId?: string
  supplierId: string
  supplierName: string
  totalAmount?: number | null
  currency?: string
  validUntil?: string
  deliveryDays?: number | null
  paymentTerms?: string | null
  status?: string
  notes?: string
  /** Optional explicit cost components when items are not broken out */
  itemsSubtotal?: number
  taxAmount?: number
  deliveryCharges?: number
  /** Optional explicit quality rating override (0 to 5) */
  qualityRating?: number | null
  /** Optional explicit reliability override (0 to 100) */
  reliabilityScore?: number | null
  /** Optional linked line items from `quotation_items` */
  items?: ComparisonQuotationItemInput[]
  /** Optional linked supplier from `suppliers` */
  supplier?: ComparisonSupplierInput | null
}

export type ComparabilitySeverity = 'warning' | 'mismatch'

export type ComparabilityIssueCode =
  | 'PR_MISMATCH'
  | 'ORG_MISMATCH'
  | 'INSUFFICIENT_QUOTATIONS'
  | 'CURRENCY_MISMATCH'
  | 'QUANTITY_MISMATCH_PR'
  | 'QUANTITY_MISMATCH_CROSS_VENDOR'
  | 'UNIT_MISMATCH_PR'
  | 'UNIT_MISMATCH_CROSS_VENDOR'
  | 'SPECIFICATION_MISMATCH'
  | 'ITEM_COUNT_MISMATCH'
  | 'MISSING_PRICING'
  | 'MISSING_DELIVERY_DAYS'
  | 'MISSING_QUALITY_RATING'
  | 'MISSING_PAYMENT_TERMS'
  | 'MISSING_RELIABILITY'
  | 'SUPPLIER_STATUS_WARNING'

export interface ComparabilityIssue {
  code: ComparabilityIssueCode
  severity: ComparabilitySeverity
  message: string
  quotationIds: string[]
  supplierNames: string[]
  expected?: string | number
  actual?: string | number
}

export interface ComparabilityReport {
  isComparable: boolean
  warnings: ComparabilityIssue[]
  mismatches: ComparabilityIssue[]
  summary: string
  checkedQuotationCount: number
  prRequestedQuantity: number | null
  prRequestedUnit: string | null
}

export interface CostLineItemBreakdown {
  description: string
  quantity: number
  unit: string
  unitPrice: number
  subtotal: number
  gstPercentage: number
  taxAmount: number
  deliveryCharges: number
  lineTotal: number
}

export interface CostBreakdown {
  itemsSubtotal: number
  taxAmount: number
  deliveryCharges: number
  totalPurchaseCost: number | null
  effectiveUnitCost: number | null
  totalQuantity: number | null
  currency: string
  source: 'items_breakdown' | 'quotation_total' | 'hybrid' | 'missing'
  itemBreakdown: CostLineItemBreakdown[]
}

export interface FactorScoreDetail {
  factor: FactorKey
  label: string
  rawValue: number | string | null
  displayValue: string
  normalizedScore: number
  weight: number
  weightPercent: number
  weightedPoints: number
  formula: string
  calculationStep: string
  isMissing: boolean
  missingDisclosure?: string
  sourceDescription: string
}

export interface VendorScoreExplanation {
  headline: string
  summary: string
  formulaEquation: string
  factorBreakdowns: FactorScoreDetail[]
  strengths: string[]
  weaknesses: string[]
  missingDataNotes: string[]
  tieBreakerNote?: string
}

export interface RankedVendorResult {
  rank: number
  rankLabel: string
  quotationId: string
  purchaseRequestId: string
  supplierId: string
  supplierName: string
  supplierStatus?: string
  currency: string
  costBreakdown: CostBreakdown
  rawMetrics: {
    totalPurchaseCost: number | null
    deliveryDays: number | null
    qualityRating: number | null
    paymentTerms: string | null
    paymentTermsTier: string | null
    reliabilityRaw: number | null
  }
  normalizedScores: Record<FactorKey, number>
  weightedContributions: Record<FactorKey, number>
  factors: Record<FactorKey, FactorScoreDetail>
  finalScore: number
  scoreGapFromLeader: number
  costDeltaVsCheapest: number | null
  costSavingsVsHighest: number | null
  isRecommended: boolean
  hasMissingData: boolean
  missingFields: FactorKey[]
  tieBreakerApplied: string | null
  explanation: VendorScoreExplanation
}

export interface ComparisonBenchmarks {
  minCost: number | null
  maxCost: number | null
  avgCost: number | null
  minDeliveryDays: number | null
  maxDeliveryDays: number | null
  highestQualityRating: number | null
  bestPaymentTermsScore: number | null
  highestReliabilityScore: number | null
}

export interface ScoringMethodology {
  deterministic: true
  usesAI: false
  weights: ComparisonWeights
  weightPercentages: Record<FactorKey, number>
  missingDataPolicy: string
  factors: Array<{
    factor: FactorKey
    label: string
    weight: number
    weightPercent: number
    direction: 'lower_is_better' | 'higher_is_better'
    formula: string
    missingHandling: string
  }>
  paymentTermsLadder: readonly PaymentTermsTier[]
  tieBreakers: readonly string[]
}

export interface CompareVendorOptions {
  /** Custom weights (fractions summing to 1 or percentages summing to 100). Defaults to standard 40/25/20/10/5. */
  weights?: Partial<ComparisonWeights>
  /**
   * When true (default), throws an error if any quotation belongs to a different Purchase Request.
   * When false, filters out mismatched quotations and reports a PR_MISMATCH in the comparability report.
   */
  strictPrMatch?: boolean
  /**
   * Cost normalization strategy:
   * - 'ratio' (default): (minCost / cost) * 100
   * - 'range': relative to [minCost, maxCost] linear range
   */
  costNormalizationMode?: 'ratio' | 'range'
  /**
   * Disclosed neutral score for missing non-cost metrics (default 50).
   */
  missingNeutralScore?: number
}

export interface VendorComparisonResult {
  purchaseRequestId: string
  purchaseRequestTitle: string
  currency: string
  comparedAt: string
  weights: ComparisonWeights
  isStandardWeights: boolean
  comparability: ComparabilityReport
  benchmarks: ComparisonBenchmarks
  rankings: RankedVendorResult[]
  recommendedVendor: RankedVendorResult | null
  quotationIds: string[]
  methodology: ScoringMethodology
  summary: string
}

// ---------------------------------------------------------------------------
// 3. Precision & Formatting Utilities
// ---------------------------------------------------------------------------

/**
 * Precision-safe currency rounding to 2 decimal places.
 */
export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Precision-safe score rounding to 2 decimal places, clamped to [0, 100].
 */
export function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  const clamped = Math.max(0, Math.min(100, value))
  return Math.round((clamped + Number.EPSILON) * 100) / 100
}

/**
 * Precision-safe weight rounding to 4 decimal places.
 */
function roundWeight(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

/**
 * Converts a positive integer rank into an ordinal label ("1st", "2nd", "3rd", "4th"...).
 */
export function formatOrdinalRank(rank: number): string {
  const mod100 = rank % 100
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`
  switch (rank % 10) {
    case 1:
      return `${rank}st`
    case 2:
      return `${rank}nd`
    case 3:
      return `${rank}rd`
    default:
      return `${rank}th`
  }
}

/**
 * Formats a currency number deterministically for explanations.
 */
export function formatCurrencyValue(amount: number, currency = 'USD'): string {
  const symbolMap: Record<string, string> = {
    USD: '$',
    INR: '₹',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
  }
  const code = (currency || 'USD').toUpperCase()
  const symbol = symbolMap[code] ?? `${code} `
  return `${symbol}${roundCurrency(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

// ---------------------------------------------------------------------------
// 4. Unit & Specification Parsing Helpers
// ---------------------------------------------------------------------------

const UNIT_ALIAS_MAP: Record<string, string> = {
  pc: 'unit',
  pcs: 'unit',
  piece: 'unit',
  pieces: 'unit',
  ea: 'unit',
  each: 'unit',
  unit: 'unit',
  units: 'unit',
  item: 'unit',
  items: 'unit',
  nos: 'unit',
  no: 'unit',
  kg: 'kg',
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  g: 'g',
  gm: 'g',
  gram: 'g',
  grams: 'g',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ton: 'ton',
  tons: 'ton',
  tonne: 'ton',
  tonnes: 'ton',
  mt: 'ton',
  l: 'liter',
  ltr: 'liter',
  ltrs: 'liter',
  liter: 'liter',
  liters: 'liter',
  litre: 'liter',
  litres: 'liter',
  ml: 'ml',
  m: 'meter',
  mtr: 'meter',
  meter: 'meter',
  meters: 'meter',
  metre: 'meter',
  metres: 'meter',
  cm: 'cm',
  mm: 'mm',
  ft: 'ft',
  feet: 'ft',
  foot: 'ft',
  box: 'box',
  boxes: 'box',
  pack: 'pack',
  packs: 'pack',
  pkt: 'pack',
  set: 'set',
  sets: 'set',
  carton: 'carton',
  cartons: 'carton',
  pallet: 'pallet',
  pallets: 'pallet',
  roll: 'roll',
  rolls: 'roll',
  hour: 'hour',
  hours: 'hour',
  hr: 'hour',
  hrs: 'hour',
  day: 'day',
  days: 'day',
  license: 'license',
  licenses: 'license',
  seat: 'seat',
  seats: 'seat',
}

/**
 * Canonicalizes a measurement unit so equivalent labels (e.g., "pcs", "units", "each")
 * compare as equal while genuine mismatches (e.g., "kg" vs "boxes") are caught.
 */
export function canonicalizeUnit(unit?: string | null): string | null {
  if (!unit) return null
  const cleaned = unit.trim().toLowerCase().replace(/\.$/, '')
  if (!cleaned) return null
  return UNIT_ALIAS_MAP[cleaned] ?? cleaned
}

/**
 * Keys stored inside `quotation_items.specifications` JSON by the CSV importer
 * that represent financial/commercial metadata rather than technical product specs.
 */
const COMMERCIAL_METADATA_SPEC_KEYS = new Set([
  'gstpercentage',
  'taxamount',
  'deliverycharges',
  'deliverydays',
  'paymentterms',
  'qualityrating',
  'effectiveunitcost',
])

interface ParsedItemSpecMetadata {
  gstPercentage?: number
  taxAmount?: number
  deliveryCharges?: number
  deliveryDays?: number
  paymentTerms?: string
  qualityRating?: number
  technicalSpecs: Record<string, string>
  rawTechnicalText: string | null
}

/**
 * Safely parses `QuotationItem.specifications` whether it is plain text or the
 * JSON metadata object produced by `quotation-import.service.ts`.
 */
function parseItemSpecifications(specRaw?: string | null): ParsedItemSpecMetadata {
  const result: ParsedItemSpecMetadata = {
    technicalSpecs: {},
    rawTechnicalText: null,
  }

  if (!specRaw || !specRaw.trim()) return result

  const trimmed = specRaw.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof parsed.gstPercentage === 'number' && Number.isFinite(parsed.gstPercentage)) {
          result.gstPercentage = parsed.gstPercentage
        }
        if (typeof parsed.taxAmount === 'number' && Number.isFinite(parsed.taxAmount)) {
          result.taxAmount = parsed.taxAmount
        }
        if (typeof parsed.deliveryCharges === 'number' && Number.isFinite(parsed.deliveryCharges)) {
          result.deliveryCharges = parsed.deliveryCharges
        }
        if (typeof parsed.deliveryDays === 'number' && Number.isFinite(parsed.deliveryDays)) {
          result.deliveryDays = parsed.deliveryDays
        }
        if (typeof parsed.paymentTerms === 'string' && parsed.paymentTerms.trim()) {
          result.paymentTerms = parsed.paymentTerms.trim()
        }
        if (typeof parsed.qualityRating === 'number' && Number.isFinite(parsed.qualityRating)) {
          result.qualityRating = parsed.qualityRating
        }

        // Extract any genuine technical specification keys (excluding commercial metadata & empty notes)
        for (const [k, v] of Object.entries(parsed)) {
          const lowerKey = k.toLowerCase()
          if (COMMERCIAL_METADATA_SPEC_KEYS.has(lowerKey)) continue
          if (v === null || v === undefined) continue
          const strVal = String(v).trim()
          if (!strVal) continue
          result.technicalSpecs[lowerKey] = strVal.toLowerCase()
        }

        const techKeys = Object.keys(result.technicalSpecs).sort()
        if (techKeys.length > 0) {
          result.rawTechnicalText = techKeys.map((k) => `${k}:${result.technicalSpecs[k]}`).join('|')
        }
        return result
      }
    } catch {
      // Not valid JSON; treat as plain specification text below.
    }
  }

  result.rawTechnicalText = trimmed.toLowerCase().replace(/\s+/g, ' ')
  return result
}

function normalizeProductText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeProductText(text: string): Set<string> {
  const stopWords = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'with', 'in', 'to', 'by', 'per'])
  const tokens = normalizeProductText(text)
    .split(' ')
    .filter((t) => t.length > 1 && !stopWords.has(t))
  return new Set(tokens)
}

/**
 * Jaccard token similarity (0 to 1) used deterministically to detect clearly
 * mismatched product descriptions across quotations.
 */
function tokenJaccardSimilarity(a: string, b: string): number {
  const setA = tokenizeProductText(a)
  const setB = tokenizeProductText(b)
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ---------------------------------------------------------------------------
// 5. Requirement 1: Purchase Request Filtering & DeepSpace Record Mapping
// ---------------------------------------------------------------------------

/**
 * Separates quotations belonging to a given Purchase Request from any mismatched ones.
 */
export function filterQuotationsForPurchaseRequest(
  purchaseRequestId: string,
  quotations: ComparisonQuotationInput[]
): {
  matching: ComparisonQuotationInput[]
  mismatched: ComparisonQuotationInput[]
} {
  const matching: ComparisonQuotationInput[] = []
  const mismatched: ComparisonQuotationInput[] = []

  for (const q of quotations) {
    if (q.purchaseRequestId === purchaseRequestId) {
      matching.push(q)
    } else {
      mismatched.push(q)
    }
  }

  return { matching, mismatched }
}

/**
 * Maps raw DeepSpace collection records (from `useOrgQuery`) into typed engine inputs
 * for a specific Purchase Request.
 */
export function buildComparisonInputsFromRecords(params: {
  purchaseRequestRecord: DeepSpaceRecord<PurchaseRequest>
  quotationRecords: DeepSpaceRecord<Quotation>[]
  quotationItemRecords?: DeepSpaceRecord<QuotationItem>[]
  supplierRecords?: DeepSpaceRecord<Supplier>[]
  selectedQuotationIds?: string[]
}): {
  purchaseRequest: PurchaseRequestInput
  quotations: ComparisonQuotationInput[]
} {
  const {
    purchaseRequestRecord,
    quotationRecords,
    quotationItemRecords = [],
    supplierRecords = [],
    selectedQuotationIds,
  } = params

  const prId = purchaseRequestRecord.recordId
  const prData = purchaseRequestRecord.data

  const purchaseRequest: PurchaseRequestInput = {
    id: prId,
    organizationId: prData.organizationId,
    title: prData.title,
    description: prData.description,
    category: prData.category,
    quantity: prData.quantity,
    unit: prData.unit,
    estimatedBudget: prData.estimatedBudget,
    requiredByDate: prData.requiredByDate,
    status: prData.status,
  }

  // Index suppliers by recordId and lowercase name
  const supplierById = new Map<string, ComparisonSupplierInput>()
  const supplierByName = new Map<string, ComparisonSupplierInput>()
  for (const sr of supplierRecords) {
    const mapped: ComparisonSupplierInput = {
      id: sr.recordId,
      name: sr.data.name,
      rating: sr.data.rating ?? null,
      status: sr.data.status,
      category: sr.data.category,
      email: sr.data.email,
    }
    supplierById.set(sr.recordId, mapped)
    if (sr.data.name) {
      supplierByName.set(sr.data.name.trim().toLowerCase(), mapped)
    }
  }

  // Group line items by quotationId
  const itemsByQuotationId = new Map<string, ComparisonQuotationItemInput[]>()
  for (const ir of quotationItemRecords) {
    const qId = ir.data.quotationId
    if (!qId) continue
    const list = itemsByQuotationId.get(qId) ?? []
    list.push({
      id: ir.recordId,
      description: ir.data.description,
      quantity: ir.data.quantity,
      unitPrice: ir.data.unitPrice,
      totalPrice: ir.data.totalPrice,
      unit: ir.data.unit,
      specifications: ir.data.specifications,
    })
    itemsByQuotationId.set(qId, list)
  }

  const selectedSet = selectedQuotationIds ? new Set(selectedQuotationIds) : null

  const quotations: ComparisonQuotationInput[] = quotationRecords
    .filter((qr) => {
      if (selectedSet) return selectedSet.has(qr.recordId)
      return qr.data.purchaseRequestId === prId
    })
    .map((qr) => {
      const qData = qr.data
      const linkedSupplier =
        supplierById.get(qData.supplierId) ??
        (qData.supplierName ? supplierByName.get(qData.supplierName.trim().toLowerCase()) : undefined) ??
        null

      return {
        quotationId: qr.recordId,
        purchaseRequestId: qData.purchaseRequestId,
        organizationId: qData.organizationId,
        supplierId: qData.supplierId,
        supplierName: qData.supplierName || linkedSupplier?.name || `Supplier ${qData.supplierId.slice(0, 6)}`,
        totalAmount: qData.totalAmount ?? null,
        currency: qData.currency || 'USD',
        validUntil: qData.validUntil,
        deliveryDays: qData.deliveryDays ?? null,
        paymentTerms: qData.paymentTerms ?? null,
        status: qData.status,
        notes: qData.notes,
        items: itemsByQuotationId.get(qr.recordId) ?? [],
        supplier: linkedSupplier,
      }
    })

  return { purchaseRequest, quotations }
}

// ---------------------------------------------------------------------------
// 6. Requirement 3: Total Purchase Cost Calculation
// ---------------------------------------------------------------------------

/**
 * Parses optional subtotal/tax/delivery summary from quotation notes when no line items exist.
 */
function parseCostSummaryFromNotes(
  notes?: string
): { subtotal: number; tax: number; delivery: number } | null {
  if (!notes) return null
  const match = notes.match(
    /Subtotal:\s*([\d.,]+).*?Tax:\s*([\d.,]+).*?Delivery:\s*([\d.,]+)/i
  )
  if (!match) return null
  const subtotal = Number(match[1].replace(/,/g, ''))
  const tax = Number(match[2].replace(/,/g, ''))
  const delivery = Number(match[3].replace(/,/g, ''))
  if (!Number.isFinite(subtotal) || !Number.isFinite(tax) || !Number.isFinite(delivery)) {
    return null
  }
  return {
    subtotal: roundCurrency(subtotal),
    tax: roundCurrency(tax),
    delivery: roundCurrency(delivery),
  }
}

/**
 * Calculates total purchase cost = sum of item subtotals + taxes + delivery charges.
 * Handles detailed line items (including CSV-imported JSON specifications) as well as
 * summary-only quotation records.
 */
export function calculateTotalPurchaseCost(quotation: ComparisonQuotationInput): CostBreakdown {
  const currency = (quotation.currency || 'USD').toUpperCase()
  const items = quotation.items ?? []

  if (items.length > 0) {
    let itemsSubtotal = 0
    let taxAmount = 0
    let itemDeliveryCharges = 0
    let totalQuantity = 0
    let hasValidLinePricing = false
    const itemBreakdown: CostLineItemBreakdown[] = []

    for (const item of items) {
      const specMeta = parseItemSpecifications(item.specifications)
      const quantity = typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0
        ? item.quantity
        : 0
      totalQuantity += quantity

      const gstPercentage =
        typeof item.gstPercentage === 'number' && Number.isFinite(item.gstPercentage)
          ? item.gstPercentage
          : specMeta.gstPercentage ?? 0

      const delivery =
        typeof item.deliveryCharges === 'number' && Number.isFinite(item.deliveryCharges)
          ? roundCurrency(Math.max(0, item.deliveryCharges))
          : specMeta.deliveryCharges !== undefined
            ? roundCurrency(Math.max(0, specMeta.deliveryCharges))
            : 0

      let unitPrice = 0
      let subtotal = 0
      let tax = 0

      if (typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) && item.unitPrice >= 0 && quantity > 0) {
        unitPrice = item.unitPrice
        subtotal = roundCurrency(quantity * unitPrice)
        tax =
          typeof item.taxAmount === 'number' && Number.isFinite(item.taxAmount)
            ? roundCurrency(Math.max(0, item.taxAmount))
            : specMeta.taxAmount !== undefined
              ? roundCurrency(Math.max(0, specMeta.taxAmount))
              : roundCurrency(subtotal * (Math.max(0, gstPercentage) / 100))
        hasValidLinePricing = true
      } else if (typeof item.totalPrice === 'number' && Number.isFinite(item.totalPrice) && item.totalPrice >= 0) {
        tax =
          typeof item.taxAmount === 'number' && Number.isFinite(item.taxAmount)
            ? roundCurrency(Math.max(0, item.taxAmount))
            : specMeta.taxAmount !== undefined
              ? roundCurrency(Math.max(0, specMeta.taxAmount))
              : 0
        subtotal = roundCurrency(Math.max(0, item.totalPrice - tax - delivery))
        unitPrice = quantity > 0 ? roundCurrency(subtotal / quantity) : subtotal
        hasValidLinePricing = true
      }

      const lineTotal = roundCurrency(subtotal + tax + delivery)

      itemsSubtotal = roundCurrency(itemsSubtotal + subtotal)
      taxAmount = roundCurrency(taxAmount + tax)
      itemDeliveryCharges = roundCurrency(itemDeliveryCharges + delivery)

      itemBreakdown.push({
        description: item.description,
        quantity,
        unit: item.unit || 'units',
        unitPrice,
        subtotal,
        gstPercentage,
        taxAmount: tax,
        deliveryCharges: delivery,
        lineTotal,
      })
    }

    // Add quotation-level tax/delivery only if items did not already carry them
    const extraTax =
      taxAmount === 0 && typeof quotation.taxAmount === 'number' && Number.isFinite(quotation.taxAmount)
        ? roundCurrency(Math.max(0, quotation.taxAmount))
        : 0
    const extraDelivery =
      itemDeliveryCharges === 0 &&
      typeof quotation.deliveryCharges === 'number' &&
      Number.isFinite(quotation.deliveryCharges)
        ? roundCurrency(Math.max(0, quotation.deliveryCharges))
        : 0

    const finalTax = roundCurrency(taxAmount + extraTax)
    const finalDelivery = roundCurrency(itemDeliveryCharges + extraDelivery)
    const computedTotal = roundCurrency(itemsSubtotal + finalTax + finalDelivery)

    if (hasValidLinePricing) {
      return {
        itemsSubtotal,
        taxAmount: finalTax,
        deliveryCharges: finalDelivery,
        totalPurchaseCost: computedTotal,
        effectiveUnitCost: totalQuantity > 0 ? roundCurrency(computedTotal / totalQuantity) : null,
        totalQuantity: totalQuantity > 0 ? totalQuantity : null,
        currency,
        source: extraTax > 0 || extraDelivery > 0 ? 'hybrid' : 'items_breakdown',
        itemBreakdown,
      }
    }
  }

  // Fallback when quotation has explicit summary components
  const hasExplicitSummary =
    typeof quotation.itemsSubtotal === 'number' && Number.isFinite(quotation.itemsSubtotal)
  if (hasExplicitSummary) {
    const subtotal = roundCurrency(Math.max(0, quotation.itemsSubtotal!))
    const tax = roundCurrency(Math.max(0, quotation.taxAmount ?? 0))
    const delivery = roundCurrency(Math.max(0, quotation.deliveryCharges ?? 0))
    const total = roundCurrency(subtotal + tax + delivery)
    return {
      itemsSubtotal: subtotal,
      taxAmount: tax,
      deliveryCharges: delivery,
      totalPurchaseCost: total,
      effectiveUnitCost: null,
      totalQuantity: null,
      currency,
      source: 'quotation_total',
      itemBreakdown: [],
    }
  }

  // Fallback to parent quotation.totalAmount
  if (
    typeof quotation.totalAmount === 'number' &&
    Number.isFinite(quotation.totalAmount) &&
    quotation.totalAmount >= 0
  ) {
    const total = roundCurrency(quotation.totalAmount)
    const notesBreakdown = parseCostSummaryFromNotes(quotation.notes)
    if (
      notesBreakdown &&
      Math.abs(notesBreakdown.subtotal + notesBreakdown.tax + notesBreakdown.delivery - total) <= 0.05
    ) {
      return {
        itemsSubtotal: notesBreakdown.subtotal,
        taxAmount: notesBreakdown.tax,
        deliveryCharges: notesBreakdown.delivery,
        totalPurchaseCost: total,
        effectiveUnitCost: null,
        totalQuantity: null,
        currency,
        source: 'quotation_total',
        itemBreakdown: [],
      }
    }

    return {
      itemsSubtotal: total,
      taxAmount: 0,
      deliveryCharges: 0,
      totalPurchaseCost: total,
      effectiveUnitCost: null,
      totalQuantity: null,
      currency,
      source: 'quotation_total',
      itemBreakdown: [],
    }
  }

  return {
    itemsSubtotal: 0,
    taxAmount: 0,
    deliveryCharges: 0,
    totalPurchaseCost: null,
    effectiveUnitCost: null,
    totalQuantity: null,
    currency,
    source: 'missing',
    itemBreakdown: [],
  }
}

// ---------------------------------------------------------------------------
// 7. Requirement 2: Comparability Verification (Specs, Quantities, Units)
// ---------------------------------------------------------------------------

/**
 * Verifies that quotations are genuinely comparable across product specifications,
 * units, currencies, and Purchase Request quantities.
 */
export function verifyComparability(
  purchaseRequest: PurchaseRequestInput,
  quotations: ComparisonQuotationInput[],
  costBreakdowns?: Map<string, CostBreakdown>
): ComparabilityReport {
  const warnings: ComparabilityIssue[] = []
  const mismatches: ComparabilityIssue[] = []

  const prRequestedQuantity =
    typeof purchaseRequest.quantity === 'number' && Number.isFinite(purchaseRequest.quantity) && purchaseRequest.quantity > 0
      ? purchaseRequest.quantity
      : null
  const prRequestedUnit = purchaseRequest.unit?.trim() || null
  const prCanonicalUnit = canonicalizeUnit(prRequestedUnit)

  // 1. Minimum count check
  if (quotations.length < 2) {
    warnings.push({
      code: 'INSUFFICIENT_QUOTATIONS',
      severity: 'warning',
      message:
        quotations.length === 0
          ? 'No quotations provided for comparison.'
          : 'Only 1 quotation selected. Add at least 2 quotations for a meaningful side-by-side comparison.',
      quotationIds: quotations.map((q) => q.quotationId),
      supplierNames: quotations.map((q) => q.supplierName),
      expected: 'At least 2 quotations',
      actual: quotations.length,
    })
  }

  // 2. Same Purchase Request check
  const wrongPr = quotations.filter((q) => q.purchaseRequestId !== purchaseRequest.id)
  if (wrongPr.length > 0) {
    mismatches.push({
      code: 'PR_MISMATCH',
      severity: 'mismatch',
      message: `${wrongPr.length} quotation(s) do not belong to Purchase Request "${purchaseRequest.title}" (${purchaseRequest.id}).`,
      quotationIds: wrongPr.map((q) => q.quotationId),
      supplierNames: wrongPr.map((q) => q.supplierName),
      expected: purchaseRequest.id,
      actual: wrongPr.map((q) => q.purchaseRequestId).join(', '),
    })
  }

  // 3. Organization isolation check (when org IDs are present)
  if (purchaseRequest.organizationId) {
    const wrongOrg = quotations.filter(
      (q) => q.organizationId && q.organizationId !== purchaseRequest.organizationId
    )
    if (wrongOrg.length > 0) {
      mismatches.push({
        code: 'ORG_MISMATCH',
        severity: 'mismatch',
        message: `Multi-tenant boundary warning: ${wrongOrg.length} quotation(s) belong to a different organization.`,
        quotationIds: wrongOrg.map((q) => q.quotationId),
        supplierNames: wrongOrg.map((q) => q.supplierName),
        expected: purchaseRequest.organizationId,
        actual: wrongOrg.map((q) => q.organizationId).join(', '),
      })
    }
  }

  // 4. Currency consistency check
  const currencies = new Map<string, ComparisonQuotationInput[]>()
  for (const q of quotations) {
    const curr = (q.currency || 'USD').toUpperCase()
    const list = currencies.get(curr) ?? []
    list.push(q)
    currencies.set(curr, list)
  }
  if (currencies.size > 1) {
    const summaryParts = Array.from(currencies.entries()).map(
      ([curr, list]) => `${curr} (${list.map((q) => q.supplierName).join(', ')})`
    )
    mismatches.push({
      code: 'CURRENCY_MISMATCH',
      severity: 'mismatch',
      message: `Currency mismatch across quotations: ${summaryParts.join(' vs ')}. Convert all quotes to the same currency before comparing costs.`,
      quotationIds: quotations.map((q) => q.quotationId),
      supplierNames: quotations.map((q) => q.supplierName),
      expected: Array.from(currencies.keys())[0],
      actual: Array.from(currencies.keys()).join(', '),
    })
  }

  // 5. Quantity checks (against PR requested quantity AND cross-vendor)
  const vendorQuantities: Array<{ quotation: ComparisonQuotationInput; totalQty: number }> = []
  for (const q of quotations) {
    const breakdown = costBreakdowns?.get(q.quotationId) ?? calculateTotalPurchaseCost(q)
    if (breakdown.totalPurchaseCost === null) {
      mismatches.push({
        code: 'MISSING_PRICING',
        severity: 'mismatch',
        message: `${q.supplierName} has no valid pricing / total cost on record.`,
        quotationIds: [q.quotationId],
        supplierNames: [q.supplierName],
      })
    }

    if (breakdown.totalQuantity !== null && breakdown.totalQuantity > 0) {
      vendorQuantities.push({ quotation: q, totalQty: breakdown.totalQuantity })
      if (prRequestedQuantity !== null && Math.abs(breakdown.totalQuantity - prRequestedQuantity) > 0.0001) {
        mismatches.push({
          code: 'QUANTITY_MISMATCH_PR',
          severity: 'mismatch',
          message: `${q.supplierName} quoted quantity ${breakdown.totalQuantity}, which does not match Purchase Request quantity ${prRequestedQuantity}${prRequestedUnit ? ` ${prRequestedUnit}` : ''}.`,
          quotationIds: [q.quotationId],
          supplierNames: [q.supplierName],
          expected: prRequestedQuantity,
          actual: breakdown.totalQuantity,
        })
      }
    }
  }

  if (vendorQuantities.length >= 2) {
    const distinctQtys = new Set(vendorQuantities.map((v) => v.totalQty))
    if (distinctQtys.size > 1) {
      const detail = vendorQuantities
        .map((v) => `${v.quotation.supplierName}: ${v.totalQty}`)
        .join(', ')
      mismatches.push({
        code: 'QUANTITY_MISMATCH_CROSS_VENDOR',
        severity: 'mismatch',
        message: `Quoted quantities differ across vendors (${detail}). Total costs may not be directly comparable without normalizing volume.`,
        quotationIds: vendorQuantities.map((v) => v.quotation.quotationId),
        supplierNames: vendorQuantities.map((v) => v.quotation.supplierName),
        expected: prRequestedQuantity ?? vendorQuantities[0].totalQty,
        actual: Array.from(distinctQtys).join(', '),
      })
    }
  }

  // 6. Unit checks (against PR unit AND cross-vendor)
  const vendorCanonicalUnits = new Map<string, { rawUnits: Set<string>; quotations: ComparisonQuotationInput[] }>()
  for (const q of quotations) {
    const items = q.items ?? []
    for (const item of items) {
      const canonical = canonicalizeUnit(item.unit)
      if (!canonical) continue

      const entry = vendorCanonicalUnits.get(canonical) ?? {
        rawUnits: new Set<string>(),
        quotations: [],
      }
      if (item.unit) entry.rawUnits.add(item.unit.trim())
      if (!entry.quotations.some((existing) => existing.quotationId === q.quotationId)) {
        entry.quotations.push(q)
      }
      vendorCanonicalUnits.set(canonical, entry)

      if (prCanonicalUnit && canonical !== prCanonicalUnit) {
        mismatches.push({
          code: 'UNIT_MISMATCH_PR',
          severity: 'mismatch',
          message: `${q.supplierName} quoted item "${item.description}" in "${item.unit}", but Purchase Request specifies "${prRequestedUnit}".`,
          quotationIds: [q.quotationId],
          supplierNames: [q.supplierName],
          expected: prRequestedUnit ?? prCanonicalUnit,
          actual: item.unit ?? canonical,
        })
      }
    }
  }

  if (vendorCanonicalUnits.size > 1) {
    const unitSummary = Array.from(vendorCanonicalUnits.entries())
      .map(([canon, info]) => `${Array.from(info.rawUnits).join('/') || canon} (${info.quotations.map((q) => q.supplierName).join(', ')})`)
      .join(' vs ')
    mismatches.push({
      code: 'UNIT_MISMATCH_CROSS_VENDOR',
      severity: 'mismatch',
      message: `Measurement unit mismatch across quotations: ${unitSummary}.`,
      quotationIds: quotations.map((q) => q.quotationId),
      supplierNames: quotations.map((q) => q.supplierName),
      expected: prRequestedUnit ?? Array.from(vendorCanonicalUnits.keys())[0],
      actual: Array.from(vendorCanonicalUnits.keys()).join(', '),
    })
  }

  // 7. Line item count & Product Specification checks across quotations with items
  const quotationsWithItems = quotations.filter((q) => (q.items?.length ?? 0) > 0)
  if (quotationsWithItems.length >= 2) {
    const itemCounts = new Set(quotationsWithItems.map((q) => q.items!.length))
    if (itemCounts.size > 1) {
      const countDetail = quotationsWithItems
        .map((q) => `${q.supplierName}: ${q.items!.length} item(s)`)
        .join(', ')
      warnings.push({
        code: 'ITEM_COUNT_MISMATCH',
        severity: 'warning',
        message: `Different number of line items across quotations (${countDetail}). Verify bundled vs itemized quotes.`,
        quotationIds: quotationsWithItems.map((q) => q.quotationId),
        supplierNames: quotationsWithItems.map((q) => q.supplierName),
      })
    }

    // Compare product descriptions and technical specifications against baseline quotation
    const baseline = quotationsWithItems[0]
    const baselineDescText = baseline.items!.map((i) => i.description).join(' ')
    const baselineTechSpecs = baseline
      .items!.map((i) => parseItemSpecifications(i.specifications).rawTechnicalText)
      .filter((s): s is string => Boolean(s))
      .sort()
      .join(' || ')

    for (let idx = 1; idx < quotationsWithItems.length; idx++) {
      const candidate = quotationsWithItems[idx]
      const candidateDescText = candidate.items!.map((i) => i.description).join(' ')
      const similarity = tokenJaccardSimilarity(baselineDescText, candidateDescText)

      if (similarity < 0.25 && baselineDescText.trim() && candidateDescText.trim()) {
        mismatches.push({
          code: 'SPECIFICATION_MISMATCH',
          severity: 'mismatch',
          message: `Product description mismatch between ${baseline.supplierName} ("${baselineDescText}") and ${candidate.supplierName} ("${candidateDescText}"). Verify both quotes cover the same specification.`,
          quotationIds: [baseline.quotationId, candidate.quotationId],
          supplierNames: [baseline.supplierName, candidate.supplierName],
          expected: baselineDescText,
          actual: candidateDescText,
        })
      }

      const candidateTechSpecs = candidate
        .items!.map((i) => parseItemSpecifications(i.specifications).rawTechnicalText)
        .filter((s): s is string => Boolean(s))
        .sort()
        .join(' || ')

      if (baselineTechSpecs && candidateTechSpecs && baselineTechSpecs !== candidateTechSpecs) {
        mismatches.push({
          code: 'SPECIFICATION_MISMATCH',
          severity: 'mismatch',
          message: `Technical specification difference detected between ${baseline.supplierName} and ${candidate.supplierName}.`,
          quotationIds: [baseline.quotationId, candidate.quotationId],
          supplierNames: [baseline.supplierName, candidate.supplierName],
          expected: baselineTechSpecs,
          actual: candidateTechSpecs,
        })
      }
    }
  }

  // 8. Supplier status & missing attribute disclosures (warnings, not hard comparability blocks)
  for (const q of quotations) {
    if (q.supplier?.status === 'blacklisted' || q.supplier?.status === 'inactive') {
      warnings.push({
        code: 'SUPPLIER_STATUS_WARNING',
        severity: 'warning',
        message: `${q.supplierName} is currently marked as "${q.supplier.status}" in the Supplier Directory.`,
        quotationIds: [q.quotationId],
        supplierNames: [q.supplierName],
        expected: 'active',
        actual: q.supplier.status,
      })
    }
  }

  const isComparable = mismatches.length === 0
  const summary = isComparable
    ? warnings.length === 0
      ? `All ${quotations.length} quotations are comparable across specifications, units, currencies, and quantities.`
      : `Quotations are comparable with ${warnings.length} advisory warning(s) to review.`
    : `Comparability alert: ${mismatches.length} mismatch(es) detected (${mismatches.map((m) => m.code).join(', ')}). Review differences before finalizing award.`

  return {
    isComparable,
    warnings,
    mismatches,
    summary,
    checkedQuotationCount: quotations.length,
    prRequestedQuantity,
    prRequestedUnit,
  }
}

// ---------------------------------------------------------------------------
// 8. Requirement 4: Deterministic Score Normalization (0 to 100)
// ---------------------------------------------------------------------------

export interface NormalizedFactorOutput {
  normalizedScore: number
  rawValue: number | string | null
  displayValue: string
  formula: string
  isMissing: boolean
  missingDisclosure?: string
  sourceDescription: string
  tierLabel?: string | null
}

/**
 * Cost Normalization (Lower is better):
 * Default ratio formula: (minCost / cost) * 100
 * Optional range formula: ((maxCost - cost) / (maxCost - minCost)) * 100
 */
export function normalizeCostScore(
  cost: number | null,
  minCost: number | null,
  maxCost: number | null,
  currency = 'USD',
  mode: 'ratio' | 'range' = 'ratio'
): NormalizedFactorOutput {
  if (cost === null || !Number.isFinite(cost) || cost < 0 || minCost === null) {
    return {
      normalizedScore: 0,
      rawValue: null,
      displayValue: MISSING_VALUE_LABEL,
      formula: 'Missing cost → 0.00 (unpriced quotes cannot earn cost points)',
      isMissing: true,
      missingDisclosure: 'Total purchase cost is missing or invalid; assigned 0.00.',
      sourceDescription: 'Missing pricing data',
    }
  }

  const displayCost = formatCurrencyValue(cost, currency)
  const displayMin = formatCurrencyValue(minCost, currency)

  if (cost === 0 && minCost === 0) {
    return {
      normalizedScore: 100,
      rawValue: 0,
      displayValue: displayCost,
      formula: `Lowest cost (${displayCost}) → 100.00`,
      isMissing: false,
      sourceDescription: 'Total purchase cost (items + tax + delivery)',
    }
  }

  if (mode === 'range' && maxCost !== null && maxCost > minCost) {
    const score = roundScore(((maxCost - cost) / (maxCost - minCost)) * 100)
    const displayMax = formatCurrencyValue(maxCost, currency)
    return {
      normalizedScore: score,
      rawValue: cost,
      displayValue: displayCost,
      formula: `((${displayMax} - ${displayCost}) / (${displayMax} - ${displayMin})) × 100 = ${score.toFixed(2)}`,
      isMissing: false,
      sourceDescription: 'Total purchase cost (range-normalized)',
    }
  }

  // Standard ratio formula: minCost / cost * 100
  const score = cost > 0 ? roundScore((minCost / cost) * 100) : 0
  return {
    normalizedScore: score,
    rawValue: cost,
    displayValue: displayCost,
    formula: `(${displayMin} / ${displayCost}) × 100 = ${score.toFixed(2)}`,
    isMissing: false,
    sourceDescription: 'Total purchase cost (items + tax + delivery)',
  }
}

/**
 * Delivery Normalization (Lower delivery days is better):
 * Formula: (minDays / days) * 100
 */
export function normalizeDeliveryScore(
  deliveryDays: number | null | undefined,
  minDays: number | null,
  missingNeutralScore = DEFAULT_MISSING_NEUTRAL_SCORE
): NormalizedFactorOutput {
  if (deliveryDays === null || deliveryDays === undefined || !Number.isFinite(deliveryDays) || deliveryDays < 0) {
    const fallback = roundScore(missingNeutralScore)
    return {
      normalizedScore: fallback,
      rawValue: null,
      displayValue: MISSING_VALUE_LABEL,
      formula: `Missing delivery lead time → disclosed neutral ${fallback.toFixed(2)}`,
      isMissing: true,
      missingDisclosure: `Delivery lead time not provided; assigned disclosed neutral score of ${fallback.toFixed(2)}/100.`,
      sourceDescription: 'Missing delivery lead time',
    }
  }

  const displayDays = deliveryDays === 0 ? '0 days (Same-day)' : `${deliveryDays} day${deliveryDays === 1 ? '' : 's'}`

  if (minDays === null) {
    return {
      normalizedScore: 100,
      rawValue: deliveryDays,
      displayValue: displayDays,
      formula: `Only quoted delivery time (${deliveryDays}d) → 100.00`,
      isMissing: false,
      sourceDescription: 'Quotation delivery lead time',
    }
  }

  if (minDays === 0) {
    if (deliveryDays === 0) {
      return {
        normalizedScore: 100,
        rawValue: 0,
        displayValue: displayDays,
        formula: 'Same-day delivery (0 days) → 100.00',
        isMissing: false,
        sourceDescription: 'Quotation delivery lead time',
      }
    }
    const score = roundScore((1 / (deliveryDays + 1)) * 100)
    return {
      normalizedScore: score,
      rawValue: deliveryDays,
      displayValue: displayDays,
      formula: `(1 / (${deliveryDays} + 1)) × 100 = ${score.toFixed(2)} (relative to 0-day benchmark)`,
      isMissing: false,
      sourceDescription: 'Quotation delivery lead time',
    }
  }

  const score = roundScore((minDays / deliveryDays) * 100)
  return {
    normalizedScore: score,
    rawValue: deliveryDays,
    displayValue: displayDays,
    formula: `(${minDays}d / ${deliveryDays}d) × 100 = ${score.toFixed(2)}`,
    isMissing: false,
    sourceDescription: 'Quotation delivery lead time',
  }
}

/**
 * Extracts quality rating deterministically without fabricating values:
 * 1. Explicit quotation.qualityRating
 * 2. Average qualityRating stored in quotation_items specifications JSON
 * 3. Linked supplier.rating
 */
export function resolveQualityRating(quotation: ComparisonQuotationInput): {
  rating: number | null
  sourceDescription: string
} {
  if (
    typeof quotation.qualityRating === 'number' &&
    Number.isFinite(quotation.qualityRating) &&
    quotation.qualityRating >= 0
  ) {
    return {
      rating: Math.min(5, Math.max(0, quotation.qualityRating)),
      sourceDescription: 'Quotation quality rating',
    }
  }

  // Check line item ratings (populated by CSV importer into specifications JSON)
  const itemRatings: number[] = []
  for (const item of quotation.items ?? []) {
    if (typeof item.qualityRating === 'number' && Number.isFinite(item.qualityRating) && item.qualityRating >= 0) {
      itemRatings.push(Math.min(5, Math.max(0, item.qualityRating)))
      continue
    }
    const meta = parseItemSpecifications(item.specifications)
    if (meta.qualityRating !== undefined && meta.qualityRating >= 0) {
      itemRatings.push(Math.min(5, Math.max(0, meta.qualityRating)))
    }
  }

  if (itemRatings.length > 0) {
    const avg = itemRatings.reduce((sum, r) => sum + r, 0) / itemRatings.length
    return {
      rating: Math.round((avg + Number.EPSILON) * 100) / 100,
      sourceDescription:
        itemRatings.length === 1 ? 'Quotation line-item quality rating' : `Average of ${itemRatings.length} item quality ratings`,
    }
  }

  if (
    quotation.supplier &&
    typeof quotation.supplier.rating === 'number' &&
    Number.isFinite(quotation.supplier.rating) &&
    quotation.supplier.rating >= 0
  ) {
    return {
      rating: Math.min(5, Math.max(0, quotation.supplier.rating)),
      sourceDescription: 'Supplier directory quality rating',
    }
  }

  return { rating: null, sourceDescription: 'No quality rating recorded' }
}

/**
 * Quality Normalization (Higher is better):
 * Formula: (rating / 5) * 100
 */
export function normalizeQualityScore(
  rating: number | null | undefined,
  sourceDescription = 'Quality rating',
  missingNeutralScore = DEFAULT_MISSING_NEUTRAL_SCORE
): NormalizedFactorOutput {
  if (rating === null || rating === undefined || !Number.isFinite(rating) || rating < 0) {
    const fallback = roundScore(missingNeutralScore)
    return {
      normalizedScore: fallback,
      rawValue: null,
      displayValue: MISSING_VALUE_LABEL,
      formula: `Unrated quality → disclosed neutral ${fallback.toFixed(2)}`,
      isMissing: true,
      missingDisclosure: `Quality rating is missing; never fabricated. Assigned disclosed neutral score of ${fallback.toFixed(2)}/100.`,
      sourceDescription: 'Unrated / Missing',
    }
  }

  const clamped = Math.min(5, Math.max(0, rating))
  const score = roundScore((clamped / 5) * 100)
  return {
    normalizedScore: score,
    rawValue: clamped,
    displayValue: `${clamped.toFixed(1)} / 5.0`,
    formula: `(${clamped.toFixed(2)} / 5) × 100 = ${score.toFixed(2)}`,
    isMissing: false,
    sourceDescription,
  }
}

/**
 * Payment Terms Normalization (Higher is better, standard credit ladder):
 * - Net 90 (or >= 90 days): 100
 * - Net 60: 85
 * - Net 45: 75
 * - Net 30: 60
 * - Net 15: 45
 * - Immediate / COD / Due on Receipt / Net 0: 30
 * - Advance / Prepayment / Upfront: 15
 */
export function normalizePaymentTermsScore(
  paymentTerms: string | null | undefined,
  missingNeutralScore = DEFAULT_MISSING_NEUTRAL_SCORE
): NormalizedFactorOutput {
  if (!paymentTerms || !paymentTerms.trim()) {
    const fallback = roundScore(missingNeutralScore)
    return {
      normalizedScore: fallback,
      rawValue: null,
      displayValue: MISSING_VALUE_LABEL,
      tierLabel: null,
      formula: `Missing payment terms → disclosed neutral ${fallback.toFixed(2)}`,
      isMissing: true,
      missingDisclosure: `Payment terms not specified; assigned disclosed neutral score of ${fallback.toFixed(2)}/100.`,
      sourceDescription: 'Missing payment terms',
    }
  }

  const raw = paymentTerms.trim()
  const lower = raw.toLowerCase().replace(/\s+/g, ' ')

  // Check Advance / Prepayment first
  if (
    /\b(advance|prepaid|prepay|prepayment|upfront|cia|cash in advance)\b/.test(lower)
  ) {
    // Handle split advance like "50% Advance, 50% on Delivery"
    const pctMatch = lower.match(/(\d{1,3})\s*%/)
    if (pctMatch && Number(pctMatch[1]) > 0 && Number(pctMatch[1]) < 100 && /(delivery|cod|receipt|net)/.test(lower)) {
      const advanceShare = Number(pctMatch[1]) / 100
      const score = roundScore(15 * advanceShare + 30 * (1 - advanceShare))
      return {
        normalizedScore: score,
        rawValue: raw,
        displayValue: raw,
        tierLabel: 'Partial Advance',
        formula: `Split terms (${pctMatch[1]}% Advance [15] + ${100 - Number(pctMatch[1])}% On Delivery [30]) = ${score.toFixed(2)}`,
        isMissing: false,
        sourceDescription: 'Payment terms credit ladder (split terms)',
      }
    }

    return {
      normalizedScore: 15,
      rawValue: raw,
      displayValue: raw,
      tierLabel: 'Advance',
      formula: `Credit ladder: Advance ("${raw}") → 15.00`,
      isMissing: false,
      sourceDescription: 'Payment terms credit ladder',
    }
  }

  // Check Immediate / COD / Due on Receipt / Net 0
  if (
    /\b(immediate|cod|cash on delivery|due on receipt|on receipt|on delivery|upon delivery|net\s*0)\b/.test(
      lower
    )
  ) {
    return {
      normalizedScore: 30,
      rawValue: raw,
      displayValue: raw,
      tierLabel: 'Immediate',
      formula: `Credit ladder: Immediate ("${raw}") → 30.00`,
      isMissing: false,
      sourceDescription: 'Payment terms credit ladder',
    }
  }

  // Extract Net X / NXX / X days
  const netMatch =
    lower.match(/\bnet[\s-]*(\d{1,3})\b/) ??
    lower.match(/\bn(\d{1,3})\b/) ??
    lower.match(/\b(\d{1,3})\s*(?:days?|d)\b/)

  if (netMatch) {
    const days = Number(netMatch[1])
    if (Number.isFinite(days)) {
      let score: number
      let tierLabel: string

      if (days >= 90) {
        score = 100
        tierLabel = days === 90 ? 'Net 90' : `Net ${days} (≥90d)`
      } else if (days === 60) {
        score = 85
        tierLabel = 'Net 60'
      } else if (days === 45) {
        score = 75
        tierLabel = 'Net 45'
      } else if (days === 30) {
        score = 60
        tierLabel = 'Net 30'
      } else if (days === 15) {
        score = 45
        tierLabel = 'Net 15'
      } else if (days === 0) {
        score = 30
        tierLabel = 'Immediate'
      } else if (days > 60) {
        score = roundScore(85 + ((days - 60) / 30) * 15)
        tierLabel = `Net ${days}`
      } else if (days > 45) {
        score = roundScore(75 + ((days - 45) / 15) * 10)
        tierLabel = `Net ${days}`
      } else if (days > 30) {
        score = roundScore(60 + ((days - 30) / 15) * 15)
        tierLabel = `Net ${days}`
      } else if (days > 15) {
        score = roundScore(45 + ((days - 15) / 15) * 15)
        tierLabel = `Net ${days}`
      } else {
        score = roundScore(30 + (days / 15) * 15)
        tierLabel = `Net ${days}`
      }

      return {
        normalizedScore: score,
        rawValue: raw,
        displayValue: raw,
        tierLabel,
        formula: `Credit ladder: ${tierLabel} → ${score.toFixed(2)}`,
        isMissing: false,
        sourceDescription: 'Payment terms credit ladder',
      }
    }
  }

  // Unrecognized text -> transparent neutral fallback
  const fallback = roundScore(missingNeutralScore)
  return {
    normalizedScore: fallback,
    rawValue: raw,
    displayValue: `${raw} (Unclassified)`,
    tierLabel: 'Unclassified',
    formula: `Unrecognized payment term "${raw}" → disclosed neutral ${fallback.toFixed(2)}`,
    isMissing: true,
    missingDisclosure: `Payment terms "${raw}" did not match standard credit tiers; assigned disclosed neutral score of ${fallback.toFixed(2)}/100.`,
    sourceDescription: 'Unrecognized payment terms',
  }
}

/**
 * Reliability Normalization (0 to 100):
 * Derived deterministically from:
 * 1. Blacklisted status check (scores 0 with explicit disclosure)
 * 2. Explicit reliabilityScore (0-100)
 * 3. On-time delivery rate (0-100) blended with supplier rating (70/30) or standalone
 * 4. Supplier directory rating ((rating / 5) * 100)
 * 5. Missing -> explicitly disclosed neutral score (never hallucinated)
 */
export function normalizeReliabilityScore(
  quotation: ComparisonQuotationInput,
  missingNeutralScore = DEFAULT_MISSING_NEUTRAL_SCORE
): NormalizedFactorOutput {
  const supplier = quotation.supplier

  if (supplier?.status === 'blacklisted') {
    return {
      normalizedScore: 0,
      rawValue: 0,
      displayValue: '0 / 100 (Blacklisted)',
      formula: 'Supplier status is blacklisted → 0.00',
      isMissing: false,
      sourceDescription: 'Supplier status (blacklisted)',
    }
  }

  const explicitScore =
    typeof quotation.reliabilityScore === 'number' && Number.isFinite(quotation.reliabilityScore)
      ? quotation.reliabilityScore
      : typeof supplier?.reliabilityScore === 'number' && Number.isFinite(supplier.reliabilityScore)
        ? supplier.reliabilityScore
        : null

  if (explicitScore !== null && explicitScore >= 0) {
    const score = roundScore(explicitScore)
    return {
      normalizedScore: score,
      rawValue: score,
      displayValue: `${score.toFixed(0)}%`,
      formula: `Supplier reliability index = ${score.toFixed(2)} / 100`,
      isMissing: false,
      sourceDescription: 'Recorded supplier reliability score',
    }
  }

  const onTimeRate =
    typeof supplier?.onTimeDeliveryRate === 'number' &&
    Number.isFinite(supplier.onTimeDeliveryRate) &&
    supplier.onTimeDeliveryRate >= 0
      ? Math.min(100, Math.max(0, supplier.onTimeDeliveryRate))
      : null

  const supplierRating =
    typeof supplier?.rating === 'number' && Number.isFinite(supplier.rating) && supplier.rating >= 0
      ? Math.min(5, Math.max(0, supplier.rating))
      : null

  if (onTimeRate !== null && supplierRating !== null) {
    const ratingNormalized = (supplierRating / 5) * 100
    const score = roundScore(onTimeRate * 0.7 + ratingNormalized * 0.3)
    return {
      normalizedScore: score,
      rawValue: onTimeRate,
      displayValue: `${onTimeRate.toFixed(0)}% on-time, ${supplierRating.toFixed(1)}★`,
      formula: `(${onTimeRate.toFixed(1)}% × 0.70) + ((${supplierRating.toFixed(1)} / 5) × 100 × 0.30) = ${score.toFixed(2)}`,
      isMissing: false,
      sourceDescription: 'Supplier on-time history (70%) + rating (30%)',
    }
  }

  if (onTimeRate !== null) {
    const score = roundScore(onTimeRate)
    return {
      normalizedScore: score,
      rawValue: onTimeRate,
      displayValue: `${onTimeRate.toFixed(0)}% on-time`,
      formula: `On-time delivery history = ${score.toFixed(2)} / 100`,
      isMissing: false,
      sourceDescription: 'Supplier on-time delivery history',
    }
  }

  if (supplierRating !== null) {
    const score = roundScore((supplierRating / 5) * 100)
    return {
      normalizedScore: score,
      rawValue: supplierRating,
      displayValue: `${supplierRating.toFixed(1)} / 5.0 (${score.toFixed(0)}%)`,
      formula: `(${supplierRating.toFixed(2)} / 5) × 100 = ${score.toFixed(2)}`,
      isMissing: false,
      sourceDescription: 'Supplier directory rating',
    }
  }

  const fallback = roundScore(missingNeutralScore)
  return {
    normalizedScore: fallback,
    rawValue: null,
    displayValue: MISSING_VALUE_LABEL,
    formula: `No reliability history or supplier rating → disclosed neutral ${fallback.toFixed(2)}`,
    isMissing: true,
    missingDisclosure: `Supplier reliability history & rating unavailable; assigned disclosed neutral score of ${fallback.toFixed(2)}/100.`,
    sourceDescription: 'Unrated / Missing',
  }
}

// ---------------------------------------------------------------------------
// 9. Requirements 5 & 6: Weights & Weighted Final Score
// ---------------------------------------------------------------------------

/**
 * Normalizes weights into non-negative fractions summing to 1.0.
 * Accepts either fractional weights (e.g., 0.40) or percentage weights (e.g., 40).
 */
export function normalizeWeights(input?: Partial<ComparisonWeights>): ComparisonWeights {
  if (!input) {
    return { ...DEFAULT_COMPARISON_WEIGHTS }
  }

  const raw: ComparisonWeights = {
    cost: input.cost ?? DEFAULT_COMPARISON_WEIGHTS.cost,
    delivery: input.delivery ?? DEFAULT_COMPARISON_WEIGHTS.delivery,
    quality: input.quality ?? DEFAULT_COMPARISON_WEIGHTS.quality,
    paymentTerms: input.paymentTerms ?? DEFAULT_COMPARISON_WEIGHTS.paymentTerms,
    reliability: input.reliability ?? DEFAULT_COMPARISON_WEIGHTS.reliability,
  }

  const sanitized: ComparisonWeights = {
    cost: Number.isFinite(raw.cost) && raw.cost >= 0 ? raw.cost : 0,
    delivery: Number.isFinite(raw.delivery) && raw.delivery >= 0 ? raw.delivery : 0,
    quality: Number.isFinite(raw.quality) && raw.quality >= 0 ? raw.quality : 0,
    paymentTerms: Number.isFinite(raw.paymentTerms) && raw.paymentTerms >= 0 ? raw.paymentTerms : 0,
    reliability: Number.isFinite(raw.reliability) && raw.reliability >= 0 ? raw.reliability : 0,
  }

  const total =
    sanitized.cost +
    sanitized.delivery +
    sanitized.quality +
    sanitized.paymentTerms +
    sanitized.reliability

  if (total <= 0) {
    return { ...DEFAULT_COMPARISON_WEIGHTS }
  }

  // Exact match to standard weights (either fractional or 40/25/20/10/5 percentages)
  const scaled: ComparisonWeights = {
    cost: roundWeight(sanitized.cost / total),
    delivery: roundWeight(sanitized.delivery / total),
    quality: roundWeight(sanitized.quality / total),
    paymentTerms: roundWeight(sanitized.paymentTerms / total),
    reliability: roundWeight(sanitized.reliability / total),
  }

  // Ensure exact sum = 1.0000 by adjusting the largest weight for any 0.0001 rounding residual
  const scaledSum =
    scaled.cost + scaled.delivery + scaled.quality + scaled.paymentTerms + scaled.reliability
  const residual = roundWeight(1 - scaledSum)
  if (Math.abs(residual) > 0) {
    const keys: FactorKey[] = ['cost', 'delivery', 'quality', 'paymentTerms', 'reliability']
    let maxKey: FactorKey = 'cost'
    for (const k of keys) {
      if (scaled[k] > scaled[maxKey]) maxKey = k
    }
    scaled[maxKey] = roundWeight(scaled[maxKey] + residual)
  }

  return scaled
}

/**
 * Checks whether the supplied weights match the standard 40/25/20/10/5 specification.
 */
export function isUsingStandardWeights(weights: ComparisonWeights): boolean {
  const eps = 0.0005
  return (
    Math.abs(weights.cost - DEFAULT_COMPARISON_WEIGHTS.cost) < eps &&
    Math.abs(weights.delivery - DEFAULT_COMPARISON_WEIGHTS.delivery) < eps &&
    Math.abs(weights.quality - DEFAULT_COMPARISON_WEIGHTS.quality) < eps &&
    Math.abs(weights.paymentTerms - DEFAULT_COMPARISON_WEIGHTS.paymentTerms) < eps &&
    Math.abs(weights.reliability - DEFAULT_COMPARISON_WEIGHTS.reliability) < eps
  )
}

/**
 * Exact weighted final score formula:
 * Final = (Cost * wCost) + (Delivery * wDelivery) + (Quality * wQuality) + (PaymentTerms * wTerms) + (Reliability * wReliability)
 */
export function calculateWeightedFinalScore(
  normalizedScores: Record<FactorKey, number>,
  weights: ComparisonWeights = DEFAULT_COMPARISON_WEIGHTS
): {
  finalScore: number
  weightedContributions: Record<FactorKey, number>
} {
  const rawContributions: Record<FactorKey, number> = {
    cost: normalizedScores.cost * weights.cost,
    delivery: normalizedScores.delivery * weights.delivery,
    quality: normalizedScores.quality * weights.quality,
    paymentTerms: normalizedScores.paymentTerms * weights.paymentTerms,
    reliability: normalizedScores.reliability * weights.reliability,
  }

  const weightedContributions: Record<FactorKey, number> = {
    cost: roundScore(rawContributions.cost),
    delivery: roundScore(rawContributions.delivery),
    quality: roundScore(rawContributions.quality),
    paymentTerms: roundScore(rawContributions.paymentTerms),
    reliability: roundScore(rawContributions.reliability),
  }

  const finalScore = roundScore(
    rawContributions.cost +
      rawContributions.delivery +
      rawContributions.quality +
      rawContributions.paymentTerms +
      rawContributions.reliability
  )

  return { finalScore, weightedContributions }
}

// ---------------------------------------------------------------------------
// 10. Requirement 8: Methodology & Individual Explanation Generator
// ---------------------------------------------------------------------------

/**
 * Returns complete transparent scoring methodology for UI disclosure modals / drawers.
 */
export function getScoringMethodology(
  weights: ComparisonWeights = DEFAULT_COMPARISON_WEIGHTS,
  missingNeutralScore = DEFAULT_MISSING_NEUTRAL_SCORE
): ScoringMethodology {
  const normWeights = normalizeWeights(weights)
  const weightPercentages: Record<FactorKey, number> = {
    cost: Math.round(normWeights.cost * 10000) / 100,
    delivery: Math.round(normWeights.delivery * 10000) / 100,
    quality: Math.round(normWeights.quality * 10000) / 100,
    paymentTerms: Math.round(normWeights.paymentTerms * 10000) / 100,
    reliability: Math.round(normWeights.reliability * 10000) / 100,
  }

  return {
    deterministic: true,
    usesAI: false,
    weights: normWeights,
    weightPercentages,
    missingDataPolicy: `Missing attributes are never hallucinated or fabricated. Missing pricing receives 0.00 points. Missing optional factors (delivery days, quality rating, payment terms, reliability) are explicitly marked "${MISSING_VALUE_LABEL}" and assigned a disclosed neutral score of ${roundScore(missingNeutralScore).toFixed(0)}/100.`,
    factors: [
      {
        factor: 'cost',
        label: FACTOR_LABELS.cost,
        weight: normWeights.cost,
        weightPercent: weightPercentages.cost,
        direction: 'lower_is_better',
        formula: '(Lowest Total Cost / Vendor Total Cost) × 100',
        missingHandling: 'Assigned 0.00 and flagged as missing pricing.',
      },
      {
        factor: 'delivery',
        label: FACTOR_LABELS.delivery,
        weight: normWeights.delivery,
        weightPercent: weightPercentages.delivery,
        direction: 'lower_is_better',
        formula: '(Fastest Delivery Days / Vendor Delivery Days) × 100',
        missingHandling: `Marked "${MISSING_VALUE_LABEL}" with neutral score ${roundScore(missingNeutralScore).toFixed(0)}/100.`,
      },
      {
        factor: 'quality',
        label: FACTOR_LABELS.quality,
        weight: normWeights.quality,
        weightPercent: weightPercentages.quality,
        direction: 'higher_is_better',
        formula: '(Quality Rating / 5) × 100',
        missingHandling: `Marked "${MISSING_VALUE_LABEL}" with neutral score ${roundScore(missingNeutralScore).toFixed(0)}/100.`,
      },
      {
        factor: 'paymentTerms',
        label: FACTOR_LABELS.paymentTerms,
        weight: normWeights.paymentTerms,
        weightPercent: weightPercentages.paymentTerms,
        direction: 'higher_is_better',
        formula: 'Credit Ladder: Net 90 (100), Net 60 (85), Net 45 (75), Net 30 (60), Net 15 (45), Immediate (30), Advance (15)',
        missingHandling: `Marked "${MISSING_VALUE_LABEL}" with neutral score ${roundScore(missingNeutralScore).toFixed(0)}/100.`,
      },
      {
        factor: 'reliability',
        label: FACTOR_LABELS.reliability,
        weight: normWeights.reliability,
        weightPercent: weightPercentages.reliability,
        direction: 'higher_is_better',
        formula: 'Supplier on-time delivery history & supplier directory rating mapped to 0–100 (Blacklisted = 0)',
        missingHandling: `Marked "${MISSING_VALUE_LABEL}" with neutral score ${roundScore(missingNeutralScore).toFixed(0)}/100.`,
      },
    ],
    paymentTermsLadder: PAYMENT_TERMS_LADDER,
    tieBreakers: TIE_BREAKER_HIERARCHY,
  }
}

/**
 * Generates an itemized, human-readable mathematical explanation for a single vendor's ranking.
 */
export function generateVendorExplanation(params: {
  supplierName: string
  rank: number
  rankLabel: string
  totalVendors: number
  finalScore: number
  scoreGapFromLeader: number
  factors: Record<FactorKey, FactorScoreDetail>
  tieBreakerApplied: string | null
}): VendorScoreExplanation {
  const {
    supplierName,
    rank,
    rankLabel,
    totalVendors,
    finalScore,
    scoreGapFromLeader,
    factors,
    tieBreakerApplied,
  } = params

  const orderedFactors: FactorScoreDetail[] = [
    factors.cost,
    factors.delivery,
    factors.quality,
    factors.paymentTerms,
    factors.reliability,
  ]

  const formulaEquation =
    orderedFactors
      .map((f) => `(${f.normalizedScore.toFixed(2)} × ${f.weight.toFixed(2)})`)
      .join(' + ') + ` = ${finalScore.toFixed(2)}`

  const strengths: string[] = []
  const weaknesses: string[] = []
  const missingDataNotes: string[] = []

  for (const f of orderedFactors) {
    if (f.isMissing && f.missingDisclosure) {
      missingDataNotes.push(`${f.label}: ${f.missingDisclosure}`)
    } else if (f.normalizedScore >= 85) {
      strengths.push(
        `Strong ${f.label.toLowerCase()} (${f.displayValue} → ${f.normalizedScore.toFixed(1)}/100, +${f.weightedPoints.toFixed(2)} pts)`
      )
    } else if (f.normalizedScore < 60) {
      weaknesses.push(
        `Lower ${f.label.toLowerCase()} score (${f.displayValue} → ${f.normalizedScore.toFixed(1)}/100, +${f.weightedPoints.toFixed(2)} pts)`
      )
    }
  }

  // Sort factors by weighted points to highlight top contributor
  const topContributor = [...orderedFactors].sort((a, b) => b.weightedPoints - a.weightedPoints)[0]

  const headline =
    rank === 1
      ? `${rankLabel} Place — ${supplierName} leads with ${finalScore.toFixed(2)}/100`
      : `${rankLabel} Place — ${supplierName} scored ${finalScore.toFixed(2)}/100 (${scoreGapFromLeader.toFixed(2)} pts behind #1)`

  const parts: string[] = [
    `${supplierName} ranked ${rankLabel} out of ${totalVendors} vendor${totalVendors === 1 ? '' : 's'} with a deterministic weighted score of ${finalScore.toFixed(2)}/100.`,
    `Primary contribution came from ${topContributor.label} (+${topContributor.weightedPoints.toFixed(2)} pts from ${topContributor.displayValue}).`,
  ]

  if (strengths.length > 0 && rank === 1) {
    parts.push(`Key advantage: ${strengths[0]}.`)
  } else if (weaknesses.length > 0) {
    parts.push(`Primary gap: ${weaknesses[0]}.`)
  }

  if (tieBreakerApplied) {
    parts.push(`Tie-breaker applied: ${tieBreakerApplied}.`)
  }

  if (missingDataNotes.length > 0) {
    parts.push(`Disclosed missing data on ${missingDataNotes.length} factor(s).`)
  }

  return {
    headline,
    summary: parts.join(' '),
    formulaEquation,
    factorBreakdowns: orderedFactors,
    strengths,
    weaknesses,
    missingDataNotes,
    tieBreakerNote: tieBreakerApplied ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// 11. Requirement 7: Deterministic Ranking with Tie-Breakers
// ---------------------------------------------------------------------------

interface PreliminaryVendorEvaluation {
  quotation: ComparisonQuotationInput
  costBreakdown: CostBreakdown
  rawMetrics: RankedVendorResult['rawMetrics']
  normalizedScores: Record<FactorKey, number>
  weightedContributions: Record<FactorKey, number>
  factors: Record<FactorKey, FactorScoreDetail>
  finalScore: number
  missingFields: FactorKey[]
}

function compareEvaluationsDeterministically(
  a: PreliminaryVendorEvaluation,
  b: PreliminaryVendorEvaluation
): { order: number; tieBreakerReason: string | null } {
  // Primary: Higher Final Score
  if (a.finalScore !== b.finalScore) {
    return { order: b.finalScore - a.finalScore, tieBreakerReason: null }
  }

  // Tie-breaker 1: Lower Total Purchase Cost
  const costA = a.rawMetrics.totalPurchaseCost ?? Number.POSITIVE_INFINITY
  const costB = b.rawMetrics.totalPurchaseCost ?? Number.POSITIVE_INFINITY
  if (costA !== costB) {
    return {
      order: costA - costB,
      tieBreakerReason: 'Tied on final score; ranked by lower total purchase cost',
    }
  }

  // Tie-breaker 2: Faster Delivery Time (lower days)
  const daysA = a.rawMetrics.deliveryDays ?? Number.POSITIVE_INFINITY
  const daysB = b.rawMetrics.deliveryDays ?? Number.POSITIVE_INFINITY
  if (daysA !== daysB) {
    return {
      order: daysA - daysB,
      tieBreakerReason: 'Tied on final score and cost; ranked by faster delivery time',
    }
  }

  // Tie-breaker 3: Higher Quality Rating
  const qualA = a.rawMetrics.qualityRating ?? -1
  const qualB = b.rawMetrics.qualityRating ?? -1
  if (qualA !== qualB) {
    return {
      order: qualB - qualA,
      tieBreakerReason: 'Tied on final score, cost, and delivery; ranked by higher quality rating',
    }
  }

  // Tie-breaker 4: Higher Payment Terms Score
  if (a.normalizedScores.paymentTerms !== b.normalizedScores.paymentTerms) {
    return {
      order: b.normalizedScores.paymentTerms - a.normalizedScores.paymentTerms,
      tieBreakerReason: 'Tied on prior criteria; ranked by better payment terms',
    }
  }

  // Tie-breaker 5: Higher Reliability Score
  if (a.normalizedScores.reliability !== b.normalizedScores.reliability) {
    return {
      order: b.normalizedScores.reliability - a.normalizedScores.reliability,
      tieBreakerReason: 'Tied on prior criteria; ranked by higher supplier reliability',
    }
  }

  // Tie-breaker 6: Alphabetical supplier name, then quotationId
  const nameA = a.quotation.supplierName.trim().toLowerCase()
  const nameB = b.quotation.supplierName.trim().toLowerCase()
  if (nameA !== nameB) {
    return {
      order: nameA < nameB ? -1 : 1,
      tieBreakerReason: 'Exact tie across all scored metrics; ordered alphabetically by supplier name',
    }
  }

  const idOrder = a.quotation.quotationId < b.quotation.quotationId ? -1 : a.quotation.quotationId > b.quotation.quotationId ? 1 : 0
  return {
    order: idOrder,
    tieBreakerReason: idOrder !== 0 ? 'Exact tie across all metrics; ordered by quotation ID' : null,
  }
}

// ---------------------------------------------------------------------------
// 12. Main Orchestrator: compareVendorQuotations
// ---------------------------------------------------------------------------

/**
 * Executes the complete deterministic vendor comparison workflow for a single Purchase Request.
 */
export function compareVendorQuotations(
  purchaseRequest: PurchaseRequestInput,
  quotations: ComparisonQuotationInput[],
  options: CompareVendorOptions = {}
): VendorComparisonResult {
  const {
    strictPrMatch = true,
    costNormalizationMode = 'ratio',
    missingNeutralScore = DEFAULT_MISSING_NEUTRAL_SCORE,
  } = options

  const weights = normalizeWeights(options.weights)
  const isStandard = isUsingStandardWeights(weights)
  const methodology = getScoringMethodology(weights, missingNeutralScore)

  // Requirement 1: Enforce same Purchase Request
  const { matching, mismatched } = filterQuotationsForPurchaseRequest(purchaseRequest.id, quotations)
  if (strictPrMatch && mismatched.length > 0) {
    const badIds = mismatched.map((q) => `${q.quotationId} (PR: ${q.purchaseRequestId})`).join(', ')
    throw new Error(
      `Cannot compare quotations from different Purchase Requests. Expected PR "${purchaseRequest.id}", found mismatched quotation(s): ${badIds}.`
    )
  }

  const activeQuotations = strictPrMatch ? quotations : matching

  // Requirement 3: Compute total purchase cost breakdowns first
  const costBreakdowns = new Map<string, CostBreakdown>()
  for (const q of activeQuotations) {
    costBreakdowns.set(q.quotationId, calculateTotalPurchaseCost(q))
  }

  // Requirement 2: Comparability report (include mismatched if strictPrMatch=false so report flags PR_MISMATCH)
  const comparability = verifyComparability(
    purchaseRequest,
    strictPrMatch ? activeQuotations : quotations,
    costBreakdowns
  )

  // Compute comparison benchmarks across active quotations
  const validCosts: number[] = []
  const validDays: number[] = []
  const resolvedQualityMap = new Map<string, { rating: number | null; sourceDescription: string }>()
  const resolvedDeliveryMap = new Map<string, number | null>()
  const resolvedPaymentTermsMap = new Map<string, string | null>()

  for (const q of activeQuotations) {
    const cb = costBreakdowns.get(q.quotationId)!
    if (cb.totalPurchaseCost !== null && cb.totalPurchaseCost >= 0) {
      validCosts.push(cb.totalPurchaseCost)
    }

    // Resolve delivery days from quotation or item specs
    let deliveryDays: number | null =
      typeof q.deliveryDays === 'number' && Number.isFinite(q.deliveryDays) && q.deliveryDays >= 0
        ? q.deliveryDays
        : null
    if (deliveryDays === null && q.items && q.items.length > 0) {
      const itemDays = q.items
        .map((i) => parseItemSpecifications(i.specifications).deliveryDays)
        .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d >= 0)
      if (itemDays.length > 0) {
        deliveryDays = Math.max(...itemDays)
      }
    }
    resolvedDeliveryMap.set(q.quotationId, deliveryDays)
    if (deliveryDays !== null) validDays.push(deliveryDays)

    // Resolve payment terms from quotation or first item spec
    let paymentTerms: string | null = q.paymentTerms?.trim() ? q.paymentTerms.trim() : null
    if (!paymentTerms && q.items && q.items.length > 0) {
      for (const item of q.items) {
        const meta = parseItemSpecifications(item.specifications)
        if (meta.paymentTerms) {
          paymentTerms = meta.paymentTerms
          break
        }
      }
    }
    resolvedPaymentTermsMap.set(q.quotationId, paymentTerms)

    // Resolve quality rating
    resolvedQualityMap.set(q.quotationId, resolveQualityRating(q))
  }

  const minCost = validCosts.length > 0 ? Math.min(...validCosts) : null
  const maxCost = validCosts.length > 0 ? Math.max(...validCosts) : null
  const avgCost =
    validCosts.length > 0
      ? roundCurrency(validCosts.reduce((sum, c) => sum + c, 0) / validCosts.length)
      : null
  const minDeliveryDays = validDays.length > 0 ? Math.min(...validDays) : null
  const maxDeliveryDays = validDays.length > 0 ? Math.max(...validDays) : null

  // Requirement 4, 5, 6: Normalize each factor and compute weighted scores
  const preliminary: PreliminaryVendorEvaluation[] = []
  let highestQualityRating: number | null = null
  let bestPaymentTermsScore: number | null = null
  let highestReliabilityScore: number | null = null

  for (const q of activeQuotations) {
    const cb = costBreakdowns.get(q.quotationId)!
    const deliveryDays = resolvedDeliveryMap.get(q.quotationId) ?? null
    const paymentTerms = resolvedPaymentTermsMap.get(q.quotationId) ?? null
    const qualityInfo = resolvedQualityMap.get(q.quotationId) ?? {
      rating: null,
      sourceDescription: 'No quality rating recorded',
    }

    const costNorm = normalizeCostScore(
      cb.totalPurchaseCost,
      minCost,
      maxCost,
      cb.currency,
      costNormalizationMode
    )
    const deliveryNorm = normalizeDeliveryScore(deliveryDays, minDeliveryDays, missingNeutralScore)
    const qualityNorm = normalizeQualityScore(
      qualityInfo.rating,
      qualityInfo.sourceDescription,
      missingNeutralScore
    )
    const termsNorm = normalizePaymentTermsScore(paymentTerms, missingNeutralScore)
    const reliabilityNorm = normalizeReliabilityScore(q, missingNeutralScore)

    if (qualityInfo.rating !== null) {
      highestQualityRating =
        highestQualityRating === null ? qualityInfo.rating : Math.max(highestQualityRating, qualityInfo.rating)
    }
    if (!termsNorm.isMissing) {
      bestPaymentTermsScore =
        bestPaymentTermsScore === null
          ? termsNorm.normalizedScore
          : Math.max(bestPaymentTermsScore, termsNorm.normalizedScore)
    }
    if (!reliabilityNorm.isMissing) {
      highestReliabilityScore =
        highestReliabilityScore === null
          ? reliabilityNorm.normalizedScore
          : Math.max(highestReliabilityScore, reliabilityNorm.normalizedScore)
    }

    const normalizedScores: Record<FactorKey, number> = {
      cost: costNorm.normalizedScore,
      delivery: deliveryNorm.normalizedScore,
      quality: qualityNorm.normalizedScore,
      paymentTerms: termsNorm.normalizedScore,
      reliability: reliabilityNorm.normalizedScore,
    }

    const { finalScore, weightedContributions } = calculateWeightedFinalScore(
      normalizedScores,
      weights
    )

    const buildDetail = (factor: FactorKey, norm: NormalizedFactorOutput): FactorScoreDetail => {
      const w = weights[factor]
      const wp = Math.round(w * 10000) / 100
      const pts = weightedContributions[factor]
      return {
        factor,
        label: FACTOR_LABELS[factor],
        rawValue: norm.rawValue,
        displayValue: norm.displayValue,
        normalizedScore: norm.normalizedScore,
        weight: w,
        weightPercent: wp,
        weightedPoints: pts,
        formula: norm.formula,
        calculationStep: `${norm.normalizedScore.toFixed(2)} × ${wp}% = ${pts.toFixed(2)} pts`,
        isMissing: norm.isMissing,
        missingDisclosure: norm.missingDisclosure,
        sourceDescription: norm.sourceDescription,
      }
    }

    const factors: Record<FactorKey, FactorScoreDetail> = {
      cost: buildDetail('cost', costNorm),
      delivery: buildDetail('delivery', deliveryNorm),
      quality: buildDetail('quality', qualityNorm),
      paymentTerms: buildDetail('paymentTerms', termsNorm),
      reliability: buildDetail('reliability', reliabilityNorm),
    }

    const missingFields: FactorKey[] = (
      ['cost', 'delivery', 'quality', 'paymentTerms', 'reliability'] as FactorKey[]
    ).filter((k) => factors[k].isMissing)

    // Add missing-field advisories into comparability warnings (transparent disclosure)
    if (deliveryNorm.isMissing) {
      comparability.warnings.push({
        code: 'MISSING_DELIVERY_DAYS',
        severity: 'warning',
        message: `${q.supplierName}: ${deliveryNorm.missingDisclosure}`,
        quotationIds: [q.quotationId],
        supplierNames: [q.supplierName],
      })
    }
    if (qualityNorm.isMissing) {
      comparability.warnings.push({
        code: 'MISSING_QUALITY_RATING',
        severity: 'warning',
        message: `${q.supplierName}: ${qualityNorm.missingDisclosure}`,
        quotationIds: [q.quotationId],
        supplierNames: [q.supplierName],
      })
    }
    if (termsNorm.isMissing) {
      comparability.warnings.push({
        code: 'MISSING_PAYMENT_TERMS',
        severity: 'warning',
        message: `${q.supplierName}: ${termsNorm.missingDisclosure}`,
        quotationIds: [q.quotationId],
        supplierNames: [q.supplierName],
      })
    }
    if (reliabilityNorm.isMissing) {
      comparability.warnings.push({
        code: 'MISSING_RELIABILITY',
        severity: 'warning',
        message: `${q.supplierName}: ${reliabilityNorm.missingDisclosure}`,
        quotationIds: [q.quotationId],
        supplierNames: [q.supplierName],
      })
    }

    preliminary.push({
      quotation: q,
      costBreakdown: cb,
      rawMetrics: {
        totalPurchaseCost: cb.totalPurchaseCost,
        deliveryDays,
        qualityRating: qualityInfo.rating,
        paymentTerms,
        paymentTermsTier: termsNorm.tierLabel ?? null,
        reliabilityRaw: typeof reliabilityNorm.rawValue === 'number' ? reliabilityNorm.rawValue : null,
      },
      normalizedScores,
      weightedContributions,
      factors,
      finalScore,
      missingFields,
    })
  }

  // Requirement 7: Deterministic Ranking with Tie-Breakers
  const sorted = [...preliminary].sort((a, b) => compareEvaluationsDeterministically(a, b).order)

  const leaderScore = sorted.length > 0 ? sorted[0].finalScore : 0

  const rankings: RankedVendorResult[] = sorted.map((item, idx) => {
    const rank = idx + 1
    const rankLabel = formatOrdinalRank(rank)
    const scoreGapFromLeader = roundScore(Math.max(0, leaderScore - item.finalScore))

    // Detect if a tie-breaker was needed relative to an immediate neighbor with identical finalScore
    let tieBreakerApplied: string | null = null
    if (idx > 0 && sorted[idx - 1].finalScore === item.finalScore) {
      tieBreakerApplied = compareEvaluationsDeterministically(sorted[idx - 1], item).tieBreakerReason
    } else if (idx < sorted.length - 1 && sorted[idx + 1].finalScore === item.finalScore) {
      tieBreakerApplied = compareEvaluationsDeterministically(item, sorted[idx + 1]).tieBreakerReason
    }

    const costDeltaVsCheapest =
      item.rawMetrics.totalPurchaseCost !== null && minCost !== null
        ? roundCurrency(item.rawMetrics.totalPurchaseCost - minCost)
        : null

    const costSavingsVsHighest =
      item.rawMetrics.totalPurchaseCost !== null && maxCost !== null
        ? roundCurrency(maxCost - item.rawMetrics.totalPurchaseCost)
        : null

    // Requirement 8: Individual scoring explanation
    const explanation = generateVendorExplanation({
      supplierName: item.quotation.supplierName,
      rank,
      rankLabel,
      totalVendors: sorted.length,
      finalScore: item.finalScore,
      scoreGapFromLeader,
      factors: item.factors,
      tieBreakerApplied,
    })

    return {
      rank,
      rankLabel,
      quotationId: item.quotation.quotationId,
      purchaseRequestId: item.quotation.purchaseRequestId,
      supplierId: item.quotation.supplierId,
      supplierName: item.quotation.supplierName,
      supplierStatus: item.quotation.supplier?.status,
      currency: item.costBreakdown.currency,
      costBreakdown: item.costBreakdown,
      rawMetrics: item.rawMetrics,
      normalizedScores: item.normalizedScores,
      weightedContributions: item.weightedContributions,
      factors: item.factors,
      finalScore: item.finalScore,
      scoreGapFromLeader,
      costDeltaVsCheapest,
      costSavingsVsHighest,
      isRecommended: rank === 1,
      hasMissingData: item.missingFields.length > 0,
      missingFields: item.missingFields,
      tieBreakerApplied,
      explanation,
    }
  })

  // Refresh comparability summary after missing-field warnings have been added
  if (comparability.isComparable && comparability.warnings.length > 0) {
    comparability.summary = `Quotations are comparable with ${comparability.warnings.length} advisory note(s) regarding missing or secondary attributes.`
  }

  const recommendedVendor = rankings.length > 0 ? rankings[0] : null
  const primaryCurrency = activeQuotations[0]?.currency?.toUpperCase() || 'USD'

  const summary = recommendedVendor
    ? `Recommended supplier: ${recommendedVendor.supplierName} (#1 with ${recommendedVendor.finalScore.toFixed(2)}/100${
        recommendedVendor.rawMetrics.totalPurchaseCost !== null
          ? `, total cost ${formatCurrencyValue(recommendedVendor.rawMetrics.totalPurchaseCost, recommendedVendor.currency)}`
          : ''
      }) across ${rankings.length} evaluated quotation${rankings.length === 1 ? '' : 's'}.`
    : 'No quotations evaluated.'

  return {
    purchaseRequestId: purchaseRequest.id,
    purchaseRequestTitle: purchaseRequest.title,
    currency: primaryCurrency,
    comparedAt: new Date().toISOString(),
    weights,
    isStandardWeights: isStandard,
    comparability,
    benchmarks: {
      minCost,
      maxCost,
      avgCost,
      minDeliveryDays,
      maxDeliveryDays,
      highestQualityRating,
      bestPaymentTermsScore,
      highestReliabilityScore,
    },
    rankings,
    recommendedVendor,
    quotationIds: activeQuotations.map((q) => q.quotationId),
    methodology,
    summary,
  }
}

// ---------------------------------------------------------------------------
// 13. Requirement 9: DeepSpace Save Comparison Service (`comparisons` collection)
// ---------------------------------------------------------------------------

export interface SerializedComparisonCriteria {
  version: 1
  deterministic: true
  comparedAt: string
  weights: ComparisonWeights
  isStandardWeights: boolean
  isComparable: boolean
  mismatchCount: number
  warningCount: number
  benchmarks: ComparisonBenchmarks
  rankings: Array<{
    rank: number
    rankLabel: string
    quotationId: string
    supplierId: string
    supplierName: string
    totalPurchaseCost: number | null
    currency: string
    deliveryDays: number | null
    qualityRating: number | null
    paymentTerms: string | null
    finalScore: number
    normalizedScores: Record<FactorKey, number>
    weightedContributions: Record<FactorKey, number>
    missingFields: FactorKey[]
    tieBreakerApplied: string | null
    headline: string
  }>
}

export interface BuildComparisonPayloadOptions {
  title?: string
  notes?: string
  status?: ComparisonStatus
}

/**
 * Builds the exact `comparisons` collection record payload matching `src/schemas/comparisons-schema.ts`:
 * (`purchaseRequestId`, `title`, `quotationIds`, `criteria`, `recommendation`, `notes`, `status`).
 */
export function buildComparisonRecordPayload(
  result: VendorComparisonResult,
  options: BuildComparisonPayloadOptions = {}
): Omit<Comparison, 'organizationId'> {
  const dateLabel = result.comparedAt.split('T')[0]
  const title =
    options.title?.trim() ||
    `${result.purchaseRequestTitle} — Vendor Comparison (${dateLabel})`

  const criteriaPayload: SerializedComparisonCriteria = {
    version: 1,
    deterministic: true,
    comparedAt: result.comparedAt,
    weights: result.weights,
    isStandardWeights: result.isStandardWeights,
    isComparable: result.comparability.isComparable,
    mismatchCount: result.comparability.mismatches.length,
    warningCount: result.comparability.warnings.length,
    benchmarks: result.benchmarks,
    rankings: result.rankings.map((r) => ({
      rank: r.rank,
      rankLabel: r.rankLabel,
      quotationId: r.quotationId,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      totalPurchaseCost: r.rawMetrics.totalPurchaseCost,
      currency: r.currency,
      deliveryDays: r.rawMetrics.deliveryDays,
      qualityRating: r.rawMetrics.qualityRating,
      paymentTerms: r.rawMetrics.paymentTerms,
      finalScore: r.finalScore,
      normalizedScores: r.normalizedScores,
      weightedContributions: r.weightedContributions,
      missingFields: r.missingFields,
      tieBreakerApplied: r.tieBreakerApplied,
      headline: r.explanation.headline,
    })),
  }

  const recommendation = result.recommendedVendor
    ? `${result.recommendedVendor.supplierName} (Score: ${result.recommendedVendor.finalScore.toFixed(2)}/100${
        result.recommendedVendor.rawMetrics.totalPurchaseCost !== null
          ? `, Cost: ${formatCurrencyValue(result.recommendedVendor.rawMetrics.totalPurchaseCost, result.recommendedVendor.currency)}`
          : ''
      }) — ${result.recommendedVendor.explanation.summary}`
    : 'No recommendation available (no valid quotations ranked).'

  const noteParts: string[] = []
  if (options.notes?.trim()) {
    noteParts.push(options.notes.trim())
  }
  if (!result.comparability.isComparable) {
    noteParts.push(`Comparability alert: ${result.comparability.summary}`)
  }

  const status: ComparisonStatus =
    options.status ?? (result.rankings.length >= 2 ? 'completed' : 'in_progress')

  return {
    purchaseRequestId: result.purchaseRequestId,
    title,
    quotationIds: JSON.stringify(result.quotationIds),
    criteria: JSON.stringify(criteriaPayload),
    recommendation,
    notes: noteParts.join('\n\n'),
    status,
  }
}

export interface SaveComparisonParams {
  organizationId: string
  result: VendorComparisonResult
  /**
   * DeepSpace mutation handler from `useOrgMutations<Comparison>('comparisons')`
   * (either `mutations.createWithOrg` or `mutations.create`).
   */
  createComparison: (data: Omit<Comparison, 'organizationId'> | Comparison) => Promise<string>
  title?: string
  notes?: string
  status?: ComparisonStatus
}

export interface SaveComparisonResponse {
  comparisonId: string
  record: Comparison
}

/**
 * Persists a deterministic vendor comparison result into the DeepSpace `comparisons` collection
 * while enforcing multi-tenant `organizationId` and `purchaseRequestId` integrity.
 */
export async function saveComparisonToDeepSpace(
  params: SaveComparisonParams
): Promise<SaveComparisonResponse> {
  const { organizationId, result, createComparison, title, notes, status } = params

  if (!organizationId || !organizationId.trim()) {
    throw new Error('Organization ID is required to save a vendor comparison.')
  }
  if (!result.purchaseRequestId || !result.purchaseRequestId.trim()) {
    throw new Error('Purchase Request ID is required to save a vendor comparison.')
  }
  if (result.quotationIds.length === 0) {
    throw new Error('At least one quotation is required to save a vendor comparison.')
  }

  const payloadWithoutOrg = buildComparisonRecordPayload(result, { title, notes, status })
  const fullRecord: Comparison = {
    organizationId,
    ...payloadWithoutOrg,
  }

  const comparisonId = await createComparison(fullRecord)

  return {
    comparisonId,
    record: fullRecord,
  }
}

/**
 * Safely parses a saved DeepSpace `Comparison` record back into structured quotation IDs
 * and serialized criteria snapshot for history viewing.
 */
export function parseSavedComparison(record: Comparison): {
  quotationIds: string[]
  criteria: SerializedComparisonCriteria | null
} {
  let quotationIds: string[] = []
  if (record.quotationIds) {
    try {
      const parsed = JSON.parse(record.quotationIds)
      if (Array.isArray(parsed)) {
        quotationIds = parsed.map(String)
      }
    } catch {
      quotationIds = record.quotationIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }

  let criteria: SerializedComparisonCriteria | null = null
  if (record.criteria) {
    try {
      const parsed = JSON.parse(record.criteria) as SerializedComparisonCriteria
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rankings)) {
        criteria = parsed
      }
    } catch {
      criteria = null
    }
  }

  return { quotationIds, criteria }
}
