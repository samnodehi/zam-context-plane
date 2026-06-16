/**
 * Phase P11: History Compressor Integrator. [FUTURE-ONLY]
 *
 * Converts a pre-generated HistoryCompressorOutput (representing structured
 * state extracted by a model-assisted History Compressor) into a SummaryPhase
 * trace object that can be conditionally included in trace.json.
 *
 * WHAT THIS MODULE DOES:
 *   - Accepts a validated HistoryCompressorOutput.
 *   - Maps the 11 state extraction categories into the SummaryPhase trace
 *     structure (included/omitted/uncertain/protectedCategories).
 *   - Enforces that protected categories (docs/13 §10, docs/14 §4) never
 *     appear in the omitted[] array.
 *   - Returns a CompressorIntegratorResult with the SummaryPhase trace and
 *     any safety warnings.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - It does NOT call any LLM or model provider.
 *   - It does NOT bypass deterministic guardrails.
 *   - It does NOT validate or modify any MVP schemas or fixtures.
 *   - It does NOT mutate any existing pipeline state.
 *   - It does NOT implement the history compressor itself.
 *
 * SAFETY INVARIANT:
 *   Protected categories (currentTaskState, acceptedDecisions, openCommitments,
 *   userConstraints, antiRegressionRules, durableFacts) must NEVER appear in
 *   the summaryPhase.omitted[] array. If the compressor's summaryTrace.omitted
 *   lists a protected category, it is moved to summaryPhase.uncertain[] with
 *   a safety warning, preserving the fail-open guarantee (docs/13 §10;
 *   docs/14 §4, §6).
 *
 * Canonical: docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §10;
 *            docs/14_SUMMARY_QUALITY_HARNESS_SCOPING.md §4, §7;
 *            docs/16_TRACE_EXTENSIONS_SCOPING.md §6.2;
 *            schemas/future/history-compressor-output.schema.json;
 *            schemas/outputs/trace.schema.json summaryPhase.
 */

import type { HistoryCompressorOutput, StateItem } from '../types/compressor.js';
import type {
  SummaryPhase,
  SummaryPhaseIncludedItem,
  SummaryPhaseOmittedItem,
} from '../types/trace.js';
import type { PlanningWarning } from '../types/warnings.js';

// ---------------------------------------------------------------------------
// Protected categories (docs/13 §10 "Protected from Compression" table)
// ---------------------------------------------------------------------------

/**
 * Categories that must NEVER be omitted by a history compressor.
 *
 * If the compressor's summaryTrace.omitted references any of these, the
 * integrator must move them to uncertain[] and emit a warning.
 *
 * Canonical: docs/13 §10 "Protected from Compression" table.
 */
export const PROTECTED_CATEGORIES: ReadonlySet<string> = new Set([
  'currentTaskState',
  'acceptedDecisions',
  'openCommitments',
  'userConstraints',
  'antiRegressionRules',
  'durableFacts',
]);

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * The result of integrateCompressorOutput().
 *
 * summaryPhase:  The SummaryPhase trace object for trace.json.
 * warnings:      Planning warnings emitted (e.g., protected category violations).
 */
export interface CompressorIntegratorResult {
  summaryPhase: SummaryPhase;
  warnings: PlanningWarning[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an included item from a state category name and its items.
 *
 * Each non-empty StateItem[] category produces one SummaryPhaseIncludedItem
 * with the category name, a description summarizing item count, and the
 * compressorTraceId as the source reference.
 */
function buildIncludedItem(
  category: string,
  items: StateItem[],
  compressorTraceId: string,
): SummaryPhaseIncludedItem {
  return {
    category,
    description: `${items.length} item(s) extracted by compressor`,
    sourceReference: compressorTraceId,
  };
}

/**
 * All 11 state extraction categories from HistoryCompressorOutput,
 * in canonical order (docs/13 §10 table order).
 */
const ALL_CATEGORIES: readonly string[] = [
  'currentTaskState',
  'acceptedDecisions',
  'openIssues',
  'openCommitments',
  'userConstraints',
  'importantFilesPaths',
  'failedAttempts',
  'warnings',
  'antiRegressionRules',
  'recentRelevantTurns',
  'durableFacts',
];

/**
 * Get the StateItem[] for a category from the HistoryCompressorOutput.
 * currentTaskState is a single object — we wrap it in an array for
 * uniform processing.
 */
function getCategoryItems(
  output: HistoryCompressorOutput,
  category: string,
): StateItem[] {
  switch (category) {
    case 'currentTaskState':
      // currentTaskState is a single object, not an array. Wrap it.
      return [{ content: output.currentTaskState.activeTask }];
    case 'acceptedDecisions':
      return output.acceptedDecisions;
    case 'openIssues':
      return output.openIssues;
    case 'openCommitments':
      return output.openCommitments;
    case 'userConstraints':
      return output.userConstraints;
    case 'importantFilesPaths':
      return output.importantFilesPaths;
    case 'failedAttempts':
      return output.failedAttempts;
    case 'warnings':
      return output.warnings;
    case 'antiRegressionRules':
      return output.antiRegressionRules;
    case 'recentRelevantTurns':
      return output.recentRelevantTurns;
    case 'durableFacts':
      return output.durableFacts;
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Main integrator function
// ---------------------------------------------------------------------------

/**
 * Convert a pre-generated HistoryCompressorOutput into a SummaryPhase trace
 * object suitable for conditional inclusion in trace.json.
 *
 * Mapping strategy:
 *   1. For each of the 11 state categories, check if items are non-empty.
 *      Non-empty categories → included[].
 *   2. Map summaryTrace.omitted → omitted[], but enforce protected category
 *      safety: any protected category in omitted[] is moved to uncertain[]
 *      with a warning.
 *   3. Map summaryTrace.uncertain → uncertain[].
 *   4. protectedCategories is the static set of always-protected categories.
 *   5. summaryTraceId = compressorTraceId.
 *
 * @param compressorOutput  The AJV-validated HistoryCompressorOutput object.
 * @returns                 CompressorIntegratorResult with summaryPhase and warnings.
 */
export function integrateCompressorOutput(
  compressorOutput: HistoryCompressorOutput,
): CompressorIntegratorResult {
  const warnings: PlanningWarning[] = [];

  // -------------------------------------------------------------------------
  // Step 1: Build included[] from non-empty state categories.
  // -------------------------------------------------------------------------
  const included: SummaryPhaseIncludedItem[] = [];

  for (const category of ALL_CATEGORIES) {
    const items = getCategoryItems(compressorOutput, category);
    if (items.length > 0) {
      included.push(buildIncludedItem(category, items, compressorOutput.compressorTraceId));
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Map summaryTrace.omitted → omitted[], enforcing protected
  //         category safety.
  //
  // SAFETY INVARIANT: Protected categories must NEVER appear in omitted[].
  // If the compressor listed a protected category as omitted, the integrator
  // moves it to uncertain[] and emits a warning. This preserves fail-open
  // safety (docs/14 §4; docs/13 §10).
  // -------------------------------------------------------------------------
  const omitted: SummaryPhaseOmittedItem[] = [];
  const uncertain: SummaryPhaseOmittedItem[] = [];

  for (const omittedCategory of compressorOutput.summaryTrace.omitted) {
    if (PROTECTED_CATEGORIES.has(omittedCategory)) {
      // SAFETY: Move to uncertain instead of omitted.
      uncertain.push({
        category: omittedCategory,
        reason: `Protected category '${omittedCategory}' was listed as omitted by compressor but was moved to uncertain by safety enforcement (docs/13 §10, docs/14 §4).`,
      });
      warnings.push({
        code: 'compressor_protected_category_violation',
        message:
          `History compressor (version: ${compressorOutput.compressorVersion}) attempted to omit ` +
          `protected category '${omittedCategory}'. Moved to uncertain[] for fail-open safety. ` +
          `Protected categories must never be omitted (docs/13 §10; docs/14 §4).`,
      });
    } else {
      omitted.push({
        category: omittedCategory,
        reason: `Deliberately excluded by compressor (version: ${compressorOutput.compressorVersion}).`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Map summaryTrace.uncertain → uncertain[].
  // -------------------------------------------------------------------------
  for (const uncertainCategory of compressorOutput.summaryTrace.uncertain) {
    uncertain.push({
      category: uncertainCategory,
      reason: `Compressor was not confident about retaining or omitting (version: ${compressorOutput.compressorVersion}).`,
    });
  }

  // -------------------------------------------------------------------------
  // Step 4: Build protectedCategories from the static set.
  // -------------------------------------------------------------------------
  const protectedCategories: string[] = [...PROTECTED_CATEGORIES];

  // -------------------------------------------------------------------------
  // Step 5: Assemble SummaryPhase.
  // -------------------------------------------------------------------------
  const summaryPhase: SummaryPhase = {
    compressorVersion: compressorOutput.compressorVersion,
    included,
    omitted,
    uncertain,
    protectedCategories,
    summaryTraceId: compressorOutput.compressorTraceId,
  };

  return { summaryPhase, warnings };
}
