import { EmbPattern } from "./types/EmbPattern.js";
import { EmbThread } from "./types/EmbThread.js";

export function write(pattern: EmbPattern) {
  const extendsBounds = pattern.extents();
  const width = extendsBounds.maxX - extendsBounds.minX;
  const height = extendsBounds.maxY - extendsBounds.minY;
  const viewbox = `${extendsBounds.minX} ${extendsBounds.minY} ${width} ${height}`;

  const paths = [];

  for (const stitchblock of pattern.getAsStitchblock()) {
    const block = (stitchblock as any[])[0];
    const thread = (stitchblock as EmbThread[])[1];
    let data = "M";

    for (const stitch of block) {
      const x = stitch[0];
      const y = stitch[1];
      data += ` ${x},${y}`;
    }
    const path = `<path d="${data}" fill="none" stroke="#${thread.hexColor()}" stroke-width="3"/>`;
    paths.push(path);
  }

  return `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:ev="http://www.w3.org/2001/xml-events" width="${width}" height="${height}" viewBox="${viewbox}">${paths.join(
    ""
  )}</svg>`;
}
