import { RotateCcw, DollarSign, Clock, Star, CreditCard, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui'
import {
  FACTOR_LABELS,
  DEFAULT_COMPARISON_WEIGHTS,
  type ComparisonWeights,
  type FactorKey,
} from '@/lib/vendor-comparison-engine'
import type { SliderWeights } from '@/types'

const FACTOR_ORDER: FactorKey[] = ['cost', 'delivery', 'quality', 'paymentTerms', 'reliability']

const FACTOR_META: Record<
  FactorKey,
  { shortLabel: string; barColor: string; directionLabel: string }
> = {
  cost: { shortLabel: 'Cost', barColor: 'bg-indigo-500', directionLabel: 'Lower is better' },
  delivery: { shortLabel: 'Delivery', barColor: 'bg-sky-500', directionLabel: 'Faster is better' },
  quality: { shortLabel: 'Quality', barColor: 'bg-emerald-500', directionLabel: 'Higher is better' },
  paymentTerms: { shortLabel: 'Terms', barColor: 'bg-amber-500', directionLabel: 'Longer credit is better' },
  reliability: { shortLabel: 'Reliability', barColor: 'bg-violet-500', directionLabel: 'Higher is better' },
}

function getFactorIcon(factor: FactorKey) {
  switch (factor) {
    case 'cost':
      return DollarSign
    case 'delivery':
      return Clock
    case 'quality':
      return Star
    case 'paymentTerms':
      return CreditCard
    case 'reliability':
      return ShieldCheck
  }
}

export interface ComparisonWeightSlidersProps {
  sliderWeights: SliderWeights
  normalizedWeights: ComparisonWeights
  isStandardWeights: boolean
  onSliderChange: (factor: FactorKey, val: number) => void
  onResetWeights: () => void
  costNormMode: 'ratio' | 'range'
  onCostNormModeChange: (mode: 'ratio' | 'range') => void
}

export function ComparisonWeightSliders({
  sliderWeights,
  normalizedWeights,
  isStandardWeights,
  onSliderChange,
  onResetWeights,
  costNormMode,
  onCostNormModeChange,
}: ComparisonWeightSlidersProps) {
  return (
    <div className="card-layer p-5 h-full flex flex-col justify-between space-y-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Scoring Weights Customizer
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adjust relative weights; engine auto-normalizes to 100%.
            </p>
          </div>
          <Button
            variant={isStandardWeights ? 'ghost' : 'secondary'}
            size="sm"
            onClick={onResetWeights}
            disabled={isStandardWeights && costNormMode === 'ratio'}
            className="gap-1.5 shrink-0"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>

        {/* Stacked distribution bar */}
        <div className="space-y-1.5">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            {FACTOR_ORDER.map((factor) => (
              <div
                key={factor}
                className={`${FACTOR_META[factor].barColor} transition-all duration-200`}
                style={{ width: `${normalizedWeights[factor] * 100}%` }}
                title={`${FACTOR_LABELS[factor]}: ${(normalizedWeights[factor] * 100).toFixed(1)}%`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {isStandardWeights
                ? 'Standard Weights (40 / 25 / 20 / 10 / 5)'
                : 'Custom Weight Profile Active'}
            </span>
            <span className="font-mono font-semibold text-foreground">
              Effective Total: 100.0%
            </span>
          </div>
        </div>

        {/* 5 Interactive sliders */}
        <div className="space-y-3 pt-1">
          {FACTOR_ORDER.map((factor) => {
            const Icon = getFactorIcon(factor)
            const meta = FACTOR_META[factor]
            const effectivePct = (normalizedWeights[factor] * 100).toFixed(1)
            const standardPct = Math.round(DEFAULT_COMPARISON_WEIGHTS[factor] * 100)

            return (
              <div key={factor} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Icon className="size-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">{FACTOR_LABELS[factor]}</span>
                    <span className="text-[10px] text-muted-foreground">({standardPct}%)</span>
                  </div>
                  <span className="font-mono font-semibold text-primary">{effectivePct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={sliderWeights[factor]}
                  onChange={(e) => onSliderChange(factor, Number(e.target.value))}
                  className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-muted accent-primary"
                />
              </div>
            )
          })}
        </div>
      </div>

      <div className="pt-3 border-t border-border flex items-center justify-between gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground">Cost normalization:</span>
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
          <button
            type="button"
            onClick={() => onCostNormModeChange('ratio')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              costNormMode === 'ratio'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Ratio (min/cost)
          </button>
          <button
            type="button"
            onClick={() => onCostNormModeChange('range')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              costNormMode === 'range'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Linear Range
          </button>
        </div>
      </div>
    </div>
  )
}
