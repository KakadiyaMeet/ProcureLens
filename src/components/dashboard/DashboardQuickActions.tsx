import { Link } from 'react-router-dom'
import { Plus, Upload, Scale, Bot, Users } from 'lucide-react'
import { Button } from '@/components/ui'

export function DashboardQuickActions() {
  return (
    <div className="card-layer p-5 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Quick Procurement Actions</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Link to="/purchase-requests">
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-9 text-xs">
            <Plus className="size-3.5 text-primary" />
            New PR
          </Button>
        </Link>
        <Link to="/quotation-import">
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-9 text-xs">
            <Upload className="size-3.5 text-sky-500" />
            Import CSV
          </Button>
        </Link>
        <Link to="/comparisons">
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-9 text-xs">
            <Scale className="size-3.5 text-amber-500" />
            Compare Bids
          </Button>
        </Link>
        <Link to="/analyst">
          <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-9 text-xs">
            <Bot className="size-3.5 text-indigo-500" />
            Ask Analyst
          </Button>
        </Link>
      </div>
    </div>
  )
}
