#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeVisualEffectPathSweepFrameNative } from "./vfx_path_sweep_frame_native_bridge.mjs";

function usage() {
  console.error("usage: node src/vfx_path_sweep_frame_native_cli.mjs build --vfx-root <dir> --vfx-revision <sha> --scene <file> --donor-state <file> --receipt <file> [--half-width <number>]");
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
  for (const required of ["vfx-root", "vfx-revision", "scene", "donor-state", "receipt"]) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }

  const result = await observeVisualEffectPathSweepFrameNative(args["vfx-root"], {
    vfxRevision: args["vfx-revision"],
    halfWidth: args["half-width"] === undefined ? undefined : Number(args["half-width"]),
  });
  await Promise.all([
    writeOutput(args.scene, result.sceneBytes),
    writeOutput(args["donor-state"], result.donorStateBytes),
    writeOutput(args.receipt, result.receiptBytes),
  ]);

  console.log("vfx_path_sweep_frame_native=PASS");
  console.log(`retained_path_source_hash=${result.frameSet.pathSourceHash}`);
  console.log(`retained_sweep_source_hash=${result.retained.sourceHash}`);
  console.log(`derived_frame_set_hash=${result.frameSet.frameSetHash}`);
  console.log(`path_count=${result.frameSet.pathCount}`);
  console.log(`point_count=${result.frameSet.pointCount}`);
  console.log(`scene_sha256=${result.receipt.outputs.scene.sha256}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
