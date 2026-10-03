// Regenerates docs/example-stitches.svg from docs/example.svg (run `npm run build` first).
import { readFileSync, writeFileSync } from "node:fs";
import { Window } from "happy-dom";
import { readPes, readSvg, writePes, writeSvg } from "../dist/index.js";

const source = readFileSync(new URL("../docs/example.svg", import.meta.url), "utf8");
// Through PES bytes, so the image shows exactly what the file holds.
const stitches = writeSvg(readPes(writePes(readSvg(source, { DOMParser: new Window().DOMParser }).pattern)))
  // Slightly thinner than real thread, so the stitch rows stay visible.
  .replaceAll('stroke-width="3"', 'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"')
  // Same frame as the source: its 100-unit viewBox becomes the default 100 mm square.
  .replace(/width="[^"]+" height="[^"]+" viewBox="[^"]+"/, 'width="400" height="400" viewBox="0 0 1000 1000"');
writeFileSync(new URL("../docs/example-stitches.svg", import.meta.url), stitches);
