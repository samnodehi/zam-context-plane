/**
 * ZAM SDK — Error class hierarchy.
 *
 * All SDK errors extend ZAMError. Raw fetch errors and HTTP error responses
 * are always wrapped — consumers never see raw network primitives or
 * unparsed HTTP responses.
 *
 * Canonical: docs/31 §5 DQ-13.
 */

// =============================================================================
// Base error class
// =============================================================================

/**
 * Base class for all ZAM SDK errors.
 *
 * @param message   Human-readable error description.
 * @param statusCode HTTP status code, or null for network/timeout errors.
 * @param code      Machine-readable error code from the server, or SDK-generated code.
 * @param details   Optional structured details from the server error response.
 */
export class ZAMError extends Error {
  public readonly statusCode: number | null;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number | null,
    code: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ZAMError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Restore prototype chain (required when extending built-ins in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// =============================================================================
// HTTP error subclasses
// =============================================================================

/**
 * Thrown when the server returns HTTP 401 Unauthorized.
 * The server's ZAM_API_KEY is set but the request did not supply the correct key,
 * or no key was supplied and the server requires authentication.
 */
export class ZAMAuthenticationError extends ZAMError {
  constructor(message: string, details?: unknown) {
    super(message, 401, 'AUTH_ERROR', details);
    this.name = 'ZAMAuthenticationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the server returns HTTP 400 Bad Request.
 * The request payload failed schema validation.
 * `details` contains field-level validation errors from the server.
 */
export class ZAMValidationError extends ZAMError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ZAMValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the server returns HTTP 422 Unprocessable Content.
 * The request payload is structurally valid but semantically unprocessable —
 * for example, an empty registry or a registry that causes a fatal planning error.
 * `details` may contain additional context from the server.
 */
export class ZAMUnprocessableError extends ZAMError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'UNPROCESSABLE_REQUEST', details);
    this.name = 'ZAMUnprocessableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the server returns HTTP 5xx (server-side error).
 * Indicates an internal planning pipeline error or unexpected server failure.
 * `details` may contain additional context from the server error response.
 */
export class ZAMServerError extends ZAMError {
  constructor(message: string, statusCode: number, details?: unknown) {
    super(message, statusCode, 'SERVER_ERROR', details);
    this.name = 'ZAMServerError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// =============================================================================
// Network error subclasses (no HTTP response available)
// =============================================================================

/**
 * Thrown when a network-level failure occurs before an HTTP response is received.
 * This includes DNS resolution failures, connection refused, and other fetch rejections.
 * `statusCode` is always null.
 */
export class ZAMNetworkError extends ZAMError {
  constructor(message: string, details?: unknown) {
    super(message, null, 'NETWORK_ERROR', details);
    this.name = 'ZAMNetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a request exceeds the configured `timeout` option.
 * Extends ZAMNetworkError because no HTTP response is available.
 * `statusCode` is always null.
 */
export class ZAMTimeoutError extends ZAMNetworkError {
  constructor(message: string) {
    super(message);
    this.name = 'ZAMTimeoutError';
    // Override code set by ZAMNetworkError
    (this as { code: string }).code = 'TIMEOUT_ERROR';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
