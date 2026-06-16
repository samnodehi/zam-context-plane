/**
 * ZAM SDK — Main entry point.
 *
 * Exports the ZAMClient class, all TypeScript types, and all error classes.
 * Consumers import from '@zamapi/sdk'.
 *
 * @example
 * ```typescript
 * import { ZAMClient, ZAMAuthenticationError } from '@zamapi/sdk';
 * import type { PlanRequest, PlanResponse } from '@zamapi/sdk';
 * ```
 *
 * Canonical: docs/31 §5 DQ-10.
 */

// Client class
export { ZAMClient } from './client.js';

// All public types
export type {
  ZAMClientOptions,
  PlanRequest,
  PlanResponse,
  TraceRequest,
  TraceResponse,
  EvaluateRequest,
  EvaluateExpected,
  EvaluateResponse,
  EvaluateViolation,
  HealthResponse,
  ZAMErrorResponse,
} from './types.js';

// All error classes
export {
  ZAMError,
  ZAMAuthenticationError,
  ZAMValidationError,
  ZAMUnprocessableError,
  ZAMServerError,
  ZAMNetworkError,
  ZAMTimeoutError,
} from './errors.js';
