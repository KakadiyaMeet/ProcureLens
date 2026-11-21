import { Clock, CheckCircle2, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui'
import { formatDate, formatCurrency } from '@/utils'

export interface ActivityItem {
  id: string
  title: string
  type: 'pr' | 'quote' | 'decision'
  timestamp: string
  amount?: number
  status?: string
}

export interface DashboardRecentActivityProps {
  items: ActivityItem[]
}

export function DashboardRecentActivity({ items }: DashboardRecentActivityProps) {
  if (items.length === 0) {
    return (
      <div className="card-layer p-5 text-center text-muted-foreground text-xs py-8">
        No recent activity logged for this organization.
      </div>
    )
  }

  return (
    <div className="card-layer p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          Recent Procurement Activity
        </h3>
        <Link to="/comparisons" className="text-xs text-primary hover:underline flex items-center gap-1">
          View history <ArrowRight className="size-3" />
        </Link>
      </div>

      <div className="divide-y divide-border/60">
        {items.map((item) => (
          <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-xs first:pt-0 last:pb-0">
            <div className="min-w-0 flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{item.title}</p>
                <p className="text-[11px] text-muted-foreground">{formatDate(item.timestamp)}</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              {item.amount !== undefined && (
                <p className="font-mono font-medium text-foreground">{formatCurrency(item.amount)}</p>
              )}
              {item.status && (
                <Badge variant="outline" size="sm" className="capitalize text-[10px]">
                  {item.status}
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
