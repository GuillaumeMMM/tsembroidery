/** @vitest-environment happy-dom */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readSvg } from "./internal.ts";

test("readSvg: flower_pattern.svg keeps every color drawn through symbols", () => {
  const source = readFileSync("tests/fixtures/flower_pattern.svg", "utf8");
  const { pattern, warnings } = readSvg(source);
  expect(warnings).toStrictEqual([]);
  expect(pattern.threadlist).toHaveLength(13);
  expect(new Set(pattern.threadlist.map((thread) => thread.hexColor())).size).toBe(10);
  for (const thread of pattern.threadlist) {
    expect(thread.extras.svg?.zone.length).toBeGreaterThan(0);
  }
}, 60000);
