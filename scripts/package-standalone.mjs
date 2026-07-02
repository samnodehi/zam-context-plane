/**
 * Produce a self-contained, prerequisite-free ZAM artifact for OS packaging.
 *
 * The output folder runs with only a Node runtime — no `npm install` on the
 * target, no dev dependencies, and no `schemas/` folder (schemas are embedded
 * into `dist` by scripts/gen-embedded-schemas.mjs). An OS installer / supervisor
 * launches it as:
 *   node <out>/dist/http-server.js       (env: ZAM_HOST / ZAM_PORT / ZAM_API_KEY)
 * Health: GET /health (returns 200; requires X-ZAM-API-Key when ZAM_API_KEY set).
 *
 * Steps: build → copy `dist` + the manifest → install PRODUCTION deps with
 * lifecycle scripts DISABLED. `--ignore-scripts` is required: the artifact is
 * prebuilt, so the `prepare` hook (npm run gen:schemas) must not run on the
 * target (scripts/ is not shipped, and the schemas are already embedded).
 *
 * Usage: npm run package:standalone [-- <outDir>]   (default: dist-standalone/)
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, cpSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = resolve(repoRoot, process.argv[2] ?? 'dist-standalone');
const run = (cmd, cwd = repoRoot) => execSync(cmd, { cwd, stdio: 'inherit' });

console.log(`[package] repo: ${repoRoot}`);
console.log(`[package] out:  ${outDir}`);

// 1. Fresh build (regenerates embedded schemas + compiles dist).
console.log('[package] building…');
run('npm run build');

// 2. Reset the output dir and copy the shippable set only: dist + the manifest.
//    No src, no scripts/, no schemas/ folder, no dev config.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(repoRoot, 'dist'), join(outDir, 'dist'), { recursive: true });
for (const f of ['package.json', 'package-lock.json']) {
  copyFileSync(join(repoRoot, f), join(outDir, f));
}

// 3. Install PRODUCTION dependencies only, with lifecycle scripts disabled
//    (the artifact is prebuilt — see the header note on --ignore-scripts).
console.log('[package] installing production deps (--omit=dev --ignore-scripts)…');
run('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', outDir);

// 4. Verify + report.
if (!existsSync(join(outDir, 'dist', 'http-server.js'))) {
  throw new Error('package: expected entry dist/http-server.js is missing after assembly');
}
const dirSize = (p) =>
  readdirSync(p, { withFileTypes: true }).reduce((n, e) => {
    const fp = join(p, e.name);
    return n + (e.isDirectory() ? dirSize(fp) : statSync(fp).size);
  }, 0);
const mb = (dirSize(outDir) / 1024 / 1024).toFixed(1);

console.log('');
console.log(`[package] ✓ self-contained ZAM ready: ${outDir}  (~${mb} MB, no schemas/ folder)`);
console.log('[package]   entry:  dist/http-server.js');
console.log('[package]   launch: node dist/http-server.js   (env: ZAM_HOST=127.0.0.1 ZAM_PORT=<port> ZAM_API_KEY=<token>)');
console.log('[package]   health: GET /health');
