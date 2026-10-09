/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import {
  EmbConstant as C,
  EmbThread,
  getJefThreadSet,
  getThreadSet,
  readPes,
  readSvg,
  resolveStitchSettings,
  stitchOutline,
  stitchZone,
  stitchSvg,
  type Stitch,
  type StitchZone,
  type ThreadStitchSettings,
} from "./internal.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(`${import.meta.dirname}/fixtures/${name}`));
const svg100 = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const needle = (stitches: Stitch[]) => stitches.filter(([, , command]) => command === C.STITCH);
const box = (points: { x: number; y: number }[]) => [
  Math.min(...points.map((p) => p.x)),
  Math.min(...points.map((p) => p.y)),
  Math.max(...points.map((p) => p.x)),
  Math.max(...points.map((p) => p.y)),
];
const stitchBox = (stitches: Stitch[]) => box(needle(stitches).map(([x, y]) => ({ x, y })));
/** Stitches of threadlist entry `index`: the blocks between its color break and the next. */
const entryStitches = (stitches: Stitch[], index: number) => {
  const breaks = stitches.flatMap(([, , command], i) => (command === C.COLOR_BREAK ? [i] : []));
  return stitches.slice(breaks[index] + 1, breaks[index + 1] ?? stitches.length);
};

test("resolveStitchSettings fills in readSvg's defaults and checks values", () => {
  expect(resolveStitchSettings()).toStrictEqual({
    runningStitchLength: 2.5,
    fillStitchLength: 3,
    rowSpacing: 0.4,
    pullCompensation: 0,
    underlay: true,
    fillAngle: 45,
    tieStitches: 0,
  });
  expect(resolveStitchSettings({ fillAngle: 225, underlay: false }).fillAngle).toBe(225);
  expect(() => resolveStitchSettings({ rowSpacing: 0 })).toThrow(/row spacing/);
  expect(() => resolveStitchSettings({ tieStitches: -1 })).toThrow(/tieStitches/);
  expect(() => resolveStitchSettings({ underlay: "yes" as unknown as boolean })).toThrow(/underlay/);
});

test("stitchZone fills a zone with rows along fillAngle, inside it", () => {
  const zone: StitchZone = [{ kind: "fill", rings: [square(0, 0, 200)] }];
  const stitches = stitchZone(zone, { fillAngle: 0, underlay: false });
  // Rows are half a row spacing (0.2 mm) inside the top and bottom edges.
  expect(stitchBox(stitches)).toEqual([0, 2, 200, 198].map((v) => expect.closeTo(v, 6)));
  const rows = needle(stitches)
    .slice(1)
    .map((stitch, i) => [needle(stitches)[i], stitch])
    .filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 20);
  expect(rows.length).toBeGreaterThan(50);
  for (const [p, q] of rows) expect(q[1]).toBeCloseTo(p[1]);
});

test("stitchZone keeps holes, stitches satin and running lines, running last", () => {
  const zone: StitchZone = [
    { kind: "running", points: [{ x: 0, y: 300 }, { x: 200, y: 300 }], closed: false },
    { kind: "fill", rings: [square(0, 0, 200), square(50, 50, 100)] },
    { kind: "satin", points: [{ x: 0, y: 250 }, { x: 200, y: 250 }], closed: false, width: 20 },
  ];
  const stitches = needle(stitchZone(zone, { underlay: false, pullCompensation: 0 }));
  const inHole = stitches.filter(([x, y]) => x > 52 && x < 148 && y > 52 && y < 148);
  expect(inHole).toHaveLength(0);
  // Satin zigzags 1 mm each side of y = 250.
  const satin = stitches.filter(([, y]) => y > 230 && y < 270);
  expect(Math.min(...satin.map(([, y]) => y))).toBeCloseTo(240);
  expect(Math.max(...satin.map(([, y]) => y))).toBeCloseTo(260);
  // The running line comes last.
  expect(stitches[stitches.length - 1][1]).toBeCloseTo(300);
});

test("stitchZone separates runs with a trim, ties them, and starts near `from`", () => {
  const zone: StitchZone = [
    { kind: "fill", rings: [square(0, 0, 100)] },
    { kind: "fill", rings: [square(500, 0, 100)] },
  ];
  const settings = { underlay: false };
  const plain = stitchZone(zone, settings);
  expect(plain.filter(([, , command]) => command === C.SEQUENCE_BREAK)).toHaveLength(1);
  expect(stitchZone(zone, { ...settings, tieStitches: 2 }).length - plain.length).toBe(8);
  const fromRight = needle(stitchZone(zone, settings, { x: 700, y: 0 }));
  expect(fromRight[0][0]).toBeGreaterThan(400);
});

test("stitchZone is deterministic, takes plain data and leaves it unchanged", () => {
  const zone: StitchZone = [
    { kind: "fill", rings: [square(0, 0, 150), square(40, 40, 30)] },
    { kind: "satin", points: [{ x: 0, y: 200 }, { x: 150, y: 220 }, { x: 0, y: 260 }], closed: true, width: 25 },
  ];
  const copy = JSON.parse(JSON.stringify(zone)) as StitchZone;
  const settings: Partial<ThreadStitchSettings> = { fillAngle: 30, tieStitches: 1 };
  expect(stitchZone(copy, settings)).toStrictEqual(stitchZone(zone, settings));
  expect(zone).toStrictEqual(copy);
  expect(stitchZone([])).toStrictEqual([]);
  expect(stitchZone([{ kind: "running", points: [], closed: false }, { kind: "fill", rings: [] }])).toStrictEqual([]);
});

test("stitchZone checks its input", () => {
  const fill: StitchZone = [{ kind: "fill", rings: [square(0, 0, 100)] }];
  expect(() => stitchZone(fill, { fillStitchLength: 0 })).toThrow(/fill stitch length/);
  expect(() => stitchZone([{ kind: "fill", rings: [[{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]] }])).toThrow(/finite/);
  expect(() => stitchZone([{ kind: "satin", points: [{ x: 0, y: 0 }], closed: false, width: -1 }])).toThrow(/width/);
  expect(() => stitchZone([{ kind: "blob" } as unknown as StitchZone[number]])).toThrow(/kind/);
  expect(() => stitchZone(fill, {}, { x: Infinity, y: 0 })).toThrow(/from/);
});

test("readSvg keeps each thread's zone, in the pattern's final coordinates", () => {
  const svg = svg100(`
    <rect x="10" y="10" width="30" height="30" fill="#ff0000"/>
    <path d="M10 70H90" stroke="#0000ff" stroke-width="3" fill="none"/>`);
  for (const read of [readSvg, stitchSvg]) {
    const { pattern } = read(svg, { pullCompensation: 0 });
    const [red, blue] = pattern.threadlist.map((thread) => thread.extras.svg!);
    expect(red.zone.map((part) => part.kind)).toStrictEqual(["fill"]);
    expect(blue.zone).toStrictEqual([
      { kind: "satin", points: expect.any(Array), closed: false, width: expect.closeTo(30, 6) },
    ]);
    // The red zone covers the red stitches, which reach its edges.
    const zoneBox = box(red.zone.flatMap((part) => (part.kind === "fill" ? part.rings.flat() : [])));
    expect(stitchBox(entryStitches(pattern.stitches, 0))).toEqual(zoneBox.map((v) => expect.closeTo(v, 0)));
  }
});

test("readSvg zones follow the fit: smaller design, narrower satin", () => {
  const svg = svg100(`<path d="M10 50H90" stroke="#0000ff" stroke-width="3" fill="none"/>`);
  const zone = stitchSvg(svg, { size: 50 }).pattern.threadlist[0].extras.svg!.zone;
  const satin = zone[0];
  if (satin.kind !== "satin") throw new Error("expected satin");
  expect(satin.width).toBeCloseTo(15);
  expect(box(satin.points)).toEqual([50, 250, 450, 250].map((v) => expect.closeTo(v, 6)));
});

test("stitching a readSvg zone again gives an equivalent fill", () => {
  const svg = svg100(`<circle cx="50" cy="50" r="30" fill="#00aa00"/><rect x="5" y="5" width="20" height="20" fill="#00aa00"/>`);
  const { pattern } = readSvg(svg);
  const { zone, settings } = pattern.threadlist[0].extras.svg!;
  const original = entryStitches(pattern.stitches, 0);
  const again = stitchZone(zone, settings);
  expect(stitchBox(again)).toEqual(stitchBox(original).map((v) => expect.closeTo(v, -1)));
  expect(needle(again).length / needle(original).length).toBeGreaterThan(0.95);
  expect(needle(again).length / needle(original).length).toBeLessThan(1.05);
  // A different angle restitches the same area.
  const turned = stitchZone(zone, { ...settings, fillAngle: 0 });
  expect(stitchBox(turned)).toEqual(stitchBox(original).map((v) => expect.closeTo(v, -1)));
});

test("readSvg gives each threadlist entry its own thread object", () => {
  const { pattern } = readSvg(
    svg100(`
      <rect x="10" y="10" width="30" height="30" fill="#ff0000"/>
      <rect x="50" y="50" width="30" height="30" fill="#0000ff"/>
      <path d="M5 95H95" stroke="#ff0000" stroke-width="0.3" fill="none"/>`),
  );
  const [first, blue, again] = pattern.threadlist;
  expect([first, blue, again].map((thread) => thread.hexColor())).toStrictEqual(["#ff0000", "#0000ff", "#ff0000"]);
  expect(again).not.toBe(first);
  expect(again).toBeInstanceOf(EmbThread);
  expect(first.extras.svg!.kinds).toStrictEqual(["fill"]);
  expect(again.extras.svg!.kinds).toStrictEqual(["running"]);
  expect(again.extras.svg!.zone).toStrictEqual([{ kind: "running", points: expect.any(Array), closed: false }]);
});

test("thread charts are exported, with fresh threads on every call", () => {
  expect(getThreadSet()[5].hexColor()).toBe("#ed171f");
  expect(getThreadSet()[5]).not.toBe(getThreadSet()[5]);
  const jef = getJefThreadSet();
  expect(jef[0]).toBeNull();
  expect(jef[1]!.hexColor()).toBe("#000000");
});

/** Even-odd point-in-region test. */
const inside = (rings: { x: number; y: number }[][], x: number, y: number) => {
  let result = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i], ring[j]];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) result = !result;
    }
  }
  return result;
};
/** Area of outer rings minus holes, which wind the other way. */
const area = (rings: { x: number; y: number }[][]) =>
  Math.abs(
    rings.reduce(
      (sum, ring) =>
        sum + ring.reduce((s, p, i) => s + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0) / 2,
      0,
    ),
  );

test("stitchOutline rebuilds a fill's area from its stitches", () => {
  const stitches = stitchZone([{ kind: "fill", rings: [square(0, 0, 200), square(50, 50, 100)] }], { underlay: false });
  const zone = stitchOutline(stitches);
  expect(zone).toHaveLength(1);
  const part = zone[0];
  if (part.kind !== "fill") throw new Error("expected fill");
  // Outer edge plus the hole, within the thread width.
  expect(part.rings).toHaveLength(2);
  expect(box(part.rings.flat())).toEqual([-2, 0, 202, 200].map((v) => expect.closeTo(v, -1)));
  expect(inside(part.rings, 100, 100)).toBe(false);
  expect(inside(part.rings, 25, 25)).toBe(true);
  // About 204×200 minus a 96×96 hole: the thread widens the fill and narrows the hole.
  expect(area(part.rings)).toBeGreaterThan(29000);
  expect(area(part.rings)).toBeLessThan(33000);
  // Stitched again, it covers the same area.
  expect(stitchBox(stitchZone(zone, { underlay: false }))).toEqual(stitchBox(stitches).map((v) => expect.closeTo(v, -1)));
});

test("stitchOutline turns satin and running lines into fills, and ignores jumps", () => {
  const satin = stitchZone([{ kind: "satin", points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], closed: false, width: 30 }], {
    underlay: false,
  });
  const [part] = stitchOutline(satin);
  expect(part.kind).toBe("fill");
  if (part.kind !== "fill") return;
  expect(box(part.rings.flat())).toEqual([-2, -17, 302, 17].map((v) => expect.closeTo(v, -1)));
  // Two running lines joined by a jump: two thin strips, nothing along the jump.
  const zone = stitchOutline([
    [0, 0, C.STITCH],
    [100, 0, C.STITCH],
    [100, 100, C.JUMP],
    [0, 100, C.STITCH],
    [100, 100, C.STITCH],
  ]);
  expect(zone).toHaveLength(2);
  for (const strip of zone) if (strip.kind === "fill") expect(area(strip.rings)).toBeCloseTo(100 * 4, -2);
  expect(stitchOutline([])).toStrictEqual([]);
  expect(() => stitchOutline(satin, 0)).toThrow(/thread width/);
});

test("stitchOutline covers every stitch of a real design", () => {
  const pattern = readPes(fixture("flowers.pes"));
  for (const [block] of pattern.getAsColorblocks()) {
    const zone = stitchOutline(block);
    const rings = zone.flatMap((part) => (part.kind === "fill" ? [part.rings] : []));
    for (const [x, y] of needle(block)) {
      expect(rings.some((island) => inside(island, x, y))).toBe(true);
    }
  }
});
