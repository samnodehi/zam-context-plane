/**
 * Fastify server factory for the ZAM HTTP Service.
 *
 * Creates and configures a Fastify instance with:
 *   - Local-network guard (Host + Origin checks) on every request — defeats
 *     DNS-rebinding and cross-origin browser access to the loopback service
 *   - API key authentication (X-ZAM-API-Key header) when ZAM_API_KEY env is set
 *   - Standard JSON request/response handling
 *   - GET /health route registration (subject to auth when ZAM_API_KEY is set)
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

// ---------------------------------------------------------------------------
// Local-network hardening (anti DNS-rebinding / cross-origin) — docs/18 §4.1
// ---------------------------------------------------------------------------

/**
 * Loopback hostnames always allowed in the Host header. The service binds to
 * 127.0.0.1 by default, so legitimate traffic carries one of these; a
 * DNS-rebinding attack reaches the loopback port via the browser with the
 * attacker's domain as Host, so rejecting a non-loopback Host blocks it.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1']);

/** Parse a comma-separated env list into a trimmed, lower-cased string set. */
function parseEnvSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

/**
 * Extract the hostname from a Host header, dropping the optional port and IPv6
 * brackets. e.g. "127.0.0.1:3000" → "127.0.0.1"; "[::1]:3000" → "::1".
 */
function hostnameFromHostHeader(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return (end > 0 ? trimmed.slice(1, end) : trimmed.slice(1)).toLowerCase();
  }
  const colon = trimmed.indexOf(':');
  return (colon >= 0 ? trimmed.slice(0, colon) : trimmed).toLowerCase();
}

/**
 * Whether a *bind* host (the listen interface, not a request Host header) is a
 * loopback interface. Used by the entrypoint to refuse a non-loopback bind by
 * default. e.g. "127.0.0.1" / "localhost" / "::1" → true; "0.0.0.0" / "::" / a
 * public IP → false. Canonical: docs/18 §4.1.
 */
export function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h.startsWith('127.');
}

/**
 * Build and return a configured Fastify instance.
 *
 * Authentication behavior (docs/21 §2 IQ-3; docs/18 §4.1):
 *   - If process.env.ZAM_API_KEY is set: require the X-ZAM-API-Key header on
 *     EVERY route, including GET /health. Mismatched or absent key → 401. The
 *     key value is never logged.
 *   - If process.env.ZAM_API_KEY is not set: no auth check (local-only mode);
 *     all routes (incl. /health) are reachable without a key.
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
  // Local-network guard (anti DNS-rebinding / cross-origin) — always on, runs
  // before auth. Rejects (403) a non-loopback Host (allow-list ZAM_ALLOWED_HOSTS)
  // or a cross-origin browser Origin (allow-list ZAM_ALLOWED_ORIGINS, default
  // none). Non-browser local callers send no Origin + a loopback Host → pass.
  // Canonical: docs/18 §4.1.
  // -------------------------------------------------------------------------
  const allowedHosts = new Set<string>([
    ...LOOPBACK_HOSTS,
    ...parseEnvSet(process.env['ZAM_ALLOWED_HOSTS']),
  ]);
  const allowedOrigins = parseEnvSet(process.env['ZAM_ALLOWED_ORIGINS']);

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // A present Host that isn't allow-listed → reject. A missing Host cannot
      // carry a rebound domain, so it is not the DNS-rebinding attack vector.
      const hostHeader = request.headers.host;
      if (typeof hostHeader === 'string' && hostHeader.length > 0) {
        if (!allowedHosts.has(hostnameFromHostHeader(hostHeader))) {
          return reply.status(403).send(buildError('FORBIDDEN', 'Host not allowed.'));
        }
      }
      // A present, non-allow-listed Origin (a cross-origin browser) → reject.
      const origin = request.headers.origin;
      if (
        typeof origin === 'string' &&
        origin.length > 0 &&
        !allowedOrigins.has(origin.toLowerCase())
      ) {
        return reply.status(403).send(buildError('FORBIDDEN', 'Origin not allowed.'));
      }
    },
  );

  // -------------------------------------------------------------------------
  // API key authentication hook (docs/21 §2 IQ-3)
  // -------------------------------------------------------------------------
  const apiKey = process.env['ZAM_API_KEY'];

  if (apiKey) {
    fastify.addHook(
      'onRequest',
      async (request: FastifyRequest, reply: FastifyReply) => {
        // When a key is set it is required on EVERY route, including /health
        // (no bypass). With no key set this hook is not registered, so all
        // routes stay open — the OSS default. Canonical: docs/18 §4.1.
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
