import { createContext, useContext, useMemo, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useQuery, useAuth } from 'deepspace'

export type Org = {
  name: string
  slug: string
  description: string
  industry: string
  size: string
  ownerId: string
}

export interface OrgContextValue {
  organization: any | null
  organizations: any[]
  orgId: string
  switchOrg: (id: string) => void
  isLoading: boolean
  /**
   * Returns `true` if the given record belongs to the active organization.
   * Use this for client-side privacy checks in multi-tenant data lists.
   */
  belongsToOrg: (record: { data?: { organizationId?: string } }) => boolean
}

export const OrgContext = createContext<OrgContextValue | null>(null)

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const auth = useAuth() as any
  const user = auth.user ?? (auth.userId ? { id: auth.userId } : null)
  const { records, status } = useQuery<Org>('organizations')
  const [orgId, setOrgId] = useState(() => {
    try {
      return localStorage.getItem('procurelens-org-id') || ''
    } catch {
      return ''
    }
  })

  const userOrgs = useMemo(
    () => records.filter((r) => r.data?.ownerId === user?.id || r.createdBy === user?.id),
    [records, user?.id]
  )

  const organization = useMemo(
    () => userOrgs.find((r) => r.recordId === orgId) || userOrgs[0] || null,
    [userOrgs, orgId]
  )

  useEffect(() => {
    if (organization && organization.recordId !== orgId) {
      setOrgId(organization.recordId)
      try {
        localStorage.setItem('procurelens-org-id', organization.recordId)
      } catch {
        // ignore localStorage errors
      }
    }
  }, [organization, orgId])

  const switchOrg = (id: string) => {
    setOrgId(id)
    try {
      localStorage.setItem('procurelens-org-id', id)
    } catch {
      // ignore
    }
  }

  // Multi-tenant privacy guard: only return true for records belonging to the
  // active organization. If no org is active yet, no records pass the check.
  const effectiveOrgId = organization?.recordId || orgId
  const belongsToOrg = useCallback(
    (record: { data?: { organizationId?: string } }) => {
      if (!effectiveOrgId) return false
      return record.data?.organizationId === effectiveOrgId
    },
    [effectiveOrgId]
  )

  return (
    <OrgContext.Provider
      value={{
        organization,
        organizations: userOrgs,
        orgId: organization?.recordId || '',
        switchOrg,
        isLoading: (status as string) === 'connecting' || status === 'loading',
        belongsToOrg,
      }}
    >
      {children}
    </OrgContext.Provider>
  )
}

export function useOrganization() {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrganization must be used within OrganizationProvider')
  return ctx
}

/** Convenience hook to retrieve just the active organization ID. */
export function useOrganizationId(): string {
  return useOrganization().orgId
}
