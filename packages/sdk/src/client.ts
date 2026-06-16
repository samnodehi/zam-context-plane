/**
 * ZAM SDK — ZAMClient HTTP client.
 *
 * A standalone HTTP client for the ZAM Context Governance API.
 * Uses the global `fetch` API (Node 18+ built-in — no external HTTP library).
 *
 * Features:
 * - Per-request timeout via AbortController
 * - Automatic retry on network errors (not on HTTP error responses)
 * - Consistent error mapping to ZAMError subclasses
 * - Optional API key authentication via X-ZAM-API-Key header
 *
 * Canonical: docs/31 §5 DQ-11; docs/18 §4.
 */

import type {
  ZAMClientOptions,
  PlanRequest,
  PlanResponse,
  TraceRequest,
  TraceResponse,
  EvaluateRequest,
  EvaluateResponse,
  HealthResponse,
  ZAMErrorResponse,
} from './types.js';

import {
  ZAMError,
  ZAMAuthenticationError,
  ZAMValidationError,
  ZAMUnprocessableError,
  ZAMServerError,
  ZAMNetworkError,
  ZAMTimeoutError,
} from './errors.js';

/** Default timeout in milliseconds if not specified in options. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Default number of retries if not specified in options. */
const DEFAULT_RETRIES = 0;

/**
 * HTTP client for the ZAM Context Governance API.
 *
 * @example
 * ```typescript
 * import { ZAMClient } from '@zamapi/sdk';
 *
 * const zam = new ZAMClient({
 *   baseUrl: 'http://localhost:3001',
 *   apiKey: 'your-api-key',   // omit if server is in local-only mode
 *   timeout: 30000,           // default: 30 seconds
 *   retries: 0,               // default: no retries
 * });
 *
 * const result = await zam.plan({
 *   request: { text: 'Analyze this codebase' },
 *   registry: [{ id: 'ctx-1', ... }],
 * });
 * console.log(result.promptPlan);
 * ```
 */
export class ZAMClient {
  private readonly _baseUrl: string;
  private readonly _apiKey: string | undefined;
  private readonly _timeout: number;
  private readonly _retries: number;

  constructor(options: ZAMClientOptions) {
    // Remove trailing slash so path concatenation is always clean
    this._baseUrl = options.baseUrl.replace(/\/+$/, '');
    this._apiKey = options.apiKey;
    this._timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this._retries = options.retries ?? DEFAULT_RETRIES;
  }

  // ===========================================================================
  // Public API methods
  // ===========================================================================

  /**
   * Submit a context planning request.
   * Calls POST /plan and returns the prompt plan, trace, and summary.
   *
   * @throws {ZAMAuthenticationError} Server returned 401 — invalid or missing API key.
   * @throws {ZAMValidationError}     Server returned 400 — request payload validation failed.
   * @throws {ZAMUnprocessableError}  Server returned 422 — valid input but unprocessable (e.g., empty registry).
   * @throws {ZAMServerError}         Server returned 5xx — internal server error.
   * @throws {ZAMTimeoutError}        Request exceeded the configured timeout.
   * @throws {ZAMNetworkError}        Network-level failure before HTTP response received.
   */
  async plan(request: PlanRequest): Promise<PlanResponse> {
    return this._request<PlanResponse>('POST', '/plan', request);
  }

  /**
   * Explain a trace produced by a prior /plan call.
   * Calls POST /trace and returns a human-readable explanation.
   *
   * @throws {ZAMAuthenticationError} Server returned 401.
   * @throws {ZAMValidationError}     Server returned 400.
   * @throws {ZAMServerError}         Server returned 5xx.
   * @throws {ZAMTimeoutError}        Request timed out.
   * @throws {ZAMNetworkError}        Network failure.
   */
  async trace(request: TraceRequest): Promise<TraceResponse> {
    return this._request<TraceResponse>('POST', '/trace', request);
  }

  /**
   * Run fixture-based evaluation of the planning pipeline.
   * Calls POST /evaluate and returns the comparison result.
   *
   * @throws {ZAMAuthenticationError} Server returned 401.
   * @throws {ZAMValidationError}     Server returned 400.
   * @throws {ZAMUnprocessableError}  Server returned 422.
   * @throws {ZAMServerError}         Server returned 5xx.
   * @throws {ZAMTimeoutError}        Request timed out.
   * @throws {ZAMNetworkError}        Network failure.
   */
  async evaluate(request: EvaluateRequest): Promise<EvaluateResponse> {
    return this._request<EvaluateResponse>('POST', '/evaluate', request);
  }

  /**
   * Check if the ZAM server is alive.
   * Calls GET /health — does NOT require authentication (auth bypass by design).
   *
   * @throws {ZAMServerError}   Server returned 5xx.
   * @throws {ZAMTimeoutError}  Request timed out.
   * @throws {ZAMNetworkError}  Server unreachable.
   */
  async health(): Promise<HealthResponse> {
    return this._request<HealthResponse>('GET', '/health');
  }

  // ===========================================================================
  // Private request helper
  // ===========================================================================

  /**
   * Internal method that executes one HTTP request with timeout, retry,
   * and error mapping.
   *
   * @param method  HTTP method ('GET' | 'POST').
   * @param path    URL path (e.g. '/plan', '/health'). Must start with '/'.
   * @param body    Optional request body (serialized to JSON for POST requests).
   * @returns       Parsed JSON response body.
   */
  private async _request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this._baseUrl}${path}`;
    const attemptsAllowed = this._retries + 1;

    let lastError: ZAMError | undefined;

    for (let attempt = 1; attempt <= attemptsAllowed; attempt++) {
      try {
        return await this._executeOnce<T>(method, url, body);
      } catch (err) {
        if (err instanceof ZAMNetworkError) {
          // Network errors (including timeout) are retried
          lastError = err;
          // On the last attempt, fall through and throw below
          if (attempt < attemptsAllowed) {
            continue;
          }
        } else {
          // HTTP errors (4xx, 5xx) are NOT retried — throw immediately
          throw err;
        }
      }
    }

    // All attempts exhausted with network errors
    throw lastError!;
  }

  /**
   * Execute a single HTTP request attempt with timeout support.
   * Maps HTTP status codes and network failures to ZAMError subclasses.
   */
  private async _executeOnce<T>(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this._apiKey !== undefined) {
      headers['X-ZAM-API-Key'] = this._apiKey;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (method === 'POST' && body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;

    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      clearTimeout(timeoutId);

      // AbortController fires when setTimeout calls controller.abort()
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR')
      ) {
        throw new ZAMTimeoutError(
          `Request to ${url} timed out after ${this._timeout}ms.`,
        );
      }

      // All other fetch rejections are network errors
      throw new ZAMNetworkError(
        `Network error on request to ${url}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    clearTimeout(timeoutId);

    // Success path
    if (response.ok) {
      const json = await response.json() as T;
      return json;
    }

    // Error path — parse server error response
    let errorBody: ZAMErrorResponse | undefined;
    try {
      errorBody = await response.json() as ZAMErrorResponse;
    } catch {
      // Response body is not valid JSON — construct minimal error
      errorBody = undefined;
    }

    const code = errorBody?.error?.code ?? 'UNKNOWN_ERROR';
    const message =
      errorBody?.error?.message ??
      `Server returned HTTP ${response.status}`;
    const details = errorBody?.error?.details;

    switch (response.status) {
      case 401:
        throw new ZAMAuthenticationError(message, details);
      case 400:
        throw new ZAMValidationError(message, details);
      case 422:
        throw new ZAMUnprocessableError(message, details);
      default:
        if (response.status >= 500) {
          throw new ZAMServerError(message, response.status, details);
        }
        // Unexpected 4xx (e.g., 404, 405) — wrap as generic ZAMError
        throw new ZAMError(message, response.status, code, details);
    }
  }
}
