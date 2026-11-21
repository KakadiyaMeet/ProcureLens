import { useState, useMemo } from 'react'
import { Building2, Pencil, Trash2, Plus, Globe, Phone, Mail } from 'lucide-react'
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
import { validateRequired, validateEmail } from '@/lib/validation'

export type SupplierData = {
  organizationId: string
  name: string
  email: string
  phone: string
  address: string
  category: string
  rating: number
  status: string
  notes: string
  contactPerson: string
  website: string
  taxId: string
}

const INITIAL_FORM: Omit<SupplierData, 'organizationId'> = {
  name: '',
  email: '',
  phone: '',
  address: '',
  category: '',
  rating: 0,
  status: 'active',
  notes: '',
  contactPerson: '',
  website: '',
  taxId: '',
}

export default function SuppliersPage() {
  const { records, status, orgId } = useOrgQuery<SupplierData>('suppliers')
  const { createWithOrg, put, remove } = useOrgMutations<SupplierData>('suppliers')
  const { success, error: toastError } = useToast()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [formData, setFormData] = useState(INITIAL_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const filteredSuppliers = useMemo(() => {
    return records.filter((rec) => {
      const data = rec.data
      const matchesSearch =
        !search.trim() ||
        (data.name && data.name.toLowerCase().includes(search.toLowerCase())) ||
        (data.email && data.email.toLowerCase().includes(search.toLowerCase())) ||
        (data.contactPerson && data.contactPerson.toLowerCase().includes(search.toLowerCase())) ||
        (data.category && data.category.toLowerCase().includes(search.toLowerCase()))

      const matchesStatus =
        statusFilter === 'all' || !statusFilter || data.status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [records, search, statusFilter])

  const handleOpenAdd = () => {
    if (!orgId) {
      toastError('Organization required', 'Please select or create an organization before adding suppliers.')
      return
    }
    setEditingRecordId(null)
    setFormData(INITIAL_FORM)
    setErrors({})
    setIsModalOpen(true)
  }

  const handleOpenEdit = (recId: string, data: SupplierData) => {
    if (!orgId || data.organizationId !== orgId) {
      toastError('Unauthorized', 'This supplier does not belong to your active organization.')
      return
    }
    setEditingRecordId(recId)
    setFormData({
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      address: data.address || '',
      category: data.category || '',
      rating: data.rating ?? 0,
      status: data.status || 'active',
      notes: data.notes || '',
      contactPerson: data.contactPerson || '',
      website: data.website || '',
      taxId: data.taxId || '',
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

    const nameErr = validateRequired(formData.name, 'Supplier name')
    const emailReqErr = validateRequired(formData.email, 'Email address')
    const emailFormatErr = emailReqErr ? null : validateEmail(formData.email)

    const newErrors: Record<string, string> = {}
    if (nameErr) newErrors.name = nameErr
    if (emailReqErr || emailFormatErr) newErrors.email = (emailReqErr || emailFormatErr)!

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    try {
      setIsSubmitting(true)
      if (editingRecordId) {
        const existing = records.find((r) => r.recordId === editingRecordId)
        if (!existing || existing.data.organizationId !== orgId) {
          toastError('Unauthorized', 'You do not have permission to modify this supplier.')
          return
        }

        await put(editingRecordId, {
          name: formData.name.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          address: formData.address.trim(),
          category: formData.category.trim(),
          rating: Number(formData.rating) || 0,
          status: formData.status,
          notes: formData.notes.trim(),
          contactPerson: formData.contactPerson.trim(),
          website: formData.website.trim(),
          taxId: formData.taxId.trim(),
        })
        success('Supplier updated', `${formData.name} was successfully updated.`)
      } else {
        await createWithOrg({
          name: formData.name.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          address: formData.address.trim(),
          category: formData.category.trim(),
          rating: 0,
          status: 'active',
          notes: formData.notes.trim(),
          contactPerson: formData.contactPerson.trim(),
          website: formData.website.trim(),
          taxId: formData.taxId.trim(),
        })
        success('Supplier added', `${formData.name} was successfully added.`)
      }
      setIsModalOpen(false)
      setFormData(INITIAL_FORM)
      setEditingRecordId(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred while saving.'
      toastError('Save failed', msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (recId: string) => {
    if (!orgId) {
      toastError('Organization required', 'Please select an organization first.')
      return
    }

    const existing = records.find((r) => r.recordId === recId)
    if (!existing || existing.data.organizationId !== orgId) {
      toastError('Unauthorized', 'You do not have permission to delete this supplier.')
      return
    }

    try {
      await remove(recId)
      success('Supplier removed', 'The supplier has been removed.')
      setDeleteConfirmId(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not delete supplier.'
      toastError('Delete failed', msg)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Manage your approved vendors, supplier profiles, and contact details."
        actions={
          <Button onClick={handleOpenAdd} className="gap-2">
            <Plus className="size-4" />
            Add Supplier
          </Button>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            placeholder="Search suppliers by name, email, or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            className="w-full sm:w-80"
          />

          <div className="w-full sm:w-48">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="blacklisted">Blacklisted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Showing {filteredSuppliers.length} of {records.length} suppliers
        </div>
      </div>

      {/* Main Content: Loading / Empty / Table */}
      {status === 'loading' ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 w-full animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : !orgId ? (
        <EmptyState
          icon={<Building2 className="size-6 text-muted-foreground" />}
          title="No Organization Selected"
          description="Please set up or select an organization to view and manage suppliers."
          action={{
            label: 'Set Up Organization',
            onClick: () => {
              window.location.href = '/onboarding'
            },
          }}
        />
      ) : filteredSuppliers.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6 text-muted-foreground" />}
          title={search || statusFilter !== 'all' ? 'No suppliers match your search' : 'No suppliers registered yet'}
          description={
            search || statusFilter !== 'all'
              ? 'Try modifying your search query or filter settings.'
              : 'Add your first supplier to begin tracking vendors and requesting quotes.'
          }
          action={{
            label: search || statusFilter !== 'all' ? 'Clear Filters' : 'Add Supplier',
            onClick:
              search || statusFilter !== 'all'
                ? () => {
                    setSearch('')
                    setStatusFilter('all')
                  }
                : handleOpenAdd,
          }}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
              <tr>
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredSuppliers.map((record) => {
                const s = record.data
                return (
                  <tr key={record.recordId} className="transition-colors hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium text-foreground">
                      <div className="flex flex-col">
                        <span>{s.name}</span>
                        {s.website && (
                          <a
                            href={s.website.startsWith('http') ? s.website : `https://${s.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            <Globe className="size-3" />
                            {s.website.replace(/^https?:\/\//, '')}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      <div className="inline-flex items-center gap-1.5">
                        <Mail className="size-3.5 text-muted-foreground/70" />
                        <span>{s.email}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {s.category ? (
                        <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                          {s.category}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={s.status || 'active'} />
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      <div className="flex flex-col text-xs">
                        {s.contactPerson && <span className="font-medium text-foreground">{s.contactPerson}</span>}
                        {s.phone && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Phone className="size-3" />
                            {s.phone}
                          </span>
                        )}
                        {!s.contactPerson && !s.phone && '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(record.recordId, s)}
                          title="Edit supplier"
                          className="size-8"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirmId(record.recordId)}
                          title="Delete supplier"
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

      {/* Add / Edit Supplier Modal */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} size="lg">
        <Modal.Header>
          <Modal.Title>{editingRecordId ? 'Edit Supplier' : 'Add Supplier'}</Modal.Title>
          <Modal.Description>
            {editingRecordId
              ? 'Update the supplier profile, contact information, and business terms.'
              : 'Register a new supplier or vendor to your organization directory.'}
          </Modal.Description>
        </Modal.Header>

        <form onSubmit={handleSubmit}>
          <Modal.Body className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="supplier-name">Supplier Name *</Label>
                <Input
                  id="supplier-name"
                  placeholder="e.g. Acme Industrial Supplies"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value })
                    if (errors.name) setErrors({ ...errors, name: '' })
                  }}
                  className={errors.name ? 'border-destructive' : ''}
                />
                {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="supplier-email">Email Address *</Label>
                <Input
                  id="supplier-email"
                  type="email"
                  placeholder="contact@supplier.com"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData({ ...formData, email: e.target.value })
                    if (errors.email) setErrors({ ...errors, email: '' })
                  }}
                  className={errors.email ? 'border-destructive' : ''}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="supplier-phone">Phone</Label>
                <Input
                  id="supplier-phone"
                  placeholder="+1 (555) 123-4567"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="supplier-contact">Contact Person</Label>
                <Input
                  id="supplier-contact"
                  placeholder="John Doe"
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="supplier-category">Category</Label>
                <Input
                  id="supplier-category"
                  placeholder="e.g. Hardware, IT Equipment, Logistics"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="supplier-status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(val) => setFormData({ ...formData, status: val })}
                >
                  <SelectTrigger id="supplier-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="blacklisted">Blacklisted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="supplier-website">Website</Label>
                <Input
                  id="supplier-website"
                  placeholder="https://acme.com"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="supplier-taxId">Tax ID / VAT Number</Label>
                <Input
                  id="supplier-taxId"
                  placeholder="e.g. US123456789"
                  value={formData.taxId}
                  onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-address">Address</Label>
              <Input
                id="supplier-address"
                placeholder="123 Business Parkway, Suite 400"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-notes">Notes</Label>
              <Textarea
                id="supplier-notes"
                placeholder="Internal notes, payment terms, or delivery expectations..."
                rows={3}
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
              {editingRecordId ? 'Save Changes' : 'Add Supplier'}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <Modal open={true} onClose={() => setDeleteConfirmId(null)} size="sm">
          <Modal.Header>
            <Modal.Title>Delete Supplier</Modal.Title>
            <Modal.Description>
              Are you sure you want to remove this supplier? This action cannot be undone.
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
