/**
 * ProcureLens — Core Procurement Type Definitions
 */

import type { Organization } from '@/schemas/organizations-schema'
import type { UserProfile, UserRole } from '@/schemas/users-schema'
import type { Supplier, SupplierStatus } from '@/schemas/suppliers-schema'
import type { PurchaseRequest, PRPriority, PRStatus } from '@/schemas/purchase-requests-schema'
import type { Quotation, QuotationStatus } from '@/schemas/quotations-schema'
import type { QuotationItem } from '@/schemas/quotation-items-schema'
import type { Comparison, ComparisonStatus } from '@/schemas/comparisons-schema'
import type { Decision, DecisionStatus } from '@/schemas/decisions-schema'

export type {
  Organization,
  UserProfile,
  UserRole,
  Supplier,
  SupplierStatus,
  PurchaseRequest,
  PRPriority,
  PRStatus,
  Quotation,
  QuotationStatus,
  QuotationItem,
  Comparison,
  ComparisonStatus,
  Decision,
  DecisionStatus,
}

export interface MetricSummary {
  totalPurchaseRequests: number
  activeSuppliers: number
  totalSpend: number
  totalQuotations: number
  pendingApprovals: number
  completedComparisons: number
  avgSavingsPercentage: number
}

export interface BreadcrumbItem {
  label: string
  href?: string
  active?: boolean
}
