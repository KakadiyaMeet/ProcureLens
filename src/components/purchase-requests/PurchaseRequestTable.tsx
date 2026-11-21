import { Link } from 'react-router-dom'
import { Calendar, Scale, Edit, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { StatusBadge } from '@/components/StatusBadge'
import { formatCurrency, formatDate } from '@/utils'
import type { PurchaseRequest } from '@/types'

export interface PRTableProps {
  requests: Array<{ recordId: string; data: PurchaseRequest }>
  onEdit: (id: string, pr: PurchaseRequest) => void
  onDelete: (id: string) => void
  onStatusChange: (id: string, newStatus: string, title: string) => void
  isActionBusy?: boolean
}

export function PurchaseRequestTable({
  requests,
  onEdit,
  onDelete,
  onStatusChange,
  isActionBusy,
}: PRTableProps) {
  if (requests.length === 0) return null

  return (
    <div className="card-layer overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-3 px-4">Title</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">Priority</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Budget</th>
              <th className="py-3 px-4">Qty</th>
              <th className="py-3 px-4">Deadline</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {requests.map((r) => {
              const pr = r.data
              return (
                <tr key={r.recordId} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 px-4 font-semibold text-foreground max-w-[200px] truncate">
                    {pr.title}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">{pr.category || 'General'}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={pr.priority || 'medium'} />
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={pr.status || 'draft'} />
                  </td>
                  <td className="py-3 px-4 font-mono font-medium text-foreground">
                    {formatCurrency(pr.estimatedBudget)}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">
                    {pr.quantity} {pr.unit || 'units'}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">
                    <div className="inline-flex items-center gap-1.5 text-xs">
                      <Calendar className="size-3 text-muted-foreground/70" />
                      <span>{formatDate(pr.requiredByDate)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link to={`/comparisons?pr=${r.recordId}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Compare vendor bids"
                          className="size-7 text-primary hover:bg-primary/10"
                        >
                          <Scale className="size-3.5" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => onEdit(r.recordId, pr)}
                      >
                        <Edit className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => onDelete(r.recordId)}
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
    </div>
  )
}
