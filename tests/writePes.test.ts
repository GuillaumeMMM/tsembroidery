import { test, expect } from "vitest";
import {
  ByteReader,
  EmbConstant as C,
  EmbPattern,
  EmbThread,
  readInt32le,
  readPes,
  writePes,
} from "../src/index.ts";

function thread(r: number, g: number, b: number): EmbThread {
  const t = new EmbThread();
  t.setColor(r, g, b);
  return t;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(start, start + length),
  );
}

function pecOffset(bytes: Uint8Array): number {
  const value = readInt32le(new ByteReader(bytes.subarray(8)));
  expect(value).not.toBeNull();
  return value as number;
}

test("writePes: v6 is the default and a simple design round-trips", () => {
  const source = new EmbPattern();
  source.addThread(thread(18, 52, 86));
  source.stitchAbs(0, 0);
  source.stitch(100, 70);
  source.stitch(0, -140);

  const bytes = writePes(source);

  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(ascii(bytes, 0, 8)).toBe("#PES0060");
  const offset = pecOffset(bytes);
  expect(offset).toBeGreaterThan(0);
  expect(ascii(bytes, offset, 3)).toBe("LA:");

  const result = readPes(bytes);
  expect(result.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [100, 70, C.STITCH],
    [100, -70, C.STITCH],
    [100, -70, C.END],
  ]);
  expect(result.threadlist[0].hexColor()).toBe("#123456");
});

test("writePes: v1 maps source colors to the Brother palette", () => {
  const source = new EmbPattern();
  source.addThread(thread(255, 0, 0));
  source.stitchAbs(0, 0);
  source.stitch(10, -10);

  const bytes = writePes(source, { version: 1 });
  expect(ascii(bytes, 0, 8)).toBe("#PES0001");
  expect(ascii(bytes, pecOffset(bytes), 3)).toBe("LA:");

  const result = readPes(bytes);
  expect(result.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [10, -10, C.STITCH],
    [10, -10, C.END],
  ]);
  expect(result.threadlist[0].hexColor()).toBe("#ed171f");
});

test("writePes: v6 preserves metadata and thread fields", () => {
  const source = new EmbPattern();
  const red = thread(0x12, 0x34, 0x56);
  red.catalog_number = "C-123";
  red.description = "Custom blue";
  red.brand = "Example";
  red.chart = "Chart";
  source.addThread(red);
  source.metadata("name", "My design");
  source.metadata("category", "Samples");
  source.metadata("author", "Alice");
  source.metadata("keywords", "svg, test");
  source.metadata("comments", "Hello PES");
  source.stitchAbs(0, 0);
  source.stitch(25, 35);

  const result = readPes(writePes(source));

  expect(result.getMetadata("name")).toBe("My design");
  expect(result.getMetadata("category")).toBe("Samples");
  expect(result.getMetadata("author")).toBe("Alice");
  expect(result.getMetadata("keywords")).toBe("svg, test");
  expect(result.getMetadata("comments")).toBe("Hello PES");
  expect(result.threadlist).toHaveLength(1);
  expect(result.threadlist[0].color).toBe(0xff123456 >>> 0);
  expect(result.threadlist[0].catalog_number).toBe("C-123");
  expect(result.threadlist[0].description).toBe("Custom blue");
  expect(result.threadlist[0].brand).toBe("Example");
  expect(result.threadlist[0].chart).toBe("Chart");
});

test("writePes: distinct color changes and stops survive a round trip", () => {
  const red = thread(255, 0, 0);
  const green = thread(0, 255, 0);

  const withStop = new EmbPattern();
  withStop.addThread(red);
  withStop.stitchAbs(0, 0);
  withStop.stop();
  withStop.stitch(10, 10);
  const stopResult = readPes(writePes(withStop));
  expect(stopResult.stitches.map((s) => s[2])).toStrictEqual([
    C.STITCH,
    C.STOP,
    C.TRIM,
    C.JUMP,
    C.STITCH,
    C.END,
  ]);
  expect(stopResult.threadlist).toHaveLength(1);

  const withColor = new EmbPattern();
  withColor.addThread(red);
  withColor.addThread(green);
  withColor.stitchAbs(0, 0);
  withColor.colorChange();
  withColor.stitch(5, 5);
  const colorResult = readPes(writePes(withColor));
  expect(colorResult.stitches.map((s) => s[2])).toStrictEqual([
    C.STITCH,
    C.COLOR_CHANGE,
    C.TRIM,
    C.JUMP,
    C.STITCH,
    C.END,
  ]);
  expect(colorResult.threadlist[0].hexColor()).toBe("#ff0000");
  expect(colorResult.threadlist[1].hexColor()).toBe("#00ff00");
});

test("writePes: encodes signed stitch boundaries", () => {
  const source = new EmbPattern();
  source.addThread(thread(0, 0, 0));
  source.stitchAbs(0, 0);
  source.stitch(63, -64);
  source.stitch(1984, -1984);
  source.stitch(63, -64); // final deltas are +2047 / -2048

  const result = readPes(writePes(source));
  expect(result.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [63, -64, C.STITCH],
    [2047, -2048, C.STITCH],
    [2110, -2112, C.STITCH],
    [2110, -2112, C.END],
  ]);
});

test("writePes: default encoding splits stitches at the PES delta limit", () => {
  const source = new EmbPattern();
  source.addThread(thread(0, 0, 0));
  source.stitchAbs(0, 0);
  source.stitch(5000, 0);

  const result = readPes(writePes(source));
  expect(result.stitches.map((s) => [s[0], s[2]])).toStrictEqual([
    [0, C.STITCH],
    [0, C.TRIM],
    [1667, C.JUMP],
    [1667, C.TRIM],
    [3333, C.JUMP],
    [5000, C.STITCH],
    [5000, C.END],
  ]);
});

test("writePes: empty and jump-only patterns produce readable designs", () => {
  const empty = readPes(writePes(new EmbPattern()));
  expect(empty.stitches).toStrictEqual([[0, 0, C.END]]);
  expect(empty.threadlist[0].hexColor()).toBe("#000000");

  const jumpOnly = new EmbPattern();
  jumpOnly.moveAbs(0, 0);
  jumpOnly.move(25, -10);
  const result = readPes(writePes(jumpOnly));
  expect(result.stitches.map((s) => s[2])).toStrictEqual([
    C.JUMP,
    C.TRIM,
    C.JUMP,
    C.END,
  ]);
  expect(result.stitches[0].slice(0, 2)).toStrictEqual([0, 0]);
  expect(result.stitches[2].slice(0, 2)).toStrictEqual([25, -10]);
});

test("writePes: does not mutate the source pattern or settings", () => {
  const source = new EmbPattern();
  const t = thread(1, 2, 3);
  source.addThread(t);
  source.stitchAbs(0, 0);
  source.stop();
  source.stitch(10, 10);
  const stitchesBefore = structuredClone(source.stitches);
  const threadsBefore = [...source.threadlist];
  const settings = { version: 6 as const, max_stitch: 100 };

  writePes(source, settings);

  expect(source.stitches).toStrictEqual(stitchesBefore);
  expect(source.threadlist).toStrictEqual(threadsBefore);
  expect(settings).toStrictEqual({ version: 6, max_stitch: 100 });
});

test("writePes: validates version and raw unrepresentable deltas", () => {
  expect(() => writePes(new EmbPattern(), { version: 2 as 1 })).toThrow(
    /version/i,
  );

  const source = new EmbPattern();
  source.stitchAbs(0, 0);
  source.stitch(2048, 0);
  expect(() => writePes(source, { encode: false })).toThrow(/2047|delta/i);
});
