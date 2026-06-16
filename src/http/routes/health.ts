/**
 * GET /health route handler for the ZAM HTTP Service.
 *
 * Returns a simple health check response indicating the service is alive
 * and reporting its version. This endpoint intentionally exposes no internal
 * state, schema data, or trace information.
 *
 * This endpoint bypasses X-ZAM-API-Key authentication by design, so that
 * Docker health checks and Kubernetes readiness probes can reach it without
 * credentials. The auth bypass is enforced in src/http/server.ts.
 *
 * Response shape: { status: 'ok', version: string }
 * Version is read from package.json at module load time — never hardcoded.
 *
 * Canonical: docs/31_PRODUCT_DISTRIBUTION_AND_PACKAGING.md §3 DQ-7.
 */

import { createRequire } from 'node:module';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// Read package.json version at module load time.
// createRequire(import.meta.url) is the correct ESM-compatible approach for
// requiring JSON files. dist/http/routes/health.js is 3 levels below the project
// root, so '../../../package.json' resolves correctly at runtime.
const require = createRequire(import.meta.url);
const pkg = require('../../../package.json') as { version: string };
const VERSION: string = pkg.version;

/**
 * Register the GET /health route on the Fastify instance.
 * Canonical: docs/31 §3 DQ-7.
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/health',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({ status: 'ok', version: VERSION });
    },
  );
}
