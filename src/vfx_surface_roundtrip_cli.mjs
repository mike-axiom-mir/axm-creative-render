#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeUniversalCreation } from "./donor_bridge.mjs";
import { axmSceneToHolographicSampleField } from "./direct_sample_bridge.mjs";
import { observeVisualEffectVoxelSurface, surfaceMeshToAxmScene } from "./vfx_surface_roundtrip_bridge.mjs";
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
  for (const key of ["uc-root", "vfx-root", "source-scene", "surface-scene", "state", "html", "receipt"]) {
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
  const ucRoot = resolve(args["uc-root"]), vfxRoot = resolve(args["vfx-root"]);
  const outputs = {
    sourceScene: resolve(args["source-scene"]),
    surfaceScene: resolve(args["surface-scene"]),
    state: resolve(args.state),
    html: resolve(args.html),
    receipt: resolve(args.receipt),
  };
  const paths = Object.values(outputs);
  if (new Set(paths).size !== paths.length) throw new Error("roundtrip output paths must be distinct");
  for (const path of paths) {
    if (pathIsInside(ucRoot, path) || pathIsInside(vfxRoot, path)) {
      throw new Error("roundtrip outputs may not be written inside donor repositories");
    }
  }

  const uc = await observeUniversalCreation(ucRoot);
  const sourceSha = sha256(uc.sceneBytes);
  const adapted = axmSceneToHolographicSampleField(uc.sceneBytes, {
    id: "creative-render-vfx-surface-roundtrip",
    samplesPerTriangle: 24,
    maxTriangles: 512,
    pointSize: 1.6,
  });
  if (adapted.observation.source_scene_sha256 !== sourceSha || adapted.field.sourceDigest !== sourceSha) {
    throw new Error("direct-sample adapter lost source-scene identity");
  }

  const vfx = await observeVisualEffectVoxelSurface(vfxRoot, adapted.field, {
    resolution: 18,
    kernel: 1.9,
    iso: 0.16,
    maxTriangles: 12_000,
    seed: 20260916,
  });
  if (vfx.observation.source_digest !== sourceSha) throw new Error("VFX voxel surface lost source-scene identity");

  const roundtrip = surfaceMeshToAxmScene(vfx.surfaceMesh, { albedo: [54, 210, 240] });
  if (roundtrip.observation.source_surface_digest !== vfx.observation.surface.digest) {
    throw new Error("surface-to-scene adapter lost VFX mesh identity");
  }
  if (roundtrip.observation.source_voxel_digest !== vfx.observation.voxel.digest) {
    throw new Error("surface-to-scene adapter lost VFX voxel identity");
  }

  await write(outputs.sourceScene, uc.sceneBytes);
  await write(outputs.surfaceScene, roundtrip.bytes);
  await write(outputs.state, vfx.stateBytes);
  await write(outputs.html, vfx.htmlBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_SURFACE_ROUNDTRIP_RECEIPT",
    version: 1,
    mode: "uc-scene-to-direct-sample-to-vfx-voxel-surface-to-axm-scene",
    universal_creation: uc.observation,
    direct_sample: adapted.observation,
    visual_effect_fabric: vfx.observation,
    surface_to_scene: roundtrip.observation,
    outputs: {
      source_scene: { contract: "AXM_SCENE 1", sha256: sourceSha, bytes: uc.sceneBytes.length },
      surface_scene: { contract: "AXM_SCENE 1", sha256: sha256(roundtrip.bytes), bytes: roundtrip.bytes.length },
      vfx_state: { media_type: "application/json", sha256: sha256(vfx.stateBytes), bytes: vfx.stateBytes.length },
      vfx_html: { media_type: "text/html", sha256: sha256(vfx.htmlBytes), bytes: vfx.htmlBytes.length },
    },
    authority: {
      source_scene: "AXM_SCENE_1_CALLER_STATE",
      direct_sample_field: "DERIVED_REBUILDABLE_VFX_INPUT_STATE",
      voxel_density: "DERIVED_REBUILDABLE_VFX_RENDER_STATE",
      triangle_surface: "DERIVED_REBUILDABLE_VFX_RENDER_STATE",
      surface_scene: "DERIVED_RENDER_FABRIC_ADAPTER_INPUT",
    },
    truth_boundary: {
      proves: [
        "one exact AXM scene identity can drive a bounded direct-sample field, real donor voxel-density reconstruction, real donor triangle-surface extraction, and a new renderer-consumable AXM scene",
        "the derived VFX triangle surface remains linked to the source scene through explicit sample/voxel/mesh digests",
        "the exercised donor execution repeats to the same final-state and derived output bytes in the pinned environment",
      ],
      does_not_prove: [
        "semantic topology recovery or source-authored mesh equivalence",
        "normal, UV, material, skin, animation, collision, or gameplay semantics preserved in AXM_SCENE 1",
        "visual or cinematic quality",
        "physical holography",
        "whole-world conversion",
        "cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("vfx_surface_roundtrip=PASS");
  console.log(`source_scene_sha256=${sourceSha}`);
  console.log(`uc_hands=${uc.observation.hand_count}`);
  console.log(`uc_recipes=${uc.observation.recipe_count}`);
  console.log(`sample_points=${adapted.observation.point_count}`);
  console.log(`voxel_resolution=${vfx.observation.voxel.resolution}`);
  console.log(`surface_triangles=${vfx.observation.surface.triangle_count}`);
  console.log(`surface_mesh_digest=${vfx.observation.surface.digest}`);
  console.log(`surface_scene_sha256=${roundtrip.observation.output_sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
