// ============================================================================
// Tests — History Compressor Core Logic
// Phase M3-C. Canonical source: docs/27 §8.1–§8.3, §8.6–§8.7, §10.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CompressorConfig, EventStreamEntry } from '../src/types.js';
import {
  estimateHistoryTokens,
  compressHistory,
  type CompressorResult,
  type HistoryCompressorOutput,
} from '../src/history-compressor.js';

// ---------------------------------------------------------------------------
// Helpers — mock EventStreamEntry factories
// ---------------------------------------------------------------------------

function makeUserMessage(turnIndex: number, text: string): EventStreamEntry {
  return {
    entryId: `entry-um-${turnIndex}`,
    sessionId: 'session-test',
    turnIndex,
    timestamp: new Date().toISOString(),
    type: 'user_message',
    content: { text },
  };
}

function makeModelResponse(turnIndex: number, text: string): EventStreamEntry {
  return {
    entryId: `entry-mr-${turnIndex}`,
    sessionId: 'session-test',
    turnIndex,
    timestamp: new Date().toISOString(),
    type: 'model_response',
    content: { type: 'text', text, providerName: 'openrouter', model: 'test-model' },
  };
}

function makeToolCall(turnIndex: number): EventStreamEntry {
  return {
    entryId: `entry-tc-${turnIndex}`,
    sessionId: 'session-test',
    turnIndex,
    timestamp: new Date().toISOString(),
    type: 'tool_call',
    content: {
      callId: `call-${turnIndex}`,
      toolName: 'read_file',
      arguments: { path: '/src/main.ts' },
      permissionResult: { allowed: true, reason: 'Auto-approved', requiresApproval: false },
    },
  };
}

function makeToolResult(turnIndex: number, output: string): EventStreamEntry {
  return {
    entryId: `entry-tr-${turnIndex}`,
    sessionId: 'session-test',
    turnIndex,
    timestamp: new Date().toISOString(),
    type: 'tool_result',
    content: {
      callId: `call-${turnIndex}`,
      toolName: 'read_file',
      success: true,
      output,
      rawOutputLength: output.length,
      truncated: false,
      durationMs: 5,
    },
  };
}

function makeSystemEvent(turnIndex: number): EventStreamEntry {
  return {
    entryId: `entry-se-${turnIndex}`,
    sessionId: 'session-test',
    turnIndex,
    timestamp: new Date().toISOString(),
    type: 'system_event',
    content: { event: 'session_start' },
  };
}

/** Build a session with N turns, each containing a user message and model response. */
function makeSession(turnCount: number, textPerTurn = 'some conversation text'): EventStreamEntry[] {
  const entries: EventStreamEntry[] = [];
  for (let i = 0; i < turnCount; i++) {
    entries.push(makeUserMessage(i, textPerTurn));
    entries.push(makeModelResponse(i, textPerTurn));
  }
  return entries;
}

/** Minimal valid config for tests (compressor disabled by default; override enabled as needed). */
function makeConfig(overrides: Partial<CompressorConfig> = {}): CompressorConfig {
  return {
    enabled: false,
    provider: {
      name: 'openrouter',
      model: 'google/gemini-3.1-flash-lite',
      apiKeyEnvVar: 'OPENROUTER_API_KEY',
    },
    tokenThreshold: 1000,
    minTurnsBeforeCompression: 6,
    recompressionTurnInterval: 5,
    rawWindowSize: 6,
    confidenceThreshold: 0.75,
    timeoutMs: 15000,
    fallbackOnError: 'raw_history',
    ...overrides,
  };
}

/** Minimal valid HistoryCompressorOutput for mocking successful LLM responses. */
function makeValidOutput(): Record<string, unknown> {
  return {
    currentTaskState: {
      activeTask: 'test-task',
      currentGoal: 'test goal',
      blockers: [],
      progressNotes: [],
    },
    acceptedDecisions: [],
    openIssues: [],
    openCommitments: [],
    userConstraints: [],
    importantFilesPaths: [],
    failedAttempts: [],
    activeWarnings: [],
    antiRegressionRules: [],
    durableFacts: [],
    recentRawTurnWindow: {
      windowSize: 6,
      turnCount: 6,
      windowPolicy: 'most_recent_N',
    },
    compressionConfidence: 0.90,
    failOpenTriggered: false,
    failOpenReason: null,
    protectedCategoriesRetained: [
      'currentTaskState',
      'acceptedDecisions',
      'openCommitments',
      'userConstraints',
      'antiRegressionRules',
    ],
    totalRawTokensApprox: 5000,
    compressedTokensApprox: 800,
  };
}

// ---------------------------------------------------------------------------
// Tests — estimateHistoryTokens
// ---------------------------------------------------------------------------

describe('estimateHistoryTokens', () => {
  it('should return 0 for empty entries', () => {
    expect(estimateHistoryTokens([])).toBe(0);
  });

  it('should count tokens from user_message text (4 chars = 1 token)', () => {
    const entries = [makeUserMessage(0, '1234')]; // 4 chars → 1 token
    expect(estimateHistoryTokens(entries)).toBe(1);
  });

  it('should count tokens from model_response text', () => {
    const entries = [makeModelResponse(0, '12345678')]; // 8 chars → 2 tokens
    expect(estimateHistoryTokens(entries)).toBe(2);
  });

  it('should count tokens from tool_result output', () => {
    const entries = [makeToolResult(0, '1234567890123')]; // 13 chars → ceil(13/4) = 4 tokens
    expect(estimateHistoryTokens(entries)).toBe(4);
  });

  it('should exclude system_event entries from token count', () => {
    const entries = [
      makeUserMessage(0, '1234'), // 1 token
      makeSystemEvent(0),         // excluded
    ];
    expect(estimateHistoryTokens(entries)).toBe(1);
  });

  it('should exclude tool_call entries from token count', () => {
    const entries = [
      makeUserMessage(0, '1234'), // 1 token
      makeToolCall(0),            // excluded (no text/output field)
    ];
    expect(estimateHistoryTokens(entries)).toBe(1);
  });

  it('should accumulate tokens across multiple entries', () => {
    const entries = [
      makeUserMessage(0, '1234'),    // 1 token
      makeModelResponse(0, '1234'),  // 1 token
      makeToolResult(0, '12345678'), // 2 tokens
    ];
    expect(estimateHistoryTokens(entries)).toBe(4);
  });

  it('should use Math.ceil for fractional token counts', () => {
    // 5 chars → ceil(5/4) = 2 tokens
    const entries = [makeUserMessage(0, '12345')];
    expect(estimateHistoryTokens(entries)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests — compressHistory: Activation Guard (§8.2)
// ---------------------------------------------------------------------------

describe('compressHistory — activation guard', () => {
  it('should return null result immediately when disabled', async () => {
    const config = makeConfig({ enabled: false });
    const entries = makeSession(10);
    const result = await compressHistory(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.fallbackUsed).toBe(false);
  });

  it('should return null result when turns below minTurnsBeforeCompression', async () => {
    const config = makeConfig({ enabled: true, minTurnsBeforeCompression: 10, tokenThreshold: 100 });
    // Only 5 turns (turns 0–4)
    const entries = makeSession(5, 'long text to exceed token threshold easily');
    const result = await compressHistory(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.fallbackUsed).toBe(false);
  });

  it('should return null result when estimated tokens below tokenThreshold', async () => {
    const config = makeConfig({ enabled: true, minTurnsBeforeCompression: 2, tokenThreshold: 99999 });
    // 6 turns but tiny text — below threshold
    const entries = makeSession(6, 'hi');
    const result = await compressHistory(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
  });

  it('should return cached result when a valid cached output is provided', async () => {
    const config = makeConfig({ enabled: true, minTurnsBeforeCompression: 2, tokenThreshold: 1 });
    const entries = makeSession(6, 'x');

    const cachedOutput = makeValidOutput() as unknown as HistoryCompressorOutput;
    const cached: CompressorResult = {
      output: cachedOutput,
      compressed: true,
      rawTurnWindow: [],
      durationMs: 100,
      fallbackUsed: false,
      tokensSaved: 4200,
    };

    // Should return the cached result without any LLM call
    const result = await compressHistory(entries, 'session-1', config, cached);
    expect(result.output).toBe(cachedOutput);
    expect(result.compressed).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(result.tokensSaved).toBe(4200);
  });

  it('should NOT use cached result when cached.compressed is false', async () => {
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 99999, // deliberately high to stop at threshold check
    });
    const entries = makeSession(6, 'hi'); // small, will hit threshold guard

    const staleCache: CompressorResult = {
      output: null,
      compressed: false,
      rawTurnWindow: [],
      durationMs: 0,
      fallbackUsed: true,
      tokensSaved: 0,
    };

    const result = await compressHistory(entries, 'session-1', config, staleCache);
    // Should not use the cache (compressed=false), falls to token threshold guard
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — compressHistory: LLM Call and Validation (§8.6, §8.7)
// ---------------------------------------------------------------------------

describe('compressHistory — LLM call and validation', () => {
  // We mock the provider-client to avoid real network calls.
  // The mock is applied by replacing createProviderClient behavior via vi.mock.
  // Since history-compressor.ts imports createProviderClient, we mock the module.

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null result when model returns non-JSON text', async () => {
    // Override createProviderClient to return a mock that replies with non-JSON
    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => ({ text: 'This is not JSON at all.' }),
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
    });
    const entries = makeSession(6, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('Failed to extract JSON');
  });

  it('should return null result when model returns schema-invalid JSON', async () => {
    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => ({ text: JSON.stringify({ invalid: 'object', no_required_fields: true }) }),
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
    });
    const entries = makeSession(6, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('Schema validation failed');
  });

  it('should return null result when model omits a required protected category', async () => {
    const outputMissingProtected = {
      ...makeValidOutput(),
      // Missing 'antiRegressionRules' from protectedCategoriesRetained
      protectedCategoriesRetained: [
        'currentTaskState',
        'acceptedDecisions',
        'openCommitments',
        'userConstraints',
        // 'antiRegressionRules' is MISSING
      ],
    };

    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => ({ text: JSON.stringify(outputMissingProtected) }),
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
    });
    const entries = makeSession(6, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('Protected categories not retained');
  });

  it('should set failOpenTriggered=true when confidence is below threshold', async () => {
    const lowConfidenceOutput = {
      ...makeValidOutput(),
      compressionConfidence: 0.50, // below 0.75 threshold
      failOpenTriggered: false,    // model says false, but compressor must override
      failOpenReason: null,
    };

    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => ({ text: JSON.stringify(lowConfidenceOutput) }),
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
      confidenceThreshold: 0.75,
    });
    const entries = makeSession(6, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).not.toBeNull();
    expect(result.compressed).toBe(true);
    expect(result.output!.failOpenTriggered).toBe(true);
    expect(result.output!.failOpenReason).toContain('0.5');
    expect(result.output!.failOpenReason).toContain('0.75');
  });

  it('should return null result on provider timeout', async () => {
    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => {
          // Simulate a response that never resolves within timeout
          await new Promise(resolve => setTimeout(resolve, 30000));
          return { text: '{}' };
        },
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
      timeoutMs: 50, // Very short timeout to trigger the timeout case
    });
    const entries = makeSession(6, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('timed out');
  }, 5000); // 5s vitest timeout (the function's internal timeout is 50ms)

  it('should return null result on provider API error', async () => {
    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => {
          throw new Error('Provider API error: 503 Service Unavailable');
        },
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
    });
    const entries = makeSession(6, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('503');
  });

  it('should return valid compressed output on successful LLM response', async () => {
    const validOutput = makeValidOutput();

    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => ({ text: JSON.stringify(validOutput) }),
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
      confidenceThreshold: 0.75,
    });
    const entries = makeSession(6, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).not.toBeNull();
    expect(result.compressed).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
    // Verify metadata was injected
    expect(result.output!.compressorVersion).toBe('google/gemini-3.1-flash-lite');
    expect(result.output!.sessionId).toBe('session-1');
    expect(result.output!.compressionTraceId).toBeTruthy();
  });

  it('should extract JSON from markdown code fences in model response', async () => {
    const validOutput = makeValidOutput();
    const markdownResponse = `\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``;

    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => ({ text: markdownResponse }),
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
    });
    const entries = makeSession(6, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).not.toBeNull();
    expect(result.compressed).toBe(true);
  });

  it('should not throw even if createProviderClient itself throws synchronously', async () => {
    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => {
        throw new Error('Synchronous client creation error');
      },
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
    });
    const entries = makeSession(6, 'a'.repeat(500));

    // Must not throw — must return a null fallback result
    const result = await ch(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.fallbackUsed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — compressHistory: Raw Turn Window
// ---------------------------------------------------------------------------

describe('compressHistory — raw turn window', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should include the raw turn window entries in the result even on null output (failed LLM)', async () => {
    vi.doMock('../src/provider-client.js', () => ({
      createProviderClient: () => ({
        chat: async () => ({ text: 'not json at all' }),
      }),
    }));

    const { compressHistory: ch } = await import('../src/history-compressor.js');
    const config = makeConfig({
      enabled: true,
      minTurnsBeforeCompression: 2,
      tokenThreshold: 1,
      rawWindowSize: 3,
    });
    const entries = makeSession(8, 'a'.repeat(500));

    const result = await ch(entries, 'session-1', config);
    expect(result.output).toBeNull();
    expect(result.fallbackUsed).toBe(true);
    // rawTurnWindow should be populated (last 3 turns = 6 entries: 2 per turn)
    expect(result.rawTurnWindow.length).toBeGreaterThan(0);
  });
});
