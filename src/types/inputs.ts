/**
 * Minimal boundary/runtime types for Phase 1 input loading.
 *
 * These types are the post-validation in-memory contracts — not duplicates of
 * the JSON Schemas. JSON Schema + AJV remains the authoritative validation
 * boundary. Types here exist only to give downstream phases a stable TS contract.
 *
 * Phase 1 scope:
 *   - RawRequestText: raw file content, loaded as UTF-8 string.
 *   - RawComponentRegistry: AJV-validated array; indexing is Phase 2.
 *   - All Class B types: minimal shape matching accepted schemas.
 *   - LoadedInputs: the aggregate result returned by loadInputs().
 *
 * Phase 2+ additions (registry indexing, componentsById, etc.) must NOT be
 * added here until those phases are approved.
 */

import type { PlanningWarning } from './warnings.js';

// ---------------------------------------------------------------------------
// RequestSignals (moved here from normalized.ts to avoid circular import)
// ---------------------------------------------------------------------------

/**
 * The structured signal set produced by Phase 3 (minimal in-process Request
 * Router stub), or supplied directly via --request-signals (harness use).
 *
 * In MVP, Phase 3 always produces:
 *   promptFamily:      'general_default'   (no classifier implemented)
 *   familyConfidence:  0.0                 (no classification performed)
 *   injectionSuspect:  false               (no detector implemented)
 *
 * When --request-signals is provided (Class B optional), the supplied JSON
 * bypasses the stub and is used as-is after AJV validation.
 *
 * Canonical: docs/06 §2.1; schemas/inputs/request-signals.schema.json.
 */
export interface RequestSignals {
  /** Closed enum — 'general_default' in MVP Phase 3 stub. Canonical: docs/06 §2.2. */
  promptFamily: string;
  /**
   * Router's confidence in its promptFamily classification (float 0.0–1.0).
   * Phase 3 sets 0.0 — no classification was performed.
   * Canonical: schemas/inputs/request-signals.schema.json; docs/06 §2.1.
   */
  familyConfidence: number;
  /**
   * Whether the Request Router detected adversarial injection patterns.
   * Phase 3 sets false — no detection implemented in MVP.
   * The Request Router is the sole detection owner per F-25.
   * Canonical: docs/06 §2.1 F-25.
   */
  injectionSuspect: boolean;

  /** Active skill IDs. Absent optional arrays default to [] in selectors. */
  activeSkillIds?: string[];
  /** Active tool IDs. Absent optional arrays default to [] in selectors. */
  activeToolIds?: string[];
  /** Active memory IDs. Absent optional arrays default to [] in selectors. */
  activeMemoryIds?: string[];
  /** Output format hint. Optional. */
  outputFormatHint?: string | null;
  /** Operator-supplied override flags. Optional. */
  explicitCallerFlags?: string[];

  /**
   * [FUTURE-ONLY] Re-entry turn flag. True when the External Runtime is calling
   * ZAM again after executing tool results (docs/20 §4.2).
   * Phase 3 stub never sets this. Passed through verbatim when provided by caller
   * via --request-signals or HTTP body.requestSignals.
   * Canonical: docs/20 §4.2; schemas/inputs/request-signals.schema.json.
   */
  reentryTurn?: boolean;

  /**
   * [FUTURE-ONLY] Prior plan ID. The runId from the prior planning turn's trace
   * (trace.run.runId), passed by the External Runtime on re-entry (docs/20 §4.3).
   * Enables reentryPhase[].priorPlanId linkage in trace.json.
   * Canonical: docs/20 §4.3; schemas/inputs/request-signals.schema.json.
   */
  priorPlanId?: string;

  /**
   * [FUTURE-ONLY] Loop suspect advisory flag. Set when the Request Router
   * detects a degenerate re-entry loop (docs/20 §5.3). Advisory only — does
   * NOT cause ZAM to halt or refuse. The External Runtime owns loop limits.
   * Canonical: docs/20 §5.3; schemas/inputs/request-signals.schema.json.
   */
  loopSuspect?: boolean;
}

// ---------------------------------------------------------------------------
// Class A types
// ---------------------------------------------------------------------------

/** Raw UTF-8 content of the --request file. Phase 3 normalises this into requestSignals. */
export type RawRequestText = string;

/**
 * AJV-validated component registry array.
 * Each element is a fully validated Component object (18 required fields).
 * Phase 2 indexes this into componentsById, componentsByType, etc.
 * Typed as unknown[] here to avoid duplicating the full Component schema.
 */
export type RawComponentRegistry = unknown[];

// ---------------------------------------------------------------------------
// Class B types
// ---------------------------------------------------------------------------

/** Loaded from --active-ids or defaulted to empty arrays. */
export interface ActiveIds {
  activeSkillIds: string[];
  activeToolIds: string[];
  activeMemoryIds: string[];
}

/** Loaded from --runtime or defaulted (capabilityInventoryComplete: false). */
export interface RuntimeCapabilities {
  availableToolIds: string[];
  unavailableToolIds: string[];
  capabilityInventoryComplete: boolean;
  runtimeLabel: string;
}

/** Loaded from --history or defaulted (historyMalformed: true). */
export interface HistoryStateSummary {
  lanesPresent: string[];
  durableConstraintsPresent: boolean;
  openCommitmentsPresent: boolean;
  recentRawTurnCount: number;
  totalHistoryTokensApprox: number;
  historyMalformed: boolean;
}

/** Loaded from --budget or null when absent/malformed (unconstrained). */
export interface BudgetState {
  totalPromptTokenTarget: number;
  maxScaffoldTokens: number;
  maxSkillTokens: number;
  maxToolTokens: number;
  maxHistoryTokens: number;
  reservedUserTokens: number;
  budgetCritical: boolean;
}

/** Loaded from --constraints or null when absent/malformed (no constraints). */
export interface UserConstraints {
  alwaysInclude: string[];
  neverInclude: string[];
  constraintSource: string;
}

/**
 * Loaded from --policy or defaulted.
 * injectionSuspectAction is an open string per schema design —
 * not a closed enum at the boundary. Orchestrator normalizes it in Phase 5+.
 */
export interface SelectorPolicy {
  failOpenThreshold: number;
  deterministicOnly: boolean;
  injectionSuspectAction: string;
}

// ---------------------------------------------------------------------------
// Aggregate result
// ---------------------------------------------------------------------------

/**
 * The result of a successful loadInputs() call.
 * All Class A inputs are present. All Class B inputs are either loaded or
 * their accepted fallback is applied. Warnings collect all Class B events.
 */
export interface LoadedInputs {
  /** Raw UTF-8 content of --request file. Phase 3 normalises. */
  requestText: RawRequestText;
  /** AJV-validated registry array. Phase 2 indexes. */
  registryRaw: RawComponentRegistry;
  /** Active IDs: loaded or silent-defaulted to empty arrays. */
  activeIds: ActiveIds;
  /** Runtime capabilities: loaded or fallback (capabilityInventoryComplete: false). */
  runtime: RuntimeCapabilities;
  /** History state: loaded or fallback (historyMalformed: true). */
  history: HistoryStateSummary;
  /** Budget state: loaded or null (unconstrained). */
  budget: BudgetState | null;
  /** User constraints: loaded or null (absent = no constraints; malformed = no constraints + warning). */
  constraints: UserConstraints | null;
  /** Selector policy: loaded or defaulted. deterministicOnly always true in MVP. */
  policy: SelectorPolicy;
  /**
   * Pre-normalized RequestSignals from --request-signals (Class B optional).
   * Non-null: loaded from file and validated against request-signals.schema.json;
   *   Phase 3 bypasses its stub and uses this object directly.
   * Null: --request-signals absent or malformed; Phase 3 uses its always-stub.
   */
  requestSignals: RequestSignals | null;
  /** All Class B planning warnings collected during loading. Not written to disk in Phase 1. */
  warnings: PlanningWarning[];
}
