import { Trophy, Calculator, Award } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import type { RankedVendorResult, FactorKey, ComparisonWeights } from '@/lib/vendor-comparison-engine'

const FACTOR_ORDER: FactorKey[] = ['cost', 'delivery', 'quality', 'paymentTerms', 'reliability']
const FACTOR_LABELS: Record<FactorKey, string> = {
  cost: 'Cost',
  delivery: 'Delivery',
  quality: 'Quality',
  paymentTerms: 'Terms',
  reliability: 'Reliability',
}

export interface MatrixTableProps {
  rankings: RankedVendorResult[]
  weights: ComparisonWeights
  onInspectMath: (quotationId: string) => void
  onAward: (vendor: RankedVendorResult) => void
}

export function ComparisonMatrixTable({
  rankings,
  weights,
  onInspectMath,
  onAward,
}: MatrixTableProps) {
  if (rankings.length === 0) return null

  return (
    <div className="card-layer overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-3 px-4">Rank</th>
              <th className="py-3 px-4">Supplier</th>
              {FACTOR_ORDER.map((f) => (
                <th key={f} className="py-3 px-4 whitespace-nowrap">
                  {FACTOR_LABELS[f]} ({(weights[f] * 100).toFixed(0)}%)
                </th>
              ))}
              <th className="py-3 px-4 text-right">Final Score</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rankings.map((vendor) => (
              <tr
                key={vendor.quotationId}
                onClick={() => onInspectMath(vendor.quotationId)}
                className={`cursor-pointer hover:bg-muted/30 transition-colors ${
                  vendor.rank === 1 ? 'bg-primary/[0.03]' : ''
                }`}
              >
                <td className="py-3 px-4 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${
                      vendor.rank === 1
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'border-border bg-muted text-muted-foreground'
                    }`}
                  >
                    {vendor.rank === 1 && <Trophy className="size-3" />}
                    {vendor.rankLabel}
                  </span>
                </td>

                <td className="py-3 px-4 font-semibold text-foreground">
                  {vendor.supplierName}
                  {vendor.isRecommended && (
                    <Badge variant="success" size="sm" className="ml-2">
                      Leader
                    </Badge>
                  )}
                </td>

                {FACTOR_ORDER.map((f) => {
                  const factor = vendor.factors[f]
                  return (
                    <td key={f} className="py-3 px-4 whitespace-nowrap">
                      <div>{factor.displayValue}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        +{factor.weightedPoints.toFixed(1)} pts
                      </div>
                    </td>
                  )
                })}

                <td className="py-3 px-4 text-right whitespace-nowrap">
                  <span className="font-mono font-bold text-sm text-primary">
                    {vendor.finalScore.toFixed(2)}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {vendor.rank === 1 ? 'Leader' : `−${vendor.scoreGapFromLeader.toFixed(2)} pts`}
                  </span>
                </td>

                <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => onInspectMath(vendor.quotationId)}
                    >
                      <Calculator className="size-3" />
                      Math
                    </Button>
                    <Button
                      variant={vendor.rank === 1 ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => onAward(vendor)}
                    >
                      <Award className="size-3" />
                      Award
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
