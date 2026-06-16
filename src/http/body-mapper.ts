/**
 * HTTP body-to-LoadedInputs mapper for the ZAM HTTP Service.
 *
 * The CLI pipeline's loadInputs() reads files from disk and is filesystem-
 * coupled. The HTTP service receives all inputs as JSON in the request body.
 * This module constructs the equivalent LoadedInputs struct from the validated
 * HTTP body WITHOUT touching the filesystem, and WITHOUT modifying
 * src/core/input-loader.ts.
 *
 * Class B fallback semantics are preserved identically to the CLI path:
 *   - absent optional field → apply the same default that input-loader.ts uses
 *   - validation failure at the Fastify layer → Fastify returns 400 before this
 *     function is called, so all fields here are pre-validated
 *
 * Canonical: docs/21 §4.1; docs/18 §5; src/core/input-loader.ts defaults.
 */

import type {
  LoadedInputs,
  ActiveIds,
  RuntimeCapabilities,
  HistoryStateSummary,
  BudgetState,
  UserConstraints,
  SelectorPolicy,
  RequestSignals,
} from '../types/inputs.js';
import type { PlanningWarning } from '../types/warnings.js';
import type { AnalyzerOutput } from '../types/analyzer.js';
import type { ModelSelectorOutput } from '../types/model-selector.js';

// ---------------------------------------------------------------------------
// Class B defaults — must stay identical to input-loader.ts constants
// ---------------------------------------------------------------------------

const ACTIVE_IDS_DEFAULT: ActiveIds = {
  activeSkillIds: [],
  activeToolIds: [],
  activeMemoryIds: [],
};

const RUNTIME_DEFAULT: RuntimeCapabilities = {
  availableToolIds: [],
  unavailableToolIds: [],
  capabilityInventoryComplete: false,
  runtimeLabel: 'missing',
};

const HISTORY_DEFAULT: HistoryStateSummary = {
  lanesPresent: [],
  durableConstraintsPresent: false,
  openCommitmentsPresent: false,
  recentRawTurnCount: 0,
  totalHistoryTokensApprox: 0,
  historyMalformed: true,
};

const POLICY_DEFAULT: SelectorPolicy = {
  failOpenThreshold: 0.7,
  deterministicOnly: true,
  injectionSuspectAction: 'warn_and_continue',
};

// ---------------------------------------------------------------------------
// HTTP request body shape
// ---------------------------------------------------------------------------

/**
 * The expected shape of the POST /plan request body.
 * All fields except `request` and `registry` are optional — matching
 * the Class A / Class B input distinction from the CLI pipeline.
 *
 * Canonical: docs/18 §4.2.
 */
export interface PlanRequestBody {
  request: {
    text: string;
    /**
     * [FUTURE-ONLY] Optional metadata for re-entry signals.
     * Allows the External Runtime to signal re-entry without providing a full
     * requestSignals object. If requestSignals is also provided, it takes
     * precedence and metadata is ignored.
     * Canonical: docs/20 §4.2–§4.3 §5.3.
     */
    metadata?: {
      /** [FUTURE-ONLY] docs/20 §4.2 */
      reentryTurn?: boolean;
      /** [FUTURE-ONLY] docs/20 §4.3 */
      priorPlanId?: string;
      /** [FUTURE-ONLY] docs/20 §5.3 */
      loopSuspect?: boolean;
    };
  };
  registry: unknown[];       // component-registry.json array
  activeIds?: ActiveIds;
  runtime?: RuntimeCapabilities;
  history?: HistoryStateSummary;
  budget?: BudgetState | null;
  constraints?: UserConstraints | null;
  policy?: SelectorPolicy;
  requestSignals?: RequestSignals | null;
  /**
   * [FUTURE-ONLY] Optional model-assisted AnalyzerOutput.
   * When present, proposals are validated via AJV (src/http/validation/schemas.ts)
   * and passed to integrateAnalyzerOutput() in plan.ts.
   * NOT added to LoadedInputs — handled separately in the route handler.
   * Canonical: docs/15 §4; docs/18 §4.2.
   */
  analyzerOutput?: AnalyzerOutput | null;
  /**
   * [FUTURE-ONLY] Optional array of model-assisted selector outputs.
   * When present, each item is validated individually via AJV
   * (src/http/validation/schemas.ts validateModelSelectorOutputsBody).
   * Invalid items are skipped with warnings; valid items are passed to
   * integrateModelSelectorOutputs() in plan.ts.
   * NOT added to LoadedInputs — handled separately in the route handler.
   * Proposals are advisory only — deterministic Conflict Resolver Priority 0–4
   * takes precedence. Model proposals slot in at Priority 5 only.
   * Canonical: docs/19 §8; docs/13 §12; docs/18 §4.2.
   */
  modelSelectorOutputs?: ModelSelectorOutput[] | null;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map a validated PlanRequestBody to a LoadedInputs struct.
 *
 * Absent optional fields receive the same Class B defaults that the CLI's
 * input-loader.ts applies. Warnings are emitted for absent Class B fields
 * that would normally generate them in the CLI path.
 *
 * The registry is passed as-is — Fastify schema validation has already
 * confirmed it conforms to the component-registry schema shape. Phase 2
 * (buildRegistryIndexes) will perform the same cross-field validation it
 * always does.
 *
 * Canonical: docs/21 §4.1.
 */
export function mapBodyToLoadedInputs(body: PlanRequestBody): LoadedInputs {
  const warnings: PlanningWarning[] = [];

  // Active IDs — absent: silent default (no warning), matching CLI behavior
  const activeIds: ActiveIds = body.activeIds ?? ACTIVE_IDS_DEFAULT;

  // Runtime — absent: emit warning (matching CLI behavior)
  let runtime: RuntimeCapabilities;
  if (body.runtime != null) {
    runtime = body.runtime;
  } else {
    warnings.push({
      code: 'runtime_capabilities_missing',
      message:
        'runtime not provided in request body; treating capabilityInventoryComplete as false. ' +
        'All tool availability unknown; all tool components will be included.',
    });
    runtime = RUNTIME_DEFAULT;
  }

  // History — absent: emit warning (matching CLI behavior)
  let history: HistoryStateSummary;
  if (body.history != null) {
    history = body.history;
  } else {
    warnings.push({
      code: 'history_summary_missing',
      message:
        'history not provided in request body; treating all history components as uncertain ' +
        '(historyMalformed: true). All high-risk/non-optional history components will be included.',
    });
    history = HISTORY_DEFAULT;
  }

  // Budget — absent: emit warning (matching CLI behavior)
  let budget: BudgetState | null;
  if (body.budget !== undefined && body.budget !== null) {
    budget = body.budget;
  } else {
    if (body.budget === undefined) {
      warnings.push({
        code: 'budget_config_missing',
        message:
          'budget not provided in request body; treating budget as unconstrained. ' +
          'Selectors are budget-aware but not budget-enforcing.',
      });
    }
    budget = null;
  }

  // Constraints — absent: silent null (no warning), matching CLI behavior
  const constraints: UserConstraints | null = body.constraints ?? null;

  // Policy — absent: emit warning + apply defaults, matching CLI behavior
  let policy: SelectorPolicy;
  if (body.policy != null) {
    // deterministicOnly coercion: must be true in MVP (identical to CLI logic)
    if (!body.policy.deterministicOnly) {
      warnings.push({
        code: 'selector_policy_defaulted',
        message:
          'policy supplied deterministicOnly: false; model-assisted selectors are not ' +
          'implemented in MVP. Coercing to true.',
      });
      policy = { ...body.policy, deterministicOnly: true };
    } else {
      policy = body.policy;
    }
  } else {
    warnings.push({
      code: 'selector_policy_defaulted',
      message:
        'policy not provided in request body; applying safe defaults ' +
        '(failOpenThreshold: 0.7, deterministicOnly: true, injectionSuspectAction: "warn_and_continue").',
    });
    policy = { ...POLICY_DEFAULT };
  }

  // requestSignals — absent: null (Phase 3 stub will run), matching CLI behavior.
  // [FUTURE-ONLY] Exception: if body.request.metadata contains re-entry fields
  // (reentryTurn, priorPlanId, loopSuspect) and requestSignals is absent,
  // synthesize a minimal RequestSignals carry-through so the Phase 3 bypass path
  // picks up these signals. The synthesized object always includes required fields
  // (promptFamily, familyConfidence, injectionSuspect) set to their safe MVP
  // defaults. This preserves the fail-open invariant — no model calls, no
  // selector changes. Canonical: docs/20 §4.2–§4.3 §5.3.
  let requestSignals: RequestSignals | null;
  if (body.requestSignals != null) {
    // Explicit requestSignals takes full precedence. metadata is ignored.
    requestSignals = body.requestSignals;
  } else if (
    body.request.metadata != null &&
    (body.request.metadata.reentryTurn != null ||
      body.request.metadata.priorPlanId != null ||
      body.request.metadata.loopSuspect != null)
  ) {
    // Synthesize minimal signals carrying only the re-entry metadata fields.
    // Required fields are set to Phase 3 stub defaults (safe substitution).
    requestSignals = {
      promptFamily: 'general_default',
      familyConfidence: 0.0,
      injectionSuspect: false,
      ...(body.request.metadata.reentryTurn != null
        ? { reentryTurn: body.request.metadata.reentryTurn }
        : {}),
      ...(body.request.metadata.priorPlanId != null
        ? { priorPlanId: body.request.metadata.priorPlanId }
        : {}),
      ...(body.request.metadata.loopSuspect != null
        ? { loopSuspect: body.request.metadata.loopSuspect }
        : {}),
    };
    warnings.push({
      code: 'prompt_family_defaulted',
      message:
        '[FUTURE-ONLY] Re-entry metadata provided in request.metadata without explicit requestSignals. ' +
        'Synthesized minimal RequestSignals with general_default family (safe substitution). ' +
        'Canonical: docs/20 §4.2.',
    });
  } else {
    requestSignals = null;
  }

  return {
    requestText: body.request.text,
    registryRaw: body.registry,
    activeIds,
    runtime,
    history,
    budget,
    constraints,
    policy,
    requestSignals,
    warnings,
  };
}
