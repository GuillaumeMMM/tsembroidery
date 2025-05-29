import { EmbPattern } from "../dist/EmbPattern.js";
import { read } from "../dist/PesReader.js";
import { writeSvg } from "../dist/writeSvg.js";
import { PyFile } from "../dist/PyFile.js";
import { readFileSync, writeFileSync } from "fs";

function loadPesFromArray(array) {
  const pesPyFile = new PyFile(array);
  let pattern = new EmbPattern();
  read(pesPyFile, pattern);
  const data = writeSvg(pattern);
  writeFileSync("./tests/out.svg", data);
}

// Read the file synchronously using fs
const buffer = readFileSync("./flowers.pes");
loadPesFromArray(buffer);
