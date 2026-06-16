import { Command } from 'commander';
import { planCommand } from './commands/plan.js';
import { evaluateCommand } from './commands/evaluate.js';

const program = new Command();

program
  .name('context-plane')
  .description('Portable Context Control Plane CLI MVP')
  .version('0.0.1');

program.addCommand(planCommand);
program.addCommand(evaluateCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
