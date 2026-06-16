// ============================================================================
// Tests — Docker Workspace
// Phase R5
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDockerWorkspace } from '../src/docker-workspace.js';
import * as childProcess from 'node:child_process';

// Mock child_process.execFile
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(childProcess.execFile);

describe('DockerWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const config = {
    containerName: 'zam-sandbox',
    workspaceRoot: '/workspace',
    execTimeoutMs: 5000,
  };

  it('returns workspace root from config', () => {
    const ws = createDockerWorkspace(config);
    expect(ws.getWorkspaceRoot()).toBe('/workspace');
  });

  it('validates paths within workspace', () => {
    const ws = createDockerWorkspace(config);
    expect(ws.isPathWithinWorkspace('/workspace/src/file.ts')).toBe(true);
    expect(ws.isPathWithinWorkspace('/workspace')).toBe(true);
  });

  it('rejects paths outside workspace', () => {
    const ws = createDockerWorkspace(config);
    expect(ws.isPathWithinWorkspace('/etc/passwd')).toBe(false);
  });

  it('executes read_file via docker exec cat', async () => {
    const ws = createDockerWorkspace(config);

    // Mock successful docker exec
    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, 'file contents here', '');
      return {} as any;
    });

    const result = await ws.execute({
      toolName: 'read_file',
      arguments: { path: '/workspace/src/main.ts' },
      callId: 'call-1',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('file contents here');
    expect(result.callId).toBe('call-1');

    // Verify docker exec was called with correct args
    expect(mockedExecFile).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['exec', 'zam-sandbox']),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('rejects read_file outside workspace root', async () => {
    const ws = createDockerWorkspace(config);

    await expect(
      ws.execute({
        toolName: 'read_file',
        arguments: { path: '/etc/passwd' },
        callId: 'call-2',
      }),
    ).rejects.toThrow('outside the workspace root');
  });

  it('handles docker exec failures', async () => {
    const ws = createDockerWorkspace(config);

    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      const error: any = new Error('container not running');
      error.stderr = 'Error: No such container';
      (callback as Function)(error, '', 'Error: No such container');
      return {} as any;
    });

    const result = await ws.execute({
      toolName: 'read_file',
      arguments: { path: '/workspace/file.txt' },
      callId: 'call-3',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No such container');
  });

  it('executes list_dir via docker exec ls', async () => {
    const ws = createDockerWorkspace(config);

    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, 'file1.ts\nfile2.ts\n', '');
      return {} as any;
    });

    const result = await ws.execute({
      toolName: 'list_dir',
      arguments: { path: '/workspace/src' },
      callId: 'call-4',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('file1.ts');
  });

  it('executes grep_search via docker exec grep', async () => {
    const ws = createDockerWorkspace(config);

    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, '/workspace/src/main.ts:5:const foo = 42;', '');
      return {} as any;
    });

    const result = await ws.execute({
      toolName: 'grep_search',
      arguments: { pattern: 'foo', path: '/workspace/src' },
      callId: 'call-5',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('foo');
  });

  it('executes shell_exec via docker exec sh -c', async () => {
    const ws = createDockerWorkspace(config);

    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, 'build complete', '');
      return {} as any;
    });

    const result = await ws.execute({
      toolName: 'shell_exec',
      arguments: { command: 'npm run build' },
      callId: 'call-6',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('build complete');
  });

  it('throws for unsupported tool names', async () => {
    const ws = createDockerWorkspace(config);

    await expect(
      ws.execute({
        toolName: 'unknown_tool',
        arguments: {},
        callId: 'call-7',
      }),
    ).rejects.toThrow('Unsupported tool');
  });

  it('includes stderr in output when present', async () => {
    const ws = createDockerWorkspace(config);

    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, 'stdout data', 'stderr warning');
      return {} as any;
    });

    const result = await ws.execute({
      toolName: 'read_file',
      arguments: { path: '/workspace/file.txt' },
      callId: 'call-8',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('stdout data');
    expect(result.output).toContain('[stderr]');
    expect(result.output).toContain('stderr warning');
  });

  it('records duration in milliseconds', async () => {
    const ws = createDockerWorkspace(config);

    mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, 'data', '');
      return {} as any;
    });

    const result = await ws.execute({
      toolName: 'read_file',
      arguments: { path: '/workspace/file.txt' },
      callId: 'call-9',
    });

    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
