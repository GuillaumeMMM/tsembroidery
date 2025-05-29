import { StringHelpers } from "./types/StringHelpers.js";
import { EmbPattern } from "./types/EmbPattern.js";
import { EmbThreadPec, getThreadSet } from "./types/EmbThreadPec.js";
import { readInt24le, readInt8, readString8 } from "./readHelper.js";
import { EmbThread } from "./types/EmbThread.js";
import { PyFile } from "./types/PyFile.js";

const JUMP_CODE = 0x10;
const TRIM_CODE = 0x20;
const FLAG_LONG = 0x80;

export function read(f: PyFile, out: EmbPattern, settings = null) {
  readPec(f, out);
  out.convertDuplicateColorChangeToStop();
}

export function readPec(f: PyFile, out: EmbPattern, pes_chart = null) {
  f.seek(3, 1); // LA:
  const label = readString8(f, 16); // Label
  if (label != null) {
    out.metadata("Label", StringHelpers.strip(label));
  }
  f.seek(0xf, 1); // Dunno, spaces then 0xFF 0x00
  const pec_graphic_byte_stride = readInt8(f);
  const pec_graphic_icon_height = readInt8(f);
  f.seek(0xc, 1);
  const color_changes = readInt8(f);
  const count_colors = color_changes + 1; // PEC uses cc - 1, 0xFF means 0.
  const color_bytes = new Uint8Array(f.read(count_colors));
  const threads = [];
  mapPecColors(color_bytes, out, pes_chart, threads);
  f.seek(0x1d0 - color_changes, 1);
  const stitch_block_end = readInt24le(f) - 5 + f.tell();
  // The end of this value is already 5 into the stitchblock.

  // 3 bytes, '\x31\xff\xf0', 6 2-byte shorts. 15 total.
  f.seek(0x0f, 1);
  readPecStitches(f, out);
  f.seek(stitch_block_end, 0);

  const byte_size = pec_graphic_byte_stride * pec_graphic_icon_height;

  readPecGraphics(
    f,
    out,
    byte_size,
    pec_graphic_byte_stride,
    count_colors + 1,
    threads
  );
}

function readPecGraphics(
  f: PyFile,
  out: EmbPattern,
  size: number,
  stride: number,
  count: number,
  values: EmbThreadPec[]
) {
  const v = values;

  v.splice(0, 0, null);
  for (let i = 0; i < count; i++) {
    const graphic = new Uint8Array(f.read(size));
    if (f !== null) {
      out.metadata(i, [graphic, stride, v[i]]);
    }
  }
}

function processPecColors(colorbytes, out: EmbPattern, values: EmbThreadPec[]) {
  const thread_set = getThreadSet();
  const max_value = thread_set.length;
  for (let byte of colorbytes) {
    const thread_value = thread_set[byte % max_value];
    out.addThread(thread_value);
    values.push(thread_value);
  }
}

function processPecTable(
  colorbytes: Uint8Array,
  out: EmbPattern,
  chart,
  values
) {
  // This is how PEC actually allocates pre-defined threads to blocks.
  const thread_set = getThreadSet();
  const max_value = thread_set.length;
  const thread_map = {};
  for (let i = 0; i < colorbytes.length; i++) {
    const color_index = colorbytes[i] % max_value;
    let thread_value = thread_map[color_index] ? thread_map[color_index] : null;
    if (thread_value === null) {
      if (chart.length > 0) thread_value = chart.pop(0);
      else thread_value = thread_set[color_index];
      thread_map[color_index] = thread_value;
    }
    out.addThread(thread_value);
    values.append(thread_value);
  }
}

function mapPecColors(
  colorbytes: Uint8Array,
  out: EmbPattern,
  chart: EmbThread[],
  values
) {
  if (chart === null || chart.length == 0) {
    // Reading pec colors.
    processPecColors(colorbytes, out, values);
  } else if (chart.length >= colorbytes.length) {
    // Reading threads in 1 : 1 mode.
    for (let thread of chart) {
      out.addThread(thread);
      values.append(thread);
    }
  } else {
    // Reading tabled mode threads.
    processPecTable(colorbytes, out, chart, values);
  }
}

function signed12(b: number) {
  b &= 0xfff;
  if (b > 0x7ff) return -0x1000 + b;
  else return b;
}

function signed7(b: number) {
  if (b > 63) return -128 + b;
  else return b;
}

function readPecStitches(f: PyFile, out: EmbPattern) {
  while (1) {
    let val1 = readInt8(f);
    let val2 = readInt8(f);
    let val3 = null;
    if ((val1 == 0xff && val2 == 0x00) || val2 === null) {
      break;
    }
    if (val1 == 0xfe && val2 == 0xb0) {
      f.seek(1, 1);
      out.colorChange(0, 0);
      continue;
    }
    let jump = false;
    let trim = false;
    let x = null;
    let y = null;
    let code = null;
    if ((val1 & FLAG_LONG) != 0) {
      if ((val1 & TRIM_CODE) != 0) {
        trim = true;
      }
      if ((val1 & JUMP_CODE) != 0) {
        jump = true;
      }
      code = (val1 << 8) | val2;
      x = signed12(code);
      val2 = readInt8(f);
      if (val2 === null) {
        break;
      }
    } else {
      x = signed7(val1);
    }

    if ((val2 & FLAG_LONG) != 0) {
      if ((val2 & TRIM_CODE) != 0) {
        trim = true;
      }
      if ((val2 & JUMP_CODE) != 0) {
        jump = true;
      }
      val3 = readInt8(f);
      if (val3 === null) {
        break;
      }
      code = (val2 << 8) | val3;
      y = signed12(code);
    } else {
      y = signed7(val2);
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
