/**
 * Generic Test Adapter for the ZAM HTTP Service.
 *
 * Demonstrates an end-to-end adapter pattern: calls POST /plan, assembles
 * the prompt from the returned prompt-plan.json, and shows how any runtime
 * (not just OpenClaw) can consume the ZAM planning API.
 *
 * Isolation rules (docs/21 §3):
 *   - May import from src/http/ (client-side HTTP types and server factory).
 *   - Must NOT import from src/core/ directly.
 *   - Must NOT import from src/cli/ directly.
 *
 * This adapter is used by tests/http/test-adapter.test.ts.
 *
 * Canonical: docs/21 §2 IQ-6; docs/18 §2; docs/21 §3.
 */

import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Standard fixture payload (subset of fixtures/05-selector-ladder)
// ---------------------------------------------------------------------------

const TEST_REGISTRY = [
  {
    id: 'scaffold.system-rules',
    type: 'scaffold',
    title: 'System Rules Scaffold',
    summary: 'Defines baseline behavioral rules for the agent across all contexts.',
    source: 'scaffold/system_rules.md',
    tokensApprox: 320,
    charsApprox: 1280,
    riskLevel: 'medium',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'fail_open',
    retainPolicy: 'durable',
    budgetPriority: 7,
    evidenceRequired: null,
    tags: ['scaffold', 'system'],
    version: '1.0.0',
    hash: null,
  },
  {
    id: 'skill.coding-guide',
    type: 'skill',
    title: 'Coding Assistant Guide',
    summary: 'Provides coding conventions, patterns, and debugging strategies.',
    source: 'skills/coding_guide.md',
    tokensApprox: 480,
    charsApprox: 1920,
    riskLevel: 'low',
    requiredWhen: ['coding_build_debug'],
    safeToOmitWhen: ['simple_greeting', 'heartbeat_proactive'],
    defaultAction: 'omit',
    omissionPolicy: 'allow',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: ['skill', 'coding', 'debug'],
    version: '1.0.0',
    hash: null,
  },
];

// ---------------------------------------------------------------------------
// Adapter result type
// ---------------------------------------------------------------------------

/** Result of one adapter run. */
export interface AdapterRunResult {
  /** HTTP status code returned by the server. */
  statusCode: number;
  /** Whether the run was structurally successful (200 with promptPlan/trace/summary). */
  success: boolean;
  /** Whether the planning response contains the expected scaffold component. */
  containsScaffold: boolean;
  /** Raw response body (parsed). */
  body: unknown;
}

// ---------------------------------------------------------------------------
// runTestAdapter
// ---------------------------------------------------------------------------

/**
 * Run the generic test adapter against an in-memory Fastify server.
 *
 * Posts a minimal planning request and validates the response structure.
 * The server must already be built and ready (server.ready() called).
 *
 * @param server A ready Fastify instance (from buildServer()).
 * @param requestText The planning request text to send.
 * @returns AdapterRunResult with success/failure and selected component details.
 */
export async function runTestAdapter(
  server: FastifyInstance,
  requestText: string = 'Help me understand how this system works.',
): Promise<AdapterRunResult> {
  const response = await server.inject({
    method: 'POST',
    url: '/plan',
    payload: {
      request: { text: requestText },
      registry: TEST_REGISTRY,
    },
    headers: { 'content-type': 'application/json' },
  });

  const statusCode = response.statusCode;
  let body: unknown;
  try {
    body = JSON.parse(response.body) as unknown;
  } catch {
    body = response.body;
  }

  if (statusCode !== 200 || typeof body !== 'object' || body === null) {
    return { statusCode, success: false, containsScaffold: false, body };
  }

  const b = body as Record<string, unknown>;
  const hasPlan = 'promptPlan' in b;
  const hasTrace = 'trace' in b;
  const hasSummary = 'summary' in b;

  if (!hasPlan || !hasTrace || !hasSummary) {
    return { statusCode, success: false, containsScaffold: false, body };
  }

  // Check whether scaffold.system-rules (defaultAction: include) appears
  const plan = b['promptPlan'] as Record<string, unknown> | undefined;
  const selectedComponents = plan?.['selectedComponents'];
  const containsScaffold =
    Array.isArray(selectedComponents) &&
    selectedComponents.some(
      (c): c is Record<string, unknown> =>
        typeof c === 'object' && c !== null && c['componentId'] === 'scaffold.system-rules',
    );

  return { statusCode, success: true, containsScaffold, body };
}
