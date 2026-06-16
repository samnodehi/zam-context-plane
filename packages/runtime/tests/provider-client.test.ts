// ============================================================================
// Tests — Provider Client (Phase R5: Multi-provider with retries)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProviderClient } from '../src/provider-client.js';
import type { ProviderClient, RuntimeConfig, ProviderChatOptions } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(providerName = 'openrouter', envVar = 'TEST_API_KEY'): RuntimeConfig {
  return {
    zam: { endpoint: 'library' },
    provider: { name: providerName, model: 'test-model', apiKeyEnvVar: envVar },
    workspace: { mode: 'local', rootPath: './' },
    loop: { maxTurns: 10, timeoutMs: 300000 },
    eventStream: { persistPath: './test-sessions' },
  };
}

function mockFetchResponse(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
}

function mockFetchError(errorBody: string, status = 500): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => errorBody,
    json: async () => ({}),
  }));
}

function getLastFetchBody(): Record<string, unknown> {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(lastCall[1].body as string);
}

function getLastFetchUrl(): string {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return lastCall[0] as string;
}

function getLastFetchHeaders(): Record<string, string> {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return lastCall[1].headers as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe('createProviderClient', () => {
  beforeEach(() => {
    process.env.TEST_API_KEY = 'test-key-123';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TEST_API_KEY;
  });

  it('should create OpenRouter client', () => {
    const client = createProviderClient(makeConfig('openrouter'));
    expect(client).toBeDefined();
    expect(typeof client.chat).toBe('function');
  });

  it('should create Anthropic client', () => {
    const client = createProviderClient(makeConfig('anthropic'));
    expect(client).toBeDefined();
    expect(typeof client.chat).toBe('function');
  });

  it('should throw for unsupported provider', () => {
    expect(() => createProviderClient(makeConfig('gemini')))
      .toThrow('Unsupported provider: "gemini"');
  });

  it('should throw if API key env var is not set', () => {
    delete process.env.TEST_API_KEY;
    expect(() => createProviderClient(makeConfig('openrouter')))
      .toThrow('API key not found');
  });

  it('should throw if Anthropic API key env var is not set', () => {
    delete process.env.TEST_API_KEY;
    expect(() => createProviderClient(makeConfig('anthropic')))
      .toThrow('API key not found');
  });
});

// ---------------------------------------------------------------------------
// OpenRouter tests
// ---------------------------------------------------------------------------

describe('OpenRouterProviderClient', () => {
  let client: ProviderClient;

  beforeEach(() => {
    process.env.TEST_API_KEY = 'test-key-123';
    client = createProviderClient(makeConfig('openrouter'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TEST_API_KEY;
  });

  it('should send text request and return text response', async () => {
    mockFetchResponse({
      choices: [{
        message: { role: 'assistant', content: 'Hello!' },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'test-model',
    });

    expect(result.type).toBe('text');
    expect(result.text).toBe('Hello!');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('should send to correct URL with correct headers', async () => {
    mockFetchResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });

    await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    });

    expect(getLastFetchUrl()).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = getLastFetchHeaders();
    expect(headers['Authorization']).toBe('Bearer test-key-123');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('should include tools in request body when provided', async () => {
    mockFetchResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });

    await client.chat({
      messages: [{ role: 'user', content: 'Read the file' }],
      tools: [
        { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
      ],
      model: 'test-model',
    });

    const body = getLastFetchBody();
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ]);
  });

  it('should NOT include tool_choice when no tools provided', async () => {
    mockFetchResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });

    await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    });

    const body = getLastFetchBody();
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });

  it('should serialize tool result messages with tool_call_id', async () => {
    mockFetchResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });

    await client.chat({
      messages: [
        { role: 'user', content: 'Read test.txt' },
        { role: 'tool', content: 'file contents here', toolCallId: 'tc-123' },
      ],
      model: 'test-model',
    });

    const body = getLastFetchBody();
    const msgs = body.messages as Array<Record<string, unknown>>;
    expect(msgs[1].role).toBe('tool');
    expect(msgs[1].tool_call_id).toBe('tc-123');
    expect(msgs[1].content).toBe('file contents here');
  });

  it('should parse tool_call response', async () => {
    mockFetchResponse({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'call-abc',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"test.txt"}' },
          }],
        },
      }],
    });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'Read file' }],
      model: 'test-model',
    });

    expect(result.type).toBe('tool_call');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].toolName).toBe('read_file');
    expect(result.toolCalls![0].arguments).toEqual({ path: 'test.txt' });
    expect(result.toolCalls![0].callId).toBe('call-abc');
  });

  it('should throw on non-retryable API error', async () => {
    mockFetchError('Bad request', 400);

    await expect(client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    })).rejects.toThrow('OpenRouter API error (HTTP 400)');
  });

  it('should throw when no choices in response', async () => {
    mockFetchResponse({ choices: [] });

    await expect(client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    })).rejects.toThrow('OpenRouter returned no choices');
  });

  it('should handle response without usage', async () => {
    mockFetchResponse({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    });

    expect(result.usage).toBeUndefined();
  });

  it('should retry on 429 and eventually throw after max retries', async () => {
    // Mock fetch to always return 429
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
        json: async () => ({}),
      };
    }));

    await expect(client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    })).rejects.toThrow('OpenRouter API error (HTTP 429)');

    // Should have been called 4 times (1 initial + 3 retries)
    expect(callCount).toBe(4);
  }, 30000);

  it('should retry on 500 and succeed on retry', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'recovered' } }],
        }),
      };
    }));

    const result = await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    });

    expect(result.type).toBe('text');
    expect(result.text).toBe('recovered');
    expect(callCount).toBe(2);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Anthropic tests
// ---------------------------------------------------------------------------

describe('AnthropicProviderClient', () => {
  let client: ProviderClient;

  beforeEach(() => {
    process.env.TEST_API_KEY = 'test-anthropic-key';
    client = createProviderClient(makeConfig('anthropic'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TEST_API_KEY;
  });

  it('should send to correct Anthropic URL with correct headers', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'test-model',
    });

    expect(getLastFetchUrl()).toBe('https://api.anthropic.com/v1/messages');
    const headers = getLastFetchHeaders();
    expect(headers['x-api-key']).toBe('test-anthropic-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('should return text response', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'The answer is 42.' }],
      model: 'test-model',
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'What is the answer?' }],
      model: 'test-model',
    });

    expect(result.type).toBe('text');
    expect(result.text).toBe('The answer is 42.');
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it('should extract system messages into top-level system field', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'test-model',
    });

    const body = getLastFetchBody();
    expect(body.system).toEqual([{ type: 'text', text: 'You are a helpful assistant.' }]);
    // Messages should NOT contain system messages
    const msgs = body.messages as Array<Record<string, unknown>>;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('should apply cache_control to last stable system block', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [
        { role: 'system', content: 'Stable system prompt 1' },
        { role: 'system', content: 'Stable system prompt 2' },
        { role: 'system', content: 'Volatile system prompt' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'test-model',
      cacheHints: [
        { messageIndex: 0, stability: 'stable' },
        { messageIndex: 1, stability: 'stable' },
        { messageIndex: 2, stability: 'volatile' },
      ],
    });

    const body = getLastFetchBody();
    const system = body.system as Array<Record<string, unknown>>;

    // First stable block: no cache_control
    expect(system[0]).toEqual({ type: 'text', text: 'Stable system prompt 1' });
    // Last stable block: cache_control applied
    expect(system[1]).toEqual({
      type: 'text',
      text: 'Stable system prompt 2',
      cache_control: { type: 'ephemeral' },
    });
    // Volatile block: no cache_control
    expect(system[2]).toEqual({ type: 'text', text: 'Volatile system prompt' });
  });

  it('should apply cache_control to last session system block', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [
        { role: 'system', content: 'Stable content' },
        { role: 'system', content: 'Session content' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'test-model',
      cacheHints: [
        { messageIndex: 0, stability: 'stable' },
        { messageIndex: 1, stability: 'session' },
      ],
    });

    const body = getLastFetchBody();
    const system = body.system as Array<Record<string, unknown>>;

    // Stable block gets cache_control
    expect(system[0]).toEqual({
      type: 'text',
      text: 'Stable content',
      cache_control: { type: 'ephemeral' },
    });
    // Session block gets cache_control
    expect(system[1]).toEqual({
      type: 'text',
      text: 'Session content',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('should NOT include system field when no system messages exist', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'test-model',
    });

    const body = getLastFetchBody();
    expect(body.system).toBeUndefined();
  });

  it('should include tools in Anthropic format (input_schema)', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [{ role: 'user', content: 'Read file' }],
      tools: [
        { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
      ],
      model: 'test-model',
    });

    const body = getLastFetchBody();
    expect(body.tools).toEqual([
      {
        name: 'read_file',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
  });

  it('should parse tool_use response', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_abc123',
          name: 'read_file',
          input: { path: 'test.txt' },
        },
      ],
      model: 'test-model',
    });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'Read file' }],
      model: 'test-model',
    });

    expect(result.type).toBe('tool_call');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].toolName).toBe('read_file');
    expect(result.toolCalls![0].arguments).toEqual({ path: 'test.txt' });
    expect(result.toolCalls![0].callId).toBe('toolu_abc123');
  });

  it('should serialize tool result messages as tool_result content blocks', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'I see the file.' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [
        { role: 'user', content: 'Read test.txt' },
        { role: 'tool', content: 'file contents here', toolCallId: 'toolu_abc' },
      ],
      model: 'test-model',
    });

    const body = getLastFetchBody();
    const msgs = body.messages as Array<Record<string, unknown>>;

    // Tool result should be role 'user' with tool_result content block
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_abc',
        content: 'file contents here',
      },
    ]);
  });

  it('should throw on non-retryable Anthropic API error', async () => {
    mockFetchError('Forbidden', 403);

    await expect(client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    })).rejects.toThrow('Anthropic API error (HTTP 403)');
  });

  it('should handle multiple text blocks', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Part 1. ' },
        { type: 'text', text: 'Part 2.' },
      ],
      model: 'test-model',
    });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    });

    expect(result.type).toBe('text');
    expect(result.text).toBe('Part 1. Part 2.');
  });

  it('should handle response without usage', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
    });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    });

    expect(result.usage).toBeUndefined();
  });

  it('should set max_tokens in Anthropic request', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    });

    const body = getLastFetchBody();
    expect(body.max_tokens).toBe(8192);
  });

  it('should apply cache_control to non-system stable user messages', async () => {
    mockFetchResponse({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
    });

    await client.chat({
      messages: [
        { role: 'user', content: 'Stable user context' },
        { role: 'user', content: 'Volatile question' },
      ],
      model: 'test-model',
      cacheHints: [
        { messageIndex: 0, stability: 'stable' },
        { messageIndex: 1, stability: 'volatile' },
      ],
    });

    const body = getLastFetchBody();
    const msgs = body.messages as Array<Record<string, unknown>>;

    // Stable user message gets cache_control content block
    expect(msgs[0].content).toEqual([
      {
        type: 'text',
        text: 'Stable user context',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    // Volatile user message stays as plain string
    expect(msgs[1].content).toBe('Volatile question');
  });

  it('should retry on 529 and eventually throw after max retries', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 529,
        text: async () => 'Overloaded',
        json: async () => ({}),
      };
    }));

    await expect(client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    })).rejects.toThrow('Anthropic API error (HTTP 529)');

    // Should have been called 4 times (1 initial + 3 retries)
    expect(callCount).toBe(4);
  }, 30000);

  it('should retry on 429 and succeed on retry', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => 'Rate limited',
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'recovered' }],
          model: 'test-model',
        }),
      };
    }));

    const result = await client.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'test-model',
    });

    expect(result.type).toBe('text');
    expect(result.text).toBe('recovered');
    expect(callCount).toBe(2);
  }, 30000);
});
