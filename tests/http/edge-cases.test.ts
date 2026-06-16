/**
 * HTTP edge-case tests — V3-C Test Hardening (docs/30 §4.3).
 *
 * Covers HT-1 through HT-10 as specified in docs/30_HTTP_API_STABILIZATION.md §4.3.
 *
 * Uses Fastify's server.inject() for all tests — no real TCP socket.
 * No src/core/*.ts, schemas/, or fixtures/ files are modified.
 *
 * Already-covered cases (verified in existing test files):
 *   HT-6  POST /evaluate missing fixtureId → 400  [evaluate.test.ts line 188]
 *   HT-8  Auth: wrong API key → 401               [plan.test.ts line 194]
 *   HT-9  Auth: correct API key → 200             [plan.test.ts line 221]
 *
 * Canonical: docs/30 §4.3; docs/18 §4; docs/21 §5.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/http/server.js';

// ---------------------------------------------------------------------------
// Shared registry for happy-path and large-registry tests
// ---------------------------------------------------------------------------

/** Minimal valid component fixture used as the base registry entry. */
const BASE_COMPONENT = {
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
};

/** Generate a registry of N unique valid components for large-registry tests. */
function buildLargeRegistry(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    ...BASE_COMPONENT,
    id: `scaffold.component-${i}`,
    title: `Component ${i}`,
    summary: `Auto-generated component ${i} for large-registry edge case test.`,
    source: `scaffold/component_${i}.md`,
  }));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('HTTP Edge Cases (V3-C HT-1 through HT-10)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env['ZAM_API_KEY'];
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // HT-1: POST /plan with empty registry ([]) → 422 UNPROCESSABLE_REQUEST
  // -------------------------------------------------------------------------
  it('[HT-1] POST /plan with empty registry returns 422 UNPROCESSABLE_REQUEST', async () => {
    /**
     * An empty registry has no components for the pipeline to work with.
     * buildRegistryIndexes() throws RegistryFatalError(code: 'empty_registry')
     * before any planning occurs. The route handler maps this to 422.
     * Canonical: docs/30 §4.3 HT-1; docs/05 §8; src/core/registry-loader.ts.
     */
    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        request: { text: 'Hello!' },
        registry: [],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect((body['error'] as Record<string, unknown>)['code']).toBe('UNPROCESSABLE_REQUEST');
  });

  // -------------------------------------------------------------------------
  // HT-2: POST /plan with missing `request` field → 400 VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('[HT-2] POST /plan with missing request field returns 400 VALIDATION_ERROR', async () => {
    /**
     * The plan route handler has an explicit pre-flight guard that checks for
     * the presence and shape of the 'request' field before calling
     * mapBodyToLoadedInputs(). A missing or malformed 'request' returns a
     * descriptive 400 VALIDATION_ERROR instead of an opaque 500.
     * Canonical: docs/30 §4.3 HT-2; docs/18 §4.2; src/http/routes/plan.ts.
     */
    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        // 'request' field intentionally absent
        registry: [BASE_COMPONENT],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // HT-3: POST /plan with invalid JSON body → 400
  // -------------------------------------------------------------------------
  it('[HT-3] POST /plan with invalid JSON body returns 400', async () => {
    /**
     * Fastify's built-in JSON body parser rejects malformed JSON and returns
     * a native 400 error before the route handler is called.
     * The global error handler maps this to VALIDATION_ERROR.
     * Canonical: docs/30 §4.3 HT-3.
     */
    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload: '{ this is not valid json {{{{',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // HT-4: POST /plan with 100+ component registry → 200 (performance boundary)
  // -------------------------------------------------------------------------
  it('[HT-4] POST /plan with 100-component registry returns 200', async () => {
    /**
     * Performance boundary test: verifies the pipeline handles a large registry
     * without crash, timeout, or unexpected error.
     * All 100 components have defaultAction: 'include' so they are all selected.
     * Budget is unconstrained (no budget field) so no trimming occurs.
     * Canonical: docs/30 §4.3 HT-4.
     */
    const largeRegistry = buildLargeRegistry(100);

    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        request: { text: 'Process all components.' },
        registry: largeRegistry,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');
    expect(body).toHaveProperty('summary');
  });

  // -------------------------------------------------------------------------
  // HT-5: POST /trace with non-object `trace` field → 400 VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('[HT-5] POST /trace with string trace field returns 400 VALIDATION_ERROR', async () => {
    /**
     * The trace route handler checks typeof traceValue !== 'object' — a string
     * satisfies this condition → 400 VALIDATION_ERROR.
     * Canonical: docs/30 §4.3 HT-5; routes/trace.ts line 48.
     */
    const response = await server.inject({
      method: 'POST',
      url: '/trace',
      payload: { trace: 'this-is-not-an-object' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR');
  });

  it('[HT-5b] POST /trace with numeric trace field returns 400 VALIDATION_ERROR', async () => {
    /**
     * Additional variant: a number value for trace also fails the object check.
     * Canonical: docs/30 §4.3 HT-5; routes/trace.ts line 48.
     */
    const response = await server.inject({
      method: 'POST',
      url: '/trace',
      payload: { trace: 42 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // HT-6: POST /evaluate with missing fixtureId → 400 VALIDATION_ERROR
  // ALREADY COVERED in evaluate.test.ts (line 188). Verified and documented.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // HT-7: POST /evaluate with missing `input` → 400 VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('[HT-7] POST /evaluate with missing input field returns 400 VALIDATION_ERROR', async () => {
    /**
     * The evaluate route handler has an explicit guard: if body.input is absent
     * or not an object, returns 400 VALIDATION_ERROR.
     * Canonical: docs/30 §4.3 HT-7; routes/evaluate.ts line 186.
     */
    const response = await server.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        fixtureId: 'test-ht-7',
        // 'input' field intentionally absent
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // HT-8: Auth: wrong API key → 401
  // ALREADY COVERED in plan.test.ts (line 194). Verified and documented.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // HT-9: Auth: correct API key → 200
  // ALREADY COVERED in plan.test.ts (line 221). Verified and documented.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // HT-10: Unknown route (GET /nonexistent) → 404
  // -------------------------------------------------------------------------
  it('[HT-10] GET /nonexistent returns 404', async () => {
    /**
     * Fastify returns 404 for unregistered routes by default.
     * No route is registered for GET /nonexistent.
     * Canonical: docs/30 §4.3 HT-10.
     */
    const response = await server.inject({
      method: 'GET',
      url: '/nonexistent',
    });

    expect(response.statusCode).toBe(404);
  });
});
