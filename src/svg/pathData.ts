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

/** Lengths in mm. */
export interface PathStitchOptions {
  stitchLength?: number;
  flattenTolerance?: number;
  underlay?: boolean;
  pullCompensation?: number;
  rowSpacing?: number;
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
  tolerance: number
): void {
  const length = distance(start, c1) + distance(c1, c2) + distance(c2, end);
  const steps = Math.max(2, Math.min(512, Math.ceil(length / Math.max(tolerance, 0.001))));
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    const u = 1 - t;
    points.push({
      x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
      y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
    });
  }
  points.push(end);
}

/** `tolerance` is measured after `transform`. */
export function flattenSvgPath(
  data: string,
  tolerance = 0.25,
  transform?: Matrix
): FlatPathSubpath[] {
  const path = new SVGPathData(data)
    .toAbs()
    .normalizeHVZ(false)
    .normalizeST()
    .qtToC()
    .aToC();
  if (transform) {
    path.matrix(transform[0], transform[1], transform[3], transform[4], transform[6], transform[7]);
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
        tolerance
      );
    } else if (command.type === SVGPathData.LINE_TO) {
      points.push({ x: command.x, y: command.y });
    }
  }
  flush(false);
  return subpaths;
}

export function resample(points: Point2[], closed: boolean, stitchLength: number): Point2[] {
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

function satin(points: Point2[], closed: boolean, width: number, spacing: number): Point2[] {
  // Same-side peaks are `spacing` apart.
  const samples = resample(points, closed, spacing / 2);
  const last = samples.length - 1;
  let normal = { x: 0, y: 0 };
  return samples.map((point, index) => {
    const previous = samples[index - 1] ?? (closed ? samples[last - 1] : point);
    const next = samples[index + 1] ?? (closed ? samples[1] : point);
    const length = distance(previous, next);
    if (length > 0) {
      normal = { x: (previous.y - next.y) / length, y: (next.x - previous.x) / length };
    }
    const offset = index % 2 === 0 ? width / 2 : -width / 2;
    return { x: point.x + normal.x * offset, y: point.y + normal.y * offset };
  });
}

export function resolvePathStitchOptions(
  options: PathStitchOptions = {}
): Required<PathStitchOptions> {
  const {
    stitchLength = 2.5,
    flattenTolerance = 0.05,
    underlay = true,
    pullCompensation = 0.2,
    rowSpacing = 0.4,
  } = options;
  if (!Number.isFinite(stitchLength) || stitchLength <= 0) {
    throw new RangeError("SVG stitch length must be a positive finite number");
  }
  if (!Number.isFinite(flattenTolerance) || flattenTolerance <= 0) {
    throw new RangeError("SVG flatten tolerance must be a positive finite number");
  }
  if (!Number.isFinite(pullCompensation) || pullCompensation < 0) {
    throw new RangeError("SVG pull compensation must be a non-negative number");
  }
  if (!Number.isFinite(rowSpacing) || rowSpacing <= 0) {
    throw new RangeError("SVG row spacing must be a positive finite number");
  }
  return { stitchLength, flattenTolerance, underlay, pullCompensation, rowSpacing };
}

/** Stroke width in pattern units, after the shape's transform. */
export function strokeWidth(shape: SvgShape): number {
  const [a, b, , c, d] = shape.transform;
  return (shape.outline?.style.width ?? 0) * Math.sqrt(Math.abs(a * d - b * c));
}

export function strokePoints(
  line: FlatPathSubpath,
  width: number,
  options: Required<PathStitchOptions>
): Point2[] {
  const run = resample(line.points, line.closed, options.stitchLength * UNITS_PER_MM);
  if (width < SATIN_MIN_WIDTH) return run;
  width += 2 * options.pullCompensation * UNITS_PER_MM;
  const spacing = options.rowSpacing * UNITS_PER_MM;
  if (!options.underlay) return satin(line.points, line.closed, width, spacing);
  // Underlay walks the centerline, then the satin comes back over it.
  const back = line.closed ? line.points : [...line.points].reverse();
  return [...run, ...satin(back, line.closed, width, spacing)];
}
