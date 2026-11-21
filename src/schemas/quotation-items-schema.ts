import type { CollectionSchema } from 'deepspace/schema'

export type QuotationItem = {
  organizationId: string
  quotationId: string
  description: string
  quantity?: number
  unitPrice?: number
  totalPrice?: number
  unit?: string
  specifications?: string
}

export const quotationItemsSchema: CollectionSchema = {
  name: 'quotation_items',
  columns: [
    { name: 'organizationId', storage: 'text', interpretation: 'plain' },
    { name: 'quotationId', storage: 'text', interpretation: 'plain' },
    { name: 'description', storage: 'text', interpretation: 'plain' },
    { name: 'quantity', storage: 'number', interpretation: 'plain' },
    { name: 'unitPrice', storage: 'number', interpretation: 'plain' },
    { name: 'totalPrice', storage: 'number', interpretation: 'plain' },
    { name: 'unit', storage: 'text', interpretation: 'plain' },
    { name: 'specifications', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
