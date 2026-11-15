import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/types.ts', 'src/index.ts', 'src/serdes/index.ts'],
      thresholds: { lines: 90, statements: 90 },
    },
  },
});
