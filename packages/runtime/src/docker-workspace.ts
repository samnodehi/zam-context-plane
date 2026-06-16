// ============================================================================
// ZAM Runtime — Docker Workspace
// Canonical source: docs/24 §3.6
// Phase R5: Sandboxed tool execution inside a Docker container.
// ============================================================================

import { execFile } from 'node:child_process';
import type {
  Workspace,
  ToolAction,
  ToolObservation,
} from './types.js';

/** Configuration for the Docker workspace. */
export interface DockerWorkspaceConfig {
  /** Docker container name or ID to exec into. */
  containerName: string;
  /** Workspace root path inside the container. */
  workspaceRoot: string;
  /** Timeout in milliseconds for docker exec commands. Default: 30000. */
  execTimeoutMs?: number;
}

/**
 * Create a DockerWorkspace that executes tools inside a Docker container.
 *
 * Per docs/24 §3.6:
 * - Same Workspace interface as LocalWorkspace, different execution backend.
 * - All tool execution results are captured — stdout, stderr, exit codes, duration.
 * - Workspace root boundaries are enforced.
 * - Tool execution is synchronous from the loop's perspective.
 */
export function createDockerWorkspace(config: DockerWorkspaceConfig): Workspace {
  return new DockerWorkspaceImpl(config);
}

class DockerWorkspaceImpl implements Workspace {
  private readonly config: DockerWorkspaceConfig;
  private readonly timeoutMs: number;

  constructor(config: DockerWorkspaceConfig) {
    this.config = config;
    this.timeoutMs = config.execTimeoutMs ?? 30000;
  }

  getWorkspaceRoot(): string {
    return this.config.workspaceRoot;
  }

  isPathWithinWorkspace(path: string): boolean {
    // Docker workspace paths are always POSIX-style.
    // For absolute paths, check directly. For relative paths, they're within workspace by definition.
    if (!path.startsWith('/')) {
      // Relative path — always within workspace
      return true;
    }
    const normalizedRoot = this.config.workspaceRoot.endsWith('/')
      ? this.config.workspaceRoot
      : this.config.workspaceRoot + '/';
    return path === this.config.workspaceRoot || path.startsWith(normalizedRoot);
  }

  async execute(action: ToolAction): Promise<ToolObservation> {
    const startTime = Date.now();

    // Map tool actions to docker exec commands
    const dockerCmd = this.buildDockerCommand(action);

    try {
      const { stdout, stderr } = await this.execDocker(dockerCmd);
      const durationMs = Date.now() - startTime;
      const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');

      return {
        callId: action.callId,
        success: true,
        output,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const err = error as ExecError;

      return {
        callId: action.callId,
        success: false,
        output: err.stdout ?? '',
        error: err.stderr || err.message || 'Docker execution failed',
        durationMs,
      };
    }
  }

  /**
   * Build the docker exec command arguments for a given tool action.
   */
  private buildDockerCommand(action: ToolAction): string[] {
    const args = action.arguments;

    switch (action.toolName) {
      case 'read_file': {
        const filePath = args.path as string;
        if (!this.isPathWithinWorkspace(filePath)) {
          throw new Error(`Path "${filePath}" is outside the workspace root.`);
        }
        return ['cat', this.resolvePath(filePath)];
      }
      case 'write_file': {
        const filePath = args.path as string;
        if (!this.isPathWithinWorkspace(filePath)) {
          throw new Error(`Path "${filePath}" is outside the workspace root.`);
        }
        const content = args.content as string;
        const resolvedPath = this.resolvePath(filePath);
        // Use sh -c with heredoc-style echo to write file content
        return ['sh', '-c', `cat > ${this.shellEscape(resolvedPath)} << 'ZAMEOF'\n${content}\nZAMEOF`];
      }
      case 'list_dir': {
        const dirPath = (args.path as string) || this.config.workspaceRoot;
        if (!this.isPathWithinWorkspace(dirPath)) {
          throw new Error(`Path "${dirPath}" is outside the workspace root.`);
        }
        return ['ls', '-la', this.resolvePath(dirPath)];
      }
      case 'grep_search': {
        const pattern = args.pattern as string;
        const searchPath = (args.path as string) || this.config.workspaceRoot;
        if (!this.isPathWithinWorkspace(searchPath)) {
          throw new Error(`Path "${searchPath}" is outside the workspace root.`);
        }
        return ['grep', '-rnI', pattern, this.resolvePath(searchPath)];
      }
      case 'shell_exec': {
        const command = args.command as string;
        return ['sh', '-c', `cd ${this.shellEscape(this.config.workspaceRoot)} && ${command}`];
      }
      default:
        throw new Error(`Unsupported tool: "${action.toolName}".`);
    }
  }

  /**
   * Resolve a path relative to the workspace root.
   * If the path is already absolute (starts with /), use it directly.
   * Docker paths are always POSIX — never use node's path.resolve which
   * would produce Windows-style paths on Windows hosts.
   */
  private resolvePath(p: string): string {
    if (p.startsWith('/')) return p;
    const root = this.config.workspaceRoot.endsWith('/')
      ? this.config.workspaceRoot
      : this.config.workspaceRoot + '/';
    return root + p;
  }

  /**
   * Execute a command inside the Docker container via `docker exec`.
   */
  private execDocker(cmd: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const args = ['exec', this.config.containerName, ...cmd];

      execFile('docker', args, { timeout: this.timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          const execError: ExecError = error as ExecError;
          execError.stdout = stdout;
          execError.stderr = stderr;
          reject(execError);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * Basic shell escaping for paths.
   */
  private shellEscape(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
}

/** Internal error type with stdout/stderr from execFile. */
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number;
}
