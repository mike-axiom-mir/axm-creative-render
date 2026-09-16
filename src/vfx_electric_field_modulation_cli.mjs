#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { electricPathsToAxmScene, observeVisualEffectElectricFieldModulation } from "./vfx_electric_field_modulation_bridge.mjs";

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
  if (args.command !== "build") throw new Error("usage: vfx_electric_field_modulation_cli.mjs build --vfx-root PATH --base-scene PATH --modulated-scene PATH --state PATH --receipt PATH");
  for (const key of ["vfx-root", "base-scene", "modulated-scene", "state", "receipt"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }

  const observed = await observeVisualEffectElectricFieldModulation(resolve(args["vfx-root"]));
  const base = electricPathsToAxmScene(observed.basePaths, "base", {
    source_hash: observed.observation.base_paths.source_hash,
    source_schema: "VFX_RETAINED_ELECTRIC_PATHS_ARRAY",
  });
  const modulated = electricPathsToAxmScene(observed.modulated.paths, "modulated", {
    source_hash: observed.modulated.pathSetHash,
    source_schema: observed.modulated.schema,
    base_paths_hash: observed.modulated.basePathsHash,
    derived: observed.modulated.derived,
    rebuildable: observed.modulated.rebuildable,
  });
  if (base.observation.geometry_layout_sha256 !== modulated.observation.geometry_layout_sha256) throw new Error("base and modulated electric scene adapters do not share exact path layout");
  if (base.observation.output_triangle_count !== modulated.observation.output_triangle_count) throw new Error("base and modulated electric scene triangle counts differ");
  if (sha256(base.bytes) === sha256(modulated.bytes)) throw new Error("electric modulation produced identical derived scene bytes");

  const outputs = {};
  outputs.base_scene = await writeBound(args["base-scene"], base.bytes);
  outputs.modulated_scene = await writeBound(args["modulated-scene"], modulated.bytes);
  outputs.vfx_state = await writeBound(args.state, observed.stateBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_ELECTRIC_FIELD_MODULATION_RECEIPT",
    version: 1,
    visual_effect_fabric: observed.observation,
    base_to_scene: base.observation,
    modulated_to_scene: modulated.observation,
    comparison: {
      same_retained_base_hash: observed.modulated.basePathsHash === observed.observation.base_paths.source_hash,
      same_path_count: base.observation.path_count === modulated.observation.path_count,
      same_segment_count: base.observation.segment_count === modulated.observation.segment_count,
      same_renderer_layout: base.observation.geometry_layout_sha256 === modulated.observation.geometry_layout_sha256,
      same_scene_triangle_count: base.observation.output_triangle_count === modulated.observation.output_triangle_count,
      base_scene_sha256: outputs.base_scene.sha256,
      modulated_scene_sha256: outputs.modulated_scene.sha256,
      scene_bytes_differ: outputs.base_scene.sha256 !== outputs.modulated_scene.sha256,
      adapter_difference_channel: "RGB_ALBEDO_FROM_DERIVED_PATH_ENERGY_ONLY",
    },
    outputs,
    authority: {
      base_electric_paths: "RETAINED_VFX_ELECTRIC_PATH_STATE",
      scalar_field_sources: "CANONICAL_VFX_SCALAR_FIELD_SOURCES",
      composition_source: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCE",
      modulation_source: "CANONICAL_NEUTRAL_VFX_MODULATION_SOURCE",
      modulated_electric_paths: "DERIVED_REBUILDABLE_VFX_BODY",
      axm_scenes: "DERIVED_REPLACEABLE_VISUAL_ADAPTER_BODIES",
      pixels: "NOT_PRODUCED_BY_THIS_COMMAND"
    },
    truth_boundary: {
      proves: "the current VFX electric composed-field modulation graph preserves retained path topology and non-energy path state while producing a separately identified derived energy-modulated path set that crosses one explicit energy-to-albedo visualization adapter",
      does_not_prove: "physical electricity, bloom/atmosphere/pulse realization, lighting interaction, aesthetic quality, gameplay or world meaning, browser/GPU parity, realtime performance, or cross-machine bitwise determinism"
    }
  };
  const receiptOut = await writeBound(args.receipt, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));

  console.log("vfx_electric_field_modulation=PASS");
  console.log(`base_paths_hash=${observed.observation.base_paths.source_hash}`);
  console.log(`modulated_path_set_hash=${observed.modulated.pathSetHash}`);
  console.log(`composition_source_hash=${observed.observation.composition_source.source_hash}`);
  console.log(`modulation_source_hash=${observed.observation.modulation_source.source_hash}`);
  console.log(`factor_stats=${JSON.stringify(observed.modulated.factorStats)}`);
  console.log(`scene_triangles=${base.observation.output_triangle_count}`);
  console.log(`base_scene_sha256=${outputs.base_scene.sha256}`);
  console.log(`modulated_scene_sha256=${outputs.modulated_scene.sha256}`);
  console.log(`receipt_sha256=${receiptOut.sha256}`);
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
