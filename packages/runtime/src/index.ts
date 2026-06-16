// ============================================================================
// ZAM Runtime — Public Library API Entry Point
// Exports the runtime's public API for programmatic use.
// ============================================================================

export { createSession } from './session-manager.js';
export { runLoop } from './turn-loop.js';
export { loadConfig } from './config.js';
export { createZamClient } from './zam-client.js';
export { createProviderClient } from './provider-client.js';
export { assemblePrompt } from './prompt-assembler.js';
export { buildZamInput } from './history-state-builder.js';
export { EventStream } from './event-stream.js';
export { LocalWorkspace } from './local-workspace.js';
export { LocalPermissionGate } from './permission-gate.js';
export { LocalToolOutputOptimizer, DEFAULT_OPTIMIZER_CONFIG } from './tool-output-optimizer.js';
export { createAgent } from './create-agent.js';
export type { AgentOptions, Agent } from './create-agent.js';

// Re-export types
export type {
  RuntimeConfig,
  RuntimeResult,
  UserRequest,
  Session,
  EventStreamEntry,
  EventType,
  EventContent,
  ProviderClient,
  ProviderResponse,
  ProviderMessage,
  ProviderChatOptions,
  PromptPlan,
  SelectedComponent,
  AssembledPrompt,
  ZamClient,
  ZamPlanRequestBody,
  ZamPlanResponse,
  ToolCall,
  Workspace,
  ToolAction,
  ToolObservation,
  PermissionGate,
  PermissionResult,
  PermissionCategory,
  ToolOutputOptimizer,
  OptimizerConfig,
  OptimizedOutput,
} from './types.js';
