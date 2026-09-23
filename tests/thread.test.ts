import { test } from "node:test";
import assert from "node:assert/strict";
import { EmbThread, findNearestColorIndex } from "../dist/index.js";

test("setColor forces the 0xFF alpha byte", () => {
  const t = new EmbThread();
  t.setColor(0x12, 0x34, 0x56);
  assert.equal(t.color, 0xff123456 >>> 0);
  assert.equal(t.getOpaqueColor(), 0xff123456 >>> 0);
});

test("color getters mask to 8 bits regardless of alpha", () => {
  const t = new EmbThread();
  t.setColor(255, 128, 0);
  assert.equal(t.getRed(), 255);
  assert.equal(t.getGreen(), 128);
  assert.equal(t.getBlue(), 0);
});

test("hexColor includes '#' and is zero-padded", () => {
  const t = new EmbThread();
  t.setColor(0x0a, 0x0b, 0x0c);
  assert.equal(t.hexColor(), "#0a0b0c");
  t.setColor(0, 0, 0);
  assert.equal(t.hexColor(), "#000000");
  t.setColor(255, 255, 255);
  assert.equal(t.hexColor(), "#ffffff");
});

test("hexColor works when color has no alpha byte", () => {
  const t = new EmbThread();
  t.color = 0x000abc; // set_hex_color stores bare 24-bit value
  assert.equal(t.hexColor(), "#000abc");
});

test("setHexColor with 6 digits", () => {
  const t = new EmbThread();
  t.setHexColor("#123456");
  assert.equal(t.color, 0x123456);
  assert.equal(t.hexColor(), "#123456");
});

test("setHexColor strips leading #", () => {
  const t = new EmbThread();
  t.setHexColor("#abcdef");
  assert.equal(t.color, 0xabcdef);
  // multiple '#' like python lstrip('#')
  const t2 = new EmbThread();
  t2.setHexColor("##aabbcc");
  assert.equal(t2.color, 0xaabbcc);
});

test("setHexColor with 8 digits uses the first 6", () => {
  const t = new EmbThread();
  t.setHexColor("#123456ff");
  assert.equal(t.color, 0x123456);
});

test("setHexColor with 3 digits expands forward (PY-BUG fixed)", () => {
  // python reverses the digits: "#abc" -> rgb(cc,bb,aa). Fixed to CSS
  // semantics: "#abc" -> rgb(aa,bb,cc).
  const t = new EmbThread();
  t.setHexColor("#abc");
  assert.equal(t.getRed(), 0xaa);
  assert.equal(t.getGreen(), 0xbb);
  assert.equal(t.getBlue(), 0xcc);
});

test("setHexColor with 4 digits uses the first 3 (alpha ignored)", () => {
  const t = new EmbThread();
  t.setHexColor("#abcd");
  assert.equal(t.getRed(), 0xaa);
  assert.equal(t.getGreen(), 0xbb);
  assert.equal(t.getBlue(), 0xcc);
});

test("findNearestColorIndex exact match", () => {
  const a = new EmbThread();
  a.setColor(255, 0, 0);
  const b = new EmbThread();
  b.setColor(0, 255, 0);
  assert.equal(findNearestColorIndex(0xff0000, [a, b]), 0);
  assert.equal(findNearestColorIndex(0x00ff00, [a, b]), 1);
});

test("findNearestColorIndex skips null entries", () => {
  const a = new EmbThread();
  a.setColor(255, 0, 0);
  assert.equal(findNearestColorIndex(0xff0000, [null, a]), 1);
  assert.equal(findNearestColorIndex(0xff0000, [null, null]), -1);
});

test("findNearestColorIndex tie resolves to the later index", () => {
  // python uses `<=`, so an exact tie keeps the LAST match.
  const a = new EmbThread();
  a.setColor(0, 0, 0);
  const b = new EmbThread();
  b.setColor(0, 0, 0);
  assert.equal(findNearestColorIndex(0x000000, [a, b]), 1);
});

test("findNearestColorIndex accepts an EmbThread as target", () => {
  const red = new EmbThread();
  red.setColor(255, 0, 0);
  const blue = new EmbThread();
  blue.setColor(0, 0, 255);
  assert.equal(findNearestColorIndex(red, [blue, red]), 1);
});

test("findNearestColorIndex picks perceptually nearer color (red-mean)", () => {
  const dark = new EmbThread();
  dark.setColor(10, 10, 10);
  const bright = new EmbThread();
  bright.setColor(240, 0, 0);
  // A dark red should be closer to dark gray than to bright red? No —
  // red-mean weights red: check the actual nearest to (180, 0, 0).
  const target = new EmbThread();
  target.setColor(180, 0, 0);
  assert.equal(target.findNearestColorIndex([dark, bright]), 1);
});
