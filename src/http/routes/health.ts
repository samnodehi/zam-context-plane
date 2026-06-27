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
 * Version is inlined from package.json at build time (src/generated/version.ts).
 *
 * Canonical: docs/31_PRODUCT_DISTRIBUTION_AND_PACKAGING.md §3 DQ-7.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { PACKAGE_VERSION } from '../../generated/version.js';

// Version is inlined (src/generated/version.ts, generated from package.json at
// build time) so it survives single-binary bundling and never drifts.
const VERSION: string = PACKAGE_VERSION;

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
