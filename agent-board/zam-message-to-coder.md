# Instruction for Coder — Phase V4-E (Developer Documentation)

## Objective
Write production-grade developer documentation for the newly repaired and verified `@zamapi/sdk`. The goal is to produce a comprehensive, customer-ready `README.md` that serves as the official API reference, quickstart guide, and integration manual for developers using ZAM in their runtimes.

## Allowed Files
- `packages/sdk/README.md` (CREATE or OVERWRITE)
- `agent-board/zam-coder-report.md` (OVERWRITE)

## Forbidden Files
- You MUST NOT touch any `.ts` source files, tests, schemas, or fixtures.
- You MUST NOT touch `packages/runtime/` or any files outside the `packages/sdk/` docs.
- You MUST NOT modify `package.json` or `vitest.config.ts`.
- You MUST NOT touch forbidden directories like `.gemini` or `~/.openclaw`.

## Required Reads
1. `packages/sdk/src/client.ts` (for method signatures, default behaviors, and retry logic)
2. `packages/sdk/src/types.ts` (for request/response shapes)
3. `packages/sdk/src/errors.ts` (for the error class hierarchy)
4. `docs/18_HTTP_API_AND_ADAPTER_SPEC.md` (for the underlying HTTP contract)

## Exact Requested Actions
1. Read the SDK source files to understand the exact API surface, types, and error classes exported by the SDK.
2. Create or overwrite `packages/sdk/README.md`.
3. Write a high-quality, production-grade documentation document that includes at minimum:
   - **Introduction:** What the SDK is (a lightweight, zero-dependency HTTP client for the ZAM Context Governance API).
   - **Installation:** How to install it (e.g., `npm install @zamapi/sdk` — assume it will be published).
   - **Quickstart:** A short, complete code example showing how to initialize the client and make a `plan()` request.
   - **API Reference:** Detailed documentation of the `ZAMClient` constructor options, methods (`plan`, `trace`, `evaluate`, `health`), their parameters, and return types.
   - **Error Handling:** Documentation of the custom error classes (`ZAMAuthenticationError`, `ZAMNetworkError`, etc.) and how to catch/handle them.
   - **TypeScript Integration:** A brief note on how to import and use the provided types.
4. The documentation MUST reflect the code exactly as it currently exists. Do not invent features or endpoints that do not exist.
5. Write your actions into `agent-board/zam-coder-report.md`.

## Verification Requirements
- Ensure `packages/sdk/README.md` is valid Markdown.
- Ensure all code examples are syntactically correct TypeScript.
- Verify that the API methods described match the actual `client.ts` exactly.

## Report Requirements
Overwrite `agent-board/zam-coder-report.md` with:
- Status (COMPLETE / BLOCKED)
- Files read
- Files changed
- A brief summary of the documentation sections created.

## Stop Condition
Stop immediately after writing the report. Do not start a second pass. Do not write `zam-reviewer-feedback.md`.