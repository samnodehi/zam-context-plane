// ============================================================================
// ZAM Runtime — Selector Prompt Templates
// Canonical source: docs/26_MODEL_ASSISTED_SELECTOR_IMPLEMENTATION.md §4.5
// Phase M2-B: Prompt builder for the Model-Assisted Selector LLM call.
// ============================================================================

/**
 * Input data required to build the Model-Assisted Selector prompt.
 * All fields are provided by the runtime turn-loop after the first
 * deterministic core pass identifies unresolved components.
 *
 * Canonical: docs/26 §4.5.
 */
export interface SelectorPromptData {
  /** The original user request text. */
  requestText: string;
  /** The prompt family determined by the Analyzer (e.g. 'coding_build_debug'). */
  promptFamily: string;
  /** The Analyzer's confidence score (0.0–1.0). */
  analyzerConfidence: number;
  /** Lanes the Analyzer identified as needed (e.g. ['scaffold', 'tools']). */
  neededLanes: string[];
  /** The risk level determined by the Analyzer (e.g. 'low', 'medium', 'high', 'critical'). */
  assessedRequestRiskLevel: string;
  /**
   * A JSON-serialized array of unresolved components.
   * Each element must contain at least: id, type, description, tags.
   * This string is inserted directly into the prompt — the caller is responsible
   * for producing valid JSON before passing it here.
   */
  unresolvedComponentsJson: string;
}

/**
 * Builds the Model-Assisted Selector prompt for a single LLM call.
 * Canonical: docs/26 §4.5.
 *
 * The returned string instructs the model to evaluate each unresolved component
 * and return a JSON array of decisions matching the ProposalDecision shape.
 * When the model is uncertain it must prefer "include" (fail-open).
 *
 * @param data  All fields required to populate the prompt template.
 * @returns     The complete prompt string, ready for the provider client.
 */
export function buildSelectorPrompt(data: SelectorPromptData): string {
  const lanesDisplay = data.neededLanes.length > 0
    ? data.neededLanes.join(', ')
    : '(none specified)';

  return `You are a context selection advisor for an AI agent runtime.

## Request Context
User request: "${data.requestText}"
Request classification: ${data.promptFamily} (confidence: ${data.analyzerConfidence})
Needed lanes: ${lanesDisplay}
Risk level: ${data.assessedRequestRiskLevel}

## Unresolved Components
The following components could not be decisively classified by the deterministic
selector. For each, decide whether to include, omit, or defer:

${data.unresolvedComponentsJson}

## Rules
- Return a JSON array of decisions.
- For each component, provide: componentId, action (include/omit/defer), confidence (high/medium/low), path, reason, evidence[].
- When uncertain, prefer "include" (fail-open).
- Safety-critical, mandatory, and high-risk components should always be "include".
- Components not relevant to the current request type may be "omit" if you are confident.

Respond with ONLY the JSON array. No explanation, no markdown.`;
}
