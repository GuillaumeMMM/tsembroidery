# tsembroidery

Read and write Brother `.pes` embroidery files, render them as SVG, and convert SVG strokes to stitches. Based on [pyembroidery](https://github.com/EmbroidePy/pyembroidery).

```ts
import { readPes, pesToSvg, svgToPes } from "@guillaumemmm/tsembroidery";

const pattern = readPes(pesBytes);
const svg = pesToSvg(pesBytes);
const pes = svgToPes(svgText, { size: 100, stitchLength: 2.5 });
```

`readSvg`/`svgToPes` need a `DOMParser` (built into browsers; in Node use e.g. happy-dom). SVGs are fitted into a `size` mm square (default 100, a 10×10 cm hoop). Strokes are stitched (satin from 1 mm wide), fills are not yet; `<style>` sheets are ignored.
