/**
 * Port of pyembroidery `SvgWriter.py`, plus the `write_embroidery` and
 * `convert` flows from `PyEmbroidery.py` specialized to PES -> SVG.
 *
 * Serialization note: python builds an ElementTree and calls
 * `tree.write(stream)` with the DEFAULT encoding ("us-ascii"), which
 * means NO xml declaration, no pretty-print whitespace, and attribute
 * order = insertion order (python 3.8+). We build the same string by
 * hand — the attribute values here (numbers, `none`, `#rrggbb`, URLs)
 * never need XML escaping, so ElementTree's escaping is a no-op.
 *
 * Number formatting: `numStr` restates python `str()` for the special
 * float values (python prints `inf`/`-inf`/`nan`, JS would print
 * `Infinity`/`-Infinity`/`NaN`). For FINITE values JS's shortest
 * round-trip matches python's repr with one documented caveat: python
 * distinguishes int from float (`str(10)` = "10" but `str(10.0)` =
 * "10.0") and TS cannot — an integer-valued FLOAT (e.g. coordinates
 * that went through a rotation matrix) prints without the trailing
 * ".0". Plain integer coordinates — the normal PES path — match exactly.
 */
import { EmbConstant } from "./constants.js";
import type { EmbPattern } from "./pattern.js";
import type { TranscoderSettings } from "./encoder.js";
import { readPes } from "./readers/pes.js";

const { CONTINGENCY_SEQUIN_STITCH } = EmbConstant;

/** Encoder settings plus the writer/convert level switches. */
export interface SvgSettings extends TranscoderSettings {
  /** python `write_embroidery`: `settings.get("encode", True)`. */
  encode?: boolean;
  /** python `convert`: `settings.get("stable", True)` (used by pesToSvg). */
  stable?: boolean;
}

/** python `str()` for numbers, with python's special-value spellings. */
function numStr(v: number): string {
  if (Number.isFinite(v)) return String(v);
  if (Number.isNaN(v)) return "nan";
  return v > 0 ? "inf" : "-inf";
}

/**
 * python `SvgWriter.write(pattern, f, settings)` — serializes the
 * (already encoded) pattern to an SVG string. python's writer ignores
 * its `settings` argument.
 */
function serializeSvg(pattern: EmbPattern): string {
  const extents = pattern.extents();
  const width = extents.maxX - extents.minX;
  const height = extents.maxY - extents.minY;
  const viewBox =
    `${numStr(extents.minX)} ${numStr(extents.minY)} ` +
    `${numStr(width)} ${numStr(height)}`;

  // root = Element("svg"); root.set(...) in this exact order:
  let out =
    `<svg version="1.1"` +
    ` xmlns="http://www.w3.org/2000/svg"` +
    ` xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` xmlns:ev="http://www.w3.org/2001/xml-events"` +
    ` width="${numStr(width)}" height="${numStr(height)}"` +
    ` viewBox="${viewBox}">`;

  for (const [block, thread] of pattern.getAsStitchblock()) {
    let data = "M";
    for (const stitch of block) {
      data += ` ${numStr(stitch[0])},${numStr(stitch[1])}`;
    }
    out += `<path d="${data}" fill="none" stroke="${thread.hexColor()}" stroke-width="3"/>`;
  }

  out += "</svg>";
  return out;
}

/**
 * python `write_embroidery(SvgWriter, pattern, stream, settings)`:
 * copies the settings, fills every missing encoder key from the
 * WRITER's class attributes, runs `pattern.get_normalized_pattern`
 * (unless `encode` is falsy), then hands the pattern to the writer.
 * Returns the SVG string (python writes bytes to a stream).
 */
export function writeSvg(pattern: EmbPattern, settings?: SvgSettings): string {
  // python: settings = {} if None else settings.copy()
  const s: SvgSettings = { ...(settings ?? {}) };

  // python: if settings.get("encode", True):
  if (s.encode ?? true) {
    // python fills each missing key from the writer class attribute, each
    // in its own `try/except AttributeError`:
    if (s.max_jump === undefined) s.max_jump = Infinity; // writer.MAX_JUMP_DISTANCE
    if (s.max_stitch === undefined) s.max_stitch = Infinity; // writer.MAX_STITCH_DISTANCE
    if (s.full_jump === undefined) s.full_jump = false; // writer.FULL_JUMP
    // strip_speeds: python `writer.STRIP_SPEEDS` raises AttributeError in
    // SvgWriter (no such attribute) -> the key is NOT filled here; the
    // Transcoder's own default (true) applies.
    if (s.sequin_contingency === undefined) {
      // writer.SEQUIN_CONTINGENCY = CONTINGENCY_SEQUIN_STITCH
      s.sequin_contingency = CONTINGENCY_SEQUIN_STITCH;
    }
    pattern = pattern.getNormalizedPattern(s);
  }

  // python: writer.write(pattern, stream, settings)
  return serializeSvg(pattern);
}

/**
 * python `convert(filename_from, filename_to, settings)` specialized to
 * PES bytes -> SVG string: read, take the stable pattern (default true —
 * python applies it whether or not settings are given), then writeSvg.
 */
export function pesToSvg(bytes: Uint8Array, settings?: SvgSettings): string {
  let pattern = readPes(bytes, settings);
  // python convert():
  //   if settings is not None:
  //       stable = settings.get("stable", True)
  //       if stable: pattern = pattern.get_stable_pattern()
  //   else:
  //       pattern = pattern.get_stable_pattern()
  const stable = settings?.stable ?? true;
  if (stable) pattern = pattern.getStablePattern();
  return writeSvg(pattern, settings);
}
