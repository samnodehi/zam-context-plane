// zam-adapter-openclaw — the first reference adapter (docs/38).
//
// Demonstrates the docs/37 §5 adapter contract end-to-end for an OpenClaw-shaped
// workspace: extract files -> ZAM registry, run the deterministic core plan(),
// assemble the governed prompt from the selected components only.
//
// Per docs/37 DQ-5 the adapter needs NO per-turn model call — classification is
// the deterministic core router; fail-open behavior is inherited unchanged.

import { plan as corePlan } from 'context-plane';
import { extractWorkspace, type RegistryEntry } from './extract.js';
import { assemblePrompt, type AssembleStats, type PromptPlan } from './assemble.js';

export { extractWorkspace } from './extract.js';
export type { RegistryEntry, ExtractResult } from './extract.js';
export { assemblePrompt } from './assemble.js';
export type { PromptPlan, PartitionEntry, AssembleStats, AssembleResult } from './assemble.js';
export { parseFrontmatter } from './frontmatter.js';

interface PlanResult {
  promptPlan: PromptPlan;
  trace: unknown;
  summary: string;
}

// The core's plan() is the deterministic governance entrypoint. We rely only on
// the documented prompt-plan partitions (schemas/outputs/prompt-plan.schema.json),
// so we annotate structurally and stay decoupled from the core's exported type names.
const plan = corePlan as unknown as (input: {
  request: { text: string };
  registry: RegistryEntry[];
}) => PlanResult;

export interface GovernInput {
  workspaceDir: string;
  requestText: string;
}

export interface GovernResult {
  registry: RegistryEntry[];
  promptFamily: string;
  prompt: string;
  stats: AssembleStats;
  plan: PlanResult;
}

/**
 * Govern an OpenClaw-shaped workspace for a single user request: extract -> plan -> assemble.
 * The one call an OpenClaw-style host makes per turn.
 */
export function governWorkspace(input: GovernInput): GovernResult {
  const { registry, bodies } = extractWorkspace(input.workspaceDir);
  const result = plan({ request: { text: input.requestText }, registry });
  const { prompt, stats } = assemblePrompt(result.promptPlan, registry, bodies);
  return {
    registry,
    promptFamily: result.promptPlan.promptFamily,
    prompt,
    stats,
    plan: result,
  };
}
