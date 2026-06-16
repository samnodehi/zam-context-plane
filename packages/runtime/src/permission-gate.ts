// ============================================================================
// ZAM Runtime — Permission Gate
// Canonical source: docs/24 §3.7
// Phase R3: Tiered permission system for tool actions.
// ============================================================================

import type {
  PermissionGate as IPermissionGate,
  PermissionResult,
  PermissionCategory,
  ToolAction,
  Session,
} from './types.js';

/**
 * Approval callback type for interactive environments.
 * Called when a tool action requires user approval.
 * Returns true to approve, false to deny.
 */
export type ApprovalCallback = (action: ToolAction) => Promise<boolean>;

/**
 * Tool-to-category mapping.
 * Per docs/24 §3.7 Permission Categories table.
 */
const TOOL_CATEGORY_MAP: Record<string, PermissionCategory> = {
  read_file: 'read_only',
  list_dir: 'read_only',
  grep_search: 'read_only',
  write_file: 'file_write',
  shell_exec: 'shell_exec',
};

/**
 * Default permission policies per category.
 * Per docs/24 §3.7:
 * - read_only: Auto-approve
 * - file_write: Auto-approve within workspace
 * - shell_exec: Require user approval (configurable)
 * - destructive: Always require approval
 * - network: Require approval (not in v0.1)
 */
const DEFAULT_POLICY: Record<PermissionCategory, 'auto_approve' | 'require_approval'> = {
  read_only: 'auto_approve',
  file_write: 'auto_approve',
  shell_exec: 'require_approval',
  destructive: 'require_approval',
  network: 'require_approval',
};

/**
 * LocalPermissionGate — enforces tiered permission system.
 *
 * Per docs/24 §3.7 Invariants:
 * - Auto-approved actions are logged but not shown to the user.
 * - Actions requiring approval block the loop until the user responds.
 * - Rejection causes tool_call to fail with permission_denied error.
 * - Permission categories are configurable via overrides.
 */
export class LocalPermissionGate implements IPermissionGate {
  private readonly approvalCallback: ApprovalCallback | undefined;
  private readonly policyOverrides: Partial<Record<PermissionCategory, 'auto_approve' | 'require_approval'>>;

  constructor(options?: {
    approvalCallback?: ApprovalCallback;
    policyOverrides?: Partial<Record<PermissionCategory, 'auto_approve' | 'require_approval'>>;
  }) {
    this.approvalCallback = options?.approvalCallback;
    this.policyOverrides = options?.policyOverrides ?? {};
  }

  async check(action: ToolAction, _session: Session): Promise<PermissionResult> {
    // Determine category for this tool
    const category = this.getCategory(action.toolName);

    // Get effective policy (overrides > defaults)
    const policy = this.policyOverrides[category] ?? DEFAULT_POLICY[category];

    // Auto-approve path
    if (policy === 'auto_approve') {
      return {
        allowed: true,
        reason: `Auto-approved: category "${category}"`,
        requiresApproval: false,
        approvedBy: 'auto',
      };
    }

    // Require-approval path
    if (!this.approvalCallback) {
      // No callback available — deny by default (headless mode)
      return {
        allowed: false,
        reason: `Approval required for category "${category}" but no approval callback is available.`,
        requiresApproval: true,
      };
    }

    // Call the approval callback
    const approved = await this.approvalCallback(action);
    if (approved) {
      return {
        allowed: true,
        reason: `User approved: category "${category}"`,
        requiresApproval: true,
        approvedBy: 'user',
      };
    }

    return {
      allowed: false,
      reason: `User denied: category "${category}"`,
      requiresApproval: true,
    };
  }

  /**
   * Get the permission category for a tool.
   * Unknown tools default to 'destructive' (most restrictive).
   */
  getCategory(toolName: string): PermissionCategory {
    return TOOL_CATEGORY_MAP[toolName] ?? 'destructive';
  }
}
