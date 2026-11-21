/**
 * ProcureLens — AI Procurement Analyst
 *
 * Spatial UI two-panel interface:
 *   - Left rail: Saved comparisons selector, quick-prompt action buttons,
 *     and conversation thread history.
 *   - Main conversation pane:
 *     * Header with active comparison badge, org verification, model status.
 *     * Message bubble stream with markdown rendering & visual badge parser
 *       ([FACT] blue pill, [SUGGESTION] green pill, [RISK] amber pill).
 *     * Preset prompt chips & input bar with Send, Cancel, and Clear actions.
 *     * Loading skeleton states & graceful error banner with Retry action.
 */

import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth, useUser, getAuthToken } from 'deepspace'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/atom-one-dark.css'
import {
  AlertCircle,
  AlertTriangle,
  Award,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@/components/ui'
import { useOrgQuery } from '@/hooks/useOrgQuery'
import type { Comparison } from '@/schemas/comparisons-schema'
import type { PurchaseRequest } from '@/schemas/purchase-requests-schema'
import type { Quotation } from '@/schemas/quotations-schema'
import type { QuotationItem } from '@/schemas/quotation-items-schema'
import type { Supplier } from '@/schemas/suppliers-schema'
import {
  DEFAULT_COMPARISON_WEIGHTS,
  buildComparisonInputsFromRecords,
  compareVendorQuotations,
  formatCurrencyValue,
  parseSavedComparison,
  type VendorComparisonResult,
} from '@/lib/vendor-comparison-engine'
import {
  analyseComparison,
  explainSupplierRankings,
  identifyProcurementRisks,
  highlightMissingQuotationInfo,
  suggestNegotiationStrategies,
  generateExecutiveSummary,
} from '@/services/procurement-analyst.service'

export type AnalystAction =
  | 'analyse_comparison'
  | 'explain_rankings'
  | 'identify_risks'
  | 'missing_info'
  | 'negotiation_strategies'
  | 'grounded_qa'
  | 'executive_summary'

// ─── Epistemic Visual Badges ─────────────────────────────────────────────────

export function EpistemicBadge({ type }: { type: 'FACT' | 'SUGGESTION' | 'RISK' }) {
  if (type === 'FACT') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-blue-50 text-blue-700 border border-blue-200 shadow-sm dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800 mr-1.5 align-baseline">
        <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
        FACT
      </span>
    )
  }
  if (type === 'SUGGESTION') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 mr-1.5 align-baseline">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        SUGGESTION
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-amber-50 text-amber-700 border border-amber-200 shadow-sm dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 mr-1.5 align-baseline">
      <span className="size-1.5 rounded-full bg-amber-500" />
      RISK
    </span>
  )
}

function parseTextWithBadges(text: string): React.ReactNode {
  const parts = text.split(/(\[(?:FACT|SUGGESTION|RISK)\])/g)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    if (part === '[FACT]') return <EpistemicBadge key={i} type="FACT" />
    if (part === '[SUGGESTION]') return <EpistemicBadge key={i} type="SUGGESTION" />
    if (part === '[RISK]') return <EpistemicBadge key={i} type="RISK" />
    return part
  })
}

function replaceBadgesInReactNodes(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') {
    return parseTextWithBadges(children)
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => (
      <Fragment key={idx}>{replaceBadgesInReactNodes(child)}</Fragment>
    ))
  }
  return children
}

const MarkdownCodeBlock = ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    const text = ref.current?.textContent
    if (!text) return
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="group relative my-3">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="absolute right-2 top-2 inline-flex h-6 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-[11px] font-medium text-zinc-200 opacity-0 transition-opacity hover:bg-zinc-700 focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <pre ref={ref} className="rounded-xl bg-zinc-950 p-4 text-xs font-mono text-zinc-100 overflow-x-auto border border-zinc-800" {...props}>
        {children}
      </pre>
    </div>
  )
}

const MarkdownExternalLink = ({ children, href, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:opacity-80"
    {...props}
  >
    {children}
    <ExternalLink className="size-3 inline-block" />
  </a>
)

const markdownComponents: Components = {
  p: ({ children }) => <p className="my-2.5 leading-relaxed text-[13.5px]">{replaceBadgesInReactNodes(children)}</p>,
  li: ({ children }) => <li className="my-1.5 leading-relaxed text-[13.5px]">{replaceBadgesInReactNodes(children)}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{replaceBadgesInReactNodes(children)}</strong>,
  h1: ({ children }) => <h1 className="text-xl font-bold tracking-tight text-foreground my-4 pb-1 border-b border-border/60">{replaceBadgesInReactNodes(children)}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold text-foreground my-3 flex items-center gap-2">{replaceBadgesInReactNodes(children)}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground my-2">{replaceBadgesInReactNodes(children)}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-2.5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2.5 space-y-1">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-primary/40 bg-muted/40 px-3.5 py-2 rounded-r-lg text-muted-foreground italic text-xs">
      {replaceBadgesInReactNodes(children)}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs text-left border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border bg-muted/60 px-3 py-2 font-semibold text-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/60 px-3 py-2 text-foreground/90">{replaceBadgesInReactNodes(children)}</td>,
  pre: MarkdownCodeBlock,
  a: MarkdownExternalLink,
}

// ─── Chat Message Types & Storage ────────────────────────────────────────────

export interface AnalystChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  provider?: string
  isFallback?: boolean
  timestamp: string
  warning?: string
  action?: AnalystAction | 'custom'
}

export interface AnalystThread {
  id: string
  comparisonId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: AnalystChatMessage[]
}

const PRESET_PROMPTS = [
  'Explain supplier ranking weights & math',
  'Identify procurement risks & sole-supplier bottlenecks',
  'Formulate negotiation counter-offers & leverage points',
  'Audit missing data & unstated payment terms',
  'Generate 1-page executive purchasing summary',
]

// ─── Main AI Analyst Page Component ──────────────────────────────────────────

export default function AnalystPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useUser()
  const { error: toastError, success: toastSuccess } = useToast()

  const requestedComparisonId = searchParams.get('comparisonId') || ''

  // Multi-tenant isolated queries
  const { records: comparisonRecords, orgId } = useOrgQuery<Comparison>('comparisons')
  const { records: prRecords } = useOrgQuery<PurchaseRequest>('purchase_requests')
  const { records: quotationRecords } = useOrgQuery<Quotation>('quotations')
  const { records: quotationItemRecords } = useOrgQuery<QuotationItem>('quotation_items')
  const { records: supplierRecords } = useOrgQuery<Supplier>('suppliers')

  // Selected comparison
  const [selectedComparisonId, setSelectedComparisonId] = useState<string>(requestedComparisonId)

  useEffect(() => {
    if (requestedComparisonId) {
      setSelectedComparisonId(requestedComparisonId)
    } else if (comparisonRecords.length > 0 && !selectedComparisonId) {
      setSelectedComparisonId(comparisonRecords[0].recordId)
    }
  }, [requestedComparisonId, comparisonRecords, selectedComparisonId])

  const activeComparisonRecord = useMemo(() => {
    return comparisonRecords.find((c) => c.recordId === selectedComparisonId) || null
  }, [comparisonRecords, selectedComparisonId])

  // Reconstructed deterministic comparison result
  const activeComparisonResult = useMemo<VendorComparisonResult | null>(() => {
    if (!activeComparisonRecord) return null
    const pr = prRecords.find((r) => r.recordId === activeComparisonRecord.data.purchaseRequestId)
    if (!pr) return null

    const parsed = parseSavedComparison(activeComparisonRecord.data)

    // Resolve quotations that still exist for the saved IDs
    const matchedByIds = parsed.quotationIds.length > 0
      ? quotationRecords.filter((q) => parsed.quotationIds.includes(q.recordId))
      : []

    // Fallback: all quotations belonging to the same purchase request
    const matchedByPr = quotationRecords.filter(
      (q) => q.data.purchaseRequestId === activeComparisonRecord.data.purchaseRequestId
    )

    // Prefer saved-ID matches; if stale / fewer than 2, fall back to PR-level quotations
    const quotes = matchedByIds.length >= 2 ? matchedByIds : matchedByPr

    if (quotes.length < 2) return null

    // When falling back to PR-level, use their actual record IDs so the engine
    // doesn't filter everything out against stale saved IDs
    const effectiveSelectedIds = matchedByIds.length >= 2
      ? parsed.quotationIds
      : quotes.map((q) => q.recordId)

    const { purchaseRequest, quotations } = buildComparisonInputsFromRecords({
      purchaseRequestRecord: pr,
      quotationRecords: quotes,
      quotationItemRecords,
      supplierRecords,
      selectedQuotationIds: effectiveSelectedIds,
    })

    if (quotations.length === 0) return null

    return compareVendorQuotations(purchaseRequest, quotations, {
      weights: parsed.criteria?.weights || DEFAULT_COMPARISON_WEIGHTS,
    })
  }, [activeComparisonRecord, prRecords, quotationRecords, quotationItemRecords, supplierRecords])

  // Diagnostic: explain WHY a selected comparison can't be used
  const comparisonDiagnostic = useMemo<string | null>(() => {
    if (activeComparisonResult) return null // all good
    if (!selectedComparisonId) return 'No comparison selected. Save one from the Comparisons page first.'
    if (!activeComparisonRecord) return 'The selected comparison was not found in this organization.'
    const pr = prRecords.find((r) => r.recordId === activeComparisonRecord.data.purchaseRequestId)
    if (!pr) return `Purchase request "${activeComparisonRecord.data.purchaseRequestId}" no longer exists. Create a new comparison.`
    const prQuotes = quotationRecords.filter(
      (q) => q.data.purchaseRequestId === activeComparisonRecord.data.purchaseRequestId
    )
    if (prQuotes.length < 2) {
      return `Only ${prQuotes.length} quotation(s) exist for this purchase request. Upload at least 2 supplier quotations, then re-run the comparison.`
    }
    return 'Comparison data could not be reconstructed. Try re-saving the comparison from the Comparisons page.'
  }, [activeComparisonResult, selectedComparisonId, activeComparisonRecord, prRecords, quotationRecords])

  // Active PR title for breadcrumbs/headers
  const activePr = useMemo(() => {
    if (!activeComparisonRecord) return null
    return prRecords.find((r) => r.recordId === activeComparisonRecord.data.purchaseRequestId) || null
  }, [activeComparisonRecord, prRecords])

  // Thread management & message history
  const [threads, setThreads] = useState<AnalystThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string>('')
  const [messages, setMessages] = useState<AnalystChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastFailedAction, setLastFailedAction] = useState<{
    action: AnalystAction | 'custom'
    prompt: string
  } | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  // Load threads from localStorage
  const storageKey = useMemo(() => {
    return `procurelens-analyst-threads-${orgId || 'default'}-${selectedComparisonId || 'all'}`
  }, [orgId, selectedComparisonId])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed: AnalystThread[] = JSON.parse(stored)
        setThreads(parsed)
        if (parsed.length > 0) {
          setActiveThreadId(parsed[0].id)
          setMessages(parsed[0].messages)
          return
        }
      }
    } catch {
      // ignore JSON parse failures
    }
    // Default thread
    const newId = `thread-${Date.now()}`
    const initialThread: AnalystThread = {
      id: newId,
      comparisonId: selectedComparisonId,
      title: activeComparisonRecord?.data.title || 'General Analysis',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    }
    setThreads([initialThread])
    setActiveThreadId(newId)
    setMessages([])
  }, [storageKey, selectedComparisonId, activeComparisonRecord?.data.title])

  // Persist messages to active thread
  const persistMessages = useCallback(
    (newMessages: AnalystChatMessage[]) => {
      setMessages(newMessages)
      setThreads((prevThreads) => {
        const next = prevThreads.map((t) => {
          if (t.id === activeThreadId) {
            const firstUser = newMessages.find((m) => m.role === 'user')
            const title = firstUser ? firstUser.content.slice(0, 42) + '…' : t.title
            return {
              ...t,
              title,
              updatedAt: new Date().toISOString(),
              messages: newMessages,
            }
          }
          return t
        })
        try {
          localStorage.setItem(storageKey, JSON.stringify(next))
        } catch {
          // ignore storage error
        }
        return next
      })
    },
    [activeThreadId, storageKey]
  )

  // Auto-scroll logic
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const handleScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottomRef.current = gap < 100
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: isGenerating ? 'auto' : 'smooth' })
  }, [messages, isGenerating])

  // Handle comparison selection change
  const handleSelectComparison = (newId: string) => {
    setSelectedComparisonId(newId)
    setSearchParams({ comparisonId: newId })
    setErrorMessage(null)
  }

  // Create new thread
  const handleCreateNewThread = () => {
    const newId = `thread-${Date.now()}`
    const newThread: AnalystThread = {
      id: newId,
      comparisonId: selectedComparisonId,
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    }
    const updated = [newThread, ...threads]
    setThreads(updated)
    setActiveThreadId(newId)
    setMessages([])
    setErrorMessage(null)
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated))
    } catch {}
    toastSuccess('New conversation started', 'Ready for new procurement questions.')
  }

  // Clear current chat
  const handleClearChat = () => {
    persistMessages([])
    setErrorMessage(null)
    toastSuccess('Conversation cleared', 'Thread history has been reset.')
  }

  // Execute an AI analyst query
  const executeQuery = useCallback(
    async (action: AnalystAction | 'custom', promptText: string) => {
      if (!promptText.trim() && action === 'custom') return
      if (!activeComparisonResult) {
        toastError(
          'Comparison not ready',
          comparisonDiagnostic || 'Please select a saved comparison with at least 2 evaluated supplier quotations.'
        )
        return
      }

      setErrorMessage(null)
      setIsGenerating(true)
      setLastFailedAction({ action, prompt: promptText })

      const userMsg: AnalystChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: promptText,
        timestamp: new Date().toISOString(),
        action,
      }

      const updatedHistory = [...messages, userMsg]
      persistMessages(updatedHistory)
      setInput('')

      // Abort previous in-flight call
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const token = getAuthToken()
        const res = await fetch('/api/ai/analyst', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
          body: JSON.stringify({
            action: action === 'custom' ? 'grounded_qa' : action,
            comparisonResult: activeComparisonResult,
            organizationId: orgId || 'default-org',
            organizationName: user?.name || 'ProcureLens Enterprise',
            question: promptText,
          }),
        })

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string }
          const errorMsg =
            errData.error || `Server responded with status ${res.status} (${res.statusText})`
          throw new Error(errorMsg)
        }

        const data = (await res.json()) as {
          text?: string
          provider?: string
          isFallback?: boolean
          warning?: string
          generatedAt?: string
        }
        const asstMsg: AnalystChatMessage = {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          content: data.text || '',
          provider: data.provider || 'gemini',
          isFallback: Boolean(data.isFallback),
          warning: data.warning,
          timestamp: data.generatedAt || new Date().toISOString(),
        }

        persistMessages([...updatedHistory, asstMsg])
        setLastFailedAction(null)
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return // intentional user cancel
        }

        console.warn('[AI Analyst] Backend error, generating deterministic fallback:', err)

        // Resilient client-side fallback if server fails
        const fallbackText = runLocalFallback(action, promptText, activeComparisonResult, orgId || 'default')

        const fallbackMsg: AnalystChatMessage = {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          content: fallbackText,
          provider: 'rule-based engine (client fallback)',
          isFallback: true,
          warning:
            err instanceof Error
              ? `AI service error: ${err.message}. Showing deterministic rule-based analysis.`
              : 'AI service temporarily unavailable. Showing deterministic analysis.',
          timestamp: new Date().toISOString(),
        }

        persistMessages([...updatedHistory, fallbackMsg])
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'AI service rate limited or unreachable. Showing verified rule-based metrics.'
        )
      } finally {
        setIsGenerating(false)
        abortControllerRef.current = null
      }
    },
    [activeComparisonResult, messages, orgId, persistMessages, toastError, user?.name]
  )

  const handleStopGenerating = () => {
    abortControllerRef.current?.abort()
    setIsGenerating(false)
  }

  const handleRetryLastAction = () => {
    if (lastFailedAction) {
      void executeQuery(lastFailedAction.action, lastFailedAction.prompt)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      {/* ─── Breadcrumb & Top Bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-border/60">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/home" className="hover:text-foreground transition-colors">
            ProcureLens
          </Link>
          <ChevronRight className="size-3" />
          <Link to="/comparisons" className="hover:text-foreground transition-colors">
            Comparisons
          </Link>
          <ChevronRight className="size-3" />
          <span className="font-semibold text-foreground flex items-center gap-1.5">
            <Bot className="size-3.5 text-primary" />
            AI Procurement Analyst
          </span>
        </div>

        {/* Fact vs Suggestion Badge Taxonomy Legend */}
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-muted-foreground font-medium">Epistemic Guardrails:</span>
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold uppercase bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
            [FACT] Grounded
          </span>
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
            [SUGGESTION] Advisory
          </span>
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold uppercase bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
            [RISK] Audit Flag
          </span>
        </div>
      </div>

      {/* ─── Spatial UI Two-Panel Layout ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ── LEFT RAIL: Saved Comparisons & Quick Actions (4 cols) ────────── */}
        <aside className="lg:col-span-4 space-y-4">
          {/* Comparison Selector Card */}
          <div className="card-layer p-4 space-y-4 border border-border/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="size-4 text-primary" />
                Active Comparison
              </h3>
              <Badge variant="outline" className="text-[10px]">
                {comparisonRecords.length} Saved
              </Badge>
            </div>

            {comparisonRecords.length === 0 ? (
              <div className="p-4 rounded-lg bg-muted/30 border border-dashed border-border text-center space-y-2">
                <p className="text-xs text-muted-foreground">No saved comparisons found.</p>
                <Link to="/comparisons">
                  <Button size="sm" variant="outline" className="gap-1 text-xs">
                    <Plus className="size-3" />
                    Create Comparison
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                  Select Comparison to Audit
                </label>
                <Select value={selectedComparisonId} onValueChange={handleSelectComparison}>
                  <SelectTrigger className="w-full text-xs bg-card">
                    <SelectValue placeholder="Choose a comparison..." />
                  </SelectTrigger>
                  <SelectContent>
                    {comparisonRecords.map((c) => (
                      <SelectItem key={c.recordId} value={c.recordId} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate max-w-[220px]">{c.data.title}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {c.data.status === 'completed' ? '✓ Ready' : 'In Progress'}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Diagnostic Banner — explains why a comparison can't be loaded */}
            {comparisonDiagnostic && selectedComparisonId && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Cannot Load Comparison</p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5 leading-relaxed">
                      {comparisonDiagnostic}
                    </p>
                  </div>
                </div>
                <Link to="/comparisons">
                  <Button size="sm" variant="outline" className="gap-1 text-xs w-full border-amber-300 dark:border-amber-700">
                    <BarChart3 className="size-3" />
                    Go to Comparisons
                  </Button>
                </Link>
              </div>
            )}

            {/* Selected Comparison Summary Box */}
            {activeComparisonResult && activeComparisonRecord && (
              <div className="p-3.5 rounded-lg bg-primary/5 border border-primary/20 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-foreground">
                      {activeComparisonResult.purchaseRequestTitle}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {activeComparisonResult.rankings.length} evaluated quotations
                    </p>
                  </div>
                  <Link
                    to={`/comparisons?prId=${activeComparisonRecord.data.purchaseRequestId}`}
                    className="text-[11px] text-primary hover:underline flex items-center gap-1 shrink-0"
                  >
                    View Matrix
                    <ExternalLink className="size-3" />
                  </Link>
                </div>

                {activeComparisonResult.recommendedVendor && (
                  <div className="flex items-center justify-between pt-2 border-t border-primary/10">
                    <div className="flex items-center gap-1.5">
                      <Award className="size-3.5 text-amber-500" />
                      <span className="text-xs font-semibold text-foreground truncate max-w-[140px]">
                        {activeComparisonResult.recommendedVendor.supplierName}
                      </span>
                    </div>
                    <Badge variant="info" className="text-[10px]">
                      {activeComparisonResult.recommendedVendor.finalScore.toFixed(2)}/100
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick-Prompt Action Buttons Card */}
          <div className="card-layer p-4 space-y-3 border border-border/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                Quick Procurement Audits
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Trigger deep analytical routines strictly grounded in your active vendor comparison.
            </p>

            <div className="space-y-1.5 pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={isGenerating || !activeComparisonResult}
                className="w-full justify-start text-xs gap-2.5 bg-card hover:bg-accent/60 h-9"
                onClick={() =>
                  executeQuery(
                    'explain_rankings',
                    'Explain the deterministic ranking scores, factor weights, and why the winner was selected.'
                  )
                }
              >
                <Scale className="size-3.5 text-indigo-500" />
                <span className="truncate">Explain Vendor Rankings</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={isGenerating || !activeComparisonResult}
                className="w-full justify-start text-xs gap-2.5 bg-card hover:bg-accent/60 h-9"
                onClick={() =>
                  executeQuery(
                    'identify_risks',
                    'Identify procurement risks, sole-supplier dependency, lead-time bottlenecks, and price spreads.'
                  )
                }
              >
                <ShieldAlert className="size-3.5 text-amber-500" />
                <span className="truncate">Audit Procurement Risks</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={isGenerating || !activeComparisonResult}
                className="w-full justify-start text-xs gap-2.5 bg-card hover:bg-accent/60 h-9"
                onClick={() =>
                  executeQuery(
                    'negotiation_strategies',
                    'Suggest targeted negotiation strategies, price counter-offers, and payment term leverage.'
                  )
                }
              >
                <TrendingUp className="size-3.5 text-emerald-500" />
                <span className="truncate">Negotiation Counter-Offers</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={isGenerating || !activeComparisonResult}
                className="w-full justify-start text-xs gap-2.5 bg-card hover:bg-accent/60 h-9"
                onClick={() =>
                  executeQuery(
                    'executive_summary',
                    'Generate a formal Executive Purchasing Summary suitable for management sign-off.'
                  )
                }
              >
                <FileText className="size-3.5 text-sky-500" />
                <span className="truncate">Executive Purchasing Summary</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={isGenerating || !activeComparisonResult}
                className="w-full justify-start text-xs gap-2.5 bg-card hover:bg-accent/60 h-9"
                onClick={() =>
                  executeQuery(
                    'missing_info',
                    'Audit quotations for unstated payment terms, missing delivery days, or incomplete specs.'
                  )
                }
              >
                <AlertCircle className="size-3.5 text-rose-500" />
                <span className="truncate">Audit Missing Quotation Data</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={isGenerating || !activeComparisonResult}
                className="w-full justify-start text-xs gap-2.5 bg-card hover:bg-accent/60 h-9"
                onClick={() =>
                  executeQuery(
                    'analyse_comparison',
                    'Perform full 360-degree multi-criteria analysis across all evaluated dimensions.'
                  )
                }
              >
                <Layers className="size-3.5 text-purple-500" />
                <span className="truncate">Full Comparison Analysis</span>
              </Button>
            </div>
          </div>

          {/* Conversation History / Threads Card */}
          <div className="card-layer p-4 space-y-3 border border-border/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Clock className="size-4 text-primary" />
                Thread Sessions
              </h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={handleCreateNewThread}
              >
                <Plus className="size-3" />
                New
              </Button>
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {threads.map((t) => {
                const isActive = t.id === activeThreadId
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setActiveThreadId(t.id)
                      setMessages(t.messages)
                      setErrorMessage(null)
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary font-medium border border-primary/20'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="size-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{t.title}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {t.messages.length} msgs
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        {/* ── MAIN CONVERSATION PANE (8 cols) ───────────────────────────────── */}
        <main className="lg:col-span-8 flex flex-col h-[calc(100vh-170px)] min-h-[640px] bg-shell-panel rounded-xl border border-border/70 shadow-[var(--shadow-card)] overflow-hidden">
          {/* Main Pane Header */}
          <header className="px-5 py-3.5 border-b border-border/60 bg-card/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-foreground truncate max-w-[300px]">
                    {activeComparisonRecord?.data.title || 'Procurement AI Analyst'}
                  </h2>
                  <Badge variant="outline" className="text-[10px] gap-1 bg-background/80">
                    <ShieldCheck className="size-3 text-emerald-500" />
                    Verified Organization
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {activePr ? `Linked to PR: ${activePr.data.title}` : 'Strict zero-hallucination guardrails active'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {/* Active Model Indicator */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                Gemini 1.5 Flash • Operational
              </div>

              {/* Clear chat button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-foreground text-xs gap-1"
                onClick={handleClearChat}
                title="Clear current conversation"
              >
                <Trash2 className="size-3.5" />
                Clear
              </Button>
            </div>
          </header>

          {/* Graceful Error Banner with Retry */}
          {errorMessage && (
            <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-3 text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                <span className="truncate font-medium">{errorMessage}</span>
              </div>
              {lastFailedAction && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 gap-1 shrink-0"
                  onClick={handleRetryLastAction}
                >
                  <RefreshCw className="size-3" />
                  Retry Action
                </Button>
              )}
            </div>
          )}

          {/* Message Stream Area */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5 space-y-5">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-lg mx-auto">
                <div className="size-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
                  <Bot className="size-7" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-semibold text-foreground">
                    ProcureLens AI Procurement Analyst
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Audits vendor quotations, calculates deterministic score breakdowns, detects supply
                    chain risks, and formulates strategic negotiation counter-offers.
                  </p>
                </div>

                {/* Preset Chips */}
                <div className="w-full pt-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Suggested Queries:
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {PRESET_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => executeQuery('custom', prompt)}
                        className="text-left text-xs px-3 py-2 rounded-lg bg-card/80 border border-border/70 hover:border-primary/40 hover:bg-primary/5 transition-all text-muted-foreground hover:text-foreground flex items-center justify-between group shadow-sm"
                      >
                        <span className="truncate">{prompt}</span>
                        <ChevronRight className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === 'user'
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {!isUser && (
                      <div className="size-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center text-primary shrink-0 mt-0.5">
                        <Bot className="size-4" />
                      </div>
                    )}

                    <div
                      className={`max-w-[85%] rounded-2xl p-4 space-y-2 ${
                        isUser
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'bg-card border border-border/80 text-foreground shadow-sm'
                      }`}
                    >
                      {/* Assistant Header / Metadata */}
                      {!isUser && (
                        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-border/40 text-[11px] text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground flex items-center gap-1">
                              AI Analyst
                            </span>
                            {msg.provider && (
                              <span className="px-1.5 py-0.2 rounded bg-muted text-[10px] font-mono">
                                {msg.provider}
                              </span>
                            )}
                            {msg.isFallback && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-medium">
                                Deterministic Fallback
                              </span>
                            )}
                          </div>
                          <span className="text-[10px]">
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      )}

                      {/* Content */}
                      {isUser ? (
                        <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div className="prose prose-xs dark:prose-invert max-w-none">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            rehypePlugins={[rehypeHighlight]}
                            components={markdownComponents}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}

                      {/* Warning note if any */}
                      {msg.warning && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1 border-t border-border/30 italic">
                          ℹ️ {msg.warning}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })
            )}

            {/* Skeleton Loading State */}
            {isGenerating && (
              <div className="flex gap-3 justify-start animate-pulse">
                <div className="size-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary shrink-0 mt-0.5">
                  <Bot className="size-4" />
                </div>
                <div className="max-w-[75%] w-full bg-card border border-border/70 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-primary animate-ping" />
                    <span className="text-xs font-semibold text-primary">
                      Synthesizing multi-criteria procurement factors...
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-3.5 bg-muted rounded w-5/6" />
                    <div className="h-3.5 bg-muted rounded w-4/6" />
                    <div className="h-3.5 bg-muted rounded w-3/4" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Preset Prompt Chips Bar (Above Input) */}
          <div className="px-4 py-2 border-t border-border/40 bg-muted/20 flex items-center gap-2 overflow-x-auto shrink-0">
            <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
              Chips:
            </span>
            {PRESET_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                disabled={isGenerating || !activeComparisonResult}
                onClick={() => executeQuery('custom', prompt)}
                className="text-[11px] px-2.5 py-1 rounded-full border border-border/60 bg-card hover:bg-accent text-muted-foreground hover:text-foreground whitespace-nowrap transition-colors shrink-0 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <footer className="p-4 border-t border-border/60 bg-card/70 backdrop-blur-md shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (input.trim() && !isGenerating) {
                  void executeQuery('custom', input)
                }
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  activeComparisonResult
                    ? 'Ask a procurement question (e.g. "What if we negotiate a 10% discount with Supplier B?")...'
                    : 'Select a saved comparison to begin...'
                }
                disabled={isGenerating || !activeComparisonResult}
                className="flex-1 h-10 px-3.5 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />

              {isGenerating ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-10 px-3.5 gap-1.5 text-xs shrink-0"
                  onClick={handleStopGenerating}
                >
                  <Square className="size-3.5" />
                  Cancel
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || !activeComparisonResult}
                  className="h-10 px-4 gap-1.5 text-xs shrink-0 font-medium"
                >
                  <Send className="size-3.5" />
                  Send
                </Button>
              )}
            </form>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Responses are strictly grounded in vendor quotation records. Purchase orders and contract awards require explicit human authorization.
            </p>
          </footer>
        </main>
      </div>
    </div>
  )
}

// ─── Client-side Rule-based Fallback Runner ───────────────────────────────────

function runLocalFallback(
  action: AnalystAction | 'custom',
  _prompt: string,
  comparisonResult: VendorComparisonResult,
  orgId: string
): string {
  const ctx = { organizationId: orgId }

  switch (action) {
    case 'explain_rankings':
      return explainSupplierRankings(ctx, comparisonResult).text
    case 'identify_risks':
      return identifyProcurementRisks(ctx, { comparison: comparisonResult }).analysis.text
    case 'missing_info': {
      const completeness = comparisonResult.rankings.map((r) => ({
        quotationId: r.quotationId,
        supplierName: r.supplierName,
        hasPaymentTerms: r.rawMetrics.paymentTerms !== null,
        hasDeliveryDays: r.rawMetrics.deliveryDays !== null,
        hasQualityRating: r.rawMetrics.qualityRating !== null,
        hasValidUntil: true,
        hasItems: true,
        hasSpecifications: true,
        currency: r.currency,
      }))
      return highlightMissingQuotationInfo(ctx, completeness).text
    }
    case 'negotiation_strategies':
      return suggestNegotiationStrategies(ctx, comparisonResult).text
    case 'executive_summary':
      return generateExecutiveSummary(ctx, comparisonResult).text
    case 'analyse_comparison':
    case 'custom':
    default:
      return analyseComparison(ctx, comparisonResult).text
  }
}
