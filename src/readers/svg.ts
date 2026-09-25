import { EmbPattern } from "../pattern.js";

/** SVG source accepted by the public reader and converter APIs. */
export type SvgInput = string | Uint8Array;

/** Reserved for parser-specific SVG settings. */
export interface SvgReadSettings {
  [key: string]: unknown;
}

/**
 * SVG reader seam.
 *
 * The parser is intentionally left for the caller to implement. Returning a
 * fresh empty pattern keeps the conversion pipeline wired while making the
 * placeholder behavior deterministic.
 */
export function readSvg(
  _input: SvgInput,
  _settings?: SvgReadSettings
): EmbPattern {
  return new EmbPattern();
}
