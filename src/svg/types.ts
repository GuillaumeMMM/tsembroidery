import type { EmbThread } from "../thread.js";
import type { Matrix } from "../matrix.js";

export interface SvgStrokeStyle {
  color: EmbThread;
  width: number;
  linecap: string;
  linejoin: string;
  dashArray: number[] | null;
  dashOffset: number;
}

export interface SvgFillStyle {
  color: EmbThread | null;
  rule: "nonzero" | "evenodd";
}

export interface SvgOutline {
  d: string;
  style: SvgStrokeStyle;
}

export interface SvgFill {
  d: string;
  style: SvgFillStyle;
}

/** One child of a `<clipPath>`, placed in pattern space by `transform`. */
export interface SvgClipPart {
  d: string;
  transform: Matrix;
  rule: "nonzero" | "evenodd";
}

export interface SvgShape {
  outline: SvgOutline | null;
  fill: SvgFill | null;
  transform: Matrix;
  sourceElement: string;
  /** The shape shows only where every list's union of parts overlaps. */
  clips: SvgClipPart[][];
}

export interface SvgViewport {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  targetSize: number;
  preserveAspectRatio: string;
  transform: Matrix;
}

/** A `DOMParser` class: the browser's, or one from a DOM library such as happy-dom. */
export type SvgDomParser = new () => {
  parseFromString(source: string, type: "image/svg+xml"): unknown;
};

/** How a thread's stitches are made: tatami fill, satin stroke, or running stitches along a thin stroke. */
export type SvgStitchKind = "fill" | "satin" | "running";

/** The `readSvg` settings that shape a thread's stitches, as passed or defaulted. Lengths in mm. */
export interface ThreadStitchSettings {
  runningStitchLength: number;
  fillStitchLength: number;
  rowSpacing: number;
  pullCompensation: number;
  underlay: boolean;
  fillAngle: number;
  tieStitches: number;
  minStitchLength: number;
}

/** A point in pattern units (0.1 mm). */
export interface ZonePoint {
  x: number;
  y: number;
}

/** One part of a zone, in pattern units (0.1 mm). */
export type ZonePart =
  /** Areas: outer rings and holes, in any order or direction. */
  | { kind: "fill"; rings: ZonePoint[][] }
  /** A satin column along `points`, `width` across before pull compensation. Below 1 mm, running stitches. */
  | { kind: "satin"; points: ZonePoint[]; closed: boolean; width: number }
  | { kind: "running"; points: ZonePoint[]; closed: boolean };

/** What a thread covers, as plain data: `stitchZone` stitches it with any settings. */
export type StitchZone = ZonePart[];

/** What `readSvg` stitched with a thread, in `thread.extras.svg`. */
export interface SvgThreadInfo {
  /** Every kind of stitch in this thread. */
  kinds: SvgStitchKind[];
  settings: ThreadStitchSettings;
  /** The visible parts this thread stitched, in the pattern's final coordinates. */
  zone: StitchZone;
}

export interface SvgReadSettings {
  /** Parses the SVG. Default: the global `DOMParser`, which browsers have and Node doesn't. */
  DOMParser?: SvgDomParser;
  /** Edge of the square the SVG is fitted into, in mm. Default 100 (a 10×10 cm hoop). */
  size?: number;
  /** How the viewBox fits the square, as in SVG. Default "xMidYMid meet". */
  preserveAspectRatio?: string;
  /** Longest stitch of running stitches (thin strokes, satin underlay, travel inside fills), in mm. Straight parts are split into equal stitches; corners and curves are kept. Default 2.5. */
  runningStitchLength?: number;
  /** Longest stitch in fill rows, in mm. Default 3. */
  fillStitchLength?: number;
  /** Maximum error when turning curves into lines, in mm. Default 0.05. */
  flattenTolerance?: number;
  /** First layer under fills (sparse rows across) and satin (center walk). Default true. */
  underlay?: boolean;
  /** Widens fills and satin so fabric pulling in doesn't open gaps, in mm. Default 0. */
  pullCompensation?: number;
  /** Distance between parallel stitches in fills and satin, in mm. Default 0.4. */
  rowSpacing?: number;
  /** Direction of fill rows, in degrees: 0 is horizontal, 90 vertical, measured clockwise in SVG coordinates (y down). Default 45. */
  fillAngle?: number;
  /** Colors closer than this (red-mean distance, 0-765) share one thread. Default 10; 0 merges exact matches only. */
  colorTolerance?: number;
  /** Shrinks and moves the stitches, if needed, so the design stays inside the `size` square: pull compensation, strokes on the edge and content outside the viewBox can overflow it. Default true. */
  fit?: boolean;
  /** Small back-and-forth stitches added wherever the thread is cut (both sides of jumps and color changes), so it holds. Default 0. */
  tieStitches?: number;
  /** Shortest stitch along lines, travel and inside fill rows, in mm: closer needle points merge into the next stitch. The ends of lines and rows stay exact, and satin is untouched. Default 0 (off). */
  minStitchLength?: number;
  /** Maximum nesting of `<use>` references. Default 32. */
  maxUseDepth?: number;
  /** Maximum number of expanded `<use>` references. Default 10000. */
  maxUseInstances?: number;
}

export interface NormalizedSvg {
  viewport: SvgViewport;
  shapes: SvgShape[];
  warnings: string[];
}
