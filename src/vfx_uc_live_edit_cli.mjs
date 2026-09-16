#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { observeUniversalCreation } from "./donor_bridge.mjs";
import { axmSceneToHolographicSampleField } from "./direct_sample_bridge.mjs";
import {
  observeVisualEffectRefinedVoxelSurface,
  refinedSurfaceToUcPrecisionMesh,
  runUniversalCreationSurfaceEdit,
} from "./vfx_uc_live_edit_bridge.mjs";
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
  for (const key of ["uc-root", "vfx-root", "source-scene", "surface-scene", "edited-scene", "state", "html", "receipt"]) {
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
    editedScene: resolve(args["edited-scene"]),
    state: resolve(args.state),
    html: resolve(args.html),
    receipt: resolve(args.receipt),
  };
  const outputPaths = Object.values(outputs);
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("VFX/UC live-edit outputs must be distinct");
  for (const path of outputPaths) {
    if (pathIsInside(ucRoot, path) || pathIsInside(vfxRoot, path)) {
      throw new Error("VFX/UC live-edit outputs may not be written inside donor repositories");
    }
  }

  const source = await observeUniversalCreation(ucRoot);
  const sourceSha256 = sha256(source.sceneBytes);
  const adapted = axmSceneToHolographicSampleField(source.sceneBytes, {
    id: "creative-render-vfx-uc-live-edit-source",
    samplesPerTriangle: 24,
    maxTriangles: 512,
    pointSize: 1.6,
  });
  const vfx = await observeVisualEffectRefinedVoxelSurface(vfxRoot, adapted.field, {
    resolution: 18,
    kernel: 1.9,
    iso: 0.16,
    maxTriangles: 12_000,
    iterations: 2,
    lambda: 0.18,
    featurePreserve: 0.72,
    maxMoveVoxels: 0.22,
  });
  if (adapted.observation.source_scene_sha256 !== sourceSha256 || vfx.observation.source_digest !== sourceSha256) {
    throw new Error("VFX/UC live-edit source identity mismatch");
  }
  const admitted = refinedSurfaceToUcPrecisionMesh(vfx.surfaceMesh, { id: "vfx-refined-surface-for-uc" });
  const edit = await runUniversalCreationSurfaceEdit(
    ucRoot,
    admitted.mesh,
    {
      source_scene_sha256: sourceSha256,
      vfx_surface_digest: vfx.observation.surface.digest,
      vfx_parent_mesh_digest: vfx.observation.surface.parent_mesh_digest,
      vfx_voxel_digest: vfx.observation.voxel.digest,
    },
    { twistDegrees: 22, translateX: 0.18, albedo: [72, 220, 180] },
  );

  await write(outputs.sourceScene, source.sceneBytes);
  await write(outputs.surfaceScene, edit.beforeSceneBytes);
  await write(outputs.editedScene, edit.editedSceneBytes);
  await write(outputs.state, vfx.stateBytes);
  await write(outputs.html, vfx.htmlBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_UC_LIVE_EDIT_RECEIPT",
    version: 1,
    mode: "source-scene-to-refined-vfx-surface-to-uc-creative-flow-to-renderer-scene",
    source_universal_creation: source.observation,
    direct_sample: adapted.observation,
    visual_effect_fabric: vfx.observation,
    surface_to_precision_mesh: admitted.observation,
    universal_creation_edit: edit.observation,
    outputs: {
      source_scene: { contract: "AXM_SCENE 1", sha256: sourceSha256, bytes: source.sceneBytes.length },
      surface_scene: { contract: "AXM_SCENE 1", sha256: sha256(edit.beforeSceneBytes), bytes: edit.beforeSceneBytes.length },
      edited_scene: { contract: "AXM_SCENE 1", sha256: sha256(edit.editedSceneBytes), bytes: edit.editedSceneBytes.length },
      vfx_state: { media_type: "application/json", sha256: sha256(vfx.stateBytes), bytes: vfx.stateBytes.length },
      vfx_html: { media_type: "text/html", sha256: sha256(vfx.htmlBytes), bytes: vfx.htmlBytes.length },
    },
    authority: {
      original_source_scene: "CALLER_SOURCE_STATE",
      sampled_voxel_surface_and_refinement: "DERIVED_REBUILDABLE_VFX_STATE",
      uc_precision_mesh_adapter: "DERIVED_CALLER_ADAPTER_STATE",
      uc_edited_mesh: "DERIVED_CREATIVE_CANDIDATE",
      surface_and_edited_axm_scenes: "DERIVED_RENDERER_INPUTS",
    },
    truth_boundary: {
      proves: [
        "one exact source scene can become a refined VFX triangle surface and retain source lineage",
        "that derived triangle surface can be admitted as caller-supplied precision-mesh state to Universal Creation Creative Flow",
        "real Universal Creation twist, translation and bounds Hands can operate on that supplied geometry without overwriting caller state",
        "the pre-edit and edited derived meshes can be expressed as distinct AXM_SCENE 1 renderer inputs",
      ],
      does_not_prove: [
        "semantic object or topology recovery",
        "that the VFX surface or UC edit becomes canonical world truth",
        "UV or source material preservation",
        "purposeful artistic quality",
        "live game-world mutation",
        "physics correctness",
        "cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("vfx_uc_live_edit=PASS");
  console.log(`source_scene_sha256=${sourceSha256}`);
  console.log(`source_triangles=${source.observation.probe_triangle_count}`);
  console.log(`sample_points=${adapted.observation.point_count}`);
  console.log(`refined_surface_triangles=${vfx.observation.surface.triangle_count}`);
  console.log(`refined_surface_digest=${vfx.observation.surface.digest}`);
  console.log(`uc_hands=${edit.observation.hand_count}`);
  console.log(`uc_recipes=${edit.observation.recipe_count}`);
  console.log(`uc_operations=${edit.observation.flow_operations.join(",")}`);
  console.log(`surface_scene_sha256=${receipt.outputs.surface_scene.sha256}`);
  console.log(`edited_scene_sha256=${receipt.outputs.edited_scene.sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
