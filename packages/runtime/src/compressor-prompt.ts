// ============================================================================
// ZAM Runtime — Compressor Prompt Templates + History Formatter
// Phase M3-B. Canonical source: docs/27 §8.4, §8.5.
// ============================================================================

import type { EventStreamEntry } from './types.js';

// ---------------------------------------------------------------------------
// §8.4 Compressor Prompt Template
// ---------------------------------------------------------------------------

/**
 * The system prompt template for the History Compressor model.
 *
 * Variables:
 *   {formattedHistory}  — formatted conversation history from formatHistory()
 *   {rawWindowSize}     — configured raw window size (number)
 *   {actualTurnCount}   — total completed turns in the session (number)
 *
 * Canonical source: docs/27 §8.4.
 */
export const COMPRESSOR_PROMPT_TEMPLATE = `You are a structured state extractor for an AI agent session history.

Your job is to analyze the conversation history below and extract structured \
state into 11 categories. You are NOT writing a paragraph summary. You are \
extracting discrete, identifiable state items into a JSON schema.

## CRITICAL RULES
1. PROTECTED CATEGORIES must be extracted completely. Missing a user constraint, \
accepted decision, or open commitment is a CRITICAL failure.
2. Never embed raw conversation text. Extract structured descriptions only.
3. When uncertain whether an item should be included, INCLUDE IT. Fail-open.
4. Preserve the semantic meaning exactly. "Do NOT use React" must not become \
"Use React".
5. No secrets, credentials, API keys, or sensitive data in any field.

## Session History
{formattedHistory}

## Output Format (JSON)
Respond with ONLY a JSON object matching this exact schema:
{
  "currentTaskState": {
    "activeTask": "<string or null>",
    "currentGoal": "<string or null>",
    "blockers": ["<string>"],
    "progressNotes": ["<string>"]
  },
  "acceptedDecisions": [
    {"decisionId": "<unique-id>", "summary": "<what was decided>", "acceptedAt": "<turn reference>"}
  ],
  "openIssues": [
    {"issueId": "<unique-id>", "summary": "<description>", "severity": "<critical|important|advisory>"}
  ],
  "openCommitments": [
    {"commitmentId": "<unique-id>", "summary": "<what was committed>", "committedAt": "<turn reference>"}
  ],
  "userConstraints": [
    {"constraintId": "<unique-id>", "summary": "<constraint description>"}
  ],
  "importantFilesPaths": ["<path>"],
  "failedAttempts": [
    {"attemptId": "<unique-id>", "summary": "<what was tried>", "failureReason": "<why it failed>"}
  ],
  "activeWarnings": [
    {"warningCode": "<code>", "message": "<warning description>"}
  ],
  "antiRegressionRules": [
    {
      "ruleId": "<unique-id>",
      "category": "<process|architectural|tool_specific|safety>",
      "summary": "<the rule>",
      "severity": "<critical|important|advisory>",
      "applicability": ["<task types>"],
      "sourceReference": "<what incident created this>",
      "reviewDate": null
    }
  ],
  "durableFacts": [
    {"factId": "<unique-id>", "summary": "<fact description>"}
  ],
  "recentRawTurnWindow": {
    "windowSize": {rawWindowSize},
    "turnCount": {actualTurnCount},
    "windowPolicy": "most_recent_N"
  },
  "compressionConfidence": <float 0.0-1.0>,
  "failOpenTriggered": <true if confidence < 0.75 or uncertain>,
  "failOpenReason": "<reason or null>",
  "protectedCategoriesRetained": [<list of protected categories you retained>],
  "totalRawTokensApprox": <integer>,
  "compressedTokensApprox": <integer>
}

## Category Extraction Instructions
- currentTaskState: What is the user currently trying to accomplish?
- acceptedDecisions: What has been explicitly agreed upon? ("OK", "approved", "yes let's do that")
- openIssues: What problems have been identified but not resolved?
- openCommitments: What has been promised or is pending delivery?
- userConstraints: What rules or preferences has the user stated? ("always", "never", "must", "don't")
- importantFilesPaths: What files and directories have been referenced?
- failedAttempts: What approaches were tried and abandoned? Why?
- activeWarnings: Any warnings or risks that are still relevant?
- antiRegressionRules: What hard lessons emerged? What must not be repeated?
- durableFacts: What long-lived facts were established (project structure, naming conventions, etc.)?

Respond with ONLY the JSON object. No explanation, no markdown fences.`;

// ---------------------------------------------------------------------------
// §8.4 Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build the final compressor prompt by interpolating variables into the template.
 *
 * @param formattedHistory  The formatted conversation history string.
 * @param rawWindowSize     Configured raw window size.
 * @param actualTurnCount   Total completed turns in the session.
 * @returns The fully interpolated prompt string.
 */
export function buildCompressorPrompt(
  formattedHistory: string,
  rawWindowSize: number,
  actualTurnCount: number,
): string {
  return COMPRESSOR_PROMPT_TEMPLATE
    .replace('{formattedHistory}', formattedHistory)
    .replace('{rawWindowSize}', String(rawWindowSize))
    .replace('{actualTurnCount}', String(actualTurnCount));
}

// ---------------------------------------------------------------------------
// §8.5 History Formatting for the Prompt
// ---------------------------------------------------------------------------

/**
 * Format EventStream entries into the text format expected by the compressor prompt.
 *
 * Per docs/27 §8.5:
 * - Only `user_message`, `model_response` (text), `tool_call`, and `tool_result`
 *   entries are included.
 * - `system_event`, `zam_plan`, and `error` entries are excluded (they are internal).
 *
 * Output format:
 *   [Turn 1] User: <user message text>
 *   [Turn 1] Assistant: <model response text>
 *   [Turn 1] Tool Call: <tool name>(<arguments>)
 *   [Turn 1] Tool Result: <output>
 *
 * @param entries  All EventStream entries for the session.
 * @returns Formatted history string.
 */
export function formatHistory(entries: EventStreamEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const turn = entry.turnIndex + 1; // 1-indexed for display

    switch (entry.type) {
      case 'user_message': {
        const content = entry.content as { text: string };
        lines.push(`[Turn ${turn}] User: ${content.text}`);
        break;
      }
      case 'model_response': {
        const content = entry.content as { type: string; text?: string };
        // Only include text responses; tool_call responses are represented
        // by their separate tool_call entries.
        if (content.type === 'text' && content.text) {
          lines.push(`[Turn ${turn}] Assistant: ${content.text}`);
        }
        break;
      }
      case 'tool_call': {
        const content = entry.content as {
          toolName: string;
          arguments: Record<string, unknown>;
        };
        const argsStr = JSON.stringify(content.arguments);
        lines.push(`[Turn ${turn}] Tool Call: ${content.toolName}(${argsStr})`);
        break;
      }
      case 'tool_result': {
        const content = entry.content as { output: string };
        lines.push(`[Turn ${turn}] Tool Result: ${content.output}`);
        break;
      }
      // system_event, zam_plan, error → excluded (internal)
      default:
        break;
    }
  }

  return lines.join('\n');
}
