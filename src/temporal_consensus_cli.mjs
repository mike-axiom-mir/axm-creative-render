#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { analyzeConsensusTemporalPpms } from "./temporal_consensus_bridge.mjs";
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
  const ucRoot = resolve(args["uc-root"]), outDir = resolve(args["out-dir"]), receiptPath = resolve(args.receipt);
  const declaredFrames = String(args.frames).split(",").map((value) => value.trim()).filter(Boolean);
  const framePaths = declaredFrames.map((value) => resolve(value));
  if (pathIsInside(ucRoot, outDir) || pathIsInside(ucRoot, receiptPath)) throw new Error("temporal consensus outputs may not be written inside the Universal Creation donor repository");
  if (pathIsInside(outDir, receiptPath)) throw new Error("temporal consensus receipt must remain outside the generated frame directory");

  const frameBytes = await Promise.all(framePaths.map((path) => readFile(path)));
  const result = await analyzeConsensusTemporalPpms(ucRoot, frameBytes, {
    regionCount: args.regions == null ? 3 : Number(args.regions),
    searchRadius: args["search-radius"] == null ? 16 : Number(args["search-radius"]),
    maxAxisSpread: args["max-axis-spread"] == null ? 4 : Number(args["max-axis-spread"]),
    trailWindow: args["trail-window"] == null ? 3 : Number(args["trail-window"]),
    decay: args.decay == null ? 0.65 : Number(args.decay),
  });

  const stabilizedDir = join(outDir, "stabilized"), finishedDir = join(outDir, "finished"), differenceDir = join(outDir, "difference");
  await Promise.all([mkdir(stabilizedDir, { recursive: true }), mkdir(finishedDir, { recursive: true }), mkdir(differenceDir, { recursive: true })]);
  const outputs = [];
  for (let index = 0; index < result.outputPpms.length; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const stablePath = join(stabilizedDir, `frame-${suffix}.ppm`), finishPath = join(finishedDir, `frame-${suffix}.ppm`);
    if (framePaths.includes(resolve(stablePath)) || framePaths.includes(resolve(finishPath))) throw new Error("temporal consensus refuses to overwrite a source frame");
    await write(stablePath, result.stabilizedPpms[index]);
    await write(finishPath, result.outputPpms[index]);
    let difference = null;
    if (result.differencePpms[index]) {
      const differencePath = join(differenceDir, `frame-${suffix}.ppm`);
      await write(differencePath, result.differencePpms[index]);
      difference = { file: `difference/frame-${suffix}.ppm`, sha256: sha256(result.differencePpms[index]), bytes: result.differencePpms[index].length };
    }
    outputs.push({
      index,
      stabilized: { file: `stabilized/frame-${suffix}.ppm`, sha256: sha256(result.stabilizedPpms[index]), bytes: result.stabilizedPpms[index].length },
      finished: { file: `finished/frame-${suffix}.ppm`, sha256: sha256(result.outputPpms[index]), bytes: result.outputPpms[index].length },
      difference,
    });
  }

  const receipt = {
    contract: "AXM_CREATIVE_TEMPORAL_CONSENSUS_RECEIPT",
    version: 1,
    mode: "multi-region-uc-tracks-to-representative-real-track-stabilization",
    source_frames: declaredFrames.map((declaredPath, index) => ({ index, declared_path: declaredPath, sha256: sha256(frameBytes[index]), bytes: frameBytes[index].length })),
    outputs,
    observation: result.observation,
    truth_boundary: result.observation.truth_boundary,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);

  console.log("temporal_motion_consensus=PASS");
  console.log(`frame_count=${result.observation.frame_count}`);
  console.log(`regions=${result.observation.policy.regionCount}`);
  console.log(`hand_count=${result.observation.hand_count}`);
  console.log(`recipe_count=${result.observation.recipe_count}`);
  console.log(`agreement_frame_count=${result.observation.agreement_frame_count}`);
  console.log(`nonzero_consensus_frame_count=${result.observation.nonzero_consensus_frame_count}`);
  console.log(`mean_improved_frame_count=${result.observation.mean_improved_frame_count}`);
  for (const row of result.observation.motion.slice(1)) {
    console.log(`consensus_${row.index}=dx:${row.consensus_dx},dy:${row.consensus_dy},spread:${row.spread_dx}/${row.spread_dy},representative:${row.representative_region_index},pre:${row.pre_mean_region_mse},post:${row.post_mean_region_mse}`);
  }
  console.log(`repeat_verification=${result.observation.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
