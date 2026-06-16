/**
 * Phase 2: Registry boundary/runtime types.
 *
 * These types are the post-indexing in-memory contracts for Phase 2 registry
 * loading. JSON Schema + AJV remains the authoritative validation boundary
 * (Phase 1). Types here exist only to give downstream phases a stable TS
 * contract without duplicating the full schema.
 *
 * This file must contain ONLY type/interface definitions.
 * Runtime error classes (e.g. RegistryFatalError) are in src/core/registry-loader.ts.
 *
 * Phase 2 scope:
 *   - Component: typed view of a single AJV-validated registry entry.
 *   - RegistryIndexes: the five runtime index structures.
 *   - QuarantinedComponent: a component excluded by a non-fatal validation failure.
 *   - RegistryValidationWarning: a non-fatal registry-phase warning (internal code).
 *   - RegistryResult: aggregate output of buildRegistryIndexes().
 *
 * Phase 3+ additions must NOT be made here until those phases are approved.
 */

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Typed view of a single AJV-validated registry entry after Phase 2 processing.
 *
 * Enum string fields (riskLevel, omissionPolicy, retainPolicy, defaultAction, type)
 * are kept as plain `string` to avoid duplicating the schema enum lists in
 * TypeScript. AJV already validated these values at the Phase 1 boundary.
 *
 * Phase 2 loader-applied annotations (defaultActionOverridden,
 * evidenceRequiredGrammarInvalid) are optional fields set during cross-field
 * validation. They are not present in the raw JSON.
 */
export interface Component {
  // --- 18 required fields (all guaranteed present by AJV Phase 1) ---
  id: string;
  /** One of 8 canonical MVP component types — AJV validated. */
  type: string;
  title: string;
  summary: string;
  source: string;
  /** >= 1 unless metadataOnly: true. Phase 2 checks the cross-field rule. */
  tokensApprox: number;
  /** >= 1 unless metadataOnly: true. Phase 2 checks the cross-field rule. */
  charsApprox: number;
  /** 'low' | 'medium' | 'high' | 'critical' — AJV validated. */
  riskLevel: string;
  requiredWhen: string[];
  safeToOmitWhen: string[];
  /** 'include' | 'omit' | 'defer' — AJV validated. May be overridden by Phase 2. */
  defaultAction: string;
  /** 'allow' | 'fail_open' | 'never' — AJV validated. */
  omissionPolicy: string;
  /** 'optional' | 'durable' | 'mandatory' | 'safety_critical' — AJV validated. */
  retainPolicy: string;
  /** 1–10 — AJV validated (schema enforces minimum: 1, maximum: 10). */
  budgetPriority: number;
  /** null = no additional evidence expression required for Path A (Phase 5). */
  evidenceRequired: string | null;
  tags: string[];
  version: string;
  hash: string | null;

  // --- 2 optional MVP fields ---
  /** If true, tokensApprox and charsApprox may be 0. */
  metadataOnly?: boolean;
  /** Matched by output_format selector against outputFormatHint. */
  formatTag?: string | null;

  // --- Phase 2 loader-applied annotations (not in raw JSON) ---
  /**
   * True if defaultAction was 'omit' but was overridden to 'include' because
   * retainPolicy is 'mandatory'/'safety_critical' OR omissionPolicy is 'never'.
   * Canonical: docs/05 §8 override row.
   */
  defaultActionOverridden?: boolean;
  /**
   * True if evidenceRequired is a non-null string but its grammar is not
   * recognized in the MVP atom set. Path A will be disabled for this component
   * in Phase 5. Path B is unaffected.
   * Canonical: docs/05 §7, §8.
   */
  evidenceRequiredGrammarInvalid?: boolean;
}

// ---------------------------------------------------------------------------
// RegistryIndexes
// ---------------------------------------------------------------------------

/**
 * The five runtime index structures produced by buildRegistryIndexes().
 *
 * All components in componentsById are valid and non-quarantined.
 * Quarantined and duplicate-rejected components never enter these indexes.
 * Canonical: docs/05 §10; docs/06 §2 Class A inputs.
 */
export interface RegistryIndexes {
  /** All valid components keyed by id. Canonical: docs/05 §10. */
  componentsById: Map<string, Component>;
  /** All valid components grouped by type. Canonical: docs/05 §10. */
  componentsByType: Map<string, Component[]>;
  /** All valid components grouped by each tag element. Canonical: docs/05 §10. */
  componentsByTag: Map<string, Component[]>;
  /**
   * IDs of all components with retainPolicy: safety_critical OR omissionPolicy: never.
   * Canonical: docs/05 §10.
   */
  safetyCriticalIds: Set<string>;
  /**
   * Static registry-level candidate set for budget trimming.
   * retainPolicy: optional AND omissionPolicy: allow AND riskLevel in [low, medium].
   * This is NOT the final trim list — the Budgeter re-validates against resolved
   * SelectionDecisions before trimming. Canonical: docs/05 §10.
   */
  trimmableCandidateIds: Set<string>;
}

// ---------------------------------------------------------------------------
// QuarantinedComponent
// ---------------------------------------------------------------------------

/**
 * A component excluded from the registry indexes due to a non-fatal validation
 * failure (e.g. tokensApprox < 1 when not metadataOnly, and not safety-critical).
 *
 * Safety-critical malformed components halt the run — they never reach this list.
 * Canonical: docs/05 §8, §10, §11 trace event 'component_quarantined'.
 */
export interface QuarantinedComponent {
  /** Component id, if readable from the raw entry. */
  id: string;
  /** Human-readable reason for quarantine. */
  reason: string;
  /** riskLevel from the component, if readable. */
  riskLevel: string;
  /**
   * The raw array element. Used for internal diagnostics only.
   * Must NOT be emitted in trace output — raw component content is prohibited.
   */
  rawEntry: unknown;
}

// ---------------------------------------------------------------------------
// RegistryValidationWarning
// ---------------------------------------------------------------------------

/**
 * A non-fatal registry-phase validation warning.
 *
 * Codes beginning with 'registry_' are internal Phase 2 codes — they will be
 * wrapped in a generic 'validation_warning' trace entry in Phase 11.
 * The codes 'component_quarantined' and 'duplicate_id_rejected' are canonical
 * trace event names from docs/05 §11 and are used directly.
 *
 * Warning codes used in Phase 2:
 *   'component_quarantined'              — canonical trace event (docs/05 §11)
 *   'duplicate_id_rejected'              — canonical trace event (docs/05 §11)
 *   'registry_default_action_overridden' — internal only; wrapped in validation_warning in Phase 11
 *   'registry_evidence_grammar_invalid'  — internal only; wrapped in validation_warning in Phase 11
 *   'registry_null_evidence_path_a_advisory' — internal only; wrapped in validation_warning in Phase 11
 *   'registry_no_valid_omission_path'    — internal only; wrapped in validation_warning in Phase 11
 *
 * NOTE: 'path_a_null_evidence' is a Phase 5 per-decision selector warning
 * (SelectionDecision.warnings[]). It must NOT be emitted in Phase 2.
 */
export interface RegistryValidationWarning {
  /** Machine-readable registry-phase warning code. */
  code: string;
  /** Component id this warning applies to. */
  componentId: string;
  /** Optional: field that triggered the warning. */
  field?: string;
  /** Human-readable explanation. Must not contain raw component content. */
  message: string;
}

// ---------------------------------------------------------------------------
// RegistryResult
// ---------------------------------------------------------------------------

/**
 * The aggregate output of buildRegistryIndexes().
 *
 * Fatal cases throw RegistryFatalError before this is returned.
 * Canonical: docs/05 §10; docs/04 §7.1.
 */
export interface RegistryResult {
  /** The five runtime index structures. All entries are valid and non-quarantined. */
  indexes: RegistryIndexes;
  /**
   * Components excluded due to non-fatal validation failures.
   * Safety-critical malformed components halt the run and never appear here.
   */
  quarantinedComponents: QuarantinedComponent[];
  /**
   * Non-fatal registry-phase warnings collected during indexing.
   * Includes quarantine events, duplicate-ID rejections, override events,
   * and advisory grammar/policy warnings.
   */
  validationWarnings: RegistryValidationWarning[];
}
