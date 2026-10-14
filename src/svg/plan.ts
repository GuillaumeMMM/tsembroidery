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

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Cover {
  rings: Ring[];
  box: Box;
}

function bounds(points: Point2[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { x, y } of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

const MARGIN = 1;

function overlaps(a: Box, b: Box): boolean {
  return (
    a.minX <= b.maxX + MARGIN &&
    b.minX <= a.maxX + MARGIN &&
    a.minY <= b.maxY + MARGIN &&
    b.minY <= a.maxY + MARGIN
  );
}

function covering(covers: Cover[], points: Point2[]): Ring[] {
  if (points.length === 0) return [];
  const box = bounds(points);
  return covers.filter((cover) => overlaps(cover.box, box)).flatMap((cover) => cover.rings);
}

function uncovered(covers: Cover[], region: Ring[]): Ring[] {
  return covers.length === 0 ? region : subtract(region, covering(covers, region.flat()));
}

function addCover(covers: Cover[], region: Ring[]): Cover[] {
  if (region.length === 0) return covers;
  const box = bounds(region.flat());
  const touching = covers.filter((cover) => overlaps(cover.box, box));
  const rings = unite(touching.flatMap((cover) => cover.rings), region);
  return [...covers.filter((cover) => !touching.includes(cover)), { rings, box: bounds(rings.flat()) }];
}

/** Removes what clip paths and later shapes hide, as SVG paints them. Returns items in document order. */
function visibleItems(
  shapes: SvgShape[],
  settings: ThreadStitchSettings,
  tolerance: number,
): Item<EmbThread>[] {
  const items: Item<EmbThread>[] = [];
  let above: Cover[] = [];
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
        for (const island of islands(uncovered(above, outline)).reverse()) {
          items.push(fillItem({ kind: "fill", rings: island }, style.color, settings));
        }
      } else {
        for (const line of (above.length === 0 ? lines : clipLines(lines, covering(above, lines.flatMap((line) => line.points)))).reverse()) {
          items.push(partItem(linePart(line, width), style.color, settings));
        }
      }
      // Thin running lines have no area to hide anything.
      above = addCover(above, outline);
    }
    if (shape.fill !== null && shape.fill.style.color !== null) {
      const subpaths = flattenSvgPath(shape.fill.d, tolerance, shape.transform);
      const region = clipped(unionRings(subpaths.map((subpath) => subpath.points), shape.fill.style.rule));
      for (const island of islands(uncovered(above, region)).reverse()) {
        items.push(fillItem({ kind: "fill", rings: island }, shape.fill.style.color, settings));
      }
      above = addCover(above, region);
    }
  }
  return items.reverse();
}

function closest<C>(items: Item<C>[], from: Point2 | null): Item<C> {
  return from === null
    ? items[0]
    : items.reduce((best, candidate) =>
        distance(candidate.starts[nearest(candidate.starts, from)], from) <
        distance(best.starts[nearest(best.starts, from)], from)
          ? candidate
          : best
      );
}

interface Run<C> {
  blocks: PlannedBlock<C>[];
  travel: number;
}

function stitchRun<C>(items: Item<C>[], start: Point2 | null, next: (pool: Item<C>[], from: Point2 | null) => Item<C>): Run<C> {
  const run: Run<C> = { blocks: [], travel: 0 };
  const pool = [...items];
  let position = start;
  while (pool.length > 0) {
    const item = next(pool, position);
    pool.splice(pool.indexOf(item), 1);
    const stitches = item.stitch(position);
    if (stitches.length === 0) continue;
    if (position !== null) run.travel += distance(position, { x: stitches[0][0], y: stitches[0][1] });
    run.blocks.push({ stitches, thread: item.color, part: item.part });
    const [x, y] = stitches[stitches.length - 1];
    position = { x, y };
  }
  return run;
}

function shorten(points: Point2[], start: Point2 | null): number[] {
  const order = points.map((_, index) => index);
  const at = (k: number) => (k < 0 ? start : k >= order.length ? null : points[order[k]]);
  const gap = (a: Point2 | null, b: Point2 | null) => (a === null || b === null ? 0 : distance(a, b));
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < order.length - 1; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const delta = gap(at(i - 1), at(j)) + gap(at(i), at(j + 1)) - gap(at(i - 1), at(i)) - gap(at(j), at(j + 1));
        if (delta >= -1e-9) continue;
        order.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse());
        improved = true;
      }
    }
  }
  return order;
}

function stitchColor<C>(items: Item<C>[], start: Point2 | null): PlannedBlock<C>[] {
  const greedy = stitchRun(items, start, closest);
  if (greedy.blocks.length < 3) return greedy.blocks;
  const middles = greedy.blocks.map(({ stitches }) => {
    const [first, last] = [stitches[0], stitches[stitches.length - 1]];
    return { x: (first[0] + last[0]) / 2, y: (first[1] + last[1]) / 2 };
  });
  const order = shorten(middles, start);
  if (order.every((index, position) => index === position)) return greedy.blocks;
  const byPart = new Map(items.map((item) => [item.part, item]));
  const queue = order.map((index) => byPart.get(greedy.blocks[index].part)!);
  const shorter = stitchRun(queue, start, () => queue.shift()!);
  return shorter.travel < greedy.travel ? shorter.blocks : greedy.blocks;
}

/**
 * Fills and satin first, running strokes last. Within each, a color is stitched whole, its blocks
 * in the shortest order found, then the color of the nearest remaining block.
 */
function orderItems<C>(items: Item<C>[], start: Point2 | null): PlannedBlock<C>[] {
  const blocks: PlannedBlock<C>[] = [];
  let position: Point2 | null = start;
  for (const layer of [0, 1]) {
    let pool = items.filter((item) => item.layer === layer);
    while (pool.length > 0) {
      const { color } = closest(pool, position);
      const stitched = stitchColor(pool.filter((item) => item.color === color), position);
      pool = pool.filter((item) => item.color !== color);
      if (stitched.length === 0) continue;
      blocks.push(...stitched);
      const last = stitched[stitched.length - 1].stitches;
      const [x, y] = last[last.length - 1];
      position = { x, y };
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
