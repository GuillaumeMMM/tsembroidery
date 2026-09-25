import { EmbConstant } from "../constants.js";
import { EmbPattern, type Stitch, type StitchBlock } from "../pattern.js";
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

/**
 * Adds `count` small stitches at both thread ends of a run, going back and forth
 * a third of the way along the neighbouring stitch, so the thread holds once cut.
 */
function tie(stitches: Stitch[], count: number): Stitch[] {
  if (count === 0 || stitches.length < 2) return stitches;
  const lock = ([x, y]: Stitch, [nx, ny]: Stitch): Stitch[] =>
    Array.from({ length: count }, (_, i) =>
      i % 2 === 0 ? [x + (nx - x) / 3, y + (ny - y) / 3, EmbConstant.STITCH] : [x, y, EmbConstant.STITCH]
    );
  const last = stitches.length - 1;
  return [
    stitches[0],
    ...lock(stitches[0], stitches[1]),
    ...stitches.slice(1),
    ...lock(stitches[last], stitches[last - 1]),
  ];
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
  const ties = settings.tieStitches ?? 0;
  if (!Number.isInteger(ties) || ties < 0) {
    throw new RangeError("SVG tieStitches must be a non-negative integer");
  }
  const normalized = normalizeSvg(decodeSvgInput(input), settings);
  normalized.warnings.forEach((warning) => settings.onWarning?.(warning));
  const pattern = new EmbPattern();
  // Each run between jumps becomes its own block, so the thread is trimmed before every jump.
  const runs = planStitches(normalized.shapes, stitchOptions).flatMap(([stitches, thread]) => {
    const split: StitchBlock[] = [];
    for (const stitch of stitches) {
      if (stitch[2] === EmbConstant.JUMP || split.length === 0) split.push([[], thread]);
      if (stitch[2] === EmbConstant.STITCH) split[split.length - 1][0].push(stitch);
    }
    return split.filter(([run]) => run.length > 0);
  });
  if (runs.length === 0) return pattern;

  for (const [stitches, thread] of runs) pattern.addStitchblock([tie(stitches, ties), thread]);
  // Ends like any other block, with a trim.
  const [x, y] = pattern.stitches[pattern.stitches.length - 1];
  pattern.addCommand(EmbConstant.SEQUENCE_BREAK, x, y);
  return pattern;
}

export type { NormalizedSvg, SvgShape, SvgViewport } from "../svg/types.js";
