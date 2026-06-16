/**
 * ZAM SDK — TypeScript type definitions.
 *
 * All types are defined independently in this file, derived from the
 * docs/18 §4 HTTP API contract. They are NOT imported from or coupled to
 * the ZAM Core (`context-plane`) package.
 *
 * Design decision: Complex nested types such as `PromptPlan`, `Trace`, and
 * `ComponentRegistryEntry` are typed as `Record<string, unknown>`. The SDK
 * is a pure transport layer — it does not validate or interpret the internal
 * structure of these objects. All schema validation is performed server-side.
 * This decoupling ensures the SDK remains stable as the server's internal
 * schemas evolve.
 *
 * Canonical: docs/31 §5 DQ-12; docs/18 §4.
 */

// =============================================================================
// Client Options
// =============================================================================

/**
 * Configuration options for the ZAMClient constructor.
 * Canonical: docs/31 §5 DQ-11.
 */
export interface ZAMClientOptions {
  /**
   * Base URL of the ZAM API server.
   * Example: "http://localhost:3001"
   * Must NOT have a trailing slash.
   */
  baseUrl: string;

  /**
   * API key sent in the X-ZAM-API-Key header.
   * Omit if the server is running in local-only mode (no ZAM_API_KEY set).
   */
  apiKey?: string;

  /**
   * Request timeout in milliseconds.
   * Applies per request (not per retry attempt).
   * Default: 30000 (30 seconds).
   */
  timeout?: number;

  /**
   * Number of automatic retries on network error.
   * Only retries on network failures (fetch rejection), NOT on HTTP error responses.
   * Default: 0 (no retries).
   */
  retries?: number;
}

// =============================================================================
// POST /plan
// =============================================================================

/**
 * Request body for POST /plan.
 * Canonical: docs/18 §4.2.
 *
 * Only `request` and `registry` are required. All other fields are optional
 * and trigger class-B fallback behavior when absent.
 *
 * Complex nested types (registry, tools, skills, history, budget, riskPolicy,
 * userConstraints) are typed as `Record<string, unknown>` — the SDK passes
 * them through to the server, which performs all schema validation.
 */
export interface PlanRequest {
  /** The planning request — must contain a non-empty `text` string field. */
  request: {
    text: string;
    metadata?: Record<string, unknown>;
  };

  /**
   * Component registry — array of component entries.
   * Validated server-side against component.schema.json.
   * Typed as array of opaque objects to avoid coupling with server schemas.
   */
  registry: Record<string, unknown>[];

  /**
   * Tool definitions, validated server-side against tools.schema.json.
   * Optional — triggers class-B fallback when absent.
   */
  tools?: Record<string, unknown>;

  /**
   * Skill definitions, validated server-side against skills.schema.json.
   * Optional — triggers class-B fallback when absent.
   */
  skills?: Record<string, unknown>;

  /**
   * History state, validated server-side against history-state-summary.schema.json.
   * Optional — triggers class-B fallback when absent.
   */
  history?: Record<string, unknown>;

  /**
   * Budget constraints, validated server-side against budget.schema.json.
   * Optional — triggers class-B fallback when absent.
   */
  budget?: Record<string, unknown>;

  /**
   * Risk policy, validated server-side against risk-policy.schema.json.
   * Optional — triggers class-B fallback when absent.
   */
  riskPolicy?: Record<string, unknown>;

  /**
   * User constraints, validated server-side against user-constraints.schema.json.
   * Optional — triggers class-B fallback when absent.
   */
  userConstraints?: Record<string, unknown>;
}

/**
 * Response body from POST /plan (HTTP 200).
 * Canonical: docs/18 §4.2.
 *
 * `promptPlan` and `trace` are typed as `Record<string, unknown>` — the SDK
 * does not interpret their internal structure. Consumers may cast them to
 * their own typed interfaces if needed.
 */
export interface PlanResponse {
  /**
   * The generated prompt plan (prompt-plan.json structure).
   * Contains selectedComponents, omittedComponents, deferredComponents, etc.
   */
  promptPlan: Record<string, unknown>;

  /**
   * Full planning trace (trace.json structure).
   * Contains per-phase decision evidence for auditability.
   */
  trace: Record<string, unknown>;

  /**
   * Human-readable planning summary (summary.md content as a string).
   */
  summary: string;
}

// =============================================================================
// POST /trace
// =============================================================================

/**
 * Request body for POST /trace.
 * Canonical: docs/18 §4.3.
 */
export interface TraceRequest {
  /**
   * A trace object produced by a prior POST /plan call.
   * The server accepts any JSON object and explains what it finds.
   */
  trace: Record<string, unknown>;
}

/**
 * Response body from POST /trace (HTTP 200).
 * Canonical: docs/18 §4.3.
 */
export interface TraceResponse {
  /**
   * Human-readable narrative explaining all decisions in the trace.
   * Useful for debugging, operator review, and audit tooling.
   */
  explanation: string;
}

// =============================================================================
// POST /evaluate
// =============================================================================

/**
 * Expected outputs for POST /evaluate comparison.
 * Both fields are optional — if absent, their comparison layer is skipped.
 * Canonical: docs/18 §4.4; src/http/routes/evaluate.ts EvaluateExpected.
 */
export interface EvaluateExpected {
  /** Expected prompt-plan structure (partition comparison). */
  promptPlan?: Record<string, unknown>;
  /** Expected trace structure (top-level phase key comparison). */
  trace?: Record<string, unknown>;
}

/**
 * Request body for POST /evaluate.
 * Canonical: docs/18 §4.4.
 */
export interface EvaluateRequest {
  /** Caller-supplied fixture identifier — returned verbatim in response. */
  fixtureId: string;

  /**
   * Planning pipeline input — same shape as POST /plan request body.
   * The server runs the full 11-phase pipeline on this input.
   */
  input: PlanRequest;

  /**
   * Expected outputs to compare actual results against.
   * Optional — if absent, no comparison is performed.
   */
  expected?: EvaluateExpected;
}

/**
 * A single field-level violation found during output comparison.
 * Canonical: src/http/routes/evaluate.ts EvaluateViolation.
 */
export interface EvaluateViolation {
  field: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

/**
 * Response body from POST /evaluate (HTTP 200).
 * Canonical: docs/18 §4.4.
 */
export interface EvaluateResponse {
  /** Echo of the fixtureId supplied in the request. */
  fixtureId: string;

  /** true if no violations were found; false otherwise. */
  passed: boolean;

  /** List of comparison violations. Empty array when passed === true. */
  violations: EvaluateViolation[];

  /** The actual prompt plan produced by the pipeline. */
  actualPlan: Record<string, unknown>;

  /** The actual trace produced by the pipeline. */
  actualTrace: Record<string, unknown>;
}

// =============================================================================
// GET /health
// =============================================================================

/**
 * Response body from GET /health (HTTP 200).
 * Canonical: src/http/routes/health.ts.
 */
export interface HealthResponse {
  /** Always "ok" when the server is alive. */
  status: 'ok';

  /** Server version, read from package.json at startup. */
  version: string;
}

// =============================================================================
// Error response shape (internal — used by ZAMClient)
// =============================================================================

/**
 * Standard error response body returned by the server on 4xx/5xx responses.
 * Canonical: docs/18 §4.5; src/http/errors.ts.
 */
export interface ZAMErrorResponse {
  error: {
    /** Closed set of error codes defined by the HTTP service. */
    code: string;
    /** Human-readable error message. */
    message: string;
    /**
     * Optional field-level details.
     * Present for VALIDATION_ERROR and UNPROCESSABLE_REQUEST responses.
     */
    details?: unknown;
  };
}
