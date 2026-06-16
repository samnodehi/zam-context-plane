import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../../src/cli/index.ts');

function run(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', entry, ...args],
    { encoding: 'utf8', timeout: 15_000 }
  );
}

describe('Phase 0 CLI smoke', () => {
  it('--help exits 0 and mentions plan', () => {
    const result = run(['--help']);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('plan');
  });

  it('unknown top-level flag exits non-zero', () => {
    const result = run(['--unknown-flag-xyz-phase0']);
    expect(result.status, `stderr: ${result.stderr}`).not.toBe(0);
  });
});
