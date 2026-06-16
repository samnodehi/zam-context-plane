/**
 * Phase 3: Request normalization — deterministic in-process Request Router.
 *
 * Consumes Phase 1 LoadedInputs and Phase 2 RegistryResult, and produces a
 * NormalizedInputs aggregate with a deterministic RequestSignals object.
 *
 * On the no-signals path, the deterministic Request Router (request-router.ts)
 * classifies the request text into a prompt family, fail-open to general_default
 * (C1, docs/33):
 *   promptFamily:      classifyRequest(text).promptFamily   (deterministic, offline)
 *   familyConfidence:  classifyRequest(text).familyConfidence
 *   injectionSuspect:  false  (injection detection is out of C1 scope; Request
 *                              Router remains the sole future owner)
 * When the router cannot confidently classify, it returns general_default and this
 * module emits a single prompt_family_defaulted warning.
 *
 * Phase 3 bypass: if LoadedInputs.requestSignals is non-null (i.e. the caller
 * provided --request-signals — e.g. from the runtime's model analyzer), the module
 * uses those validated pre-normalized signals directly and skips the router. This
 * is the only path where injectionSuspect may be true — it is carried from the
 * caller, never detected from raw text here.
 *
 * Phase 3 boundary — this module must NOT:
 *   - Detect or derive injectionSuspect from raw request text (out of C1 scope)
 *   - Implement MODEL-assisted promptFamily routing (the runtime owns that tier).
 *     Deterministic keyword/heuristic routing IS performed, via request-router.ts.
 *   - Construct a candidate set — Phase 4
 *   - Run selectors or produce SelectionDecision records — Phase 5
 *   - Produce reference_unknown records — Phase 5
 *   - Emit injection-gate warnings — Phase 7
 *   - Write prompt-plan.json, trace.json, or summary.md — Phase 11
 *   - Make provider/model/network calls — permanently prohibited
 *
 * Canonical: docs/06 §2.1, §2.2; docs/11 §6 Phase 3; docs/33.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire as _createRequire } from 'node:module';

import type { LoadedInputs } from '../types/inputs.js';
import type { RegistryResult } from '../types/registry.js';
import type { NormalizedInputs } from '../types/normalized.js';
import type { RequestSignals } from '../types/inputs.js';
import type { PlanningWarning } from '../types/warnings.js';

import { classifyRequest } from './request-router.js';

// ---------------------------------------------------------------------------
// AJV — local duplicate of Phase 1 pattern (intentional; input-loader.ts
// does not export its AJV instance; no shared utility file in Phase 3 scope)
// ---------------------------------------------------------------------------

const _require = _createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvCtor = (_require('ajv/dist/2020') as any).default as new (opts?: Record<string, unknown>) => AjvInstance;
type AjvInstance = {
  addSchema(schema: unknown): AjvInstance;
  compile(schema: unknown): ValidateFn;
};
type ValidateFn = {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }>;
};

/**
 * Resolve the path to the schemas/ directory regardless of whether running
 * via tsx from src/ or from compiled dist/. Identical pattern to Phase 1.
 */
function resolveSchemaBase(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = resolve(thisFile, '..');
  return resolve(thisDir, '../../schemas');
}

// Lazily built singleton AJV instance for Phase 3 (request-signals validation)
let _ajv: AjvInstance | null = null;

/**
 * Build an AJV instance with draft 2020-12 support and shared schemas
 * pre-loaded, then compile the request-signals validator.
 *
 * Preloads prompt-family.schema.json (referenced by $ref in request-signals)
 * before compiling request-signals.schema.json.
 */
function buildRequestSignalsValidator(): ValidateFn {
  const schemaBase = resolveSchemaBase();

  const promptFamilySchema = _require(
    resolve(schemaBase, 'shared/prompt-family.schema.json'),
  ) as Record<string, unknown>;
  const requestSignalsSchema = _require(
    resolve(schemaBase, 'inputs/request-signals.schema.json'),
  ) as Record<string, unknown>;

  const ajv = new AjvCtor({ strict: false, allErrors: false });
  ajv.addSchema(promptFamilySchema);
  return ajv.compile(requestSignalsSchema);
}

/**
 * Get (or lazily create) the singleton AJV validator for RequestSignals.
 * Compiled once per process; safe to call multiple times.
 */
function getRequestSignalsValidator(): ValidateFn {
  if (_ajv === null) {
    // _ajv is repurposed here as a sentinel; the validator is cached separately.
    _ajv = {} as AjvInstance; // sentinel
    _validateRequestSignals = buildRequestSignalsValidator();
  }
  return _validateRequestSignals!;
}

let _validateRequestSignals: ValidateFn | null = null;

// ---------------------------------------------------------------------------
// normalizeInputs
// ---------------------------------------------------------------------------

/**
 * Phase 3 entry point: produce NormalizedInputs from Phase 1 + Phase 2 results.
 *
 * Processing order:
 *   1. Build RequestSignals (promptFamily, familyConfidence, injectionSuspect, activeIds)
 *   2. Emit prompt_family_defaulted warning (always — no classifier in MVP)
 *   3. Validate produced RequestSignals with AJV guard (Phase 3 internal bug check)
 *   4. Perform active ID unknown check against registryResult.indexes.componentsById
 *   5. Build and return NormalizedInputs
 *
 * @param loadedInputs  Output of Phase 1 loadInputs().
 * @param registryResult Output of Phase 2 buildRegistryIndexes().
 * @returns NormalizedInputs — requestSignals + verbatim Phase 1 Class B carry-forwards.
 * @throws Error if the produced RequestSignals fails AJV validation (Phase 3 coding bug).
 */
export function normalizeInputs(
  loadedInputs: LoadedInputs,
  registryResult: RegistryResult,
): NormalizedInputs {
  const warnings: PlanningWarning[] = [];

  // -------------------------------------------------------------------------
  // Step 0: Early-exit when --request-signals was provided (Phase 12)
  // -------------------------------------------------------------------------
  // When loadedInputs.requestSignals is non-null, Phase 1 loaded and validated
  // the file against request-signals.schema.json. Phase 3 skips its always-stub
  // and uses the provided signals directly. The prompt_family_defaulted warning
  // is NOT emitted (the caller already has real, classified signals).
  // The active_id_unknown check (Step 4) still runs using the provided activeIds.
  if (loadedInputs.requestSignals != null) {
    const requestSignals: RequestSignals = loadedInputs.requestSignals;

    // Step 4 (active_id_unknown) still runs
    const { componentsById } = registryResult.indexes;
    const { activeSkillIds, activeToolIds, activeMemoryIds } = loadedInputs.activeIds;

    for (const skillId of activeSkillIds) {
      if (!componentsById.has(skillId)) {
        warnings.push({
          code: 'active_id_unknown',
          message:
            `Active skill ID '${skillId}' was not found in componentsById. ` +
            `Treated as absent for selector evaluation; no SelectionDecision produced for this ID.`,
          context: { idType: 'skill', id: skillId },
        });
      }
    }
    for (const toolId of activeToolIds) {
      if (!componentsById.has(toolId)) {
        warnings.push({
          code: 'active_id_unknown',
          message:
            `Active tool ID '${toolId}' was not found in componentsById. ` +
            `Treated as absent for selector evaluation; no SelectionDecision produced for this ID.`,
          context: { idType: 'tool', id: toolId },
        });
      }
    }
    for (const memoryId of activeMemoryIds) {
      if (!componentsById.has(memoryId)) {
        warnings.push({
          code: 'active_id_unknown',
          message:
            `Active memory ID '${memoryId}' was not found in componentsById. ` +
            `Treated as absent for selector evaluation; no SelectionDecision produced for this ID.`,
          context: { idType: 'memory', id: memoryId },
        });
      }
    }

    return {
      requestSignals,
      runtime: loadedInputs.runtime,
      history: loadedInputs.history,
      budget: loadedInputs.budget,
      constraints: loadedInputs.constraints,
      policy: loadedInputs.policy,
      activeIds: loadedInputs.activeIds,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // Step 1: Build RequestSignals via the deterministic Request Router (C1)
  // -------------------------------------------------------------------------
  // The router (request-router.ts) classifies the request text into a prompt
  // family deterministically and offline, fail-open to general_default. It does
  // NOT perform injection detection (out of C1 scope) — injectionSuspect stays
  // false on this path. Empty/whitespace text classifies to general_default.
  // Canonical: docs/33; docs/06 §2.2; docs/11 §4.1 A* (safe substitution, no halt).
  const { activeSkillIds, activeToolIds, activeMemoryIds } = loadedInputs.activeIds;

  const classification = classifyRequest(loadedInputs.requestText);

  const requestSignals: RequestSignals = {
    promptFamily: classification.promptFamily,
    familyConfidence: classification.familyConfidence,
    injectionSuspect: false,
    // Array fields included explicitly for downstream convenience — selectors
    // default absent to [] anyway.
    activeSkillIds: [...activeSkillIds],
    activeToolIds: [...activeToolIds],
    activeMemoryIds: [...activeMemoryIds],
  };

  // -------------------------------------------------------------------------
  // Step 2: Emit prompt_family_defaulted only when the router fell back
  // -------------------------------------------------------------------------
  // Emitted only when the router could not confidently classify and returned
  // general_default. On a confident classification no defaulting warning is
  // emitted — the classified promptFamily/familyConfidence are the record.
  // Distinct from the Phase 5 per-selector code 'prompt_family_unknown'.
  // Canonical: docs/33 DQ-6; docs/06 §2.2; warning-code.schema.json (open advisory enum).
  if (classification.defaulted) {
    warnings.push({
      code: 'prompt_family_defaulted',
      message:
        'Deterministic Request Router could not confidently classify the request. ' +
        'Using safe fallback: promptFamily=general_default, familyConfidence=0.0. ' +
        'Selectors will use the general_default ladder. ' +
        'Canonical: docs/33; docs/06 §2.2.',
    });
  }

  // -------------------------------------------------------------------------
  // Step 3: AJV validation guard (Phase 3 internal consistency check)
  // -------------------------------------------------------------------------
  // Validates the produced RequestSignals against request-signals.schema.json.
  // This guard protects against future changes to this module accidentally
  // producing an invalid struct (e.g. familyConfidence out of 0.0–1.0 range,
  // or promptFamily not in the closed enum).
  // A failure here is a Phase 3 coding bug — NOT a user input error.
  // Do not throw ClassAError. Do not classify as RegistryFatalError.
  const validate = getRequestSignalsValidator();
  if (!validate(requestSignals)) {
    const errs = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || '<root>'}: ${e.message ?? 'invalid'}`)
      .join('\n');
    throw new Error(
      `Phase 3 internal bug: produced RequestSignals failed AJV validation.\n` +
      `This is an implementation defect, not a user input error.\n` +
      `Validation errors:\n${errs}`,
    );
  }

  // -------------------------------------------------------------------------
  // Step 4: Active ID unknown check
  // -------------------------------------------------------------------------
  // For each active ID (skill/tool/memory): if not present in componentsById,
  // emit active_id_unknown warning. The ID is still passed through — it is NOT
  // removed from the arrays. Phase 5 selectors handle unknown active IDs.
  // Do NOT emit reference_unknown — that is a Phase 5 per-decision code.
  // Canonical: docs/11 §4.1; docs/06 §2.1; warning-code.schema.json $comment.
  const { componentsById } = registryResult.indexes;

  for (const skillId of activeSkillIds) {
    if (!componentsById.has(skillId)) {
      warnings.push({
        code: 'active_id_unknown',
        message:
          `Active skill ID '${skillId}' was not found in componentsById. ` +
          `Treated as absent for selector evaluation; no SelectionDecision produced for this ID.`,
        context: { idType: 'skill', id: skillId },
      });
    }
  }

  for (const toolId of activeToolIds) {
    if (!componentsById.has(toolId)) {
      warnings.push({
        code: 'active_id_unknown',
        message:
          `Active tool ID '${toolId}' was not found in componentsById. ` +
          `Treated as absent for selector evaluation; no SelectionDecision produced for this ID.`,
        context: { idType: 'tool', id: toolId },
      });
    }
  }

  for (const memoryId of activeMemoryIds) {
    if (!componentsById.has(memoryId)) {
      warnings.push({
        code: 'active_id_unknown',
        message:
          `Active memory ID '${memoryId}' was not found in componentsById. ` +
          `Treated as absent for selector evaluation; no SelectionDecision produced for this ID.`,
        context: { idType: 'memory', id: memoryId },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Build and return NormalizedInputs
  // -------------------------------------------------------------------------
  // Phase 1 Class B inputs are carried forward verbatim. Phase 3 does NOT
  // re-validate or transform them — Phase 1 already applied all fallbacks and
  // warnings. Phase 3 does NOT re-emit Phase 1 warnings.
  return {
    requestSignals,
    // Phase 1 Class B carry-forwards (verbatim)
    runtime: loadedInputs.runtime,
    history: loadedInputs.history,
    budget: loadedInputs.budget,
    constraints: loadedInputs.constraints,
    policy: loadedInputs.policy,
    activeIds: loadedInputs.activeIds,
    // Phase 3 warnings only (prompt_family_defaulted, active_id_unknown)
    warnings,
  };
}
