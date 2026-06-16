/**
 * Canonical Class-B input defaults (single source of truth).
 *
 * These values were previously copy-pasted — and required by comment to "stay
 * identical" — across src/core/api.ts, src/core/input-loader.ts, and
 * src/http/body-mapper.ts. They are centralized here so the three sites import
 * one definition (DEBT.md C3, item b). Values are unchanged.
 *
 * Canonical: docs/06 §2; docs/32.
 */

import type {
  ActiveIds,
  RuntimeCapabilities,
  HistoryStateSummary,
  SelectorPolicy,
} from '../types/inputs.js';

/** Active IDs — absent: silent default (no warning). */
export const ACTIVE_IDS_DEFAULT: ActiveIds = {
  activeSkillIds: [],
  activeToolIds: [],
  activeMemoryIds: [],
};

/** Runtime capabilities — absent: capability inventory incomplete; all tools treated as available. */
export const RUNTIME_DEFAULT: RuntimeCapabilities = {
  availableToolIds: [],
  unavailableToolIds: [],
  capabilityInventoryComplete: false,
  runtimeLabel: 'missing',
};

/** History state — absent: malformed; all high-risk/non-optional history components included. */
export const HISTORY_DEFAULT: HistoryStateSummary = {
  lanesPresent: [],
  durableConstraintsPresent: false,
  openCommitmentsPresent: false,
  recentRawTurnCount: 0,
  totalHistoryTokensApprox: 0,
  historyMalformed: true,
};

/** Selector policy — absent: safe defaults (deterministic-only MVP). */
export const POLICY_DEFAULT: SelectorPolicy = {
  failOpenThreshold: 0.7,
  deterministicOnly: true,
  injectionSuspectAction: 'warn_and_continue',
};
