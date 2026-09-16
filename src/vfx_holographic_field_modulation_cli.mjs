#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { holographicSampleFieldToAxmScene, observeVisualEffectHolographicFieldModulation } from "./vfx_holographic_field_modulation_bridge.mjs";

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
  if (args.command !== "build") throw new Error("usage: vfx_holographic_field_modulation_cli.mjs build --vfx-root PATH --base-scene PATH --modulated-scene PATH --state PATH --receipt PATH");
  for (const key of ["vfx-root", "base-scene", "modulated-scene", "state", "receipt"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }

  const observed = await observeVisualEffectHolographicFieldModulation(resolve(args["vfx-root"]));
  const base = holographicSampleFieldToAxmScene(observed.base, "base", {
    source_hash: observed.observation.base_sample.source_hash,
    source_schema: observed.base.schema,
  });
  const modulated = holographicSampleFieldToAxmScene(observed.modulated, "modulated", {
    source_hash: observed.modulated.sampleFieldHash,
    source_schema: observed.modulated.schema,
    base_sample_hash: observed.modulated.baseSampleFieldHash,
    derived: observed.modulated.derived,
    rebuildable: observed.modulated.rebuildable,
  });
  if (base.observation.geometry_layout_sha256 !== modulated.observation.geometry_layout_sha256) throw new Error("base and modulated holographic scene adapters do not share exact sample layout");
  if (base.observation.output_triangle_count !== modulated.observation.output_triangle_count) throw new Error("base and modulated holographic scene triangle counts differ");
  if (sha256(base.bytes) === sha256(modulated.bytes)) throw new Error("holographic modulation produced identical derived scene bytes");

  const outputs = {};
  outputs.base_scene = await writeBound(args["base-scene"], base.bytes);
  outputs.modulated_scene = await writeBound(args["modulated-scene"], modulated.bytes);
  outputs.vfx_state = await writeBound(args.state, observed.stateBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_HOLOGRAPHIC_FIELD_MODULATION_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    base_to_scene: base.observation,
    modulated_to_scene: modulated.observation,
    comparison: {
      same_canonical_form_hash: observed.base.canonicalFormHash === observed.modulated.canonicalFormHash,
      same_retained_base_hash: observed.modulated.baseSampleFieldHash === observed.observation.base_sample.source_hash,
      same_point_count: base.observation.point_count === modulated.observation.point_count,
      same_renderer_layout: base.observation.geometry_layout_sha256 === modulated.observation.geometry_layout_sha256,
      same_scene_triangle_count: base.observation.output_triangle_count === modulated.observation.output_triangle_count,
      base_scene_sha256: outputs.base_scene.sha256,
      modulated_scene_sha256: outputs.modulated_scene.sha256,
      scene_bytes_differ: outputs.base_scene.sha256 !== outputs.modulated_scene.sha256,
      adapter_difference_channel: "RGB_ALBEDO_FROM_DERIVED_SAMPLE_INTENSITY_ONLY"
    },
    outputs,
    authority: {
      canonical_holographic_form: "CANONICAL_VFX_FORM_STATE",
      base_sample_field: "RETAINED_DERIVED_VFX_SAMPLE_STATE",
      scalar_field_sources: "CANONICAL_VFX_SCALAR_FIELD_SOURCES",
      composition_source: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE",
      modulation_source: "CANONICAL_NEUTRAL_VFX_MODULATION_SOURCE",
      modulated_sample_field: "DERIVED_REBUILDABLE_VFX_BODY",
      axm_scenes: "DERIVED_REPLACEABLE_VISUAL_ADAPTER_BODIES",
      pixels: "NOT_PRODUCED_BY_THIS_COMMAND"
    },
    truth_boundary: {
      proves: "the current VFX holographic composed-field modulation graph preserves canonical form identity and retained sample geometry while producing a separately identified derived intensity-modulated sample field that crosses one explicit intensity-to-albedo visualization adapter",
      does_not_prove: "physical holography, donor WebGL equivalence, projector behavior, shimmer/breakup semantics, aesthetic quality, gameplay or world meaning, realtime performance, GPU/browser parity, or cross-machine bitwise determinism"
    }
  };
  const receiptOut = await writeBound(args.receipt, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));

  console.log("vfx_holographic_field_modulation=PASS");
  console.log(`canonical_form_hash=${observed.observation.canonical_form.source_hash}`);
  console.log(`base_sample_hash=${observed.observation.base_sample.source_hash}`);
  console.log(`modulated_sample_hash=${observed.observation.modulated_sample.sample_field_hash}`);
  console.log(`composition_source_hash=${observed.observation.composition_source.source_hash}`);
  console.log(`modulation_source_hash=${observed.observation.modulation_source.source_hash}`);
  console.log(`factor_stats=${JSON.stringify(observed.observation.modulated_sample.factor_stats)}`);
  console.log(`scene_triangles=${base.observation.output_triangle_count}`);
  console.log(`base_scene_sha256=${outputs.base_scene.sha256}`);
  console.log(`modulated_scene_sha256=${outputs.modulated_scene.sha256}`);
  console.log(`receipt_sha256=${receiptOut.sha256}`);
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
