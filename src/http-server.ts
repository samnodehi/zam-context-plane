/**
 * ZAM HTTP Service — production entry point.
 *
 * Starts the Fastify HTTP server and listens on a configurable port and host.
 * Analogous to src/cli/index.ts for the HTTP service.
 *
 * Configuration (environment variables):
 *   ZAM_PORT      — TCP port to listen on (default: 3000)
 *   ZAM_HOST      — host interface to bind to (default: 127.0.0.1 for local-only mode)
 *                   Set to 0.0.0.0 for Docker/container deployments (docs/31 §3 DQ-5).
 *                   Only use 0.0.0.0 together with ZAM_API_KEY for security.
 *   ZAM_API_KEY   — if set, enables API key authentication (X-ZAM-API-Key header)
 *   ZAM_LOG_LEVEL — Fastify log level: trace|debug|info|warn|error|fatal|silent
 *                   (default: info). Use 'silent' in production for source protection.
 *                   (docs/31 §3 DQ-6)
 *
 * Canonical: docs/21 §2 IQ-2, IQ-3; docs/18 §4.1; docs/31 §3 DQ-5, DQ-6.
 */

import { buildServer } from './http/server.js';

const port = parseInt(process.env['ZAM_PORT'] ?? '3000', 10);

// ZAM_HOST defaults to 127.0.0.1 (local-only mode) when not set.
// Set ZAM_HOST=0.0.0.0 in Docker deployments to expose the server to the host network.
// Canonical: docs/31 §3 DQ-5.
const host = process.env['ZAM_HOST'] ?? '127.0.0.1';

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
