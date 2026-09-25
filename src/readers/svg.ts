import { EmbConstant } from "../constants.js";
import { EmbPattern } from "../pattern.js";
import { resolvePathStitchOptions } from "../svg/pathData.js";
import { normalizeSvg } from "../svg/normalize.js";
import { planStitches } from "../svg/plan.js";
import type { SvgReadSettings } from "../svg/types.js";

export type SvgInput = string | Uint8Array;

export type { SvgReadSettings } from "../svg/types.js";

export function decodeSvgInput(input: SvgInput): string {
  let source: string;
  try {
    source = typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new Error("readSvg: input bytes are not valid UTF-8");
  }
  return source.replace(/^\uFEFF/, "");
}

/** Fills become tatami and strokes running or satin stitches; hidden parts are dropped and colors grouped. */
export function readSvg(
  input: SvgInput,
  settings: SvgReadSettings = {}
): EmbPattern {
  const stitchOptions = resolvePathStitchOptions({
    stitchLength: settings.stitchLength,
    flattenTolerance: settings.flattenTolerance,
    underlay: settings.underlay,
    pullCompensation: settings.pullCompensation,
    rowSpacing: settings.rowSpacing,
  });
  const normalized = normalizeSvg(decodeSvgInput(input), settings);
  normalized.warnings.forEach((warning) => settings.onWarning?.(warning));
  const pattern = new EmbPattern();
  let hasStitches = false;

  for (const block of planStitches(normalized.shapes, stitchOptions)) {
    const firstStitch = block[0].find((stitch) => stitch[2] === EmbConstant.STITCH);
    if (hasStitches && firstStitch) {
      pattern.addStitchAbsolute(EmbConstant.JUMP, firstStitch[0], firstStitch[1]);
    }
    pattern.addStitchblock(block);
    hasStitches = true;
  }
  return pattern;
}

export type { NormalizedSvg, SvgShape, SvgViewport } from "../svg/types.js";
