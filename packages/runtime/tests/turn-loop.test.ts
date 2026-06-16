// ============================================================================
// Tests — Turn Loop Engine
// ============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest';
import { runLoop } from '../src/turn-loop.js';
import { EventStream } from '../src/event-stream.js';
import type {
  Session,
  RuntimeConfig,
  ZamClient,
  ProviderClient,
  ProviderResponse,
  ZamPlanResponse,
  ZamPlanRequestBody,
  Workspace,
  PermissionGate,
  ToolOutputOptimizer,
  ToolAction,
  ToolObservation,
  PermissionResult,
  OptimizedOutput,
} from '../src/types.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Mock the request-analyzer module (Phase M1-D)
// All existing tests get analyzer returning null (disabled/failed behavior).
// ---------------------------------------------------------------------------
const mockAnalyzeRequest = vi.fn(async () => ({
  output: null,
  tier: 0 as const,
  durationMs: 10,
  fallbackUsed: false,
}));

vi.mock('../src/request-analyzer.js', () => ({
  analyzeRequest: (...args: unknown[]) => mockAnalyzeRequest(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    zam: { endpoint: 'library' },
    provider: { name: 'openrouter', model: 'test-model', apiKeyEnvVar: 'TEST_KEY' },
    workspace: { mode: 'local', rootPath: './' },
    loop: { maxTurns: 10, timeoutMs: 300000 },
    eventStream: { persistPath: './test-sessions' },
    ...overrides,
  };
}

function createTempSession(configOverrides?: Partial<RuntimeConfig>): {
  session: Session;
  tempDir: string;
} {
  const tempDir = join(tmpdir(), `zam-test-tl-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  const config = makeConfig(configOverrides);
  const esPath = join(tempDir, 'events.jsonl');

  return {
    session: {
      sessionId: randomUUID(),
      turnCounter: 0,
      startedAt: new Date().toISOString(),
      eventStream: new EventStream(esPath),
      config,
    },
    tempDir,
  };
}

function createMockZamClient(response?: Partial<ZamPlanResponse>): ZamClient {
  let callCount = 0;
  return {
    plan: async (_input: ZamPlanRequestBody): Promise<ZamPlanResponse> => {
      callCount++;
      return {
        promptPlan: {
          selectedComponents: [
            { id: `sys-${callCount}`, content: 'You are helpful.', role: 'system' as const },
            { id: `req-${callCount}`, content: _input.request.text, role: 'user' as const },
          ],
          omittedComponents: [],
          deferredComponents: [],
          selectedTools: [],
          riskFlags: [],
          failOpenReasons: [],
          planningWarnings: [],
        },
        trace: { run: { runId: `run-${callCount}` } },
        summary: 'test plan',
        ...response,
      };
    },
  };
}

function createMockProvider(response: ProviderResponse): ProviderClient {
  return {
    chat: async () => response,
  };
}

/** Mock workspace: auto-approves and returns success for all tool calls */
function createMockWorkspace(): Workspace {
  return {
    execute: async (action: ToolAction): Promise<ToolObservation> => ({
      callId: action.callId,
      success: true,
      output: `Result of ${action.toolName}`,
      durationMs: 5,
    }),
    getWorkspaceRoot: () => '/test',
    isPathWithinWorkspace: () => true,
  };
}

/** Mock permission gate: auto-approves all actions */
function createMockPermissionGate(): PermissionGate {
  return {
    check: async (): Promise<PermissionResult> => ({
      allowed: true,
      reason: 'Auto-approved',
      requiresApproval: false,
      approvedBy: 'auto',
    }),
  };
}

/** Mock permission gate: denies all actions */
function createDenyPermissionGate(): PermissionGate {
  return {
    check: async (): Promise<PermissionResult> => ({
      allowed: false,
      reason: 'Denied by policy',
      requiresApproval: true,
    }),
  };
}

/** Mock tool output optimizer: passes through output */
function createMockToolOptimizer(): ToolOutputOptimizer {
  return {
    optimize: (observation: ToolObservation): OptimizedOutput => ({
      content: observation.output,
      truncated: false,
      originalLines: observation.output.split('\n').length,
      originalChars: observation.output.length,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests — Phase R2 backward compatibility
// ---------------------------------------------------------------------------

describe('runLoop', () => {
  let tempDir: string;

  afterEach(() => {
    // Restore all spies/mocks to prevent leaks between tests.
    // This is critical for the Date.now spy in the timeout test — if that test
    // crashes before its manual restore, this afterEach ensures cleanup.
    vi.restoreAllMocks();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return text response on happy path', async () => {
    const { session, tempDir: td } = createTempSession();
    tempDir = td;

    const result = await runLoop(
      session,
      { text: 'What is 2+2?' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'The answer is 4.' }),
      {},
    );

    expect(result.exitReason).toBe('completed');
    expect(result.finalResponse).toBe('The answer is 4.');
    expect(result.turnCount).toBe(1);
  });

  it('should trigger max_turns fail-safe', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 0, timeoutMs: 300000 },
    });
    tempDir = td;

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    expect(result.exitReason).toBe('max_turns');
  });

  it('should trigger timeout fail-safe', async () => {
    // Use vi.spyOn to make the elapsed-time check deterministic.
    // runLoop captures startTime = Date.now() at entry, then checks
    // elapsed = Date.now() - startTime >= timeoutMs at the top of the loop.
    //
    // The original test used real wall-clock with timeoutMs=1, which was flaky
    // because startTime is captured inside runLoop, making the pre-call sleep
    // irrelevant — the race was whether the synchronous code path between the
    // two Date.now() calls took ≥1ms.
    //
    // vi.spyOn is preferred over manual monkey-patching because:
    // 1. vi.restoreAllMocks() in afterEach guarantees cleanup even on crash.
    // 2. It integrates with vitest's mock lifecycle (no manual try/finally).
    // 3. It avoids global mutation that could leak to parallel test workers.
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // First call: startTime capture. Subsequent calls: elapsed check.
      // With timeoutMs=50, elapsed = 2000 - 1000 = 1000 >= 50 → deterministic timeout.
      return callCount === 1 ? 1000 : 2000;
    });

    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 10, timeoutMs: 50 },  // 50ms timeout
    });
    tempDir = td;

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    expect(result.exitReason).toBe('timeout');
  });

  it('should handle ZAM errors gracefully', async () => {
    const { session, tempDir: td } = createTempSession();
    tempDir = td;

    const failingZam: ZamClient = {
      plan: async () => {
        throw new Error('ZAM pipeline failed');
      },
    };

    const result = await runLoop(
      session,
      { text: 'test' },
      failingZam,
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    expect(result.exitReason).toBe('error');
    expect(result.finalResponse).toBe('Context planning failed.');
  });

  it('should handle provider errors and continue (recoverable)', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 2, timeoutMs: 300000 },
    });
    tempDir = td;

    let callCount = 0;
    const provider: ProviderClient = {
      chat: async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Rate limited');
        }
        return { type: 'text', text: 'Recovered!' };
      },
    };

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      provider,
      {},
    );

    expect(result.exitReason).toBe('completed');
    expect(result.finalResponse).toBe('Recovered!');
    expect(result.turnCount).toBe(2);
  });

  it('should return error when model returns tool_call without tool infrastructure', async () => {
    const { session, tempDir: td } = createTempSession();
    tempDir = td;

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      createMockProvider({
        type: 'tool_call',
        toolCalls: [
          { toolName: 'read_file', arguments: { path: '/test' }, callId: 'tc-1' },
        ],
      }),
      {},
      // No workspace, permissionGate, or toolOptimizer
    );

    expect(result.exitReason).toBe('error');
    expect(result.finalResponse).toBe('Tool execution not available.');
  });

  it('should detect no-progress (identical plans)', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 5, timeoutMs: 300000 },
    });
    tempDir = td;

    // Provider always fails (recoverable) so we re-enter the loop
    // ZAM always returns the same plan → no-progress should trigger on second turn
    const alwaysFailProvider: ProviderClient = {
      chat: async () => {
        throw new Error('always fail');
      },
    };

    const fixedPlanZam: ZamClient = {
      plan: async () => ({
        promptPlan: {
          selectedComponents: [{ id: 'fixed', content: 'same plan always' }],
        },
        trace: { run: { runId: 'fixed-run' } },
        summary: 'fixed',
      }),
    };

    const result = await runLoop(session, { text: 'test' }, fixedPlanZam, alwaysFailProvider, {});

    expect(result.exitReason).toBe('no_progress');
  });

  it('should record user message in EventStream', async () => {
    const { session, tempDir: td } = createTempSession();
    tempDir = td;

    await runLoop(
      session,
      { text: 'hello test' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    const entries = session.eventStream.read();
    const userMsg = entries.find((e) => e.type === 'user_message');
    expect(userMsg).toBeDefined();
    expect((userMsg!.content as { text: string }).text).toBe('hello test');
  });

  it('should record session ID in the result', async () => {
    const { session, tempDir: td } = createTempSession();
    tempDir = td;

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    expect(result.sessionId).toBe(session.sessionId);
  });
});

// ---------------------------------------------------------------------------
// Tests — Phase R3: Tool execution
// ---------------------------------------------------------------------------

describe('runLoop — tool execution (Phase R3)', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should execute tool calls and re-enter loop', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 3, timeoutMs: 300000 },
    });
    tempDir = td;

    let providerCallCount = 0;
    const provider: ProviderClient = {
      chat: async () => {
        providerCallCount++;
        if (providerCallCount === 1) {
          return {
            type: 'tool_call' as const,
            toolCalls: [
              { toolName: 'read_file', arguments: { path: 'test.txt' }, callId: 'tc-1' },
            ],
          };
        }
        return { type: 'text', text: 'Done after reading file.' };
      },
    };

    const result = await runLoop(
      session,
      { text: 'Read the file' },
      createMockZamClient(),
      provider,
      {},
      createMockWorkspace(),
      createMockPermissionGate(),
      createMockToolOptimizer(),
    );

    expect(result.exitReason).toBe('completed');
    expect(result.finalResponse).toBe('Done after reading file.');
    expect(result.turnCount).toBe(2);
  });

  it('should record tool_call and tool_result in EventStream', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 3, timeoutMs: 300000 },
    });
    tempDir = td;

    let providerCallCount = 0;
    const provider: ProviderClient = {
      chat: async () => {
        providerCallCount++;
        if (providerCallCount === 1) {
          return {
            type: 'tool_call' as const,
            toolCalls: [
              { toolName: 'read_file', arguments: { path: 'f.txt' }, callId: 'tc-abc' },
            ],
          };
        }
        return { type: 'text', text: 'ok' };
      },
    };

    await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      provider,
      {},
      createMockWorkspace(),
      createMockPermissionGate(),
      createMockToolOptimizer(),
    );

    const entries = session.eventStream.read();
    const toolCallEntry = entries.find((e) => e.type === 'tool_call');
    expect(toolCallEntry).toBeDefined();
    const tcContent = toolCallEntry!.content as { callId: string; toolName: string };
    expect(tcContent.callId).toBe('tc-abc');
    expect(tcContent.toolName).toBe('read_file');

    const toolResultEntry = entries.find((e) => e.type === 'tool_result');
    expect(toolResultEntry).toBeDefined();
    const trContent = toolResultEntry!.content as { callId: string; success: boolean; output: string };
    expect(trContent.callId).toBe('tc-abc');
    expect(trContent.success).toBe(true);
    expect(trContent.output).toContain('Result of read_file');
  });

  it('should handle permission denied for tool calls', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 3, timeoutMs: 300000 },
    });
    tempDir = td;

    let providerCallCount = 0;
    const provider: ProviderClient = {
      chat: async () => {
        providerCallCount++;
        if (providerCallCount === 1) {
          return {
            type: 'tool_call' as const,
            toolCalls: [
              { toolName: 'shell_exec', arguments: { command: 'rm -rf /' }, callId: 'tc-deny' },
            ],
          };
        }
        return { type: 'text', text: 'understood, skipping.' };
      },
    };

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      provider,
      {},
      createMockWorkspace(),
      createDenyPermissionGate(),
      createMockToolOptimizer(),
    );

    expect(result.exitReason).toBe('completed');

    const entries = session.eventStream.read();
    const errorEntries = entries.filter((e) => e.type === 'error');
    const permDenied = errorEntries.find((e) =>
      (e.content as { errorType: string }).errorType === 'permission_denied'
    );
    expect(permDenied).toBeDefined();

    const toolResultEntry = entries.find((e) => e.type === 'tool_result');
    expect(toolResultEntry).toBeDefined();
    const trContent = toolResultEntry!.content as { success: boolean; error: string };
    expect(trContent.success).toBe(false);
    expect(trContent.error).toContain('Permission denied');
  });

  it('should handle tool execution failures', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 3, timeoutMs: 300000 },
    });
    tempDir = td;

    const failingWorkspace: Workspace = {
      execute: async () => {
        throw new Error('Disk full');
      },
      getWorkspaceRoot: () => '/test',
      isPathWithinWorkspace: () => true,
    };

    let providerCallCount = 0;
    const provider: ProviderClient = {
      chat: async () => {
        providerCallCount++;
        if (providerCallCount === 1) {
          return {
            type: 'tool_call' as const,
            toolCalls: [
              { toolName: 'write_file', arguments: { path: 'out.txt', content: 'data' }, callId: 'tc-fail' },
            ],
          };
        }
        return { type: 'text', text: 'I see the error, trying something else.' };
      },
    };

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      provider,
      {},
      failingWorkspace,
      createMockPermissionGate(),
      createMockToolOptimizer(),
    );

    expect(result.exitReason).toBe('completed');

    const entries = session.eventStream.read();
    const toolErrors = entries.filter(
      (e) => e.type === 'error' && (e.content as { errorType: string }).errorType === 'tool_error'
    );
    expect(toolErrors.length).toBeGreaterThan(0);
  });

  it('should detect no-progress with identical tool calls', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 5, timeoutMs: 300000 },
    });
    tempDir = td;

    const provider: ProviderClient = {
      chat: async () => ({
        type: 'tool_call' as const,
        toolCalls: [
          { toolName: 'read_file', arguments: { path: 'same.txt' }, callId: 'tc-repeat' },
        ],
      }),
    };

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      provider,
      {},
      createMockWorkspace(),
      createMockPermissionGate(),
      createMockToolOptimizer(),
    );

    expect(result.exitReason).toBe('no_progress');

    const entries = session.eventStream.read();
    const failSafe = entries.find(
      (e) => e.type === 'system_event' &&
        (e.content as { details?: { reason?: string } }).details?.reason === 'no_progress_tool'
    );
    expect(failSafe).toBeDefined();
  });

  it('should execute multiple tool calls sequentially', async () => {
    const { session, tempDir: td } = createTempSession({
      loop: { maxTurns: 3, timeoutMs: 300000 },
    });
    tempDir = td;

    const executedTools: string[] = [];
    const trackingWorkspace: Workspace = {
      execute: async (action: ToolAction): Promise<ToolObservation> => {
        executedTools.push(action.toolName);
        return {
          callId: action.callId,
          success: true,
          output: `Done: ${action.toolName}`,
          durationMs: 5,
        };
      },
      getWorkspaceRoot: () => '/test',
      isPathWithinWorkspace: () => true,
    };

    let providerCallCount = 0;
    const provider: ProviderClient = {
      chat: async () => {
        providerCallCount++;
        if (providerCallCount === 1) {
          return {
            type: 'tool_call' as const,
            toolCalls: [
              { toolName: 'read_file', arguments: { path: 'a.txt' }, callId: 'tc-1' },
              { toolName: 'list_dir', arguments: { path: '.' }, callId: 'tc-2' },
              { toolName: 'grep_search', arguments: { query: 'TODO' }, callId: 'tc-3' },
            ],
          };
        }
        return { type: 'text', text: 'All done.' };
      },
    };

    const result = await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      provider,
      {},
      trackingWorkspace,
      createMockPermissionGate(),
      createMockToolOptimizer(),
    );

    expect(result.exitReason).toBe('completed');
    expect(executedTools).toEqual(['read_file', 'list_dir', 'grep_search']);
  });

  // ---- Phase M1-D: Analyzer Integration Tests ----

  it('should call analyzeRequest and attach output to ZAM plan request', async () => {
    const { session, tempDir: td } = createTempSession({
      analyzer: {
        enabled: true,
        provider: { name: 'openrouter', model: 'test-analyzer', apiKeyEnvVar: 'TEST_KEY' },
        confidenceThreshold: 0.85,
        tier2ConfidenceThreshold: 0.60,
        timeoutMs: 5000,
        fallbackOnError: 'deterministic',
      },
    });
    tempDir = td;

    // Mock analyzer returning a valid output
    const dummyOutput = {
      analyzerVersion: 'test-model',
      tier: 1,
      promptFamily: 'coding_build_debug',
      analyzerConfidence: 0.92,
      assessedRequestRiskLevel: 'low',
      neededLanes: ['scaffold', 'tools'],
      requiresHistory: false,
      requiresTools: true,
      requiresFiles: true,
      failOpenTriggered: false,
      failOpenReason: null,
      evidence: ['test'],
      analyzerTraceId: 'trace-123',
    };
    mockAnalyzeRequest.mockResolvedValueOnce({
      output: dummyOutput,
      tier: 1,
      durationMs: 42,
      fallbackUsed: false,
    });

    // Track what zamClient.plan receives
    let capturedInput: ZamPlanRequestBody | undefined;
    const zamClient: ZamClient = {
      plan: async (input: ZamPlanRequestBody) => {
        capturedInput = input;
        return {
          promptPlan: {
            selectedComponents: [
              { id: 'sys-1', content: 'You are helpful.', role: 'system' as const },
              { id: 'req-1', content: input.request.text, role: 'user' as const },
            ],
          },
          trace: { run: { runId: 'run-analyzer-test' } },
          summary: 'test plan',
        };
      },
    };

    const result = await runLoop(
      session,
      { text: 'Fix the bug in utils.ts' },
      zamClient,
      createMockProvider({ type: 'text', text: 'Fixed.' }),
      {},
    );

    expect(result.exitReason).toBe('completed');

    // Verify analyzeRequest was called
    expect(mockAnalyzeRequest).toHaveBeenCalled();

    // Verify analyzer output was attached to ZAM plan input
    expect(capturedInput).toBeDefined();
    expect(capturedInput!.analyzerOutput).toEqual(dummyOutput);

    // Verify analyzer_completed event was recorded in EventStream
    const events = session.eventStream.read();
    const analyzerEvent = events.find(
      (e) => e.type === 'system_event' && (e.content as any).event === 'analyzer_completed',
    );
    expect(analyzerEvent).toBeDefined();
    const details = (analyzerEvent!.content as any).details;
    expect(details.tier).toBe(1);
    expect(details.promptFamily).toBe('coding_build_debug');
    expect(details.analyzerConfidence).toBe(0.92);
    expect(details.durationMs).toBe(42);
    expect(details.fallbackUsed).toBe(false);
  });

  it('should not attach analyzerOutput when analyzer returns null', async () => {
    const { session, tempDir: td } = createTempSession();
    tempDir = td;

    // Default mock returns null output — no need to override
    mockAnalyzeRequest.mockResolvedValueOnce({
      output: null,
      tier: 0,
      durationMs: 5,
      fallbackUsed: false,
    });

    let capturedInput: ZamPlanRequestBody | undefined;
    const zamClient: ZamClient = {
      plan: async (input: ZamPlanRequestBody) => {
        capturedInput = input;
        return {
          promptPlan: {
            selectedComponents: [
              { id: 'sys-1', content: 'You are helpful.', role: 'system' as const },
            ],
          },
          trace: { run: { runId: 'run-null-test' } },
          summary: 'test plan',
        };
      },
    };

    await runLoop(
      session,
      { text: 'Hello' },
      zamClient,
      createMockProvider({ type: 'text', text: 'Hi!' }),
      {},
    );

    // analyzerOutput should NOT be on the input
    expect(capturedInput).toBeDefined();
    expect(capturedInput!.analyzerOutput).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — Phase M3-D: History Compressor integration
// ---------------------------------------------------------------------------

// Mock the history-compressor module
const mockCompressHistory = vi.fn(async () => ({
  output: null,
  compressed: false,
  rawTurnWindow: [],
  durationMs: 5,
  fallbackUsed: false,
  tokensSaved: 0,
}));

vi.mock('../src/history-compressor.js', () => ({
  compressHistory: (...args: unknown[]) => mockCompressHistory(...args),
}));

describe('runLoop — history compressor (Phase M3-D)', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    mockCompressHistory.mockClear();
  });

  it('should call compressHistory when compressor config is present', async () => {
    const compressorConfig = {
      enabled: true,
      provider: { name: 'openrouter', model: 'test-compressor', apiKeyEnvVar: 'TEST_KEY' },
      tokenThreshold: 4000,
      minTurnsBeforeCompression: 6,
      recompressionTurnInterval: 5,
      rawWindowSize: 6,
      confidenceThreshold: 0.75,
      timeoutMs: 15000,
      fallbackOnError: 'raw_history' as const,
    };

    const { session, tempDir: td } = createTempSession({
      compressor: compressorConfig,
    });
    tempDir = td;

    mockCompressHistory.mockResolvedValueOnce({
      output: null,
      compressed: false,
      rawTurnWindow: [],
      durationMs: 3,
      fallbackUsed: false,
      tokensSaved: 0,
    });

    await runLoop(
      session,
      { text: 'test compressor' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    // compressHistory should have been called with entries, sessionId, config, and cached result
    expect(mockCompressHistory).toHaveBeenCalledTimes(1);
    const callArgs = mockCompressHistory.mock.calls[0];
    expect(Array.isArray(callArgs[0])).toBe(true); // entries
    expect(callArgs[1]).toBe(session.sessionId); // sessionId
    expect(callArgs[2]).toBe(compressorConfig); // config
    expect(callArgs[3]).toBeUndefined(); // cachedCompressorResult (first call)
  });

  it('should NOT call compressHistory when compressor config is absent', async () => {
    const { session, tempDir: td } = createTempSession();
    tempDir = td;

    await runLoop(
      session,
      { text: 'test no compressor' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    expect(mockCompressHistory).not.toHaveBeenCalled();
  });

  it('should record compressor_completed event in EventStream', async () => {
    const { session, tempDir: td } = createTempSession({
      compressor: {
        enabled: true,
        provider: { name: 'openrouter', model: 'test-compressor', apiKeyEnvVar: 'TEST_KEY' },
        tokenThreshold: 4000,
        minTurnsBeforeCompression: 6,
        recompressionTurnInterval: 5,
        rawWindowSize: 6,
        confidenceThreshold: 0.75,
        timeoutMs: 15000,
        fallbackOnError: 'raw_history' as const,
      },
    });
    tempDir = td;

    mockCompressHistory.mockResolvedValueOnce({
      output: null,
      compressed: false,
      rawTurnWindow: [],
      durationMs: 7,
      fallbackUsed: false,
      tokensSaved: 0,
    });

    await runLoop(
      session,
      { text: 'test' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    const events = session.eventStream.read();
    const compressorEvent = events.find(
      (e) => e.type === 'system_event' && (e.content as any).event === 'compressor_completed',
    );
    expect(compressorEvent).toBeDefined();
    const details = (compressorEvent!.content as any).details;
    expect(details.compressorVersion).toBe('test-compressor');
    expect(details.compressed).toBe(false);
    expect(details.fallbackUsed).toBe(false);
    expect(details.durationMs).toBe(7);
    expect(details.cachedResult).toBe(false);
  });

  it('should pass compressorResult to buildZamInput when compressed', async () => {
    const compressorConfig = {
      enabled: true,
      provider: { name: 'openrouter', model: 'test-compressor', apiKeyEnvVar: 'TEST_KEY' },
      tokenThreshold: 4000,
      minTurnsBeforeCompression: 6,
      recompressionTurnInterval: 5,
      rawWindowSize: 6,
      confidenceThreshold: 0.75,
      timeoutMs: 15000,
      fallbackOnError: 'raw_history' as const,
    };

    const { session, tempDir: td } = createTempSession({
      compressor: compressorConfig,
    });
    tempDir = td;

    const mockOutput = {
      compressorVersion: 'test-compressor',
      sessionId: session.sessionId,
      compressionTraceId: 'trace-m3d',
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
      recentRawTurnWindow: { windowSize: 6, turnCount: 6, windowPolicy: 'most_recent_N' },
      compressionConfidence: 0.92,
      failOpenTriggered: false,
      failOpenReason: null,
      protectedCategoriesRetained: ['currentTaskState', 'acceptedDecisions', 'openCommitments', 'userConstraints', 'antiRegressionRules'],
      totalRawTokensApprox: 8000,
      compressedTokensApprox: 2000,
    };

    mockCompressHistory.mockResolvedValueOnce({
      output: mockOutput,
      compressed: true,
      rawTurnWindow: [],
      durationMs: 1200,
      fallbackUsed: false,
      tokensSaved: 6000,
    });

    // Track what zamClient.plan receives
    let capturedInput: ZamPlanRequestBody | undefined;
    const zamClient: ZamClient = {
      plan: async (input: ZamPlanRequestBody) => {
        capturedInput = input;
        return {
          promptPlan: {
            selectedComponents: [
              { id: 'sys-1', content: 'You are helpful.', role: 'system' as const },
            ],
          },
          trace: { run: { runId: 'run-compressor-test' } },
          summary: 'test plan',
        };
      },
    };

    const result = await runLoop(
      session,
      { text: 'test compression pass' },
      zamClient,
      createMockProvider({ type: 'text', text: 'Done.' }),
      {},
    );

    expect(result.exitReason).toBe('completed');

    // Verify structured_summary was passed in history to ZAM
    expect(capturedInput).toBeDefined();
    const history = capturedInput!.history as { structured_summary?: string } | undefined;
    expect(history?.structured_summary).toBeDefined();
    const parsed = JSON.parse(history!.structured_summary!);
    expect(parsed.compressionConfidence).toBe(0.92);

    // Verify compressor_completed event has compressed=true
    const events = session.eventStream.read();
    const compressorEvent = events.find(
      (e) => e.type === 'system_event' && (e.content as any).event === 'compressor_completed',
    );
    const details = (compressorEvent!.content as any).details;
    expect(details.compressed).toBe(true);
    expect(details.totalRawTokens).toBe(8000);
    expect(details.compressedTokens).toBe(2000);
    expect(details.compressionRatio).toBeCloseTo(0.75);
    expect(details.confidenceScore).toBe(0.92);
  });

  it('should update session.cachedCompressorResult after compressor call', async () => {
    const { session, tempDir: td } = createTempSession({
      compressor: {
        enabled: true,
        provider: { name: 'openrouter', model: 'test-compressor', apiKeyEnvVar: 'TEST_KEY' },
        tokenThreshold: 4000,
        minTurnsBeforeCompression: 6,
        recompressionTurnInterval: 5,
        rawWindowSize: 6,
        confidenceThreshold: 0.75,
        timeoutMs: 15000,
        fallbackOnError: 'raw_history' as const,
      },
    });
    tempDir = td;

    const mockResult = {
      output: null,
      compressed: false,
      rawTurnWindow: [],
      durationMs: 3,
      fallbackUsed: false,
      tokensSaved: 0,
    };
    mockCompressHistory.mockResolvedValueOnce(mockResult);

    // Initially undefined
    expect(session.cachedCompressorResult).toBeUndefined();

    await runLoop(
      session,
      { text: 'test cache update' },
      createMockZamClient(),
      createMockProvider({ type: 'text', text: 'ok' }),
      {},
    );

    // After the loop, session should have the cached result
    expect(session.cachedCompressorResult).toBe(mockResult);
  });
});
