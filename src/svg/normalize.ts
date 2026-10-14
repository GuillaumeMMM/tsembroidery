import { SVGShapes, type SVGPathData } from "svg-pathdata";
import { colorDistanceRedMean, EmbThread } from "../thread.js";
import {
  composeSvgMatrix,
  getTranslate,
  invertMatrix,
  parseSvgTransform,
  svgMatrix,
  type Matrix,
} from "./transform.js";
import {
  parseNumberList,
  parseSvgLength,
  getNumbers,
  UNITS_PER_MM,
} from "./numbers.js";
import { parseStylesheet } from "./css.js";
import { flattenSvgPath } from "./pathData.js";
import {
  applySvgStyle,
  declaredValue,
  getDefaultSvgStyle,
  getFillStyle,
  getStrokeStyle,
  parseSvgColor,
  type SvgStyleState,
} from "./styles.js";
import type {
  NormalizedSvg,
  SvgClipPart,
  SvgDomParser,
  SvgReadSettings,
  SvgShape,
  SvgViewport,
} from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

const SHAPE_TAGS = new Set([
  "path",
  "line",
  "polyline",
  "polygon",
  "rect",
  "circle",
  "ellipse",
]);
const CONTAINER_TAGS = new Set(["g", "svg", "a", "symbol"]);
const GRADIENT_TAGS = new Set(["lineargradient", "radialgradient"]);
const IGNORED_TAGS = new Set([
  "defs",
  "style",
  "title",
  "desc",
  "metadata",
  "script",
  "foreignobject",
  "lineargradient",
  "radialgradient",
  "clippath",
]);

function localName(element: Element): string {
  return (
    element.localName ||
    element.tagName.split(":").pop() ||
    ""
  ).toLowerCase();
}

function isSvgElement(element: Element): boolean {
  const namespace = element.namespaceURI;
  return namespace === null || namespace === "" || namespace === SVG_NAMESPACE;
}

function length(element: Element, name: string): number {
  return parseSvgLength(element.getAttribute(name)) ?? 0;
}

function parseDocument(
  source: string,
  Parser: SvgDomParser | undefined,
): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error(
      "readSvg: DOCTYPE and entity declarations are not supported",
    );
  }
  if (Parser === undefined) {
    throw new Error("readSvg: no DOMParser here; pass one in the settings");
  }

  const text = source.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>/g,
    (_, content: string) =>
      content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;"),
  );
  const document = new Parser().parseFromString(
    text,
    "image/svg+xml",
  ) as Document;
  const error =
    document.getElementsByTagNameNS("*", "parsererror")[0] ??
    document.getElementsByTagName("parsererror")[0];
  if (error) {
    throw new Error(
      `readSvg: XML parse error: ${error.textContent ?? "invalid SVG"}`,
    );
  }
  const root = document.documentElement;
  if (!root || localName(root) !== "svg" || !isSvgElement(root)) {
    throw new Error("readSvg: document root must be an SVG element");
  }
  return document;
}

//  Use SVGShapes to generate paths from shapes
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
      const coords = getNumbers(element.getAttribute("points") ?? "");
      if (coords.length < 4) return null;
      coords.length -= coords.length % 2;
      return tag === "polygon"
        ? SVGShapes.createPolygon(coords)
        : SVGShapes.createPolyline(coords);
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
        Math.max(0, ry ?? rx ?? 0),
      );
    }
    case "circle":
    case "ellipse": {
      const rx = length(element, tag === "circle" ? "r" : "rx");
      const ry = length(element, tag === "circle" ? "r" : "ry");
      if (rx <= 0 || ry <= 0) return null;
      return SVGShapes.createEllipse(
        rx,
        ry,
        length(element, "cx"),
        length(element, "cy"),
      );
    }
    default:
      return null;
  }
}

function childElements(element: Element): Element[] {
  return Array.from(element.childNodes).filter(
    (node): node is Element => node.nodeType === 1,
  );
}

function getElementsMap(root: Element): Map<string, Element> {
  const ids = new Map<string, Element>();
  for (const element of [root, ...Array.from(root.getElementsByTagName("*"))]) {
    const id = element.getAttribute("id");
    if (id !== null && !ids.has(id)) ids.set(id, element);
  }
  return ids;
}

function colorDistance(a: EmbThread, b: EmbThread): number {
  return Math.sqrt(
    colorDistanceRedMean(
      a.getRed(),
      a.getGreen(),
      a.getBlue(),
      b.getRed(),
      b.getGreen(),
      b.getBlue(),
    ),
  );
}

function averageColor(threads: EmbThread[]): EmbThread | null {
  if (threads.length === 0) return null;
  const mean = (channel: (thread: EmbThread) => number) =>
    Math.round(
      threads.reduce((sum, thread) => sum + channel(thread), 0) /
        threads.length,
    );
  const thread = new EmbThread();
  thread.setColor(
    mean((t) => t.getRed()),
    mean((t) => t.getGreen()),
    mean((t) => t.getBlue()),
  );
  return thread;
}

function getHref(element: Element): string | null {
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
  settings: SvgReadSettings,
): { shapes: SvgShape[]; warnings: string[] } {
  const root = document.documentElement;
  const elementsMap = getElementsMap(root);
  const shapes: SvgShape[] = [];
  const warnings: string[] = [];
  const maxDepth = settings.maxUseDepth ?? 32;
  const maxInstances = settings.maxUseInstances ?? 10000;
  const tolerance = settings.colorTolerance ?? 10;

  let instances = 0;

  const styleSheet = Array.from(root.getElementsByTagName("style"))
    .map((element) => element.textContent ?? "")
    .join("\n");
  const cssRules = parseStylesheet(styleSheet, warnings);

  const gradients = new Map<string, EmbThread | null>();
  const gradientColor = (
    id: string,
    seen = new Set<string>(),
  ): EmbThread | null => {
    if (gradients.has(id)) return gradients.get(id)!;
    const element = elementsMap.get(id);
    if (
      element === undefined ||
      !GRADIENT_TAGS.has(localName(element)) ||
      seen.has(id)
    ) {
      warnings.push(`Unsupported paint url(#${id})`);
      gradients.set(id, null);
      return null;
    }
    const stops = childElements(element).filter(
      (child) => localName(child) === "stop",
    );
    let color: EmbThread | null;
    if (stops.length > 0) {
      color = averageColor(
        stops
          .map(
            (stop) =>
              declaredValue(stop, "stop", cssRules, "stop-color") ?? "black",
          )
          .map(parseSvgColor)
          .filter((thread) => thread !== null),
      );
    } else {
      const href = getHref(element);
      color = href?.startsWith("#")
        ? gradientColor(href.slice(1), seen.add(id))
        : null;
    }
    gradients.set(id, color);
    return color;
  };

  const threads: EmbThread[] = [];

  const getFirstClosestThread = (thread: EmbThread): EmbThread => {
    const match = threads.find(
      (known) => colorDistance(known, thread) <= tolerance,
    );
    if (match) return match;
    threads.push(thread);
    return thread;
  };

  const clipReference = (value: string | null): Element | null => {
    if (value === null || value.toLowerCase() === "none") return null;

    const id = value.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/)?.[1];
    const element = id === undefined ? undefined : elementsMap.get(id);
    if (element === undefined || localName(element) !== "clippath") {
      warnings.push(`Unsupported clip-path ${value}`);
      return null;
    }
    return element;
  };

  const clipChain = (element: Element, tag: string): Element[] => {
    const chain: Element[] = [];
    for (
      let clip = clipReference(
        declaredValue(element, tag, cssRules, "clip-path"),
      );
      clip !== null && !chain.includes(clip);
    ) {
      chain.push(clip);
      clip = clipReference(
        declaredValue(clip, "clippath", cssRules, "clip-path"),
      );
    }
    return chain;
  };

  const boundingBox = (owned: SvgShape[], toLocal: Matrix) => {
    const points = owned.flatMap((shape) =>
      flattenSvgPath(
        (shape.fill ?? shape.outline)!.d,
        0.1,
        composeSvgMatrix(toLocal, shape.transform),
      ).flatMap((subpath) => subpath.points),
    );
    if (points.length === 0) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const [x, y] = [Math.min(...xs), Math.min(...ys)];
    return svgMatrix(Math.max(...xs) - x, 0, 0, Math.max(...ys) - y, x, y);
  };

  const clipParts = (
    clip: Element,
    ownerTransform: Matrix,
    owned: SvgShape[],
  ): SvgClipPart[] => {
    let base = ownerTransform;
    if (clip.getAttribute("clipPathUnits") === "objectBoundingBox") {
      const box = boundingBox(owned, invertMatrix(ownerTransform));
      if (box === null) return [];
      base = composeSvgMatrix(base, box);
    }
    base = composeSvgMatrix(
      base,
      parseSvgTransform(clip.getAttribute("transform")),
    );
    const defaultRule = declaredValue(clip, "clippath", cssRules, "clip-rule");
    const parts: SvgClipPart[] = [];
    const add = (child: Element, parent: Matrix, depth: number): void => {
      const tag = localName(child);
      if (declaredValue(child, tag, cssRules, "display") === "none") return;
      const transform = composeSvgMatrix(
        parent,
        parseSvgTransform(child.getAttribute("transform")),
      );
      if (tag === "use") {
        const target = elementsMap.get(getHref(child)?.slice(1) ?? "");
        if (target !== undefined && depth < maxDepth) {
          add(
            target,
            composeSvgMatrix(
              transform,
              getTranslate(length(child, "x"), length(child, "y")),
            ),
            depth + 1,
          );
        }
        return;
      }
      if (!SHAPE_TAGS.has(tag)) {
        warnings.push(`Skipped unsupported <${tag}> in clipPath`);
        return;
      }
      const path = shapePath(child, tag);
      if (path === null) return;
      const rule =
        declaredValue(child, tag, cssRules, "clip-rule") ?? defaultRule;
      parts.push({
        d: typeof path === "string" ? path : path.encode(),
        transform,
        rule: rule?.toLowerCase() === "evenodd" ? "evenodd" : "nonzero",
      });
    };
    for (const child of childElements(clip)) add(child, base, 0);
    return parts;
  };

  const visitNode = (
    element: Element,
    parentTransform: Matrix,
    inheritedStyle: SvgStyleState,
    inheritedClips: SvgClipPart[][],
    useDepth: number,
    visiting: Set<Element>,
  ): void => {
    if (!isSvgElement(element)) {
      warnings.push(`Skipped non-SVG element <${localName(element)}>`);
      return;
    }
    const tag = localName(element);
    const style = applySvgStyle(element, tag, inheritedStyle, cssRules, gradientColor);

    if (!style.display || !style.visibility || style.opacity <= 0) return;

    const transform = composeSvgMatrix(
      parentTransform,
      parseSvgTransform(element.getAttribute("transform")),
    );

    const clipChainArr = IGNORED_TAGS.has(tag) ? [] : clipChain(element, tag);
    const ownClips = clipChainArr.map((): SvgClipPart[] => []);
    const clips = [...inheritedClips, ...ownClips];
    const start = shapes.length;
    render(element, tag, style, transform, clips, useDepth, visiting);
    clipChainArr.forEach((clip, index) =>
      ownClips[index].push(...clipParts(clip, transform, shapes.slice(start))),
    );
  };

  const render = (
    element: Element,
    tag: string,
    style: SvgStyleState,
    transform: Matrix,
    clips: SvgClipPart[][],
    useDepth: number,
    visiting: Set<Element>,
  ): void => {
    if (IGNORED_TAGS.has(tag) || (tag === "symbol" && useDepth === 0)) return;

    if (tag === "use") {
      if (useDepth >= maxDepth) {
        warnings.push(`Skipped <use> beyond maximum depth ${maxDepth}`);
        return;
      }
      const href = getHref(element);
      if (href === null || !href.startsWith("#") || href.length === 1) {
        warnings.push("Skipped external or empty <use> reference");
        return;
      }
      const target = elementsMap.get(href.slice(1));
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
        warnings.push(
          `Stopped <use> expansion after ${maxInstances} instances`,
        );
        return;
      }

      //  Visit the node referneced by the use
      visitNode(
        target,
        composeSvgMatrix(
          transform,
          getTranslate(length(element, "x"), length(element, "y")),
        ),
        style,
        clips,
        useDepth + 1,
        new Set(visiting).add(target),
      );
      return;
    }

    if (CONTAINER_TAGS.has(tag)) {
      for (const child of childElements(element)) {
        visitNode(child, transform, style, clips, useDepth, visiting);
      }
      return;
    }

    //  Not a container, not a use, not a shape -> skip
    if (!SHAPE_TAGS.has(tag)) {
      warnings.push(`Skipped unsupported SVG element <${tag}>`);
      return;
    }

    const path = shapePath(element, tag);

    if (path === null) return;

    const d = typeof path === "string" ? path : path.encode();
    const stroke = getStrokeStyle(style);
    const outline =
      stroke === null
        ? null
        : {
            d,
            style: { ...stroke, color: getFirstClosestThread(stroke.color) },
          };
    const fillStyle = getFillStyle(style);
    const fill =
      fillStyle.color === null
        ? null
        : {
            d,
            style: {
              ...fillStyle,
              color: getFirstClosestThread(fillStyle.color),
            },
          };
    shapes.push({ outline, fill, transform, sourceElement: tag, clips });
  };

  //  Go through the dom recursively
  visitNode(root, viewport.transform, getDefaultSvgStyle(), [], 0, new Set());
  return { shapes, warnings };
}

export function normalizeSvg(
  source: string,
  settings: SvgReadSettings = {},
): NormalizedSvg {
  const document = parseDocument(
    source,
    settings.DOMParser ??
      (typeof DOMParser === "undefined" ? undefined : DOMParser),
  );
  const root = document.documentElement;
  const viewport = normalizeSvgViewport(
    root,
    (settings.size ?? 100) * UNITS_PER_MM,
    settings.preserveAspectRatio ??
      root.getAttribute("preserveAspectRatio") ??
      "xMidYMid meet",
  );
  return { viewport, ...collectShapes(document, viewport, settings) };
}

const ALIGNMENT: Record<string, number> = { Min: 0, Mid: 0.5, Max: 1 };

function viewportMatrix(
  x: number,
  y: number,
  width: number,
  height: number,
  targetSize: number,
  preserveAspectRatio: string,
): Matrix {
  const [align, meetOrSlice] = preserveAspectRatio.trim().split(/\s+/);
  const scaleX = targetSize / width;
  const scaleY = targetSize / height;
  if (align === "none") {
    return svgMatrix(scaleX, 0, 0, scaleY, -x * scaleX, -y * scaleY);
  }

  // Invalid values fall back to xMidYMid.
  const [, alignX = "Mid", alignY = "Mid"] =
    align.match(/^x(Min|Mid|Max)Y(Min|Mid|Max)$/) ?? [];
  const scale =
    meetOrSlice === "slice"
      ? Math.max(scaleX, scaleY)
      : Math.min(scaleX, scaleY);
  return svgMatrix(
    scale,
    0,
    0,
    scale,
    (targetSize - width * scale) * ALIGNMENT[alignX] - x * scale,
    (targetSize - height * scale) * ALIGNMENT[alignY] - y * scale,
  );
}

function normalizeSvgViewport(
  root: Element,
  targetSize = 1000,
  preserveAspectRatio = "xMidYMid meet",
): SvgViewport {
  if (targetSize <= 0) {
    throw new RangeError("SVG size must be a positive number");
  }

  const viewBox = root.getAttribute("viewBox");
  let x = 0;
  let y = 0;
  let width: number;
  let height: number;
  if (viewBox !== null) {
    const values = parseNumberList(viewBox, "viewBox");
    if (values.length !== 4) {
      throw new Error("SVG viewBox requires four numbers");
    }
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
    transform: viewportMatrix(
      x,
      y,
      width,
      height,
      targetSize,
      preserveAspectRatio,
    ),
  };
}
