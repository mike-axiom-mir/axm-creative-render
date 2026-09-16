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
import { observeVisualEffectTransientImpulseCanvasRuntime } from "./vfx_transient_canvas_runtime_bridge.mjs";
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
    "surface-state", "surface-html", "impulse-state", "impulse-svg", "canvas-state", "canvas-html",
    "canvas-trace", "physics-trace", "receipt",
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
    canvasState: resolve(args["canvas-state"]),
    canvasHtml: resolve(args["canvas-html"]),
    canvasTrace: resolve(args["canvas-trace"]),
    physicsTrace: resolve(args["physics-trace"]),
    receipt: resolve(args.receipt),
  };
  const outputPaths = Object.values(outputs);
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("transient Canvas physics outputs must be distinct");
  for (const path of outputPaths) {
    if (pathIsInside(ucRoot, path) || pathIsInside(vfxRoot, path)) {
      throw new Error("transient Canvas physics outputs may not be written inside donor repositories");
    }
  }

  const source = await observeUniversalCreation(ucRoot);
  const sourceSha256 = sha256(source.sceneBytes);
  const sampled = axmSceneToHolographicSampleField(source.sceneBytes, {
    id: "creative-render-vfx-transient-canvas-physics-source",
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
    throw new Error("transient Canvas physics source identity mismatch before surface construction");
  }
  const admitted = refinedSurfaceToUcPrecisionMesh(surface.surfaceMesh, { id: "vfx-refined-surface-for-transient-canvas-physics" });
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

  const impulseOptions = {
    id: "creative-render-shared-visual-physics-impulse",
    seed: 20260916,
    origin: [0.5, 0.5],
    direction: [1, 0.28],
    energy: 0.9,
    radius: 0.28,
    duration: 0.8,
    tint: [0.18, 0.9, 1],
    accent: [1, 0.52, 0.18],
    controls: {
      symmetry: 0.2,
      directionality: 0.92,
      fragmentation: 0.62,
      ringWeight: 0.72,
      spokeWeight: 1.08,
    },
  };
  const impulse = await observeVisualEffectTransientImpulse(vfxRoot, impulseOptions);
  const canvas = await observeVisualEffectTransientImpulseCanvasRuntime(vfxRoot, impulseOptions);
  if (canvas.observation.canonical_event_hash !== impulse.observation.canonical_event_hash) {
    throw new Error("SVG and Canvas2D VFX branches lost shared canonical event identity");
  }
  if (canvas.observation.field.geometry_hash !== impulse.observation.field.geometry_hash) {
    throw new Error("SVG and Canvas2D VFX branches lost shared derived field identity");
  }
  if (JSON.stringify(canvas.event) !== JSON.stringify(impulse.event)) {
    throw new Error("SVG and Canvas2D VFX branches normalized different canonical events");
  }

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
      vfx_canvas_trace_sha256: canvas.observation.runtime.trace_sha256,
    },
    { impulseScale: 0.7, steps: 90, dt: 1 / 60, sampleEvery: 30, albedo: [72, 220, 180] },
  );
  if (physics.observation.input_triangle_count !== edit.observation.edited_triangle_count) {
    throw new Error("transient Canvas physics admission changed edited mesh triangle identity");
  }
  if (physics.observation.event_to_action.source_event_id !== impulse.event.id) {
    throw new Error("transient Canvas physics adapter lost canonical VFX event identity");
  }

  await write(outputs.sourceScene, source.sceneBytes);
  await write(outputs.surfaceScene, edit.beforeSceneBytes);
  await write(outputs.editedScene, physics.beforeSceneBytes);
  await write(outputs.impulseScene, physics.impulseSceneBytes);
  await write(outputs.surfaceState, surface.stateBytes);
  await write(outputs.surfaceHtml, surface.htmlBytes);
  await write(outputs.impulseState, impulse.stateBytes);
  await write(outputs.impulseSvg, impulse.svgBytes);
  await write(outputs.canvasState, canvas.stateBytes);
  await write(outputs.canvasHtml, canvas.htmlBytes);
  await write(outputs.canvasTrace, canvas.traceBytes);
  await write(outputs.physicsTrace, physics.traceBytes);

  const receipt = {
    contract: "AXM_CREATIVE_VFX_TRANSIENT_CANVAS_UC_PHYSICS_RECEIPT",
    version: 1,
    mode: "canonical-source-to-derived-vfx-geometry-and-shared-transient-event-to-executed-canvas-runtime-plus-consumer-mapped-uc-physics-to-renderer-scene",
    source_universal_creation: source.observation,
    direct_sample: sampled.observation,
    visual_effect_surface: surface.observation,
    surface_to_precision_mesh: admitted.observation,
    universal_creation_edit: edit.observation,
    visual_effect_transient_impulse: impulse.observation,
    visual_effect_transient_canvas: canvas.observation,
    universal_creation_transient_physics: physics.observation,
    shared_event_evidence: {
      canonical_event_hash: impulse.observation.canonical_event_hash,
      field_geometry_hash: impulse.observation.field.geometry_hash,
      svg_graph_id: impulse.observation.donor_graph_id,
      canvas_graph_id: canvas.observation.donor_graph_id,
      canvas_runtime_trace_sha256: canvas.observation.runtime.trace_sha256,
      branches_agree: true,
    },
    outputs: {
      source_scene: { contract: "AXM_SCENE 1", sha256: sourceSha256, bytes: source.sceneBytes.length },
      surface_scene: { contract: "AXM_SCENE 1", sha256: sha256(edit.beforeSceneBytes), bytes: edit.beforeSceneBytes.length },
      edited_scene: { contract: "AXM_SCENE 1", sha256: sha256(physics.beforeSceneBytes), bytes: physics.beforeSceneBytes.length },
      impulse_scene: { contract: "AXM_SCENE 1", sha256: sha256(physics.impulseSceneBytes), bytes: physics.impulseSceneBytes.length },
      surface_state: { media_type: "application/json", sha256: sha256(surface.stateBytes), bytes: surface.stateBytes.length },
      surface_html: { media_type: "text/html", sha256: sha256(surface.htmlBytes), bytes: surface.htmlBytes.length },
      impulse_state: { media_type: "application/json", sha256: sha256(impulse.stateBytes), bytes: impulse.stateBytes.length },
      impulse_svg: { media_type: "image/svg+xml", sha256: sha256(impulse.svgBytes), bytes: impulse.svgBytes.length },
      canvas_state: { media_type: "application/json", sha256: sha256(canvas.stateBytes), bytes: canvas.stateBytes.length },
      canvas_html: { media_type: "text/html", sha256: sha256(canvas.htmlBytes), bytes: canvas.htmlBytes.length },
      canvas_trace: { media_type: "application/json", sha256: sha256(canvas.traceBytes), bytes: canvas.traceBytes.length },
      physics_trace: { media_type: "application/json", sha256: sha256(physics.traceBytes), bytes: physics.traceBytes.length },
    },
    authority: {
      original_source_scene: "CALLER_SOURCE_STATE",
      sampled_surface_refinement: "DERIVED_REBUILDABLE_VFX_STATE",
      uc_edited_mesh: "DERIVED_CREATIVE_CANDIDATE",
      vfx_transient_event: "CANONICAL_INPUT_ONLY_WITHIN_THE_VFX_EFFECT_GRAPH",
      vfx_svg_canvas_field_envelope: "DERIVED_REBUILDABLE_VFX_BODIES",
      canvas_runtime_trace: "DERIVED_REPLACEABLE_EXECUTION_EVIDENCE",
      event_to_physics_mapping: "CALLER_OWNED_CREATIVE_RENDER_ADAPTER",
      physics_proxy_and_trace: "DERIVED_UC_PHYSICS_EVIDENCE",
      impulse_moved_mesh: "DERIVED_CREATIVE_CANDIDATE",
      renderer_scenes: "DERIVED_RENDERER_INPUTS",
    },
    truth_boundary: {
      proves: [
        "the current VFX donor can derive SVG and Canvas2D realizations from the same canonical transient event and the same renderer-neutral field geometry",
        "the actual generated VFX Canvas2D inline JavaScript can execute against a bounded recording Canvas2D interface at explicit proof frame times and repeat the same API trace in the exercised JS runtime",
        "the Canvas runtime trace remains derived replaceable evidence and does not mutate or replace the canonical transient event",
        "Creative Render can separately map only the shared event direction and energy into a bounded real UC Physics Fabric apply-impulse action",
        "the resulting repeated UC physics displacement can flow through real UC Creative Flow to a distinct same-albedo renderer scene without overwriting caller source state",
      ],
      does_not_prove: [
        "actual browser Canvas2D pixels or browser/GPU equivalence",
        "pixel-perfect equivalence between SVG and Canvas2D realizations",
        "that Canvas draw calls are physics, collision or gameplay authority",
        "triangle-mesh collision, Z-axis physics or rigid rotation",
        "scientific or gameplay correctness of the event-to-impulse mapping",
        "live game-world mutation or real-time synchronized compositing",
        "aesthetic quality or professional acceptance",
        "cross-engine or cross-machine bitwise determinism",
      ],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await write(outputs.receipt, receiptBytes);

  console.log("vfx_transient_canvas_uc_physics=PASS");
  console.log(`source_scene_sha256=${sourceSha256}`);
  console.log(`surface_triangles=${surface.observation.surface.triangle_count}`);
  console.log(`uc_hands=${source.observation.hand_count}`);
  console.log(`uc_recipes=${source.observation.recipe_count}`);
  console.log(`vfx_event_hash=${impulse.observation.canonical_event_hash}`);
  console.log(`vfx_field_hash=${impulse.observation.field.geometry_hash}`);
  console.log(`canvas_renderer=${canvas.observation.realization.renderer}`);
  console.log(`canvas_frames=${canvas.observation.runtime.frame_count}`);
  console.log(`canvas_calls=${canvas.observation.runtime.call_count}`);
  console.log(`canvas_trace_sha256=${canvas.observation.runtime.trace_sha256}`);
  console.log(`mapped_impulse=${physics.observation.mapped_impulse.x},${physics.observation.mapped_impulse.y}`);
  console.log(`physics_checksum=${physics.observation.final_checksum}`);
  console.log(`physics_displacement=${physics.observation.displacement_xy.x},${physics.observation.displacement_xy.y}`);
  console.log(`receipt_sha256=${sha256(receiptBytes)}`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
