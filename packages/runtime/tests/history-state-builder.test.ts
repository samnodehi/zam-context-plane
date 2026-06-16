// ============================================================================
// Tests — History State Builder
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildZamInput } from '../src/history-state-builder.js';
import { EventStream } from '../src/event-stream.js';
import type { RuntimeConfig } from '../src/types.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

function makeConfig(): RuntimeConfig {
  return {
    zam: { endpoint: 'library' },
    provider: { name: 'openrouter', model: 'test-model', apiKeyEnvVar: 'TEST_KEY' },
    workspace: { mode: 'local', rootPath: './' },
    loop: { maxTurns: 10, timeoutMs: 300000 },
    eventStream: { persistPath: './test-sessions' },
  };
}

describe('buildZamInput', () => {
  let tempDir: string;
  let es: EventStream;

  beforeEach(() => {
    tempDir = join(tmpdir(), `zam-test-hsb-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    es = new EventStream(join(tempDir, 'events.jsonl'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Phase R2 tests (preserved)
  // -------------------------------------------------------------------------

  it('should build request with user text and metadata', () => {
    const result = buildZamInput(
      es,
      { text: 'hello world', metadata: { source: 'cli' } },
      { components: [] },
      makeConfig(),
    );

    expect(result.request.text).toBe('hello world');
    expect(result.request.metadata).toEqual({ source: 'cli' });
  });

  it('should pass registry unchanged', () => {
    const registry = { components: [{ id: 'c1' }] };
    const result = buildZamInput(es, { text: 'test' }, registry, makeConfig());

    expect(result.registry).toBe(registry);
  });

  it('should set no history on empty EventStream', () => {
    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());
    expect(result.history).toBeUndefined();
  });

  it('should build recent_raw_turns from user_message events', () => {
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'hi' } });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    expect(result.history).toEqual({
      recent_raw_turns: [{ role: 'user', content: 'hi' }],
    });
  });

  it('should build recent_raw_turns from model_response (text) events', () => {
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'hi' } });
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'model_response',
      content: { type: 'text', text: 'hello!', providerName: 'openrouter', model: 'm' },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    expect(result.history).toEqual({
      recent_raw_turns: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello!' },
      ],
    });
  });

  it('should set reentryTurn=true when model responses exist', () => {
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'hi' } });
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'model_response',
      content: { type: 'text', text: 'hello!', providerName: 'p', model: 'm' },
    });

    const result = buildZamInput(es, { text: 'follow-up' }, {}, makeConfig());

    expect(result.requestSignals?.reentryTurn).toBe(true);
  });

  it('should NOT set reentryTurn on first turn (no prior model response)', () => {
    const result = buildZamInput(es, { text: 'first' }, {}, makeConfig());
    expect(result.requestSignals).toBeUndefined();
  });

  it('should set priorPlanId from most recent zam_plan entry', () => {
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'hi' } });
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'zam_plan',
      content: { runId: 'run-abc', promptPlan: {}, trace: {}, summary: '', isReentry: false },
    });
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'model_response',
      content: { type: 'text', text: 'resp', providerName: 'p', model: 'm' },
    });

    const result = buildZamInput(es, { text: 'follow-up' }, {}, makeConfig());

    expect(result.requestSignals?.priorPlanId).toBe('run-abc');
  });

  it('should default metadata to empty object', () => {
    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());
    expect(result.request.metadata).toEqual({});
  });

  // -------------------------------------------------------------------------
  // Phase R3 tests: open_commitments mapping
  // -------------------------------------------------------------------------

  it('should map tool_call to open_commitments with role:assistant', () => {
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'tool_call',
      content: {
        callId: 'tc-1',
        toolName: 'read_file',
        arguments: { path: 'test.txt' },
        permissionResult: { allowed: true, reason: 'auto', requiresApproval: false, approvedBy: 'auto' },
      },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    const history = result.history as { open_commitments?: Array<{ role: string; dropAllowed: boolean }> };
    expect(history?.open_commitments).toBeDefined();
    expect(history!.open_commitments!.length).toBe(1);
    expect(history!.open_commitments![0].role).toBe('assistant');
    expect(history!.open_commitments![0].dropAllowed).toBe(false);
  });

  it('should map tool_result to open_commitments with role:tool', () => {
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'tool_result',
      content: {
        callId: 'tc-1',
        toolName: 'read_file',
        success: true,
        output: 'file content',
        rawOutputLength: 12,
        truncated: false,
        durationMs: 5,
      },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    const history = result.history as { open_commitments?: Array<{ role: string; content: string; dropAllowed: boolean }> };
    expect(history?.open_commitments).toBeDefined();
    expect(history!.open_commitments![0].role).toBe('tool');
    expect(history!.open_commitments![0].content).toBe('file content');
    expect(history!.open_commitments![0].dropAllowed).toBe(false);
  });

  it('should map failed tool_result with error prefix', () => {
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'tool_result',
      content: {
        callId: 'tc-1',
        toolName: 'read_file',
        success: false,
        output: '',
        error: 'File not found',
        rawOutputLength: 0,
        truncated: false,
        durationMs: 0,
      },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    const history = result.history as { open_commitments?: Array<{ role: string; content: string }> };
    expect(history!.open_commitments![0].content).toContain('Error: File not found');
  });

  it('should map tool_error to open_commitments with role:tool', () => {
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'error',
      content: {
        errorType: 'tool_error',
        message: 'Disk full',
        recoverable: true,
      },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    const history = result.history as { open_commitments?: Array<{ role: string; content: string; dropAllowed: boolean }> };
    expect(history?.open_commitments).toBeDefined();
    expect(history!.open_commitments![0].role).toBe('tool');
    expect(history!.open_commitments![0].content).toContain('tool_error');
    expect(history!.open_commitments![0].content).toContain('Disk full');
    expect(history!.open_commitments![0].dropAllowed).toBe(false);
  });

  it('should map permission_denied error to open_commitments', () => {
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'error',
      content: {
        errorType: 'permission_denied',
        message: 'Shell execution denied',
        recoverable: true,
      },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    const history = result.history as { open_commitments?: Array<{ role: string; content: string }> };
    expect(history?.open_commitments).toBeDefined();
    expect(history!.open_commitments![0].content).toContain('permission_denied');
  });

  it('should NOT map non-tool errors to open_commitments', () => {
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'error',
      content: {
        errorType: 'provider_error',
        message: 'Rate limited',
        recoverable: true,
      },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    expect(result.history).toBeUndefined();
  });

  it('should preserve toolCallId and toolName in open_commitments entries', () => {
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'tool_call',
      content: {
        callId: 'tc-42',
        toolName: 'grep_search',
        arguments: { query: 'TODO' },
        permissionResult: { allowed: true, reason: 'auto', requiresApproval: false },
      },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    const history = result.history as { open_commitments?: Array<{ toolCallId?: string; toolName?: string }> };
    expect(history!.open_commitments![0].toolCallId).toBe('tc-42');
    expect(history!.open_commitments![0].toolName).toBe('grep_search');
  });

  it('should include both recent_raw_turns and open_commitments in history', () => {
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'hi' } });
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'tool_call',
      content: {
        callId: 'tc-1',
        toolName: 'read_file',
        arguments: { path: 'x.txt' },
        permissionResult: { allowed: true, reason: 'auto', requiresApproval: false },
      },
    });
    es.append({
      sessionId: 's',
      turnIndex: 0,
      type: 'tool_result',
      content: { callId: 'tc-1', toolName: 'read_file', success: true, output: 'content', rawOutputLength: 7, truncated: false, durationMs: 5 },
    });

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    const history = result.history as { recent_raw_turns?: unknown[]; open_commitments?: unknown[] };
    expect(history?.recent_raw_turns).toBeDefined();
    expect(history?.open_commitments).toBeDefined();
    expect(history!.recent_raw_turns!.length).toBe(1);
    expect(history!.open_commitments!.length).toBe(2); // tool_call + tool_result
  });

  // -------------------------------------------------------------------------
  // Phase M3-D tests: CompressorResult integration
  // -------------------------------------------------------------------------

  it('should include structured_summary when compressorResult is compressed', () => {
    // Set up EventStream with several turns
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'turn0' } });
    es.append({
      sessionId: 's', turnIndex: 0, type: 'model_response',
      content: { type: 'text', text: 'resp0', providerName: 'p', model: 'm' },
    });
    es.append({ sessionId: 's', turnIndex: 1, type: 'user_message', content: { text: 'turn1' } });
    es.append({
      sessionId: 's', turnIndex: 1, type: 'model_response',
      content: { type: 'text', text: 'resp1', providerName: 'p', model: 'm' },
    });

    const mockOutput = {
      compressorVersion: 'test-model',
      sessionId: 's',
      compressionTraceId: 'trace-1',
      currentTaskState: { activeTask: 'test', currentGoal: null, blockers: [], progressNotes: [] },
      acceptedDecisions: [],
      openIssues: [],
      openCommitments: [],
      userConstraints: [],
      importantFilesPaths: [],
      failedAttempts: [],
      activeWarnings: [],
      antiRegressionRules: [],
      durableFacts: [],
      recentRawTurnWindow: { windowSize: 2, turnCount: 2, windowPolicy: 'most_recent_N' },
      compressionConfidence: 0.95,
      failOpenTriggered: false,
      failOpenReason: null,
      protectedCategoriesRetained: ['currentTaskState', 'acceptedDecisions', 'openCommitments', 'userConstraints', 'antiRegressionRules'],
      totalRawTokensApprox: 100,
      compressedTokensApprox: 30,
    };

    // rawTurnWindow only contains turn 1 entries
    const rawWindowEntries = es.read().filter(e => e.turnIndex === 1);

    const compressorResult = {
      output: mockOutput as any,
      compressed: true,
      rawTurnWindow: rawWindowEntries,
      durationMs: 500,
      fallbackUsed: false,
      tokensSaved: 70,
    };

    const result = buildZamInput(es, { text: 'next' }, {}, makeConfig(), compressorResult);

    const history = result.history as {
      structured_summary?: string;
      recent_raw_turns?: Array<{ role: string; content: string }>;
    };

    // structured_summary should be present
    expect(history?.structured_summary).toBeDefined();
    const parsed = JSON.parse(history!.structured_summary!);
    expect(parsed.compressorVersion).toBe('test-model');
    expect(parsed.compressionConfidence).toBe(0.95);
  });

  it('should use rawTurnWindow for recent_raw_turns when compressed', () => {
    // Set up 3 turns of data
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'old-turn' } });
    es.append({
      sessionId: 's', turnIndex: 0, type: 'model_response',
      content: { type: 'text', text: 'old-resp', providerName: 'p', model: 'm' },
    });
    es.append({ sessionId: 's', turnIndex: 1, type: 'user_message', content: { text: 'recent-turn' } });
    es.append({
      sessionId: 's', turnIndex: 1, type: 'model_response',
      content: { type: 'text', text: 'recent-resp', providerName: 'p', model: 'm' },
    });

    // rawTurnWindow only includes turn 1
    const rawWindowEntries = es.read().filter(e => e.turnIndex === 1);

    const compressorResult = {
      output: { totalRawTokensApprox: 100, compressedTokensApprox: 30 } as any,
      compressed: true,
      rawTurnWindow: rawWindowEntries,
      durationMs: 100,
      fallbackUsed: false,
      tokensSaved: 70,
    };

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig(), compressorResult);

    const history = result.history as { recent_raw_turns?: Array<{ role: string; content: string }> };
    // Should only contain the recent turn window, not all turns
    expect(history!.recent_raw_turns!.length).toBe(2); // user + assistant from turn 1 only
    expect(history!.recent_raw_turns![0].content).toBe('recent-turn');
    expect(history!.recent_raw_turns![1].content).toBe('recent-resp');
  });

  it('should include ALL open_commitments even when compressed', () => {
    // Set up tool calls across old and recent turns
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'hi' } });
    es.append({
      sessionId: 's', turnIndex: 0, type: 'tool_call',
      content: {
        callId: 'tc-old', toolName: 'read_file', arguments: { path: 'old.txt' },
        permissionResult: { allowed: true, reason: 'auto', requiresApproval: false },
      },
    });
    es.append({
      sessionId: 's', turnIndex: 0, type: 'tool_result',
      content: { callId: 'tc-old', toolName: 'read_file', success: true, output: 'old content', rawOutputLength: 11, truncated: false, durationMs: 5 },
    });
    es.append({ sessionId: 's', turnIndex: 1, type: 'user_message', content: { text: 'next' } });
    es.append({
      sessionId: 's', turnIndex: 1, type: 'tool_call',
      content: {
        callId: 'tc-new', toolName: 'write_file', arguments: { path: 'new.txt' },
        permissionResult: { allowed: true, reason: 'auto', requiresApproval: false },
      },
    });

    // rawTurnWindow includes only turn 1
    const rawWindowEntries = es.read().filter(e => e.turnIndex === 1);

    const compressorResult = {
      output: { totalRawTokensApprox: 100, compressedTokensApprox: 30 } as any,
      compressed: true,
      rawTurnWindow: rawWindowEntries,
      durationMs: 100,
      fallbackUsed: false,
      tokensSaved: 70,
    };

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig(), compressorResult);

    const history = result.history as { open_commitments?: Array<{ toolName?: string }> };
    // open_commitments must include ALL tool calls, not just from rawTurnWindow
    expect(history!.open_commitments!.length).toBe(3); // tc-old call + result + tc-new call
  });

  it('should behave identically to pre-M3 when compressorResult is null', () => {
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'hi' } });

    const resultWithNull = buildZamInput(es, { text: 'test' }, {}, makeConfig(), null);
    const resultWithoutParam = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    expect(resultWithNull.history).toEqual(resultWithoutParam.history);
  });

  it('should behave identically to pre-M3 when compressorResult.compressed is false', () => {
    es.append({ sessionId: 's', turnIndex: 0, type: 'user_message', content: { text: 'hi' } });

    const compressorResult = {
      output: null,
      compressed: false,
      rawTurnWindow: [],
      durationMs: 1,
      fallbackUsed: true,
      fallbackReason: 'below threshold',
      tokensSaved: 0,
    };

    const result = buildZamInput(es, { text: 'test' }, {}, makeConfig(), compressorResult);
    const resultBaseline = buildZamInput(es, { text: 'test' }, {}, makeConfig());

    expect(result.history).toEqual(resultBaseline.history);
    // structured_summary should NOT be present
    const history = result.history as { structured_summary?: string } | undefined;
    expect(history?.structured_summary).toBeUndefined();
  });
});
