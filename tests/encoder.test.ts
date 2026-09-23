import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EmbConstant as C,
  EmbPattern,
  EmbThread,
  Transcoder,
  towards,
  pointInMatrixSpace,
} from "../dist/index.js";
import type { TranscoderSettings } from "../dist/index.js";

const closeTo = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

function buildSource(stitches: Array<[number, number, number]>): EmbPattern {
  const p = new EmbPattern();
  for (const [x, y, command] of stitches) p.addStitchAbsolute(command, x, y);
  return p;
}

function transcode(
  stitches: Array<[number, number, number]>,
  settings?: TranscoderSettings
): EmbPattern {
  const destination = new EmbPattern();
  new Transcoder(settings).transcode(buildSource(stitches), destination);
  return destination;
}

const cmds = (p: EmbPattern) => p.stitches.map((s) => s[2]);

/* ------------------------------- settings ----------------------------- */

test("Transcoder settings defaults (python __init__)", () => {
  const t = new Transcoder();
  assert.equal(t.maxStitch, Infinity);
  assert.equal(t.maxJump, Infinity);
  assert.equal(t.fullJump, false);
  assert.equal(t.sequinContingency, C.CONTINGENCY_SEQUIN_UTILIZE);
  assert.equal(t.stripSpeeds, true);
  assert.equal(t.explicitTrim, true);
  assert.equal(t.hasTieOn, false);
  assert.equal(t.hasTieOff, false);
  assert.equal(t.longStitchContingency, C.CONTINGENCY_JUMP_NEEDLE);
  assert.deepEqual(t.matrix, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  // initial state machine values
  assert.equal(t.sourcePattern, null);
  assert.equal(t.destinationPattern, null);
  assert.equal(t.position, 0);
  assert.equal(t.colorIndex, -1);
  assert.equal(t.stitch, null);
  assert.equal(t.stateTrimmed, true);
  assert.equal(t.stateSequinMode, false);
  assert.equal(t.needleX, 0);
  assert.equal(t.needleY, 0);
  assert.equal(t.stateJumping, false);
});

test("strip_sequins picks the initial sequin contingency, explicit setting wins", () => {
  // strip_sequins True (default) -> UTILIZE, False -> JUMP
  assert.equal(
    new Transcoder().sequinContingency,
    C.CONTINGENCY_SEQUIN_UTILIZE
  );
  assert.equal(
    new Transcoder({ strip_sequins: false }).sequinContingency,
    C.CONTINGENCY_SEQUIN_JUMP
  );
  // sequin_contingency setting overrides either
  assert.equal(
    new Transcoder({
      strip_sequins: false,
      sequin_contingency: C.CONTINGENCY_SEQUIN_STITCH,
    }).sequinContingency,
    C.CONTINGENCY_SEQUIN_STITCH
  );
  assert.equal(
    new Transcoder({
      strip_sequins: true,
      sequin_contingency: C.CONTINGENCY_SEQUIN_REMOVE,
    }).sequinContingency,
    C.CONTINGENCY_SEQUIN_REMOVE
  );
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
  assert.equal(t.maxStitch, 4);
  assert.equal(t.maxJump, 9);
  assert.equal(t.fullJump, true);
  assert.equal(t.stripSpeeds, false);
  assert.equal(t.explicitTrim, false);
  assert.equal(t.hasTieOn, true);
  assert.equal(t.hasTieOff, true);
  assert.equal(t.longStitchContingency, C.CONTINGENCY_SEW_TO);
});

test("translate setting: array and {x, y} forms compose the matrix", () => {
  const a = new Transcoder({ translate: [10, 20] });
  assert.deepEqual(pointInMatrixSpace(a.matrix, 0, 0), [10, 20]);
  const o = new Transcoder({ translate: { x: 10, y: 20 } });
  assert.deepEqual(pointInMatrixSpace(o.matrix, 0, 0), [10, 20]);
});

test("translate setting: short array falls through (python IndexError -> .x -> pass)", () => {
  // python: translate[1] raises IndexError -> tries translate.x ->
  // AttributeError -> pass. An array has no .x, so nothing is applied.
  const t = new Transcoder({ translate: [10] });
  assert.deepEqual(pointInMatrixSpace(t.matrix, 0, 0), [0, 0]);
});

test("scale setting: scalar is uniform, array is per-axis, {x, y} works", () => {
  const uniform = new Transcoder({ scale: 3 });
  assert.deepEqual(pointInMatrixSpace(uniform.matrix, 2, 5), [6, 15]);
  const perAxis = new Transcoder({ scale: [2, 3] });
  assert.deepEqual(pointInMatrixSpace(perAxis.matrix, 2, 5), [4, 15]);
  const obj = new Transcoder({ scale: { x: 2, y: 3 } });
  assert.deepEqual(pointInMatrixSpace(obj.matrix, 2, 5), [4, 15]);
});

test("settings matrix order: translate applied before scale", () => {
  // python: matrix = I; matrix = multiply(matrix, translate); matrix =
  // multiply(matrix, scale). Row vectors: p*(T*S) applies T first.
  const t = new Transcoder({ translate: [10, 10], scale: 2 });
  assert.deepEqual(pointInMatrixSpace(t.matrix, 0, 0), [20, 20]);
});

test("rotate setting rotates by degrees after translate", () => {
  const t = new Transcoder({ translate: [10, 0], rotate: 90 });
  const [x, y] = pointInMatrixSpace(t.matrix, 0, 0) as [number, number];
  closeTo(x, 0);
  closeTo(y, 10);
});

test("invalid transform settings restate python's TypeError", () => {
  // python: `translate[0]` on a scalar raises TypeError, and
  // `except IndexError` does NOT catch it -> constructor crashes.
  assert.throws(() => new Transcoder({ translate: 5 }), TypeError);
  // python: scale [2] -> IndexError -> .x AttributeError ->
  // get_scale([2], [2]) feeds the list into matrix math -> TypeError.
  assert.throws(() => new Transcoder({ scale: [2] }), TypeError);
  // python: get_rotate does `theta *= tau / 360` -> TypeError on a string.
  // @ts-expect-error the string rotate is the deliberately invalid input
  // being tested (restated python TypeError).
  assert.throws(() => new Transcoder({ rotate: "90" }), TypeError);
});

/* ------------------------------- transcode ---------------------------- */

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
  destination.metadata("name", "old"); // must be overwritten by source
  destination.metadata("existing", true); // must survive

  const t = new Transcoder();
  const returned = t.transcode(source, destination);

  assert.equal(returned, destination);
  assert.equal(destination.threadlist.length, 1);
  assert.equal(destination.threadlist[0], thread); // same instance
  assert.equal(destination.getMetadata("name"), "Flowers");
  assert.equal(destination.getMetadata("version"), 6);
  assert.equal(destination.getMetadata("existing"), true);
  // first stitch declared the color index (-1 -> 0)
  assert.equal(t.colorIndex, 0);
  assert.deepEqual(destination.stitches, [
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
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [10, 0, C.STITCH],
    [0, 10, C.STITCH],
    [0, 10, C.END], // add(END) uses the needle, not the source coords
  ]);
  assert.equal(cmds(dest).filter((c) => c === C.END).length, 1);
});

test("transcode: source without END gets a trailing END", () => {
  const dest = transcode([[5, 5, C.STITCH]]);
  assert.deepEqual(dest.stitches, [
    [5, 5, C.STITCH],
    [5, 5, C.END],
  ]);
});

test("transcode: empty source still ends with END at (0,0)", () => {
  // python: `flags = NO_COMMAND` before the loop; loop never runs ->
  // flags != END -> end_here().
  const dest = transcode([]);
  assert.deepEqual(dest.stitches, [[0, 0, C.END]]);
});

test("transcode: NO_COMMAND stitches are skipped", () => {
  const dest = transcode([
    [3, 3, C.NO_COMMAND],
    [0, 0, C.STITCH],
  ]);
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.END],
  ]);
});

/* -------------------------- movement / lengths ------------------------ */

test("first stitch jumps only within range: no JUMP unless full_jump", () => {
  const plain = transcode([[10, 0, C.STITCH]]);
  assert.deepEqual(cmds(plain), [C.STITCH, C.END]);

  const full = transcode([[10, 0, C.STITCH]], { full_jump: true });
  assert.deepEqual(full.stitches, [
    [10, 0, C.JUMP],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("JUMP command interpolates by max_jump with python round()", () => {
  // distance 10, max_jump 3 -> steps=ceil(10/3)=4, step=2.5 ->
  // intermediates at round(2.5)=2, round(5)=5, round(7.5)=8 (half-to-even!
  // Math.round would give 3, 5, 8), then jump_at lands on the target.
  const dest = transcode(
    [
      [10, 0, C.JUMP],
      [10, 0, C.END],
    ],
    { max_jump: 3 }
  );
  assert.deepEqual(dest.stitches, [
    [2, 0, C.JUMP],
    [5, 0, C.JUMP],
    [8, 0, C.JUMP],
    [10, 0, C.JUMP],
    [10, 0, C.END],
  ]);
});

test("long stitch with default JUMP_NEEDLE contingency splits into JUMPs", () => {
  // First stitch is governed by max_jump only (still inf -> whole).
  // Second stitch: needle_to interpolates with JUMP data by max_stitch.
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [10, 0, C.STITCH],
    ],
    { max_stitch: 5 }
  );
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [5, 0, C.JUMP],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

test("interpolate uses python round(): 0.5 rounds to even (0), not 1", () => {
  // distance 1, max_stitch 0.6 -> steps=2, step=0.5 -> round(0.5)=0
  const dest = transcode(
    [
      [0, 0, C.STITCH],
      [1, 0, C.STITCH],
    ],
    { max_stitch: 0.6 }
  );
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.JUMP], // Math.round(0.5) would have produced [1, 0, JUMP]
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
  assert.deepEqual(cmds(dest), [C.STITCH, C.STITCH, C.END]);
});

test("on-the-fly CONTINGENCY_NONE / CONTINGENCY_SEW_TO commands", () => {
  // NONE: no split at all
  const none = transcode(
    [
      [0, 0, C.STITCH],
      [0, 0, C.CONTINGENCY_NONE],
      [10, 0, C.STITCH],
    ],
    { max_stitch: 5 }
  );
  assert.deepEqual(cmds(none), [C.STITCH, C.STITCH, C.END]);

  // SEW_TO: gap stitches are STITCH data, not JUMP
  const sew = transcode(
    [
      [0, 0, C.STITCH],
      [0, 0, C.CONTINGENCY_SEW_TO],
      [10, 0, C.STITCH],
    ],
    { max_stitch: 5 }
  );
  assert.deepEqual(sew.stitches, [
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
    [10, 0, C.JUMP], // state_jumping -> python skips the jump entirely
    [15, 0, C.STITCH],
  ]);
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [15, 0, C.STITCH],
    [15, 0, C.END],
  ]);
});

test("NEEDLE_AT: first stitch lands whole, mid-run always needle_to", () => {
  const first = transcode([[10, 0, C.NEEDLE_AT]]);
  assert.deepEqual(cmds(first), [C.STITCH, C.END]);

  // Even with CONTINGENCY_SEW_TO, NEEDLE_AT interpolates with JUMP data.
  const mid = transcode(
    [
      [0, 0, C.STITCH],
      [10, 0, C.NEEDLE_AT],
    ],
    { max_stitch: 5, long_stitch_contingency: C.CONTINGENCY_SEW_TO }
  );
  assert.deepEqual(mid.stitches, [
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
  assert.deepEqual(sewn.stitches, [
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
  assert.deepEqual(jumping.stitches, [
    [0, 0, C.STITCH],
    [5, 0, C.JUMP],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

/* ---------------------------- middle-level ---------------------------- */

test("COLOR_BREAK before any stitching is ignored (color_index < 0)", () => {
  const dest = transcode([
    [5, 5, C.COLOR_BREAK],
    [10, 10, C.STITCH],
  ]);
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.END],
  ]);
  assert.equal(dest.countColorChanges(), 0);
});

test("COLOR_CHANGE before any stitching is still emitted (python comment)", () => {
  const dest = transcode([[9, 9, C.COLOR_CHANGE]]);
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(once.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.END],
  ]);

  const twice = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.SEQUENCE_BREAK],
    [5, 5, C.SEQUENCE_BREAK],
  ]);
  assert.equal(twice.countStitchCommands(C.TRIM), 1);
});

/* --------------------------------- ties -------------------------------- */

test("tie_off at position 0 uses python's negative index (wraps to LAST)", () => {
  // python: source_pattern.stitches[position - 1] with position 0 is
  // stitches[-1] -> the LAST stitch. Here that is [5, 5, STITCH], so the
  // lock stitches walk from the needle (0,0) toward (5,5).
  const t = new Transcoder();
  const destination = new EmbPattern();
  const source = buildSource([
    [0, 0, C.TIE_OFF],
    [5, 5, C.STITCH],
  ]);
  t.transcode(source, destination);
  assert.deepEqual(destination.stitches, [
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
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(dest.stitches, [[0, 0, C.END]]);
});

test("lock_stitch clamps the anchor with oriented() when over max_stitch", () => {
  // needle (0,0), anchor (100,0), max_stitch 10 -> anchor becomes (10,0)
  const dest = transcode(
    [
      [0, 0, C.TIE_OFF],
      [100, 0, C.STITCH],
    ],
    { max_stitch: 10 }
  );
  assert.deepEqual(dest.stitches, [
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0.66), 0, C.STITCH],
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0), 0, C.STITCH],
    // NB: the first source stitch is governed by max_JUMP (still inf),
    // so max_stitch does not split it — only the lock clamped.
    [100, 0, C.STITCH],
    [100, 0, C.END],
  ]);
});

test("lock_stitch: keeps floats, does not move the needle or the state", () => {
  const t = new Transcoder();
  t.destinationPattern = new EmbPattern();
  t.lockStitch(0, 0, 10, 0);
  assert.deepEqual(t.destinationPattern.stitches, [
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0.66), 0, C.STITCH],
    [towards(0, 10, 0.33), 0, C.STITCH],
    [towards(0, 10, 0), 0, C.STITCH],
  ]);
  assert.equal(t.needleX, 0);
  assert.equal(t.needleY, 0);
  assert.equal(t.stateTrimmed, true); // lock_stitch never declares
});

test("OPTION_ENABLE_TIE_ON / OPTION_DISABLE_TIE_ON toggle mid-stream", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.TRIM],
    [0, 0, C.OPTION_ENABLE_TIE_ON],
    [10, 0, C.STITCH], // -> tie on toward source[4] (20,0)
    [20, 0, C.STITCH],
    [25, 0, C.TRIM],
    [0, 0, C.OPTION_DISABLE_TIE_ON],
    [30, 0, C.STITCH], // -> NO tie (disabled)
    [40, 0, C.STITCH],
  ]);
  assert.deepEqual(dest.stitches, [
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
    [10, 10, C.TRIM], // -> tie off toward source[2] == needle -> 4 locks in place
    [0, 0, C.OPTION_DISABLE_TIE_OFF],
    [20, 20, C.STITCH],
    [30, 30, C.TRIM], // -> NO locks
  ]);
  assert.deepEqual(dest.stitches, [
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
  // 1 + 1 + 4 locks = 6 STITCH commands before the first TRIM
  const firstTrim = dest.stitches.findIndex((s) => s[2] === C.TRIM);
  assert.equal(firstTrim, 6);
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
  assert.equal(t.lookaheadStitch(), true); // finds TIE_ON
  t.position = 1;
  assert.equal(t.lookaheadStitch(), true); // TIE_ON itself counts
  t.position = 2;
  assert.equal(t.lookaheadStitch(), false); // END stops the search
  t.position = 3;
  assert.equal(t.lookaheadStitch(), true); // STITCH after END still visible? no:
  // position 3 IS the stitch -> true (range starts at position)
  t.position = 4;
  assert.equal(t.lookaheadStitch(), false); // past the end

  const noStitching = buildSource([
    [0, 0, C.COLOR_CHANGE],
    [0, 0, C.SEQUENCE_BREAK],
    [0, 0, C.END],
  ]);
  t.sourcePattern = noStitching;
  t.position = 0;
  assert.equal(t.lookaheadStitch(), false); // breaks don't count as stitching
});

test("OPTION_IMPLICIT_TRIM / OPTION_EXPLICIT_TRIM gate the COLOR_BREAK trim", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.COLOR_BREAK], // explicit (default) -> TRIM + COLOR_CHANGE
    [10, 10, C.STITCH],
    [0, 0, C.OPTION_IMPLICIT_TRIM],
    [15, 15, C.COLOR_BREAK], // implicit -> COLOR_CHANGE only, no TRIM
    [20, 20, C.STITCH],
    [0, 0, C.OPTION_EXPLICIT_TRIM],
    [25, 25, C.COLOR_BREAK], // explicit again -> TRIM + COLOR_CHANGE
    [30, 30, C.STITCH],
  ]);
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.TRIM],
    [0, 0, C.COLOR_CHANGE],
    [10, 10, C.STITCH],
    [10, 10, C.COLOR_CHANGE], // <- no TRIM before this one
    [20, 20, C.STITCH],
    [20, 20, C.TRIM],
    [20, 20, C.COLOR_CHANGE],
    [30, 30, C.STITCH],
    [30, 30, C.END],
  ]);
});

/* --------------------------------- core -------------------------------- */

test("TRIM: leading trim is a no-op, duplicate trims collapse", () => {
  const leading = transcode([[5, 5, C.TRIM]]);
  assert.deepEqual(leading.stitches, [[0, 0, C.END]]); // state starts trimmed

  const dup = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.TRIM],
    [5, 5, C.TRIM],
  ]);
  assert.deepEqual(dup.stitches, [
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
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(stripped.stitches, [
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
  assert.deepEqual(kept.stitches, [
    [0, 0, C.SLOW],
    [0, 0, C.FAST],
    [10, 0, C.STITCH],
    [10, 0, C.END],
  ]);
});

/* -------------------------------- sequins ------------------------------ */

test("SEQUIN_EJECT with UTILIZE: mode toggles on, eject lands", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 0, C.SEQUIN_EJECT],
  ]);
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE], // at the needle before the eject
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.END],
  ]);
});

test("SEQUIN_EJECT while trimmed: jump/stitch first, then mode + eject", () => {
  const dest = transcode([[5, 0, C.SEQUIN_EJECT]]);
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(dest.stitches, [
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
  assert.deepEqual(dest.stitches, [
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
  // python: sequin_at returns early -> no needle update, no declare.
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.END], // needle never left (0,0)
  ]);
});

test("SEQUIN_MODE command toggles only under UTILIZE", () => {
  const utilize = transcode([
    [0, 0, C.STITCH],
    [5, 5, C.SEQUIN_MODE],
    [6, 6, C.SEQUIN_MODE],
  ]);
  assert.deepEqual(utilize.stitches, [
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
  assert.deepEqual(cmds(stripped), [C.STITCH, C.END]);
});

test("TRIM while in sequin mode toggles the mode off first", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 0, C.SEQUIN_EJECT],
    [10, 0, C.TRIM],
  ]);
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE], // on
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.SEQUIN_MODE], // off, before the trim
    [5, 0, C.TRIM],
    [5, 0, C.END],
  ]);
});

test("jump_at turns sequin mode off before jumping (in-range jump)", () => {
  const dest = transcode([
    [0, 0, C.STITCH],
    [5, 0, C.SEQUIN_EJECT],
    [10, 0, C.JUMP], // gap within max_jump -> toggle happens in jump_at
  ]);
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.SEQUIN_MODE], // toggled off in jump_at
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
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.SEQUIN_MODE], // toggled inside interpolate (gap exceeds max_jump)
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
  assert.deepEqual(dest.stitches, [
    [0, 0, C.STITCH],
    [0, 0, C.SEQUIN_MODE],
    [5, 0, C.SEQUIN_EJECT],
    [5, 0, C.SEQUIN_MODE], // contingency command closes the mode...
    [5, 0, C.END], // ...and the next eject is dropped (needle unmoved)
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
  // PY-BUG: python's branch reads
  //     elif flags == CONTINGENCY_SEQUIN_JUMP:
  //         ...
  //         self.sequin_contingency = CONTINGENCY_SEQUIN_REMOVE
  // (copy-paste from the CONTINGENCY_SEQUIN_REMOVE branch above it).
  // The branch handles CONTINGENCY_SEQUIN_JUMP, so it must SET that value.
  assert.equal(t.sequinContingency, C.CONTINGENCY_SEQUIN_JUMP);
  assert.notEqual(t.sequinContingency, C.CONTINGENCY_SEQUIN_REMOVE);
});

test("in-stream CONTINGENCY_SEQUIN_UTILIZE does not close a running mode", () => {
  // python's UTILIZE branch (unlike REMOVE/STITCH/JUMP) never toggles.
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
  assert.equal(t.sequinContingency, C.CONTINGENCY_SEQUIN_UTILIZE);
  assert.equal(t.stateSequinMode, true); // still on
  assert.equal(destination.countStitchCommands(C.SEQUIN_MODE), 1);
});

/* ---------------------------- option commands -------------------------- */

test("OPTION_MAX_* read the RAW stitch coordinates, not the transformed", () => {
  const t = new Transcoder({ translate: [100, 0] });
  const destination = new EmbPattern();
  t.transcode(
    buildSource([
      [0, 0, C.STITCH], // -> (100, 0): settings translate applies
      [7, 999, C.OPTION_MAX_STITCH_LENGTH],
      [3, 999, C.OPTION_MAX_JUMP_LENGTH],
    ]),
    destination
  );
  assert.equal(t.maxStitch, 7); // raw stitch[0], NOT 107
  assert.equal(t.maxJump, 3); // raw stitch[0], NOT 103
  assert.deepEqual(destination.stitches[0], [100, 0, C.STITCH]);
});

/* ----------------------------- matrix commands -------------------------- */

test("MATRIX_TRANSLATE / SCALE / ROTATE / RESET apply mid-stream", () => {
  const t = new Transcoder();
  const destination = new EmbPattern();
  t.transcode(
    buildSource([
      [0, 0, C.STITCH],
      [5, 0, C.MATRIX_TRANSLATE], // raw coords -> translate(5, 0)
      [10, 0, C.STITCH], // -> (15, 0)
      [2, 3, C.MATRIX_SCALE], // raw coords -> scale(2, 3)
      [10, 10, C.STITCH], // (10,10)+translate(5,0) -> (15,10) *scale(2,3) -> (30,30)
      [90, 0, C.MATRIX_ROTATE], // raw -> rotate 90 degrees
      [0, 10, C.STITCH], // (0,10)+T -> (5,10) *S -> (10,30) *R90 -> (-30,10)
      [0, 0, C.MATRIX_RESET],
      [7, 7, C.STITCH], // identity again -> (7, 7)
    ]),
    destination
  );
  const s = destination.stitches;
  assert.deepEqual(s[0], [0, 0, C.STITCH]);
  assert.deepEqual(s[1], [15, 0, C.STITCH]);
  assert.deepEqual(s[2], [30, 30, C.STITCH]);
  closeTo(s[3][0], -30); // 90 deg rotation of (10, 30)
  closeTo(s[3][1], 10); // (float: 10 + 30*cos(pi/2) ≈ 10.000000000000002)
  assert.deepEqual(s[4], [7, 7, C.STITCH]);
  assert.deepEqual(s[5], [7, 7, C.END]);
});

/* ------------------------------ unit-level ----------------------------- */

test("add / updateNeedlePosition / declareNotTrimmed", () => {
  const t = new Transcoder();
  t.destinationPattern = new EmbPattern();
  t.add(C.STOP); // no coords -> needle (0, 0)
  t.updateNeedlePosition(4, 5);
  t.add(C.STOP);
  t.add(C.TRIM, 9, 9);
  assert.deepEqual(t.destinationPattern.stitches, [
    [0, 0, C.STOP],
    [4, 5, C.STOP],
    [9, 9, C.TRIM],
  ]);

  assert.equal(t.colorIndex, -1);
  t.declareNotTrimmed();
  assert.equal(t.stateTrimmed, false);
  assert.equal(t.colorIndex, 0); // -1 -> 0
  t.colorIndex = 7;
  t.declareNotTrimmed(); // already untrimmed -> no-op
  assert.equal(t.colorIndex, 7);
});

test("colorChangeHere emits COLOR_CHANGE, bumps color_index, marks trimmed", () => {
  const t = new Transcoder();
  t.destinationPattern = new EmbPattern();
  t.colorIndex = 0;
  t.stateTrimmed = false;
  t.colorChangeHere();
  assert.deepEqual(t.destinationPattern.stitches, [[0, 0, C.COLOR_CHANGE]]);
  assert.equal(t.colorIndex, 1);
  assert.equal(t.stateTrimmed, true);
});

test("positionWillExceedConstraint uses max_stitch and the raw stitch", () => {
  const t = new Transcoder({ max_stitch: 5 });
  t.needleX = 0;
  t.needleY = 0;
  t.stitch = [10, 0, C.STITCH];
  assert.equal(t.positionWillExceedConstraint(), true); // |10| > 5
  assert.equal(t.positionWillExceedConstraint(20), false);
  assert.equal(t.positionWillExceedConstraint(undefined, 3, 4), false);
  assert.equal(t.positionWillExceedConstraint(undefined, 9, 0), true);
  // python: `if new_x is None or new_y is None` -> BOTH are recomputed
  // from self.stitch, so the lone `3` is discarded.
  assert.equal(t.positionWillExceedConstraint(undefined, 3), true);
});

/* --------------------------- getNormalizedPattern ----------------------- */

test("EmbPattern.getNormalizedPattern transcodes into a fresh pattern", () => {
  const p = new EmbPattern();
  const thread = new EmbThread();
  thread.setColor(1, 2, 3);
  p.addThread(thread);
  p.metadata("name", "Flowers");
  p.stitchAbs(1, 2);
  p.stitch(3, 4); // (4, 6)
  const before = p.stitches.map((s) => [...s] as [number, number, number]);

  const n = p.getNormalizedPattern({ scale: 2 });
  assert.deepEqual(n.stitches, [
    [2, 4, C.STITCH],
    [8, 12, C.STITCH],
    [8, 12, C.END],
  ]);
  assert.deepEqual(p.stitches, before); // source untouched
  assert.equal(n.threadlist[0], thread); // threads shared by reference
  assert.equal(n.getMetadata("name"), "Flowers");

  const n2 = p.getNormalizedPattern(); // defaults == identity matrix
  assert.deepEqual(n2.stitches, [
    [1, 2, C.STITCH],
    [4, 6, C.STITCH],
    [4, 6, C.END],
  ]);
});
