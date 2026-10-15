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

const CELL = 100;
const MAX_CELLS = 1024;

interface Covers {
  list: Cover[];
  cells: Map<string, number[]>;
  wide: number[];
}

function cellRange(box: Box): [number, number, number, number] {
  return [
    Math.floor((box.minX - MARGIN) / CELL),
    Math.floor((box.minY - MARGIN) / CELL),
    Math.floor((box.maxX + MARGIN) / CELL),
    Math.floor((box.maxY + MARGIN) / CELL),
  ];
}

function covering(covers: Covers, points: Point2[]): Ring[] {
  if (points.length === 0) return [];
  const box = bounds(points);
  const [x0, y0, x1, y1] = cellRange(box);
  const found = new Set<number>(covers.wide);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) covers.list.forEach((_, index) => found.add(index));
  else {
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (const index of covers.cells.get(`${x},${y}`) ?? []) found.add(index);
      }
    }
  }
  return [...found]
    .sort((a, b) => a - b)
    .filter((index) => overlaps(covers.list[index].box, box))
    .flatMap((index) => covers.list[index].rings);
}

function uncovered(covers: Covers, region: Ring[]): Ring[] {
  return covers.list.length === 0 ? region : subtract(region, covering(covers, region.flat()));
}

function addCover(covers: Covers, region: Ring[]): void {
  if (region.length === 0) return;
  const box = bounds(region.flat());
  const index = covers.list.push({ rings: region, box }) - 1;
  const [x0, y0, x1, y1] = cellRange(box);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
    covers.wide.push(index);
    return;
  }
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const key = `${x},${y}`;
      const cell = covers.cells.get(key);
      if (cell === undefined) covers.cells.set(key, [index]);
      else cell.push(index);
    }
  }
}

/** Removes what clip paths and later shapes hide, as SVG paints them. Returns items in document order. */
function visibleItems(
  shapes: SvgShape[],
  settings: ThreadStitchSettings,
  tolerance: number,
): Item<EmbThread>[] {
  const items: Item<EmbThread>[] = [];
  const above: Covers = { list: [], cells: new Map(), wide: [] };
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
        for (const line of (above.list.length === 0 ? lines : clipLines(lines, covering(above, lines.flatMap((line) => line.points)))).reverse()) {
          items.push(partItem(linePart(line, width), style.color, settings));
        }
      }
      // Thin running lines have no area to hide anything.
      addCover(above, outline);
    }
    if (shape.fill !== null && shape.fill.style.color !== null) {
      const subpaths = flattenSvgPath(shape.fill.d, tolerance, shape.transform);
      const region = clipped(unionRings(subpaths.map((subpath) => subpath.points), shape.fill.style.rule));
      for (const island of islands(uncovered(above, region)).reverse()) {
        items.push(fillItem({ kind: "fill", rings: island }, shape.fill.style.color, settings));
      }
      addCover(above, region);
    }
  }
  return items.reverse();
}

const GRID = 50;

interface Finder<C> {
  next(from: Point2 | null): Item<C>;
  take(item: Item<C>): void;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}

function cellOf(point: Point2): [number, number] {
  return [Math.floor(point.x / GRID), Math.floor(point.y / GRID)];
}

function nearestFinder<C>(items: Item<C>[]): Finder<C> {
  const rank = new Map(items.map((item, index) => [item, index]));
  const alive = new Set(items);
  const cells = new Map<string, Item<C>[]>();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const item of items) {
    for (const point of item.starts) {
      const [cx, cy] = cellOf(point);
      [x0, y0, x1, y1] = [Math.min(x0, cx), Math.min(y0, cy), Math.max(x1, cx), Math.max(y1, cy)];
      const key = `${cx},${cy}`;
      const cell = cells.get(key);
      if (cell === undefined) cells.set(key, [item]);
      else if (cell[cell.length - 1] !== item) cell.push(item);
    }
  }
  return {
    next(from) {
      if (from === null) return items.find((item) => alive.has(item))!;
      const [fx, fy] = cellOf(from);
      const seen = new Set<Item<C>>();
      let best: Item<C> | null = null;
      let bestDistance = Infinity;
      for (let r = 0; ; r += 1) {
        if (best !== null && bestDistance < (r - 1) * GRID) break;
        for (let cx = Math.max(fx - r, x0); cx <= Math.min(fx + r, x1); cx += 1) {
          const edge = cx === fx - r || cx === fx + r;
          const rows = edge ? range(Math.max(fy - r, y0), Math.min(fy + r, y1)) : [fy - r, fy + r].filter((cy) => cy >= y0 && cy <= y1);
          for (const cy of rows) {
            for (const item of cells.get(`${cx},${cy}`) ?? []) {
              if (!alive.has(item) || seen.has(item)) continue;
              seen.add(item);
              const d = distance(item.starts[nearest(item.starts, from)], from);
              if (d < bestDistance || (d === bestDistance && rank.get(item)! < rank.get(best!)!)) [best, bestDistance] = [item, d];
            }
          }
        }
        if (fx - r <= x0 && fx + r >= x1 && fy - r <= y0 && fy + r >= y1) break;
      }
      return best ?? items.find((item) => alive.has(item))!;
    },
    take(item) {
      alive.delete(item);
    },
  };
}

function queueFinder<C>(queue: Item<C>[]): Finder<C> {
  let index = 0;
  return { next: () => queue[index++], take: () => {} };
}

interface Run<C> {
  blocks: PlannedBlock<C>[];
  travel: number;
}

function stitchRun<C>(items: Item<C>[], start: Point2 | null, finder: Finder<C>): Run<C> {
  const run: Run<C> = { blocks: [], travel: 0 };
  let position = start;
  for (let left = items.length; left > 0; left -= 1) {
    const item = finder.next(position);
    finder.take(item);
    const stitches = item.stitch(position);
    if (stitches.length === 0) continue;
    if (position !== null) run.travel += distance(position, { x: stitches[0][0], y: stitches[0][1] });
    run.blocks.push({ stitches, thread: item.color, part: item.part });
    const [x, y] = stitches[stitches.length - 1];
    position = { x, y };
  }
  return run;
}

function shortenAll(points: Point2[], start: Point2 | null): number[] {
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

const EXACT_LIMIT = 3000;
const NEIGHBORS = 10;

function neighbors(points: Point2[]): number[][] {
  const cells = new Map<string, number[]>();
  points.forEach((point, index) => {
    const key = cellOf(point).join(",");
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, [index]);
    else cell.push(index);
  });
  return points.map((point, index) => {
    const [fx, fy] = cellOf(point);
    const found: [number, number][] = [];
    for (let r = 0; found.length < points.length - 1; r += 1) {
      for (let cx = fx - r; cx <= fx + r; cx += 1) {
        const edge = cx === fx - r || cx === fx + r;
        for (const cy of edge ? range(fy - r, fy + r) : [fy - r, fy + r]) {
          for (const other of cells.get(`${cx},${cy}`) ?? []) {
            if (other !== index) found.push([distance(point, points[other]), other]);
          }
        }
      }
      found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (found.length >= NEIGHBORS && found[NEIGHBORS - 1][0] < r * GRID) break;
    }
    return found.slice(0, NEIGHBORS).map(([, other]) => other);
  });
}

function shortenNear(points: Point2[], start: Point2 | null): number[] {
  const order = points.map((_, index) => index);
  const position = order.slice();
  const near = neighbors(points);
  const toStart =
    start === null
      ? []
      : order
          .slice()
          .sort((a, b) => distance(points[a], start) - distance(points[b], start) || a - b)
          .slice(0, NEIGHBORS);
  const at = (k: number) => (k < 0 ? start : k >= order.length ? null : points[order[k]]);
  const gap = (a: Point2 | null, b: Point2 | null) => (a === null || b === null ? 0 : distance(a, b));
  const tryMove = (i: number, j: number): boolean => {
    if (i >= j) return false;
    const delta = gap(at(i - 1), at(j)) + gap(at(i), at(j + 1)) - gap(at(i - 1), at(i)) - gap(at(j), at(j + 1));
    if (delta >= -1e-9) return false;
    for (let a = i, b = j; a < b; a += 1, b -= 1) {
      [order[a], order[b]] = [order[b], order[a]];
      position[order[a]] = a;
      position[order[b]] = b;
    }
    return true;
  };
  for (let improved = true; improved; ) {
    improved = false;
    for (const other of toStart) if (tryMove(0, position[other])) improved = true;
    for (let p = 0; p < order.length; p += 1) {
      for (const other of near[order[p]]) {
        const q = position[other];
        if (q > p + 1 ? tryMove(p + 1, q) : q < p - 1 && tryMove(q + 1, p)) improved = true;
      }
    }
  }
  return order;
}

function shorten(points: Point2[], start: Point2 | null): number[] {
  return points.length <= EXACT_LIMIT ? shortenAll(points, start) : shortenNear(points, start);
}

function stitchColor<C>(items: Item<C>[], start: Point2 | null): PlannedBlock<C>[] {
  const greedy = stitchRun(items, start, nearestFinder(items));
  if (greedy.blocks.length < 3) return greedy.blocks;
  const middles = greedy.blocks.map(({ stitches }) => {
    const [first, last] = [stitches[0], stitches[stitches.length - 1]];
    return { x: (first[0] + last[0]) / 2, y: (first[1] + last[1]) / 2 };
  });
  const order = shorten(middles, start);
  if (order.every((index, position) => index === position)) return greedy.blocks;
  const byPart = new Map(items.map((item) => [item.part, item]));
  const queue = order.map((index) => byPart.get(greedy.blocks[index].part)!);
  const shorter = stitchRun(queue, start, queueFinder(queue));
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
    const finder = nearestFinder(pool);
    while (pool.length > 0) {
      const { color } = finder.next(position);
      const group = pool.filter((item) => item.color === color);
      group.forEach((item) => finder.take(item));
      const stitched = stitchColor(group, position);
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
