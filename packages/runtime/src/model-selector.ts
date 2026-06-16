// ============================================================================
// ZAM Runtime — Model-Assisted Selector
// Canonical source: docs/26_MODEL_ASSISTED_SELECTOR_IMPLEMENTATION.md §4.5, §4.6
// Phase M2-C: LLM call, JSON parsing, and fail-open error handling.
// ============================================================================

import type { ProviderClient, SelectorConfig } from './types.js';
import { buildSelectorPrompt, type SelectorPromptData } from './selector-prompt.js';

/**
 * ProposalDecision — canonical definition lives in @zam/types (single source
 * shared with core; DEBT.md C3 / docs/32). Imported as a type (fully erased at
 * emit) and re-exported to preserve this module's export surface.
 * Canonical: docs/19 §8; docs/26 §4.5.
 */
import type { ProposalDecision } from '@zam/types';
export type { ProposalDecision };

/**
 * Result of executing the model-assisted selector.
 */
export interface ModelSelectorResult {
  /** Parsed proposals from the model. Empty array signals fail-open / no change. */
  proposals: ProposalDecision[];
  /** True if the model call was skipped or failed and deterministic fallback is in effect. */
  fallbackUsed: boolean;
  /** Reason for fallback, if applicable. */
  fallbackReason?: string;
  /** Wall-clock duration of the LLM call in milliseconds. 0 if selector was disabled. */
  durationMs: number;
}

/**
 * Guard: checks that a parsed value is a non-null object with the required
 * ProposalDecision fields. Does not enforce enum values — that is the
 * integrator's responsibility.
 */
function isValidProposalDecision(v: unknown): v is ProposalDecision {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return (
    typeof rec['componentId'] === 'string' &&
    typeof rec['action'] === 'string' &&
    typeof rec['confidence'] === 'string' &&
    typeof rec['reason'] === 'string' &&
    Array.isArray(rec['evidence']) &&
    typeof rec['path'] === 'string'
  );
}

/**
 * Parse the raw LLM text response into an array of ProposalDecision objects.
 * Returns null on any parse or validation error (caller handles fail-open).
 */
function parseProposals(text: string): ProposalDecision[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  for (const item of parsed) {
    if (!isValidProposalDecision(item)) return null;
  }

  return parsed as ProposalDecision[];
}

/**
 * Execute the model-assisted selector for the current turn.
 *
 * Implements the fail-open safety contract from docs/26 §4.6:
 * - If selector is disabled → return empty proposals immediately.
 * - If the LLM call errors, times out, or returns malformed JSON → return empty proposals.
 * - No crash in any failure mode.
 *
 * @param client   The ProviderClient to use for the LLM call.
 * @param config   The SelectorConfig (must have enabled=true to proceed).
 * @param data     The SelectorPromptData assembled by the turn-loop.
 * @returns        A ModelSelectorResult with proposals and fallback metadata.
 */
export async function executeModelAssistedSelector(
  client: ProviderClient,
  config: SelectorConfig,
  data: SelectorPromptData,
): Promise<ModelSelectorResult> {
  // Fast path: selector disabled
  if (!config.enabled) {
    return {
      proposals: [],
      fallbackUsed: false,
      durationMs: 0,
    };
  }

  const prompt = buildSelectorPrompt(data);
  const startMs = Date.now();

  let rawText: string;
  try {
    // Wrap the chat call in a timeout race
    const chatPromise = client.chat({
      messages: [{ role: 'user', content: prompt }],
      model: config.provider.model,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Model-assisted selector timed out after ${config.timeoutMs}ms`)),
        config.timeoutMs,
      ),
    );

    const response = await Promise.race([chatPromise, timeoutPromise]);
    rawText = response.text ?? '';
  } catch (err) {
    const durationMs = Date.now() - startMs;
    return {
      proposals: [],
      fallbackUsed: true,
      fallbackReason: err instanceof Error ? err.message : String(err),
      durationMs,
    };
  }

  const durationMs = Date.now() - startMs;

  // Parse and validate the JSON response
  const proposals = parseProposals(rawText);
  if (proposals === null) {
    return {
      proposals: [],
      fallbackUsed: true,
      fallbackReason: 'Model response was not a valid JSON array of ProposalDecision objects.',
      durationMs,
    };
  }

  return {
    proposals,
    fallbackUsed: false,
    durationMs,
  };
}
