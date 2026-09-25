import { test, expect } from "vitest";
import {
  ByteReader,
  EmbConstant as C,
  EmbPattern,
  readInt32le,
  readPes,
  readSvg,
  svgToPes,
} from "../src/index.ts";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(start, start + length)
  );
}

function pecOffset(bytes: Uint8Array): number {
  return readInt32le(new ByteReader(bytes.subarray(8))) as number;
}

test("readSvg: placeholder accepts strings and bytes as empty patterns", () => {
  const a = readSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const b = readSvg(
    new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    )
  );

  expect(a).toBeInstanceOf(EmbPattern);
  expect(b).toBeInstanceOf(EmbPattern);
  expect(a).not.toBe(b);
  expect(a.stitches).toStrictEqual([]);
  expect(b.stitches).toStrictEqual([]);
});

test("svgToPes: text and bytes currently produce a valid empty v6 design", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  for (const source of [svg, new TextEncoder().encode(svg)]) {
    const bytes = svgToPes(source);
    expect(ascii(bytes, 0, 8)).toBe("#PES0060");
    expect(ascii(bytes, pecOffset(bytes), 3)).toBe("LA:");

    const result = readPes(bytes);
    expect(result.stitches).toStrictEqual([[0, 0, C.END]]);
    expect(result.threadlist[0].hexColor()).toBe("#000000");
  }
});

test("svgToPes: forwards the requested PES version", () => {
  const bytes = svgToPes("<svg></svg>", { version: 1 });
  expect(ascii(bytes, 0, 8)).toBe("#PES0001");
  expect(readPes(bytes).stitches).toStrictEqual([[0, 0, C.END]]);
});
