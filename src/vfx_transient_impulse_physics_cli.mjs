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
import {
  observeVisualEffectTransientImpulse,
  runUniversalCreationTransientImpulsePhysics,
} from "./vfx_transient_impulse_physics_bridge.mjs";
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
  for (const key of [
    "uc-root", "vfx-root", "source-scene", "surface-scene", "edited-scene", "impulse-scene",
    "surface-state", "surface-html", "impulse-state", "impulse-svg", "physics-trace", "receipt",
  ]) {
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
    impulseScene: resolve(args["impulse-scene"]),
    surfaceState: resolve(args["surface-state"]),
    surfaceHtml: resolve(args["surface-html"]),
    impulseState: resolve(args["impulse-state"]),
    impulseSvg: resolve(args["impulse-svg"]),
    physicsTrace: resolve(args["physics-trace"]),
    receipt: resolve(args.receipt),
  };
  const outputPaths = Object.values(outputs);
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("transient-impulse physics outputs must be distinct");
  for (const path of outputPaths) {
    if (pathIsInside(ucRoot, path) || pathIsInside(vfxRoot, path)) {
      throw new Error("transient-impulse physics outputs may not be written inside donor repositories");
    }
  }

  const source = await observeUniversalCreation(ucRoot);
  const sourceSha256 = sha256(source.sceneBytes);
  const sampled = axmSceneToHolographicSampleField(source.sceneBytes, {
    id: "creative-render-vfx-transient-physics-source",
    samplesPerTriangle: 24,
    maxTriangles: 512,
    pointSize: 1.6,
  });
  const surface = await observeVisualEffectRefinedVoxelSurface(vfxRoot, sampled.field, {
    resolution: 18,
    kernel: 1.9,
    iso: 0.16,
    maxTriangles: 12_000,
    iterations: 2,
    lambda: 0.18,
    featurePreserve: 0.72,
    maxMoveVoxels: 0.22,
  });
  if (sampled.observation.source_scene_sha256 !== sourceSha256 || surface.observation.source_digest !== sourceSha256) {
    throw new Error("transient-impulse physics source identity mismatch before surface construction");
  }
  const admitted = refinedSurfaceToUcPrecisionMesh(surface.surfaceMesh, { id: "vfx-refined-surface-for-transient-physics" });
  const edit = await runUniversalCreationSurfaceEdit(
    ucRoot,
    admitted.mesh,
    {
      source_scene_sha256: sourceSha256,
      vfx_surface_digest: surface.observation.surface.digest,
      vfx_parent_mesh_digest: surface.observation.surface.parent_mesh_digest,
      vfx_voxel_digest: surface.observation.voxel.digest,
    },
    { twistDegrees: 22, translateX: 0.18, albedo: [72, 220, 180] },
  );

  const impulse = await observeVisualEffectTransientImpulse(vfxRoot, {
    id: "creative-render-consumer-neutral-impulse",
    seed: 20260916,
    origin: [0.5, 0.5],
    direction: [1, 0.28],
    energy: 0.9,
    radius: 0.28,
    duration: 0.8,
    controls: {
      symmetry: 0.2,
      directionality: 0.92,
      fragmentation: 0.62,
      ringWeight: 0.72,
      spokeWeight: 1.08,
    },
  });
  const physics = await runUniversalCreationTransientImpulsePhysics(
    ucRoot,
    edit.editedPrecisionMesh,
    impulse.event,
    {
      source_scene_sha256: sourceSha256,
      vfx_surface_digest: surface.observation.surface.digest,
      uc_edited_mesh_digest: edit.observation.edited_mesh_digest,
      vfx_event_hash: impulse.observation.canonical_event_hash,
      vfx_field_geometry_hash: impulse.observation.field.geometry_hash,
    },
    { impulseScale: 0.7, steps: 90, dt: 1 / 60, sampleEvery: 30, albedo: [72, 220, 180] },
  );

  if (physics.observation.input_triangle_count !== edit.observation.edited_triangle_count) {
    throw new Error("transient-impulse physics admission changed edited mesh triangle identity");
  }
  if (physics.observation.event_to_action.source_event_id !== impulse.event.id) {
    throw new Error("transient-impulse physics adapter lost canonical VFX event identity");
  }

  await write(outputs.sourceScene, source.sceneBytes);
  await write(outputs.surfaceScene, edit.beforeSceneBytes);
  await write(outputs.editedScene, physics.beforeSceneBytes);
  await write(outputs.impulseScene, physics.impulseSceneBytes);
  await write(outputs.surfaceState, surface.stateBytes);
  await write(outputs.surfaceHtml, surface.htmlBytes);
  await write(outputs.impulseState, impulse.stateBytes);
  await write(outputs.impulseSvg, impulse.svgBytes);
  await write(outputs.physicsTrace, physics.traceBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_TRANSIENT_UC_PHYSICS_RECEIPT",
    version: 1,
    mode: "canonical-source-to-derived-vfx-geometry-to-uc-edit-plus-neutral-vfx-event-to-consumer-mapped-uc-physics-to-renderer-scene",
    source_universal_creation: source.observation,
    direct_sample: sampled.observation,
    visual_effect_surface: surface.observation,
    surface_to_precision_mesh: admitted.observation,
    universal_creation_edit: edit.observation,
    visual_effect_transient_impulse: impulse.observation,
    universal_creation_transient_physics: physics.observation,
    outputs: {
      source_scene: { contract: "AXM_SCENE 1", sha256: sourceSha256, bytes: source.sceneBytes.length },
      surface_scene: { contract: "AXM_SCENE 1", sha256: sha256(edit.beforeSceneBytes), bytes: edit.beforeSceneBytes.length },
      edited_scene: { contract: "AXM_SCENE 1", sha256: sha256(physics.beforeSceneBytes), bytes: physics.beforeSceneBytes.length },
      impulse_scene: { contract: "AXM_SCENE 1", sha256: sha256(physics.impulseSceneBytes), bytes: physics.impulseSceneBytes.length },
      surface_state: { media_type: "application/json", sha256: sha256(surface.stateBytes), bytes: surface.stateBytes.length },
      surface_html: { media_type: "text/html", sha256: sha256(surface.htmlBytes), bytes: surface.htmlBytes.length },
      impulse_state: { media_type: "application/json", sha256: sha256(impulse.stateBytes), bytes: impulse.stateBytes.length },
      impulse_svg: { media_type: "image/svg+xml", sha256: sha256(impulse.svgBytes), bytes: impulse.svgBytes.length },
      physics_trace: { media_type: "application/json", sha256: sha256(physics.traceBytes), bytes: physics.traceBytes.length },
    },
    authority: {
      original_source_scene: "CALLER_SOURCE_STATE",
      sampled_surface_refinement: "DERIVED_REBUILDABLE_VFX_STATE",
      uc_edited_mesh: "DERIVED_CREATIVE_CANDIDATE",
      vfx_transient_event: "CANONICAL_INPUT_ONLY_WITHIN_THE_VFX_EFFECT_GRAPH",
      vfx_field_envelope_svg: "DERIVED_REBUILDABLE_VFX_BODIES",
      event_to_physics_mapping: "CALLER_OWNED_CREATIVE_RENDER_ADAPTER",
      physics_proxy_and_trace: "DERIVED_UC_PHYSICS_EVIDENCE",
      impulse_moved_mesh: "DERIVED_CREATIVE_CANDIDATE",
      renderer_scenes: "DERIVED_RENDERER_INPUTS",
    },
    truth_boundary: {
      proves: [
        "the current VFX donor can construct and repeat one bounded canonical transient-impulse event plus derived field/envelope/SVG evidence",
        "Creative Render can explicitly map only that neutral event's normalized direction and energy into a bounded UC Physics Fabric apply-impulse action without claiming that VFX itself owns physics semantics",
        "the real current UC Physics Fabric can apply that action to the explicit lossy 2D proxy derived from a VFX/UC mesh and repeat the same final checksum in the exercised runtime",
        "the resulting displacement can be applied through real UC Creative Flow without overwriting caller source state",
        "pre-impulse and impulse-moved derived meshes become distinct same-albedo AXM_SCENE 1 renderer inputs",
      ],
      does_not_prove: [
        "that VFX field rings, spokes or fragments are physical force or collision data",
        "triangle-mesh collision, Z-axis physics or rigid rotation",
        "scientific or gameplay correctness of the event-to-impulse mapping",
        "semantic meaning such as explosion, hit or weapon impact",
        "live game-world mutation",
        "aesthetic quality of the transient SVG or resulting rendered scene",
        "cross-engine or cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("vfx_transient_uc_physics=PASS");
  console.log(`source_scene_sha256=${sourceSha256}`);
  console.log(`surface_triangles=${surface.observation.surface.triangle_count}`);
  console.log(`uc_edited_mesh_digest=${edit.observation.edited_mesh_digest}`);
  console.log(`vfx_event_hash=${impulse.observation.canonical_event_hash}`);
  console.log(`vfx_field_hash=${impulse.observation.field.geometry_hash}`);
  console.log(`mapped_impulse=${physics.observation.mapped_impulse.x},${physics.observation.mapped_impulse.y}`);
  console.log(`physics_checksum=${physics.observation.final_checksum}`);
  console.log(`physics_displacement=${physics.observation.displacement_xy.x},${physics.observation.displacement_xy.y}`);
  console.log(`impulse_scene_sha256=${receipt.outputs.impulse_scene.sha256}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
