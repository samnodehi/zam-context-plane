// ============================================================================
// Integration Tests — Agent Loop (IT-1 through IT-5)
// Canonical source: docs/29_LIBRARY_API_AND_INTEGRATION_TESTING.md §4.3
// Phase V2-3: End-to-end integration tests connecting the REAL ZAM Core
//             pipeline to the Runtime agent loop, with only the provider
//             (model) mocked.
//
// What is REAL (not mocked):
//   - ZAM core plan() function (src/core/api.ts)
//   - Full deterministic pipeline (Registry → Selector → Conflict → Budget → Plan)
//   - AJV schema validation in the core
//   - Session management and EventStream
//   - Runtime createAgent() factory wiring
//
// What is MOCKED:
//   - ProviderClient.chat() — mock returns without real API calls
//   - Workspace.execute() — mock for tool call tests
//
// Constraints:
//   - No real provider/model API calls (no API keys, no network)
//   - No modification to fixtures/, schemas/, or src/core/
//   - All integration tests run via `vitest run` from the runtime package
// ============================================================================

import { describe, it, expect } from 'vitest';
import { createAgent } from '../../src/create-agent.js';
import type {
  RuntimeConfig,
  ProviderClient,
  ProviderChatOptions,
  Workspace,
  ToolAction,
  ToolObservation,
  ZamPlanRequestBody,
  ZamPlanResponse,
} from '../../src/types.js';

// ---------------------------------------------------------------------------
// Import the REAL ZAM Core plan() function
// Path from packages/runtime/tests/integration/ to workspace root src/core/:
//   ../../../../src/core/api.js (4 levels: integration → tests → runtime → packages → workspace)
// Node16 module resolution requires .js extension for TypeScript source files.
// Vitest/tsx resolves this to src/core/api.ts transparently.
// ---------------------------------------------------------------------------
import { plan as realPlan } from '../../../../src/core/api.js';

// ---------------------------------------------------------------------------
// Minimal valid component registry entries (from docs/05 §3 schema)
// These are inline registries — not modifying any fixtures/ files.
// ---------------------------------------------------------------------------

/** Minimal valid component conforming to component-registry.schema.json
 * Uses type 'scaffold' — one of the 8 canonical MVP types (docs/05 §4).
 * omissionPolicy 'allow' = budget-trimmable (unlike 'fail_open' which bypasses Budgeter).
 */
function makeComponent(id: string, overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    type: 'scaffold',
    title: `Scaffold component ${id.replace(/\./g, ' ')}`,
    summary: `Test scaffold component for integration testing of ${id}`,
    source: `test:${id}`,
    tokensApprox: 50,
    charsApprox: 200,
    riskLevel: 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'allow',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: ['test'],
    version: '0.1.0',
    hash: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    zam: { endpoint: 'library' },
    provider: { name: 'openrouter', model: 'test-model', apiKeyEnvVar: 'TEST_KEY' },
    workspace: { mode: 'local', rootPath: './' },
    loop: { maxTurns: 10, timeoutMs: 300000 },
    eventStream: { persistPath: './test-sessions' },
    ...overrides,
  };
}

/**
 * Creates a planFn wrapping the real core plan() function.
 * This is the integration bridge: maps ZamPlanRequestBody to CorePlanInput
 * and CorePlanOutput to ZamPlanResponse — same mapping as the CLI's createCorePlanFn().
 */
function makeRealPlanFn(registry?: unknown[]) {
  return async (input: ZamPlanRequestBody): Promise<ZamPlanResponse> => {
    const effectiveRegistry = registry ??
      (Array.isArray(input.registry) ? input.registry as unknown[] : []);
    const result = realPlan({
      request: input.request,
      registry: effectiveRegistry,
      history: input.history as Parameters<typeof realPlan>[0]['history'],
      budget: input.budget as Parameters<typeof realPlan>[0]['budget'],
      constraints: input.userConstraints as Parameters<typeof realPlan>[0]['constraints'],
      requestSignals: input.requestSignals as Parameters<typeof realPlan>[0]['requestSignals'],
    });
    return result as unknown as ZamPlanResponse;
  };
}

/** Mock provider returning a single text response */
function makeTextProvider(text: string = 'Task completed.'): ProviderClient {
  return {
    chat: async (_opts: ProviderChatOptions) => ({
      type: 'text' as const,
      text,
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  };
}

/** Mock workspace: auto-approves and returns success for all tool calls */
function makeSuccessWorkspace(): Workspace {
  return {
    execute: async (action: ToolAction): Promise<ToolObservation> => ({
      callId: action.callId,
      success: true,
      output: `Mock output for ${action.toolName}(${JSON.stringify(action.arguments)})`,
      durationMs: 5,
    }),
    getWorkspaceRoot: () => '/test',
    isPathWithinWorkspace: () => true,
  };
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe('Integration Tests — Agent Loop (IT-1 through IT-5)', () => {

  // --------------------------------------------------------------------------
  // IT-1: Single-turn success with real core
  // Validates: real plan() is called, agent exits cleanly with exitReason=completed
  // --------------------------------------------------------------------------
  it('IT-1: single-turn success — real core runs, mock provider returns text', async () => {
    const registry = [makeComponent('scaffold.helpful-assistant')];
    const planFn = makeRealPlanFn(registry);

    const agent = await createAgent({
      config: makeConfig(),
      planFn,
      provider: makeTextProvider('Hello! How can I help?'),
    });

    const result = await agent.run('Hello, agent!');

    // Real core ran (no error thrown, no 'error' exitReason)
    expect(result.exitReason).toBe('completed');
    expect(result.finalResponse).toBe('Hello! How can I help?');
    expect(result.turnCount).toBe(1);
    expect(typeof result.sessionId).toBe('string');
  });

  // --------------------------------------------------------------------------
  // IT-2: Core artifact generation — verify real core produces a promptPlan
  // Validates: zam_plan event is recorded in EventStream with real promptPlan data;
  //            selectedComponents is non-empty; proves real core ran (not a mock).
  // --------------------------------------------------------------------------
  it('IT-2: core artifact generation — promptPlan is generated by real core', async () => {
    const registry = [
      makeComponent('scaffold.helpful-assistant'),
      makeComponent('scaffold.safety-policy', { retainPolicy: 'mandatory' }),
    ];
    const planFn = makeRealPlanFn(registry);

    const agent = await createAgent({
      config: makeConfig(),
      planFn,
      provider: makeTextProvider('Response here.'),
    });

    const result = await agent.run('What is the weather today?');

    expect(result.exitReason).toBe('completed');

    // Inspect EventStream for zam_plan event
    const entries = agent.session.eventStream.read();
    const zamPlanEntry = entries.find((e) => e.type === 'zam_plan');
    expect(zamPlanEntry).toBeDefined();

    // Verify the real core produced a valid promptPlan structure
    const planContent = zamPlanEntry!.content as {
      promptPlan: { selectedComponents?: Array<{ componentId: string; action: string }> };
      runId: string;
    };
    expect(planContent.promptPlan).toBeDefined();
    // Real core selected at least one component from the registry
    // selectedComponents items use 'componentId' (not 'id') per prompt-plan.schema.json
    expect(Array.isArray(planContent.promptPlan.selectedComponents)).toBe(true);
    expect((planContent.promptPlan.selectedComponents?.length ?? 0)).toBeGreaterThan(0);
    const firstSelected = planContent.promptPlan.selectedComponents?.[0];
    expect(typeof firstSelected?.componentId).toBe('string');
    expect(firstSelected?.action).toBe('include');
    // runId is a real UUID from the core's trace assembly
    expect(typeof planContent.runId).toBe('string');
    expect(planContent.runId.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // IT-3: Tool call multi-turn — real core, tool execution, re-entry
  // Validates: provider requests a tool call → workspace executes → re-entry →
  //            provider returns text; turnCount >= 2; zam_plan events for both turns
  // --------------------------------------------------------------------------
  it('IT-3: tool call multi-turn — real core drives re-entry after tool execution', async () => {
    const registry = [makeComponent('scaffold.helpful-assistant')];
    const planFn = makeRealPlanFn(registry);

    let callCount = 0;
    const toolCallProvider: ProviderClient = {
      chat: async () => {
        callCount++;
        if (callCount === 1) {
          // First call: return a tool call
          return {
            type: 'tool_call' as const,
            toolCalls: [
              { toolName: 'list_dir', arguments: { path: '.' }, callId: 'tc-it3' },
            ],
          };
        }
        // Second call: return text (after tool result fed back)
        return {
          type: 'text' as const,
          text: 'Directory listing completed successfully.',
          usage: { inputTokens: 15, outputTokens: 8 },
        };
      },
    };

    const agent = await createAgent({
      config: makeConfig(),
      planFn,
      provider: toolCallProvider,
      workspace: makeSuccessWorkspace(),
    });

    const result = await agent.run('List the files in this directory.');

    expect(result.exitReason).toBe('completed');
    expect(result.finalResponse).toBe('Directory listing completed successfully.');
    expect(result.turnCount).toBeGreaterThanOrEqual(2);

    // Verify EventStream has zam_plan events for both turns
    const entries = agent.session.eventStream.read();
    const zamPlanEntries = entries.filter((e) => e.type === 'zam_plan');
    expect(zamPlanEntries.length).toBeGreaterThanOrEqual(2);

    // Verify tool_call and tool_result events are present
    const toolCallEntry = entries.find((e) => e.type === 'tool_call');
    expect(toolCallEntry).toBeDefined();
    expect((toolCallEntry!.content as { toolName: string }).toolName).toBe('list_dir');

    const toolResultEntry = entries.find((e) => e.type === 'tool_result');
    expect(toolResultEntry).toBeDefined();
    expect((toolResultEntry!.content as { success: boolean }).success).toBe(true);
  });

  // --------------------------------------------------------------------------
  // IT-4: Max turns circuit breaker
  // Validates: provider endlessly requests tool calls; loop hits maxTurns;
  //            exitReason === 'max_turns'
  // --------------------------------------------------------------------------
  it('IT-4: max turns circuit breaker — loop terminates at maxTurns', async () => {
    const registry = [makeComponent('scaffold.helpful-assistant')];
    const planFn = makeRealPlanFn(registry);

    // Provider always returns a tool call — never resolves
    let toolCallId = 0;
    const endlessToolCallProvider: ProviderClient = {
      chat: async () => ({
        type: 'tool_call' as const,
        // Use unique callId each time to avoid no_progress_tool detection
        toolCalls: [
          {
            toolName: 'read_file',
            arguments: { path: `file-${++toolCallId}.txt` },
            callId: `tc-${toolCallId}`,
          },
        ],
      }),
    };

    const agent = await createAgent({
      config: makeConfig({ loop: { maxTurns: 3, timeoutMs: 300000 } }),
      planFn,
      provider: endlessToolCallProvider,
      workspace: makeSuccessWorkspace(),
    });

    const result = await agent.run('Keep reading files forever.');

    expect(result.exitReason).toBe('max_turns');
    expect(result.turnCount).toBe(3);
  });

  // --------------------------------------------------------------------------
  // IT-5: Budget enforcement — over-budget optional components are omitted by real core
  // Validates: core Budgeter trims optional scaffold components when budget is exceeded;
  //            omittedComponents confirms trimming; mandatory component is always retained.
  //
  // Budget schema (budget-state.schema.json): uses totalPromptTokenTarget, maxScaffoldTokens,
  // reservedUserTokens (not tokenBudget/outputReserveTokens).
  // Components must use omissionPolicy='allow' (not 'fail_open') to be budget-trimmable.
  // Canonical: docs/06 §20–§27, docs/05 §5.
  // --------------------------------------------------------------------------
  it('IT-5: budget enforcement — real core budgeter trims over-budget optional components', async () => {
    // Registry: one mandatory component (100 tokens) + two optional heavy ones (500 tokens each)
    // Budget: maxScaffoldTokens=150 → the two optional heavies cannot both fit
    const registry = [
      makeComponent('scaffold.mandatory-base', {
        retainPolicy: 'mandatory',    // Must always be included
        budgetPriority: 10,           // Highest priority — trimmed last
        tokensApprox: 100,
        charsApprox: 400,
        omissionPolicy: 'allow',      // allow = budget-trimmable (if needed)
      }),
      makeComponent('scaffold.optional-heavy-1', {
        retainPolicy: 'optional',     // Budget-trimmable
        budgetPriority: 1,            // Lowest priority — trimmed first
        tokensApprox: 500,
        charsApprox: 2000,
        omissionPolicy: 'allow',      // allow = budget-trimmable
      }),
      makeComponent('scaffold.optional-heavy-2', {
        retainPolicy: 'optional',     // Budget-trimmable
        budgetPriority: 1,            // Lowest priority — trimmed first
        tokensApprox: 500,
        charsApprox: 2000,
        omissionPolicy: 'allow',      // allow = budget-trimmable
      }),
    ];

    // Budget: total 200 tokens, maxScaffoldTokens=150, reservedUserTokens=50.
    // mandatory (100) fits within 150. optional heavies (500 each) do not.
    // Real core budgeter must trim both optional heavies.
    const tightBudget = {
      totalPromptTokenTarget: 200,
      maxScaffoldTokens: 150,    // Only 150 tokens for scaffold components
      maxSkillTokens: 0,
      maxToolTokens: 0,
      maxHistoryTokens: 0,
      reservedUserTokens: 50,
      budgetCritical: false,
    };

    // Capture the plan output to inspect it directly
    let capturedPlanOutput: unknown = null;
    const planFn = async (input: ZamPlanRequestBody): Promise<ZamPlanResponse> => {
      const result = realPlan({
        request: input.request,
        registry,
        budget: tightBudget as Parameters<typeof realPlan>[0]['budget'],
      });
      capturedPlanOutput = result;
      return result as unknown as ZamPlanResponse;
    };

    const agent = await createAgent({
      config: makeConfig(),
      planFn,
      provider: makeTextProvider('Budget test completed.'),
    });

    const result = await agent.run('Test the budget enforcement.');

    expect(result.exitReason).toBe('completed');

    // Verify the real core ran and captured a plan output
    expect(capturedPlanOutput).not.toBeNull();
    const planOut = capturedPlanOutput as {
      promptPlan: {
        selectedComponents: Array<{ componentId: string }>;
        omittedComponents?: Array<{ componentId: string }>;
      };
      pipelineWarnings: Array<{ code: string }>;
    };

    // The mandatory component must always be selected (retainPolicy=mandatory)
    // selectedComponents items use 'componentId' (not 'id') per prompt-plan.schema.json
    const selectedComponentIds = planOut.promptPlan.selectedComponents.map(
      (c) => c.componentId
    );
    expect(selectedComponentIds).toContain('scaffold.mandatory-base');

    // Both optional heavies should be omitted (each is 500 tokens, maxScaffoldTokens=150)
    const omitted = planOut.promptPlan.omittedComponents ?? [];
    const omittedIds = omitted.map((c) => c.componentId);
    expect(omittedIds).toContain('scaffold.optional-heavy-1');
    expect(omittedIds).toContain('scaffold.optional-heavy-2');
  });

});
