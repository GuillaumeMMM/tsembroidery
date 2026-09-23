import { test } from "node:test";
import assert from "node:assert/strict";
import { pyRound } from "../dist/index.js";

// python `round()` semantics: half-to-even, returns int.
test("pyRound: no rounding needed", () => {
  assert.equal(pyRound(0), 0);
  assert.equal(pyRound(2.0), 2);
  assert.equal(pyRound(2.4), 2);
  assert.equal(pyRound(2.6), 3);
});

test("pyRound: half-to-even (differs from Math.round)", () => {
  assert.equal(pyRound(4.5), 4); // Math.round gives 5
  assert.equal(pyRound(5.5), 6); // Math.round gives 6
  assert.equal(pyRound(2.5), 2); // Math.round gives 3
  assert.equal(pyRound(3.5), 4); // Math.round gives 4
});

test("pyRound: negative halves", () => {
  assert.equal(pyRound(-4.5), -4); // even
  assert.equal(pyRound(-5.5), -6); // even
  assert.equal(pyRound(-2.4), -2);
  assert.equal(pyRound(-2.6), -3);
});
