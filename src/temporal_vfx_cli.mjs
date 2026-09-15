#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { applyTemporalVfxPpms } from "./temporal_vfx_bridge.mjs";
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
  for (const key of ["uc-root", "vfx-root", "frames", "out-dir", "receipt"]) if (!values[key]) throw new Error(`missing --${key}`);
  return values;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const ucRoot = resolve(args["uc-root"]);
  const vfxRoot = resolve(args["vfx-root"]);
  const outDir = resolve(args["out-dir"]);
  const receiptPath = resolve(args.receipt);
  const declaredFrames = String(args.frames).split(",").map((value) => value.trim()).filter(Boolean);
  const framePaths = declaredFrames.map((value) => resolve(value));

  for (const donorRoot of [ucRoot, vfxRoot]) {
    if (pathIsInside(donorRoot, outDir) || pathIsInside(donorRoot, receiptPath)) {
      throw new Error("temporal VFX outputs may not be written inside donor repositories");
    }
  }
  if (pathIsInside(outDir, receiptPath)) throw new Error("temporal VFX receipt must remain outside the generated artifact directory");

  const frameBytes = await Promise.all(framePaths.map((path) => readFile(path)));
  const result = await applyTemporalVfxPpms(ucRoot, vfxRoot, frameBytes, {
    baseSeed: args.seed == null ? 20260915 : Number(args.seed),
    seedStep: args["seed-step"] == null ? 1 : Number(args["seed-step"]),
  });

  await mkdir(outDir, { recursive: true });
  const outputs = [];
  for (const artifact of result.artifacts) {
    const stem = String(artifact.index).padStart(3, "0");
    const paths = {
      state: join(outDir, `effect-${stem}.state.json`),
      svg: join(outDir, `effect-${stem}.svg`),
      effect: join(outDir, `effect-${stem}.ppm`),
      composite: join(outDir, `frame-${stem}.ppm`),
    };
    for (const path of Object.values(paths)) {
      if (framePaths.includes(resolve(path))) throw new Error("temporal VFX refuses to overwrite a source frame");
    }
    await write(paths.state, artifact.stateBytes);
    await write(paths.svg, artifact.svgBytes);
    await write(paths.effect, artifact.effectPpmBytes);
    await write(paths.composite, artifact.outputPpmBytes);
    outputs.push({
      index: artifact.index,
      seed: artifact.seed,
      state_file: `effect-${stem}.state.json`,
      state_sha256: sha256(artifact.stateBytes),
      svg_file: `effect-${stem}.svg`,
      svg_sha256: sha256(artifact.svgBytes),
      effect_file: `effect-${stem}.ppm`,
      effect_sha256: sha256(artifact.effectPpmBytes),
      composite_file: `frame-${stem}.ppm`,
      composite_sha256: sha256(artifact.outputPpmBytes),
      composite_bytes: artifact.outputPpmBytes.length,
    });
  }

  const receipt = {
    contract: "AXM_CREATIVE_TEMPORAL_VFX_RECEIPT",
    version: 1,
    mode: "verified-rendered-sequence-to-vfx-state-raster-to-uc-composite",
    source_frames: declaredFrames.map((declaredPath, index) => ({
      index,
      declared_path: declaredPath,
      sha256: sha256(frameBytes[index]),
      bytes: frameBytes[index].length,
    })),
    outputs,
    observation: result.observation,
    truth_boundary: result.observation.truth_boundary,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(receiptPath, receiptBytes);

  console.log("temporal_vfx=PASS");
  console.log(`frame_count=${receipt.observation.frame_count}`);
  console.log(`vfx_graph=${receipt.observation.donor_invariant.vfx_graph_id}`);
  console.log(`uc_hand_count=${receipt.observation.donor_invariant.uc_hand_count}`);
  console.log(`uc_recipe_count=${receipt.observation.donor_invariant.uc_recipe_count}`);
  console.log(`distinct_vfx_state_count=${receipt.observation.distinct_vfx_state_count}`);
  console.log(`distinct_effect_raster_count=${receipt.observation.distinct_effect_raster_count}`);
  console.log(`changed_frame_count=${receipt.observation.changed_frame_count}`);
  console.log(`repeat_verification=${receipt.observation.repeat_verification}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
