#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { sha256 } from "./creative_scene_operator.mjs";
import {
  directElectricFlickerSetToAxmScene,
  observeVisualEffectDirectElectricFlicker,
} from "./vfx_direct_electric_flicker_bridge.mjs";

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
  if (args.command !== "build") throw new Error("usage: vfx_direct_electric_flicker_cli.mjs build --vfx-root <dir> --phase-a-scene <file> --phase-b-scene <file> --donor-state <file> --receipt <file>");
  const root = resolve(required(args, "vfx-root"));
  const phaseAPath = resolve(required(args, "phase-a-scene"));
  const phaseBPath = resolve(required(args, "phase-b-scene"));
  const statePath = resolve(required(args, "donor-state"));
  const receiptPath = resolve(required(args, "receipt"));

  const observed = await observeVisualEffectDirectElectricFlicker(root);
  const phaseA = directElectricFlickerSetToAxmScene(observed.setA);
  const phaseB = directElectricFlickerSetToAxmScene(observed.setB);
  if (phaseA.observation.geometry_layout_sha256 !== phaseB.observation.geometry_layout_sha256) throw new Error("direct electric flicker native observer geometry drifted between phases");
  if (phaseA.observation.output_triangle_count !== phaseB.observation.output_triangle_count) throw new Error("direct electric flicker native observer topology drifted between phases");
  if (phaseA.observation.output_sha256 === phaseB.observation.output_sha256) throw new Error("direct electric flicker native observer did not distinguish donor-derived energy phases");

  const donorStateBytes = Buffer.from(`${JSON.stringify(observed.stateA, null, 2)}\n`, "utf8");
  const outputs = {
    phase_a_scene: await writeBound(phaseAPath, phaseA.bytes),
    phase_b_scene: await writeBound(phaseBPath, phaseB.bytes),
    donor_state: await writeBound(statePath, donorStateBytes),
  };
  const receipt = {
    contract: "AXM_CREATIVE_VFX_DIRECT_ELECTRIC_FLICKER_NATIVE_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    derived_sets: {
      phase_a: {
        schema: observed.setA.schema,
        modulated_set_hash: observed.setA.modulatedSetHash,
        path_set_hash: observed.setA.pathSetHash,
        phase: observed.setA.phase,
        sample_value: observed.setA.sampleValue,
        normalized_sample: observed.setA.normalizedSample,
        factor: observed.setA.factor,
        derived: observed.setA.derived,
        rebuildable: observed.setA.rebuildable,
      },
      phase_b: {
        schema: observed.setB.schema,
        modulated_set_hash: observed.setB.modulatedSetHash,
        path_set_hash: observed.setB.pathSetHash,
        phase: observed.setB.phase,
        sample_value: observed.setB.sampleValue,
        normalized_sample: observed.setB.normalizedSample,
        factor: observed.setB.factor,
        derived: observed.setB.derived,
        rebuildable: observed.setB.rebuildable,
      },
    },
    native_observer: {
      phase_a: phaseA.observation,
      phase_b: phaseB.observation,
      same_geometry_layout: phaseA.observation.geometry_layout_sha256 === phaseB.observation.geometry_layout_sha256,
      same_triangle_count: phaseA.observation.output_triangle_count === phaseB.observation.output_triangle_count,
      scene_bytes_differ: phaseA.observation.output_sha256 !== phaseB.observation.output_sha256,
      difference_channel: "NEUTRAL_GRAYSCALE_FROM_DONOR_DERIVED_ELECTRIC_FLICKER_ENERGY_ONLY",
    },
    outputs,
    truth_boundary: {
      proves: "the current VFX donor's own electric flicker-cycle modulation graph can retain electric, flicker and binding source authority while producing rebuild-validated phase-selected derived path-energy sets that a replaceable Creative Render native observer consumes without changing geometry or non-energy path state",
      does_not_prove: "physical electricity, real emitted light, bloom, perceptual flicker quality, photosensitivity safety, comfort, aesthetic quality, temporal frame pacing, target-device performance, GPU/browser parity or cross-machine bitwise determinism",
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeBound(receiptPath, receiptBytes);
  console.log(JSON.stringify({
    receipt: receiptPath,
    graph_id: observed.observation.graph_id,
    phase_a_modulated_set_hash: observed.setA.modulatedSetHash,
    phase_b_modulated_set_hash: observed.setB.modulatedSetHash,
    retained_flicker_source_hash: observed.observation.retained.flicker_cycle_source_hash,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
