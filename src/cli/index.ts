import { Command } from 'commander';
import { planCommand } from './commands/plan.js';
import { evaluateCommand } from './commands/evaluate.js';
import { PACKAGE_VERSION } from '../generated/version.js';

const program = new Command();

program
  .name('context-plane')
  .description(
    'Portable, deterministic context governance layer for AI agents — plan what context each request gets (include/omit/defer).',
  )
  .version(PACKAGE_VERSION);

program.addCommand(planCommand);
program.addCommand(evaluateCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
