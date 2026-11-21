import type { CollectionSchema } from 'deepspace/schema'

export type ComparisonStatus = 'in_progress' | 'completed'

export type Comparison = {
  organizationId: string
  purchaseRequestId: string
  title: string
  quotationIds?: string
  criteria?: string
  status?: ComparisonStatus | string
  recommendation?: string
  notes?: string
}

export const comparisonsSchema: CollectionSchema = {
  name: 'comparisons',
  columns: [
    { name: 'organizationId', storage: 'text', interpretation: 'plain' },
    { name: 'purchaseRequestId', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'quotationIds', storage: 'text', interpretation: 'plain' },
    { name: 'criteria', storage: 'text', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['in_progress', 'completed'] } },
    { name: 'recommendation', storage: 'text', interpretation: 'plain' },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
