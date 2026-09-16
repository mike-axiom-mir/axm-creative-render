import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256 } from "./creative_scene_operator.mjs";
import { precisionMeshToAxmScene } from "./donor_bridge.mjs";

const MAX_VFX_POINTS = 24_000;
const MAX_SURFACE_TRIANGLES = 12_000;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function integer(value, label, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return number;
}

function validateSampleField(field) {
  object(field, "direct sample field");
  if ((field.stride ?? 7) !== 7) throw new Error("direct sample field must use stride 7");
  if (!Array.isArray(field.points) || field.points.length === 0 || field.points.length % 7 !== 0) {
    throw new Error("direct sample field must contain a non-empty packed stride-7 point array");
  }
  const pointCount = field.points.length / 7;
  if (pointCount > MAX_VFX_POINTS) throw new Error(`direct sample field exceeds ${MAX_VFX_POINTS}-point ceiling`);
  for (const value of field.points) finite(value, "direct sample value");
  if (typeof field.sourceKind !== "string" || !field.sourceKind) throw new Error("direct sample field requires sourceKind");
  if (typeof field.sourceDigest !== "string" || !field.sourceDigest) throw new Error("direct sample field requires sourceDigest");
  return pointCount;
}

function validateRefinedSurfaceMesh(mesh) {
  object(mesh, "refined VFX surface mesh");
  if (mesh.schema !== "axm.holographic-triangle-surface/v0.2") {
    throw new Error(`unexpected refined VFX surface schema: ${String(mesh.schema)}`);
  }
  if (mesh.derived !== true || mesh.rebuildable !== true) {
    throw new Error("refined VFX surface must remain derived and rebuildable");
  }
  if (!Array.isArray(mesh.vertices) || mesh.vertices.length === 0 || mesh.vertices.length % 9 !== 0) {
    throw new Error("refined VFX surface vertices must contain packed triangles");
  }
  if (!Array.isArray(mesh.normals) || mesh.normals.length !== mesh.vertices.length) {
    throw new Error("refined VFX surface normals must match positions");
  }
  for (const value of [...mesh.vertices, ...mesh.normals]) finite(value, "refined VFX surface value");
  const triangleCount = mesh.vertices.length / 9;
  if (triangleCount !== Number(mesh.triangleCount)) throw new Error("refined VFX surface triangle count drifted");
  if (triangleCount > MAX_SURFACE_TRIANGLES) throw new Error(`refined VFX surface exceeds ${MAX_SURFACE_TRIANGLES}-triangle ceiling`);
  for (const field of ["sourceVoxelDigest", "parentMeshDigest", "digest"]) {
    if (typeof mesh[field] !== "string" || !mesh[field]) throw new Error(`refined VFX surface requires ${field}`);
  }
  const refinement = object(mesh.refinement, "refined VFX surface refinement evidence");
  for (const field of ["iterations", "lambda", "featurePreserve", "maxMove", "maxAppliedMove"]) {
    finite(refinement[field], `refinement ${field}`);
  }
  return triangleCount;
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function stableMeshBytes(mesh) {
  return Buffer.from(JSON.stringify({
    schema: mesh.schema,
    version: mesh.version,
    id: mesh.id,
    positions: mesh.positions,
    normals: mesh.normals,
    uvs: mesh.uvs,
    indices: mesh.indices,
    metadata: mesh.metadata,
  }));
}

export function refinedSurfaceToUcPrecisionMesh(surfaceMesh, options = {}) {
  const triangleCount = validateRefinedSurfaceMesh(surfaceMesh);
  const vertexCount = triangleCount * 3;
  const mesh = {
    schema: "axm.precision-mesh/v1",
    version: "1.0.0",
    id: String(options.id ?? "creative-render-vfx-refined-surface"),
    positions: surfaceMesh.vertices.map(Number),
    normals: surfaceMesh.normals.map(Number),
    uvs: new Array(vertexCount * 2).fill(0),
    indices: Array.from({ length: vertexCount }, (_, index) => index),
    metadata: {
      adapter: "axm-creative-render/v0.15",
      source_surface_schema: surfaceMesh.schema,
      source_surface_digest: surfaceMesh.digest,
      source_parent_mesh_digest: surfaceMesh.parentMeshDigest,
      source_voxel_digest: surfaceMesh.sourceVoxelDigest,
      uv_policy: "zero-placeholder-because-vfx-surface-has-no-uv-semantics",
    },
  };
  const meshSha256 = sha256(stableMeshBytes(mesh));
  return {
    mesh,
    observation: {
      schema: "axm.creative-render.vfx-surface-to-uc-precision-mesh/v1",
      source_surface_schema: surfaceMesh.schema,
      source_surface_digest: surfaceMesh.digest,
      source_parent_mesh_digest: surfaceMesh.parentMeshDigest,
      source_voxel_digest: surfaceMesh.sourceVoxelDigest,
      source_triangle_count: triangleCount,
      output_schema: mesh.schema,
      output_vertex_count: vertexCount,
      output_triangle_count: triangleCount,
      output_sha256: meshSha256,
      normals_carried: true,
      uvs_preserved: false,
      topology_semantics_preserved: false,
      adapter_policy: "each derived VFX triangle becomes three caller-owned precision-mesh vertices with sequential indices; VFX normals are carried and UVs are explicit zero placeholders",
    },
  };
}

export async function observeVisualEffectRefinedVoxelSurface(root, sampleField, options = {}) {
  const pointCount = validateSampleField(sampleField);
  const resolution = integer(options.resolution ?? 18, "voxel resolution", 14, 34);
  const maxTriangles = integer(options.maxTriangles ?? MAX_SURFACE_TRIANGLES, "surface maxTriangles", 2_000, MAX_SURFACE_TRIANGLES);
  const kernel = finite(options.kernel ?? 1.9, "voxel kernel");
  const iso = finite(options.iso ?? 0.16, "voxel iso");
  const iterations = integer(options.iterations ?? 2, "refinement iterations", 1, 4);
  const lambda = finite(options.lambda ?? 0.18, "refinement lambda");
  const featurePreserve = finite(options.featurePreserve ?? 0.72, "feature preserve");
  const maxMoveVoxels = finite(options.maxMoveVoxels ?? 0.22, "max move voxels");

  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    stream: resolve(rootPath, "hand-lab/src/holographic-state-stream.mjs"),
    projector: resolve(rootPath, "hand-lab/src/holographic-state-projector.mjs"),
    voxel: resolve(rootPath, "hand-lab/src/holographic-state-voxel-surface.mjs"),
    refine: resolve(rootPath, "hand-lab/src/holographic-state-voxel-refine.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(
    Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)]),
  ));
  const modules = {};
  for (const [name, path] of Object.entries(paths)) {
    modules[name] = await import(`${pathToFileURL(path).href}?sha=${sources[name].sha256}`);
  }
  const { runtime, stream, projector, voxel, refine } = modules;
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("VFX Hand runtime unavailable");
  }
  if (typeof stream.admitSampleFieldHand?.execute !== "function" || typeof stream.makeDirectSampleState !== "function") {
    throw new Error("VFX direct-sample admission unavailable");
  }
  const hands = [
    stream.admitSampleFieldHand,
    projector.creativeFieldHand,
    voxel.voxelDensityHand,
    voxel.voxelSurfaceMeshHand,
    refine.featurePreservingRefineHand,
    refine.refinedVoxelSurfaceWebglHand,
  ];
  if (hands.some((hand) => !hand?.id || typeof hand.execute !== "function")) {
    throw new Error("VFX donor does not expose the required refined-surface Hands");
  }
  const graph = {
    schema: "axm.hand-graph/v0.1",
    id: "axm.creative-render.direct-sample-voxel-refined-surface",
    version: "0.1.0",
    stages: [
      { id: "admit-samples", hand: stream.admitSampleFieldHand.id, params: {} },
      { id: "creative-field", hand: projector.creativeFieldHand.id, params: {} },
      { id: "voxel-density", hand: voxel.voxelDensityHand.id, params: { resolution, kernel, iso } },
      { id: "surface-mesh", hand: voxel.voxelSurfaceMeshHand.id, params: { maxTriangles } },
      { id: "feature-refine", hand: refine.featurePreservingRefineHand.id, params: { iterations, lambda, featurePreserve, maxMoveVoxels } },
      { id: "realize-refined", hand: refine.refinedVoxelSurfaceWebglHand.id, params: {} },
    ],
  };
  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(hands),
    graph,
    initialState: stream.makeDirectSampleState(sampleField, options.seed ?? 20260916),
    context: { callerKind: "axm-creative-render" },
  });
  const first = execute();
  const second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("refined VFX surface repeat verification failed");

  const finalState = object(first.finalState, "refined VFX final state");
  const voxelField = object(finalState.voxelField, "refined VFX voxel field");
  const surfaceMesh = object(finalState.surfaceMesh, "refined VFX surface mesh");
  const realization = object(finalState.realizations?.holographicVoxelSurface, "refined VFX realization");
  const triangleCount = validateRefinedSurfaceMesh(surfaceMesh);
  if (finalState.form?.sourceDigest !== sampleField.sourceDigest || finalState.form?.sourceKind !== sampleField.sourceKind) {
    throw new Error("refined VFX path lost caller source identity");
  }
  if (finalState.sampleField?.pointCount !== pointCount || finalState.sampleField?.canonicalFormHash !== sampleField.sourceDigest) {
    throw new Error("refined VFX path lost direct-sample continuity");
  }
  if (surfaceMesh.sourceVoxelDigest !== voxelField.digest) throw new Error("refined VFX surface lost voxel identity");
  if (realization.renderer !== "axm.vfx.holographic-voxel-surface/v0.7") {
    throw new Error(`unexpected refined VFX renderer: ${String(realization.renderer)}`);
  }
  if (realization.meshDigest !== surfaceMesh.digest || realization.voxelDigest !== voxelField.digest) {
    throw new Error("refined VFX realization lost mesh or voxel identity");
  }
  if (realization.canonicalFormHash !== sampleField.sourceDigest) throw new Error("refined VFX realization lost source hash");

  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  const htmlBytes = Buffer.from(realization.content, "utf8");
  return {
    surfaceMesh: structuredClone(surfaceMesh),
    stateBytes,
    htmlBytes,
    observation: {
      schema: "axm.creative-render.vfx-refined-surface-observation/v1",
      donor: "axm-visual-effect-fabric",
      graph_owner: "axm-creative-render-caller-composition",
      graph_id: graph.id,
      donor_hand_ids: hands.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      final_state_hash: first.finalStateHash,
      source_kind: finalState.form?.sourceKind ?? null,
      source_digest: finalState.form?.sourceDigest ?? null,
      point_count: pointCount,
      voxel: { schema: voxelField.schema, resolution: voxelField.resolution, digest: voxelField.digest, derived: voxelField.derived, rebuildable: voxelField.rebuildable },
      surface: {
        schema: surfaceMesh.schema,
        triangle_count: triangleCount,
        parent_mesh_digest: surfaceMesh.parentMeshDigest,
        digest: surfaceMesh.digest,
        source_voxel_digest: surfaceMesh.sourceVoxelDigest,
        derived: surfaceMesh.derived,
        rebuildable: surfaceMesh.rebuildable,
        refinement: structuredClone(surfaceMesh.refinement),
      },
      renderer: realization.renderer,
      repeat_verification: "PASS",
      state_sha256: sha256(stateBytes),
      html_sha256: sha256(htmlBytes),
      truth_boundary: {
        donor_graph_reused: false,
        donor_hands_reused: true,
        refined_surface_is_canonical_source: false,
        semantic_topology_recovery_proven: false,
      },
    },
  };
}

export async function runUniversalCreationSurfaceEdit(root, precisionMesh, lineage = {}, options = {}) {
  object(precisionMesh, "caller precision mesh");
  if (precisionMesh.schema !== "axm.precision-mesh/v1") throw new Error("UC surface edit requires axm.precision-mesh/v1 caller state");
  if (!Array.isArray(precisionMesh.positions) || !Array.isArray(precisionMesh.indices) || precisionMesh.indices.length % 3 !== 0) {
    throw new Error("UC surface edit requires triangle precision-mesh state");
  }
  const twistDegrees = finite(options.twistDegrees ?? 22, "twist degrees");
  const translateX = finite(options.translateX ?? 0.18, "translation x");
  if (Math.abs(twistDegrees) > 180) throw new Error("twist degrees must stay within +/-180 for this proof");
  if (Math.abs(translateX) > 1) throw new Error("translation x must stay within +/-1 for this proof");

  const rootPath = resolve(root);
  const entryPath = resolve(rootPath, "capabilities/platform-hands/index.js");
  const entry = await fileDigest(entryPath);
  const require = createRequire(import.meta.url);
  const platform = require(entryPath);
  const hands = platform?.creativeHands;
  const flow = platform?.creativeFlow;
  if (!hands || typeof hands.audit !== "function" || typeof hands.recipeRegistry !== "function") {
    throw new Error("Universal Creation creativeHands surface unavailable");
  }
  if (!flow || typeof flow.run !== "function" || typeof flow.summary !== "function") {
    throw new Error("Universal Creation Creative Flow unavailable");
  }
  const audit = object(hands.audit(), "UC creative hands audit");
  const recipes = object(hands.recipeRegistry(), "UC recipe registry");
  const flowSummary = object(flow.summary(), "UC Creative Flow summary");
  const inputMeshSha256 = sha256(stableMeshBytes(precisionMesh));
  const state = {
    surface_mesh: structuredClone(precisionMesh),
    source_lineage: structuredClone(lineage),
  };
  const request = {
    mode: "execute",
    goal: "apply explicit bounded creative edits directly to caller-supplied VFX-derived geometry",
    state,
    steps: [
      { id: "twist", hand_id: "creative.mesh-deform.twist", args: { mesh: { $state: "surface_mesh" }, degrees: twistDegrees }, save_as: "twisted_mesh" },
      { id: "translate", hand_id: "creative.mesh-transform.translate", args: { mesh: { $state: "twisted_mesh" }, vector: [translateX, 0, 0] }, save_as: "edited_mesh" },
      { id: "bounds", hand_id: "creative.mesh-analysis.bounds", args: { mesh: { $state: "edited_mesh" } }, save_as: "bounds" },
    ],
    expose: { bounds: { $state: "bounds" } },
  };
  const before = JSON.stringify(request.state);
  const first = object(flow.run(request), "UC surface edit result");
  const second = object(flow.run(request), "UC repeated surface edit result");
  if (first.status !== "PASS" || first.candidate_ready !== true || first.source_state_mutated !== false) {
    throw new Error(`UC surface edit did not pass cleanly: ${String(first.status)}`);
  }
  if (second.status !== "PASS" || second.digest !== first.digest) throw new Error("UC surface edit repeat verification failed");
  if (JSON.stringify(request.state) !== before) throw new Error("UC surface edit mutated caller source state");
  if (!Array.isArray(first.receipts) || first.receipts.length !== 3 || first.receipts.some((row) => row.status !== "PASS")) {
    throw new Error("UC surface edit receipt set drifted");
  }
  const editedMesh = object(first.final_state?.edited_mesh, "UC edited precision mesh");
  const repeatedMesh = object(second.final_state?.edited_mesh, "UC repeated edited precision mesh");
  if (editedMesh.schema !== "axm.precision-mesh/v1" || editedMesh.digest !== repeatedMesh.digest) {
    throw new Error("UC edited mesh identity did not repeat");
  }
  if (editedMesh.indices.length !== precisionMesh.indices.length) throw new Error("bounded UC edit unexpectedly changed triangle count");
  if (editedMesh.positions.length !== precisionMesh.positions.length) throw new Error("bounded UC edit unexpectedly changed vertex count");

  const albedo = options.albedo ?? [72, 220, 180];
  const beforeScene = precisionMeshToAxmScene(precisionMesh, { scale: 1, albedo });
  const editedScene = precisionMeshToAxmScene(editedMesh, { scale: 1, albedo });
  const beforeSceneBytes = Buffer.from((await import("./creative_scene_operator.mjs")).serializeScene(beforeScene), "utf8");
  const editedSceneBytes = Buffer.from((await import("./creative_scene_operator.mjs")).serializeScene(editedScene), "utf8");
  if (sha256(beforeSceneBytes) === sha256(editedSceneBytes)) throw new Error("UC creative edit produced identical AXM scene bytes");

  return {
    inputPrecisionMesh: structuredClone(precisionMesh),
    editedPrecisionMesh: structuredClone(editedMesh),
    beforeSceneBytes,
    editedSceneBytes,
    observation: {
      schema: "axm.creative-render.uc-vfx-surface-edit-observation/v1",
      donor: "axm-universal-creation",
      entry_sha256: entry.sha256,
      hand_count: audit.total,
      recipe_count: recipes.count,
      creative_flow_version: String(flow.version ?? "unknown"),
      creative_flow_summary_digest: flowSummary.digest ?? null,
      flow_status: first.status,
      flow_digest: first.digest ?? null,
      flow_operations: first.receipts.map((row) => row.operation_id ?? row.hand_id ?? null),
      source_state_mutated: first.source_state_mutated,
      candidate_ready: first.candidate_ready,
      input_precision_mesh_sha256: inputMeshSha256,
      input_triangle_count: precisionMesh.indices.length / 3,
      edited_triangle_count: editedMesh.indices.length / 3,
      edited_mesh_digest: editedMesh.digest,
      edit_policy: { twist_degrees: twistDegrees, translate: [translateX, 0, 0] },
      bounds: structuredClone(first.final_state?.bounds ?? null),
      repeat_verification: "PASS",
      before_scene_sha256: sha256(beforeSceneBytes),
      edited_scene_sha256: sha256(editedSceneBytes),
      truth_boundary: {
        uc_owns_creative_hands_and_receipts: true,
        caller_source_mesh_overwritten: false,
        edited_mesh_promoted_to_original_world_truth: false,
        semantic_edit_intent_proven: false,
      },
    },
  };
}
