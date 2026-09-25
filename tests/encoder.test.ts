import { test, expect } from "vitest";
import {
  EmbConstant as C,
  EmbPattern,
  EmbThread,
  Transcoder,
  towards,
  pointInMatrixSpace,
} from "./internal.ts";
import type { EncoderSettings } from "./internal.ts";

const closeTo = (a: number, b: number, eps = 1e-9) =>
  expect(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`).toBeTruthy();

function buildSource(stitches: Array<[number, number, number]>): EmbPattern {
  const p = new EmbPattern();
  for (const [x, y, command] of stitches) p.addStitchAbsolute(command, x, y);
  return p;
}

function transcode(
  stitches: Array<[number, number, number]>,
  settings?: EncoderSettings
): EmbPattern {
  const destination = new EmbPattern();
  new Transcoder(settings).transcode(buildSource(stitches), destination);
  return destination;
}

const cmds = (p: EmbPattern) => p.stitches.map((s) => s[2]);

test("Transcoder settings defaults (python __init__)", () => {
  const t = new Transcoder();
  expect(t.maxStitch).toBe(Infinity);
  expect(t.maxJump).toBe(Infinity);
  expect(t.fullJump).toBe(false);
  expect(t.sequinContingency).toBe(C.CONTINGENCY_SEQUIN_UTILIZE);
  expect(t.stripSpeeds).toBe(true);
  expect(t.explicitTrim).toBe(true);
  expect(t.hasTieOn).toBe(false);
  expect(t.hasTieOff).toBe(false);
  expect(t.longStitchContingency).toBe(C.CONTINGENCY_JUMP_NEEDLE);
  expect(t.matrix).toStrictEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  expect(t.sourcePattern).toBe(null);
  expect(t.destinationPattern).toBe(null);
  expect(t.position).toBe(0);
  expect(t.colorIndex).toBe(-1);
  expect(t.stitch).toBe(null);
  expect(t.stateTrimmed).toBe(true);
  expect(t.stateSequinMode).toBe(false);
  expect(t.needleX).toBe(0);
  expect(t.needleY).toBe(0);
  expect(t.stateJumping).toBe(false);
});

test("strip_sequins picks the initial sequin contingency, explicit setting wins", () => {
  expect(new Transcoder().sequinContingency).toBe(
    C.CONTINGENCY_SEQUIN_UTILIZE
  );
  expect(new Transcoder({ strip_sequins: false }).sequinContingency).toBe(
    C.CONTINGENCY_SEQUIN_JUMP
  );
  expect(
    new Transcoder({
      strip_sequins: false,
      sequin_contingency: C.CONTINGENCY_SEQUIN_STITCH,
    }).sequinContingency
  ).toBe(C.CONTINGENCY_SEQUIN_STITCH);
  expect(
    new Transcoder({
      strip_sequins: true,
      sequin_contingency: C.CONTINGENCY_SEQUIN_REMOVE,
    }).sequinContingency
  ).toBe(C.CONTINGENCY_SEQUIN_REMOVE);
});

test("remaining boolean/numeric settings map through", () => {
  const t = new Transcoder({
    max_stitch: 4,
    max_jump: 9,
    full_jump: true,
    strip_speeds: false,
    explicit_trim: false,
    tie_on: true,
    tie_off: true,
    long_stitch_contingency: C.CONTINGENCY_SEW_TO,
  });
  expect(t.maxStitch).toBe(4);
  expect(t.maxJump).toBe(9);
  expect(t.fullJump).toBe(true);
  expect(t.stripSpeeds).toBe(false);
  expect(t.explicitTrim).toBe(false);
  expect(t.hasTieOn).toBe(true);
  expect(t.hasTieOff).toBe(true);
  expect(t.longStitchContingency).toBe(C.CONTINGENCY_SEW_TO);
});

test("translate setting: array and {x, y} forms compose the matrix", () => {
  const a = new Transcoder({ translate: [10, 20] });
  expect(pointInMatrixSpace(a.matrix, 0, 0)).toStrictEqual([10, 20]);
  const o = new Transcoder({ translate: { x: 10, y: 20 } });
  expect(pointInMatrixSpace(o.matrix, 0, 0)).toStrictEqual([10, 20]);
});

test("translate setting: short array falls through (python IndexError -> .x -> pass)", () => {
  const t = new Transcoder({ translate: [10] });
  expect(pointInMatrixSpace(t.matrix, 0, 0)).toStrictEqual([0, 0]);
});

test("scale setting: scalar is uniform, array is per-axis, {x, y} works", () => {
  const uniform = new Transcoder({ scale: 3 });
  expect(pointInMatrixSpace(uniform.matrix, 2, 5)).toStrictEqual([6, 15]);
  const perAxis = new Transcoder({ scale: [2, 3] });
  expect(pointInMatrixSpace(perAxis.matrix, 2, 5)).toStrictEqual([4, 15]);
  const obj = new Transcoder({ scale: { x: 2, y: 3 } });
  expect(pointInMatrixSpace(obj.matrix, 2, 5)).toStrictEqual([4, 15]);
});

test("settings matrix order: translate applied before scale", () => {
  const t = new Transcoder({ translate: [10, 10], scale: 2 });
  expect(pointInMatrixSpace(t.matrix, 0, 0)).toStrictEqual([20, 20]);
});

test("rotate setting rotates by degrees after translate", () => {
  const t = new Transcoder({ translate: [10, 0], rotate: 90 });
  const [x, y] = pointInMatrixSpace(t.matrix, 0, 0) as [number, number];
  closeTo(x, 0);
  closeTo(y, 10);
});

test("invalid transform settings restate python's TypeError", () => {
  // @ts-expect-error invalid on purpose
  expect(() => new Transcoder({ translate: 5 })).toThrow(TypeError);
  expect(() => new Transcoder({ scale: [2] })).toThrow(TypeError);
  // @ts-expect-error invalid on purpose
  expect(() => new Transcoder({ rotate: "90" })).toThrow(TypeError);
});

test("transcode copies metadata and threads, returns destination", () => {
  const source = buildSource([
    [0, 0, C.STITCH],
    [5, 5, C.STITCH],
  ]);
  const thread = new EmbThread();
  thread.setColor(1, 2, 3);
  source.addThread(thread);
  source.metadata("name", "Flowers");
  source.metadata("version", 6);

  const destination = new EmbPattern();
  destination.metadata("name", "old");
  destination.metadata("existing", true);

  const t = new Transcoder();
  const returned = t.transcode(source, destination);

  expect(returned).toBe(destination);
  expect(destination.threadlist.length).toBe(1);
  expect(destination.threadlist[0]).toBe(thread);
  expect(destination.getMetadata("name")).toBe("Flowers");
  expect(destination.getMetadata("version")).toBe(6);
  expect(destination.getMetadata("existing")).toBe(true);
  expect(t.colorIndex).toBe(0);
  expect(destination.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 5, C.STITCH],
    [5, 5, C.END],
  ]);
});

test("transcode: simple stitch stream, END emitted at the needle", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [10, 0, C.STITCH],
    [0, 10, C.STITCH],
    [0, 0, C.END],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [10, 0, C.STITCH],
    [0, 10, C.STITCH],
    [0, 10, C.END],
  ]);
  expect(cmds(dest).filter((c) => c === C.END).length).toBe(1);
});

test("transcode: source without END gets a trailing END", () => {
  const dest = transcode([[5, 5, C.STITCH]]);
  expect(dest.stitches).toStrictEqual([
    [5, 5, C.STITCH],
    [5, 5, C.END],
  ]);
});

test("transcode: empty source still ends with END at (0,0)", () => {
  const dest = transcode([]);
  expect(dest.stitches).toStrictEqual([[0, 0, C.END]]);
});

test("transcode: NO_COMMAND stitches are skipped", () => {
  const dest = transcode([
    [3, 3, C.NO_COMMAND],
    [0, 0, C.STITCH],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.END],
  ]);
});

test("first stitch jumps only within range: no JUMP unless full_jump", () => {
  const plain = transcode([[10, 0, C.STITCH]]);
  expect(cmds(plain)).toStrictEqual([C.STITCH, C.END]);

  const full = transcode([[10, 0, C.STITCH]], { full_jump: true });
  expect(full.stitches).toStrictEqual([
    [10, 0, C.JUMP],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("JUMP command is split into equal steps of at most max_jump", () => {
  const dest = transcode(
    [
      [10, 0, C.JUMP],
      [10, 0, C.END],
    ],
    { max_jump: 3 }
  );
  // As in pyembroidery 1.5: exact positions, rounded by each writer when it encodes moves.
  expect(dest.stitches).toStrictEqual([
    [2.5, 0, C.JUMP],
    [5, 0, C.JUMP],
    [7.5, 0, C.JUMP],
    [10, 0, C.JUMP],
    [10, 0, C.END],
  ]);
});

test("long stitch with default JUMP_NEEDLE contingency splits into JUMPs", () => {
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [10, 0, C.STITCH],
    ],
    { max_stitch: 5 }
  );
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 0, C.JUMP],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("interpolated gap points keep exact positions", () => {
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [1, 0, C.STITCH],
    ],
    { max_stitch: 0.6 }
  );
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0.5, 0, C.JUMP],
    [1, 0, C.STITCH],
    [1, 0, C.END],
  ]);
});

test("long_stitch_contingency CONTINGENCY_NONE keeps the long stitch", () => {
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [10, 0, C.STITCH],
    ],
    { max_stitch: 5, long_stitch_contingency: C.CONTINGENCY_NONE }
  );
  expect(cmds(dest)).toStrictEqual([C.STITCH, C.STITCH, C.END]);
});

test("on-the-fly CONTINGENCY_NONE / CONTINGENCY_SEW_TO commands", () => {
  const none = transcode(
    [
      [0, 0, C.STITCH],
      [0, 0, C.CONTINGENCY_NONE],
      [10, 0, C.STITCH],
    ],
    { max_stitch: 5 }
  );
  expect(cmds(none)).toStrictEqual([C.STITCH, C.STITCH, C.END]);

  const sew = transcode(
    [
      [0, 0, C.STITCH],
      [0, 0, C.CONTINGENCY_SEW_TO],
      [10, 0, C.STITCH],
    ],
    { max_stitch: 5 }
  );
  expect(sew.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 0, C.STITCH],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("STITCH_BREAK sets jumping: following JUMP dropped, STITCH needle_to's", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 0, C.STITCH_BREAK],
    [10, 0, C.JUMP],
    [15, 0, C.STITCH],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [15, 0, C.STITCH],
    [15, 0, C.END],
  ]);
});

test("NEEDLE_AT: first stitch lands whole, mid-run always needle_to", () => {
  const first = transcode([[10, 0, C.NEEDLE_AT]]);
  expect(cmds(first)).toStrictEqual([C.STITCH, C.END]);

  const mid = transcode(
    [
      [0, 0, C.STITCH],
      [10, 0, C.NEEDLE_AT],
    ],
    { max_stitch: 5, long_stitch_contingency: C.CONTINGENCY_SEW_TO }
  );
  expect(mid.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 0, C.JUMP],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("SEW_TO always sews (STITCH interpolation); while jumping it needle_to's", () => {
  const sewn = transcode(
    [
      [0, 0, C.STITCH],
      [10, 0, C.SEW_TO],
    ],
    { max_stitch: 5 }
  );
  expect(sewn.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 0, C.STITCH],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);

  const jumping = transcode(
    [
      [0, 0, C.STITCH],
      [0, 0, C.STITCH_BREAK],
      [10, 0, C.SEW_TO],
    ],
    { max_stitch: 5 }
  );
  expect(jumping.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 0, C.JUMP],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("COLOR_BREAK before any stitching is ignored (color_index < 0)", () => {
  const dest = transcode([
    [5, 5, C.COLOR_BREAK],
    [10, 10, C.STITCH],
  ]);
  expect(dest.stitches).toStrictEqual([
    [10, 10, C.STITCH],
    [10, 10, C.END],
  ]);
});

test("COLOR_BREAK mid-pattern: TRIM then COLOR_CHANGE when stitching remains", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.COLOR_BREAK],
    [10, 10, C.STITCH],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.COLOR_CHANGE],
    [10, 10, C.STITCH],
    [10, 10, C.END],
  ]);
});

test("COLOR_BREAK at the very end: TRIM but no COLOR_CHANGE (lookahead)", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.COLOR_BREAK],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.END],
  ]);
  expect(dest.countColorChanges()).toBe(0);
});

test("COLOR_CHANGE before any stitching is still emitted (python comment)", () => {
  const dest = transcode([[9, 9, C.COLOR_CHANGE]]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.COLOR_CHANGE],
    [0, 0, C.END],
  ]);
});

test("COLOR_CHANGE after stitching: trim first, then change at the needle", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [9, 9, C.COLOR_CHANGE],
    [10, 10, C.STITCH],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.COLOR_CHANGE],
    [10, 10, C.STITCH],
    [10, 10, C.END],
  ]);
});

test("FRAME_EJECT: tie/trim, jump to target, then STOP", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [20, 20, C.FRAME_EJECT],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [20, 20, C.JUMP],
    [20, 20, C.STOP],
    [20, 20, C.END],
  ]);
});

test("SEQUENCE_BREAK trims at most once", () => {
  const once = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.SEQUENCE_BREAK],
  ]);
  expect(once.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.END],
  ]);

  const twice = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.SEQUENCE_BREAK],
    [5, 5, C.SEQUENCE_BREAK],
  ]);
  expect(twice.countStitchCommands(C.TRIM)).toBe(1);
});

test("tie_off at position 0 uses python's negative index (wraps to LAST)", () => {
  const t = new Transcoder();
  const destination = new EmbPattern();
  const source = buildSource([
    [0, 0, C.TIE_OFF],
    [5, 5, C.STITCH],
  ]);
  t.transcode(source, destination);
  expect(destination.stitches).toStrictEqual([
    [towards(0, 5, 0.33), towards(0, 5, 0.33), C.STITCH],
    [towards(0, 5, 0.66), towards(0, 5, 0.66), C.STITCH],
    [towards(0, 5, 0.33), towards(0, 5, 0.33), C.STITCH],
    [towards(0, 5, 0), towards(0, 5, 0), C.STITCH],
    [5, 5, C.STITCH],
    [5, 5, C.END],
  ]);
});

test("tie_on setting: first stitch locks toward the NEXT source stitch", () => {
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [10, 0, C.STITCH],
    ],
    { tie_on: true }
  );
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0.66), 0, C.STITCH],
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0), 0, C.STITCH],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("TIE_ON command past the end of source is skipped (python IndexError)", () => {
  const dest = transcode([[10, 10, C.TIE_ON]]);
  expect(dest.stitches).toStrictEqual([[0, 0, C.END]]);
});

test("lock_stitch clamps the anchor with oriented() when over max_stitch", () => {
  const dest = transcode(
    [
      [0, 0, C.TIE_OFF],
      [100, 0, C.STITCH],
    ],
    { max_stitch: 10 }
  );
  expect(dest.stitches).toStrictEqual([
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0.66), 0, C.STITCH],
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0), 0, C.STITCH],
    [100, 0, C.STITCH],
    [100, 0, C.END],
  ]);
});

test("lock_stitch: keeps floats, does not move the needle or the state", () => {
  const t = new Transcoder();
  t.destinationPattern = new EmbPattern();
  t.lockStitch(0, 0, 10, 0);
  expect(t.destinationPattern.stitches).toStrictEqual([
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0.66), 0, C.STITCH],
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0), 0, C.STITCH],
  ]);
  expect(t.needleX).toBe(0);
  expect(t.needleY).toBe(0);
  expect(t.stateTrimmed).toBe(true);
});

test("OPTION_ENABLE_TIE_ON / OPTION_DISABLE_TIE_ON toggle mid-stream", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.TRIM],
    [0, 0, C.OPTION_ENABLE_TIE_ON],
    [10, 0, C.STITCH],
    [20, 0, C.STITCH],
    [25, 0, C.TRIM],
    [0, 0, C.OPTION_DISABLE_TIE_ON],
    [30, 0, C.STITCH],
    [40, 0, C.STITCH],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [10, 0, C.STITCH],
    [towards(10, 20, 0.33), 0, C.STITCH],
    [towards(10, 20, 0.66), 0, C.STITCH],
    [towards(10, 20, 0.33), 0, C.STITCH],
    [towards(10, 20, 0), 0, C.STITCH],
    [20, 0, C.STITCH],
    [20, 0, C.TRIM],
    [30, 0, C.STITCH],
    [40, 0, C.STITCH],
    [40, 0, C.END],
  ]);
});

test("OPTION_ENABLE_TIE_OFF / OPTION_DISABLE_TIE_OFF toggle mid-stream", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [0, 0, C.OPTION_ENABLE_TIE_OFF],
    [5, 5, C.STITCH],
    [10, 10, C.TRIM],
    [0, 0, C.OPTION_DISABLE_TIE_OFF],
    [20, 20, C.STITCH],
    [30, 30, C.TRIM],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 5, C.STITCH],
    [5, 5, C.STITCH],
    [5, 5, C.STITCH],
    [5, 5, C.STITCH],
    [5, 5, C.STITCH],
    [5, 5, C.TRIM],
    [20, 20, C.STITCH],
    [20, 20, C.TRIM],
    [20, 20, C.END],
  ]);
  const firstTrim = dest.stitches.findIndex((s) => s[2] === C.TRIM);
  expect(firstTrim).toBe(6);
});

test("lookahead_stitch finds stitching ahead, stops at END", () => {
  const source = buildSource([
    [0, 0, C.COLOR_CHANGE],
    [0, 0, C.TIE_ON],
    [0, 0, C.END],
    [0, 0, C.STITCH],
  ]);
  const t = new Transcoder();
  t.sourcePattern = source;
  t.position = 0;
  expect(t.lookaheadStitch()).toBe(true);
  t.position = 1;
  expect(t.lookaheadStitch()).toBe(true);
  t.position = 2;
  expect(t.lookaheadStitch()).toBe(false);
  t.position = 3;
  expect(t.lookaheadStitch()).toBe(true);
  t.position = 4;
  expect(t.lookaheadStitch()).toBe(false);

  const noStitching = buildSource([
    [0, 0, C.COLOR_CHANGE],
    [0, 0, C.SEQUENCE_BREAK],
    [0, 0, C.END],
  ]);
  t.sourcePattern = noStitching;
  t.position = 0;
  expect(t.lookaheadStitch()).toBe(false);
});

test("OPTION_IMPLICIT_TRIM / OPTION_EXPLICIT_TRIM gate the COLOR_BREAK trim", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.COLOR_BREAK],
    [10, 10, C.STITCH],
    [0, 0, C.OPTION_IMPLICIT_TRIM],
    [15, 15, C.COLOR_BREAK],
    [20, 20, C.STITCH],
    [0, 0, C.OPTION_EXPLICIT_TRIM],
    [25, 25, C.COLOR_BREAK],
    [30, 30, C.STITCH],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.COLOR_CHANGE],
    [10, 10, C.STITCH],
    [10, 10, C.COLOR_CHANGE],
    [20, 20, C.STITCH],
    [20, 20, C.TRIM],
    [20, 20, C.COLOR_CHANGE],
    [30, 30, C.STITCH],
    [30, 30, C.END],
  ]);
});

test("TRIM: leading trim is a no-op, duplicate trims collapse", () => {
  const leading = transcode([[5, 5, C.TRIM]]);
  expect(leading.stitches).toStrictEqual([[0, 0, C.END]]);

  const dup = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.TRIM],
    [5, 5, C.TRIM],
  ]);
  expect(dup.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.END],
  ]);
});

test("STOP lands at the needle and marks trimmed", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.STOP],
    [10, 10, C.STITCH],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.STOP],
    [10, 10, C.STITCH],
    [10, 10, C.END],
  ]);
});

test("SLOW/FAST are stripped by default, kept with strip_speeds false", () => {
  const stripped = transcode([
    [0, 0, C.SLOW],
    [10, 0, C.STITCH],
  ]);
  expect(stripped.stitches).toStrictEqual([
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);

  const kept = transcode(
    [
      [0, 0, C.SLOW],
      [0, 0, C.FAST],
      [10, 0, C.STITCH],
    ],
    { strip_speeds: false }
  );
  expect(kept.stitches).toStrictEqual([
    [0, 0, C.SLOW],
    [0, 0, C.FAST],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("SEQUIN_EJECT with UTILIZE: mode toggles on, eject lands", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 0, C.SEQUIN_EJECT],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.END],
  ]);
});

test("SEQUIN_EJECT while trimmed: jump/stitch first, then mode + eject", () => {
  const dest = transcode([[5, 0, C.SEQUIN_EJECT]]);
  expect(dest.stitches).toStrictEqual([
    [5, 0, C.STITCH],
    [5, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.END],
  ]);
});

test("strip_sequins false: eject becomes a JUMP, no SEQUIN_MODE ever", () => {
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [5, 0, C.SEQUIN_EJECT],
    ],
    { strip_sequins: false }
  );
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 0, C.JUMP],
    [5, 0, C.END],
  ]);
});

test("sequin_contingency STITCH setting: eject becomes a STITCH", () => {
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [5, 0, C.SEQUIN_EJECT],
    ],
    { sequin_contingency: C.CONTINGENCY_SEQUIN_STITCH }
  );
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [5, 0, C.STITCH],
    [5, 0, C.END],
  ]);
});

test("sequin_contingency REMOVE: eject dropped, needle NOT updated", () => {
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [5, 0, C.SEQUIN_EJECT],
      [10, 0, C.SEQUIN_EJECT],
    ],
    { sequin_contingency: C.CONTINGENCY_SEQUIN_REMOVE }
  );
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.END],
  ]);
});

test("SEQUIN_MODE command toggles only under UTILIZE", () => {
  const utilize = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.SEQUIN_MODE],
    [6, 6, C.SEQUIN_MODE],
  ]);
  expect(utilize.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [0, 0, C.SEQUIN_MODE],
    [0, 0, C.END],
  ]);

  const stripped = transcode(
    [
      [0, 0, C.STITCH],
      [5, 5, C.SEQUIN_MODE],
    ],
    { strip_sequins: false }
  );
  expect(cmds(stripped)).toStrictEqual([C.STITCH, C.END]);
});

test("TRIM while in sequin mode toggles the mode off first", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 0, C.SEQUIN_EJECT],
    [10, 0, C.TRIM],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.SEQUIN_MODE],
    [5, 0, C.TRIM],
    [5, 0, C.END],
  ]);
});

test("jump_at turns sequin mode off before jumping (in-range jump)", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 0, C.SEQUIN_EJECT],
    [10, 0, C.JUMP],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.SEQUIN_MODE],
    [10, 0, C.JUMP],
    [10, 0, C.END],
  ]);
});

test("interpolating a long JUMP toggles sequin mode off first", () => {
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [5, 0, C.SEQUIN_EJECT],
      [20, 0, C.JUMP],
    ],
    { max_jump: 5 }
  );
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.SEQUIN_MODE],
    [10, 0, C.JUMP],
    [15, 0, C.JUMP],
    [20, 0, C.JUMP],
    [20, 0, C.END],
  ]);
});

test("in-stream CONTINGENCY_SEQUIN_REMOVE turns the mode off, then drops ejects", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 0, C.SEQUIN_EJECT],
    [0, 0, C.CONTINGENCY_SEQUIN_REMOVE],
    [10, 0, C.SEQUIN_EJECT],
  ]);
  expect(dest.stitches).toStrictEqual([
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.SEQUIN_MODE],
    [5, 0, C.END],
  ]);
});

test("in-stream CONTINGENCY_SEQUIN_JUMP sets JUMP — PY-BUG fixed", () => {
  const t = new Transcoder();
  const destination = new EmbPattern();
  t.transcode(
    buildSource([
      [0, 0, C.STITCH],
      [0, 0, C.CONTINGENCY_SEQUIN_JUMP],
    ]),
    destination
  );
  expect(t.sequinContingency).toBe(C.CONTINGENCY_SEQUIN_JUMP);
  expect(t.sequinContingency).not.toBe(C.CONTINGENCY_SEQUIN_REMOVE);
});

test("in-stream CONTINGENCY_SEQUIN_UTILIZE does not close a running mode", () => {
  const t = new Transcoder();
  const destination = new EmbPattern();
  t.transcode(
    buildSource([
      [0, 0, C.STITCH],
      [5, 0, C.SEQUIN_EJECT],
      [0, 0, C.CONTINGENCY_SEQUIN_UTILIZE],
    ]),
    destination
  );
  expect(t.sequinContingency).toBe(C.CONTINGENCY_SEQUIN_UTILIZE);
  expect(t.stateSequinMode).toBe(true);
  expect(destination.countStitchCommands(C.SEQUIN_MODE)).toBe(1);
});

test("OPTION_MAX_* read the RAW stitch coordinates, not the transformed", () => {
  const t = new Transcoder({ translate: [100, 0] });
  const destination = new EmbPattern();
  t.transcode(
    buildSource([
      [0, 0, C.STITCH],
      [7, 999, C.OPTION_MAX_STITCH_LENGTH],
      [3, 999, C.OPTION_MAX_JUMP_LENGTH],
    ]),
    destination
  );
  expect(t.maxStitch).toBe(7);
  expect(t.maxJump).toBe(3);
  expect(destination.stitches[0]).toStrictEqual([100, 0, C.STITCH]);
});

test("MATRIX_TRANSLATE / SCALE / ROTATE / RESET apply mid-stream", () => {
  const t = new Transcoder();
  const destination = new EmbPattern();
  t.transcode(
    buildSource([
      [0, 0, C.STITCH],
      [5, 0, C.MATRIX_TRANSLATE],
      [10, 0, C.STITCH],
      [2, 3, C.MATRIX_SCALE],
      [10, 10, C.STITCH],
      [90, 0, C.MATRIX_ROTATE],
      [0, 10, C.STITCH],
      [0, 0, C.MATRIX_RESET],
      [7, 7, C.STITCH],
    ]),
    destination
  );
  const s = destination.stitches;
  expect(s[0]).toStrictEqual([0, 0, C.STITCH]);
  expect(s[1]).toStrictEqual([15, 0, C.STITCH]);
  expect(s[2]).toStrictEqual([30, 30, C.STITCH]);
  closeTo(s[3][0], -30);
  closeTo(s[3][1], 10);
  expect(s[4]).toStrictEqual([7, 7, C.STITCH]);
  expect(s[5]).toStrictEqual([7, 7, C.END]);
});

test("add / updateNeedlePosition / declareNotTrimmed", () => {
  const t = new Transcoder();
  t.destinationPattern = new EmbPattern();
  t.add(C.STOP);
  t.updateNeedlePosition(4, 5);
  t.add(C.STOP);
  t.add(C.TRIM, 9, 9);
  expect(t.destinationPattern.stitches).toStrictEqual([
    [0, 0, C.STOP],
    [4, 5, C.STOP],
    [9, 9, C.TRIM],
  ]);

  expect(t.colorIndex).toBe(-1);
  t.declareNotTrimmed();
  expect(t.stateTrimmed).toBe(false);
  expect(t.colorIndex).toBe(0);
  t.colorIndex = 7;
  t.declareNotTrimmed();
  expect(t.colorIndex).toBe(7);
});

test("colorChangeHere emits COLOR_CHANGE, bumps color_index, marks trimmed", () => {
  const t = new Transcoder();
  t.destinationPattern = new EmbPattern();
  t.colorIndex = 0;
  t.stateTrimmed = false;
  t.colorChangeHere();
  expect(t.destinationPattern.stitches).toStrictEqual([[0, 0, C.COLOR_CHANGE]]);
  expect(t.colorIndex).toBe(1);
  expect(t.stateTrimmed).toBe(true);
});

test("positionWillExceedConstraint uses max_stitch and the raw stitch", () => {
  const t = new Transcoder({ max_stitch: 5 });
  t.needleX = 0;
  t.needleY = 0;
  t.stitch = [10, 0, C.STITCH];
  expect(t.positionWillExceedConstraint()).toBe(true);
  expect(t.positionWillExceedConstraint(20)).toBe(false);
  expect(t.positionWillExceedConstraint(undefined, 3, 4)).toBe(false);
  expect(t.positionWillExceedConstraint(undefined, 9, 0)).toBe(true);
  expect(t.positionWillExceedConstraint(undefined, 3)).toBe(true);
});

test("EmbPattern.getNormalizedPattern transcodes into a fresh pattern", () => {
  const p = new EmbPattern();
  const thread = new EmbThread();
  thread.setColor(1, 2, 3);
  p.addThread(thread);
  p.metadata("name", "Flowers");
  p.stitchAbs(1, 2);
  p.stitch(3, 4);
  const before = p.stitches.map((s) => [...s] as [number, number, number]);

  const n = p.getNormalizedPattern({ scale: 2 });
  expect(n.stitches).toStrictEqual([
    [2, 4, C.STITCH],
    [8, 12, C.STITCH],
    [8, 12, C.END],
  ]);
  expect(p.stitches).toStrictEqual(before);
  expect(n.threadlist[0]).toBe(thread);
  expect(n.getMetadata("name")).toBe("Flowers");

  const n2 = p.getNormalizedPattern();
  expect(n2.stitches).toStrictEqual([
    [1, 2, C.STITCH],
    [4, 6, C.STITCH],
    [4, 6, C.END],
  ]);
});
