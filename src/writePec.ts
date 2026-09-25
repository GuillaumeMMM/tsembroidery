/**
 * Internal Brother PEC serializer used by the PES writer.
 *
 * The stitch stream follows pyembroidery's PecWriter, while the header
 * layout is kept compatible with this package's existing PecReader.
 */
import { EmbConstant } from "./constants.js";
import { findNearestColorIndex } from "./thread.js";
import type { EmbThread } from "./thread.js";
import type { EmbPattern, Extents, Stitch } from "./pattern.js";
import { getThreadSet } from "./pecThreads.js";
import { pyRound } from "./pyMath.js";
import { ByteWriter } from "./binaryWriter.js";

const {
  COMMAND_MASK,
  STITCH,
  JUMP,
  TRIM,
  STOP,
  END,
  COLOR_CHANGE,
} = EmbConstant;

const JUMP_CODE = 0x10;
const TRIM_CODE = 0x20;
const PEC_ICON_WIDTH = 48;
const PEC_ICON_HEIGHT = 38;
const PEC_STRIDE = 6;

const encoder = new TextEncoder();

function fromHex(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

/** pyembroidery's 48x6 grayscale preview frame. */
const BLANK_GRAPHIC = Uint8Array.from(
  fromHex(
    "000000000000f0ffffffff0f080000000010040000000020020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040020000000040040000000020080000000010f0ffffffff0f000000000000"
  )
);

export interface PecColorInfo {
  /** Includes the leading color-count byte, as PES v6 addenda expect. */
  colorIndexList: number[];
  rgbList: number[];
}

function truncateUtf8(value: string, maxBytes: number): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const next = encoder.encode(character);
    if (bytes.length + next.length > maxBytes) break;
    bytes.push(...next);
  }
  return Uint8Array.from(bytes);
}

function labelBytes(pattern: EmbPattern): Uint8Array {
  const metadata = pattern.getMetadata("name");
  const name = typeof metadata === "string" ? metadata : "Untitled";
  const label = truncateUtf8(name, 16);
  const padded = new Uint8Array(16).fill(0x20);
  padded.set(label);
  return padded;
}

function sameThreadValue(a: EmbThread, b: EmbThread): boolean {
  return (
    (a.color & 0xffffff) === (b.color & 0xffffff) &&
    a.description === b.description &&
    a.catalog_number === b.catalog_number &&
    a.details === b.details &&
    a.brand === b.brand &&
    a.chart === b.chart &&
    a.weight === b.weight
  );
}

function buildUniquePalette(threadlist: EmbThread[]): number[] {
  const chart: (EmbThread | null)[] = getThreadSet();
  const uniqueThreads: EmbThread[] = [];
  for (const thread of threadlist) {
    if (!uniqueThreads.some((unique) => sameThreadValue(unique, thread))) {
      uniqueThreads.push(thread);
    }
  }

  const assignments: number[] = [];
  for (const thread of uniqueThreads) {
    const index = findNearestColorIndex(thread, chart);
    if (index < 0) {
      throw new RangeError(
        `writePes: a PEC palette supports at most ${chart.length} unique threads`
      );
    }
    assignments.push(index);
    chart[index] = null;
  }

  return threadlist.map(
    (thread) =>
      assignments[
        uniqueThreads.findIndex((unique) => sameThreadValue(unique, thread))
      ] ?? -1
  );
}

/** Append a PEC header, stitch block, and preview frames to `out`. */
export function writePec(
  pattern: EmbPattern,
  out: ByteWriter,
  threadlist: EmbThread[] = pattern.threadlist
): PecColorInfo {
  const extents = finiteExtents(pattern);
  const palette = buildUniquePalette(pattern.threadlist);
  if (palette.some((index) => index < 0)) {
    throw new RangeError("writePes: could not map every thread to the PEC palette");
  }
  if (palette.length < 1 || palette.length > 256) {
    throw new RangeError("writePes: PES supports between 1 and 256 color blocks");
  }

  const colorInfo: PecColorInfo = {
    colorIndexList: [palette.length - 1, ...palette],
    rgbList: threadlist.map((thread) => thread.color),
  };

  const pecStart = out.tell();
  out.writeBytes(new TextEncoder().encode("LA:"));
  out.writeBytes(labelBytes(pattern));
  // CR, 12 spaces, FF FF. The reader resumes at the stride byte.
  out.writeBytes([
    0x0d,
    ...new Array<number>(12).fill(0x20),
    0xff,
    0xff,
  ]);
  out.writeUint8(PEC_ICON_WIDTH / 8);
  out.writeUint8(PEC_ICON_HEIGHT);
  out.writeBytes(new Array<number>(12).fill(0));
  out.writeUint8(palette.length - 1);
  out.writeBytes(palette);
  if (out.tell() > pecStart + 514) {
    throw new RangeError("writePes: too many PEC colors for the fixed header");
  }
  out.seek(pecStart + 514);

  writePecBlock(pattern, out, extents);
  writePecGraphics(pattern, out, extents);
  return colorInfo;
}

function finiteExtents(pattern: EmbPattern): Extents {
  if (pattern.stitches.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return pattern.extents();
}

function writePecBlock(
  pattern: EmbPattern,
  out: ByteWriter,
  extents: Extents
): void {
  const blockStart = out.tell();
  const lengthPosition = blockStart;
  out.writeInt24le(0);

  const width = extents.maxX - extents.minX;
  const height = extents.maxY - extents.minY;
  out.writeBytes([0x31, 0xff, 0xf0]);
  out.writeInt16le(pyRound(width));
  out.writeInt16le(pyRound(height));
  out.writeInt16le(0x1e0);
  out.writeInt16le(0x1b0);
  // Two reserved shorts are part of the 15-byte marker expected by the reader.
  out.writeInt16le(0);
  out.writeInt16le(0);
  encodePecStitches(pattern, out);

  const blockEnd = out.tell();
  out.seek(lengthPosition);
  out.writeInt24le(blockEnd - blockStart);
  out.seek(blockEnd);
}

function checkedDelta(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`writePes: stitch delta must be finite, got ${value}`);
  }
  const rounded = pyRound(value);
  if (rounded < -2048 || rounded > 2047) {
    throw new RangeError(
      `writePes: stitch delta ${rounded} exceeds the PEC limit of -2048..2047`
    );
  }
  return rounded;
}

function writeValue(
  out: ByteWriter,
  value: number,
  forceLong = false,
  flag = 0
): void {
  if (!forceLong && value > -64 && value < 63) {
    out.writeUint8(value & 0x7f);
    return;
  }
  const encoded =
    (value & 0x0fff) | 0x8000 | (flag << 8);
  out.writeUint8((encoded >> 8) & 0xff);
  out.writeUint8(encoded & 0xff);
}

function writeStitch(out: ByteWriter, dx: number, dy: number): void {
  writeValue(out, dx);
  writeValue(out, dy);
}

function writeJump(out: ByteWriter, dx: number, dy: number): void {
  writeValue(out, dx, true, JUMP_CODE);
  writeValue(out, dy, true, JUMP_CODE);
}

function writeTrimJump(out: ByteWriter, dx: number, dy: number): void {
  writeValue(out, dx, true, TRIM_CODE);
  writeValue(out, dy, true, TRIM_CODE);
}

function encodePecStitches(pattern: EmbPattern, out: ByteWriter): void {
  let colorTwo = true;
  let jumping = true;
  let initial = true;
  let ended = false;
  let x = 0;
  let y = 0;

  for (const stitch of pattern.stitches) {
    const command = stitch[2] & COMMAND_MASK;
    if (command === END) {
      out.writeUint8(0xff);
      ended = true;
      break;
    }

    const dx = checkedDelta(stitch[0] - x);
    const dy = checkedDelta(stitch[1] - y);
    x += dx;
    y += dy;

    if (command === STITCH) {
      if (jumping) {
        if (dx !== 0 && dy !== 0) writeStitch(out, 0, 0);
        jumping = false;
      }
      writeStitch(out, dx, dy);
    } else if (command === JUMP) {
      jumping = true;
      if (initial) writeJump(out, dx, dy);
      else writeTrimJump(out, dx, dy);
    } else if (command === COLOR_CHANGE) {
      if (jumping) {
        writeStitch(out, 0, 0);
        jumping = false;
      }
      out.writeBytes([0xfe, 0xb0, colorTwo ? 0x02 : 0x01]);
      colorTwo = !colorTwo;
    } else if (command === STOP || command === TRIM) {
      // STOPs are converted to duplicate-thread color changes before writing.
      // Explicit TRIMs are represented by the trim flag on a following jump.
    }
    initial = false;
  }

  if (!ended) out.writeUint8(0xff);
}

function writePecGraphics(
  pattern: EmbPattern,
  out: ByteWriter,
  extents: Extents
): void {
  const allPoints: Stitch[] = [];
  for (const [block] of pattern.getAsStitchblock()) allPoints.push(...block);
  out.writeBytes(drawScaled(extents, allPoints, 4));

  for (const [block] of pattern.getAsColorblocks()) {
    out.writeBytes(
      drawScaled(
        extents,
        block.filter((stitch) => (stitch[2] & COMMAND_MASK) === STITCH),
        5
      )
    );
  }
}

function drawScaled(
  extents: Extents,
  points: Stitch[],
  buffer: number
): Uint8Array {
  const graphic = BLANK_GRAPHIC.slice();
  const diagramWidth = extents.maxX - extents.minX || 1;
  const diagramHeight = extents.maxY - extents.minY || 1;
  const graphicWidth = PEC_STRIDE * 8;
  const graphicHeight = graphic.length / PEC_STRIDE;
  const scale = Math.min(
    (graphicWidth - buffer) / diagramWidth,
    (graphicHeight - buffer) / diagramHeight
  );
  const centerX = (extents.maxX + extents.minX) / 2;
  const centerY = (extents.maxY + extents.minY) / 2;
  const translateX = graphicWidth / 2 - centerX * scale;
  const translateY = graphicHeight / 2 - centerY * scale;

  for (const point of points) {
    const x = Math.floor(point[0] * scale + translateX);
    const y = Math.floor(point[1] * scale + translateY);
    if (x < 0 || x >= graphicWidth || y < 0 || y >= graphicHeight) continue;
    graphic[y * PEC_STRIDE + Math.floor(x / 8)] |=
      1 << Math.floor(x % 8);
  }
  return graphic;
}
