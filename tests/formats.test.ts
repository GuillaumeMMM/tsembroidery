import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import {
  EmbConstant as C,
  EmbPattern,
  readExp,
  readJef,
  readPes,
  readVp3,
  readXxx,
  writeExp,
  writeJef,
  writeVp3,
  writeXxx,
} from "./internal.ts";

// Expected files were written by pyembroidery 1.5.1 from flowers.pes; JEF with the date set to 20260101120000.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const flowers = () => readPes(fixture("flowers.pes"));
const date = "20260101120000";

const counts = (pattern: EmbPattern) =>
  [C.STITCH, C.JUMP, C.TRIM, C.COLOR_CHANGE, C.END].map((command) => pattern.countStitchCommands(command));

test("writers: output matches pyembroidery byte for byte", () => {
  expect(writeExp(flowers())).toStrictEqual(fixture("flowers.pyembroidery.exp"));
  expect(writeXxx(flowers())).toStrictEqual(fixture("flowers.pyembroidery.xxx"));
  expect(writeVp3(flowers())).toStrictEqual(fixture("flowers.pyembroidery.vp3"));
  expect(writeJef(flowers(), { date })).toStrictEqual(fixture("flowers.pyembroidery.jef"));
  expect(writeJef(flowers(), { date, trims: true })).toStrictEqual(fixture("flowers.pyembroidery-trims.jef"));
});

test("readers: read files as pyembroidery does", () => {
  const extents = { minX: 0, minY: 0, maxX: 770, maxY: 908 };
  const exp = readExp(fixture("flowers.pyembroidery.exp"));
  expect(counts(exp)).toStrictEqual([9862, 75, 26, 12, 1]);
  expect(exp.extents()).toStrictEqual(extents);
  expect(exp.threadlist).toHaveLength(0);

  const xxx = readXxx(fixture("flowers.pyembroidery.xxx"));
  expect(counts(xxx)).toStrictEqual([9862, 53, 26, 12, 1]);
  expect(xxx.extents()).toStrictEqual(extents);
  expect(xxx.threadlist.map((thread) => thread.hexColor())).toStrictEqual(flowers().threadlist.map((thread) => thread.hexColor()));

  const vp3 = readVp3(fixture("flowers.pyembroidery.vp3"));
  expect(counts(vp3)).toStrictEqual([9862, 12, 27, 12, 1]);
  expect(vp3.extents()).toStrictEqual(extents);
  expect(vp3.stitches.slice(0, 2)).toStrictEqual([
    [373, 596, C.STITCH],
    [354, 619, C.STITCH],
  ]);
  expect(vp3.threadlist).toHaveLength(13);
  expect(vp3.threadlist[0]).toMatchObject({ description: "Sky Blue", catalog_number: "32", brand: "Brother" });

  for (const name of ["flowers.pyembroidery.jef", "flowers.pyembroidery-trims.jef"]) {
    const jef = readJef(fixture(name));
    expect(counts(jef)).toStrictEqual([9862, 75, 24, 12, 1]);
    expect(jef.extents()).toStrictEqual(extents);
    // JEF keeps only indexes into Janome's thread chart.
    expect(jef.threadlist.slice(0, 3).map((thread) => thread.hexColor())).toStrictEqual(["#1e77ac", "#4d3419", "#98d6bd"]);
    expect(jef.threadlist[0]).toMatchObject({ description: "Sola Blue", catalog_number: "263", brand: "Jef" });
  }
});

test("writers/readers: round-trip stitches and color changes", () => {
  const pattern = new EmbPattern();
  pattern.addThread({ hex: "#ff0000" });
  pattern.addThread({ hex: "#0000ff" });
  pattern.stitchAbs(0, 0);
  pattern.stitchAbs(50, 30);
  pattern.stitchAbs(320, -150); // Longer than one record: split.
  pattern.colorChange();
  pattern.stitchAbs(330, -140);
  pattern.end();
  const stitched = (read: EmbPattern) => read.stitches.filter(([, , c]) => c === C.STITCH).map(([x, y]) => [x, y]);
  for (const [write, read] of [
    [writeExp, readExp],
    [writeXxx, readXxx],
    [writeVp3, readVp3],
    [(p: EmbPattern) => writeJef(p, { date }), readJef],
  ] as const) {
    const result = read(write(pattern));
    const points = stitched(result);
    expect(result.countColorChanges()).toBe(1);
    expect(points[points.length - 1]).toStrictEqual([330, -140]);
    // Each format places the design on its own origin; relative moves are kept.
    const [x0, y0] = points[0];
    expect(points.map(([x, y]) => [x - x0, y - y0])).toContainEqual([320, -150]);
  }
});

test("writers: reject moves too long for a record when encoding is off", () => {
  const pattern = new EmbPattern();
  pattern.stitchAbs(0, 0);
  pattern.stitchAbs(500, 0);
  pattern.end();
  expect(() => writeExp(pattern, { encode: false })).toThrow(/EXP limit/);
  expect(() => writeJef(pattern, { encode: false, date })).toThrow(/JEF limit/);
  pattern.stitches[1][2] = C.JUMP;
  expect(() => writeXxx(pattern, { encode: false })).toThrow(/XXX limit/);
});

test("writeJef: stamps the current date by default", () => {
  const pattern = new EmbPattern();
  pattern.stitchAbs(0, 0);
  pattern.stitchAbs(10, 0);
  const stamp = new TextDecoder().decode(writeJef(pattern).subarray(8, 22));
  expect(stamp).toMatch(new RegExp(`^${new Date().getFullYear()}\\d{10}$`));
});
