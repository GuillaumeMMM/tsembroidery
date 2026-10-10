/** @vitest-environment happy-dom */
import { test, expect } from "vitest";
import {
  EmbPattern,
  EmbThread,
  readDst,
  readPes,
  readSvg,
  writeDst,
  writePes,
  type ThreadStitchSettings,
} from "./internal.ts";

const svg100 = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

const DEFAULTS: ThreadStitchSettings = {
  runningStitchLength: 2.5,
  fillStitchLength: 3,
  rowSpacing: 0.4,
  pullCompensation: 0,
  underlay: true,
  fillAngle: 45,
  tieStitches: 0,
  minStitchLength: 0,
};

const twoReds = svg100(`
  <rect x="10" y="10" width="20" height="20" fill="#ff0000"/>
  <rect x="60" y="10" width="20" height="20" fill="#0000ff"/>
  <rect x="10" y="60" width="20" height="20" fill="#fe0000"/>`);

test("readSvg: records the stitch kinds and settings of each thread in thread.extras.svg", () => {
  const { pattern } = readSvg(twoReds);
  // #fe0000 merges into #ff0000, so threads and their records stay aligned.
  expect(pattern.threadlist.map((thread) => thread.hexColor())).toStrictEqual(["#ff0000", "#0000ff"]);
  const [red, blue] = pattern.threadlist.map((thread) => thread.extras.svg);
  expect(red).toStrictEqual({ kinds: ["fill"], settings: DEFAULTS, zone: expect.any(Array) });
  expect(blue).toStrictEqual({ kinds: ["fill"], settings: DEFAULTS, zone: expect.any(Array) });
  // Both red squares are in the red zone.
  expect(red!.zone.map((part) => part.kind)).toStrictEqual(["fill", "fill"]);
});

test("readSvg: records every stitch kind of a thread", () => {
  const { pattern } = readSvg(
    svg100(`
      <rect x="40" y="40" width="10" height="10" fill="#00ff00"/>
      <rect x="10" y="10" width="80" height="80" fill="#000000"/>
      <path d="M10 5H90" stroke="#000000" stroke-width="2" fill="none"/>
      <path d="M10 95H90" stroke="#000000" stroke-width="0.2" fill="none"/>`),
    { fillAngle: 0, tieStitches: 1 },
  );
  // The green square is covered, so it has no thread; one black thread holds the rest.
  expect(pattern.threadlist.map((thread) => thread.hexColor())).toStrictEqual(["#000000"]);
  const info = pattern.threadlist[0].extras.svg!;
  expect(info.kinds).toStrictEqual(["fill", "satin", "running"]);
  expect(info.settings).toStrictEqual({ ...DEFAULTS, fillAngle: 0, tieStitches: 1 });
});

test("readSvg: records fillAngle as passed, though equivalent angles stitch the same", () => {
  const read = (fillAngle: number) => readSvg(twoReds, { fillAngle }).pattern;
  for (const fillAngle of [225, -135, 70.5]) {
    expect(read(fillAngle).threadlist[0].extras.svg!.settings.fillAngle).toBe(fillAngle);
  }
  expect(read(225).stitches).toStrictEqual(read(45).stitches);
  expect(read(-135).stitches).toStrictEqual(read(45).stitches);
});

test("thread extras survive the methods that rebuild a pattern", () => {
  const { pattern } = readSvg(twoReds);
  const expected = pattern.threadlist.map((thread) => thread.extras.svg);
  pattern.metadata("bayeux", { version: 1 });
  const normalized = pattern.getNormalizedPattern();
  const copies: EmbPattern[] = [normalized, normalized.getStablePattern(), pattern.getPatternMergeJumps()];
  const rebuilt = normalized.getNormalizedPattern();
  rebuilt.convertDuplicateColorChangeToStop();
  rebuilt.convertStopToColorChange();
  copies.push(rebuilt);
  for (const copy of copies) {
    expect(copy.threadlist.map((thread) => thread.extras.svg)).toStrictEqual(expected);
    expect(copy.getMetadata("bayeux")).toStrictEqual({ version: 1 });
  }
});

test("readers leave thread extras empty and writers ignore them", () => {
  const { pattern } = readSvg(twoReds);
  const bare = readSvg(twoReds).pattern;
  for (const thread of bare.threadlist) thread.extras = {};
  pattern.threadlist[0].extras.bayeux = { locked: true };
  expect(writePes(pattern)).toStrictEqual(writePes(bare));
  expect(writeDst(pattern)).toStrictEqual(writeDst(bare));
  for (const read of [readPes(writePes(pattern)), readDst(writeDst(pattern, { extendedHeader: true }))]) {
    for (const thread of read.threadlist) expect(thread.extras).toStrictEqual({});
  }
  expect(new EmbThread().extras).toStrictEqual({});
});
