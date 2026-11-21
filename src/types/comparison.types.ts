/**
 * ProcureLens — Vendor Comparison Engine Type Definitions
 */

import type {
  FactorKey,
  ComparisonWeights,
  PaymentTermsTier,
  RankedVendorResult,
  VendorComparisonResult,
  ScoringMethodology,
  ComparabilityIssue,
  ComparabilityReport,
  CostBreakdown,
  FactorScoreDetail,
  VendorScoreExplanation,
  SerializedComparisonCriteria,
} from '@/lib/vendor-comparison-engine'

export type {
  FactorKey,
  ComparisonWeights,
  PaymentTermsTier,
  RankedVendorResult,
  VendorComparisonResult,
  ScoringMethodology,
  ComparabilityIssue,
  ComparabilityReport,
  CostBreakdown,
  FactorScoreDetail,
  VendorScoreExplanation,
  SerializedComparisonCriteria,
}

export interface SliderWeights {
  cost: number
  delivery: number
  quality: number
  paymentTerms: number
  reliability: number
}

export type CostNormalizationMode = 'ratio' | 'range'
