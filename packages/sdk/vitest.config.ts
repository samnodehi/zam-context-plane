import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // vmForks is required for Node 24 + "type": "module" + Vitest 4.x.
    // It uses Node's --experimental-vm-modules in a forked process,
    // giving correct ESM context injection for test files.
    pool: 'vmForks',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
