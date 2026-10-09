import { EmbConstant } from "../constants.js";
import type { Stitch } from "../pattern.js";
import { resolveStitchSettings } from "./pathData.js";
import { planZone } from "./plan.js";
import type { StitchZone, ThreadStitchSettings, ZonePoint } from "./types.js";

/** Splits stitches at jumps into runs of needle points, the thread being cut between runs. */
export function splitRuns(stitches: Stitch[]): Stitch[][] {
  const runs: Stitch[][] = [];
  for (const stitch of stitches) {
    if (stitch[2] === EmbConstant.JUMP || runs.length === 0) runs.push([]);
    if (stitch[2] === EmbConstant.STITCH) runs[runs.length - 1].push(stitch);
  }
  return runs.filter((run) => run.length > 0);
}

/**
 * Adds `count` small stitches at both thread ends of a run, going back and forth
 * a third of the way along the neighbouring stitch, so the thread holds once cut.
 */
export function tie(stitches: Stitch[], count: number): Stitch[] {
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

const finitePoint = (point: ZonePoint) =>
  Number.isFinite(point?.x) && Number.isFinite(point?.y);

/** Checks a zone's numbers and drops parts with nothing to stitch. */
function checkZone(zone: StitchZone): StitchZone {
  if (!Array.isArray(zone)) throw new TypeError("stitchZone: zone must be an array of parts");
  return zone.filter((part) => {
    if (part.kind === "fill") {
      if (!part.rings.every((ring) => ring.every(finitePoint))) {
        throw new RangeError("stitchZone: fill points must be finite numbers");
      }
      return part.rings.some((ring) => ring.length >= 3);
    }
    if (part.kind === "satin" || part.kind === "running") {
      if (!part.points.every(finitePoint)) {
        throw new RangeError(`stitchZone: ${part.kind} points must be finite numbers`);
      }
      if (part.kind === "satin" && !(Number.isFinite(part.width) && part.width >= 0)) {
        throw new RangeError("stitchZone: satin width must be a non-negative number");
      }
      return part.points.length > 0;
    }
    throw new TypeError(`stitchZone: unknown part kind ${String((part as { kind: unknown }).kind)}`);
  });
}

/**
 * Stitches a thread's zone: fills and satin first, running lines last, each next part the nearest,
 * as `readSvg` does. Starts near `from` when given. Runs between thread cuts are separated by a
 * SEQUENCE_BREAK (a trim), as `readSvg` writes them. Deterministic: the same zone and settings
 * always give the same stitches. Settings are checked as by `resolveStitchSettings`.
 */
export function stitchZone(
  zone: StitchZone,
  settings: Partial<ThreadStitchSettings> = {},
  from: ZonePoint | null = null,
): Stitch[] {
  const resolved = resolveStitchSettings(settings);
  if (from !== null && !finitePoint(from)) {
    throw new RangeError("stitchZone: from must have finite x and y");
  }
  const stitches: Stitch[] = [];
  for (const block of planZone(checkZone(zone), resolved, from)) {
    for (const run of splitRuns(block.stitches)) {
      if (stitches.length > 0) {
        const [x, y] = stitches[stitches.length - 1];
        stitches.push([x, y, EmbConstant.SEQUENCE_BREAK]);
      }
      stitches.push(...tie(run, resolved.tieStitches));
    }
  }
  return stitches;
}
