import { type Matrix } from "../matrix.js";
import { parseNumberList, parseSvgLength } from "./numbers.js";
import { svgMatrix } from "./transform.js";
import type { SvgViewport } from "./types.js";

const ALIGNMENT: Record<string, number> = { Min: 0, Mid: 0.5, Max: 1 };

function viewportMatrix(
  x: number,
  y: number,
  width: number,
  height: number,
  targetSize: number,
  preserveAspectRatio: string
): Matrix {
  const [align, meetOrSlice] = preserveAspectRatio.trim().split(/\s+/);
  const scaleX = targetSize / width;
  const scaleY = targetSize / height;
  if (align === "none") {
    return svgMatrix(scaleX, 0, 0, scaleY, -x * scaleX, -y * scaleY);
  }

  // Invalid values fall back to xMidYMid.
  const [, alignX = "Mid", alignY = "Mid"] = align.match(/^x(Min|Mid|Max)Y(Min|Mid|Max)$/) ?? [];
  const scale = meetOrSlice === "slice" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  return svgMatrix(
    scale,
    0,
    0,
    scale,
    (targetSize - width * scale) * ALIGNMENT[alignX] - x * scale,
    (targetSize - height * scale) * ALIGNMENT[alignY] - y * scale
  );
}

export function normalizeSvgViewport(
  root: Element,
  targetSize = 1000,
  preserveAspectRatio = "xMidYMid meet"
): SvgViewport {
  if (!Number.isFinite(targetSize) || targetSize <= 0) {
    throw new RangeError("SVG size must be a positive finite number");
  }

  const viewBox = root.getAttribute("viewBox");
  let x = 0;
  let y = 0;
  let width: number;
  let height: number;
  if (viewBox !== null) {
    const values = parseNumberList(viewBox, "viewBox");
    if (values.length !== 4) throw new Error("SVG viewBox requires four numbers");
    [x, y, width, height] = values;
  } else {
    width = parseSvgLength(root.getAttribute("width")) ?? 300;
    height = parseSvgLength(root.getAttribute("height")) ?? 150;
  }
  if (width <= 0 || height <= 0) {
    throw new Error("SVG viewport must have positive dimensions");
  }

  return {
    sourceX: x,
    sourceY: y,
    sourceWidth: width,
    sourceHeight: height,
    targetSize,
    preserveAspectRatio,
    transform: viewportMatrix(x, y, width, height, targetSize, preserveAspectRatio),
  };
}
