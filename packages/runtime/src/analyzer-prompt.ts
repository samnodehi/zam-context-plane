// ============================================================================
// ZAM Runtime — Analyzer Prompt Templates
// Canonical source: docs/25 §6.3, §6.5
// Phase M1-B: Prompt builders for Tier 1 and Tier 2 analyzer calls.
// ============================================================================

/**
 * Builds the Tier 1 prompt for the lightweight analyzer model.
 * Canonical: docs/25 §6.3.
 *
 * The prompt instructs the model to classify the user request and produce
 * a structured JSON output matching the AnalyzerOutput schema
 * (schemas/future/analyzer-output.schema.json).
 */
export function buildTier1AnalyzerPrompt(requestText: string): string {
  return `You are a request classifier for an AI agent context governance system.

Analyze the following user request and produce a structured JSON classification.

## User Request
${requestText}

## Output Format (JSON)
Respond with ONLY a JSON object matching this exact schema:
{
  "promptFamily": "<one of: general_default, simple_greeting, coding_build_debug, research_investigation, ops_security_change_risk, lifecycle_internal, heartbeat_proactive, group_chat_behavior, tool_use_required, history_sensitive>",
  "requestType": "<broad category: greeting, coding, research, ops, lifecycle, conversation>",
  "taskType": "<specific: debug, refactor, review, continuation, explain, create, deploy, other>",
  "analyzerConfidence": <float 0.0-1.0>,
  "assessedRequestRiskLevel": "<low, medium, high, critical>",
  "neededLanes": [<list of relevant lanes from: scaffold, project_rules, policy_safety, skills, tools, memory, history, files, output_format, runtime_capabilities>],
  "requiresHistory": <true/false>,
  "requiresTools": <true/false>,
  "requiresFiles": <true/false>,
  "evidence": [<list of textual signals you used>]
}

## Classification Rules
1. If the request is a simple greeting or acknowledgement, use promptFamily "simple_greeting".
2. If the request involves code (writing, debugging, reviewing), use "coding_build_debug".
3. If the request involves research or explanation, use "research_investigation".
4. If the request involves deployment, security, or infrastructure changes, use "ops_security_change_risk".
5. If the request references previous conversation ("continue", "fix that", "as before"), set requiresHistory to true and consider "history_sensitive".
6. If the request requires executing commands or file operations, set requiresTools to true.
7. For neededLanes, include only the lanes that are genuinely needed. Be conservative — include rather than exclude when uncertain.
8. Set analyzerConfidence to reflect your actual confidence. Use < 0.6 if the request is genuinely ambiguous.

Respond with ONLY the JSON object. No explanation, no markdown.`;
}

/**
 * Builds the Tier 2 prompt for the stronger analyzer model when Tier 1
 * confidence is below the threshold.
 * Canonical: docs/25 §6.5.
 *
 * The Tier 2 prompt includes the Tier 1 result for context, then appends
 * the full Tier 1 prompt so the stronger model has all the same instructions
 * plus knowledge of what the lightweight model concluded.
 */
export function buildTier2AnalyzerPrompt(
  requestText: string,
  tier1Classification: string,
  tier1Confidence: number,
): string {
  const tier2Context = `## Tier 2 Escalation Context
A lightweight classifier analyzed this request and classified it as:
Classification: ${tier1Classification}
Confidence: ${tier1Confidence}
Because the confidence was below the threshold, please provide a deeper, more accurate analysis of the request.

---

`;

  return tier2Context + buildTier1AnalyzerPrompt(requestText);
}
