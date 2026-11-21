import type { CollectionSchema } from 'deepspace/schema'

export type QuotationStatus = 'draft' | 'submitted' | 'under_review' | 'accepted' | 'rejected'

export type Quotation = {
  organizationId: string
  purchaseRequestId: string
  supplierId: string
  supplierName?: string
  totalAmount?: number
  currency?: string
  validUntil?: string
  deliveryDays?: number
  paymentTerms?: string
  status?: QuotationStatus | string
  notes?: string
}

export const quotationsSchema: CollectionSchema = {
  name: 'quotations',
  columns: [
    { name: 'organizationId', storage: 'text', interpretation: 'plain' },
    { name: 'purchaseRequestId', storage: 'text', interpretation: 'plain' },
    { name: 'supplierId', storage: 'text', interpretation: 'plain' },
    { name: 'supplierName', storage: 'text', interpretation: 'plain' },
    { name: 'totalAmount', storage: 'number', interpretation: 'plain' },
    { name: 'currency', storage: 'text', interpretation: 'plain' },
    { name: 'validUntil', storage: 'text', interpretation: 'plain' },
    { name: 'deliveryDays', storage: 'number', interpretation: 'plain' },
    { name: 'paymentTerms', storage: 'text', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['draft', 'submitted', 'under_review', 'accepted', 'rejected'] } },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
