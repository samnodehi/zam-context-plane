/**
 * Fastify server factory for the ZAM HTTP Service.
 *
 * Creates and configures a Fastify instance with:
 *   - API key authentication (X-ZAM-API-Key header) when ZAM_API_KEY env is set
 *   - Standard JSON request/response handling
 *   - GET /health route registration (bypasses auth — used by Docker health checks)
 *   - POST /plan route registration
 *   - POST /trace route registration
 *   - POST /evaluate route registration
 *
 * This factory is used by both:
 *   - src/http-server.ts (production: listen on a real port)
 *   - tests/http/*.test.ts (testing: server.inject(), no real port)
 *
 * Canonical: docs/21 §2 IQ-2, IQ-3; docs/18 §4.1.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { healthRoutes } from './routes/health.js';
import { planRoutes } from './routes/plan.js';
import { traceRoutes } from './routes/trace.js';
import { evaluateRoutes } from './routes/evaluate.js';
import { buildError } from './errors.js';

/**
 * Constant-time API-key comparison.
 *
 * A naive `provided !== expected` string compare short-circuits on the first
 * differing byte, leaking key-prefix information through response timing. We
 * hash both inputs to fixed-length SHA-256 digests and compare with
 * `timingSafeEqual`, which runs in time independent of where they differ.
 * Hashing also sidesteps `timingSafeEqual`'s equal-length requirement and
 * avoids leaking the expected key's length.
 *
 * Behavior is identical to the previous compare: returns true only for an
 * exact match. Canonical: docs/21 §2 IQ-3 (auth), DEBT.md C5.
 */
function timingSafeKeyMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Build and return a configured Fastify instance.
 *
 * Authentication behavior (docs/21 §2 IQ-3):
 *   - If process.env.ZAM_API_KEY is set: require X-ZAM-API-Key header on every
 *     request except GET /health. Mismatched or absent key → 401. The key value
 *     is never logged.
 *   - If process.env.ZAM_API_KEY is not set: no auth check (local-only mode).
 *
 * @param opts Optional configuration overrides (used in tests to disable logging).
 * @param opts.logger Fastify logger option. Pass `false` to disable (tests),
 *   `true` to enable with defaults, or `{ level: string }` for a specific level
 *   (e.g. `{ level: 'info' }` or `{ level: 'silent' }`). Docs: docs/31 §3 DQ-6.
 */
export async function buildServer(opts: { logger?: boolean | { level: string } } = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    // Disable logger in tests for clean output; enable in production
    logger: opts.logger ?? false,
  });

  // -------------------------------------------------------------------------
  // API key authentication hook (docs/21 §2 IQ-3)
  // -------------------------------------------------------------------------
  const apiKey = process.env['ZAM_API_KEY'];

  if (apiKey) {
    fastify.addHook(
      'onRequest',
      async (request: FastifyRequest, reply: FastifyReply) => {
        // Health endpoint bypasses authentication so Docker/Kubernetes health
        // checks can reach it without credentials. (docs/31 §3 DQ-7)
        if (request.url === '/health') return;

        const providedKey = request.headers['x-zam-api-key'];
        // Key value intentionally not logged (docs/21 §2 IQ-3).
        // Comparison is constant-time to avoid leaking the key via timing.
        if (typeof providedKey !== 'string' || !timingSafeKeyMatch(providedKey, apiKey)) {
          return reply.status(401).send(
            buildError('AUTH_ERROR', 'Missing or invalid X-ZAM-API-Key header.'),
          );
        }
      },
    );
  }

  // -------------------------------------------------------------------------
  // Global error handler — catches unexpected thrown errors from route handlers
  // -------------------------------------------------------------------------
  fastify.setErrorHandler(
    async (error: Error, _request: FastifyRequest, reply: FastifyReply) => {
      // Fastify validation errors (400): let Fastify handle them natively
      if ('statusCode' in error && (error as { statusCode: number }).statusCode === 400) {
        return reply.status(400).send(
          buildError('VALIDATION_ERROR', error.message),
        );
      }
      // All other unhandled errors → 500
      return reply.status(500).send(
        buildError('INTERNAL_ERROR', 'An unexpected internal error occurred.'),
      );
    },
  );

  // -------------------------------------------------------------------------
  // Register routes
  // -------------------------------------------------------------------------
  await fastify.register(healthRoutes);
  await fastify.register(planRoutes);
  await fastify.register(traceRoutes);
  await fastify.register(evaluateRoutes);

  return fastify;
}
