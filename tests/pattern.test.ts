import { test, expect } from "vitest";
import { EmbConstant as C, EmbPattern, EmbThread } from "../src/index.ts";
import type { Stitch } from "../src/index.ts";

function thread(r: number, g: number, b: number): EmbThread {
  const t = new EmbThread();
  t.setColor(r, g, b);
  return t;
}

test("addStitchRelative accumulates against the cursor", () => {
  const p = new EmbPattern();
  p.stitch(10, 10);
  p.stitch(5, -5);
  expect(p.stitches).toStrictEqual([
    [10, 10, C.STITCH],
    [15, 5, C.STITCH],
  ]);
  expect(p._previousX).toBe(15);
  expect(p._previousY).toBe(5);
});

test("addStitchAbsolute sets the cursor", () => {
  const p = new EmbPattern();
  p.stitchAbs(100, 200);
  p.stitch(1, 1);
  expect(p.stitches[1]).toStrictEqual([101, 201, C.STITCH]);
});

test("addCommand does NOT move the cursor", () => {
  const p = new EmbPattern();
  p.stitchAbs(10, 20);
  p.addCommand(C.SEQUENCE_BREAK, 999, 999);
  p.stitch(5, 5);
  expect(p.stitches[2]).toStrictEqual([15, 25, C.STITCH]);
  expect(p.stitches[1]).toStrictEqual([999, 999, C.SEQUENCE_BREAK]);
});

test("shorthand builders map to their commands", () => {
  const p = new EmbPattern();
  p.move(1, 2);
  p.trim();
  p.colorChange();
  p.stop();
  p.end();
  p.sequinEject();
  p.sequinMode();
  const commands = p.stitches.map((s) => s[2]);
  expect(commands).toStrictEqual([
    C.JUMP,
    C.TRIM,
    C.COLOR_CHANGE,
    C.STOP,
    C.END,
    C.SEQUIN_EJECT,
    C.SEQUIN_MODE,
  ]);
});

test("extents computes bounds over all stitches", () => {
  const p = new EmbPattern();
  p.stitchAbs(-10, 4);
  p.stitchAbs(30, -7);
  p.stitchAbs(5, 22);
  expect(p.extents()).toStrictEqual({ minX: -10, minY: -7, maxX: 30, maxY: 22 });
});

test("extents on empty pattern is +/-Infinity (python behavior)", () => {
  const p = new EmbPattern();
  expect(p.extents()).toStrictEqual({
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });
});

test("count helpers", () => {
  const p = new EmbPattern();
  p.stitch();
  p.stitch();
  p.colorChange();
  p.move();
  expect(p.countStitches()).toBe(4);
  expect(p.countColorChanges()).toBe(1);
  expect(p.countStitchCommands(C.STITCH)).toBe(2);
  expect(p.countStitchCommands(C.JUMP)).toBe(1);
});

test("addThread with an EmbThread instance", () => {
  const p = new EmbPattern();
  const t = thread(1, 2, 3);
  p.addThread(t);
  expect(p.threadlist.length).toBe(1);
  expect(p.threadlist[0]).toBe(t);
});

test("addThread with a packed color number", () => {
  const p = new EmbPattern();
  p.addThread(0x123456);
  expect(p.threadlist[0].color).toBe(0x123456);
});

test("addThread with an object spec", () => {
  const p = new EmbPattern();
  p.addThread({ name: "n", brand: "b", hex: "#112233", id: "7" });
  const t = p.threadlist[0];
  expect(t.description).toBe("n");
  expect(t.brand).toBe("b");
  expect(t.color).toBe(0x112233);
  expect(t.catalog_number).toBe("7");
});

test("addThread object spec: desc/manufacturer/rgb tuple variants", () => {
  const p = new EmbPattern();
  p.addThread({ desc: "d", manufacturer: "m", rgb: [1, 2, 3] });
  expect(p.threadlist[0].description).toBe("d");
  expect(p.threadlist[0].brand).toBe("m");
  expect(p.threadlist[0].color).toBe(0x010203);
});

test("addThread object spec: color string '#rrggbb'", () => {
  const p = new EmbPattern();
  p.addThread({ color: "#aabbcc" });
  expect(p.threadlist[0].color).toBe(0xaabbcc);
});

test("metadata round-trip with getMetadata default", () => {
  const p = new EmbPattern();
  p.metadata("name", "Flowers");
  expect(p.getMetadata("name")).toBe("Flowers");
  expect(p.getMetadata("missing", "fallback")).toBe("fallback");
  expect(p.getMetadata("missing")).toBe(undefined);
});

test("getThreadOrFiller returns stored thread when present", () => {
  const p = new EmbPattern();
  const t = thread(9, 9, 9);
  p.addThread(t);
  expect(p.getThreadOrFiller(0)).toBe(t);
});

test("filler thread is deterministic black but a FRESH instance each call", () => {
  const p = new EmbPattern();
  const a = p.getThreadOrFiller(0);
  const b = p.getThreadOrFiller(0);
  expect(a.hexColor()).toBe("#000000");
  expect(b.hexColor()).toBe("#000000");
  expect(a).not.toBe(b);
});

function patternWithColors(): EmbPattern {
  const p = new EmbPattern();
  p.addThread(thread(255, 0, 0));
  p.addThread(thread(0, 255, 0));
  p.stitchAbs(0, 0);
  p.stitch(10, 0);
  p.colorChange();
  p.stitch(0, 10);
  p.trim();
  p.stitch(10, 10);
  return p;
}

test("getAsStitchblock splits runs on non-stitch commands and swaps thread", () => {
  const p = patternWithColors();
  const blocks = [...p.getAsStitchblock()];
  expect(blocks.length).toBe(3);
  expect(blocks[0][0].length).toBe(2);
  expect(blocks[0][1].hexColor()).toBe("#ff0000");
  expect(blocks[1][0].length).toBe(1);
  expect(blocks[1][1].hexColor()).toBe("#00ff00");
  expect(blocks[2][0].length).toBe(1);
  expect(blocks[2][1].hexColor()).toBe("#00ff00");
});

test("getAsStitchblock on empty pattern yields nothing", () => {
  const p = new EmbPattern();
  expect([...p.getAsStitchblock()]).toStrictEqual([]);
});

test("getAsCommandBlocks groups by command transitions", () => {
  const p = patternWithColors();
  const blocks = [...p.getAsCommandBlocks()];
  expect(blocks.length).toBe(5);
  expect(blocks[0].length).toBe(2);
  expect(blocks[1].length).toBe(1);
  expect(blocks[1][0][2]).toBe(C.COLOR_CHANGE);
});

test("getAsColorblocks splits at COLOR_CHANGE with threads", () => {
  const p = patternWithColors();
  const blocks = [...p.getAsColorblocks()];
  expect(blocks.length).toBe(2);
  expect(blocks[0][0].length).toBe(2);
  expect(blocks[0][1].hexColor()).toBe("#ff0000");
  expect(blocks[1][0].length).toBe(4);
  expect(blocks[1][0][0][2]).toBe(C.COLOR_CHANGE);
  expect(blocks[1][1].hexColor()).toBe("#00ff00");
});

test("convertDuplicateColorChangeToStop: different thread keeps COLOR_CHANGE", () => {
  const p = patternWithColors();
  p.convertDuplicateColorChangeToStop();
  const commands = p.stitches.map((s) => s[2]);
  expect(commands.includes(C.COLOR_CHANGE)).toBeTruthy();
  expect(!commands.includes(C.STOP)).toBeTruthy();
  expect(p.threadlist.length).toBe(2);
});

test("convertDuplicateColorChangeToStop: duplicate thread becomes STOP", () => {
  const p = new EmbPattern();
  const t = thread(1, 2, 3);
  p.addThread(t);
  p.addThread(t);
  p.stitchAbs(0, 0);
  p.colorChange();
  p.stitch(5, 5);
  p.convertDuplicateColorChangeToStop();
  const commands = p.stitches.map((s) => s[2]);
  expect(commands.includes(C.STOP)).toBeTruthy();
  expect(!commands.includes(C.COLOR_CHANGE)).toBeTruthy();
});

test("convertStopToColorChange adds threads", () => {
  const p = new EmbPattern();
  p.addThread(thread(1, 2, 3));
  p.stitchAbs(0, 0);
  p.stop();
  p.stitch(5, 5);
  p.convertStopToColorChange();
  const commands = p.stitches.map((s) => s[2]);
  expect(commands.includes(C.COLOR_CHANGE)).toBeTruthy();
  expect(!commands.includes(C.STOP)).toBeTruthy();
  expect(p.threadlist.length).toBe(2);
});

test("convertJumpsToTrim: jump run of >= 3 gets a TRIM, one merged JUMP left", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.move(1, 0);
  p.move(1, 0);
  p.move(1, 0);
  p.stitch(1, 0);
  p.convertJumpsToTrim(3);
  const commands = p.stitches.map((s) => s[2]);
  expect(commands).toStrictEqual([C.STITCH, C.TRIM, C.JUMP, C.STITCH]);
});

test("convertJumpsToTrim: short jump run is kept as one jump", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.move(1, 0);
  p.move(1, 0);
  p.stitch(1, 0);
  p.convertJumpsToTrim(3);
  const jumps = p.stitches.filter((s) => s[2] === C.JUMP);
  expect(jumps.length).toBe(1);
});

test("translate moves every stitch", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.stitch(5, 5);
  p.translate(10, -3);
  expect(p.stitches[0]).toStrictEqual([10, -3, C.STITCH]);
  expect(p.stitches[1]).toStrictEqual([15, 2, C.STITCH]);
});

test("moveCenterToOrigin centers extents on (0,0) with python rounding", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.stitchAbs(10, 10);
  p.moveCenterToOrigin();
  expect(p.extents()).toStrictEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 });

  const offset = new EmbPattern();
  offset.stitchAbs(100, 200);
  offset.stitchAbs(110, 220);
  offset.moveCenterToOrigin();
  expect(offset.extents()).toStrictEqual({ minX: -5, minY: -10, maxX: 5, maxY: 10 });
});

test("getSingletonThreadlist keeps only changed threads", () => {
  const p = new EmbPattern();
  const a = thread(1, 1, 1);
  const b = thread(2, 2, 2);
  p.addThread(a);
  p.addThread(a);
  p.addThread(b);
  expect(p.getSingletonThreadlist()).toStrictEqual([a, b]);
  expect(p.getUniqueThreadlist().length).toBe(2);
});

test("addStitchblock emits COLOR_BREAK for a new thread", () => {
  const p = new EmbPattern();
  const t = thread(5, 5, 5);
  const block: Stitch[] = [
    [0, 0, C.STITCH],
    [10, 0, C.STITCH],
  ];
  p.addStitchblock([block, t]);
  expect(p.stitches[0][2]).toBe(C.COLOR_BREAK);
  expect(p.stitches[1][2]).toBe(C.STITCH);
  expect(p.stitches[2][0]).toBe(10);
  expect(p.threadlist[0]).toBe(t);
});

test("addStitchblock emits SEQUENCE_BREAK for the same thread", () => {
  const p = new EmbPattern();
  const t = thread(5, 5, 5);
  const block: Stitch[] = [[0, 0, C.STITCH]];
  p.addStitchblock([block, t]);
  p.addStitchblock([[[1, 1, C.STITCH]], t]);
  expect(p.stitches[0][2]).toBe(C.COLOR_BREAK);
  const secondBlockStart = p.stitches.findIndex(
    (s, i) => i > 0 && s[2] === C.SEQUENCE_BREAK
  );
  expect(secondBlockStart > 0).toBeTruthy();
});

test("getStablePattern strips jumps/trims into breaks", () => {
  const p = new EmbPattern();
  p.addThread(thread(1, 2, 3));
  p.stitchAbs(0, 0);
  p.move(10, 10);
  p.stitch(5, 5);
  p.trim();
  p.stitch(2, 2);
  const stable = p.getStablePattern();
  const commands = stable.stitches.map((s) => s[2]);
  expect(!commands.includes(C.JUMP)).toBeTruthy();
  expect(!commands.includes(C.TRIM)).toBeTruthy();
  expect(commands[0]).toBe(C.COLOR_BREAK);
  expect(commands.filter((c) => c === C.STITCH).length).toBe(3);
});

test("getPatternMergeJumps replaces jump runs with STITCH_BREAK", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.move(1, 0);
  p.move(1, 0);
  p.stitch(1, 0);
  const merged = p.getPatternMergeJumps();
  const commands = merged.stitches.map((s) => s[2]);
  expect(commands.filter((c) => c === C.STITCH_BREAK).length).toBe(1);
  expect(!commands.includes(C.JUMP)).toBeTruthy();
});

test("fixColorCount pads threadlist to cover all color blocks", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.colorChange();
  p.stitch(1, 1);
  p.colorChange();
  p.stitch(1, 1);
  p.fixColorCount();
  expect(p.threadlist.length).toBe(3);
  p.fixColorCount();
  expect(p.threadlist.length).toBe(3);
});

test("append helpers add option/matrix commands at the cursor", () => {
  const p = new EmbPattern();
  p.stitchAbs(0, 0);
  p.appendTranslation(5, 6);
  p.appendEnableTieOn();
  p.appendEnableTieOff();
  p.appendDisableTieOn();
  p.appendDisableTieOff();
  const commands = p.stitches.map((s) => s[2]);
  expect(commands.slice(1)).toStrictEqual([
    C.MATRIX_TRANSLATE,
    C.OPTION_ENABLE_TIE_ON,
    C.OPTION_ENABLE_TIE_OFF,
    C.OPTION_DISABLE_TIE_ON,
    C.OPTION_DISABLE_TIE_OFF,
  ]);
  expect(p.stitches[1]).toStrictEqual([5, 6, C.MATRIX_TRANSLATE]);
});
