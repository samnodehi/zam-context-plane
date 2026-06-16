// ============================================================================
// ZAM Runtime — Provider Client
// Canonical source: docs/24 §3.5, §6
// Phase R5: Multi-provider with cache advisory and retry logic.
// ============================================================================

import type {
  ProviderClient,
  ProviderChatOptions,
  ProviderResponse,
  ProviderMessage,
  ProviderToolDefinition,
  CacheHint,
  RuntimeConfig,
} from './types.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

/** Default retry configuration. */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * Fetch with exponential backoff retry for rate limits (429) and transient
 * server errors (5xx).
 *
 * Per docs/24 §3.5 invariant: "Provider implementations handle rate limiting,
 * retries, and API-specific error translation internally."
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  providerLabel: string,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);

    // Success or non-retryable error — return immediately
    if (response.ok || (!isRetryableStatus(response.status))) {
      return response;
    }

    // Retryable status (429 or 5xx)
    lastError = new Error(
      `${providerLabel} API error (HTTP ${response.status}): ${await response.text()}`,
    );

    // If this was the last attempt, don't sleep — fall through to throw
    if (attempt < maxRetries) {
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      await sleep(delayMs);
    }
  }

  // All retries exhausted
  throw lastError ?? new Error(`${providerLabel} request failed after ${maxRetries} retries.`);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a provider client based on config.
 * Phase R4: OpenRouter and Anthropic are supported.
 */
export function createProviderClient(config: RuntimeConfig): ProviderClient {
  switch (config.provider.name) {
    case 'openrouter':
      return new OpenRouterProviderClient(config);
    case 'anthropic':
      return new AnthropicProviderClient(config);
    default:
      throw new Error(
        `Unsupported provider: "${config.provider.name}". Supported: "openrouter", "anthropic".`,
      );
  }
}

// ---------------------------------------------------------------------------
// OpenRouter Provider Client
// ---------------------------------------------------------------------------

/**
 * OpenRouter provider client.
 * Uses native fetch() to call OpenRouter's OpenAI-compatible API.
 * Phase R4: Full tool support with tool_choice and tool result messages.
 */
class OpenRouterProviderClient implements ProviderClient {
  private readonly apiKey: string;
  private readonly config: RuntimeConfig;

  constructor(config: RuntimeConfig) {
    this.config = config;

    const envVarName = config.provider.apiKeyEnvVar;
    const key = process.env[envVarName];
    if (!key) {
      throw new Error(
        `API key not found. Set the environment variable "${envVarName}" with your OpenRouter API key.`,
      );
    }
    this.apiKey = key;
  }

  async chat(options: ProviderChatOptions): Promise<ProviderResponse> {
    const hasTools = options.tools && options.tools.length > 0;

    // Build request body
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages.map((m) => serializeOpenRouterMessage(m)),
      stream: false,
    };

    // Include tools if provided (Phase R4)
    if (hasTools) {
      body.tools = options.tools!.map((t) => serializeOpenRouterTool(t));
      body.tool_choice = 'auto';
    }

    const response = await fetchWithRetry(
      OPENROUTER_API_URL,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/zam-context-plane',
          'X-Title': 'ZAM Runtime',
        },
        body: JSON.stringify(body),
      },
      'OpenRouter',
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenRouter API error (HTTP ${response.status}): ${errorBody}`,
      );
    }

    const data = await response.json() as OpenRouterChatResponse;

    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('OpenRouter returned no choices in response.');
    }

    const message = choice.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      return {
        type: 'tool_call',
        toolCalls: message.tool_calls.map((tc) => ({
          toolName: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          callId: tc.id,
        })),
        usage: data.usage
          ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
          : undefined,
        rawResponse: data,
      };
    }

    return {
      type: 'text',
      text: message.content ?? '',
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
      rawResponse: data,
    };
  }
}

/**
 * Serialize a ProviderMessage into OpenAI-compatible format.
 * Per OpenAI spec: tool result messages use role 'tool' with 'tool_call_id'.
 */
function serializeOpenRouterMessage(m: ProviderMessage): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    role: m.role,
    content: m.content,
  };
  // tool result messages carry tool_call_id for correlation
  if (m.role === 'tool' && m.toolCallId) {
    msg.tool_call_id = m.toolCallId;
  }
  // assistant messages with tool calls must include the tool_calls array
  // so the provider can correlate subsequent tool result messages.
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    msg.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.callId,
      type: 'function',
      function: {
        name: tc.toolName,
        arguments: JSON.stringify(tc.arguments),
      },
    }));
  }
  return msg;
}

/**
 * Serialize a tool definition into OpenAI-compatible function calling format.
 */
function serializeOpenRouterTool(t: ProviderToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic Provider Client
// ---------------------------------------------------------------------------

/**
 * Anthropic provider client.
 * Calls the direct Anthropic Messages API.
 * Phase R4: Supports cache advisory translation via cache_control blocks.
 *
 * Key Anthropic API differences from OpenAI:
 * - System message is a top-level field, not a message in the array.
 * - Tool definitions use input_schema instead of parameters.
 * - Tool results use tool_use_id for correlation.
 * - Cache hints are translated to cache_control: { type: "ephemeral" } blocks.
 */
class AnthropicProviderClient implements ProviderClient {
  private readonly apiKey: string;
  private readonly config: RuntimeConfig;

  constructor(config: RuntimeConfig) {
    this.config = config;

    const envVarName = config.provider.apiKeyEnvVar;
    const key = process.env[envVarName];
    if (!key) {
      throw new Error(
        `API key not found. Set the environment variable "${envVarName}" with your Anthropic API key.`,
      );
    }
    this.apiKey = key;
  }

  async chat(options: ProviderChatOptions): Promise<ProviderResponse> {
    const hasTools = options.tools && options.tools.length > 0;

    // Separate system messages from conversation messages
    const { systemBlocks, conversationMessages } = partitionAnthropicMessages(
      options.messages,
      options.cacheHints,
    );

    // Build request body
    const body: Record<string, unknown> = {
      model: options.model,
      messages: conversationMessages,
      max_tokens: 8192,
    };

    // System messages are a top-level field in Anthropic API
    if (systemBlocks.length > 0) {
      body.system = systemBlocks;
    }

    // Include tools if provided
    if (hasTools) {
      body.tools = options.tools!.map((t) => serializeAnthropicTool(t));
    }

    const response = await fetchWithRetry(
      ANTHROPIC_API_URL,
      {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'content-type': 'application/json',
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(body),
      },
      'Anthropic',
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Anthropic API error (HTTP ${response.status}): ${errorBody}`,
      );
    }

    const data = await response.json() as AnthropicResponse;

    return parseAnthropicResponse(data);
  }
}

/**
 * Partition our generic ProviderMessages into Anthropic's expected format:
 * - system messages → top-level system blocks (with optional cache_control)
 * - user/assistant/tool messages → conversation messages
 *
 * Cache hint translation:
 * - 'stable' hints on system messages → cache_control: { type: "ephemeral" }
 *   (placed on the last stable system block to maximize cache reuse)
 * - 'session' hints → cache_control: { type: "ephemeral" } on last session block
 * - 'volatile' hints → no cache_control (always recomputed)
 */
function partitionAnthropicMessages(
  messages: ProviderMessage[],
  cacheHints?: CacheHint[],
): {
  systemBlocks: AnthropicSystemBlock[];
  conversationMessages: AnthropicConversationMessage[];
} {
  const systemBlocks: AnthropicSystemBlock[] = [];
  const conversationMessages: AnthropicConversationMessage[] = [];

  // Build a hint lookup by message index
  const hintMap = new Map<number, CacheHint>();
  if (cacheHints) {
    for (const hint of cacheHints) {
      hintMap.set(hint.messageIndex, hint);
    }
  }

  // Find the last index of each cache stability tier for cache_control placement
  let lastStableSystemIdx = -1;
  let lastSessionSystemIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'system') {
      const hint = hintMap.get(i);
      if (hint?.stability === 'stable') lastStableSystemIdx = systemBlocks.length;
      if (hint?.stability === 'session') lastSessionSystemIdx = systemBlocks.length;
      systemBlocks.push({ type: 'text', text: messages[i].content });
    }
  }

  // Apply cache_control to the last stable and session system blocks
  if (lastStableSystemIdx >= 0 && lastStableSystemIdx < systemBlocks.length) {
    systemBlocks[lastStableSystemIdx].cache_control = { type: 'ephemeral' };
  }
  if (lastSessionSystemIdx >= 0 && lastSessionSystemIdx < systemBlocks.length) {
    systemBlocks[lastSessionSystemIdx].cache_control = { type: 'ephemeral' };
  }

  // Build conversation messages (non-system)
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      // Anthropic uses tool_result content blocks with tool_use_id
      conversationMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          },
        ],
      });
    } else {
      // user/assistant messages
      const convMsg: AnthropicConversationMessage = {
        role: m.role as 'user' | 'assistant',
        content: m.content,
      };

      // Assistant messages with tool calls must use content blocks format
      // so Anthropic can correlate subsequent tool_result blocks.
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: AnthropicMessageContentBlock[] = [];
        if (m.content) {
          blocks.push({ type: 'text', text: m.content });
        }
        for (const tc of m.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.callId,
            name: tc.toolName,
            input: tc.arguments,
          });
        }
        convMsg.content = blocks;
      } else {
        // Apply cache_control to non-system messages with stable/session hints
        const hint = hintMap.get(i);
        if (hint && (hint.stability === 'stable' || hint.stability === 'session')) {
          convMsg.content = [
            {
              type: 'text',
              text: m.content,
              cache_control: { type: 'ephemeral' },
            },
          ];
        }
      }
      conversationMessages.push(convMsg);
    }
  }

  return { systemBlocks, conversationMessages };
}

/**
 * Serialize a tool definition into Anthropic's format.
 * Anthropic uses input_schema instead of parameters.
 */
function serializeAnthropicTool(t: ProviderToolDefinition): Record<string, unknown> {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  };
}

/**
 * Parse Anthropic's response into our ProviderResponse shape.
 */
function parseAnthropicResponse(data: AnthropicResponse): ProviderResponse {
  const contentBlocks = data.content ?? [];

  // Check for tool_use blocks
  const toolUseBlocks = contentBlocks.filter(
    (b): b is AnthropicToolUseBlock => b.type === 'tool_use'
  );

  if (toolUseBlocks.length > 0) {
    return {
      type: 'tool_call',
      toolCalls: toolUseBlocks.map((b) => ({
        toolName: b.name,
        arguments: b.input as Record<string, unknown>,
        callId: b.id,
      })),
      usage: data.usage
        ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
        : undefined,
      rawResponse: data,
    };
  }

  // Text response — concatenate text blocks
  const textBlocks = contentBlocks.filter(
    (b): b is AnthropicTextBlock => b.type === 'text'
  );
  const text = textBlocks.map((b) => b.text).join('');

  return {
    type: 'text',
    text,
    usage: data.usage
      ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
      : undefined,
    rawResponse: data,
  };
}

// ---------------------------------------------------------------------------
// OpenRouter / OpenAI-compatible response types (internal)
// ---------------------------------------------------------------------------

interface OpenRouterChatResponse {
  choices?: Array<{
    message: {
      role: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Anthropic response types (internal)
// ---------------------------------------------------------------------------

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicConversationMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicMessageContentBlock[];
}

type AnthropicMessageContentBlock =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
