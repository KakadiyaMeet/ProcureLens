/**
 * ProcureLens — AI Procurement Analyst Type Definitions
 */

import type {
  AnalystServiceContext,
  AnalystAnalysisResult,
  IdentifiedRisk,
} from '@/services/procurement-analyst.service'

export type {
  AnalystServiceContext,
  AnalystAnalysisResult,
  IdentifiedRisk,
}

export type AnalystTaskType =
  | 'analyze_comparison'
  | 'explain_rankings'
  | 'identify_risks'
  | 'missing_info'
  | 'negotiation_strategies'
  | 'qa'
  | 'executive_summary'

export type EpistemicMarker = 'FACT' | 'SUGGESTION' | 'RISK'

export interface AnalystMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  taskType?: AnalystTaskType
  isFallback?: boolean
}

export interface PromptPreset {
  id: string
  label: string
  icon: string
  taskType: AnalystTaskType
  prompt: string
  description: string
}
