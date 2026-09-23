/**
 * Port of pyembroidery `EmbEncoder.py` (`class Transcoder`).
 *
 * Faithful line-by-line restatement of the transcoder: the big
 * `transcode_stitches` elif chain, the tie/trim state machine, sequin
 * contingencies, on-the-fly settings commands and matrix commands.
 *
 * Deliberate divergences (marked in place):
 *  - PY-BUG: python's `CONTINGENCY_SEQUIN_JUMP` branch assigns
 *    `CONTINGENCY_SEQUIN_REMOVE` (copy-paste); we set the value the
 *    branch's name promises.
 *  - `{x, y}` objects stand in for python's `.x/.y` attribute fallback
 *    (python plain dicts would actually raise an uncaught KeyError
 *    there; in TS `{x, y}` is the natural spelling of that path).
 *  - Invalid transform settings restate python's eventual TypeError as
 *    an explicit throw (JS would otherwise silently build a NaN matrix).
 *
 * Encoder subtleties kept from python:
 *  - `pointInMatrixSpace` results: x/y are TRANSFORMED, but flags are
 *    read from the RAW `stitch[2]`; OPTION_MAX_* and MATRIX_* also read
 *    the RAW `stitch[0]/[1]`.
 *  - `interpolateGapStitches`/`lockStitch` append DIRECTLY to
 *    `destination.stitches` (not through `add`); `lockStitch` does NOT
 *    update the needle position or the trimmed state.
 *  - `tieOff` reads `source[position - 1]` — at position 0 python's
 *    negative indexing wraps to the LAST stitch.
 */
import { EmbConstant, type Command } from "./constants.js";
import type { EmbPattern, Stitch } from "./pattern.js";
import {
  getIdentity,
  getScale,
  getTranslate,
  getRotate,
  matrixMultiply,
  pointInMatrixSpace,
  distance,
  towards,
  oriented,
  type Matrix,
} from "./matrix.js";
import { pyRound } from "./pyMath.js";

// python: `from .EmbConstant import *`
const {
  NO_COMMAND,
  STITCH,
  JUMP,
  TRIM,
  STOP,
  END,
  COLOR_CHANGE,
  SEQUIN_MODE,
  SEQUIN_EJECT,
  SLOW,
  FAST,
  SEW_TO,
  NEEDLE_AT,
  STITCH_BREAK,
  SEQUENCE_BREAK,
  COLOR_BREAK,
  TIE_OFF,
  TIE_ON,
  FRAME_EJECT,
  MATRIX_TRANSLATE,
  MATRIX_SCALE,
  MATRIX_ROTATE,
  MATRIX_RESET,
  OPTION_ENABLE_TIE_ON,
  OPTION_ENABLE_TIE_OFF,
  OPTION_DISABLE_TIE_ON,
  OPTION_DISABLE_TIE_OFF,
  OPTION_MAX_STITCH_LENGTH,
  OPTION_MAX_JUMP_LENGTH,
  OPTION_EXPLICIT_TRIM,
  OPTION_IMPLICIT_TRIM,
  CONTINGENCY_NONE,
  CONTINGENCY_JUMP_NEEDLE,
  CONTINGENCY_SEW_TO,
  CONTINGENCY_SEQUIN_UTILIZE,
  CONTINGENCY_SEQUIN_JUMP,
  CONTINGENCY_SEQUIN_STITCH,
  CONTINGENCY_SEQUIN_REMOVE,
} = EmbConstant;

/** python's `[x, y]` sequence or `.x/.y` attribute object. */
export type PointLike = [number, ...number[]] | { x: number; y: number };

/** python settings dict for `Transcoder.__init__` (keys stay snake_case). */
export interface TranscoderSettings {
  max_stitch?: number;
  max_jump?: number;
  full_jump?: boolean;
  strip_sequins?: boolean;
  sequin_contingency?: number;
  strip_speeds?: boolean;
  explicit_trim?: boolean;
  tie_on?: boolean;
  tie_off?: boolean;
  long_stitch_contingency?: number;
  translate?: number | PointLike;
  scale?: number | PointLike;
  rotate?: number;
  [key: string]: unknown;
}

export class Transcoder {
  maxStitch: number;
  maxJump: number;
  fullJump: boolean;
  sequinContingency: number;
  stripSpeeds: boolean;
  explicitTrim: boolean;
  hasTieOn: boolean;
  hasTieOff: boolean;
  longStitchContingency: number;
  matrix: Matrix;
  sourcePattern: EmbPattern | null = null;
  destinationPattern: EmbPattern | null = null;
  position = 0;
  colorIndex = -1;
  stitch: Stitch | null = null;
  stateTrimmed = true;
  stateSequinMode = false;
  needleX = 0;
  needleY = 0;
  stateJumping = false;

  constructor(settings: TranscoderSettings = {}) {
    this.maxStitch = settings.max_stitch ?? Infinity;
    this.maxJump = settings.max_jump ?? Infinity;
    this.fullJump = settings.full_jump ?? false;
    const stripSequins = settings.strip_sequins ?? true;
    // python computes the strip_sequins-derived contingency first...
    let sequinContingency: number = stripSequins
      ? CONTINGENCY_SEQUIN_UTILIZE
      : CONTINGENCY_SEQUIN_JUMP;
    // ...then lets an explicit sequin_contingency setting override it.
    sequinContingency = settings.sequin_contingency ?? sequinContingency;
    this.sequinContingency = sequinContingency;

    this.stripSpeeds = settings.strip_speeds ?? true;
    this.explicitTrim = settings.explicit_trim ?? true;

    this.hasTieOn = settings.tie_on ?? false;
    this.hasTieOff = settings.tie_off ?? false;
    this.longStitchContingency =
      settings.long_stitch_contingency ?? CONTINGENCY_JUMP_NEEDLE;

    this.matrix = getIdentity();
    const translate = settings.translate;
    if (translate !== null && translate !== undefined) {
      this.applyTranslate(translate);
    }
    const scale = settings.scale;
    if (scale !== null && scale !== undefined) {
      this.applyScale(scale);
    }
    const rotate = settings.rotate;
    if (rotate !== null && rotate !== undefined) {
      if (typeof rotate !== "number") {
        // python get_rotate: `theta *= tau / 360` -> TypeError on a
        // non-number.
        throw new TypeError("rotate must be a number of degrees");
      }
      this.matrix = matrixMultiply(this.matrix, getRotate(rotate));
    }
  }

  private applyTranslate(translate: unknown): void {
    // python:
    //   try:
    //       m = get_translate(translate[0], translate[1])
    //       self.matrix = matrix_multiply(self.matrix, m)
    //   except IndexError:
    //       try:
    //           m = get_translate(translate.x, translate.y)
    //           self.matrix = matrix_multiply(self.matrix, m)
    //       except AttributeError:
    //           pass
    if (Array.isArray(translate)) {
      if (translate.length >= 2) {
        this.matrix = matrixMultiply(
          this.matrix,
          getTranslate(translate[0], translate[1])
        );
        return;
      }
      // IndexError -> `.x` -> AttributeError -> pass (arrays have no `.x`)
      const point = translate as unknown as { x?: unknown; y?: unknown };
      if (typeof point.x === "number" && typeof point.y === "number") {
        this.matrix = matrixMultiply(
          this.matrix,
          getTranslate(point.x, point.y)
        );
      }
      return;
    }
    if (typeof translate === "object") {
      // TS-side adaptation of python's `.x/.y` fallback path.
      const point = translate as { x?: unknown; y?: unknown };
      if (typeof point.x === "number" && typeof point.y === "number") {
        this.matrix = matrixMultiply(
          this.matrix,
          getTranslate(point.x, point.y)
        );
      }
      return;
    }
    // python: `translate[0]` on a scalar raises TypeError, which
    // `except IndexError` does NOT catch -> constructor crashes.
    throw new TypeError(
      "translate must be [x, y] or {x, y} (python raises TypeError for scalars here)"
    );
  }

  private applyScale(scale: unknown): void {
    // python:
    //   try:
    //       m = get_scale(scale[0], scale[1])
    //       self.matrix = matrix_multiply(self.matrix, m)
    //   except (IndexError, TypeError):
    //       try:
    //           m = get_scale(scale.x, scale.y)
    //           self.matrix = matrix_multiply(self.matrix, m)
    //       except AttributeError:
    //           m = get_scale(scale, scale)
    //           self.matrix = matrix_multiply(self.matrix, m)
    if (typeof scale === "number") {
      // scalar: TypeError -> AttributeError -> get_scale(scale, scale)
      this.matrix = matrixMultiply(this.matrix, getScale(scale, scale));
      return;
    }
    if (Array.isArray(scale)) {
      if (scale.length >= 2) {
        this.matrix = matrixMultiply(
          this.matrix,
          getScale(scale[0], scale[1])
        );
        return;
      }
      // IndexError -> `.x` -> AttributeError -> get_scale(scale, scale):
      // python feeds the LIST into matrix math and dies with TypeError.
      throw new TypeError("scale: cannot build a matrix from a short array");
    }
    if (typeof scale === "object") {
      // TS-side adaptation of python's `.x/.y` fallback path.
      const point = scale as { x?: unknown; y?: unknown };
      if (typeof point.x === "number" && typeof point.y === "number") {
        this.matrix = matrixMultiply(this.matrix, getScale(point.x, point.y));
        return;
      }
      // python: dict -> uncaught KeyError; other objects -> AttributeError
      // -> get_scale(scale, scale) -> TypeError in matrix math.
      throw new TypeError("scale: cannot build a matrix from this value");
    }
    // python: boolean/other -> get_scale(v, v) -> TypeError in matrix math
    throw new TypeError("scale: cannot build a matrix from this value");
  }

  transcode(sourcePattern: EmbPattern, destinationPattern: EmbPattern): EmbPattern {
    this.sourcePattern = sourcePattern;
    this.destinationPattern = destinationPattern;
    this.transcodeMetadata();
    this.transcodeThreads();
    this.transcodeStitches();
    return destinationPattern;
  }

  /** Transcodes metadata, (just moves). */
  transcodeMetadata(): void {
    const source = this.sourcePattern!.extras;
    const dest = this.destinationPattern!.extras;
    Object.assign(dest, source);
  }

  /** Transcodes threads, (just moves). */
  transcodeThreads(): void {
    const source = this.sourcePattern!.threadlist;
    const dest = this.destinationPattern!.threadlist;
    dest.push(...source);
  }

  /**
   * Transcodes stitches.
   * Converts middle-level commands and potentially incompatible
   * commands into a format friendly low level commands.
   */
  transcodeStitches(): void {
    const source = this.sourcePattern!.stitches;
    this.stateTrimmed = true;
    this.needleX = 0;
    this.needleY = 0;
    this.position = 0;
    this.colorIndex = -1;

    let flags: Command | number = NO_COMMAND;
    // python: `for self.position, self.stitch in enumerate(source)` —
    // after a normal pass `position` stays on the LAST stitch (unlike a
    // C-style for), so entries() preserves that observable behavior.
    for (const [index, stitch] of source.entries()) {
      this.position = index;
      this.stitch = stitch;
      const p = pointInMatrixSpace(this.matrix, stitch);
      const x = p[0];
      const y = p[1];
      flags = stitch[2]; // flags come from the RAW stitch

      if (flags === NO_COMMAND) {
        continue;
      } else if (flags === STITCH) {
        if (this.stateTrimmed) {
          this.jumpToWithinStitchrange(x, y);
          this.stitchAt(x, y);
          if (this.hasTieOn) this.tieOn();
        } else if (this.stateJumping) {
          this.needleTo(x, y);
          this.stateJumping = false;
        } else {
          this.stitchWithContingency(x, y);
        }
      } else if (flags === NEEDLE_AT) {
        if (this.stateTrimmed) {
          this.jumpToWithinStitchrange(x, y);
          this.stitchAt(x, y);
          if (this.hasTieOn) this.tieOn();
        } else if (this.stateJumping) {
          this.needleTo(x, y);
          this.stateJumping = false;
        } else {
          this.needleTo(x, y);
        }
      } else if (flags === SEW_TO) {
        if (this.stateTrimmed) {
          this.jumpToWithinStitchrange(x, y);
          this.stitchAt(x, y);
          if (this.hasTieOn) this.tieOn();
        } else if (this.stateJumping) {
          this.needleTo(x, y);
          this.stateJumping = false;
        } else {
          this.sewTo(x, y);
        }

        // Middle Level Commands.
      } else if (flags === STITCH_BREAK) {
        this.stateJumping = true;
      } else if (flags === FRAME_EJECT) {
        this.tieOffAndTrimIfNeeded();
        this.jumpTo(x, y);
        this.stopHere();
      } else if (flags === SEQUENCE_BREAK) {
        this.tieOffAndTrimIfNeeded();
      } else if (flags === COLOR_BREAK) {
        this.colorBreak();
      } else if (flags === TIE_OFF) {
        this.tieOff();
      } else if (flags === TIE_ON) {
        this.tieOn();

        // Core Commands.
      } else if (flags === TRIM) {
        this.tieOffAndTrimIfNeeded();
      } else if (flags === JUMP) {
        if (!this.stateJumping) {
          this.jumpTo(x, y);
        }
      } else if (flags === SEQUIN_MODE) {
        this.toggleSequins();
      } else if (flags === SEQUIN_EJECT) {
        if (this.stateTrimmed) {
          this.jumpToWithinStitchrange(x, y);
          this.stitchAt(x, y);
          if (this.hasTieOn) this.tieOn();
        }
        if (!this.stateSequinMode) this.toggleSequins();
        this.sequinAt(x, y);
      } else if (flags === COLOR_CHANGE) {
        this.tieOffTrimColorChange();
        // If we are told to do something we do it.
        // Even if it's the first command and makes no sense.
      } else if (flags === STOP) {
        this.stopHere();
      } else if (flags === SLOW) {
        this.slowCommandHere();
      } else if (flags === FAST) {
        this.fastCommandHere();
      } else if (flags === END) {
        this.endHere();
        break;

        // On-the-fly Settings Commands.
      } else if (flags === OPTION_ENABLE_TIE_ON) {
        this.hasTieOn = true;
      } else if (flags === OPTION_ENABLE_TIE_OFF) {
        this.hasTieOff = true;
      } else if (flags === OPTION_DISABLE_TIE_ON) {
        this.hasTieOn = false;
      } else if (flags === OPTION_DISABLE_TIE_OFF) {
        this.hasTieOff = false;
      } else if (flags === OPTION_MAX_JUMP_LENGTH) {
        this.maxJump = stitch[0]; // RAW stitch coordinate
      } else if (flags === OPTION_MAX_STITCH_LENGTH) {
        this.maxStitch = stitch[0]; // RAW stitch coordinate
      } else if (flags === OPTION_EXPLICIT_TRIM) {
        this.explicitTrim = true;
      } else if (flags === OPTION_IMPLICIT_TRIM) {
        this.explicitTrim = false;
      } else if (flags === CONTINGENCY_NONE) {
        this.longStitchContingency = CONTINGENCY_NONE;
      } else if (flags === CONTINGENCY_JUMP_NEEDLE) {
        this.longStitchContingency = CONTINGENCY_JUMP_NEEDLE;
      } else if (flags === CONTINGENCY_SEW_TO) {
        this.longStitchContingency = CONTINGENCY_SEW_TO;
      } else if (flags === CONTINGENCY_SEQUIN_REMOVE) {
        if (this.stateSequinMode) this.toggleSequins(); // turn it off
        this.sequinContingency = CONTINGENCY_SEQUIN_REMOVE;
      } else if (flags === CONTINGENCY_SEQUIN_STITCH) {
        if (this.stateSequinMode) this.toggleSequins(); // turn it off
        this.sequinContingency = CONTINGENCY_SEQUIN_STITCH;
      } else if (flags === CONTINGENCY_SEQUIN_JUMP) {
        if (this.stateSequinMode) this.toggleSequins(); // turn it off
        // PY-BUG: python reads
        //     elif flags == CONTINGENCY_SEQUIN_JUMP:
        //         if self.state_sequin_mode:
        //             self.toggle_sequins()
        //         self.sequin_contingency = CONTINGENCY_SEQUIN_REMOVE
        // The last line is copy-pasted from the CONTINGENCY_SEQUIN_REMOVE
        // branch above; this branch handles CONTINGENCY_SEQUIN_JUMP, so it
        // must set CONTINGENCY_SEQUIN_JUMP.
        this.sequinContingency = CONTINGENCY_SEQUIN_JUMP;
      } else if (flags === CONTINGENCY_SEQUIN_UTILIZE) {
        // NB: python's UTILIZE branch (unlike REMOVE/STITCH/JUMP) never
        // closes a running sequin mode — restated as-is.
        this.sequinContingency = CONTINGENCY_SEQUIN_UTILIZE;
      } else if (flags === MATRIX_TRANSLATE) {
        this.matrix = matrixMultiply(
          this.matrix,
          getTranslate(stitch[0], stitch[1]) // RAW stitch coordinates
        );
      } else if (flags === MATRIX_SCALE) {
        this.matrix = matrixMultiply(
          this.matrix,
          getScale(stitch[0], stitch[1]) // RAW stitch coordinates
        );
      } else if (flags === MATRIX_ROTATE) {
        this.matrix = matrixMultiply(
          this.matrix,
          getRotate(stitch[0]) // RAW stitch coordinate
        );
      } else if (flags === MATRIX_RESET) {
        this.matrix = getIdentity();
      }
    }
    if (flags !== END) {
      this.endHere();
    }
  }

  updateNeedlePosition(x: number, y: number): void {
    this.needleX = x;
    this.needleY = y;
  }

  declareNotTrimmed(): void {
    if (this.stateTrimmed) {
      this.stateTrimmed = false;
      if (this.colorIndex === -1) {
        this.colorIndex = 0;
      }
    }
  }

  add(flags: Command | number, x: number | null = null, y: number | null = null): void {
    const ax = x === null ? this.needleX : x;
    const ay = y === null ? this.needleY : y;
    // python appends straight to the list — the destination's
    // _previousX/_previousY cursor is deliberately NOT touched.
    this.destinationPattern!.stitches.push([ax, ay, flags]);
  }

  /**
   * Looks forward from current position and
   * determines if anymore stitching will occur.
   */
  lookaheadStitch(): boolean {
    const source = this.sourcePattern!.stitches;
    for (let pos = this.position; pos < source.length; pos++) {
      const flags = source[pos][2];
      if (
        flags === STITCH ||
        flags === NEEDLE_AT ||
        flags === SEW_TO ||
        flags === TIE_ON ||
        flags === SEQUIN_EJECT
      ) {
        return true;
      } else if (flags === END) {
        return false;
      }
    }
    return false;
  }

  /** Implements color break. Should add color changes add needed only. */
  colorBreak(): void {
    if (this.colorIndex < 0) {
      // We haven't stitched anything, colorbreak happens, before start.
      // Ignore.
      return;
    }
    if (!this.stateTrimmed) {
      if (this.hasTieOff) this.tieOff();
      if (this.explicitTrim) this.trimHere();
    }
    if (!this.lookaheadStitch()) {
      // No more stitching will happen, colorchange unneeded.
      return;
    }
    this.add(COLOR_CHANGE);
    this.colorIndex += 1;
    this.stateTrimmed = true;
  }

  tieOffTrimColorChange(): void {
    if (!this.stateTrimmed) {
      if (this.hasTieOff) this.tieOff();
      if (this.explicitTrim) this.trimHere();
    }
    this.add(COLOR_CHANGE);
    this.colorIndex += 1;
    this.stateTrimmed = true;
  }

  tieOffAndTrimIfNeeded(): void {
    if (!this.stateTrimmed) {
      this.tieOffAndTrim();
    }
  }

  tieOffAndTrim(): void {
    if (this.hasTieOff) this.tieOff();
    this.trimHere();
  }

  tieOff(): void {
    const source = this.sourcePattern!.stitches;
    // python: `stitches[self.position - 1]` — at position 0 python's
    // negative indexing wraps to the LAST stitch of the source.
    let index = this.position - 1;
    if (index < 0) index = source.length + index;
    const previous = index >= 0 ? source[index] : undefined;
    if (previous === undefined) {
      return; // python IndexError -> pass (must be an island stitch)
    }
    const b = pointInMatrixSpace(this.matrix, previous);
    const flags = b[2] as Command | number;
    if (
      flags === STITCH ||
      flags === NEEDLE_AT ||
      flags === SEW_TO ||
      flags === SEQUIN_EJECT
    ) {
      this.lockStitch(this.needleX, this.needleY, b[0], b[1], this.maxStitch);
    }
  }

  tieOn(): void {
    const source = this.sourcePattern!.stitches;
    const next = source[this.position + 1];
    if (next === undefined) {
      return; // python IndexError -> pass (must be an island stitch)
    }
    const b = pointInMatrixSpace(this.matrix, next);
    const flags = b[2] as Command | number;
    if (
      flags === STITCH ||
      flags === NEEDLE_AT ||
      flags === SEW_TO ||
      flags === SEQUIN_EJECT
    ) {
      this.lockStitch(this.needleX, this.needleY, b[0], b[1], this.maxStitch);
    }
  }

  trimHere(): void {
    if (this.stateSequinMode) {
      // Can't trim in sequin mode. DST uses jumps to trigger sequin
      // eject and to trim.
      this.toggleSequins();
    }
    this.add(TRIM);
    this.stateTrimmed = true;
  }

  /**
   * Sequin mode toggle can be called whenever but will only actually
   * turn on if set to utilize mode for the sequin contingency.
   */
  toggleSequins(): void {
    const contingency = this.sequinContingency;
    if (contingency === CONTINGENCY_SEQUIN_UTILIZE) {
      this.add(SEQUIN_MODE);
      this.stateSequinMode = !this.stateSequinMode;
    }
  }

  /**
   * Jumps close enough to stitch a position in x,y
   * without violating the length constraints.
   */
  jumpToWithinStitchrange(newX: number, newY: number): void {
    const x0 = this.needleX;
    const y0 = this.needleY;
    const maxLength = this.maxJump;
    this.interpolateGapStitches(x0, y0, newX, newY, maxLength, JUMP);
    if (this.fullJump) {
      if (this.needleX !== newX || this.needleY !== newY) {
        this.jumpAt(newX, newY);
      }
    }
    // We are currently assuming that max_jump is also max_stitch.
    // Properly it might be the case that some format could require
    // a split constraint here where we would need to jump further
    // so that we could then stitch closer.
  }

  jumpTo(newX: number, newY: number): void {
    const x0 = this.needleX;
    const y0 = this.needleY;
    const maxLength = this.maxJump;
    this.interpolateGapStitches(x0, y0, newX, newY, maxLength, JUMP);
    this.jumpAt(newX, newY);
  }

  jumpAt(newX: number, newY: number): void {
    if (this.stateSequinMode) {
      this.toggleSequins(); // can't jump with sequin mode on.
    }
    this.add(JUMP, newX, newY);
    this.updateNeedlePosition(newX, newY);
  }

  stitchWithContingency(newX: number, newY: number): void {
    if (this.longStitchContingency === CONTINGENCY_SEW_TO) {
      this.sewTo(newX, newY);
    } else if (this.longStitchContingency === CONTINGENCY_JUMP_NEEDLE) {
      this.needleTo(newX, newY);
    } else {
      this.stitchAt(newX, newY);
    }
  }

  /**
   * Stitches to a specific location, with the emphasis on sewing.
   * Subdivides long stitches into additional stitches.
   */
  sewTo(newX: number, newY: number): void {
    const x0 = this.needleX;
    const y0 = this.needleY;
    const maxLength = this.maxStitch;
    this.interpolateGapStitches(x0, y0, newX, newY, maxLength, STITCH);
    this.stitchAt(newX, newY);
  }

  /**
   * Insert needle at specific location, emphasis on the needle.
   * Uses jumps to avoid needle penetrations where possible.
   *
   * The limit here is the max stitch limit or jump threshold.
   * If jump threshold is set low, it will insert jumps even
   * between stitches it could have technically encoded values for.
   *
   * Stitches to the new location, adding jumps if needed.
   */
  needleTo(newX: number, newY: number): void {
    const x0 = this.needleX;
    const y0 = this.needleY;
    const maxLength = this.maxStitch;
    this.interpolateGapStitches(x0, y0, newX, newY, maxLength, JUMP);
    this.stitchAt(newX, newY);
  }

  /**
   * Inserts a stitch at the specific location.
   * Should have already been checked for constraints.
   */
  stitchAt(newX: number, newY: number): void {
    this.add(STITCH, newX, newY);
    this.updateNeedlePosition(newX, newY);
    this.declareNotTrimmed();
  }

  sequinAt(newX: number, newY: number): void {
    const contingency = this.sequinContingency;
    if (contingency === CONTINGENCY_SEQUIN_UTILIZE) {
      this.add(SEQUIN_EJECT, newX, newY);
    } else if (contingency === CONTINGENCY_SEQUIN_JUMP) {
      this.add(JUMP, newX, newY);
    } else if (contingency === CONTINGENCY_SEQUIN_STITCH) {
      this.add(STITCH, newX, newY);
    } else if (contingency === CONTINGENCY_SEQUIN_REMOVE) {
      // Do not update the needle position or declare untrimmed.
      return;
    }
    this.updateNeedlePosition(newX, newY);
    this.declareNotTrimmed();
  }

  slowCommandHere(): void {
    if (!this.stripSpeeds) {
      this.add(SLOW);
    }
  }

  fastCommandHere(): void {
    if (!this.stripSpeeds) {
      this.add(FAST);
    }
  }

  stopHere(): void {
    this.add(STOP);
    this.stateTrimmed = true;
  }

  endHere(): void {
    this.add(END);
    this.stateTrimmed = true;
  }

  colorChangeHere(): void {
    this.add(COLOR_CHANGE);
    this.colorIndex += 1;
    this.stateTrimmed = true;
  }

  /**
   * Check if the stitch is too long before trying to deal with it.
   * (python: if EITHER new_x or new_y is None, BOTH are recomputed
   * from the raw `self.stitch[0], self.stitch[1]`.)
   */
  positionWillExceedConstraint(
    length: number | null = null,
    newX: number | null = null,
    newY: number | null = null
  ): boolean {
    const limit = length === null ? this.maxStitch : length;
    if (newX === null || newY === null) {
      const stitch = this.stitch!;
      const p = pointInMatrixSpace(this.matrix, stitch[0], stitch[1]);
      newX = p[0] as number;
      newY = p[1] as number;
    }
    const distanceX = newX - this.needleX;
    const distanceY = newY - this.needleY;
    return Math.abs(distanceX) > limit || Math.abs(distanceY) > limit;
  }

  /**
   * Command sequence line to x, y, respecting length as maximum.
   * This does not arrive_at, it steps to within striking distance.
   * The next step can arrive at (x, y) without violating constraint.
   * If these are already in range, this command will do nothing.
   *
   * returns the last stitch interpolated by the code.
   * (python returns it; TS: the needle position IS that stitch.)
   */
  interpolateGapStitches(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    maxLength: number,
    data: Command | number
  ): void {
    const transcode = this.destinationPattern!.stitches;
    const distanceX = x1 - x0;
    const distanceY = y1 - y0;
    if (Math.abs(distanceX) > maxLength || Math.abs(distanceY) > maxLength) {
      if (data === JUMP && this.stateSequinMode) {
        this.toggleSequins(); // can't jump with sequin mode on.
      }

      const stepsX = Math.ceil(Math.abs(distanceX / (maxLength * 1.0)));
      const stepsY = Math.ceil(Math.abs(distanceY / (maxLength * 1.0)));
      const steps = stepsX > stepsY ? stepsX : stepsY;
      const stepSizeX = distanceX / steps;
      const stepSizeY = distanceY / steps;
      let qx = x0;
      let qy = y0;
      for (let q = 1; q < steps; q++) {
        // we need the gap stitches only, not start or end stitch.
        qx += stepSizeX;
        qy += stepSizeY;
        const stitch: Stitch = [pyRound(qx), pyRound(qy), data];
        transcode.push(stitch);
        this.updateNeedlePosition(stitch[0], stitch[1]);
      }
    }
  }

  /**
   * Tie-on, Tie-off. Lock stitch from current location towards
   * anchor location. Ends again at lock location. May not exceed
   * max_length in the process.
   *
   * Appends DIRECTLY to the destination stitches: no needle update, no
   * declare_not_trimmed, float coordinates kept (python never rounds).
   */
  lockStitch(
    x: number,
    y: number,
    anchorX: number,
    anchorY: number,
    maxLength: number | null = null
  ): void {
    const limit = maxLength === null ? this.maxStitch : maxLength;
    const transcode = this.destinationPattern!.stitches;
    let length = distance(x, y, anchorX, anchorY);
    if (length > limit) {
      const p = oriented(x, y, anchorX, anchorY, limit);
      anchorX = p[0];
      anchorY = p[1];
    }
    for (const amount of [0.33, 0.66, 0.33, 0]) {
      transcode.push([
        towards(x, anchorX, amount),
        towards(y, anchorY, amount),
        STITCH,
      ]);
    }
  }
}
