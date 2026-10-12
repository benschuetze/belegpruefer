import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["app/**/*.test.ts", "tests/**/*.test.ts", "evals/**/*.test.ts"],
    environment: "node",
    // PGlite boots a WASM Postgres per file; the first start can take a few seconds.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
