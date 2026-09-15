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

export function precisionMeshToAxmScene(mesh, options = {}) {
  validatePrecisionMesh(mesh);
  const scale = options.scale ?? 0.62;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 16) {
    throw new Error("scene adapter scale must be finite and in (0,16]");
  }
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
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function" || typeof hands.invoke !== "function") {
    throw new Error("Universal Creation donor does not expose the expected creativeHands service");
  }

  const audit = requireObject(hands.audit(), "creative hands audit");
  const recipes = requireObject(hands.recipeRegistry(), "creative recipe registry");
  const invoked = requireObject(
    hands.invoke("creative.mesh-primitive.cube", { spec: { id: "creative-render-live-donor-cube", detail: 8 } }),
    "creative hand result",
  );
  const mesh = requireObject(invoked.result, "creative mesh result");
  const meshInfo = validatePrecisionMesh(mesh);
  const sceneBytes = Buffer.from(serializeScene(precisionMeshToAxmScene(mesh)), "utf8");

  return {
    sceneBytes,
    observation: {
      schema: "axm.creative-render.uc-donor-observation/v1",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      creative_hands_version: String(hands.version ?? "unknown"),
      hand_count: audit.total,
      hand_audit_digest: audit.digest ?? null,
      recipe_count: recipes.count,
      recipe_registry_digest: recipes.digest ?? null,
      probe_hand: "creative.mesh-primitive.cube",
      probe_result_schema: mesh.schema ?? null,
      probe_vertex_count: meshInfo.vertexCount,
      probe_triangle_count: meshInfo.triangleCount,
      adapted_scene_contract: "AXM_SCENE 1",
      adapted_scene_sha256: sha256(sceneBytes),
      adapter_coordinate_scale: 0.62,
      adapter_albedo_rgb: [94, 196, 255],
    },
  };
}

export async function observeVisualEffectFabric(root) {
  const rootPath = resolve(root);
  const runtimePath = resolve(rootPath, "hand-lab/src/hand-runtime.mjs");
  const effectPath = resolve(rootPath, "hand-lab/src/holographic-ai-state-native.mjs");
  const [runtimeSource, effectSource] = await Promise.all([fileDigest(runtimePath), fileDigest(effectPath)]);

  const runtime = await import(`${pathToFileURL(runtimePath).href}?sha=${runtimeSource.sha256}`);
  const effect = await import(`${pathToFileURL(effectPath).href}?sha=${effectSource.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("Visual Effect Fabric donor does not expose the expected Hand runtime");
  }
  if (!Array.isArray(effect.HOLOGRAPHIC_AI_STATE_NATIVE_HANDS) || !effect.HOLOGRAPHIC_AI_STATE_NATIVE_GRAPH || typeof effect.makeHolographicAiInitialState !== "function") {
    throw new Error("Visual Effect Fabric donor does not expose the state-native holographic AI graph");
  }

  const registry = runtime.createHandRegistry(effect.HOLOGRAPHIC_AI_STATE_NATIVE_HANDS);
  const run = runtime.executeHandGraph({
    registry,
    graph: effect.HOLOGRAPHIC_AI_STATE_NATIVE_GRAPH,
    initialState: effect.makeHolographicAiInitialState(),
    context: { callerKind: "axm-creative-render" },
  });
  const finalState = requireObject(run.finalState, "VFX final state");
  const realization = finalState.realizations?.holographicAiStateNative;
  requireObject(realization, "state-native holographic AI realization");
  if (typeof realization.content !== "string" || !realization.content.includes("<canvas")) {
    throw new Error("state-native holographic AI realization did not produce HTML canvas content");
  }
  const workingSet = requireObject(realization.workingSet, "state-native working set");
  if (workingSet.canonicalStateRetained !== true || workingSet.derivedGpuDataRebuildable !== true) {
    throw new Error("state-native donor lost its canonical/derived working-set boundary");
  }

  const htmlBytes = Buffer.from(realization.content, "utf8");
  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");

  return {
    htmlBytes,
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-donor-observation/v1",
      donor: "axm-visual-effect-fabric",
      runtime_sha256: runtimeSource.sha256,
      effect_module_sha256: effectSource.sha256,
      graph_id: run.graph?.id ?? effect.HOLOGRAPHIC_AI_STATE_NATIVE_GRAPH.id,
      graph_version: run.graph?.version ?? effect.HOLOGRAPHIC_AI_STATE_NATIVE_GRAPH.version,
      graph_stage_count: effect.HOLOGRAPHIC_AI_STATE_NATIVE_GRAPH.stages.length,
      executed_stage_count: run.executedStageIds?.length ?? null,
      final_state_hash: run.finalStateHash,
      renderer: realization.renderer,
      derived_from_state_hash: realization.derivedFromStateHash,
      working_set_hash: workingSet.workingSetHash,
      point_count: workingSet.pointCount,
      modeled_buffer_bytes: workingSet.modeledBufferBytes,
      canonical_state_retained: workingSet.canonicalStateRetained,
      derived_gpu_data_rebuildable: workingSet.derivedGpuDataRebuildable,
      body_buffer_build_policy: workingSet.bodyBufferBuildPolicy,
      behavior_delta_policy: workingSet.behaviorDeltaPolicy,
      html_sha256: sha256(htmlBytes),
      state_sha256: sha256(stateBytes),
    },
  };
}
