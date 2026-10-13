/** Port of pyembroidery's EmbPattern. Stitches are absolute [x, y, command], in 0.1 mm. */
import { EmbConstant, type Command } from "./constants.js";
import { EmbThread } from "./thread.js";
import { pyRound } from "./utils.js";
import { Transcoder, type EncoderSettings } from "./encoder.js";

/** Value equality: PES v6 reads equal threads as separate objects. */
function sameThread(a: EmbThread, b: EmbThread): boolean {
  return (
    a === b ||
    ((a.color & 0xffffff) === (b.color & 0xffffff) &&
      a.description === b.description &&
      a.catalog_number === b.catalog_number &&
      a.details === b.details &&
      a.brand === b.brand &&
      a.chart === b.chart &&
      a.weight === b.weight)
  );
}

export type Stitch = [number, number, Command | number];

export type StitchBlock = [Stitch[], EmbThread];

export interface Threadthread {
  name?: string;
  description?: string;
  desc?: string;
  brand?: string;
  manufacturer?: string;
  color?: number | string | [number, number, number];
  rgb?: number | string | [number, number, number];
  hex?: string;
  id?: string;
  catalog?: string;
}

export interface Extents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Data apps attach to a pattern, by key; readers also store file metadata here. Add typed keys with
 */
export interface PatternExtras {
  [key: string]: unknown;
  [key: number]: unknown;
}

export class EmbPattern {
  stitches: Stitch[] = [];
  threadlist: EmbThread[] = [];
  extras: PatternExtras = {};
  _previousX = 0;
  _previousY = 0;

  move(dx = 0, dy = 0): void {
    this.addStitchRelative(EmbConstant.JUMP, dx, dy);
  }

  moveAbs(x: number, y: number): void {
    this.addStitchAbsolute(EmbConstant.JUMP, x, y);
  }

  stitch(dx = 0, dy = 0): void {
    this.addStitchRelative(EmbConstant.STITCH, dx, dy);
  }

  stitchAbs(x: number, y: number): void {
    this.addStitchAbsolute(EmbConstant.STITCH, x, y);
  }

  stop(dx = 0, dy = 0): void {
    this.addStitchRelative(EmbConstant.STOP, dx, dy);
  }

  trim(dx = 0, dy = 0): void {
    this.addStitchRelative(EmbConstant.TRIM, dx, dy);
  }

  colorChange(dx = 0, dy = 0): void {
    this.addStitchRelative(EmbConstant.COLOR_CHANGE, dx, dy);
  }

  sequinEject(dx = 0, dy = 0): void {
    this.addStitchRelative(EmbConstant.SEQUIN_EJECT, dx, dy);
  }

  sequinMode(dx = 0, dy = 0): void {
    this.addStitchRelative(EmbConstant.SEQUIN_MODE, dx, dy);
  }

  end(dx = 0, dy = 0): void {
    this.addStitchRelative(EmbConstant.END, dx, dy);
  }

  addThread(thread: EmbThread | number | Threadthread): void {
    if (thread instanceof EmbThread) {
      this.threadlist.push(thread);
      return;
    }

    const threadObject = new EmbThread();

    if (typeof thread === "number") {
      threadObject.color = thread;
      this.threadlist.push(threadObject);
      return;
    }

    if (thread.name) threadObject.description = thread.name;
    if (thread.description) threadObject.description = thread.description;
    if (thread.desc) threadObject.description = thread.desc;
    if (thread.brand) threadObject.brand = thread.brand;
    if (thread.manufacturer) threadObject.brand = thread.manufacturer;

    const color = thread.color !== undefined ? thread.color : thread.rgb;

    if (color !== undefined) {
      if (typeof color === "number") {
        threadObject.color = color;
      }
      if (typeof color === "string") {
        if (color[0] === "#") threadObject.setHexColor(color.substring(1));
      }
      if (Array.isArray(color)) {
        threadObject.color =
          ((color[0] & 0xff) << 16) |
          ((color[1] & 0xff) << 8) |
          (color[2] & 0xff);
      }
    }
    if (thread.hex) threadObject.setHexColor(thread.hex);
    if (thread.id) threadObject.catalog_number = thread.id;
    if (thread.catalog) threadObject.catalog_number = thread.catalog;

    this.threadlist.push(threadObject);
  }

  metadata(name: string | number, data: unknown): void {
    this.extras[name] = data;
  }

  getMetadata<T = unknown>(name: string | number): T | undefined {
    return this.extras[name] as T | undefined;
  }

  addStitchAbsolute(cmd: Command | number, x = 0, y = 0): void {
    this.stitches.push([x, y, cmd]);
    this._previousX = x;
    this._previousY = y;
  }

  addStitchRelative(cmd: Command | number, dx = 0, dy = 0): void {
    const x = this._previousX + dx;
    const y = this._previousY + dy;
    this.addStitchAbsolute(cmd, x, y);
  }

  addCommand(cmd: Command | number, x = 0, y = 0): void {
    this.stitches.push([x, y, cmd]);
  }

  insertStitchRelative(
    position: number,
    cmd: Command | number,
    dx = 0,
    dy = 0,
  ): void {
    if (position < 0) position += this.stitches.length;
    if (position === 0) {
      this.stitches.unshift([dx, dy, cmd]);
    } else if (position === this.stitches.length) {
      this.addStitchRelative(cmd, dx, dy);
    } else if (position > 0 && position < this.stitches.length) {
      const [x, y] = this.stitches[position - 1];
      this.stitches.splice(position, 0, [x + dx, y + dy, cmd]);
    }
  }

  addStitchblock(stitchblock: StitchBlock): void {
    const threadlist = this.threadlist;
    const block = stitchblock[0];
    const thread = stitchblock[1];
    if (
      threadlist.length === 0 ||
      thread !== threadlist[threadlist.length - 1]
    ) {
      threadlist.push(thread);
      this.addStitchRelative(EmbConstant.COLOR_BREAK);
    } else {
      this.addStitchRelative(EmbConstant.SEQUENCE_BREAK);
    }
    for (const stitch of block) {
      this.addStitchAbsolute(stitch[2], stitch[0], stitch[1]);
    }
  }

  extents(): Extents {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const stitch of this.stitches) {
      if (stitch[0] > maxX) maxX = stitch[0];
      if (stitch[0] < minX) minX = stitch[0];
      if (stitch[1] > maxY) maxY = stitch[1];
      if (stitch[1] < minY) minY = stitch[1];
    }
    return { minX, minY, maxX, maxY };
  }

  countStitchCommands(command: Command | number): number {
    let count = 0;
    for (const stitch of this.stitches) {
      if (stitch[2] === command) count += 1;
    }
    return count;
  }

  countColorChanges(): number {
    return this.countStitchCommands(EmbConstant.COLOR_CHANGE);
  }

  countStitches(): number {
    return this.stitches.length;
  }

  countThreads(): number {
    return this.threadlist.length;
  }

  getThreadOrFiller(index: number): EmbThread {
    if (this.threadlist.length <= index) {
      const thread = new EmbThread();
      thread.setColor(0, 0, 0);
      thread.description = "Filler";
      return thread;
    }
    return this.threadlist[index];
  }

  *getAsStitchblock(): Generator<StitchBlock> {
    let stitchblock: Stitch[] = [];
    let thread = this.getThreadOrFiller(0);
    let threadIndex = 1;
    let stitched = false;
    for (const stitch of this.stitches) {
      const flags = stitch[2];
      if (flags === EmbConstant.STITCH) {
        stitchblock.push(stitch);
        stitched = true;
      } else {
        if (stitchblock.length > 0) {
          yield [stitchblock, thread];
          stitchblock = [];
        }
        // Deviation from pyembroidery, which only follows COLOR_CHANGE: addStitchblock marks colors
        // with COLOR_BREAK. Like the encoder, a COLOR_BREAK before any stitch opens the first thread.
        if (
          flags === EmbConstant.COLOR_CHANGE ||
          (flags === EmbConstant.COLOR_BREAK && stitched)
        ) {
          thread = this.getThreadOrFiller(threadIndex);
          threadIndex += 1;
        }
      }
    }
    if (stitchblock.length > 0) yield [stitchblock, thread];
  }

  *getAsCommandBlocks(): Generator<Stitch[]> {
    let lastPos = 0;
    let lastCommand: Command | number = EmbConstant.NO_COMMAND;
    for (let pos = 0; pos < this.stitches.length; pos++) {
      const stitch = this.stitches[pos];
      const command = stitch[2];
      if (command === lastCommand || lastCommand === EmbConstant.NO_COMMAND) {
        lastCommand = command;
        continue;
      }
      lastCommand = command;
      yield this.stitches.slice(lastPos, pos);
      lastPos = pos;
    }
    yield this.stitches.slice(lastPos);
  }

  *getAsColorblocks(): Generator<[Stitch[], EmbThread]> {
    let threadIndex = 0;
    let lastPos = 0;
    let afterBreak = false;
    let thread: EmbThread;
    for (let pos = 0; pos < this.stitches.length; pos++) {
      const command = this.stitches[pos][2];
      // As in current pyembroidery: a COLOR_BREAK is omitted from the blocks and empty blocks are skipped.
      if (command === EmbConstant.COLOR_BREAK) {
        if (lastPos !== pos) {
          thread = this.getThreadOrFiller(threadIndex);
          threadIndex += 1;
          yield [this.stitches.slice(lastPos, pos), thread];
        }
        lastPos = pos + 1;
        afterBreak = true;
        continue;
      }
      if (command !== EmbConstant.COLOR_CHANGE) continue;
      thread = this.getThreadOrFiller(threadIndex);
      threadIndex += 1;
      yield [this.stitches.slice(lastPos, pos), thread];
      lastPos = pos;
      afterBreak = false;
    }
    if (afterBreak && lastPos === this.stitches.length) return;
    thread = this.getThreadOrFiller(threadIndex);
    yield [this.stitches.slice(lastPos), thread];
  }

  translate(dx: number, dy: number): void {
    for (const stitch of this.stitches) {
      stitch[0] += dx;
      stitch[1] += dy;
    }
  }

  fixColorCount(): void {
    let threadIndex = 0;
    let initColor = true;
    for (const stitch of this.stitches) {
      const command = stitch[2] & EmbConstant.COMMAND_MASK;
      if (command === EmbConstant.STITCH) {
        if (initColor) {
          threadIndex += 1;
          initColor = false;
        }
      } else if (
        command === EmbConstant.COLOR_CHANGE ||
        command === EmbConstant.COLOR_BREAK
      ) {
        initColor = true;
      }
    }
    while (this.threadlist.length < threadIndex) {
      this.addThread(this.getThreadOrFiller(this.threadlist.length));
    }
  }

  /**
   * Adds a TRIM before runs of `jumpsToRequireTrim` jumps, or of jumps going further than
   * `distanceToRequireTrim`, and drops runs of jumps that end where they started (with `clipping`).
   * Formats without a trim command (like DST) encode trims this way.
   */
  interpolateTrims(
    jumpsToRequireTrim: number | null = null,
    distanceToRequireTrim: number | null = null,
    clipping = true,
  ): void {
    let i = -1;
    let ie = this.stitches.length - 1;
    let x = 0;
    let y = 0;
    let jumpCount = 0;
    let jumpStart = 0;
    let jumpDx = 0;
    let jumpDy = 0;
    let jumping = false;
    let trimmed = true;
    while (i < ie) {
      i += 1;
      const stitch = this.stitches[i];
      const dx = stitch[0] - x;
      const dy = stitch[1] - y;
      [x, y] = stitch;
      const command = stitch[2] & EmbConstant.COMMAND_MASK;
      if (
        command === EmbConstant.STITCH ||
        command === EmbConstant.SEQUIN_EJECT
      ) {
        trimmed = false;
        jumping = false;
      } else if (
        command === EmbConstant.COLOR_CHANGE ||
        command === EmbConstant.TRIM
      ) {
        trimmed = true;
        jumping = false;
      }
      if (command !== EmbConstant.JUMP) continue;
      if (!jumping) {
        [jumpDx, jumpDy, jumpCount, jumpStart] = [0, 0, 0, i];
        jumping = true;
      }
      jumpCount += 1;
      jumpDx += dx;
      jumpDy += dy;
      if (
        !trimmed &&
        (jumpCount === jumpsToRequireTrim ||
          (distanceToRequireTrim !== null &&
            (Math.abs(jumpDy) > distanceToRequireTrim ||
              Math.abs(jumpDx) > distanceToRequireTrim)))
      ) {
        this.insertStitchRelative(jumpStart, EmbConstant.TRIM);
        jumpStart += 1;
        i += 1;
        ie += 1;
        trimmed = true;
      }
      if (clipping && jumpDx === 0 && jumpDy === 0) {
        // The jumps went nowhere: drop them, keeping any trim added before them.
        this.stitches.splice(jumpStart, i + 1 - jumpStart);
        i = jumpStart - 1;
        ie = this.stitches.length - 1;
      }
    }
  }

  convertDuplicateColorChangeToStop(): void {
    const newPattern = new EmbPattern();
    newPattern.addThread(this.getThreadOrFiller(0));

    let threadIndex = 0;
    for (const [x, y, command] of this.stitches) {
      if (
        command === EmbConstant.COLOR_CHANGE ||
        command === EmbConstant.COLOR_BREAK
      ) {
        threadIndex += 1;
        const thread = this.getThreadOrFiller(threadIndex);
        const last = newPattern.threadlist[newPattern.threadlist.length - 1];
        if (sameThread(thread, last)) {
          newPattern.stop();
        } else {
          newPattern.colorChange();
          newPattern.addThread(thread);
        }
      } else {
        newPattern.addStitchAbsolute(command, x, y);
      }
    }

    this.stitches = newPattern.stitches;
    this.threadlist = newPattern.threadlist;
  }

  getNormalizedPattern(encodeSettings?: EncoderSettings): EmbPattern {
    const normalPattern = new EmbPattern();
    const transcoder = new Transcoder(encodeSettings);
    transcoder.transcode(this, normalPattern);
    return normalPattern;
  }
}
