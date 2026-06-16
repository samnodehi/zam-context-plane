// ============================================================================
// Tests — Cost Tracker
// Phase R5
// ============================================================================

import { describe, it, expect } from 'vitest';
import { createCostTracker } from '../src/cost-tracker.js';
import type { EventStreamEntry, ModelResponseContent } from '../src/types.js';

function makeModelResponseEvent(
  inputTokens: number,
  outputTokens: number,
): EventStreamEntry {
  return {
    entryId: 'entry-1',
    sessionId: 'sess-1',
    turnIndex: 0,
    type: 'model_response',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: {
      type: 'text',
      text: 'response',
      providerName: 'openrouter',
      model: 'test-model',
      usage: { inputTokens, outputTokens },
    } satisfies ModelResponseContent,
  };
}

describe('CostTracker', () => {
  it('starts with zero tokens and turns', () => {
    const { getState } = createCostTracker();
    const state = getState();
    expect(state.totalInputTokens).toBe(0);
    expect(state.totalOutputTokens).toBe(0);
    expect(state.totalTurns).toBe(0);
    expect(state.budgetExceeded).toBe(false);
  });

  it('accumulates token usage across turns', () => {
    const { handler, getState } = createCostTracker();

    handler(makeModelResponseEvent(100, 50));
    handler(makeModelResponseEvent(200, 75));

    const state = getState();
    expect(state.totalInputTokens).toBe(300);
    expect(state.totalOutputTokens).toBe(125);
    expect(state.totalTurns).toBe(2);
  });

  it('flags budget exceeded when limit is reached', () => {
    const { handler, getState } = createCostTracker(500);

    handler(makeModelResponseEvent(200, 100));
    expect(getState().budgetExceeded).toBe(false);

    handler(makeModelResponseEvent(150, 100));
    // Total = 200+150+100+100 = 550 > 500
    expect(getState().budgetExceeded).toBe(true);
  });

  it('does not flag budget exceeded without a limit', () => {
    const { handler, getState } = createCostTracker();

    handler(makeModelResponseEvent(10000, 5000));
    expect(getState().budgetExceeded).toBe(false);
    expect(getState().budgetLimitTokens).toBeUndefined();
  });

  it('handles model responses without usage gracefully', () => {
    const { handler, getState } = createCostTracker();

    const eventNoUsage: EventStreamEntry = {
      entryId: 'entry-2',
      sessionId: 'sess-1',
      turnIndex: 0,
      type: 'model_response',
      timestamp: '2026-01-01T00:00:00.000Z',
      content: {
        type: 'text',
        text: 'response',
        providerName: 'openrouter',
        model: 'test-model',
      } satisfies ModelResponseContent,
    };

    handler(eventNoUsage);

    const state = getState();
    expect(state.totalInputTokens).toBe(0);
    expect(state.totalOutputTokens).toBe(0);
    expect(state.totalTurns).toBe(1); // Turn is still counted
  });

  it('ignores non-model_response events', () => {
    const { handler, getState } = createCostTracker();

    handler({
      entryId: 'e1',
      sessionId: 's1',
      turnIndex: 0,
      type: 'user_message',
      timestamp: '2026-01-01T00:00:00.000Z',
      content: { text: 'hello' },
    });

    expect(getState().totalTurns).toBe(0);
    expect(getState().totalInputTokens).toBe(0);
  });

  it('returns a snapshot from getState', () => {
    const { handler, getState } = createCostTracker();
    const state1 = getState();
    handler(makeModelResponseEvent(100, 50));
    const state2 = getState();

    expect(state1.totalInputTokens).toBe(0);
    expect(state2.totalInputTokens).toBe(100);
  });

  it('flags budget exactly at the limit', () => {
    const { handler, getState } = createCostTracker(200);

    handler(makeModelResponseEvent(100, 100));
    // Total = 200 === 200 (>=)
    expect(getState().budgetExceeded).toBe(true);
  });
});
