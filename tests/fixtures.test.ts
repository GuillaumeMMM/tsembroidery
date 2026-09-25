import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { EmbConstant as C, readPes, writePes } from "./internal.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

test("readPes: reads the first stitch of a real file", () => {
  const pattern = readPes(fixture("flowers.pes"));
  expect(pattern.stitches[0]).toStrictEqual([358, 616, C.JUMP]);
  expect(pattern.stitches).toHaveLength(9929);
  expect(pattern.extents()).toStrictEqual({ minX: 0, minY: 0, maxX: 770, maxY: 908 });
});

test.each([1, 6] as const)("writePes: v%i output matches pyembroidery byte for byte", (version) => {
  const pattern = readPes(fixture("flowers.pes"));
  expect(writePes(pattern, { version })).toStrictEqual(
    fixture(`flowers.pyembroidery-v${version}.pes`)
  );
});
