import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests exercise src/ directly — no build step in the test path.
    // (tests/types-check.ts is compile-only and checks the PUBLISHED
    // declarations; it doesn't match *.test.ts, so vitest never runs it —
    // `npm run typecheck` compiles it.)
    include: ["tests/**/*.test.ts"],
    environment: "node", // fixture/golden tests read via node:fs
  },
});
