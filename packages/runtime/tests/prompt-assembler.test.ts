// ============================================================================
// Tests — Prompt Assembler
// ============================================================================

import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt-assembler.js';
import type { PromptPlan } from '../src/types.js';

describe('assemblePrompt', () => {
  it('should convert selectedComponents into messages', () => {
    const plan: PromptPlan = {
      selectedComponents: [
        { id: 'sys', content: 'You are an assistant.', role: 'system' },
        { id: 'req', content: 'What is 2+2?', role: 'user' },
      ],
    };

    const result = assemblePrompt(plan);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are an assistant.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'What is 2+2?' });
  });

  it('should default to system role when no role specified', () => {
    const plan: PromptPlan = {
      selectedComponents: [
        { id: 'c1', content: 'Some instructions' },
      ],
    };

    const result = assemblePrompt(plan);

    expect(result.messages[0].role).toBe('system');
  });

  it('should return empty tools array when no selectedTools', () => {
    const plan: PromptPlan = {
      selectedComponents: [
        { id: 'c1', content: 'test' },
      ],
    };

    const result = assemblePrompt(plan);
    expect(result.tools).toEqual([]);
  });

  it('should generate cache hints from cacheStability', () => {
    const plan: PromptPlan = {
      selectedComponents: [
        { id: 'c1', content: 'stable content', cacheStability: 'stable' },
        { id: 'c2', content: 'volatile content', cacheStability: 'volatile' },
      ],
    };

    const result = assemblePrompt(plan);

    expect(result.cacheHints).toHaveLength(2);
    expect(result.cacheHints[0]).toEqual({ messageIndex: 0, stability: 'stable' });
    expect(result.cacheHints[1]).toEqual({ messageIndex: 1, stability: 'volatile' });
  });

  it('should not generate cache hints when cacheStability is absent', () => {
    const plan: PromptPlan = {
      selectedComponents: [
        { id: 'c1', content: 'no stability info' },
      ],
    };

    const result = assemblePrompt(plan);
    expect(result.cacheHints).toHaveLength(0);
  });

  it('should preserve stable → session → volatile ordering', () => {
    const plan: PromptPlan = {
      selectedComponents: [
        { id: 's1', content: 'stable', role: 'system', cacheStability: 'stable' },
        { id: 's2', content: 'session', role: 'system', cacheStability: 'session' },
        { id: 'v1', content: 'volatile', role: 'user', cacheStability: 'volatile' },
      ],
    };

    const result = assemblePrompt(plan);

    // Messages should maintain input order
    expect(result.messages[0].content).toBe('stable');
    expect(result.messages[1].content).toBe('session');
    expect(result.messages[2].content).toBe('volatile');
  });

  it('should handle empty selectedComponents', () => {
    const plan: PromptPlan = { selectedComponents: [] };
    const result = assemblePrompt(plan);
    expect(result.messages).toEqual([]);
    expect(result.cacheHints).toEqual([]);
  });

  it('should map assistant role correctly', () => {
    const plan: PromptPlan = {
      selectedComponents: [
        { id: 'a1', content: 'previous assistant response', role: 'assistant' },
      ],
    };

    const result = assemblePrompt(plan);
    expect(result.messages[0].role).toBe('assistant');
  });

  // -------------------------------------------------------------------------
  // Phase R3 tests: selectedTools mapping
  // -------------------------------------------------------------------------

  it('should map selectedTools into provider tool definitions', () => {
    const plan: PromptPlan = {
      selectedComponents: [
        { id: 'c1', content: 'test' },
      ],
      selectedTools: [
        { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
        { name: 'write_file', description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
      ],
    };

    const result = assemblePrompt(plan);

    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].name).toBe('read_file');
    expect(result.tools[0].description).toBe('Read a file');
    expect(result.tools[0].parameters).toEqual({ type: 'object', properties: { path: { type: 'string' } } });
    expect(result.tools[1].name).toBe('write_file');
  });

  it('should return empty tools for empty selectedTools array', () => {
    const plan: PromptPlan = {
      selectedComponents: [{ id: 'c1', content: 'test' }],
      selectedTools: [],
    };

    const result = assemblePrompt(plan);
    expect(result.tools).toEqual([]);
  });

  it('should return empty tools when selectedTools is undefined', () => {
    const plan: PromptPlan = {
      selectedComponents: [{ id: 'c1', content: 'test' }],
    };

    const result = assemblePrompt(plan);
    expect(result.tools).toEqual([]);
  });

  it('should handle tools with missing optional fields', () => {
    const plan: PromptPlan = {
      selectedComponents: [{ id: 'c1', content: 'test' }],
      selectedTools: [
        { name: 'minimal_tool' },
      ],
    };

    const result = assemblePrompt(plan);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('minimal_tool');
    expect(result.tools[0].description).toBe('');
    expect(result.tools[0].parameters).toEqual({});
  });
});
