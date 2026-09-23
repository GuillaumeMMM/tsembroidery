import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm"],
  platform: "browser",
  dts: false,
  clean: true,
  sourcemap: true,
});
