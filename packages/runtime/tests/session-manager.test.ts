// ============================================================================
// Tests — Session Manager
// ============================================================================

import { describe, it, expect } from 'vitest';
import { createSession } from '../src/session-manager.js';
import type { RuntimeConfig } from '../src/types.js';

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

describe('createSession', () => {
  it('should generate a unique UUID v4 session ID', () => {
    const config = makeConfig();
    const session = createSession(config);

    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should generate different IDs for different sessions', () => {
    const config = makeConfig();
    const s1 = createSession(config);
    const s2 = createSession(config);

    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  it('should initialize turnCounter to 0', () => {
    const session = createSession(makeConfig());
    expect(session.turnCounter).toBe(0);
  });

  it('should set a valid ISO 8601 startedAt timestamp', () => {
    const session = createSession(makeConfig());
    expect(new Date(session.startedAt).toISOString()).toBe(session.startedAt);
  });

  it('should create EventStream at correct path', () => {
    const config = makeConfig({ eventStream: { persistPath: '/tmp/my-sessions' } });
    const session = createSession(config);

    const expectedPathPart = `/tmp/my-sessions/${session.sessionId}/events.jsonl`;
    // Normalize path separators for cross-platform
    const normalizedPath = session.eventStream.getFilePath().replace(/\\/g, '/');
    expect(normalizedPath).toContain(expectedPathPart.replace(/\\/g, '/'));
  });

  it('should preserve config reference', () => {
    const config = makeConfig();
    const session = createSession(config);
    expect(session.config).toBe(config);
  });
});
