/**
 * Phase 12: Harness zero-tolerance check functions.
 *
 * Pure module — no I/O, no AJV, no file reads/writes.
 * All functions receive already-parsed JS objects and return ZTCheckResult.
 *
 * ZT checks defined:
 *   ZT-01 — Schema-valid outputs (caller passes AJV result)
 *   ZT-02 — No unsafe omissions
 *   ZT-03 — No raw content in trace.json
 *   ZT-04 — inputDecisionIds traceability
 *   ZT-05 — fail_open_unresolved bi-directional invariant
 *   ZT-06 — No silent budget overflow
 *   ZT-07 — Candidate-set accounting
 *   ZT-08 — Partition exclusivity
 *   ZT-09 — deferredComponents[].path present
 *   ZT-10 — budget_trim not in selector/conflict paths
 *   ZT-11 — injection warning deduplicated
 *   ZT-12 — resolutionRule valid enum
 *   ZT-13 — selectorSummary.narrative matches template
 *   ZT-14 — All output files present
 *   ZT-15 — Successful fixture exits 0
 *   ZT-16 — Static expected schema-valid (Mode 1)
 *   ZT-17 — Static assertions.md present/non-empty (Mode 1)
 *   RG-01 — trimOrder[] excludes null-budgetHint entries
 *   RG-02 — planningWarnings[] no additionalProperties
 *   RS-M  — Generated requestPhase matches fixture request-signals.json
 *
 * Canonical: docs/12 Phase 12 R4 §12.
 */

import type { ZTCheckResult } from '../types/harness.js';

// ---------------------------------------------------------------------------
// Safe omit paths (ZT-02)
// ---------------------------------------------------------------------------

const SAFE_OMIT_PATHS = new Set([
  'safe_to_omit_match',
  'default_action_omit',
  'budget_trim',
]);

// ---------------------------------------------------------------------------
// resolutionRule canonical 14-value enum (ZT-12)
// ---------------------------------------------------------------------------

const CANONICAL_RESOLUTION_RULES = new Set([
  'no_conflict',
  'runtime_unavailable_defer',
  'safety_hard_protection',
  'user_constraint_include',
  'registry_require_include',
  'history_durability_include',
  'path_a_omit_uncontested',
  'path_b_omit_uncontested',
  'path_a_omit_selected_over_path_b',
  'multiple_include_merged',
  'fail_open_unresolved',
  'quarantine_boundary_violation_pass_through',
  'reference_unknown_pass_through',
  'history_malformed_fail_open',
]);

// ---------------------------------------------------------------------------
// Narrative template regex (ZT-13)
// Template: "{N} components evaluated. {D} included, {O} omitted, {De} deferred
//            ({Dd} default, {Ru} runtime-unavailable), {F} fail-open. {C} conflict(s) identified."
// ---------------------------------------------------------------------------

const NARRATIVE_REGEX =
  /^\d+ components evaluated\. \d+ included, \d+ omitted, \d+ deferred \(\d+ default, \d+ runtime-unavailable\), \d+ fail-open\. \d+ conflict\(s\) identified\.$/;

// ---------------------------------------------------------------------------
// Raw content heuristic (ZT-03)
// ---------------------------------------------------------------------------

/** Field names whose content is ALLOWED to be long (schema-defined fields). */
const ALLOWED_LONG_FIELDS = new Set([
  'narrative',
  'summary',
  'conflictDescription',
  'message',
  'description',
]);

/**
 * Targeted field-name scan for ZT-03: reject known raw-content field names.
 * These should never appear in trace.json under any key.
 *
 * Full set from Phase 12 R4 §12.3:
 *   rawRequestText, rawHistoryContent, rawComponentContent, componentBody,
 *   componentText, historyContent, rawContent,
 *   requestText, rawRequest, userText, content, body,
 *   turnContent, rawTurnContent, inline
 */
const FORBIDDEN_TRACE_FIELDS = new Set([
  'rawRequestText',
  'rawHistoryContent',
  'rawComponentContent',
  'componentBody',
  'componentText',
  'historyContent',
  'rawContent',
  // Additional forbidden names from Phase 12 R4 §12.3:
  'requestText',
  'rawRequest',
  'userText',
  'content',
  'body',
  'turnContent',
  'rawTurnContent',
  'inline',
]);

// ---------------------------------------------------------------------------
// Helper: pass / fail constructors
// ---------------------------------------------------------------------------

function pass(id: string): ZTCheckResult {
  return { id, passed: true, message: null };
}

function fail(id: string, message: string): ZTCheckResult {
  return { id, passed: false, message };
}

// ---------------------------------------------------------------------------
// Helper: extract sorted component IDs from prompt plan partition arrays
// ---------------------------------------------------------------------------

type PromptPlanComponent = { componentId?: string; id?: string };

function extractIds(arr: PromptPlanComponent[] | undefined): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => (c.componentId ?? c.id ?? '')).filter(Boolean).sort();
}

// ---------------------------------------------------------------------------
// ZT-01: Schema-valid outputs
// ---------------------------------------------------------------------------

/**
 * ZT-01: The caller passes the AJV result directly.
 * @param schemaKey 'prompt-plan' | 'trace'
 * @param passed AJV validation result
 * @param errors AJV error details
 */
export function checkZT01Schema(
  schemaKey: string,
  passed: boolean,
  errors?: string,
): ZTCheckResult {
  if (passed) return pass('ZT-01');
  return fail('ZT-01', `Schema validation failed for ${schemaKey}: ${errors ?? 'unknown error'}`);
}

// ---------------------------------------------------------------------------
// ZT-02: No unsafe omissions
// ---------------------------------------------------------------------------

/**
 * ZT-02: All omittedComponents[].path must be in the safe-omit set.
 */
export function checkZT02NoUnsafeOmissions(promptPlan: Record<string, unknown>): ZTCheckResult {
  const omitted = promptPlan['omittedComponents'];
  if (!Array.isArray(omitted)) return pass('ZT-02');

  const bad: string[] = [];
  for (const comp of omitted as Array<Record<string, unknown>>) {
    const p = comp['path'];
    if (typeof p === 'string' && !SAFE_OMIT_PATHS.has(p)) {
      bad.push(`componentId='${comp['componentId']}' path='${p}'`);
    }
  }
  if (bad.length > 0) {
    return fail('ZT-02', `Unsafe omission paths found: ${bad.join(', ')}`);
  }
  return pass('ZT-02');
}

// ---------------------------------------------------------------------------
// ZT-03: No raw content in trace.json
// ---------------------------------------------------------------------------

/**
 * ZT-03: Targeted field-name scan + 500-char heuristic on non-allow-listed fields.
 */
export function checkZT03NoRawContent(trace: Record<string, unknown>): ZTCheckResult {
  const issues: string[] = [];
  scanForRawContent(trace, '', issues);
  if (issues.length > 0) {
    return fail('ZT-03', `Possible raw content in trace.json: ${issues.slice(0, 5).join('; ')}`);
  }
  return pass('ZT-03');
}

function scanForRawContent(obj: unknown, path: string, issues: string[]): void {
  if (issues.length >= 10) return; // cap
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      const key = path.split('.').pop() ?? '';
      if (FORBIDDEN_TRACE_FIELDS.has(key)) {
        issues.push(`Forbidden field '${key}' at ${path}`);
      } else if (!ALLOWED_LONG_FIELDS.has(key) && obj.length > 500) {
        issues.push(`Suspiciously long string (${obj.length} chars) at ${path}`);
      }
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => scanForRawContent(item, `${path}[${i}]`, issues));
  } else {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const subPath = path ? `${path}.${k}` : k;
      if (FORBIDDEN_TRACE_FIELDS.has(k)) {
        issues.push(`Forbidden field '${k}' at ${subPath}`);
        continue;
      }
      scanForRawContent(v, subPath, issues);
    }
  }
}

// ---------------------------------------------------------------------------
// ZT-04: inputDecisionIds traceability
// ---------------------------------------------------------------------------

/**
 * ZT-04: Every inputDecisionId in resolvedDecisions[] and
 * conflictResolutionTrace[] must match a decisionId in selectorTrace[].
 */
export function checkZT04InputDecisionIds(trace: Record<string, unknown>): ZTCheckResult {
  const selectorPhase = trace['selectorPhase'] as Record<string, unknown> | undefined;
  const conflictPhase = trace['conflictPhase'] as Record<string, unknown> | undefined;

  const selectorTrace = Array.isArray(selectorPhase?.['selectorTrace'])
    ? (selectorPhase!['selectorTrace'] as Array<Record<string, unknown>>)
    : [];

  const traceDecisionIds = new Set(selectorTrace.map((e) => e['decisionId']).filter(Boolean));

  const allInputIds: string[] = [];

  // resolvedDecisions
  const resolvedDecisions = Array.isArray(conflictPhase?.['resolvedDecisions'])
    ? (conflictPhase!['resolvedDecisions'] as Array<Record<string, unknown>>)
    : [];
  for (const rd of resolvedDecisions) {
    const ids = rd['inputDecisionIds'];
    if (Array.isArray(ids)) {
      allInputIds.push(...(ids as string[]));
    }
  }

  // conflictResolutionTrace
  const conflictTrace = Array.isArray(conflictPhase?.['conflictResolutionTrace'])
    ? (conflictPhase!['conflictResolutionTrace'] as Array<Record<string, unknown>>)
    : [];
  for (const crt of conflictTrace) {
    const ids = crt['inputDecisionIds'];
    if (Array.isArray(ids)) {
      allInputIds.push(...(ids as string[]));
    }
  }

  const missing = allInputIds.filter((id) => !traceDecisionIds.has(id));
  if (missing.length > 0) {
    return fail(
      'ZT-04',
      `${missing.length} inputDecisionId(s) not found in selectorTrace: ${missing.slice(0, 5).join(', ')}`,
    );
  }
  return pass('ZT-04');
}

// ---------------------------------------------------------------------------
// ZT-05: fail_open_unresolved bi-directional invariant
// ---------------------------------------------------------------------------

/**
 * ZT-05: Bi-directional invariant for fail_open_unresolved.
 *
 * Canonical source: trace.schema.json — unresolvedConflicts is in selectorPhase,
 * NOT in conflictPhase. conflictPhase has additionalProperties:false and does not
 * include unresolvedConflicts.
 *
 * For every fail_open_unresolved entry in EITHER:
 *   - conflictPhase.resolvedDecisions[]
 *   - conflictPhase.conflictResolutionTrace[]
 * the following invariants must hold:
 *   - finalAction must be 'include'
 *   - finalPath must be 'fail_open'
 *   - warningsEmitted must be non-empty
 *   - componentId must appear in selectorPhase.unresolvedConflicts[]
 *
 * Reciprocally: every selectorPhase.unresolvedConflicts[] id must have a
 * matching fail_open_unresolved entry in the conflict output (either array).
 */
export function checkZT05FailOpenUnresolved(trace: Record<string, unknown>): ZTCheckResult {
  const selectorPhase = trace['selectorPhase'] as Record<string, unknown> | undefined;
  const conflictPhase = trace['conflictPhase'] as Record<string, unknown> | undefined;

  const resolvedDecisions = Array.isArray(conflictPhase?.['resolvedDecisions'])
    ? (conflictPhase!['resolvedDecisions'] as Array<Record<string, unknown>>)
    : [];

  const conflictResolutionTrace = Array.isArray(conflictPhase?.['conflictResolutionTrace'])
    ? (conflictPhase!['conflictResolutionTrace'] as Array<Record<string, unknown>>)
    : [];

  // Canonical location: selectorPhase.unresolvedConflicts (trace.schema.json §selectorPhase)
  const unresolvedConflicts = Array.isArray(selectorPhase?.['unresolvedConflicts'])
    ? (selectorPhase!['unresolvedConflicts'] as string[])
    : [];
  const unresolvedIds = new Set<string>(unresolvedConflicts.filter(Boolean));

  // Collect all fail_open_unresolved entries from both arrays
  const failOpenFromResolved = resolvedDecisions.filter(
    (rd) => rd['resolutionRule'] === 'fail_open_unresolved',
  );
  const failOpenFromTrace = conflictResolutionTrace.filter(
    (crt) => crt['resolutionRule'] === 'fail_open_unresolved',
  );
  const allFailOpenEntries = [...failOpenFromResolved, ...failOpenFromTrace];
  const failOpenIds = new Set<unknown>(allFailOpenEntries.map((e) => e['componentId']).filter(Boolean));

  const issues: string[] = [];

  // Check per-entry invariants (same rules for both sources)
  function checkEntry(entry: Record<string, unknown>, source: string): void {
    const cId = entry['componentId'];
    if (entry['finalAction'] !== 'include') {
      issues.push(`fail_open_unresolved ${source} entry '${cId}' has finalAction='${entry['finalAction']}', expected 'include'`);
    }
    if (entry['finalPath'] !== 'fail_open') {
      issues.push(`fail_open_unresolved ${source} entry '${cId}' has finalPath='${entry['finalPath']}', expected 'fail_open'`);
    }
    const warnings = entry['warningsEmitted'];
    if (!Array.isArray(warnings) || warnings.length === 0) {
      issues.push(`fail_open_unresolved ${source} entry '${cId}' has empty warningsEmitted`);
    }
    if (typeof cId === 'string' && !unresolvedIds.has(cId)) {
      issues.push(`fail_open_unresolved ${source} entry '${cId}' not found in selectorPhase.unresolvedConflicts`);
    }
  }

  for (const entry of failOpenFromResolved) {
    checkEntry(entry, 'resolvedDecisions');
  }
  for (const entry of failOpenFromTrace) {
    checkEntry(entry, 'conflictResolutionTrace');
  }

  // Reciprocal: every selectorPhase.unresolvedConflicts entry must have a
  // fail_open_unresolved entry in either resolvedDecisions or conflictResolutionTrace
  for (const uid of unresolvedIds) {
    if (!failOpenIds.has(uid)) {
      issues.push(`selectorPhase.unresolvedConflicts '${uid}' has no matching fail_open_unresolved in resolvedDecisions or conflictResolutionTrace`);
    }
  }

  if (issues.length > 0) {
    return fail('ZT-05', issues.slice(0, 5).join('; '));
  }
  return pass('ZT-05');
}

// ---------------------------------------------------------------------------
// ZT-06: No silent budget overflow
// ---------------------------------------------------------------------------

/**
 * ZT-06: budgetPhase.budgetOverflow must equal budgetPhase.budgetReport.budgetOverflow.
 */
export function checkZT06NoBudgetOverflowSilence(trace: Record<string, unknown>): ZTCheckResult {
  const budgetPhase = trace['budgetPhase'] as Record<string, unknown> | undefined;
  if (!budgetPhase) return pass('ZT-06');

  const topLevel = budgetPhase['budgetOverflow'];
  const report = budgetPhase['budgetReport'] as Record<string, unknown> | undefined;
  const reportLevel = report?.['budgetOverflow'];

  if (topLevel !== reportLevel) {
    return fail(
      'ZT-06',
      `budgetPhase.budgetOverflow=${JSON.stringify(topLevel)} but budgetReport.budgetOverflow=${JSON.stringify(reportLevel)}`,
    );
  }
  return pass('ZT-06');
}

// ---------------------------------------------------------------------------
// ZT-07: Candidate-set accounting
// ---------------------------------------------------------------------------

/**
 * ZT-07: noConflictComponentIds.length + conflictResolutionTrace.length
 *        must equal candidateSetSize from registryPhase.candidateSetSummary.
 */
export function checkZT07CandidateSetAccounting(trace: Record<string, unknown>): ZTCheckResult {
  const registryPhase = trace['registryPhase'] as Record<string, unknown> | undefined;
  const conflictPhase = trace['conflictPhase'] as Record<string, unknown> | undefined;

  const candidateSummary = registryPhase?.['candidateSetSummary'] as Record<string, unknown> | undefined;
  const candidateSetSize = typeof candidateSummary?.['candidateSetSize'] === 'number'
    ? candidateSummary['candidateSetSize']
    : null;

  if (candidateSetSize === null) return pass('ZT-07'); // Cannot check without size

  const noConflictCount = Array.isArray(conflictPhase?.['noConflictComponentIds'])
    ? (conflictPhase!['noConflictComponentIds'] as unknown[]).length
    : 0;
  const conflictTraceCount = Array.isArray(conflictPhase?.['conflictResolutionTrace'])
    ? (conflictPhase!['conflictResolutionTrace'] as unknown[]).length
    : 0;

  const actual = noConflictCount + conflictTraceCount;
  if (actual !== candidateSetSize) {
    return fail(
      'ZT-07',
      `noConflictComponentIds(${noConflictCount}) + conflictResolutionTrace(${conflictTraceCount}) = ${actual}, expected candidateSetSize=${candidateSetSize}`,
    );
  }
  return pass('ZT-07');
}

// ---------------------------------------------------------------------------
// ZT-08: Partition exclusivity
// ---------------------------------------------------------------------------

/**
 * ZT-08: No component ID should appear in more than one partition
 * (selected, omitted, deferred) of prompt-plan.json.
 */
export function checkZT08PartitionExclusivity(promptPlan: Record<string, unknown>): ZTCheckResult {
  const selected = extractIds(promptPlan['selectedComponents'] as PromptPlanComponent[] | undefined);
  const omitted = extractIds(promptPlan['omittedComponents'] as PromptPlanComponent[] | undefined);
  const deferred = extractIds(promptPlan['deferredComponents'] as PromptPlanComponent[] | undefined);

  const allIds = [...selected, ...omitted, ...deferred];
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const id of allIds) {
    if (seen.has(id)) {
      duplicates.push(id);
    }
    seen.add(id);
  }

  if (duplicates.length > 0) {
    return fail('ZT-08', `Component IDs appear in multiple partitions: ${duplicates.join(', ')}`);
  }
  return pass('ZT-08');
}

// ---------------------------------------------------------------------------
// ZT-09: deferredComponents[].path present
// ---------------------------------------------------------------------------

/**
 * ZT-09: Every deferredComponents entry must have a non-empty 'path' field.
 */
export function checkZT09DeferredPath(promptPlan: Record<string, unknown>): ZTCheckResult {
  const deferred = promptPlan['deferredComponents'];
  if (!Array.isArray(deferred)) return pass('ZT-09');

  const missing: string[] = [];
  for (const comp of deferred as Array<Record<string, unknown>>) {
    if (typeof comp['path'] !== 'string' || comp['path'] === '') {
      missing.push(String(comp['componentId'] ?? '(unknown)'));
    }
  }

  if (missing.length > 0) {
    return fail('ZT-09', `deferredComponents missing path: ${missing.join(', ')}`);
  }
  return pass('ZT-09');
}

// ---------------------------------------------------------------------------
// ZT-10: budget_trim not in selector/conflict paths
// ---------------------------------------------------------------------------

/**
 * ZT-10: 'budget_trim' must not appear in selectorTrace[].path or
 * conflictResolutionTrace[].path. Budget trimming is a budget-phase action,
 * not a selector or conflict action.
 */
export function checkZT10BudgetTrimNotInSelectorConflict(trace: Record<string, unknown>): ZTCheckResult {
  const selectorPhase = trace['selectorPhase'] as Record<string, unknown> | undefined;
  const conflictPhase = trace['conflictPhase'] as Record<string, unknown> | undefined;

  const selectorTrace = Array.isArray(selectorPhase?.['selectorTrace'])
    ? (selectorPhase!['selectorTrace'] as Array<Record<string, unknown>>)
    : [];
  const conflictTrace = Array.isArray(conflictPhase?.['conflictResolutionTrace'])
    ? (conflictPhase!['conflictResolutionTrace'] as Array<Record<string, unknown>>)
    : [];

  const badSelector = selectorTrace.filter((e) => e['path'] === 'budget_trim');
  const badConflict = conflictTrace.filter((e) => e['finalPath'] === 'budget_trim');

  if (badSelector.length > 0 || badConflict.length > 0) {
    return fail(
      'ZT-10',
      `budget_trim found in selector paths (${badSelector.length}) or conflict paths (${badConflict.length})`,
    );
  }
  return pass('ZT-10');
}

// ---------------------------------------------------------------------------
// ZT-11: Injection warning deduplicated
// ---------------------------------------------------------------------------

/**
 * ZT-11: No injection warning code should appear more than once in
 * selectorPhase.planningWarnings[].
 */
export function checkZT11InjectionWarningDedup(trace: Record<string, unknown>): ZTCheckResult {
  const selectorPhase = trace['selectorPhase'] as Record<string, unknown> | undefined;
  const warnings = Array.isArray(selectorPhase?.['planningWarnings'])
    ? (selectorPhase!['planningWarnings'] as Array<Record<string, unknown>>)
    : [];

  const injectionCodes = warnings
    .map((w) => w['code'])
    .filter((c) => typeof c === 'string' && String(c).includes('injection'));

  const codeCounts = new Map<string, number>();
  for (const code of injectionCodes) {
    codeCounts.set(String(code), (codeCounts.get(String(code)) ?? 0) + 1);
  }

  const dupes = [...codeCounts.entries()].filter(([, count]) => count > 1);
  if (dupes.length > 0) {
    return fail(
      'ZT-11',
      `Injection warnings duplicated: ${dupes.map(([c, n]) => `${c}(x${n})`).join(', ')}`,
    );
  }
  return pass('ZT-11');
}

// ---------------------------------------------------------------------------
// ZT-12: resolutionRule valid enum
// ---------------------------------------------------------------------------

/**
 * ZT-12: All resolutionRule values in resolvedDecisions[] AND
 * conflictResolutionTrace[] must be in the canonical 14-value enum.
 */
export function checkZT12ResolutionRuleEnum(trace: Record<string, unknown>): ZTCheckResult {
  const conflictPhase = trace['conflictPhase'] as Record<string, unknown> | undefined;
  const resolvedDecisions = Array.isArray(conflictPhase?.['resolvedDecisions'])
    ? (conflictPhase!['resolvedDecisions'] as Array<Record<string, unknown>>)
    : [];
  const conflictResolutionTrace = Array.isArray(conflictPhase?.['conflictResolutionTrace'])
    ? (conflictPhase!['conflictResolutionTrace'] as Array<Record<string, unknown>>)
    : [];

  const invalid: string[] = [];

  for (const rd of resolvedDecisions) {
    const rule = rd['resolutionRule'];
    if (typeof rule === 'string' && !CANONICAL_RESOLUTION_RULES.has(rule)) {
      invalid.push(`resolvedDecisions: componentId='${rd['componentId']}' resolutionRule='${rule}'`);
    }
  }

  for (const crt of conflictResolutionTrace) {
    const rule = crt['resolutionRule'];
    if (typeof rule === 'string' && !CANONICAL_RESOLUTION_RULES.has(rule)) {
      invalid.push(`conflictResolutionTrace: componentId='${crt['componentId']}' resolutionRule='${rule}'`);
    }
  }

  if (invalid.length > 0) {
    return fail('ZT-12', `Invalid resolutionRule values: ${invalid.join(', ')}`);
  }
  return pass('ZT-12');
}

// ---------------------------------------------------------------------------
// ZT-13: selectorSummary.narrative matches template
// ---------------------------------------------------------------------------

/**
 * ZT-13: selectorPhase.selectorSummary.narrative must match the canonical
 * template from docs/06 §3.6.
 */
export function checkZT13NarrativeTemplate(trace: Record<string, unknown>): ZTCheckResult {
  const selectorPhase = trace['selectorPhase'] as Record<string, unknown> | undefined;
  const summary = selectorPhase?.['selectorSummary'] as Record<string, unknown> | undefined;
  const narrative = summary?.['narrative'];

  if (typeof narrative !== 'string') {
    return fail('ZT-13', `selectorSummary.narrative is missing or not a string (type=${typeof narrative})`);
  }

  if (!NARRATIVE_REGEX.test(narrative)) {
    return fail('ZT-13', `narrative does not match canonical template: "${narrative.slice(0, 120)}"`);
  }
  return pass('ZT-13');
}

// ---------------------------------------------------------------------------
// ZT-14: All output files present
// ---------------------------------------------------------------------------

/**
 * ZT-14: The caller checks file presence and passes the result.
 */
export function checkZT14OutputFilesPresent(
  promptPlanPresent: boolean,
  tracePresent: boolean,
  summaryPresent: boolean,
): ZTCheckResult {
  const missing: string[] = [];
  if (!promptPlanPresent) missing.push('prompt-plan.json');
  if (!tracePresent) missing.push('trace.json');
  if (!summaryPresent) missing.push('summary.md');
  if (missing.length > 0) {
    return fail('ZT-14', `Missing output files: ${missing.join(', ')}`);
  }
  return pass('ZT-14');
}

// ---------------------------------------------------------------------------
// ZT-15: Successful fixture exits 0
// ---------------------------------------------------------------------------

/**
 * ZT-15: The CLI must exit 0 for a successful fixture run.
 */
export function checkZT15ExitCode(exitCode: number): ZTCheckResult {
  if (exitCode !== 0) {
    return fail('ZT-15', `CLI exited with code ${exitCode} (expected 0)`);
  }
  return pass('ZT-15');
}

// ---------------------------------------------------------------------------
// ZT-16: Static expected schema-valid (Mode 1)
// ---------------------------------------------------------------------------

/**
 * ZT-16: The caller passes the AJV result for static expected files.
 */
export function checkZT16StaticSchemaValid(
  schemaKey: string,
  passed: boolean,
  errors?: string,
): ZTCheckResult {
  if (passed) return pass('ZT-16');
  return fail('ZT-16', `Static expected file schema invalid for ${schemaKey}: ${errors ?? 'unknown error'}`);
}

// ---------------------------------------------------------------------------
// ZT-17: Static assertions.md present/non-empty (Mode 1)
// ---------------------------------------------------------------------------

/**
 * ZT-17: The caller passes whether assertions.md was present and non-empty.
 */
export function checkZT17AssertionsMd(present: boolean, nonEmpty: boolean): ZTCheckResult {
  if (!present) return fail('ZT-17', 'expected/assertions.md is missing');
  if (!nonEmpty) return fail('ZT-17', 'expected/assertions.md is empty');
  return pass('ZT-17');
}

// ---------------------------------------------------------------------------
// RG-01: trimOrder[] excludes null-budgetHint entries
// ---------------------------------------------------------------------------

/**
 * RG-01: budgetPhase.budgetReport.trimOrder[] must not contain entries
 * where budgetHint is null.
 */
export function checkRG01TrimOrderNoNullHint(trace: Record<string, unknown>): ZTCheckResult {
  const budgetPhase = trace['budgetPhase'] as Record<string, unknown> | undefined;
  const budgetReport = budgetPhase?.['budgetReport'] as Record<string, unknown> | undefined;
  const trimOrder = budgetReport?.['trimOrder'];

  if (!Array.isArray(trimOrder)) return pass('RG-01');

  const nullHintEntries = (trimOrder as Array<Record<string, unknown>>).filter(
    (e) => e['budgetHint'] === null,
  );
  if (nullHintEntries.length > 0) {
    const ids = nullHintEntries.map((e) => e['componentId']).join(', ');
    return fail('RG-01', `trimOrder contains null-budgetHint entries: ${ids}`);
  }
  return pass('RG-01');
}

// ---------------------------------------------------------------------------
// RG-02: planningWarnings[] no additionalProperties
// ---------------------------------------------------------------------------

/**
 * Known top-level PlanningWarning fields per planning-warning.schema.json.
 *
 * Schema: required=[code, message]; optional=[componentId].
 * additionalProperties: false — 'context' and all other extra fields are forbidden.
 */
const PLANNING_WARNING_FIELDS = new Set(['code', 'message', 'componentId']);

/**
 * RG-02: All entries in top-level trace.warnings[] must have only
 * schema-defined fields: code, message, componentId.
 *
 * 'context' is NOT a schema field (additionalProperties: false).
 * Any warning with extra fields such as 'context' fails RG-02.
 */
export function checkRG02PlanningWarningsShape(trace: Record<string, unknown>): ZTCheckResult {
  const warnings = Array.isArray(trace['warnings'])
    ? (trace['warnings'] as Array<Record<string, unknown>>)
    : [];

  const issues: string[] = [];
  for (const w of warnings) {
    const extra = Object.keys(w).filter((k) => !PLANNING_WARNING_FIELDS.has(k));
    if (extra.length > 0) {
      issues.push(`Warning code='${w['code']}' has extra fields: ${extra.join(', ')}`);
    }
  }

  if (issues.length > 0) {
    return fail('RG-02', issues.slice(0, 5).join('; '));
  }
  return pass('RG-02');
}

// ---------------------------------------------------------------------------
// RS-M: Generated requestPhase matches fixture request-signals.json
// ---------------------------------------------------------------------------

/**
 * RS-M: Generated trace.requestPhase values must match fixture request-signals.json.
 *
 * Checks:
 *   - requestPhase.promptFamily === fixture.promptFamily
 *   - requestPhase.familyConfidence === fixture.familyConfidence
 *   - requestPhase.injectionSuspectFlag === fixture.injectionSuspect
 */
export function checkRSMRequestSignalsMatch(
  trace: Record<string, unknown>,
  fixtureSignals: Record<string, unknown>,
): ZTCheckResult {
  const requestPhase = trace['requestPhase'] as Record<string, unknown> | undefined;
  if (!requestPhase) {
    return fail('RS-M', 'trace.requestPhase is missing');
  }

  const issues: string[] = [];

  if (requestPhase['promptFamily'] !== fixtureSignals['promptFamily']) {
    issues.push(
      `promptFamily: got '${requestPhase['promptFamily']}', expected '${fixtureSignals['promptFamily']}'`,
    );
  }
  if (requestPhase['familyConfidence'] !== fixtureSignals['familyConfidence']) {
    issues.push(
      `familyConfidence: got ${requestPhase['familyConfidence']}, expected ${fixtureSignals['familyConfidence']}`,
    );
  }
  if (requestPhase['injectionSuspectFlag'] !== fixtureSignals['injectionSuspect']) {
    issues.push(
      `injectionSuspectFlag: got ${requestPhase['injectionSuspectFlag']}, expected ${fixtureSignals['injectionSuspect']}`,
    );
  }

  if (issues.length > 0) {
    return fail('RS-M', `requestPhase does not match fixture request-signals.json: ${issues.join('; ')}`);
  }
  return pass('RS-M');
}

// ---------------------------------------------------------------------------
// Semantic comparison helpers
// ---------------------------------------------------------------------------

/**
 * Compare sorted partition component-ID sets between generated and expected.
 * Returns { match, expectedSelected, generatedSelected, ... }
 */
export function comparePartitions(
  generatedPlan: Record<string, unknown>,
  expectedPlan: Record<string, unknown>,
): {
  expectedSelected: string[];
  generatedSelected: string[];
  expectedOmitted: string[];
  generatedOmitted: string[];
  expectedDeferred: string[];
  generatedDeferred: string[];
  match: boolean;
} {
  const eSelected = extractIds(expectedPlan['selectedComponents'] as PromptPlanComponent[] | undefined);
  const gSelected = extractIds(generatedPlan['selectedComponents'] as PromptPlanComponent[] | undefined);
  const eOmitted = extractIds(expectedPlan['omittedComponents'] as PromptPlanComponent[] | undefined);
  const gOmitted = extractIds(generatedPlan['omittedComponents'] as PromptPlanComponent[] | undefined);
  const eDeferred = extractIds(expectedPlan['deferredComponents'] as PromptPlanComponent[] | undefined);
  const gDeferred = extractIds(generatedPlan['deferredComponents'] as PromptPlanComponent[] | undefined);

  const match =
    JSON.stringify(eSelected) === JSON.stringify(gSelected) &&
    JSON.stringify(eOmitted) === JSON.stringify(gOmitted) &&
    JSON.stringify(eDeferred) === JSON.stringify(gDeferred);

  return {
    expectedSelected: eSelected,
    generatedSelected: gSelected,
    expectedOmitted: eOmitted,
    generatedOmitted: gOmitted,
    expectedDeferred: eDeferred,
    generatedDeferred: gDeferred,
    match,
  };
}

/** Canonical 8 trace keys. */
const CANONICAL_TRACE_KEYS = new Set([
  'run',
  'requestPhase',
  'registryPhase',
  'selectorPhase',
  'conflictPhase',
  'budgetPhase',
  'planPhase',
  'warnings',
]);

/**
 * Compare trace top-level key sets between generated and expected.
 * Exact equality is required (no extra keys in generated, no missing keys).
 */
export function comparePhaseKeys(
  generatedTrace: Record<string, unknown>,
  expectedTrace: Record<string, unknown>,
): {
  expectedKeys: string[];
  generatedKeys: string[];
  missingFromGenerated: string[];
  extraInGenerated: string[];
  match: boolean;
} {
  const expectedKeys = Object.keys(expectedTrace).sort();
  const generatedKeys = Object.keys(generatedTrace).sort();

  // Hard: generated must match canonical set exactly
  const missingFromGenerated = expectedKeys.filter((k) => !generatedKeys.includes(k));
  const extraInGenerated = generatedKeys.filter((k) => !expectedKeys.includes(k));

  // Also flag if generated has any key outside the canonical 8
  for (const k of generatedKeys) {
    if (!CANONICAL_TRACE_KEYS.has(k) && !extraInGenerated.includes(k)) {
      extraInGenerated.push(k);
    }
  }

  const match = missingFromGenerated.length === 0 && extraInGenerated.length === 0;

  return { expectedKeys, generatedKeys, missingFromGenerated, extraInGenerated, match };
}

/**
 * Compare selectorSummary count fields between generated and expected trace.
 * Warning-only (non-blocking in Phase 12).
 */
export function compareSelectorSummary(
  generatedTrace: Record<string, unknown>,
  expectedTrace: Record<string, unknown>,
): {
  expected: Record<string, number>;
  generated: Record<string, number>;
  match: boolean;
} {
  const COUNT_FIELDS = [
    'totalEvaluated',
    'decidedInclude',
    'decidedOmit',
    'decidedDefer',
    'defaultDefer',
    'runtimeUnavailableDefer',
    'failOpenInclude',
    'conflictsIdentified',
  ];

  function extractCounts(trace: Record<string, unknown>): Record<string, number> {
    const sp = trace['selectorPhase'] as Record<string, unknown> | undefined;
    const ss = sp?.['selectorSummary'] as Record<string, unknown> | undefined;
    const result: Record<string, number> = {};
    for (const field of COUNT_FIELDS) {
      const v = ss?.[field];
      result[field] = typeof v === 'number' ? v : -1;
    }
    return result;
  }

  const expected = extractCounts(expectedTrace);
  const generated = extractCounts(generatedTrace);
  const match = JSON.stringify(expected) === JSON.stringify(generated);
  return { expected, generated, match };
}
