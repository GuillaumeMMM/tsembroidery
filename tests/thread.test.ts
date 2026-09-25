import { test, expect } from "vitest";
import { EmbThread, findNearestColorIndex } from "../src/index.ts";

test("setColor forces the 0xFF alpha byte", () => {
  const t = new EmbThread();
  t.setColor(0x12, 0x34, 0x56);
  expect(t.color).toBe(0xff123456 >>> 0);
  expect(t.getOpaqueColor()).toBe(0xff123456 >>> 0);
});

test("color getters mask to 8 bits regardless of alpha", () => {
  const t = new EmbThread();
  t.setColor(255, 128, 0);
  expect(t.getRed()).toBe(255);
  expect(t.getGreen()).toBe(128);
  expect(t.getBlue()).toBe(0);
});

test("hexColor includes '#' and is zero-padded", () => {
  const t = new EmbThread();
  t.setColor(0x0a, 0x0b, 0x0c);
  expect(t.hexColor()).toBe("#0a0b0c");
  t.setColor(0, 0, 0);
  expect(t.hexColor()).toBe("#000000");
  t.setColor(255, 255, 255);
  expect(t.hexColor()).toBe("#ffffff");
});

test("hexColor works when color has no alpha byte", () => {
  const t = new EmbThread();
  t.color = 0x000abc;
  expect(t.hexColor()).toBe("#000abc");
});

test("setHexColor with 6 digits", () => {
  const t = new EmbThread();
  t.setHexColor("#123456");
  expect(t.color).toBe(0x123456);
  expect(t.hexColor()).toBe("#123456");
});

test("setHexColor strips leading #", () => {
  const t = new EmbThread();
  t.setHexColor("#abcdef");
  expect(t.color).toBe(0xabcdef);
  const t2 = new EmbThread();
  t2.setHexColor("##aabbcc");
  expect(t2.color).toBe(0xaabbcc);
});

test("setHexColor with 8 digits uses the first 6", () => {
  const t = new EmbThread();
  t.setHexColor("#123456ff");
  expect(t.color).toBe(0x123456);
});

test("setHexColor with 3 digits expands forward (PY-BUG fixed)", () => {
  const t = new EmbThread();
  t.setHexColor("#abc");
  expect(t.getRed()).toBe(0xaa);
  expect(t.getGreen()).toBe(0xbb);
  expect(t.getBlue()).toBe(0xcc);
});

test("setHexColor with 4 digits uses the first 3 (alpha ignored)", () => {
  const t = new EmbThread();
  t.setHexColor("#abcd");
  expect(t.getRed()).toBe(0xaa);
  expect(t.getGreen()).toBe(0xbb);
  expect(t.getBlue()).toBe(0xcc);
});

test("findNearestColorIndex exact match", () => {
  const a = new EmbThread();
  a.setColor(255, 0, 0);
  const b = new EmbThread();
  b.setColor(0, 255, 0);
  expect(findNearestColorIndex(0xff0000, [a, b])).toBe(0);
  expect(findNearestColorIndex(0x00ff00, [a, b])).toBe(1);
});

test("findNearestColorIndex skips null entries", () => {
  const a = new EmbThread();
  a.setColor(255, 0, 0);
  expect(findNearestColorIndex(0xff0000, [null, a])).toBe(1);
  expect(findNearestColorIndex(0xff0000, [null, null])).toBe(-1);
});

test("findNearestColorIndex tie resolves to the later index", () => {
  const a = new EmbThread();
  a.setColor(0, 0, 0);
  const b = new EmbThread();
  b.setColor(0, 0, 0);
  expect(findNearestColorIndex(0x000000, [a, b])).toBe(1);
});

test("findNearestColorIndex accepts an EmbThread as target", () => {
  const red = new EmbThread();
  red.setColor(255, 0, 0);
  const blue = new EmbThread();
  blue.setColor(0, 0, 255);
  expect(findNearestColorIndex(red, [blue, red])).toBe(1);
});

test("findNearestColorIndex picks perceptually nearer color (red-mean)", () => {
  const dark = new EmbThread();
  dark.setColor(10, 10, 10);
  const bright = new EmbThread();
  bright.setColor(240, 0, 0);
  const target = new EmbThread();
  target.setColor(180, 0, 0);
  expect(target.findNearestColorIndex([dark, bright])).toBe(1);
});
