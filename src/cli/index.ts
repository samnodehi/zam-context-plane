import { createRequire } from 'node:module';
import { Command } from 'commander';
import { planCommand } from './commands/plan.js';
import { evaluateCommand } from './commands/evaluate.js';

// Read the version from package.json so `--version` never drifts from the package.
// dist/cli/index.js (and src/cli/index.ts under tsx) sits 2 levels below the package root.
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('context-plane')
  .description(
    'Portable, deterministic context governance layer for AI agents — plan what context each request gets (include/omit/defer).',
  )
  .version(pkg.version);

program.addCommand(planCommand);
program.addCommand(evaluateCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
