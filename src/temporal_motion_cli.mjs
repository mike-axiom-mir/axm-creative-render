#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { analyzeAndFinishTemporalPpms } from "./temporal_motion_bridge.mjs";
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
  const declaredFrames = String(args.frames).split(",").map((value) => value.trim()).filter(Boolean);
  const framePaths = declaredFrames.map((value) => resolve(value));
  if (pathIsInside(ucRoot, outDir) || pathIsInside(ucRoot, receiptPath)) throw new Error("temporal motion outputs may not be written inside the Universal Creation donor repository");
  if (pathIsInside(outDir, receiptPath)) throw new Error("temporal motion receipt must remain outside the generated frame directory");

  const frameBytes = await Promise.all(framePaths.map((path) => readFile(path)));
  const result = await analyzeAndFinishTemporalPpms(ucRoot, frameBytes, {
    searchRadius: args["search-radius"] == null ? 16 : Number(args["search-radius"]),
    trailWindow: args["trail-window"] == null ? 3 : Number(args["trail-window"]),
    decay: args.decay == null ? 0.65 : Number(args.decay),
  });

  const stabilizedDir = join(outDir, "stabilized");
  const finishedDir = join(outDir, "finished");
  const differenceDir = join(outDir, "difference");
  await Promise.all([mkdir(stabilizedDir, { recursive: true }), mkdir(finishedDir, { recursive: true }), mkdir(differenceDir, { recursive: true })]);
  const outputs = [];
  for (let index = 0; index < result.outputPpms.length; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const stablePath = join(stabilizedDir, `frame-${suffix}.ppm`);
    const finishPath = join(finishedDir, `frame-${suffix}.ppm`);
    if (framePaths.includes(resolve(stablePath)) || framePaths.includes(resolve(finishPath))) throw new Error("temporal motion refuses to overwrite a source frame");
    await write(stablePath, result.stabilizationPpms[index]);
    await write(finishPath, result.outputPpms[index]);
    let difference = null;
    if (result.differencePpms[index]) {
      const differencePath = join(differenceDir, `frame-${suffix}.ppm`);
      await write(differencePath, result.differencePpms[index]);
      difference = { file: `difference/frame-${suffix}.ppm`, sha256: sha256(result.differencePpms[index]), bytes: result.differencePpms[index].length };
    }
    outputs.push({
      index,
      stabilized: { file: `stabilized/frame-${suffix}.ppm`, sha256: sha256(result.stabilizationPpms[index]), bytes: result.stabilizationPpms[index].length },
      finished: { file: `finished/frame-${suffix}.ppm`, sha256: sha256(result.outputPpms[index]), bytes: result.outputPpms[index].length },
      difference,
    });
  }

  const receipt = {
    contract: "AXM_CREATIVE_TEMPORAL_MOTION_RECEIPT",
    version: 1,
    mode: "rendered-sequence-to-uc-block-match-stabilization-and-finishing",
    source_frames: declaredFrames.map((declaredPath, index) => ({ index, declared_path: declaredPath, sha256: sha256(frameBytes[index]), bytes: frameBytes[index].length })),
    outputs,
    observation: result.observation,
    truth_boundary: result.observation.truth_boundary,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);

  console.log("temporal_motion_stabilization=PASS");
  console.log(`frame_count=${result.observation.frame_count}`);
  console.log(`hand_count=${result.observation.hand_count}`);
  console.log(`recipe_count=${result.observation.recipe_count}`);
  console.log(`nonzero_track_count=${result.observation.nonzero_track_count}`);
  console.log(`strictly_improved_track_count=${result.observation.strictly_improved_track_count}`);
  for (const row of result.observation.motion.slice(1)) console.log(`track_${row.index}=dx:${row.dx},dy:${row.dy},pre:${row.pre_region_mse},post:${row.post_region_mse}`);
  console.log(`repeat_verification=${result.observation.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
