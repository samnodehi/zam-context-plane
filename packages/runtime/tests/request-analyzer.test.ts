// ============================================================================
// Tests — Request Analyzer
// Phase M1-C. Canonical: docs/25 §6.1–§6.6.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AnalyzerConfig } from '../src/types.js';

// ---------------------------------------------------------------------------
// Mock the provider-client module BEFORE importing the analyzer
// ---------------------------------------------------------------------------

const mockChat = vi.fn();

vi.mock('../src/provider-client.js', () => ({
  createProviderClient: vi.fn(() => ({
    chat: mockChat,
  })),
}));

// Now import the analyzer (it will use the mocked createProviderClient)
const { analyzeRequest } = await import('../src/request-analyzer.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AnalyzerConfig>): AnalyzerConfig {
  return {
    enabled: true,
    provider: { name: 'openrouter', model: 'google/gemini-3.1-flash-lite', apiKeyEnvVar: 'TEST_KEY' },
    confidenceThreshold: 0.85,
    tier2ConfidenceThreshold: 0.60,
    timeoutMs: 5000,
    fallbackOnError: 'deterministic',
    ...overrides,
  };
}

/** A valid AnalyzerOutput JSON (all required fields per schema). */
function makeValidAnalyzerJson(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    promptFamily: 'coding_build_debug',
    requestType: 'coding',
    taskType: 'debug',
    analyzerConfidence: 0.92,
    assessedRequestRiskLevel: 'low',
    neededLanes: ['scaffold', 'tools', 'files'],
    requiresHistory: false,
    requiresTools: true,
    requiresFiles: true,
    evidence: ['mentions code', 'mentions debugging'],
    // Note: analyzerVersion, analyzerTraceId, tier, failOpenTriggered, failOpenReason
    // are added by the analyzer module, not by the model.
    ...overrides,
  };
}

function mockChatReturning(json: Record<string, unknown>) {
  mockChat.mockResolvedValueOnce({
    type: 'text' as const,
    text: JSON.stringify(json),
  });
}

function mockChatReturningText(text: string) {
  mockChat.mockResolvedValueOnce({
    type: 'text' as const,
    text,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Test 1: Disabled ----
  it('should return null immediately when config.enabled is false', async () => {
    const config = makeConfig({ enabled: false });
    const result = await analyzeRequest('Fix the bug', config);

    expect(result.output).toBeNull();
    expect(result.tier).toBe(0);
    expect(result.durationMs).toBe(0);
    expect(result.fallbackUsed).toBe(false);
    expect(mockChat).not.toHaveBeenCalled();
  });

  // ---- Test 2: Tier 0 — Empty request ----
  it('should return general_default for empty request without calling LLM', async () => {
    const config = makeConfig();
    const result = await analyzeRequest('   ', config);

    expect(result.output).not.toBeNull();
    expect(result.output!.promptFamily).toBe('general_default');
    expect(result.output!.tier).toBe(0);
    expect(result.output!.analyzerVersion).toBe('tier0-regex');
    expect(result.fallbackUsed).toBe(false);
    expect(mockChat).not.toHaveBeenCalled();
  });

  // ---- Test 3: Tier 0 — Greeting ----
  it('should return simple_greeting for "Hello" without calling LLM', async () => {
    const config = makeConfig();
    const result = await analyzeRequest('Hello', config);

    expect(result.output).not.toBeNull();
    expect(result.output!.promptFamily).toBe('simple_greeting');
    expect(result.output!.tier).toBe(0);
    expect(result.fallbackUsed).toBe(false);
    expect(mockChat).not.toHaveBeenCalled();
  });

  // ---- Test 4: Tier 1 Happy Path ----
  it('should return valid AnalyzerOutput for Tier 1 happy path', async () => {
    const config = makeConfig();
    mockChatReturning(makeValidAnalyzerJson());

    const result = await analyzeRequest('Fix the null pointer exception in utils.ts', config);

    expect(result.output).not.toBeNull();
    expect(result.output!.promptFamily).toBe('coding_build_debug');
    expect(result.output!.analyzerConfidence).toBe(0.92);
    expect(result.output!.tier).toBe(1);
    expect(result.output!.analyzerVersion).toBe('google/gemini-3.1-flash-lite');
    expect(result.output!.analyzerTraceId).toBeTruthy();
    expect(result.fallbackUsed).toBe(false);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  // ---- Test 5: Tier 1 Malformed JSON ----
  it('should return null with fallback when LLM returns garbage', async () => {
    const config = makeConfig();
    mockChatReturningText('This is not JSON at all, just some random text without braces');

    const result = await analyzeRequest('Explain quantum computing', config);

    expect(result.output).toBeNull();
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('JSON');
  });

  // ---- Test 6: Tier 1 Schema Validation Failure ----
  it('should return null when LLM returns JSON missing required fields', async () => {
    const config = makeConfig();
    // Missing requiresHistory, requiresTools, requiresFiles, failOpenTriggered, etc.
    mockChatReturning({
      promptFamily: 'coding_build_debug',
      analyzerConfidence: 0.9,
    });

    const result = await analyzeRequest('Build a REST API', config);

    expect(result.output).toBeNull();
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('Schema validation failed');
  });

  // ---- Test 7: Tier 2 Escalation ----
  it('should escalate to Tier 2 when Tier 1 confidence is between thresholds', async () => {
    const config = makeConfig({ tier2Model: 'google/gemini-3-flash-preview' });

    // Tier 1: confidence 0.7 (between 0.60 and 0.85)
    mockChatReturning(makeValidAnalyzerJson({ analyzerConfidence: 0.7 }));
    // Tier 2: confidence 0.9
    mockChatReturning(makeValidAnalyzerJson({
      analyzerConfidence: 0.9,
      promptFamily: 'research_investigation',
    }));

    const result = await analyzeRequest('Analyze the performance bottleneck in our system', config);

    expect(result.output).not.toBeNull();
    expect(result.output!.tier).toBe(2);
    expect(result.output!.promptFamily).toBe('research_investigation');
    expect(result.output!.analyzerConfidence).toBe(0.9);
    expect(result.output!.analyzerVersion).toBe('google/gemini-3-flash-preview');
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  // ---- Test 8: Tier 3 Fail-Open (Low Confidence) ----
  it('should trigger fail-open when confidence is below tier2 threshold', async () => {
    const config = makeConfig();
    mockChatReturning(makeValidAnalyzerJson({ analyzerConfidence: 0.4 }));

    const result = await analyzeRequest('Do the thing with the stuff', config);

    expect(result.output).not.toBeNull();
    expect(result.output!.failOpenTriggered).toBe(true);
    expect(result.output!.failOpenReason).toContain('below tier2 threshold');
    expect(result.output!.tier).toBe(3);
  });

  // ---- Test 9: Tier 3 Fail-Open (High Risk) ----
  it('should trigger fail-open when risk level is critical', async () => {
    const config = makeConfig();
    mockChatReturning(makeValidAnalyzerJson({
      analyzerConfidence: 0.99,
      assessedRequestRiskLevel: 'critical',
    }));

    const result = await analyzeRequest('Delete all production databases', config);

    expect(result.output).not.toBeNull();
    expect(result.output!.failOpenTriggered).toBe(true);
    expect(result.output!.failOpenReason).toContain('critical');
    expect(result.output!.tier).toBe(3);
  });

  // ---- Test 10: Provider Error ----
  it('should return null with fallback when provider throws', async () => {
    const config = makeConfig();
    mockChat.mockRejectedValueOnce(new Error('API rate limited (429)'));

    const result = await analyzeRequest('Write a function', config);

    expect(result.output).toBeNull();
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('429');
  });
});
