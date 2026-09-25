/** @vitest-environment happy-dom */
import { test, expect } from "vitest";
import { EmbConstant as C, EmbPattern, normalizeSvg, readSvg } from "../src/index.ts";
import { flattenSvgPath } from "../src/svg/pathData.ts";

function blocks(pattern: EmbPattern) {
  return [...pattern.getAsStitchblock()];
}

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
  expect(skewX[0][0]).toBeCloseTo(10);
  expect(skewX[0][1]).toBeCloseTo(10);
  expect(skewY[0][0]).toBeCloseTo(10);
  expect(skewY[0][1]).toBeCloseTo(10);
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
  expect(result[1][0][0]).toStrictEqual([0, 0, C.STITCH]);
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
  expect(pattern.stitches.filter((stitch) => stitch[2] === C.JUMP)).toHaveLength(1);
  expect(blocks(pattern)).toHaveLength(2);
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
  expect(result[1][0][0]).toStrictEqual([0, 100, C.STITCH]);
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

test("readSvg: does not turn fill-only shapes into stitches", () => {
  const pattern = readSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>
     </svg>`
  );

  expect(blocks(pattern)).toHaveLength(0);
  expect(pattern.threadlist).toHaveLength(0);
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
    { size: 50, satinUnderlay: false }
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
      { size: 50, satinUnderlay: false }
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
    { size: 50 }
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
