/** @vitest-environment happy-dom */
import { test, expect } from "vitest";
import { EmbConstant as C, EmbPattern, readPes, readSvg, writePes } from "./internal.ts";
import { normalizeSvg } from "../src/svg/normalize.ts";
import { flattenSvgPath } from "../src/svg/pathData.ts";

function blocks(pattern: EmbPattern) {
  return [...pattern.getAsStitchblock()];
}

/** Commands written between the first and the last stitch, after PES encoding (tie stitches aside). */
const commandsBetweenBlocks = (pattern: EmbPattern) => {
  const commands = readPes(writePes(pattern)).stitches.map(([, , command]) => command);
  const first = commands.indexOf(C.STITCH);
  const last = commands.lastIndexOf(C.STITCH);
  return commands.slice(first, last).filter((command) => command !== C.STITCH);
};

const hasPoint = (block: number[][], x: number, y: number) =>
  block.some(([px, py]) => Math.abs(px - x) < 1e-6 && Math.abs(py - y) < 1e-6);

test("readSvg: defaults to a 100 mm square with 2.5 mm stitches", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <path d="M0 5L10 5" stroke="black" stroke-width="0.01"/>
     </svg>`
  );
  const [[block]] = blocks(pattern);
  expect(block[0]).toStrictEqual([0, 500, C.STITCH]);
  expect(block[block.length - 1]).toStrictEqual([1000, 500, C.STITCH]);
  expect(block).toHaveLength(41);
});

test("readSvg: fits the viewBox into the size square with meet", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
       <path d="M 0 0 L 100 0" fill="none" stroke="#ff0000"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );

  const [block, thread] = blocks(pattern)[0];
  expect(thread.hexColor()).toBe("#ff0000");
  expect(block[0]).toStrictEqual([0, 125, C.STITCH]);
  expect(block[block.length - 1]).toStrictEqual([500, 125, C.STITCH]);
});

test("readSvg: parses compact path data and absolute vertical commands", () => {
  expect(flattenSvgPath("M0 0H10V20")).toStrictEqual([
    {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
      ],
      closed: false,
    },
  ]);
  expect(flattenSvgPath("M0 0L10-5")).toStrictEqual([
    {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: -5 },
      ],
      closed: false,
    },
  ]);
  expect(flattenSvgPath("m1 2l3 4h2v5z")).toStrictEqual([
    {
      points: [
        { x: 1, y: 2 },
        { x: 4, y: 6 },
        { x: 6, y: 6 },
        { x: 6, y: 11 },
      ],
      closed: true,
    },
  ]);
});

test("readSvg: flattens arcs without producing invalid coordinates", () => {
  const [subpath] = flattenSvgPath("M0 0A5 5 0 0 1 10 0", 1);
  expect(subpath.points.length).toBeGreaterThan(2);
  expect(subpath.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  const end = subpath.points[subpath.points.length - 1];
  expect(end.x).toBeCloseTo(10, 9);
  expect(end.y).toBeCloseTo(0, 9);
});

test("readSvg: treats uppercase path commands as absolute", () => {
  expect(flattenSvgPath("M10 10L20 10V30H5")).toStrictEqual([
    {
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 30 },
        { x: 5, y: 30 },
      ],
      closed: false,
    },
  ]);
  expect(flattenSvgPath("M10 10l5 5M1 1L2 2")).toStrictEqual([
    { points: [{ x: 10, y: 10 }, { x: 15, y: 15 }], closed: false },
    { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], closed: false },
  ]);
});

test("readSvg: places basic shapes away from the origin", () => {
  const normalized = normalizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
       <rect x="10" y="20" width="30" height="40" stroke="black"/>
       <circle cx="100" cy="100" r="10" stroke="black"/>
       <polyline points="50,50 60,50 60,70" stroke="black"/>
     </svg>`,
    { size: 50 }
  );
  const [rect, circle, polyline] = normalized.shapes.map((shape) =>
    flattenSvgPath(shape.outline!.d, 0.25, shape.transform)[0]
  );
  expect(rect.points).toStrictEqual([
    { x: 10, y: 20 },
    { x: 40, y: 20 },
    { x: 40, y: 60 },
    { x: 10, y: 60 },
  ]);
  expect(rect.closed).toBe(true);
  expect(circle.points[0]).toStrictEqual({ x: 110, y: 100 });
  for (const point of circle.points) {
    expect(Math.hypot(point.x - 100, point.y - 100)).toBeCloseTo(10, 1);
  }
  expect(polyline.points).toStrictEqual([
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 70 },
  ]);
});

test("readSvg: applies skew transforms", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
       <path d="M0 10L0 20" transform="skewX(45)" stroke="black"/>
       <path d="M10 0L20 0" transform="skewY(45)" stroke="black"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const [[skewX], [skewY]] = blocks(pattern);
  expect(hasPoint(skewX, 10, 10)).toBe(true);
  expect(hasPoint(skewX, 20, 20)).toBe(true);
  expect(hasPoint(skewY, 10, 10)).toBe(true);
  expect(hasPoint(skewY, 20, 20)).toBe(true);
});

test("readSvg: rotates around an explicit center", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
       <path d="M20 10L30 10" transform="rotate(90 10 10)" stroke="black"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const [[block]] = blocks(pattern);
  expect(block[0][0]).toBeCloseTo(10);
  expect(block[0][1]).toBeCloseTo(20);
});

test("readSvg: resolves CSS color names and functions", () => {
  const normalized = normalizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <path d="M0 0L1 0" stroke="RebeccaPurple"/>
       <path d="M0 0L1 0" stroke="hsl(120, 100%, 25%)"/>
       <path d="M0 0L1 0" stroke="rgba(255, 0, 0, 0)"/>
       <path d="M0 0L1 0" stroke="transparent"/>
     </svg>`
  );
  expect(normalized.shapes.map((shape) => shape.outline?.style.color.hexColor() ?? null)).toStrictEqual([
    "#663399",
    "#008000",
    null,
    null,
  ]);
});

test("readSvg: reports warnings through onWarning", () => {
  const warnings: string[] = [];
  readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <text>hi</text>
     </svg>`,
    { onWarning: (message) => warnings.push(message) }
  );
  expect(warnings).toStrictEqual(["Skipped unsupported SVG element <text>"]);
});

test("readSvg: composes transform lists in SVG order", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <path d="M0 0L1 0" transform="translate(10 0) scale(2)" stroke="black" stroke-width="0.01"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  expect(blocks(pattern)[0][0][0]).toStrictEqual([50, 0, C.STITCH]);
});

test("readSvg: applies SVG matrix transforms and accepts transform=none", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <path d="M0 0L1 0" transform="matrix(2 0 0 3 4 5)" stroke="black" stroke-width="0.01"/>
       <path d="M0 0L1 0" transform="none" stroke="black" stroke-width="0.01"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const result = blocks(pattern);
  expect(result[0][0][0]).toStrictEqual([200, 250, C.STITCH]);
  expect(hasPoint(result[1][0], 0, 0)).toBe(true);
  expect(hasPoint(result[1][0], 50, 0)).toBe(true);
});

test("readSvg: supports non-uniform normalization when requested", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" preserveAspectRatio="none">
       <path d="M0 0L100 50" stroke="black"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const block = blocks(pattern)[0][0];
  expect(block[0]).toStrictEqual([0, 0, C.STITCH]);
  expect(block[block.length - 1]).toStrictEqual([500, 500, C.STITCH]);
});

test("readSvg: honors the root preserveAspectRatio attribute", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" preserveAspectRatio="xMinYMin slice">
       <path d="M0 0L100 0" stroke="black" stroke-width="0.01"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const block = blocks(pattern)[0][0];
  expect(block[0]).toStrictEqual([0, 0, C.STITCH]);
  expect(block[block.length - 1]).toStrictEqual([1000, 0, C.STITCH]);
});

test("readSvg: handles negative viewBox origins with meet", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 20 10">
       <path d="M-10 -20L-10 -20" stroke="black"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const block = blocks(pattern)[0][0];
  expect(block[0]).toStrictEqual([0, 125, C.STITCH]);
});

test("readSvg: expands symbols referenced by use", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <defs>
         <symbol id="line" viewBox="0 0 10 10">
           <path d="M0 0L10 0"/>
         </symbol>
       </defs>
       <use href="#line" x="20" y="30" stroke="black"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const block = blocks(pattern)[0][0];
  expect(block[0]).toStrictEqual([100, 150, C.STITCH]);
  expect(block[block.length - 1]).toStrictEqual([150, 150, C.STITCH]);
});

test("readSvg: does not loop on cyclic use references", () => {
  const normalized = normalizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <g id="a"><use href="#b"/></g>
       <g id="b"><use href="#a"/></g>
     </svg>`
  );
  expect(normalized.shapes).toHaveLength(0);
  expect(normalized.warnings.some((warning) => warning.includes("cyclic"))).toBe(true);
});

test("readSvg: inherits presentation styles and currentColor", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="#800080">
       <g stroke="currentColor" fill="none">
         <path d="M0 0L10 0"/>
       </g>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const [block, thread] = blocks(pattern)[0];
  expect(thread.hexColor()).toBe("#800080");
  expect(block[0]).toStrictEqual([0, 0, C.STITCH]);
});

test("readSvg: applies group transforms and keeps stroke centerlines", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <g transform="translate(10 20)">
         <path d="M 0 0 L 10 0" fill="none" stroke="rgb(0, 0, 255)"/>
       </g>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );

  const [block, thread] = blocks(pattern)[0];
  expect(thread.hexColor()).toBe("#0000ff");
  expect(block[0]).toStrictEqual([50, 100, C.STITCH]);
  expect(block[block.length - 1]).toStrictEqual([100, 100, C.STITCH]);
});

test("readSvg: use targets inherit from the use element, not their original ancestors", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <defs>
         <g stroke="#00aa00" fill="none">
           <path id="line" d="M0 0L10 0"/>
         </g>
       </defs>
       <use href="#line"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  expect(blocks(pattern)).toHaveLength(0);
});

test("readSvg: use targets inherit from the use element and its ancestors", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <defs>
         <g stroke="#00aa00"><path id="line" d="M0 0L10 0"/></g>
       </defs>
       <g stroke="#0000ff"><use href="#line"/></g>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  const [block, thread] = blocks(pattern)[0];
  expect(thread.hexColor()).toBe("#0000ff");
  expect(block[0]).toStrictEqual([0, 0, C.STITCH]);
});

test("readSvg: use target attributes override the use element", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <defs><path id="line" d="M0 0L10 0" stroke="#ff0000"/></defs>
       <use href="#line" stroke="#0000ff"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  expect(blocks(pattern)[0][1].hexColor()).toBe("#ff0000");
});

test("readSvg: expands same-document use references", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <defs>
         <path id="line" d="M 0 0 L 10 0"/>
       </defs>
       <use href="#line" x="20" y="30" stroke="#00aa00" fill="none"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );

  const [block, thread] = blocks(pattern)[0];
  expect(thread.hexColor()).toBe("#00aa00");
  expect(block[0]).toStrictEqual([100, 150, C.STITCH]);
  expect(block[block.length - 1]).toStrictEqual([150, 150, C.STITCH]);
});

test("readSvg: jumps between separate shape blocks", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <path d="M0 0L10 0" stroke="black"/>
       <path d="M20 20L30 20" stroke="black"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );
  expect(blocks(pattern)).toHaveLength(2);
  // Written out, the thread is trimmed before jumping to the second line.
  expect(commandsBetweenBlocks(pattern)).toStrictEqual([C.TRIM, C.JUMP]);
});

test("readSvg: converts basic shapes to centerline paths", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <line x1="0" y1="0" x2="10" y2="0" stroke="#000000"/>
       <rect x="0" y="20" width="10" height="10" fill="none" stroke="#000000"/>
     </svg>`,
    { size: 50, stitchLength: 1000 }
  );

  const result = blocks(pattern);
  expect(result).toHaveLength(2);
  expect(result[0][0][0]).toStrictEqual([0, 0, C.STITCH]);
  for (const [x, y] of [[0, 100], [50, 100], [50, 150], [0, 150]]) {
    expect(hasPoint(result[1][0], x, y)).toBe(true);
  }
});

test("readSvg: retains both fill and outline channels on a shape", () => {
  const normalized = normalizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <rect x="0" y="0" width="10" height="10" fill="#ff0000" stroke="#0000ff"/>
     </svg>`
  );
  expect(normalized.shapes[0].outline?.style.color.hexColor()).toBe("#0000ff");
  expect(normalized.shapes[0].fill?.style.color?.hexColor()).toBe("#ff0000");
});

test("readSvg: rejects invalid input and stitch settings", () => {
  expect(() => readSvg(new Uint8Array([0xff, 0xfe]))).toThrow(/UTF-8/);
  expect(() => readSvg("<svg/>", { stitchLength: 0 })).toThrow(/stitch length/);
  expect(() => readSvg("<svg/>", { flattenTolerance: -1 })).toThrow(/tolerance/);
});

test("readSvg: rejects malformed XML", () => {
  expect(() => readSvg("<svg><path></svg>")).toThrow(/SVG|XML|parse/i);
});

test("readSvg: decodes UTF-8 bytes and strips a BOM", () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 0" stroke="#000000"/></svg>';
  const bytes = new TextEncoder().encode(`\uFEFF${source}`);
  const pattern = readSvg(bytes, { size: 50, stitchLength: 1000 });
  expect(blocks(pattern)).toHaveLength(1);
});

test("readSvg: satin-stitches strokes 1 mm and wider across their width", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
       <path d="M0 100L100 100" stroke="black" stroke-width="20"/>
     </svg>`,
    { size: 50, underlay: false, pullCompensation: 0 }
  );
  const [[block]] = blocks(pattern);
  const ys = block.map(([, y]) => y);
  expect(Math.min(...ys)).toBeCloseTo(90);
  expect(Math.max(...ys)).toBeCloseTo(110);
  for (let i = 1; i < block.length; i += 1) {
    expect(Math.sign(block[i][1] - 100)).toBe(-Math.sign(block[i - 1][1] - 100));
  }
  expect(block[2][0] - block[0][0]).toBeCloseTo(4);
});

test("readSvg: measures stroke width after transforms", () => {
  const read = (width: string) => {
    const [[block]] = blocks(readSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
         <path d="M0 10L10 10" stroke="black" stroke-width="${width}"/>
       </svg>`,
      { size: 50, underlay: false, pullCompensation: 0 }
    ));
    return Math.max(...block.map(([, y]) => Math.abs(y - 100)));
  };
  expect(read("0.19")).toBeCloseTo(0);
  expect(read("1")).toBeCloseTo(5);
});

test("readSvg: skips zero-width strokes", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <path d="M0 0L10 0" stroke="black" stroke-width="0"/>
     </svg>`
  );
  expect(blocks(pattern)).toHaveLength(0);
});

test("readSvg: walks the centerline under satin, then satins back", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
       <path d="M0 100L100 100" stroke="black" stroke-width="20"/>
     </svg>`,
    { size: 50, pullCompensation: 0 }
  );
  const [[block]] = blocks(pattern);
  expect(block.slice(0, 5).map(([x, y]) => [x, y])).toStrictEqual([
    [0, 100], [25, 100], [50, 100], [75, 100], [100, 100],
  ]);
  expect(block[5][0]).toBeCloseTo(100);
  expect(Math.abs(block[5][1] - 100)).toBeCloseTo(10);
  expect(block[block.length - 1][0]).toBeCloseTo(0);
  expect(block.filter(([, , command]) => command === C.JUMP)).toHaveLength(0);
});

const outlineColors = (source: string, settings = {}) =>
  normalizeSvg(source, settings).shapes.map((shape) => shape.outline?.style.color.hexColor() ?? null);
const fillColors = (source: string) =>
  normalizeSvg(source).shapes.map((shape) => shape.fill?.style.color?.hexColor() ?? null);

test("readSvg: applies <style> classes as exported by Illustrator", () => {
  expect(
    outlineColors(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
         <style type="text/css"><![CDATA[
           /* generated */
           .st0{fill:none;stroke:#E53935;stroke-width:2;stroke-miterlimit:10;}
           .st1, .st2 {stroke:#1E88E5}
         ]]></style>
         <path class="st0" d="M0 0L1 0"/>
         <path class="st2" d="M0 0L1 0"/>
       </svg>`
    )
  ).toStrictEqual(["#e53935", "#1e88e5"]);
});

test("readSvg: resolves stylesheet rules by specificity, below inline styles", () => {
  expect(
    outlineColors(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
         <style>
           #x { stroke: green }
           path.a { stroke: blue }
           path { stroke: red }
           .later { stroke: orange }
           .earlier { stroke: purple }
         </style>
         <path d="M0 0L1 0"/>
         <path class="a" stroke="black" d="M0 0L1 0"/>
         <path id="x" class="a" d="M0 0L1 0"/>
         <path id="x2" class="a" style="stroke: yellow" d="M0 0L1 0"/>
         <path class="earlier later" d="M0 0L1 0"/>
       </svg>`
    )
  ).toStrictEqual(["#ff0000", "#0000ff", "#008000", "#ffff00", "#800080"]);
});

test("readSvg: warns about unsupported CSS and ignores it", () => {
  const normalized = normalizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <style>
         @media print { path { stroke: red } }
         g > path { stroke: blue }
         path:hover { stroke: blue }
       </style>
       <path d="M0 0L1 0" stroke="black"/>
     </svg>`
  );
  expect(normalized.shapes[0].outline?.style.color.hexColor()).toBe("#000000");
  expect(normalized.warnings).toStrictEqual([
    "Skipped CSS at-rule @media",
    'Skipped unsupported CSS selector "g > path"',
    'Skipped unsupported CSS selector "path:hover"',
  ]);
});

test("readSvg: flattens gradients to the average of their stops", () => {
  expect(
    fillColors(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
         <style>.end { stop-color: #0000ff }</style>
         <defs>
           <linearGradient id="g">
             <stop offset="0" stop-color="#ff0000"/>
             <stop offset="1" class="end"/>
           </linearGradient>
           <radialGradient id="linked" href="#g"/>
         </defs>
         <rect width="5" height="5" fill="url(#g)"/>
         <rect width="5" height="5" style="fill: url('#linked')"/>
         <rect width="5" height="5" fill="url(#missing) green"/>
         <rect width="5" height="5" fill="url(#missing)"/>
       </svg>`
    )
  ).toStrictEqual(["#800080", "#800080", "#008000", null]);
});

test("readSvg: merges near-identical colors into one thread", () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
       <path d="M0 0L1 0" stroke="#e53935"/>
       <path d="M0 5L1 5" stroke="#e53a35"/>
       <path d="M0 9L1 9" stroke="#1e88e5"/>
     </svg>`;
  const [a, b, c] = normalizeSvg(source).shapes.map((shape) => shape.outline!.style.color);
  expect(a).toBe(b);
  expect(c).not.toBe(a);
  expect(outlineColors(source, { colorTolerance: 0 })).toStrictEqual(["#e53935", "#e53a35", "#1e88e5"]);
  expect(readSvg(source).threadlist.map((thread) => thread.hexColor())).toStrictEqual(["#e53935", "#1e88e5"]);
  expect(() => normalizeSvg(source, { colorTolerance: -1 })).toThrow(/colorTolerance/);
});

// 1 SVG unit = 1 mm (10 pattern units) in a 100-unit viewBox at the default 100 mm size.
const fill = (body: string) => {
  const [[block, thread]] = blocks(readSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`));
  return { block, thread };
};
const segmentsOf = (block: [number, number, number][]) =>
  block.slice(1).map((stitch, i) => [block[i], stitch] as const);
const distanceToSegment = (px: number, py: number, [a, b]: readonly [number[], number[]]) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
};

test("readSvg: tatami-fills a shape, covering it with short stitches", () => {
  const { block, thread } = fill(`<rect x="10" y="10" width="20" height="20" fill="#e53935"/>`);
  expect(thread.hexColor()).toBe("#e53935");
  expect(block.every(([, , command]) => command === C.STITCH)).toBe(true);
  // Pull compensation grows the fill by 0.2 mm on each side.
  for (const [x, y] of block) {
    expect(x).toBeGreaterThanOrEqual(98 - 1e-6);
    expect(x).toBeLessThanOrEqual(302 + 1e-6);
    expect(y).toBeGreaterThanOrEqual(98 - 1e-6);
    expect(y).toBeLessThanOrEqual(302 + 1e-6);
  }
  const segments = segmentsOf(block);
  // 3 mm max stitch, plus up to the 0.5 mm minimum before the first grid point.
  expect(Math.max(...segments.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])))).toBeLessThanOrEqual(35 + 1e-6);
  // Every interior point is within one row spacing (0.4 mm) of a stitch.
  for (let x = 105; x < 300; x += 19) {
    for (let y = 105; y < 300; y += 19) {
      expect(Math.min(...segments.map((segment) => distanceToSegment(x, y, segment)))).toBeLessThanOrEqual(4);
    }
  }
});

test("readSvg: leaves even-odd holes empty and fills same-direction nonzero ones", () => {
  const ring = "M10 10H50V50H10Z M20 20H40V40H20Z";
  const inHole = (block: [number, number, number][]) =>
    segmentsOf(block).some(([a, b]) => {
      const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // 0.5 mm margin: row connections may cut a concave corner slightly.
      return mx > 205 && mx < 395 && my > 205 && my < 395;
    });
  const evenOdd = fill(`<path d="${ring}" fill-rule="evenodd"/>`).block;
  expect(inHole(evenOdd)).toBe(false);
  expect(evenOdd.some(([, , command]) => command === C.JUMP)).toBe(false);
  expect(inHole(fill(`<path d="${ring}"/>`).block)).toBe(true);
});

test("readSvg: travels inside concave shapes instead of jumping", () => {
  // A "U": the rows split around the notch.
  const { block } = fill(`<path d="M10 10H20V40H40V10H50V50H10Z"/>`);
  expect(block.some(([, , command]) => command === C.JUMP)).toBe(false);
  for (const [a, b] of segmentsOf(block)) {
    const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    expect(mx > 205 && mx < 395 && my < 395).toBe(false);
  }
});

test("readSvg: jumps between separate islands of one fill", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10H20V20H10Z M60 60H70V70H60Z"/></svg>`
  );
  expect(blocks(pattern)).toHaveLength(2);
  expect(commandsBetweenBlocks(pattern)).toStrictEqual([C.TRIM, C.JUMP]);
});

test("readSvg: skips fill=none and zero-area fills", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <rect x="10" y="10" width="20" height="20" fill="none"/>
       <path d="M0 0L10 10"/>
     </svg>`
  );
  expect(blocks(pattern)).toHaveLength(0);
});

const svg100 = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
/** Stitch segments per thread color (jumps excluded). */
const segmentsByColor = (pattern: EmbPattern) => {
  const result = new Map<string, (readonly [number[], number[]])[]>();
  // readSvg marks colors with COLOR_BREAK; the encoder turns them into color changes.
  for (const [block, thread] of pattern.getNormalizedPattern().getAsStitchblock()) {
    const list = result.get(thread.hexColor()) ?? [];
    list.push(...segmentsOf(block as [number, number, number][]));
    result.set(thread.hexColor(), list);
  }
  return result;
};
const midpointsIn = (segments: (readonly [number[], number[]])[], [x0, y0, x1, y1]: number[]) =>
  segments.filter(([a, b]) => {
    const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return mx > x0 && mx < x1 && my > y0 && my < y1;
  }).length;

test("readSvg: does not stitch fill hidden under a later shape", () => {
  const segments = segmentsByColor(readSvg(svg100(`
    <rect x="0" y="0" width="40" height="40" fill="#ff0000"/>
    <rect x="20" y="20" width="40" height="40" fill="#0000ff"/>`)));
  expect(midpointsIn(segments.get("#ff0000")!, [205, 205, 395, 395])).toBe(0);
  expect(midpointsIn(segments.get("#ff0000")!, [5, 5, 195, 195])).toBeGreaterThan(0);
  expect(midpointsIn(segments.get("#0000ff")!, [205, 205, 395, 395])).toBeGreaterThan(0);
});

test("readSvg: satin strokes hide the fills below them, including their own", () => {
  const segments = segmentsByColor(readSvg(svg100(`
    <rect x="0" y="0" width="40" height="40" fill="#ff0000"/>
    <path d="M0 20H40" stroke="#000000" stroke-width="6" fill="none"/>
    <rect x="50" y="0" width="40" height="40" fill="#00ff00" stroke="#0000ff" stroke-width="6"/>`)));
  // The black band covers y 17..23 mm; the blue border covers 3 mm inside the green square.
  expect(midpointsIn(segments.get("#ff0000")!, [5, 175, 395, 225])).toBe(0);
  expect(midpointsIn(segments.get("#00ff00")!, [500, 0, 900, 25])).toBe(0);
  expect(midpointsIn(segments.get("#00ff00")!, [535, 35, 865, 365])).toBeGreaterThan(0);
});

test("readSvg: clips thin lines under later fills and stitches them last", () => {
  const pattern = readSvg(svg100(`
    <path d="M0 50H100" stroke="#000000" stroke-width="0.2"/>
    <rect x="40" y="30" width="20" height="40" fill="#ff0000"/>`));
  const segments = segmentsByColor(pattern);
  expect(midpointsIn(segments.get("#000000")!, [405, 0, 595, 1000])).toBe(0);
  expect(midpointsIn(segments.get("#000000")!, [0, 0, 395, 1000])).toBeGreaterThan(0);
  expect(midpointsIn(segments.get("#000000")!, [605, 0, 1000, 1000])).toBeGreaterThan(0);
  const threads = [...pattern.getNormalizedPattern().getAsStitchblock()].map(([, thread]) => thread.hexColor());
  expect(threads[threads.length - 1]).toBe("#000000");
  expect(threads[0]).toBe("#ff0000");
});

test("readSvg: skips shapes that are fully hidden", () => {
  const pattern = readSvg(svg100(`
    <rect x="10" y="10" width="10" height="10" fill="#ff0000"/>
    <rect x="0" y="0" width="40" height="40" fill="#0000ff"/>`));
  expect(pattern.threadlist.map((thread) => thread.hexColor())).toStrictEqual(["#0000ff"]);
});

test("readSvg: groups colors and moves on to the nearest remaining color", () => {
  const pattern = readSvg(svg100(`
    <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>
    <rect x="80" y="0" width="10" height="10" fill="#00ff00"/>
    <rect x="30" y="0" width="10" height="10" fill="#0000ff"/>
    <rect x="0" y="30" width="10" height="10" fill="#ff0000"/>`));
  // Both reds first, then blue (nearer than green), then green: one change per color.
  expect(pattern.threadlist.map((thread) => thread.hexColor())).toStrictEqual(["#ff0000", "#0000ff", "#00ff00"]);
  expect(pattern.countStitchCommands(C.COLOR_BREAK)).toBe(3);
});

const fillBlock = (settings: object) =>
  blocks(readSvg(svg100(`<rect x="10" y="10" width="20" height="20" fill="#e53935"/>`), settings))[0][0];
const xExtent = (block: number[][]) => [Math.min(...block.map(([x]) => x)), Math.max(...block.map(([x]) => x))];

test("readSvg: grows fills and satin by the pull compensation", () => {
  expect(xExtent(fillBlock({ pullCompensation: 0, underlay: false }))).toEqual([100, 300].map((v) => expect.closeTo(v, 5)));
  expect(xExtent(fillBlock({ pullCompensation: 0.5, underlay: false }))).toEqual([95, 305].map((v) => expect.closeTo(v, 5)));
  const satin = blocks(readSvg(svg100(`<path d="M10 50H90" stroke="#000" stroke-width="2"/>`), { pullCompensation: 0.3, underlay: false }))[0][0];
  const ys = satin.map(([, y]) => y);
  expect(Math.min(...ys)).toBeCloseTo(500 - 13);
  expect(Math.max(...ys)).toBeCloseTo(500 + 13);
  expect(() => readSvg(svg100(""), { pullCompensation: -1 })).toThrow(/pull compensation/);
});

test("readSvg: stitches a sparse underlay across the fill, inset from the edges", () => {
  const withUnderlay = fillBlock({ pullCompensation: 0 });
  const without = fillBlock({ pullCompensation: 0, underlay: false });
  expect(withUnderlay.length).toBeGreaterThan(without.length);
  // The underlay comes first: inside a 0.5 mm inset, with rows across the 45° fill rows.
  const [x0, y0] = withUnderlay[0];
  for (const value of [x0, y0]) {
    expect(value).toBeGreaterThanOrEqual(105 - 1e-6);
    expect(value).toBeLessThanOrEqual(295 + 1e-6);
  }
  const firstRow = segmentsOf(withUnderlay as [number, number, number][]).find(
    // Skip moves along the (axis-aligned) edges.
    ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 20 && Math.abs(b[0] - a[0]) > 1 && Math.abs(b[1] - a[1]) > 1
  )!;
  expect((firstRow[1][0] - firstRow[0][0]) * (firstRow[1][1] - firstRow[0][1])).toBeLessThan(0);
});

const longestStitch = (block: number[][]) =>
  Math.max(...block.slice(1).map((stitch, i) => Math.hypot(stitch[0] - block[i][0], stitch[1] - block[i][1])));

test("readSvg: fills strokes wider than 7 mm instead of satin-stitching them", () => {
  const pattern = readSvg(
    svg100(`<rect x="0" y="40" width="100" height="20" fill="#ff0000"/>
            <path d="M10 50H90" stroke="#000000" stroke-width="10" fill="none"/>`),
    { pullCompensation: 0 }
  );
  const segments = segmentsByColor(pattern);
  const black = segments.get("#000000")!;
  // Tatami rows: no stitch spans the 10 mm width, unlike satin.
  expect(Math.max(...black.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])))).toBeLessThanOrEqual(35 + 1e-6);
  const ys = black.flatMap(([a, b]) => [a[1], b[1]]);
  expect(Math.min(...ys)).toBeCloseTo(450, 0);
  expect(Math.max(...ys)).toBeCloseTo(550, 0);
  // The wide stroke still hides the fill below it.
  expect(midpointsIn(segments.get("#ff0000")!, [105, 455, 895, 545])).toBe(0);
});

test("readSvg: keeps satin up to 7 mm", () => {
  const [[block]] = blocks(readSvg(svg100(`<path d="M10 50H90" stroke="#000" stroke-width="7"/>`), { pullCompensation: 0, underlay: false }));
  expect(longestStitch(block)).toBeGreaterThanOrEqual(70);
});

test("readSvg: spaces fill rows and satin stitches by rowSpacing", () => {
  const settings = { pullCompensation: 0, underlay: false };
  const dense = fillBlock({ ...settings, rowSpacing: 0.4 });
  const sparse = fillBlock({ ...settings, rowSpacing: 0.8 });
  expect(sparse.length).toBeLessThan(dense.length * 0.6);
  const [[satin]] = blocks(readSvg(svg100(`<path d="M10 50H90" stroke="#000" stroke-width="2"/>`), { ...settings, rowSpacing: 0.8 }));
  // Same-side peaks are 0.8 mm apart.
  expect(satin[2][0] - satin[0][0]).toBeCloseTo(8);
  expect(() => readSvg(svg100(""), { rowSpacing: 0 })).toThrow(/row spacing/);
});

const allPoints = (pattern: EmbPattern) =>
  pattern.stitches.filter(([, , command]) => command === C.STITCH).map(([x, y]) => [x, y]);

test("readSvg: clips fills to a clipPath", () => {
  const points = allPoints(readSvg(svg100(`
    <defs><clipPath id="c"><circle cx="50" cy="50" r="20"/></clipPath></defs>
    <rect width="100" height="100" fill="#e53935" clip-path="url(#c)"/>`)));
  expect(points.length).toBeGreaterThan(100);
  // Radius 20 mm, plus 0.2 mm pull compensation and flattening slack.
  expect(Math.max(...points.map(([x, y]) => Math.hypot(x - 500, y - 500)))).toBeLessThanOrEqual(203);
});

test("readSvg: clips a group in its own coordinates", () => {
  const points = allPoints(readSvg(svg100(`
    <defs><clipPath id="c"><rect x="0" y="0" width="10" height="100"/></clipPath></defs>
    <g transform="translate(50 0)" clip-path="url(#c)"><rect x="-50" width="100" height="100"/></g>`)));
  expect(Math.min(...points.map(([x]) => x))).toBeGreaterThanOrEqual(500 - 3);
  expect(Math.max(...points.map(([x]) => x))).toBeLessThanOrEqual(600 + 3);
});

test("readSvg: supports objectBoundingBox clip units", () => {
  const points = allPoints(readSvg(svg100(`
    <clipPath id="left" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath>
    <rect x="20" y="20" width="40" height="40" clip-path="url(#left)"/>`)));
  expect(Math.min(...points.map(([x]) => x))).toBeGreaterThanOrEqual(200 - 3);
  expect(Math.max(...points.map(([x]) => x))).toBeLessThanOrEqual(400 + 3);
});

test("readSvg: clips strokes to a clipPath", () => {
  const points = allPoints(readSvg(svg100(`
    <clipPath id="c"><rect x="30" width="40" height="100"/></clipPath>
    <path d="M0 50H100" stroke="#000" stroke-width="0.2" fill="none" clip-path="url(#c)"/>`)));
  expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(300);
  expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(700);
});

test("readSvg: a clipped shape hides only its visible part", () => {
  const segments = segmentsByColor(readSvg(svg100(`
    <clipPath id="band"><rect x="40" width="20" height="100"/></clipPath>
    <rect width="100" height="100" fill="#ff0000"/>
    <rect width="100" height="100" fill="#0000ff" clip-path="url(#band)"/>`)));
  expect(midpointsIn(segments.get("#ff0000")!, [405, 5, 595, 995])).toBe(0);
  expect(midpointsIn(segments.get("#ff0000")!, [5, 5, 395, 995])).toBeGreaterThan(0);
  expect(midpointsIn(segments.get("#0000ff")!, [0, 0, 395, 1000])).toBe(0);
});

test("readSvg: reads clip-path from CSS and honors clip-rule", () => {
  const segments = segmentsByColor(readSvg(svg100(`
    <style>.clipped { clip-path: url(#ring) }</style>
    <clipPath id="ring"><path d="M10 10H90V90H10Z M30 30H70V70H30Z" clip-rule="evenodd"/></clipPath>
    <rect class="clipped" width="100" height="100" fill="#ff0000"/>`)));
  expect(midpointsIn(segments.get("#ff0000")!, [305, 305, 695, 695])).toBe(0);
  expect(midpointsIn(segments.get("#ff0000")!, [105, 105, 295, 895])).toBeGreaterThan(0);
});

test("readSvg: clip-rule does not change how a shape is filled", () => {
  const segments = segmentsByColor(readSvg(svg100(
    `<path d="M10 10H90V90H10Z M30 30H70V70H30Z" clip-rule="evenodd" fill="#ff0000"/>`
  )));
  expect(midpointsIn(segments.get("#ff0000")!, [305, 305, 695, 695])).toBeGreaterThan(0);
});

test("readSvg: ignores a missing clipPath with a warning", () => {
  const warnings: string[] = [];
  const pattern = readSvg(svg100(`<rect width="10" height="10" clip-path="url(#nope)"/>`), {
    onWarning: (message) => warnings.push(message),
  });
  expect(allPoints(pattern).length).toBeGreaterThan(0);
  expect(warnings).toStrictEqual(["Unsupported clip-path url(#nope)"]);
});

test("readSvg: adds tieStitches at every thread end", () => {
  const svg = svg100(`<path d="M10 10H40" stroke="#000" stroke-width="0.3"/><path d="M60 60H90" stroke="#000" stroke-width="0.3"/>`);
  const stitches = (tieStitches: number) =>
    readPes(writePes(readSvg(svg, { tieStitches }))).stitches.filter(([, , command]) => command === C.STITCH);
  // Off by default; otherwise that many stitches at each of the four thread ends: start, both sides of the jump, end.
  expect(stitches(0)).toStrictEqual(readPes(writePes(readSvg(svg))).stitches.filter(([, , c]) => c === C.STITCH));
  expect(stitches(2).length - stitches(0).length).toBe(8);
  expect(stitches(3).length - stitches(0).length).toBe(12);
  // Out a third of the first 2.5 mm stitch and back, then on along the line.
  const [start, a, b, c] = stitches(2);
  expect([a[0] - start[0], b[0] - start[0], c[0] - start[0]]).toStrictEqual([8, 0, 25]);
  expect(() => readSvg(svg, { tieStitches: 1.5 })).toThrow(/tieStitches/);
});
