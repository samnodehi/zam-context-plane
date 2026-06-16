// ============================================================================
// ZAM Runtime — TypeScript Interfaces
// Canonical source: docs/24_NATIVE_SMART_RUNTIME_SCOPING.md §3–§4
// ============================================================================

import type { EventStream } from './event-stream.js';
import type { CompressorResult } from './history-compressor.js';

// ---------------------------------------------------------------------------
// §8.1 RuntimeConfig
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  zam: {
    endpoint: string;  // 'library' for in-process, or HTTP URL
  };
  provider: {
    name: string;      // 'openrouter' in Phase R2
    model: string;
    apiKeyEnvVar: string;
  };
  workspace: {
    mode: 'local' | 'docker';
    rootPath: string;
  };
  loop: {
    maxTurns: number;
    timeoutMs: number;
  };
  eventStream: {
    persistPath: string;
  };
  registry?: {
    path?: string;
  };
  analyzer?: AnalyzerConfig;
  selector?: SelectorConfig;
  compressor?: CompressorConfig;
}

/**
 * Configuration for the model-assisted Request Analyzer.
 * Phase M1. Canonical: docs/25 §5.4, §6.1.
 *
 * When `enabled` is false (or the analyzer section is absent from config),
 * the analyzer is skipped entirely and the pipeline uses deterministic-only
 * routing — identical to pre-M1 behavior.
 */
export interface AnalyzerConfig {
  /** Whether the analyzer is active. Default: false (opt-in). */
  enabled: boolean;
  /** Provider config for the lightweight analyzer model (Tier 1). */
  provider: {
    name: string;      // e.g. 'openrouter'
    model: string;     // e.g. 'google/gemini-3.1-flash-lite'
    apiKeyEnvVar: string;
  };
  /** Optional stronger model identifier for Tier 2 escalation. */
  tier2Model?: string;
  /** Confidence threshold (0.0–1.0). Below this → escalate to Tier 2. Default: 0.85. */
  confidenceThreshold: number;
  /** Tier 2 confidence threshold (0.0–1.0). Below this → trigger Tier 3 fail-open. Default: 0.60. */
  tier2ConfidenceThreshold: number;
  /** Maximum time (ms) to wait for analyzer response. On timeout → deterministic fallback. Default: 5000. */
  timeoutMs: number;
  /** What to do on analyzer error. Only 'deterministic' is accepted in M1. */
  fallbackOnError: 'deterministic';
}

/**
 * Configuration for the model-assisted Selector (fallback).
 * Phase M2. Canonical: docs/26 §6.2.
 *
 * When `enabled` is false (or the selector section is absent from config),
 * the model-assisted selector is skipped entirely and the pipeline uses
 * deterministic-only selection — identical to pre-M2 behavior.
 */
export interface SelectorConfig {
  /** Whether the model-assisted selector is active. Default: false (opt-in). */
  enabled: boolean;
  /** Provider config for the lightweight selector model. */
  provider: {
    name: string;      // e.g. 'openrouter'
    model: string;     // e.g. 'google/gemini-3.1-flash-lite'
    apiKeyEnvVar: string;
  };
  /** Maximum time (ms) to wait for selector response. On timeout → deterministic fallback. Default: 5000. */
  timeoutMs: number;
  /** What to do on selector error. Only 'deterministic' is accepted in M2. */
  fallbackOnError: 'deterministic';
}

/**
 * Configuration for the model-assisted History Compressor.
 * Phase M3. Canonical: docs/27 §7.3, §8.1.
 *
 * When `enabled` is false (or the compressor section is absent from config),
 * the compressor is skipped entirely and the pipeline uses full raw history
 * — identical to pre-M3 behavior.
 */
export interface CompressorConfig {
  /** Whether the compressor is active. Default: false (opt-in). */
  enabled: boolean;
  /** Provider config for the lightweight compressor model (Tier 1). */
  provider: {
    name: string;      // e.g. 'openrouter'
    model: string;     // e.g. 'google/gemini-3.1-flash-lite'
    apiKeyEnvVar: string;
  };
  /** Optional stronger model identifier for Tier 2 escalation. */
  tier2Model?: string;
  /** Approximate raw history token count above which compression activates. Default: 4000. */
  tokenThreshold: number;
  /** Minimum completed turns before compression can activate. Default: 6. */
  minTurnsBeforeCompression: number;
  /** Number of new turns after last compression before re-compressing. Default: 5. */
  recompressionTurnInterval: number;
  /** Number of most recent raw turns to include alongside the structured summary. Default: 6. */
  rawWindowSize: number;
  /** Confidence threshold (0.0–1.0). Below this → fail-open (use raw history). Default: 0.75. */
  confidenceThreshold: number;
  /** Maximum time (ms) to wait for compressor response. On timeout → raw history fallback. Default: 15000. */
  timeoutMs: number;
  /** What to do on compressor error. Only 'raw_history' is accepted in M3. */
  fallbackOnError: 'raw_history';
}


// ---------------------------------------------------------------------------
// §3.1 TurnLoopEngine + RuntimeResult + UserRequest
// ---------------------------------------------------------------------------

export interface UserRequest {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeResult {
  finalResponse: string;
  turnCount: number;
  exitReason: 'completed' | 'max_turns' | 'no_progress' | 'timeout' | 'error';
  sessionId: string;
}

// ---------------------------------------------------------------------------
// §3.2 Session
// ---------------------------------------------------------------------------

export interface Session {
  sessionId: string;
  turnCounter: number;
  startedAt: string;         // ISO 8601
  eventStream: EventStream;
  config: RuntimeConfig;
  /** Cached compressor result from previous turn for reuse. Phase M3-D. */
  cachedCompressorResult?: CompressorResult | null;
}

// ---------------------------------------------------------------------------
// §4.1 EventStream Entries
// ---------------------------------------------------------------------------

export type EventType =
  | 'user_message'
  | 'zam_plan'
  | 'model_response'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'system_event';

export interface EventStreamEntry {
  entryId: string;          // UUID v4
  sessionId: string;
  turnIndex: number;
  type: EventType;
  timestamp: string;        // ISO 8601 with milliseconds
  content: EventContent;
}

export type EventContent =
  | UserMessageContent
  | ZamPlanContent
  | ModelResponseContent
  | ToolCallContent
  | ToolResultContent
  | ErrorContent
  | SystemEventContent;

// ---------------------------------------------------------------------------
// §4.2 Content Shapes
// ---------------------------------------------------------------------------

export interface UserMessageContent {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ZamPlanContent {
  runId: string;
  promptPlan: object;
  trace: object;
  summary: string;
  isReentry: boolean;
}

export interface ModelResponseContent {
  type: 'text' | 'tool_call';
  text?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  providerName: string;
  model: string;
}

export interface ToolCallContent {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  permissionResult: PermissionResult;
}

export interface ToolResultContent {
  callId: string;
  toolName: string;
  success: boolean;
  output: string;
  rawOutputLength: number;
  truncated: boolean;
  durationMs: number;
  error?: string;
}

export interface ErrorContent {
  errorType: 'provider_error' | 'tool_error' | 'zam_error' | 'permission_denied' | 'config_error' | 'internal_error';
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

export interface SystemEventContent {
  event: 'session_start' | 'session_end' | 'config_loaded' | 'fail_safe_triggered' | 'analyzer_completed' | 'model_selector_completed' | 'compressor_completed';
  details?: Record<string, unknown>;
}

/**
 * Content shape for analyzer_completed system events.
 * Phase M1-D. Canonical: docs/25 §7.2.
 */
export interface AnalyzerEventContent {
  analyzerVersion: string;
  tier: number;
  promptFamily: string;
  analyzerConfidence: number;
  durationMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

/**
 * Content shape for model_selector_completed system events.
 * Phase M2-D. Canonical: docs/26 §8.
 */
export interface SelectorEventContent {
  /** Model name used for the selector call. */
  selectorVersion: string;
  /** How many components were sent to the model. */
  unresolvedCount: number;
  /** How many proposals the model returned. */
  proposalCount: number;
  /** How many proposals differ from the deterministic decision. */
  changedCount: number;
  /** Wall-clock time for the LLM call in milliseconds. */
  durationMs: number;
  /** True if the model call failed and fallback was used. */
  fallbackUsed: boolean;
  /** Reason for fallback (timeout, parse error, etc.). */
  fallbackReason?: string;
}

/**
 * Content shape for compressor_completed system events.
 * Phase M3-D. Canonical: docs/27 §9.3.
 */
export interface CompressorEventContent {
  /** Model name used for the compressor call. */
  compressorVersion: string;
  /** Whether compression was applied. */
  compressed: boolean;
  /** Raw history token count. */
  totalRawTokens: number;
  /** Compressed output token count. */
  compressedTokens: number;
  /** 1 - (compressed / raw). */
  compressionRatio: number;
  /** Number of raw turns retained. */
  rawWindowSize: number;
  /** Model's compression confidence. */
  confidenceScore: number;
  /** Whether fail-open expanded context. */
  failOpenTriggered: boolean;
  /** Wall-clock time for the LLM call in milliseconds. */
  durationMs: number;
  /** True if raw history was used as fallback. */
  fallbackUsed: boolean;
  /** Reason for fallback. */
  fallbackReason?: string;
  /** True if a cached summary was reused. */
  cachedResult: boolean;
  /** Categories unconditionally retained. */
  protectedCategories: string[];
}

// ---------------------------------------------------------------------------
// §3.7 Permission Gate (used in ToolCallContent)
// ---------------------------------------------------------------------------

export interface PermissionResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  approvedBy?: 'auto' | 'user';
}

// ---------------------------------------------------------------------------
// §3.5 Provider Client
// ---------------------------------------------------------------------------

export interface ProviderClient {
  chat(options: ProviderChatOptions): Promise<ProviderResponse>;
}

export interface ProviderChatOptions {
  messages: ProviderMessage[];
  tools?: ProviderToolDefinition[];
  model: string;
  cacheHints?: CacheHint[];
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;  // For tool result messages
  toolCalls?: ToolCall[];  // For assistant messages that invoked tools (history replay)
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CacheHint {
  /** Index in the messages array where this hint applies */
  messageIndex: number;
  stability: 'stable' | 'session' | 'volatile';
}

export interface ProviderResponse {
  type: 'text' | 'tool_call';
  text?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  rawResponse?: unknown;
}

export interface ToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  callId: string;
}

// ---------------------------------------------------------------------------
// §3.4 Prompt Assembler
// ---------------------------------------------------------------------------

export interface AssembledPrompt {
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
  cacheHints: CacheHint[];
}

// ---------------------------------------------------------------------------
// Minimal type for ZAM prompt-plan.json output (§9.3)
// ---------------------------------------------------------------------------

export interface PromptPlan {
  selectedComponents: SelectedComponent[];
  omittedComponents?: unknown[];
  deferredComponents?: unknown[];
  selectedTools?: unknown[];
  riskFlags?: string[];
  failOpenReasons?: string[];
  planningWarnings?: unknown[];
}

export interface SelectedComponent {
  id: string;
  content: string;
  promptFamily?: string;
  cacheStability?: 'stable' | 'session' | 'volatile';
  role?: 'system' | 'user' | 'assistant';
}

// ---------------------------------------------------------------------------
// §3.3 ZAM Plan Request Body (from docs/18 §4.2)
// ---------------------------------------------------------------------------

export interface ZamPlanRequestBody {
  request: { text: string; metadata: Record<string, unknown> };
  registry: object;
  tools?: object;
  skills?: object;
  history?: object;
  budget?: object;
  riskPolicy?: object;
  userConstraints?: object;
  requestSignals?: {
    reentryTurn?: boolean;
    priorPlanId?: string;
    [key: string]: unknown;
  };
  /** Model-assisted analyzer output. Phase M1-D. Canonical: docs/25 §7.1. */
  analyzerOutput?: unknown;
  /** Model-assisted selector outputs for two-pass architecture. Phase M2-D. Canonical: docs/26 §5. */
  modelSelectorOutputs?: unknown[];
}

// ---------------------------------------------------------------------------
// ZAM Library API Response (from docs/18 §7)
// ---------------------------------------------------------------------------

export interface ZamPlanResponse {
  promptPlan: PromptPlan;
  trace: { run: { runId: string }; [key: string]: unknown };
  summary: string;
}

// ---------------------------------------------------------------------------
// ZAM Client Interface
// ---------------------------------------------------------------------------

export interface ZamClient {
  plan(input: ZamPlanRequestBody): Promise<ZamPlanResponse>;
}

// ---------------------------------------------------------------------------
// §3.6 Workspace
// ---------------------------------------------------------------------------

export interface Workspace {
  execute(action: ToolAction): Promise<ToolObservation>;
  getWorkspaceRoot(): string;
  isPathWithinWorkspace(path: string): boolean;
}

export interface ToolAction {
  toolName: string;
  arguments: Record<string, unknown>;
  callId: string;
}

export interface ToolObservation {
  callId: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// §3.7 Permission Gate
// ---------------------------------------------------------------------------

export interface PermissionGate {
  check(action: ToolAction, session: Session): Promise<PermissionResult>;
}

export type PermissionCategory =
  | 'read_only'
  | 'file_write'
  | 'shell_exec'
  | 'destructive'
  | 'network';

// ---------------------------------------------------------------------------
// §3.8 Tool Output Optimizer
// ---------------------------------------------------------------------------

export interface ToolOutputOptimizer {
  optimize(observation: ToolObservation, config?: Partial<OptimizerConfig>): OptimizedOutput;
}

export interface OptimizerConfig {
  maxOutputLines: number;       // default: 100
  maxOutputChars: number;       // default: 10000
  stripAnsiCodes: boolean;      // default: true
  errorExtractionMode: boolean; // default: true
}

export interface OptimizedOutput {
  content: string;
  truncated: boolean;
  originalLines: number;
  originalChars: number;
}

// ---------------------------------------------------------------------------
// §3.9 Subscriber Bus
// ---------------------------------------------------------------------------

export interface SubscriberBus {
  subscribe(handler: EventHandler): void;
  unsubscribe(handler: EventHandler): void;
  publish(event: EventStreamEntry): void;
}

export type EventHandler = (event: EventStreamEntry) => void;

// ---------------------------------------------------------------------------
// §3.9 Built-in Subscriber State Types
// ---------------------------------------------------------------------------

export interface StuckDetectorState {
  /** Advisory flag: true when the detector believes the loop is stuck. */
  isStuck: boolean;
  /** Number of consecutive identical model response hashes observed. */
  consecutiveIdenticalResponses: number;
  /** Number of consecutive tool failures observed. */
  consecutiveToolFailures: number;
  /** Threshold for consecutive identical responses before flagging stuck. */
  identicalResponseThreshold: number;
  /** Threshold for consecutive tool failures before flagging stuck. */
  toolFailureThreshold: number;
}

export interface CostTrackerState {
  /** Cumulative input tokens across all turns. */
  totalInputTokens: number;
  /** Cumulative output tokens across all turns. */
  totalOutputTokens: number;
  /** Total turns observed. */
  totalTurns: number;
  /** Optional budget limit (total tokens). */
  budgetLimitTokens?: number;
  /** True if budget limit has been exceeded. */
  budgetExceeded: boolean;
}
