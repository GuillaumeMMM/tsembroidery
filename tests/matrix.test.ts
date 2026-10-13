import { test, expect } from "vitest";
import {
  getIdentity,
  getScale,
  getTranslate,
  getRotate,
  matrixMultiply,
} from "./internal.ts";

const apply = (m: number[], x: number, y: number): [number, number] => [
  x * m[0] + y * m[3] + m[6],
  x * m[1] + y * m[4] + m[7],
];

const closeTo = (a: number, b: number, eps = 1e-9) =>
  expect(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`).toBeTruthy();

test("getIdentity leaves points unchanged", () => {
  expect(apply(getIdentity(), 3, 4)).toStrictEqual([3, 4]);
});

test("getTranslate shifts points", () => {
  const m = getTranslate(10, -5);
  expect(apply(m, 1, 2)).toStrictEqual([11, -3]);
});

test("getScale scales points (uniform and per-axis)", () => {
  expect(apply(getScale(2), 3, 4)).toStrictEqual([6, 8]);
  expect(apply(getScale(2, 3), 3, 4)).toStrictEqual([6, 12]);
});

test("getRotate 90 degrees rotates CCW in matrix sense", () => {
  const m = getRotate(90);
  const [x, y] = apply(m, 1, 0);
  closeTo(x, 0);
  closeTo(y, 1);
});

test("getRotate 360 is identity (approx)", () => {
  const m = getRotate(360);
  const [x, y] = apply(m, 5, 7);
  closeTo(x, 5);
  closeTo(y, 7);
});

test("matrixMultiply: python settings order (translate then scale)", () => {
  let m = getIdentity();
  m = matrixMultiply(m, getTranslate(10, 10));
  m = matrixMultiply(m, getScale(2, 2));
  expect(apply(m, 0, 0)).toStrictEqual([20, 20]);
});

test("matrixMultiply: identity is neutral on both sides", () => {
  const t = getTranslate(3, 4);
  expect(matrixMultiply(getIdentity(), t)).toStrictEqual(t);
  expect(matrixMultiply(t, getIdentity())).toStrictEqual(t);
});
