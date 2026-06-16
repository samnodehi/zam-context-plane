// ============================================================================
// ZAM Runtime — Tool Output Optimizer
// Canonical source: docs/24 §3.8
// Phase R3: Reshapes raw tool output for efficient LLM consumption.
// ============================================================================

import type {
  ToolOutputOptimizer as IToolOutputOptimizer,
  ToolObservation,
  OptimizerConfig,
  OptimizedOutput,
} from './types.js';

/**
 * Default optimizer configuration per docs/24 §3.8.
 */
export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  maxOutputLines: 100,
  maxOutputChars: 10000,
  stripAnsiCodes: true,
  errorExtractionMode: true,
};

/**
 * Regex to match ANSI escape codes (colors, cursor, formatting).
 */
const ANSI_REGEX = /\x1B\[[0-9;]*[A-Za-z]/g;

/**
 * LocalToolOutputOptimizer — reshapes raw tool output for LLM consumption.
 *
 * Per docs/24 §3.8 Optimization Rules:
 * - Line truncation: Cap at N lines
 * - Character truncation: Hard cap on total chars
 * - ANSI stripping: Remove escape codes
 * - Whitespace normalization: Collapse consecutive blank lines
 * - Summary + tail: For large outputs, show first 10 + last 20 lines
 *
 * Per docs/24 §3.8 Invariants:
 * - Never modifies semantic meaning — only formats and truncates.
 * - Truncation is clearly marked so the model knows information was removed.
 * - Original line/char counts are preserved in metadata.
 */
export class LocalToolOutputOptimizer implements IToolOutputOptimizer {
  optimize(observation: ToolObservation, config?: Partial<OptimizerConfig>): OptimizedOutput {
    const cfg: OptimizerConfig = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };

    const rawOutput = observation.output ?? '';
    const originalChars = rawOutput.length;

    // Step 1: Strip ANSI codes if enabled
    let processed = cfg.stripAnsiCodes ? rawOutput.replace(ANSI_REGEX, '') : rawOutput;

    // Step 2: Normalize whitespace — collapse consecutive blank lines into one
    processed = collapseBlankLines(processed);

    const originalLines = processed.split('\n').length;
    let truncated = false;

    // Step 3: Line truncation with summary+tail strategy
    const lines = processed.split('\n');
    if (lines.length > cfg.maxOutputLines) {
      truncated = true;
      const headCount = 10;
      const tailCount = 20;
      const omittedCount = lines.length - headCount - tailCount;

      if (omittedCount > 0 && lines.length > headCount + tailCount) {
        const head = lines.slice(0, headCount);
        const tail = lines.slice(-tailCount);
        processed = [
          ...head,
          `\n[... ${omittedCount} lines omitted ...]\n`,
          ...tail,
        ].join('\n');
      } else {
        // Not enough lines for summary+tail, just truncate
        processed = lines.slice(0, cfg.maxOutputLines).join('\n');
        processed += `\n[... truncated ${lines.length - cfg.maxOutputLines} remaining lines]`;
      }
    }

    // Step 4: Character truncation (hard cap)
    if (processed.length > cfg.maxOutputChars) {
      truncated = true;
      processed = processed.slice(0, cfg.maxOutputChars);
      processed += '\n[... truncated, output exceeded character limit]';
    }

    return {
      content: processed,
      truncated,
      originalLines,
      originalChars,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collapse consecutive blank lines into a single blank line.
 * Per docs/24 §3.8: "Whitespace normalization — Collapse consecutive blank lines into one."
 */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}
