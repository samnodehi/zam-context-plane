// ============================================================================
// Tests — LocalWorkspace
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalWorkspace } from '../src/local-workspace.js';

const TEST_DIR = join(process.cwd(), '.test-workspace-tmp');

describe('LocalWorkspace', () => {
  let workspace: LocalWorkspace;

  beforeEach(() => {
    // Create a clean test workspace directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    workspace = new LocalWorkspace(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // Workspace root enforcement
  // -------------------------------------------------------------------------

  describe('isPathWithinWorkspace', () => {
    it('accepts paths within workspace', () => {
      expect(workspace.isPathWithinWorkspace('file.txt')).toBe(true);
      expect(workspace.isPathWithinWorkspace('sub/dir/file.txt')).toBe(true);
      expect(workspace.isPathWithinWorkspace('./file.txt')).toBe(true);
    });

    it('rejects paths outside workspace', () => {
      expect(workspace.isPathWithinWorkspace('../outside.txt')).toBe(false);
      expect(workspace.isPathWithinWorkspace('../../etc/passwd')).toBe(false);
      expect(workspace.isPathWithinWorkspace('sub/../../outside.txt')).toBe(false);
    });

    it('returns correct workspace root', () => {
      expect(workspace.getWorkspaceRoot()).toBe(TEST_DIR);
    });
  });

  // -------------------------------------------------------------------------
  // read_file
  // -------------------------------------------------------------------------

  describe('read_file', () => {
    it('reads a file within workspace', async () => {
      writeFileSync(join(TEST_DIR, 'hello.txt'), 'Hello, World!');

      const result = await workspace.execute({
        toolName: 'read_file',
        arguments: { path: 'hello.txt' },
        callId: 'call-1',
      });

      expect(result.callId).toBe('call-1');
      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello, World!');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('fails for non-existent file', async () => {
      const result = await workspace.execute({
        toolName: 'read_file',
        arguments: { path: 'nonexistent.txt' },
        callId: 'call-2',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('rejects path outside workspace', async () => {
      const result = await workspace.execute({
        toolName: 'read_file',
        arguments: { path: '../outside.txt' },
        callId: 'call-3',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace root');
    });

    it('fails without path argument', async () => {
      const result = await workspace.execute({
        toolName: 'read_file',
        arguments: {},
        callId: 'call-4',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('requires a "path" argument');
    });
  });

  // -------------------------------------------------------------------------
  // write_file
  // -------------------------------------------------------------------------

  describe('write_file', () => {
    it('writes a file within workspace', async () => {
      const result = await workspace.execute({
        toolName: 'write_file',
        arguments: { path: 'output.txt', content: 'Test content' },
        callId: 'call-5',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('File written');
      expect(readFileSync(join(TEST_DIR, 'output.txt'), 'utf8')).toBe('Test content');
    });

    it('creates parent directories if needed', async () => {
      const result = await workspace.execute({
        toolName: 'write_file',
        arguments: { path: 'sub/dir/output.txt', content: 'Nested' },
        callId: 'call-6',
      });

      expect(result.success).toBe(true);
      expect(existsSync(join(TEST_DIR, 'sub/dir/output.txt'))).toBe(true);
    });

    it('rejects path outside workspace', async () => {
      const result = await workspace.execute({
        toolName: 'write_file',
        arguments: { path: '../escape.txt', content: 'Bad' },
        callId: 'call-7',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace root');
    });
  });

  // -------------------------------------------------------------------------
  // list_dir
  // -------------------------------------------------------------------------

  describe('list_dir', () => {
    it('lists directory contents', async () => {
      writeFileSync(join(TEST_DIR, 'file1.txt'), 'a');
      writeFileSync(join(TEST_DIR, 'file2.txt'), 'bb');
      mkdirSync(join(TEST_DIR, 'subdir'));

      const result = await workspace.execute({
        toolName: 'list_dir',
        arguments: { path: '.' },
        callId: 'call-8',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.txt');
      expect(result.output).toContain('file2.txt');
      expect(result.output).toContain('dir: subdir');
    });

    it('rejects path outside workspace', async () => {
      const result = await workspace.execute({
        toolName: 'list_dir',
        arguments: { path: '..' },
        callId: 'call-9',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace root');
    });
  });

  // -------------------------------------------------------------------------
  // grep_search
  // -------------------------------------------------------------------------

  describe('grep_search', () => {
    it('finds matches in a file', async () => {
      writeFileSync(join(TEST_DIR, 'code.ts'), 'const x = 1;\nconst y = 2;\nconst z = x + y;\n');

      const result = await workspace.execute({
        toolName: 'grep_search',
        arguments: { query: 'const', path: 'code.ts' },
        callId: 'call-10',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('code.ts:1:');
      expect(result.output).toContain('code.ts:2:');
      expect(result.output).toContain('code.ts:3:');
    });

    it('searches directory recursively', async () => {
      mkdirSync(join(TEST_DIR, 'src'));
      writeFileSync(join(TEST_DIR, 'src/a.ts'), 'TODO: fix this\n');
      writeFileSync(join(TEST_DIR, 'src/b.ts'), 'no match\n');

      const result = await workspace.execute({
        toolName: 'grep_search',
        arguments: { query: 'TODO', path: '.' },
        callId: 'call-11',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('TODO');
      expect(result.output).not.toContain('b.ts');
    });

    it('reports no matches', async () => {
      writeFileSync(join(TEST_DIR, 'empty.txt'), 'nothing here\n');

      const result = await workspace.execute({
        toolName: 'grep_search',
        arguments: { query: 'NONEXISTENT', path: 'empty.txt' },
        callId: 'call-12',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('No matches found.');
    });

    it('rejects path outside workspace', async () => {
      const result = await workspace.execute({
        toolName: 'grep_search',
        arguments: { query: 'test', path: '../..' },
        callId: 'call-13',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside workspace root');
    });
  });

  // -------------------------------------------------------------------------
  // shell_exec
  // -------------------------------------------------------------------------

  describe('shell_exec', () => {
    it('executes a simple command', async () => {
      const result = await workspace.execute({
        toolName: 'shell_exec',
        arguments: { command: 'echo hello' },
        callId: 'call-14',
      });

      expect(result.success).toBe(true);
      expect(result.output.trim()).toContain('hello');
    });

    it('captures stderr on failure', async () => {
      const result = await workspace.execute({
        toolName: 'shell_exec',
        arguments: { command: 'node -e "process.exit(1)"' },
        callId: 'call-15',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('fails without command argument', async () => {
      const result = await workspace.execute({
        toolName: 'shell_exec',
        arguments: {},
        callId: 'call-16',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('requires a "command" argument');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown tool
  // -------------------------------------------------------------------------

  describe('unknown tool', () => {
    it('returns error for unknown tool', async () => {
      const result = await workspace.execute({
        toolName: 'unknown_tool',
        arguments: {},
        callId: 'call-17',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });
});
