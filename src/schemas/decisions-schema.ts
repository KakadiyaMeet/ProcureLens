import type { CollectionSchema } from 'deepspace/schema'

export type DecisionStatus = 'pending' | 'approved' | 'rejected'

export type Decision = {
  organizationId: string
  comparisonId: string
  purchaseRequestId: string
  selectedQuotationId: string
  selectedSupplierId?: string
  selectedSupplierName?: string
  totalAmount?: number
  justification?: string
  approvedBy?: string
  status?: DecisionStatus | string
}

export const decisionsSchema: CollectionSchema = {
  name: 'decisions',
  columns: [
    { name: 'organizationId', storage: 'text', interpretation: 'plain' },
    { name: 'comparisonId', storage: 'text', interpretation: 'plain' },
    { name: 'purchaseRequestId', storage: 'text', interpretation: 'plain' },
    { name: 'selectedQuotationId', storage: 'text', interpretation: 'plain' },
    { name: 'selectedSupplierId', storage: 'text', interpretation: 'plain' },
    { name: 'selectedSupplierName', storage: 'text', interpretation: 'plain' },
    { name: 'totalAmount', storage: 'number', interpretation: 'plain' },
    { name: 'justification', storage: 'text', interpretation: 'plain' },
    { name: 'approvedBy', storage: 'text', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['pending', 'approved', 'rejected'] } },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
