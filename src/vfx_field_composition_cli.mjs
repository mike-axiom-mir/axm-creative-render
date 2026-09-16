#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { composedFieldGridToAxmScene, observeVisualEffectFieldComposition } from "./vfx_field_composition_bridge.mjs";
import { sha256 } from "./creative_scene_operator.mjs";
import { pathIsInside } from "./path_safety.mjs";

function parseArgs(argv) {
  if (argv[0] !== "build") throw new Error("only the 'build' command is supported");
  const values = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    const name = key.slice(2);
    if (values[name] !== undefined) throw new Error(`duplicate --${name}`);
    values[name] = value;
  }
  for (const key of ["vfx-root", "multiply-scene", "add-scene", "multiply-state", "add-state", "receipt"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const vfxRoot = resolve(args["vfx-root"]);
  const outputs = {
    multiplyScene: resolve(args["multiply-scene"]),
    addScene: resolve(args["add-scene"]),
    multiplyState: resolve(args["multiply-state"]),
    addState: resolve(args["add-state"]),
    receipt: resolve(args.receipt),
  };
  const paths = Object.values(outputs);
  if (new Set(paths).size !== paths.length) throw new Error("field-composition output paths must be distinct");
  for (const path of paths) {
    if (pathIsInside(vfxRoot, path)) throw new Error("field-composition outputs may not be written inside the donor repository");
  }

  const shared = {
    a: { id: "creative-render-field-a", seed: 1201, frequency: 3.25, octaves: 4, lacunarity: 2, gain: 0.5, offset: [0.1, -0.2] },
    b: { id: "creative-render-field-b", seed: 9127, frequency: 5.5, octaves: 3, lacunarity: 2.2, gain: 0.45, offset: [1.3, 0.7] },
  };
  const multiply = await observeVisualEffectFieldComposition(vfxRoot, {
    ...shared,
    id: "creative-render-multiply",
    operation: "multiply",
  });
  const add = await observeVisualEffectFieldComposition(vfxRoot, {
    ...shared,
    id: "creative-render-add-clamp",
    operation: "add-clamp",
  });

  if (multiply.observation.input_a.source_hash !== add.observation.input_a.source_hash) {
    throw new Error("input field A changed across composition operations");
  }
  if (multiply.observation.input_b.source_hash !== add.observation.input_b.source_hash) {
    throw new Error("input field B changed across composition operations");
  }
  if (multiply.observation.composition_source.source_hash === add.observation.composition_source.source_hash) {
    throw new Error("distinct composition operations unexpectedly share canonical composition identity");
  }
  if (multiply.observation.grid.field_hash === add.observation.grid.field_hash) {
    throw new Error("distinct composition operations unexpectedly produced the same derived grid identity");
  }

  const multiplyScene = composedFieldGridToAxmScene(multiply.field);
  const addScene = composedFieldGridToAxmScene(add.field);
  if (sha256(multiplyScene.bytes) === sha256(addScene.bytes)) {
    throw new Error("distinct composition grids unexpectedly produced identical renderer scene bytes");
  }

  await write(outputs.multiplyScene, multiplyScene.bytes);
  await write(outputs.addScene, addScene.bytes);
  await write(outputs.multiplyState, multiply.stateBytes);
  await write(outputs.addState, add.stateBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_FIELD_COMPOSITION_RECEIPT",
    version: 1,
    mode: "current-vfx-two-field-composition-to-derived-axm-scenes",
    shared_inputs: {
      field_a_source_hash: multiply.observation.input_a.source_hash,
      field_b_source_hash: multiply.observation.input_b.source_hash,
      source_modules_identical_across_runs: JSON.stringify(multiply.observation.module_sha256) === JSON.stringify(add.observation.module_sha256),
    },
    multiply: {
      visual_effect_fabric: multiply.observation,
      grid_to_scene: multiplyScene.observation,
    },
    add_clamp: {
      visual_effect_fabric: add.observation,
      grid_to_scene: addScene.observation,
    },
    outputs: {
      multiply_scene: { contract: "AXM_SCENE 1", sha256: sha256(multiplyScene.bytes), bytes: multiplyScene.bytes.length },
      add_clamp_scene: { contract: "AXM_SCENE 1", sha256: sha256(addScene.bytes), bytes: addScene.bytes.length },
      multiply_state: { media_type: "application/json", sha256: sha256(multiply.stateBytes), bytes: multiply.stateBytes.length },
      add_clamp_state: { media_type: "application/json", sha256: sha256(add.stateBytes), bytes: add.stateBytes.length },
    },
    authority: {
      field_a: "CANONICAL_VFX_SCALAR_FIELD_SOURCE",
      field_b: "CANONICAL_VFX_SCALAR_FIELD_SOURCE",
      composition_sources: "CANONICAL_NEUTRAL_VFX_COMPOSITION_SOURCES",
      retained_grids: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
      axm_scenes: "DERIVED_REPLACEABLE_VISUAL_ADAPTER_BODIES",
      pixels: "NOT_PRODUCED_BY_THIS_CLI",
    },
    truth_boundary: {
      proves: [
        "the real current VFX two-field composition graph can execute twice per operation with repeat-stable final state",
        "the exact same two canonical scalar-field source hashes survive across materially different neutral composition operations",
        "changing only the neutral composition operation changes canonical composition identity, derived grid identity, and derived renderer scene bytes",
        "a bounded explicit adapter can materialize the retained derived scalar grid as AXM_SCENE 1 albedo tiles without promoting that visualization into field truth",
      ],
      does_not_prove: [
        "visual or artistic quality",
        "material, smoke, fire, weather, gameplay, physics, visibility, or masking semantics",
        "continuous-field equivalence beyond the retained sampled grid",
        "renderer pixels until a separate Render Fabric step executes",
        "real-time performance, GPU/browser parity, or cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("vfx_field_composition=PASS");
  console.log(`input_a_hash=${receipt.shared_inputs.field_a_source_hash}`);
  console.log(`input_b_hash=${receipt.shared_inputs.field_b_source_hash}`);
  console.log(`multiply_composition_hash=${multiply.observation.composition_source.source_hash}`);
  console.log(`add_clamp_composition_hash=${add.observation.composition_source.source_hash}`);
  console.log(`multiply_grid_hash=${multiply.observation.grid.field_hash}`);
  console.log(`add_clamp_grid_hash=${add.observation.grid.field_hash}`);
  console.log(`grid_cells=${multiply.observation.grid.cells}`);
  console.log(`scene_triangles=${multiplyScene.observation.output_triangle_count}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
