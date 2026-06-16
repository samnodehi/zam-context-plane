// ============================================================================
// ZAM Runtime — ZAM Client (Library API Wrapper)
// Canonical source: docs/18 §7, docs/24 §9
// Phase R2: Thin wrapper that provides the ZamClient interface.
// The actual core pipeline integration is deferred — in Phase R2 this
// is a stub that must be connected to the core before real use.
// ============================================================================

import type { ZamClient, ZamPlanRequestBody, ZamPlanResponse } from './types.js';

/**
 * Create a ZAM client that wraps the core library API.
 *
 * Per docs/18 §7: "The library API must expose the same validation and
 * fail-open guarantees as the HTTP API."
 *
 * Phase R2 note: The core does not yet export a clean `plan()` function
 * matching docs/18 §7. This factory accepts an injected plan function
 * so that:
 * - In production: the caller wires up the actual core pipeline.
 * - In tests: the caller injects a mock.
 *
 * This design avoids a hard compile-time dependency on the core package
 * while maintaining the ZamClient interface contract.
 */
export function createZamClient(
  planFn: (input: ZamPlanRequestBody) => Promise<ZamPlanResponse>,
): ZamClient {
  return new LibraryZamClient(planFn);
}

/**
 * Library API ZAM client — calls the core pipeline in-process.
 * Per R2-Q2: Library API (in-process), no HTTP server needed.
 */
class LibraryZamClient implements ZamClient {
  private readonly planFn: (input: ZamPlanRequestBody) => Promise<ZamPlanResponse>;

  constructor(planFn: (input: ZamPlanRequestBody) => Promise<ZamPlanResponse>) {
    this.planFn = planFn;
  }

  async plan(input: ZamPlanRequestBody): Promise<ZamPlanResponse> {
    // Validate required fields before calling the core
    if (!input.request || typeof input.request.text !== 'string') {
      throw new Error('ZAM client: request.text is required and must be a string.');
    }
    if (!input.registry || typeof input.registry !== 'object') {
      throw new Error('ZAM client: registry is required and must be an object.');
    }

    return this.planFn(input);
  }
}
