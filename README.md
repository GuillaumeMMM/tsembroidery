# tsembroidery

Read and write Brother `.pes` embroidery files and render designs as SVG. Based on [pyembroidery](https://github.com/EmbroidePy/pyembroidery).

```ts
import { EmbPattern, EmbThread, writePes } from "@guillaumemmm/tsembroidery";

const pattern = new EmbPattern();
const thread = new EmbThread();
thread.setColor(18, 52, 86);
pattern.addThread(thread);
pattern.stitchAbs(0, 0);
pattern.stitch(100, 70);

const pesBytes = writePes(pattern); // PES v6 by default
```

`writePes` accepts either full PES v6 (`{ version: 6 }`) or v1 (`{ version: 1 }`) and returns a `Uint8Array`. The normal encoder settings use PES's 2047-unit stitch limit.

The SVG-facing API is also exposed:

```ts
import { readSvg, svgToPes } from "@guillaumemmm/tsembroidery";

declare const svgTextOrBytes: string | Uint8Array;
const pattern = readSvg(svgTextOrBytes);
const pesBytes = svgToPes(svgTextOrBytes, { version: 6 });
```

`readSvg` is currently a deliberately empty placeholder. It is the integration point for the SVG parser; until that parser is implemented, `svgToPes` returns a valid empty PES design.
