#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeVisualEffectBranchPropagationNative } from "./vfx_branch_propagation_native_bridge.mjs";

function usage() {
  console.error("usage: node src/vfx_branch_propagation_native_cli.mjs build --vfx-root <dir> --vfx-revision <sha> --phase-a-scene <file> --phase-b-scene <file> --donor-state <file> --receipt <file> [--phase-a <0..1>] [--phase-b <0..1>]");
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

  const result = await observeVisualEffectBranchPropagationNative(args["vfx-root"], {
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

  console.log("vfx_branch_propagation_native=PASS");
  console.log(`branch_network_hash=${result.network.networkHash}`);
  console.log(`phase_a_envelope_hash=${result.phaseAEnvelope.envelopeHash}`);
  console.log(`phase_b_envelope_hash=${result.phaseBEnvelope.envelopeHash}`);
  console.log(`shared_geometry_sha256=${result.receipt.native_observer.phase_a.geometry_sha256}`);
  console.log(`phase_a_scene_sha256=${result.receipt.outputs.phase_a_scene.sha256}`);
  console.log(`phase_b_scene_sha256=${result.receipt.outputs.phase_b_scene.sha256}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
