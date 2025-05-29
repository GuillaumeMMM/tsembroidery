import { EmbPattern } from "./types/EmbPattern.js";
import { EmbThread } from "./types/EmbThread.js";
import { readPec } from "./pecReader.js";
import { PyFile } from "./types/PyFile.js";
import {
  readInt16le,
  readInt24be,
  readInt32le,
  readInt8,
  readString8,
} from "./readHelper.js";

export function read(f: PyFile, out: EmbPattern, settings = null) {
  const loaded_thread_values = [];
  const pes_string = readString8(f, 8);

  if (pes_string == "#PEC0001") {
    readPec(f, out, loaded_thread_values);
    out.convertDuplicateColorChangeToStop();
    return;
  }

  const pec_block_position = readInt32le(f);

  // Ignoring several known PES versions, just abort and read PEC block
  // All versions allow, abort and read PEC block.
  // Metadata started appearing in V4
  // Threads appeared in V5.
  // We quickly abort if there's any complex items in the header.
  // "#PES0100", "#PES0090" "#PES0080" "#PES0070", "#PES0040",
  // "#PES0030", "#PES0022", "#PES0020"
  if (pes_string == "#PES0060")
    readPesHeaderVersion6(f, out, loaded_thread_values);
  else if (pes_string == "#PES0050")
    readPesHeaderVersion5(f, out, loaded_thread_values);
  else if (pes_string == "#PES0055")
    readPesHeaderVersion5(f, out, loaded_thread_values);
  else if (pes_string == "#PES0056")
    readPesHeaderVersion5(f, out, loaded_thread_values);
  else if (pes_string == "#PES0040") readPesHeaderVersion4(f, out);
  else if (pes_string == "#PES0001") readPesHeaderVersion1(f, out);
  else console.error("Header is unrecognised.");
  f.seek(pec_block_position, 0);
  readPec(f, out, loaded_thread_values);
  out.convertDuplicateColorChangeToStop();
}

function readPesString(f) {
  const length = readInt8(f);
  if (length == 0) {
    return null;
  }
  return readString8(f, length);
}

function readPesMetadata(f, out) {
  let v = readPesString(f);
  if (v !== null && v.length > 0) out.metadata("name", v);
  v = readPesString(f);
  if (v !== null && v.length > 0) out.metadata("category", v);
  v = readPesString(f);
  if (v !== null && v.length > 0) out.metadata("author", v);
  v = readPesString(f);
  if (v !== null && v.length > 0) out.metadata("keywords", v);
  v = readPesString(f);
  if (v !== null && v.length > 0) out.metadata("comments", v);
}

function readPesThread(f, threadlist) {
  const thread = new EmbThread();
  thread.catalog_number = readPesString(f);
  thread.color = 0xff000000 | readInt24be(f);
  f.seek(5, 1);
  thread.description = readPesString(f);
  thread.brand = readPesString(f);
  thread.chart = readPesString(f);
  threadlist.push(thread);
}

function readPesHeaderVersion1(f, out) {
  // Nothing I care about.
  console.warn("pass: read_pes_header_version_1");
}

function readPesHeaderVersion4(f, out) {
  f.seek(4, 1);
  readPesMetadata(f, out);
}

function readPesHeaderVersion5(f, out, threadlist) {
  f.seek(4, 1);
  readPesMetadata(f, out);
  f.seek(24, 1); // this is 36 in version 6 and 24 in version 5
  const v = readPesString(f);
  if (v !== null && v.length > 0) out.metadata("image", v);
  f.seek(24, 1);
  const count_programmable_fills = readInt16le(f);
  if (count_programmable_fills != 0) return;
  const count_motifs = readInt16le(f);
  if (count_motifs != 0) return;
  const count_feather_patterns = readInt16le(f);
  if (count_feather_patterns != 0) return;
  const count_threads = readInt16le(f);
  for (let i = 0; i < count_threads; i++) {
    readPesThread(f, threadlist);
  }
}

function readPesHeaderVersion6(f, out, threadlist) {
  f.seek(4, 1);
  readPesMetadata(f, out);
  f.seek(36, 1); // this is 36 in version 6 and 24 in version 5
  const v = readPesString(f);
  if (v !== null && v.length > 0) out.metadata("image_file", v);
  f.seek(24, 1);
  const count_programmable_fills = readInt16le(f);
  if (count_programmable_fills != 0) return;
  const count_motifs = readInt16le(f);
  if (count_motifs != 0) return;
  const count_feather_patterns = readInt16le(f);
  if (count_feather_patterns != 0) return;
  const count_threads = readInt16le(f);
  for (let i = 0; i < count_threads; i++) {
    readPesThread(f, threadlist);
  }
}
