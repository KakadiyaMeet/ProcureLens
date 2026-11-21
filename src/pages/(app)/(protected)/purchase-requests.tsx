import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  Send,
  CheckCircle2,
  Play,
  CheckSquare,
  Ban,
  Calendar,
  DollarSign,
  User,
  Upload,
  Scale,
} from 'lucide-react'
import { useUser } from 'deepspace'
import {
  Button,
  Input,
  Modal,
  EmptyState,
  SearchInput,
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectContent,
  Label,
  Textarea,
  useToast,
} from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { useOrgQuery, useOrgMutations } from '@/hooks/useOrgQuery'
import {
  validateRequired,
  validatePositiveNumber,
  validateNonNegative,
} from '@/lib/validation'

export type PRData = {
  organizationId: string
  title: string
  description: string
  category: string
  priority: string
  status: string
  quantity: number
  unit: string
  estimatedBudget: number
  requiredByDate: string
  requestedBy: string
  approvedBy: string
  notes: string
}

type PRFormData = {
  title: string
  description: string
  category: string
  priority: string
  quantity: string | number
  unit: string
  estimatedBudget: string | number
  requiredByDate: string
  notes: string
}

const INITIAL_FORM: PRFormData = {
  title: '',
  description: '',
  category: '',
  priority: 'medium',
  quantity: 1,
  unit: 'units',
  estimatedBudget: 0,
  requiredByDate: '',
  notes: '',
}

/** Strict workflow transition matrix */
const VALID_PR_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending', 'cancelled'],
  pending: ['approved', 'cancelled', 'draft'],
  approved: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: ['draft'], // Allows reopening cancelled request as draft
}

function formatCurrency(amount: number | undefined | null) {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

function formatDate(dateStr: string | undefined | null) {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export default function PurchaseRequestsPage() {
  const { user } = useUser()
  const { records, status, orgId } = useOrgQuery<PRData>('purchase_requests')
  const { createWithOrg, put, remove } = useOrgMutations<PRData>('purchase_requests')
  const { success, error: toastError } = useToast()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [formData, setFormData] = useState<PRFormData>(INITIAL_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const filteredRequests = useMemo(() => {
    return records.filter((rec) => {
      const data = rec.data
      const matchesSearch =
        !search.trim() ||
        (data.title && data.title.toLowerCase().includes(search.toLowerCase())) ||
        (data.description && data.description.toLowerCase().includes(search.toLowerCase())) ||
        (data.category && data.category.toLowerCase().includes(search.toLowerCase()))

      const matchesStatus =
        statusFilter === 'all' || !statusFilter || data.status === statusFilter

      const matchesPriority =
        priorityFilter === 'all' || !priorityFilter || data.priority === priorityFilter

      return matchesSearch && matchesStatus && matchesPriority
    })
  }, [records, search, statusFilter, priorityFilter])

  const handleOpenAdd = () => {
    if (!orgId) {
      toastError('Organization required', 'Please select or create an organization before adding purchase requests.')
      return
    }
    setEditingRecordId(null)
    setFormData(INITIAL_FORM)
    setErrors({})
    setIsModalOpen(true)
  }

  const handleOpenEdit = (recId: string, data: PRData) => {
    if (!orgId || data.organizationId !== orgId) {
      toastError('Unauthorized', 'This purchase request does not belong to your active organization.')
      return
    }
    setEditingRecordId(recId)
    setFormData({
      title: data.title || '',
      description: data.description || '',
      category: data.category || '',
      priority: data.priority || 'medium',
      quantity: data.quantity ?? 1,
      unit: data.unit || 'units',
      estimatedBudget: data.estimatedBudget ?? 0,
      requiredByDate: data.requiredByDate || '',
      notes: data.notes || '',
    })
    setErrors({})
    setIsModalOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!orgId) {
      toastError('Organization required', 'Please select or create an organization before saving.')
      return
    }

    const titleErr = validateRequired(formData.title, 'Title')
    const descErr = validateRequired(formData.description, 'Description')
    const qtyErr = validatePositiveNumber(
      typeof formData.quantity === 'string' ? parseFloat(formData.quantity) : formData.quantity,
      'Quantity'
    )
    const budgetErr = validateNonNegative(
      typeof formData.estimatedBudget === 'string'
        ? parseFloat(formData.estimatedBudget)
        : formData.estimatedBudget,
      'Estimated Budget'
    )

    const newErrors: Record<string, string> = {}
    if (titleErr) newErrors.title = titleErr
    if (descErr) newErrors.description = descErr
    if (qtyErr) newErrors.quantity = qtyErr
    if (budgetErr) newErrors.estimatedBudget = budgetErr

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    try {
      setIsSubmitting(true)
      const qtyNumber = typeof formData.quantity === 'string' ? parseFloat(formData.quantity) : formData.quantity
      const budgetNumber =
        typeof formData.estimatedBudget === 'string'
          ? parseFloat(formData.estimatedBudget)
          : formData.estimatedBudget

      if (editingRecordId) {
        const existing = records.find((r) => r.recordId === editingRecordId)
        if (!existing || existing.data.organizationId !== orgId) {
          toastError('Unauthorized', 'You do not have permission to modify this purchase request.')
          return
        }

        await put(editingRecordId, {
          title: formData.title.trim(),
          description: formData.description.trim(),
          category: formData.category.trim(),
          priority: formData.priority,
          quantity: qtyNumber,
          unit: formData.unit.trim() || 'units',
          estimatedBudget: budgetNumber,
          requiredByDate: formData.requiredByDate,
          notes: formData.notes.trim(),
        })
        success('Request updated', `${formData.title} has been updated.`)
      } else {
        await createWithOrg({
          title: formData.title.trim(),
          description: formData.description.trim(),
          category: formData.category.trim(),
          priority: formData.priority || 'medium',
          status: 'draft',
          quantity: qtyNumber,
          unit: formData.unit.trim() || 'units',
          estimatedBudget: budgetNumber,
          requiredByDate: formData.requiredByDate,
          requestedBy: user?.name || user?.email || 'Current User',
          approvedBy: '',
          notes: formData.notes.trim(),
        })
        success('Request created', `${formData.title} was created as a draft.`)
      }

      setIsModalOpen(false)
      setFormData(INITIAL_FORM)
      setEditingRecordId(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save purchase request.'
      toastError('Save failed', msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Strict workflow status transition handler
  const handleStatusChange = async (recId: string, newStatus: string, title: string) => {
    if (!orgId) {
      toastError('Organization required', 'Please select or create an organization first.')
      return
    }

    const existing = records.find((r) => r.recordId === recId)
    if (!existing || existing.data.organizationId !== orgId) {
      toastError('Unauthorized', 'You do not have permission to update this purchase request.')
      return
    }

    const currentStatus = existing.data.status || 'draft'
    const allowed = VALID_PR_TRANSITIONS[currentStatus] || []
    if (!allowed.includes(newStatus)) {
      toastError(
        'Invalid Transition',
        `Cannot move purchase request from "${currentStatus}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none'}`
      )
      return
    }

    try {
      setActionLoadingId(recId)
      const updates: Partial<PRData> = { status: newStatus }
      if (newStatus === 'approved') {
        updates.approvedBy = user?.name || user?.email || 'Authorized Approver'
      }
      await put(recId, updates)

      const statusLabels: Record<string, string> = {
        draft: 'reopened as draft',
        pending: 'submitted for approval',
        approved: 'approved',
        in_progress: 'marked in progress',
        completed: 'completed',
        cancelled: 'cancelled',
      }
      success('Status updated', `"${title}" has been ${statusLabels[newStatus] || newStatus}.`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update status.'
      toastError('Status update failed', msg)
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleDelete = async (recId: string) => {
    if (!orgId) {
      toastError('Organization required', 'Please select an organization first.')
      return
    }

    const existing = records.find((r) => r.recordId === recId)
    if (!existing || existing.data.organizationId !== orgId) {
      toastError('Unauthorized', 'You do not have permission to delete this purchase request.')
      return
    }

    try {
      await remove(recId)
      success('Request deleted', 'The purchase request has been deleted.')
      setDeleteConfirmId(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not delete request.'
      toastError('Delete failed', msg)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Requests"
        description="Create, review, and track purchase requests across your organization."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/quotation-import">
              <Button variant="secondary" className="gap-2">
                <Upload className="size-4" />
                Import Quotations
              </Button>
            </Link>
            <Button onClick={handleOpenAdd} className="gap-2">
              <Plus className="size-4" />
              New Request
            </Button>
          </div>
        }
      />

      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            placeholder="Search by title, description, or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            className="w-full sm:w-80"
          />

          <div className="w-full sm:w-44">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-full sm:w-40">
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Showing {filteredRequests.length} of {records.length} requests
        </div>
      </div>

      {/* Main Content */}
      {status === 'loading' ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 w-full animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : !orgId ? (
        <EmptyState
          icon={<FileText className="size-6 text-muted-foreground" />}
          title="No Organization Selected"
          description="Please set up or select an organization to view and manage purchase requests."
          action={{
            label: 'Set Up Organization',
            onClick: () => {
              window.location.href = '/onboarding'
            },
          }}
        />
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-6 text-muted-foreground" />}
          title={
            search || statusFilter !== 'all' || priorityFilter !== 'all'
              ? 'No purchase requests match your filters'
              : 'No purchase requests found'
          }
          description={
            search || statusFilter !== 'all' || priorityFilter !== 'all'
              ? 'Try adjusting your search terms or filter criteria.'
              : 'Create your first purchase request to begin the procurement workflow.'
          }
          action={{
            label:
              search || statusFilter !== 'all' || priorityFilter !== 'all'
                ? 'Clear Filters'
                : 'New Request',
            onClick:
              search || statusFilter !== 'all' || priorityFilter !== 'all'
                ? () => {
                    setSearch('')
                    setStatusFilter('all')
                    setPriorityFilter('all')
                  }
                : handleOpenAdd,
          }}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
              <tr>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Budget</th>
                <th className="py-3 px-4">Quantity</th>
                <th className="py-3 px-4">Required By</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRequests.map((record) => {
                const pr = record.data
                const isActionBusy = actionLoadingId === record.recordId

                return (
                  <tr key={record.recordId} className="transition-colors hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium text-foreground">
                      <div className="flex flex-col">
                        <span className="font-semibold">{pr.title}</span>
                        {pr.description && (
                          <span className="line-clamp-1 max-w-xs text-xs text-muted-foreground">
                            {pr.description}
                          </span>
                        )}
                        {pr.requestedBy && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <User className="size-3" />
                            {pr.requestedBy}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {pr.category ? (
                        <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                          {pr.category}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={pr.priority || 'medium'} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={pr.status || 'draft'} />
                    </td>
                    <td className="py-3 px-4 font-medium text-foreground">
                      {formatCurrency(pr.estimatedBudget)}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {pr.quantity} {pr.unit || 'units'}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      <div className="inline-flex items-center gap-1.5 text-xs">
                        <Calendar className="size-3.5 text-muted-foreground/70" />
                        <span>{formatDate(pr.requiredByDate)}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Status Workflow Action Buttons */}
                        {pr.status === 'draft' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isActionBusy}
                            onClick={() => handleStatusChange(record.recordId, 'pending', pr.title)}
                            className="h-8 gap-1 text-xs"
                            title="Submit request for approval"
                          >
                            <Send className="size-3" />
                            Submit
                          </Button>
                        )}

                        {pr.status === 'pending' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isActionBusy}
                            onClick={() => handleStatusChange(record.recordId, 'approved', pr.title)}
                            className="h-8 gap-1 bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900 text-xs"
                            title="Approve purchase request"
                          >
                            <CheckCircle2 className="size-3" />
                            Approve
                          </Button>
                        )}

                        {pr.status === 'approved' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isActionBusy}
                            onClick={() => handleStatusChange(record.recordId, 'in_progress', pr.title)}
                            className="h-8 gap-1 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900 text-xs"
                            title="Start procurement process"
                          >
                            <Play className="size-3" />
                            Start
                          </Button>
                        )}

                        {pr.status === 'in_progress' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isActionBusy}
                            onClick={() => handleStatusChange(record.recordId, 'completed', pr.title)}
                            className="h-8 gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900 text-xs"
                            title="Mark as completed"
                          >
                            <CheckSquare className="size-3" />
                            Complete
                          </Button>
                        )}

                        {pr.status !== 'cancelled' && pr.status !== 'completed' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isActionBusy}
                            onClick={() => handleStatusChange(record.recordId, 'cancelled', pr.title)}
                            className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive"
                            title="Cancel request"
                          >
                            <Ban className="size-3" />
                            Cancel
                          </Button>
                        )}

                        {pr.status === 'cancelled' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isActionBusy}
                            onClick={() => handleStatusChange(record.recordId, 'draft', pr.title)}
                            className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                            title="Reopen request as draft"
                          >
                            Reopen
                          </Button>
                        )}

                        {/* Compare Quotes Link */}
                        <Link to={`/comparisons?pr=${record.recordId}`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Compare vendor quotations"
                            className="size-8 text-primary hover:bg-primary/10"
                          >
                            <Scale className="size-3.5" />
                          </Button>
                        </Link>

                        {/* Edit Button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(record.recordId, pr)}
                          title="Edit request"
                          className="size-8"
                        >
                          <Pencil className="size-3.5" />
                        </Button>

                        {/* Delete Button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirmId(record.recordId)}
                          title="Delete request"
                          className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Purchase Request Modal */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} size="lg">
        <Modal.Header>
          <Modal.Title>{editingRecordId ? 'Edit Purchase Request' : 'New Purchase Request'}</Modal.Title>
          <Modal.Description>
            {editingRecordId
              ? 'Update the request specifications, quantities, and budget.'
              : 'Submit a new request for procurement or purchasing approval.'}
          </Modal.Description>
        </Modal.Header>

        <form onSubmit={handleSubmit}>
          <Modal.Body className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pr-title">Request Title *</Label>
              <Input
                id="pr-title"
                placeholder="e.g. 20x Ergonomic Office Chairs"
                value={formData.title}
                onChange={(e) => {
                  setFormData({ ...formData, title: e.target.value })
                  if (errors.title) setErrors({ ...errors, title: '' })
                }}
                className={errors.title ? 'border-destructive' : ''}
              />
              {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pr-desc">Description *</Label>
              <Textarea
                id="pr-desc"
                placeholder="Detailed specifications, business justification, or brand requirements..."
                rows={3}
                value={formData.description}
                onChange={(e) => {
                  setFormData({ ...formData, description: e.target.value })
                  if (errors.description) setErrors({ ...errors, description: '' })
                }}
                className={errors.description ? 'border-destructive' : ''}
              />
              {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pr-category">Category</Label>
                <Input
                  id="pr-category"
                  placeholder="e.g. Office Furniture, IT Hardware, Software"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pr-priority">Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(val) => setFormData({ ...formData, priority: val })}
                >
                  <SelectTrigger id="pr-priority">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pr-quantity">Quantity *</Label>
                <Input
                  id="pr-quantity"
                  type="number"
                  min="0.01"
                  step="any"
                  placeholder="e.g. 10"
                  value={formData.quantity}
                  onChange={(e) => {
                    setFormData({ ...formData, quantity: e.target.value })
                    if (errors.quantity) setErrors({ ...errors, quantity: '' })
                  }}
                  className={errors.quantity ? 'border-destructive' : ''}
                />
                {errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pr-unit">Unit of Measure</Label>
                <Input
                  id="pr-unit"
                  placeholder="e.g. units, pcs, licenses, hours, kg"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pr-budget">Estimated Budget ($) *</Label>
                <Input
                  id="pr-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.estimatedBudget}
                  onChange={(e) => {
                    setFormData({ ...formData, estimatedBudget: e.target.value })
                    if (errors.estimatedBudget) setErrors({ ...errors, estimatedBudget: '' })
                  }}
                  className={errors.estimatedBudget ? 'border-destructive' : ''}
                />
                {errors.estimatedBudget && (
                  <p className="text-xs text-destructive">{errors.estimatedBudget}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pr-date">Required By Date</Label>
                <Input
                  id="pr-date"
                  type="date"
                  value={formData.requiredByDate}
                  onChange={(e) => setFormData({ ...formData, requiredByDate: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pr-notes">Additional Notes</Label>
              <Textarea
                id="pr-notes"
                placeholder="Preferred vendors, delivery address details, or timeline requirements..."
                rows={2}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editingRecordId ? 'Save Changes' : 'Create Request'}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <Modal open={true} onClose={() => setDeleteConfirmId(null)} size="sm">
          <Modal.Header>
            <Modal.Title>Delete Purchase Request</Modal.Title>
            <Modal.Description>
              Are you sure you want to permanently delete this purchase request? This action cannot be undone.
            </Modal.Description>
          </Modal.Header>
          <Modal.Footer>
            <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDelete(deleteConfirmId)}
            >
              Delete
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  )
}
