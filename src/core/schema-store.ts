/**
 * Central, bundler-safe schema + AJV access.
 *
 * Replaces the former per-module `createRequire(import.meta.url)` + disk-relative
 * `resolveSchemaBase()` loading. Schemas are inlined (src/generated/schemas.ts, a
 * build artifact) and AJV is a static import, so ZAM bundles into a single
 * executable (esbuild / Node SEA / bun) and performs **no schema disk I/O at
 * runtime**. Behavior is identical to the old disk loader: `getSchema(relPath)`
 * returns the same object keyed by the same path relative to `schemas/`.
 *
 * Canonical: docs/21 §2 IQ-3 (validation); docs/18 §4.1.
 */
import ajv2020Module from 'ajv/dist/2020.js';

import { EMBEDDED_SCHEMAS } from '../generated/schemas.js';

/**
 * AJV validate-function shape returned by `ajv.compile()`. Exported so tests can
 * construct a compatible fake validator without depending on the AJV runtime.
 */
export type ValidateFn = {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }>;
};

/** Minimal AJV instance surface used across ZAM. */
export type AjvInstance = {
  addSchema(schema: unknown): AjvInstance;
  compile(schema: unknown): ValidateFn;
};

type AjvCtor = new (opts?: Record<string, unknown>) => AjvInstance;

// `ajv/dist/2020` is CJS. With esModuleInterop the class is the default export's
// `.default` (matching the prior `require('ajv/dist/2020').default`); the `??`
// fallback covers bundlers/interop shapes where the module itself is the class.
const Ajv2020: AjvCtor =
  (ajv2020Module as unknown as { default?: AjvCtor }).default ??
  (ajv2020Module as unknown as AjvCtor);

/** Construct an AJV draft 2020-12 instance. */
export function createAjv2020(opts?: Record<string, unknown>): AjvInstance {
  return new Ajv2020(opts);
}

/**
 * Return an inlined schema by its path relative to `schemas/` (POSIX), e.g.
 * `"shared/enums.shared.schema.json"`. Throws if the key is unknown — a
 * programming error, since the generator embeds every `schemas/**.json`.
 */
export function getSchema(relPath: string): Record<string, unknown> {
  const schema = EMBEDDED_SCHEMAS[relPath];
  if (schema === undefined) {
    throw new Error(`Embedded schema not found: ${relPath}`);
  }
  return schema;
}
