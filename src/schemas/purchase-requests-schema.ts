import type { CollectionSchema } from 'deepspace/schema'

export type PRPriority = 'low' | 'medium' | 'high' | 'urgent'
export type PRStatus = 'draft' | 'pending' | 'approved' | 'in_progress' | 'completed' | 'cancelled'

export type PurchaseRequest = {
  organizationId: string
  title: string
  description?: string
  category?: string
  priority?: PRPriority | string
  status?: PRStatus | string
  quantity?: number
  unit?: string
  estimatedBudget?: number
  requiredByDate?: string
  requestedBy?: string
  approvedBy?: string
  notes?: string
}

export const purchaseRequestsSchema: CollectionSchema = {
  name: 'purchase_requests',
  columns: [
    { name: 'organizationId', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'description', storage: 'text', interpretation: 'plain' },
    { name: 'category', storage: 'text', interpretation: 'plain' },
    { name: 'priority', storage: 'text', interpretation: { kind: 'select', options: ['low', 'medium', 'high', 'urgent'] } },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['draft', 'pending', 'approved', 'in_progress', 'completed', 'cancelled'] } },
    { name: 'quantity', storage: 'number', interpretation: 'plain' },
    { name: 'unit', storage: 'text', interpretation: 'plain' },
    { name: 'estimatedBudget', storage: 'number', interpretation: 'plain' },
    { name: 'requiredByDate', storage: 'text', interpretation: 'plain' },
    { name: 'requestedBy', storage: 'text', interpretation: 'plain' },
    { name: 'approvedBy', storage: 'text', interpretation: 'plain' },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
