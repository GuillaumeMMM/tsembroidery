import { SVGPathData } from "svg-pathdata";
import type { Matrix } from "../matrix.js";
import { UNITS_PER_MM } from "./numbers.js";
import type { SvgShape } from "./types.js";

export interface Point2 {
  x: number;
  y: number;
}

export interface FlatPathSubpath {
  points: Point2[];
  closed: boolean;
}

export interface PathStitchOptions {
  runningStitchLength?: number;
  fillStitchLength?: number;
  flattenTolerance?: number;
  underlay?: boolean;
  pullCompensation?: number;
  rowSpacing?: number;
  fillAngle?: number;
}

export const SATIN_MIN_WIDTH = 1 * UNITS_PER_MM;
/** Wider satin stitches get loose and snag; wider strokes are filled instead. */
export const SATIN_MAX_WIDTH = 7 * UNITS_PER_MM;

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function flattenCubic(
  points: Point2[],
  start: Point2,
  c1: Point2,
  c2: Point2,
  end: Point2,
  tolerance: number,
): void {
  // Wang's formula: enough segments to stay within `tolerance` of the curve.
  const bend = Math.max(
    Math.hypot(start.x - 2 * c1.x + c2.x, start.y - 2 * c1.y + c2.y),
    Math.hypot(c1.x - 2 * c2.x + end.x, c1.y - 2 * c2.y + end.y),
  );
  const steps = Math.max(
    1,
    Math.min(
      512,
      Math.ceil(Math.sqrt((0.75 * bend) / Math.max(tolerance, 0.001))),
    ),
  );
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    const u = 1 - t;
    points.push({
      x:
        u * u * u * start.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * end.x,
      y:
        u * u * u * start.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * end.y,
    });
  }
  points.push(end);
}

/** `tolerance` is measured after `transform`. */
export function flattenSvgPath(
  data: string,
  tolerance = 0.25,
  transform?: Matrix,
): FlatPathSubpath[] {
  const path = new SVGPathData(data)
    .toAbs()
    .normalizeHVZ(false)
    .normalizeST()
    .qtToC()
    .aToC();
  if (transform) {
    path.matrix(
      transform[0],
      transform[1],
      transform[3],
      transform[4],
      transform[6],
      transform[7],
    );
  }

  const subpaths: FlatPathSubpath[] = [];
  let points: Point2[] = [];
  let start: Point2 = { x: 0, y: 0 };
  const flush = (closed: boolean): void => {
    if (points.length > 0) subpaths.push({ points, closed });
    points = [];
  };

  for (const command of path.commands) {
    if (command.type === SVGPathData.MOVE_TO) {
      flush(false);
      start = { x: command.x, y: command.y };
      points = [start];
      continue;
    }
    if (command.type === SVGPathData.CLOSE_PATH) {
      flush(true);
      continue;
    }
    // After Z, drawing resumes at the subpath start.
    if (points.length === 0) points.push(start);
    if (command.type === SVGPathData.CURVE_TO) {
      flattenCubic(
        points,
        points[points.length - 1],
        { x: command.x1, y: command.y1 },
        { x: command.x2, y: command.y2 },
        { x: command.x, y: command.y },
        tolerance,
      );
    } else if (command.type === SVGPathData.LINE_TO) {
      points.push({ x: command.x, y: command.y });
    }
  }
  flush(false);
  return subpaths;
}

export function resample(
  points: Point2[],
  closed: boolean,
  stitchLength: number,
): Point2[] {
  const output: Point2[] = [points[0]];
  const segments = closed ? [...points, points[0]] : points;
  for (let index = 1; index < segments.length; index += 1) {
    const start = segments[index - 1];
    const end = segments[index];
    const length = distance(start, end);
    if (length <= 0.000001) {
      const last = output[output.length - 1];
      if (last.x !== end.x || last.y !== end.y) output.push(end);
      continue;
    }
    const count = Math.max(1, Math.ceil(length / stitchLength));
    for (let step = 1; step <= count; step += 1) {
      const amount = step / count;
      output.push({
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
      });
    }
  }
  return output;
}

function unit(x: number, y: number): Point2 {
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

/**
 * Zigzag across the line, evenly spaced along it. The direction across is blended
 * between corners, so curves made of straight segments stay smooth.
 */
function satin(
  points: Point2[],
  closed: boolean,
  width: number,
  spacing: number,
): Point2[] {
  const line = points.filter(
    (point, i) => i === 0 || distance(points[i - 1], point) > 0.000001,
  );
  if (
    closed &&
    line.length > 1 &&
    distance(line[0], line[line.length - 1]) > 0.000001
  )
    line.push(line[0]);
  if (line.length < 2) return [...line];
  const segments = line
    .slice(1)
    .map((end, i) => unit(end.x - line[i].x, end.y - line[i].y));
  const tangents = line.map((_, i) => {
    let before = segments[i - 1];
    let after = segments[i];
    if (closed && (i === 0 || i === line.length - 1))
      [before, after] = [segments[segments.length - 1], segments[0]];
    if (!before || !after) return before ?? after;
    const blended = unit(before.x + after.x, before.y + after.y);
    return blended.x === 0 && blended.y === 0 ? after : blended;
  });
  const lengths = [0];
  for (let i = 1; i < line.length; i++)
    lengths.push(lengths[i - 1] + distance(line[i - 1], line[i]));
  const total = lengths[lengths.length - 1];
  // Same-side peaks are `spacing` apart; a loop needs an even count to close on the same side.
  let count = Math.max(1, Math.ceil(total / (spacing / 2)));
  if (closed && count % 2 === 1) count += 1;

  const output: Point2[] = [];
  let segment = 0;
  for (let k = 0; k <= count; k++) {
    const along = (total * k) / count;
    while (segment < line.length - 2 && lengths[segment + 1] < along) segment++;
    const t = Math.min(
      1,
      Math.max(
        0,
        (along - lengths[segment]) / (lengths[segment + 1] - lengths[segment]),
      ),
    );
    const [a, b] = [line[segment], line[segment + 1]];
    const [ta, tb] = [tangents[segment], tangents[segment + 1]];
    const tangent = unit(ta.x + (tb.x - ta.x) * t, ta.y + (tb.y - ta.y) * t);
    const offset = k % 2 === 0 ? width / 2 : -width / 2;
    output.push({
      x: a.x + (b.x - a.x) * t - tangent.y * offset,
      y: a.y + (b.y - a.y) * t + tangent.x * offset,
    });
  }
  return output;
}

export function resolvePathStitchOptions(
  options: PathStitchOptions = {},
): Required<PathStitchOptions> {
  const {
    runningStitchLength = 2.5,
    fillStitchLength = 3,
    flattenTolerance = 0.05,
    underlay = true,
    pullCompensation = 0,
    rowSpacing = 0.4,
    fillAngle = 45,
  } = options;
  if (!Number.isFinite(runningStitchLength) || runningStitchLength <= 0) {
    throw new RangeError(
      "SVG running stitch length must be a positive finite number",
    );
  }
  if (!Number.isFinite(fillStitchLength) || fillStitchLength <= 0) {
    throw new RangeError(
      "SVG fill stitch length must be a positive finite number",
    );
  }
  if (!Number.isFinite(flattenTolerance) || flattenTolerance <= 0) {
    throw new RangeError(
      "SVG flatten tolerance must be a positive finite number",
    );
  }
  if (!Number.isFinite(pullCompensation) || pullCompensation < 0) {
    throw new RangeError("SVG pull compensation must be a non-negative number");
  }
  if (!Number.isFinite(rowSpacing) || rowSpacing <= 0) {
    throw new RangeError("SVG row spacing must be a positive finite number");
  }
  if (!Number.isFinite(fillAngle)) {
    throw new RangeError("SVG fill angle must be a finite number");
  }
  return {
    runningStitchLength,
    fillStitchLength,
    flattenTolerance,
    underlay,
    pullCompensation,
    rowSpacing,
    fillAngle,
  };
}

/** Stroke width in pattern units, after the shape's transform. */
export function strokeWidth(shape: SvgShape): number {
  const [a, b, , c, d] = shape.transform;
  return (shape.outline?.style.width ?? 0) * Math.sqrt(Math.abs(a * d - b * c));
}

export function strokePoints(
  line: FlatPathSubpath,
  width: number,
  options: Required<PathStitchOptions>,
): Point2[] {
  const run = resample(
    line.points,
    line.closed,
    options.runningStitchLength * UNITS_PER_MM,
  );
  if (width < SATIN_MIN_WIDTH) return run;
  width += 2 * options.pullCompensation * UNITS_PER_MM;
  const spacing = options.rowSpacing * UNITS_PER_MM;
  if (!options.underlay) return satin(line.points, line.closed, width, spacing);
  // Underlay walks the centerline, then the satin comes back over it.
  const back = line.closed ? line.points : [...line.points].reverse();
  return [...run, ...satin(back, line.closed, width, spacing)];
}
