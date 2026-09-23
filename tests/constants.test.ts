import { test } from "node:test";
import assert from "node:assert/strict";
import { EmbConstant } from "../dist/index.js";

// Pinned to pyembroidery EmbConstant.py values.
test("EmbConstant core command values", () => {
  assert.equal(EmbConstant.NO_COMMAND, -1);
  assert.equal(EmbConstant.STITCH, 0);
  assert.equal(EmbConstant.JUMP, 1);
  assert.equal(EmbConstant.TRIM, 2);
  assert.equal(EmbConstant.STOP, 3);
  assert.equal(EmbConstant.END, 4);
  assert.equal(EmbConstant.COLOR_CHANGE, 5);
  assert.equal(EmbConstant.SEQUIN_MODE, 6);
  assert.equal(EmbConstant.SEQUIN_EJECT, 7);
  assert.equal(EmbConstant.SLOW, 0xb);
  assert.equal(EmbConstant.FAST, 0xc);
});

test("EmbConstant implied-contingency and break values", () => {
  assert.equal(EmbConstant.SEW_TO, 0xb0);
  assert.equal(EmbConstant.NEEDLE_AT, 0xb1);
  assert.equal(EmbConstant.STITCH_BREAK, 0xe0);
  assert.equal(EmbConstant.SEQUENCE_BREAK, 0xe1);
  assert.equal(EmbConstant.COLOR_BREAK, 0xe2);
  assert.equal(EmbConstant.TIE_ON, 0xe4);
  assert.equal(EmbConstant.TIE_OFF, 0xe5);
  assert.equal(EmbConstant.FRAME_EJECT, 0xe9);
});

test("EmbConstant matrix, option and contingency values", () => {
  assert.equal(EmbConstant.MATRIX_TRANSLATE, 0xc0);
  assert.equal(EmbConstant.MATRIX_SCALE, 0xc1);
  assert.equal(EmbConstant.MATRIX_ROTATE, 0xc2);
  assert.equal(EmbConstant.MATRIX_RESET, 0xc3);
  assert.equal(EmbConstant.OPTION_ENABLE_TIE_ON, 0xd1);
  assert.equal(EmbConstant.OPTION_ENABLE_TIE_OFF, 0xd2);
  assert.equal(EmbConstant.OPTION_DISABLE_TIE_ON, 0xd3);
  assert.equal(EmbConstant.OPTION_DISABLE_TIE_OFF, 0xd4);
  assert.equal(EmbConstant.OPTION_MAX_STITCH_LENGTH, 0xd5);
  assert.equal(EmbConstant.OPTION_MAX_JUMP_LENGTH, 0xd6);
  assert.equal(EmbConstant.OPTION_EXPLICIT_TRIM, 0xd7);
  assert.equal(EmbConstant.OPTION_IMPLICIT_TRIM, 0xd8);
  assert.equal(EmbConstant.CONTINGENCY_NONE, 0xf0);
  assert.equal(EmbConstant.CONTINGENCY_JUMP_NEEDLE, 0xf1);
  assert.equal(EmbConstant.CONTINGENCY_SEW_TO, 0xf2);
  assert.equal(EmbConstant.CONTINGENCY_SEQUIN_UTILIZE, 0xf5);
  assert.equal(EmbConstant.CONTINGENCY_SEQUIN_JUMP, 0xf6);
  assert.equal(EmbConstant.CONTINGENCY_SEQUIN_STITCH, 0xf7);
  assert.equal(EmbConstant.CONTINGENCY_SEQUIN_REMOVE, 0xf8);
  assert.equal(EmbConstant.COMMAND_MASK, 0xff);
});
