/**
 * Phase P10: TypeScript interfaces for AnalyzerOutput. [FUTURE-ONLY]
 *
 * Mirrors schemas/future/analyzer-output.schema.json exactly.
 *
 * ISOLATION INVARIANTS:
 *   - These types are used only by src/core/analyzer-integrator.ts and
 *     the --analyzer-output path in src/cli/commands/plan.ts and
 *     src/core/input-loader.ts.
 *   - They are NOT used by any MVP pipeline module.
 *   - The AnalyzerOutput type does NOT extend or modify any MVP type
 *     (SelectionDecision, RequestSignals, LoadedInputs, etc.).
 *   - No field from this type may be added to any MVP schema without
 *     a separate explicit schema decision pass.
 *
 * Canonical: docs/15_REQUEST_ANALYZER_SCHEMA_SCOPING.md §4;
 *            schemas/future/analyzer-output.schema.json.
 */

/**
 * Structured output produced by a model-assisted Request Analyzer.
 *
 * This is a [FUTURE-ONLY] type. It does not participate in any MVP planning
 * pipeline phase. It enters the pipeline as advisory proposals only, through
 * the analyzer integrator, and must not override deterministic guardrails.
 *
 * Canonical: docs/15 §4; schemas/future/analyzer-output.schema.json.
 */
export interface AnalyzerOutput {
  /**
   * Identifier of the analyzer model or version that produced this output.
   * For audit and reproducibility. Not a schema version.
   * Canonical: docs/15 §4.2.
   */
  analyzerVersion: string;

  /**
   * Which routing tier was applied.
   * 0 = deterministic fast path; 1 = lightweight analyzer;
   * 2 = stronger analyzer/planner; 3 = fail-open expanded context.
   * Canonical: docs/15 §5.
   */
  tier: 0 | 1 | 2 | 3;

  /**
   * [FUTURE-ONLY] Prompt family classification proposal.
   * Must be a value from the accepted PromptFamilyValue enum (docs/06 §2.2).
   * Canonical: docs/15 §4.2.
   */
  promptFamily: string;

  /**
   * [FUTURE-ONLY] Broad request category (e.g. 'coding', 'research', 'greeting').
   * Does not exist in MVP. Optional.
   * Canonical: docs/15 §4.2.
   */
  requestType?: string;

  /**
   * [FUTURE-ONLY] Specific task shape (e.g. 'debug', 'refactor', 'continuation').
   * Does not exist in MVP. Optional.
   * Canonical: docs/15 §4.2.
   */
  taskType?: string;

  /**
   * [FUTURE-ONLY] Analyzer float confidence in its classification (0.0–1.0).
   * Distinct from SelectionDecision.confidence (string enum high/medium/low,
   * owned by docs/06 §4). Aligned with requestSignals.familyConfidence (float).
   * Canonical: docs/15 §4.2.
   */
  analyzerConfidence: number;

  /**
   * [FUTURE-ONLY] Analyzer assessment of request-level risk.
   * Distinct from component riskLevel (docs/05 §5) which is per-component.
   * This is a request-level assessment only.
   * Values 'high' or 'critical' trigger Tier 3 fail-open regardless of confidence.
   * Canonical: docs/15 §4.2, §6.
   */
  assessedRequestRiskLevel: 'low' | 'medium' | 'high' | 'critical';

  /**
   * [FUTURE-ONLY] Lanes the analyzer proposes as relevant for this request.
   * Advisory only — does not override protected lanes.
   * All proposals enter the Conflict Resolver as additional SelectionDecision inputs.
   * Canonical: docs/15 §4.2.
   */
  neededLanes: string[];

  /**
   * [FUTURE-ONLY] Whether the request semantically needs history context.
   * Advisory. Protected lanes cannot be omitted regardless of this value.
   * Canonical: docs/15 §4.2.
   */
  requiresHistory: boolean;

  /**
   * [FUTURE-ONLY] Whether the request needs tool context. Advisory.
   * Canonical: docs/15 §4.2.
   */
  requiresTools: boolean;

  /**
   * [FUTURE-ONLY] Whether the request needs file/project context. Advisory.
   * Canonical: docs/15 §4.2.
   */
  requiresFiles: boolean;

  /**
   * Whether this output represents a fail-open expansion rather than a
   * confident classification.
   * Must be true when analyzerConfidence < threshold OR when
   * assessedRequestRiskLevel is 'high' or 'critical'.
   * Canonical: docs/15 §4.2, §6.
   */
  failOpenTriggered: boolean;

  /**
   * Human-readable reason why fail-open was triggered, or null if not triggered.
   * Required in trace when failOpenTriggered is true.
   * Canonical: docs/15 §4.2.
   */
  failOpenReason: string | null;

  /**
   * The textual signals or patterns the analyzer used to reach its classification.
   * Required for auditability and trace.
   * Canonical: docs/15 §4.2.
   */
  evidence: string[];

  /**
   * Unique ID linking this AnalyzerOutput to its trace entry in trace.json.
   * Required for full traceability.
   * Canonical: docs/15 §4.2.
   */
  analyzerTraceId: string;
}
