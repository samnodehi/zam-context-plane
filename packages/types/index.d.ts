/**
 * @zam/types — canonical cross-package type declarations.
 *
 * Single source of truth for types shared between the ZAM Core (`context-plane`,
 * at the repo root) and the ZAM Runtime (`@zam/runtime`). Previously these were
 * hand-duplicated in both packages because the runtime cannot import core's
 * `src/types/*` across the TypeScript `rootDir` boundary (see DEBT.md C3).
 *
 * This is a hand-authored declaration file (no emit), consumed via tsconfig
 * `paths` + `import type`. Being a `.d.ts` means re-exporting it from a package's
 * `src/` never triggers TS6059 ("not under rootDir"), and `import type` is fully
 * erased by esbuild/vitest at runtime — so no install, build, or hoist is needed.
 *
 * These types are `[FUTURE-ONLY]` and mirror their JSON Schemas exactly:
 *   - AnalyzerOutput      → schemas/future/analyzer-output.schema.json
 *   - ProposalDecision /  → schemas/future/model-selector-output.schema.json
 *     ModelSelectorOutput
 *
 * Canonical: docs/15 §4; docs/19 §8; docs/32.
 */

/**
 * Structured output produced by a model-assisted Request Analyzer.
 * Advisory only — enters the pipeline through the analyzer integrator and must
 * not override deterministic guardrails. Canonical: docs/15 §4.2.
 */
export interface AnalyzerOutput {
  /** Identifier of the analyzer model/version that produced this output (audit, not a schema version). */
  analyzerVersion: string;
  /** Routing tier: 0 deterministic fast path; 1 light analyzer; 2 stronger analyzer; 3 fail-open expanded. */
  tier: 0 | 1 | 2 | 3;
  /** Prompt family classification proposal (PromptFamilyValue enum value; docs/06 §2.2). */
  promptFamily: string;
  /** Broad request category (e.g. 'coding', 'research', 'greeting'). Optional. */
  requestType?: string;
  /** Specific task shape (e.g. 'debug', 'refactor', 'continuation'). Optional. */
  taskType?: string;
  /** Analyzer float confidence in its classification (0.0–1.0). */
  analyzerConfidence: number;
  /** Request-level risk assessment. 'high'/'critical' force Tier 3 fail-open regardless of confidence. */
  assessedRequestRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Lanes the analyzer proposes as relevant. Advisory; cannot override protected lanes. */
  neededLanes: string[];
  /** Whether the request semantically needs history context. Advisory. */
  requiresHistory: boolean;
  /** Whether the request needs tool context. Advisory. */
  requiresTools: boolean;
  /** Whether the request needs file/project context. Advisory. */
  requiresFiles: boolean;
  /** True when this output is a fail-open expansion rather than a confident classification. */
  failOpenTriggered: boolean;
  /** Human-readable reason fail-open was triggered, or null. Required in trace when triggered. */
  failOpenReason: string | null;
  /** Coded signals/patterns the analyzer used. Required for auditability. */
  evidence: string[];
  /** Unique ID linking this output to its trace entry. */
  analyzerTraceId: string;
}

/**
 * One proposal record per component evaluated by a model-assisted selector.
 * `[FUTURE-ONLY]` — advisory input only; the integrator converts these into
 * SelectionDecision records before the Conflict Resolver. Canonical: docs/19 §8.
 */
export interface ProposalDecision {
  /** Registry component ID this proposal applies to (must be a known, non-quarantined component). */
  componentId: string;
  /** Proposed action (values identical to SelectionAction; docs/06 §4). */
  action: 'include' | 'omit' | 'defer' | 'reference_unknown';
  /** Model confidence (values identical to SelectionConfidence). Low confidence → fail-open in integrator. */
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable rationale. Must not contain raw component/history/user content. */
  reason: string;
  /** Coded signal atoms justifying the proposal. Non-empty for any 'omit'/'defer'. */
  evidence: string[];
  /** Decision ladder path (values identical to SelectionPath; docs/06 §4). */
  path:
    | 'required_match'
    | 'safe_to_omit_match'
    | 'default_action_omit'
    | 'default_include'
    | 'default_defer'
    | 'fail_open'
    | 'conflict_include'
    | 'safety_override'
    | 'runtime_unavailable'
    | 'not_evaluated'
    | 'reference_unknown'
    | 'quarantine_boundary_violation';
}

/**
 * Structured output produced by a model-assisted selector during fan-out.
 * Intentionally separate from SelectionDecision (docs/19 §8 OQ-2). Canonical: docs/19 §8.
 */
export interface ModelSelectorOutput {
  /** Name identifying the selector ('model_assisted_<scope>'; docs/19 §9). */
  selectorName: string;
  /** One ProposalDecision per component evaluated (may be empty). */
  proposals: ProposalDecision[];
}
