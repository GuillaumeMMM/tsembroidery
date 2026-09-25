import { test, expect } from "vitest";
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
} from "../src/index.ts";
import { ByteWriter } from "../src/binaryWriter.ts";

function reader(...bytes: number[]): ByteReader {
  return new ByteReader(Uint8Array.from(bytes));
}

test("signed8 boundaries", () => {
  expect(signed8(0)).toBe(0);
  expect(signed8(63)).toBe(63);
  expect(signed8(64)).toBe(64);
  expect(signed8(127)).toBe(127);
  expect(signed8(128)).toBe(-128);
  expect(signed8(255)).toBe(-1);
});

test("signed16 boundaries", () => {
  expect(signed16(0x7fff)).toBe(32767);
  expect(signed16(0x8000)).toBe(-32768);
  expect(signed16(0xffff)).toBe(-1);
  expect(signed16(0x10000)).toBe(0);
});

test("signed24 boundaries", () => {
  expect(signed24(0x7fffff)).toBe(8388607);
  expect(signed24(0x800000)).toBe(-8388608);
  expect(signed24(0xffffff)).toBe(-1);
});

test("readSigned maps each byte through signed8", () => {
  expect(readSigned(reader(0x00, 0x7f, 0x80, 0xff), 4)).toStrictEqual([0, 127, -128, -1]);
  expect(readSigned(reader(0x01), 3)).toStrictEqual([1]);
});

test("readInt8 / readSint8", () => {
  expect(readInt8(reader(0xff))).toBe(255);
  expect(readSint8(reader(0xff))).toBe(-1);
  expect(readInt8(reader())).toBe(null);
});

test("readInt16le / readInt16be", () => {
  expect(readInt16le(reader(0x34, 0x12))).toBe(0x1234);
  expect(readInt16be(reader(0x12, 0x34))).toBe(0x1234);
  expect(readInt16le(reader(0x34))).toBe(null);
});

test("readInt24le / readInt24be", () => {
  expect(readInt24le(reader(0x03, 0x02, 0x01))).toBe(0x010203);
  expect(readInt24be(reader(0x01, 0x02, 0x03))).toBe(0x010203);
  expect(readInt24le(reader(0x03, 0x02))).toBe(null);
});

test("readInt32le / readInt32be", () => {
  expect(readInt32le(reader(0x78, 0x56, 0x34, 0x12))).toBe(0x12345678);
  expect(readInt32be(reader(0x12, 0x34, 0x56, 0x78))).toBe(0x12345678);
  expect(readInt32le(reader(0x78, 0x56, 0x34, 0x12, 0xff))).toBe(0x12345678);
  expect(readInt32le(reader(0x78, 0x56))).toBe(null);
});

test("seek SET / CUR / END", () => {
  const r = reader(10, 20, 30, 40);
  r.seek(2);
  expect(r.tell()).toBe(2);
  r.seek(1, 1);
  expect(r.tell()).toBe(3);
  r.seek(-1, 2);
  expect(r.tell()).toBe(3);
  expect(readInt8(r)).toBe(40);
});

test("read is short at EOF, never throws", () => {
  const r = reader(1, 2, 3);
  expect(Array.from(r.read(10))).toStrictEqual([1, 2, 3]);
  expect(r.tell()).toBe(3);
  expect(Array.from(r.read(1))).toStrictEqual([]);
});

test("readString8 decodes utf-8", () => {
  const r = new ByteReader(new TextEncoder().encode("LA:Label of design"));
  expect(readString8(r, 3)).toBe("LA:");
  expect(readString8(r, 16)).toBe("Label of design");
});

test("readString8 returns null on invalid utf-8", () => {
  const r = reader(0xff, 0xfe, 0x41);
  expect(readString8(r, 3)).toBe(null);
});

test("readString8 returns empty string on EOF (python decodes b'')", () => {
  const r = reader();
  expect(readString8(r, 8)).toBe("");
});

test("readString16 honors BOM", () => {
  const le = reader(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00);
  expect(readString16(le, 6)).toBe("Hi");
  const be = reader(0xfe, 0xff, 0x00, 0x48, 0x00, 0x69);
  expect(readString16(be, 6)).toBe("Hi");
  const noBom = reader(0x48, 0x00, 0x69, 0x00);
  expect(readString16(noBom, 4)).toBe("Hi");
});

test("ByteWriter: seeking back to patch keeps the full output", () => {
  const out = new ByteWriter();
  out.writeUint32le(0);
  out.writeBytes([1, 2, 3]);
  out.seek(0);
  out.writeUint8(9);
  expect(out.length).toBe(7);
  expect(out.toUint8Array()).toStrictEqual(Uint8Array.from([9, 0, 0, 0, 1, 2, 3]));
});
