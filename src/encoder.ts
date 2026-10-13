import { EmbConstant, type Command } from "./constants.js";
import { pyRound } from "./utils.js";
import type { EmbPattern, Stitch } from "./pattern.js";

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
  STITCH_BREAK,
  SEQUENCE_BREAK,
  COLOR_BREAK,
  CONTINGENCY_SEQUIN_UTILIZE,
  CONTINGENCY_SEQUIN_JUMP,
  CONTINGENCY_SEQUIN_STITCH,
  CONTINGENCY_SEQUIN_REMOVE,
} = EmbConstant;

export interface EncoderSettings {
  max_stitch?: number;
  max_jump?: number;
  full_jump?: boolean;
  round?: boolean;
  strip_sequins?: boolean;
  sequin_contingency?: number;
  strip_speeds?: boolean;
  explicit_trim?: boolean;
  tie_on?: boolean;
  tie_off?: boolean;
}

function distance(x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return Math.sqrt(dx * dx + dy * dy);
}

function towards(a: number, b: number, amount: number): number {
  return amount * (b - a) + a;
}

function oriented(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): [number, number] {
  const radians = Math.atan2(y1 - y0, x1 - x0);
  return [x0 + r * Math.cos(radians), y0 + r * Math.sin(radians)];
}

const BREAKS = new Set<number>([
  JUMP,
  TRIM,
  STOP,
  END,
  COLOR_CHANGE,
  STITCH_BREAK,
  SEQUENCE_BREAK,
  COLOR_BREAK,
]);

export class Transcoder {
  maxStitch: number;
  maxJump: number;
  fullJump: boolean;
  round: boolean;
  sequinContingency: number;
  stripSpeeds: boolean;
  explicitTrim: boolean;
  hasTieOn: boolean;
  hasTieOff: boolean;
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

  constructor(settings: EncoderSettings = {}) {
    this.maxStitch = settings.max_stitch ?? Infinity;
    this.maxJump = settings.max_jump ?? Infinity;
    this.fullJump = settings.full_jump ?? false;
    this.round = settings.round ?? false;
    const stripSequins = settings.strip_sequins ?? true;
    let sequinContingency: number = stripSequins
      ? CONTINGENCY_SEQUIN_UTILIZE
      : CONTINGENCY_SEQUIN_JUMP;
    sequinContingency = settings.sequin_contingency ?? sequinContingency;
    this.sequinContingency = sequinContingency;

    this.stripSpeeds = settings.strip_speeds ?? true;
    this.explicitTrim = settings.explicit_trim ?? true;

    this.hasTieOn = settings.tie_on ?? false;
    this.hasTieOff = settings.tie_off ?? false;
  }

  transcode(
    sourcePattern: EmbPattern,
    destinationPattern: EmbPattern,
  ): EmbPattern {
    this.sourcePattern = sourcePattern;
    this.destinationPattern = destinationPattern;
    this.transcodeMetadata();
    this.transcodeThreads();
    this.transcodeStitches();
    return destinationPattern;
  }

  transcodeMetadata(): void {
    const source = this.sourcePattern!.extras;
    const dest = this.destinationPattern!.extras;
    Object.assign(dest, source);
  }

  transcodeThreads(): void {
    const source = this.sourcePattern!.threadlist;
    const dest = this.destinationPattern!.threadlist;
    dest.push(...source);
  }

  transcodeStitches(): void {
    const source = this.sourcePattern!.stitches;
    this.stateTrimmed = true;
    this.needleX = 0;
    this.needleY = 0;
    this.position = 0;
    this.colorIndex = -1;

    let cmd: Command | number = NO_COMMAND;
    for (const [index, stitch] of source.entries()) {
      this.position = index;
      this.stitch = stitch;
      const x = this.round ? pyRound(stitch[0]) : stitch[0];
      const y = this.round ? pyRound(stitch[1]) : stitch[1];
      // x/y are transformed; cmd and option values come from the raw stitch.
      cmd = stitch[2];

      if (cmd === NO_COMMAND) continue;

      if (cmd === END) {
        this.endHere();
        break;
      }

      switch (cmd) {
        case STITCH:
          if (this.stateTrimmed) {
            this.jumpToWithinStitchrange(x, y);
            this.stitchAt(x, y);
            if (this.hasTieOn) this.tieOn();
          } else {
            this.needleTo(x, y);
            this.stateJumping = false;
          }
          break;
        case SEQUIN_EJECT:
          if (this.stateTrimmed) {
            this.jumpToWithinStitchrange(x, y);
            this.stitchAt(x, y);
            if (this.hasTieOn) this.tieOn();
          }
          if (!this.stateSequinMode) this.toggleSequins();
          this.sequinAt(x, y);
          break;
        case JUMP:
          if (!this.stateJumping) this.jumpTo(x, y);
          break;
        case STITCH_BREAK:
          this.stateJumping = true;
          break;
        case TRIM:
        case SEQUENCE_BREAK:
          this.tieOffAndTrimIfNeeded();
          break;
        case COLOR_BREAK:
          this.colorBreak();
          break;
        case COLOR_CHANGE:
          this.tieOffTrimColorChange();
          break;
        case SEQUIN_MODE:
          this.toggleSequins();
          break;
        case STOP:
          this.stopHere();
          break;
        case SLOW:
          this.slowCommandHere();
          break;
        case FAST:
          this.fastCommandHere();
          break;
      }
    }
    if (cmd !== END) {
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

  add(
    cmd: Command | number,
    x: number | null = null,
    y: number | null = null,
  ): void {
    const ax = x === null ? this.needleX : x;
    const ay = y === null ? this.needleY : y;
    this.destinationPattern!.stitches.push([ax, ay, cmd]);
  }

  lookaheadStitch(): boolean {
    const source = this.sourcePattern!.stitches;
    for (let pos = this.position; pos < source.length; pos++) {
      const cmd = source[pos][2];
      if (cmd === STITCH || cmd === SEQUIN_EJECT) {
        return true;
      } else if (cmd === END) {
        return false;
      }
    }
    return false;
  }

  colorBreak(): void {
    if (this.colorIndex < 0) {
      return;
    }
    if (!this.stateTrimmed) {
      if (this.hasTieOff) this.tieOff();
      if (this.explicitTrim) this.trimHere();
    }
    if (!this.lookaheadStitch()) {
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
      if (this.hasTieOff) this.tieOff();
      this.trimHere();
    }
  }

  tieOff(): void {
    const source = this.sourcePattern!.stitches;
    // pyembroidery anchors on the stitch just before, which is usually where the needle already is,
    // so its lock stitches don't move. Anchor on the last stitch away from the needle instead.
    for (let offset = 1; offset <= source.length; offset += 1) {
      let index = this.position - offset;
      if (index < 0) index += source.length;
      const b = source[index];
      const cmd = b[2];
      if (cmd === STITCH || cmd === SEQUIN_EJECT) {
        if (b[0] !== this.needleX || b[1] !== this.needleY) {
          this.lockStitch(
            this.needleX,
            this.needleY,
            b[0],
            b[1],
            this.maxStitch,
          );
          return;
        }
      } else if (BREAKS.has(cmd)) {
        return;
      }
    }
  }

  tieOn(): void {
    const source = this.sourcePattern!.stitches;
    const next = source[this.position + 1];
    if (next === undefined) {
      return;
    }
    const [x, y, cmd] = next;
    if (cmd === STITCH || cmd === SEQUIN_EJECT) {
      this.lockStitch(this.needleX, this.needleY, x, y, this.maxStitch);
    }
  }

  trimHere(): void {
    if (this.stateSequinMode) {
      this.toggleSequins();
    }
    this.add(TRIM);
    this.stateTrimmed = true;
  }

  toggleSequins(): void {
    const contingency = this.sequinContingency;
    if (contingency === CONTINGENCY_SEQUIN_UTILIZE) {
      this.add(SEQUIN_MODE);
      this.stateSequinMode = !this.stateSequinMode;
    }
  }

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
      this.toggleSequins();
    }
    this.add(JUMP, newX, newY);
    this.updateNeedlePosition(newX, newY);
  }

  needleTo(newX: number, newY: number): void {
    const x0 = this.needleX;
    const y0 = this.needleY;
    const maxLength = this.maxStitch;
    this.interpolateGapStitches(x0, y0, newX, newY, maxLength, JUMP);
    this.stitchAt(newX, newY);
  }

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

  interpolateGapStitches(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    maxLength: number,
    cmd: Command | number,
  ): void {
    const transcode = this.destinationPattern!.stitches;
    const distanceX = x1 - x0;
    const distanceY = y1 - y0;
    if (Math.abs(distanceX) > maxLength || Math.abs(distanceY) > maxLength) {
      if (cmd === JUMP && this.stateSequinMode) {
        this.toggleSequins();
      }

      const stepsX = Math.ceil(Math.abs(distanceX / (maxLength * 1.0)));
      const stepsY = Math.ceil(Math.abs(distanceY / (maxLength * 1.0)));
      const maxSteps = Math.max(stepsX, stepsY);
      const stepSizeX = distanceX / maxSteps;
      const stepSizeY = distanceY / maxSteps;
      let qx = x0;
      let qy = y0;
      for (let q = 1; q < maxSteps; q++) {
        qx += stepSizeX;
        qy += stepSizeY;
        const stitch: Stitch = [qx, qy, cmd];
        transcode.push(stitch);
        this.updateNeedlePosition(stitch[0], stitch[1]);
      }
    }
  }

  lockStitch(
    x: number,
    y: number,
    anchorX: number,
    anchorY: number,
    maxLength: number | null = null,
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
