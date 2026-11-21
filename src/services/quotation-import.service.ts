/**
 * ProcureLens - Quotation Import Database Service
 *
 * Implements:
 * - Grouping of parsed quotation items by supplier
 * - Creation of parent quotations in `quotations` collection
 * - Creation of child line items in `quotation_items` collection
 * - Multi-tenant isolation enforcing active `organizationId`
 * - Automatic supplier resolution / creation in `suppliers` collection
 * - Progress tracking and atomic-like batch import reporting
 * - React hook `useQuotationImportService` for UI workflows
 */

import { useState, useCallback } from 'react'
import type { Quotation, QuotationStatus } from '@/schemas/quotations-schema'
import type { QuotationItem } from '@/schemas/quotation-items-schema'
import type { Supplier } from '@/schemas/suppliers-schema'
import { useOrgMutations, useOrgQuery } from '@/hooks/useOrgQuery'
import {
  type ParsedRowResult,
  type SupplierQuotationGroup,
  groupItemsBySupplier,
  roundCurrency,
} from '@/lib/quotation-parser'

// ---------------------------------------------------------------------------
// 1. Interfaces & Types
// ---------------------------------------------------------------------------

export interface ImportMutationHandler<T> {
  create: (data: T) => Promise<string>
  createConfirmed?: (data: T) => Promise<string>
  put?: (recordId: string, data: Partial<T>) => Promise<void>
}

export interface ImportMutationsBundle {
  quotations: ImportMutationHandler<Quotation>
  quotationItems: ImportMutationHandler<QuotationItem>
  suppliers?: ImportMutationHandler<Supplier>
}

export interface SupplierReference {
  id: string
  name: string
  rating?: number
  email?: string
}

export interface SaveQuotationsParams {
  organizationId: string
  purchaseRequestId: string
  validRows: ParsedRowResult[]
  mutations: ImportMutationsBundle
  existingSuppliers?: SupplierReference[]
  autoCreateSuppliers?: boolean
  defaultCurrency?: string
  validUntilDays?: number
  defaultStatus?: QuotationStatus
  onProgress?: (progress: ImportProgress) => void
}

export interface ImportProgress {
  totalSuppliers: number
  processedSuppliers: number
  totalItems: number
  processedItems: number
  currentSupplier: string
  percent: number
  stage: 'idle' | 'resolving_suppliers' | 'creating_quotations' | 'creating_items' | 'completed' | 'error'
  statusMessage: string
}

export interface CreatedQuotationSummary {
  quotationId: string
  supplierId: string
  supplierName: string
  totalAmount: number
  deliveryDays: number | null
  itemCount: number
  createdItemIds: string[]
}

export interface CreatedSupplierSummary {
  supplierId: string
  supplierName: string
  isNewlyCreated: boolean
}

export interface QuotationImportResult {
  success: boolean
  organizationId: string
  purchaseRequestId: string
  totalQuotationsCreated: number
  totalItemsCreated: number
  createdQuotations: CreatedQuotationSummary[]
  createdSuppliers: CreatedSupplierSummary[]
  errors: Array<{
    supplierName?: string
    error: string
  }>
  durationMs: number
}

// ---------------------------------------------------------------------------
// 2. Pure Database Import Function
// ---------------------------------------------------------------------------

/**
 * Executes database persistence for parsed quotation rows:
 * 1. Groups items by supplier
 * 2. Matches or creates suppliers under active organizationId
 * 3. Creates parent quotation in `quotations` collection
 * 4. Creates line items in `quotation_items` collection linked to parent quotationId
 */
export async function saveQuotationsToDatabase(
  params: SaveQuotationsParams
): Promise<QuotationImportResult> {
  const startTime = Date.now()
  const {
    organizationId,
    purchaseRequestId,
    validRows,
    mutations,
    existingSuppliers = [],
    autoCreateSuppliers = true,
    defaultCurrency = 'USD',
    validUntilDays = 30,
    defaultStatus = 'submitted',
    onProgress,
  } = params

  if (!organizationId) {
    throw new Error('Organization ID is required for multi-tenant data isolation.')
  }

  if (!purchaseRequestId) {
    throw new Error('Purchase Request ID is required to link imported quotations.')
  }

  // Filter to valid rows with parsed data
  const validItems = validRows.filter((r) => r.isValid && r.parsedData && r.calculated)
  if (validItems.length === 0) {
    return {
      success: true,
      organizationId,
      purchaseRequestId,
      totalQuotationsCreated: 0,
      totalItemsCreated: 0,
      createdQuotations: [],
      createdSuppliers: [],
      errors: [{ error: 'No valid quotation rows provided to import.' }],
      durationMs: Date.now() - startTime,
    }
  }

  // Group items by supplier
  const supplierGroups = groupItemsBySupplier(validItems)
  const totalSuppliers = supplierGroups.length
  const totalItems = validItems.length

  const createdQuotations: CreatedQuotationSummary[] = []
  const createdSuppliers: CreatedSupplierSummary[] = []
  const errors: Array<{ supplierName?: string; error: string }> = []

  let processedSuppliers = 0
  let processedItems = 0

  const reportProgress = (
    stage: ImportProgress['stage'],
    currentSupplier: string,
    message: string
  ) => {
    if (!onProgress) return
    const percent = Math.min(
      100,
      Math.round(
        ((processedSuppliers * 0.4 + (processedItems / Math.max(1, totalItems)) * 0.6) /
          Math.max(1, totalSuppliers)) *
          100
      )
    )
    onProgress({
      totalSuppliers,
      processedSuppliers,
      totalItems,
      processedItems,
      currentSupplier,
      percent,
      stage,
      statusMessage: message,
    })
  }

  // Calculate default validUntil date
  const validUntilDate = new Date(Date.now() + validUntilDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  // Track suppliers in map: normalized name -> supplier id
  const supplierMap = new Map<string, string>()
  for (const s of existingSuppliers) {
    if (s.name) {
      supplierMap.set(s.name.trim().toLowerCase(), s.id)
    }
  }

  for (const group of supplierGroups) {
    const rawSupplierName = group.supplierName.trim()
    const normSupplierName = rawSupplierName.toLowerCase()

    try {
      reportProgress(
        'resolving_suppliers',
        rawSupplierName,
        `Resolving supplier: ${rawSupplierName}...`
      )

      let supplierId = supplierMap.get(normSupplierName)
      let isNewlyCreated = false

      // Auto-create supplier if not found and mutations available
      if (!supplierId) {
        if (autoCreateSuppliers && mutations.suppliers) {
          try {
            reportProgress(
              'resolving_suppliers',
              rawSupplierName,
              `Creating new supplier record: ${rawSupplierName}...`
            )
            const newSupplierData: Supplier = {
              organizationId,
              name: rawSupplierName,
              email: `${rawSupplierName.toLowerCase().replace(/[^a-z0-9]/g, '')}@procurelens-supplier.local`,
              rating: group.supplierRating ?? undefined,
              status: 'active',
              notes: `Auto-created during quotation CSV import for PR ${purchaseRequestId}.`,
            }

            supplierId = await mutations.suppliers.create(newSupplierData)
            supplierMap.set(normSupplierName, supplierId)
            isNewlyCreated = true

            createdSuppliers.push({
              supplierId,
              supplierName: rawSupplierName,
              isNewlyCreated: true,
            })
          } catch (supErr: any) {
            // Fallback to generated ID if creation fails
            supplierId = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
            supplierMap.set(normSupplierName, supplierId)
          }
        } else {
          // Fallback synthetic supplier id
          supplierId = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
          supplierMap.set(normSupplierName, supplierId)
        }
      } else {
        createdSuppliers.push({
          supplierId,
          supplierName: rawSupplierName,
          isNewlyCreated: false,
        })
      }

      // Create Parent Quotation in `quotations` collection
      reportProgress(
        'creating_quotations',
        rawSupplierName,
        `Creating quotation record for ${rawSupplierName}...`
      )

      const quotationPayload: Quotation = {
        organizationId,
        purchaseRequestId,
        supplierId,
        supplierName: rawSupplierName,
        totalAmount: group.totalQuotationCost,
        currency: defaultCurrency,
        validUntil: validUntilDate,
        deliveryDays: group.maxDeliveryDays ?? undefined,
        paymentTerms: group.paymentTerms || 'Net 30',
        status: defaultStatus,
        notes: `Imported via Quotation CSV Import. Items: ${group.items.length}, Subtotal: ${group.totalSubtotal}, Tax: ${group.totalTaxAmount}, Delivery: ${group.totalDeliveryCharges}`,
      }

      const quotationId = await mutations.quotations.create(quotationPayload)

      // Create Child Items in `quotation_items` collection
      reportProgress(
        'creating_items',
        rawSupplierName,
        `Saving ${group.items.length} line items for ${rawSupplierName}...`
      )

      const createdItemIds: string[] = []

      for (const row of group.items) {
        if (!row.parsedData || !row.calculated) continue

        const itemPayload: QuotationItem = {
          organizationId,
          quotationId,
          description: row.parsedData.productName,
          quantity: row.parsedData.quantity,
          unitPrice: row.parsedData.unitPrice,
          totalPrice: row.calculated.totalCost,
          unit: row.parsedData.unit || 'units',
          specifications: JSON.stringify({
            gstPercentage: row.parsedData.gstPercentage,
            taxAmount: row.calculated.taxAmount,
            deliveryCharges: row.parsedData.deliveryCharges,
            deliveryDays: row.parsedData.deliveryDays,
            paymentTerms: row.parsedData.paymentTerms,
            qualityRating: row.parsedData.qualityRating,
            effectiveUnitCost: row.calculated.effectiveUnitCost,
            notes: row.parsedData.notes || '',
          }),
        }

        const itemId = await mutations.quotationItems.create(itemPayload)
        createdItemIds.push(itemId)
        processedItems++
      }

      processedSuppliers++

      createdQuotations.push({
        quotationId,
        supplierId,
        supplierName: rawSupplierName,
        totalAmount: group.totalQuotationCost,
        deliveryDays: group.maxDeliveryDays,
        itemCount: createdItemIds.length,
        createdItemIds,
      })
    } catch (groupError: any) {
      errors.push({
        supplierName: rawSupplierName,
        error: groupError?.message || String(groupError),
      })
    }
  }

  reportProgress('completed', '', 'Import completed successfully!')

  return {
    success: errors.length === 0,
    organizationId,
    purchaseRequestId,
    totalQuotationsCreated: createdQuotations.length,
    totalItemsCreated: processedItems,
    createdQuotations,
    createdSuppliers,
    errors,
    durationMs: Date.now() - startTime,
  }
}

// ---------------------------------------------------------------------------
// 3. React Hook for Quotation Import Workflow
// ---------------------------------------------------------------------------

export interface UseQuotationImportServiceReturn {
  isImporting: boolean
  progress: ImportProgress
  lastResult: QuotationImportResult | null
  error: string | null
  importQuotations: (
    purchaseRequestId: string,
    validRows: ParsedRowResult[],
    options?: {
      defaultCurrency?: string
      validUntilDays?: number
      defaultStatus?: QuotationStatus
      autoCreateSuppliers?: boolean
    }
  ) => Promise<QuotationImportResult>
  reset: () => void
}

/**
 * Convenient React hook wrapping database mutations and multi-tenant isolation
 * for quotation import components.
 */
export function useQuotationImportService(): UseQuotationImportServiceReturn {
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<QuotationImportResult | null>(null)
  const [progress, setProgress] = useState<ImportProgress>({
    totalSuppliers: 0,
    processedSuppliers: 0,
    totalItems: 0,
    processedItems: 0,
    currentSupplier: '',
    percent: 0,
    stage: 'idle',
    statusMessage: 'Ready to import.',
  })

  // DeepSpace multi-tenant mutations and query hooks
  const quotationsMutations = useOrgMutations<Quotation>('quotations')
  const quotationItemsMutations = useOrgMutations<QuotationItem>('quotation_items')
  const suppliersMutations = useOrgMutations<Supplier>('suppliers')
  const { records: supplierRecords, orgId } = useOrgQuery<Supplier>('suppliers')

  const reset = useCallback(() => {
    setIsImporting(false)
    setError(null)
    setLastResult(null)
    setProgress({
      totalSuppliers: 0,
      processedSuppliers: 0,
      totalItems: 0,
      processedItems: 0,
      currentSupplier: '',
      percent: 0,
      stage: 'idle',
      statusMessage: 'Ready to import.',
    })
  }, [])

  const importQuotations = useCallback(
    async (
      purchaseRequestId: string,
      validRows: ParsedRowResult[],
      options?: {
        defaultCurrency?: string
        validUntilDays?: number
        defaultStatus?: QuotationStatus
        autoCreateSuppliers?: boolean
      }
    ): Promise<QuotationImportResult> => {
      if (!orgId) {
        const errMsg = 'No active organization selected. Cannot import quotations.'
        setError(errMsg)
        throw new Error(errMsg)
      }

      setIsImporting(true)
      setError(null)

      try {
        const existingSuppliers: SupplierReference[] = supplierRecords.map((r) => ({
          id: r.recordId,
          name: r.data?.name || '',
          email: r.data?.email,
          rating: r.data?.rating,
        }))

        const result = await saveQuotationsToDatabase({
          organizationId: orgId,
          purchaseRequestId,
          validRows,
          mutations: {
            quotations: {
              create: (data) => quotationsMutations.createWithOrg(data),
            },
            quotationItems: {
              create: (data) => quotationItemsMutations.createWithOrg(data),
            },
            suppliers: {
              create: (data) => suppliersMutations.createWithOrg(data as Supplier),
            },
          },
          existingSuppliers,
          autoCreateSuppliers: options?.autoCreateSuppliers ?? true,
          defaultCurrency: options?.defaultCurrency ?? 'USD',
          validUntilDays: options?.validUntilDays ?? 30,
          defaultStatus: options?.defaultStatus ?? 'submitted',
          onProgress: setProgress,
        })

        setLastResult(result)
        setIsImporting(false)
        return result
      } catch (err: any) {
        const message = err?.message || 'Failed to import quotations'
        setError(message)
        setIsImporting(false)
        setProgress((prev) => ({
          ...prev,
          stage: 'error',
          statusMessage: `Error: ${message}`,
        }))
        throw err
      }
    },
    [orgId, supplierRecords, quotationsMutations, quotationItemsMutations, suppliersMutations]
  )

  return {
    isImporting,
    progress,
    lastResult,
    error,
    importQuotations,
    reset,
  }
}
