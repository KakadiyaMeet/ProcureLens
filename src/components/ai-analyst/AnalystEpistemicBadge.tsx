import { CheckCircle2, Lightbulb, AlertTriangle } from 'lucide-react'

export interface EpistemicBadgeProps {
  marker: 'FACT' | 'SUGGESTION' | 'RISK'
}

export function AnalystEpistemicBadge({ marker }: EpistemicBadgeProps) {
  if (marker === 'FACT') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 className="size-3" />
        FACT
      </span>
    )
  }
  if (marker === 'SUGGESTION') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400 border border-sky-500/20">
        <Lightbulb className="size-3" />
        SUGGESTION
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20">
      <AlertTriangle className="size-3" />
      RISK
    </span>
  )
}
