export { EmbConstant } from "./constants.js";
export type { Command } from "./constants.js";

export { pyRound } from "./pyMath.js";

export { EmbThread, findNearestColorIndex } from "./thread.js";
export type { ColorSource } from "./thread.js";

export { EmbThreadPec, getThreadSet } from "./pecThreads.js";

export { EmbPattern } from "./pattern.js";
export type {
  Stitch,
  StitchBlock,
  ThreadSpec,
  Extents,
} from "./pattern.js";

export {
  getIdentity,
  getScale,
  getTranslate,
  getRotate,
  matrixMultiply,
  pointInMatrixSpace,
  distance,
  distanceSquared,
  towards,
  angleRadians,
  oriented,
} from "./matrix.js";
export type { Matrix } from "./matrix.js";

export { readPec } from "./readers/pec.js";
export { readPes, readPesInto } from "./readers/pes.js";
export { decodeSvgInput, readSvg } from "./readers/svg.js";
export type {
  SvgInput,
  SvgReadSettings,
  NormalizedSvg,
  SvgShape,
  SvgViewport,
} from "./readers/svg.js";
export { normalizeSvg } from "./svg/normalize.js";
export { pathToStitches } from "./svg/pathData.js";
export type {
  FlatPathSubpath,
  PathStitchOptions,
} from "./svg/pathData.js";
export type {
  SvgFill,
  SvgFillStyle,
  SvgOutline,
  SvgStrokeStyle,
} from "./svg/types.js";

export { Transcoder } from "./encoder.js";
export type { TranscoderSettings, PointLike } from "./encoder.js";

export { writeSvg, pesToSvg } from "./writeSvg.js";
export type { SvgSettings } from "./writeSvg.js";

export { writePes, svgToPes } from "./writePes.js";
export type { PesSettings, SvgToPesSettings } from "./writePes.js";

export {
  ByteReader,
  signed8,
  signed16,
  signed24,
  readSigned,
  readSint8,
  readInt8,
  readInt16le,
  readInt16be,
  readInt24le,
  readInt24be,
  readInt32le,
  readInt32be,
  readString8,
  readString16,
} from "./binary.js";
