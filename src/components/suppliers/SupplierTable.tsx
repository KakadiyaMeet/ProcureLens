import { Star, Mail, Phone, Edit, Trash2 } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import type { Supplier } from '@/types'

export interface SupplierTableProps {
  suppliers: Array<{ recordId: string; data: Supplier }>
  onEdit: (supplier: { recordId: string; data: Supplier }) => void
  onDelete: (id: string) => void
}

export function SupplierTable({ suppliers, onEdit, onDelete }: SupplierTableProps) {
  if (suppliers.length === 0) {
    return null
  }

  return (
    <div className="card-layer overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-3 px-4">Supplier</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">Contact</th>
              <th className="py-3 px-4">Rating</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {suppliers.map((s) => (
              <tr key={s.recordId} className="hover:bg-muted/30 transition-colors">
                <td className="py-3 px-4 font-semibold text-foreground">
                  {s.data.name}
                  {s.data.contactPerson && (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {s.data.contactPerson}
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-muted-foreground">
                  {s.data.category || 'General'}
                </td>
                <td className="py-3 px-4 text-muted-foreground space-y-0.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <Mail className="size-3 shrink-0" />
                    <span>{s.data.email}</span>
                  </div>
                  {s.data.phone && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <Phone className="size-3 shrink-0" />
                      <span>{s.data.phone}</span>
                    </div>
                  )}
                </td>
                <td className="py-3 px-4">
                  {s.data.rating !== undefined && s.data.rating !== null ? (
                    <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                      <Star className="size-3.5 fill-current" />
                      {s.data.rating.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Unrated</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <Badge
                    variant={
                      s.data.status === 'active'
                        ? 'success'
                        : s.data.status === 'blacklisted'
                          ? 'destructive'
                          : 'secondary'
                    }
                    size="sm"
                    className="capitalize"
                  >
                    {s.data.status || 'Active'}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="inline-flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(s)}>
                      <Edit className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => onDelete(s.recordId)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
