import type { ReactNode } from 'react'

export interface DashboardMetricsCardProps {
  title: string
  value: string | number
  description?: string
  icon: ReactNode
  trend?: {
    value: string
    isPositive?: boolean
  }
  badge?: string
}

export function DashboardMetricsCard({
  title,
  value,
  description,
  icon,
  trend,
  badge,
}: DashboardMetricsCardProps) {
  return (
    <div className="card-layer p-5 transition-all hover:card-layer-hover">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <div className="rounded-xl border border-border bg-secondary/80 p-2 text-primary">
          {icon}
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        {badge && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {badge}
          </span>
        )}
      </div>
      {(description || trend) && (
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          {description && <p>{description}</p>}
          {trend && (
            <span
              className={`font-medium ${
                trend.isPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {trend.value}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
