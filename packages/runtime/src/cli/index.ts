#!/usr/bin/env node
// ============================================================================
// ZAM Runtime — CLI Entry Point
// Canonical source: docs/24 §3.1
// Phase R6: `zam-agent run <prompt>` — wired to real ZAM core pipeline
//           with tool execution infrastructure.
// ============================================================================

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { loadConfig } from '../config.js';
import { createSession } from '../session-manager.js';
import { createZamClient } from '../zam-client.js';
import { createProviderClient } from '../provider-client.js';
import { runLoop } from '../turn-loop.js';
import { LocalWorkspace } from '../local-workspace.js';
import { LocalPermissionGate } from '../permission-gate.js';
import { LocalToolOutputOptimizer } from '../tool-output-optimizer.js';
import { DEFAULT_TOOL_REGISTRY, CORE_TOOL_DEFINITIONS } from '../default-registry.js';
import type { ZamPlanRequestBody, ZamPlanResponse, ToolAction } from '../types.js';

const program = new Command();

program
  .name('zam-agent')
  .description('ZAM-Native Agent Runtime — lightweight AI agent loop owner')
  .version('0.1.0');

program
  .command('run')
  .description('Run a single agent session with the given prompt')
  .argument('<prompt>', 'The prompt text to send to the agent')
  .option('--config <path>', 'Path to runtime.config.json', './runtime.config.json')
  .option('--model <model>', 'Override the model from config')
  .option('--registry <path>', 'Path to a ZAM component registry JSON file')
  .action(async (prompt: string, opts: { config: string; model?: string; registry?: string }) => {
    try {
      // Load config
      const config = loadConfig(opts.config);

      // Override model if specified
      if (opts.model) {
        config.provider.model = opts.model;
      }

      // Create session
      const session = createSession(config);
      console.error(`[zam-agent] Session: ${session.sessionId}`);
      console.error(`[zam-agent] Model: ${config.provider.model}`);

      // Load the ZAM core plan function and create client
      const planFn = await createCorePlanFn(opts.registry ?? config.registry?.path);
      const zamClient = createZamClient(planFn);

      // Create provider client
      const provider = createProviderClient(config);

      // Create tool execution infrastructure (Phase R6)
      const workspaceRoot = config.workspace.rootPath || process.cwd();
      const workspace = new LocalWorkspace(workspaceRoot);
      console.error(`[zam-agent] Workspace: ${workspace.getWorkspaceRoot()}`);

      const permissionGate = new LocalPermissionGate({
        approvalCallback: createInteractiveApprovalCallback(),
      });

      const toolOptimizer = new LocalToolOutputOptimizer();

      // Create a minimal registry (passed to runLoop for tool registration)
      const registry = {};

      // Run the turn loop with full tool infrastructure
      const result = await runLoop(
        session,
        { text: prompt },
        zamClient,
        provider,
        registry,
        workspace,
        permissionGate,
        toolOptimizer,
        undefined,  // optimizerConfig
        undefined,  // subscriberBus
        undefined,  // stuckDetectorState
        CORE_TOOL_DEFINITIONS,  // Phase R6: tool schemas for provider
      );

      // Output results
      console.log(result.finalResponse);
      console.error(`[zam-agent] Turns: ${result.turnCount}`);
      console.error(`[zam-agent] Exit: ${result.exitReason}`);
      console.error(`[zam-agent] Session ID: ${result.sessionId}`);

      process.exit(result.exitReason === 'completed' ? 0 : 1);
    } catch (err) {
      console.error(`[zam-agent] Fatal error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`[zam-agent] ${(err as Error).message}`);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Interactive approval callback for Permission Gate
// ---------------------------------------------------------------------------

/**
 * Create an interactive approval callback that prompts the user via stderr.
 *
 * Per docs/24 §3.7:
 * - Actions requiring approval block the loop until the user responds.
 * - Uses standard Node.js readline on stderr (stdout is reserved for
 *   the agent's final response output).
 */
function createInteractiveApprovalCallback(): (action: ToolAction) => Promise<boolean> {
  return (action: ToolAction): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stderr,
      });

      const argsPreview = JSON.stringify(action.arguments, null, 2);
      process.stderr.write(
        `\n[zam-agent] Permission required for: ${action.toolName}\n` +
        `[zam-agent] Arguments: ${argsPreview}\n` +
        `[zam-agent] Allow? (y/n): `,
      );

      rl.once('line', (answer: string) => {
        rl.close();
        const approved = answer.trim().toLowerCase() === 'y';
        if (approved) {
          process.stderr.write('[zam-agent] → Approved.\n');
        } else {
          process.stderr.write('[zam-agent] → Denied.\n');
        }
        resolve(approved);
      });
    });
  };
}

// ---------------------------------------------------------------------------
// Core plan function loader — replaces Phase R2 placeholder
// ---------------------------------------------------------------------------

/**
 * Dynamically load the ZAM core `plan()` function and return a planFn
 * compatible with the ZamClient injection interface.
 *
 * The core library API is loaded via dynamic import() to maintain the
 * clean package boundary between @zam/runtime and context-plane.
 * The runtime does NOT have a compile-time dependency on the core.
 *
 * When a registry path is provided (via --registry or config.registry.path),
 * the registry JSON is pre-loaded from disk and injected into every plan call.
 * The 5 default tool components (from default-registry.ts) are always merged
 * into the registry unless user-provided components with the same IDs exist.
 *
 * Canonical: docs/18 §7; docs/24 §9.
 */
async function createCorePlanFn(
  registryPath?: string,
): Promise<(input: ZamPlanRequestBody) => Promise<ZamPlanResponse>> {
  // Dynamic import of the core library API.
  // Path is relative to this file's compiled location in the workspace.
  // At build-time: this file is at packages/runtime/dist/cli/index.js,
  // so ../../../../dist/core/api.js resolves to the workspace dist/core/api.js.
  const coreApiUrl = new URL('../../../../dist/core/api.js', import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let corePlan: (input: any) => any;
  try {
    const coreModule = await import(coreApiUrl.href);
    corePlan = coreModule.plan;
    if (typeof corePlan !== 'function') {
      throw new Error('Core module does not export a plan() function.');
    }
  } catch (err) {
    console.error(
      '[zam-agent] Warning: Could not load ZAM core library API. ' +
      'Using built-in fallback plan function.',
    );
    console.error(`[zam-agent] Core load error: ${(err as Error).message}`);
    // Fallback to built-in minimal plan function if core is unavailable.
    // This ensures the runtime CLI still works even without the core built.
    return createFallbackPlanFn();
  }

  // Pre-load registry from file if a path was provided.
  let userRegistry: unknown[] = [];
  if (registryPath) {
    try {
      const raw = readFileSync(registryPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        console.error(
          `[zam-agent] Warning: Registry file must contain a JSON array. ` +
          `Got ${typeof parsed}. Using empty registry.`,
        );
      } else {
        userRegistry = parsed;
        console.error(`[zam-agent] Registry: ${userRegistry.length} components loaded from ${registryPath}`);
      }
    } catch (err) {
      console.error(
        `[zam-agent] Warning: Could not load registry from ${registryPath}: ` +
        `${(err as Error).message}. Using empty registry.`,
      );
    }
  }

  // Merge default tool components with user registry.
  // User-provided components with matching IDs take precedence.
  const mergedRegistry = mergeRegistries(userRegistry, DEFAULT_TOOL_REGISTRY);
  console.error(`[zam-agent] Registry: ${mergedRegistry.length} total components (including ${DEFAULT_TOOL_REGISTRY.length} default tools)`);

  return async (input: ZamPlanRequestBody): Promise<ZamPlanResponse> => {
    // Map ZamPlanRequestBody to CorePlanInput.
    // Use the merged registry (user + default tools).
    // If the caller provided an inline registry, merge tools into it too.
    const inlineRegistry = Array.isArray(input.registry)
      ? mergeRegistries(input.registry as unknown[], DEFAULT_TOOL_REGISTRY)
      : mergedRegistry;

    const result = corePlan({
      request: input.request,
      registry: inlineRegistry,
      // Pass through optional fields — CorePlanInput accepts the same shapes.
      // Fields that don't exist on input are undefined → omitted by the core API.
      history: input.history,
      budget: input.budget,
      constraints: input.userConstraints,
      requestSignals: input.requestSignals,
    });
    return result as ZamPlanResponse;
  };
}

/**
 * Merge two registry arrays, with entries in `primary` taking precedence
 * over entries in `defaults` when they share the same `id` field.
 */
function mergeRegistries(primary: unknown[], defaults: unknown[]): unknown[] {
  const primaryIds = new Set<string>();
  for (const entry of primary) {
    if (entry && typeof entry === 'object' && 'id' in entry) {
      primaryIds.add((entry as { id: string }).id);
    }
  }

  const merged = [...primary];
  for (const entry of defaults) {
    if (entry && typeof entry === 'object' && 'id' in entry) {
      const id = (entry as { id: string }).id;
      if (!primaryIds.has(id)) {
        merged.push(entry);
      }
    }
  }

  return merged;
}

/**
 * Fallback plan function used when the ZAM core library API is not available.
 * Produces a minimal prompt plan with the user request text, matching the
 * Phase R2 placeholder behavior. This ensures the runtime CLI can still
 * function for basic testing even without the core built.
 */
function createFallbackPlanFn(): (input: ZamPlanRequestBody) => Promise<ZamPlanResponse> {
  return async (input: ZamPlanRequestBody): Promise<ZamPlanResponse> => {
    const runId = crypto.randomUUID();
    return {
      promptPlan: {
        selectedComponents: [
          {
            id: 'system-prompt',
            content: 'You are a helpful assistant.',
            role: 'system' as const,
            cacheStability: 'stable' as const,
          },
          {
            id: 'user-request',
            content: input.request.text,
            role: 'user' as const,
            cacheStability: 'volatile' as const,
          },
        ],
        omittedComponents: [],
        deferredComponents: [],
        selectedTools: [],
        riskFlags: [],
        failOpenReasons: [],
        planningWarnings: [],
      },
      trace: {
        run: { runId },
      },
      summary: `Fallback planning run ${runId} completed (core not loaded).`,
    };
  };
}
