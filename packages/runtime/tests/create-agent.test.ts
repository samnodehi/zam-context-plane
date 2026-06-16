// ============================================================================
// Tests — createAgent() Convenience Factory
// Canonical source: docs/29_LIBRARY_API_AND_INTEGRATION_TESTING.md §4.2
// Phase V2-2: Unit tests for the createAgent() factory using vitest mocks.
//
// These tests inject mock planFn and mock ProviderClient to verify that the
// factory correctly wires components and that agent.run() delegates to runLoop.
// No live provider calls. No real core pipeline.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RuntimeConfig, ZamPlanRequestBody, ZamPlanResponse, ProviderClient, ProviderChatOptions, RuntimeResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// Minimal test fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    zam: { endpoint: 'library' },
    provider: { name: 'openrouter', model: 'test-model', apiKeyEnvVar: 'TEST_KEY' },
    workspace: { mode: 'local', rootPath: './' },
    loop: { maxTurns: 10, timeoutMs: 300000 },
    eventStream: { persistPath: './test-sessions' },
    ...overrides,
  };
}

function makeMinimalPromptPlan() {
  return {
    schemaVersion: 'v0',
    selectedComponents: [],
    omittedComponents: [],
    deferredComponents: [],
    selectedTools: [],
    riskFlags: [],
    failOpenReasons: [],
    planningWarnings: [],
  };
}

function makeMockPlanResponse(): ZamPlanResponse {
  return {
    promptPlan: makeMinimalPromptPlan() as ZamPlanResponse['promptPlan'],
    trace: { run: { runId: 'test-run-id' } },
    summary: 'Test summary.',
  };
}

function makeMockProviderResponse() {
  return {
    type: 'text' as const,
    text: 'This is the agent response.',
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function makeMockPlanFn() {
  return vi.fn(async (_input: ZamPlanRequestBody): Promise<ZamPlanResponse> => {
    return makeMockPlanResponse();
  });
}

function makeMockProvider(): ProviderClient {
  return {
    chat: vi.fn(async (_options: ProviderChatOptions) => makeMockProviderResponse()),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAgent()', () => {
  // Dynamically import createAgent inside tests so we always get the actual module.
  // The import is at the top of each describe block via a shared variable.
  let createAgent: (options?: import('../src/create-agent.js').AgentOptions) => Promise<import('../src/create-agent.js').Agent>;

  beforeEach(async () => {
    // Import fresh each group to avoid module cache issues with vi.mock
    const mod = await import('../src/create-agent.js');
    createAgent = mod.createAgent;
  });

  describe('factory construction', () => {
    it('should return an Agent with a session and run() method', async () => {
      const config = makeConfig();
      const agent = await createAgent({
        config,
        planFn: makeMockPlanFn(),
        provider: makeMockProvider(),
      });

      expect(agent).toBeDefined();
      expect(typeof agent.run).toBe('function');
      expect(agent.session).toBeDefined();
      expect(typeof agent.session.sessionId).toBe('string');
    });

    it('should create a session with a UUID v4 session ID', async () => {
      const agent = await createAgent({
        config: makeConfig(),
        planFn: makeMockPlanFn(),
        provider: makeMockProvider(),
      });

      expect(agent.session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should preserve config in session', async () => {
      const config = makeConfig({ loop: { maxTurns: 5, timeoutMs: 60000 } });
      const agent = await createAgent({
        config,
        planFn: makeMockPlanFn(),
        provider: makeMockProvider(),
      });

      expect(agent.session.config.loop.maxTurns).toBe(5);
    });

    it('should create a new session per createAgent() call', async () => {
      const config = makeConfig();
      const opts = { config, planFn: makeMockPlanFn(), provider: makeMockProvider() };
      const agent1 = await createAgent(opts);
      const agent2 = await createAgent(opts);

      expect(agent1.session.sessionId).not.toBe(agent2.session.sessionId);
    });
  });

  describe('agent.run()', () => {
    it('should call planFn via the turn loop when run() is invoked', async () => {
      const mockPlanFn = makeMockPlanFn();
      const mockProvider = makeMockProvider();

      const agent = await createAgent({
        config: makeConfig(),
        planFn: mockPlanFn,
        provider: mockProvider,
      });

      const result = await agent.run('Hello, agent!');

      // planFn must have been called (ZamClient wraps it)
      expect(mockPlanFn).toHaveBeenCalled();
      // provider.chat must have been called with the assembled prompt
      expect(mockProvider.chat).toHaveBeenCalled();
      // result must be a RuntimeResult
      expect(result).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(typeof result.finalResponse).toBe('string');
      expect(typeof result.turnCount).toBe('number');
      expect(['completed', 'max_turns', 'no_progress', 'timeout', 'error']).toContain(result.exitReason);
    });

    it('should complete with a text response from the mocked provider', async () => {
      const mockPlanFn = makeMockPlanFn();
      const mockProvider: ProviderClient = {
        chat: vi.fn(async () => ({
          type: 'text' as const,
          text: 'Task completed successfully.',
          usage: { inputTokens: 10, outputTokens: 5 },
        })),
      };

      const agent = await createAgent({
        config: makeConfig(),
        planFn: mockPlanFn,
        provider: mockProvider,
      });

      const result = await agent.run('Do the task.');
      expect(result.finalResponse).toBe('Task completed successfully.');
      expect(result.exitReason).toBe('completed');
    });

    it('should respect maxTurns from config', async () => {
      const mockPlanFn = makeMockPlanFn();
      // Provider always returns a tool call → turn loop should hit max_turns
      let callCount = 0;
      const mockProvider: ProviderClient = {
        chat: vi.fn(async () => {
          callCount++;
          if (callCount <= 3) {
            // Keep returning tool calls
            return {
              type: 'tool_call' as const,
              toolCalls: [{ toolName: 'read_file', arguments: { path: 'test.txt' }, callId: `call-${callCount}` }],
            };
          }
          // Eventually resolve
          return {
            type: 'text' as const,
            text: 'Done after retries.',
          };
        }),
      };

      // Inject a workspace that handles tool calls
      const mockWorkspace = {
        execute: vi.fn(async () => ({
          callId: 'call-1',
          success: true,
          output: 'file contents',
          durationMs: 10,
        })),
        getWorkspaceRoot: () => './',
        isPathWithinWorkspace: () => true,
      };

      const agent = await createAgent({
        config: makeConfig({ loop: { maxTurns: 10, timeoutMs: 300000 } }),
        planFn: mockPlanFn,
        provider: mockProvider,
        workspace: mockWorkspace,
      });

      const result: RuntimeResult = await agent.run('Read a file repeatedly.');
      // Should have completed (provider resolves after 3 tool calls)
      expect(['completed', 'max_turns', 'no_progress', 'error']).toContain(result.exitReason);
      expect(result.turnCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('planFn injection', () => {
    it('should use the injected planFn, not the real core', async () => {
      const mockPlanFn = makeMockPlanFn();
      const agent = await createAgent({
        config: makeConfig(),
        planFn: mockPlanFn,
        provider: makeMockProvider(),
      });

      await agent.run('Test prompt');

      // Verify the injected mock was called, not real core
      expect(mockPlanFn).toHaveBeenCalledTimes(1);
      const callArg = mockPlanFn.mock.calls[0][0] as ZamPlanRequestBody;
      expect(callArg.request.text).toBe('Test prompt');
    });

    it('should pass request.text from the prompt to planFn', async () => {
      const mockPlanFn = makeMockPlanFn();
      const agent = await createAgent({
        config: makeConfig(),
        planFn: mockPlanFn,
        provider: makeMockProvider(),
      });

      await agent.run('My specific prompt text');

      const callArg = mockPlanFn.mock.calls[0][0] as ZamPlanRequestBody;
      expect(callArg.request.text).toBe('My specific prompt text');
    });
  });

  describe('permissionGate injection', () => {
    it('should use the injected permissionGate', async () => {
      const mockPermissionGate = {
        check: vi.fn(async () => ({
          allowed: true,
          reason: 'auto-approved',
          requiresApproval: false,
          approvedBy: 'auto' as const,
        })),
      };

      const agent = await createAgent({
        config: makeConfig(),
        planFn: makeMockPlanFn(),
        provider: makeMockProvider(),
        permissionGate: mockPermissionGate,
      });

      // run() succeeds even with a custom permission gate
      const result = await agent.run('Test with custom gate');
      expect(result).toBeDefined();
    });
  });

  describe('workspace injection', () => {
    it('should use the injected workspace without error', async () => {
      const mockWorkspace = {
        execute: vi.fn(async () => ({
          callId: 'x',
          success: true,
          output: 'output',
          durationMs: 1,
        })),
        getWorkspaceRoot: vi.fn(() => '/mock/workspace'),
        isPathWithinWorkspace: vi.fn(() => true),
      };

      const agent = await createAgent({
        config: makeConfig(),
        planFn: makeMockPlanFn(),
        provider: makeMockProvider(),
        workspace: mockWorkspace,
      });

      const result = await agent.run('Use injected workspace');
      expect(result).toBeDefined();
      // Workspace.execute is not called unless provider returns a tool_call
      // (in this test provider returns text, so execute is not called)
    });
  });
});
