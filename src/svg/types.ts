import type { EmbThread } from "../thread.js";
import type { Matrix } from "../matrix.js";
import type { StitchBlock } from "../pattern.js";

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

export interface SvgShape {
  outline: SvgOutline | null;
  fill: SvgFill | null;
  transform: Matrix;
  sourceElement: string;
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
  /** Default "xMidYMid meet". */
  preserveAspectRatio?: string;
  /** Max running stitch length, in mm. Default 2.5. */
  stitchLength?: number;
  /** In mm. Default 0.05. */
  flattenTolerance?: number;
  /** Center-walk under satin strokes. Default true. */
  satinUnderlay?: boolean;
  /** Default 32. */
  maxUseDepth?: number;
  /** Default 10000. */
  maxUseInstances?: number;
  onWarning?: (message: string) => void;
}

export interface NormalizedSvg {
  viewport: SvgViewport;
  shapes: SvgShape[];
  warnings: string[];
}

export type SvgStitchResult = StitchBlock[];
