import { test, expect } from "vitest";
import {
  EmbConstant as C,
  EmbPattern,
  EmbThread,
  writeSvg,
  pesToSvg,
  towards,
} from "./internal.ts";

const svgHeader = (width: string, height: string, viewBox: string) =>
  `<svg version="1.1" xmlns="http://www.w3.org/2000/svg"` +
  ` xmlns:xlink="http://www.w3.org/1999/xlink"` +
  ` xmlns:ev="http://www.w3.org/2001/xml-events"` +
  ` width="${width}" height="${height}" viewBox="${viewBox}">`;

const pathEl = (d: string, stroke: string) =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="3"/>`;

function thread(r: number, g: number, b: number): EmbThread {
  const t = new EmbThread();
  t.setColor(r, g, b);
  return t;
}

test("writeSvg: two color blocks, exact python ElementTree output", () => {
  const p = new EmbPattern();
  p.addThread(thread(255, 0, 0));
  p.addThread(thread(0, 255, 0));
  p.stitchAbs(0, 0);
  p.stitch(10, 0);
  p.colorChange();
  p.stitch(0, 10);

  expect(writeSvg(p)).toBe(
    svgHeader("10", "10", "0 0 10 10") +
      pathEl("M 0,0 10,0", "#ff0000") +
      pathEl("M 10,10", "#00ff00") +
      "</svg>",
  );
});

test("writeSvg: encode=false serializes the raw pattern (no encoder)", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.move(5, 5);
  p.stitch(10, 10);

  expect(writeSvg(p, { encode: false })).toBe(
    svgHeader("15", "15", "0 0 15 15") +
      pathEl("M 0,0", "#000000") +
      pathEl("M 15,15", "#000000") +
      "</svg>",
  );
});

test("writeSvg: empty pattern extents", () => {
  expect(writeSvg(new EmbPattern())).toBe(
    svgHeader("0", "0", "0 0 0 0") + "</svg>",
  );
  expect(writeSvg(new EmbPattern(), { encode: false })).toBe(
    svgHeader("-inf", "-inf", "inf inf -inf -inf") + "</svg>",
  );
});

test("writeSvg: missing threads get the deterministic black filler", () => {
  const p = new EmbPattern();
  p.stitchAbs(5, 5);
  expect(writeSvg(p)).toBe(
    svgHeader("0", "0", "5 5 0 0") + pathEl("M 5,5", "#000000") + "</svg>",
  );
});

test("writeSvg: negative extents flow into width/height/viewBox", () => {
  const p = new EmbPattern();
  p.addThread(thread(255, 0, 0));
  p.stitchAbs(-10, 4);
  p.stitch(40, -11);
  expect(writeSvg(p)).toBe(
    svgHeader("40", "11", "-10 -7 40 11") +
      pathEl("M -10,4 30,-7", "#ff0000") +
      "</svg>",
  );
});

test("writeSvg: sequin_contingency defaults to the WRITER's STITCH value", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.sequinEject(5, 0);

  const withDefaults = writeSvg(p);
  expect(
    withDefaults.includes(pathEl("M 0,0 5,0", "#000000")),
    `eject should be encoded as a STITCH: ${withDefaults}`,
  ).toBe(true);

  const utilize = writeSvg(p, {
    sequin_contingency: C.CONTINGENCY_SEQUIN_UTILIZE,
  });
  expect(utilize.includes(pathEl("M 0,0", "#000000"))).toBe(true);
  expect(utilize.includes("5,0")).toBe(false);
});

test("writeSvg: a caller-supplied max_stitch is kept (writer default only-if-absent)", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.stitch(100, 0);

  expect(writeSvg(p).includes(pathEl("M 0,0 100,0", "#000000"))).toBe(true);

  const split = writeSvg(p, { max_stitch: 5 });
  expect(split.split("<path").length - 1).toBe(2);
  expect(split.includes(pathEl("M 0,0", "#000000"))).toBe(true);
  expect(split.includes(pathEl("M 100,0", "#000000"))).toBe(true);
});

test("writeSvg: tie_on locks land in the path as float coordinates", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.stitch(10, 0);
  const f1 = towards(0, 10, 0.33);
  const f2 = towards(0, 10, 0.66);

  const svg = writeSvg(p, { tie_on: true });
  expect(
    svg.includes(pathEl(`M 0,0 ${f1},0 ${f2},0 ${f1},0 0,0 10,0`, "#000000")),
    `lock floats missing: ${svg}`,
  ).toBe(true);
  expect(svg.includes('viewBox="0 0 10 0"')).toBe(true);
});

test("writeSvg does not mutate the caller's settings object", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  const settings = { max_stitch: 5 };
  writeSvg(p, settings);
  expect(settings).toStrictEqual({ max_stitch: 5 });
});
