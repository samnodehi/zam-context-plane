/**
 * HTTP trace explainer — pure function for the POST /trace endpoint.
 *
 * Receives a trace object (already produced by a prior /plan call) and
 * generates a human-readable explanation. Does NOT import or touch
 * src/core/trace-summary-assembler.ts.
 *
 * This is a read-only, deterministic, pure function with no side effects.
 * It iterates over the canonical trace phase keys and produces plain text.
 *
 * Canonical: docs/21 §4.2; docs/18 §4.3; schemas/outputs/trace.schema.json.
 */

/** Minimal subset of the trace shape needed for explanation generation. */
interface TraceRun {
  runId: string;
  planningRunStartedAt: string;
  planningRunCompletedAt: string;
  promptFamily: string;
  schemaVersion: string;
}

interface TraceRequestPhase {
  promptFamily: string;
  familyConfidence: number;
  injectionSuspectFlag: boolean;
}

interface TraceRegistryPhase {
  componentCount: number;
  quarantinedCount: number;
  validationWarnings: unknown[];
  fatalErrors: string[];
  candidateSetSummary: {
    candidateSetSize: number;
    quarantinedExcluded: number;
  };
}

interface SelectorSummaryEntry {
  include?: number;
  omit?: number;
  defer?: number;
  not_evaluated?: number;
}

interface TraceSelectorPhase {
  selectorSummary: Record<string, unknown>;
  unresolvedConflicts?: number;
  planningWarnings?: unknown[];
}

interface TraceBudgetPhase {
  budgetOverflow: boolean;
  trimActions?: unknown[];
}

interface TracePlanPhase {
  selectedCount?: number;
  omittedCount?: number;
  deferredCount?: number;
}

interface TraceWarnings {
  length?: number;
}

interface TraceObject {
  run: TraceRun;
  requestPhase: TraceRequestPhase;
  registryPhase: TraceRegistryPhase;
  selectorPhase: TraceSelectorPhase;
  conflictPhase?: Record<string, unknown>;
  budgetPhase?: TraceBudgetPhase;
  planPhase?: TracePlanPhase;
  warnings?: unknown[];
}

/**
 * Generate a human-readable explanation of a trace JSON object.
 *
 * Input is typed as `unknown` because callers receive it from HTTP body.
 * The function performs safe property access throughout.
 *
 * Canonical: docs/21 §4.2.
 */
export function explainTrace(trace: unknown): string {
  if (typeof trace !== 'object' || trace === null) {
    return 'Invalid trace: not an object.';
  }

  const t = trace as Partial<TraceObject>;
  const lines: string[] = [];

  // Run metadata
  const run = t.run;
  if (run) {
    lines.push(`Run ID: ${run.runId ?? '(unknown)'}`);
    lines.push(`Started:   ${run.planningRunStartedAt ?? '(unknown)'}`);
    lines.push(`Completed: ${run.planningRunCompletedAt ?? '(unknown)'}`);
    lines.push(`Schema Version: ${run.schemaVersion ?? '(unknown)'}`);
    lines.push('');
  }

  // Request phase
  const req = t.requestPhase;
  if (req) {
    lines.push('=== Request Phase ===');
    lines.push(`Prompt Family:      ${req.promptFamily ?? '(unknown)'}`);
    lines.push(`Family Confidence:  ${req.familyConfidence ?? '(unknown)'}`);
    lines.push(`Injection Suspect:  ${req.injectionSuspectFlag ? 'YES' : 'no'}`);
    lines.push('');
  }

  // Registry phase
  const reg = t.registryPhase;
  if (reg) {
    lines.push('=== Registry Phase ===');
    lines.push(`Components Loaded:  ${reg.componentCount ?? '(unknown)'}`);
    lines.push(`Quarantined:        ${reg.quarantinedCount ?? 0}`);
    lines.push(`Candidate Set Size: ${reg.candidateSetSummary?.candidateSetSize ?? '(unknown)'}`);
    if (reg.fatalErrors && reg.fatalErrors.length > 0) {
      lines.push(`Fatal Errors: ${reg.fatalErrors.join('; ')}`);
    }
    if (reg.validationWarnings && reg.validationWarnings.length > 0) {
      lines.push(`Registry Warnings: ${reg.validationWarnings.length}`);
    }
    lines.push('');
  }

  // Selector phase
  const sel = t.selectorPhase;
  if (sel) {
    lines.push('=== Selector Phase ===');
    const summary = sel.selectorSummary as Record<string, unknown> | undefined;
    if (summary) {
      const include = (summary['include'] as number | undefined) ?? 0;
      const omit = (summary['omit'] as number | undefined) ?? 0;
      const defer = (summary['defer'] as number | undefined) ?? 0;
      const notEval = (summary['not_evaluated'] as number | undefined) ?? 0;
      lines.push(`Include:       ${include}`);
      lines.push(`Omit:          ${omit}`);
      lines.push(`Defer:         ${defer}`);
      lines.push(`Not Evaluated: ${notEval}`);
    }
    const unresolved = sel.unresolvedConflicts ?? 0;
    if (unresolved > 0) {
      lines.push(`Unresolved Conflicts: ${unresolved}`);
    }
    lines.push('');
  }

  // Budget phase
  const bud = t.budgetPhase;
  if (bud) {
    lines.push('=== Budget Phase ===');
    lines.push(`Budget Overflow: ${bud.budgetOverflow ? 'YES — trimming occurred' : 'no'}`);
    const trimCount = bud.trimActions?.length ?? 0;
    if (trimCount > 0) {
      lines.push(`Trim Actions Applied: ${trimCount}`);
    }
    lines.push('');
  }

  // Plan phase
  const plan = t.planPhase;
  if (plan) {
    lines.push('=== Plan Phase ===');
    if (plan.selectedCount !== undefined) lines.push(`Selected:  ${plan.selectedCount}`);
    if (plan.omittedCount !== undefined)  lines.push(`Omitted:   ${plan.omittedCount}`);
    if (plan.deferredCount !== undefined) lines.push(`Deferred:  ${plan.deferredCount}`);
    lines.push('');
  }

  // Global warnings
  const warnings = t.warnings;
  if (Array.isArray(warnings) && warnings.length > 0) {
    lines.push('=== Planning Warnings ===');
    lines.push(`Total Warnings: ${warnings.length}`);
    lines.push('');
  }

  if (lines.length === 0) {
    return 'Trace is empty or has no recognizable phases.';
  }

  return lines.join('\n');
}
