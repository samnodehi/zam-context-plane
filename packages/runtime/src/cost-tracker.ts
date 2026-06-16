// ============================================================================
// ZAM Runtime — Cost Tracker
// Canonical source: docs/24 §3.9 (Built-in Subscribers table)
// Phase R5: Tracks cumulative token usage and warns on budget limits.
// ============================================================================

import type {
  EventHandler,
  EventStreamEntry,
  CostTrackerState,
  ModelResponseContent,
} from './types.js';

/**
 * Create a CostTracker subscriber.
 *
 * Per docs/24 §3.9:
 * - Track cumulative token usage and estimated cost across turns.
 * - Emit warning if approaching budget limits.
 * - Read-only observer; does not modify events or block the loop.
 *
 * @param budgetLimitTokens Optional total token limit. When exceeded, budgetExceeded is set.
 */
export function createCostTracker(budgetLimitTokens?: number): {
  handler: EventHandler;
  getState: () => CostTrackerState;
} {
  const state: CostTrackerState = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTurns: 0,
    budgetLimitTokens,
    budgetExceeded: false,
  };

  const handler: EventHandler = (event: EventStreamEntry) => {
    if (event.type === 'model_response') {
      const content = event.content as ModelResponseContent;
      state.totalTurns++;

      if (content.usage) {
        state.totalInputTokens += content.usage.inputTokens;
        state.totalOutputTokens += content.usage.outputTokens;
      }

      // Check budget
      if (state.budgetLimitTokens !== undefined) {
        const totalTokens = state.totalInputTokens + state.totalOutputTokens;
        if (totalTokens >= state.budgetLimitTokens) {
          state.budgetExceeded = true;
        }
      }
    }
  };

  return { handler, getState: () => ({ ...state }) };
}
