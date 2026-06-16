/**
 * HTTP integration tests for the Generic Test Adapter — ZAM HTTP Service.
 *
 * Tests the test adapter (src/adapters/test-adapter/index.ts) against an
 * in-memory Fastify server via server.inject(). No real TCP socket.
 *
 * The adapter proves vendor-neutrality: any HTTP client (not just OpenClaw)
 * can consume the ZAM planning API per docs/21 §2 IQ-6.
 *
 * Test strategy (docs/21 §5):
 *   - Adapter returns success for a minimal valid request.
 *   - Adapter detects that scaffold.system-rules is included in the plan
 *     (defaultAction: include → always selected in general_default).
 *   - The 651-test MVP baseline (tests/phase12/) is NOT modified.
 *
 * Canonical: docs/21 §5; docs/21 §2 IQ-6; docs/18 §2.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/http/server.js';
import { runTestAdapter } from '../../src/adapters/test-adapter/index.js';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Generic Test Adapter (POST /plan via adapter)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env['ZAM_API_KEY'];
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('adapter run succeeds (status 200, success: true)', async () => {
    const result = await runTestAdapter(server);

    expect(result.statusCode).toBe(200);
    expect(result.success).toBe(true);
  });

  it('adapter detects scaffold.system-rules in selectedComponents', async () => {
    const result = await runTestAdapter(server);

    expect(result.success).toBe(true);
    expect(result.containsScaffold).toBe(true);
  });

  it('adapter response body has promptPlan, trace, and summary', async () => {
    const result = await runTestAdapter(server);

    expect(result.success).toBe(true);

    const body = result.body as Record<string, unknown>;
    expect(body).toHaveProperty('promptPlan');
    expect(body).toHaveProperty('trace');
    expect(body).toHaveProperty('summary');
  });

  it('adapter works with a custom request text', async () => {
    const result = await runTestAdapter(server, 'Explain this codebase to me.');

    expect(result.statusCode).toBe(200);
    expect(result.success).toBe(true);
  });
});
