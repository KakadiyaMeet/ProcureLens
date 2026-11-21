import { Trophy, Award, Bot, Calculator } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { formatCurrency } from '@/utils'
import type { RankedVendorResult } from '@/lib/vendor-comparison-engine'

export interface WinnerHeroProps {
  winner: RankedVendorResult
  totalVendors: number
  onAward: (vendor: RankedVendorResult) => void
  onInspectMath: (quotationId: string) => void
  onAnalyzeWithAI: () => void
}

export function ComparisonWinnerHero({
  winner,
  totalVendors,
  onAward,
  onInspectMath,
  onAnalyzeWithAI,
}: WinnerHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-emerald-500/5 p-6 spatial-shadow">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="space-y-2.5 max-w-3xl">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <Trophy className="size-3.5" />
              #1 Top-Ranked Supplier
            </span>
            <Badge variant="outline">{totalVendors} Vendors Evaluated</Badge>
            {winner.hasMissingData && (
              <Badge variant="warning">{winner.missingFields.length} Unrated Field(s)</Badge>
            )}
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              {winner.supplierName}
            </h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              {winner.explanation.summary}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="rounded-xl border border-border bg-card/90 px-3.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Cost</p>
              <p className="text-sm font-bold text-foreground mt-0.5">
                {formatCurrency(winner.rawMetrics.totalPurchaseCost, winner.currency)}
              </p>
              {winner.costSavingsVsHighest !== null && winner.costSavingsVsHighest > 0 && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  Saves {formatCurrency(winner.costSavingsVsHighest, winner.currency)} vs highest
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card/90 px-3.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Delivery</p>
              <p className="text-sm font-bold text-foreground mt-0.5">
                {winner.factors.delivery.displayValue}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card/90 px-3.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Quality</p>
              <p className="text-sm font-bold text-foreground mt-0.5">
                {winner.factors.quality.displayValue}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card/90 px-3.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Terms</p>
              <p className="text-sm font-bold text-foreground mt-0.5">
                {winner.factors.paymentTerms.displayValue}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-4 shrink-0 border-t lg:border-t-0 lg:border-l border-border/60 pt-4 lg:pt-0 lg:pl-6">
          <div className="lg:text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Deterministic Score
            </p>
            <div className="flex items-baseline gap-1 lg:justify-end">
              <span className="text-4xl font-extrabold text-primary">
                {winner.finalScore.toFixed(2)}
              </span>
              <span className="text-sm text-muted-foreground">/100</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
              onClick={onAnalyzeWithAI}
            >
              <Bot className="size-4" />
              Analyze with AI
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => onInspectMath(winner.quotationId)}
            >
              <Calculator className="size-4" />
              Inspect Math
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => onAward(winner)}>
              <Award className="size-4" />
              Award Supplier
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
