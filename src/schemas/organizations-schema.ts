import type { CollectionSchema } from 'deepspace/schema'

export type OrgSize = '1-10' | '11-50' | '51-200' | '201-500' | '500+'

export type Organization = {
  name: string
  slug: string
  description?: string
  industry?: string
  size?: OrgSize | string
  ownerId?: string
}

export const organizationsSchema: CollectionSchema = {
  name: 'organizations',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'slug', storage: 'text', interpretation: 'plain' },
    { name: 'description', storage: 'text', interpretation: 'plain' },
    { name: 'industry', storage: 'text', interpretation: 'plain' },
    {
      name: 'size',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['1-10', '11-50', '51-200', '201-500', '500+'],
      },
    },
    { name: 'ownerId', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: true, update: 'own', delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
