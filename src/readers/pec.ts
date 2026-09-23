/**
 * Port of pyembroidery `PecReader.py` (stitch/color decoding).
 *
 * Deliberate divergences (documented in README):
 *  - `read_pec_graphics` and its thumbnail metadata are DROPPED: they
 *    consume only the trailing section of the file (no seek logic that
 *    the stitch path depends on) and are useless for SVG output.
 *    Consequently the `values` plumbing python threads through
 *    `map_pec_colors`/`process_pec_*` only to feed the graphics metadata
 *    is dropped too.
 *  - The label strip uses JS `trim()` (python `str.strip()`), which
 *    differs only for a few exotic unicode whitespace codepoints.
 *
 * Layout consumed by `readPec` (starting at the `LA:` marker):
 *   3B "LA:" | 16B label | 15B pad | 1B stride | 1B height | 12B pad |
 *   1B color_changes | (cc+1)B color table | pad to absolute 514 |
 *   3B stitch-block length L | 15B marker | stitches ... | FF 00
 *   stitch block ends at absolute `L + 512`.
 */
import { ByteReader, readInt8, readInt24le } from "../binary.js";
import { EmbPattern } from "../pattern.js";
import { EmbThread } from "../thread.js";
import { getThreadSet } from "../pecThreads.js";

const JUMP_CODE = 0x10;
const TRIM_CODE = 0x20;
const FLAG_LONG = 0x80;

/** python `signed12` */
function signed12(b: number): number {
  b &= 0xfff;
  if (b > 0x7ff) return -0x1000 + b;
  return b;
}

/** python `signed7` */
function signed7(b: number): number {
  if (b > 63) return -128 + b;
  return b;
}

/**
 * Reads a PEC block into `out`.
 *
 * @param f positioned AT the `LA:` marker.
 * @param pesChart thread chart loaded from the PES header (may be null
 *                 or empty -> read the PEC color table instead).
 */
export function readPec(f: ByteReader, out: EmbPattern, pesChart: EmbThread[] | null = null): void {
  f.seek(3, 1); // LA:
  const label = f.read(16);
  // python: label = read_string_8(f, 16); if label is not None: metadata
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(label);
    out.metadata("Label", text.trim());
  } catch {
    // read_string_8 returned None (invalid utf-8): python skips metadata.
  }
  f.seek(0xf, 1); // Dunno, spaces then 0xFF 0x00
  const pecGraphicByteStride = readInt8(f);
  const pecGraphicIconHeight = readInt8(f);
  f.seek(0xc, 1);
  const colorChanges = readInt8(f);
  if (colorChanges === null) {
    throw new Error("readPec: unexpected end of file in PEC header");
  }
  const countColors = colorChanges + 1; // PEC uses cc - 1, 0xFF means 0.
  const colorBytes = f.read(countColors);
  mapPecColors(colorBytes, out, pesChart);
  f.seek(0x1d0 - colorChanges, 1);

  const lengthValue = readInt24le(f);
  if (lengthValue === null) {
    throw new Error("readPec: unexpected end of file reading stitch block length");
  }
  // The end of this value is already 5 into the stitchblock.
  const stitchBlockEnd = lengthValue - 5 + f.tell();

  // 3 bytes, '\x31\xff\xf0', 6 2-byte shorts. 15 total.
  f.seek(0x0f, 1);
  readPecStitches(f, out);
  f.seek(stitchBlockEnd, 0);

  // PEC thumbnail graphics read here by python are intentionally dropped.
  void pecGraphicByteStride;
  void pecGraphicIconHeight;
}

/** python `process_pec_colors`: map color bytes straight to the PEC chart. */
function processPecColors(colorBytes: Uint8Array, out: EmbPattern): void {
  const threadSet = getThreadSet();
  const maxValue = threadSet.length;
  for (const byte of colorBytes) {
    const threadValue = threadSet[byte % maxValue];
    out.addThread(threadValue);
  }
}

/**
 * python `process_pec_table`: this is how PEC actually allocates
 * pre-defined threads to blocks — repeated color indices reuse the first
 * thread allocated for that index; new indices pop from the PES chart.
 * Note: python mutates `chart` via `chart.pop(0)`; so do we.
 */
function processPecTable(
  colorBytes: Uint8Array,
  out: EmbPattern,
  chart: EmbThread[]
): void {
  const threadSet = getThreadSet();
  const maxValue = threadSet.length;
  const threadMap = new Map<number, EmbThread>();
  for (let i = 0; i < colorBytes.length; i++) {
    const colorIndex = colorBytes[i] % maxValue;
    let threadValue = threadMap.get(colorIndex) ?? null;
    if (threadValue === null) {
      if (chart.length > 0) threadValue = chart.shift()!;
      else threadValue = threadSet[colorIndex];
      threadMap.set(colorIndex, threadValue);
    }
    out.addThread(threadValue);
  }
}

/** python `map_pec_colors` */
function mapPecColors(
  colorBytes: Uint8Array,
  out: EmbPattern,
  chart: EmbThread[] | null
): void {
  if (chart === null || chart.length === 0) {
    // Reading pec colors.
    processPecColors(colorBytes, out);
  } else if (chart.length >= colorBytes.length) {
    // Reading threads in 1 : 1 mode. (python iterates the whole chart,
    // not just colorBytes.length entries — restated exactly.)
    for (const thread of chart) {
      out.addThread(thread);
    }
  } else {
    // Reading tabled mode threads.
    processPecTable(colorBytes, out, chart);
  }
}

/**
 * python `read_pec_stitches` — PEC delta-encoded stitch stream.
 * Stops on `FF 00` (end marker) or EOF, then appends END.
 */
function readPecStitches(f: ByteReader, out: EmbPattern): void {
  for (;;) {
    const val1 = readInt8(f);
    const val2 = readInt8(f);
    if ((val1 === 0xff && val2 === 0x00) || val2 === null || val1 === null) {
      break;
    }
    if (val1 === 0xfe && val2 === 0xb0) {
      f.seek(1, 1);
      out.colorChange(0, 0);
      continue;
    }
    let jump = false;
    let trim = false;
    let x: number;
    let y: number;
    let code: number;
    let current2: number;

    if ((val1 & FLAG_LONG) !== 0) {
      if ((val1 & TRIM_CODE) !== 0) trim = true;
      if ((val1 & JUMP_CODE) !== 0) jump = true;
      code = (val1 << 8) | val2;
      x = signed12(code);
      const nextByte = readInt8(f);
      if (nextByte === null) break;
      current2 = nextByte;
    } else {
      x = signed7(val1);
      current2 = val2;
    }

    if ((current2 & FLAG_LONG) !== 0) {
      if ((current2 & TRIM_CODE) !== 0) trim = true;
      if ((current2 & JUMP_CODE) !== 0) jump = true;
      const val3 = readInt8(f);
      if (val3 === null) break;
      code = (current2 << 8) | val3;
      y = signed12(code);
    } else {
      y = signed7(current2);
    }

    if (jump) {
      out.move(x, y);
    } else if (trim) {
      out.trim();
      out.move(x, y);
    } else {
      out.stitch(x, y);
    }
  }
  out.end();
}
