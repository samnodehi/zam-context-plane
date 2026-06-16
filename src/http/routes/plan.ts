/**
 * POST /plan route handler for the ZAM HTTP Service.
 *
 * Mirrors the 11-phase pipeline from src/cli/commands/plan.ts, replacing:
 *   - Filesystem reads  → JSON body fields (already Fastify-validated)
 *   - Disk writes       → JSON response body
 *   - process.exit(1)   → HTTP 422 / 500 error responses
 *
 * Core pipeline modules (Phases 1–11) are called exactly as in the CLI.
 * This file does NOT modify any src/core/*.ts file.
 *
 * Canonical: docs/18 §4.2; docs/21 §4.1; src/cli/commands/plan.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';

// Core pipeline phases — imported directly, same as CLI
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
import { validateAnalyzerOutputBody, validateModelSelectorOutputsBody } from '../validation/schemas.js';
import { integrateAnalyzerOutput } from '../../core/analyzer-integrator.js';
import { integrateModelSelectorOutputs } from '../../core/model-selector-integrator.js';

/**
 * Register the POST /plan route on the Fastify instance.
 * Canonical: docs/18 §4.2; docs/21 §4.1.
 */
export async function planRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: PlanRequestBody }>(
    '/plan',
    async (request: FastifyRequest<{ Body: PlanRequestBody }>, reply: FastifyReply) => {
      const startedAt = new Date().toISOString();
      const runId = randomUUID();

      const body = request.body;

      // -----------------------------------------------------------------------
      // Pre-flight validation: ensure required Class A fields are present.
      //
      // Fastify has no JSON schema defined for this route, so TypeScript typing
      // alone does not prevent missing fields at runtime. An absent 'request'
      // causes mapBodyToLoadedInputs() to throw a TypeError (500), and an
      // absent 'registry' causes similar failures downstream.
      //
      // Return explicit 400 VALIDATION_ERROR rather than a 500 INTERNAL_ERROR.
      // Canonical: docs/30 §4.3 HT-2; docs/18 §4.2.
      // -----------------------------------------------------------------------
      if (
        !body ||
        typeof body.request !== 'object' ||
        body.request === null ||
        typeof (body.request as { text?: unknown }).text !== 'string'
      ) {
        return reply.status(400).send(
          buildError('VALIDATION_ERROR', '"request" must be an object with a "text" string field.'),
        );
      }
      if (!Array.isArray(body.registry)) {
        return reply.status(400).send(
          buildError('VALIDATION_ERROR', '"registry" must be an array.'),
        );
      }

      // -----------------------------------------------------------------------
      // Phase 1 equivalent: map body → LoadedInputs (no filesystem I/O)
      // -----------------------------------------------------------------------
      const loadedInputs = mapBodyToLoadedInputs(body);


      // -----------------------------------------------------------------------
      // Phase 2: Registry indexing, cross-field validation, and quarantine
      // -----------------------------------------------------------------------
      let registryResult;
      try {
        registryResult = buildRegistryIndexes(loadedInputs.registryRaw);
      } catch (err) {
        if (err instanceof RegistryFatalError) {
          return reply.status(422).send(
            buildError(
              'UNPROCESSABLE_REQUEST',
              `Registry fatal error [${err.code}]: ${err.message}`,
            ),
          );
        }
        throw err;
      }

      // -----------------------------------------------------------------------
      // Phase 3: Request / runtime / history / active-IDs normalization
      // -----------------------------------------------------------------------
      const normalizedInputs = normalizeInputs(loadedInputs, registryResult);

      // -----------------------------------------------------------------------
      // Phase 4: Candidate set construction
      // -----------------------------------------------------------------------
      let candidateSetResult;
      try {
        candidateSetResult = buildCandidateSet(registryResult);
      } catch (err) {
        if (err instanceof CandidateSetFatalError) {
          return reply.status(422).send(
            buildError(
              'UNPROCESSABLE_REQUEST',
              `Candidate set fatal error [${err.code}]: ${err.message}`,
            ),
          );
        }
        throw err;
      }

      // -----------------------------------------------------------------------
      // Phase 5: Selector fan-out and deterministic ladder
      // -----------------------------------------------------------------------
      const fanOutResult = runSelectorFanOut(candidateSetResult, normalizedInputs, registryResult);

      // -----------------------------------------------------------------------
      // Phase 6: Gap-check and synthetic not_evaluated decisions
      // -----------------------------------------------------------------------
      const gapCheckResult = runGapCheck(fanOutResult, candidateSetResult);

      // Recompute selectorSummary over merged decision set (matches CLI logic)
      const allDecisions = [...fanOutResult.decisions, ...gapCheckResult.syntheticDecisions];
      computeSelectorSummary(
        allDecisions,
        fanOutResult.referencedUnknownComponents.length,
      );

      // -----------------------------------------------------------------------
      // Phase 7: Injection gate / policy normalization
      // -----------------------------------------------------------------------
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

      // Recompute post-gate summary (matches CLI logic)
      const postGateSummary = computeSelectorSummary(
        gateResult.decisions,
        fanOutResult.referencedUnknownComponents.length,
      );

      const postGateDecisions = gateResult.decisions;
      const postGateTraceEntries = gateResult.traceEntries;

      // -----------------------------------------------------------------------
      // Phase P10 (future-only): Analyzer output integration
      // If analyzerOutput was provided in the request body, validate it and
      // run the integrator to merge synthetic proposals into postGateDecisions.
      // Proposals are advisory only — the Conflict Resolver's deterministic
      // priority ladder (P0–P4) takes precedence over all advisory inputs.
      // Canonical: docs/15; src/core/analyzer-integrator.ts.
      // -----------------------------------------------------------------------
      const analyzerLoadWarnings: PlanningWarning[] = [];
      const loadedAnalyzerOutput = validateAnalyzerOutputBody(
        body.analyzerOutput,
        analyzerLoadWarnings,
      );

      let allPostGateDecisions = postGateDecisions;
      let allPostGateTraceEntries = postGateTraceEntries;

      if (loadedAnalyzerOutput !== null) {
        const analyzerResult = integrateAnalyzerOutput(
          loadedAnalyzerOutput,
          candidateSetResult.candidatesById,
        );

        // Merge analyzer proposals into the post-gate decision set.
        // These proposals enter the Conflict Resolver alongside deterministic
        // decisions. Priority P0–P4 will override them as appropriate.
        allPostGateDecisions = [...postGateDecisions, ...analyzerResult.decisions];
        allPostGateTraceEntries = [...postGateTraceEntries, ...analyzerResult.traceEntries];

        // Carry analyzer + integration warnings into accumulatedWarnings so
        // they appear in the trace output.
        analyzerLoadWarnings.push(...analyzerResult.warnings);
      }

      // -----------------------------------------------------------------------
      // Phase P6 (future-only): Model-Assisted Selector output integration
      // If modelSelectorOutputs was provided in the request body, validate each
      // item and run the integrator to merge synthetic proposals into
      // allPostGateDecisions. Proposals are advisory only — the Conflict
      // Resolver's deterministic priority ladder (P0–P4) takes precedence.
      // Model proposals slot in at Priority 5 only (docs/19 §5).
      // Canonical: docs/19; src/core/model-selector-integrator.ts.
      // -----------------------------------------------------------------------
      const modelSelectorLoadWarnings: PlanningWarning[] = [];
      const loadedModelSelectorOutputs = validateModelSelectorOutputsBody(
        body.modelSelectorOutputs,
        modelSelectorLoadWarnings,
      );

      if (loadedModelSelectorOutputs !== null) {
        const selectorResult = integrateModelSelectorOutputs(
          loadedModelSelectorOutputs,
          candidateSetResult.candidatesById,
        );

        // Merge model selector proposals into the post-gate decision set.
        // These proposals enter the Conflict Resolver alongside deterministic
        // decisions. Priority P0–P4 will override them as appropriate.
        allPostGateDecisions = [...allPostGateDecisions, ...selectorResult.decisions];
        allPostGateTraceEntries = [...allPostGateTraceEntries, ...selectorResult.traceEntries];

        // Carry model selector + integration warnings forward.
        modelSelectorLoadWarnings.push(...selectorResult.warnings);
      }

      // -----------------------------------------------------------------------
      // Phase 8: Conflict resolution
      // -----------------------------------------------------------------------
      const conflictResult = runConflictResolver(
        allPostGateDecisions,
        allPostGateTraceEntries,
        normalizedInputs,
        candidateSetResult.candidatesById,
      );

      const postConflictDecisions = conflictResult.resolvedDecisions;

      // -----------------------------------------------------------------------
      // Phase 9: Budgeter
      // -----------------------------------------------------------------------
      const budgetReport = runBudgeter(
        postConflictDecisions,
        normalizedInputs.budget,
        candidateSetResult.candidatesById,
      );

      // -----------------------------------------------------------------------
      // Phase 10: Prompt Plan Generator
      // -----------------------------------------------------------------------
      const accumulatedWarnings: PlanningWarning[] = [
        ...loadedInputs.warnings,
        ...normalizedInputs.warnings,
        ...candidateSetResult.warnings,
        ...fanOutResult.warnings,
        ...gapCheckResult.warnings,
        ...gateResult.warnings,
        ...analyzerLoadWarnings,
        ...modelSelectorLoadWarnings,
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

      // -----------------------------------------------------------------------
      // Phase 11: Trace and Summary Assembly
      // -----------------------------------------------------------------------
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

      const summaryOutput = runSummaryAssembler({
        promptFamily: normalizedInputs.requestSignals.promptFamily,
        selectorSummary: postGateSummary,
        budgetReport,
        riskFlags: promptPlan.riskFlags,
        failOpenReasons: promptPlan.failOpenReasons,
        planningWarningsCount: accumulatedWarnings.length,
      });

      // -----------------------------------------------------------------------
      // Response — replaces disk writes from CLI path (docs/18 §4.2)
      // -----------------------------------------------------------------------
      return reply.status(200).send({
        promptPlan,
        trace: traceOutput,
        summary: summaryOutput,
      });
    },
  );
}
