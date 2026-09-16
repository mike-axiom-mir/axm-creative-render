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
import { runUniversalCreationPhysicsProxy } from "./vfx_uc_physics_proxy_bridge.mjs";
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
  for (const key of ["uc-root", "vfx-root", "source-scene", "surface-scene", "edited-scene", "physics-scene", "vfx-state", "vfx-html", "physics-trace", "receipt"]) {
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
    physicsScene: resolve(args["physics-scene"]),
    vfxState: resolve(args["vfx-state"]),
    vfxHtml: resolve(args["vfx-html"]),
    physicsTrace: resolve(args["physics-trace"]),
    receipt: resolve(args.receipt),
  };
  const outputPaths = Object.values(outputs);
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("VFX/UC physics outputs must be distinct");
  for (const path of outputPaths) {
    if (pathIsInside(ucRoot, path) || pathIsInside(vfxRoot, path)) {
      throw new Error("VFX/UC physics outputs may not be written inside donor repositories");
    }
  }

  const source = await observeUniversalCreation(ucRoot);
  const sourceSha256 = sha256(source.sceneBytes);
  const adapted = axmSceneToHolographicSampleField(source.sceneBytes, {
    id: "creative-render-vfx-uc-physics-source",
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
    throw new Error("VFX/UC physics source identity mismatch");
  }
  const admitted = refinedSurfaceToUcPrecisionMesh(vfx.surfaceMesh, { id: "vfx-refined-surface-for-uc-physics" });
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
  const physics = await runUniversalCreationPhysicsProxy(
    ucRoot,
    edit.editedPrecisionMesh,
    {
      source_scene_sha256: sourceSha256,
      vfx_surface_digest: vfx.observation.surface.digest,
      uc_edited_mesh_digest: edit.observation.edited_mesh_digest,
    },
    { dropDistance: 0.55, gravityY: 9.81, steps: 120, dt: 1 / 60, sampleEvery: 30, albedo: [72, 220, 180] },
  );
  if (sha256(physics.beforeSceneBytes) !== sha256(edit.editedSceneBytes)) {
    throw new Error("physics proxy input scene does not exactly match UC edited scene");
  }

  await write(outputs.sourceScene, source.sceneBytes);
  await write(outputs.surfaceScene, edit.beforeSceneBytes);
  await write(outputs.editedScene, edit.editedSceneBytes);
  await write(outputs.physicsScene, physics.physicsSceneBytes);
  await write(outputs.vfxState, vfx.stateBytes);
  await write(outputs.vfxHtml, vfx.htmlBytes);
  await write(outputs.physicsTrace, physics.traceBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_UC_PHYSICS_PROXY_RECEIPT",
    version: 1,
    mode: "source-to-refined-vfx-to-uc-edit-to-explicit-2d-physics-proxy-to-uc-displacement-to-renderer-scene",
    source_universal_creation: source.observation,
    direct_sample: adapted.observation,
    visual_effect_fabric: vfx.observation,
    surface_to_precision_mesh: admitted.observation,
    universal_creation_edit: edit.observation,
    universal_creation_physics_proxy: physics.observation,
    outputs: {
      source_scene: { contract: "AXM_SCENE 1", sha256: sourceSha256, bytes: source.sceneBytes.length },
      surface_scene: { contract: "AXM_SCENE 1", sha256: sha256(edit.beforeSceneBytes), bytes: edit.beforeSceneBytes.length },
      edited_scene: { contract: "AXM_SCENE 1", sha256: sha256(edit.editedSceneBytes), bytes: edit.editedSceneBytes.length },
      physics_scene: { contract: "AXM_SCENE 1", sha256: sha256(physics.physicsSceneBytes), bytes: physics.physicsSceneBytes.length },
      vfx_state: { media_type: "application/json", sha256: sha256(vfx.stateBytes), bytes: vfx.stateBytes.length },
      vfx_html: { media_type: "text/html", sha256: sha256(vfx.htmlBytes), bytes: vfx.htmlBytes.length },
      physics_trace: { media_type: "application/json", sha256: sha256(physics.traceBytes), bytes: physics.traceBytes.length },
    },
    authority: {
      original_source_scene: "CALLER_SOURCE_STATE",
      refined_vfx_surface: "DERIVED_REBUILDABLE_VFX_STATE",
      uc_edited_mesh: "DERIVED_CREATIVE_CANDIDATE",
      physics_proxy: "DERIVED_2D_SIMULATION_PROXY",
      physics_moved_mesh: "DERIVED_CREATIVE_CANDIDATE",
      renderer_scenes_and_pixels: "DERIVED_REPLACEABLE_OUTPUTS",
    },
    truth_boundary: {
      proves: [
        "one exact source scene can become a refined VFX surface and a real UC creative mesh candidate",
        "the real current UC Physics Fabric can simulate an explicit 2D axis-aligned proxy derived from that candidate's X/Y bounds",
        "the same UC physics input repeats to the same final checksum and proxy position in one runtime",
        "the resulting proxy displacement can be applied through real UC Creative Flow without overwriting caller mesh state",
        "the pre-physics and physics-moved derived meshes become distinct AXM_SCENE 1 renderer inputs",
      ],
      does_not_prove: [
        "triangle-mesh collision",
        "3D physics or z-axis dynamics",
        "rigid-body rotation or angular inertia",
        "scientific validation",
        "physics correctness for the source object semantics",
        "semantic topology or material preservation",
        "live game-world mutation",
        "that any derived candidate becomes canonical source state",
        "cross-JavaScript-engine bitwise determinism",
        "artistic or gameplay quality",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("vfx_uc_physics_proxy=PASS");
  console.log(`source_scene_sha256=${sourceSha256}`);
  console.log(`refined_surface_triangles=${vfx.observation.surface.triangle_count}`);
  console.log(`uc_edited_mesh_digest=${edit.observation.edited_mesh_digest}`);
  console.log(`physics_adapter=${physics.observation.physics_adapter.id}@${physics.observation.physics_adapter.version}`);
  console.log(`physics_core_version=${physics.observation.physics_adapter.core_version}`);
  console.log(`physics_final_checksum=${physics.observation.final_checksum}`);
  console.log(`physics_displacement_xy=${physics.observation.displacement_xy.x},${physics.observation.displacement_xy.y}`);
  console.log(`edited_scene_sha256=${receipt.outputs.edited_scene.sha256}`);
  console.log(`physics_scene_sha256=${receipt.outputs.physics_scene.sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
