import { EmbConstant } from "../constants.js";
import type { Stitch } from "../pattern.js";
import { UNITS_PER_MM } from "./numbers.js";
import { resample, type PathStitchOptions, type Point2 } from "./pathData.js";
import { clipLines, offsetRegion, type Ring } from "./geometry.js";

export interface Rows {
  /** Row direction in degrees. */
  angle: number;
  spacing: number;
}

/** Sparse rows across the fill, to hold the fabric before it. */
const UNDERLAY_ROWS: Rows = { angle: -45, spacing: 2 * UNITS_PER_MM };
const UNDERLAY_INSET = 0.5 * UNITS_PER_MM;
const MAX_STITCH = 3 * UNITS_PER_MM;
const MIN_STITCH = 0.5 * UNITS_PER_MM;
const STAGGERS = 4;

interface Crossing extends Point2 {
  id: number;
  row: number;
}

/** One row of a section, with `a` left of `b`. */
interface Segment {
  row: number;
  a: Crossing;
  b: Crossing;
}

type Section = Segment[];

type Graph = [neighbor: number, weight: number][][];

/** Scanline crossings (rows on a global grid) and a travel graph of outline edges plus row lines. */
function buildRows(rings: Point2[][], spacing: number): { segments: Segment[][]; graph: Graph; nodes: Point2[] } {
  const nodes: Point2[] = [];
  const graph: Graph = [];
  const addNode = (point: Point2): number => {
    nodes.push(point);
    graph.push([]);
    return nodes.length - 1;
  };
  const link = (a: number, b: number): void => {
    const weight = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
    graph[a].push([b, weight]);
    graph[b].push([a, weight]);
  };

  const rows = new Map<number, Crossing[]>();
  for (const ring of rings) {
    const ringNodes: number[] = [];
    ring.forEach((p, index) => {
      ringNodes.push(addNode(p));
      const q = ring[(index + 1) % ring.length];
      if (p.y === q.y) return;
      const low = Math.min(p.y, q.y);
      const high = Math.max(p.y, q.y);
      const edgeCrossings: (Crossing & { t: number })[] = [];
      // Half-open [low, high) so a row through a vertex is counted once.
      for (let row = Math.ceil(low / spacing - 0.5); (row + 0.5) * spacing < high; row += 1) {
        const y = (row + 0.5) * spacing;
        if (y < low) continue;
        const t = (y - p.y) / (q.y - p.y);
        const crossing = { x: p.x + t * (q.x - p.x), y, row, t, id: -1 };
        crossing.id = addNode(crossing);
        edgeCrossings.push(crossing);
        if (!rows.has(row)) rows.set(row, []);
        rows.get(row)!.push(crossing);
      }
      edgeCrossings.sort((c1, c2) => c1.t - c2.t).forEach((crossing) => ringNodes.push(crossing.id));
    });
    ringNodes.forEach((node, index) => link(node, ringNodes[(index + 1) % ringNodes.length]));
  }

  const segments = [...rows.keys()].sort((r1, r2) => r1 - r2).map((row) => {
    const crossings = rows.get(row)!.sort((c1, c2) => c1.x - c2.x);
    const rowSegments: Segment[] = [];
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const [a, b] = [crossings[index], crossings[index + 1]];
      link(a.id, b.id);
      rowSegments.push({ row, a, b });
    }
    return rowSegments;
  });
  return { segments, graph, nodes };
}

/** Groups rows into sections that can be stitched back and forth without leaving them. */
function buildSections(rows: Segment[][]): Section[] {
  const sections: Section[] = [];
  let previous: { segment: Segment; section: Section }[] = [];
  for (const row of rows) {
    const current: { segment: Segment; section: Section }[] = [];
    const overlaps = (s: Segment, t: Segment) =>
      Math.abs(s.row - t.row) === 1 && s.a.x < t.b.x && t.a.x < s.b.x;
    for (const segment of row) {
      const above = previous.filter((entry) => overlaps(entry.segment, segment));
      const unique =
        above.length === 1 && row.filter((other) => overlaps(above[0].segment, other)).length === 1;
      const section = unique ? above[0].section : [];
      if (!unique) sections.push(section);
      section.push(segment);
      current.push({ segment, section });
    }
    previous = current;
  }
  return sections;
}

function shortestPaths(graph: Graph, source: number): { distance: Float64Array; previous: Int32Array } {
  const distance = new Float64Array(graph.length).fill(Infinity);
  const previous = new Int32Array(graph.length).fill(-1);
  const heap: [number, number][] = [[0, source]];
  distance[source] = 0;
  const swap = (i: number, j: number) => ([heap[i], heap[j]] = [heap[j], heap[i]]);
  while (heap.length > 0) {
    const [cost, node] = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    if (cost > distance[node]) continue;
    for (const [next, weight] of graph[node]) {
      const candidate = cost + weight;
      if (candidate >= distance[next]) continue;
      distance[next] = candidate;
      previous[next] = node;
      heap.push([candidate, next]);
      for (let i = heap.length - 1; i > 0; ) {
        const parent = (i - 1) >> 1;
        if (heap[parent][0] <= heap[i][0]) break;
        swap(i, parent);
        i = parent;
      }
    }
  }
  return { distance, previous };
}

/** Needle points along a row, on a staggered global grid so no lines form across rows. */
function rowPoints(row: number, from: number, to: number, y: number): Point2[] {
  const offset = ((((row % STAGGERS) + STAGGERS) % STAGGERS) / STAGGERS) * MAX_STITCH;
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const grid: number[] = [];
  for (let k = Math.ceil((low + MIN_STITCH - offset) / MAX_STITCH); k * MAX_STITCH + offset <= high - MIN_STITCH; k += 1) {
    grid.push(k * MAX_STITCH + offset);
  }
  if (to < from) grid.reverse();
  return [from, ...grid, to].map((x) => ({ x, y }));
}

function entries(section: Section): Crossing[] {
  const first = section[0];
  const last = section[section.length - 1];
  return [first.a, first.b, last.a, last.b];
}

function stitchSection(section: Section, entry: Crossing, out: Point2[]): Crossing {
  const forward = entry === section[0].a || entry === section[0].b;
  const rows = forward ? section : [...section].reverse();
  let fromA = entry === rows[0].a;
  let exit = entry;
  for (const segment of rows) {
    const [start, end] = fromA ? [segment.a, segment.b] : [segment.b, segment.a];
    appendLine(out, [start], MAX_STITCH);
    out.push(...rowPoints(segment.row, start.x, end.x, start.y).slice(1));
    exit = end;
    fromA = !fromA;
  }
  return exit;
}

function appendLine(out: Point2[], points: Point2[], maxLength: number): void {
  if (out.length === 0) {
    out.push(points[0]);
    points = points.slice(1);
  }
  if (points.length === 0) return;
  out.push(...resample([out[out.length - 1], ...points], false, maxLength).slice(1));
}

/** Tatami of `region`, section by section, travelling inside the shape between them. Starts near `from`. */
export function tatami(
  region: Ring[],
  travelLength: number,
  from: Point2 | null = null,
  { angle, spacing }: Rows
): Stitch[] {
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const toRowSpace = (p: Point2): Point2 => ({ x: p.x * cos + p.y * sin, y: p.y * cos - p.x * sin });
  const fromRowSpace = (p: Point2): Point2 => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  const rings = region.map((ring) => ring.map(toRowSpace));
  const { segments, graph, nodes } = buildRows(rings, spacing);
  const sections = buildSections(segments);
  if (sections.length === 0) return [];

  const stitches: Stitch[] = [];
  const emit = (points: Point2[], command: number) => {
    for (const point of points) {
      const { x, y } = fromRowSpace(point);
      stitches.push([x, y, command]);
    }
  };
  const nearestEntry = (point: Point2, candidates: Iterable<Section>) =>
    [...candidates]
      .flatMap((section) => entries(section).map((crossing) => [section, crossing] as const))
      .reduce((closest, pair) =>
        Math.hypot(pair[1].x - point.x, pair[1].y - point.y) <
        Math.hypot(closest[1].x - point.x, closest[1].y - point.y)
          ? pair
          : closest
      );

  const remaining = new Set(sections);
  let current: Crossing | null = null;
  while (remaining.size > 0) {
    // `out` starts at the needle's current position, which is already stitched.
    const out: Point2[] = current === null ? [] : [current];
    let alreadyStitched = out.length;
    let section: Section;
    let entry: Crossing;
    if (current === null) {
      [section, entry] = from === null ? [sections[0], sections[0][0].a] : nearestEntry(toRowSpace(from), sections);
    } else {
      const { distance, previous } = shortestPaths(graph, current.id);
      let best = Infinity;
      [section, entry] = [sections[0], sections[0][0].a];
      for (const candidate of remaining) {
        for (const crossing of entries(candidate)) {
          const cost = distance[crossing.id];
          if (cost < best) [best, section, entry] = [cost, candidate, crossing];
        }
      }
      if (Number.isFinite(best)) {
        const route: Point2[] = [];
        for (let node = entry.id; node !== -1; node = previous[node]) route.unshift(nodes[node]);
        appendLine(out, route, travelLength);
      } else {
        [section, entry] = nearestEntry(current, remaining);
        emit([entry], EmbConstant.JUMP);
        out.length = 0;
        out.push(entry);
        alreadyStitched = 0;
      }
    }
    current = stitchSection(section, entry, out);
    remaining.delete(section);
    emit(out.slice(alreadyStitched), EmbConstant.STITCH);
  }
  return stitches;
}

/** Underlay (inset, across the fill), then the fill grown by the pull compensation. */
export function fillStitches(
  region: Ring[],
  options: Required<PathStitchOptions>,
  from: Point2 | null = null
): Stitch[] {
  const travelLength = options.stitchLength * UNITS_PER_MM;
  const fillRegion = offsetRegion(region, options.pullCompensation * UNITS_PER_MM);
  const rows: Rows = { angle: 45, spacing: options.rowSpacing * UNITS_PER_MM };
  const underlay = options.underlay
    ? tatami(offsetRegion(region, -UNDERLAY_INSET), travelLength, from, UNDERLAY_ROWS)
    : [];
  if (underlay.length === 0) return tatami(fillRegion, travelLength, from, rows);

  const [x, y] = underlay[underlay.length - 1];
  const fill = tatami(fillRegion, travelLength, { x, y }, rows);
  if (fill.length === 0) return underlay;
  const start = { x: fill[0][0], y: fill[0][1] };
  // Stitch straight to the fill when that stays inside the shape, otherwise jump.
  const inside = clipLines([{ points: [{ x, y }, start], closed: false }], fillRegion).length === 0;
  const link: Stitch[] = inside
    ? resample([{ x, y }, start], false, MAX_STITCH).slice(1, -1).map((p) => [p.x, p.y, EmbConstant.STITCH])
    : [[start.x, start.y, EmbConstant.JUMP]];
  return [...underlay, ...link, ...fill];
}
