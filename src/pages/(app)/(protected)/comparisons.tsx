import { useState, useMemo, useEffect, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from 'deepspace'
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Bot,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  DollarSign,
  Eye,
  FileCheck2,
  History,
  Info,
  Layers,
  RotateCcw,
  Save,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  Trophy,
  Upload,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmModal,
  EmptyState,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useOrgMutations, useOrgQuery } from '@/hooks/useOrgQuery'
import type { Comparison, ComparisonStatus } from '@/schemas/comparisons-schema'
import type { Decision } from '@/schemas/decisions-schema'
import type { PurchaseRequest } from '@/schemas/purchase-requests-schema'
import type { QuotationItem } from '@/schemas/quotation-items-schema'
import type { Quotation } from '@/schemas/quotations-schema'
import type { Supplier } from '@/schemas/suppliers-schema'
import {
  DEFAULT_COMPARISON_WEIGHTS,
  DEFAULT_MISSING_NEUTRAL_SCORE,
  FACTOR_LABELS,
  MISSING_VALUE_LABEL,
  PAYMENT_TERMS_LADDER,
  TIE_BREAKER_HIERARCHY,
  buildComparisonInputsFromRecords,
  compareVendorQuotations,
  formatCurrencyValue,
  isUsingStandardWeights,
  normalizeWeights,
  parseSavedComparison,
  saveComparisonToDeepSpace,
  type ComparisonWeights,
  type FactorKey,
  type RankedVendorResult,
  type ScoringMethodology,
  type SerializedComparisonCriteria,
} from '@/lib/vendor-comparison-engine'

// ─── Constants & Visual Styling Maps ─────────────────────────────────────────

const FACTOR_ORDER: FactorKey[] = ['cost', 'delivery', 'quality', 'paymentTerms', 'reliability']

const FACTOR_META: Record<
  FactorKey,
  {
    shortLabel: string
    description: string
    barColor: string
    chipColor: string
    directionLabel: string
  }
> = {
  cost: {
    shortLabel: 'Cost',
    description: 'Lower total purchase cost (items + tax + delivery) scores higher.',
    barColor: 'bg-indigo-500',
    chipColor: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    directionLabel: 'Lower is better',
  },
  delivery: {
    shortLabel: 'Delivery',
    description: 'Faster delivery lead time (fewer days) scores higher.',
    barColor: 'bg-sky-500',
    chipColor: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/20',
    directionLabel: 'Faster is better',
  },
  quality: {
    shortLabel: 'Quality',
    description: 'Higher product/supplier quality rating (0–5) scores higher.',
    barColor: 'bg-emerald-500',
    chipColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    directionLabel: 'Higher is better',
  },
  paymentTerms: {
    shortLabel: 'Terms',
    description: 'Longer buyer credit period on the standard credit ladder scores higher.',
    barColor: 'bg-amber-500',
    chipColor: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
    directionLabel: 'Longer credit is better',
  },
  reliability: {
    shortLabel: 'Reliability',
    description: 'Higher supplier on-time history & directory rating scores higher.',
    barColor: 'bg-violet-500',
    chipColor: 'text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/20',
    directionLabel: 'Higher is better',
  },
}

const VENDOR_BAR_COLORS = [
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-500',
]

type SliderWeights = Record<FactorKey, number>

const STANDARD_SLIDER_WEIGHTS: SliderWeights = {
  cost: 40,
  delivery: 25,
  quality: 20,
  paymentTerms: 10,
  reliability: 5,
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

function getRankBadgeStyle(rank: number) {
  if (rank === 1) {
    return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
  }
  if (rank === 2) {
    return 'bg-slate-400/15 text-slate-600 dark:text-slate-300 border-slate-400/30'
  }
  if (rank === 3) {
    return 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30'
  }
  return 'bg-muted text-muted-foreground border-border'
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function MissingChip({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300 ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      }`}
      title="Missing value — never fabricated or hallucinated. Uses explicitly disclosed default."
    >
      <AlertTriangle className="size-3 shrink-0" />
      {MISSING_VALUE_LABEL}
    </span>
  )
}

function MethodologyContent({
  methodology,
}: {
  methodology: ScoringMethodology
}) {
  return (
    <div className="space-y-5 text-sm">
      {/* Zero-AI deterministic pledge */}
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 flex items-start gap-3">
        <ShieldCheck className="size-5 text-emerald-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-foreground">
            100% Deterministic Mathematics — Zero AI in Ranking
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Every score and rank is calculated strictly by deterministic formulas in{' '}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground text-[11px]">
              vendor-comparison-engine.ts
            </code>
            . Identical quotations and weights always yield identical rankings.
          </p>
        </div>
      </div>

      {/* Weighted final score formula */}
      <div className="rounded-xl border border-border bg-muted/40 p-3.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          Weighted Final Score Formula
        </p>
        <p className="font-mono text-xs text-foreground leading-relaxed break-words">
          Final Score = (Cost × {methodology.weights.cost.toFixed(2)}) + (Delivery ×{' '}
          {methodology.weights.delivery.toFixed(2)}) + (Quality ×{' '}
          {methodology.weights.quality.toFixed(2)}) + (PaymentTerms ×{' '}
          {methodology.weights.paymentTerms.toFixed(2)}) + (Reliability ×{' '}
          {methodology.weights.reliability.toFixed(2)})
        </p>
      </div>

      {/* Factor-by-factor normalization formulas */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
          Factor Normalization (0 to 100 Scale)
        </h4>
        <div className="space-y-2">
          {methodology.factors.map((f) => (
            <div
              key={f.factor}
              className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{f.label}</span>
                  <Badge variant="outline" size="sm">
                    {f.direction === 'lower_is_better' ? 'Lower is better' : 'Higher is better'}
                  </Badge>
                </div>
                <span className="text-xs font-semibold text-primary">
                  Weight: {f.weightPercent.toFixed(1)}%
                </span>
              </div>
              <p className="font-mono text-[11px] text-foreground/90">{f.formula}</p>
              <p className="text-[11px] text-muted-foreground">
                Missing value policy: {f.missingHandling}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Missing Info Policy */}
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5">
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5 mb-1">
          <AlertTriangle className="size-3.5" />
          Missing Data Handling Policy (No Hallucination)
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {methodology.missingDataPolicy}
        </p>
      </div>

      {/* Payment terms credit ladder */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Payment Terms Credit Ladder
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PAYMENT_TERMS_LADDER.map((tier) => (
            <div
              key={tier.key}
              className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 flex items-center justify-between"
            >
              <span className="text-xs font-medium text-foreground">{tier.label}</span>
              <span className="text-xs font-mono font-semibold text-primary">{tier.score}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tie-breaker hierarchy */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Deterministic Tie-Breaker Hierarchy
        </h4>
        <ol className="space-y-1 text-xs text-muted-foreground list-none">
          {TIE_BREAKER_HIERARCHY.map((step) => (
            <li key={step} className="leading-snug">
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function ExplanationDrawer({
  vendor,
  onClose,
  onAward,
}: {
  vendor: RankedVendorResult | null
  onClose: () => void
  onAward: (vendor: RankedVendorResult) => void
}) {
  if (!vendor) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px] animate-in fade-in-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Scoring breakdown for ${vendor.supplierName}`}
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-card text-card-foreground shadow-2xl animate-in slide-in-from-right-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getRankBadgeStyle(
                  vendor.rank
                )}`}
              >
                {vendor.rank === 1 && <Trophy className="size-3" />}
                Rank {vendor.rankLabel}
              </span>
              {vendor.isRecommended && (
                <Badge variant="success" size="sm">
                  Recommended
                </Badge>
              )}
              {vendor.hasMissingData && (
                <Badge variant="warning" size="sm">
                  {vendor.missingFields.length} unrated field{vendor.missingFields.length === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            <h2 className="text-lg font-bold text-foreground mt-1.5 truncate">
              {vendor.supplierName}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Exact Deterministic Mathematical Breakdown
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close scoring drawer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Score Hero */}
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                  Final Weighted Score
                </p>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-3xl font-bold text-primary">
                    {vendor.finalScore.toFixed(2)}
                  </span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                {vendor.rank === 1 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    Leading vendor
                  </span>
                ) : (
                  <span>−{vendor.scoreGapFromLeader.toFixed(2)} pts behind #1</span>
                )}
                {vendor.rawMetrics.totalPurchaseCost !== null && (
                  <p className="font-semibold text-foreground mt-0.5">
                    {formatCurrencyValue(vendor.rawMetrics.totalPurchaseCost, vendor.currency)}
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
              {vendor.explanation.summary}
            </p>
            <div className="mt-3 rounded-lg bg-background/80 border border-border px-3 py-2 font-mono text-[11px] text-foreground break-words">
              {vendor.explanation.formulaEquation}
            </div>
          </div>

          {/* Tie-breaker notice */}
          {vendor.tieBreakerApplied && (
            <div className="rounded-lg border border-info/30 bg-info/10 p-3 flex items-start gap-2.5 text-xs">
              <Scale className="size-4 text-info shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">Deterministic Tie-Breaker Applied</p>
                <p className="text-muted-foreground mt-0.5">{vendor.tieBreakerApplied}</p>
              </div>
            </div>
          )}

          {/* Missing data disclosure */}
          {vendor.explanation.missingDataNotes.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                Missing Data Disclosure (Never Fabricated)
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {vendor.explanation.missingDataNotes.map((note, idx) => (
                  <li key={idx}>• {note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Factor-by-factor breakdown */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
              5-Dimension Point Derivation
            </h3>
            <div className="space-y-2.5">
              {vendor.explanation.factorBreakdowns.map((f) => {
                const Icon = getFactorIcon(f.factor)
                const meta = FACTOR_META[f.factor]
                return (
                  <div
                    key={f.factor}
                    className="rounded-xl border border-border bg-background/50 p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`rounded-md border p-1.5 ${meta.chipColor}`}>
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground">{f.label}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {f.sourceDescription}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-foreground">
                          +{f.weightedPoints.toFixed(2)} pts
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Weight {f.weightPercent.toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Raw value:</span>
                      {f.isMissing ? (
                        <MissingChip compact />
                      ) : (
                        <span className="font-medium text-foreground">{f.displayValue}</span>
                      )}
                    </div>

                    {/* Normalized progress bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Normalized Score</span>
                        <span className="font-mono font-semibold text-foreground">
                          {f.normalizedScore.toFixed(2)} / 100
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            f.isMissing ? 'bg-amber-400/70' : meta.barColor
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, f.normalizedScore))}%` }}
                        />
                      </div>
                    </div>

                    <div className="rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground space-y-0.5">
                      <div>Norm: {f.formula}</div>
                      <div className="text-foreground">Weighted: {f.calculationStep}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Cost Breakdown Details */}
          <div className="rounded-xl border border-border bg-background/50 p-3.5 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Purchase Cost Breakdown
            </h3>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">Items Subtotal</p>
                <p className="font-semibold text-foreground mt-0.5">
                  {formatCurrencyValue(vendor.costBreakdown.itemsSubtotal, vendor.currency)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">Tax / GST</p>
                <p className="font-semibold text-foreground mt-0.5">
                  {formatCurrencyValue(vendor.costBreakdown.taxAmount, vendor.currency)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">Delivery Fee</p>
                <p className="font-semibold text-foreground mt-0.5">
                  {formatCurrencyValue(vendor.costBreakdown.deliveryCharges, vendor.currency)}
                </p>
              </div>
            </div>
            {vendor.costBreakdown.itemBreakdown.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-border">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Quoted Line Items ({vendor.costBreakdown.itemBreakdown.length})
                </p>
                {vendor.costBreakdown.itemBreakdown.map((item, i) => (
                  <div
                    key={`${item.description}-${i}`}
                    className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{item.description}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.quantity} {item.unit} ×{' '}
                        {formatCurrencyValue(item.unitPrice, vendor.currency)}
                        {item.gstPercentage > 0 ? ` (+${item.gstPercentage}% tax)` : ''}
                      </p>
                    </div>
                    <span className="font-mono font-medium text-foreground shrink-0">
                      {formatCurrencyValue(item.lineTotal, vendor.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Strengths & Weaknesses */}
          {(vendor.explanation.strengths.length > 0 || vendor.explanation.weaknesses.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5">
                  Strengths (≥85 norm)
                </p>
                {vendor.explanation.strengths.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No standout factor ≥85.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-foreground/90">
                    {vendor.explanation.strengths.map((s, idx) => (
                      <li key={idx}>• {s}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-400 mb-1.5">
                  Gaps (&lt;60 norm)
                </p>
                {vendor.explanation.weaknesses.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No factor scored below 60.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-foreground/90">
                    {vendor.explanation.weaknesses.map((w, idx) => (
                      <li key={idx}>• {w}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3.5 bg-muted/20">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onAward(vendor)} className="gap-2">
            <Award className="size-4" />
            Award &amp; Create Decision
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function ComparisonsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useUser()
  const { success, error: toastError, info } = useToast()

  // Organization-isolated DeepSpace queries
  const { records: prRecords, status: prStatus, orgId } =
    useOrgQuery<PurchaseRequest>('purchase_requests')
  const { records: quotationRecords, status: qStatus } =
    useOrgQuery<Quotation>('quotations')
  const { records: quotationItemRecords } =
    useOrgQuery<QuotationItem>('quotation_items')
  const { records: supplierRecords } = useOrgQuery<Supplier>('suppliers')
  const { records: savedComparisonRecords, status: compStatus } =
    useOrgQuery<Comparison>('comparisons')
  const { records: decisionRecords } = useOrgQuery<Decision>('decisions')

  // Organization-scoped mutations
  const comparisonMutations = useOrgMutations<Comparison>('comparisons')
  const decisionMutations = useOrgMutations<Decision>('decisions')
  const quotationMutations = useOrgMutations<Quotation>('quotations')
  const prMutations = useOrgMutations<PurchaseRequest>('purchase_requests')
  const supplierMutations = useOrgMutations<Supplier>('suppliers')
  const itemMutations = useOrgMutations<QuotationItem>('quotation_items')

  // Active UI state
  const [activeTab, setActiveTab] = useState<'workspace' | 'history'>('workspace')
  const [selectedPrId, setSelectedPrId] = useState<string>(() => searchParams.get('pr') || '')
  const [selectedQuotationIds, setSelectedQuotationIds] = useState<string[]>([])
  const [sliderWeights, setSliderWeights] = useState<SliderWeights>(STANDARD_SLIDER_WEIGHTS)
  const [costNormMode, setCostNormMode] = useState<'ratio' | 'range'>('ratio')
  const [showMethodologyAccordion, setShowMethodologyAccordion] = useState(false)
  const [showMethodologyModal, setShowMethodologyModal] = useState(false)
  const [activeDrawerVendorId, setActiveDrawerVendorId] = useState<string | null>(null)
  const [lastSavedComparisonId, setLastSavedComparisonId] = useState<string | null>(null)
  const [isGeneratingDemo, setIsGeneratingDemo] = useState(false)

  // Save Comparison Modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saveNotes, setSaveNotes] = useState('')
  const [saveStatus, setSaveStatus] = useState<ComparisonStatus>('completed')
  const [isSaving, setIsSaving] = useState(false)

  // Award & Create Decision Modal state
  const [awardTargetVendor, setAwardTargetVendor] = useState<RankedVendorResult | null>(null)
  const [awardJustification, setAwardJustification] = useState('')
  const [isAwarding, setIsAwarding] = useState(false)

  // History viewer & delete state
  const [viewingSavedRecordId, setViewingSavedRecordId] = useState<string | null>(null)
  const [deletingSavedRecordId, setDeletingSavedRecordId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const isLoading = prStatus === 'loading' && prRecords.length === 0

  // Index quotations per PR
  const quotationsByPrId = useMemo(() => {
    const map = new Map<string, typeof quotationRecords>()
    for (const qr of quotationRecords) {
      const prId = qr.data.purchaseRequestId
      if (!prId) continue
      const list = map.get(prId) ?? []
      list.push(qr)
      map.set(prId, list)
    }
    return map
  }, [quotationRecords])

  // All PRs in organization, sorted so PRs with quotations appear first
  const sortedPrRecords = useMemo(() => {
    return [...prRecords].sort((a, b) => {
      const countA = quotationsByPrId.get(a.recordId)?.length ?? 0
      const countB = quotationsByPrId.get(b.recordId)?.length ?? 0
      if (countB !== countA) return countB - countA
      return a.data.title.localeCompare(b.data.title)
    })
  }, [prRecords, quotationsByPrId])

  // Quick lookups
  const prById = useMemo(() => {
    const m = new Map<string, (typeof prRecords)[number]>()
    for (const pr of prRecords) m.set(pr.recordId, pr)
    return m
  }, [prRecords])

  const itemCountByQuotationId = useMemo(() => {
    const m = new Map<string, number>()
    for (const item of quotationItemRecords) {
      const qId = item.data.quotationId
      if (!qId) continue
      m.set(qId, (m.get(qId) ?? 0) + 1)
    }
    return m
  }, [quotationItemRecords])

  const supplierById = useMemo(() => {
    const m = new Map<string, (typeof supplierRecords)[number]>()
    for (const s of supplierRecords) m.set(s.recordId, s)
    return m
  }, [supplierRecords])

  // Auto-select first PR if current selection is empty/invalid
  useEffect(() => {
    if (sortedPrRecords.length === 0) return
    if (selectedPrId && sortedPrRecords.some((p) => p.recordId === selectedPrId)) {
      return
    }
    // Prefer PR with at least 2 quotations, else first PR
    const preferred =
      sortedPrRecords.find((p) => (quotationsByPrId.get(p.recordId)?.length ?? 0) >= 2) ??
      sortedPrRecords[0]
    if (preferred) {
      setSelectedPrId(preferred.recordId)
    }
  }, [sortedPrRecords, selectedPrId, quotationsByPrId])

  const selectedPrRecord = useMemo(
    () => (selectedPrId ? prById.get(selectedPrId) ?? null : null),
    [selectedPrId, prById]
  )

  const prQuotations = useMemo(
    () => (selectedPrId ? quotationsByPrId.get(selectedPrId) ?? [] : []),
    [selectedPrId, quotationsByPrId]
  )

  // Whenever the selected PR changes or its quotations update, auto-select all quotations for that PR
  useEffect(() => {
    if (!selectedPrId) {
      setSelectedQuotationIds([])
      return
    }
    const validIds = prQuotations.map((q) => q.recordId)
    setSelectedQuotationIds((prev) => {
      const kept = prev.filter((id) => validIds.includes(id))
      if (kept.length > 0) return kept
      return validIds
    })
    setLastSavedComparisonId(null)
  }, [selectedPrId, prQuotations])

  // Normalized engine weights (0–1 summing to 1.0)
  const normalizedWeights: ComparisonWeights = useMemo(
    () => normalizeWeights(sliderWeights),
    [sliderWeights]
  )
  const usingStandardWeights = useMemo(
    () => isUsingStandardWeights(normalizedWeights),
    [normalizedWeights]
  )

  // Run deterministic comparison engine (ZERO AI)
  const comparisonResult = useMemo(() => {
    if (!selectedPrRecord || selectedQuotationIds.length === 0) return null
    const { purchaseRequest, quotations } = buildComparisonInputsFromRecords({
      purchaseRequestRecord: selectedPrRecord,
      quotationRecords: prQuotations,
      quotationItemRecords,
      supplierRecords,
      selectedQuotationIds,
    })
    if (quotations.length === 0) return null
    return compareVendorQuotations(purchaseRequest, quotations, {
      weights: normalizedWeights,
      strictPrMatch: false,
      costNormalizationMode: costNormMode,
      missingNeutralScore: DEFAULT_MISSING_NEUTRAL_SCORE,
    })
  }, [
    selectedPrRecord,
    prQuotations,
    quotationItemRecords,
    supplierRecords,
    selectedQuotationIds,
    normalizedWeights,
    costNormMode,
  ])

  const activeDrawerVendor = useMemo(() => {
    if (!activeDrawerVendorId || !comparisonResult) return null
    return (
      comparisonResult.rankings.find((r) => r.quotationId === activeDrawerVendorId) ?? null
    )
  }, [activeDrawerVendorId, comparisonResult])

  // Decisions already created for the selected PR
  const existingPrDecisions = useMemo(() => {
    if (!selectedPrId) return []
    return decisionRecords.filter((d) => d.data.purchaseRequestId === selectedPrId)
  }, [decisionRecords, selectedPrId])

  // Handlers
  const handleSelectPr = useCallback(
    (prId: string) => {
      setSelectedPrId(prId)
      const nextQuotations = quotationsByPrId.get(prId) ?? []
      setSelectedQuotationIds(nextQuotations.map((q) => q.recordId))
      setLastSavedComparisonId(null)
      setActiveDrawerVendorId(null)
      const nextParams = new URLSearchParams(searchParams)
      if (prId) nextParams.set('pr', prId)
      else nextParams.delete('pr')
      setSearchParams(nextParams, { replace: true })
    },
    [quotationsByPrId, searchParams, setSearchParams]
  )

  const handleToggleQuotation = useCallback((quotationId: string, checked: boolean) => {
    setSelectedQuotationIds((prev) => {
      if (checked) {
        return prev.includes(quotationId) ? prev : [...prev, quotationId]
      }
      return prev.filter((id) => id !== quotationId)
    })
    setLastSavedComparisonId(null)
  }, [])

  const handleSliderChange = useCallback((factor: FactorKey, rawValue: number) => {
    const safeVal = Math.max(0, Math.min(100, Math.round(rawValue)))
    setSliderWeights((prev) => ({ ...prev, [factor]: safeVal }))
    setLastSavedComparisonId(null)
  }, [])

  const handleResetWeights = useCallback(() => {
    setSliderWeights({ ...STANDARD_SLIDER_WEIGHTS })
    setCostNormMode('ratio')
    setLastSavedComparisonId(null)
    info(
      'Standard weights restored',
      'Reset to Cost 40%, Delivery 25%, Quality 20%, Terms 10%, Reliability 5%.'
    )
  }, [info])

  const handleOpenSaveModal = useCallback(() => {
    if (!comparisonResult) return
    const dateLabel = comparisonResult.comparedAt.split('T')[0]
    setSaveTitle(`${comparisonResult.purchaseRequestTitle} — Comparison (${dateLabel})`)
    setSaveNotes('')
    setSaveStatus(comparisonResult.rankings.length >= 2 ? 'completed' : 'in_progress')
    setSaveModalOpen(true)
  }, [comparisonResult])

  const handleSaveComparison = useCallback(async () => {
    if (!comparisonResult || !orgId) {
      toastError('Cannot save comparison', 'Active organization and valid comparison are required.')
      return
    }
    try {
      setIsSaving(true)
      const saved = await saveComparisonToDeepSpace({
        organizationId: orgId,
        result: comparisonResult,
        createComparison: (payload) => comparisonMutations.createWithOrg(payload),
        title: saveTitle.trim() || undefined,
        notes: saveNotes.trim() || undefined,
        status: saveStatus,
      })
      setLastSavedComparisonId(saved.comparisonId)
      setSaveModalOpen(false)
      success(
        'Comparison saved',
        `"${saved.record.title}" has been saved to your organization's comparison history.`
      )
    } catch (err) {
      toastError(
        'Failed to save comparison',
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    comparisonResult,
    orgId,
    comparisonMutations,
    saveTitle,
    saveNotes,
    saveStatus,
    success,
    toastError,
  ])

  const handleOpenAwardModal = useCallback((vendor: RankedVendorResult) => {
    setAwardTargetVendor(vendor)
    setAwardJustification(
      `Awarded via deterministic multi-criteria comparison (#${vendor.rank} with ${vendor.finalScore.toFixed(
        2
      )}/100). ${vendor.explanation.summary}`
    )
  }, [])

  const handleConfirmAward = useCallback(async () => {
    if (!awardTargetVendor || !comparisonResult || !orgId) return
    try {
      setIsAwarding(true)

      // 1. Ensure comparison is saved first so decision has a valid comparisonId
      let compId = lastSavedComparisonId
      if (!compId) {
        const saved = await saveComparisonToDeepSpace({
          organizationId: orgId,
          result: comparisonResult,
          createComparison: (payload) => comparisonMutations.createWithOrg(payload),
          status: 'completed',
          notes: `Auto-saved upon awarding ${awardTargetVendor.supplierName}.`,
        })
        compId = saved.comparisonId
        setLastSavedComparisonId(compId)
      }

      // 2. Create Decision record in DeepSpace `decisions` collection
      await decisionMutations.createWithOrg({
        comparisonId: compId,
        purchaseRequestId: comparisonResult.purchaseRequestId,
        selectedQuotationId: awardTargetVendor.quotationId,
        selectedSupplierId: awardTargetVendor.supplierId,
        selectedSupplierName: awardTargetVendor.supplierName,
        totalAmount: awardTargetVendor.rawMetrics.totalPurchaseCost ?? 0,
        justification: awardJustification.trim(),
        approvedBy: user?.name || user?.email || 'Procurement Reviewer',
        status: 'approved',
      })

      // 3. Update winning quotation status to 'accepted' and competing to 'rejected'
      for (const qr of prQuotations) {
        if (qr.recordId === awardTargetVendor.quotationId) {
          await quotationMutations.updateWithOrgCheck(qr.recordId, qr, {
            status: 'accepted',
          })
        } else if (qr.data.status === 'submitted' || qr.data.status === 'under_review') {
          await quotationMutations.updateWithOrgCheck(qr.recordId, qr, {
            status: 'rejected',
          })
        }
      }

      // 4. Update the Purchase Request status to 'approved'
      if (selectedPrRecord && selectedPrRecord.data.status !== 'approved') {
        await prMutations.updateWithOrgCheck(selectedPrRecord.recordId, selectedPrRecord, {
          status: 'approved',
        })
      }

      setAwardTargetVendor(null)
      setActiveDrawerVendorId(null)
      success(
        'Award decision recorded',
        `${awardTargetVendor.supplierName} awarded for "${comparisonResult.purchaseRequestTitle}".`
      )
    } catch (err) {
      toastError(
        'Failed to record decision',
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      )
    } finally {
      setIsAwarding(false)
    }
  }, [
    awardTargetVendor,
    comparisonResult,
    orgId,
    lastSavedComparisonId,
    comparisonMutations,
    decisionMutations,
    awardJustification,
    user,
    prQuotations,
    quotationMutations,
    selectedPrRecord,
    prMutations,
    success,
    toastError,
  ])

  const handleLoadSavedComparison = useCallback(
    (record: (typeof savedComparisonRecords)[number]) => {
      const parsed = parseSavedComparison(record.data)
      setSelectedPrId(record.data.purchaseRequestId)
      if (parsed.quotationIds.length > 0) {
        setSelectedQuotationIds(parsed.quotationIds)
      }
      if (parsed.criteria?.weights) {
        setSliderWeights({
          cost: Math.round(parsed.criteria.weights.cost * 100),
          delivery: Math.round(parsed.criteria.weights.delivery * 100),
          quality: Math.round(parsed.criteria.weights.quality * 100),
          paymentTerms: Math.round(parsed.criteria.weights.paymentTerms * 100),
          reliability: Math.round(parsed.criteria.weights.reliability * 100),
        })
      }
      setLastSavedComparisonId(record.recordId)
      setViewingSavedRecordId(null)
      setActiveTab('workspace')
      info('Comparison loaded', `Restored "${record.data.title}" in the interactive workspace.`)
    },
    [info]
  )

  const handleDeleteSavedComparison = useCallback(async () => {
    if (!deletingSavedRecordId) return
    const target = savedComparisonRecords.find((r) => r.recordId === deletingSavedRecordId)
    if (!target) return
    try {
      setIsDeleting(true)
      await comparisonMutations.removeWithOrgCheck(target.recordId, target)
      if (lastSavedComparisonId === target.recordId) setLastSavedComparisonId(null)
      if (viewingSavedRecordId === target.recordId) setViewingSavedRecordId(null)
      setDeletingSavedRecordId(null)
      success('Comparison deleted', `"${target.data.title}" was removed from history.`)
    } catch (err) {
      toastError(
        'Delete failed',
        err instanceof Error ? err.message : 'Unable to delete saved comparison.'
      )
    } finally {
      setIsDeleting(false)
    }
  }, [
    deletingSavedRecordId,
    savedComparisonRecords,
    comparisonMutations,
    lastSavedComparisonId,
    viewingSavedRecordId,
    success,
    toastError,
  ])

  // Demo benchmark generator: seeds sample suppliers, PR, and quotations
  const handleLoadDemoBenchmark = useCallback(async () => {
    if (!orgId) {
      toastError('Organization required', 'Please select or create an organization first.')
      return
    }
    try {
      setIsGeneratingDemo(true)

      // 1. Ensure 3 benchmark suppliers exist
      let sup1Id = supplierRecords.find((s) => s.data.name.includes('Apex Precision'))?.recordId
      let sup2Id = supplierRecords.find((s) => s.data.name.includes('RapidMotion'))?.recordId
      let sup3Id = supplierRecords.find((s) => s.data.name.includes('ValueLine'))?.recordId

      if (!sup1Id) {
        sup1Id = await supplierMutations.createWithOrg({
          name: 'Apex Precision Dynamics',
          email: 'sales@apexprecision.com',
          phone: '+1 (555) 234-5678',
          category: 'Machining & Bearings',
          rating: 4.8,
          status: 'active',
          notes: 'ISO 9001 certified manufacturer with top on-time delivery track record.',
        })
      }

      if (!sup2Id) {
        sup2Id = await supplierMutations.createWithOrg({
          name: 'RapidMotion Industrial',
          email: 'quotes@rapidmotion.io',
          phone: '+1 (555) 345-6789',
          category: 'Automation & Hardware',
          rating: 4.5,
          status: 'active',
          notes: 'Express courier capability with domestic stocking hubs.',
        })
      }

      if (!sup3Id) {
        sup3Id = await supplierMutations.createWithOrg({
          name: 'ValueLine Global Parts',
          email: 'b2b@valuelineparts.com',
          phone: '+1 (555) 456-7890',
          category: 'Wholesale Components',
          rating: 3.8,
          status: 'active',
          notes: 'High-volume discount importer with flexible payment terms.',
        })
      }

      // 2. Create benchmark Purchase Request
      const newPrId = await prMutations.createWithOrg({
        title: 'High-Precision CNC Ball Bearings (Batch 500)',
        description: 'ABEC-7 grade stainless steel ball bearings for robotics manufacturing line.',
        category: 'Mechanical Components',
        priority: 'high',
        status: 'pending',
        quantity: 500,
        unit: 'pcs',
        estimatedBudget: 14000,
        requiredByDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        requestedBy: user?.name || user?.email || 'Engineering Lead',
        notes: 'Strict ABEC-7 tolerance required. Full material test reports requested.',
      })

      // 3. Create 3 competitive quotations
      const q1Id = await quotationMutations.createWithOrg({
        purchaseRequestId: newPrId,
        supplierId: sup1Id,
        supplierName: 'Apex Precision Dynamics',
        totalAmount: 12450,
        currency: 'USD',
        deliveryDays: 12,
        paymentTerms: 'Net 60',
        status: 'submitted',
        notes: 'Direct factory pricing: 500 pcs @ $22/pc + 10% GST + $350 freight.',
      })

      await itemMutations.createWithOrg({
        quotationId: q1Id,
        description: 'ABEC-7 Stainless Steel Ball Bearings',
        quantity: 500,
        unit: 'pcs',
        unitPrice: 22,
        totalPrice: 11000,
        specifications: 'ABEC-7, 440C stainless steel, high-temp lubricant',
      })

      const q2Id = await quotationMutations.createWithOrg({
        purchaseRequestId: newPrId,
        supplierId: sup2Id,
        supplierName: 'RapidMotion Industrial',
        totalAmount: 13800,
        currency: 'USD',
        deliveryDays: 5,
        paymentTerms: 'Net 30',
        status: 'submitted',
        notes: 'Priority express stock: 500 pcs @ $24/pc + 12% GST + $600 expedited courier.',
      })

      await itemMutations.createWithOrg({
        quotationId: q2Id,
        description: 'ABEC-7 Stainless Steel Ball Bearings',
        quantity: 500,
        unit: 'pcs',
        unitPrice: 24,
        totalPrice: 12000,
        specifications: 'ABEC-7, pre-greased, sealed',
      })

      const q3Id = await quotationMutations.createWithOrg({
        purchaseRequestId: newPrId,
        supplierId: sup3Id,
        supplierName: 'ValueLine Global Parts',
        totalAmount: 11900,
        currency: 'USD',
        deliveryDays: 21,
        paymentTerms: 'Net 90',
        status: 'submitted',
        notes: 'Bulk discount tier: 500 pcs @ $21/pc + 8% GST + $500 standard freight.',
      })

      await itemMutations.createWithOrg({
        quotationId: q3Id,
        description: 'ABEC-7 Stainless Steel Ball Bearings',
        quantity: 500,
        unit: 'pcs',
        unitPrice: 21,
        totalPrice: 10500,
        specifications: 'ABEC-7 equivalent commercial grade',
      })

      // Select new PR and its quotes
      setSelectedPrId(newPrId)
      setSelectedQuotationIds([q1Id, q2Id, q3Id])
      setLastSavedComparisonId(null)
      setActiveTab('workspace')

      success(
        'Benchmark demo loaded',
        'Created Purchase Request with 3 competing vendor quotations ready for side-by-side ranking!'
      )
    } catch (err) {
      toastError(
        'Demo generation failed',
        err instanceof Error ? err.message : 'Unable to create demo benchmark data.'
      )
    } finally {
      setIsGeneratingDemo(false)
    }
  }, [
    orgId,
    supplierRecords,
    supplierMutations,
    prMutations,
    quotationMutations,
    itemMutations,
    user,
    success,
    toastError,
  ])

  // Generate demo quotations for an existing PR
  const handleGenerateQuotesForSelectedPr = useCallback(async () => {
    if (!selectedPrRecord || !orgId) return
    try {
      setIsGeneratingDemo(true)

      let sup1Id = supplierRecords[0]?.recordId
      let sup1Name = supplierRecords[0]?.data.name || 'Apex Precision Dynamics'
      let sup2Id = supplierRecords[1]?.recordId
      let sup2Name = supplierRecords[1]?.data.name || 'RapidMotion Industrial'
      let sup3Id = supplierRecords[2]?.recordId
      let sup3Name = supplierRecords[2]?.data.name || 'ValueLine Global Parts'

      if (!sup1Id) {
        sup1Id = await supplierMutations.createWithOrg({
          name: 'Apex Precision Dynamics',
          email: 'sales@apexprecision.com',
          rating: 4.8,
          status: 'active',
        })
      }
      if (!sup2Id) {
        sup2Id = await supplierMutations.createWithOrg({
          name: 'RapidMotion Industrial',
          email: 'quotes@rapidmotion.io',
          rating: 4.5,
          status: 'active',
        })
      }
      if (!sup3Id) {
        sup3Id = await supplierMutations.createWithOrg({
          name: 'ValueLine Global Parts',
          email: 'b2b@valuelineparts.com',
          rating: 3.8,
          status: 'active',
        })
      }

      const qty = selectedPrRecord.data.quantity || 100
      const budget = selectedPrRecord.data.estimatedBudget || 5000
      const estUnit = Math.max(10, Math.round(budget / qty))

      const q1Id = await quotationMutations.createWithOrg({
        purchaseRequestId: selectedPrRecord.recordId,
        supplierId: sup1Id,
        supplierName: sup1Name,
        totalAmount: Math.round(qty * estUnit * 0.95),
        currency: 'USD',
        deliveryDays: 14,
        paymentTerms: 'Net 60',
        status: 'submitted',
        notes: `Standard proposal for ${selectedPrRecord.data.title}.`,
      })

      const q2Id = await quotationMutations.createWithOrg({
        purchaseRequestId: selectedPrRecord.recordId,
        supplierId: sup2Id,
        supplierName: sup2Name,
        totalAmount: Math.round(qty * estUnit * 1.05),
        currency: 'USD',
        deliveryDays: 6,
        paymentTerms: 'Net 30',
        status: 'submitted',
        notes: `Expedited delivery proposal for ${selectedPrRecord.data.title}.`,
      })

      const q3Id = await quotationMutations.createWithOrg({
        purchaseRequestId: selectedPrRecord.recordId,
        supplierId: sup3Id,
        supplierName: sup3Name,
        totalAmount: Math.round(qty * estUnit * 0.88),
        currency: 'USD',
        deliveryDays: 25,
        paymentTerms: 'Net 90',
        status: 'submitted',
        notes: `Economy batch quote for ${selectedPrRecord.data.title}.`,
      })

      setSelectedQuotationIds([q1Id, q2Id, q3Id])
      success(
        'Quotations generated',
        `Created 3 competitive quotations for "${selectedPrRecord.data.title}".`
      )
    } catch (err) {
      toastError(
        'Failed to generate quotations',
        err instanceof Error ? err.message : 'Error generating quotations.'
      )
    } finally {
      setIsGeneratingDemo(false)
    }
  }, [
    selectedPrRecord,
    orgId,
    supplierRecords,
    supplierMutations,
    quotationMutations,
    success,
    toastError,
  ])

  // Parsed saved comparisons for history tab
  const savedComparisonsParsed = useMemo(() => {
    return savedComparisonRecords
      .map((rec) => {
        const parsed = parseSavedComparison(rec.data)
        const pr = prById.get(rec.data.purchaseRequestId)
        return {
          record: rec,
          prTitle: pr?.data.title || rec.data.purchaseRequestId,
          quotationIds: parsed.quotationIds,
          criteria: parsed.criteria,
        }
      })
      .sort((a, b) => {
        const timeA = a.criteria?.comparedAt ?? ''
        const timeB = b.criteria?.comparedAt ?? ''
        return timeB.localeCompare(timeA)
      })
  }, [savedComparisonRecords, prById])

  const viewingSavedEntry = useMemo(
    () =>
      viewingSavedRecordId
        ? savedComparisonsParsed.find((e) => e.record.recordId === viewingSavedRecordId) ?? null
        : null,
    [viewingSavedRecordId, savedComparisonsParsed]
  )

  const handleAnalyzeWinnerWithAI = useCallback(async () => {
    if (!comparisonResult) return
    const targetCompId =
      lastSavedComparisonId ||
      viewingSavedRecordId ||
      savedComparisonsParsed.find((c) => c.record.data.purchaseRequestId === selectedPrId)?.record.recordId

    if (targetCompId) {
      navigate(`/analyst?comparisonId=${targetCompId}`)
      return
    }

    if (orgId) {
      try {
        const saved = await saveComparisonToDeepSpace({
          organizationId: orgId,
          result: comparisonResult,
          createComparison: (payload) => comparisonMutations.createWithOrg(payload),
          title: `${comparisonResult.purchaseRequestTitle} — Comparison Analysis`,
          status: 'completed',
        })
        setLastSavedComparisonId(saved.comparisonId)
        navigate(`/analyst?comparisonId=${saved.comparisonId}`)
      } catch {
        navigate('/analyst')
      }
    } else {
      navigate('/analyst')
    }
  }, [
    comparisonResult,
    lastSavedComparisonId,
    viewingSavedRecordId,
    savedComparisonsParsed,
    selectedPrId,
    orgId,
    comparisonMutations,
    navigate,
  ])

  const hasEnoughQuotations = selectedQuotationIds.length >= 2

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      <PageHeader
        title="Smart Vendor Comparison"
        description="Deterministic multi-criteria supplier ranking with transparent mathematics — zero AI in ranking"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowMethodologyModal(true)}
            >
              <BookOpen className="size-4" />
              Scoring Methodology
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={handleLoadDemoBenchmark}
              loading={isGeneratingDemo}
            >
              <Sparkles className="size-4 text-primary" />
              Benchmark Demo
            </Button>
            <Link to="/quotation-import">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Upload className="size-4" />
                Import Quotations
              </Button>
            </Link>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!comparisonResult || !hasEnoughQuotations}
              onClick={handleOpenSaveModal}
            >
              <Save className="size-4" />
              Save Comparison
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
              onClick={() => {
                const targetCompId =
                  viewingSavedRecordId ||
                  lastSavedComparisonId ||
                  savedComparisonsParsed.find((c) => c.record.data.purchaseRequestId === selectedPrId)?.record.recordId ||
                  savedComparisonsParsed[0]?.record.recordId
                if (targetCompId) {
                  navigate(`/analyst?comparisonId=${targetCompId}`)
                } else {
                  navigate('/analyst')
                }
              }}
            >
              <Bot className="size-4 text-primary" />
              Analyze with AI
            </Button>
          </>
        }
      />

      {/* Top Tabs: Workspace vs History */}
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as 'workspace' | 'history')}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="workspace" className="gap-1.5">
              <BarChart3 className="size-4" />
              Comparison Workspace
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="size-4" />
              Saved History
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {savedComparisonRecords.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Deterministic indicator pill */}
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/5 px-3 py-1 text-xs text-emerald-700 dark:text-emerald-300">
            <Calculator className="size-3.5" />
            <span className="font-medium">Deterministic Engine</span>
            <span className="text-muted-foreground">• Zero AI in ranking</span>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 1: INTERACTIVE COMPARISON WORKSPACE
           ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="workspace" className="space-y-6 mt-4">
          {isLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-44 rounded-xl border border-border bg-card animate-pulse"
                />
              ))}
            </div>
          ) : sortedPrRecords.length === 0 ? (
            <div className="card-layer p-10">
              <EmptyState
                icon={<BarChart3 className="size-10 text-muted-foreground/60" />}
                title="No Purchase Requests Found"
                description="To run deterministic vendor comparisons, create a Purchase Request and attach supplier quotations, or load our instant benchmark demo."
                action={{
                  label: '⚡ Load Benchmark Demo (1 PR + 3 Vendors)',
                  onClick: handleLoadDemoBenchmark,
                }}
                secondaryAction={{
                  label: 'Create Purchase Request',
                  onClick: () => navigate('/purchase-requests'),
                }}
              />
            </div>
          ) : (
            <>
              {/* ── Configuration Grid: PR Selector + Quotation Checklist + Weight Customizer ── */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                {/* Left Column (7 cols): PR Selector & Quotation Checklist */}
                <div className="xl:col-span-7 space-y-5">
                  {/* PR Selector Card */}
                  <div className="card-layer p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <FileCheck2 className="size-4 text-primary" />
                          1. Select Purchase Request
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Only quotations belonging to the same Purchase Request are compared.
                        </p>
                      </div>
                      {selectedPrRecord && (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {prQuotations.length} quotation{prQuotations.length === 1 ? '' : 's'}
                          </Badge>
                          <Link to="/purchase-requests">
                            <Button variant="ghost" size="sm" className="text-xs h-7">
                              Manage PRs
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Select value={selectedPrId} onValueChange={handleSelectPr}>
                        <SelectTrigger aria-label="Select Purchase Request">
                          <SelectValue placeholder="Choose a Purchase Request..." />
                        </SelectTrigger>
                        <SelectContent>
                          {sortedPrRecords.map((pr) => {
                            const count = quotationsByPrId.get(pr.recordId)?.length ?? 0
                            return (
                              <SelectItem key={pr.recordId} value={pr.recordId}>
                                {pr.data.title} ({count} quote{count === 1 ? '' : 's'})
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>

                      {selectedPrRecord && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-lg bg-muted/40 border border-border/70 p-3 text-xs">
                          <div>
                            <p className="text-[11px] text-muted-foreground">Requested Qty</p>
                            <p className="font-semibold text-foreground mt-0.5">
                              {selectedPrRecord.data.quantity !== undefined
                                ? `${selectedPrRecord.data.quantity} ${selectedPrRecord.data.unit || 'units'}`
                                : 'Not specified'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">Est. Budget</p>
                            <p className="font-semibold text-foreground mt-0.5">
                              {selectedPrRecord.data.estimatedBudget !== undefined
                                ? formatCurrencyValue(selectedPrRecord.data.estimatedBudget)
                                : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">Category</p>
                            <p className="font-semibold text-foreground mt-0.5 truncate">
                              {selectedPrRecord.data.category || 'General'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground">Awarded Status</p>
                            <p className="font-semibold text-foreground mt-0.5">
                              {existingPrDecisions.length > 0 ? (
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  Awarded ({existingPrDecisions.length})
                                </span>
                              ) : (
                                <span className="capitalize">{selectedPrRecord.data.status || 'Pending'}</span>
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quotation Checklist Card */}
                  <div className="card-layer p-5 space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <Layers className="size-4 text-primary" />
                          2. Select Quotations to Compare
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Select at least 2 supplier quotations ({selectedQuotationIds.length} of{' '}
                          {prQuotations.length} selected).
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {prQuotations.length > 0 && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setSelectedQuotationIds(prQuotations.map((q) => q.recordId))
                              }
                              disabled={selectedQuotationIds.length === prQuotations.length}
                            >
                              Select All
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedQuotationIds([])}
                              disabled={selectedQuotationIds.length === 0}
                            >
                              Clear
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* PR has 0 quotations */}
                    {prQuotations.length === 0 && selectedPrRecord && (
                      <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-3">
                        <Scale className="size-8 text-muted-foreground/60 mx-auto" />
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            No Quotations Attached to This Request Yet
                          </p>
                          <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
                            To compare vendor bids, you need at least 2 quotations for{' '}
                            <strong>{selectedPrRecord.data.title}</strong>.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                          <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={handleGenerateQuotesForSelectedPr}
                            loading={isGeneratingDemo}
                          >
                            <Sparkles className="size-4" />
                            Generate 3 Demo Quotes for this PR
                          </Button>
                          <Link to={`/quotation-import?pr=${selectedPrId}`}>
                            <Button size="sm" variant="outline" className="gap-1.5">
                              <Upload className="size-4" />
                              Import via CSV
                            </Button>
                          </Link>
                        </div>
                      </div>
                    )}

                    {/* PR has 1 quotation */}
                    {prQuotations.length === 1 && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-center justify-between gap-3 flex-wrap text-xs">
                        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                          <AlertTriangle className="size-4 shrink-0" />
                          <span>
                            This Request currently has only 1 quotation. Need at least 2 for side-by-side evaluation.
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="gap-1.5"
                            onClick={handleGenerateQuotesForSelectedPr}
                            loading={isGeneratingDemo}
                          >
                            <Sparkles className="size-3.5" />
                            Add Demo Quotes
                          </Button>
                          <Link to={`/quotation-import?pr=${selectedPrId}`}>
                            <Button size="sm" variant="outline" className="gap-1.5">
                              <Upload className="size-3.5" />
                              Import More
                            </Button>
                          </Link>
                        </div>
                      </div>
                    )}

                    {/* Quotation checklist cards */}
                    {prQuotations.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[340px] overflow-y-auto pr-1">
                        {prQuotations.map((qr) => {
                          const isChecked = selectedQuotationIds.includes(qr.recordId)
                          const linkedSup = supplierById.get(qr.data.supplierId)
                          const itemCount = itemCountByQuotationId.get(qr.recordId) ?? 0
                          const missingCount = [
                            qr.data.totalAmount === undefined || qr.data.totalAmount === null,
                            qr.data.deliveryDays === undefined || qr.data.deliveryDays === null,
                            !qr.data.paymentTerms?.trim(),
                            linkedSup?.data.rating === undefined || linkedSup?.data.rating === null,
                          ].filter(Boolean).length

                          return (
                            <label
                              key={qr.recordId}
                              className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-all ${
                                isChecked
                                  ? 'border-primary/60 bg-primary/5 spatial-shadow'
                                  : 'border-border bg-background/40 hover:bg-muted/40'
                              }`}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) =>
                                  handleToggleQuotation(qr.recordId, Boolean(checked))
                                }
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-sm text-foreground truncate">
                                    {qr.data.supplierName || linkedSup?.data.name || 'Unnamed Supplier'}
                                  </span>
                                  {qr.data.status === 'accepted' && (
                                    <Badge variant="success" size="sm">
                                      Accepted
                                    </Badge>
                                  )}
                                  {qr.data.status === 'rejected' && (
                                    <Badge variant="secondary" size="sm">
                                      Rejected
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  <span className="font-mono font-semibold text-foreground">
                                    {qr.data.totalAmount !== undefined && qr.data.totalAmount !== null
                                      ? formatCurrencyValue(qr.data.totalAmount, qr.data.currency)
                                      : MISSING_VALUE_LABEL}
                                  </span>
                                  <span>
                                    {qr.data.deliveryDays !== undefined && qr.data.deliveryDays !== null
                                      ? `${qr.data.deliveryDays}d delivery`
                                      : 'Delivery: Unrated'}
                                  </span>
                                  <span>{qr.data.paymentTerms || 'Terms: Unrated'}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[11px] text-muted-foreground">
                                    {itemCount} line item{itemCount === 1 ? '' : 's'}
                                  </span>
                                  {linkedSup?.data.rating !== undefined &&
                                  linkedSup?.data.rating !== null ? (
                                    <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                                      <Star className="size-3 fill-current" />
                                      {linkedSup.data.rating.toFixed(1)}
                                    </span>
                                  ) : (
                                    <MissingChip compact />
                                  )}
                                  {missingCount > 0 && (
                                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                      ({missingCount} missing)
                                    </span>
                                  )}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column (5 cols): Interactive Weight Customizer */}
                <div className="xl:col-span-5">
                  <div className="card-layer p-5 h-full flex flex-col justify-between space-y-4">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Sliders className="size-4 text-primary" />
                            3. Scoring Weights Customizer
                          </h2>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Adjust relative importance; engine auto-normalizes to 100%.
                          </p>
                        </div>
                        <Button
                          variant={usingStandardWeights ? 'ghost' : 'secondary'}
                          size="sm"
                          onClick={handleResetWeights}
                          disabled={usingStandardWeights && costNormMode === 'ratio'}
                          className="gap-1.5 shrink-0"
                        >
                          <RotateCcw className="size-3.5" />
                          Reset
                        </Button>
                      </div>

                      {/* Stacked Weight Distribution Bar */}
                      <div className="space-y-1.5">
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          {FACTOR_ORDER.map((factor) => (
                            <div
                              key={factor}
                              className={`${FACTOR_META[factor].barColor} transition-all duration-200`}
                              style={{ width: `${normalizedWeights[factor] * 100}%` }}
                              title={`${FACTOR_LABELS[factor]}: ${(
                                normalizedWeights[factor] * 100
                              ).toFixed(1)}%`}
                            />
                          ))}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            {usingStandardWeights
                              ? 'Standard Weights (40 / 25 / 20 / 10 / 5)'
                              : 'Custom Weight Profile Active'}
                          </span>
                          <span className="font-mono font-semibold text-foreground">
                            Effective Total: 100.0%
                          </span>
                        </div>
                      </div>

                      {/* 5 Interactive Sliders */}
                      <div className="space-y-3.5 pt-1">
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
                                  <span className="font-medium text-foreground">
                                    {FACTOR_LABELS[factor]}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    (Std {standardPct}%)
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-muted-foreground">
                                    {meta.directionLabel}
                                  </span>
                                  <span className="font-mono font-semibold text-primary min-w-[46px] text-right">
                                    {effectivePct}%
                                  </span>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={sliderWeights[factor]}
                                onChange={(e) =>
                                  handleSliderChange(factor, Number(e.target.value))
                                }
                                aria-label={`${FACTOR_LABELS[factor]} weight`}
                                className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-muted accent-primary"
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Normalization mode footer */}
                    <div className="pt-3 border-t border-border flex items-center justify-between gap-2 flex-wrap text-xs">
                      <span className="text-muted-foreground">Cost normalization:</span>
                      <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
                        <button
                          type="button"
                          onClick={() => setCostNormMode('ratio')}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                            costNormMode === 'ratio'
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Ratio (min/cost)
                        </button>
                        <button
                          type="button"
                          onClick={() => setCostNormMode('range')}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
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
                </div>
              </div>

              {/* ── Specification & Quantity Comparability Alert ── */}
              {comparisonResult && (
                <div
                  className={`rounded-xl border p-4 space-y-2.5 ${
                    !comparisonResult.comparability.isComparable
                      ? 'border-destructive/40 bg-destructive/5'
                      : comparisonResult.comparability.warnings.length > 0
                        ? 'border-amber-500/35 bg-amber-500/5'
                        : 'border-emerald-500/30 bg-emerald-500/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-2.5">
                      {!comparisonResult.comparability.isComparable ? (
                        <ShieldAlert className="size-5 text-destructive shrink-0 mt-0.5" />
                      ) : comparisonResult.comparability.warnings.length > 0 ? (
                        <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {!comparisonResult.comparability.isComparable
                            ? 'Specification & Quantity Comparability Alert'
                            : comparisonResult.comparability.warnings.length > 0
                              ? 'Comparable with Advisory Disclosures'
                              : 'Specifications & Quantities Verified Comparable'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {comparisonResult.comparability.summary}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {comparisonResult.comparability.mismatches.length > 0 && (
                        <Badge variant="destructive">
                          {comparisonResult.comparability.mismatches.length} Mismatch
                          {comparisonResult.comparability.mismatches.length === 1 ? '' : 'es'}
                        </Badge>
                      )}
                      {comparisonResult.comparability.warnings.length > 0 && (
                        <Badge variant="warning">
                          {comparisonResult.comparability.warnings.length} Advisory
                          {comparisonResult.comparability.warnings.length === 1 ? '' : ' Notes'}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Mismatches list */}
                  {comparisonResult.comparability.mismatches.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {comparisonResult.comparability.mismatches.map((issue, idx) => (
                        <div
                          key={`${issue.code}-${idx}`}
                          className="rounded-lg border border-destructive/25 bg-background/80 px-3 py-2 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5"
                        >
                          <div className="flex items-start gap-2">
                            <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-destructive/15 text-destructive shrink-0">
                              {issue.code.replace(/_/g, ' ')}
                            </span>
                            <span className="text-foreground">{issue.message}</span>
                          </div>
                          {(issue.expected !== undefined || issue.actual !== undefined) && (
                            <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                              Expected: {String(issue.expected ?? '—')} | Actual:{' '}
                              {String(issue.actual ?? '—')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Advisory warnings list */}
                  {comparisonResult.comparability.warnings.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {comparisonResult.comparability.warnings.slice(0, 6).map((w, idx) => (
                        <div
                          key={`${w.code}-${idx}`}
                          className="flex items-start gap-2 text-xs text-muted-foreground"
                        >
                          <Info className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <span>{w.message}</span>
                        </div>
                      ))}
                      {comparisonResult.comparability.warnings.length > 6 && (
                        <p className="text-[11px] text-muted-foreground pl-5">
                          + {comparisonResult.comparability.warnings.length - 6} more advisory
                          disclosure(s) visible in individual vendor scoring drawers.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Guard when fewer than 2 quotations are selected ── */}
              {!hasEnoughQuotations ? (
                <div className="card-layer p-8 text-center space-y-3">
                  <Scale className="size-9 text-muted-foreground/50 mx-auto" />
                  <h3 className="text-base font-semibold text-foreground">
                    Select at Least 2 Quotations to Rank Vendors
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Check 2 or more supplier quotations in the checklist above to unlock the
                    deterministic side-by-side matrix, visual dimension bars, and award workflow.
                  </p>
                  {prQuotations.length < 2 && (
                    <div className="pt-2">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={handleGenerateQuotesForSelectedPr}
                        loading={isGeneratingDemo}
                      >
                        <Sparkles className="size-4" />
                        Generate Demo Quotations for this PR
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                comparisonResult && (
                  <div className="space-y-6">
                    {/* ── TOP-RANKED SUPPLIER SHOWCASE ── */}
                    {comparisonResult.recommendedVendor && (
                      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-emerald-500/5 p-6 spatial-shadow">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
                          <div className="space-y-2.5 max-w-3xl">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                <Trophy className="size-3.5" />
                                #1 Top-Ranked Supplier
                              </span>
                              <Badge variant="outline">
                                {comparisonResult.rankings.length} Vendors Evaluated
                              </Badge>
                              {comparisonResult.recommendedVendor.hasMissingData && (
                                <Badge variant="warning">
                                  {comparisonResult.recommendedVendor.missingFields.length} Unrated
                                  Field(s) Disclosed
                                </Badge>
                              )}
                              {comparisonResult.recommendedVendor.tieBreakerApplied && (
                                <Badge variant="info">Tie-Breaker Applied</Badge>
                              )}
                            </div>

                            <div>
                              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                                {comparisonResult.recommendedVendor.supplierName}
                              </h2>
                              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                                {comparisonResult.recommendedVendor.explanation.summary}
                              </p>
                            </div>

                            {/* Quick Metric Pills */}
                            <div className="flex flex-wrap items-center gap-3 pt-1">
                              <div className="rounded-xl border border-border bg-card/90 px-3.5 py-2">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                  Total Purchase Cost
                                </p>
                                <p className="text-sm font-bold text-foreground mt-0.5">
                                  {comparisonResult.recommendedVendor.rawMetrics
                                    .totalPurchaseCost !== null
                                    ? formatCurrencyValue(
                                        comparisonResult.recommendedVendor.rawMetrics
                                          .totalPurchaseCost,
                                        comparisonResult.recommendedVendor.currency
                                      )
                                    : MISSING_VALUE_LABEL}
                                </p>
                                {comparisonResult.recommendedVendor.costSavingsVsHighest !== null &&
                                  comparisonResult.recommendedVendor.costSavingsVsHighest > 0 && (
                                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                      Saves{' '}
                                      {formatCurrencyValue(
                                        comparisonResult.recommendedVendor.costSavingsVsHighest,
                                        comparisonResult.recommendedVendor.currency
                                      )}{' '}
                                      vs highest quote
                                    </p>
                                  )}
                              </div>

                              <div className="rounded-xl border border-border bg-card/90 px-3.5 py-2">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                  Delivery Time
                                </p>
                                <p className="text-sm font-bold text-foreground mt-0.5">
                                  {comparisonResult.recommendedVendor.factors.delivery.displayValue}
                                </p>
                              </div>

                              <div className="rounded-xl border border-border bg-card/90 px-3.5 py-2">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                  Quality
                                </p>
                                <p className="text-sm font-bold text-foreground mt-0.5">
                                  {comparisonResult.recommendedVendor.factors.quality.displayValue}
                                </p>
                              </div>

                              <div className="rounded-xl border border-border bg-card/90 px-3.5 py-2">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                  Payment Terms
                                </p>
                                <p className="text-sm font-bold text-foreground mt-0.5">
                                  {
                                    comparisonResult.recommendedVendor.factors.paymentTerms
                                      .displayValue
                                  }
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Score & CTA Panel */}
                          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-4 shrink-0 border-t lg:border-t-0 lg:border-l border-border/60 pt-4 lg:pt-0 lg:pl-6">
                            <div className="lg:text-right">
                              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                Deterministic Score
                              </p>
                              <div className="flex items-baseline gap-1 lg:justify-end">
                                <span className="text-4xl font-extrabold text-primary">
                                  {comparisonResult.recommendedVendor.finalScore.toFixed(2)}
                                </span>
                                <span className="text-sm text-muted-foreground">/100</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                                onClick={handleAnalyzeWinnerWithAI}
                              >
                                <Bot className="size-4" />
                                Analyze with AI
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={() =>
                                  setActiveDrawerVendorId(
                                    comparisonResult.recommendedVendor!.quotationId
                                  )
                                }
                              >
                                <Calculator className="size-4" />
                                Inspect Math
                              </Button>
                              <Button
                                size="sm"
                                className="gap-1.5"
                                onClick={() =>
                                  handleOpenAwardModal(comparisonResult.recommendedVendor!)
                                }
                              >
                                <Award className="size-4" />
                                Award &amp; Create Decision
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── VISUAL COMPARISON BARS ACROSS 5 DIMENSIONS ── */}
                    <div className="card-layer p-5 space-y-5">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                            <TrendingUp className="size-4 text-primary" />
                            Visual Multi-Criteria Comparison (5 Dimensions)
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Normalized 0–100 dimension scores per vendor. Hatched/amber bars denote
                            explicitly disclosed unrated fields.
                          </p>
                        </div>
                        {/* Vendor legend */}
                        <div className="flex flex-wrap items-center gap-3">
                          {comparisonResult.rankings.map((vendor, idx) => (
                            <div
                              key={vendor.quotationId}
                              className="inline-flex items-center gap-1.5 text-xs"
                            >
                              <span
                                className={`size-2.5 rounded-full ${
                                  VENDOR_BAR_COLORS[idx % VENDOR_BAR_COLORS.length]
                                }`}
                              />
                              <span className="font-medium text-foreground">
                                #{vendor.rank} {vendor.supplierName}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {FACTOR_ORDER.map((factor) => {
                          const Icon = getFactorIcon(factor)
                          const weightPct = (comparisonResult.weights[factor] * 100).toFixed(1)
                          return (
                            <div
                              key={factor}
                              className="rounded-xl border border-border bg-background/50 p-4 space-y-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Icon className="size-4 text-primary" />
                                  <span className="text-sm font-semibold text-foreground">
                                    {FACTOR_LABELS[factor]}
                                  </span>
                                </div>
                                <Badge variant="secondary" size="sm">
                                  Weight {weightPct}%
                                </Badge>
                              </div>

                              <div className="space-y-2.5">
                                {comparisonResult.rankings.map((vendor, vIdx) => {
                                  const fDetail = vendor.factors[factor]
                                  return (
                                    <div key={vendor.quotationId} className="space-y-1">
                                      <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="truncate font-medium text-foreground max-w-[55%]">
                                          #{vendor.rank} {vendor.supplierName}
                                        </span>
                                        <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                                          {fDetail.isMissing ? (
                                            <span className="text-amber-600 dark:text-amber-400">
                                              Unrated ({fDetail.normalizedScore.toFixed(0)})
                                            </span>
                                          ) : (
                                            <>
                                              <strong className="text-foreground">
                                                {fDetail.normalizedScore.toFixed(1)}
                                              </strong>
                                              /100 (+{fDetail.weightedPoints.toFixed(1)} pts)
                                            </>
                                          )}
                                        </span>
                                      </div>
                                      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all duration-300 ${
                                            fDetail.isMissing
                                              ? 'bg-amber-400/70'
                                              : VENDOR_BAR_COLORS[vIdx % VENDOR_BAR_COLORS.length]
                                          }`}
                                          style={{
                                            width: `${Math.max(
                                              3,
                                              Math.min(100, fDetail.normalizedScore)
                                            )}%`,
                                          }}
                                        />
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}

                        {/* Overall Weighted Final Score Card */}
                        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Trophy className="size-4 text-amber-500" />
                              <span className="text-sm font-semibold text-foreground">
                                Final Weighted Score
                              </span>
                            </div>
                            <Badge variant="default" size="sm">
                              100% Total
                            </Badge>
                          </div>

                          <div className="space-y-2.5">
                            {comparisonResult.rankings.map((vendor, vIdx) => (
                              <div key={vendor.quotationId} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="truncate font-semibold text-foreground max-w-[60%]">
                                    #{vendor.rank} {vendor.supplierName}
                                  </span>
                                  <span className="font-mono font-bold text-primary shrink-0">
                                    {vendor.finalScore.toFixed(2)} / 100
                                  </span>
                                </div>
                                <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      VENDOR_BAR_COLORS[vIdx % VENDOR_BAR_COLORS.length]
                                    }`}
                                    style={{
                                      width: `${Math.max(3, Math.min(100, vendor.finalScore))}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── DETAILED COMPARISON MATRIX TABLE ── */}
                    <div className="card-layer overflow-hidden">
                      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <h3 className="text-base font-semibold text-foreground">
                            Detailed Vendor Comparison Matrix
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Shows raw quotation values, 0–100 normalized scores, weighted point
                            contributions, and deterministic rank. Click any row to inspect math.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleOpenSaveModal}
                          className="gap-1.5"
                        >
                          <Save className="size-3.5" />
                          Save Matrix
                        </Button>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              <th className="py-3 px-4">Rank</th>
                              <th className="py-3 px-4">Supplier</th>
                              {FACTOR_ORDER.map((factor) => (
                                <th key={factor} className="py-3 px-4 whitespace-nowrap">
                                  {FACTOR_META[factor].shortLabel}{' '}
                                  <span className="text-primary">
                                    ({(comparisonResult.weights[factor] * 100).toFixed(0)}%)
                                  </span>
                                </th>
                              ))}
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Final Score
                              </th>
                              <th className="py-3 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border text-sm">
                            {comparisonResult.rankings.map((vendor) => (
                              <tr
                                key={vendor.quotationId}
                                onClick={() => setActiveDrawerVendorId(vendor.quotationId)}
                                className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                                  vendor.rank === 1 ? 'bg-primary/[0.03]' : ''
                                }`}
                              >
                                {/* Rank */}
                                <td className="py-3.5 px-4 align-top whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${getRankBadgeStyle(
                                      vendor.rank
                                    )}`}
                                  >
                                    {vendor.rank === 1 && <Trophy className="size-3" />}
                                    {vendor.rankLabel}
                                  </span>
                                  {vendor.tieBreakerApplied && (
                                    <div className="mt-1 text-[10px] text-info font-medium">
                                      Tie-breaker
                                    </div>
                                  )}
                                </td>

                                {/* Supplier */}
                                <td className="py-3.5 px-4 align-top min-w-[180px]">
                                  <p className="font-semibold text-foreground">
                                    {vendor.supplierName}
                                  </p>
                                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                    {vendor.isRecommended && (
                                      <Badge variant="success" size="sm">
                                        Best Value
                                      </Badge>
                                    )}
                                    {vendor.hasMissingData && (
                                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                        {vendor.missingFields.length} unrated
                                      </span>
                                    )}
                                    {vendor.costDeltaVsCheapest === 0 && (
                                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                                        Lowest Cost
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* 5 Dimensions */}
                                {FACTOR_ORDER.map((factor) => {
                                  const f = vendor.factors[factor]
                                  return (
                                    <td
                                      key={factor}
                                      className="py-3.5 px-4 align-top whitespace-nowrap"
                                    >
                                      {f.isMissing ? (
                                        <div className="space-y-1">
                                          <MissingChip compact />
                                          <div className="text-[11px] font-mono text-muted-foreground">
                                            {f.normalizedScore.toFixed(0)}/100 → +
                                            {f.weightedPoints.toFixed(2)}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="space-y-0.5">
                                          <p className="text-xs font-semibold text-foreground">
                                            {f.displayValue}
                                          </p>
                                          <p className="text-[11px] font-mono text-muted-foreground">
                                            Norm{' '}
                                            <span className="text-foreground font-medium">
                                              {f.normalizedScore.toFixed(1)}
                                            </span>{' '}
                                            (+{f.weightedPoints.toFixed(2)})
                                          </p>
                                        </div>
                                      )}
                                    </td>
                                  )
                                })}

                                {/* Final Weighted Score */}
                                <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                                  <p className="text-base font-bold font-mono text-primary">
                                    {vendor.finalScore.toFixed(2)}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {vendor.rank === 1
                                      ? 'Leader'
                                      : `−${vendor.scoreGapFromLeader.toFixed(2)} pts`}
                                  </p>
                                </td>

                                {/* Actions */}
                                <td
                                  className="py-3.5 px-4 align-top text-right whitespace-nowrap"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="inline-flex items-center gap-1.5">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setActiveDrawerVendorId(vendor.quotationId)}
                                      className="gap-1 text-xs"
                                    >
                                      <Calculator className="size-3.5" />
                                      Math
                                    </Button>
                                    <Button
                                      variant={vendor.rank === 1 ? 'default' : 'outline'}
                                      size="sm"
                                      onClick={() => handleOpenAwardModal(vendor)}
                                      className="gap-1 text-xs"
                                    >
                                      <Award className="size-3.5" />
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

                    {/* ── TRANSPARENT SCORING METHODOLOGY ACCORDION ── */}
                    <div className="card-layer overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowMethodologyAccordion((v) => !v)}
                        className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-muted/30 transition-colors"
                        aria-expanded={showMethodologyAccordion}
                      >
                        <div className="flex items-center gap-2.5">
                          <BookOpen className="size-4 text-primary shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              Transparent Scoring Methodology &amp; Mathematical Formulas
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Inspect exact normalization equations, credit ladder, missing-data
                              policy, and tie-breaker hierarchy.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" size="sm">
                            Zero AI
                          </Badge>
                          {showMethodologyAccordion ? (
                            <ChevronUp className="size-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="size-4 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {showMethodologyAccordion && (
                        <div className="border-t border-border px-5 py-5">
                          <MethodologyContent methodology={comparisonResult.methodology} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 2: SAVED COMPARISONS HISTORY
           ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="history" className="space-y-4 mt-4">
          {compStatus === 'loading' ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-28 rounded-xl border border-border bg-card animate-pulse"
                />
              ))}
            </div>
          ) : savedComparisonsParsed.length === 0 ? (
            <div className="card-layer p-10">
              <EmptyState
                icon={<History className="size-10 text-muted-foreground/60" />}
                title="No Saved Comparisons Yet"
                description="Run a vendor comparison in the workspace and click 'Save Comparison' to preserve the full scoring matrix, weights, and recommendation for audit trails."
                action={{
                  label: 'Go to Comparison Workspace',
                  onClick: () => setActiveTab('workspace'),
                }}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {savedComparisonsParsed.map(({ record, prTitle, quotationIds, criteria }) => {
                const topRank = criteria?.rankings?.[0]
                return (
                  <div
                    key={record.recordId}
                    className="card-layer p-5 transition-all hover:card-layer-hover"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div className="space-y-2 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-semibold text-foreground">
                            {record.data.title}
                          </h3>
                          <Badge
                            variant={record.data.status === 'completed' ? 'success' : 'secondary'}
                            size="sm"
                          >
                            {record.data.status === 'completed' ? 'Completed' : 'In Progress'}
                          </Badge>
                          {criteria && (
                            <Badge
                              variant={criteria.isComparable ? 'outline' : 'destructive'}
                              size="sm"
                            >
                              {criteria.isComparable
                                ? 'Comparable'
                                : `${criteria.mismatchCount} Mismatch(es)`}
                            </Badge>
                          )}
                          {criteria && (
                            <Badge variant="outline" size="sm">
                              {criteria.isStandardWeights ? 'Standard Weights' : 'Custom Weights'}
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            PR: <strong className="text-foreground">{prTitle}</strong>
                          </span>
                          <span>{quotationIds.length} quotations compared</span>
                          {criteria?.comparedAt && (
                            <span>
                              Saved{' '}
                              {new Date(criteria.comparedAt).toLocaleString(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </span>
                          )}
                        </div>

                        {topRank && (
                          <div className="inline-flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-1.5 text-xs">
                            <Trophy className="size-3.5 text-amber-500 shrink-0" />
                            <span>
                              Top Ranked:{' '}
                              <strong className="text-foreground">{topRank.supplierName}</strong> —{' '}
                              <strong className="text-primary font-mono">
                                {topRank.finalScore.toFixed(2)}/100
                              </strong>
                              {topRank.totalPurchaseCost !== null &&
                                ` (${formatCurrencyValue(
                                  topRank.totalPurchaseCost,
                                  topRank.currency
                                )})`}
                            </span>
                          </div>
                        )}

                        {record.data.recommendation && !topRank && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {record.data.recommendation}
                          </p>
                        )}

                        {record.data.notes && (
                          <p className="text-xs text-muted-foreground italic">
                            Notes: {record.data.notes}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setViewingSavedRecordId(record.recordId)}
                        >
                          <Eye className="size-3.5" />
                          View Matrix
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => handleLoadSavedComparison(record)}
                        >
                          <BarChart3 className="size-3.5" />
                          Load in Workspace
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingSavedRecordId(record.recordId)}
                          className="text-destructive hover:text-destructive"
                          aria-label={`Delete ${record.data.title}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ══════════════════════════════════════════════════════════════════════
          INDIVIDUAL SCORING EXPLANATION DRAWER
         ══════════════════════════════════════════════════════════════════════ */}
      <ExplanationDrawer
        vendor={activeDrawerVendor}
        onClose={() => setActiveDrawerVendorId(null)}
        onAward={(vendor) => handleOpenAwardModal(vendor)}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          SCORING METHODOLOGY MODAL
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showMethodologyModal}
        onClose={() => setShowMethodologyModal(false)}
        size="lg"
      >
        <Modal.Header>
          <Modal.Title>Deterministic Scoring Methodology</Modal.Title>
          <Modal.Description>
            Full mathematical transparency into how ProcureLens scores and ranks vendor quotations.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <MethodologyContent
            methodology={
              comparisonResult?.methodology ?? {
                deterministic: true,
                usesAI: false,
                weights: normalizedWeights,
                weightPercentages: {
                  cost: Math.round(normalizedWeights.cost * 10000) / 100,
                  delivery: Math.round(normalizedWeights.delivery * 10000) / 100,
                  quality: Math.round(normalizedWeights.quality * 10000) / 100,
                  paymentTerms: Math.round(normalizedWeights.paymentTerms * 10000) / 100,
                  reliability: Math.round(normalizedWeights.reliability * 10000) / 100,
                },
                missingDataPolicy: `Missing attributes are never hallucinated or fabricated. Missing pricing receives 0.00 points. Missing optional factors are explicitly marked "${MISSING_VALUE_LABEL}" and assigned a disclosed neutral score of ${DEFAULT_MISSING_NEUTRAL_SCORE}/100.`,
                factors: FACTOR_ORDER.map((factor) => ({
                  factor,
                  label: FACTOR_LABELS[factor],
                  weight: normalizedWeights[factor],
                  weightPercent: Math.round(normalizedWeights[factor] * 10000) / 100,
                  direction:
                    factor === 'cost' || factor === 'delivery'
                      ? 'lower_is_better'
                      : 'higher_is_better',
                  formula:
                    factor === 'cost'
                      ? '(Lowest Total Cost / Vendor Total Cost) × 100'
                      : factor === 'delivery'
                        ? '(Fastest Delivery Days / Vendor Delivery Days) × 100'
                        : factor === 'quality'
                          ? '(Quality Rating / 5) × 100'
                          : factor === 'paymentTerms'
                            ? 'Credit Ladder: Net 90 (100), Net 60 (85), Net 45 (75), Net 30 (60), Net 15 (45), Immediate (30), Advance (15)'
                            : 'Supplier on-time history & directory rating mapped to 0–100 (Blacklisted = 0)',
                  missingHandling:
                    factor === 'cost'
                      ? 'Assigned 0.00 and flagged as missing pricing.'
                      : `Marked "${MISSING_VALUE_LABEL}" with neutral score ${DEFAULT_MISSING_NEUTRAL_SCORE}/100.`,
                })),
                paymentTermsLadder: PAYMENT_TERMS_LADDER,
                tieBreakers: TIE_BREAKER_HIERARCHY,
              }
            }
          />
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={() => setShowMethodologyModal(false)}>Done</Button>
        </Modal.Footer>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          SAVE COMPARISON MODAL
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} size="md">
        <Modal.Header>
          <Modal.Title>Save Vendor Comparison</Modal.Title>
          <Modal.Description>
            Persist the deterministic ranking matrix, weights, and recommendation to DeepSpace.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="save-comp-title">Comparison Title</Label>
            <Input
              id="save-comp-title"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="e.g. Q3 CNC Bearings — Vendor Comparison"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="save-comp-status">Status</Label>
            <Select
              value={saveStatus}
              onValueChange={(v) => setSaveStatus(v as ComparisonStatus)}
            >
              <SelectTrigger id="save-comp-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="save-comp-notes">Audit Notes (Optional)</Label>
            <Textarea
              id="save-comp-notes"
              rows={3}
              value={saveNotes}
              onChange={(e) => setSaveNotes(e.target.value)}
              placeholder="Document weight rationale, comparability exceptions, or committee review notes..."
            />
          </div>

          {comparisonResult?.recommendedVendor && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-semibold text-foreground">Snapshot Summary</p>
              <p className="text-muted-foreground">
                Top Ranked:{' '}
                <strong className="text-foreground">
                  {comparisonResult.recommendedVendor.supplierName}
                </strong>{' '}
                ({comparisonResult.recommendedVendor.finalScore.toFixed(2)}/100) across{' '}
                {comparisonResult.rankings.length} quotations.
              </p>
              <p className="text-muted-foreground">
                Weights: Cost {(comparisonResult.weights.cost * 100).toFixed(0)}% / Delivery{' '}
                {(comparisonResult.weights.delivery * 100).toFixed(0)}% / Quality{' '}
                {(comparisonResult.weights.quality * 100).toFixed(0)}% / Terms{' '}
                {(comparisonResult.weights.paymentTerms * 100).toFixed(0)}% / Reliability{' '}
                {(comparisonResult.weights.reliability * 100).toFixed(0)}%
              </p>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setSaveModalOpen(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSaveComparison} loading={isSaving} className="gap-1.5">
            <Save className="size-4" />
            Save Comparison
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          AWARD & CREATE DECISION MODAL
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={Boolean(awardTargetVendor)}
        onClose={() => setAwardTargetVendor(null)}
        size="md"
      >
        <Modal.Header>
          <Modal.Title>Award Supplier &amp; Create Decision</Modal.Title>
          <Modal.Description>
            Records an approved procurement decision and marks the selected quotation as accepted.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body className="space-y-4">
          {awardTargetVendor && (
            <>
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 flex items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-primary">
                    Rank {awardTargetVendor.rankLabel}
                  </span>
                  <p className="text-base font-bold text-foreground">
                    {awardTargetVendor.supplierName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Total Cost:{' '}
                    {awardTargetVendor.rawMetrics.totalPurchaseCost !== null
                      ? formatCurrencyValue(
                          awardTargetVendor.rawMetrics.totalPurchaseCost,
                          awardTargetVendor.currency
                        )
                      : MISSING_VALUE_LABEL}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold font-mono text-primary">
                    {awardTargetVendor.finalScore.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">/ 100 score</p>
                </div>
              </div>

              {comparisonResult && !comparisonResult.comparability.isComparable && (
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>
                    Note: Comparability mismatches were flagged on this PR. Document your rationale
                    in the justification field below.
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="award-justification">Decision Justification</Label>
                <Textarea
                  id="award-justification"
                  rows={4}
                  value={awardJustification}
                  onChange={(e) => setAwardJustification(e.target.value)}
                  placeholder="Provide audit justification for awarding this supplier..."
                />
              </div>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="ghost"
            onClick={() => setAwardTargetVendor(null)}
            disabled={isAwarding}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirmAward} loading={isAwarding} className="gap-1.5">
            <Award className="size-4" />
            Confirm Award Decision
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          SAVED COMPARISON MATRIX VIEWER MODAL
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={Boolean(viewingSavedEntry)}
        onClose={() => setViewingSavedRecordId(null)}
        size="xl"
      >
        <Modal.Header>
          <Modal.Title>{viewingSavedEntry?.record.data.title || 'Saved Comparison'}</Modal.Title>
          <Modal.Description>
            Saved deterministic comparison snapshot for {viewingSavedEntry?.prTitle}
          </Modal.Description>
        </Modal.Header>
        <Modal.Body className="space-y-4">
          {viewingSavedEntry && (
            <SavedMatrixViewer
              criteria={viewingSavedEntry.criteria}
              recommendation={viewingSavedEntry.record.data.recommendation}
              notes={viewingSavedEntry.record.data.notes}
            />
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setViewingSavedRecordId(null)}>
            Close
          </Button>
          {viewingSavedEntry && (
            <Button
              onClick={() => handleLoadSavedComparison(viewingSavedEntry.record)}
              className="gap-1.5"
            >
              <BarChart3 className="size-4" />
              Load in Workspace
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          DELETE SAVED COMPARISON CONFIRMATION MODAL
         ══════════════════════════════════════════════════════════════════════ */}
      <ConfirmModal
        open={Boolean(deletingSavedRecordId)}
        onClose={() => setDeletingSavedRecordId(null)}
        onConfirm={handleDeleteSavedComparison}
        title="Delete Saved Comparison"
        description="Are you sure you want to permanently remove this saved comparison matrix from your organization's history?"
        confirmText="Delete"
        variant="destructive"
        loading={isDeleting}
      />
    </div>
  )
}

// ─── Saved Matrix Snapshot Viewer ────────────────────────────────────────────

function SavedMatrixViewer({
  criteria,
  recommendation,
  notes,
}: {
  criteria: SerializedComparisonCriteria | null
  recommendation?: string
  notes?: string
}) {
  if (!criteria) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          This saved record does not include a structured criteria matrix snapshot.
        </p>
        {recommendation && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground mb-1">Recommendation</p>
            <p className="text-xs text-muted-foreground">{recommendation}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Weights summary */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">
          {criteria.isStandardWeights ? 'Standard Weights' : 'Custom Weights'}
        </Badge>
        {FACTOR_ORDER.map((factor) => (
          <span
            key={factor}
            className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground font-mono"
          >
            {FACTOR_META[factor].shortLabel}: {(criteria.weights[factor] * 100).toFixed(0)}%
          </span>
        ))}
      </div>

      {/* Saved table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2.5 px-3">Rank</th>
              <th className="py-2.5 px-3">Supplier</th>
              <th className="py-2.5 px-3">Total Cost</th>
              <th className="py-2.5 px-3">Delivery</th>
              <th className="py-2.5 px-3">Quality</th>
              <th className="py-2.5 px-3">Terms</th>
              <th className="py-2.5 px-3">Reliability</th>
              <th className="py-2.5 px-3 text-right">Final Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {criteria.rankings.map((r) => (
              <tr key={r.quotationId} className={r.rank === 1 ? 'bg-primary/5' : ''}>
                <td className="py-2.5 px-3 font-bold">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${getRankBadgeStyle(
                      r.rank
                    )}`}
                  >
                    {r.rankLabel}
                  </span>
                </td>
                <td className="py-2.5 px-3 font-semibold text-foreground">
                  {r.supplierName}
                  {r.missingFields.length > 0 && (
                    <span className="block text-[10px] font-normal text-amber-600 dark:text-amber-400">
                      Unrated: {r.missingFields.join(', ')}
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-3 font-mono">
                  <div>
                    {r.totalPurchaseCost !== null
                      ? formatCurrencyValue(r.totalPurchaseCost, r.currency)
                      : MISSING_VALUE_LABEL}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.normalizedScores.cost.toFixed(1)} (+{r.weightedContributions.cost.toFixed(2)})
                  </div>
                </td>
                <td className="py-2.5 px-3 font-mono">
                  <div>{r.deliveryDays !== null ? `${r.deliveryDays}d` : MISSING_VALUE_LABEL}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.normalizedScores.delivery.toFixed(1)} (+
                    {r.weightedContributions.delivery.toFixed(2)})
                  </div>
                </td>
                <td className="py-2.5 px-3 font-mono">
                  <div>
                    {r.qualityRating !== null ? `${r.qualityRating.toFixed(1)}/5` : MISSING_VALUE_LABEL}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.normalizedScores.quality.toFixed(1)} (+
                    {r.weightedContributions.quality.toFixed(2)})
                  </div>
                </td>
                <td className="py-2.5 px-3 font-mono">
                  <div>{r.paymentTerms || MISSING_VALUE_LABEL}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.normalizedScores.paymentTerms.toFixed(1)} (+
                    {r.weightedContributions.paymentTerms.toFixed(2)})
                  </div>
                </td>
                <td className="py-2.5 px-3 font-mono">
                  <div>
                    {r.missingFields.includes('reliability')
                      ? MISSING_VALUE_LABEL
                      : `${r.normalizedScores.reliability.toFixed(0)}/100`}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    +{r.weightedContributions.reliability.toFixed(2)} pts
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-primary text-sm">
                  {r.finalScore.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recommendation && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <p className="font-semibold text-foreground mb-1">Recorded Recommendation</p>
          <p className="text-muted-foreground leading-relaxed">{recommendation}</p>
        </div>
      )}

      {notes && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
          <p className="font-semibold text-foreground mb-1">Audit Notes</p>
          <p className="text-muted-foreground whitespace-pre-wrap">{notes}</p>
        </div>
      )}
    </div>
  )
}
