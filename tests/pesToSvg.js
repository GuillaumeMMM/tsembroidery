import { EmbPattern } from "../dist/types/EmbPattern.js";
import { read } from "../dist/pesReader.js";
import { write } from "../dist/svgWriter.js";
import { PyFile } from "../dist/types/PyFile.js";
import { readFileSync, writeFileSync } from "fs";

function loadPesFromArray(array) {
  const pesPyFile = new PyFile(array);
  let pattern = new EmbPattern();
  read(pesPyFile, pattern);
  const data = write(pattern);
  writeFileSync("./tests/out.svg", data);
}

// Read the file synchronously using fs
const buffer = readFileSync("tests/flowers.pes");
loadPesFromArray(buffer);
