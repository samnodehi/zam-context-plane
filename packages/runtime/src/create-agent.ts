// ============================================================================
// ZAM Runtime — createAgent() Convenience Factory
// Canonical source: docs/29_LIBRARY_API_AND_INTEGRATION_TESTING.md §4.2
// Phase V2-C: High-level factory function that creates a fully-wired agent
//             from a RuntimeConfig alone.
//
// The factory wires all components (ZamClient, Provider, Workspace,
// PermissionGate, ToolOptimizer) using the same pattern as the CLI in
// packages/runtime/src/cli/index.ts, but exposes them as an Agent interface
// for programmatic use rather than a CLI command.
//
// The planFn override enables both:
//  - Mock testing: inject a mock planFn that returns synthetic promptPlans
//  - Integration testing: inject the real plan() from context-plane
//  - Production use: omit planFn to use the dynamically loaded core
// ============================================================================

import { loadConfig } from './config.js';
import { createSession } from './session-manager.js';
import { createZamClient } from './zam-client.js';
import { createProviderClient } from './provider-client.js';
import { runLoop } from './turn-loop.js';
import { LocalWorkspace } from './local-workspace.js';
import { LocalPermissionGate } from './permission-gate.js';
import { LocalToolOutputOptimizer } from './tool-output-optimizer.js';
import { DEFAULT_TOOL_REGISTRY, CORE_TOOL_DEFINITIONS } from './default-registry.js';
import { mergeRegistries } from './merge-registries.js';
import type {
  RuntimeConfig,
  RuntimeResult,
  Session,
  ZamPlanRequestBody,
  ZamPlanResponse,
  ProviderClient,
  Workspace,
  PermissionGate,
} from './types.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Options for the createAgent() factory.
 *
 * All fields are optional — the factory applies sensible defaults for
 * production use. Overrides enable mock-based testing without live providers
 * or the real core pipeline.
 *
 * Canonical: docs/29 §4.2
 */
export interface AgentOptions {
  /**
   * Runtime configuration. If absent, the factory loads from the default
   * `./runtime.config.json` path (same as the CLI `--config` default).
   */
  config?: RuntimeConfig | string;

  /**
   * Override the plan function for testing or custom integration.
   *
   * If absent, the factory dynamically imports the real `plan()` function
   * from `context-plane` (the core library API added in V2-1) and wraps
   * it as a ZamClient-compatible planFn.
   *
   * This is the primary injection point for integration tests (inject real
   * plan()) and unit tests (inject a mock planFn).
   */
  planFn?: (input: ZamPlanRequestBody) => Promise<ZamPlanResponse>;

  /**
   * Override the provider client for testing.
   * If absent, creates a real provider from config.
   */
  provider?: ProviderClient;

  /**
   * Override the workspace for testing.
   * If absent, creates a LocalWorkspace from config.workspace.rootPath.
   */
  workspace?: Workspace;

  /**
   * Override the permission gate for testing.
   * If absent, creates a LocalPermissionGate with auto-approve behavior
   * (suitable for programmatic use; the CLI adds an interactive callback).
   */
  permissionGate?: PermissionGate;
}

/**
 * A fully-wired agent instance returned by createAgent().
 *
 * Canonical: docs/29 §4.2
 */
export interface Agent {
  /**
   * Run the agent with the given prompt. Returns the final RuntimeResult
   * after the turn loop completes (or hits a limit).
   */
  run(prompt: string): Promise<RuntimeResult>;

  /**
   * The session created for this agent instance. Contains the sessionId,
   * EventStream, and all session state.
   */
  session: Session;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a fully-wired ZAM-Native Agent from a RuntimeConfig alone.
 *
 * The factory follows the same wiring pattern as `zam-agent run` in the CLI
 * (packages/runtime/src/cli/index.ts), but exposes a programmatic interface
 * rather than a Commander command.
 *
 * Usage (production):
 *   const agent = await createAgent({ config: './my-config.json' });
 *   const result = await agent.run('What files are in this directory?');
 *
 * Usage (integration test with real core, mocked provider):
 *   import { plan } from 'context-plane';
 *   const agent = await createAgent({ config, planFn: wrapCorePlan(plan), provider: mockProvider });
 *
 * Usage (unit test with all mocks):
 *   const agent = await createAgent({ config, planFn: mockPlanFn, provider: mockProvider });
 *
 * Canonical: docs/29 §4.2
 */
export async function createAgent(options?: AgentOptions): Promise<Agent> {
  // ---- 1. Resolve config ----
  let config: RuntimeConfig;
  if (!options?.config) {
    config = loadConfig('./runtime.config.json');
  } else if (typeof options.config === 'string') {
    config = loadConfig(options.config);
  } else {
    config = options.config;
  }

  // ---- 2. Create session ----
  const session = createSession(config);

  // ---- 3. Resolve planFn and create ZamClient ----
  let planFn: (input: ZamPlanRequestBody) => Promise<ZamPlanResponse>;

  if (options?.planFn) {
    // Injected planFn (mock or real core — caller decides).
    planFn = options.planFn;
  } else {
    // Dynamically import the real core plan() function by package name.
    // `context-plane` resolves via the workspace-local file: dependency
    // (packages/runtime depends on the root core package), so this no longer
    // relies on a hand-counted relative path to dist/ and survives file moves.
    // The import stays dynamic to keep core loading lazy (no static compile
    // coupling beyond type resolution). Canonical: docs/18 §7; docs/24 §9;
    // docs/29 §4.2; docs/32 (C3 item c).
    const coreModule = await import('context-plane') as {
      plan: (input: unknown) => unknown;
    };
    const corePlan = coreModule.plan;
    if (typeof corePlan !== 'function') {
      throw new Error('createAgent: context-plane does not export a plan() function.');
    }
    planFn = async (input: ZamPlanRequestBody): Promise<ZamPlanResponse> => {
      // Merge default tool registry into the registry from the input.
      const inlineRegistry = Array.isArray(input.registry)
        ? mergeRegistries(input.registry as unknown[], DEFAULT_TOOL_REGISTRY)
        : mergeRegistries([], DEFAULT_TOOL_REGISTRY);

      const result = corePlan({
        request: input.request,
        registry: inlineRegistry,
        history: input.history,
        budget: input.budget,
        constraints: input.userConstraints,
        requestSignals: input.requestSignals,
      });
      return result as ZamPlanResponse;
    };
  }

  const zamClient = createZamClient(planFn);

  // ---- 4. Resolve provider ----
  const provider = options?.provider ?? createProviderClient(config);

  // ---- 5. Resolve workspace ----
  const workspaceRoot = config.workspace.rootPath || process.cwd();
  const workspace = options?.workspace ?? new LocalWorkspace(workspaceRoot);

  // ---- 6. Resolve permission gate ----
  // In programmatic (non-CLI) use, default to auto-approve for all actions.
  // The caller can inject a custom gate for production use requiring approval.
  const permissionGate = options?.permissionGate ?? new LocalPermissionGate({
    approvalCallback: async () => true,  // auto-approve for library API usage
  });

  // ---- 7. Create tool optimizer ----
  const toolOptimizer = new LocalToolOutputOptimizer();

  // ---- 8. Return the Agent instance ----
  return {
    session,
    async run(prompt: string): Promise<RuntimeResult> {
      return runLoop(
        session,
        { text: prompt },
        zamClient,
        provider,
        {},                      // registry (empty — ZamClient handles it)
        workspace,
        permissionGate,
        toolOptimizer,
        undefined,               // optimizerConfig
        undefined,               // subscriberBus
        undefined,               // stuckDetectorState
        CORE_TOOL_DEFINITIONS,   // tool schemas for provider
      );
    },
  };
}

// Internal registry-merge helper moved to ./merge-registries.ts (shared with the CLI).
