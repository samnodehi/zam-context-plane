// ============================================================================
// ZAM Runtime — LocalWorkspace
// Canonical source: docs/24 §3.6
// Phase R3: Executes tools as local processes with workspace root enforcement.
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { exec } from 'node:child_process';
import type { Workspace, ToolAction, ToolObservation } from './types.js';

/**
 * LocalWorkspace — executes tools as local file system operations and shell commands.
 *
 * Per docs/24 §3.6:
 * - Enforces workspace root boundaries: file operations outside root are rejected.
 * - All tool execution results are captured: stdout, stderr, exit codes, duration.
 * - Tool execution is synchronous from the loop's perspective.
 *
 * Supported tools (RQ-2):
 * - read_file: Read file contents
 * - write_file: Write file contents
 * - list_dir: List directory contents
 * - grep_search: Simple regex/string search in file or directory
 * - shell_exec: Execute local shell command
 */
export class LocalWorkspace implements Workspace {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  isPathWithinWorkspace(targetPath: string): boolean {
    const resolved = resolve(this.workspaceRoot, targetPath);
    const rel = relative(this.workspaceRoot, resolved);
    // Path is within workspace if:
    // 1. The relative path does not start with '..' (no escape)
    // 2. The relative path is not an absolute path (on Windows, this means
    //    it doesn't start with a drive letter like 'C:\')
    if (rel.startsWith('..')) {
      return false;
    }
    // On Windows, an absolute path in `rel` means it's on a different drive
    if (isAbsolute(rel)) {
      return false;
    }
    return true;
  }

  async execute(action: ToolAction): Promise<ToolObservation> {
    const startTime = Date.now();

    try {
      switch (action.toolName) {
        case 'read_file':
          return this.executeReadFile(action, startTime);
        case 'write_file':
          return this.executeWriteFile(action, startTime);
        case 'list_dir':
          return this.executeListDir(action, startTime);
        case 'grep_search':
          return this.executeGrepSearch(action, startTime);
        case 'shell_exec':
          return await this.executeShellExec(action, startTime);
        default:
          return {
            callId: action.callId,
            success: false,
            output: '',
            error: `Unknown tool: "${action.toolName}". Supported tools: read_file, write_file, list_dir, grep_search, shell_exec.`,
            durationMs: Date.now() - startTime,
          };
      }
    } catch (err) {
      return {
        callId: action.callId,
        success: false,
        output: '',
        error: (err as Error).message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Tool implementations
  // ---------------------------------------------------------------------------

  private executeReadFile(action: ToolAction, startTime: number): ToolObservation {
    const filePath = action.arguments.path as string;
    if (!filePath || typeof filePath !== 'string') {
      return this.fail(action.callId, 'read_file requires a "path" argument.', startTime);
    }

    if (!this.isPathWithinWorkspace(filePath)) {
      return this.fail(action.callId, `Path is outside workspace root: "${filePath}".`, startTime);
    }

    const resolved = resolve(this.workspaceRoot, filePath);
    if (!existsSync(resolved)) {
      return this.fail(action.callId, `File not found: "${filePath}".`, startTime);
    }

    const content = readFileSync(resolved, 'utf8');
    return {
      callId: action.callId,
      success: true,
      output: content,
      durationMs: Date.now() - startTime,
    };
  }

  private executeWriteFile(action: ToolAction, startTime: number): ToolObservation {
    const filePath = action.arguments.path as string;
    const content = action.arguments.content as string;

    if (!filePath || typeof filePath !== 'string') {
      return this.fail(action.callId, 'write_file requires a "path" argument.', startTime);
    }
    if (content === undefined || content === null) {
      return this.fail(action.callId, 'write_file requires a "content" argument.', startTime);
    }

    if (!this.isPathWithinWorkspace(filePath)) {
      return this.fail(action.callId, `Path is outside workspace root: "${filePath}".`, startTime);
    }

    const resolved = resolve(this.workspaceRoot, filePath);
    const dir = dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(resolved, String(content), 'utf8');
    return {
      callId: action.callId,
      success: true,
      output: `File written: ${filePath} (${String(content).length} bytes)`,
      durationMs: Date.now() - startTime,
    };
  }

  private executeListDir(action: ToolAction, startTime: number): ToolObservation {
    const dirPath = (action.arguments.path as string) ?? '.';

    if (!this.isPathWithinWorkspace(dirPath)) {
      return this.fail(action.callId, `Path is outside workspace root: "${dirPath}".`, startTime);
    }

    const resolved = resolve(this.workspaceRoot, dirPath);
    if (!existsSync(resolved)) {
      return this.fail(action.callId, `Directory not found: "${dirPath}".`, startTime);
    }

    const entries = readdirSync(resolved);
    const lines = entries.map((entry) => {
      try {
        const stat = statSync(resolve(resolved, entry));
        const type = stat.isDirectory() ? 'dir' : 'file';
        const size = stat.isFile() ? ` (${stat.size} bytes)` : '';
        return `${type}: ${entry}${size}`;
      } catch {
        return `unknown: ${entry}`;
      }
    });

    return {
      callId: action.callId,
      success: true,
      output: lines.join('\n'),
      durationMs: Date.now() - startTime,
    };
  }

  private executeGrepSearch(action: ToolAction, startTime: number): ToolObservation {
    const query = action.arguments.query as string;
    const searchPath = (action.arguments.path as string) ?? '.';

    if (!query || typeof query !== 'string') {
      return this.fail(action.callId, 'grep_search requires a "query" argument.', startTime);
    }

    if (!this.isPathWithinWorkspace(searchPath)) {
      return this.fail(action.callId, `Path is outside workspace root: "${searchPath}".`, startTime);
    }

    const resolved = resolve(this.workspaceRoot, searchPath);
    if (!existsSync(resolved)) {
      return this.fail(action.callId, `Path not found: "${searchPath}".`, startTime);
    }

    let pattern: RegExp;
    try {
      pattern = new RegExp(query, 'g');
    } catch {
      // Fall back to literal string search
      pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    }

    const results: string[] = [];
    const stat = statSync(resolved);

    if (stat.isFile()) {
      this.grepFile(resolved, searchPath, pattern, results);
    } else if (stat.isDirectory()) {
      this.grepDirectory(resolved, searchPath, pattern, results);
    }

    return {
      callId: action.callId,
      success: true,
      output: results.length > 0 ? results.join('\n') : 'No matches found.',
      durationMs: Date.now() - startTime,
    };
  }

  private grepFile(absPath: string, relPath: string, pattern: RegExp, results: string[]): void {
    try {
      const content = readFileSync(absPath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          results.push(`${relPath}:${i + 1}: ${lines[i]}`);
          pattern.lastIndex = 0; // Reset regex state
        }
      }
    } catch {
      // Skip files that can't be read (e.g., binary files)
    }
  }

  private grepDirectory(absDir: string, relDir: string, pattern: RegExp, results: string[]): void {
    try {
      const entries = readdirSync(absDir);
      for (const entry of entries) {
        const absEntry = resolve(absDir, entry);
        const relEntry = relDir === '.' ? entry : `${relDir}/${entry}`;
        try {
          const stat = statSync(absEntry);
          if (stat.isFile()) {
            this.grepFile(absEntry, relEntry, pattern, results);
          } else if (stat.isDirectory()) {
            // Skip node_modules and hidden directories for performance
            if (entry !== 'node_modules' && !entry.startsWith('.')) {
              this.grepDirectory(absEntry, relEntry, pattern, results);
            }
          }
        } catch {
          // Skip entries that can't be stat'd
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  private async executeShellExec(action: ToolAction, startTime: number): Promise<ToolObservation> {
    const command = action.arguments.command as string;
    if (!command || typeof command !== 'string') {
      return this.fail(action.callId, 'shell_exec requires a "command" argument.', startTime);
    }

    const timeoutMs = (action.arguments.timeout_ms as number) ?? 30000;

    return new Promise<ToolObservation>((resolvePromise) => {
      exec(
        command,
        {
          cwd: this.workspaceRoot,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024, // 1MB
        },
        (error, stdout, stderr) => {
          const output = [stdout, stderr].filter(Boolean).join('\n');
          if (error) {
            resolvePromise({
              callId: action.callId,
              success: false,
              output,
              error: error.message,
              durationMs: Date.now() - startTime,
            });
          } else {
            resolvePromise({
              callId: action.callId,
              success: true,
              output,
              durationMs: Date.now() - startTime,
            });
          }
        },
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private fail(callId: string, error: string, startTime: number): ToolObservation {
    return {
      callId,
      success: false,
      output: '',
      error,
      durationMs: Date.now() - startTime,
    };
  }
}
