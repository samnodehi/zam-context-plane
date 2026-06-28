/**
 * GET /health route handler for the ZAM HTTP Service.
 *
 * Returns a simple health check response indicating the service is alive
 * and reporting its version. This endpoint intentionally exposes no internal
 * state, schema data, or trace information.
 *
 * Auth follows the service default: reachable without a key when no ZAM_API_KEY
 * is set; requires the key (like every route) when ZAM_API_KEY is set.
 *
 * Response shape: { status: 'ok', version: string }
 * Version is inlined from package.json at build time (src/generated/version.ts).
 *
 * Canonical: docs/18 §4.1; docs/31 §3 DQ-7 (historical).
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
