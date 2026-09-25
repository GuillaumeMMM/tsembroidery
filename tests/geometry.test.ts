import { test, expect } from "vitest";
import { clipLines, strokeOutline, subtract, unionRings } from "../src/svg/geometry.ts";

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const bounds = (rings: { x: number; y: number }[][]) => {
  const points = rings.flat();
  return [
    Math.min(...points.map((p) => p.x)),
    Math.min(...points.map((p) => p.y)),
    Math.max(...points.map((p) => p.x)),
    Math.max(...points.map((p) => p.y)),
  ];
};

test("unionRings applies the fill rule", () => {
  expect(unionRings([square(0, 0, 100), square(25, 25, 50)], "evenodd")).toHaveLength(2);
  expect(unionRings([square(0, 0, 100), square(25, 25, 50)], "nonzero")).toHaveLength(1);
  expect(unionRings([[{ x: 0, y: 0 }, { x: 10, y: 0 }]])).toHaveLength(0);
});

test("subtract removes the covered area", () => {
  const result = subtract([square(0, 0, 400)], [square(200, 200, 400)]);
  expect(result).toHaveLength(1);
  expect(result[0]).toHaveLength(6);
  expect(bounds(result)).toStrictEqual([0, 0, 400, 400]);
});

test("strokeOutline covers half the width on each side", () => {
  const line = { points: [{ x: 0, y: 200 }, { x: 400, y: 200 }], closed: false };
  expect(bounds(strokeOutline([line], 60, "butt", "miter"))).toStrictEqual([0, 170, 400, 230]);
  expect(bounds(strokeOutline([line], 60, "square", "miter"))).toStrictEqual([-30, 170, 430, 230]);
  const ring = strokeOutline([{ points: square(0, 0, 100), closed: true }], 20, "butt", "miter");
  expect(bounds(ring)).toStrictEqual([-10, -10, 110, 110]);
  expect(ring).toHaveLength(2);
});

test("clipLines keeps the parts outside the region", () => {
  const band = [[{ x: 0, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 60 }, { x: 0, y: 60 }]];
  const pieces = clipLines([{ points: [{ x: 50, y: -20 }, { x: 50, y: 120 }], closed: false }], band);
  expect(pieces.map((piece) => piece.points.map((p) => p.y).sort((a, b) => a - b))).toEqual(
    expect.arrayContaining([[-20, 40], [60, 120]])
  );
  const loop = { points: square(200, 200, 10), closed: true };
  const [untouched] = clipLines([loop], band);
  expect(untouched.closed).toBe(true);
  expect(untouched.points).toHaveLength(4);
});
