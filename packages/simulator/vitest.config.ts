import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // reload and back-fill tests replay hours of simulated traffic: ~1–4 s alone, past vitest's 5 s default when
    // every package's tests run at once (pnpm -r runs 4 in parallel; CI has 2 cores)
    testTimeout: 20_000,
  },
});
