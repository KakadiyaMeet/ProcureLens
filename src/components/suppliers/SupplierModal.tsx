import { useState, useEffect } from 'react'
import { Modal, Button, Input, Label, Textarea, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui'
import type { Supplier } from '@/types'

export interface SupplierModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: Partial<Supplier>) => Promise<void>
  initialData?: Supplier | null
  loading?: boolean
}

export function SupplierModal({
  open,
  onClose,
  onSave,
  initialData,
  loading = false,
}: SupplierModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [category, setCategory] = useState('')
  const [rating, setRating] = useState('4.5')
  const [status, setStatus] = useState('active')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || '')
      setEmail(initialData.email || '')
      setPhone(initialData.phone || '')
      setCategory(initialData.category || '')
      setRating(initialData.rating !== undefined ? String(initialData.rating) : '4.5')
      setStatus(initialData.status || 'active')
      setNotes(initialData.notes || '')
    } else {
      setName('')
      setEmail('')
      setPhone('')
      setCategory('')
      setRating('4.5')
      setStatus('active')
      setNotes('')
    }
  }, [initialData, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      category: category.trim() || 'General',
      rating: parseFloat(rating) || 0,
      status,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <Modal.Header>
        <Modal.Title>{initialData ? 'Edit Supplier' : 'Add New Supplier'}</Modal.Title>
        <Modal.Description>
          Maintain verified supplier directory details for procurement quotations.
        </Modal.Description>
      </Modal.Header>
      <form onSubmit={handleSubmit}>
        <Modal.Body className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="supplier-name">Supplier Name</Label>
            <Input
              id="supplier-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Apex Precision Dynamics"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-email">Business Email</Label>
              <Input
                id="supplier-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sales@supplier.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supplier-phone">Phone Number</Label>
              <Input
                id="supplier-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-category">Category</Label>
              <Input
                id="supplier-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Bearings"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supplier-rating">Quality Rating (0–5)</Label>
              <Input
                id="supplier-rating"
                type="number"
                step="0.1"
                min="0"
                max="5"
                value={rating}
                onChange={(e) => setRating(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supplier-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="supplier-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="blacklisted">Blacklisted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supplier-notes">Audit Notes</Label>
            <Textarea
              id="supplier-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ISO certification, delivery terms, payment history..."
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save Supplier
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}
