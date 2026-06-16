// ============================================================================
// ZAM Runtime — Config Loader
// Canonical source: docs/24 §8
// Phase R2: Reads runtime.config.json with validation and defaults.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RuntimeConfig, AnalyzerConfig, SelectorConfig, CompressorConfig } from './types.js';

/**
 * Load and validate runtime configuration from a JSON file.
 *
 * Per docs/24 §8.1: Required fields are zam.endpoint, provider.name, provider.model.
 * Per docs/24 §8.2: Environment variables override config file values.
 * Per R2-Q6: Registry path comes from config, not hard-coded.
 */
export function loadConfig(configPath?: string): RuntimeConfig {
  const resolvedPath = resolve(configPath ?? './runtime.config.json');

  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read config file: ${resolvedPath}: ${(err as Error).message}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Config file is not valid JSON: ${resolvedPath}: ${(err as Error).message}`);
  }

  return validateAndApplyDefaults(parsed);
}

/**
 * Validate required fields and apply defaults for optional fields.
 */
function validateAndApplyDefaults(raw: Record<string, unknown>): RuntimeConfig {
  // Validate required: zam
  const zam = raw.zam as Record<string, unknown> | undefined;
  if (!zam || typeof zam !== 'object') {
    throw new Error('Config validation: "zam" section is required.');
  }

  // Apply env override for zam.endpoint
  const zamEndpoint = process.env['ZAM_ENDPOINT'] ?? zam.endpoint;
  if (typeof zamEndpoint !== 'string' || !zamEndpoint) {
    throw new Error('Config validation: "zam.endpoint" is required (e.g., "library" or an HTTP URL).');
  }

  // Phase R2: Only "library" is supported
  if (zamEndpoint !== 'library') {
    throw new Error(
      `Config validation: "zam.endpoint" must be "library" in Phase R2. Got: "${zamEndpoint}".`,
    );
  }

  // Validate required: provider
  const provider = raw.provider as Record<string, unknown> | undefined;
  if (!provider || typeof provider !== 'object') {
    throw new Error('Config validation: "provider" section is required.');
  }
  if (typeof provider.name !== 'string' || !provider.name) {
    throw new Error('Config validation: "provider.name" is required.');
  }
  if (typeof provider.model !== 'string' || !provider.model) {
    throw new Error('Config validation: "provider.model" is required.');
  }

  // Optional sections with defaults per docs/24 §8.1
  const workspace = raw.workspace as Record<string, unknown> | undefined;
  const loop = raw.loop as Record<string, unknown> | undefined;
  const eventStream = raw.eventStream as Record<string, unknown> | undefined;
  const registry = raw.registry as Record<string, unknown> | undefined;

  const config: RuntimeConfig = {
    zam: {
      endpoint: zamEndpoint,
    },
    provider: {
      name: provider.name as string,
      model: provider.model as string,
      apiKeyEnvVar: (provider.apiKeyEnvVar as string) ?? 'ZAM_PROVIDER_API_KEY',
    },
    workspace: {
      mode: (process.env['ZAM_WORKSPACE_MODE'] as 'local' | 'docker')
        ?? (workspace?.mode as 'local' | 'docker')
        ?? 'local',
      rootPath: process.env['ZAM_WORKSPACE_ROOT']
        ?? (workspace?.rootPath as string)
        ?? process.cwd(),
    },
    loop: {
      maxTurns: (loop?.maxTurns as number) ?? 10,
      timeoutMs: (loop?.timeoutMs as number) ?? 300000,
    },
    eventStream: {
      persistPath: (eventStream?.persistPath as string) ?? './sessions',
    },
  };

  // Optional registry config per R2-Q6
  if (registry?.path) {
    config.registry = { path: registry.path as string };
  }

  // Phase M1: Optional analyzer config per docs/25 §5.4
  const analyzer = raw.analyzer as Record<string, unknown> | undefined;
  if (analyzer && typeof analyzer === 'object' && analyzer.enabled === true) {
    config.analyzer = parseAnalyzerConfig(analyzer, config.provider.apiKeyEnvVar);
  }

  // Phase M2: Optional selector config per docs/26 §6.2
  const selector = raw.selector as Record<string, unknown> | undefined;
  if (selector && typeof selector === 'object' && selector.enabled === true) {
    config.selector = parseSelectorConfig(selector, config.provider.apiKeyEnvVar);
  }

  // Phase M3: Optional compressor config per docs/27 §7.3
  const compressor = raw.compressor as Record<string, unknown> | undefined;
  if (compressor && typeof compressor === 'object' && compressor.enabled === true) {
    config.compressor = parseCompressorConfig(compressor, config.provider.apiKeyEnvVar);
  }

  // Validate numeric constraints per docs/24 §8.1
  if (config.loop.maxTurns < 1 || config.loop.maxTurns > 50) {
    throw new Error(
      `Config validation: "loop.maxTurns" must be between 1 and 50. Got: ${config.loop.maxTurns}.`,
    );
  }
  if (config.loop.timeoutMs < 1000) {
    throw new Error(
      `Config validation: "loop.timeoutMs" must be at least 1000ms. Got: ${config.loop.timeoutMs}.`,
    );
  }

  return config;
}

/**
 * Parse and validate the analyzer configuration section.
 * Phase M1. Canonical: docs/25 §5.4.
 *
 * @param analyzer      The raw analyzer object from config JSON.
 * @param mainApiKeyEnvVar  The main provider's apiKeyEnvVar for fallback.
 */
function parseAnalyzerConfig(
  analyzer: Record<string, unknown>,
  mainApiKeyEnvVar: string,
): AnalyzerConfig {
  // Validate required: analyzer.provider
  const analyzerProvider = analyzer.provider as Record<string, unknown> | undefined;
  if (!analyzerProvider || typeof analyzerProvider !== 'object') {
    throw new Error('Config validation: "analyzer.provider" section is required when analyzer is enabled.');
  }
  if (typeof analyzerProvider.name !== 'string' || !analyzerProvider.name) {
    throw new Error('Config validation: "analyzer.provider.name" is required.');
  }
  if (typeof analyzerProvider.model !== 'string' || !analyzerProvider.model) {
    throw new Error('Config validation: "analyzer.provider.model" is required.');
  }

  // Defaults per docs/25 §5.4
  const confidenceThreshold = (analyzer.confidenceThreshold as number) ?? 0.85;
  const tier2ConfidenceThreshold = (analyzer.tier2ConfidenceThreshold as number) ?? 0.60;
  const timeoutMs = (analyzer.timeoutMs as number) ?? 5000;
  const fallbackOnError = (analyzer.fallbackOnError as string) ?? 'deterministic';

  // Validate fallbackOnError — only 'deterministic' accepted in M1
  if (fallbackOnError !== 'deterministic') {
    throw new Error(
      `Config validation: "analyzer.fallbackOnError" must be "deterministic" in Phase M1. Got: "${fallbackOnError}".`,
    );
  }

  // Validate confidence thresholds are in range [0.0, 1.0]
  if (confidenceThreshold < 0.0 || confidenceThreshold > 1.0) {
    throw new Error(
      `Config validation: "analyzer.confidenceThreshold" must be between 0.0 and 1.0. Got: ${confidenceThreshold}.`,
    );
  }
  if (tier2ConfidenceThreshold < 0.0 || tier2ConfidenceThreshold > 1.0) {
    throw new Error(
      `Config validation: "analyzer.tier2ConfidenceThreshold" must be between 0.0 and 1.0. Got: ${tier2ConfidenceThreshold}.`,
    );
  }

  // Validate tier2 threshold <= confidence threshold
  if (tier2ConfidenceThreshold > confidenceThreshold) {
    throw new Error(
      `Config validation: "analyzer.tier2ConfidenceThreshold" (${tier2ConfidenceThreshold}) must be <= "analyzer.confidenceThreshold" (${confidenceThreshold}).`,
    );
  }

  // Validate timeoutMs >= 500
  if (timeoutMs < 500) {
    throw new Error(
      `Config validation: "analyzer.timeoutMs" must be at least 500ms. Got: ${timeoutMs}.`,
    );
  }

  return {
    enabled: true,
    provider: {
      name: analyzerProvider.name as string,
      model: analyzerProvider.model as string,
      apiKeyEnvVar: (analyzerProvider.apiKeyEnvVar as string) ?? mainApiKeyEnvVar,
    },
    tier2Model: (analyzer.tier2Model as string) ?? undefined,
    confidenceThreshold,
    tier2ConfidenceThreshold,
    timeoutMs,
    fallbackOnError: 'deterministic',
  };
}

/**
 * Parse and validate the selector configuration section.
 * Phase M2. Canonical: docs/26 §6.2.
 *
 * @param selector        The raw selector object from config JSON.
 * @param mainApiKeyEnvVar  The main provider's apiKeyEnvVar for fallback.
 */
function parseSelectorConfig(
  selector: Record<string, unknown>,
  mainApiKeyEnvVar: string,
): SelectorConfig {
  // Validate required: selector.provider
  const selectorProvider = selector.provider as Record<string, unknown> | undefined;
  if (!selectorProvider || typeof selectorProvider !== 'object') {
    throw new Error('Config validation: "selector.provider" section is required when selector is enabled.');
  }
  if (typeof selectorProvider.name !== 'string' || !selectorProvider.name) {
    throw new Error('Config validation: "selector.provider.name" is required.');
  }
  if (typeof selectorProvider.model !== 'string' || !selectorProvider.model) {
    throw new Error('Config validation: "selector.provider.model" is required.');
  }

  // Defaults per docs/26 §6.1
  const timeoutMs = (selector.timeoutMs as number) ?? 5000;
  const fallbackOnError = (selector.fallbackOnError as string) ?? 'deterministic';

  // Validate fallbackOnError — only 'deterministic' accepted in M2
  if (fallbackOnError !== 'deterministic') {
    throw new Error(
      `Config validation: "selector.fallbackOnError" must be "deterministic" in Phase M2. Got: "${fallbackOnError}".`,
    );
  }

  // Validate timeoutMs >= 500
  if (timeoutMs < 500) {
    throw new Error(
      `Config validation: "selector.timeoutMs" must be at least 500ms. Got: ${timeoutMs}.`,
    );
  }

  return {
    enabled: true,
    provider: {
      name: selectorProvider.name as string,
      model: selectorProvider.model as string,
      apiKeyEnvVar: (selectorProvider.apiKeyEnvVar as string) ?? mainApiKeyEnvVar,
    },
    timeoutMs,
    fallbackOnError: 'deterministic',
  };
}

/**
 * Parse and validate the compressor configuration section.
 * Phase M3. Canonical: docs/27 §7.3.
 *
 * @param compressor       The raw compressor object from config JSON.
 * @param mainApiKeyEnvVar The main provider's apiKeyEnvVar for fallback.
 */
function parseCompressorConfig(
  compressor: Record<string, unknown>,
  mainApiKeyEnvVar: string,
): CompressorConfig {
  // Validate required: compressor.provider
  const compressorProvider = compressor.provider as Record<string, unknown> | undefined;
  if (!compressorProvider || typeof compressorProvider !== 'object') {
    throw new Error('Config validation: "compressor.provider" section is required when compressor is enabled.');
  }
  if (typeof compressorProvider.name !== 'string' || !compressorProvider.name) {
    throw new Error('Config validation: "compressor.provider.name" is required.');
  }
  if (typeof compressorProvider.model !== 'string' || !compressorProvider.model) {
    throw new Error('Config validation: "compressor.provider.model" is required.');
  }

  // Defaults per docs/27 §7.3
  const tokenThreshold = (compressor.tokenThreshold as number) ?? 4000;
  const minTurnsBeforeCompression = (compressor.minTurnsBeforeCompression as number) ?? 6;
  const recompressionTurnInterval = (compressor.recompressionTurnInterval as number) ?? 5;
  const rawWindowSize = (compressor.rawWindowSize as number) ?? 6;
  const confidenceThreshold = (compressor.confidenceThreshold as number) ?? 0.75;
  const timeoutMs = (compressor.timeoutMs as number) ?? 15000;
  const fallbackOnError = (compressor.fallbackOnError as string) ?? 'raw_history';

  // Validate fallbackOnError — only 'raw_history' accepted in M3
  if (fallbackOnError !== 'raw_history') {
    throw new Error(
      `Config validation: "compressor.fallbackOnError" must be "raw_history" in Phase M3. Got: "${fallbackOnError}".`,
    );
  }

  // Validate confidence threshold is in range [0.0, 1.0]
  if (confidenceThreshold < 0.0 || confidenceThreshold > 1.0) {
    throw new Error(
      `Config validation: "compressor.confidenceThreshold" must be between 0.0 and 1.0. Got: ${confidenceThreshold}.`,
    );
  }

  // Validate tokenThreshold >= 500
  if (tokenThreshold < 500) {
    throw new Error(
      `Config validation: "compressor.tokenThreshold" must be at least 500. Got: ${tokenThreshold}.`,
    );
  }

  // Validate minTurnsBeforeCompression >= 2
  if (minTurnsBeforeCompression < 2) {
    throw new Error(
      `Config validation: "compressor.minTurnsBeforeCompression" must be at least 2. Got: ${minTurnsBeforeCompression}.`,
    );
  }

  // Validate recompressionTurnInterval >= 1
  if (recompressionTurnInterval < 1) {
    throw new Error(
      `Config validation: "compressor.recompressionTurnInterval" must be at least 1. Got: ${recompressionTurnInterval}.`,
    );
  }

  // Validate rawWindowSize >= 1
  if (rawWindowSize < 1) {
    throw new Error(
      `Config validation: "compressor.rawWindowSize" must be at least 1. Got: ${rawWindowSize}.`,
    );
  }

  // Validate timeoutMs >= 1000 (compressor needs more time than analyzer/selector)
  if (timeoutMs < 1000) {
    throw new Error(
      `Config validation: "compressor.timeoutMs" must be at least 1000ms. Got: ${timeoutMs}.`,
    );
  }

  return {
    enabled: true,
    provider: {
      name: compressorProvider.name as string,
      model: compressorProvider.model as string,
      apiKeyEnvVar: (compressorProvider.apiKeyEnvVar as string) ?? mainApiKeyEnvVar,
    },
    tier2Model: (compressor.tier2Model as string) ?? undefined,
    tokenThreshold,
    minTurnsBeforeCompression,
    recompressionTurnInterval,
    rawWindowSize,
    confidenceThreshold,
    timeoutMs,
    fallbackOnError: 'raw_history',
  };
}
