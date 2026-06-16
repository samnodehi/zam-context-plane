// ============================================================================
// Tests — Permission Gate
// ============================================================================

import { describe, it, expect } from 'vitest';
import { LocalPermissionGate } from '../src/permission-gate.js';
import type { ToolAction, Session, RuntimeConfig } from '../src/types.js';
import { EventStream } from '../src/event-stream.js';

// Minimal mock session for tests
function createMockSession(): Session {
  return {
    sessionId: 'test-session',
    turnCounter: 0,
    startedAt: new Date().toISOString(),
    eventStream: new EventStream('/dev/null'),
    config: {
      zam: { endpoint: 'library' },
      provider: { name: 'openrouter', model: 'test', apiKeyEnvVar: 'TEST' },
      workspace: { mode: 'local', rootPath: '.' },
      loop: { maxTurns: 10, timeoutMs: 300000 },
      eventStream: { persistPath: './sessions' },
    } as RuntimeConfig,
  };
}

function action(toolName: string): ToolAction {
  return { toolName, arguments: {}, callId: `call-${toolName}` };
}

describe('LocalPermissionGate', () => {
  // -------------------------------------------------------------------------
  // Category mapping
  // -------------------------------------------------------------------------

  describe('getCategory', () => {
    it('maps read_file to read_only', () => {
      const gate = new LocalPermissionGate();
      expect(gate.getCategory('read_file')).toBe('read_only');
    });

    it('maps list_dir to read_only', () => {
      const gate = new LocalPermissionGate();
      expect(gate.getCategory('list_dir')).toBe('read_only');
    });

    it('maps grep_search to read_only', () => {
      const gate = new LocalPermissionGate();
      expect(gate.getCategory('grep_search')).toBe('read_only');
    });

    it('maps write_file to file_write', () => {
      const gate = new LocalPermissionGate();
      expect(gate.getCategory('write_file')).toBe('file_write');
    });

    it('maps shell_exec to shell_exec', () => {
      const gate = new LocalPermissionGate();
      expect(gate.getCategory('shell_exec')).toBe('shell_exec');
    });

    it('maps unknown tools to destructive', () => {
      const gate = new LocalPermissionGate();
      expect(gate.getCategory('rm')).toBe('destructive');
      expect(gate.getCategory('drop_database')).toBe('destructive');
    });
  });

  // -------------------------------------------------------------------------
  // Default policies
  // -------------------------------------------------------------------------

  describe('default policies', () => {
    it('auto-approves read_only tools', async () => {
      const gate = new LocalPermissionGate();
      const session = createMockSession();

      const result = await gate.check(action('read_file'), session);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.approvedBy).toBe('auto');
    });

    it('auto-approves file_write tools', async () => {
      const gate = new LocalPermissionGate();
      const session = createMockSession();

      const result = await gate.check(action('write_file'), session);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.approvedBy).toBe('auto');
    });

    it('denies shell_exec without approval callback', async () => {
      const gate = new LocalPermissionGate();
      const session = createMockSession();

      const result = await gate.check(action('shell_exec'), session);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('no approval callback');
    });

    it('denies unknown tools without approval callback', async () => {
      const gate = new LocalPermissionGate();
      const session = createMockSession();

      const result = await gate.check(action('rm'), session);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Approval callback
  // -------------------------------------------------------------------------

  describe('approval callback', () => {
    it('approves shell_exec when callback returns true', async () => {
      const gate = new LocalPermissionGate({
        approvalCallback: async () => true,
      });
      const session = createMockSession();

      const result = await gate.check(action('shell_exec'), session);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvedBy).toBe('user');
    });

    it('denies shell_exec when callback returns false', async () => {
      const gate = new LocalPermissionGate({
        approvalCallback: async () => false,
      });
      const session = createMockSession();

      const result = await gate.check(action('shell_exec'), session);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('User denied');
    });
  });

  // -------------------------------------------------------------------------
  // Policy overrides
  // -------------------------------------------------------------------------

  describe('policy overrides', () => {
    it('can override shell_exec to auto_approve', async () => {
      const gate = new LocalPermissionGate({
        policyOverrides: { shell_exec: 'auto_approve' },
      });
      const session = createMockSession();

      const result = await gate.check(action('shell_exec'), session);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.approvedBy).toBe('auto');
    });

    it('can override file_write to require_approval', async () => {
      const gate = new LocalPermissionGate({
        policyOverrides: { file_write: 'require_approval' },
      });
      const session = createMockSession();

      // Without callback, this should be denied
      const result = await gate.check(action('write_file'), session);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });
});
