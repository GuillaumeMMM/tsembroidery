import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Browser-support guard (Phase 10).
 *
 * The library contract is environment-agnostic: `Uint8Array` in, `string`
 * out, zero Node built-ins in `src/`. Today that holds only because nothing
 * imports anything — tsup's DEFAULT platform is "node", so a future import
 * could silently pull node shims into the bundle. These tests make the
 * guarantee contractual on both ends:
 *
 *  1. the build config must pin an explicit cross-environment platform
 *  2. the built ESM and CJS artifacts must stay free of Node-only globals
 */

test("tsup pins an explicit cross-environment platform", () => {
  const config = readFileSync(new URL("../tsup.config.ts", import.meta.url), "utf8");
  // "neutral" = no node/browser conditions at all; "browser" would also be
  // acceptable. The absence of `platform` (esbuild default: "node") is not.
  assert.match(
    config,
    /platform:\s*["'](neutral|browser)["']/,
    'tsup.config.ts must declare platform: "neutral" (or "browser")'
  );
});

/**
 * Targeted patterns — a bare `/process./` would false-positive on prose
 * comments, which DO survive into dist (e.g. encoder.ts: "…in the
 * process."). `require(`, specifiers, and the mutable/hostile globals are
 * what actually breaks a browser.
 */
const FORBIDDEN: [RegExp, string][] = [
  [/\brequire\s*\(/, "require() call"],
  [/["'`]node:/, "node: module specifier"],
  [/\bprocess\s*\.\s*(env|argv|stdout|stderr|cwd|exit|platform)\b/, "process.* member access"],
  [/\bBuffer\b/, "Buffer"],
  [/__(dirname|filename)\b/, "__dirname / __filename"],
  [/\bsetImmediate\b/, "setImmediate"],
];

for (const name of ["index.js", "index.cjs"]) {
  test(`dist/${name} contains no Node-only globals`, () => {
    const url = new URL(`../dist/${name}`, import.meta.url);
    let code: string;
    try {
      code = readFileSync(url, "utf8");
    } catch {
      assert.fail(`dist/${name} missing — run the build first (npm test does)`);
    }
    for (const [pattern, label] of FORBIDDEN) {
      const found = code.match(pattern);
      assert.equal(
        found,
        null,
        `${label} found in dist/${name}: ${found ? JSON.stringify(found[0]) : ""}`
      );
    }
  });
}
