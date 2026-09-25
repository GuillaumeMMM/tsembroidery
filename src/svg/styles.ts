import { colord, extend } from "colord";
import namesPlugin from "colord/plugins/names";
import { EmbThread } from "../thread.js";
import { matchingDeclarations, parseDeclarations, type CssRule, type Declaration } from "./css.js";
import { parseSvgLength } from "./numbers.js";
import type { SvgFillStyle, SvgStrokeStyle } from "./types.js";


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
  "clip-path",
  "opacity",
  "display",
  "visibility",
  "stop-color",
];

export interface StyleContext {
  rules: CssRule[];
  /** Flat color for a `url(#id)` paint server, or null. */
  resolvePaint: (id: string) => EmbThread | null;
}

const NO_STYLES: StyleContext = { rules: [], resolvePaint: () => null };

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
let namesLoaded = false;

export function parseSvgColor(value: string | null | undefined): EmbThread | null {
  if (value === null || value === undefined) return null;
  // Registered on first use so importing the package has no side effects.
  if (!namesLoaded) {
    extend([namesPlugin]);
    namesLoaded = true;
  }
  const color = colord(value.trim().toLowerCase());
  if (!color.isValid() || color.alpha() === 0) return null;
  const { r, g, b } = color.toRgb();
  const thread = new EmbThread();
  thread.setColor(r, g, b);
  return thread;
}

function parsePaint(text: string, style: SvgStyleState, context: StyleContext): EmbThread | null {
  if (text.toLowerCase() === "currentcolor") return style.color;
  const reference = text.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/i);
  if (reference === null) return parseSvgColor(text);
  return context.resolvePaint(reference[1]) ?? parseSvgColor(reference[2]);
}

function applyProperty(
  style: SvgStyleState,
  [name, text]: Declaration,
  context: StyleContext
): void {
  const keyword = text.toLowerCase();
  if (keyword === "inherit") return;
  switch (name) {
    case "stroke":
    case "fill":
      style[name] = parsePaint(text, style, context);
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

/** Presentation attributes, then stylesheet rules, then the inline style: last one wins. */
export function cascade(element: Element, tag: string, rules: CssRule[]): Declaration[] {
  const declarations: Declaration[] = [];
  for (const property of PRESENTATION_ATTRIBUTES) {
    const value = element.getAttribute(property)?.trim();
    if (value) declarations.push([property, value]);
  }
  declarations.push(...matchingDeclarations(element, tag, rules));
  declarations.push(...parseDeclarations(element.getAttribute("style") ?? ""));
  return declarations;
}

export function declaredValue(element: Element, tag: string, rules: CssRule[], property: string): string | null {
  return cascade(element, tag, rules).filter(([name]) => name === property).pop()?.[1] ?? null;
}

export function applySvgStyle(
  element: Element,
  tag: string,
  inherited: SvgStyleState,
  context: StyleContext = NO_STYLES
): SvgStyleState {
  const style = { ...inherited };
  for (const declaration of cascade(element, tag, context.rules)) {
    applyProperty(style, declaration, context);
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
