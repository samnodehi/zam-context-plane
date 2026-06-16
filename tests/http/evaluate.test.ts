/**
 * HTTP integration tests for POST /evaluate — ZAM HTTP Service.
 *
 * Uses Fastify's server.inject() to exercise the route without a real TCP socket.
 *
 * Test strategy (docs/21 §5):
 *   - Send a minimal planning input with an empty expected object and assert
 *     the response is 200 with fixtureId, passed, violations, actualPlan,
 *     actualTrace.
 *   - Send input with an expected promptPlan that matches actual output
 *     and assert passed: true.
 *   - Send input with an expected promptPlan that mismatches actual output
 *     and assert passed: false with at least one violation.
 *   - Send an invalid body and assert 400.
 *   - The 651-test MVP baseline (tests/phase12/) is NOT modified.
 *
 * Canonical: docs/21 §5; docs/18 §4.4.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/http/server.js';

// ---------------------------------------------------------------------------
// Fixture data (same as plan.test.ts for consistency)
// ---------------------------------------------------------------------------

const REGISTRY_TWO_COMPONENTS = [
  {
    id: 'scaffold.system-rules',
    type: 'scaffold',
    title: 'System Rules Scaffold',
    summary: 'Defines baseline behavioral rules.',
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

const MINIMAL_INPUT = {
  request: { text: 'Hello!' },
  registry: REGISTRY_TWO_COMPONENTS,
};

const CODING_INPUT = {
  request: { text: 'Help me debug my code.' },
  registry: REGISTRY_TWO_COMPONENTS,
  requestSignals: {
    promptFamily: 'coding_build_debug',
    familyConfidence: 0.95,
    injectionSuspect: false,
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /evaluate', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env['ZAM_API_KEY'];
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200 with the correct response shape for a minimal request', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        fixtureId: 'test-fixture-001',
        input: MINIMAL_INPUT,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body['fixtureId']).toBe('test-fixture-001');
    expect(typeof body['passed']).toBe('boolean');
    expect(Array.isArray(body['violations'])).toBe(true);
    expect(body).toHaveProperty('actualPlan');
    expect(body).toHaveProperty('actualTrace');
  });

  it('returns passed: true when expected partition matches actual (scaffold included in general_default)', async () => {
    // First, get the actual output to build a matching expected
    const planResponse = await server.inject({
      method: 'POST',
      url: '/plan',
      payload: MINIMAL_INPUT,
      headers: { 'content-type': 'application/json' },
    });
    expect(planResponse.statusCode).toBe(200);
    const planBody = JSON.parse(planResponse.body) as Record<string, unknown>;
    const actualPlan = planBody['promptPlan'] as Record<string, unknown>;
    const actualTrace = planBody['trace'] as Record<string, unknown>;

    // Now evaluate with matching expected
    const evalResponse = await server.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        fixtureId: 'test-fixture-002',
        input: MINIMAL_INPUT,
        expected: {
          promptPlan: actualPlan,
          trace: actualTrace,
        },
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(evalResponse.statusCode).toBe(200);
    const evalBody = JSON.parse(evalResponse.body) as Record<string, unknown>;
    expect(evalBody['passed']).toBe(true);
    expect((evalBody['violations'] as unknown[]).length).toBe(0);
  });

  it('returns passed: false with violations when expected partition has extra component IDs', async () => {
    // Expected claims a component that shouldn't be selected
    const response = await server.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        fixtureId: 'test-fixture-003',
        input: MINIMAL_INPUT,
        expected: {
          promptPlan: {
            // general_default → scaffold is selected, coding-guide is not
            // Force a mismatch: claim coding-guide should also be selected
            selectedComponents: [
              { componentId: 'scaffold.system-rules' },
              { componentId: 'skill.coding-guide' },     // should NOT be selected
            ],
            omittedComponents: [],
            deferredComponents: [],
          },
        },
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body['passed']).toBe(false);
    expect((body['violations'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns 400 when fixtureId is missing', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        input: MINIMAL_INPUT,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with actualPlan containing skill.coding-guide for coding_build_debug family', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        fixtureId: 'test-fixture-005',
        input: CODING_INPUT,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    const plan = body['actualPlan'] as Record<string, unknown>;
    const selectedIds = ((plan['selectedComponents'] ?? []) as Record<string, unknown>[])
      .map((c) => c['componentId']);
    expect(selectedIds).toContain('skill.coding-guide');
  });
});
