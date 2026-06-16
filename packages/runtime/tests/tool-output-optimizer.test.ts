// ============================================================================
// Tests — Tool Output Optimizer
// ============================================================================

import { describe, it, expect } from 'vitest';
import { LocalToolOutputOptimizer, DEFAULT_OPTIMIZER_CONFIG } from '../src/tool-output-optimizer.js';
import type { ToolObservation } from '../src/types.js';

function makeObservation(output: string): ToolObservation {
  return {
    callId: 'test-call',
    success: true,
    output,
    durationMs: 10,
  };
}

describe('LocalToolOutputOptimizer', () => {
  const optimizer = new LocalToolOutputOptimizer();

  // -------------------------------------------------------------------------
  // Default config
  // -------------------------------------------------------------------------

  describe('DEFAULT_OPTIMIZER_CONFIG', () => {
    it('has correct defaults from docs/24 §3.8', () => {
      expect(DEFAULT_OPTIMIZER_CONFIG.maxOutputLines).toBe(100);
      expect(DEFAULT_OPTIMIZER_CONFIG.maxOutputChars).toBe(10000);
      expect(DEFAULT_OPTIMIZER_CONFIG.stripAnsiCodes).toBe(true);
      expect(DEFAULT_OPTIMIZER_CONFIG.errorExtractionMode).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pass-through for small output
  // -------------------------------------------------------------------------

  describe('small output', () => {
    it('passes through short output unchanged', () => {
      const result = optimizer.optimize(makeObservation('Hello, World!'));

      expect(result.content).toBe('Hello, World!');
      expect(result.truncated).toBe(false);
      expect(result.originalChars).toBe(13);
      expect(result.originalLines).toBe(1);
    });

    it('preserves empty output', () => {
      const result = optimizer.optimize(makeObservation(''));

      expect(result.content).toBe('');
      expect(result.truncated).toBe(false);
      expect(result.originalChars).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // ANSI stripping
  // -------------------------------------------------------------------------

  describe('ANSI stripping', () => {
    it('strips ANSI color codes', () => {
      const ansiText = '\x1B[31mError:\x1B[0m something failed';
      const result = optimizer.optimize(makeObservation(ansiText));

      expect(result.content).toBe('Error: something failed');
      expect(result.truncated).toBe(false);
    });

    it('strips cursor movement codes', () => {
      const ansiText = '\x1B[2A\x1B[3Bhello';
      const result = optimizer.optimize(makeObservation(ansiText));

      expect(result.content).toBe('hello');
    });

    it('preserves text when stripping disabled', () => {
      const ansiText = '\x1B[31mRed\x1B[0m';
      const result = optimizer.optimize(makeObservation(ansiText), {
        ...DEFAULT_OPTIMIZER_CONFIG,
        stripAnsiCodes: false,
      });

      expect(result.content).toBe(ansiText);
    });
  });

  // -------------------------------------------------------------------------
  // Whitespace normalization
  // -------------------------------------------------------------------------

  describe('whitespace normalization', () => {
    it('collapses 3+ consecutive blank lines into 1', () => {
      const text = 'line1\n\n\n\nline2\n\n\n\n\nline3';
      const result = optimizer.optimize(makeObservation(text));

      expect(result.content).toBe('line1\n\nline2\n\nline3');
    });

    it('preserves single blank lines', () => {
      const text = 'line1\n\nline2';
      const result = optimizer.optimize(makeObservation(text));

      expect(result.content).toBe('line1\n\nline2');
    });
  });

  // -------------------------------------------------------------------------
  // Line truncation
  // -------------------------------------------------------------------------

  describe('line truncation', () => {
    it('truncates output exceeding maxOutputLines with summary+tail', () => {
      // Create 200 lines
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
      const text = lines.join('\n');

      const result = optimizer.optimize(makeObservation(text));

      expect(result.truncated).toBe(true);
      expect(result.originalLines).toBe(200);
      // Should contain first 10 lines
      expect(result.content).toContain('line 1');
      expect(result.content).toContain('line 10');
      // Should contain summary marker
      expect(result.content).toContain('lines omitted');
      // Should contain last 20 lines
      expect(result.content).toContain('line 181');
      expect(result.content).toContain('line 200');
    });

    it('does not truncate output within limit', () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
      const text = lines.join('\n');

      const result = optimizer.optimize(makeObservation(text));

      expect(result.truncated).toBe(false);
      expect(result.originalLines).toBe(50);
    });

    it('respects custom maxOutputLines', () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      const text = lines.join('\n');

      const result = optimizer.optimize(makeObservation(text), {
        ...DEFAULT_OPTIMIZER_CONFIG,
        maxOutputLines: 5,
      });

      expect(result.truncated).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Character truncation
  // -------------------------------------------------------------------------

  describe('character truncation', () => {
    it('truncates output exceeding maxOutputChars', () => {
      // Create a string longer than 10000 chars
      const longText = 'x'.repeat(15000);
      const result = optimizer.optimize(makeObservation(longText));

      expect(result.truncated).toBe(true);
      expect(result.originalChars).toBe(15000);
      expect(result.content.length).toBeLessThanOrEqual(10000 + 60); // + truncation marker
      expect(result.content).toContain('truncated');
    });

    it('does not truncate output within character limit', () => {
      const text = 'x'.repeat(5000);
      const result = optimizer.optimize(makeObservation(text));

      expect(result.truncated).toBe(false);
      expect(result.originalChars).toBe(5000);
    });

    it('respects custom maxOutputChars', () => {
      const text = 'x'.repeat(200);
      const result = optimizer.optimize(makeObservation(text), {
        ...DEFAULT_OPTIMIZER_CONFIG,
        maxOutputChars: 50,
      });

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBeLessThanOrEqual(50 + 60);
    });
  });

  // -------------------------------------------------------------------------
  // Metadata preservation
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('preserves original line count after truncation', () => {
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
      const result = optimizer.optimize(makeObservation(lines.join('\n')));

      expect(result.originalLines).toBe(200);
    });

    it('preserves original char count after truncation', () => {
      const text = 'x'.repeat(15000);
      const result = optimizer.optimize(makeObservation(text));

      expect(result.originalChars).toBe(15000);
    });
  });
});
