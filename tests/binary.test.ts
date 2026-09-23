import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ByteReader,
  signed8,
  signed16,
  signed24,
  readSigned,
  readSint8,
  readInt8,
  readInt16le,
  readInt16be,
  readInt24le,
  readInt24be,
  readInt32le,
  readInt32be,
  readString8,
  readString16,
} from "../dist/index.js";

function reader(...bytes: number[]): ByteReader {
  return new ByteReader(Uint8Array.from(bytes));
}

/* ------------------------- signed conversions ------------------------- */

test("signed8 boundaries", () => {
  assert.equal(signed8(0), 0);
  assert.equal(signed8(63), 63);
  assert.equal(signed8(64), 64);
  assert.equal(signed8(127), 127);
  assert.equal(signed8(128), -128);
  assert.equal(signed8(255), -1);
});

test("signed16 boundaries", () => {
  assert.equal(signed16(0x7fff), 32767);
  assert.equal(signed16(0x8000), -32768);
  assert.equal(signed16(0xffff), -1);
  assert.equal(signed16(0x10000), 0); // masked to 16 bits
});

test("signed24 boundaries", () => {
  assert.equal(signed24(0x7fffff), 8388607);
  assert.equal(signed24(0x800000), -8388608);
  assert.equal(signed24(0xffffff), -1);
});

test("readSigned maps each byte through signed8", () => {
  assert.deepEqual(readSigned(reader(0x00, 0x7f, 0x80, 0xff), 4), [0, 127, -128, -1]);
  // short read -> short result, no throw
  assert.deepEqual(readSigned(reader(0x01), 3), [1]);
});

/* --------------------------- integer readers -------------------------- */

test("readInt8 / readSint8", () => {
  assert.equal(readInt8(reader(0xff)), 255);
  assert.equal(readSint8(reader(0xff)), -1);
  assert.equal(readInt8(reader()), null); // EOF -> null
});

test("readInt16le / readInt16be", () => {
  assert.equal(readInt16le(reader(0x34, 0x12)), 0x1234);
  assert.equal(readInt16be(reader(0x12, 0x34)), 0x1234);
  assert.equal(readInt16le(reader(0x34)), null);
});

test("readInt24le / readInt24be", () => {
  assert.equal(readInt24le(reader(0x03, 0x02, 0x01)), 0x010203);
  assert.equal(readInt24be(reader(0x01, 0x02, 0x03)), 0x010203);
  assert.equal(readInt24le(reader(0x03, 0x02)), null);
});

test("readInt32le / readInt32be", () => {
  assert.equal(readInt32le(reader(0x78, 0x56, 0x34, 0x12)), 0x12345678);
  assert.equal(readInt32be(reader(0x12, 0x34, 0x56, 0x78)), 0x12345678);
  assert.equal(readInt32le(reader(0x78, 0x56, 0x34, 0x12, 0xff)), 0x12345678); // ignores extra
  assert.equal(readInt32le(reader(0x78, 0x56)), null);
});

/* --------------------------- ByteReader protocol ---------------------- */

test("seek SET / CUR / END", () => {
  const r = reader(10, 20, 30, 40);
  r.seek(2);
  assert.equal(r.tell(), 2);
  r.seek(1, 1);
  assert.equal(r.tell(), 3);
  r.seek(-1, 2); // END: size + offset
  assert.equal(r.tell(), 3);
  assert.equal(readInt8(r), 40);
});

test("read is short at EOF, never throws", () => {
  const r = reader(1, 2, 3);
  assert.deepEqual(Array.from(r.read(10)), [1, 2, 3]);
  assert.equal(r.tell(), 3);
  assert.deepEqual(Array.from(r.read(1)), []); // past the end -> empty
});

/* ------------------------------- strings ------------------------------ */

test("readString8 decodes utf-8", () => {
  const r = new ByteReader(new TextEncoder().encode("LA:Label of design"));
  assert.equal(readString8(r, 3), "LA:");
  assert.equal(readString8(r, 16), "Label of design");
});

test("readString8 returns null on invalid utf-8", () => {
  const r = reader(0xff, 0xfe, 0x41); // continuation byte without lead
  assert.equal(readString8(r, 3), null);
});

test("readString8 returns empty string on EOF (python decodes b'')", () => {
  const r = reader();
  assert.equal(readString8(r, 8), "");
});

test("readString16 honors BOM", () => {
  // utf-16le with BOM: "Hi"
  const le = reader(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00);
  assert.equal(readString16(le, 6), "Hi");
  // utf-16be with BOM
  const be = reader(0xfe, 0xff, 0x00, 0x48, 0x00, 0x69);
  assert.equal(readString16(be, 6), "Hi");
  // no BOM -> native little-endian
  const noBom = reader(0x48, 0x00, 0x69, 0x00);
  assert.equal(readString16(noBom, 4), "Hi");
});
