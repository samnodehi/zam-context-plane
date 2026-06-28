/**
 * ZAM HTTP Service — production entry point.
 *
 * Starts the Fastify HTTP server and listens on a configurable port and host.
 * Analogous to src/cli/index.ts for the HTTP service.
 *
 * Configuration (environment variables):
 *   ZAM_PORT      — TCP port to listen on (default: 3000)
 *   ZAM_HOST      — host interface to bind to (default: 127.0.0.1, loopback-only).
 *                   A non-loopback bind (e.g. 0.0.0.0) is REFUSED unless
 *                   ZAM_ALLOW_NONLOOPBACK_BIND is set — exposing the planner on a
 *                   network is opt-in and should be paired with ZAM_API_KEY.
 *   ZAM_ALLOW_NONLOOPBACK_BIND — set (1/true/yes) to permit a non-loopback ZAM_HOST.
 *   ZAM_API_KEY   — if set, enables API key authentication (X-ZAM-API-Key header)
 *   ZAM_LOG_LEVEL — Fastify log level: trace|debug|info|warn|error|fatal|silent
 *                   (default: info). Use 'silent' in production for source protection.
 *                   (docs/31 §3 DQ-6)
 *
 * Canonical: docs/21 §2 IQ-2, IQ-3; docs/18 §4.1; docs/31 §3 DQ-5, DQ-6.
 */

import { buildServer, isLoopbackBindHost } from './http/server.js';

const port = parseInt(process.env['ZAM_PORT'] ?? '3000', 10);

// ZAM_HOST defaults to 127.0.0.1 (local-only mode) when not set.
// Set ZAM_HOST=0.0.0.0 in Docker deployments to expose the server to the host network.
// Canonical: docs/31 §3 DQ-5.
const host = process.env['ZAM_HOST'] ?? '127.0.0.1';

// Refuse a non-loopback bind unless explicitly opted in. Binding the planner to
// a network interface (e.g. 0.0.0.0) exposes it beyond the local host; that is
// opt-in via ZAM_ALLOW_NONLOOPBACK_BIND and should be paired with ZAM_API_KEY.
// Canonical: docs/18 §4.1.
const allowNonLoopback = ['1', 'true', 'yes'].includes(
  (process.env['ZAM_ALLOW_NONLOOPBACK_BIND'] ?? '').trim().toLowerCase(),
);
if (!isLoopbackBindHost(host) && !allowNonLoopback) {
  console.error(
    `Refusing to bind to non-loopback host "${host}". The HTTP service is ` +
      `loopback-only by default; set ZAM_ALLOW_NONLOOPBACK_BIND=1 to override ` +
      `(and set ZAM_API_KEY to require authentication).`,
  );
  process.exit(1);
}

// ZAM_LOG_LEVEL defaults to 'info' when not set.
// Canonical: docs/31 §3 DQ-6.
const logLevel = process.env['ZAM_LOG_LEVEL'] ?? 'info';

const server = await buildServer({ logger: { level: logLevel } });

try {
  await server.listen({ port, host });
  // Port and host are logged by Fastify's built-in logger on startup.
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
