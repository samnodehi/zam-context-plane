// ============================================================================
// ZAM Runtime — Stuck Detector
// Canonical source: docs/24 §3.9 (Built-in Subscribers table)
// Phase R5: Detects no-progress loops via identical responses or repeated
//           tool failures. Sets an advisory flag for the Turn Loop Engine.
// ============================================================================

import { createHash } from 'node:crypto';
import type {
  EventHandler,
  EventStreamEntry,
  StuckDetectorState,
  ModelResponseContent,
  ToolResultContent,
} from './types.js';

/** Default thresholds before the detector flags "stuck". */
const DEFAULT_IDENTICAL_RESPONSE_THRESHOLD = 3;
const DEFAULT_TOOL_FAILURE_THRESHOLD = 5;

/**
 * Create a StuckDetector subscriber.
 *
 * Per docs/24 §3.9:
 * - Detect no-progress loops (identical responses, repeated tool failures).
 * - Set an advisory flag that the Turn Loop Engine checks during no-progress evaluation.
 * - The detector is a read-only observer; it does not modify events or block the loop.
 */
export function createStuckDetector(options?: {
  identicalResponseThreshold?: number;
  toolFailureThreshold?: number;
}): { handler: EventHandler; getState: () => StuckDetectorState } {
  const state: StuckDetectorState = {
    isStuck: false,
    consecutiveIdenticalResponses: 0,
    consecutiveToolFailures: 0,
    identicalResponseThreshold:
      options?.identicalResponseThreshold ?? DEFAULT_IDENTICAL_RESPONSE_THRESHOLD,
    toolFailureThreshold:
      options?.toolFailureThreshold ?? DEFAULT_TOOL_FAILURE_THRESHOLD,
  };

  let lastResponseHash: string | null = null;

  const handler: EventHandler = (event: EventStreamEntry) => {
    if (event.type === 'model_response') {
      const content = event.content as ModelResponseContent;
      const hash = hashContent(content);

      if (hash === lastResponseHash) {
        state.consecutiveIdenticalResponses++;
      } else {
        state.consecutiveIdenticalResponses = 0;
        lastResponseHash = hash;
      }

      // Check identical response threshold
      if (state.consecutiveIdenticalResponses >= state.identicalResponseThreshold) {
        state.isStuck = true;
      }
    }

    if (event.type === 'tool_result') {
      const content = event.content as ToolResultContent;
      if (!content.success) {
        state.consecutiveToolFailures++;
      } else {
        // Successful tool execution resets the failure counter
        state.consecutiveToolFailures = 0;
      }

      // Check tool failure threshold
      if (state.consecutiveToolFailures >= state.toolFailureThreshold) {
        state.isStuck = true;
      }
    }

    // A successful text completion resets stuck state
    if (event.type === 'model_response') {
      const content = event.content as ModelResponseContent;
      if (content.type === 'text' && state.consecutiveIdenticalResponses === 0) {
        state.isStuck = false;
        state.consecutiveToolFailures = 0;
      }
    }
  };

  return { handler, getState: () => ({ ...state }) };
}

function hashContent(content: unknown): string {
  const json = JSON.stringify(content);
  return createHash('sha256').update(json).digest('hex');
}
