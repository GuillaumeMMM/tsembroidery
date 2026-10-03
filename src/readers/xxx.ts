/** Port of pyembroidery's XxxReader. */
import { signed16, signed8 } from "../binary.js";
import { EmbPattern } from "../pattern.js";
import { EmbThread } from "../thread.js";

const STITCHES_START = 0x100;

/** Parses a Singer .xxx file. */
export function readXxx(bytes: Uint8Array): EmbPattern {
  const out = new EmbPattern();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorCount = bytes.length >= 0x29 ? view.getUint16(0x27, true) : 0;
  let offset = STITCHES_START;
  const byte = () => (offset < bytes.length ? bytes[offset++] : null);
  while (offset < bytes.length) {
    const b1 = byte()!;
    if (b1 === 0x7d || b1 === 0x7e) {
      if (offset + 4 > bytes.length) break;
      const x = signed16(view.getUint16(offset, true));
      const y = signed16(view.getUint16(offset + 2, true));
      offset += 4;
      out.move(x, -y);
      continue;
    }
    const b2 = byte();
    if (b2 === null) break;
    if (b1 !== 0x7f) {
      out.stitch(signed8(b1), -signed8(b2));
      continue;
    }
    const b3 = byte();
    const b4 = byte();
    if (b3 === null || b4 === null) break;
    if (b2 === 0x01) {
      out.move(signed8(b3), -signed8(b4));
    } else if (b2 === 0x03) {
      out.trim();
      const [x, y] = [signed8(b3), -signed8(b4)];
      if (x !== 0 || y !== 0) out.move(x, y);
    } else if (b2 === 0x08 || (b2 >= 0x0a && b2 <= 0x17)) {
      out.colorChange();
    } else if (b2 === 0x7f || b2 === 0x18) {
      break;
    }
  }
  out.end();
  // Colors follow the end marker and two padding bytes, as 0x00RRGGBB.
  offset += 2;
  for (let i = 0; i < colorCount && offset + 4 <= bytes.length; i++, offset += 4) {
    const thread = new EmbThread();
    thread.color = view.getUint32(offset, false);
    out.addThread(thread);
  }
  return out;
}
