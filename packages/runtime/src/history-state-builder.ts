// ============================================================================
// ZAM Runtime — History State Builder
// Canonical source: docs/24 §3.3, §4.3
// Phase R3: Handles user_message, model_response (text), tool_call,
//           tool_result, and tool-related error mapping.
// ============================================================================

import type { EventStream } from './event-stream.js';
import type {
  UserRequest,
  RuntimeConfig,
  ZamPlanRequestBody,
  EventStreamEntry,
} from './types.js';
import type { CompressorResult } from './history-compressor.js';
import type { AnalyzerOutput } from './request-analyzer.js';

/**
 * Build a ZAM POST /plan request body from the current EventStream state.
 *
 * Per docs/24 §3.3 and §4.3:
 * - user_message → role:'user' in recent_raw_turns
 * - model_response(text) → role:'assistant' in recent_raw_turns
 * - tool_call → role:'assistant' in open_commitments (dropAllowed: false)
 * - tool_result → role:'tool' in open_commitments (dropAllowed: false)
 * - error (tool_error, permission_denied) → role:'tool' in open_commitments
 * - Sets reentryTurn and priorPlanId on re-entry turns
 */
export function buildZamInput(
  eventStream: EventStream,
  request: UserRequest,
  registry: object,
  config: RuntimeConfig,
  compressorResult?: CompressorResult | null,
  analyzerOutput?: AnalyzerOutput | null,
): ZamPlanRequestBody {
  const entries = eventStream.read();

  // Build open_commitments from tool_call, tool_result, and tool-related errors.
  // Per docs/27 §9.2: open_commitments are ALWAYS built from all raw entries
  // (dropAllowed: false — they must never be compressed out).
  const openCommitments = buildOpenCommitments(entries);

  // Build recent_raw_turns:
  // - When compression is active: use only the rawTurnWindow entries.
  // - Otherwise: use all entries (existing behavior).
  let recentRawTurns: HistoryTurn[];
  if (compressorResult?.compressed && compressorResult.output) {
    recentRawTurns = buildRecentRawTurns(compressorResult.rawTurnWindow);
  } else {
    recentRawTurns = buildRecentRawTurns(entries);
  }

  // Determine re-entry signals
  const isReentry = hasCompletedTurns(entries);
  const priorPlanId = getLatestPlanRunId(entries);

  // Construct the history object for ZAM
  const history: Record<string, unknown> = {};

  // Per docs/27 §9.2: when compression is active, include structured_summary
  if (compressorResult?.compressed && compressorResult.output) {
    history.structured_summary = JSON.stringify(compressorResult.output);
  }

  if (recentRawTurns.length > 0) {
    history.recent_raw_turns = recentRawTurns;
  }
  if (openCommitments.length > 0) {
    history.open_commitments = openCommitments;
  }

  // Extract active capability IDs from the registry so ZAM Core knows which
  // tools, skills, and memory components are active in this runtime session.
  // registry is typed as `object` to avoid coupling to ZAM Core internals;
  // at runtime it is an array of component objects (each with `id` and `type`).
  // Canonical: docs/25 §7.1 (requestSignals.activeToolIds et al.).
  const registryArray = Array.isArray(registry) ? registry : [];
  const activeToolIds: string[] = [];
  const activeSkillIds: string[] = [];
  const activeMemoryIds: string[] = [];
  for (const comp of registryArray) {
    if (comp !== null && typeof comp === 'object') {
      const c = comp as Record<string, unknown>;
      if (typeof c['id'] === 'string') {
        if (c['type'] === 'tool') {
          activeToolIds.push(c['id']);
        } else if (c['type'] === 'skill') {
          activeSkillIds.push(c['id']);
        } else if (c['type'] === 'memory') {
          activeMemoryIds.push(c['id']);
        }
      }
    }
  }

  // Build request signals — always produce a fully formed object so that
  // providing it to CorePlanInput bypasses the Phase 3 stub with correct values.
  // When analyzerOutput is available, use its promptFamily/analyzerConfidence;
  // otherwise fall back to the Phase 3 defaults (general_default / 0.0).
  // Canonical: docs/25 §7.1; src/core/request-normalizer.ts Phase 3 bypass path.
  const requestSignals: Record<string, unknown> = {
    promptFamily: analyzerOutput?.promptFamily ?? 'general_default',
    familyConfidence: analyzerOutput?.analyzerConfidence ?? 0.0,
    injectionSuspect: false,
    activeSkillIds,
    activeToolIds,
    activeMemoryIds,
  };
  if (isReentry) {
    requestSignals.reentryTurn = true;
    if (priorPlanId) {
      requestSignals.priorPlanId = priorPlanId;
    }
  }

  return {
    request: {
      text: request.text,
      metadata: request.metadata ?? {},
    },
    registry,
    history: Object.keys(history).length > 0 ? history : undefined,
    requestSignals,
    analyzerOutput: analyzerOutput ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface HistoryTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  dropAllowed?: boolean;
  toolCallId?: string;
  toolName?: string;
}

/**
 * Extract user_message and model_response (text) entries into history turns.
 * Per docs/24 §4.3:
 * - user_message → role: 'user' in recent_raw_turns
 * - model_response (text) → role: 'assistant' in recent_raw_turns
 */
function buildRecentRawTurns(entries: EventStreamEntry[]): HistoryTurn[] {
  const turns: HistoryTurn[] = [];

  for (const entry of entries) {
    if (entry.type === 'user_message') {
      const content = entry.content as { text: string };
      turns.push({ role: 'user', content: content.text });
    } else if (entry.type === 'model_response') {
      const content = entry.content as { type: string; text?: string };
      if (content.type === 'text' && content.text) {
        turns.push({ role: 'assistant', content: content.text });
      }
    }
  }

  return turns;
}

/**
 * Build open_commitments lane from tool_call, tool_result, and tool-related
 * error EventStream entries.
 *
 * Per docs/24 §4.3:
 * - tool_call → role:'assistant' in open_commitments, dropAllowed:false
 * - tool_result → role:'tool' in open_commitments, dropAllowed:false
 * - error (tool_error, permission_denied) → role:'tool' in open_commitments
 *
 * Critical: dropAllowed: false ensures ZAM's budgeter does not trim these.
 */
function buildOpenCommitments(entries: EventStreamEntry[]): HistoryTurn[] {
  const commitments: HistoryTurn[] = [];

  for (const entry of entries) {
    if (entry.type === 'tool_call') {
      const content = entry.content as {
        callId: string;
        toolName: string;
        arguments: Record<string, unknown>;
      };
      // Tool call request from the assistant
      commitments.push({
        role: 'assistant',
        content: JSON.stringify({
          toolName: content.toolName,
          arguments: content.arguments,
        }),
        dropAllowed: false,
        toolCallId: content.callId,
        toolName: content.toolName,
      });
    } else if (entry.type === 'tool_result') {
      const content = entry.content as {
        callId: string;
        toolName: string;
        success: boolean;
        output: string;
        error?: string;
      };
      // Tool execution result
      const resultContent = content.success
        ? content.output
        : `Error: ${content.error ?? 'Tool execution failed'}`;
      commitments.push({
        role: 'tool',
        content: resultContent,
        dropAllowed: false,
        toolCallId: content.callId,
        toolName: content.toolName,
      });
    } else if (entry.type === 'error') {
      const content = entry.content as {
        errorType: string;
        message: string;
      };
      // Only include tool-related errors in open_commitments
      if (content.errorType === 'tool_error' || content.errorType === 'permission_denied') {
        commitments.push({
          role: 'tool',
          content: `[${content.errorType}] ${content.message}`,
          dropAllowed: false,
        });
      }
    }
  }

  return commitments;
}

/**
 * Check if there have been any completed turns (i.e., a model_response exists).
 * If so, the next ZAM call should be marked as a re-entry.
 */
function hasCompletedTurns(entries: EventStreamEntry[]): boolean {
  return entries.some((e) => e.type === 'model_response');
}

/**
 * Get the runId from the most recent zam_plan entry.
 * Per docs/24 §4.3 and docs/20 §4.3.
 */
function getLatestPlanRunId(entries: EventStreamEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'zam_plan') {
      const content = entries[i].content as { runId: string };
      return content.runId;
    }
  }
  return undefined;
}
