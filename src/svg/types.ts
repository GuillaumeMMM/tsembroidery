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

export interface SvgReadSettings {
  /** Edge of the square the SVG is fitted into, in mm. Default 100 (a 10×10 cm hoop). */
  size?: number;
  /** How the viewBox fits the square, as in SVG. Default "xMidYMid meet". */
  preserveAspectRatio?: string;
  /** Max running stitch length, in mm. Default 2.5. */
  stitchLength?: number;
  /** Maximum error when turning curves into lines, in mm. Default 0.05. */
  flattenTolerance?: number;
  /** First layer under fills (sparse rows across) and satin (center walk). Default true. */
  underlay?: boolean;
  /** Widens fills and satin so fabric pulling in doesn't open gaps, in mm. Default 0.2. */
  pullCompensation?: number;
  /** Distance between parallel stitches in fills and satin, in mm. Default 0.4. */
  rowSpacing?: number;
  /** Colors closer than this (red-mean distance, 0-765) share one thread. Default 10; 0 merges exact matches only. */
  colorTolerance?: number;
  /** Maximum nesting of `<use>` references. Default 32. */
  maxUseDepth?: number;
  /** Maximum number of expanded `<use>` references. Default 10000. */
  maxUseInstances?: number;
  /** Called for each part of the SVG that is skipped or unsupported. */
  onWarning?: (message: string) => void;
}

export interface NormalizedSvg {
  viewport: SvgViewport;
  shapes: SvgShape[];
  warnings: string[];
}
