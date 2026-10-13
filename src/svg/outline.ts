import { EmbConstant } from "../constants.js";
import type { Stitch } from "../pattern.js";
import { coverage } from "./geometry.js";
import { UNITS_PER_MM } from "./numbers.js";
import type { Point2 } from "./pathData.js";
import type { StitchZone } from "./types.js";

const SIMPLIFY_TOLERANCE = 0.05;

export function stitchOutline(
  stitches: Stitch[],
  threadWidthMm = 0.4,
): StitchZone {
  if (!Number.isFinite(threadWidthMm) || threadWidthMm <= 0) {
    throw new RangeError(
      "stitchOutline: thread width must be a positive finite number",
    );
  }
  // Lines of consecutive needle points; any other command cuts the line.
  const lines: Point2[][] = [];
  let line: Point2[] = [];
  for (const [x, y, command] of stitches) {
    if (
      command === EmbConstant.STITCH &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      line.push({ x, y });
      continue;
    }
    if (line.length > 0) lines.push(line);
    line = [];
  }
  if (line.length > 0) lines.push(line);

  const width = threadWidthMm * UNITS_PER_MM;
  return coverage(lines, width, width, SIMPLIFY_TOLERANCE * UNITS_PER_MM).map(
    (rings) => ({
      kind: "fill",
      rings,
    }),
  );
}
