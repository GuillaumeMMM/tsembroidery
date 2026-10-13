import { test, expect } from "vitest";
import { EmbConstant } from "./internal.ts";

test("EmbConstant core command values", () => {
  expect(EmbConstant.NO_COMMAND).toBe(-1);
  expect(EmbConstant.STITCH).toBe(0);
  expect(EmbConstant.JUMP).toBe(1);
  expect(EmbConstant.TRIM).toBe(2);
  expect(EmbConstant.STOP).toBe(3);
  expect(EmbConstant.END).toBe(4);
  expect(EmbConstant.COLOR_CHANGE).toBe(5);
  expect(EmbConstant.SEQUIN_MODE).toBe(6);
  expect(EmbConstant.SEQUIN_EJECT).toBe(7);
  expect(EmbConstant.SLOW).toBe(0xb);
  expect(EmbConstant.FAST).toBe(0xc);
});

test("EmbConstant break values", () => {
  expect(EmbConstant.STITCH_BREAK).toBe(0xe0);
  expect(EmbConstant.SEQUENCE_BREAK).toBe(0xe1);
  expect(EmbConstant.COLOR_BREAK).toBe(0xe2);
});

test("EmbConstant contingency values", () => {
  expect(EmbConstant.CONTINGENCY_SEQUIN_UTILIZE).toBe(0xf5);
  expect(EmbConstant.CONTINGENCY_SEQUIN_JUMP).toBe(0xf6);
  expect(EmbConstant.CONTINGENCY_SEQUIN_STITCH).toBe(0xf7);
  expect(EmbConstant.CONTINGENCY_SEQUIN_REMOVE).toBe(0xf8);
  expect(EmbConstant.COMMAND_MASK).toBe(0xff);
});
