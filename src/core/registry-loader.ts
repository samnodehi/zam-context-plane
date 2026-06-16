/**
 * Phase 2: Registry loading, indexing, cross-field validation, and quarantine.
 *
 * Consumes the AJV-validated RawComponentRegistry from Phase 1 and produces
 * a RegistryResult: five runtime index structures, quarantined components,
 * and non-fatal validation warnings.
 *
 * Phase 2 boundary — this module must NOT:
 *   - Build candidateSetSummary — Phase 4
 *   - Normalise the request into requestSignals — Phase 3
 *   - Derive promptFamily or injectionSuspect — Phase 3
 *   - Emit reference_unknown SelectionDecisions — Phase 5
 *   - Execute any selector, conflict resolver, budgeter, or planner — Phase 5+
 *   - Re-run AJV validation — Phase 1 already validated the registry
 *   - Verify hash vs. content (content files not loaded in MVP)
 *   - Write any output files — Phase 11
 *   - Make provider/model/network calls — permanently prohibited in MVP
 *
 * Canonical refs: docs/05 §8, §10, §11; docs/04 §7.1; docs/06 §2; docs/11 §8 I-04–I-07.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire as _createRequire } from 'node:module';

const _require = _createRequire(import.meta.url);

import type { RawComponentRegistry } from '../types/inputs.js';
import type {
  Component,
  RegistryIndexes,
  RegistryResult,
  QuarantinedComponent,
  RegistryValidationWarning,
} from '../types/registry.js';

/**
 * Resolve the path to the schemas/ directory regardless of whether we are
 * running via tsx from src/ or from compiled dist/. Identical to the helper
 * in input-loader.ts — schemas/ is always at the project root, two levels
 * above src/ or dist/.
 */
function resolveSchemaBase(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = resolve(thisFile, '..');
  return resolve(thisDir, '../../schemas');
}

// ---------------------------------------------------------------------------
// RegistryFatalError
// ---------------------------------------------------------------------------

/**
 * Thrown by buildRegistryIndexes() on any fatal registry condition.
 *
 * Fatal codes (docs/05 §8):
 *   'critical_without_protection' — riskLevel: critical without hard protection
 *   'safety_critical_malformed'   — safety-critical component with tokensApprox/charsApprox < 1
 *   'fatal_duplicate_id'          — duplicate id where any occurrence is hard-protected
 *
 * Parallel to ClassAError from Phase 1. Caller must catch and exit non-zero.
 */
export class RegistryFatalError extends Error {
  constructor(
    public readonly code:
      | 'critical_without_protection'
      | 'safety_critical_malformed'
      | 'fatal_duplicate_id'
      | 'empty_registry',
    public readonly componentId: string,
    message: string,
  ) {
    super(message);
    this.name = 'RegistryFatalError';
  }
}

// ---------------------------------------------------------------------------
// Safety predicate
// ---------------------------------------------------------------------------

/**
 * Returns true if a raw component record is hard-protected.
 *
 * Hard-protected means:
 *   retainPolicy === 'safety_critical'
 *   OR riskLevel === 'critical'
 *   OR omissionPolicy === 'never'
 *
 * This is the exact halt trigger from docs/05 §8 for all fatal rows.
 * Used in both token/char checks and duplicate-ID checks.
 */
function isHardProtected(raw: Record<string, unknown>): boolean {
  return (
    raw['retainPolicy'] === 'safety_critical' ||
    raw['riskLevel'] === 'critical' ||
    raw['omissionPolicy'] === 'never'
  );
}

// ---------------------------------------------------------------------------
// Evidence grammar recognition (docs/05 §7)
// ---------------------------------------------------------------------------

/**
 * Canonical promptFamily enum values.
 * Read from schemas/shared/prompt-family.schema.json, which is the authoritative
 * source (canonical owner: docs/06 §2.2, AC-11).
 * These are loaded via the same createRequire mechanism used by Phase 1 AJV.
 * Do not inline-guess values — always derive from the schema file.
 */
const VALID_PROMPT_FAMILIES: ReadonlySet<string> = new Set(
  (_require(resolve(resolveSchemaBase(), 'shared/prompt-family.schema.json')) as { enum: string[] }).enum,
);

/**
 * Canonical riskLevel values accepted in evidenceRequired atoms.
 * Source: docs/05 §7 atom table — 'Value must be low, medium, high, or critical'.
 */
const VALID_RISK_LEVELS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'critical']);

/**
 * Returns true if evidenceRequired string is a recognized MVP grammar expression.
 *
 * Accepted atoms (docs/05 §7, AC-11):
 *   promptFamily=<value>          — value must be one of the 10 canonical promptFamily enum strings
 *   riskLevel=<value>             — value must be one of: low, medium, high, critical
 *   explicitUserConstraint=false  — ONLY 'false' is valid; 'true' and any other value are invalid
 *
 * Connector: ' AND ' only (case-sensitive).
 * Unsupported: OR, NOT, parentheses.
 * Explicitly invalid atoms: budgetCritical=true, requestFamily=<any> (docs/05 §7).
 *
 * Canonical: docs/05 §7 — Active MVP Atom Set, Examples, Atoms Not Supported.
 */
function isRecognizedGrammar(expr: string): boolean {
  // Split on ' AND ' (case-sensitive per MVP spec)
  const parts = expr.split(' AND ');
  if (parts.length === 0) return false;

  for (const part of parts) {
    const atom = part.trim();
    if (atom.length === 0) return false;

    // Unsupported connectors/operators within a fragment
    if (atom.includes(' OR ') || atom.startsWith('NOT ') || atom.includes('(')) {
      return false;
    }

    const eqIdx = atom.indexOf('=');
    if (eqIdx === -1) return false;

    const key = atom.slice(0, eqIdx);
    const value = atom.slice(eqIdx + 1);

    // Value must be non-empty
    if (value.length === 0) return false;

    if (key === 'promptFamily') {
      // Value must be one of the 10 canonical promptFamily enum strings
      if (!VALID_PROMPT_FAMILIES.has(value)) return false;
    } else if (key === 'riskLevel') {
      // Value must be one of: low, medium, high, critical
      if (!VALID_RISK_LEVELS.has(value)) return false;
    } else if (key === 'explicitUserConstraint') {
      // Only 'false' is valid. 'true' and any other value are invalid.
      if (value !== 'false') return false;
    } else {
      // Any other key (budgetCritical, requestFamily, unknown atoms) is unrecognized
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Warning helper
// ---------------------------------------------------------------------------

function addWarning(
  warnings: RegistryValidationWarning[],
  code: string,
  componentId: string,
  message: string,
  field?: string,
): void {
  warnings.push({ code, componentId, message, ...(field !== undefined ? { field } : {}) });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Build registry indexes from a Phase 1 AJV-validated raw registry array.
 *
 * Processing order (per docs/05 §8):
 *   1. Cast each raw entry to a working shape.
 *   2. Per-component cross-field validation (in array order):
 *      a. critical_without_protection check (halt)
 *      b. token/char count check (halt-or-quarantine)
 *      c. defaultAction override (non-fatal)
 *      d. evidenceRequired grammar check (non-fatal)
 *      e. Path A advisory warnings (non-fatal)
 *   3. Duplicate ID detection (inline, using a seen-IDs Map).
 *   4. Build index structures from valid components.
 *   5. Return RegistryResult.
 *
 * Throws RegistryFatalError on any fatal condition (step 2a, 2b safety-critical,
 * or 3 with hard-protected duplicate). Caller must catch and exit non-zero.
 *
 * Does NOT:
 *   - Re-run AJV (Phase 1 already guaranteed all 18 required fields and types)
 *   - Build candidateSetSummary (Phase 4)
 *   - Emit reference_unknown (Phase 5)
 *   - Verify hash content (post-MVP)
 *   - Clamp budgetPriority (AJV already enforces 1–10)
 */
export function buildRegistryIndexes(registryRaw: RawComponentRegistry): RegistryResult {
  // -------------------------------------------------------------------------
  // Guard: empty registry is semantically unprocessable.
  // An empty registry means no components can be selected — the pipeline has
  // nothing to work with. Fail fast with a clear fatal error rather than
  // returning a vacuous 200 with empty outputs.
  // Canonical: docs/30 §4.3 HT-1; docs/05 §8.
  // -------------------------------------------------------------------------
  if (registryRaw.length === 0) {
    throw new RegistryFatalError(
      'empty_registry',
      '(none)',
      'Registry is empty (0 components). A planning run requires at least one registered component.',
    );
  }

  const quarantinedComponents: QuarantinedComponent[] = [];
  const validationWarnings: RegistryValidationWarning[] = [];

  // Tracks valid (non-quarantined, non-rejected) components in array order.
  // Also serves as the duplicate-ID seen set (keyed by id).
  const validComponents = new Map<string, Component>();

  // Step 2: per-component cross-field validation loop (in array order).
  for (const rawEntry of registryRaw) {
    // Step 1: Cast — AJV Phase 1 guarantees all 18 required fields are present
    // and have the correct types. This cast is safe.
    const raw = rawEntry as Record<string, unknown>;

    const id = raw['id'] as string;
    const riskLevel = raw['riskLevel'] as string;
    const retainPolicy = raw['retainPolicy'] as string;
    const omissionPolicy = raw['omissionPolicy'] as string;
    const tokensApprox = raw['tokensApprox'] as number;
    const charsApprox = raw['charsApprox'] as number;
    const metadataOnly = raw['metadataOnly'] as boolean | undefined;
    const defaultAction = raw['defaultAction'] as string;
    const evidenceRequired = raw['evidenceRequired'] as string | null;
    const safeToOmitWhen = raw['safeToOmitWhen'] as string[];

    // -----------------------------------------------------------------------
    // Step 2a: riskLevel: critical protection check (halt condition)
    // docs/05 §8: "riskLevel: critical without retainPolicy: safety_critical
    // AND without omissionPolicy: never → hard error: halt planning."
    // -----------------------------------------------------------------------
    if (
      riskLevel === 'critical' &&
      retainPolicy !== 'safety_critical' &&
      omissionPolicy !== 'never'
    ) {
      throw new RegistryFatalError(
        'critical_without_protection',
        id,
        `Component '${id}' has riskLevel: critical but lacks hard protection ` +
          `(retainPolicy is '${retainPolicy}', omissionPolicy is '${omissionPolicy}'). ` +
          `A critical component must have retainPolicy: safety_critical OR omissionPolicy: never.`,
      );
    }

    // -----------------------------------------------------------------------
    // Step 2b: token/char count cross-field check (halt-or-quarantine)
    // docs/05 §8 rows for tokensApprox < 1 when not metadataOnly.
    // Negative values are impossible after Phase 1 AJV (minimum: 0 enforced).
    // -----------------------------------------------------------------------
    if (metadataOnly !== true && (tokensApprox < 1 || charsApprox < 1)) {
      if (isHardProtected(raw)) {
        // Safety-critical malformed → halt
        throw new RegistryFatalError(
          'safety_critical_malformed',
          id,
          `Component '${id}' is hard-protected (retainPolicy: ${retainPolicy}, ` +
            `riskLevel: ${riskLevel}, omissionPolicy: ${omissionPolicy}) but has ` +
            `tokensApprox: ${tokensApprox}, charsApprox: ${charsApprox} with metadataOnly absent or false. ` +
            `Hard-protected components must have tokensApprox >= 1 and charsApprox >= 1, ` +
            `or set metadataOnly: true.`,
        );
      }
      // Non-safety-critical → quarantine
      quarantinedComponents.push({
        id,
        reason:
          `tokensApprox: ${tokensApprox}, charsApprox: ${charsApprox} with metadataOnly absent or false — ` +
          `component excluded from registry indexes.`,
        riskLevel,
        rawEntry,
      });
      addWarning(
        validationWarnings,
        'component_quarantined',
        id,
        `Component '${id}' quarantined: tokensApprox or charsApprox < 1 with metadataOnly false/absent. ` +
          `riskLevel: ${riskLevel}.`,
        'tokensApprox',
      );
      // Skip to next component — do not include in indexes
      continue;
    }

    // -----------------------------------------------------------------------
    // From here on the component has passed halt/quarantine checks.
    // Build the Component object (will be mutated by steps 2c, 2d, 2e below).
    // -----------------------------------------------------------------------
    const component: Component = {
      id,
      type: raw['type'] as string,
      title: raw['title'] as string,
      summary: raw['summary'] as string,
      source: raw['source'] as string,
      tokensApprox,
      charsApprox,
      riskLevel,
      requiredWhen: raw['requiredWhen'] as string[],
      safeToOmitWhen,
      defaultAction,
      omissionPolicy,
      retainPolicy,
      budgetPriority: raw['budgetPriority'] as number,
      evidenceRequired,
      tags: raw['tags'] as string[],
      version: raw['version'] as string,
      hash: raw['hash'] as string | null,
    };

    // Copy optional MVP fields if present
    if (raw['metadataOnly'] !== undefined) {
      component.metadataOnly = raw['metadataOnly'] as boolean;
    }
    if (raw['formatTag'] !== undefined) {
      component.formatTag = raw['formatTag'] as string | null;
    }

    // -----------------------------------------------------------------------
    // Step 2c: defaultAction: 'omit' override (non-fatal)
    // docs/05 §8: if defaultAction: omit combined with mandatory/safety_critical
    // retainPolicy or omissionPolicy: never → override to include + warn.
    // Exception: not a quarantine trigger.
    // -----------------------------------------------------------------------
    if (
      component.defaultAction === 'omit' &&
      (retainPolicy === 'mandatory' || retainPolicy === 'safety_critical' || omissionPolicy === 'never')
    ) {
      component.defaultAction = 'include';
      component.defaultActionOverridden = true;
      addWarning(
        validationWarnings,
        'registry_default_action_overridden',
        id,
        `Component '${id}' had defaultAction: omit but retainPolicy is '${retainPolicy}' / ` +
          `omissionPolicy is '${omissionPolicy}'. Overriding defaultAction to include. ` +
          `This is a non-fatal registry configuration issue — verify registry authoring intent.`,
        'defaultAction',
      );
    }

    // -----------------------------------------------------------------------
    // Step 2d: evidenceRequired grammar check (non-fatal)
    // docs/05 §7: unrecognized grammar → Path A disabled (annotation only),
    // warn, do not quarantine, do not halt, do not normalize to null.
    // -----------------------------------------------------------------------
    if (evidenceRequired !== null && !isRecognizedGrammar(evidenceRequired)) {
      component.evidenceRequiredGrammarInvalid = true;
      addWarning(
        validationWarnings,
        'registry_evidence_grammar_invalid',
        id,
        `Component '${id}' has evidenceRequired: "${evidenceRequired}" which is not a recognized ` +
          `MVP grammar expression. Path A will be disabled for this component in Phase 5. ` +
          `Path B is unaffected. Invalid grammar is not normalized to null. ` +
          `Recognized atoms: promptFamily=<v>, riskLevel=<v>, explicitUserConstraint=false ` +
          `(joined by AND only; OR/NOT not supported).`,
        'evidenceRequired',
      );
    }

    // -----------------------------------------------------------------------
    // Step 2e: Path A advisory warnings (non-fatal, docs/05 §8 / §7)
    //
    // Warning 1: omissionPolicy: allow + non-empty safeToOmitWhen + evidenceRequired: null
    //   → omission authorized by tag match alone; may be intentional but should be verified.
    //   NOTE: do NOT emit 'path_a_null_evidence' here — that is a Phase 5 per-decision
    //   selector warning (SelectionDecision.warnings[]). Canonical: docs/06 §8 Step 7.
    //
    // Warning 2: omissionPolicy: allow + empty safeToOmitWhen + defaultAction !== 'omit'
    //   + evidenceRequired: null → no valid omission path in MVP.
    // -----------------------------------------------------------------------
    if (omissionPolicy === 'allow' && safeToOmitWhen.length > 0 && evidenceRequired === null) {
      addWarning(
        validationWarnings,
        'registry_null_evidence_path_a_advisory',
        id,
        `Component '${id}' has omissionPolicy: allow, non-empty safeToOmitWhen, and ` +
          `evidenceRequired: null. Path A omission is authorized by safeToOmitWhen tag match ` +
          `alone (no additional evidence expression required). Verify this is intentional. ` +
          `Canonical: docs/05 §8.`,
        'evidenceRequired',
      );
    } else if (
      omissionPolicy === 'allow' &&
      safeToOmitWhen.length === 0 &&
      component.defaultAction !== 'omit' &&
      evidenceRequired === null
    ) {
      addWarning(
        validationWarnings,
        'registry_no_valid_omission_path',
        id,
        `Component '${id}' has omissionPolicy: allow, empty safeToOmitWhen, ` +
          `defaultAction: '${component.defaultAction}' (not omit), and evidenceRequired: null. ` +
          `No valid Path A or Path B omission path exists in MVP. ` +
          `Consider using omissionPolicy: fail_open. Canonical: docs/05 §8.`,
        'omissionPolicy',
      );
    }

    // -----------------------------------------------------------------------
    // Step 3: Duplicate ID detection (inline)
    // docs/05 §8 rows 375–376.
    // -----------------------------------------------------------------------
    if (validComponents.has(id)) {
      const existingComponent = validComponents.get(id)!;

      // Check if either the existing (first) or incoming (current) occurrence is hard-protected.
      // We read from the typed Component fields directly for the existing entry, and from raw for
      // the incoming entry (raw is already Record<string, unknown>).
      const existingHardProtected =
        existingComponent.retainPolicy === 'safety_critical' ||
        existingComponent.riskLevel === 'critical' ||
        existingComponent.omissionPolicy === 'never';
      const incomingHardProtected = isHardProtected(raw);

      if (existingHardProtected || incomingHardProtected) {
        // Fatal: duplicate ID involving a hard-protected component
        throw new RegistryFatalError(
          'fatal_duplicate_id',
          id,
          `Duplicate component id '${id}': one or both occurrences are hard-protected ` +
            `(retainPolicy/riskLevel/omissionPolicy). A duplicate ID involving a hard-protected ` +
            `component can silently corrupt safety-critical behavior. Planning run halted.`,
        );
      }

      // Non-fatal: retain first, reject second
      addWarning(
        validationWarnings,
        'duplicate_id_rejected',
        id,
        `Component id '${id}' appears more than once in the registry. ` +
          `First occurrence retained; subsequent occurrence(s) rejected. ` +
          `Neither occurrence is hard-protected. Verify registry authoring intent.`,
        'id',
      );
      // Do not add the duplicate to validComponents — skip to next
      continue;
    }

    // Component passed all checks — add to valid set
    validComponents.set(id, component);
  }

  // -------------------------------------------------------------------------
  // Step 4: Build index structures from valid components
  // Canonical: docs/05 §10.
  // -------------------------------------------------------------------------

  const componentsById = new Map<string, Component>();
  const componentsByType = new Map<string, Component[]>();
  const componentsByTag = new Map<string, Component[]>();
  const safetyCriticalIds = new Set<string>();
  const trimmableCandidateIds = new Set<string>();

  for (const [, comp] of validComponents) {
    // componentsById
    componentsById.set(comp.id, comp);

    // componentsByType
    const typeList = componentsByType.get(comp.type) ?? [];
    typeList.push(comp);
    componentsByType.set(comp.type, typeList);

    // componentsByTag — one entry per tag element
    for (const tag of comp.tags) {
      const tagList = componentsByTag.get(tag) ?? [];
      tagList.push(comp);
      componentsByTag.set(tag, tagList);
    }

    // safetyCriticalIds: retainPolicy: safety_critical OR omissionPolicy: never
    // Canonical: docs/05 §10.
    if (comp.retainPolicy === 'safety_critical' || comp.omissionPolicy === 'never') {
      safetyCriticalIds.add(comp.id);
    }

    // trimmableCandidateIds: retainPolicy: optional AND omissionPolicy: allow
    // AND riskLevel in [low, medium].
    // This is a static registry-level candidate set — NOT the final trim list.
    // The Budgeter re-validates against resolved SelectionDecisions. Canonical: docs/05 §10.
    if (
      comp.retainPolicy === 'optional' &&
      comp.omissionPolicy === 'allow' &&
      (comp.riskLevel === 'low' || comp.riskLevel === 'medium')
    ) {
      trimmableCandidateIds.add(comp.id);
    }
  }

  const indexes: RegistryIndexes = {
    componentsById,
    componentsByType,
    componentsByTag,
    safetyCriticalIds,
    trimmableCandidateIds,
  };

  // Step 5: Return RegistryResult
  return {
    indexes,
    quarantinedComponents,
    validationWarnings,
  };
}
