// Shared types for the MCP adapter (docs/39).
//
// RegistryEntry is the canonical 18-field component shape
// (schemas/inputs/component-registry.schema.json) — defined locally because each
// adapter independently produces schema-valid entries (it is the public contract,
// not internal logic). The Mcp* types mirror the standard MCP list item shapes.

export type ComponentType =
  | 'scaffold'
  | 'skill'
  | 'tool'
  | 'history'
  | 'memory'
  | 'output_format';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type DefaultAction = 'include' | 'omit' | 'defer';
export type OmissionPolicy = 'allow' | 'fail_open' | 'never';
export type RetainPolicy = 'optional' | 'durable' | 'mandatory' | 'safety_critical';

export interface RegistryEntry {
  id: string;
  type: ComponentType;
  title: string;
  summary: string;
  source: string;
  tokensApprox: number;
  charsApprox: number;
  riskLevel: RiskLevel;
  requiredWhen: string[];
  safeToOmitWhen: string[];
  defaultAction: DefaultAction;
  omissionPolicy: OmissionPolicy;
  retainPolicy: RetainPolicy;
  budgetPriority: number;
  evidenceRequired: string | null;
  tags: string[];
  version: string;
  hash: string | null;
}

// --- MCP capability shapes (standard tools/list, resources/list, prompts/list) ---

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: McpToolAnnotations;
}
export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}
export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}
export interface McpServerCapabilities {
  name: string;
  tools?: McpTool[];
  resources?: McpResource[];
  prompts?: McpPrompt[];
}
export interface McpCapabilities {
  servers: McpServerCapabilities[];
}

export type CapabilityKind = 'tool' | 'resource' | 'prompt';

/** Links a generated component id back to its original MCP item (for reconstruction). */
export interface MappedItem {
  id: string;
  kind: CapabilityKind;
  server: string;
  tool?: McpTool;
  resource?: McpResource;
  prompt?: McpPrompt;
}
