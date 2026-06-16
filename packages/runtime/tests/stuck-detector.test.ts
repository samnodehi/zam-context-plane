// ============================================================================
// Tests — Stuck Detector
// Phase R5
// ============================================================================

import { describe, it, expect } from 'vitest';
import { createStuckDetector } from '../src/stuck-detector.js';
import type { EventStreamEntry, ModelResponseContent, ToolResultContent } from '../src/types.js';

function makeModelResponseEvent(
  text: string,
  overrides?: Partial<ModelResponseContent>,
): EventStreamEntry {
  return {
    entryId: 'entry-1',
    sessionId: 'sess-1',
    turnIndex: 0,
    type: 'model_response',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: {
      type: 'text',
      text,
      providerName: 'openrouter',
      model: 'test-model',
      ...overrides,
    } satisfies ModelResponseContent,
  };
}

function makeToolResultEvent(
  success: boolean,
  toolName: string = 'read_file',
): EventStreamEntry {
  return {
    entryId: 'entry-2',
    sessionId: 'sess-1',
    turnIndex: 0,
    type: 'tool_result',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: {
      callId: 'call-1',
      toolName,
      success,
      output: success ? 'file contents' : '',
      rawOutputLength: 100,
      truncated: false,
      durationMs: 50,
      error: success ? undefined : 'File not found',
    } satisfies ToolResultContent,
  };
}

describe('StuckDetector', () => {
  it('starts in non-stuck state', () => {
    const { getState } = createStuckDetector();
    const state = getState();
    expect(state.isStuck).toBe(false);
    expect(state.consecutiveIdenticalResponses).toBe(0);
    expect(state.consecutiveToolFailures).toBe(0);
  });

  it('flags stuck after consecutive identical model responses', () => {
    const { handler, getState } = createStuckDetector({
      identicalResponseThreshold: 2,
    });

    const event = makeModelResponseEvent('same text');

    // First occurrence — sets the baseline
    handler(event);
    expect(getState().isStuck).toBe(false);

    // Second identical — counter=1, not yet stuck
    handler(event);
    expect(getState().consecutiveIdenticalResponses).toBe(1);
    expect(getState().isStuck).toBe(false);

    // Third identical — counter=2, threshold met
    handler(event);
    expect(getState().consecutiveIdenticalResponses).toBe(2);
    expect(getState().isStuck).toBe(true);
  });

  it('resets identical response counter on different response', () => {
    const { handler, getState } = createStuckDetector({
      identicalResponseThreshold: 3,
    });

    handler(makeModelResponseEvent('response A'));
    handler(makeModelResponseEvent('response A'));
    expect(getState().consecutiveIdenticalResponses).toBe(1);

    // Different response resets counter
    handler(makeModelResponseEvent('response B'));
    expect(getState().consecutiveIdenticalResponses).toBe(0);
    expect(getState().isStuck).toBe(false);
  });

  it('flags stuck after consecutive tool failures', () => {
    const { handler, getState } = createStuckDetector({
      toolFailureThreshold: 3,
    });

    handler(makeToolResultEvent(false));
    handler(makeToolResultEvent(false));
    expect(getState().isStuck).toBe(false);

    handler(makeToolResultEvent(false));
    expect(getState().consecutiveToolFailures).toBe(3);
    expect(getState().isStuck).toBe(true);
  });

  it('resets tool failure counter on successful tool result', () => {
    const { handler, getState } = createStuckDetector({
      toolFailureThreshold: 5,
    });

    handler(makeToolResultEvent(false));
    handler(makeToolResultEvent(false));
    expect(getState().consecutiveToolFailures).toBe(2);

    // Success resets
    handler(makeToolResultEvent(true));
    expect(getState().consecutiveToolFailures).toBe(0);
    expect(getState().isStuck).toBe(false);
  });

  it('uses default thresholds', () => {
    const { getState } = createStuckDetector();
    const state = getState();
    expect(state.identicalResponseThreshold).toBe(3);
    expect(state.toolFailureThreshold).toBe(5);
  });

  it('returns a snapshot (not a reference) from getState', () => {
    const { handler, getState } = createStuckDetector();
    const state1 = getState();
    handler(makeToolResultEvent(false));
    const state2 = getState();

    // state1 should not be modified
    expect(state1.consecutiveToolFailures).toBe(0);
    expect(state2.consecutiveToolFailures).toBe(1);
  });

  it('ignores irrelevant event types', () => {
    const { handler, getState } = createStuckDetector();
    handler({
      entryId: 'e1',
      sessionId: 's1',
      turnIndex: 0,
      type: 'user_message',
      timestamp: '2026-01-01T00:00:00.000Z',
      content: { text: 'hello' },
    });
    expect(getState().consecutiveIdenticalResponses).toBe(0);
    expect(getState().consecutiveToolFailures).toBe(0);
  });
});
