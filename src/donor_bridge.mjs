import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function validatePrecisionMesh(mesh) {
  requireObject(mesh, "precision mesh");
  if (!Array.isArray(mesh.positions) || mesh.positions.length === 0 || mesh.positions.length % 3 !== 0) {
    throw new Error("precision mesh positions must be a non-empty xyz array");
  }
  if (!Array.isArray(mesh.indices) || mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    throw new Error("precision mesh indices must be a non-empty triangle-index array");
  }
  const vertexCount = mesh.positions.length / 3;
  for (const [i, value] of mesh.positions.entries()) {
    if (!Number.isFinite(value)) throw new Error(`precision mesh position ${i} must be finite`);
  }
  for (const [i, value] of mesh.indices.entries()) {
    if (!Number.isInteger(value) || value < 0 || value >= vertexCount) {
      throw new Error(`precision mesh index ${i} is out of range`);
    }
  }
  return { vertexCount, triangleCount: mesh.indices.length / 3 };
}

function byte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be an integer in 0..255`);
  }
  return value;
}

function meshScale(options) {
  const scale = options.scale ?? 0.62;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 16) {
    throw new Error("adapter scale must be finite and in (0,16]");
  }
  return scale;
}

export function precisionMeshToAxmScene(mesh, options = {}) {
  validatePrecisionMesh(mesh);
  const scale = meshScale(options);
  const albedo = options.albedo ?? [94, 196, 255];
  if (!Array.isArray(albedo) || albedo.length !== 3) throw new Error("albedo must be RGB");
  const rgb = albedo.map((value, i) => byte(value, `albedo[${i}]`));

  const triangles = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const vertices = [];
    for (let j = 0; j < 3; j += 1) {
      const index = mesh.indices[i + j] * 3;
      vertices.push([
        mesh.positions[index] * scale,
        mesh.positions[index + 1] * scale,
        mesh.positions[index + 2] * scale,
      ]);
    }
    triangles.push({ vertices, albedo: [...rgb] });
  }

  return { version: 1, triangles };
}

export function precisionMeshToHolographicForm(mesh, options = {}) {
  const info = validatePrecisionMesh(mesh);
  const scale = meshScale(options);
  const maxTriangles = Math.round(options.maxTriangles ?? 128);
  const samplesPerTriangle = Math.round(options.samplesPerTriangle ?? 24);
  const pointSize = Number(options.pointSize ?? 1.8);
  if (!Number.isInteger(maxTriangles) || maxTriangles < 1 || maxTriangles > 128) {
    throw new Error("maxTriangles must be an integer in 1..128");
  }
  if (!Number.isInteger(samplesPerTriangle) || samplesPerTriangle < 16 || samplesPerTriangle > 96) {
    throw new Error("samplesPerTriangle must be an integer in 16..96");
  }
  if (!Number.isFinite(pointSize) || pointSize < 0.25 || pointSize > 8) {
    throw new Error("pointSize must be finite in [0.25,8]");
  }

  const triangleCount = Math.min(info.triangleCount, maxTriangles);
  const primitives = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const points = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const meshIndex = mesh.indices[triangle * 3 + corner] * 3;
      points.push([
        mesh.positions[meshIndex] * scale,
        mesh.positions[meshIndex + 1] * scale,
        mesh.positions[meshIndex + 2] * scale,
      ]);
    }
    primitives.push({
      type: "polyline",
      points: [...points, points[0]],
      samples: samplesPerTriangle,
      size: pointSize,
      role: triangle % 4,
    });
  }

  const vertexLimit = Math.min(info.vertexCount, 512);
  const vertexCells = [];
  for (let vertex = 0; vertex < vertexLimit; vertex += 1) {
    const offset = vertex * 3;
    vertexCells.push([
      mesh.positions[offset] * scale,
      mesh.positions[offset + 1] * scale,
      mesh.positions[offset + 2] * scale,
      pointSize * 1.35,
      5,
      vertexLimit === 1 ? 0 : vertex / (vertexLimit - 1),
      1,
    ]);
  }
  primitives.push({ type: "points", points: vertexCells });

  return {
    id: String(options.id ?? "creative-render-mesh-hologram"),
    style: { pattern: "none", amount: 0, scale: 7 },
    primitives,
    source: {
      schema: "axm.creative-render.mesh-hologram-source/v1",
      original_vertex_count: info.vertexCount,
      original_triangle_count: info.triangleCount,
      projected_triangle_count: triangleCount,
      projected_vertex_count: vertexLimit,
      bounded: triangleCount < info.triangleCount || vertexLimit < info.vertexCount,
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export async function observeUniversalCreation(root) {
  const rootPath = resolve(root);
  const entryPath = resolve(rootPath, "capabilities/platform-hands/index.js");
  const entry = await fileDigest(entryPath);
  const require = createRequire(import.meta.url);
  const platform = require(entryPath);
  const hands = platform?.creativeHands;
  const flow = platform?.creativeFlow;
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeHands service");
  }
  if (!flow || typeof flow.summary !== "function" || typeof flow.run !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeFlow service");
  }

  const audit = requireObject(hands.audit(), "creative hands audit");
  const recipes = requireObject(hands.recipeRegistry(), "creative recipe registry");
  const flowSummary = requireObject(flow.summary(), "creative flow summary");
  const flowRequest = {
    mode: "execute",
    goal: "build a renderable shaped cube through explicit deterministic creative hands",
    state: { bridge: "axm-creative-render-v0.3" },
    steps: [
      {
        id: "make",
        hand_id: "creative.mesh-primitive.cube",
        args: { spec: { id: "creative-render-live-donor-cube", detail: 8 } },
        save_as: "mesh",
      },
      {
        id: "scale",
        hand_id: "creative.mesh-transform.scale",
        args: { mesh: { $state: "mesh" }, vector: [1.35, 0.8, 1.1] },
        save_as: "scaled",
      },
      {
        id: "rotate",
        hand_id: "creative.mesh-transform.rotate-y",
        args: { mesh: { $state: "scaled" }, degrees: 24 },
        save_as: "render_mesh",
      },
      {
        id: "bounds",
        recipe_id: "mesh-analysis.bounds",
        args: { mesh: { $state: "render_mesh" } },
        save_as: "bounds",
      },
    ],
    expose: { bounds: { $state: "bounds" } },
  };
  const flowResult = requireObject(flow.run(flowRequest), "creative flow result");
  if (flowResult.status !== "PASS" || flowResult.candidate_ready !== true || flowResult.source_state_mutated !== false) {
    throw new Error(`Universal Creation Creative Flow did not pass cleanly: ${String(flowResult.status)}`);
  }
  if (!Array.isArray(flowResult.receipts) || flowResult.receipts.length !== flowRequest.steps.length) {
    throw new Error("Universal Creation Creative Flow receipt count drifted");
  }
  const mesh = requireObject(flowResult.final_state?.render_mesh, "Creative Flow render mesh");
  const bounds = requireObject(flowResult.final_state?.bounds, "Creative Flow bounds");
  const meshInfo = validatePrecisionMesh(mesh);
  const sceneBytes = Buffer.from(serializeScene(precisionMeshToAxmScene(mesh)), "utf8");
  const holographicForm = precisionMeshToHolographicForm(mesh, { id: "creative-render-live-donor-cube-hologram" });

  return {
    sceneBytes,
    holographicForm,
    observation: {
      schema: "axm.creative-render.uc-donor-observation/v2",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      creative_hands_version: String(hands.version ?? "unknown"),
      hand_count: audit.total,
      hand_audit_digest: audit.digest ?? null,
      recipe_count: recipes.count,
      recipe_registry_digest: recipes.digest ?? null,
      creative_flow_version: String(flow.version ?? "unknown"),
      creative_flow_summary_digest: flowSummary.digest ?? null,
      flow_status: flowResult.status,
      flow_digest: flowResult.digest ?? null,
      flow_receipt_count: flowResult.receipts.length,
      flow_operations: flowResult.receipts.map((row) => row.operation_id ?? row.hand_id ?? row.recipe_id ?? null),
      flow_bounds_size: bounds.size ?? null,
      probe_result_schema: mesh.schema ?? null,
      probe_vertex_count: meshInfo.vertexCount,
      probe_triangle_count: meshInfo.triangleCount,
      adapted_scene_contract: "AXM_SCENE 1",
      adapted_scene_sha256: sha256(sceneBytes),
      adapter_coordinate_scale: 0.62,
      adapter_albedo_rgb: [94, 196, 255],
      holographic_form_id: holographicForm.id,
      holographic_primitive_count: holographicForm.primitives.length,
      holographic_projection_bounded: holographicForm.source.bounded,
    },
  };
}

export async function observeVisualEffectFabric(root, options = {}) {
  const rootPath = resolve(root);
  const runtimePath = resolve(rootPath, "hand-lab/src/hand-runtime.mjs");
  const effectPath = resolve(rootPath, "hand-lab/src/holographic-state-projector.mjs");
  const [runtimeSource, effectSource] = await Promise.all([fileDigest(runtimePath), fileDigest(effectPath)]);

  const runtime = await import(`${pathToFileURL(runtimePath).href}?sha=${runtimeSource.sha256}`);
  const effect = await import(`${pathToFileURL(effectPath).href}?sha=${effectSource.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("Visual Effect Fabric donor does not expose the expected Hand runtime");
  }
  if (!Array.isArray(effect.HOLOGRAPHIC_STATE_PROJECTOR_HANDS) || !effect.HOLOGRAPHIC_STATE_PROJECTOR_GRAPH || typeof effect.makeHolographicFormState !== "function") {
    throw new Error("Visual Effect Fabric donor does not expose the generic holographic state projector");
  }

  const form = options.form ?? effect.makeGlobeForm?.();
  if (!form) throw new Error("generic holographic projector observation requires a form");
  const registry = runtime.createHandRegistry(effect.HOLOGRAPHIC_STATE_PROJECTOR_HANDS);
  const run = runtime.executeHandGraph({
    registry,
    graph: effect.HOLOGRAPHIC_STATE_PROJECTOR_GRAPH,
    initialState: effect.makeHolographicFormState(form, options.seed ?? 20260915),
    context: { callerKind: "axm-creative-render" },
  });
  const finalState = requireObject(run.finalState, "VFX final state");
  const realization = finalState.realizations?.holographicStateProjector;
  requireObject(realization, "generic holographic state projector realization");
  if (typeof realization.content !== "string" || !realization.content.includes("<canvas")) {
    throw new Error("generic holographic state projector did not produce HTML canvas content");
  }
  const workingSet = requireObject(realization.workingSet, "generic holographic working set");
  if (
    workingSet.canonicalFormRetained !== true ||
    workingSet.derivedSampleFieldEditable !== true ||
    workingSet.derivedGpuDataRebuildable !== true
  ) {
    throw new Error("generic holographic donor lost its canonical/editable/derived working-set boundary");
  }

  const htmlBytes = Buffer.from(realization.content, "utf8");
  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");

  return {
    htmlBytes,
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-donor-observation/v2",
      donor: "axm-visual-effect-fabric",
      runtime_sha256: runtimeSource.sha256,
      effect_module_sha256: effectSource.sha256,
      graph_id: run.graph?.id ?? effect.HOLOGRAPHIC_STATE_PROJECTOR_GRAPH.id,
      graph_version: run.graph?.version ?? effect.HOLOGRAPHIC_STATE_PROJECTOR_GRAPH.version,
      graph_stage_count: effect.HOLOGRAPHIC_STATE_PROJECTOR_GRAPH.stages.length,
      executed_stage_count: run.executedStageIds?.length ?? null,
      final_state_hash: run.finalStateHash,
      form_id: finalState.form?.id ?? null,
      canonical_form_hash: realization.canonicalFormHash,
      sample_field_hash: realization.sampleFieldHash,
      renderer: realization.renderer,
      derived_from_state_hash: realization.derivedFromStateHash,
      working_set_hash: workingSet.sampleFieldHash,
      point_count: workingSet.pointCount,
      modeled_buffer_bytes: workingSet.modeledBufferBytes,
      canonical_form_retained: workingSet.canonicalFormRetained,
      derived_sample_field_editable: workingSet.derivedSampleFieldEditable,
      derived_gpu_data_rebuildable: workingSet.derivedGpuDataRebuildable,
      field_buffer_build_policy: workingSet.fieldBufferBuildPolicy,
      canonical_state_retained: workingSet.canonicalFormRetained,
      body_buffer_build_policy: workingSet.fieldBufferBuildPolicy,
      behavior_delta_policy: null,
      html_sha256: sha256(htmlBytes),
      state_sha256: sha256(stateBytes),
    },
  };
}
