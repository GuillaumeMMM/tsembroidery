import { EmbConstant } from "./constants.js";
import type { EmbPattern } from "./pattern.js";
import type { EncoderSettings } from "./encoder.js";

const { CONTINGENCY_SEQUIN_STITCH } = EmbConstant;

export interface SvgWriteSettings extends EncoderSettings {
  /** Run the encoder first. Default true. */
  encode?: boolean;
  /** Regroup stitches into clean runs before drawing. Default false. */
  stable?: boolean;
}

/** Python str() for numbers (inf, -inf, nan). */
function numStr(v: number): string {
  if (Number.isFinite(v)) return String(v);
  if (Number.isNaN(v)) return "nan";
  return v > 0 ? "inf" : "-inf";
}

function serializeSvg(pattern: EmbPattern): string {
  const extents = pattern.extents();
  const width = extents.maxX - extents.minX;
  const height = extents.maxY - extents.minY;
  const viewBox =
    `${numStr(extents.minX)} ${numStr(extents.minY)} ` +
    `${numStr(width)} ${numStr(height)}`;

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

/** Draws a pattern as SVG: one path per stitch run, in 0.1 mm units. */
export function writeSvg(pattern: EmbPattern, settings?: SvgWriteSettings): string {
  const { stable = false, ...s }: SvgWriteSettings = { ...(settings ?? {}) };
  if (stable) pattern = pattern.getStablePattern();

  if (s.encode ?? true) {
    if (s.max_jump === undefined) s.max_jump = Infinity;
    if (s.max_stitch === undefined) s.max_stitch = Infinity;
    if (s.full_jump === undefined) s.full_jump = false;
    if (s.sequin_contingency === undefined) {
      s.sequin_contingency = CONTINGENCY_SEQUIN_STITCH;
    }
    pattern = pattern.getNormalizedPattern(s);
  }

  return serializeSvg(pattern);
}
