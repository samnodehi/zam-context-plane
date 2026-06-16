// ============================================================================
// Tests — Selector Prompt Builder
// Canonical: docs/26_MODEL_ASSISTED_SELECTOR_IMPLEMENTATION.md §4.5
// ============================================================================

import { describe, it, expect } from 'vitest';
import { buildSelectorPrompt, type SelectorPromptData } from '../src/selector-prompt.js';

const BASE_DATA: SelectorPromptData = {
  requestText: 'Fix the authentication bug in login.ts',
  promptFamily: 'coding_build_debug',
  analyzerConfidence: 0.92,
  neededLanes: ['scaffold', 'tools', 'files'],
  assessedRequestRiskLevel: 'medium',
  unresolvedComponentsJson: JSON.stringify([
    {
      id: 'comp-123',
      type: 'skill',
      description: 'Authentication helper skill',
      tags: ['auth', 'security'],
    },
  ]),
};

describe('buildSelectorPrompt', () => {
  it('should contain the required static opening line', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('You are a context selection advisor for an AI agent runtime.');
  });

  it('should interpolate requestText into the prompt', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('"Fix the authentication bug in login.ts"');
  });

  it('should interpolate promptFamily into the prompt', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('coding_build_debug');
  });

  it('should interpolate analyzerConfidence into the prompt', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('0.92');
  });

  it('should interpolate neededLanes as comma-separated string', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('scaffold, tools, files');
  });

  it('should interpolate assessedRequestRiskLevel into the prompt', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('medium');
  });

  it('should inject unresolvedComponentsJson directly into the prompt', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('comp-123');
    expect(prompt).toContain('Authentication helper skill');
  });

  it('should contain the ## Unresolved Components section header', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('## Unresolved Components');
  });

  it('should contain the ## Rules section header', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('## Rules');
  });

  it('should contain the fail-open instruction', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('When uncertain, prefer "include" (fail-open).');
  });

  it('should contain the safety-critical rule', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('Safety-critical, mandatory, and high-risk components should always be "include".');
  });

  it('should contain the JSON-only output instruction', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('Respond with ONLY the JSON array. No explanation, no markdown.');
  });

  it('should contain the required output fields instruction', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('componentId, action (include/omit/defer), confidence (high/medium/low), path, reason, evidence[]');
  });

  it('should handle empty neededLanes array gracefully', () => {
    const data: SelectorPromptData = {
      ...BASE_DATA,
      neededLanes: [],
    };
    const prompt = buildSelectorPrompt(data);
    expect(prompt).toContain('(none specified)');
    // Should still be a complete, valid prompt
    expect(prompt).toContain('You are a context selection advisor for an AI agent runtime.');
    expect(prompt).toContain('## Rules');
  });

  it('should handle empty unresolvedComponentsJson gracefully', () => {
    const data: SelectorPromptData = {
      ...BASE_DATA,
      unresolvedComponentsJson: '[]',
    };
    const prompt = buildSelectorPrompt(data);
    expect(prompt).toContain('[]');
    expect(prompt).toContain('## Rules');
  });

  it('should handle multiple unresolved components', () => {
    const components = [
      { id: 'comp-a', type: 'skill', description: 'Skill A', tags: ['a'] },
      { id: 'comp-b', type: 'tool', description: 'Tool B', tags: ['b'] },
    ];
    const data: SelectorPromptData = {
      ...BASE_DATA,
      unresolvedComponentsJson: JSON.stringify(components),
    };
    const prompt = buildSelectorPrompt(data);
    expect(prompt).toContain('comp-a');
    expect(prompt).toContain('comp-b');
  });

  it('should preserve request classification line format from §4.5', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    // Exact format from docs/26 §4.5: "Request classification: {family} (confidence: {conf})"
    expect(prompt).toContain('Request classification: coding_build_debug (confidence: 0.92)');
  });

  it('should preserve risk level line format from §4.5', () => {
    const prompt = buildSelectorPrompt(BASE_DATA);
    expect(prompt).toContain('Risk level: medium');
  });
});
