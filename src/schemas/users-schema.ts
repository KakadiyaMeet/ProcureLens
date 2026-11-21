import { USERS_COLUMNS, type CollectionSchema } from 'deepspace/schema'

export type UserRole = 'admin' | 'member' | 'viewer'

export type UserProfile = {
  name?: string
  email?: string
  role?: UserRole | string
  image?: string
}

export const usersSchema: CollectionSchema = {
  name: 'users',
  columns: [...USERS_COLUMNS],
  permissions: {
    viewer: { read: 'own', create: false, update: 'own', delete: false },
    member: { read: 'own', create: false, update: 'own', delete: false },
    admin: { read: true, create: false, update: true, delete: true },
  },
}
