/** Port of pyembroidery's XxxWriter. */
import { ByteWriter } from "./binaryWriter.js";
import { EmbConstant } from "./constants.js";
import type { EncoderSettings } from "./encoder.js";
import { EmbPattern } from "./pattern.js";
import { pyRound } from "./pyMath.js";

const { COMMAND_MASK, STITCH, JUMP, TRIM, STOP, END, COLOR_CHANGE } = EmbConstant;

/** 0x7D-0x7F start commands, so short records stop below them. */
const MAX_DELTA = 124;

export interface XxxWriteSettings extends EncoderSettings {
  /** Run the encoder first, splitting moves longer than XXX allows. Default true. */
  encode?: boolean;
}

function zeros(out: ByteWriter, count: number): void {
  out.writeBytes(new Array<number>(count).fill(0));
}

function writeHeader(out: ByteWriter, pattern: EmbPattern): void {
  const stitches = pattern.stitches;
  const last = stitches[stitches.length - 1] ?? [0, 0, END];
  const { minX, minY, maxX, maxY } =
    stitches.length > 0 ? pattern.extents() : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  zeros(out, 0x17);
  // The END command isn't counted.
  out.writeUint32le(stitches.length - 1);
  zeros(out, 0x0c);
  out.writeUint32le(pattern.threadlist.length);
  out.writeUint16le(0);
  for (const value of [maxX - minX, maxY - minY, last[0], -last[1], -minX, maxY]) {
    out.writeUint16le(Math.trunc(value) & 0xffff);
  }
  zeros(out, 0x42 + 4 + 0x73);
  out.writeUint16le(0x20);
  zeros(out, 0x08);
}

function writeShort(out: ByteWriter, dx: number, dy: number): void {
  if (dx < -128 || dx > 127 || dy < -127 || dy > 128) {
    throw new RangeError(`writeXxx: a move exceeds the XXX limit of ${MAX_DELTA}`);
  }
  out.writeUint8(dx & 0xff);
  out.writeUint8(-dy & 0xff);
}

function writeStitches(out: ByteWriter, pattern: EmbPattern): void {
  let x = 0;
  let y = 0;
  for (const stitch of pattern.stitches) {
    const command = stitch[2] & COMMAND_MASK;
    const dx = pyRound(stitch[0] - x);
    const dy = pyRound(stitch[1] - y);
    x += dx;
    y += dy;
    if (command === COLOR_CHANGE || command === STOP) {
      out.writeBytes([0x7f, 0x08]);
      writeShort(out, dx, dy);
    } else if (command === END) {
      break;
    } else if (command === STITCH) {
      if (Math.abs(dx) < MAX_DELTA && Math.abs(dy) < MAX_DELTA) {
        writeShort(out, dx, dy);
      } else {
        out.writeUint8(0x7d);
        out.writeUint16le(dx & 0xffff);
        out.writeUint16le(-dy & 0xffff);
      }
    } else if (command === TRIM) {
      out.writeBytes([0x7f, 0x03]);
      writeShort(out, dx, dy);
    } else if (command === JUMP) {
      out.writeBytes([0x7f, 0x01]);
      writeShort(out, dx, dy);
    }
  }
}

function writeColors(out: ByteWriter, pattern: EmbPattern): void {
  out.writeBytes([0x00, 0x00]);
  for (const thread of pattern.threadlist) {
    out.writeBytes([0x00, thread.getRed(), thread.getGreen(), thread.getBlue()]);
  }
  zeros(out, 4 * Math.max(0, 21 - pattern.threadlist.length));
  out.writeUint32le(0xffffff00);
  out.writeBytes([0x00, 0x01]);
}

/** Serializes a pattern as a Singer .xxx file. */
export function writeXxx(source: EmbPattern, settings: XxxWriteSettings = {}): Uint8Array {
  const { encode = true, ...encoderSettings } = settings;
  const pattern = encode
    ? source.getNormalizedPattern({
        max_jump: MAX_DELTA,
        max_stitch: MAX_DELTA,
        full_jump: false,
        // As in current pyembroidery: no trim before color changes.
        explicit_trim: false,
        round: true,
        ...encoderSettings,
      })
    : source;

  const out = new ByteWriter();
  writeHeader(out, pattern);
  const endOfStitchesOffset = out.tell();
  out.writeUint32le(0);
  writeStitches(out, pattern);
  const endOfStitches = out.tell();
  out.seek(endOfStitchesOffset);
  out.writeUint32le(endOfStitches);
  out.seek(endOfStitches);
  out.writeBytes([0x7f, 0x7f, 0x02, 0x14]);
  writeColors(out, pattern);
  return out.toUint8Array();
}
