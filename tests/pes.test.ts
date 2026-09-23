import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ByteReader,
  EmbConstant as C,
  EmbPattern,
  EmbThread,
  readPesInto,
} from "../dist/index.js";
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

/* --------------------------- #PEC0001 path ---------------------------- */

test("PES: #PEC0001 container reads the bare PEC block (offset 8)", () => {
  const p = read(buildPecContainer(SIMPLE_PEC));
  assert.deepEqual(p.stitches, [
    [10, 20, C.STITCH],
    [15, 15, C.STITCH],
    [15, 15, C.END],
  ]);
  assert.equal(p.getMetadata("Label"), "Test Label");
  assert.equal(p.threadlist.length, 1);
});

/* ----------------------------- #PES0001 ------------------------------- */

test("PES: #PES0001 header is skipped entirely, PEC read at offset", () => {
  const p = read(buildPes("#PES0001", [], SIMPLE_PEC));
  assert.deepEqual(commands(p), [C.STITCH, C.STITCH, C.END]);
  // v1 header has no threads -> PEC color table used (index 5 = Red)
  assert.equal(p.threadlist[0].hexColor(), "#ed171f");
});

test("PES: declared PEC offset is honored (PEC not at 12)", () => {
  const p = read(buildPes("#PES0001", fillers(40, 0xaa), SIMPLE_PEC, { pecOffset: 64 }));
  assert.deepEqual(commands(p), [C.STITCH, C.STITCH, C.END]);
});

test("PES: unknown magic still reads the PEC block (python: pass)", () => {
  const p = read(buildPes("#PES0999", fillers(8, 0x11), SIMPLE_PEC));
  assert.deepEqual(commands(p), [C.STITCH, C.STITCH, C.END]);
  assert.equal(p.getMetadata("Label"), "Test Label");
});

/* ----------------------------- metadata ------------------------------- */

test("PES: #PES0040 reads metadata fields", () => {
  const header = [
    ...fillers(4),
    ...pesMetadata(["My Name", "Floral", "Alice", "flowers, blue", "hi"]),
  ];
  const p = read(buildPes("#PES0040", header, SIMPLE_PEC));
  assert.equal(p.getMetadata("name"), "My Name");
  assert.equal(p.getMetadata("category"), "Floral");
  assert.equal(p.getMetadata("author"), "Alice");
  assert.equal(p.getMetadata("keywords"), "flowers, blue");
  assert.equal(p.getMetadata("comments"), "hi");
});

test("PES: empty metadata strings are not stored (python: len > 0)", () => {
  const header = [...fillers(4), ...pesMetadata(["", "", "Bob", "", ""])];
  const p = read(buildPes("#PES0040", header, SIMPLE_PEC));
  assert.equal(p.getMetadata("name"), undefined);
  assert.equal(p.getMetadata("author"), "Bob");
  assert.equal(p.getMetadata("category"), undefined);
});

test("PES: null (0-length) metadata string is not stored", () => {
  const header = [...fillers(4), ...pesMetadata([null, null, null, null, null])];
  const p = read(buildPes("#PES0040", header, SIMPLE_PEC));
  assert.equal(p.getMetadata("name"), undefined);
  assert.deepEqual(Object.keys(p.extras).filter((k) => k !== "Label"), []);
});

/* ------------------------------ threads ------------------------------- */

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

/**
 * PEC stream with a COLOR_CHANGE: after read, convertDuplicateColorChange
 * keeps thread[0] plus one thread per color change — without one, a multi
 * thread list would legitimately collapse to a single thread (python does
 * the same).
 */
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
  assert.equal(p.getMetadata("image"), "img.pes");
  assert.equal(p.threadlist.length, 2);
  assert.equal(p.threadlist[0].catalog_number, "c1");
  assert.equal(p.threadlist[0].description, "d1");
  assert.equal(p.threadlist[0].brand, "b1");
  assert.equal(p.threadlist[0].chart, "ch1");
  // int24be color | 0xFF000000
  assert.equal(p.threadlist[0].color, 0xff112233 >>> 0);
  assert.equal(p.threadlist[0].hexColor(), "#112233");
  assert.equal(p.threadlist[1].hexColor(), "#aabbcc");
  assert.ok(commands(p).includes(C.COLOR_CHANGE));
});

test("PES: #PES0055 and #PES0056 use the v5 header path", () => {
  for (const magic of ["#PES0055", "#PES0056"]) {
    const header = v5Header([pesThread({ color: 0xff0000 })]);
    const p = read(buildPes(magic, header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
    assert.equal(p.threadlist.length, 1, magic);
    assert.equal(p.getMetadata("image"), "img.pes", magic);
  }
});

test("PES: #PES0060 uses 36-byte skip and image_file key", () => {
  const header = v5Header([pesThread({ color: 0x00ff00 })]);
  // v6: 4 pad + metadata + 36 (not 24) + image + 24 + counts + threads
  const v6 = Uint8Array.from([
    ...fillers(4),
    ...pesMetadata(["Six", null, null, null, null]),
    ...fillers(36),
    ...pesString("six.png"),
    ...fillers(24),
    0, 0, // fills
    0, 0, // motifs
    0, 0, // feather
    1, 0, // count_threads = 1
    ...pesThread({ color: 0x00ff00 }),
  ]);
  const p = read(buildPes("#PES0060", v6, SIMPLE_PEC, { pecOffset: 12 + v6.length }));
  assert.equal(p.getMetadata("image_file"), "six.png");
  assert.equal(p.getMetadata("image"), undefined); // v5-only key
  assert.equal(p.threadlist.length, 1);
  assert.equal(p.getMetadata("name"), "Six");
});

test("PES: header threads win over PEC color table (1:1 mode)", () => {
  // 1 header thread vs 1 PEC color byte -> 1:1 mode uses the header thread
  const header = v5Header([pesThread({ color: 0x556677 })]);
  const p = read(buildPes("#PES0050", header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
  assert.equal(p.threadlist.length, 1);
  assert.equal(p.threadlist[0].hexColor(), "#556677");
});

test("PES: programmable fills > 0 aborts header (no threads read)", () => {
  const header = v5Header([pesThread({ color: 0x556677 })], { fills: 1 });
  const p = read(buildPes("#PES0050", header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
  assert.equal(p.threadlist.length, 1); // from PEC table, not header
  assert.equal(p.threadlist[0].hexColor(), "#ed171f"); // index 5 = Red
});

test("PES: motifs > 0 aborts header after fills check", () => {
  const header = v5Header([pesThread({ color: 0x556677 })], { motifs: 2 });
  const p = read(buildPes("#PES0050", header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
  assert.equal(p.threadlist[0].hexColor(), "#ed171f");
});

test("PES: feather patterns > 0 aborts header too", () => {
  const header = v5Header([pesThread({ color: 0x556677 })], { feather: 3 });
  const p = read(buildPes("#PES0050", header, SIMPLE_PEC, { pecOffset: 12 + header.length }));
  assert.equal(p.threadlist[0].hexColor(), "#ed171f");
});

/* ------------------- convertDuplicateColorChangeToStop ---------------- */

test("PES: duplicate-color color changes become STOP after read", () => {
  // PEC color bytes [5, 5] push the SAME chart instance twice (python
  // process_pec_colors reuses threadSet[5]), so the second color block
  // resolves to the identical thread object -> converted to STOP.
  const stream = bytes(
    encStitch(5, 5),
    [0xfe, 0xb0, 0x00],
    encStitch(3, 3),
    END_BYTES
  );
  const pec = buildPecBlock({ stitches: stream, colors: [5, 5] });
  const p = read(buildPes("#PES0001", [], pec));
  const cmds = commands(p);
  assert.ok(cmds.includes(C.STOP), "expected a STOP");
  assert.ok(!cmds.includes(C.COLOR_CHANGE), "COLOR_CHANGE should be a STOP");
  assert.equal(p.threadlist.length, 1); // STOP consumed the duplicate thread
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
  assert.ok(cmds.includes(C.COLOR_CHANGE));
  assert.ok(!cmds.includes(C.STOP));
  assert.equal(p.threadlist.length, 2);
});

/* ------------------------------ robustness ---------------------------- */

test("PES: truncated file (no PEC offset) throws a descriptive error", () => {
  const p = new EmbPattern();
  assert.throws(
    () => readPesInto(new ByteReader(Uint8Array.from([0x23])), p),
    /PEC block offset/
  );
});

test("PES: #PES0001 with PEC offset beyond EOF throws (not hangs)", () => {
  const p = new EmbPattern();
  // offset points past the end: readPec hits EOF in the header
  assert.throws(() => readPesInto(new ByteReader(SIMPLE_PEC.subarray(0, 40)), p));
});
