#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeVisualEffectPathSweepPropagationNative } from "./vfx_path_sweep_propagation_native_bridge.mjs";

function parse(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "<end>"}`);
    options[key.slice(2)] = value;
  }
  return options;
}

async function writeOutput(path, bytes) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.command !== "build") throw new Error("usage: build --vfx-root <dir> --vfx-revision <sha> --phase-a-scene <file> --phase-b-scene <file> --donor-state <file> --receipt <file>");
  for (const key of ["vfx-root", "vfx-revision", "phase-a-scene", "phase-b-scene", "donor-state", "receipt"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  const result = await observeVisualEffectPathSweepPropagationNative(args["vfx-root"], {
    vfxRevision: args["vfx-revision"],
    phaseA: args["phase-a"] === undefined ? undefined : Number(args["phase-a"]),
    phaseB: args["phase-b"] === undefined ? undefined : Number(args["phase-b"]),
    halfWidth: args["half-width"] === undefined ? undefined : Number(args["half-width"]),
    frontSoftness: args["front-softness"] === undefined ? undefined : Number(args["front-softness"]),
  });
  await Promise.all([
    writeOutput(args["phase-a-scene"], result.phaseASceneBytes),
    writeOutput(args["phase-b-scene"], result.phaseBSceneBytes),
    writeOutput(args["donor-state"], result.donorStateBytes),
    writeOutput(args.receipt, result.receiptBytes),
  ]);
  console.log("vfx_path_sweep_propagation_native=PASS");
  console.log(`phase_a_weight_set_hash=${result.phaseAWeightSet.weightSetHash}`);
  console.log(`phase_b_weight_set_hash=${result.phaseBWeightSet.weightSetHash}`);
  console.log(`phase_a_scene_sha256=${result.receipt.outputs.phase_a_scene.sha256}`);
  console.log(`phase_b_scene_sha256=${result.receipt.outputs.phase_b_scene.sha256}`);
  console.log(`shared_geometry_sha256=${result.receipt.outputs.shared_geometry_sha256}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
