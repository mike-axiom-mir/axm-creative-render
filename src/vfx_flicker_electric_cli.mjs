#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { sha256 } from "./creative_scene_operator.mjs";
import {
  flickerElectricViewToAxmScene,
  observeVisualEffectFlickerElectric,
} from "./vfx_flicker_electric_bridge.mjs";

function parseArgs(argv) {
  const args = { command: argv[2] };
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function required(args, key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required`);
  return value;
}

async function writeBound(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command !== "build") throw new Error("usage: vfx_flicker_electric_cli.mjs build --vfx-root <dir> --phase-a-scene <file> --phase-b-scene <file> --flicker-state <file> --receipt <file> [--max-paths <n>]");
  const root = resolve(required(args, "vfx-root"));
  const phaseAPath = resolve(required(args, "phase-a-scene"));
  const phaseBPath = resolve(required(args, "phase-b-scene"));
  const statePath = resolve(required(args, "flicker-state"));
  const receiptPath = resolve(required(args, "receipt"));
  const maxPaths = args["max-paths"] === undefined ? undefined : Number(args["max-paths"]);

  const observed = await observeVisualEffectFlickerElectric(root, { maxPaths });
  const phaseA = flickerElectricViewToAxmScene(observed.phaseA);
  const phaseB = flickerElectricViewToAxmScene(observed.phaseB);
  if (phaseA.observation.geometry_layout_sha256 !== phaseB.observation.geometry_layout_sha256) throw new Error("flicker electric native observer geometry drifted between phases");
  if (phaseA.observation.output_triangle_count !== phaseB.observation.output_triangle_count) throw new Error("flicker electric native observer topology drifted between phases");
  if (phaseA.observation.output_sha256 === phaseB.observation.output_sha256) throw new Error("flicker electric native observer did not distinguish selected phase energy");

  const flickerStateBytes = Buffer.from(`${JSON.stringify(observed.flickerState, null, 2)}\n`, "utf8");
  const outputs = {
    phase_a_scene: await writeBound(phaseAPath, phaseA.bytes),
    phase_b_scene: await writeBound(phaseBPath, phaseB.bytes),
    flicker_state: await writeBound(statePath, flickerStateBytes),
  };
  const receipt = {
    contract: "AXM_CREATIVE_VFX_FLICKER_ELECTRIC_NATIVE_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    views: {
      phase_a: {
        schema: observed.phaseA.schema,
        view_hash: observed.phaseA.viewHash,
        phase: observed.phaseA.phase,
        factor: observed.phaseA.factor,
        mapping: observed.phaseA.mapping,
        electric_path_set_hash: observed.phaseA.electricPathSetHash,
        flicker_source_hash: observed.phaseA.flickerSourceHash,
        derived: observed.phaseA.derived,
        rebuildable: observed.phaseA.rebuildable,
      },
      phase_b: {
        schema: observed.phaseB.schema,
        view_hash: observed.phaseB.viewHash,
        phase: observed.phaseB.phase,
        factor: observed.phaseB.factor,
        mapping: observed.phaseB.mapping,
        electric_path_set_hash: observed.phaseB.electricPathSetHash,
        flicker_source_hash: observed.phaseB.flickerSourceHash,
        derived: observed.phaseB.derived,
        rebuildable: observed.phaseB.rebuildable,
      },
    },
    native_observer: {
      phase_a: phaseA.observation,
      phase_b: phaseB.observation,
      same_geometry_layout: phaseA.observation.geometry_layout_sha256 === phaseB.observation.geometry_layout_sha256,
      same_triangle_count: phaseA.observation.output_triangle_count === phaseB.observation.output_triangle_count,
      scene_bytes_differ: phaseA.observation.output_sha256 !== phaseB.observation.output_sha256,
      difference_channel: "NEUTRAL_GRAYSCALE_FROM_FLICKER_SCALED_DERIVED_ELECTRIC_ENERGY_ONLY",
    },
    outputs,
    truth_boundary: {
      proves: "one retained renderer-neutral VFX flicker cycle can drive only the energy field of an already-derived VFX electric path set at explicit normalized phases, with caller-neutral replay, whole-cycle identity replay, unchanged geometry/non-energy state, non-creative path capacity, and replaceable native observation bodies",
      does_not_prove: "physical electricity, real light emission, bloom, perceptual flicker quality, photosensitivity safety, comfort, aesthetic quality, temporal frame pacing, target-device performance, GPU/browser parity or cross-machine bitwise determinism",
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeBound(receiptPath, receiptBytes);
  console.log(JSON.stringify({ receipt: receiptPath, phase_a_view_hash: observed.phaseA.viewHash, phase_b_view_hash: observed.phaseB.viewHash, flicker_source_hash: observed.observation.flicker_source.source_hash }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
