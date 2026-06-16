// ============================================================================
// Tests — Compressor Prompt Templates + History Formatter
// Phase M3-B. Canonical source: docs/27 §8.4, §8.5.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  COMPRESSOR_PROMPT_TEMPLATE,
  buildCompressorPrompt,
  formatHistory,
} from '../src/compressor-prompt.js';
import type { EventStreamEntry } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers — mock EventStreamEntry factories
// ---------------------------------------------------------------------------

function makeEntry(
  overrides: Partial<EventStreamEntry> & { type: EventStreamEntry['type']; content: EventStreamEntry['content'] },
): EventStreamEntry {
  return {
    entryId: 'entry-' + Math.random().toString(36).slice(2, 8),
    sessionId: 'session-test',
    turnIndex: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — COMPRESSOR_PROMPT_TEMPLATE
// ---------------------------------------------------------------------------

describe('COMPRESSOR_PROMPT_TEMPLATE', () => {
  it('should contain the {formattedHistory} placeholder', () => {
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('{formattedHistory}');
  });

  it('should contain the {rawWindowSize} placeholder', () => {
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('{rawWindowSize}');
  });

  it('should contain the {actualTurnCount} placeholder', () => {
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('{actualTurnCount}');
  });

  it('should contain all 11 state extraction categories', () => {
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('currentTaskState');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('acceptedDecisions');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('openIssues');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('openCommitments');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('userConstraints');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('importantFilesPaths');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('failedAttempts');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('activeWarnings');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('antiRegressionRules');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('durableFacts');
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('recentRawTurnWindow');
  });

  it('should contain protected category extraction instructions', () => {
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('PROTECTED CATEGORIES must be extracted completely');
  });

  it('should contain the fail-open instruction', () => {
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('When uncertain whether an item should be included, INCLUDE IT');
  });

  it('should contain the semantic preservation rule', () => {
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('"Do NOT use React" must not become "Use React"');
  });

  it('should instruct JSON-only output', () => {
    expect(COMPRESSOR_PROMPT_TEMPLATE).toContain('Respond with ONLY the JSON object. No explanation, no markdown fences.');
  });
});

// ---------------------------------------------------------------------------
// Tests — buildCompressorPrompt
// ---------------------------------------------------------------------------

describe('buildCompressorPrompt', () => {
  it('should interpolate {formattedHistory} into the prompt', () => {
    const result = buildCompressorPrompt('TEST_HISTORY_CONTENT', 6, 10);
    expect(result).toContain('TEST_HISTORY_CONTENT');
    expect(result).not.toContain('{formattedHistory}');
  });

  it('should interpolate {rawWindowSize} into the prompt', () => {
    const result = buildCompressorPrompt('history', 8, 10);
    expect(result).toContain('"windowSize": 8');
    expect(result).not.toContain('{rawWindowSize}');
  });

  it('should interpolate {actualTurnCount} into the prompt', () => {
    const result = buildCompressorPrompt('history', 6, 15);
    expect(result).toContain('"turnCount": 15');
    expect(result).not.toContain('{actualTurnCount}');
  });

  it('should interpolate all three variables simultaneously', () => {
    const result = buildCompressorPrompt('[Turn 1] User: hello', 4, 7);
    expect(result).toContain('[Turn 1] User: hello');
    expect(result).toContain('"windowSize": 4');
    expect(result).toContain('"turnCount": 7');
    // No placeholders remain
    expect(result).not.toContain('{formattedHistory}');
    expect(result).not.toContain('{rawWindowSize}');
    expect(result).not.toContain('{actualTurnCount}');
  });

  it('should handle empty history string', () => {
    const result = buildCompressorPrompt('', 6, 0);
    expect(result).toContain('## Session History\n');
    expect(result).not.toContain('{formattedHistory}');
  });
});

// ---------------------------------------------------------------------------
// Tests — formatHistory
// ---------------------------------------------------------------------------

describe('formatHistory', () => {
  it('should format user_message entries', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'user_message',
        turnIndex: 0,
        content: { text: 'Hello world' },
      }),
    ];

    const result = formatHistory(entries);
    expect(result).toBe('[Turn 1] User: Hello world');
  });

  it('should format model_response text entries', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'model_response',
        turnIndex: 0,
        content: {
          type: 'text',
          text: 'The answer is 42.',
          providerName: 'openrouter',
          model: 'test-model',
        },
      }),
    ];

    const result = formatHistory(entries);
    expect(result).toBe('[Turn 1] Assistant: The answer is 42.');
  });

  it('should format tool_call entries with arguments', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'tool_call',
        turnIndex: 0,
        content: {
          callId: 'tc-1',
          toolName: 'read_file',
          arguments: { path: '/src/main.ts' },
          permissionResult: {
            allowed: true,
            reason: 'Auto-approved',
            requiresApproval: false,
          },
        },
      }),
    ];

    const result = formatHistory(entries);
    expect(result).toBe('[Turn 1] Tool Call: read_file({"path":"/src/main.ts"})');
  });

  it('should format tool_result entries', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'tool_result',
        turnIndex: 0,
        content: {
          callId: 'tc-1',
          toolName: 'read_file',
          success: true,
          output: 'file contents here',
          rawOutputLength: 18,
          truncated: false,
          durationMs: 5,
        },
      }),
    ];

    const result = formatHistory(entries);
    expect(result).toBe('[Turn 1] Tool Result: file contents here');
  });

  it('should exclude system_event entries', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'user_message',
        turnIndex: 0,
        content: { text: 'Hello' },
      }),
      makeEntry({
        type: 'system_event',
        turnIndex: 0,
        content: {
          event: 'analyzer_completed',
          details: { tier: 0 },
        },
      }),
    ];

    const result = formatHistory(entries);
    expect(result).toBe('[Turn 1] User: Hello');
    expect(result).not.toContain('analyzer_completed');
    expect(result).not.toContain('system_event');
  });

  it('should exclude zam_plan entries', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'user_message',
        turnIndex: 0,
        content: { text: 'Hello' },
      }),
      makeEntry({
        type: 'zam_plan',
        turnIndex: 0,
        content: {
          runId: 'run-1',
          promptPlan: {},
          trace: {},
          summary: 'test plan',
          isReentry: false,
        },
      }),
    ];

    const result = formatHistory(entries);
    expect(result).toBe('[Turn 1] User: Hello');
    expect(result).not.toContain('zam_plan');
    expect(result).not.toContain('test plan');
  });

  it('should exclude error entries', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'user_message',
        turnIndex: 0,
        content: { text: 'Hello' },
      }),
      makeEntry({
        type: 'error',
        turnIndex: 0,
        content: {
          errorType: 'provider_error',
          message: 'Rate limited',
          recoverable: true,
        },
      }),
    ];

    const result = formatHistory(entries);
    expect(result).toBe('[Turn 1] User: Hello');
    expect(result).not.toContain('Rate limited');
    expect(result).not.toContain('error');
  });

  it('should exclude model_response entries of type tool_call', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'model_response',
        turnIndex: 0,
        content: {
          type: 'tool_call',
          toolCalls: [
            { toolName: 'read_file', arguments: { path: 'a.txt' }, callId: 'tc-1' },
          ],
          providerName: 'openrouter',
          model: 'test-model',
        },
      }),
    ];

    // model_response with type='tool_call' should not produce an Assistant: line
    const result = formatHistory(entries);
    expect(result).toBe('');
  });

  it('should handle multi-turn conversation with correct turn numbers', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'user_message',
        turnIndex: 0,
        content: { text: 'Read the file' },
      }),
      makeEntry({
        type: 'tool_call',
        turnIndex: 0,
        content: {
          callId: 'tc-1',
          toolName: 'read_file',
          arguments: { path: 'src/main.ts' },
          permissionResult: {
            allowed: true,
            reason: 'Auto-approved',
            requiresApproval: false,
          },
        },
      }),
      makeEntry({
        type: 'tool_result',
        turnIndex: 0,
        content: {
          callId: 'tc-1',
          toolName: 'read_file',
          success: true,
          output: 'console.log("hello")',
          rawOutputLength: 20,
          truncated: false,
          durationMs: 5,
        },
      }),
      makeEntry({
        type: 'model_response',
        turnIndex: 1,
        content: {
          type: 'text',
          text: 'The file contains a hello world program.',
          providerName: 'openrouter',
          model: 'test-model',
        },
      }),
      makeEntry({
        type: 'user_message',
        turnIndex: 2,
        content: { text: 'Now fix the bug' },
      }),
    ];

    const result = formatHistory(entries);
    const lines = result.split('\n');
    expect(lines).toEqual([
      '[Turn 1] User: Read the file',
      '[Turn 1] Tool Call: read_file({"path":"src/main.ts"})',
      '[Turn 1] Tool Result: console.log("hello")',
      '[Turn 2] Assistant: The file contains a hello world program.',
      '[Turn 3] User: Now fix the bug',
    ]);
  });

  it('should return empty string for empty entries', () => {
    const result = formatHistory([]);
    expect(result).toBe('');
  });

  it('should return empty string when all entries are excluded types', () => {
    const entries: EventStreamEntry[] = [
      makeEntry({
        type: 'system_event',
        turnIndex: 0,
        content: { event: 'session_start' },
      }),
      makeEntry({
        type: 'zam_plan',
        turnIndex: 0,
        content: {
          runId: 'run-1',
          promptPlan: {},
          trace: {},
          summary: 'plan',
          isReentry: false,
        },
      }),
      makeEntry({
        type: 'error',
        turnIndex: 0,
        content: {
          errorType: 'internal_error',
          message: 'oops',
          recoverable: false,
        },
      }),
    ];

    const result = formatHistory(entries);
    expect(result).toBe('');
  });
});
