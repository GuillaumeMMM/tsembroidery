#!/usr/bin/env node
/**
 * PES -> SVG converter.
 *
 *   node scripts/pes2svg.mjs <input.pes> [output.svg]
 *
 * The output path defaults to the input path with a ".svg" extension.
 * Lives outside src/ on purpose: the library itself takes a Uint8Array
 * and returns a string with zero Node built-ins; only this CLI touches
 * the filesystem.
 */
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
