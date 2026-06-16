/**
 * Phase P6: ModelSelectorOutput / ProposalDecision types. [FUTURE-ONLY]
 *
 * The canonical definitions now live in `@zam/types` — the single source shared
 * with the runtime (DEBT.md C3 / docs/32). This module re-exports them so existing
 * core imports (`from '../types/model-selector.js'`) are unchanged.
 *
 * Mirrors schemas/future/model-selector-output.schema.json exactly.
 *
 * ISOLATION INVARIANTS (unchanged):
 *   - Used only by src/core/model-selector-integrator.ts and the HTTP body-mapper /
 *     plan route handler.
 *   - NOT used by any MVP pipeline module.
 *   - OQ-2 (docs/19): model proposals use a SEPARATE ProposalDecision shape (not
 *     SelectionDecision); the integrator converts ProposalDecision → SelectionDecision
 *     before the Conflict Resolver.
 *
 * Canonical: docs/19 §8; schemas/future/model-selector-output.schema.json; docs/32.
 */

export type { ProposalDecision, ModelSelectorOutput } from '@zam/types';
