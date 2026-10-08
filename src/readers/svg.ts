import { EmbConstant } from "../constants.js";
import { EmbPattern, type Stitch, type StitchBlock } from "../pattern.js";
import { resolvePathStitchOptions } from "../svg/pathData.js";
import { normalizeSvg } from "../svg/normalize.js";
import { planStitches } from "../svg/plan.js";
import type { SvgReadSettings } from "../svg/types.js";

export type SvgInput = string | Uint8Array;

export type { SvgDomParser, SvgReadSettings } from "../svg/types.js";

export interface SvgReadResult {
  pattern: EmbPattern;
  /** Parts of the SVG that were skipped or unsupported, each listed once. */
  warnings: string[];
}

export function decodeSvgInput(input: SvgInput): string {
  let source: string;
  try {
    source =
      typeof input === "string"
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
      i % 2 === 0
        ? [x + (nx - x) / 3, y + (ny - y) / 3, EmbConstant.STITCH]
        : [x, y, EmbConstant.STITCH],
    );
  const last = stitches.length - 1;
  return [
    stitches[0],
    ...lock(stitches[0], stitches[1]),
    ...stitches.slice(1),
    ...lock(stitches[last], stitches[last - 1]),
  ];
}

/** Shrinks and moves the stitches, if needed, so they stay inside the `limit`×`limit` square at the origin. */
function fitInto(pattern: EmbPattern, limit: number): void {
  const { minX, minY, maxX, maxY } = pattern.extents();
  const scale = Math.min(1, limit / Math.max(maxX - minX, maxY - minY));
  const fit = (min: number, max: number) => {
    const half = ((max - min) * scale) / 2;
    return [
      (min + max) / 2,
      Math.min(Math.max((min + max) / 2, half), limit - half),
    ];
  };
  const [[cx, nx], [cy, ny]] = [fit(minX, maxX), fit(minY, maxY)];
  for (const stitch of pattern.stitches) {
    stitch[0] = nx + (stitch[0] - cx) * scale;
    stitch[1] = ny + (stitch[1] - cy) * scale;
  }
}

/**
 * Fills become tatami and strokes running or satin stitches; hidden parts are dropped and colors grouped.
 */
export function readSvg(
  input: SvgInput,
  settings: SvgReadSettings = {},
): SvgReadResult {
  const stitchOptions = resolvePathStitchOptions({
    runningStitchLength: settings.runningStitchLength,
    fillStitchLength: settings.fillStitchLength,
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
  const warnings = [...new Set(normalized.warnings)];
  const fit = settings.fit ?? true;
  const pattern = new EmbPattern();
  // Each run between jumps becomes its own block, so the thread is trimmed before every jump.
  const runs = planStitches(normalized.shapes, stitchOptions).flatMap(
    ([stitches, thread]) => {
      const split: StitchBlock[] = [];
      for (const stitch of stitches) {
        if (stitch[2] === EmbConstant.JUMP || split.length === 0)
          split.push([[], thread]);
        if (stitch[2] === EmbConstant.STITCH)
          split[split.length - 1][0].push(stitch);
      }
      return split.filter(([run]) => run.length > 0);
    },
  );
  if (runs.length === 0) return { pattern, warnings };

  for (const [stitches, thread] of runs)
    pattern.addStitchblock([tie(stitches, ties), thread]);
  // Ends like any other block, with a trim.
  const [x, y] = pattern.stitches[pattern.stitches.length - 1];
  pattern.addCommand(EmbConstant.SEQUENCE_BREAK, x, y);
  const size = normalized.viewport.targetSize;
  if (fit) fitInto(pattern, size);
  // Embroidery formats start the needle at (0, 0), the center of the design.
  pattern.translate(-size / 2, -size / 2);
  return { pattern, warnings };
}

export type { NormalizedSvg, SvgShape, SvgViewport } from "../svg/types.js";
