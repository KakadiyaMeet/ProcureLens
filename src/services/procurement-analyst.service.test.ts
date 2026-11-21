import { describe, it, expect } from 'vitest'
import {
  compareVendorQuotations,
  type PurchaseRequestInput,
  type ComparisonQuotationInput,
} from '@/lib/vendor-comparison-engine'
import {
  generateFallbackAnalysis,
  analyseComparison,
  explainSupplierRankings,
  identifyProcurementRisks,
  highlightMissingQuotationInfo,
  suggestNegotiationStrategies,
  buildGroundedQAContext,
  generateExecutiveSummary,
} from './procurement-analyst.service'

const BASE_PR: PurchaseRequestInput = {
  id: 'pr-test-1',
  organizationId: 'org-test',
  title: 'High-Precision Ball Bearings',
  quantity: 500,
  unit: 'units',
  estimatedBudget: 25000,
}

function makeQuotation(overrides: Partial<ComparisonQuotationInput>): ComparisonQuotationInput {
  return {
    quotationId: 'q-1',
    purchaseRequestId: 'pr-test-1',
    organizationId: 'org-test',
    supplierId: 'sup-1',
    supplierName: 'Acme Bearings',
    currency: 'USD',
    deliveryDays: 7,
    paymentTerms: 'Net 30',
    items: [
      {
        description: 'Ball Bearing ABEC-7',
        quantity: 500,
        unitPrice: 40,
        unit: 'units',
        specifications: JSON.stringify({
          gstPercentage: 10,
          taxAmount: 2000,
          deliveryCharges: 500,
          qualityRating: 4.8,
        }),
      },
    ],
    supplier: {
      id: 'sup-1',
      name: 'Acme Bearings',
      rating: 4.8,
      status: 'active',
    },
    ...overrides,
  }
}

describe('ProcurementAnalystService — Deterministic & Fallback Verification', () => {
  const ctx = { organizationId: 'org-test' }

  const q1 = makeQuotation({
    quotationId: 'q-1',
    supplierId: 'sup-1',
    supplierName: 'Acme Bearings',
    deliveryDays: 5,
    items: [{
      description: 'Ball Bearing ABEC-7',
      quantity: 500,
      unitPrice: 38,
      unit: 'units',
      specifications: JSON.stringify({ gstPercentage: 10, deliveryCharges: 200, qualityRating: 4.8 }),
    }],
  })

  const q2 = makeQuotation({
    quotationId: 'q-2',
    supplierId: 'sup-2',
    supplierName: 'Global Precision',
    deliveryDays: 14,
    paymentTerms: 'Net 60',
    items: [{
      description: 'Ball Bearing ABEC-7',
      quantity: 500,
      unitPrice: 50,
      unit: 'units',
      specifications: JSON.stringify({ gstPercentage: 10, deliveryCharges: 500, qualityRating: 4.2 }),
    }],
  })

  const comparison = compareVendorQuotations(BASE_PR, [q1, q2])

  describe('AI Failure Mode Fallback Handling', () => {
    it('generates fallback analysis on rate_limit with epistemic markers and disclaimer', () => {
      const fallback = generateFallbackAnalysis(ctx, comparison, 'rate_limit')
      expect(fallback.isFallback).toBe(true)
      expect(fallback.text).toContain('AI service rate limit reached')
      expect(fallback.text).toContain('[FACT]')
      expect(fallback.text).toContain('Acme Bearings')
      expect(fallback.text).toContain('⚠️ Approval of this recommendation requires explicit authorisation')
    })

    it('generates fallback analysis on timeout', () => {
      const fallback = generateFallbackAnalysis(ctx, comparison, 'timeout')
      expect(fallback.isFallback).toBe(true)
      expect(fallback.text).toContain('AI service timed out')
      expect(fallback.text).toContain('[FACT]')
    })

    it('generates fallback analysis on unavailable', () => {
      const fallback = generateFallbackAnalysis(ctx, comparison, 'unavailable')
      expect(fallback.isFallback).toBe(true)
      expect(fallback.text).toContain('AI service temporarily unavailable')
    })

    it('generates fallback analysis on error', () => {
      const fallback = generateFallbackAnalysis(ctx, comparison, 'error')
      expect(fallback.isFallback).toBe(true)
      expect(fallback.text).toContain('AI service error')
    })

    it('handles comparison with missing supplier or tie gracefully in fallback', () => {
      const emptyComparison = {
        ...comparison,
        rankings: [],
        recommendedVendor: null,
      }
      const fallback = generateFallbackAnalysis(ctx, emptyComparison, 'rate_limit')
      expect(fallback.text).toContain('Insufficient data')
      expect(fallback.text).toContain('0 quotation(s) compared')
    })
  })

  describe('Deterministic Rule-Based Analysis Capabilities', () => {
    it('produces structured comparison analysis verbatim without AI', () => {
      const result = analyseComparison(ctx, comparison)
      expect(result.text).toContain('## Vendor Comparison Analysis')
      expect(result.text).toContain('[FACT]')
      expect(result.text).toContain('2 supplier(s) were evaluated')
      expect(result.text).toContain('Acme Bearings')
    })

    it('explains supplier rankings with 5 factors and exact percentages', () => {
      const result = explainSupplierRankings(ctx, comparison)
      expect(result.text).toContain('Cost: 40%')
      expect(result.text).toContain('Delivery: 25%')
      expect(result.text).toContain('Quality: 20%')
      expect(result.text).toContain('Payment Terms: 10%')
      expect(result.text).toContain('Reliability: 5%')
      expect(result.text).toContain('Total Cost:')
      expect(result.text).toContain('Delivery Time:')
    })

    it('identifies price variance and sole supplier risks deterministically', () => {
      // 1 quotation -> sole supplier
      const soleComparison = compareVendorQuotations(BASE_PR, [q1], { strictPrMatch: true })
      const soleRisk = identifyProcurementRisks(ctx, { comparison: soleComparison })
      expect(soleRisk.risks.some((r) => r.code === 'SOLE_SUPPLIER_RISK')).toBe(true)
      expect(soleRisk.analysis.text).toContain('SOLE_SUPPLIER_RISK')

      // 2 quotations with > 15% price variance
      const priceRisk = identifyProcurementRisks(ctx, { comparison })
      expect(priceRisk.risks.some((r) => r.code === 'PRICE_VARIANCE_RISK')).toBe(true)
    })

    it('highlights missing quotation fields accurately', () => {
      const incompleteQuotation = {
        quotationId: 'q-inc',
        supplierName: 'Incomplete Supplier',
        hasPaymentTerms: false,
        hasDeliveryDays: false,
        hasQualityRating: false,
        hasValidUntil: true,
        hasItems: true,
        hasSpecifications: true,
      }
      const result = highlightMissingQuotationInfo(ctx, [incompleteQuotation])
      expect(result.text).toContain('Incomplete Supplier')
      expect(result.text).toContain('Payment Terms, Delivery Days, Quality Rating')
      expect(result.text).toContain('Request **Payment Terms**')
      expect(result.text).toContain('Request **Delivery Days**')
      expect(result.text).toContain('Request **Quality Rating**')
    })

    it('suggests actionable negotiation strategies', () => {
      const result = suggestNegotiationStrategies(ctx, comparison)
      expect(result.text).toContain('## Negotiation Strategy Recommendations')
      expect(result.text).toContain('[SUGGESTION]')
      expect(result.text).toContain('Counter-offer: request a price reduction')
    })

    it('builds grounded QA context without hallucination', () => {
      const { systemAddendum, userContext } = buildGroundedQAContext(ctx, 'What is the delivery time?', comparison)
      expect(systemAddendum).toContain('Answer the question below using ONLY the data')
      expect(userContext).toContain('High-Precision Ball Bearings')
      expect(userContext).toContain('Acme Bearings')
    })

    it('generates an executive purchasing summary with non-autonomous disclaimer', () => {
      const summary = generateExecutiveSummary(ctx, comparison, {
        estimatedBudget: 25000,
        requiredByDate: '2026-12-01',
        requestedBy: 'Engineering Ops',
      })
      expect(summary.text).toContain('## Executive Purchasing Summary')
      expect(summary.text).toContain('Engineering Ops')
      expect(summary.text).toContain('⚠️ Approval of this recommendation requires explicit authorisation')
    })
  })
})
