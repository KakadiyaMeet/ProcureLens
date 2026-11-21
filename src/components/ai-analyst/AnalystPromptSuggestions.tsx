import { Sparkles, ShieldAlert, Award, FileQuestion, HelpCircle, Layers } from 'lucide-react'
import { Button } from '@/components/ui'

export interface PromptSuggestionsProps {
  onSelectPrompt: (prompt: string) => void
  disabled?: boolean
}

export const DEFAULT_PROMPTS = [
  {
    icon: Award,
    title: 'Explain Rankings',
    prompt: 'Explain why the top-ranked vendor won and how the 5 evaluation factors contributed to the final score.',
  },
  {
    icon: ShieldAlert,
    title: 'Identify Procurement Risks',
    prompt: 'Identify any potential procurement risks, sole-supplier dependencies, or lead-time bottlenecks.',
  },
  {
    icon: FileQuestion,
    title: 'Audit Missing Info',
    prompt: 'Highlight any unrated fields, missing payment terms, or incomplete specifications across the vendor bids.',
  },
  {
    icon: Sparkles,
    title: 'Suggest Negotiation Tactics',
    prompt: 'Suggest specific negotiation levers to extract cost or delivery concessions from the leading suppliers.',
  },
]

export function AnalystPromptSuggestions({ onSelectPrompt, disabled = false }: PromptSuggestionsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {DEFAULT_PROMPTS.map((p) => {
        const Icon = p.icon
        return (
          <button
            key={p.title}
            type="button"
            disabled={disabled}
            onClick={() => onSelectPrompt(p.prompt)}
            className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-2.5 text-left transition-all hover:bg-muted/40 hover:border-primary/40 disabled:opacity-50"
          >
            <div className="rounded-lg bg-primary/10 p-1.5 text-primary shrink-0 mt-0.5">
              <Icon className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{p.title}</p>
              <p className="text-[11px] text-muted-foreground line-clamp-1">{p.prompt}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
