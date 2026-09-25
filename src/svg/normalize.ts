import { SVGShapes, type SVGPathData } from "svg-pathdata";
import { colorDistanceRedMean, EmbThread } from "../thread.js";
import { getTranslate, type Matrix } from "../matrix.js";
import { composeSvgMatrix, invertMatrix, parseSvgTransform, svgMatrix } from "./transform.js";
import { normalizeSvgViewport } from "./viewport.js";
import { parseSvgLength, scanNumbers, UNITS_PER_MM } from "./numbers.js";
import { parseStylesheet } from "./css.js";
import { flattenSvgPath } from "./pathData.js";
import {
  applySvgStyle,
  declaredValue,
  getDefaultSvgStyle,
  getFillStyle,
  getStrokeStyle,
  parseSvgColor,
  type StyleContext,
  type SvgStyleState,
} from "./styles.js";
import type {
  NormalizedSvg,
  SvgClipPart,
  SvgReadSettings,
  SvgShape,
  SvgViewport,
} from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

const SHAPE_TAGS = new Set(["path", "line", "polyline", "polygon", "rect", "circle", "ellipse"]);
const CONTAINER_TAGS = new Set(["g", "svg", "a", "symbol"]);
const IGNORED_TAGS = new Set([
  "defs", "style", "title", "desc", "metadata", "script", "foreignobject", "lineargradient", "radialgradient", "clippath",
]);
const GRADIENT_TAGS = new Set(["lineargradient", "radialgradient"]);

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
  // Not every DOM implementation parses CDATA (happy-dom doesn't), so inline it as escaped text.
  const text = source.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content: string) =>
    content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  );
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
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

function colorDistance(a: EmbThread, b: EmbThread): number {
  return Math.sqrt(
    colorDistanceRedMean(a.getRed(), a.getGreen(), a.getBlue(), b.getRed(), b.getGreen(), b.getBlue())
  );
}

function averageColor(threads: EmbThread[]): EmbThread | null {
  if (threads.length === 0) return null;
  const mean = (channel: (thread: EmbThread) => number) =>
    Math.round(threads.reduce((sum, thread) => sum + channel(thread), 0) / threads.length);
  const thread = new EmbThread();
  thread.setColor(mean((t) => t.getRed()), mean((t) => t.getGreen()), mean((t) => t.getBlue()));
  return thread;
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
  const root = document.documentElement;
  const ids = collectIds(root);
  const shapes: SvgShape[] = [];
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const maxDepth = settings.maxUseDepth ?? 32;
  const maxInstances = settings.maxUseInstances ?? 10000;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError("SVG maxUseDepth must be a non-negative integer");
  }
  if (!Number.isInteger(maxInstances) || maxInstances < 0) {
    throw new RangeError("SVG maxUseInstances must be a non-negative integer");
  }
  const tolerance = settings.colorTolerance ?? 10;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("SVG colorTolerance must be a non-negative number");
  }
  let instances = 0;

  const styleSheet = Array.from(root.getElementsByTagName("style"))
    .map((element) => element.textContent ?? "")
    .join("\n");
  const rules = parseStylesheet(styleSheet, warn);

  const gradients = new Map<string, EmbThread | null>();
  const gradientColor = (id: string, seen = new Set<string>()): EmbThread | null => {
    if (gradients.has(id)) return gradients.get(id)!;
    const element = ids.get(id);
    if (element === undefined || !GRADIENT_TAGS.has(localName(element)) || seen.has(id)) {
      warn(`Unsupported paint url(#${id})`);
      gradients.set(id, null);
      return null;
    }
    const stops = Array.from(element.children).filter((child) => localName(child) === "stop");
    let color: EmbThread | null;
    if (stops.length > 0) {
      color = averageColor(
        stops
          .map((stop) => declaredValue(stop, "stop", rules, "stop-color") ?? "black")
          .map(parseSvgColor)
          .filter((thread) => thread !== null)
      );
    } else {
      // Stops can be inherited from another gradient through href.
      const href = useHref(element);
      color = href?.startsWith("#") ? gradientColor(href.slice(1), seen.add(id)) : null;
    }
    gradients.set(id, color);
    return color;
  };
  const context: StyleContext = { rules, resolvePaint: (id) => gradientColor(id) };

  // Near-identical colors share one thread, so they don't cost a thread change.
  const threads: EmbThread[] = [];
  const canonicalThread = (thread: EmbThread): EmbThread => {
    const match = threads.find((known) => colorDistance(known, thread) <= tolerance);
    if (match) return match;
    threads.push(thread);
    return thread;
  };

  const clipReference = (value: string | null): Element | null => {
    if (value === null || value.toLowerCase() === "none") return null;
    const id = value.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/)?.[1];
    const element = id === undefined ? undefined : ids.get(id);
    if (element === undefined || localName(element) !== "clippath") {
      warn(`Unsupported clip-path ${value}`);
      return null;
    }
    return element;
  };

  /** The element's clipPath, followed by any clip-path set on that clipPath, and so on. */
  const clipChain = (element: Element, tag: string): Element[] => {
    const chain: Element[] = [];
    for (let clip = clipReference(declaredValue(element, tag, rules, "clip-path")); clip !== null && !chain.includes(clip); ) {
      chain.push(clip);
      clip = clipReference(declaredValue(clip, "clippath", rules, "clip-path"));
    }
    return chain;
  };

  const boundingBox = (owned: SvgShape[], toLocal: Matrix) => {
    const points = owned.flatMap((shape) =>
      flattenSvgPath((shape.fill ?? shape.outline)!.d, 0.1, composeSvgMatrix(toLocal, shape.transform)).flatMap(
        (subpath) => subpath.points
      )
    );
    if (points.length === 0) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const [x, y] = [Math.min(...xs), Math.min(...ys)];
    return svgMatrix(Math.max(...xs) - x, 0, 0, Math.max(...ys) - y, x, y);
  };

  const clipParts = (clip: Element, ownerTransform: Matrix, owned: SvgShape[]): SvgClipPart[] => {
    let base = ownerTransform;
    if (clip.getAttribute("clipPathUnits") === "objectBoundingBox") {
      const box = boundingBox(owned, invertMatrix(ownerTransform));
      if (box === null) return [];
      base = composeSvgMatrix(base, box);
    }
    base = composeSvgMatrix(base, parseSvgTransform(clip.getAttribute("transform")));
    const defaultRule = declaredValue(clip, "clippath", rules, "clip-rule");
    const parts: SvgClipPart[] = [];
    const add = (child: Element, parent: Matrix, depth: number): void => {
      const tag = localName(child);
      if (declaredValue(child, tag, rules, "display") === "none") return;
      const transform = composeSvgMatrix(parent, parseSvgTransform(child.getAttribute("transform")));
      if (tag === "use") {
        const target = ids.get(useHref(child)?.slice(1) ?? "");
        if (target !== undefined && depth < maxDepth) {
          add(target, composeSvgMatrix(transform, getTranslate(length(child, "x"), length(child, "y"))), depth + 1);
        }
        return;
      }
      if (!SHAPE_TAGS.has(tag)) {
        warn(`Skipped unsupported <${tag}> in clipPath`);
        return;
      }
      const path = shapePath(child, tag);
      if (path === null) return;
      const rule = declaredValue(child, tag, rules, "clip-rule") ?? defaultRule;
      parts.push({
        d: typeof path === "string" ? path : path.encode(),
        transform,
        rule: rule?.toLowerCase() === "evenodd" ? "evenodd" : "nonzero",
      });
    };
    for (const child of Array.from(clip.children)) add(child, base, 0);
    return parts;
  };

  const visit = (
    element: Element,
    parentTransform: Matrix,
    inheritedStyle: SvgStyleState,
    inheritedClips: SvgClipPart[][],
    useDepth: number,
    visiting: Set<Element>,
    allowSymbol = false
  ): void => {
    if (!isSvgElement(element)) {
      warnings.push(`Skipped non-SVG element <${localName(element)}>`);
      return;
    }
    const tag = localName(element);
    const style = applySvgStyle(element, tag, inheritedStyle, context);
    if (!style.display || !style.visibility || style.opacity <= 0) return;
    const transform = composeSvgMatrix(
      parentTransform,
      parseSvgTransform(element.getAttribute("transform"))
    );
    // Clip parts are filled in once the element's shapes exist (bounding-box units need them).
    const chain = IGNORED_TAGS.has(tag) ? [] : clipChain(element, tag);
    const ownClips = chain.map((): SvgClipPart[] => []);
    const clips = [...inheritedClips, ...ownClips];
    const start = shapes.length;
    render(element, tag, style, transform, clips, useDepth, visiting, allowSymbol);
    chain.forEach((clip, index) => ownClips[index].push(...clipParts(clip, transform, shapes.slice(start))));
  };

  const render = (
    element: Element,
    tag: string,
    style: SvgStyleState,
    transform: Matrix,
    clips: SvgClipPart[][],
    useDepth: number,
    visiting: Set<Element>,
    allowSymbol: boolean
  ): void => {
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
        clips,
        useDepth + 1,
        new Set(visiting).add(target),
        true
      );
      return;
    }

    if (IGNORED_TAGS.has(tag) || (tag === "symbol" && !allowSymbol)) return;
    if (CONTAINER_TAGS.has(tag)) {
      for (const child of Array.from(element.children)) {
        visit(child, transform, style, clips, useDepth, visiting, allowSymbol);
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
    const fill = fillStyle.color === null
      ? null
      : { d, style: { ...fillStyle, color: canonicalThread(fillStyle.color) } };
    shapes.push({ outline, fill, transform, sourceElement: tag, clips });
  };

  visit(root, viewport.transform, getDefaultSvgStyle(), [], 0, new Set());
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
