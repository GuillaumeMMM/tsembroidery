import { test, expect } from "vitest";
import {
  getIdentity,
  getScale,
  getTranslate,
  getRotate,
  matrixMultiply,
  pointInMatrixSpace,
  distance,
  distanceSquared,
  towards,
  oriented,
} from "../src/index.ts";

const closeTo = (a: number, b: number, eps = 1e-9) =>
  expect(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`).toBeTruthy();

test("getIdentity leaves points unchanged", () => {
  const p = pointInMatrixSpace(getIdentity(), [3, 4, 0] as any);
  expect(p).toStrictEqual([3, 4, 0]);
});

test("getTranslate shifts points", () => {
  const m = getTranslate(10, -5);
  expect(pointInMatrixSpace(m, 1, 2)).toStrictEqual([11, -3]);
});

test("getScale scales points (uniform and per-axis)", () => {
  expect(pointInMatrixSpace(getScale(2), 3, 4)).toStrictEqual([6, 8]);
  expect(pointInMatrixSpace(getScale(2, 3), 3, 4)).toStrictEqual([6, 12]);
});

test("getRotate 90 degrees rotates CCW in matrix sense", () => {
  const m = getRotate(90);
  const [x, y] = pointInMatrixSpace(m, 1, 0) as [number, number];
  closeTo(x, 0);
  closeTo(y, 1);
});

test("getRotate 360 is identity (approx)", () => {
  const m = getRotate(360);
  const [x, y] = pointInMatrixSpace(m, 5, 7) as [number, number];
  closeTo(x, 5);
  closeTo(y, 7);
});

test("matrixMultiply: python settings order (translate then scale)", () => {
  let m = getIdentity();
  m = matrixMultiply(m, getTranslate(10, 10));
  m = matrixMultiply(m, getScale(2, 2));
  expect(pointInMatrixSpace(m, 0, 0)).toStrictEqual([20, 20]);
});

test("matrixMultiply: identity is neutral on both sides", () => {
  const t = getTranslate(3, 4);
  expect(matrixMultiply(getIdentity(), t)).toStrictEqual(t);
  expect(matrixMultiply(t, getIdentity())).toStrictEqual(t);
});

test("pointInMatrixSpace carries a 3rd element through", () => {
  const m = matrixMultiply(getTranslate(1, 1), getRotate(0));
  const out = pointInMatrixSpace(m, [10, 20, 42] as any);
  expect(out).toStrictEqual([11, 21, 42]);
});

test("pointInMatrixSpace on a 2-element vector returns 2 elements", () => {
  const out = pointInMatrixSpace(getTranslate(1, 1), [5, 5] as any);
  expect(out).toStrictEqual([6, 6]);
});

test("distance / distanceSquared", () => {
  expect(distanceSquared(0, 0, 3, 4)).toBe(25);
  expect(distance(0, 0, 3, 4)).toBe(5);
});

test("towards interpolates within [0,1]", () => {
  expect(towards(0, 100, 0)).toBe(0);
  expect(towards(0, 100, 1)).toBe(100);
  expect(towards(0, 100, 0.33)).toBe(33);
  expect(towards(10, 20, 0.5)).toBe(15);
});

test("oriented reaches distance r toward the target", () => {
  const [x, y] = oriented(0, 0, 10, 0, 4);
  closeTo(x, 4);
  closeTo(y, 0);
  expect(Math.round(distance(0, 0, x, y))).toBe(4);
});

test("oriented from beyond target keeps direction", () => {
  const [x, y] = oriented(10, 0, 0, 0, 5);
  closeTo(x, 5);
  closeTo(y, 0);
});
