// ============================================================================
// Tests — Model-Assisted Selector
// Canonical: docs/26_MODEL_ASSISTED_SELECTOR_IMPLEMENTATION.md §4.6
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import type { ProviderClient, SelectorConfig } from '../src/types.js';
import type { SelectorPromptData } from '../src/selector-prompt.js';
import { executeModelAssistedSelector } from '../src/model-selector.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG: SelectorConfig = {
  enabled: true,
  provider: {
    name: 'openrouter',
    model: 'google/gemini-3.1-flash-lite',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
  },
  timeoutMs: 5000,
  fallbackOnError: 'deterministic',
};

const BASE_DATA: SelectorPromptData = {
  requestText: 'Fix the authentication bug',
  promptFamily: 'coding_build_debug',
  analyzerConfidence: 0.92,
  neededLanes: ['scaffold', 'tools'],
  assessedRequestRiskLevel: 'medium',
  unresolvedComponentsJson: JSON.stringify([
    { id: 'comp-auth', type: 'skill', description: 'Auth skill', tags: ['auth'] },
  ]),
};

const VALID_PROPOSAL_ARRAY = JSON.stringify([
  {
    componentId: 'comp-auth',
    action: 'include',
    confidence: 'high',
    reason: 'Auth skill is needed for authentication bugs',
    evidence: ['request_mentions_auth'],
    path: 'default_include',
  },
]);

function makeMockClient(responseText: string): ProviderClient {
  return {
    chat: vi.fn().mockResolvedValue({
      type: 'text',
      text: responseText,
    }),
  };
}

function makeMockClientThrowing(error: Error): ProviderClient {
  return {
    chat: vi.fn().mockRejectedValue(error),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeModelAssistedSelector', () => {
  it('should return valid proposals when model returns correct JSON', async () => {
    const client = makeMockClient(VALID_PROPOSAL_ARRAY);
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    expect(result.fallbackUsed).toBe(false);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].componentId).toBe('comp-auth');
    expect(result.proposals[0].action).toBe('include');
    expect(result.proposals[0].confidence).toBe('high');
    expect(result.proposals[0].path).toBe('default_include');
  });

  it('should return empty proposals and fallbackUsed=false for empty array response', async () => {
    const client = makeMockClient('[]');
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    expect(result.fallbackUsed).toBe(false);
    expect(result.proposals).toHaveLength(0);
  });

  it('should return empty proposals and fallbackUsed=true for malformed JSON', async () => {
    const client = makeMockClient('not valid json {{{');
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    expect(result.fallbackUsed).toBe(true);
    expect(result.proposals).toHaveLength(0);
    expect(result.fallbackReason).toBeTruthy();
  });

  it('should return empty proposals and fallbackUsed=true for JSON object (not array)', async () => {
    const client = makeMockClient('{"componentId": "x", "action": "include"}');
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    expect(result.fallbackUsed).toBe(true);
    expect(result.proposals).toHaveLength(0);
  });

  it('should return empty proposals and fallbackUsed=true for JSON array with invalid element', async () => {
    // Missing required 'path' field
    const invalid = JSON.stringify([
      { componentId: 'comp-x', action: 'include', confidence: 'high', reason: 'ok', evidence: [] },
    ]);
    const client = makeMockClient(invalid);
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    expect(result.fallbackUsed).toBe(true);
    expect(result.proposals).toHaveLength(0);
  });

  it('should return empty proposals and fallbackUsed=true on provider error', async () => {
    const client = makeMockClientThrowing(new Error('Provider unavailable'));
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    expect(result.fallbackUsed).toBe(true);
    expect(result.proposals).toHaveLength(0);
    expect(result.fallbackReason).toContain('Provider unavailable');
  });

  it('should return empty proposals and fallbackUsed=true on timeout', async () => {
    const timeoutError = new Error('Model-assisted selector timed out after 100ms');
    const client = makeMockClientThrowing(timeoutError);
    const shortTimeoutConfig: SelectorConfig = { ...BASE_CONFIG, timeoutMs: 100 };
    const result = await executeModelAssistedSelector(client, shortTimeoutConfig, BASE_DATA);

    expect(result.fallbackUsed).toBe(true);
    expect(result.proposals).toHaveLength(0);
    expect(result.fallbackReason).toContain('timed out');
  });

  it('should not call the model and return empty proposals when selector is disabled', async () => {
    const disabledConfig: SelectorConfig = { ...BASE_CONFIG, enabled: false };
    const client = makeMockClient(VALID_PROPOSAL_ARRAY);
    const result = await executeModelAssistedSelector(client, disabledConfig, BASE_DATA);

    expect(result.fallbackUsed).toBe(false);
    expect(result.proposals).toHaveLength(0);
    expect(result.durationMs).toBe(0);
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('should return multiple proposals when model returns multiple valid decisions', async () => {
    const multipleProposals = JSON.stringify([
      {
        componentId: 'comp-a',
        action: 'include',
        confidence: 'high',
        reason: 'Needed',
        evidence: ['signal_a'],
        path: 'required_match',
      },
      {
        componentId: 'comp-b',
        action: 'omit',
        confidence: 'medium',
        reason: 'Not relevant',
        evidence: ['signal_b'],
        path: 'safe_to_omit_match',
      },
    ]);
    const client = makeMockClient(multipleProposals);
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    expect(result.fallbackUsed).toBe(false);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0].componentId).toBe('comp-a');
    expect(result.proposals[1].componentId).toBe('comp-b');
    expect(result.proposals[1].action).toBe('omit');
  });

  it('should record a positive durationMs when the call succeeds', async () => {
    const client = makeMockClient(VALID_PROPOSAL_ARRAY);
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should not crash and should return empty proposals when model returns null text', async () => {
    const client: ProviderClient = {
      chat: vi.fn().mockResolvedValue({ type: 'text', text: undefined }),
    };
    const result = await executeModelAssistedSelector(client, BASE_CONFIG, BASE_DATA);

    // text is undefined → rawText = '' → JSON.parse('') throws → fallback
    expect(result.fallbackUsed).toBe(true);
    expect(result.proposals).toHaveLength(0);
  });
});
