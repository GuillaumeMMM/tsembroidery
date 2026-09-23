import { test } from "node:test";
import assert from "node:assert/strict";
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
} from "../dist/index.js";

const closeTo = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

test("getIdentity leaves points unchanged", () => {
  const p = pointInMatrixSpace(getIdentity(), [3, 4, 0] as any);
  assert.deepEqual(p, [3, 4, 0]);
});

test("getTranslate shifts points", () => {
  const m = getTranslate(10, -5);
  assert.deepEqual(pointInMatrixSpace(m, 1, 2), [11, -3]);
});

test("getScale scales points (uniform and per-axis)", () => {
  assert.deepEqual(pointInMatrixSpace(getScale(2), 3, 4), [6, 8]);
  assert.deepEqual(pointInMatrixSpace(getScale(2, 3), 3, 4), [6, 12]);
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
  // python builds: matrix = I; matrix = multiply(matrix, translate);
  // matrix = multiply(matrix, scale). Row-vector convention: p*(A*B)
  // applies A first, then B -> translate (0,0)->(10,10), scale ->(20,20).
  let m = getIdentity();
  m = matrixMultiply(m, getTranslate(10, 10));
  m = matrixMultiply(m, getScale(2, 2));
  assert.deepEqual(pointInMatrixSpace(m, 0, 0), [20, 20]);
});

test("matrixMultiply: identity is neutral on both sides", () => {
  const t = getTranslate(3, 4);
  assert.deepEqual(matrixMultiply(getIdentity(), t), t);
  assert.deepEqual(matrixMultiply(t, getIdentity()), t);
});

test("pointInMatrixSpace carries a 3rd element through", () => {
  const m = matrixMultiply(getTranslate(1, 1), getRotate(0));
  const out = pointInMatrixSpace(m, [10, 20, 42] as any);
  assert.deepEqual(out, [11, 21, 42]); // command survives transform
});

test("pointInMatrixSpace on a 2-element vector returns 2 elements", () => {
  const out = pointInMatrixSpace(getTranslate(1, 1), [5, 5] as any);
  assert.deepEqual(out, [6, 6]);
});

test("distance / distanceSquared", () => {
  assert.equal(distanceSquared(0, 0, 3, 4), 25);
  assert.equal(distance(0, 0, 3, 4), 5);
});

test("towards interpolates within [0,1]", () => {
  assert.equal(towards(0, 100, 0), 0);
  assert.equal(towards(0, 100, 1), 100);
  assert.equal(towards(0, 100, 0.33), 33);
  assert.equal(towards(10, 20, 0.5), 15);
});

test("oriented reaches distance r toward the target", () => {
  const [x, y] = oriented(0, 0, 10, 0, 4);
  closeTo(x, 4);
  closeTo(y, 0);
  assert.equal(Math.round(distance(0, 0, x, y)), 4);
});

test("oriented from beyond target keeps direction", () => {
  const [x, y] = oriented(10, 0, 0, 0, 5);
  closeTo(x, 5);
  closeTo(y, 0);
});
