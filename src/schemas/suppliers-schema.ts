import type { CollectionSchema } from 'deepspace/schema'

export type SupplierStatus = 'active' | 'inactive' | 'blacklisted'

export type Supplier = {
  organizationId: string
  name: string
  email: string
  phone?: string
  address?: string
  category?: string
  rating?: number
  status?: SupplierStatus | string
  notes?: string
  contactPerson?: string
  website?: string
  taxId?: string
}

export const suppliersSchema: CollectionSchema = {
  name: 'suppliers',
  columns: [
    { name: 'organizationId', storage: 'text', interpretation: 'plain' },
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'email', storage: 'text', interpretation: 'plain' },
    { name: 'phone', storage: 'text', interpretation: 'plain' },
    { name: 'address', storage: 'text', interpretation: 'plain' },
    { name: 'category', storage: 'text', interpretation: 'plain' },
    { name: 'rating', storage: 'number', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['active', 'inactive', 'blacklisted'] } },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
    { name: 'contactPerson', storage: 'text', interpretation: 'plain' },
    { name: 'website', storage: 'text', interpretation: 'plain' },
    { name: 'taxId', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
