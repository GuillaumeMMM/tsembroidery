/**
 * Port of pyembroidery `PesReader.py`.
 *
 * Flow: magic (8B) -> PEC block offset (int32le) -> version-specific
 * header (metadata/threads) -> seek to PEC block -> readPec ->
 * convertDuplicateColorChangeToStop.
 *
 * The "#PEC0001" magic is a PES container holding a bare PEC block.
 * Unknown magics are NOT fatal (python: `pass`) — the PEC block at the
 * declared offset is still parsed.
 */
import {
  ByteReader,
  readInt8,
  readInt16le,
  readInt24be,
  readInt32le,
  readString8,
} from "../binary.js";
import { EmbPattern } from "../pattern.js";
import { EmbThread } from "../thread.js";
import { readPec } from "./pec.js";

/**
 * python `read_embroidery(reader, f, settings, pattern)` convenience
 * wrapper (python exposes this as `read_pes`): wraps the raw bytes,
 * creates the pattern when not provided, returns it.
 *
 * python's `PesReader.read(f, out, settings)` accepts `settings` but
 * never reads it — the parameter is threaded through for signature
 * fidelity.
 */
export function readPes(
  bytes: Uint8Array,
  settings?: Record<string, unknown>,
  pattern?: EmbPattern
): EmbPattern {
  const out = pattern ?? new EmbPattern();
  readPesInto(new ByteReader(bytes), out, settings);
  return out;
}

/**
 * python `PesReader.read(f, out, settings=None)` — the low-level reader;
 * fills `out` in place.
 */
export function readPesInto(
  f: ByteReader,
  out: EmbPattern,
  _settings?: Record<string, unknown> // python: accepted, unused
): void {
  const loadedThreadValues: EmbThread[] = [];

  const pesString = readString8(f, 8);

  if (pesString === "#PEC0001") {
    readPec(f, out, loadedThreadValues);
    out.convertDuplicateColorChangeToStop();
    return;
  }

  const pecBlockPosition = readInt32le(f);
  if (pecBlockPosition === null) {
    throw new Error("readPes: unexpected end of file reading PEC block offset");
  }

  // Ignoring several known PES versions, just abort and read PEC block
  // All versions allow, abort and read PEC block.
  // Metadata started appearing in V4.
  // Threads appeared in V5.
  // We quickly abort if there's any complex items in the header.
  // "#PES0100", "#PES0090" "#PES0080" "#PES0070", "#PES0040",
  // "#PES0030", "#PES0022", "#PES0020"
  if (pesString === "#PES0060") {
    readPesHeaderVersion6(f, out, loadedThreadValues);
  } else if (pesString === "#PES0050") {
    readPesHeaderVersion5(f, out, loadedThreadValues);
  } else if (pesString === "#PES0055") {
    readPesHeaderVersion5(f, out, loadedThreadValues);
  } else if (pesString === "#PES0056") {
    readPesHeaderVersion5(f, out, loadedThreadValues);
  } else if (pesString === "#PES0040") {
    readPesHeaderVersion4(f, out);
  } else if (pesString === "#PES0001") {
    readPesHeaderVersion1(f, out);
  }
  // else: Header is unrecognised. (python: pass)

  f.seek(pecBlockPosition, 0);
  readPec(f, out, loadedThreadValues);
  out.convertDuplicateColorChangeToStop();
}

/** python `read_pes_string`: length-prefixed string, 0 length -> None. */
function readPesString(f: ByteReader): string | null {
  const length = readInt8(f);
  if (length === null || length === 0) return null;
  return readString8(f, length);
}

function readPesMetadata(f: ByteReader, out: EmbPattern): void {
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

function readPesThread(f: ByteReader, threadlist: EmbThread[]): void {
  const thread = new EmbThread();
  thread.catalog_number = readPesString(f);
  const color = readInt24be(f);
  if (color === null) {
    throw new Error("readPes: unexpected end of file reading thread color");
  }
  thread.color = (0xff000000 | color) >>> 0;
  f.seek(5, 1);
  thread.description = readPesString(f);
  thread.brand = readPesString(f);
  thread.chart = readPesString(f);
  threadlist.push(thread);
}

function readPesHeaderVersion1(_f: ByteReader, _out: EmbPattern): void {
  // Nothing I care about. (python: pass — reads nothing)
}

function readPesHeaderVersion4(f: ByteReader, out: EmbPattern): void {
  f.seek(4, 1);
  readPesMetadata(f, out);
}

/** Shared by v5 (skip 24) and v6 (skip 36) — see the two callers. */
function readPesHeaderThreads(
  f: ByteReader,
  out: EmbPattern,
  threadlist: EmbThread[],
  imageKey: string
): void {
  const v = readPesString(f);
  if (v !== null && v.length > 0) out.metadata(imageKey, v);
  f.seek(24, 1);
  const countProgrammableFills = readInt16le(f);
  if (countProgrammableFills !== 0) return;
  const countMotifs = readInt16le(f);
  if (countMotifs !== 0) return;
  const countFeatherPatterns = readInt16le(f);
  if (countFeatherPatterns !== 0) return;
  const countThreads = readInt16le(f);
  if (countThreads === null) return;
  for (let i = 0; i < countThreads; i++) {
    readPesThread(f, threadlist);
  }
}

function readPesHeaderVersion5(
  f: ByteReader,
  out: EmbPattern,
  threadlist: EmbThread[]
): void {
  f.seek(4, 1);
  readPesMetadata(f, out);
  f.seek(24, 1); // this is 36 in version 6 and 24 in version 5
  readPesHeaderThreads(f, out, threadlist, "image");
}

function readPesHeaderVersion6(
  f: ByteReader,
  out: EmbPattern,
  threadlist: EmbThread[]
): void {
  f.seek(4, 1);
  readPesMetadata(f, out);
  f.seek(36, 1); // this is 36 in version 6 and 24 in version 5
  readPesHeaderThreads(f, out, threadlist, "image_file");
}
