import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { EmbConstant as C, EmbPattern, readDst, readPes, writeDst } from "./internal.ts";

// Expected files were written by pyembroidery 1.5.1 from flowers.pes.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

test("writeDst: output matches pyembroidery byte for byte", () => {
  const flowers = readPes(fixture("flowers.pes"));
  expect(writeDst(flowers)).toStrictEqual(fixture("flowers.pyembroidery.dst"));
  expect(writeDst(flowers, { extendedHeader: true })).toStrictEqual(fixture("flowers.pyembroidery-extended.dst"));
});

test("readDst: reads a file as pyembroidery does", () => {
  const pattern = readDst(fixture("flowers.pyembroidery-extended.dst"));
  expect(pattern.stitches).toHaveLength(9957);
  expect(pattern.stitches.slice(0, 2)).toStrictEqual([
    [60, 103, C.JUMP],
    [119, 205, C.JUMP],
  ]);
  expect(pattern.stitches[pattern.stitches.length - 1]).toStrictEqual([431, 154, C.END]);
  const count = (command: number) => pattern.stitches.filter(([, , c]) => c === command).length;
  expect([count(C.STITCH), count(C.JUMP), count(C.TRIM), count(C.COLOR_CHANGE)]).toStrictEqual([9862, 56, 26, 12]);
  expect(pattern.extents()).toStrictEqual({ minX: 0, minY: 0, maxX: 770, maxY: 908 });
  // The extended header lists the threads.
  expect(pattern.threadlist).toHaveLength(13);
  expect(pattern.threadlist.slice(0, 3).map((thread) => thread.hexColor())).toStrictEqual(["#2584bb", "#293133", "#a8ddc4"]);
  expect(pattern.getMetadata("name")).toBe("Untitled");
});

test("writeDst/readDst: round-trips stitches, trims, color changes and the name", () => {
  const pattern = new EmbPattern();
  pattern.metadata("name", "Round trip");
  pattern.stitchAbs(0, 0);
  pattern.stitchAbs(50, 30);
  pattern.moveAbs(400, -250); // longer than one record: split into jumps
  pattern.stitchAbs(420, -240);
  pattern.trim();
  pattern.stitchAbs(100, 100);
  pattern.colorChange();
  pattern.stitchAbs(110, 90);
  pattern.end();

  const read = readDst(writeDst(pattern));
  expect(read.getMetadata("name")).toBe("Round trip");
  const stitches = read.stitches.filter(([, , command]) => command === C.STITCH).map(([x, y]) => [x, y]);
  expect(stitches).toStrictEqual([[0, 0], [50, 30], [420, -240], [100, 100], [110, 90]]);
  // The explicit trim, plus the long jump: readers treat 3+ jumps in a row as a trim.
  expect(read.countStitchCommands(C.TRIM)).toBe(2);
  expect(read.countColorChanges()).toBe(1);
  // Moves are at most 12.1 mm per record.
  for (let i = 1; i < read.stitches.length; i++) {
    const [[x0, y0], [x1, y1]] = [read.stitches[i - 1], read.stitches[i]];
    expect(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))).toBeLessThanOrEqual(121);
  }
});

test("writeDst: keeps the header at 512 bytes with long names and many threads", () => {
  const pattern = new EmbPattern();
  pattern.metadata("name", "A name much longer than sixteen characters");
  for (let i = 0; i < 40; i++) pattern.addThread({ hex: "#123456", description: "Long thread description", catalog: "1234" });
  pattern.stitchAbs(0, 0);
  pattern.stitchAbs(10, 10);
  const bytes = writeDst(pattern, { extendedHeader: true });
  expect(bytes[0x1ff]).toBe(0x20);
  expect(new TextDecoder().decode(bytes.subarray(3, 19))).toBe("A name much long");
  expect(readDst(bytes).stitches.filter(([, , c]) => c === C.STITCH).map(([x, y]) => [x, y])).toStrictEqual([[0, 0], [10, 10]]);
});

test("writeDst: rejects moves too long for a record when encoding is off", () => {
  const pattern = new EmbPattern();
  pattern.stitchAbs(0, 0);
  pattern.stitchAbs(500, 0);
  expect(() => writeDst(pattern, { encode: false })).toThrow(/DST limit/);
});

test("interpolateTrims: turns jump bursts into trims and drops jumps that go nowhere", () => {
  const pattern = new EmbPattern();
  pattern.stitchAbs(0, 0);
  pattern.stitchAbs(10, 0);
  pattern.move(2, 2);
  pattern.move(-4, -4);
  pattern.move(2, 2);
  pattern.stitch(5, 0);
  pattern.interpolateTrims(3);
  expect(pattern.stitches.map(([, , command]) => command)).toStrictEqual([C.STITCH, C.STITCH, C.TRIM, C.STITCH]);
});
