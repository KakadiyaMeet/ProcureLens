import { useState, useEffect } from 'react'
import { Modal, Button, Input, Label, Textarea, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui'
import type { PurchaseRequest } from '@/types'

export interface PRModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: Partial<PurchaseRequest>) => Promise<void>
  initialData?: PurchaseRequest | null
  loading?: boolean
}

export function PurchaseRequestModal({
  open,
  onClose,
  onSave,
  initialData,
  loading = false,
}: PRModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('medium')
  const [quantity, setQuantity] = useState('100')
  const [unit, setUnit] = useState('pcs')
  const [budget, setBudget] = useState('5000')
  const [requiredByDate, setRequiredByDate] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || '')
      setDescription(initialData.description || '')
      setCategory(initialData.category || '')
      setPriority(initialData.priority || 'medium')
      setQuantity(initialData.quantity !== undefined ? String(initialData.quantity) : '100')
      setUnit(initialData.unit || 'pcs')
      setBudget(initialData.estimatedBudget !== undefined ? String(initialData.estimatedBudget) : '5000')
      setRequiredByDate(initialData.requiredByDate || '')
      setNotes(initialData.notes || '')
    } else {
      setTitle('')
      setDescription('')
      setCategory('')
      setPriority('medium')
      setQuantity('100')
      setUnit('pcs')
      setBudget('5000')
      setRequiredByDate('')
      setNotes('')
    }
  }, [initialData, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      category: category.trim() || 'General',
      priority,
      quantity: parseFloat(quantity) || 1,
      unit: unit.trim() || 'pcs',
      estimatedBudget: parseFloat(budget) || 0,
      requiredByDate: requiredByDate || undefined,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <Modal.Header>
        <Modal.Title>{initialData ? 'Edit Purchase Request' : 'New Purchase Request'}</Modal.Title>
        <Modal.Description>
          Specify required procurement items, quantities, and budget threshold.
        </Modal.Description>
      </Modal.Header>
      <form onSubmit={handleSubmit}>
        <Modal.Body className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pr-title">Request Title</Label>
            <Input
              id="pr-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Precision CNC Ball Bearings (Batch 500)"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-category">Category</Label>
              <Input
                id="pr-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Mechanical Components"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="pr-priority">
                  <SelectValue />
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-qty">Quantity</Label>
              <Input
                id="pr-qty"
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-unit">Unit</Label>
              <Input
                id="pr-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g. pcs, kg, sets"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-budget">Est. Budget ($)</Label>
              <Input
                id="pr-budget"
                type="number"
                min="0"
                required
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-date">Required By Date</Label>
            <Input
              id="pr-date"
              type="date"
              value={requiredByDate}
              onChange={(e) => setRequiredByDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-desc">Technical Specifications &amp; Notes</Label>
            <Textarea
              id="pr-desc"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Material requirements, tolerances, delivery location..."
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save Request
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}
