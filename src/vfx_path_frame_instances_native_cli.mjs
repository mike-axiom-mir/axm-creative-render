#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeVisualEffectPathFrameInstancesNative } from "./vfx_path_frame_instances_native_bridge.mjs";

function usage() {
  console.error("usage: node src/vfx_path_frame_instances_native_cli.mjs build --vfx-root <dir> --vfx-revision <sha> --dense-scene <file> --sparse-scene <file> --donor-state <file> --receipt <file>");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "build") return { command };
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
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== "build") {
    usage();
    process.exitCode = 2;
    return;
  }
  for (const required of ["vfx-root", "vfx-revision", "dense-scene", "sparse-scene", "donor-state", "receipt"]) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  const result = await observeVisualEffectPathFrameInstancesNative(args["vfx-root"], { vfxRevision: args["vfx-revision"] });
  await Promise.all([
    writeOutput(args["dense-scene"], result.denseSceneBytes),
    writeOutput(args["sparse-scene"], result.sparseSceneBytes),
    writeOutput(args["donor-state"], result.donorStateBytes),
    writeOutput(args.receipt, result.receiptBytes),
  ]);
  console.log("vfx_path_frame_instances_native=PASS");
  console.log(`retained_path_source_hash=${result.denseSet.pathSourceHash}`);
  console.log(`retained_sweep_source_hash=${result.retained.sourceHash}`);
  console.log(`derived_frame_set_hash=${result.frameSet.frameSetHash}`);
  console.log(`dense_instance_set_hash=${result.denseSet.instanceSetHash}`);
  console.log(`sparse_instance_set_hash=${result.sparseSet.instanceSetHash}`);
  console.log(`dense_instance_count=${result.denseSet.instanceCount}`);
  console.log(`sparse_instance_count=${result.sparseSet.instanceCount}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
