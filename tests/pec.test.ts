import { test, expect } from "vitest";
import { ByteReader, EmbConstant as C, EmbPattern, EmbThread, readPec } from "./internal.ts";
import {
  buildPecBlock,
  encStitch,
  encJump,
  encTrim,
  COLOR_CHANGE_BYTES,
  END_BYTES,
  bytes,
} from "./helpers.ts";

function read(block: Uint8Array, chart: EmbThread[] | null = null) {
  const p = new EmbPattern();
  readPec(new ByteReader(block), p, chart);
  return p;
}

function commands(p: EmbPattern): number[] {
  return p.stitches.map((s) => s[2]);
}

function thread(r: number, g: number, b: number): EmbThread {
  const t = new EmbThread();
  t.setColor(r, g, b);
  return t;
}

test("PEC: basic stitches with 7-bit deltas", () => {
  const stream = bytes(
    encStitch(0, 0),
    encStitch(10, 5),
    encStitch(-3, -7),
    END_BYTES
  );
  const p = read(buildPecBlock({ stitches: stream }));
  expect(p.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [10, 5, C.STITCH],
    [7, -2, C.STITCH],
    [7, -2, C.END],
  ]);
});

test("PEC: signed7 boundary (64..127 -> negative)", () => {
  const p = read(buildPecBlock({ stitches: bytes([100, 64], END_BYTES) }));
  expect(p.stitches[0]).toStrictEqual([-28, -64, C.STITCH]);
});

test("PEC: 12-bit long form for x and y", () => {
  const p = read(
    buildPecBlock({ stitches: bytes(encStitch(0x123, -1000), END_BYTES) })
  );
  expect(p.stitches[0]).toStrictEqual([291, -1000, C.STITCH]);
});

test("PEC: 12-bit long form for x only (y stays 7-bit)", () => {
  const p = read(buildPecBlock({ stitches: bytes(encStitch(300, 5), END_BYTES) }));
  expect(p.stitches[0]).toStrictEqual([300, 5, C.STITCH]);
});

test("PEC: JUMP flag emits a JUMP command", () => {
  const p = read(
    buildPecBlock({
      stitches: bytes(encStitch(0, 0), encJump(50, -50), END_BYTES),
    })
  );
  expect(p.stitches[1][2]).toBe(C.JUMP);
  expect(p.stitches[1].slice(0, 2)).toStrictEqual([50, -50]);
});

test("PEC: TRIM flag emits TRIM then JUMP at same delta", () => {
  const p = read(
    buildPecBlock({
      stitches: bytes(encStitch(0, 0), encTrim(20, 30), END_BYTES),
    })
  );
  expect(p.stitches[1][2]).toBe(C.TRIM);
  expect(p.stitches[1].slice(0, 2)).toStrictEqual([0, 0]);
  expect(p.stitches[2][2]).toBe(C.JUMP);
  expect(p.stitches[2].slice(0, 2)).toStrictEqual([20, 30]);
});

test("PEC: 0xFEB0 color change (3 bytes consumed)", () => {
  const p = read(
    buildPecBlock({
      stitches: bytes(encStitch(5, 5), COLOR_CHANGE_BYTES, encStitch(3, 3), END_BYTES),
    })
  );
  expect(commands(p)).toStrictEqual([C.STITCH, C.COLOR_CHANGE, C.STITCH, C.END]);
  expect(p.stitches[2].slice(0, 2)).toStrictEqual([8, 8]);
});

test("PEC: FF00 terminates and END appended", () => {
  const p = read(buildPecBlock({ stitches: bytes(encStitch(1, 1), END_BYTES) }));
  expect(commands(p)).toStrictEqual([C.STITCH, C.END]);
});

test("PEC: label stored in metadata, trimmed", () => {
  const p = read(buildPecBlock({ label: "My Design" }));
  expect(p.getMetadata("Label")).toBe("My Design");
});

test("PEC: color table maps to PEC chart (pesChart empty)", () => {
  const p = read(buildPecBlock({ colors: [5, 29] }), []);
  expect(p.threadlist.length).toBe(2);
  expect(p.threadlist[0].hexColor()).toBe("#ed171f");
  expect(p.threadlist[1].hexColor()).toBe("#f0f0f0");
});

test("PEC: color byte wraps by chart length (byte % 65)", () => {
  const p = read(buildPecBlock({ colors: [69] }), []);
  expect(p.threadlist[0].hexColor()).toBe("#4b6baf");
});

test("PEC: 1:1 chart mode adds every chart thread when chart >= colors", () => {
  const chart = [thread(1, 2, 3), thread(4, 5, 6)];
  const p = read(buildPecBlock({ colors: [5] }), chart);
  expect(p.threadlist.length).toBe(2);
  expect(p.threadlist[0]).toBe(chart[0]);
  expect(p.threadlist[1]).toBe(chart[1]);
});

test("PEC: table mode — chart shorter than colors, duplicates reuse", () => {
  const chart = [thread(10, 20, 30)];
  const popped = chart[0];
  const p = read(buildPecBlock({ colors: [5, 5, 7] }), chart);
  expect(p.threadlist.length).toBe(3);
  expect(p.threadlist[0]).toBe(popped);
  expect(p.threadlist[1]).toBe(popped);
  expect(p.threadlist[2]).not.toBe(popped);
  expect(p.threadlist[2].hexColor()).toBe("#913697");
  expect(chart.length).toBe(0);
});

test("PEC: table mode pops from chart (chart is mutated)", () => {
  const chart = [thread(1, 1, 1), thread(2, 2, 2)];
  const [first, second] = chart;
  const p = read(buildPecBlock({ colors: [5, 7, 9] }), chart);
  expect(p.threadlist[0]).toBe(first);
  expect(p.threadlist[1]).toBe(second);
  expect(chart.length).toBe(0);
  expect(p.threadlist[2].hexColor()).toBe("#915fac");
});

test("PEC: truncated stream (EOF mid-stitch) stops cleanly with END", () => {
  const p = read(buildPecBlock({ stitches: bytes([encStitch(300, 0)[0]]) }));
  expect(commands(p)).toStrictEqual([C.END]);
});

test("PEC: empty stitch stream still yields END", () => {
  const p = read(buildPecBlock({ stitches: END_BYTES }));
  expect(commands(p)).toStrictEqual([C.END]);
});

test("PEC: reader leaves the cursor at the declared stitch block end", () => {
  const block = buildPecBlock({ stitches: bytes(encStitch(1, 1), END_BYTES), pad: 7 });
  const f = new ByteReader(block);
  const p = new EmbPattern();
  readPec(f, p, null);
  const expectedEnd = block.length;
  expect(f.tell()).toBe(expectedEnd);
});
