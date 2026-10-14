/** @vitest-environment happy-dom */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readSvg, type SvgReadSettings } from "./internal.ts";

const settings: SvgReadSettings = { size: 100, colorTolerance: 9, minStitchLength: 0.3 };

const read = (file: string) => {
  const { pattern, warnings } = readSvg(readFileSync(`tests/fixtures/${file}`, "utf8"), settings);
  const blocks = [...pattern.getAsColorblocks()];
  return {
    threads: blocks.length,
    colors: new Set(blocks.map(([, thread]) => thread.color & 0xffffff)).size,
    warnings,
  };
};

test("readSvg: flower_pattern.svg keeps every layer drawn through symbols", () => {
  const { threads, colors, warnings } = read("flower_pattern.svg");
  expect({ threads, colors }).toStrictEqual({ threads: 13, colors: 10 });
  expect(warnings).toStrictEqual([]);
}, 60000);

test("readSvg: gallardo.svg keeps every layer filled with gradients", () => {
  const { threads, colors, warnings } = read("gallardo.svg");
  expect({ threads, colors }).toStrictEqual({ threads: 114, colors: 106 });
  expect(warnings).toStrictEqual(["Skipped non-SVG element <namedview>"]);
}, 60000);
