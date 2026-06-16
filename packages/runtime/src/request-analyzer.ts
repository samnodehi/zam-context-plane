// ============================================================================
// ZAM Runtime — Request Analyzer
// Canonical source: docs/25 §6.1–§6.6
// Phase M1-C: Core analyzer module with Tier 0/1/2/3 routing.
// ============================================================================

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import type { AnalyzerConfig } from './types.js';
import type { ProviderClient, RuntimeConfig } from './types.js';
import { createProviderClient } from './provider-client.js';
import { buildTier1AnalyzerPrompt, buildTier2AnalyzerPrompt } from './analyzer-prompt.js';

// ---------------------------------------------------------------------------
// AnalyzerOutput type — mirrors src/types/analyzer.ts exactly.
// Re-declared here because packages/runtime/src cannot import from src/types/
// due to rootDir constraint. Canonical: docs/15 §4; schemas/future/analyzer-output.schema.json.
// ---------------------------------------------------------------------------

export interface AnalyzerOutput {
  analyzerVersion: string;
  tier: 0 | 1 | 2 | 3;
  promptFamily: string;
  requestType?: string;
  taskType?: string;
  analyzerConfidence: number;
  assessedRequestRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  neededLanes: string[];
  requiresHistory: boolean;
  requiresTools: boolean;
  requiresFiles: boolean;
  failOpenTriggered: boolean;
  failOpenReason: string | null;
  evidence: string[];
  analyzerTraceId: string;
}

// ---------------------------------------------------------------------------
// AJV Bootstrap (CJS interop — mirrors src/core/input-loader.ts pattern)
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

let _validateAnalyzerOutput: ValidateFn | null = null;

function getValidator(): ValidateFn {
  if (_validateAnalyzerOutput === null) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Navigate from packages/runtime/src/ to project root schemas/
    const schemaPath = resolve(__dirname, '../../../schemas/future/analyzer-output.schema.json');
    const schemaContent = readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(schemaContent) as Record<string, unknown>;

    const ajv = new AjvCtor({ strict: false, allErrors: false });
    _validateAnalyzerOutput = ajv.compile(schema);
  }
  return _validateAnalyzerOutput;
}

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/**
 * Result wrapper for the analyzer. Contains the AnalyzerOutput (or null on
 * failure/disable), the tier used, timing, and fallback information.
 * Canonical: docs/25 §6.1.
 */
export interface AnalyzerResult {
  output: AnalyzerOutput | null;
  tier: 0 | 1 | 2 | 3;
  durationMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

// ---------------------------------------------------------------------------
// Tier 0 Fast Path — Regex Patterns (docs/25 §6.2)
// ---------------------------------------------------------------------------

const GREETING_PATTERN = /^\s*(hello|hi|hey|howdy|greetings|good\s+(morning|afternoon|evening|day)|yo|sup|hola|salam|salaam)\s*[!?.]*\s*$/i;
const ACKNOWLEDGEMENT_PATTERN = /^\s*(thanks|thank\s+you|ok|okay|got\s+it|sure|alright|yes|yep|yeah|no|nope|understood|roger|cool|great|fine|np|thx|ty)\s*[!?.]*\s*$/i;

function buildTier0Output(promptFamily: string, evidence: string[]): AnalyzerOutput {
  return {
    analyzerVersion: 'tier0-regex',
    tier: 0,
    promptFamily,
    analyzerConfidence: 1.0,
    assessedRequestRiskLevel: 'low',
    neededLanes: [],
    requiresHistory: false,
    requiresTools: false,
    requiresFiles: false,
    failOpenTriggered: false,
    failOpenReason: null,
    evidence,
    analyzerTraceId: randomUUID(),
  };
}

function tryTier0(requestText: string): AnalyzerOutput | null {
  // Empty or whitespace-only
  if (!requestText.trim()) {
    return buildTier0Output('general_default', ['empty_or_whitespace_request']);
  }

  // Greeting
  if (GREETING_PATTERN.test(requestText)) {
    return buildTier0Output('simple_greeting', ['regex_greeting_match']);
  }

  // Acknowledgement
  if (ACKNOWLEDGEMENT_PATTERN.test(requestText)) {
    return buildTier0Output('simple_greeting', ['regex_acknowledgement_match']);
  }

  return null; // Not a Tier 0 match — proceed to LLM
}

// ---------------------------------------------------------------------------
// JSON Extraction from Model Response
// ---------------------------------------------------------------------------

/**
 * Extract JSON from a model response, handling markdown code fences
 * and trailing text that some models produce.
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
// Provider Client Factory for Analyzer
// ---------------------------------------------------------------------------

/**
 * Creates a synthetic RuntimeConfig from analyzer provider settings,
 * then uses createProviderClient to get a ProviderClient instance.
 */
function createAnalyzerProviderClient(
  providerConfig: AnalyzerConfig['provider'],
): ProviderClient {
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
// Timeout Helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core Analyzer Function
// ---------------------------------------------------------------------------

/**
 * Analyze a user request using a lightweight model.
 * Returns a validated AnalyzerOutput or null if the analyzer is
 * disabled, timed out, or encountered an error.
 *
 * Safety invariant: On ANY error, returns null (fallback to deterministic).
 * The caller passes null to plan() which means deterministic-only routing.
 *
 * Canonical: docs/25 §6.1.
 */
export async function analyzeRequest(
  requestText: string,
  config: AnalyzerConfig,
): Promise<AnalyzerResult> {
  const startTime = Date.now();

  // ------- Disabled Check -------
  if (!config.enabled) {
    return { output: null, tier: 0, durationMs: 0, fallbackUsed: false };
  }

  // ------- Tier 0 Fast Path -------
  const tier0Result = tryTier0(requestText);
  if (tier0Result) {
    return {
      output: tier0Result,
      tier: 0,
      durationMs: Date.now() - startTime,
      fallbackUsed: false,
    };
  }

  // ------- Tier 1 LLM Call -------
  let currentTier: 1 | 2 = 1;

  try {
    const tier1Client = createAnalyzerProviderClient(config.provider);
    const tier1Prompt = buildTier1AnalyzerPrompt(requestText);

    const tier1Response = await withTimeout(
      tier1Client.chat({
        messages: [{ role: 'user', content: tier1Prompt }],
        model: config.provider.model,
      }),
      config.timeoutMs,
      'Analyzer Tier 1',
    );

    const tier1Text = tier1Response.text ?? '';
    const tier1Json = extractJson(tier1Text);
    if (!tier1Json) {
      console.warn('[ZAM Analyzer] Tier 1: Failed to extract JSON from model response.');
      return {
        output: null,
        tier: 1,
        durationMs: Date.now() - startTime,
        fallbackUsed: true,
        fallbackReason: 'Tier 1: Failed to extract JSON from response',
      };
    }

    // Add metadata fields that the model doesn't produce
    tier1Json.analyzerVersion = config.provider.model;
    tier1Json.analyzerTraceId = randomUUID();
    tier1Json.tier = 1;

    // Set fail-open defaults if model didn't provide them
    if (tier1Json.failOpenTriggered === undefined) {
      tier1Json.failOpenTriggered = false;
    }
    if (tier1Json.failOpenReason === undefined) {
      tier1Json.failOpenReason = null;
    }

    // Validate against schema
    const validate = getValidator();
    if (!validate(tier1Json)) {
      const errMsg = validate.errors?.[0]?.message ?? 'Unknown schema error';
      console.warn(`[ZAM Analyzer] Tier 1: Schema validation failed: ${errMsg}`);
      return {
        output: null,
        tier: 1,
        durationMs: Date.now() - startTime,
        fallbackUsed: true,
        fallbackReason: `Tier 1: Schema validation failed: ${errMsg}`,
      };
    }

    let result = tier1Json as unknown as AnalyzerOutput;
    const confidence = result.analyzerConfidence;

    // ------- Tier 2 Escalation (§6.5) -------
    if (confidence >= config.tier2ConfidenceThreshold && confidence < config.confidenceThreshold) {
      currentTier = 2;
      try {
        const tier2Model = config.tier2Model ?? config.provider.model;
        const tier2ProviderConfig = { ...config.provider, model: tier2Model };
        const tier2Client = config.tier2Model
          ? createAnalyzerProviderClient(tier2ProviderConfig)
          : tier1Client;

        const tier2Prompt = buildTier2AnalyzerPrompt(
          requestText,
          result.promptFamily,
          confidence,
        );

        const tier2Response = await withTimeout(
          tier2Client.chat({
            messages: [{ role: 'user', content: tier2Prompt }],
            model: tier2Model,
          }),
          config.timeoutMs,
          'Analyzer Tier 2',
        );

        const tier2Text = tier2Response.text ?? '';
        const tier2Json = extractJson(tier2Text);
        if (tier2Json) {
          tier2Json.analyzerVersion = tier2Model;
          tier2Json.analyzerTraceId = randomUUID();
          tier2Json.tier = 2;
          if (tier2Json.failOpenTriggered === undefined) tier2Json.failOpenTriggered = false;
          if (tier2Json.failOpenReason === undefined) tier2Json.failOpenReason = null;

          if (validate(tier2Json)) {
            result = tier2Json as unknown as AnalyzerOutput;
          } else {
            console.warn('[ZAM Analyzer] Tier 2: Schema validation failed. Using Tier 1 result.');
          }
        } else {
          console.warn('[ZAM Analyzer] Tier 2: Failed to extract JSON. Using Tier 1 result.');
        }
      } catch (tier2Error) {
        console.warn(`[ZAM Analyzer] Tier 2 error: ${(tier2Error as Error).message}. Using Tier 1 result.`);
        // Keep Tier 1 result
      }
    }

    // ------- Fail-Open Enforcement (§6.4) -------
    const finalConfidence = result.analyzerConfidence;
    const riskLevel = result.assessedRequestRiskLevel;

    if (finalConfidence < config.tier2ConfidenceThreshold) {
      result.failOpenTriggered = true;
      result.failOpenReason = `Confidence ${finalConfidence} below tier2 threshold ${config.tier2ConfidenceThreshold}`;
      result.tier = 3;
      currentTier = 2; // Tier 3 is a result state, not a call tier
    }

    if (riskLevel === 'high' || riskLevel === 'critical') {
      result.failOpenTriggered = true;
      result.failOpenReason = `Assessed risk level is '${riskLevel}' — unconditional fail-open`;
      result.tier = 3;
    }

    return {
      output: result,
      tier: result.tier as 0 | 1 | 2 | 3,
      durationMs: Date.now() - startTime,
      fallbackUsed: false,
    };
  } catch (error) {
    // ------- Global Error Handler (§6.6) -------
    console.warn(`[ZAM Analyzer] Error: ${(error as Error).message}`);
    return {
      output: null,
      tier: currentTier,
      durationMs: Date.now() - startTime,
      fallbackUsed: true,
      fallbackReason: (error as Error).message,
    };
  }
}
