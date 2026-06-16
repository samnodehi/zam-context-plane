// ============================================================================
// ZAM Runtime — Prompt Assembler
// Canonical source: docs/24 §3.4, docs/18 §6
// Phase R6: Filters metadataOnly components, injects user request,
//           accepts runtime tool definitions for provider function calling,
//           injects conversation history from EventStream.
// ============================================================================

import type {
  PromptPlan,
  SelectedComponent,
  AssembledPrompt,
  ProviderMessage,
  ProviderToolDefinition,
  CacheHint,
  EventStreamEntry,
  UserMessageContent,
  ModelResponseContent,
  ToolResultContent,
} from './types.js';

/**
 * Translate prompt-plan.json into an OpenAI-compatible message array.
 *
 * Per docs/24 §3.4:
 * - selectedComponents become messages in stable → session → volatile order
 * - System components → role: 'system'
 * - User request and conversation history are inferred from component roles
 * - Cache hints are generated from cacheStability classification
 *
 * Phase R6 additions:
 * - Components with no content (metadataOnly tool descriptors) are filtered out.
 * - If requestText is provided and no user message exists in the plan, the
 *   user's request is injected as a role: 'user' message.
 * - If toolDefinitions are provided, they are used as the tool schemas for
 *   the provider. Otherwise, falls back to selectedTools from the plan.
 * - Conversation history from EventStream is injected between system messages
 *   and the current user message to enable multi-turn interactions.
 *
 * @param promptPlan      ZAM's prompt plan output
 * @param requestText     Optional user request text to inject if missing
 * @param toolDefinitions Optional runtime tool schemas for provider function calling
 * @param history         Optional EventStream entries for conversation history
 */
export function assemblePrompt(
  promptPlan: PromptPlan,
  requestText?: string,
  toolDefinitions?: ProviderToolDefinition[],
  history?: EventStreamEntry[],
): AssembledPrompt {
  const messages: ProviderMessage[] = [];
  const cacheHints: CacheHint[] = [];

  // Convert selectedComponents into messages.
  // Components arrive from ZAM already in stable → session → volatile order
  // per docs/18 §6.3 and PPG output ordering.
  // Phase R6: Skip components with no content (metadataOnly tool descriptors).
  for (const component of promptPlan.selectedComponents) {
    if (!component.content) {
      continue;
    }
    const message = componentToMessage(component);
    const messageIndex = messages.length;
    messages.push(message);

    // Generate cache hints based on stability classification
    if (component.cacheStability) {
      cacheHints.push({
        messageIndex,
        stability: component.cacheStability,
      });
    }
  }

  // Phase R6: Inject conversation history from EventStream.
  // History entries are inserted after system/component messages but before
  // the current user message. This enables multi-turn tool-use interactions.
  if (history && history.length > 0) {
    const historyMessages = mapHistoryToMessages(history);
    messages.push(...historyMessages);
  }

  // Phase R6: Ensure the user's request text is present as a user message.
  // If ZAM's plan already includes a user-role component, do not duplicate.
  // Also skip if history already contains the current user message (it will
  // be the last user_message entry appended by the turn loop at Step 0).
  if (requestText) {
    const hasUserMessage = messages.some((m) => m.role === 'user');
    if (!hasUserMessage) {
      messages.push({ role: 'user', content: requestText });
    }
  }

  // Phase R6: Use runtime tool definitions if provided; otherwise fall back
  // to mapping selectedTools from ZAM's prompt plan (Phase R3 behavior).
  const tools = toolDefinitions && toolDefinitions.length > 0
    ? toolDefinitions
    : mapSelectedTools(promptPlan.selectedTools);

  return {
    messages,
    tools,
    cacheHints,
  };
}

// ---------------------------------------------------------------------------
// History mapping
// ---------------------------------------------------------------------------

/**
 * Convert EventStream entries into ProviderMessages for conversation replay.
 *
 * Mapping rules:
 * - user_message  → role: 'user',      content: text
 * - model_response → role: 'assistant', content: text (fallback ''),
 *                    toolCalls if present
 * - tool_result   → role: 'tool',      toolCallId: callId,
 *                    content: output (fallback error message)
 *
 * Other entry types (zam_plan, tool_call, error, system_event) are skipped
 * since they are internal runtime events, not conversation messages.
 */
function mapHistoryToMessages(entries: EventStreamEntry[]): ProviderMessage[] {
  const result: ProviderMessage[] = [];

  for (const entry of entries) {
    switch (entry.type) {
      case 'user_message': {
        const c = entry.content as UserMessageContent;
        result.push({ role: 'user', content: c.text });
        break;
      }
      case 'model_response': {
        const c = entry.content as ModelResponseContent;
        const msg: ProviderMessage = {
          role: 'assistant',
          content: c.text ?? '',
        };
        if (c.toolCalls && c.toolCalls.length > 0) {
          msg.toolCalls = c.toolCalls;
        }
        result.push(msg);
        break;
      }
      case 'tool_result': {
        const c = entry.content as ToolResultContent;
        result.push({
          role: 'tool',
          toolCallId: c.callId,
          content: c.output || c.error || 'Tool returned no output.',
        });
        break;
      }
      // zam_plan, tool_call, error, system_event are internal — skip.
      default:
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Legacy helpers
// ---------------------------------------------------------------------------

/**
 * Map ZAM's selectedTools into provider-compatible tool definitions.
 *
 * Per docs/24 §3.4: the assembler passes through tool definitions from
 * ZAM's prompt plan without modification. Tool selection is ZAM's decision.
 */
function mapSelectedTools(
  selectedTools?: unknown[],
): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  if (!selectedTools || selectedTools.length === 0) {
    return [];
  }

  return selectedTools
    .filter((tool): tool is Record<string, unknown> => tool !== null && typeof tool === 'object')
    .map((tool) => ({
      name: String(tool.name ?? ''),
      description: String(tool.description ?? ''),
      parameters: (tool.parameters as Record<string, unknown>) ?? {},
    }));
}

/**
 * Convert a single selected component into a provider message.
 *
 * Role mapping:
 * - Components with role 'system' or no explicit role → 'system'
 * - Components with role 'user' → 'user'
 * - Components with role 'assistant' → 'assistant'
 */
function componentToMessage(component: SelectedComponent): ProviderMessage {
  // Default to 'system' if no explicit role — system prompt text from
  // selected components becomes role:'system' per the instructions.
  const role = component.role ?? 'system';

  return {
    role,
    content: component.content,
  };
}
