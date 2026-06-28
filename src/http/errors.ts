/**
 * Standard error response builder for the ZAM HTTP Service.
 *
 * All error responses (4xx, 5xx) use the closed structure defined in
 * docs/18 §4.5. No provider-specific error codes appear.
 *
 * Error code enum is closed — no new codes may be added without canonical
 * approval and a matching update to this file.
 *
 * Canonical: docs/18 §4.5.
 */

/** Closed set of error codes returned by the HTTP service. */
export type HttpErrorCode =
  | 'VALIDATION_ERROR'      // 400: request payload schema validation failed
  | 'AUTH_ERROR'            // 401: missing or invalid API key
  | 'FORBIDDEN'             // 403: rejected by the local-network guard (non-loopback Host / cross-origin Origin)
  | 'UNPROCESSABLE_REQUEST' // 422: valid input but semantically unprocessable (Class A failure)
  | 'PLANNING_ERROR'        // 500: internal planning pipeline error
  | 'INTERNAL_ERROR';       // 500: unexpected internal error

export interface HttpErrorDetail {
  field?: string;
  message: string;
}

export interface HttpErrorResponse {
  error: {
    code: HttpErrorCode;
    message: string;
    details: HttpErrorDetail[];
  };
}

/**
 * Build a standard HTTP error response body.
 * Canonical: docs/18 §4.5.
 */
export function buildError(
  code: HttpErrorCode,
  message: string,
  details: HttpErrorDetail[] = [],
): HttpErrorResponse {
  return { error: { code, message, details } };
}
