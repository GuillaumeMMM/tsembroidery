// Regenerates docs/example-stitches.svg from docs/example.svg (run `npm run build` first).
import { readFileSync, writeFileSync } from "node:fs";
import { Window } from "happy-dom";
import { pesToSvg, svgToPes } from "../dist/index.js";

globalThis.DOMParser = new Window().DOMParser;
const source = readFileSync(new URL("../docs/example.svg", import.meta.url), "utf8");
const stitches = pesToSvg(svgToPes(source))
  // Slightly thinner than real thread, so the stitch rows stay visible.
  .replaceAll('stroke-width="3"', 'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"')
  // Same frame as the source: its 100-unit viewBox becomes the default 100 mm square.
  .replace(/width="[^"]+" height="[^"]+" viewBox="[^"]+"/, 'width="400" height="400" viewBox="0 0 1000 1000"');
writeFileSync(new URL("../docs/example-stitches.svg", import.meta.url), stitches);
