#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { finishTemporalPpms } from "./temporal_finish_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function parseArgs(argv) {
  if (argv[0] !== "apply") throw new Error("only the 'apply' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["uc-root", "frames", "out-dir", "receipt"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const ucRoot = resolve(args["uc-root"]);
  const outDir = resolve(args["out-dir"]);
  const receiptPath = resolve(args.receipt);
  const framePaths = String(args.frames).split(",").map((value) => resolve(value.trim())).filter(Boolean);
  if (pathIsInside(ucRoot, outDir) || pathIsInside(ucRoot, receiptPath)) {
    throw new Error("temporal finish outputs may not be written inside the Universal Creation donor repository");
  }
  if (pathIsInside(outDir, receiptPath)) throw new Error("temporal finish receipt must remain outside the generated frame directory");

  const frameBytes = await Promise.all(framePaths.map((path) => readFile(path)));
  const result = await finishTemporalPpms(ucRoot, frameBytes, {
    maxWindow: args.window == null ? 3 : Number(args.window),
    decay: args.decay == null ? 0.65 : Number(args.decay),
  });

  await mkdir(outDir, { recursive: true });
  const outputs = [];
  for (let index = 0; index < result.outputPpms.length; index += 1) {
    const outputPath = join(outDir, `frame-${String(index).padStart(3, "0")}.ppm`);
    if (framePaths.includes(resolve(outputPath))) throw new Error("temporal finish refuses to overwrite a source frame");
    await write(outputPath, result.outputPpms[index]);
    outputs.push({ index, file: `frame-${String(index).padStart(3, "0")}.ppm`, sha256: sha256(result.outputPpms[index]), bytes: result.outputPpms[index].length });
  }

  const receipt = {
    contract: "AXM_CREATIVE_TEMPORAL_FINISH_RECEIPT",
    version: 1,
    mode: "rendered-sequence-to-universal-creation-frame-finishing",
    source_frames: framePaths.map((path, index) => ({ index, path, sha256: sha256(frameBytes[index]), bytes: frameBytes[index].length })),
    outputs,
    observation: result.observation,
    truth_boundary: result.observation.truth_boundary,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);

  console.log("temporal_frame_finish=PASS");
  console.log(`frame_count=${result.observation.frame_count}`);
  console.log(`hand_count=${result.observation.hand_count}`);
  console.log(`recipe_count=${result.observation.recipe_count}`);
  console.log(`operation=${result.observation.finishing_hand_id}`);
  console.log(`changed_frame_count=${result.observation.changed_frame_count}`);
  console.log(`repeat_verification=${result.observation.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
