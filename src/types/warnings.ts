/**
 * PlanningWarning — in-memory accumulator for Phase 1 Class B fallback events.
 *
 * Warnings are collected inside LoadedInputs.warnings[] and printed to stderr
 * for development visibility. They are NOT written to disk in Phase 1.
 * trace.json assembly (Phase 11) will consume this array.
 *
 * Shape mirrors schemas/shared/warning-code.schema.json but adds an optional
 * context field for structured loader diagnostics.
 */
export interface PlanningWarning {
  /** Machine-readable warning code, e.g. 'selector_policy_defaulted'. */
  code: string;
  /** Human-readable explanation. Must not contain raw component or history content. */
  message: string;
  /** Optional structured context for diagnostics. Not written to trace in Phase 1. */
  context?: Record<string, unknown>;
}
