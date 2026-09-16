#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { domainWarpGridToAxmScene, observeVisualEffectDomainWarp } from "./vfx_domain_warp_bridge.mjs";
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
  for (const key of ["vfx-root", "zero-scene", "warped-scene", "zero-state", "warped-state", "receipt"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return values;
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "w" });
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const vfxRoot = resolve(args["vfx-root"]);
  const outputs = {
    zeroScene: resolve(args["zero-scene"]),
    warpedScene: resolve(args["warped-scene"]),
    zeroState: resolve(args["zero-state"]),
    warpedState: resolve(args["warped-state"]),
    receipt: resolve(args.receipt),
  };
  const paths = Object.values(outputs);
  if (new Set(paths).size !== paths.length) throw new Error("domain-warp output paths must be distinct");
  for (const path of paths) {
    if (pathIsInside(vfxRoot, path)) throw new Error("domain-warp outputs may not be written inside the donor repository");
  }

  const shared = {
    id: "creative-render-domain-warp",
    field: {
      id: "creative-render-domain-base",
      seed: 90210,
      frequency: 4.5,
      octaves: 5,
      lacunarity: 2.15,
      gain: 0.57,
      offset: [0.2, -0.1],
    },
    flowField: {
      id: "creative-render-domain-flow-field",
      seed: 4404,
      frequency: 2.25,
      octaves: 4,
      lacunarity: 2.1,
      gain: 0.52,
      offset: [-0.35, 0.4],
    },
    flow: {
      id: "creative-render-domain-flow",
      mode: "tangent",
      sampleStep: 0.01,
      strength: 1.4,
    },
  };

  const zero = await observeVisualEffectDomainWarp(vfxRoot, { ...shared, amplitude: 0 });
  const warped = await observeVisualEffectDomainWarp(vfxRoot, { ...shared, amplitude: 0.18 });

  for (const key of ["base_source", "flow_scalar_source", "flow_source"]) {
    if (zero.observation[key].source_hash !== warped.observation[key].source_hash) {
      throw new Error(`${key} changed across zero/active warp challenge`);
    }
  }
  if (!sameJson(zero.observation.module_sha256, warped.observation.module_sha256)) {
    throw new Error("VFX donor module identity changed across zero/active warp challenge");
  }
  if (zero.observation.zero_amplitude_exact_noop_verified !== true || zero.observation.grid.max_displacement !== 0) {
    throw new Error("zero-amplitude donor no-op evidence failed");
  }
  if (!(warped.observation.grid.max_displacement > 0)) throw new Error("active domain warp produced no retained displacement");
  if (zero.observation.warp_source.source_hash === warped.observation.warp_source.source_hash) {
    throw new Error("zero/active domain-warp sources unexpectedly share identity");
  }
  if (zero.observation.grid.field_hash === warped.observation.grid.field_hash) {
    throw new Error("zero/active domain-warp grids unexpectedly share identity");
  }
  if (sameJson(zero.field.values, warped.field.values)) {
    throw new Error("active domain warp did not alter the derived sampled scalar grid");
  }

  const zeroScene = domainWarpGridToAxmScene(zero.field);
  const warpedScene = domainWarpGridToAxmScene(warped.field);
  if (zeroScene.observation.output_triangle_count !== warpedScene.observation.output_triangle_count) {
    throw new Error("zero/active domain-warp scene topology count changed");
  }
  const zeroVertices = zeroScene.scene.triangles.map((triangle) => triangle.vertices);
  const warpedVertices = warpedScene.scene.triangles.map((triangle) => triangle.vertices);
  if (!sameJson(zeroVertices, warpedVertices)) throw new Error("domain-warp visualization changed geometry instead of albedo only");
  if (sha256(zeroScene.bytes) === sha256(warpedScene.bytes)) {
    throw new Error("different domain-warp grids unexpectedly produced identical renderer scene bytes");
  }

  await write(outputs.zeroScene, zeroScene.bytes);
  await write(outputs.warpedScene, warpedScene.bytes);
  await write(outputs.zeroState, zero.stateBytes);
  await write(outputs.warpedState, warped.stateBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_DOMAIN_WARP_RECEIPT",
    version: 1,
    mode: "current-vfx-renderer-neutral-domain-warp-to-derived-axm-scenes",
    shared_inputs: {
      base_source_hash: zero.observation.base_source.source_hash,
      flow_scalar_source_hash: zero.observation.flow_scalar_source.source_hash,
      flow_source_hash: zero.observation.flow_source.source_hash,
      source_modules_identical_across_runs: sameJson(zero.observation.module_sha256, warped.observation.module_sha256),
    },
    zero_amplitude: {
      visual_effect_fabric: zero.observation,
      grid_to_scene: zeroScene.observation,
    },
    active_warp: {
      visual_effect_fabric: warped.observation,
      grid_to_scene: warpedScene.observation,
    },
    challenge: {
      only_declared_warp_control_changed: true,
      zero_amplitude: 0,
      active_amplitude: 0.18,
      zero_is_exact_base_noop: zero.observation.zero_amplitude_exact_noop_verified,
      active_max_displacement: warped.observation.grid.max_displacement,
      retained_source_hashes_stable: true,
      warp_source_identity_changed: true,
      derived_grid_identity_changed: true,
      adapter_geometry_identical: true,
      scene_bytes_changed: true,
    },
    outputs: {
      zero_scene: { contract: "AXM_SCENE 1", sha256: sha256(zeroScene.bytes), bytes: zeroScene.bytes.length },
      warped_scene: { contract: "AXM_SCENE 1", sha256: sha256(warpedScene.bytes), bytes: warpedScene.bytes.length },
      zero_state: { media_type: "application/json", sha256: sha256(zero.stateBytes), bytes: zero.stateBytes.length },
      warped_state: { media_type: "application/json", sha256: sha256(warped.stateBytes), bytes: warped.stateBytes.length },
    },
    authority: {
      base_scalar_source: "CANONICAL_VFX_SCALAR_FIELD_SOURCE",
      flow_scalar_source: "CANONICAL_VFX_SCALAR_FIELD_SOURCE",
      vector_flow_source: "CANONICAL_VFX_VECTOR_FLOW_SOURCE",
      domain_warp_sources: "CANONICAL_NEUTRAL_VFX_DOMAIN_WARP_SOURCES",
      retained_grids: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
      axm_scenes: "DERIVED_REPLACEABLE_VISUAL_ADAPTER_BODIES",
      pixels: "NOT_PRODUCED_BY_THIS_CLI",
    },
    truth_boundary: {
      proves: [
        "the real current VFX renderer-neutral domain-warp graph executes caller-neutrally over retained scalar/vector source truth",
        "zero amplitude is independently checked as an exact no-op against the retained base scalar sampler",
        "changing only the declared warp amplitude preserves base/flow source identities while changing warp-source identity, derived grid identity, and derived scene bytes",
        "a bounded explicit adapter can visualize the derived scalar grid as fixed AXM_SCENE 1 geometry with scalar values encoded only as albedo",
      ],
      does_not_prove: [
        "visual or artistic quality",
        "smoke, water, wind, particles, cracks, gameplay, UI, material, visibility, or masking semantics",
        "physical fluid or vector-flow correctness",
        "continuous-field equivalence beyond the retained sampled grid",
        "renderer pixels until a separate Render Fabric step executes",
        "real-time performance, GPU/browser parity, or cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("vfx_domain_warp=PASS");
  console.log(`base_source_hash=${receipt.shared_inputs.base_source_hash}`);
  console.log(`flow_source_hash=${receipt.shared_inputs.flow_source_hash}`);
  console.log(`zero_warp_source_hash=${zero.observation.warp_source.source_hash}`);
  console.log(`active_warp_source_hash=${warped.observation.warp_source.source_hash}`);
  console.log(`zero_grid_hash=${zero.observation.grid.field_hash}`);
  console.log(`warped_grid_hash=${warped.observation.grid.field_hash}`);
  console.log(`active_max_displacement=${warped.observation.grid.max_displacement}`);
  console.log(`scene_triangles=${zeroScene.observation.output_triangle_count}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
