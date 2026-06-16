// ============================================================================
// ZAM Runtime — Default Tool Registry
// Canonical source: docs/24 §2 (RQ-2), docs/05 §3–§4
// Phase R6: 5 core tool component definitions in ZAM registry format,
//           plus provider-facing function schemas for tool calling.
// ============================================================================

import type { ProviderToolDefinition } from './types.js';

/**
 * Default tool components for the ZAM-Native Agent Runtime.
 *
 * Per docs/24 §2 (RQ-2), the v0.1 runtime ships with 5 core tools:
 *   - read_file   (read-only, auto-approve)
 *   - write_file   (file write, auto-approve within workspace)
 *   - list_dir     (read-only, auto-approve)
 *   - grep_search  (read-only, auto-approve)
 *   - shell_exec   (shell execution, require approval)
 *
 * Each entry conforms to schemas/inputs/component-registry.schema.json
 * with all 18 required fields from docs/05 §3.
 *
 * These are merged into the user-provided registry (if any) or used
 * alone when no external registry is specified.
 */
export const DEFAULT_TOOL_REGISTRY: unknown[] = [
  {
    id: 'tool.read_file',
    type: 'tool',
    title: 'Read File',
    summary: 'Read the contents of a file from the workspace.',
    source: 'runtime:tool:read_file',
    tokensApprox: 1,
    charsApprox: 1,
    riskLevel: 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'fail_open',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: ['tool', 'read-only', 'file'],
    version: '0.1.0',
    hash: null,
    metadataOnly: true,
  },
  {
    id: 'tool.write_file',
    type: 'tool',
    title: 'Write File',
    summary: 'Write or create a file in the workspace.',
    source: 'runtime:tool:write_file',
    tokensApprox: 1,
    charsApprox: 1,
    riskLevel: 'medium',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'fail_open',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: ['tool', 'file-write', 'file'],
    version: '0.1.0',
    hash: null,
    metadataOnly: true,
  },
  {
    id: 'tool.list_dir',
    type: 'tool',
    title: 'List Directory',
    summary: 'List the contents of a directory in the workspace.',
    source: 'runtime:tool:list_dir',
    tokensApprox: 1,
    charsApprox: 1,
    riskLevel: 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'fail_open',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: ['tool', 'read-only', 'directory'],
    version: '0.1.0',
    hash: null,
    metadataOnly: true,
  },
  {
    id: 'tool.grep_search',
    type: 'tool',
    title: 'Grep Search',
    summary: 'Search file contents with pattern matching in the workspace.',
    source: 'runtime:tool:grep_search',
    tokensApprox: 1,
    charsApprox: 1,
    riskLevel: 'low',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'fail_open',
    retainPolicy: 'optional',
    budgetPriority: 5,
    evidenceRequired: null,
    tags: ['tool', 'read-only', 'search'],
    version: '0.1.0',
    hash: null,
    metadataOnly: true,
  },
  {
    id: 'tool.shell_exec',
    type: 'tool',
    title: 'Shell Execute',
    summary: 'Execute a shell command in the workspace with configurable timeout.',
    source: 'runtime:tool:shell_exec',
    tokensApprox: 1,
    charsApprox: 1,
    riskLevel: 'high',
    requiredWhen: [],
    safeToOmitWhen: [],
    defaultAction: 'include',
    omissionPolicy: 'fail_open',
    retainPolicy: 'optional',
    budgetPriority: 4,
    evidenceRequired: null,
    tags: ['tool', 'shell', 'execution'],
    version: '0.1.0',
    hash: null,
    metadataOnly: true,
  },
];

/**
 * Core tool function schemas for provider tool calling.
 *
 * These are the actual OpenAI-compatible function definitions that the
 * provider needs to enable the model to call tools. They are separate
 * from the DEFAULT_TOOL_REGISTRY above, which are ZAM component metadata
 * for the selector pipeline.
 *
 * The runtime owns these schemas. ZAM decides WHICH tools to include;
 * the runtime defines HOW to call them.
 */
export const CORE_TOOL_DEFINITIONS: ProviderToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file from the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to the file to read.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or create a file in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to the file to write.' },
        content: { type: 'string', description: 'The content to write to the file.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the contents of a directory in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to the directory.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep_search',
    description: 'Search file contents with pattern matching in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex or plain text).' },
        path: { type: 'string', description: 'Directory or file path to search in.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'shell_exec',
    description: 'Execute a shell command in the workspace with configurable timeout.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds. Default: 30000.' },
      },
      required: ['command'],
    },
  },
];
