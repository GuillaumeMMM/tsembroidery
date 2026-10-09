import { EmbConstant } from "../constants.js";
import { EmbPattern } from "../pattern.js";
import { EmbThread } from "../thread.js";
import {
  resolveFlattenTolerance,
  resolveStitchSettings,
} from "../svg/pathData.js";
import { normalizeSvg } from "../svg/normalize.js";
import { planStitches } from "../svg/plan.js";
import { splitRuns, tie } from "../svg/zone.js";
import type {
  StitchZone,
  SvgReadSettings,
  SvgStitchKind,
  SvgThreadInfo,
  ThreadStitchSettings,
  ZonePart,
  ZonePoint,
} from "../svg/types.js";

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

/** Box around the stitches; extents() would also count the first color break, left at (0, 0). */
function stitchExtents(pattern: EmbPattern) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y, command] of pattern.stitches) {
    if (command !== EmbConstant.STITCH) continue;
    [minX, minY] = [Math.min(minX, x), Math.min(minY, y)];
    [maxX, maxY] = [Math.max(maxX, x), Math.max(maxY, y)];
  }
  return { minX, minY, maxX, maxY };
}

type PointMap = (point: ZonePoint) => ZonePoint;

/**
 * Shrinks and moves the stitches, if needed, so they stay inside the `limit`×`limit` square at the origin.
 * Returns the scale and the point mapping applied.
 */
function fitInto(
  pattern: EmbPattern,
  limit: number,
): { scale: number; map: PointMap } {
  const { minX, minY, maxX, maxY } = stitchExtents(pattern);
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
  return {
    scale,
    map: ({ x, y }) => ({ x: nx + (x - cx) * scale, y: ny + (y - cy) * scale }),
  };
}

/** A copy of `zone` with every point mapped and satin widths scaled. */
function mapZone(zone: StitchZone, map: PointMap, scale: number): StitchZone {
  return zone.map((part): ZonePart => {
    if (part.kind === "fill")
      return { kind: "fill", rings: part.rings.map((ring) => ring.map(map)) };
    const points = part.points.map(map);
    return part.kind === "satin"
      ? { ...part, points, width: part.width * scale }
      : { ...part, points };
  });
}

const KINDS: SvgStitchKind[] = ["fill", "satin", "running"];

/** One `threadlist` entry: consecutive blocks of a thread. */
interface Entry {
  thread: EmbThread;
  parts: ZonePart[];
}

/** Sets `thread.extras.svg` on the thread of every entry. */
function recordThreads(
  entries: Entry[],
  settings: ThreadStitchSettings,
  map: PointMap,
  scale: number,
): void {
  for (const { thread, parts } of entries) {
    const kinds = new Set(parts.map((part) => part.kind));
    const info: SvgThreadInfo = {
      kinds: KINDS.filter((kind) => kinds.has(kind)),
      settings: { ...settings },
      zone: mapZone(parts, map, scale),
    };
    thread.extras.svg = info;
  }
}

/** A thread with the same color and details as `thread`, and its own extras. */
function cloneThread(thread: EmbThread): EmbThread {
  return Object.assign(new EmbThread(), thread, { extras: {} });
}

/** Stitches the SVG in the coordinates of the `size` square at the origin. */
export function stitchSvg(
  input: SvgInput,
  settings: SvgReadSettings = {},
): SvgReadResult {
  const stitchSettings = resolveStitchSettings({
    runningStitchLength: settings.runningStitchLength,
    fillStitchLength: settings.fillStitchLength,
    rowSpacing: settings.rowSpacing,
    pullCompensation: settings.pullCompensation,
    underlay: settings.underlay,
    fillAngle: settings.fillAngle,
    tieStitches: settings.tieStitches,
  });
  const flattenTolerance = resolveFlattenTolerance(settings.flattenTolerance);
  const normalized = normalizeSvg(decodeSvgInput(input), settings);
  const warnings = [...new Set(normalized.warnings)];
  const fit = settings.fit ?? true;
  const pattern = new EmbPattern();
  const planned = planStitches(
    normalized.shapes,
    stitchSettings,
    flattenTolerance,
  );

  // A color stitched again after other colors gets a thread object of its own, so each
  // threadlist entry has its own extras.
  const entries: Entry[] = [];
  const used = new Set<EmbThread>();
  let source: EmbThread | null = null;
  for (const { stitches, thread, part } of planned) {
    // Each run between jumps becomes its own block, so the thread is trimmed before every jump.
    const runs = splitRuns(stitches);
    if (runs.length === 0) continue;
    if (thread !== source) {
      entries.push({
        thread: used.has(thread) ? cloneThread(thread) : thread,
        parts: [],
      });
      used.add(thread);
      source = thread;
    }
    const entry = entries[entries.length - 1];
    entry.parts.push(part);
    for (const run of runs)
      pattern.addStitchblock([tie(run, stitchSettings.tieStitches), entry.thread]);
  }
  if (entries.length === 0) return { pattern, warnings };

  // Ends like any other block, with a trim.
  const [x, y] = pattern.stitches[pattern.stitches.length - 1];
  pattern.addCommand(EmbConstant.SEQUENCE_BREAK, x, y);
  const { scale, map } = fit
    ? fitInto(pattern, normalized.viewport.targetSize)
    : { scale: 1, map: (point: ZonePoint) => ({ ...point }) };
  recordThreads(entries, stitchSettings, map, scale);
  return { pattern, warnings };
}

/**
 * Fills become tatami and strokes running or satin stitches; hidden parts are dropped and colors grouped.
 * The stitches are centered on (0, 0), where the needle starts.
 */
export function readSvg(
  input: SvgInput,
  settings: SvgReadSettings = {},
): SvgReadResult {
  const result = stitchSvg(input, settings);
  const { pattern } = result;
  if (pattern.stitches.length > 0) {
    const { minX, minY, maxX, maxY } = stitchExtents(pattern);
    const [dx, dy] = [-(minX + maxX) / 2, -(minY + maxY) / 2];
    pattern.translate(dx, dy);
    // The zones move with the stitches.
    const move = ({ x, y }: ZonePoint) => ({ x: x + dx, y: y + dy });
    for (const thread of new Set(pattern.threadlist)) {
      const info = thread.extras.svg;
      if (info) info.zone = mapZone(info.zone, move, 1);
    }
  }
  return result;
}

export type { NormalizedSvg, SvgShape, SvgViewport } from "../svg/types.js";
