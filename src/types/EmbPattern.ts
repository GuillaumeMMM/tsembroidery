import { EmbConstant } from "./EmbConstant.js";
import { EmbThread } from "./EmbThread.js";
import { StringHelpers } from "./StringHelpers.js";

export class EmbPattern {
  public stitches: number[][] = [];
  public threadlist: EmbThread[] = [];
  public extras: {} = {};
  public _previousX: number = 0;
  public _previousY: number = 0;

  constructor() {}

  public addStitchAbsolute(cmd, x = 0, y = 0) {
    // Add a command at the absolute location: x, y"""
    this.stitches.push([x, y, cmd]);
    this._previousX = x;
    this._previousY = y;
  }

  public addStitchRelative(cmd, dx = 0, dy = 0) {
    // Add a command relative to the previous location"""
    const x = this._previousX + dx;
    const y = this._previousY + dy;
    this.addStitchAbsolute(cmd, x, y);
  }

  public stitch(dx = 0, dy = 0) {
    // Stitch dx, dy"""
    this.addStitchRelative(EmbConstant.STITCH, dx, dy);
  }

  public move(dx = 0, dy = 0) {
    // Move dx, dy"""
    this.addStitchRelative(EmbConstant.JUMP, dx, dy);
  }

  public trim(dx = 0, dy = 0) {
    // Trim dx, dy"""
    this.addStitchRelative(EmbConstant.TRIM, dx, dy);
  }

  public end(dx = 0, dy = 0) {
    // End Design dx, dy"""
    this.addStitchRelative(EmbConstant.END, dx, dy);
  }

  public stop(dx = 0, dy = 0) {
    // Stop dx, dy"""
    this.addStitchRelative(EmbConstant.STOP, dx, dy);
  }

  public colorChange(dx = 0, dy = 0) {
    // Color Change dx, dy"""
    this.addStitchRelative(EmbConstant.COLOR_CHANGE, dx, dy);
  }

  public addThread(thread: EmbThread) {
    // Adds thread to design.
    // Note: this has no effect on stitching and can be done at any point.
    let thread_object = null;
    if (thread instanceof EmbThread) {
      this.threadlist.push(thread);
    } else if (typeof thread === "number") {
      thread_object = new EmbThread();
      thread_object.color = thread;
      this.threadlist.push(thread_object);
    } else if (typeof thread === "object") {
      thread_object = new EmbThread();
      if (thread["name"]) thread_object.description = thread["name"];
      if (thread["description"])
        thread_object.description = thread["description"];
      if (thread["desc"]) thread_object.description = thread["desc"];
      if (thread["brand"]) thread_object.brand = thread["brand"];
      if (thread["manufacturer"]) thread_object.brand = thread["manufacturer"];
      if (thread["color"] || thread["rgb"]) {
        let color = null;
        try {
          color = thread["color"];
        } catch (e) {
          color = thread["rgb"];
        }
        if (typeof color === "number") thread_object.color = color;
        else if (typeof color === "string") {
          if (color == "random")
            thread_object.color =
              0xff000000 | StringHelpers.randomRangeInt(0, 0xffffff);
          if (color[0] == "#") thread_object.setHexColor(color.substring(1));
        } else if (typeof color === "object") {
          thread_object.color =
            ((color[0] & 0xff) << 16) |
            ((color[1] & 0xff) << 8) |
            (color[2] & 0xff);
        }
      }
      if (thread["hex"]) thread_object.setHexColor(thread["hex"]);
      if (thread["id"]) thread_object.catalog_number = thread["id"];
      if (thread["catalog"]) thread_object.catalog_number = thread["catalog"];
      this.threadlist.push(thread_object);
    }
  }

  public convertDuplicateColorChangeToStop() {
    // Converts color change to same thread into a STOP."""

    const new_pattern = new EmbPattern();
    new_pattern.addThread(this.getThreadOrFiller(0));

    let thread_index = 0;
    for (const [x, y, command] of this.stitches) {
      if (
        command === EmbConstant.COLOR_CHANGE ||
        command === EmbConstant.COLOR_BREAK
      ) {
        // command in (COLOR_CHANGE, COLOR_BREAK):
        thread_index += 1;
        let thread = this.getThreadOrFiller(thread_index);
        if (
          thread == new_pattern.threadlist[new_pattern.threadlist.length - 1]
        ) {
          new_pattern.stop();
        } else {
          new_pattern.colorChange();
          new_pattern.addThread(thread);
        }
      } else {
        new_pattern.addStitchAbsolute(command, x, y);
      }
    }

    this.stitches = new_pattern.stitches;
    this.threadlist = new_pattern.threadlist;
  }

  public static getRandomThread() {
    const thread = new EmbThread();
    thread.color = 0xff000000 | StringHelpers.randomRangeInt(0, 0xffffff);
    thread.description = "Random";
    return thread;
  }

  public getThreadOrFiller(index) {
    if (this.threadlist.length <= index) return EmbPattern.getRandomThread();
    else return this.threadlist[index];
  }

  public convertStopToColorChange() {
    // Convert stops to a color change to the same color."""

    const new_pattern = new EmbPattern();
    new_pattern.addThread(this.getThreadOrFiller(0));
    let thread_index = 1;

    for (let [x, y, command] of this.stitches) {
      if (
        command === EmbConstant.COLOR_CHANGE ||
        command === EmbConstant.COLOR_BREAK
      ) {
        new_pattern.addThread(this.getThreadOrFiller(thread_index));
        new_pattern.addStitchAbsolute(command, x, y);
        thread_index += 1;
      } else if (command == EmbConstant.STOP) {
        new_pattern.colorChange();
        new_pattern.addThread(this.getThreadOrFiller(thread_index));
      } else {
        new_pattern.addStitchAbsolute(command, x, y);
      }
    }

    this.stitches = new_pattern.stitches;
    this.threadlist = new_pattern.threadlist;
  }

  public metadata(name, data) {
    // Adds select metadata to design.
    // Note: this has no effect on stitching and can be done at any point.
    this.extras[name] = data;
  }

  public extents() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const stitch of this.stitches) {
      if (stitch[0] > maxX) {
        maxX = stitch[0];
      }
      if (stitch[0] < minX) {
        minX = stitch[0];
      }
      if (stitch[1] > maxY) {
        maxY = stitch[1];
      }
      if (stitch[1] < minY) {
        minY = stitch[1];
      }
    }

    return { minX, minY, maxX, maxY };
  }

  *enumerate(it, start = 0) {
    let i = start;
    for (const x of it) yield [i++, x];
  }

  public *getAsCommandBlocks() {
    let last_pos = 0;
    let last_command = EmbConstant.NO_COMMAND;
    for (let [pos, stitch] of this.enumerate(this.stitches)) {
      const command = stitch[2];
      if (command == last_command || last_command == EmbConstant.NO_COMMAND) {
        last_command = command;
        continue;
      }
      last_command = command;
      yield this.stitches.slice(last_pos, pos);
      last_pos = pos;
    }
    yield this.stitches.slice(last_pos);
  }

  public *getAsStitchblock() {
    let stitchblock = [];
    let thread = this.getThreadOrFiller(0);
    let thread_index = 1;
    for (const stitch of this.stitches) {
      const flags = stitch[2];
      if (flags == EmbConstant.STITCH) stitchblock.push(stitch);
      else {
        if (stitchblock.length > 0) {
          yield [stitchblock, thread];
          stitchblock = [];
        }
        if (flags == EmbConstant.COLOR_CHANGE) {
          thread = this.getThreadOrFiller(thread_index);
          thread_index += 1;
        }
      }
    }
    if (stitchblock.length > 0) yield [stitchblock, thread];
  }

  public *getAsColorblocks() {
    let thread_index = 0;
    let last_pos = 0;
    let thread = null;
    for (const [pos, stitch] of this.enumerate(this.stitches)) {
      if (stitch[2] != EmbConstant.COLOR_CHANGE) {
        continue;
      }
      thread = this.getThreadOrFiller(thread_index);
      thread_index += 1;
      yield [this.stitches.slice(last_pos, pos), thread];
      last_pos = pos;
    }
    thread = this.getThreadOrFiller(thread_index);
    yield [this.stitches.slice(last_pos), thread];
  }

  public appendTranslation(x: number, y: number) {
    // Appends translation to the pattern.
    // All commands will be translated by the given amount,
    // including absolute location commands."""
    this.addStitchRelative(EmbConstant.MATRIX_TRANSLATE, x, y);
  }

  public appendEnableTieOn(x = 0, y = 0) {
    // Appends enable tie on.
    // All starts of new stitching will be tied on"""
    this.addStitchRelative(EmbConstant.OPTION_ENABLE_TIE_ON, x, y);
  }

  public appendEnableTieOff(x = 0, y = 0) {
    // Appends enable tie off.
    // All ends of stitching will be tied off"""
    this.addStitchRelative(EmbConstant.OPTION_ENABLE_TIE_OFF, x, y);
  }

  public appendDisableTieOn(x = 0, y = 0) {
    // """Appends disable tie on.
    // New stitching will no longer be tied on"""
    this.addStitchRelative(EmbConstant.OPTION_DISABLE_TIE_ON, x, y);
  }

  public appendDisableTieOff(x = 0, y = 0) {
    // """Appends enable tie off.
    // Ends of stitching will no longer be tied off"""
    this.addStitchRelative(EmbConstant.OPTION_DISABLE_TIE_OFF, x, y);
  }
}
