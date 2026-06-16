// Prompt assembler (docs/38 §3 DQ-6).
//
// Reads ONLY the plan's selectedComponents, pulls each component's cached body,
// and concatenates them into the final governed prompt. Omitted and deferred
// components are excluded by construction — that is the governance payoff.

import type { RegistryEntry } from './extract.js';

/** One entry in a prompt-plan partition (schemas/outputs/prompt-plan.schema.json). */
export interface PartitionEntry {
  componentId: string;
  action: string;
  path: string;
  reason: string;
  tokensApprox?: number;
}

/** The subset of the core's prompt-plan the adapter consumes. */
export interface PromptPlan {
  promptFamily: string;
  selectedComponents: PartitionEntry[];
  omittedComponents: PartitionEntry[];
  deferredComponents: PartitionEntry[];
  estimatedTokens: { total: number };
}

export interface AssembleStats {
  promptFamily: string;
  selected: number;
  omitted: number;
  deferred: number;
  /** Tokens if every component were injected (the naive baseline). */
  baselineTokens: number;
  /** Tokens actually kept (selected components only). */
  selectedTokens: number;
  savedTokens: number;
  /** Fraction in [0, 1] of baseline tokens saved by governance. */
  savedPct: number;
}

export interface AssembleResult {
  prompt: string;
  stats: AssembleStats;
}

export function assemblePrompt(
  promptPlan: PromptPlan,
  registry: RegistryEntry[],
  bodies: Map<string, string>,
): AssembleResult {
  const byId = new Map(registry.map((c) => [c.id, c]));
  const sections: string[] = [];
  let selectedTokens = 0;

  for (const sel of promptPlan.selectedComponents) {
    const entry = byId.get(sel.componentId);
    if (!entry) continue; // unknown / reference-only component — nothing to assemble
    const body = bodies.get(sel.componentId) ?? '';
    selectedTokens += entry.tokensApprox;
    sections.push(`## ${entry.title}\n\n${body}`.trimEnd());
  }

  const baselineTokens = registry.reduce((sum, c) => sum + c.tokensApprox, 0);
  const savedTokens = Math.max(0, baselineTokens - selectedTokens);
  const savedPct = baselineTokens > 0 ? savedTokens / baselineTokens : 0;

  return {
    prompt: sections.join('\n\n'),
    stats: {
      promptFamily: promptPlan.promptFamily,
      selected: promptPlan.selectedComponents.length,
      omitted: promptPlan.omittedComponents.length,
      deferred: promptPlan.deferredComponents.length,
      baselineTokens,
      selectedTokens,
      savedTokens,
      savedPct,
    },
  };
}
