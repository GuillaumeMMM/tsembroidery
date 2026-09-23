import { test, expect } from "vitest";
import { EmbConstant } from "../src/index.ts";

// Pinned to pyembroidery EmbConstant.py values.
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

test("EmbConstant implied-contingency and break values", () => {
  expect(EmbConstant.SEW_TO).toBe(0xb0);
  expect(EmbConstant.NEEDLE_AT).toBe(0xb1);
  expect(EmbConstant.STITCH_BREAK).toBe(0xe0);
  expect(EmbConstant.SEQUENCE_BREAK).toBe(0xe1);
  expect(EmbConstant.COLOR_BREAK).toBe(0xe2);
  expect(EmbConstant.TIE_ON).toBe(0xe4);
  expect(EmbConstant.TIE_OFF).toBe(0xe5);
  expect(EmbConstant.FRAME_EJECT).toBe(0xe9);
});

test("EmbConstant matrix, option and contingency values", () => {
  expect(EmbConstant.MATRIX_TRANSLATE).toBe(0xc0);
  expect(EmbConstant.MATRIX_SCALE).toBe(0xc1);
  expect(EmbConstant.MATRIX_ROTATE).toBe(0xc2);
  expect(EmbConstant.MATRIX_RESET).toBe(0xc3);
  expect(EmbConstant.OPTION_ENABLE_TIE_ON).toBe(0xd1);
  expect(EmbConstant.OPTION_ENABLE_TIE_OFF).toBe(0xd2);
  expect(EmbConstant.OPTION_DISABLE_TIE_ON).toBe(0xd3);
  expect(EmbConstant.OPTION_DISABLE_TIE_OFF).toBe(0xd4);
  expect(EmbConstant.OPTION_MAX_STITCH_LENGTH).toBe(0xd5);
  expect(EmbConstant.OPTION_MAX_JUMP_LENGTH).toBe(0xd6);
  expect(EmbConstant.OPTION_EXPLICIT_TRIM).toBe(0xd7);
  expect(EmbConstant.OPTION_IMPLICIT_TRIM).toBe(0xd8);
  expect(EmbConstant.CONTINGENCY_NONE).toBe(0xf0);
  expect(EmbConstant.CONTINGENCY_JUMP_NEEDLE).toBe(0xf1);
  expect(EmbConstant.CONTINGENCY_SEW_TO).toBe(0xf2);
  expect(EmbConstant.CONTINGENCY_SEQUIN_UTILIZE).toBe(0xf5);
  expect(EmbConstant.CONTINGENCY_SEQUIN_JUMP).toBe(0xf6);
  expect(EmbConstant.CONTINGENCY_SEQUIN_STITCH).toBe(0xf7);
  expect(EmbConstant.CONTINGENCY_SEQUIN_REMOVE).toBe(0xf8);
  expect(EmbConstant.COMMAND_MASK).toBe(0xff);
});
