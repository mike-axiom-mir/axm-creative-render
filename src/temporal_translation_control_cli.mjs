#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createTranslationControlPpms } from "./temporal_translation_control.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function parseArgs(argv) {
  if (argv[0] !== "build") throw new Error("only the 'build' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["uc-root", "source", "out-dir", "receipt"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

function parseOffsets(value) {
  if (value == null) return [{ dx: 0, dy: 0 }, { dx: 4, dy: 2 }, { dx: 8, dy: 5 }];
  return String(value).split(",").map((part, index) => {
    const fields = part.trim().split(":");
    if (fields.length !== 2) throw new Error(`offset ${index} must be dx:dy`);
    return { dx: Number(fields[0]), dy: Number(fields[1]) };
  });
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const ucRoot = resolve(args["uc-root"]), sourcePath = resolve(args.source), outDir = resolve(args["out-dir"]), receiptPath = resolve(args.receipt);
  if (pathIsInside(ucRoot, outDir) || pathIsInside(ucRoot, receiptPath)) throw new Error("translation-control outputs may not be written inside the Universal Creation donor repository");
  if (pathIsInside(outDir, receiptPath)) throw new Error("translation-control receipt must remain outside the generated frame directory");
  const sourceBytes = await readFile(sourcePath);
  const result = await createTranslationControlPpms(ucRoot, sourceBytes, parseOffsets(args.offsets));
  await mkdir(outDir, { recursive: true });
  const outputs = [];
  for (let index = 0; index < result.outputPpms.length; index += 1) {
    const file = `frame-${String(index).padStart(3, "0")}.ppm`;
    const path = join(outDir, file);
    if (resolve(path) === sourcePath) throw new Error("translation-control refuses to overwrite the verified renderer source");
    await write(path, result.outputPpms[index]);
    outputs.push({ index, file, sha256: sha256(result.outputPpms[index]), bytes: result.outputPpms[index].length, expected_offset: result.observation.offsets[index] });
  }
  const receipt = {
    contract: "AXM_CREATIVE_TRANSLATION_CONTROL_RECEIPT",
    version: 1,
    mode: "verified-renderer-frame-to-uc-image-translation-control",
    source: { declared_path: args.source, sha256: sha256(sourceBytes), bytes: sourceBytes.length },
    outputs,
    observation: result.observation,
    truth_boundary: result.observation.truth_boundary,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);
  console.log("translation_control=PASS");
  console.log(`frame_count=${outputs.length}`);
  console.log(`hand_count=${result.observation.hand_count}`);
  console.log(`recipe_count=${result.observation.recipe_count}`);
  console.log(`operation=${result.observation.overlay_hand_id}`);
  for (const row of outputs) console.log(`control_${row.index}=dx:${row.expected_offset.dx},dy:${row.expected_offset.dy},sha256:${row.sha256}`);
  console.log(`repeat_verification=${result.observation.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
