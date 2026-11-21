import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { aiChatSchemas } from './schemas/ai-chat-schema'
import { organizationsSchema } from './schemas/organizations-schema'
import { suppliersSchema } from './schemas/suppliers-schema'
import { purchaseRequestsSchema } from './schemas/purchase-requests-schema'
import { quotationsSchema } from './schemas/quotations-schema'
import { quotationItemsSchema } from './schemas/quotation-items-schema'
import { comparisonsSchema } from './schemas/comparisons-schema'
import { decisionsSchema } from './schemas/decisions-schema'

// Export all individual collection schemas
export {
  usersSchema,
  settingsSchema,
  aiChatSchemas,
  organizationsSchema,
  suppliersSchema,
  purchaseRequestsSchema,
  quotationsSchema,
  quotationItemsSchema,
  comparisonsSchema,
  decisionsSchema,
}

// Export all model TypeScript types
export * from './schemas/organizations-schema'
export * from './schemas/users-schema'
export * from './schemas/suppliers-schema'
export * from './schemas/purchase-requests-schema'
export * from './schemas/quotations-schema'
export * from './schemas/quotation-items-schema'
export * from './schemas/comparisons-schema'
export * from './schemas/decisions-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  ...aiChatSchemas,
  organizationsSchema,
  suppliersSchema,
  purchaseRequestsSchema,
  quotationsSchema,
  quotationItemsSchema,
  comparisonsSchema,
  decisionsSchema,
]
