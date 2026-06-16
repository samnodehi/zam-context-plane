/**
 * Phase P11: TypeScript interfaces for HistoryCompressorOutput. [FUTURE-ONLY]
 *
 * Mirrors schemas/future/history-compressor-output.schema.json exactly.
 *
 * ISOLATION INVARIANTS:
 *   - These types are used only by src/core/compressor-integrator.ts and
 *     future integration paths.
 *   - They are NOT used by any MVP pipeline module.
 *   - The HistoryCompressorOutput type does NOT extend or modify any MVP type
 *     (SelectionDecision, RequestSignals, LoadedInputs, etc.).
 *   - No field from this type may be added to any MVP schema without
 *     a separate explicit schema decision pass.
 *
 * Canonical: docs/13_MODEL_ASSISTED_CONTEXT_PLANNING.md §10;
 *            docs/14_SUMMARY_QUALITY_HARNESS_SCOPING.md;
 *            schemas/future/history-compressor-output.schema.json.
 */

// ---------------------------------------------------------------------------
// StateItem
// ---------------------------------------------------------------------------

/**
 * A single extracted state item produced by the history compressor.
 *
 * 'content' carries the core extracted text.
 * 'notes' carries optional reasoning, source reference, or lifecycle metadata.
 *
 * Canonical: schemas/future/history-compressor-output.schema.json $defs.StateItem.
 */
export interface StateItem {
  /** The extracted state content. Required. Must be non-empty. */
  content: string;
  /** Optional metadata: source reference, lifecycle note, reasoning for retention. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// CurrentTaskState
// ---------------------------------------------------------------------------

/**
 * The active task state at the time of compression.
 *
 * Single object (not array) because there is only one active task state
 * per session at any point.
 *
 * Canonical: schemas/future/history-compressor-output.schema.json currentTaskState;
 *            docs/13 §10 'Current task state: Active task, current goal, blockers'.
 */
export interface CurrentTaskState {
  /** Description of the active task the session is currently working on. Required. */
  activeTask: string;
  /** The current goal within the active task. Optional. */
  currentGoal?: string;
  /** Known blockers currently preventing task progress. May be empty. */
  blockers?: string[];
}

// ---------------------------------------------------------------------------
// SummaryTrace
// ---------------------------------------------------------------------------

/**
 * Trace output documenting what the compressor retained, omitted, and was
 * uncertain about.
 *
 * All three arrays are required (may be empty).
 *
 * Canonical: schemas/future/history-compressor-output.schema.json summaryTrace;
 *            docs/13 §10 Summary Trace table.
 */
export interface SummaryTrace {
  /** State categories and items retained in the summary. */
  included: string[];
  /** Items deliberately excluded by the compressor. */
  omitted: string[];
  /** Items the compressor was not confident about retaining or omitting. */
  uncertain: string[];
}

// ---------------------------------------------------------------------------
// HistoryCompressorOutput
// ---------------------------------------------------------------------------

/**
 * Structured output produced by a model-assisted History Compressor.
 *
 * This is a [FUTURE-ONLY] type. It does not participate in any MVP planning
 * pipeline phase. It enters the pipeline as advisory structured state only,
 * through the compressor integrator, and must respect all protected category
 * invariants (docs/13 §10, docs/14 §4).
 *
 * 11 state extraction categories map to the required fields.
 * summaryTrace provides the 3 trace categories (included/omitted/uncertain).
 *
 * Canonical: docs/13 §10; docs/14 §4–§7;
 *            schemas/future/history-compressor-output.schema.json.
 */
export interface HistoryCompressorOutput {
  /**
   * Identifier of the compressor model or version that produced this output.
   * For audit and reproducibility. Not a schema version.
   */
  compressorVersion: string;

  /**
   * Unique ID linking this output to its trace entry in trace.json.
   * Required for full traceability.
   */
  compressorTraceId: string;

  /** Active task state — active task, current goal, and blockers. */
  currentTaskState: CurrentTaskState;

  /** Decisions accepted during the session. Protected from compression. */
  acceptedDecisions: StateItem[];

  /** Unresolved problems identified but not yet addressed. */
  openIssues: StateItem[];

  /** Promises, agreements, and pending deliverables. Protected from compression. */
  openCommitments: StateItem[];

  /** User-stated requirements and preferences. */
  userConstraints: StateItem[];

  /** Files, directories, and paths referenced as important during the session. */
  importantFilesPaths: StateItem[];

  /** Approaches tried and rejected, with reasons. */
  failedAttempts: StateItem[];

  /** Active warnings and risk flags. */
  warnings: StateItem[];

  /** Hard lessons from the session. Protected from compression. */
  antiRegressionRules: StateItem[];

  /** Configurable window of recent raw conversation turns. */
  recentRelevantTurns: StateItem[];

  /** Long-lived factual context established in the session. Protected from compression. */
  durableFacts: StateItem[];

  /** Trace output: included/omitted/uncertain categories. */
  summaryTrace: SummaryTrace;
}
