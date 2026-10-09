import { EmbConstant } from "../constants.js";
import type { Stitch } from "../pattern.js";
import type { EmbThread } from "../thread.js";
import { fillStitches } from "./fill.js";
import {
  clipLines,
  intersect,
  islands,
  linesInside,
  strokeOutline,
  subtract,
  unionRings,
  unite,
  type Ring,
} from "./geometry.js";
import { UNITS_PER_MM } from "./numbers.js";
import {
  flattenSvgPath,
  SATIN_MAX_WIDTH,
  SATIN_MIN_WIDTH,
  strokePoints,
  strokeWidth,
  type FlatPathSubpath,
  type Point2,
} from "./pathData.js";
import type {
  SvgShape,
  ThreadStitchSettings,
  ZonePart,
} from "./types.js";

/** Stitches of one zone part, in stitching order. */
export interface PlannedBlock<C = EmbThread> {
  stitches: Stitch[];
  thread: C;
  part: ZonePart;
}

interface Item<C> {
  color: C;
  part: ZonePart;
  /** Running strokes (1) are stitched after fills and satin (0), so they stay on top. */
  layer: 0 | 1;
  starts: Point2[];
  stitch(from: Point2 | null): Stitch[];
}

const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

function nearest(points: Point2[], from: Point2): number {
  return points.reduce((best, point, index) => (distance(point, from) < distance(points[best], from) ? index : best), 0);
}

function strokeItem<C>(
  part: ZonePart & { kind: "satin" | "running" },
  color: C,
  settings: ThreadStitchSettings,
): Item<C> {
  const { points, closed } = part;
  const width = part.kind === "satin" ? part.width : 0;
  return {
    color,
    part,
    layer: width >= SATIN_MIN_WIDTH ? 0 : 1,
    starts: closed ? points : [points[0], points[points.length - 1]],
    stitch(from) {
      let ordered = points;
      if (from !== null && closed) {
        const start = nearest(points, from);
        ordered = [...points.slice(start), ...points.slice(0, start)];
      } else if (from !== null && distance(points[points.length - 1], from) < distance(points[0], from)) {
        ordered = [...points].reverse();
      }
      return strokePoints({ points: ordered, closed }, width, settings).map(({ x, y }) => [x, y, EmbConstant.STITCH]);
    },
  };
}

function fillItem<C>(part: ZonePart & { kind: "fill" }, color: C, settings: ThreadStitchSettings): Item<C> {
  return {
    color,
    part,
    layer: 0,
    starts: part.rings.flat(),
    stitch: (from) => fillStitches(part.rings, settings, from),
  };
}

function partItem<C>(part: ZonePart, color: C, settings: ThreadStitchSettings): Item<C> {
  return part.kind === "fill" ? fillItem(part, color, settings) : strokeItem(part, color, settings);
}

/** A stroke line as a zone part: satin from 1 mm wide, running stitches below. */
function linePart(line: FlatPathSubpath, width: number): ZonePart {
  return width >= SATIN_MIN_WIDTH
    ? { kind: "satin", points: line.points, closed: line.closed, width }
    : { kind: "running", points: line.points, closed: line.closed };
}

/** The area a shape's clip paths leave visible, or null when it has none. */
function clipRegion(shape: SvgShape, tolerance: number): Ring[] | null {
  let region: Ring[] | null = null;
  for (const parts of shape.clips) {
    const union = parts.reduce<Ring[]>((sum, part) => {
      const subpaths = flattenSvgPath(part.d, tolerance, part.transform);
      return unite(sum, unionRings(subpaths.map((subpath) => subpath.points), part.rule));
    }, []);
    region = region === null ? union : intersect(region, union);
  }
  return region;
}

/** Removes what clip paths and later shapes hide, as SVG paints them. Returns items in document order. */
function visibleItems(
  shapes: SvgShape[],
  settings: ThreadStitchSettings,
  tolerance: number,
): Item<EmbThread>[] {
  const items: Item<EmbThread>[] = [];
  let above: Ring[] = [];
  for (const shape of [...shapes].reverse()) {
    const clip = clipRegion(shape, tolerance);
    const clipped = (region: Ring[]) => (clip === null ? region : intersect(region, clip));
    // A shape's stroke is painted over its own fill.
    if (shape.outline !== null) {
      const { style } = shape.outline;
      const fullLines = flattenSvgPath(shape.outline.d, tolerance, shape.transform);
      const lines = clip === null ? fullLines : linesInside(fullLines, clip);
      const width = strokeWidth(shape);
      const outline =
        width >= SATIN_MIN_WIDTH ? clipped(strokeOutline(fullLines, width, style.linecap, style.linejoin)) : [];
      if (width > SATIN_MAX_WIDTH) {
        // Too wide for satin: fill the area the stroke covers.
        for (const island of islands(subtract(outline, above)).reverse()) {
          items.push(fillItem({ kind: "fill", rings: island }, style.color, settings));
        }
      } else {
        for (const line of clipLines(lines, above).reverse()) {
          items.push(partItem(linePart(line, width), style.color, settings));
        }
      }
      // Thin running lines have no area to hide anything.
      above = unite(above, outline);
    }
    if (shape.fill !== null && shape.fill.style.color !== null) {
      const subpaths = flattenSvgPath(shape.fill.d, tolerance, shape.transform);
      const region = clipped(unionRings(subpaths.map((subpath) => subpath.points), shape.fill.style.rule));
      for (const island of islands(subtract(region, above)).reverse()) {
        items.push(fillItem({ kind: "fill", rings: island }, shape.fill.style.color, settings));
      }
      above = unite(above, region);
    }
  }
  return items.reverse();
}

/**
 * Fills and satin first, running strokes last. Within each, the next block is the nearest one
 * of the current color, or of any color once the current color is done.
 */
function orderItems<C>(items: Item<C>[], start: Point2 | null): PlannedBlock<C>[] {
  const blocks: PlannedBlock<C>[] = [];
  let position: Point2 | null = start;
  let color: C | null = null;
  for (const layer of [0, 1]) {
    const pool = items.filter((item) => item.layer === layer);
    while (pool.length > 0) {
      const sameColor = pool.filter((item) => item.color === color);
      const candidates = sameColor.length > 0 ? sameColor : pool;
      const from: Point2 | null = position;
      const item: Item<C> =
        from === null
          ? candidates[0]
          : candidates.reduce((best, candidate) =>
              distance(candidate.starts[nearest(candidate.starts, from)], from) <
              distance(best.starts[nearest(best.starts, from)], from)
                ? candidate
                : best
            );
      pool.splice(pool.indexOf(item), 1);
      const stitches: Stitch[] = item.stitch(from);
      if (stitches.length === 0) continue;
      blocks.push({ stitches, thread: item.color, part: item.part });
      const [x, y] = stitches[stitches.length - 1];
      position = { x, y };
      color = item.color;
    }
  }
  return blocks;
}

/** Stitches the visible parts of `shapes`, grouped by color. `flattenTolerance` in mm. */
export function planStitches(
  shapes: SvgShape[],
  settings: ThreadStitchSettings,
  flattenTolerance: number,
): PlannedBlock[] {
  return orderItems(visibleItems(shapes, settings, flattenTolerance * UNITS_PER_MM), null);
}

/** Stitches every part of `zone`, in the same order rules as `planStitches`, starting near `from`. */
export function planZone(
  zone: ZonePart[],
  settings: ThreadStitchSettings,
  from: Point2 | null,
): PlannedBlock<null>[] {
  return orderItems(zone.map((part) => partItem(part, null, settings)), from);
}
