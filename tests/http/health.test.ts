/**
 * HTTP integration tests for GET /health — ZAM HTTP Service.
 *
 * Uses Fastify's server.inject() to exercise the route without a real TCP socket.
 *
 * Test strategy (docs/31 §3 DQ-7):
 *   - Verify the health endpoint returns 200 with correct { status, version } shape.
 *   - Verify version matches package.json (not hardcoded).
 *   - Verify /health bypasses X-ZAM-API-Key authentication when a key is set.
 *   - Verify response Content-Type is application/json.
 *   - Verify unsupported HTTP methods return 404.
 *   - The 651-test MVP baseline (tests/phase12/) is NOT modified.
 *
 * Canonical: docs/31_PRODUCT_DISTRIBUTION_AND_PACKAGING.md §3 DQ-7.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/http/server.js';

// Read the expected version from package.json (same method as the health route itself).
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };
const EXPECTED_VERSION = pkg.version;

// ---------------------------------------------------------------------------
// Suite 1: unauthenticated server (ZAM_API_KEY not set)
// ---------------------------------------------------------------------------

describe('GET /health — unauthenticated mode', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env['ZAM_API_KEY'];
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200 with status "ok" and version string', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(typeof body['version']).toBe('string');
    expect((body['version'] as string).length).toBeGreaterThan(0);
  });

  it('version in response matches package.json version', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body['version']).toBe(EXPECTED_VERSION);
  });

  it('response Content-Type is application/json', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('POST /health returns 404 (method not supported)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/health',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: authenticated server (ZAM_API_KEY set) — /health must bypass auth
// ---------------------------------------------------------------------------

describe('GET /health — authenticated mode (ZAM_API_KEY set)', () => {
  let server: FastifyInstance;
  const TEST_API_KEY = 'test-key-for-health-bypass';

  beforeAll(async () => {
    process.env['ZAM_API_KEY'] = TEST_API_KEY;
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    delete process.env['ZAM_API_KEY'];
    await server.close();
  });

  it('GET /health returns 200 WITHOUT X-ZAM-API-Key header (auth bypassed)', async () => {
    // This request intentionally sends NO authentication header.
    // /health must be reachable by Docker/Kubernetes health checks that cannot
    // provide credentials. The auth bypass is enforced in src/http/server.ts.
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      // No 'x-zam-api-key' header
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
  });

  it('GET /plan returns 401 WITHOUT X-ZAM-API-Key (auth enforced on other routes)', async () => {
    // Verifies that the /health bypass does not affect other routes.
    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload: {},
      headers: { 'content-type': 'application/json' },
      // No 'x-zam-api-key' header
    });

    expect(response.statusCode).toBe(401);
  });
});
