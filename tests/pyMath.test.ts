import { test, expect } from "vitest";
import { pyRound } from "../src/index.ts";

// python `round()` semantics: half-to-even, returns int.
test("pyRound: no rounding needed", () => {
  expect(pyRound(0)).toBe(0);
  expect(pyRound(2.0)).toBe(2);
  expect(pyRound(2.4)).toBe(2);
  expect(pyRound(2.6)).toBe(3);
});

test("pyRound: half-to-even (differs from Math.round)", () => {
  expect(pyRound(4.5)).toBe(4); // Math.round gives 5
  expect(pyRound(5.5)).toBe(6); // Math.round gives 6
  expect(pyRound(2.5)).toBe(2); // Math.round gives 3
  expect(pyRound(3.5)).toBe(4); // Math.round gives 4
});

test("pyRound: negative halves", () => {
  expect(pyRound(-4.5)).toBe(-4); // even
  expect(pyRound(-5.5)).toBe(-6); // even
  expect(pyRound(-2.4)).toBe(-2);
  expect(pyRound(-2.6)).toBe(-3);
});
