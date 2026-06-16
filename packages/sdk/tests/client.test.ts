/**
 * ZAM SDK — ZAMClient unit tests.
 *
 * Tests use Vitest's `vi.stubGlobal` to mock the global `fetch` function.
 * No real HTTP server is required.
 *
 * Coverage:
 *  1.  health() returns { status: 'ok', version: '0.1.0' } on 200
 *  2.  plan() sends correct POST body and returns parsed response on 200
 *  3.  trace() sends correct POST body and returns parsed response on 200
 *  4.  evaluate() sends correct POST body and returns parsed response on 200
 *  5.  plan() with apiKey sends X-ZAM-API-Key header
 *  6.  plan() without apiKey does NOT send X-ZAM-API-Key header
 *  7.  401 response throws ZAMAuthenticationError
 *  8.  400 response throws ZAMValidationError with details
 *  9.  422 response throws ZAMUnprocessableError
 *  10. 500 response throws ZAMServerError
 *  11. Network failure (fetch rejects) throws ZAMNetworkError
 *  12. Timeout throws ZAMTimeoutError
 *  13. Retry succeeds on second attempt after network failure
 *  14. Retry exhausted still throws ZAMNetworkError
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZAMClient } from '../src/client.js';
import {
  ZAMAuthenticationError,
  ZAMValidationError,
  ZAMUnprocessableError,
  ZAMServerError,
  ZAMNetworkError,
  ZAMTimeoutError,
} from '../src/errors.js';
import type { PlanRequest, EvaluateRequest, TraceRequest } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock Response with a JSON body. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Minimal valid PlanRequest for testing. */
const minimalPlanRequest: PlanRequest = {
  request: { text: 'Test planning request' },
  registry: [{ id: 'ctx-1', type: 'system', content: 'You are a test assistant.' }],
};

/** Minimal valid TraceRequest for testing. */
const minimalTraceRequest: TraceRequest = {
  trace: { phase1: { decisions: [] }, phase2: { decisions: [] } },
};

/** Minimal valid EvaluateRequest for testing. */
const minimalEvaluateRequest: EvaluateRequest = {
  fixtureId: 'fixture-01',
  input: minimalPlanRequest,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZAMClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────

  it('1. health() returns { status: "ok", version: "0.1.0" } on 200', async () => {
    const healthBody = { status: 'ok', version: '0.1.0' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, healthBody)));

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });
    const result = await client.health();

    expect(result).toEqual({ status: 'ok', version: '0.1.0' });
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────

  it('2. plan() sends correct POST body and returns parsed response on 200', async () => {
    const planBody = {
      promptPlan: { selectedComponents: [] },
      trace: { phase1: {} },
      summary: 'Test summary',
    };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200, planBody));
    vi.stubGlobal('fetch', mockFetch);

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });
    const result = await client.plan(minimalPlanRequest);

    expect(result).toEqual(planBody);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/plan');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(minimalPlanRequest);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────

  it('3. trace() sends correct POST body and returns parsed response on 200', async () => {
    const traceResponseBody = { explanation: 'Phase 1 selected component ctx-1 because...' };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200, traceResponseBody));
    vi.stubGlobal('fetch', mockFetch);

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });
    const result = await client.trace(minimalTraceRequest);

    expect(result).toEqual(traceResponseBody);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/trace');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(minimalTraceRequest);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────

  it('4. evaluate() sends correct POST body and returns parsed response on 200', async () => {
    const evaluateResponseBody = {
      fixtureId: 'fixture-01',
      passed: true,
      violations: [],
      actualPlan: { selectedComponents: [] },
      actualTrace: { phase1: {} },
    };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(200, evaluateResponseBody));
    vi.stubGlobal('fetch', mockFetch);

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });
    const result = await client.evaluate(minimalEvaluateRequest);

    expect(result).toEqual(evaluateResponseBody);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/evaluate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(minimalEvaluateRequest);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────

  it('5. plan() with apiKey sends X-ZAM-API-Key header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, { promptPlan: {}, trace: {}, summary: '' }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const client = new ZAMClient({
      baseUrl: 'http://localhost:3001',
      apiKey: 'test-secret-key',
    });
    await client.plan(minimalPlanRequest);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-ZAM-API-Key']).toBe('test-secret-key');
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────

  it('6. plan() without apiKey does NOT send X-ZAM-API-Key header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse(200, { promptPlan: {}, trace: {}, summary: '' }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });
    await client.plan(minimalPlanRequest);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-ZAM-API-Key']).toBeUndefined();
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────

  it('7. 401 response throws ZAMAuthenticationError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(401, { error: { code: 'AUTH_ERROR', message: 'Invalid API key.', details: [] } }),
      ),
    );

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001', apiKey: 'wrong-key' });
    await expect(client.plan(minimalPlanRequest)).rejects.toBeInstanceOf(ZAMAuthenticationError);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────

  it('8. 400 response throws ZAMValidationError with details', async () => {
    const errorDetails = [{ field: 'registry', message: 'must be an array' }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(400, {
          error: { code: 'VALIDATION_ERROR', message: '"registry" must be an array.', details: errorDetails },
        }),
      ),
    );

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });

    let caughtError: unknown;
    try {
      await client.plan(minimalPlanRequest);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ZAMValidationError);
    const validationErr = caughtError as ZAMValidationError;
    expect(validationErr.statusCode).toBe(400);
    expect(validationErr.details).toEqual(errorDetails);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────

  it('9. 422 response throws ZAMUnprocessableError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(422, {
          error: { code: 'UNPROCESSABLE_REQUEST', message: 'Registry fatal error.', details: [] },
        }),
      ),
    );

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });
    await expect(client.plan(minimalPlanRequest)).rejects.toBeInstanceOf(ZAMUnprocessableError);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────

  it('10. 500 response throws ZAMServerError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(500, {
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error.', details: [] },
        }),
      ),
    );

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });

    let caughtError: unknown;
    try {
      await client.plan(minimalPlanRequest);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ZAMServerError);
    const serverErr = caughtError as ZAMServerError;
    expect(serverErr.statusCode).toBe(500);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────

  it('11. Network failure (fetch rejects) throws ZAMNetworkError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001' });
    await expect(client.plan(minimalPlanRequest)).rejects.toBeInstanceOf(ZAMNetworkError);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────

  it('12. Timeout throws ZAMTimeoutError', async () => {
    // Simulate a fetch that never resolves within the timeout
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          // Listen for abort signal from ZAMClient's AbortController
          const signal = init?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener('abort', () => {
              const abortError = new Error('The operation was aborted.');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          }
        });
      }),
    );

    // Use a very short timeout to trigger quickly in tests
    const client = new ZAMClient({ baseUrl: 'http://localhost:3001', timeout: 50 });

    await expect(client.plan(minimalPlanRequest)).rejects.toBeInstanceOf(ZAMTimeoutError);
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────

  it('13. Retry succeeds on second attempt after network failure', async () => {
    const successBody = { promptPlan: { selectedComponents: [] }, trace: {}, summary: 'ok' };
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network error on attempt 1'))
      .mockResolvedValueOnce(mockResponse(200, successBody));

    vi.stubGlobal('fetch', mockFetch);

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001', retries: 1 });
    const result = await client.plan(minimalPlanRequest);

    expect(result).toEqual(successBody);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────

  it('14. Retry exhausted still throws ZAMNetworkError', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Persistent network failure'));

    vi.stubGlobal('fetch', mockFetch);

    const client = new ZAMClient({ baseUrl: 'http://localhost:3001', retries: 2 });

    await expect(client.plan(minimalPlanRequest)).rejects.toBeInstanceOf(ZAMNetworkError);
    // retries: 2 means 3 total attempts (1 initial + 2 retries)
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
