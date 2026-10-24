import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unidade',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'worker/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', 'node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integracao',
          include: ['src/**/*.int.test.ts', 'worker/**/*.int.test.ts', 'tests/integracao/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'arquitetura',
          include: ['tests/arquitetura/**/*.test.ts', '.claude/hooks/**/*.test.mjs'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
