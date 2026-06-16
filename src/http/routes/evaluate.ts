/**
 * POST /evaluate route handler for the ZAM HTTP Service.
 *
 * Exposes the planning pipeline evaluation over HTTP. Mirrors the logic of
 * src/cli/commands/evaluate.ts but without filesystem access, subprocess
 * spawning, or process.exit(). Instead:
 *   - Input comes from request body (same PlanRequestBody shape as POST /plan).
 *   - The full 11-phase pipeline is run in-process.
 *   - Actual outputs are compared against caller-supplied expected objects.
 *   - Returns { fixtureId, passed, violations, actualPlan, actualTrace }.
 *
 * This handler does NOT import from src/cli/.
 * It does NOT modify harness-runner.ts, harness-checks.ts, or evaluate.ts.
 *
 * Comparison logic:
 *   Layer 1 — Partition comparison: selected/omitted/deferred component IDs
 *             must match between actual and expected prompt-plan.
 *   Layer 2 — Trace phase key comparison: the set of top-level keys in the
 *             actual trace must match the expected trace.
 *
 * Canonical: docs/21 §4.3; docs/18 §4.4; src/cli/commands/evaluate.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';

// Core pipeline phases — same as plan.ts
import { buildRegistryIndexes, RegistryFatalError } from '../../core/registry-loader.js';
import { normalizeInputs } from '../../core/request-normalizer.js';
import { buildCandidateSet, CandidateSetFatalError } from '../../core/candidate-set-builder.js';
import { runSelectorFanOut, computeSelectorSummary } from '../../core/selector-engine.js';
import { runGapCheck } from '../../core/gap-check.js';
import { runInjectionGate } from '../../core/injection-gate.js';
import { runConflictResolver } from '../../core/conflict-resolver.js';
import { runBudgeter } from '../../core/budgeter.js';
import { runPromptPlanGenerator } from '../../core/prompt-plan-generator.js';
import { runTraceAssembler, runSummaryAssembler } from '../../core/trace-summary-assembler.js';

import type { PlanningWarning } from '../../types/warnings.js';

import { mapBodyToLoadedInputs, type PlanRequestBody } from '../body-mapper.js';
import { buildError } from '../errors.js';

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

/**
 * Expected outputs supplied by the caller for comparison.
 * Both fields are optional — if absent, their comparison layer is skipped.
 */
interface EvaluateExpected {
  promptPlan?: Record<string, unknown>;
  trace?: Record<string, unknown>;
}

/** POST /evaluate request body. */
interface EvaluateRequestBody {
  /** Caller-supplied fixture identifier (used in response; not processed). */
  fixtureId: string;
  /** Input for the planning pipeline — same shape as POST /plan body. */
  input: PlanRequestBody;
  /** Expected outputs to compare against. */
  expected?: EvaluateExpected;
}

/** A single field-level violation found during output comparison. */
interface EvaluateViolation {
  field: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

/** POST /evaluate response body. */
interface EvaluateResponse {
  fixtureId: string;
  passed: boolean;
  violations: EvaluateViolation[];
  actualPlan: unknown;
  actualTrace: unknown;
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

/**
 * Extract the ordered list of componentIds from a prompt-plan partition array.
 * Returns [] if the partition is absent or malformed.
 */
function extractComponentIds(
  plan: Record<string, unknown>,
  partitionKey: string,
): string[] {
  const partition = plan[partitionKey];
  if (!Array.isArray(partition)) return [];
  return partition
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => String(e['componentId'] ?? ''))
    .filter(Boolean);
}

/**
 * Layer 1: Compare selected/omitted/deferred component ID sets.
 *
 * Matches the semantic comparison in harness-runner.ts comparePartitions().
 * Set-based — order does not matter.
 */
function comparePartitionLayer(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  violations: EvaluateViolation[],
): void {
  for (const key of ['selectedComponents', 'omittedComponents', 'deferredComponents'] as const) {
    const actualIds = new Set(extractComponentIds(actual, key));
    const expectedIds = new Set(extractComponentIds(expected, key));

    const missingFromActual = [...expectedIds].filter((id) => !actualIds.has(id));
    const extraInActual = [...actualIds].filter((id) => !expectedIds.has(id));

    if (missingFromActual.length > 0 || extraInActual.length > 0) {
      violations.push({
        field: `promptPlan.${key}`,
        expected: [...expectedIds].sort(),
        actual: [...actualIds].sort(),
        message:
          `Partition mismatch for ${key}: ` +
          (missingFromActual.length > 0 ? `missing=[${missingFromActual.join(', ')}] ` : '') +
          (extraInActual.length > 0 ? `extra=[${extraInActual.join(', ')}]` : ''),
      });
    }
  }
}

/**
 * Layer 2: Compare top-level phase keys of the trace.
 *
 * Matches the semantic comparison in harness-runner.ts comparePhaseKeys().
 * Extra keys in actual (beyond expected) are a hard violation.
 * Missing keys from actual are also a hard violation.
 */
function compareTracePhaseKeys(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  violations: EvaluateViolation[],
): void {
  const actualKeys = new Set(Object.keys(actual));
  const expectedKeys = new Set(Object.keys(expected));

  const missingFromActual = [...expectedKeys].filter((k) => !actualKeys.has(k));
  const extraInActual = [...actualKeys].filter((k) => !expectedKeys.has(k));

  if (missingFromActual.length > 0 || extraInActual.length > 0) {
    violations.push({
      field: 'trace (top-level phase keys)',
      expected: [...expectedKeys].sort(),
      actual: [...actualKeys].sort(),
      message:
        'Trace phase key mismatch: ' +
        (missingFromActual.length > 0 ? `missing=[${missingFromActual.join(', ')}] ` : '') +
        (extraInActual.length > 0 ? `extra=[${extraInActual.join(', ')}]` : ''),
    });
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register the POST /evaluate route on the Fastify instance.
 * Canonical: docs/21 §4.3.
 */
export async function evaluateRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: EvaluateRequestBody }>(
    '/evaluate',
    async (request: FastifyRequest<{ Body: EvaluateRequestBody }>, reply: FastifyReply) => {
      const body = request.body;

      if (!body || typeof body.fixtureId !== 'string' || !body.fixtureId) {
        return reply.status(400).send(
          buildError('VALIDATION_ERROR', '"fixtureId" must be a non-empty string.'),
        );
      }
      if (!body.input || typeof body.input !== 'object') {
        return reply.status(400).send(
          buildError('VALIDATION_ERROR', '"input" must be a non-null object matching PlanRequestBody.'),
        );
      }

      const fixtureId = body.fixtureId;
      const startedAt = new Date().toISOString();
      const runId = randomUUID();

      // -------------------------------------------------------------------
      // Run the full 11-phase planning pipeline (same as POST /plan)
      // -------------------------------------------------------------------

      const loadedInputs = mapBodyToLoadedInputs(body.input);

      let registryResult;
      try {
        registryResult = buildRegistryIndexes(loadedInputs.registryRaw);
      } catch (err) {
        if (err instanceof RegistryFatalError) {
          return reply.status(422).send(
            buildError('UNPROCESSABLE_REQUEST', `Registry fatal error [${err.code}]: ${err.message}`),
          );
        }
        throw err;
      }

      const normalizedInputs = normalizeInputs(loadedInputs, registryResult);

      let candidateSetResult;
      try {
        candidateSetResult = buildCandidateSet(registryResult);
      } catch (err) {
        if (err instanceof CandidateSetFatalError) {
          return reply.status(422).send(
            buildError('UNPROCESSABLE_REQUEST', `Candidate set fatal error [${err.code}]: ${err.message}`),
          );
        }
        throw err;
      }

      const fanOutResult = runSelectorFanOut(candidateSetResult, normalizedInputs, registryResult);
      const gapCheckResult = runGapCheck(fanOutResult, candidateSetResult);

      const allDecisions = [...fanOutResult.decisions, ...gapCheckResult.syntheticDecisions];
      computeSelectorSummary(allDecisions, fanOutResult.referencedUnknownComponents.length);

      const allTraceEntries = [
        ...fanOutResult.selectorTrace,
        ...gapCheckResult.syntheticTraceEntries,
      ];
      const gateResult = runInjectionGate(
        allDecisions,
        allTraceEntries,
        normalizedInputs,
        candidateSetResult.candidatesById,
      );

      const postGateSummary = computeSelectorSummary(
        gateResult.decisions,
        fanOutResult.referencedUnknownComponents.length,
      );

      const postGateDecisions = gateResult.decisions;
      const postGateTraceEntries = gateResult.traceEntries;

      const conflictResult = runConflictResolver(
        postGateDecisions,
        postGateTraceEntries,
        normalizedInputs,
        candidateSetResult.candidatesById,
      );

      const postConflictDecisions = conflictResult.resolvedDecisions;

      const budgetReport = runBudgeter(
        postConflictDecisions,
        normalizedInputs.budget,
        candidateSetResult.candidatesById,
      );

      const accumulatedWarnings: PlanningWarning[] = [
        ...loadedInputs.warnings,
        ...normalizedInputs.warnings,
        ...candidateSetResult.warnings,
        ...fanOutResult.warnings,
        ...gapCheckResult.warnings,
        ...gateResult.warnings,
        ...conflictResult.globalWarnings,
        ...conflictResult.unresolvedConflictWarnings.map((w) => ({
          code: w.warningCode,
          message: `unresolved conflict for ${w.componentId}`,
        })),
      ];

      const promptPlan = runPromptPlanGenerator(
        postConflictDecisions,
        budgetReport,
        normalizedInputs,
        candidateSetResult.candidatesById,
        accumulatedWarnings,
      );

      const completedAt = new Date().toISOString();

      const traceOutput = runTraceAssembler({
        runId,
        planningRunStartedAt: startedAt,
        planningRunCompletedAt: completedAt,
        schemaVersion: 'v0',
        normalizedInputs,
        registryResult,
        candidateSetResult,
        fanOutResult,
        gapCheckResult,
        gateResult,
        conflictResult,
        budgetReport,
        promptPlan,
        postGateSummary,
        accumulatedWarnings,
      });

      const _summaryOutput = runSummaryAssembler({
        promptFamily: normalizedInputs.requestSignals.promptFamily,
        selectorSummary: postGateSummary,
        budgetReport,
        riskFlags: promptPlan.riskFlags,
        failOpenReasons: promptPlan.failOpenReasons,
        planningWarningsCount: accumulatedWarnings.length,
      });

      // -------------------------------------------------------------------
      // Compare actual vs expected (Layers 1 and 2)
      // -------------------------------------------------------------------

      const violations: EvaluateViolation[] = [];
      const expected = body.expected;

      if (expected) {
        // Layer 1: prompt-plan partition comparison
        if (expected.promptPlan && typeof expected.promptPlan === 'object') {
          comparePartitionLayer(
            promptPlan as unknown as Record<string, unknown>,
            expected.promptPlan,
            violations,
          );
        }

        // Layer 2: trace phase key comparison
        if (expected.trace && typeof expected.trace === 'object') {
          compareTracePhaseKeys(
            traceOutput as unknown as Record<string, unknown>,
            expected.trace,
            violations,
          );
        }
      }

      const response: EvaluateResponse = {
        fixtureId,
        passed: violations.length === 0,
        violations,
        actualPlan: promptPlan,
        actualTrace: traceOutput,
      };

      return reply.status(200).send(response);
    },
  );
}
