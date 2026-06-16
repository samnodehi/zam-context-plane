// @zam/adapter-mcp — the strategic second reference adapter (docs/39).
//
// Governs an MCP client's aggregated capabilities: map tools/resources/prompts to
// a ZAM registry, run the deterministic core plan(), and return only the subset to
// surface this turn. Same docs/37 §5 contract as the OpenClaw adapter, different
// surface — which is the point (portability proof). No per-turn model call.

import { plan as corePlan } from 'context-plane';
import { mapCapabilities } from './map.js';
import type { McpCapabilities, McpPrompt, McpResource, McpTool, RegistryEntry } from './types.js';

export { mapCapabilities } from './map.js';
export { classifyCapability } from './classify.js';
export type {
  McpCapabilities,
  McpServerCapabilities,
  McpTool,
  McpResource,
  McpPrompt,
  RegistryEntry,
  MappedItem,
  CapabilityKind,
} from './types.js';

interface PromptPlan {
  promptFamily: string;
  selectedComponents: Array<{ componentId: string }>;
  omittedComponents: unknown[];
  deferredComponents: unknown[];
}
interface PlanResult {
  promptPlan: PromptPlan;
  trace: unknown;
  summary: string;
}

// Decoupled structural annotation over the documented prompt-plan partitions.
const plan = corePlan as unknown as (input: {
  request: { text: string };
  registry: RegistryEntry[];
}) => PlanResult;

export interface SurfacedCapabilities {
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export interface GovernStats {
  promptFamily: string;
  totalTools: number;
  totalResources: number;
  totalPrompts: number;
  surfacedTools: number;
  surfacedResources: number;
  surfacedPrompts: number;
  baselineTokens: number;
  surfacedTokens: number;
  savedTokens: number;
  savedPct: number;
}

export interface GovernCapabilitiesResult {
  registry: RegistryEntry[];
  promptFamily: string;
  surfaced: SurfacedCapabilities;
  stats: GovernStats;
  plan: PlanResult;
}

export interface GovernCapabilitiesInput {
  capabilities: McpCapabilities;
  requestText: string;
}

/**
 * Govern an MCP capability set for a single request: map -> plan() -> reconstruct
 * the surfaced tools/resources/prompts. The one call an MCP host makes per turn
 * before advertising its tool list to the model.
 */
export function governCapabilities(input: GovernCapabilitiesInput): GovernCapabilitiesResult {
  const { registry, items } = mapCapabilities(input.capabilities);
  const result = plan({ request: { text: input.requestText }, registry });
  const selectedIds = new Set(result.promptPlan.selectedComponents.map((c) => c.componentId));

  const surfaced: SurfacedCapabilities = { tools: [], resources: [], prompts: [] };
  let surfacedTokens = 0;

  // Iterate the registry (sorted, deterministic) and keep the selected items.
  for (const entry of registry) {
    if (!selectedIds.has(entry.id)) continue;
    const item = items.get(entry.id);
    if (!item) continue;
    surfacedTokens += entry.tokensApprox;
    if (item.kind === 'tool' && item.tool) surfaced.tools.push(item.tool);
    else if (item.kind === 'resource' && item.resource) surfaced.resources.push(item.resource);
    else if (item.kind === 'prompt' && item.prompt) surfaced.prompts.push(item.prompt);
  }

  let totalTools = 0;
  let totalResources = 0;
  let totalPrompts = 0;
  for (const it of items.values()) {
    if (it.kind === 'tool') totalTools++;
    else if (it.kind === 'resource') totalResources++;
    else totalPrompts++;
  }

  const baselineTokens = registry.reduce((sum, c) => sum + c.tokensApprox, 0);
  const savedTokens = Math.max(0, baselineTokens - surfacedTokens);
  const savedPct = baselineTokens > 0 ? savedTokens / baselineTokens : 0;

  return {
    registry,
    promptFamily: result.promptPlan.promptFamily,
    surfaced,
    stats: {
      promptFamily: result.promptPlan.promptFamily,
      totalTools,
      totalResources,
      totalPrompts,
      surfacedTools: surfaced.tools.length,
      surfacedResources: surfaced.resources.length,
      surfacedPrompts: surfaced.prompts.length,
      baselineTokens,
      surfacedTokens,
      savedTokens,
      savedPct,
    },
    plan: result,
  };
}
