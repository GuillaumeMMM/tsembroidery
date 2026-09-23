import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm", "cjs"],
  // The library is environment-agnostic (no Node built-ins, see
  // tests/browser.test.ts). tsup's default platform is "node" — pin it so
  // esbuild can never resolve node/browser-specific imports by accident.
  platform: "neutral",
  dts: false,
  clean: true,
  sourcemap: true,
});
