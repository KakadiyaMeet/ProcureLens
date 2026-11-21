/**
 * AI Tool Definitions — converts DeepSpace BUILT_IN_TOOLS to Vercel AI SDK tools.
 *
 * The assistant can read AND modify data. Per-collection RBAC at the DO
 * layer is the actual security boundary — the user's role determines what
 * each tool call is allowed to do, regardless of what's in this allowlist.
 * Trim entries below if you want a stricter assistant for your app.
 */

import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod/v4'
import { BUILT_IN_TOOLS, applyAiToolDefaults } from 'deepspace/worker'
import type { ToolSchema, CollectionSchema } from 'deepspace/worker'

type ToolExecutor = (toolName: string, params: Record<string, unknown>) => Promise<unknown>

const ALLOWED_TOOL_NAMES = [
  'schema.list',
  'schema.describe',
  'records.query',
  'records.get',
  'records.create',
  'records.update',
  'records.delete',
  'user.current',
]

// ============================================================================
// System prompt
// ============================================================================

type Interpretation = CollectionSchema['columns'][number]['interpretation']

/**
 * Interpretation is `string | Record<string, unknown>`. When it's an object
 * the convention across the SDK's schemas is `{ kind: string, ... }`.
 * Narrow safely to a human-readable name.
 */
function interpretationLabel(interpretation: Interpretation): string {
  if (typeof interpretation === 'string') return interpretation
  const kind = interpretation.kind
  return typeof kind === 'string' ? kind : 'object'
}

export function buildSystemPrompt(appName: string, schemas: CollectionSchema[]): string {
  const schemaSummary = schemas
    .map((s) => {
      const cols = (s.columns ?? [])
        .map((c) => `${c.name}:${interpretationLabel(c.interpretation)}${c.required ? '!' : ''}`)
        .join(', ')
      return `- ${s.name}${cols ? ` (${cols})` : ''}`
    })
    .join('\n')

  return [
    `You are the AI Procurement Analyst for "${appName}" on DeepSpace.`,
    "You have access to procurement collections (comparisons, purchase_requests, quotations, quotation_items, suppliers, decisions).",
    "You can read and modify the user's data via the available tools. The",
    "user's own role and permissions still apply at the data layer — your",
    'tool calls run as the calling user, so you can only do what they could.',
    '',
    'AI PROCUREMENT ANALYST PRINCIPLES & GUARDRAILS:',
    '1. STRICT GROUNDING: Base all analyses strictly on database records (comparisons, quotations, suppliers). Never invent vendor names, prices, delivery dates, or ratings.',
    '2. DETERMINISTIC RANKING INTEGRITY: Never alter or recalculate vendor rankings or scores. Reproduce computed scores verbatim.',
    '3. EPISTEMIC DISCIPLINE: Tag every statement with epistemic markers:',
    '   - [FACT] for verified database facts, computed scores, prices, and dates.',
    '   - [SUGGESTION] for actionable advice, negotiation strategies, and recommendations.',
    '   - [RISK] for identified supply chain, sole-source, delivery, price variance, or missing-data risks.',
    '4. NON-AUTONOMOUS: You are an advisory assistant. Explicitly state that purchasing decisions and contract awards require human procurement officer approval.',
    '',
    'Be careful with mutations:',
    '- Confirm intent before destructive actions (delete, bulk update).',
    '- Operate only on collections the user explicitly mentioned.',
    '- After a successful write, briefly confirm what changed.',
    '- If a write is denied (RBAC), tell the user plainly — do not retry blindly.',
    '',
    'Use tools to look up facts before answering. Do not invent data.',
    'If data is missing, say so plainly. Keep answers concise.',
    '',
    'Available collections:',
    schemaSummary || '(none)',
  ].join('\n')
}

// ============================================================================
// Procurement tool schemas
// ============================================================================

const PROCUREMENT_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'procurement.analyze_comparison',
    description:
      'Inspect a saved vendor comparison, fetch associated quotations and purchase request, and evaluate supplier rankings and criteria.',
    params: {
      comparisonId: {
        type: 'string',
        required: true,
        description: 'ID of the comparison record to analyze',
      },
    },
  },
  {
    name: 'procurement.explain_rankings',
    description:
      'Explain the 5-factor deterministic ranking calculation (Cost 40%, Delivery 25%, Quality 20%, Payment Terms 10%, Reliability 5%) for suppliers in a comparison.',
    params: {
      comparisonId: {
        type: 'string',
        required: true,
        description: 'ID of the comparison record whose ranking math to explain',
      },
    },
  },
  {
    name: 'procurement.identify_risks',
    description:
      'Audit procurement risks across quotations including sole-supplier dependency, delivery lead times, price variance > 15%, missing quality ratings, and unstated payment terms.',
    params: {
      purchaseRequestId: {
        type: 'string',
        required: false,
        description: 'Optional purchase request ID to evaluate quotations for',
      },
      comparisonId: {
        type: 'string',
        required: false,
        description: 'Optional comparison ID to evaluate risks for',
      },
    },
  },
  {
    name: 'procurement.negotiation_strategies',
    description:
      'Generate targeted negotiation strategies, price counter-offers, payment term upgrades, and delivery incentives based on the gap between runner-up and winning quotations.',
    params: {
      comparisonId: {
        type: 'string',
        required: true,
        description: 'ID of the comparison record to formulate negotiation strategies for',
      },
    },
  },
]

// ============================================================================
// Tool definitions
// ============================================================================

export function buildTools(executor: ToolExecutor): ToolSet {
  const tools: ToolSet = {}

  for (const def of BUILT_IN_TOOLS) {
    if (!ALLOWED_TOOL_NAMES.includes(def.name)) continue
    const safeName = def.name.replace('.', '_')
    tools[safeName] = tool({
      description: def.description,
      inputSchema: buildInputSchema(def),
      // Apply assistant-only param defaults (e.g. records.query page size) here
      // in the AI tool layer, so internal record readers that hit the tools
      // dispatch directly stay unbounded.
      execute: async (params: Record<string, unknown>) =>
        executor(def.name, applyAiToolDefaults(def.name, params)),
    })
  }

  // Procurement analysis tools for the right-side chat dock & AI assistant
  for (const def of PROCUREMENT_TOOL_SCHEMAS) {
    const safeName = def.name.replace('.', '_')
    tools[safeName] = tool({
      description: def.description,
      inputSchema: buildInputSchema(def),
      execute: async (params: Record<string, unknown>) => {
        const comparisonId = typeof params.comparisonId === 'string' ? params.comparisonId : ''
        const prId = typeof params.purchaseRequestId === 'string' ? params.purchaseRequestId : ''

        try {
          if (def.name === 'procurement.analyze_comparison') {
            const compRecord = (await executor('records.get', {
              collection: 'comparisons',
              recordId: comparisonId,
            })) as { data?: Record<string, unknown> } | null
            if (!compRecord?.data) {
              return { success: false, error: `Comparison ${comparisonId} not found` }
            }
            const data = compRecord.data
            const purchaseRequestId = String(data.purchaseRequestId || '')
            const prRecord = purchaseRequestId
              ? ((await executor('records.get', {
                  collection: 'purchase_requests',
                  recordId: purchaseRequestId,
                })) as { data?: Record<string, unknown> } | null)
              : null
            return {
              success: true,
              comparisonId,
              title: data.title,
              status: data.status,
              purchaseRequest: prRecord?.data ? { id: purchaseRequestId, title: prRecord.data.title, category: prRecord.data.category, budget: prRecord.data.budget } : null,
              quotationIds: data.quotationIds,
              criteria: data.criteria,
              recommendation: data.recommendation,
              notes: data.notes,
            }
          }

          if (def.name === 'procurement.explain_rankings') {
            const compRecord = (await executor('records.get', {
              collection: 'comparisons',
              recordId: comparisonId,
            })) as { data?: Record<string, unknown> } | null
            if (!compRecord?.data) {
              return { success: false, error: `Comparison ${comparisonId} not found` }
            }
            return {
              success: true,
              comparisonId,
              title: compRecord.data.title,
              criteria: compRecord.data.criteria,
              recommendation: compRecord.data.recommendation,
              standardWeights: {
                cost: '40% (lower total purchase cost scores higher)',
                delivery: '25% (shorter lead time in days scores higher)',
                quality: '20% (higher supplier rating scores higher)',
                paymentTerms: '10% (more flexible credit ladder scores higher)',
                reliability: '5% (delivery reliability scores higher)',
              },
            }
          }

          if (def.name === 'procurement.identify_risks') {
            const targetPrId = prId || ''
            const quotes = (await executor('records.query', {
              collection: 'quotations',
              where: targetPrId ? { purchaseRequestId: targetPrId } : undefined,
              limit: 20,
            })) as Array<{ recordId: string; data: Record<string, unknown> }>

            const quotations = Array.isArray(quotes) ? quotes : []
            const soleSupplier = quotations.length === 1
            const missingDelivery = quotations.filter((q) => q.data.deliveryDays === undefined || q.data.deliveryDays === null).map((q) => q.data.supplierName || q.recordId)
            const missingTerms = quotations.filter((q) => !q.data.paymentTerms).map((q) => q.data.supplierName || q.recordId)

            return {
              success: true,
              quotationCount: quotations.length,
              soleSupplierRisk: soleSupplier ? '[RISK] Sole-supplier dependency detected: only 1 quotation is available.' : null,
              missingDeliveryDays: missingDelivery.length > 0 ? `[RISK] Missing delivery lead time for: ${missingDelivery.join(', ')}` : null,
              missingPaymentTerms: missingTerms.length > 0 ? `[RISK] Missing payment terms for: ${missingTerms.join(', ')}` : null,
            }
          }

          if (def.name === 'procurement.negotiation_strategies') {
            const compRecord = (await executor('records.get', {
              collection: 'comparisons',
              recordId: comparisonId,
            })) as { data?: Record<string, unknown> } | null

            return {
              success: true,
              comparisonId,
              title: compRecord?.data?.title || comparisonId,
              guidelines: [
                '[SUGGESTION] Counter-offer runner-up vendors with the lowest quoted price benchmark.',
                '[SUGGESTION] Request payment terms tier upgrade (e.g., Net 30 -> Net 45/60) to improve working capital.',
                '[SUGGESTION] Negotiate volume discount rebates if purchase request quantity exceeds baseline threshold.',
                '[SUGGESTION] Inquire about expedited delivery lead time incentives.',
              ],
            }
          }

          return { success: false, error: 'Unknown procurement tool' }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  }

  return tools
}

// ============================================================================
// Convert ToolSchema params → Zod validator + derived provider JSON Schema
// ============================================================================

/**
 * The Zod validator is the single source; the provider-facing JSON Schema is
 * derived from it with Zod's native conversion, which keeps z.record()
 * objects open (`additionalProperties: {}`). The AI SDK's own Zod conversion
 * closes every object, which would incorrectly advertise the free-form
 * `data` and `where` objects as empty — so the conversion happens here.
 */
function buildInputSchema(def: ToolSchema) {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [name, param] of Object.entries(def.params)) {
    let s: z.ZodTypeAny
    switch (param.type) {
      case 'string':
        s = z.string()
        break
      case 'number':
        s = z.number()
        break
      case 'boolean':
        s = z.boolean()
        break
      case 'object':
        s = z.record(z.string(), z.unknown())
        break
      case 'array':
        s = z.array(z.unknown())
        break
    }
    if (param.description) s = s.describe(param.description)
    if (!param.required) s = s.optional()
    shape[name] = s
  }

  const validator = z.object(shape)
  return jsonSchema<Record<string, unknown>>(
    z.toJSONSchema(validator) as Parameters<typeof jsonSchema>[0],
    {
      validate: async (value) => {
        const result = await validator.safeParseAsync(value)
        return result.success
          ? { success: true, value: result.data }
          : { success: false, error: result.error }
      },
    },
  )
}
