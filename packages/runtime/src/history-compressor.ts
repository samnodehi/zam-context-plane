// ============================================================================
// ZAM Runtime — History Compressor
// Phase M3-C. Canonical source: docs/27 §8.1–§8.3, §8.6–§8.7, §10.
// ============================================================================

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import type { CompressorConfig, EventStreamEntry, RuntimeConfig } from './types.js';
import { createProviderClient } from './provider-client.js';
import { buildCompressorPrompt, formatHistory } from './compressor-prompt.js';

// ---------------------------------------------------------------------------
// AJV Bootstrap (CJS interop — mirrors request-analyzer.ts pattern)
// ---------------------------------------------------------------------------

interface AjvInstance {
  compile(schema: Record<string, unknown>): ValidateFn;
}

interface ValidateFn {
  (data: unknown): boolean;
  errors?: Array<{ message?: string; instancePath?: string }> | null;
}

const _require = createRequire(import.meta.url);
const AjvCtor = (_require('ajv/dist/2020') as any).default as new (opts?: Record<string, unknown>) => AjvInstance;

// ---------------------------------------------------------------------------
// Schema Validator (lazy singleton)
// ---------------------------------------------------------------------------

let _validateCompressorOutput: ValidateFn | null = null;

function getValidator(): ValidateFn {
  if (_validateCompressorOutput === null) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Navigate from packages/runtime/src/ to project root schemas/
    const schemaPath = resolve(__dirname, '../../../schemas/inputs/history-compressor-output.schema.json');
    const schemaContent = readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(schemaContent) as Record<string, unknown>;

    const ajv = new AjvCtor({ strict: false, allErrors: false });
    _validateCompressorOutput = ajv.compile(schema);
  }
  return _validateCompressorOutput;
}

// ---------------------------------------------------------------------------
// §8.1 Public Types
// ---------------------------------------------------------------------------

/**
 * The validated structured output from the History Compressor model.
 * Shape is defined by schemas/inputs/history-compressor-output.schema.json.
 * Canonical: docs/27 §8.1.
 */
export interface HistoryCompressorOutput {
  compressorVersion: string;
  sessionId: string;
  compressionTraceId: string;
  currentTaskState: {
    activeTask: string | null;
    currentGoal: string | null;
    blockers: string[];
    progressNotes: string[];
  };
  acceptedDecisions: Array<{ decisionId: string; summary: string; acceptedAt: string }>;
  openIssues: Array<{ issueId: string; summary: string; severity: 'critical' | 'important' | 'advisory' }>;
  openCommitments: Array<{ commitmentId: string; summary: string; committedAt: string }>;
  userConstraints: Array<{ constraintId: string; summary: string }>;
  importantFilesPaths: string[];
  failedAttempts: Array<{ attemptId: string; summary: string; failureReason: string }>;
  activeWarnings: Array<{ warningCode: string; message: string }>;
  antiRegressionRules: Array<{
    ruleId: string;
    category: 'process' | 'architectural' | 'tool_specific' | 'safety';
    summary: string;
    severity: 'critical' | 'important' | 'advisory';
    applicability: string[];
    sourceReference: string;
    reviewDate: string | null;
  }>;
  durableFacts: Array<{ factId: string; summary: string }>;
  recentRawTurnWindow: {
    windowSize: number;
    turnCount: number;
    windowPolicy: string;
  };
  compressionConfidence: number;
  failOpenTriggered: boolean;
  failOpenReason: string | null;
  protectedCategoriesRetained: string[];
  totalRawTokensApprox: number;
  compressedTokensApprox: number;
}

/**
 * Result wrapper for the history compressor.
 * Canonical: docs/27 §8.1.
 *
 * Safety invariant: output is null when:
 *   - compressor is disabled
 *   - session is below token/turn thresholds
 *   - LLM call failed (timeout, API error)
 *   - Response parsing or schema validation failed
 *   - Protected categories not retained
 * null always means: use full raw history (current behavior, unchanged).
 */
export interface CompressorResult {
  /** null = disabled, below threshold, or failed — use raw history. */
  output: HistoryCompressorOutput | null;
  /** true if compression was applied and output is valid. */
  compressed: boolean;
  /** Recent raw turns to pair with the structured summary. */
  rawTurnWindow: EventStreamEntry[];
  /** Wall-clock time for the operation in milliseconds. */
  durationMs: number;
  /** true if compression was attempted but failed and raw history was used. */
  fallbackUsed: boolean;
  /** Human-readable reason for fallback, if applicable. */
  fallbackReason?: string;
  /** Estimated tokens saved by compression (0 if not compressed). */
  tokensSaved: number;
}

// ---------------------------------------------------------------------------
// §8.3 Token Estimation
// ---------------------------------------------------------------------------

/**
 * Lightweight token estimator for EventStream entries.
 * Counts approximate tokens from user_message, model_response, and tool_result
 * entries using the 4-chars-per-token heuristic.
 *
 * Deliberately simple — exact tokenization is provider-specific and unnecessary
 * for threshold comparison.
 *
 * Canonical: docs/27 §8.3.
 */
export function estimateHistoryTokens(entries: EventStreamEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (
      entry.type === 'user_message' ||
      entry.type === 'model_response' ||
      entry.type === 'tool_result'
    ) {
      const content = entry.content as { text?: string; output?: string };
      const text = content.text ?? content.output ?? '';
      total += Math.ceil(text.length / 4);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count completed turns in the EventStream.
 * A turn is identified by unique turnIndex values across all entries.
 */
function countCompletedTurns(entries: EventStreamEntry[]): number {
  const turnIndices = new Set<number>();
  for (const entry of entries) {
    turnIndices.add(entry.turnIndex);
  }
  return turnIndices.size;
}

/**
 * Select the N most recent raw turns from the EventStream.
 * "Most recent N turns" means the last N unique turnIndex values.
 */
function selectRawTurnWindow(entries: EventStreamEntry[], windowSize: number): EventStreamEntry[] {
  if (windowSize <= 0) return [];

  // Collect all unique turn indices in order of appearance
  const seenTurnIndices: number[] = [];
  const seenSet = new Set<number>();
  for (const entry of entries) {
    if (!seenSet.has(entry.turnIndex)) {
      seenSet.add(entry.turnIndex);
      seenTurnIndices.push(entry.turnIndex);
    }
  }

  // Take the last N turn indices
  const windowTurnIndices = new Set(seenTurnIndices.slice(-windowSize));

  // Return all entries belonging to those turn indices, in original order
  return entries.filter(e => windowTurnIndices.has(e.turnIndex));
}

/**
 * Wrap a promise with a timeout.
 * On timeout, rejects with an Error describing the label.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Extract a JSON object from a model response string.
 * Handles markdown code fences and trailing text.
 * Returns null if no parseable JSON is found.
 */
function extractJson(text: string): Record<string, unknown> | null {
  // Try 1: Direct parse
  try {
    return JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    // Continue to next strategy
  }

  // Try 2: Extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // Continue
    }
  }

  // Try 3: Find the first { ... } block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch?.[0]) {
    try {
      return JSON.parse(braceMatch[0]) as Record<string, unknown>;
    } catch {
      // All strategies failed
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Protected Category Verification (docs/27 §8.6, §10)
// ---------------------------------------------------------------------------

/**
 * The 6 protected categories per docs/27 §10 and docs/14 §4.
 * These must appear in protectedCategoriesRetained[] in the output.
 */
const PROTECTED_CATEGORIES = [
  'currentTaskState',
  'acceptedDecisions',
  'openCommitments',
  'userConstraints',
  'antiRegressionRules',
  // The 6th protected concept per docs/27 §10 is "recent direct user instructions",
  // which is covered by the raw turn window mechanism rather than a separate category
  // in the schema. The schema's protectedCategoriesRetained list must include all
  // categories the model explicitly retained. Minimum check: the 5 named schema categories.
] as const;

/**
 * Verify that the model's output declares the required protected categories
 * in its protectedCategoriesRetained array.
 *
 * Returns true if all required categories are declared retained.
 * Returns false if any required protected category is missing.
 *
 * Canonical: docs/27 §8.6 step 3, §10 Layer 3.
 */
function verifyProtectedCategories(output: Record<string, unknown>): boolean {
  const retained = output['protectedCategoriesRetained'];
  if (!Array.isArray(retained)) return false;
  const retainedSet = new Set(retained as string[]);
  for (const category of PROTECTED_CATEGORIES) {
    if (!retainedSet.has(category)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Provider Client Factory for Compressor
// ---------------------------------------------------------------------------

/**
 * Creates a synthetic RuntimeConfig from compressor provider settings,
 * then uses createProviderClient to get a ProviderClient instance.
 * Mirrors the pattern from request-analyzer.ts.
 */
function createCompressorProviderClient(
  providerConfig: CompressorConfig['provider'],
) {
  const syntheticConfig: RuntimeConfig = {
    zam: { endpoint: 'library' },
    provider: {
      name: providerConfig.name,
      model: providerConfig.model,
      apiKeyEnvVar: providerConfig.apiKeyEnvVar,
    },
    workspace: { mode: 'local', rootPath: '.' },
    loop: { maxTurns: 1, timeoutMs: 30000 },
    eventStream: { persistPath: './sessions' },
  };
  return createProviderClient(syntheticConfig);
}

// ---------------------------------------------------------------------------
// §8.2 Activation Logic + Core compressHistory Function
// ---------------------------------------------------------------------------

/**
 * Compress session history into a structured state summary.
 *
 * Activation guard (§8.2):
 *   1. Is compressor enabled? If not → return null (raw history).
 *   2. Count completed turns < minTurnsBeforeCompression? → return null.
 *   3. Estimate raw history tokens < tokenThreshold? → return null.
 *   4. Valid cached summary that is recent enough? → return cached.
 *   5. Otherwise → call LLM for compression.
 *
 * Safety invariant (§8.7): On ANY error, returns a CompressorResult with
 * output=null, compressed=false, fallbackUsed=true. This guarantees the
 * caller always uses full raw history — identical to pre-M3 behavior.
 *
 * Canonical: docs/27 §8.1, §8.2, §8.6, §8.7, §10.
 *
 * @param entries       All EventStream entries for the session.
 * @param sessionId     The stable session identifier.
 * @param config        The compressor configuration.
 * @param cachedOutput  Optional previously cached CompressorResult (for reuse).
 * @returns             A CompressorResult. output is null when compression is
 *                      not applied or fails — caller must use raw history.
 */
export async function compressHistory(
  entries: EventStreamEntry[],
  sessionId: string,
  config: CompressorConfig,
  cachedOutput?: CompressorResult | null,
): Promise<CompressorResult> {
  const startTime = Date.now();

  // Helper to build a null/fallback result
  function makeNullResult(
    fallbackUsed: boolean,
    fallbackReason?: string,
  ): CompressorResult {
    return {
      output: null,
      compressed: false,
      rawTurnWindow: [],
      durationMs: Date.now() - startTime,
      fallbackUsed,
      fallbackReason,
      tokensSaved: 0,
    };
  }

  // rawTurnWindow is computed early so catch can always reference it.
  let rawTurnWindow: EventStreamEntry[] = [];

  try {
    // ------- §8.2 Activation Guard -------

    // Guard 1: enabled check
    if (!config.enabled) {
      return makeNullResult(false);
    }

    // Guard 2: turn count check
    const completedTurns = countCompletedTurns(entries);
    if (completedTurns < config.minTurnsBeforeCompression) {
      return makeNullResult(false, `Turns (${completedTurns}) below minTurnsBeforeCompression (${config.minTurnsBeforeCompression})`);
    }

    // Guard 3: token threshold check
    const rawTokenEstimate = estimateHistoryTokens(entries);
    if (rawTokenEstimate < config.tokenThreshold) {
      return makeNullResult(false, `Estimated tokens (${rawTokenEstimate}) below tokenThreshold (${config.tokenThreshold})`);
    }

    // Guard 4: Valid cached result reuse
    // (Caller is responsible for invalidating cache after recompressionTurnInterval new turns)
    if (
      cachedOutput &&
      cachedOutput.compressed &&
      cachedOutput.output !== null
    ) {
      return {
        ...cachedOutput,
        durationMs: Date.now() - startTime,
      };
    }

    // ------- Build the Raw Turn Window -------
    // Computed before LLM call so it is available even if the call fails.
    rawTurnWindow = selectRawTurnWindow(entries, config.rawWindowSize);
    const actualTurnCount = completedTurns;

    // ------- §8.5 Format History for Prompt -------
    const formattedHistory = formatHistory(entries);

    // ------- §8.4 Build the Prompt -------
    const prompt = buildCompressorPrompt(formattedHistory, config.rawWindowSize, actualTurnCount);

    // ------- LLM Call -------
    const client = createCompressorProviderClient(config.provider);

    const response = await withTimeout(
      client.chat({
        messages: [{ role: 'user', content: prompt }],
        model: config.provider.model,
      }),
      config.timeoutMs,
      'History Compressor',
    );

    const responseText = response.text ?? '';

    // ------- §8.6 Step 1: Parse JSON -------
    const parsed = extractJson(responseText);
    if (!parsed) {
      console.warn('[ZAM Compressor] Failed to extract JSON from model response.');
      return {
        ...makeNullResult(true, 'Failed to extract JSON from model response'),
        rawTurnWindow,
      };
    }

    // ------- §8.6 Step 5: Add metadata -------
    parsed['compressorVersion'] = config.provider.model;
    parsed['sessionId'] = sessionId;
    parsed['compressionTraceId'] = randomUUID();

    // Ensure fail-open defaults if model did not provide them
    if (parsed['failOpenTriggered'] === undefined) {
      parsed['failOpenTriggered'] = false;
    }
    if (parsed['failOpenReason'] === undefined) {
      parsed['failOpenReason'] = null;
    }

    // Ensure token fields are integers (model may return floats)
    if (typeof parsed['totalRawTokensApprox'] === 'number') {
      parsed['totalRawTokensApprox'] = Math.round(parsed['totalRawTokensApprox'] as number);
    } else {
      parsed['totalRawTokensApprox'] = rawTokenEstimate;
    }
    if (typeof parsed['compressedTokensApprox'] === 'number') {
      parsed['compressedTokensApprox'] = Math.round(parsed['compressedTokensApprox'] as number);
    } else {
      parsed['compressedTokensApprox'] = 0;
    }

    // ------- §8.6 Step 2: Schema validate -------
    const validate = getValidator();
    if (!validate(parsed)) {
      const errMsg = validate.errors?.[0]?.message ?? 'Unknown schema error';
      console.warn(`[ZAM Compressor] Schema validation failed: ${errMsg}`);
      return {
        ...makeNullResult(true, `Schema validation failed: ${errMsg}`),
        rawTurnWindow,
      };
    }

    // Cast to typed output after schema validation passes
    const output = parsed as unknown as HistoryCompressorOutput;

    // ------- §8.6 Step 3: Enforce protection invariants -------
    if (!verifyProtectedCategories(parsed)) {
      console.warn('[ZAM Compressor] Protected categories not retained in output. Falling back to raw history.');
      return {
        ...makeNullResult(true, 'Protected categories not retained in compressor output'),
        rawTurnWindow,
      };
    }

    // ------- §8.6 Step 4: Enforce fail-open invariants -------
    const confidence = output.compressionConfidence;
    if (confidence < config.confidenceThreshold) {
      output.failOpenTriggered = true;
      output.failOpenReason = output.failOpenReason ?? `Confidence ${confidence} below threshold ${config.confidenceThreshold}`;
    }

    // ------- Compute token savings -------
    const compressedTokens = output.compressedTokensApprox;
    const tokensSaved = Math.max(0, rawTokenEstimate - compressedTokens);

    return {
      output,
      compressed: true,
      rawTurnWindow,
      durationMs: Date.now() - startTime,
      fallbackUsed: false,
      tokensSaved,
    };

  } catch (error) {
    // ------- §8.7 Global Error Handler -------
    // Any unhandled error (API error, timeout, etc.) → return null result.
    // This is the core safety guarantee: compressor can never block the pipeline.
    const reason = (error as Error).message;
    console.warn(`[ZAM Compressor] Error: ${reason}`);
    // Include rawTurnWindow if it was computed before the error occurred.
    return {
      ...makeNullResult(true, reason),
      rawTurnWindow,
    };
  }
}
