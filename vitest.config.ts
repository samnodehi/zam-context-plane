import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // vmForks uses Node's --experimental-vm-modules in a forked process,
    // giving correct ESM isolation for packages with "type": "module".
    // Required for Node 24 + Vitest 4.x + ESM.
    pool: 'vmForks',
    include: [
      'tests/**/*.test.ts',
      'packages/sdk/tests/**/*.test.ts',
    ],
    exclude: [
      'packages/runtime/tests/**',
      'node_modules/**',
    ],
  },
});
