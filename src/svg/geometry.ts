import {
  booleanOpDWithPolyTree,
  ClipperD,
  ClipType,
  differenceD,
  intersectD,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  PolyTreeD,
  unionD,
  type PathD,
  type PathsD,
  type PolyPathD,
} from "clipper2-ts";
import type { FlatPathSubpath, Point2 } from "./pathData.js";

export type Ring = Point2[];

/** Clipper rounds to this many decimals: 0.001 mm in pattern units. */
const PRECISION = 2;

function clean(paths: PathsD): Ring[] {
  return paths
    .map((path) =>
      path
        .filter((point, i) => {
          const next = path[(i + 1) % path.length];
          return point.x !== next.x || point.y !== next.y;
        })
        .map(({ x, y }) => ({ x, y }))
    )
    .filter((ring) => ring.length >= 3);
}

/** Resolves a fill rule into clean, non-overlapping outer and hole rings. */
export function unionRings(subpaths: Point2[][], rule: "nonzero" | "evenodd" = "nonzero"): Ring[] {
  const paths = subpaths.filter((points) => points.length >= 3);
  return clean(unionD(paths, [], rule === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero, PRECISION));
}

export function unite(a: Ring[], b: Ring[]): Ring[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return clean(unionD(a, b, FillRule.NonZero, PRECISION));
}

export function subtract(region: Ring[], cut: Ring[]): Ring[] {
  if (cut.length === 0 || region.length === 0) return region;
  return clean(differenceD(region, cut, FillRule.NonZero, PRECISION));
}

export function intersect(a: Ring[], b: Ring[]): Ring[] {
  if (a.length === 0 || b.length === 0) return [];
  return clean(intersectD(a, b, FillRule.NonZero, PRECISION));
}

/** Splits a region into separate islands, each an outline with its holes. */
export function islands(region: Ring[]): Ring[][] {
  if (region.length === 0) return [];
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(ClipType.Union, region, null, tree, FillRule.NonZero, PRECISION);
  const result: Ring[][] = [];
  const visit = (node: PolyPathD): void => {
    for (let i = 0; i < node.count; i += 1) {
      const outer = node.child(i);
      const holes = Array.from({ length: outer.count }, (_, j) => outer.child(j));
      const island = clean([outer.poly, ...holes.map((hole) => hole.poly)].filter((path): path is PathD => path !== null));
      if (island.length > 0) result.push(island);
      // Islands nested inside holes.
      holes.forEach(visit);
    }
  };
  visit(tree);
  return result;
}

/** Grows (positive `delta`) or shrinks the region, keeping corners sharp. */
export function offsetRegion(region: Ring[], delta: number): Ring[] {
  if (delta === 0 || region.length === 0) return region;
  return clean(inflatePathsD(region, delta, JoinType.Miter, EndType.Polygon, 2, PRECISION));
}

const JOINS: Record<string, JoinType> = { round: JoinType.Round, bevel: JoinType.Bevel };
const CAPS: Record<string, EndType> = { round: EndType.Round, square: EndType.Square };

export function strokeOutline(
  lines: FlatPathSubpath[],
  width: number,
  linecap: string,
  linejoin: string
): Ring[] {
  const join = JOINS[linejoin] ?? JoinType.Miter;
  const inflate = (subpaths: FlatPathSubpath[], end: EndType): PathsD =>
    subpaths.length === 0
      ? []
      : inflatePathsD(subpaths.map((line) => line.points), width / 2, join, end, 4, PRECISION);
  return unite(
    clean(inflate(lines.filter((line) => line.closed), EndType.Joined)),
    clean(inflate(lines.filter((line) => !line.closed), CAPS[linecap] ?? EndType.Butt))
  );
}

/** The parts of each line outside `region`. */
export function clipLines(lines: FlatPathSubpath[], region: Ring[]): FlatPathSubpath[] {
  return region.length === 0 ? lines : splitLines(lines, region, ClipType.Difference);
}

/** The parts of each line inside `region`. */
export function linesInside(lines: FlatPathSubpath[], region: Ring[]): FlatPathSubpath[] {
  return region.length === 0 ? [] : splitLines(lines, region, ClipType.Intersection);
}

function splitLines(lines: FlatPathSubpath[], region: Ring[], clipType: ClipType): FlatPathSubpath[] {
  const clipper = new ClipperD(PRECISION);
  clipper.addOpenSubjectPaths(lines.map((line) => (line.closed ? [...line.points, line.points[0]] : line.points)));
  clipper.addClipPaths(region);
  const closed: PathsD = [];
  const open: PathsD = [];
  clipper.execute(clipType, FillRule.NonZero, closed, open);
  return open
    .filter((path) => path.length >= 2)
    .map((path) => {
      const [first, last] = [path[0], path[path.length - 1]];
      // An uncut closed line comes back as a loop.
      return first.x === last.x && first.y === last.y && path.length > 2
        ? { points: path.slice(0, -1).map(({ x, y }) => ({ x, y })), closed: true }
        : { points: path.map(({ x, y }) => ({ x, y })), closed: false };
    });
}
