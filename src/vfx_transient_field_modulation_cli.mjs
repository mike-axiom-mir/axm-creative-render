#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { impulseFieldToAxmScene, observeVisualEffectImpulseFieldModulation } from "./vfx_transient_field_modulation_bridge.mjs";

function parseArgs(argv) {
  const out = { command: argv[2] ?? "" };
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  return out;
}

async function writeBound(path, bytes) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const written = await readFile(target);
  if (sha256(written) !== sha256(bytes)) throw new Error(`written bytes changed for ${path}`);
  return { path: target, sha256: sha256(written), bytes: written.length };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command !== "build") throw new Error("usage: vfx_transient_field_modulation_cli.mjs build --vfx-root PATH --base-scene PATH --modulated-scene PATH --state PATH --receipt PATH");
  for (const key of ["vfx-root", "base-scene", "modulated-scene", "state", "receipt"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }

  const observed = await observeVisualEffectImpulseFieldModulation(resolve(args["vfx-root"]));
  const base = impulseFieldToAxmScene(observed.event, observed.canonicalEventHash, observed.baseField, "base");
  const modulated = impulseFieldToAxmScene(observed.event, observed.canonicalEventHash, observed.modulatedField, "modulated");
  if (base.observation.geometry_layout_sha256 !== modulated.observation.geometry_layout_sha256) throw new Error("base and modulated scene adapters do not share exact primitive layout");
  if (base.observation.output_triangle_count !== modulated.observation.output_triangle_count) throw new Error("base and modulated scene triangle counts differ");
  if (sha256(base.bytes) === sha256(modulated.bytes)) throw new Error("modulated field produced identical derived scene bytes");

  const outputs = {};
  outputs.base_scene = await writeBound(args["base-scene"], base.bytes);
  outputs.modulated_scene = await writeBound(args["modulated-scene"], modulated.bytes);
  outputs.vfx_state = await writeBound(args.state, observed.stateBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_TRANSIENT_FIELD_MODULATION_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    base_to_scene: base.observation,
    modulated_to_scene: modulated.observation,
    comparison: {
      same_canonical_event_hash: observed.baseField.canonicalEventHash === observed.modulatedField.canonicalEventHash,
      same_primitive_counts: JSON.stringify(observed.baseField.counts) === JSON.stringify(observed.modulatedField.counts),
      same_primitive_layout: base.observation.geometry_layout_sha256 === modulated.observation.geometry_layout_sha256,
      same_scene_triangle_count: base.observation.output_triangle_count === modulated.observation.output_triangle_count,
      base_scene_sha256: outputs.base_scene.sha256,
      modulated_scene_sha256: outputs.modulated_scene.sha256,
      scene_bytes_differ: outputs.base_scene.sha256 !== outputs.modulated_scene.sha256,
      adapter_difference_channel: "RGB_ALBEDO_FROM_DERIVED_INTENSITY_ONLY",
    },
    outputs,
    authority: {
      canonical_event: "CANONICAL_VFX_TRANSIENT_EVENT",
      scalar_field_sources: "CANONICAL_VFX_SCALAR_FIELD_SOURCES",
      composition_source: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE",
      modulation_source: "CANONICAL_NEUTRAL_VFX_MODULATION_SOURCE",
      base_impulse_field: "DERIVED_REBUILDABLE_VFX_BODY",
      modulated_impulse_field: "DERIVED_REBUILDABLE_VFX_BODY",
      axm_scenes: "DERIVED_REPLACEABLE_VISUAL_ADAPTER_BODIES",
      pixels: "NOT_PRODUCED_BY_THIS_COMMAND"
    },
    truth_boundary: {
      proves: "the current VFX composed-field modulation graph preserves canonical event and base impulse layout while producing a separate derived modulated field that crosses one explicit intensity-to-albedo visualization adapter",
      does_not_prove: "aesthetic quality, consumer/gameplay/physics meaning, physical force semantics, browser/GPU parity, realtime performance, or cross-machine bitwise determinism"
    }
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const receiptOut = await writeBound(args.receipt, receiptBytes);

  console.log("vfx_transient_field_modulation=PASS");
  console.log(`canonical_event_hash=${observed.canonicalEventHash}`);
  console.log(`base_geometry_hash=${observed.baseField.geometryHash}`);
  console.log(`modulated_geometry_hash=${observed.modulatedField.geometryHash}`);
  console.log(`composition_source_hash=${observed.observation.composition_source.source_hash}`);
  console.log(`modulation_source_hash=${observed.observation.modulation_source.source_hash}`);
  console.log(`factor_mean=${observed.modulatedField.factorStats.mean}`);
  console.log(`scene_triangles=${base.observation.output_triangle_count}`);
  console.log(`base_scene_sha256=${outputs.base_scene.sha256}`);
  console.log(`modulated_scene_sha256=${outputs.modulated_scene.sha256}`);
  console.log(`receipt_sha256=${receiptOut.sha256}`);
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
