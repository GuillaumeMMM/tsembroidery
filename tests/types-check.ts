// Compiled by `npm run typecheck` against the published declarations in dist/.
import { Window } from "happy-dom";
import {
  EmbConstant,
  EmbPattern,
  EmbThread,
  readDst,
  readExp,
  readJef,
  readPes,
  readSvg,
  readVp3,
  readXxx,
  writeDst,
  writeExp,
  writeJef,
  writePes,
  writeSvg,
  writeVp3,
  writeXxx,
} from "../dist/index.js";
import type {
  Command,
  DstWriteSettings,
  ExpWriteSettings,
  JefWriteSettings,
  Vp3WriteSettings,
  XxxWriteSettings,
  EncoderSettings,
  Extents,
  PesWriteSettings,
  Stitch,
  StitchBlock,
  SvgDomParser,
  SvgInput,
  SvgReadResult,
  SvgReadSettings,
  SvgWriteSettings,
  SvgThreadInfo,
  ThreadStitchSettings,
} from "../dist/index.js";

// Apps type their own extras by augmenting the package (here through its relative path).
declare module "../dist/index.js" {
  interface ThreadExtras {
    bayeux?: { locked: boolean };
  }
  interface PatternExtras {
    bayeux?: { version: number };
  }
}

const pattern: EmbPattern = readPes(new Uint8Array());
const thread = new EmbThread();
thread.setHexColor("#e53935");
pattern.addThread(thread);
pattern.stitchAbs(0, 0);
pattern.stitch(100, 70);

const encoderSettings: EncoderSettings = { max_stitch: 100, tie_on: true, translate: [10, 10] };
const normalized: EmbPattern = pattern.getNormalizedPattern(encoderSettings);
const pesSettings: PesWriteSettings = { version: 1, encode: true, max_jump: 2047 };
const pes: Uint8Array = writePes(pattern, pesSettings);

const dstSettings: DstWriteSettings = { extendedHeader: true, max_stitch: 100 };
const dst: Uint8Array = writeDst(readSvg("<svg/>").pattern, dstSettings);
const fromDst: EmbPattern = readDst(dst);
const jefSettings: JefWriteSettings = { trims: true, trimAt: 3, date: "20260101120000", round: true };
const expSettings: ExpWriteSettings = { encode: true };
const vp3Settings: Vp3WriteSettings = { max_stitch: 200 };
const xxxSettings: XxxWriteSettings = { full_jump: false };
const others: EmbPattern[] = [
  readJef(writeJef(pattern, jefSettings)),
  readExp(writeExp(pattern, expSettings)),
  readVp3(writeVp3(pattern, vp3Settings)),
  readXxx(writeXxx(pattern, xxxSettings)),
];

const svgWriteSettings: SvgWriteSettings = { stable: false };
const svg: string = writeSvg(normalized, svgWriteSettings);
const preview: string = writeSvg(readPes(pes), { stable: true });

const input: SvgInput = new TextEncoder().encode("<svg></svg>");
const readSettings: SvgReadSettings = {
  size: 100,
  runningStitchLength: 2.5,
  fillStitchLength: 3,
  rowSpacing: 0.4,
  fillAngle: 45,
  pullCompensation: 0,
  underlay: true,
  fit: true,
  colorTolerance: 10,
};
const result: SvgReadResult = readSvg(input, readSettings);
// The browser's DOMParser and happy-dom's both fit.
const parsers: SvgDomParser[] = [DOMParser, new Window().DOMParser];
readSvg("<svg/>", { DOMParser: new Window().DOMParser });
const fromSvg: EmbPattern = result.pattern;
const warnings: string[] = result.warnings;
const converted: Uint8Array = writePes(fromSvg, { version: 6 });

const command: Command = EmbConstant.STITCH;
const stitch: Stitch = [0, 0, command];
const blocks: StitchBlock[] = [...fromSvg.getAsStitchblock()];
const extents: Extents = fromSvg.extents();

// @ts-expect-error unknown settings are rejected
writePes(pattern, { maxStitch: 10 });
// @ts-expect-error unknown settings are rejected
readSvg("<svg/>", { spacing: 1 });

const svgPattern = readSvg("<svg/>", { fillAngle: 0 }).pattern;
const svgInfo: SvgThreadInfo | undefined = svgPattern.threadlist[0]?.extras.svg;
const svgSettings: ThreadStitchSettings | undefined = svgInfo?.settings;
const locked: boolean | undefined = svgPattern.threadlist[0]?.extras.bayeux?.locked;
svgPattern.extras.bayeux = { version: 1 };
// @ts-expect-error augmented keys are typed
svgPattern.extras.bayeux = { version: "1" };
const untyped: unknown = svgPattern.threadlist[0]?.extras.otherApp;
void [svgInfo, svgSettings, locked, untyped];

void [svg, preview, converted, warnings, others, parsers, stitch, blocks, extents, fromDst];
