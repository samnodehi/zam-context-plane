// Prepend the Node shebang to the built CLI entry so the published `context-plane`
// bin is executable on Linux/macOS. Done as a postbuild step (NOT in src/cli/index.ts)
// because the CLI integration tests run the SOURCE via `node --import tsx/esm`, where a
// source-level shebang breaks the run. Idempotent. Canonical: docs/44.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/cli/index.js');
const shebang = '#!/usr/bin/env node\n';

const src = readFileSync(target, 'utf8');
if (!src.startsWith('#!')) {
  writeFileSync(target, shebang + src);
}
