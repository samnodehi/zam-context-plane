/**
 * Phase P10: AnalyzerOutput type. [FUTURE-ONLY]
 *
 * The canonical definition now lives in `@zam/types` — the single source shared
 * with the runtime (DEBT.md C3 / docs/32). This module re-exports it so existing
 * core imports (`from '../types/analyzer.js'`) are unchanged.
 *
 * Mirrors schemas/future/analyzer-output.schema.json exactly.
 *
 * ISOLATION INVARIANTS (unchanged):
 *   - Used only by src/core/analyzer-integrator.ts and the --analyzer-output path
 *     in src/cli/commands/plan.ts and src/core/input-loader.ts.
 *   - NOT used by any MVP pipeline module.
 *   - Does NOT extend or modify any MVP type.
 *   - No field may be added to any MVP schema without a separate schema decision pass.
 *
 * Canonical: docs/15 §4; schemas/future/analyzer-output.schema.json; docs/32.
 */

export type { AnalyzerOutput } from '@zam/types';
