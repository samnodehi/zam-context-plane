/**
 * HTTP integration tests for POST /plan — ZAM HTTP Service.
 *
 * Uses Fastify's server.inject() to exercise the full route without opening
 * a real TCP socket. No network I/O. No filesystem writes.
 *
 * Test strategy (docs/21 §5):
 *   - A small subset of existing harness fixture inputs are used as payloads.
 *   - Only structurally valid inputs that produce a 200 response are tested here.
 *   - The 651-test MVP baseline (tests/phase12/) is NOT modified.
 *   - Tests assert: response status 200, presence of promptPlan/trace/summary.
 *
 * Canonical: docs/21 §5; docs/18 §4.2.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/http/server.js';

// ---------------------------------------------------------------------------
// Fixture data (inline subset of fixtures/05-selector-ladder/required-when-match)
// ---------------------------------------------------------------------------

const REGISTRY_TWO_COMPONENTS = [
  {
    id: 'scaffold.system-rules',
    type: 'scaffold',
    title: 'System Rules Scaffold',
    summary: 'Defines baseline behavioral rules for the agent across all contexts.',
    source: 'scaffold/system_rules.md',
    tokensApprox: 320,
    charsApprox: 1280,
    riskLevel: 'medium',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'fail_open',
    retainPolicy: 'durable',
    budgetPriority: 7,
    evidenceRequired: null,
    tags: ['scaffold', 'system'],
    version: '1.0.0',
    hash: null,
  },
  {
    id: 'skill.coding-guide',
    type: 'skill',
    title: 'Coding Assistant Guide',
    summary: 'Provides coding conventions, patterns, and debugging strategies.',
    source: 'skills/coding_guide.md',
    tokensApprox: 480,
    charsApprox: 1920,
    riskLevel: 'low',
    requiredWhen: ['coding_build_debug'],
    safeToOmitWhen: ['simple_greeting', 'heartbeat_proactive'],
    defaultAction: 'omit',
    omissionPolicy: 'allow',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: ['skill', 'coding', 'debug'],
    version: '1.0.0',
    hash: null,
  },
];

const ACTIVE_IDS = {
  activeSkillIds: [],
  activeToolIds: [],
  activeMemoryIds: [],
};

const RUNTIME = {
  availableToolIds: [],
  unavailableToolIds: [],
  capabilityInventoryComplete: false,
  runtimeLabel: 'mvp_cli_no_tools',
};

const HISTORY = {
  lanesPresent: [],
  durableConstraintsPresent: false,
  openCommitmentsPresent: false,
  recentRawTurnCount: 0,
  totalHistoryTokensApprox: 0,
  historyMalformed: false,
};

const POLICY = {
  failOpenThreshold: 0.7,
  deterministicOnly: true,
  injectionSuspectAction: 'warn_and_continue',
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /plan', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    // Build server with no real port — inject() handles all requests in-memory.
    // Ensure ZAM_API_KEY is not set for these tests (local-only mode).
    delete process.env['ZAM_API_KEY'];
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200 with promptPlan, trace, and summary for minimal valid request (MVP stub path)', async () => {
    const payload = {
      request: { text: 'Help me debug my code.' },
      registry: REGISTRY_TWO_COMPONENTS,
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');
    expect(body).toHaveProperty('summary');
    expect(typeof body['summary']).toBe('string');
  });

  it('returns 200 with all optional fields provided and request-signals bypassing Phase 3 stub', async () => {
    const payload = {
      request: { text: 'Help me debug my code.' },
      registry: REGISTRY_TWO_COMPONENTS,
      activeIds: ACTIVE_IDS,
      runtime: RUNTIME,
      history: HISTORY,
      policy: POLICY,
      requestSignals: {
        promptFamily: 'coding_build_debug',
        familyConfidence: 0.95,
        injectionSuspect: false,
      },
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');
    expect(body).toHaveProperty('summary');

    // When coding_build_debug is the family and skill.coding-guide has
    // requiredWhen: ['coding_build_debug'], it should appear in selectedComponents.
    const plan = body['promptPlan'] as { selectedComponents?: { componentId: string }[] };
    const selectedIds = (plan.selectedComponents ?? []).map((c) => c.componentId);
    expect(selectedIds).toContain('skill.coding-guide');
  });

  it('returns 200 with general_default family (MVP stub) — scaffold always included', async () => {
    const payload = {
      request: { text: 'Hello!' },
      registry: REGISTRY_TWO_COMPONENTS,
      // No requestSignals: Phase 3 stub fires → general_default
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    const plan = body['promptPlan'] as { selectedComponents?: { componentId: string }[] };
    const selectedIds = (plan.selectedComponents ?? []).map((c) => c.componentId);
    // scaffold.system-rules has defaultAction: include → always selected
    expect(selectedIds).toContain('scaffold.system-rules');
  });

  it('returns 401 when ZAM_API_KEY is set and header is missing', async () => {
    // Temporarily build a second server with auth enabled
    process.env['ZAM_API_KEY'] = 'test-secret-key';
    const authServer = await buildServer({ logger: false });
    await authServer.ready();

    try {
      const response = await authServer.inject({
        method: 'POST',
        url: '/plan',
        payload: {
          request: { text: 'test' },
          registry: REGISTRY_TWO_COMPONENTS,
        },
        headers: { 'content-type': 'application/json' },
        // Intentionally omit x-zam-api-key
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect((body['error'] as Record<string, unknown>)['code']).toBe('AUTH_ERROR');
    } finally {
      await authServer.close();
      delete process.env['ZAM_API_KEY'];
    }
  });

  it('returns 200 when ZAM_API_KEY is set and correct key is provided', async () => {
    process.env['ZAM_API_KEY'] = 'test-secret-key';
    const authServer = await buildServer({ logger: false });
    await authServer.ready();

    try {
      const response = await authServer.inject({
        method: 'POST',
        url: '/plan',
        payload: {
          request: { text: 'test' },
          registry: REGISTRY_TWO_COMPONENTS,
        },
        headers: {
          'content-type': 'application/json',
          'x-zam-api-key': 'test-secret-key',
        },
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await authServer.close();
      delete process.env['ZAM_API_KEY'];
    }
  });

  // Constant-time key comparison (timingSafeEqual over SHA-256 digests) must
  // reject wrong keys of BOTH a different length and the same length, without
  // throwing on the length mismatch. Canonical: DEBT.md C5; src/http/server.ts.
  it('returns 401 for a wrong key of different length', async () => {
    process.env['ZAM_API_KEY'] = 'test-secret-key';
    const authServer = await buildServer({ logger: false });
    await authServer.ready();

    try {
      const response = await authServer.inject({
        method: 'POST',
        url: '/plan',
        payload: { request: { text: 'test' }, registry: REGISTRY_TWO_COMPONENTS },
        headers: { 'content-type': 'application/json', 'x-zam-api-key': 'x' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect((body['error'] as Record<string, unknown>)['code']).toBe('AUTH_ERROR');
    } finally {
      await authServer.close();
      delete process.env['ZAM_API_KEY'];
    }
  });

  it('returns 401 for a wrong key of the same length', async () => {
    process.env['ZAM_API_KEY'] = 'test-secret-key';
    const authServer = await buildServer({ logger: false });
    await authServer.ready();

    try {
      const response = await authServer.inject({
        method: 'POST',
        url: '/plan',
        payload: { request: { text: 'test' }, registry: REGISTRY_TWO_COMPONENTS },
        // Same length as 'test-secret-key' (15 chars), different content.
        headers: { 'content-type': 'application/json', 'x-zam-api-key': 'WRONG-secret-ky' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect((body['error'] as Record<string, unknown>)['code']).toBe('AUTH_ERROR');
    } finally {
      await authServer.close();
      delete process.env['ZAM_API_KEY'];
    }
  });

  it('[P10] returns 200 and includes analyzer-proposed lane via fail_open advisory path', async () => {
    /**
     * Scenario:
     *   - No requestSignals → Phase 3 stub → general_default family.
     *   - skill.coding-guide: requiredWhen: ['coding_build_debug'], defaultAction: 'omit'.
     *     Under general_default it is NOT selected by the deterministic ladder.
     *   - AnalyzerOutput proposes neededLanes: ['skill.coding-guide'] with low
     *     confidence (0.4) and failOpenTriggered: true.
     *   - The integrator converts this to action: include, path: fail_open.
     *     The Conflict Resolver resolves include vs omit via fail_open_unresolved → include.
     *   - Expected: skill.coding-guide appears in selectedComponents.
     */
    const payload = {
      request: { text: 'Hello!' },
      registry: REGISTRY_TWO_COMPONENTS,
      analyzerOutput: {
        analyzerVersion: 'test-http-v1.0',
        tier: 3,
        promptFamily: 'general_default',
        analyzerConfidence: 0.4,
        assessedRequestRiskLevel: 'low',
        neededLanes: ['skill.coding-guide'],
        requiresHistory: false,
        requiresTools: false,
        requiresFiles: false,
        failOpenTriggered: true,
        failOpenReason: 'Low confidence — expanding context via fail-open.',
        evidence: ['http-test-evidence'],
        analyzerTraceId: 'http-test-trace-001',
      },
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');

    const plan = body['promptPlan'] as { selectedComponents?: { componentId: string }[] };
    const selectedIds = (plan.selectedComponents ?? []).map((c) => c.componentId);
    expect(selectedIds).toContain('skill.coding-guide');
  });

  it('[P10] returns 200 and skips proposals when analyzerOutput is schema-invalid', async () => {
    /**
     * Scenario:
     *   - analyzerOutput provided but missing required fields → schema-invalid.
     *   - validateAnalyzerOutputBody returns null, emits analyzer_output_invalid warning.
     *   - Pipeline runs without any analyzer proposals. No crash.
     *   - Expected: response is 200, promptPlan and trace are present.
     */
    const payload = {
      request: { text: 'Hello!' },
      registry: REGISTRY_TWO_COMPONENTS,
      analyzerOutput: {
        // Intentionally invalid: missing all required fields
        notAValidField: 'should-be-skipped',
      },
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');
  });

  it('[P6] returns 200 and integrates model selector output resolving an unknown component', async () => {
    /**
     * Scenario:
     *   - No requestSignals → Phase 3 stub → general_default family.
     *   - skill.coding-guide: requiredWhen: ['coding_build_debug'], defaultAction: 'omit'.
     *     Under general_default it is NOT selected by the deterministic ladder.
     *   - modelSelectorOutputs provides a 'model_assisted_skill' selector proposing
     *     action: 'include', confidence: 'high' for 'skill.coding-guide'.
     *   - The integrator converts this ProposalDecision to a SelectionDecision
     *     (action: include, path: fail_open since path is 'fail_open').
     *   - The Conflict Resolver resolves include vs. the omit decision → include.
     *   - Expected: skill.coding-guide appears in selectedComponents.
     */
    const payload = {
      request: { text: 'Hello!' },
      registry: REGISTRY_TWO_COMPONENTS,
      modelSelectorOutputs: [
        {
          selectorName: 'model_assisted_skill',
          proposals: [
            {
              componentId: 'skill.coding-guide',
              action: 'include',
              confidence: 'high',
              reason: 'User message implies coding context.',
              evidence: ['keyword:debug', 'keyword:code'],
              path: 'fail_open',
            },
          ],
        },
      ],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');

    const plan = body['promptPlan'] as { selectedComponents?: { componentId: string }[] };
    const selectedIds = (plan.selectedComponents ?? []).map((c) => c.componentId);
    expect(selectedIds).toContain('skill.coding-guide');
  });

  it('[P6] returns 200 and gracefully skips invalid modelSelectorOutputs', async () => {
    /**
     * Scenario:
     *   - modelSelectorOutputs provided but item is schema-invalid
     *     (missing required 'proposals' field).
     *   - validateModelSelectorOutputsBody skips the invalid item, emits warning.
     *   - Pipeline runs without model selector proposals. No crash.
     *   - Expected: response is 200, promptPlan and trace are present.
     */
    const payload = {
      request: { text: 'Hello!' },
      registry: REGISTRY_TWO_COMPONENTS,
      modelSelectorOutputs: [
        {
          // Intentionally invalid: missing required 'selectorName' and 'proposals' fields
          notAValidField: 'should-be-skipped',
        },
      ],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');
  });

  it('[RE] returns 200 when re-entry signals are provided via request.metadata', async () => {
    /**
     * Scenario:
     *   - External Runtime sends reentryTurn: true and priorPlanId in request.metadata
     *     (docs/20 §4.2–§4.3 integration path).
     *   - No explicit requestSignals — body-mapper synthesizes minimal RequestSignals
     *     from metadata (general_default family, safe defaults).
     *   - Phase 3 bypass path passes synthesized requestSignals through verbatim.
     *   - Pipeline completes normally. Re-entry signals do not alter deterministic
     *     component selection (they are advisory only in this pass).
     *   - Expected: 200 response with promptPlan and trace present.
     */
    const payload = {
      request: {
        text: 'Continue from where we left off.',
        metadata: {
          reentryTurn: true,
          priorPlanId: 'run-abc123',
        },
      },
      registry: REGISTRY_TWO_COMPONENTS,
      activeIds: ACTIVE_IDS,
      runtime: RUNTIME,
      history: HISTORY,
      policy: POLICY,
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');
    expect(body).toHaveProperty('summary');

    // Verify trace.reentryPhase is emitted when reentryTurn === true.
    const trace = body['trace'] as Record<string, unknown>;
    expect(trace).toHaveProperty('reentryPhase');
    const reentryPhase = trace['reentryPhase'] as { trigger: string; updatedLanes: string[]; reentryTraceId: string; priorPlanId: string }[];
    expect(reentryPhase).toHaveLength(1);
    expect(reentryPhase[0].trigger).toBe('external_reentry');
    expect(reentryPhase[0].updatedLanes).toEqual(['open_commitments']);
    expect(reentryPhase[0].priorPlanId).toBe('run-abc123');
    expect(reentryPhase[0].reentryTraceId).toMatch(/^rt-/);
  });

  it('[RE] returns 200 when re-entry signals are provided directly via requestSignals', async () => {
    /**
     * Scenario:
     *   - External Runtime sends full requestSignals including reentryTurn: true,
     *     priorPlanId, and loopSuspect: false.
     *   - Phase 3 bypass path is activated; synthesized path is skipped.
     *   - Pipeline completes normally. Re-entry fields are in-memory on the
     *     RequestSignals object but do not affect deterministic selection.
     *   - Expected: 200 response with promptPlan and trace present.
     */
    const payload = {
      request: { text: 'Fix the test that just failed.' },
      registry: REGISTRY_TWO_COMPONENTS,
      activeIds: ACTIVE_IDS,
      runtime: RUNTIME,
      history: HISTORY,
      policy: POLICY,
      requestSignals: {
        promptFamily: 'coding_build_debug',
        familyConfidence: 0.85,
        injectionSuspect: false,
        reentryTurn: true,
        priorPlanId: 'run-xyz789',
        loopSuspect: false,
      },
    };

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');
    expect(body).toHaveProperty('summary');

    // Verify that re-entry signals routed the coding_build_debug family —
    // skill.coding-guide has requiredWhen: ['coding_build_debug'] so it
    // should appear in selectedComponents.
    const plan = body['promptPlan'] as { selectedComponents?: { componentId: string }[] };
    const selectedIds = (plan.selectedComponents ?? []).map((c) => c.componentId);
    expect(selectedIds).toContain('skill.coding-guide');

    // Verify trace.reentryPhase is emitted with correct priorPlanId.
    const trace = body['trace'] as Record<string, unknown>;
    expect(trace).toHaveProperty('reentryPhase');
    const reentryPhase = trace['reentryPhase'] as { trigger: string; updatedLanes: string[]; reentryTraceId: string; priorPlanId: string }[];
    expect(reentryPhase).toHaveLength(1);
    expect(reentryPhase[0].trigger).toBe('external_reentry');
    expect(reentryPhase[0].priorPlanId).toBe('run-xyz789');
    expect(reentryPhase[0].reentryTraceId).toMatch(/^rt-/);
  });
});

