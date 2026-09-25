import { colord, extend } from "colord";
import namesPlugin from "colord/plugins/names";
import { EmbThread } from "../thread.js";
import { parseSvgLength } from "./numbers.js";
import type { SvgFillStyle, SvgStrokeStyle } from "./types.js";

extend([namesPlugin]);

const PRESENTATION_ATTRIBUTES = [
  "stroke",
  "fill",
  "color",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "fill-rule",
  "clip-rule",
  "opacity",
  "display",
  "visibility",
];

export interface SvgStyleState {
  stroke: EmbThread | null;
  fill: EmbThread | null;
  fillRule: "nonzero" | "evenodd";
  strokeWidth: number;
  linecap: string;
  linejoin: string;
  dashArray: number[] | null;
  dashOffset: number;
  color: EmbThread;
  opacity: number;
  display: boolean;
  visibility: boolean;
}

export function getDefaultSvgStyle(): SvgStyleState {
  const black = new EmbThread();
  black.setColor(0, 0, 0);
  return {
    stroke: null,
    fill: black,
    fillRule: "nonzero",
    strokeWidth: 1,
    linecap: "butt",
    linejoin: "miter",
    dashArray: null,
    dashOffset: 0,
    color: black,
    opacity: 1,
    display: true,
    visibility: true,
  };
}

/** `none` and fully transparent colors give null. */
export function parseSvgColor(value: string | null | undefined): EmbThread | null {
  if (value === null || value === undefined) return null;
  const color = colord(value.trim().toLowerCase());
  if (!color.isValid() || color.alpha() === 0) return null;
  const { r, g, b } = color.toRgb();
  const thread = new EmbThread();
  thread.setColor(r, g, b);
  return thread;
}

function applyProperty(style: SvgStyleState, property: string, value: string): void {
  const name = property.trim().toLowerCase();
  const text = value.trim();
  const keyword = text.toLowerCase();
  if (keyword === "inherit") return;
  switch (name) {
    case "stroke":
    case "fill":
      style[name] = keyword === "currentcolor" ? style.color : parseSvgColor(text);
      break;
    case "color":
      style.color = parseSvgColor(text) ?? style.color;
      break;
    case "stroke-width":
      style.strokeWidth = parseSvgLength(text) ?? style.strokeWidth;
      break;
    case "stroke-linecap":
      style.linecap = text;
      break;
    case "stroke-linejoin":
      style.linejoin = text;
      break;
    case "stroke-dashoffset":
      style.dashOffset = parseSvgLength(text) ?? style.dashOffset;
      break;
    case "stroke-dasharray": {
      const values = keyword === "none"
        ? []
        : text.split(/[\s,]+/).map(parseSvgLength).filter((item) => item !== null);
      style.dashArray = values.length > 0 ? values : null;
      break;
    }
    case "fill-rule":
    case "clip-rule":
      if (keyword === "evenodd" || keyword === "nonzero") style.fillRule = keyword;
      break;
    case "opacity": {
      const opacity = Number(text);
      if (Number.isFinite(opacity)) style.opacity *= Math.max(0, Math.min(1, opacity));
      break;
    }
    case "display":
      style.display = keyword !== "none";
      break;
    case "visibility":
      style.visibility = keyword !== "hidden" && keyword !== "collapse";
      break;
  }
}

export function applySvgStyle(
  element: Element,
  inherited: SvgStyleState
): SvgStyleState {
  const style = { ...inherited };
  for (const property of PRESENTATION_ATTRIBUTES) {
    const value = element.getAttribute(property);
    if (value !== null) applyProperty(style, property, value);
  }
  for (const declaration of element.getAttribute("style")?.split(";") ?? []) {
    const separator = declaration.indexOf(":");
    if (separator >= 0) {
      applyProperty(style, declaration.slice(0, separator), declaration.slice(separator + 1));
    }
  }
  return style;
}

export function getStrokeStyle(style: SvgStyleState): SvgStrokeStyle | null {
  if (style.stroke === null || style.strokeWidth <= 0) return null;
  return {
    color: style.stroke,
    width: style.strokeWidth,
    linecap: style.linecap,
    linejoin: style.linejoin,
    dashArray: style.dashArray,
    dashOffset: style.dashOffset,
  };
}

export function getFillStyle(style: SvgStyleState): SvgFillStyle {
  return { color: style.fill, rule: style.fillRule };
}
