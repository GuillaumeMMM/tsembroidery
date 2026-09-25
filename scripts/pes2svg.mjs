#!/usr/bin/env node
// Usage: node scripts/pes2svg.mjs <input.pes> [output.svg]  (run `npm run build` first)
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { pesToSvg } from "../dist/index.js";

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("usage: node scripts/pes2svg.mjs <input.pes> [output.svg]");
  process.exit(1);
}

const extension = extname(input);
const base = extension ? input.slice(0, -extension.length) : input;
const outPath = output ?? `${base}.svg`;

const bytes = new Uint8Array(readFileSync(input));
const svg = pesToSvg(bytes);
writeFileSync(outPath, svg);
console.log(`${input} -> ${outPath} (${svg.length} bytes)`);
