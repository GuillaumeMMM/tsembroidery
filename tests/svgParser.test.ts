// Runs in plain Node, which has no global DOMParser.
import { Window } from "happy-dom";
import { test, expect } from "vitest";
import { readSvg } from "./internal.ts";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10" stroke="#000"/></svg>`;

test("readSvg: uses the DOMParser from the settings", () => {
  expect(globalThis.DOMParser).toBeUndefined();
  const { pattern } = readSvg(svg, { DOMParser: new Window().DOMParser });
  expect(pattern.countStitches()).toBeGreaterThan(0);
});

test("readSvg: explains how to provide a DOMParser when there is none", () => {
  expect(() => readSvg(svg)).toThrow(/pass one in the settings/);
});
