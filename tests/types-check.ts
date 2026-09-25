import {
  ByteReader,
  EmbConstant,
  EmbPattern,
  EmbThread,
  Transcoder,
  findNearestColorIndex,
  getThreadSet,
  pesToSvg,
  pyRound,
  readPec,
  readPes,
  readPesInto,
  readSvg,
  svgToPes,
  writePes,
  writeSvg,
} from "../dist/index.js";
import type {
  Extents,
  PesSettings,
  Stitch,
  SvgInput,
  SvgReadSettings,
  SvgSettings,
  SvgToPesSettings,
  TranscoderSettings,
} from "../dist/index.js";

const settings: SvgSettings = { encode: false, stable: true, tie_on: true };

const pattern: EmbPattern = readPes(new Uint8Array([0x23]), settings);
const into: EmbPattern = new EmbPattern();
const returned: EmbPattern = readPes(new Uint8Array(), undefined, into);
if (returned !== into) throw new Error("pattern param must be returned");

readPesInto(new ByteReader(new Uint8Array()), new EmbPattern(), {});

readPec(new ByteReader(new Uint8Array()), new EmbPattern(), [new EmbThread()]);

const encoderSettings: TranscoderSettings = {
  max_stitch: 10,
  sequin_contingency: EmbConstant.CONTINGENCY_SEQUIN_STITCH,
  matrix: undefined,
};
const normalized: EmbPattern = pattern.getNormalizedPattern(encoderSettings);
const stable: EmbPattern = pattern.getStablePattern();
const transcoder = new Transcoder({ strip_sequins: true });
void transcoder;

const svg1: string = writeSvg(pattern, settings);
const svg2: string = writeSvg(normalized);
const svg3: string = pesToSvg(new Uint8Array(), {
  sequin_contingency: EmbConstant.CONTINGENCY_SEQUIN_STITCH,
});
const svg4: string = pesToSvg(new Uint8Array(), { stable: false });

const pesSettings: PesSettings = { version: 6, encode: true, max_stitch: 2047 };
const svgInput: SvgInput = new TextEncoder().encode("<svg></svg>");
const svgReadSettings: SvgReadSettings = { stitchLength: 2, onWarning: (message: string) => void message };
const svgToPesSettings: SvgToPesSettings = { version: 1, stitchLength: 2 };
const pes1: Uint8Array = writePes(pattern, pesSettings);
const parsedSvg: EmbPattern = readSvg(svgInput, svgReadSettings);
const pes2: Uint8Array = svgToPes("<svg></svg>", svgToPesSettings);
const pes3: Uint8Array = svgToPes(svgInput, { version: 6 });

const stitch: Stitch = [0, 0, EmbConstant.STITCH];
const extents: Extents = stable.extents();
const rounded: number = pyRound(0.5);
const nearest: number = findNearestColorIndex(0xff0000, getThreadSet());

void [
  svg1,
  svg2,
  svg3,
  svg4,
  pes1,
  parsedSvg,
  pes2,
  pes3,
  stitch,
  extents,
  rounded,
  nearest,
];
