import { SVGShapes, type SVGPathData } from "svg-pathdata";
import type { EmbThread } from "../thread.js";
import { getTranslate, type Matrix } from "../matrix.js";
import { composeSvgMatrix, parseSvgTransform } from "./transform.js";
import { normalizeSvgViewport } from "./viewport.js";
import { parseSvgLength, scanNumbers, UNITS_PER_MM } from "./numbers.js";
import {
  applySvgStyle,
  getDefaultSvgStyle,
  getFillStyle,
  getStrokeStyle,
  type SvgStyleState,
} from "./styles.js";
import type {
  NormalizedSvg,
  SvgReadSettings,
  SvgShape,
  SvgViewport,
} from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

const SHAPE_TAGS = new Set(["path", "line", "polyline", "polygon", "rect", "circle", "ellipse"]);
const CONTAINER_TAGS = new Set(["g", "svg", "a", "symbol"]);
const IGNORED_TAGS = new Set(["defs", "style", "title", "desc", "metadata", "script", "foreignobject"]);

function localName(element: Element): string {
  return (element.localName || element.tagName.split(":").pop() || "").toLowerCase();
}

function isSvgElement(element: Element): boolean {
  const namespace = element.namespaceURI;
  return namespace === null || namespace === "" || namespace === SVG_NAMESPACE;
}

function length(element: Element, name: string): number {
  return parseSvgLength(element.getAttribute(name)) ?? 0;
}

function parseDocument(source: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error("readSvg: DOCTYPE and entity declarations are not supported");
  }
  if (typeof DOMParser === "undefined") {
    throw new Error("readSvg: this environment does not provide DOMParser");
  }
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const error =
    document.getElementsByTagNameNS("*", "parsererror")[0] ??
    document.getElementsByTagName("parsererror")[0];
  if (error) {
    throw new Error(`readSvg: XML parse error: ${error.textContent ?? "invalid SVG"}`);
  }
  const root = document.documentElement;
  if (!root || localName(root) !== "svg" || !isSvgElement(root)) {
    throw new Error("readSvg: document root must be an SVG element");
  }
  return document;
}

function shapePath(element: Element, tag: string): SVGPathData | string | null {
  switch (tag) {
    case "path":
      return element.getAttribute("d")?.trim() || null;
    case "line":
      return SVGShapes.createPolyline([
        length(element, "x1"),
        length(element, "y1"),
        length(element, "x2"),
        length(element, "y2"),
      ]);
    case "polyline":
    case "polygon": {
      const coords = scanNumbers(element.getAttribute("points") ?? "");
      if (coords.length < 4) return null;
      coords.length -= coords.length % 2;
      return tag === "polygon" ? SVGShapes.createPolygon(coords) : SVGShapes.createPolyline(coords);
    }
    case "rect": {
      const width = length(element, "width");
      const height = length(element, "height");
      if (width <= 0 || height <= 0) return null;
      // A missing radius takes the other one.
      const rx = parseSvgLength(element.getAttribute("rx"));
      const ry = parseSvgLength(element.getAttribute("ry"));
      return SVGShapes.createRect(
        length(element, "x"),
        length(element, "y"),
        width,
        height,
        Math.max(0, rx ?? ry ?? 0),
        Math.max(0, ry ?? rx ?? 0)
      );
    }
    case "circle":
    case "ellipse": {
      const rx = length(element, tag === "circle" ? "r" : "rx");
      const ry = length(element, tag === "circle" ? "r" : "ry");
      if (rx <= 0 || ry <= 0) return null;
      return SVGShapes.createEllipse(rx, ry, length(element, "cx"), length(element, "cy"));
    }
    default:
      return null;
  }
}

function collectIds(root: Element): Map<string, Element> {
  const ids = new Map<string, Element>();
  for (const element of [root, ...Array.from(root.querySelectorAll("[id]"))]) {
    const id = element.getAttribute("id");
    if (id !== null && !ids.has(id)) ids.set(id, element);
  }
  return ids;
}

function useHref(element: Element): string | null {
  return (
    element.getAttribute("href")?.trim() ||
    element.getAttribute("xlink:href")?.trim() ||
    element.getAttributeNS(XLINK_NAMESPACE, "href")?.trim() ||
    null
  );
}

function collectShapes(
  document: Document,
  viewport: SvgViewport,
  settings: SvgReadSettings
): { shapes: SvgShape[]; warnings: string[] } {
  const ids = collectIds(document.documentElement);
  const shapes: SvgShape[] = [];
  const warnings: string[] = [];
  const maxDepth = settings.maxUseDepth ?? 32;
  const maxInstances = settings.maxUseInstances ?? 10000;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError("SVG maxUseDepth must be a non-negative integer");
  }
  if (!Number.isInteger(maxInstances) || maxInstances < 0) {
    throw new RangeError("SVG maxUseInstances must be a non-negative integer");
  }
  let instances = 0;

  // One thread per color keeps the thread list deduplicated.
  const threads = new Map<number, EmbThread>();
  const canonicalThread = (thread: EmbThread): EmbThread => {
    const key = thread.color & 0xffffff;
    if (!threads.has(key)) threads.set(key, thread);
    return threads.get(key) as EmbThread;
  };

  const visit = (
    element: Element,
    parentTransform: Matrix,
    inheritedStyle: SvgStyleState,
    useDepth: number,
    visiting: Set<Element>,
    allowSymbol = false
  ): void => {
    if (!isSvgElement(element)) {
      warnings.push(`Skipped non-SVG element <${localName(element)}>`);
      return;
    }
    const style = applySvgStyle(element, inheritedStyle);
    if (!style.display || !style.visibility || style.opacity <= 0) return;
    const transform = composeSvgMatrix(
      parentTransform,
      parseSvgTransform(element.getAttribute("transform"))
    );
    const tag = localName(element);

    if (tag === "use") {
      if (useDepth >= maxDepth) {
        warnings.push(`Skipped <use> beyond maximum depth ${maxDepth}`);
        return;
      }
      const href = useHref(element);
      if (href === null || !href.startsWith("#") || href.length === 1) {
        warnings.push("Skipped external or empty <use> reference");
        return;
      }
      const target = ids.get(href.slice(1));
      if (target === undefined) {
        warnings.push(`Skipped missing <use> target ${href}`);
        return;
      }
      if (visiting.has(target)) {
        warnings.push(`Skipped cyclic <use> reference ${href}`);
        return;
      }
      instances += 1;
      if (instances > maxInstances) {
        warnings.push(`Stopped <use> expansion after ${maxInstances} instances`);
        return;
      }
      visit(
        target,
        composeSvgMatrix(transform, getTranslate(length(element, "x"), length(element, "y"))),
        style,
        useDepth + 1,
        new Set(visiting).add(target),
        true
      );
      return;
    }

    if (IGNORED_TAGS.has(tag) || (tag === "symbol" && !allowSymbol)) return;
    if (CONTAINER_TAGS.has(tag)) {
      for (const child of Array.from(element.children)) {
        visit(child, transform, style, useDepth, visiting, allowSymbol);
      }
      return;
    }
    if (!SHAPE_TAGS.has(tag)) {
      warnings.push(`Skipped unsupported SVG element <${tag}>`);
      return;
    }

    const path = shapePath(element, tag);
    if (path === null) return;
    const d = typeof path === "string" ? path : path.encode();
    const stroke = getStrokeStyle(style);
    const outline = stroke === null
      ? null
      : { d, style: { ...stroke, color: canonicalThread(stroke.color) } };
    const fillStyle = getFillStyle(style);
    const fill = fillStyle.color === null ? null : { d, style: fillStyle };
    if (fill !== null && outline === null) {
      warnings.push("Fill-only shape retained; fill stitching is deferred");
    }
    shapes.push({ outline, fill, transform, sourceElement: tag });
  };

  visit(document.documentElement, viewport.transform, getDefaultSvgStyle(), 0, new Set());
  return { shapes, warnings };
}

export function normalizeSvg(
  source: string,
  settings: SvgReadSettings = {}
): NormalizedSvg {
  const document = parseDocument(source);
  const root = document.documentElement;
  const viewport = normalizeSvgViewport(
    root,
    (settings.size ?? 100) * UNITS_PER_MM,
    settings.preserveAspectRatio ?? root.getAttribute("preserveAspectRatio") ?? "xMidYMid meet"
  );
  return { viewport, ...collectShapes(document, viewport, settings) };
}
