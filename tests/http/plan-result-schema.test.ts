/**
 * Contract test: the POST /plan 200 response validates against the consolidated
 * outputs/plan-result.schema.json envelope (`{ promptPlan, trace, summary }`).
 *
 * This pins the public /plan response contract to a single schema so HTTP
 * consumers (e.g. external context clients) can build their consume-half against
 * one frozen artifact. The schema is a pure $ref composition of
 * prompt-plan.schema.json + trace.schema.json + summary:string — it must stay in
 * lockstep with the real route output (src/http/routes/plan.ts).
 *
 * Uses Fastify's server.inject() — no network, no filesystem writes.
 *
 * Canonical: docs/18 §4.2; src/http/routes/plan.ts; src/core/harness-ajv.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/http/server.js';
import { getPlanResultValidator } from '../../src/core/harness-ajv.js';

// Minimal valid registry — one always-included scaffold is enough for a 200.
const REGISTRY = [
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
    safeToOmitWhen: ['simple_greeting'],
    defaultAction: 'omit',
    omissionPolicy: 'allow',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: ['skill', 'coding'],
    version: '1.0.0',
    hash: null,
  },
];

describe('POST /plan response ⊨ plan-result.schema.json', () => {
  let server: FastifyInstance;
  const validate = getPlanResultValidator();

  beforeAll(async () => {
    delete process.env['ZAM_API_KEY'];
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  async function plan(payload: unknown): Promise<Record<string, unknown>> {
    const response = await server.inject({
      method: 'POST',
      url: '/plan',
      payload,
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body) as Record<string, unknown>;
  }

  it('minimal request → 200 body conforms to the envelope schema', async () => {
    const body = await plan({ request: { text: 'Help me debug my code.' }, registry: REGISTRY });
    const ok = validate(body);
    if (!ok) console.error('plan-result validation errors:', validate.errors);
    expect(ok).toBe(true);
  });

  it('full request (optional fields + requestSignals) → conforms', async () => {
    const body = await plan({
      request: { text: 'Help me debug my code.' },
      registry: REGISTRY,
      activeIds: { activeSkillIds: [], activeToolIds: [], activeMemoryIds: [] },
      runtime: {
        availableToolIds: [],
        unavailableToolIds: [],
        capabilityInventoryComplete: false,
        runtimeLabel: 'mvp_cli_no_tools',
      },
      history: {
        lanesPresent: [],
        durableConstraintsPresent: false,
        openCommitmentsPresent: false,
        recentRawTurnCount: 0,
        totalHistoryTokensApprox: 0,
        historyMalformed: false,
      },
      policy: { failOpenThreshold: 0.7, deterministicOnly: true, injectionSuspectAction: 'warn_and_continue' },
      requestSignals: { promptFamily: 'coding_build_debug', familyConfidence: 0.95, injectionSuspect: false },
    });
    const ok = validate(body);
    if (!ok) console.error('plan-result validation errors:', validate.errors);
    expect(ok).toBe(true);
  });

  it('the envelope is enforced, not vacuous: an unknown top-level field is rejected', async () => {
    const body = await plan({ request: { text: 'Hello!' }, registry: REGISTRY });
    // A genuine response conforms; tampering must fail (additionalProperties: false).
    expect(validate({ ...body, unexpected: true })).toBe(false);
    // Dropping a required member must also fail.
    const { summary: _omitted, ...withoutSummary } = body;
    expect(validate(withoutSummary)).toBe(false);
  });
});
