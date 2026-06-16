// Prompt assembler (docs/40 §4) — builds the per-message prompt from the selected
// components only (same approach as the OpenClaw adapter).

import type { RegistryEntry } from './types.js';

export interface PartitionEntry {
  componentId: string;
}
export interface PromptPlan {
  promptFamily: string;
  selectedComponents: PartitionEntry[];
  omittedComponents: unknown[];
  deferredComponents: unknown[];
}
export interface AssembleStats {
  promptFamily: string;
  selected: number;
  omitted: number;
  deferred: number;
  baselineTokens: number;
  selectedTokens: number;
  savedTokens: number;
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
    if (!entry) continue;
    selectedTokens += entry.tokensApprox;
    sections.push(`## ${entry.title}\n\n${bodies.get(sel.componentId) ?? ''}`.trimEnd());
  }

  const baselineTokens = registry.reduce((sum, c) => sum + c.tokensApprox, 0);
  const savedTokens = Math.max(0, baselineTokens - selectedTokens);
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
      savedPct: baselineTokens > 0 ? savedTokens / baselineTokens : 0,
    },
  };
}
