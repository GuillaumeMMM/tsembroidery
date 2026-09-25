# tsembroidery

Read and write Brother `.pes` and Tajima `.dst` embroidery files, and turn SVG files into `.pes` or `.dst` files. Based on [pyembroidery](https://github.com/EmbroidePy/pyembroidery), with the additional `.svg -> .pes` & `.svg -> .dst`.

For now, only `.pes` and `.dst` were ported from pyembroidery.

```sh
npm install @guillaumemmm/tsembroidery
```

```ts
import { pesToSvg, readPes, svgToPes } from "@guillaumemmm/tsembroidery";

const pattern = readPes(pesBytes);
const preview = pesToSvg(pesBytes);
const pes = svgToPes(svgText, { size: 100 }); // fit the SVG in a 100 × 100 mm square
```

<table>
  <tr>
    <td><img src="docs/example.svg" width="360" alt="SVG artwork: overlapping shapes" /></td>
    <td><img src="docs/example-stitches.svg" width="360" alt="The same artwork as stitches" /></td>
  </tr>
  <tr>
    <td align="center">SVG input</td>
    <td align="center"><code>svgToPes</code> output, drawn with <code>pesToSvg</code></td>
  </tr>
</table>

## API

Coordinates in patterns are in **0.1 mm** (x to the right, y down). Lengths in the SVG settings are in **mm**.

| Function                                                             | Returns      | Description                                                 |
| -------------------------------------------------------------------- | ------------ | ----------------------------------------------------------- |
| `readPes(bytes: Uint8Array)`                                         | `EmbPattern` | Parses a `.pes` file.                                       |
| `writePes(pattern: EmbPattern, settings?: PesWriteSettings)`         | `Uint8Array` | Encodes a pattern as a `.pes` file.                         |
| `readDst(bytes: Uint8Array)`                                         | `EmbPattern` | Parses a Tajima `.dst` file.                                |
| `writeDst(pattern: EmbPattern, settings?: DstWriteSettings)`         | `Uint8Array` | Encodes a pattern as a `.dst` file.                         |
| `pesToSvg(bytes: Uint8Array, settings?: SvgWriteSettings)`           | `string`     | Renders a `.pes` file as SVG.                               |
| `writeSvg(pattern: EmbPattern, settings?: SvgWriteSettings)`         | `string`     | Renders a pattern as SVG, one path per run of stitches.     |
| `readSvg(input: string \| Uint8Array, settings?: SvgReadSettings)`   | `EmbPattern` | Turns SVG artwork into stitches.                            |
| `svgToPes(input: string \| Uint8Array, settings?: SvgToPesSettings)` | `Uint8Array` | `readSvg`, then `writePes`. Takes both functions' settings. |

`readSvg` and `svgToPes` need a `DOMParser`. Browsers have one; in Node, provide one first, for example from [happy-dom](https://github.com/capricorn86/happy-dom):

### `readSvg` settings

| Setting            | Default | Description                                                                                                  |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------ |
| `size`             | `100`   | Edge in mm of the square the SVG's viewBox is fitted into.                                                   |
| `stitchLength`     | `2.5`   | Longest running stitch, in mm.                                                                               |
| `rowSpacing`       | `0.4`   | Gap between parallel stitches in fills and satin, in mm.                                                     |
| `pullCompensation` | `0.2`   | Fills and satin are widened by this much on each side, in mm, so seams stay closed when the fabric pulls in. |
| `underlay`         | `true`  | Stitch a holding layer under fills and satin first.                                                          |
| `colorTolerance`   | `10`    | Colors closer than this (0–765) share one thread. `0` keeps every distinct color.                            |
| `flattenTolerance` | `0.05`  | Maximum error when curves are turned into lines, in mm.                                                      |

### Writing settings

`writePes` takes `version` (`6` by default, which keeps exact thread colors and metadata, or `1`). `writeDst` takes `extendedHeader` (`false` by default): DST stores no thread colors, so the machine just stops between colors, unless the extended header lists them.

## License

MIT
