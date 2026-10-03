// Compiled by `npm run typecheck` against the published declarations in dist/.
import { EmbConstant, EmbPattern, EmbThread, readDst, readPes, readSvg, writeDst, writePes, writeSvg } from "../dist/index.js";
import type {
  Command,
  DstWriteSettings,
  EncoderSettings,
  Extents,
  PesWriteSettings,
  Stitch,
  StitchBlock,
  SvgInput,
  SvgReadResult,
  SvgReadSettings,
  SvgWriteSettings,
} from "../dist/index.js";

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

const svgWriteSettings: SvgWriteSettings = { stable: false };
const svg: string = writeSvg(normalized, svgWriteSettings);
const preview: string = writeSvg(readPes(pes), { stable: true });

const input: SvgInput = new TextEncoder().encode("<svg></svg>");
const readSettings: SvgReadSettings = {
  size: 100,
  runningStitchLength: 2.5,
  fillStitchLength: 3,
  rowSpacing: 0.4,
  pullCompensation: 0,
  underlay: true,
  fit: true,
  colorTolerance: 10,
};
const result: SvgReadResult = readSvg(input, readSettings);
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

void [svg, preview, converted, warnings, stitch, blocks, extents, fromDst];
