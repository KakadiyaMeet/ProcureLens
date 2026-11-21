import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useAuth } from 'deepspace'
import { useOrganization } from '../../components/OrganizationProvider'
import { buttonVariants, cn } from '@/components/ui'
import {
  Building2,
  FileText,
  BarChart3,
  CheckCircle2,
  Plus,
  ArrowRight,
  Sparkles,
  Layers,
  Clock,
  TrendingUp,
  Activity,
} from 'lucide-react'

export default function HomePage() {
  const auth = useAuth() as any
  const user = auth.user ?? (auth.userId ? { id: auth.userId, name: auth.userId, email: auth.userId } : null)
  const { organization, organizations, orgId } = useOrganization()

  const effectiveOrgId = orgId || (typeof localStorage !== 'undefined' ? localStorage.getItem('procurelens-org-id') || '' : '')

  // Queries
  const { records: suppliers = [], status: suppliersStatus } = useQuery<any>('suppliers')
  const { records: prs = [], status: prsStatus } = useQuery<any>('purchase_requests')
  const { records: comparisons = [], status: comparisonsStatus } = useQuery<any>('comparisons')

  // Filtered counts
  const orgSuppliers = useMemo(() => {
    if (!effectiveOrgId) return suppliers
    return suppliers.filter((r) => r.data?.organizationId === effectiveOrgId)
  }, [suppliers, effectiveOrgId])

  const orgPrs = useMemo(() => {
    if (!effectiveOrgId) return prs
    return prs.filter((r) => r.data?.organizationId === effectiveOrgId)
  }, [prs, effectiveOrgId])

  const orgComparisons = useMemo(() => {
    if (!effectiveOrgId) return comparisons
    return comparisons.filter((r) => r.data?.organizationId === effectiveOrgId)
  }, [comparisons, effectiveOrgId])

  // Active PRs: not completed or cancelled
  const activePrs = useMemo(() => {
    return orgPrs.filter((r) => {
      const s = r.data?.status
      return s !== 'completed' && s !== 'cancelled'
    })
  }, [orgPrs])

  // Pending Comparisons: pending or no decision
  const pendingComparisons = useMemo(() => {
    return orgComparisons.filter((r) => {
      const s = r.data?.status
      const d = r.data?.decision || r.data?.selectedSupplierId
      return s === 'pending' || !d
    })
  }, [orgComparisons])

  // Decisions made
  const decisionsMade = useMemo(() => {
    const decidedPrs = orgPrs.filter((r) => r.data?.status === 'approved' || r.data?.status === 'fulfilled' || r.data?.status === 'completed')
    const decidedComparisons = orgComparisons.filter((r) => Boolean(r.data?.decision || r.data?.selectedSupplierId))
    return Math.max(decidedPrs.length, decidedComparisons.length)
  }, [orgPrs, orgComparisons])

  const isSuppliersLoading = suppliersStatus === 'loading'
  const isPrsLoading = prsStatus === 'loading'
  const isComparisonsLoading = comparisonsStatus === 'loading'

  const greetingName = user?.name || user?.email?.split('@')[0] || 'Team'

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="size-3.5" />
            <span>Procurement Intelligence</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mt-1">
            Welcome back, {greetingName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {organization ? (
              <span>
                Active Workspace: <strong className="text-foreground">{organization.data?.name}</strong>
              </span>
            ) : (
              'Monitor procurement operations, supplier performance, and purchase cycles.'
            )}
          </p>
        </div>

        {/* Quick actions in header */}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/suppliers"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}
          >
            <Building2 className="size-4 text-muted-foreground" />
            <span>Suppliers</span>
          </Link>
          <Link
            to="/purchase-requests"
            className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'inline-flex items-center gap-1.5')}
          >
            <Plus className="size-4" />
            <span>New Request</span>
          </Link>
        </div>
      </div>

      {/* Onboarding Callout if no org */}
      {organizations.length === 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 spatial-shadow flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Layers className="size-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">Set up your Organization</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Create your procurement organization to isolate supplier records, requests, and comparisons.
              </p>
            </div>
          </div>
          <Link
            to="/onboarding"
            className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'inline-flex items-center gap-1.5 whitespace-nowrap')}
          >
            Get Started <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Total Suppliers */}
        <div className="rounded-xl border border-border bg-card p-5 spatial-shadow transition-all hover:spatial-shadow-hover">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Total Suppliers
            </span>
            <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Building2 className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            {isSuppliersLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {orgSuppliers.length}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {orgSuppliers.length === 1 ? '1 active partner' : `${orgSuppliers.length} active partners`}
            </p>
          </div>
        </div>

        {/* Card 2: Active PRs */}
        <div className="rounded-xl border border-border bg-card p-5 spatial-shadow transition-all hover:spatial-shadow-hover">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Active PRs
            </span>
            <div className="flex size-9 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
              <FileText className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            {isPrsLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {activePrs.length}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {orgPrs.length} total requests logged
            </p>
          </div>
        </div>

        {/* Card 3: Pending Comparisons */}
        <div className="rounded-xl border border-border bg-card p-5 spatial-shadow transition-all hover:spatial-shadow-hover">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Pending Comparisons
            </span>
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <BarChart3 className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            {isComparisonsLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {pendingComparisons.length}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Awaiting quotation review
            </p>
          </div>
        </div>

        {/* Card 4: Decisions Made */}
        <div className="rounded-xl border border-border bg-card p-5 spatial-shadow transition-all hover:spatial-shadow-hover">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Decisions Made
            </span>
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            {isPrsLoading || isComparisonsLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {decisionsMade}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Completed evaluations & orders
            </p>
          </div>
        </div>
      </div>

      {/* Quick Action Cards Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="rounded-xl border border-border bg-card p-6 spatial-shadow flex flex-col justify-between">
          <div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
              <Building2 className="size-5" />
            </div>
            <h3 className="font-semibold text-foreground text-base">Supplier Management</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Maintain your vendor directory, contacts, ratings, and performance metrics.
            </p>
          </div>
          <div className="mt-5 pt-4 border-t border-border/60">
            <Link
              to="/suppliers"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full inline-flex items-center justify-center gap-1.5')}
            >
              <Plus className="size-3.5" />
              Add Supplier
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 spatial-shadow flex flex-col justify-between">
          <div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
              <FileText className="size-5" />
            </div>
            <h3 className="font-semibold text-foreground text-base">Purchase Requests</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Initiate requisition orders, define item specifications, and submit for review.
            </p>
          </div>
          <div className="mt-5 pt-4 border-t border-border/60">
            <Link
              to="/purchase-requests"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full inline-flex items-center justify-center gap-1.5')}
            >
              <Plus className="size-3.5" />
              New Request
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 spatial-shadow flex flex-col justify-between">
          <div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
              <BarChart3 className="size-5" />
            </div>
            <h3 className="font-semibold text-foreground text-base">Quotation Comparison</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Side-by-side vendor quotation analysis with price, delivery, and scoring matrices.
            </p>
          </div>
          <div className="mt-5 pt-4 border-t border-border/60">
            <Link
              to="/comparisons"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full inline-flex items-center justify-center gap-1.5')}
            >
              <BarChart3 className="size-3.5" />
              View Comparisons
            </Link>
          </div>
        </div>
      </div>

      {/* Procurement Process / Getting Started */}
      <div className="rounded-xl border border-border bg-card p-6 spatial-shadow">
        <h2 className="text-base font-semibold text-foreground">Procurement Lifecycle</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          How ProcureLens streamlines end-to-end procurement workflows
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-muted/40 border border-border/50">
            <div className="text-xs font-bold text-primary mb-1">01. INGEST</div>
            <div className="font-medium text-sm text-foreground">Create PR</div>
            <p className="text-xs text-muted-foreground mt-1">
              Teams define requisitions, items, budgets, and delivery constraints.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-muted/40 border border-border/50">
            <div className="text-xs font-bold text-primary mb-1">02. SOURCING</div>
            <div className="font-medium text-sm text-foreground">Collect Quotes</div>
            <p className="text-xs text-muted-foreground mt-1">
              Invite vetted suppliers to tender and submit itemized quotations.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-muted/40 border border-border/50">
            <div className="text-xs font-bold text-primary mb-1">03. ANALYSIS</div>
            <div className="font-medium text-sm text-foreground">Matrix Comparison</div>
            <p className="text-xs text-muted-foreground mt-1">
              Automated scoring across unit cost, lead time, and reliability terms.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-muted/40 border border-border/50">
            <div className="text-xs font-bold text-primary mb-1">04. DECISION</div>
            <div className="font-medium text-sm text-foreground">Award & Audit</div>
            <p className="text-xs text-muted-foreground mt-1">
              Lock in selections with complete compliance and audit documentation.
            </p>
          </div>
        </div>
      </div>

      {/* Recent Activity / Live Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Purchase Requests */}
        <div className="rounded-xl border border-border bg-card p-6 spatial-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Recent Purchase Requests</h2>
            </div>
            <Link
              to="/purchase-requests"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>

          {isPrsLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-3/4 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : orgPrs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No purchase requests yet.</p>
              <Link
                to="/purchase-requests"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3 text-xs')}
              >
                <Plus className="size-3 mr-1" /> Create first request
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {[...orgPrs].slice(0, 5).map((rec) => {
                const pr = rec.data
                const statusColors: Record<string, string> = {
                  draft: 'bg-muted text-muted-foreground',
                  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400',
                  approved: 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400',
                  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400',
                  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
                  cancelled: 'bg-muted text-muted-foreground line-through',
                }
                const badgeCls = statusColors[pr?.status] ?? 'bg-muted text-muted-foreground'
                return (
                  <div
                    key={rec.recordId}
                    className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                      <FileText className="size-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{pr?.title || '—'}</div>
                      <div className="text-xs text-muted-foreground truncate">{pr?.category || 'No category'}</div>
                    </div>
                    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium', badgeCls)}>
                      {pr?.status || 'draft'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent Suppliers */}
        <div className="rounded-xl border border-border bg-card p-6 spatial-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Supplier Directory</h2>
            </div>
            <Link
              to="/suppliers"
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>

          {isSuppliersLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="size-8 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-2/3 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-1/3 bg-muted animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : orgSuppliers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Building2 className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No suppliers registered yet.</p>
              <Link
                to="/suppliers"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3 text-xs')}
              >
                <Plus className="size-3 mr-1" /> Add first supplier
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {[...orgSuppliers].slice(0, 5).map((rec) => {
                const s = rec.data
                const initials = (s?.name || '?').slice(0, 2).toUpperCase()
                const statusDot: Record<string, string> = {
                  active: 'bg-emerald-500',
                  inactive: 'bg-muted-foreground',
                  blacklisted: 'bg-destructive',
                }
                const dotCls = statusDot[s?.status] ?? 'bg-muted-foreground'
                return (
                  <div
                    key={rec.recordId}
                    className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400 text-[11px] font-bold">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{s?.name || '—'}</div>
                      <div className="text-xs text-muted-foreground truncate">{s?.category || 'General'}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('size-2 rounded-full', dotCls)} />
                      <span className="text-[11px] text-muted-foreground capitalize">{s?.status || 'active'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Clock / Timestamp footer */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" />
        <span>Dashboard last refreshed on page load. Data is real-time via DeepSpace sync.</span>
      </div>
    </div>
  )
}
