// ============================================================================
// Tests — Config Loader
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

function createTempDir(): string {
  const dir = join(tmpdir(), `zam-test-cfg-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, config: object): string {
  const path = join(dir, 'runtime.config.json');
  writeFileSync(path, JSON.stringify(config), 'utf8');
  return path;
}

const VALID_CONFIG = {
  zam: { endpoint: 'library' },
  provider: { name: 'openrouter', model: 'test-model' },
};

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // Clear env overrides
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  it('should load a valid config file', () => {
    const path = writeConfig(tempDir, VALID_CONFIG);
    const config = loadConfig(path);

    expect(config.zam.endpoint).toBe('library');
    expect(config.provider.name).toBe('openrouter');
    expect(config.provider.model).toBe('test-model');
  });

  it('should throw when config file does not exist', () => {
    expect(() => loadConfig('/nonexistent/path/config.json')).toThrow('Config file not found');
  });

  it('should throw when config is not valid JSON', () => {
    const path = join(tempDir, 'bad.json');
    writeFileSync(path, 'not json {{{', 'utf8');
    expect(() => loadConfig(path)).toThrow('not valid JSON');
  });

  it('should throw when zam section is missing', () => {
    const path = writeConfig(tempDir, { provider: { name: 'x', model: 'y' } });
    expect(() => loadConfig(path)).toThrow('"zam" section is required');
  });

  it('should throw when zam.endpoint is missing', () => {
    const path = writeConfig(tempDir, { zam: {}, provider: { name: 'x', model: 'y' } });
    expect(() => loadConfig(path)).toThrow('"zam.endpoint" is required');
  });

  it('should throw when zam.endpoint is not "library" in Phase R2', () => {
    const path = writeConfig(tempDir, {
      zam: { endpoint: 'http://localhost:3000' },
      provider: { name: 'openrouter', model: 'test' },
    });
    expect(() => loadConfig(path)).toThrow('must be "library" in Phase R2');
  });

  it('should throw when provider section is missing', () => {
    const path = writeConfig(tempDir, { zam: { endpoint: 'library' } });
    expect(() => loadConfig(path)).toThrow('"provider" section is required');
  });

  it('should throw when provider.name is missing', () => {
    const path = writeConfig(tempDir, { zam: { endpoint: 'library' }, provider: { model: 'y' } });
    expect(() => loadConfig(path)).toThrow('"provider.name" is required');
  });

  it('should throw when provider.model is missing', () => {
    const path = writeConfig(tempDir, { zam: { endpoint: 'library' }, provider: { name: 'x' } });
    expect(() => loadConfig(path)).toThrow('"provider.model" is required');
  });

  it('should apply default apiKeyEnvVar', () => {
    const path = writeConfig(tempDir, VALID_CONFIG);
    const config = loadConfig(path);
    expect(config.provider.apiKeyEnvVar).toBe('ZAM_PROVIDER_API_KEY');
  });

  it('should apply default loop values', () => {
    const path = writeConfig(tempDir, VALID_CONFIG);
    const config = loadConfig(path);
    expect(config.loop.maxTurns).toBe(10);
    expect(config.loop.timeoutMs).toBe(300000);
  });

  it('should apply default workspace values', () => {
    const path = writeConfig(tempDir, VALID_CONFIG);
    const config = loadConfig(path);
    expect(config.workspace.mode).toBe('local');
  });

  it('should apply default eventStream persistPath', () => {
    const path = writeConfig(tempDir, VALID_CONFIG);
    const config = loadConfig(path);
    expect(config.eventStream.persistPath).toBe('./sessions');
  });

  it('should respect custom values when provided', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      loop: { maxTurns: 5, timeoutMs: 60000 },
      eventStream: { persistPath: '/custom/sessions' },
    });
    const config = loadConfig(path);
    expect(config.loop.maxTurns).toBe(5);
    expect(config.loop.timeoutMs).toBe(60000);
    expect(config.eventStream.persistPath).toBe('/custom/sessions');
  });

  it('should throw when maxTurns is out of range', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      loop: { maxTurns: 100 },
    });
    expect(() => loadConfig(path)).toThrow('between 1 and 50');
  });

  it('should throw when timeoutMs is too low', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      loop: { timeoutMs: 500 },
    });
    expect(() => loadConfig(path)).toThrow('at least 1000ms');
  });

  it('should override zam.endpoint from env var', () => {
    vi.stubEnv('ZAM_ENDPOINT', 'library');
    const path = writeConfig(tempDir, {
      zam: { endpoint: 'will-be-overridden' },
      provider: { name: 'openrouter', model: 'test' },
    });
    // Since env says 'library', it should pass Phase R2 validation
    const config = loadConfig(path);
    expect(config.zam.endpoint).toBe('library');
  });
});

describe('loadConfig — analyzer section', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  const ANALYZER_PROVIDER = { name: 'openrouter', model: 'google/gemini-3.1-flash-lite' };

  it('should leave analyzer undefined when analyzer section is absent', () => {
    const path = writeConfig(tempDir, VALID_CONFIG);
    const config = loadConfig(path);
    expect(config.analyzer).toBeUndefined();
  });

  it('should leave analyzer undefined when analyzer.enabled is false', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: false },
    });
    const config = loadConfig(path);
    expect(config.analyzer).toBeUndefined();
  });

  it('should populate AnalyzerConfig when enabled with valid config', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: {
        enabled: true,
        provider: { name: 'openrouter', model: 'google/gemini-3.1-flash-lite', apiKeyEnvVar: 'MY_KEY' },
        tier2Model: 'google/gemini-3-flash-preview',
        confidenceThreshold: 0.90,
        tier2ConfidenceThreshold: 0.65,
        timeoutMs: 3000,
        fallbackOnError: 'deterministic',
      },
    });
    const config = loadConfig(path);
    expect(config.analyzer).toBeDefined();
    expect(config.analyzer!.enabled).toBe(true);
    expect(config.analyzer!.provider.name).toBe('openrouter');
    expect(config.analyzer!.provider.model).toBe('google/gemini-3.1-flash-lite');
    expect(config.analyzer!.provider.apiKeyEnvVar).toBe('MY_KEY');
    expect(config.analyzer!.tier2Model).toBe('google/gemini-3-flash-preview');
    expect(config.analyzer!.confidenceThreshold).toBe(0.90);
    expect(config.analyzer!.tier2ConfidenceThreshold).toBe(0.65);
    expect(config.analyzer!.timeoutMs).toBe(3000);
    expect(config.analyzer!.fallbackOnError).toBe('deterministic');
  });

  it('should apply defaults when analyzer is enabled with minimal config', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: true, provider: ANALYZER_PROVIDER },
    });
    const config = loadConfig(path);
    expect(config.analyzer).toBeDefined();
    expect(config.analyzer!.confidenceThreshold).toBe(0.85);
    expect(config.analyzer!.tier2ConfidenceThreshold).toBe(0.60);
    expect(config.analyzer!.timeoutMs).toBe(5000);
    expect(config.analyzer!.fallbackOnError).toBe('deterministic');
    // apiKeyEnvVar should fall back to main provider's value
    expect(config.analyzer!.provider.apiKeyEnvVar).toBe('ZAM_PROVIDER_API_KEY');
  });

  it('should throw when analyzer is enabled but provider is missing', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: true },
    });
    expect(() => loadConfig(path)).toThrow('analyzer.provider');
  });

  it('should throw when analyzer.provider.model is missing', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: true, provider: { name: 'openrouter' } },
    });
    expect(() => loadConfig(path)).toThrow('analyzer.provider.model');
  });

  it('should throw when confidenceThreshold is out of range', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: true, provider: ANALYZER_PROVIDER, confidenceThreshold: 1.5 },
    });
    expect(() => loadConfig(path)).toThrow('between 0.0 and 1.0');
  });

  it('should throw when tier2ConfidenceThreshold > confidenceThreshold', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: {
        enabled: true,
        provider: ANALYZER_PROVIDER,
        tier2ConfidenceThreshold: 0.90,
        confidenceThreshold: 0.80,
      },
    });
    expect(() => loadConfig(path)).toThrow('must be <=');
  });

  it('should throw when timeoutMs is too low', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: true, provider: ANALYZER_PROVIDER, timeoutMs: 100 },
    });
    expect(() => loadConfig(path)).toThrow('at least 500ms');
  });

  it('should throw when fallbackOnError is not deterministic', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: true, provider: ANALYZER_PROVIDER, fallbackOnError: 'ignore' },
    });
    expect(() => loadConfig(path)).toThrow('must be "deterministic"');
  });

  it('should leave tier2Model undefined when not specified', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: true, provider: ANALYZER_PROVIDER },
    });
    const config = loadConfig(path);
    expect(config.analyzer!.tier2Model).toBeUndefined();
  });
});

describe('loadConfig — selector section', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  const SELECTOR_PROVIDER = { name: 'openrouter', model: 'google/gemini-3.1-flash-lite' };

  it('should leave selector undefined when selector section is absent', () => {
    const path = writeConfig(tempDir, VALID_CONFIG);
    const config = loadConfig(path);
    expect(config.selector).toBeUndefined();
  });

  it('should leave selector undefined when selector.enabled is false', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      selector: { enabled: false },
    });
    const config = loadConfig(path);
    expect(config.selector).toBeUndefined();
  });

  it('should populate SelectorConfig when enabled with valid config', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      selector: {
        enabled: true,
        provider: { name: 'openrouter', model: 'google/gemini-3.1-flash-lite', apiKeyEnvVar: 'SEL_KEY' },
        timeoutMs: 3000,
        fallbackOnError: 'deterministic',
      },
    });
    const config = loadConfig(path);
    expect(config.selector).toBeDefined();
    expect(config.selector!.enabled).toBe(true);
    expect(config.selector!.provider.name).toBe('openrouter');
    expect(config.selector!.provider.model).toBe('google/gemini-3.1-flash-lite');
    expect(config.selector!.provider.apiKeyEnvVar).toBe('SEL_KEY');
    expect(config.selector!.timeoutMs).toBe(3000);
    expect(config.selector!.fallbackOnError).toBe('deterministic');
  });

  it('should apply defaults when selector is enabled with minimal config', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      selector: { enabled: true, provider: SELECTOR_PROVIDER },
    });
    const config = loadConfig(path);
    expect(config.selector).toBeDefined();
    expect(config.selector!.timeoutMs).toBe(5000);
    expect(config.selector!.fallbackOnError).toBe('deterministic');
    // apiKeyEnvVar should fall back to main provider's value
    expect(config.selector!.provider.apiKeyEnvVar).toBe('ZAM_PROVIDER_API_KEY');
  });

  it('should throw when selector is enabled but provider is missing', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      selector: { enabled: true },
    });
    expect(() => loadConfig(path)).toThrow('selector.provider');
  });

  it('should throw when selector.provider.name is missing', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      selector: { enabled: true, provider: { model: 'test' } },
    });
    expect(() => loadConfig(path)).toThrow('selector.provider.name');
  });

  it('should throw when selector.provider.model is missing', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      selector: { enabled: true, provider: { name: 'openrouter' } },
    });
    expect(() => loadConfig(path)).toThrow('selector.provider.model');
  });

  it('should throw when timeoutMs is too low', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      selector: { enabled: true, provider: SELECTOR_PROVIDER, timeoutMs: 100 },
    });
    expect(() => loadConfig(path)).toThrow('at least 500ms');
  });

  it('should throw when fallbackOnError is not deterministic', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      selector: { enabled: true, provider: SELECTOR_PROVIDER, fallbackOnError: 'ignore' },
    });
    expect(() => loadConfig(path)).toThrow('must be "deterministic"');
  });

  it('should work with both analyzer and selector enabled simultaneously', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      analyzer: { enabled: true, provider: { name: 'openrouter', model: 'analyzer-model' } },
      selector: { enabled: true, provider: SELECTOR_PROVIDER },
    });
    const config = loadConfig(path);
    expect(config.analyzer).toBeDefined();
    expect(config.analyzer!.enabled).toBe(true);
    expect(config.selector).toBeDefined();
    expect(config.selector!.enabled).toBe(true);
    expect(config.analyzer!.provider.model).toBe('analyzer-model');
    expect(config.selector!.provider.model).toBe('google/gemini-3.1-flash-lite');
  });
});

describe('loadConfig — compressor section', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  const COMPRESSOR_PROVIDER = { name: 'openrouter', model: 'google/gemini-3.1-flash-lite' };

  it('should leave compressor undefined when compressor section is absent', () => {
    const path = writeConfig(tempDir, VALID_CONFIG);
    const config = loadConfig(path);
    expect(config.compressor).toBeUndefined();
  });

  it('should leave compressor undefined when compressor.enabled is false', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: false },
    });
    const config = loadConfig(path);
    expect(config.compressor).toBeUndefined();
  });

  it('should populate CompressorConfig when enabled with valid config', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: {
        enabled: true,
        provider: { name: 'openrouter', model: 'google/gemini-3.1-flash-lite', apiKeyEnvVar: 'COMP_KEY' },
        tier2Model: 'google/gemini-3-flash-preview',
        tokenThreshold: 5000,
        minTurnsBeforeCompression: 8,
        recompressionTurnInterval: 3,
        rawWindowSize: 4,
        confidenceThreshold: 0.80,
        timeoutMs: 20000,
        fallbackOnError: 'raw_history',
      },
    });
    const config = loadConfig(path);
    expect(config.compressor).toBeDefined();
    expect(config.compressor!.enabled).toBe(true);
    expect(config.compressor!.provider.name).toBe('openrouter');
    expect(config.compressor!.provider.model).toBe('google/gemini-3.1-flash-lite');
    expect(config.compressor!.provider.apiKeyEnvVar).toBe('COMP_KEY');
    expect(config.compressor!.tier2Model).toBe('google/gemini-3-flash-preview');
    expect(config.compressor!.tokenThreshold).toBe(5000);
    expect(config.compressor!.minTurnsBeforeCompression).toBe(8);
    expect(config.compressor!.recompressionTurnInterval).toBe(3);
    expect(config.compressor!.rawWindowSize).toBe(4);
    expect(config.compressor!.confidenceThreshold).toBe(0.80);
    expect(config.compressor!.timeoutMs).toBe(20000);
    expect(config.compressor!.fallbackOnError).toBe('raw_history');
  });

  it('should apply defaults when compressor is enabled with minimal config', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER },
    });
    const config = loadConfig(path);
    expect(config.compressor).toBeDefined();
    expect(config.compressor!.tokenThreshold).toBe(4000);
    expect(config.compressor!.minTurnsBeforeCompression).toBe(6);
    expect(config.compressor!.recompressionTurnInterval).toBe(5);
    expect(config.compressor!.rawWindowSize).toBe(6);
    expect(config.compressor!.confidenceThreshold).toBe(0.75);
    expect(config.compressor!.timeoutMs).toBe(15000);
    expect(config.compressor!.fallbackOnError).toBe('raw_history');
    // apiKeyEnvVar should fall back to main provider's value
    expect(config.compressor!.provider.apiKeyEnvVar).toBe('ZAM_PROVIDER_API_KEY');
  });

  it('should throw when compressor is enabled but provider is missing', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true },
    });
    expect(() => loadConfig(path)).toThrow('compressor.provider');
  });

  it('should throw when compressor.provider.name is missing', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: { model: 'test' } },
    });
    expect(() => loadConfig(path)).toThrow('compressor.provider.name');
  });

  it('should throw when compressor.provider.model is missing', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: { name: 'openrouter' } },
    });
    expect(() => loadConfig(path)).toThrow('compressor.provider.model');
  });

  it('should throw when fallbackOnError is not raw_history', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER, fallbackOnError: 'other' },
    });
    expect(() => loadConfig(path)).toThrow('"raw_history"');
  });

  it('should throw when confidenceThreshold is out of range', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER, confidenceThreshold: 1.5 },
    });
    expect(() => loadConfig(path)).toThrow('between 0.0 and 1.0');
  });

  it('should throw when tokenThreshold is too low', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER, tokenThreshold: 100 },
    });
    expect(() => loadConfig(path)).toThrow('at least 500');
  });

  it('should throw when minTurnsBeforeCompression is too low', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER, minTurnsBeforeCompression: 0 },
    });
    expect(() => loadConfig(path)).toThrow('at least 2');
  });

  it('should throw when recompressionTurnInterval is too low', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER, recompressionTurnInterval: 0 },
    });
    expect(() => loadConfig(path)).toThrow('at least 1');
  });

  it('should throw when rawWindowSize is too low', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER, rawWindowSize: 0 },
    });
    expect(() => loadConfig(path)).toThrow('at least 1');
  });

  it('should throw when timeoutMs is too low', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER, timeoutMs: 500 },
    });
    expect(() => loadConfig(path)).toThrow('at least 1000ms');
  });

  it('should fall back apiKeyEnvVar to main provider when not specified', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      provider: { name: 'openrouter', model: 'main-model', apiKeyEnvVar: 'MAIN_KEY' },
      compressor: { enabled: true, provider: { name: 'openrouter', model: 'comp-model' } },
    });
    const config = loadConfig(path);
    expect(config.compressor!.provider.apiKeyEnvVar).toBe('MAIN_KEY');
  });

  it('should leave tier2Model undefined when not specified', () => {
    const path = writeConfig(tempDir, {
      ...VALID_CONFIG,
      compressor: { enabled: true, provider: COMPRESSOR_PROVIDER },
    });
    const config = loadConfig(path);
    expect(config.compressor!.tier2Model).toBeUndefined();
  });
});
