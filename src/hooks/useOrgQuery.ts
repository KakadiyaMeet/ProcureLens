import { useQuery, useMutations } from 'deepspace'
import { useMemo, useContext } from 'react'
import { OrgContext } from '@/components/OrganizationProvider'

/**
 * React hook providing multi-tenant isolated queries for a collection.
 * Enforces that only records belonging to the currently active organization are returned.
 */
export function useOrgQuery<T extends { organizationId: string }>(collection: string) {
  const ctx = useContext(OrgContext)
  const storedOrgId = typeof window !== 'undefined' ? localStorage.getItem('procurelens-org-id') || '' : ''
  const orgId = ctx?.orgId || storedOrgId

  const { records, status } = useQuery<T>(collection)

  const filtered = useMemo(() => {
    if (!orgId) return []
    return records.filter((r) => r.data && r.data.organizationId === orgId)
  }, [records, orgId])

  return {
    records: filtered,
    allRecords: records,
    status,
    orgId,
    /**
     * Checks if a given record belongs to the currently active organization.
     */
    belongsToOrg: (record: { data?: { organizationId?: string } } | null | undefined): boolean => {
      if (!orgId || !record?.data?.organizationId) return false
      return record.data.organizationId === orgId
    },
  }
}

/**
 * React hook providing organization-scoped mutation helpers.
 * Automatically injects the active organizationId into new records and verifies tenant boundaries.
 */
export function useOrgMutations<T extends { organizationId: string }>(collection: string) {
  const ctx = useContext(OrgContext)
  const storedOrgId = typeof window !== 'undefined' ? localStorage.getItem('procurelens-org-id') || '' : ''
  const orgId = ctx?.orgId || storedOrgId
  const mutations = useMutations<T>(collection)

  return {
    ...mutations,
    orgId,
    /**
     * Create a new record bound to the active organization.
     * Throws an error if no organization is currently active.
     */
    createWithOrg: async (data: Omit<T, 'organizationId'>) => {
      if (!orgId) {
        throw new Error('No active organization selected. Please create or select an organization before adding records.')
      }
      return mutations.create({ ...data, organizationId: orgId } as unknown as T)
    },
    /**
     * Update an existing record while verifying organization ownership.
     */
    updateWithOrgCheck: async (
      recordId: string,
      existingRecord: { data?: { organizationId?: string } } | undefined,
      updates: Partial<T>
    ) => {
      if (!orgId) {
        throw new Error('No active organization selected.')
      }
      if (existingRecord?.data?.organizationId && existingRecord.data.organizationId !== orgId) {
        throw new Error('Multi-tenant violation: Cannot modify record belonging to another organization.')
      }
      return mutations.put(recordId, updates)
    },
    /**
     * Remove an existing record while verifying organization ownership.
     */
    removeWithOrgCheck: async (
      recordId: string,
      existingRecord: { data?: { organizationId?: string } } | undefined
    ) => {
      if (!orgId) {
        throw new Error('No active organization selected.')
      }
      if (existingRecord?.data?.organizationId && existingRecord.data.organizationId !== orgId) {
        throw new Error('Multi-tenant violation: Cannot delete record belonging to another organization.')
      }
      return mutations.remove(recordId)
    },
  }
}
