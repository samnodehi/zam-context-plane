// ============================================================================
// Tests — Analyzer Prompt Templates
// Phase M1-B. Canonical: docs/25 §6.3, §6.5.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { buildTier1AnalyzerPrompt, buildTier2AnalyzerPrompt } from '../src/analyzer-prompt.js';

describe('buildTier1AnalyzerPrompt', () => {
  const REQUEST = 'Please fix the bug in src/utils.ts where the date parser crashes on leap years.';

  it('should contain the user request text', () => {
    const prompt = buildTier1AnalyzerPrompt(REQUEST);
    expect(prompt).toContain(REQUEST);
  });

  it('should contain the required JSON schema fields', () => {
    const prompt = buildTier1AnalyzerPrompt(REQUEST);
    const requiredFields = [
      'promptFamily',
      'requestType',
      'taskType',
      'analyzerConfidence',
      'assessedRequestRiskLevel',
      'neededLanes',
      'requiresHistory',
      'requiresTools',
      'requiresFiles',
      'evidence',
    ];
    for (const field of requiredFields) {
      expect(prompt).toContain(`"${field}"`);
    }
  });

  it('should contain the accepted promptFamily enum values', () => {
    const prompt = buildTier1AnalyzerPrompt(REQUEST);
    const families = [
      'general_default',
      'simple_greeting',
      'coding_build_debug',
      'research_investigation',
      'ops_security_change_risk',
      'lifecycle_internal',
      'heartbeat_proactive',
      'group_chat_behavior',
      'tool_use_required',
      'history_sensitive',
    ];
    for (const family of families) {
      expect(prompt).toContain(family);
    }
  });

  it('should contain the classification rules', () => {
    const prompt = buildTier1AnalyzerPrompt(REQUEST);
    expect(prompt).toContain('Classification Rules');
    expect(prompt).toContain('simple greeting or acknowledgement');
    expect(prompt).toContain('coding_build_debug');
    expect(prompt).toContain('research_investigation');
    expect(prompt).toContain('ops_security_change_risk');
    expect(prompt).toContain('history_sensitive');
  });

  it('should contain the "Respond with ONLY" instruction', () => {
    const prompt = buildTier1AnalyzerPrompt(REQUEST);
    expect(prompt).toContain('Respond with ONLY the JSON object');
  });

  it('should contain the User Request section header', () => {
    const prompt = buildTier1AnalyzerPrompt(REQUEST);
    expect(prompt).toContain('## User Request');
  });
});

describe('buildTier2AnalyzerPrompt', () => {
  const REQUEST = 'Refactor the authentication module to use JWT tokens instead of sessions.';
  const TIER1_CLASSIFICATION = 'coding_build_debug';
  const TIER1_CONFIDENCE = 0.72;

  it('should contain the Tier 1 classification', () => {
    const prompt = buildTier2AnalyzerPrompt(REQUEST, TIER1_CLASSIFICATION, TIER1_CONFIDENCE);
    expect(prompt).toContain(`Classification: ${TIER1_CLASSIFICATION}`);
  });

  it('should contain the Tier 1 confidence value', () => {
    const prompt = buildTier2AnalyzerPrompt(REQUEST, TIER1_CLASSIFICATION, TIER1_CONFIDENCE);
    expect(prompt).toContain(`Confidence: ${TIER1_CONFIDENCE}`);
  });

  it('should contain the escalation context header', () => {
    const prompt = buildTier2AnalyzerPrompt(REQUEST, TIER1_CLASSIFICATION, TIER1_CONFIDENCE);
    expect(prompt).toContain('Tier 2 Escalation Context');
  });

  it('should contain the user request text', () => {
    const prompt = buildTier2AnalyzerPrompt(REQUEST, TIER1_CLASSIFICATION, TIER1_CONFIDENCE);
    expect(prompt).toContain(REQUEST);
  });

  it('should contain the full Tier 1 prompt content (schema fields and rules)', () => {
    const prompt = buildTier2AnalyzerPrompt(REQUEST, TIER1_CLASSIFICATION, TIER1_CONFIDENCE);
    // The Tier 2 prompt wraps the Tier 1 prompt, so it should have all schema fields
    expect(prompt).toContain('"promptFamily"');
    expect(prompt).toContain('"analyzerConfidence"');
    expect(prompt).toContain('Classification Rules');
    expect(prompt).toContain('Respond with ONLY the JSON object');
  });
});
