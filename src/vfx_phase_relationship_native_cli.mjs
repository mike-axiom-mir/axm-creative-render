#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeVisualEffectPhaseRelationshipNative } from "./vfx_phase_relationship_native_bridge.mjs";

function usage() {
  console.error("usage: node src/vfx_phase_relationship_native_cli.mjs build --vfx-root <dir> --vfx-revision <sha> --phase-a-scene <file> --phase-b-scene <file> --donor-state <file> --receipt <file> [--phase-a <number>] [--phase-b <number>]");
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
  for (const required of ["vfx-root", "vfx-revision", "phase-a-scene", "phase-b-scene", "donor-state", "receipt"]) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }

  const result = await observeVisualEffectPhaseRelationshipNative(args["vfx-root"], {
    vfxRevision: args["vfx-revision"],
    phaseA: args["phase-a"] === undefined ? undefined : Number(args["phase-a"]),
    phaseB: args["phase-b"] === undefined ? undefined : Number(args["phase-b"]),
  });

  await Promise.all([
    writeOutput(args["phase-a-scene"], result.phaseASceneBytes),
    writeOutput(args["phase-b-scene"], result.phaseBSceneBytes),
    writeOutput(args["donor-state"], result.donorStateBytes),
    writeOutput(args.receipt, result.receiptBytes),
  ]);

  console.log("vfx_phase_relationship_native=PASS");
  console.log(`phase_relationship_source_hash=${result.sourceHash}`);
  console.log(`phase_a_set_hash=${result.phaseASet.phaseSetHash}`);
  console.log(`phase_b_set_hash=${result.phaseBSet.phaseSetHash}`);
  console.log(`shared_geometry_sha256=${result.receipt.native_observer.phase_a.geometry_sha256}`);
  console.log(`phase_a_scene_sha256=${result.receipt.outputs.phase_a_scene.sha256}`);
  console.log(`phase_b_scene_sha256=${result.receipt.outputs.phase_b_scene.sha256}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
