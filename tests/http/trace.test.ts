/**
 * HTTP integration tests for POST /trace — ZAM HTTP Service.
 *
 * Uses Fastify's server.inject() to exercise the route without a real TCP socket.
 *
 * Test strategy (docs/21 §5):
 *   - Send a realistic trace object (matching the canonical trace schema shape)
 *     and assert the response contains a non-empty explanation string.
 *   - Send an invalid body and assert a 400 response.
 *   - The 651-test MVP baseline (tests/phase12/) is NOT modified.
 *
 * Canonical: docs/21 §5; docs/18 §4.3.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/http/server.js';

// ---------------------------------------------------------------------------
// Minimal valid trace object — subset of the real trace shape
// ---------------------------------------------------------------------------

const MINIMAL_TRACE = {
  run: {
    runId: '00000000-0000-0000-0000-000000000001',
    planningRunStartedAt: '2025-01-01T00:00:00.000Z',
    planningRunCompletedAt: '2025-01-01T00:00:01.000Z',
    promptFamily: 'general_default',
    schemaVersion: 'v0',
  },
  requestPhase: {
    requestSignalsSummary: {
      promptFamily: 'general_default',
      familyConfidence: 0.5,
      injectionSuspect: false,
    },
    injectionSuspectFlag: false,
    promptFamily: 'general_default',
    familyConfidence: 0.5,
  },
  registryPhase: {
    componentCount: 2,
    quarantinedCount: 0,
    validationWarnings: [],
    fatalErrors: [],
    candidateSetSummary: {
      candidateSetPolicy: 'all_non_quarantined',
      candidateSetSize: 2,
      quarantinedExcluded: 0,
    },
  },
  selectorPhase: {
    selectorTrace: [],
    planningWarnings: [],
    unresolvedConflicts: 0,
    selectorSummary: {
      include: 1,
      omit: 1,
      defer: 0,
      not_evaluated: 0,
    },
  },
  conflictPhase: {
    conflictResolutionTrace: [],
    noConflictComponentIds: ['scaffold.system-rules', 'skill.coding-guide'],
  },
  budgetPhase: {
    budgetOverflow: false,
    trimActions: [],
  },
  planPhase: {
    selectedCount: 1,
    omittedCount: 1,
    deferredCount: 0,
  },
  warnings: [],
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /trace', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env['ZAM_API_KEY'];
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200 with a non-empty explanation string for a valid trace', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/trace',
      payload: { trace: MINIMAL_TRACE },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('explanation');
    expect(typeof body['explanation']).toBe('string');
    expect((body['explanation'] as string).length).toBeGreaterThan(0);
  });

  it('explanation contains Run ID from the trace', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/trace',
      payload: { trace: MINIMAL_TRACE },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    const explanation = body['explanation'] as string;
    expect(explanation).toContain('00000000-0000-0000-0000-000000000001');
  });

  it('explanation mentions prompt family', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/trace',
      payload: { trace: MINIMAL_TRACE },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    const explanation = body['explanation'] as string;
    expect(explanation).toContain('general_default');
  });

  it('returns 400 when body has no trace field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/trace',
      payload: { notATrace: 42 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect((body['error'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when trace field is null', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/trace',
      payload: { trace: null },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
  });
});
