import { test, expect } from "vitest";
import {
  ByteReader,
  EmbConstant as C,
  EmbPattern,
  EmbThread,
  readPesInto,
} from "../src/index.ts";
import {
  buildPecBlock,
  buildPes,
  buildPecContainer,
  encStitch,
  END_BYTES,
  bytes,
  fillers,
  pesMetadata,
  pesString,
  pesThread,
} from "./helpers.ts";

function thread(r: number, g: number, b: number): EmbThread {
  const t = new EmbThread();
  t.setColor(r, g, b);
  return t;
}

const SIMPLE_STITCHES = bytes(encStitch(10, 20), encStitch(5, -5), END_BYTES);
const SIMPLE_PEC = buildPecBlock({ stitches: SIMPLE_STITCHES, colors: [5] });

function read(bytesIn: Uint8Array): EmbPattern {
  const p = new EmbPattern();
  readPesInto(new ByteReader(bytesIn), p);
  return p;
}

function commands(p: EmbPattern): number[] {
  return p.stitches.map((s) => s[2]);
}

test("PES: #PEC0001 container reads the bare PEC block (offset 8)", () => {
  const p = read(buildPecContainer(SIMPLE_PEC));
  expect(p.stitches).toStrictEqual([
    [10, 20, C.STITCH],
    [15, 15, C.STITCH],
    [15, 15, C.END],
  ]);
  expect(p.getMetadata("Label")).toBe("Test Label");
  expect(p.threadlist.length).toBe(1);
});

test("PES: #PES0001 header is skipped entirely, PEC read at offset", () => {
  const p = read(buildPes("#PES0001", [], SIMPLE_PEC));
  expect(commands(p)).toStrictEqual([C.STITCH, C.STITCH, C.END]);
  expect(p.threadlist[0].hexColor()).toBe("#ed171f");
});

test("PES: declared PEC offset is honored (PEC not at 12)", () => {
  const p = read(buildPes("#PES0001", fillers(40, 0xaa), SIMPLE_PEC, { pecOffset: 64 }));
  expect(commands(p)).toStrictEqual([C.STITCH, C.STITCH, C.END]);
});

test("PES: unknown magic still reads the PEC block (python: pass)", () => {
  const p = read(buildPes("#PES0999", fillers(8, 0x11), SIMPLE_PEC));
  expect(commands(p)).toStrictEqual([C.STITCH, C.STITCH, C.END]);
  expect(p.getMetadata("Label")).toBe("Test Label");
});

test("PES: #PES0040 reads metadata fields", () => {
  const header = [
    ...fillers(4),
    ...pesMetadata(["My Name", "Floral", "Alice", "flowers, blue", "hi"]),
  ];
  const p = read(buildPes("#PES0040", header, SIMPLE_PEC));
  expect(p.getMetadata("name")).toBe("My Name");
  expect(p.getMetadata("category")).toBe("Floral");
  expect(p.getMetadata("author")).toBe("Alice");
  expect(p.getMetadata("keywords")).toBe("flowers, blue");
  expect(p.getMetadata("comments")).toBe("hi");
});

test("PES: empty metadata strings are not stored (python: len > 0)", () => {
  const header = [...fillers(4), ...pesMetadata(["", "", "Bob", "", ""])];
  const p = read(buildPes("#PES0040", header, SIMPLE_PEC));
  expect(p.getMetadata("name")).toBe(undefined);
  expect(p.getMetadata("author")).toBe("Bob");
  expect(p.getMetadata("category")).toBe(undefined);
});

test("PES: null (0-length) metadata string is not stored", () => {
  const header = [...fillers(4), ...pesMetadata([null, null, null, null, null])];
  const p = read(buildPes("#PES0040", header, SIMPLE_PEC));
  expect(p.getMetadata("name")).toBe(undefined);
  expect(Object.keys(p.extras).filter((k) => k !== "Label")).toStrictEqual([]);
});

function v5Header(
  threadRecords: number[][],
  overrides?: {
    fills?: number;
    motifs?: number;
    feather?: number;
    image?: string;
  }
): Uint8Array {
  const o = overrides ?? {};
  return Uint8Array.from([
    ...fillers(4),
    ...pesMetadata(["Design", null, null, null, null]),
    ...fillers(24),
    ...pesString(o.image ?? "img.pes"),
    ...fillers(24),
    o.fills ?? 0, 0,
    o.motifs ?? 0, 0,
    o.feather ?? 0, 0,
    threadRecords.length & 0xff, (threadRecords.length >> 8) & 0xff,
    ...threadRecords.flatMap((r) => r),
  ]);
}

const COLOR_CHANGE_STREAM = bytes(
  encStitch(5, 5),
  [0xfe, 0xb0, 0x00],
  encStitch(3, 3),
  END_BYTES
);

test("PES: #PES0050 reads thread list (24-byte skip, image key)", () => {
  const header = v5Header([
    pesThread({ color: 0x112233, catalog: "c1", description: "d1", brand: "b1", chart: "ch1" }),
    pesThread({ color: 0xaabbcc, description: "d2" }),
  ]);
  const pec = buildPecBlock({ stitches: COLOR_CHANGE_STREAM, colors: [5] });
  const p = read(buildPes("#PES0050", header, pec, { pecOffset: 12 + header.length }));
  expect(p.getMetadata("image")).toBe("img.pes");
  expect(p.threadlist.length).toBe(2);
  expect(p.threadlist[0].catalog_number).toBe("c1");
  expect(p.threadlist[0].description).toBe("d1");
  expect(p.threadlist[0].brand).toBe("b1");
  expect(p.threadlist[0].chart).toBe("ch1");
  expect(p.threadlist[0].color).toBe(0xff112233 >>> 0);
  expect(p.threadlist[0].hexColor()).toBe("#112233");
  expect(p.threadlist[1].hexColor()).toBe("#aabbcc");
  expect(commands(p).includes(C.COLOR_CHANGE)).toBeTruthy();
});

test("PES: #PES0055 and #PES0056 use the v5 header path", () => {
  for (const magic of ["#PES0055", "#PES0056"]) {
    const header = v5Header([pesThread({ color: 0xff0000 })]);
    const p = read(buildPes(magic, header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
    expect(p.threadlist.length, magic).toBe(1);
    expect(p.getMetadata("image"), magic).toBe("img.pes");
  }
});

test("PES: #PES0060 uses 36-byte skip and image_file key", () => {
  const header = v5Header([pesThread({ color: 0x00ff00 })]);
  const v6 = Uint8Array.from([
    ...fillers(4),
    ...pesMetadata(["Six", null, null, null, null]),
    ...fillers(36),
    ...pesString("six.png"),
    ...fillers(24),
    0, 0,
    0, 0,
    0, 0,
    1, 0,
    ...pesThread({ color: 0x00ff00 }),
  ]);
  const p = read(buildPes("#PES0060", v6, SIMPLE_PEC, { pecOffset: 12 + v6.length }));
  expect(p.getMetadata("image_file")).toBe("six.png");
  expect(p.getMetadata("image")).toBe(undefined);
  expect(p.threadlist.length).toBe(1);
  expect(p.getMetadata("name")).toBe("Six");
});

test("PES: header threads win over PEC color table (1:1 mode)", () => {
  const header = v5Header([pesThread({ color: 0x556677 })]);
  const p = read(buildPes("#PES0050", header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
  expect(p.threadlist.length).toBe(1);
  expect(p.threadlist[0].hexColor()).toBe("#556677");
});

test("PES: programmable fills > 0 aborts header (no threads read)", () => {
  const header = v5Header([pesThread({ color: 0x556677 })], { fills: 1 });
  const p = read(buildPes("#PES0050", header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
  expect(p.threadlist.length).toBe(1);
  expect(p.threadlist[0].hexColor()).toBe("#ed171f");
});

test("PES: motifs > 0 aborts header after fills check", () => {
  const header = v5Header([pesThread({ color: 0x556677 })], { motifs: 2 });
  const p = read(buildPes("#PES0050", header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
  expect(p.threadlist[0].hexColor()).toBe("#ed171f");
});

test("PES: feather patterns > 0 aborts header too", () => {
  const header = v5Header([pesThread({ color: 0x556677 })], { feather: 3 });
  const p = read(buildPes("#PES0050", header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
  expect(p.threadlist[0].hexColor()).toBe("#ed171f");
});

test("PES: duplicate-color color changes become STOP after read", () => {
  const stream = bytes(
    encStitch(5, 5),
    [0xfe, 0xb0, 0x00],
    encStitch(3, 3),
    END_BYTES
  );
  const pec = buildPecBlock({ stitches: stream, colors: [5, 5] });
  const p = read(buildPes("#PES0001", [], pec));
  const cmds = commands(p);
  expect(cmds.includes(C.STOP), "expected a STOP").toBeTruthy();
  expect(!cmds.includes(C.COLOR_CHANGE), "COLOR_CHANGE should be a STOP").toBeTruthy();
  expect(p.threadlist.length).toBe(1);
});

test("PES: distinct threads keep COLOR_CHANGE after read", () => {
  const stream = bytes(
    encStitch(5, 5),
    [0xfe, 0xb0, 0x00],
    encStitch(3, 3),
    END_BYTES
  );
  const pec = buildPecBlock({ stitches: stream, colors: [5, 29] });
  const p = read(buildPes("#PES0001", [], pec));
  const cmds = commands(p);
  expect(cmds.includes(C.COLOR_CHANGE)).toBeTruthy();
  expect(!cmds.includes(C.STOP)).toBeTruthy();
  expect(p.threadlist.length).toBe(2);
});

test("PES: truncated file (no PEC offset) throws a descriptive error", () => {
  const p = new EmbPattern();
  expect(() =>
    readPesInto(new ByteReader(Uint8Array.from([0x23])), p)
  ).toThrow(/PEC block offset/);
});

test("PES: #PES0001 with PEC offset beyond EOF throws (not hangs)", () => {
  const p = new EmbPattern();
  expect(() => readPesInto(new ByteReader(SIMPLE_PEC.subarray(0, 40)), p)).toThrow();
});
