/**
 * Compile-time check of the PUBLISHED declarations (dist/*.d.ts), written
 * from a consumer's point of view: imports only go through the package
 * entry (`../dist/index.js`), exactly like an installed dependency.
 *
 * This file does not match `*.test.ts`, so vitest never executes it —
 * `tsc -p tsconfig.check.json` (`npm run typecheck`) compiles it.
 */
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
  writeSvg,
} from "../dist/index.js";
import type {
  Extents,
  Stitch,
  SvgSettings,
  TranscoderSettings,
} from "../dist/index.js";

/* ------------------------------- readers ------------------------------- */

const settings: SvgSettings = { encode: false, stable: true, tie_on: true };

// readPes(bytes, settings?, pattern?) -> EmbPattern
const pattern: EmbPattern = readPes(new Uint8Array([0x23]), settings);
const into: EmbPattern = new EmbPattern();
const returned: EmbPattern = readPes(new Uint8Array(), undefined, into);
if (returned !== into) throw new Error("pattern param must be returned");

// readPesInto(f, out, settings?) — python PesReader.read shape
readPesInto(new ByteReader(new Uint8Array()), new EmbPattern(), {});

// readPec(f, out, pesChart?)
readPec(new ByteReader(new Uint8Array()), new EmbPattern(), [new EmbThread()]);

/* ------------------------------- encoder ------------------------------- */

const encoderSettings: TranscoderSettings = {
  max_stitch: 10,
  sequin_contingency: EmbConstant.CONTINGENCY_SEQUIN_STITCH,
  matrix: undefined,
};
const normalized: EmbPattern = pattern.getNormalizedPattern(encoderSettings);
const stable: EmbPattern = pattern.getStablePattern();
const transcoder = new Transcoder({ strip_sequins: true });
void transcoder;

/* -------------------------------- writer -------------------------------- */

const svg1: string = writeSvg(pattern, settings);
const svg2: string = writeSvg(normalized);
const svg3: string = pesToSvg(new Uint8Array(), {
  sequin_contingency: EmbConstant.CONTINGENCY_SEQUIN_STITCH,
});
const svg4: string = pesToSvg(new Uint8Array(), { stable: false });

/* ------------------------------ primitives ------------------------------ */

const stitch: Stitch = [0, 0, EmbConstant.STITCH];
const extents: Extents = stable.extents();
const rounded: number = pyRound(0.5);
const nearest: number = findNearestColorIndex(0xff0000, getThreadSet());

void [svg1, svg2, svg3, svg4, stitch, extents, rounded, nearest];
