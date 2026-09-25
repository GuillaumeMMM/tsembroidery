/** @vitest-environment happy-dom */
import { test, expect } from "vitest";
import {
  ByteReader,
  EmbConstant as C,
  EmbPattern,
  readInt32le,
  readPes,
  readSvg,
  svgToPes,
} from "./internal.ts";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(start, start + length)
  );
}

function pecOffset(bytes: Uint8Array): number {
  return readInt32le(new ByteReader(bytes.subarray(8))) as number;
}

test("readSvg: accepts strings and bytes for empty documents", () => {
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

test("svgToPes: text and bytes produce a valid empty v6 design for an empty SVG", () => {
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

test("svgToPes: serializes parsed SVG stitches", () => {
  const bytes = svgToPes(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <path d="M0 0L10 0" stroke="#ff0000" fill="none"/>
     </svg>`,
    { stitchLength: 1000 }
  );

  expect(ascii(bytes, 0, 8)).toBe("#PES0060");
  const result = readPes(bytes);
  expect(result.threadlist[0].hexColor()).toBe("#ff0000");
  expect(result.stitches.some(([, , command]) => command === C.STITCH)).toBe(true);
  expect(result.stitches.some(([, , command]) => command === C.END)).toBe(true);
});

test("svgToPes: forwards the requested PES version", () => {
  const bytes = svgToPes("<svg></svg>", { version: 1 });
  expect(ascii(bytes, 0, 8)).toBe("#PES0001");
  expect(readPes(bytes).stitches).toStrictEqual([[0, 0, C.END]]);
});
