/**
 * Synthetic PEC/PES byte builders for reader tests.
 *
 * PEC block layout (relative offsets, `LA:` at 0):
 *   0    "LA:"                     (3)
 *   3    label                     (16)
 *   19   pad                       (15)
 *   34   stride                    (1)
 *   35   height                    (1)
 *   36   pad                       (12)
 *   48   color_changes             (1)  = colors.length - 1
 *   49   color table               (cc+1)
 *   ...  pad to 514
 *   514  stitch block length L     (3)  endAbsWithinBlock = L + 512
 *   517  marker                    (15)
 *   532  stitch stream ...         FF 00 terminator, optional pad to end
 */
export interface PecSpec {
  label?: string;
  /** PEC chart indices (bytes); color_changes = length - 1. */
  colors?: number[];
  stitches?: Uint8Array | number[];
  /** padding bytes appended after the FF 00 terminator (default 0). */
  pad?: number;
}

export function buildPecBlock(spec: PecSpec = {}): Uint8Array {
  const label = spec.label ?? "Test Label";
  const colors = spec.colors ?? [5];
  const stitches = spec.stitches ?? new Uint8Array([0, 0, 0xff, 0x00]);
  const pad = spec.pad ?? 0;

  const out: number[] = [];
  const push = (...bytes: number[]) => out.push(...bytes);
  const pushAscii = (s: string) => {
    for (let i = 0; i < s.length; i++) push(s.charCodeAt(i));
  };

  pushAscii("LA:");
  const labelText = label.padEnd(16, " ").substring(0, 16);
  pushAscii(labelText);
  push(...new Array(15).fill(0)); // 0xF pad
  push(1); // stride
  push(1); // height
  push(...new Array(12).fill(0)); // 0xC pad
  push(colors.length - 1); // color_changes
  push(...colors);
  while (out.length < 514) push(0);

  const endRel = 532 + stitches.length + pad;
  const lengthValue = endRel - 512;
  push(lengthValue & 0xff, (lengthValue >> 8) & 0xff, (lengthValue >> 16) & 0xff);
  // 15 byte marker: 3 bytes '\x31\xff\xf0' + 6 shorts
  push(0x31, 0xff, 0xf0, ...new Array(12).fill(0));
  push(...stitches);
  push(...new Array(pad).fill(0xee));
  return Uint8Array.from(out);
}

/* ----------------------- stitch stream encoding ----------------------- */

/** signed7 inverse: python `signed7(b) = b > 63 ? -128 + b : b`. */
function enc7(v: number): number {
  if (v >= 0 && v <= 63) return v;
  if (v >= -64 && v <= -1) return 128 + v;
  throw new Error(`value ${v} does not fit in signed7`);
}

function fits12(v: number): boolean {
  return v >= -2048 && v <= 2047;
}

/** Encodes one delta stitch WITHOUT flags (7-bit or 12-bit per axis). */
export function encStitch(x: number, y: number): number[] {
  if (!fits12(x) || !fits12(y)) {
    throw new Error(`stitch (${x},${y}) does not fit in 12 bits`);
  }
  const xLong = x < -64 || x > 63;
  const yLong = y < -64 || y > 63;
  if (!xLong && !yLong) return [enc7(x), enc7(y)];
  const out: number[] = [];
  if (xLong) {
    out.push(0x80 | ((x >> 8) & 0x0f), x & 0xff);
    if (yLong) out.push(0x80 | ((y >> 8) & 0x0f), y & 0xff);
    else out.push(enc7(y));
  } else {
    out.push(enc7(x));
    out.push(0x80 | ((y >> 8) & 0x0f), y & 0xff);
  }
  return out;
}

/** Jump: JUMP_CODE (0x10) set on the first long byte. */
export function encJump(x: number, y: number): number[] {
  const bytes = encStitch(x, y);
  if ((bytes[0] & 0x80) === 0) {
    // seven-bit x cannot carry flags: force long form for the jump
    return encLongXY(x, y, 0x10);
  }
  bytes[0] |= 0x10;
  return bytes;
}

/** Trim: TRIM_CODE (0x20) set — python emits TRIM then JUMP. */
export function encTrim(x: number, y: number): number[] {
  const bytes = encStitch(x, y);
  if ((bytes[0] & 0x80) === 0) return encLongXY(x, y, 0x20);
  bytes[0] |= 0x20;
  return bytes;
}

/** Always long form for both axes, with flags on the x high byte. */
function encLongXY(x: number, y: number, flags: number): number[] {
  const xOut: number[] = [0x80 | flags | ((x >> 8) & 0x0f), x & 0xff];
  if (y < -64 || y > 63) xOut.push(0x80 | ((y >> 8) & 0x0f), y & 0xff);
  else xOut.push(enc7(y));
  return xOut;
}

export const COLOR_CHANGE_BYTES = [0xfe, 0xb0, 0x00];
export const END_BYTES = [0xff, 0x00];

export function bytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) out.push(...part);
  return Uint8Array.from(out);
}

/* ----------------------------- PES container -------------------------- */

/** Length-prefixed PES string: 0 -> null (python `read_pes_string`). */
export function pesString(value: string | null): number[] {
  if (value === null) return [0];
  const encoded = [...value].map((c) => c.charCodeAt(0));
  return [encoded.length, ...encoded];
}

export function pesMetadata(values: (string | null)[]): number[] {
  return values.flatMap(pesString);
}

/** PES thread record: catalog, int24be color, 5 pad, desc, brand, chart. */
export function pesThread(spec: {
  catalog?: string | null;
  color: number;
  description?: string | null;
  brand?: string | null;
  chart?: string | null;
}): number[] {
  return [
    ...pesString(spec.catalog ?? null),
    (spec.color >> 16) & 0xff,
    (spec.color >> 8) & 0xff,
    spec.color & 0xff,
    0, 0, 0, 0, 0, // 5 byte skip
    ...pesString(spec.description ?? null),
    ...pesString(spec.brand ?? null),
    ...pesString(spec.chart ?? null),
  ];
}

/**
 * Builds a PES container: magic + int32le offset + arbitrary header,
 * with the PEC block placed at `pecOffset` (padded with 0xCC).
 */
export function buildPes(
  magic: string,
  header: number[] | Uint8Array,
  pecBlock: Uint8Array,
  options: { pecOffset?: number } = {}
): Uint8Array {
  const magicBytes = [...magic].map((c) => c.charCodeAt(0));
  const fixed = magicBytes.length === 8 ? 8 : 8;
  // layout: magic(8) + offset(4) + header + pad + pec
  const minimum = 12 + header.length;
  const pecOffset = options.pecOffset ?? minimum;
  const offsetBytes = [
    pecOffset & 0xff,
    (pecOffset >> 8) & 0xff,
    (pecOffset >> 16) & 0xff,
    (pecOffset >> 24) & 0xff,
  ];
  const out = [...magicBytes, ...offsetBytes, ...header];
  while (out.length < pecOffset) out.push(0xcc);
  return bytes(Uint8Array.from(out), pecBlock);
}

/** `#PEC0001` container: magic (8) directly followed by the PEC block. */
export function buildPecContainer(pecBlock: Uint8Array): Uint8Array {
  const magic = [..."#PEC0001"].map((c) => c.charCodeAt(0));
  return bytes(Uint8Array.from(magic), pecBlock);
}

export const fillers = (n: number, value = 0) => new Array(n).fill(value);
