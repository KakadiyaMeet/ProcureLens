import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_COMPARISON_WEIGHTS,
  MISSING_VALUE_LABEL,
  compareVendorQuotations,
  calculateTotalPurchaseCost,
  verifyComparability,
  normalizeCostScore,
  normalizeDeliveryScore,
  normalizeQualityScore,
  normalizePaymentTermsScore,
  normalizeReliabilityScore,
  normalizeWeights,
  calculateWeightedFinalScore,
  buildComparisonRecordPayload,
  saveComparisonToDeepSpace,
  parseSavedComparison,
  buildComparisonInputsFromRecords,
  type PurchaseRequestInput,
  type ComparisonQuotationInput,
} from './vendor-comparison-engine'

const BASE_PR: PurchaseRequestInput = {
  id: 'pr-101',
  organizationId: 'org-acme',
  title: 'Industrial Servo Motors',
  quantity: 100,
  unit: 'pcs',
  estimatedBudget: 50000,
}

function makeQuotation(overrides: Partial<ComparisonQuotationInput>): ComparisonQuotationInput {
  return {
    quotationId: 'q-default',
    purchaseRequestId: 'pr-101',
    organizationId: 'org-acme',
    supplierId: 'sup-default',
    supplierName: 'Default Supplier',
    currency: 'USD',
    deliveryDays: 10,
    paymentTerms: 'Net 30',
    items: [
      {
        description: 'Industrial Servo Motor 2kW',
        quantity: 100,
        unitPrice: 400,
        unit: 'units',
        specifications: JSON.stringify({
          gstPercentage: 10,
          taxAmount: 4000,
          deliveryCharges: 1000,
          qualityRating: 4.5,
        }),
      },
    ],
    supplier: {
      id: 'sup-default',
      name: 'Default Supplier',
      rating: 4.5,
      status: 'active',
    },
    ...overrides,
  }
}

describe('vendor-comparison-engine', () => {
  describe('Requirement 1: Same Purchase Request enforcement', () => {
    it('throws by default when quotations belong to different Purchase Requests', () => {
      const q1 = makeQuotation({ quotationId: 'q1', supplierName: 'Alpha', purchaseRequestId: 'pr-101' })
      const q2 = makeQuotation({ quotationId: 'q2', supplierName: 'Beta', purchaseRequestId: 'pr-999' })

      expect(() => compareVendorQuotations(BASE_PR, [q1, q2])).toThrow(/different Purchase Requests/i)
    })

    it('filters mismatched quotations and reports PR_MISMATCH when strictPrMatch is false', () => {
      const q1 = makeQuotation({ quotationId: 'q1', supplierName: 'Alpha', purchaseRequestId: 'pr-101' })
      const q2 = makeQuotation({ quotationId: 'q2', supplierName: 'Beta', purchaseRequestId: 'pr-999' })

      const result = compareVendorQuotations(BASE_PR, [q1, q2], { strictPrMatch: false })
      expect(result.rankings).toHaveLength(1)
      expect(result.comparability.isComparable).toBe(false)
      expect(result.comparability.mismatches.some((m) => m.code === 'PR_MISMATCH')).toBe(true)
    })
  })

  describe('Requirement 2: Comparability verification', () => {
    it('marks matching specs, equivalent units (pcs vs units), and PR quantity as comparable', () => {
      const q1 = makeQuotation({ quotationId: 'q1', supplierName: 'Alpha' })
      const q2 = makeQuotation({
        quotationId: 'q2',
        supplierName: 'Beta',
        items: [
          {
            description: 'Industrial Servo Motor 2kW',
            quantity: 100,
            unitPrice: 420,
            unit: 'pieces',
            specifications: JSON.stringify({ gstPercentage: 10, deliveryCharges: 500, qualityRating: 4.0 }),
          },
        ],
      })

      const report = verifyComparability(BASE_PR, [q1, q2])
      expect(report.isComparable).toBe(true)
      expect(report.mismatches).toHaveLength(0)
    })

    it('detects PR quantity mismatch, unit mismatch, currency mismatch, and product specification mismatch', () => {
      const q1 = makeQuotation({
        quotationId: 'q1',
        supplierName: 'Alpha',
        currency: 'USD',
        items: [{ description: 'Industrial Servo Motor 2kW', quantity: 100, unitPrice: 400, unit: 'pcs' }],
      })
      const q2 = makeQuotation({
        quotationId: 'q2',
        supplierName: 'Beta',
        currency: 'EUR',
        items: [{ description: 'Hydraulic Oil Pump 5HP', quantity: 50, unitPrice: 800, unit: 'boxes' }],
      })

      const report = verifyComparability(BASE_PR, [q1, q2])
      expect(report.isComparable).toBe(false)
      const codes = new Set(report.mismatches.map((m) => m.code))
      expect(codes.has('CURRENCY_MISMATCH')).toBe(true)
      expect(codes.has('QUANTITY_MISMATCH_PR')).toBe(true)
      expect(codes.has('QUANTITY_MISMATCH_CROSS_VENDOR')).toBe(true)
      expect(codes.has('UNIT_MISMATCH_PR')).toBe(true)
      expect(codes.has('UNIT_MISMATCH_CROSS_VENDOR')).toBe(true)
      expect(codes.has('SPECIFICATION_MISMATCH')).toBe(true)
    })
  })

  describe('Requirement 3: Total purchase cost calculation', () => {
    it('sums line items subtotal + GST tax + delivery charges with precision rounding', () => {
      const q = makeQuotation({
        items: [
          {
            description: 'Servo Motor',
            quantity: 10,
            unitPrice: 125.5,
            gstPercentage: 18,
            deliveryCharges: 250,
          },
          {
            description: 'Controller',
            quantity: 5,
            unitPrice: 80,
            gstPercentage: 18,
            deliveryCharges: 50,
          },
        ],
      })

      const cb = calculateTotalPurchaseCost(q)
      // Subtotal: 1255 + 400 = 1655
      // Tax: 225.90 + 72.00 = 297.90
      // Delivery: 250 + 50 = 300
      // Total: 2252.90
      expect(cb.itemsSubtotal).toBe(1655)
      expect(cb.taxAmount).toBe(297.9)
      expect(cb.deliveryCharges).toBe(300)
      expect(cb.totalPurchaseCost).toBe(2252.9)
      expect(cb.totalQuantity).toBe(15)
    })
  })

  describe('Requirement 4: Score normalization (0-100)', () => {
    it('normalizes cost (lower is better: minCost / cost * 100)', () => {
      expect(normalizeCostScore(10000, 10000, 12500).normalizedScore).toBe(100)
      expect(normalizeCostScore(12500, 10000, 12500).normalizedScore).toBe(80)
      expect(normalizeCostScore(null, 10000, 12500).normalizedScore).toBe(0)
    })

    it('normalizes delivery (lower days is better: minDays / days * 100)', () => {
      expect(normalizeDeliveryScore(5, 5).normalizedScore).toBe(100)
      expect(normalizeDeliveryScore(10, 5).normalizedScore).toBe(50)
      expect(normalizeDeliveryScore(0, 0).normalizedScore).toBe(100)
      const missing = normalizeDeliveryScore(null, 5)
      expect(missing.isMissing).toBe(true)
      expect(missing.displayValue).toBe(MISSING_VALUE_LABEL)
      expect(missing.normalizedScore).toBe(50)
    })

    it('normalizes quality ((rating / 5) * 100) and never fabricates missing ratings', () => {
      expect(normalizeQualityScore(5).normalizedScore).toBe(100)
      expect(normalizeQualityScore(4.25).normalizedScore).toBe(85)
      const missing = normalizeQualityScore(null)
      expect(missing.isMissing).toBe(true)
      expect(missing.displayValue).toBe(MISSING_VALUE_LABEL)
      expect(missing.normalizedScore).toBe(50)
    })

    it('maps exact payment terms credit ladder', () => {
      expect(normalizePaymentTermsScore('Net 90').normalizedScore).toBe(100)
      expect(normalizePaymentTermsScore('Net 60').normalizedScore).toBe(85)
      expect(normalizePaymentTermsScore('Net 45').normalizedScore).toBe(75)
      expect(normalizePaymentTermsScore('Net 30').normalizedScore).toBe(60)
      expect(normalizePaymentTermsScore('Net 15').normalizedScore).toBe(45)
      expect(normalizePaymentTermsScore('Immediate').normalizedScore).toBe(30)
      expect(normalizePaymentTermsScore('COD').normalizedScore).toBe(30)
      expect(normalizePaymentTermsScore('Advance').normalizedScore).toBe(15)
      expect(normalizePaymentTermsScore('100% Prepayment').normalizedScore).toBe(15)
      expect(normalizePaymentTermsScore('').isMissing).toBe(true)
    })

    it('normalizes reliability from on-time history, rating, and blacklisted status', () => {
      const qOnTime = makeQuotation({
        supplier: { id: 's1', name: 'S1', onTimeDeliveryRate: 90, rating: 5, status: 'active' },
      })
      // 90*0.7 + 100*0.3 = 63 + 30 = 93
      expect(normalizeReliabilityScore(qOnTime).normalizedScore).toBe(93)

      const qBlacklisted = makeQuotation({
        supplier: { id: 's2', name: 'S2', rating: 5, status: 'blacklisted' },
      })
      expect(normalizeReliabilityScore(qBlacklisted).normalizedScore).toBe(0)

      const qMissing = makeQuotation({ supplier: null, reliabilityScore: null })
      expect(normalizeReliabilityScore(qMissing).isMissing).toBe(true)
      expect(normalizeReliabilityScore(qMissing).normalizedScore).toBe(50)
    })
  })

  describe('Requirements 5, 6, 7, 8: Weights, Final Score, Ranking, Tie-Breakers & Explanations', () => {
    it('applies exact 40/25/20/10/5 weights and computes exact weighted final score', () => {
      expect(DEFAULT_COMPARISON_WEIGHTS).toEqual({
        cost: 0.4,
        delivery: 0.25,
        quality: 0.2,
        paymentTerms: 0.1,
        reliability: 0.05,
      })

      // Also supports percentage weights normalization
      expect(
        normalizeWeights({ cost: 40, delivery: 25, quality: 20, paymentTerms: 10, reliability: 5 })
      ).toEqual(DEFAULT_COMPARISON_WEIGHTS)

      const { finalScore, weightedContributions } = calculateWeightedFinalScore({
        cost: 100,
        delivery: 80,
        quality: 90,
        paymentTerms: 60,
        reliability: 80,
      })

      // 40 + 20 + 18 + 6 + 4 = 88
      expect(weightedContributions).toEqual({
        cost: 40,
        delivery: 20,
        quality: 18,
        paymentTerms: 6,
        reliability: 4,
      })
      expect(finalScore).toBe(88)
    })

    it('ranks vendors deterministically regardless of input order and produces detailed explanations', () => {
      const qBudget = makeQuotation({
        quotationId: 'q-budget',
        supplierId: 'sup-1',
        supplierName: 'BudgetCo',
        deliveryDays: 20,
        paymentTerms: 'Advance',
        items: [
          {
            description: 'Industrial Servo Motor 2kW',
            quantity: 100,
            unitPrice: 360,
            unit: 'pcs',
            specifications: JSON.stringify({ gstPercentage: 10, deliveryCharges: 400, qualityRating: 3.5 }),
          },
        ],
        supplier: { id: 'sup-1', name: 'BudgetCo', rating: 3.5, status: 'active' },
      })

      const qBalanced = makeQuotation({
        quotationId: 'q-balanced',
        supplierId: 'sup-2',
        supplierName: 'PrimeTech',
        deliveryDays: 5,
        paymentTerms: 'Net 60',
        items: [
          {
            description: 'Industrial Servo Motor 2kW',
            quantity: 100,
            unitPrice: 380,
            unit: 'pcs',
            specifications: JSON.stringify({ gstPercentage: 10, deliveryCharges: 200, qualityRating: 4.8 }),
          },
        ],
        supplier: { id: 'sup-2', name: 'PrimeTech', rating: 4.8, status: 'active' },
      })

      const qExpensive = makeQuotation({
        quotationId: 'q-expensive',
        supplierId: 'sup-3',
        supplierName: 'LuxuryParts',
        deliveryDays: 10,
        paymentTerms: 'Net 30',
        items: [
          {
            description: 'Industrial Servo Motor 2kW',
            quantity: 100,
            unitPrice: 500,
            unit: 'pcs',
            specifications: JSON.stringify({ gstPercentage: 10, deliveryCharges: 1000, qualityRating: 4.5 }),
          },
        ],
        supplier: { id: 'sup-3', name: 'LuxuryParts', rating: 4.5, status: 'active' },
      })

      const resA = compareVendorQuotations(BASE_PR, [qBudget, qBalanced, qExpensive])
      const resB = compareVendorQuotations(BASE_PR, [qExpensive, qBudget, qBalanced])

      expect(resA.rankings.map((r) => r.quotationId)).toEqual(resB.rankings.map((r) => r.quotationId))
      expect(resA.rankings[0].supplierName).toBe('PrimeTech')
      expect(resA.rankings[0].rank).toBe(1)
      expect(resA.rankings[0].rankLabel).toBe('1st')
      expect(resA.rankings[1].rankLabel).toBe('2nd')
      expect(resA.rankings[2].rankLabel).toBe('3rd')

      // Check explanation integrity
      const topExp = resA.rankings[0].explanation
      expect(topExp.factorBreakdowns).toHaveLength(5)
      expect(topExp.formulaEquation).toContain('0.40')
      expect(topExp.formulaEquation).toContain('0.25')
      expect(topExp.formulaEquation).toContain(resA.rankings[0].finalScore.toFixed(2))
    })

    it('breaks ties deterministically by lower cost, then faster delivery, then alphabetical supplier name', () => {
      const qA = makeQuotation({
        quotationId: 'q-a',
        supplierId: 's-a',
        supplierName: 'Zeta Corp',
        totalAmount: 10000,
        items: [],
        deliveryDays: 10,
        paymentTerms: 'Net 30',
        qualityRating: 4,
        reliabilityScore: 80,
      })
      const qB = makeQuotation({
        quotationId: 'q-b',
        supplierId: 's-b',
        supplierName: 'Alpha Corp',
        totalAmount: 10000,
        items: [],
        deliveryDays: 10,
        paymentTerms: 'Net 30',
        qualityRating: 4,
        reliabilityScore: 80,
      })

      const res = compareVendorQuotations(BASE_PR, [qA, qB])
      expect(res.rankings[0].finalScore).toBe(res.rankings[1].finalScore)
      expect(res.rankings[0].supplierName).toBe('Alpha Corp')
      expect(res.rankings[0].tieBreakerApplied).toMatch(/alphabetically/i)
    })
  })

  describe('Requirement 9: DeepSpace save comparison service & record mapping', () => {
    it('persists comparison payload with all schema fields and parses back cleanly', async () => {
      const q1 = makeQuotation({ quotationId: 'q-1', supplierName: 'Vendor One' })
      const q2 = makeQuotation({ quotationId: 'q-2', supplierName: 'Vendor Two', deliveryDays: 5 })
      const comparisonResult = compareVendorQuotations(BASE_PR, [q1, q2])

      const createMock = vi.fn().mockResolvedValue('comp-rec-123')
      const saved = await saveComparisonToDeepSpace({
        organizationId: 'org-acme',
        result: comparisonResult,
        createComparison: createMock,
        notes: 'Reviewed by procurement committee',
      })

      expect(saved.comparisonId).toBe('comp-rec-123')
      expect(createMock).toHaveBeenCalledTimes(1)
      expect(saved.record.organizationId).toBe('org-acme')
      expect(saved.record.purchaseRequestId).toBe('pr-101')
      expect(saved.record.status).toBe('completed')
      expect(saved.record.recommendation).toContain('Vendor Two')

      const parsed = parseSavedComparison(saved.record)
      expect(parsed.quotationIds).toEqual(['q-1', 'q-2'])
      expect(parsed.criteria?.rankings).toHaveLength(2)
      expect(parsed.criteria?.weights).toEqual(DEFAULT_COMPARISON_WEIGHTS)
    })

    it('rejects saving without organizationId', async () => {
      const q1 = makeQuotation({ quotationId: 'q-1' })
      const comparisonResult = compareVendorQuotations(BASE_PR, [q1])
      const payload = buildComparisonRecordPayload(comparisonResult)
      expect(payload.status).toBe('in_progress')

      await expect(
        saveComparisonToDeepSpace({
          organizationId: '',
          result: comparisonResult,
          createComparison: vi.fn(),
        })
      ).rejects.toThrow(/Organization ID is required/i)
    })

    it('maps raw DeepSpace collection records into engine inputs', () => {
      const mapped = buildComparisonInputsFromRecords({
        purchaseRequestRecord: {
          recordId: 'pr-1',
          data: { organizationId: 'org-1', title: 'Steel Pipes', quantity: 50, unit: 'm' },
        },
        quotationRecords: [
          {
            recordId: 'q-1',
            data: {
              organizationId: 'org-1',
              purchaseRequestId: 'pr-1',
              supplierId: 'sup-1',
              supplierName: 'SteelWorks',
              totalAmount: 5000,
              deliveryDays: 7,
              paymentTerms: 'Net 45',
            },
          },
        ],
        quotationItemRecords: [
          {
            recordId: 'qi-1',
            data: {
              organizationId: 'org-1',
              quotationId: 'q-1',
              description: 'Steel Pipes 2-inch',
              quantity: 50,
              unitPrice: 100,
              unit: 'meters',
            },
          },
        ],
        supplierRecords: [
          {
            recordId: 'sup-1',
            data: {
              organizationId: 'org-1',
              name: 'SteelWorks',
              email: 'sales@steelworks.test',
              rating: 4.6,
              status: 'active',
            },
          },
        ],
      })

      expect(mapped.purchaseRequest.id).toBe('pr-1')
      expect(mapped.quotations).toHaveLength(1)
      expect(mapped.quotations[0].items).toHaveLength(1)
      expect(mapped.quotations[0].supplier?.rating).toBe(4.6)
    })
  })
})
