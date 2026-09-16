import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

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

function byte(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 255) {
    throw new Error(`${label} must be an integer in 0..255`);
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
  for (const value of field.points) finite(value, "direct sample point value");
  if (typeof field.sourceKind !== "string" || !field.sourceKind) throw new Error("direct sample field requires sourceKind");
  if (typeof field.sourceDigest !== "string" || !field.sourceDigest) throw new Error("direct sample field requires sourceDigest");
  return pointCount;
}

function validateSurfaceMesh(mesh) {
  object(mesh, "VFX surface mesh");
  if (mesh.schema !== "axm.holographic-triangle-surface/v0.1") {
    throw new Error(`unexpected VFX surface mesh schema: ${String(mesh.schema)}`);
  }
  if (mesh.derived !== true || mesh.rebuildable !== true) {
    throw new Error("VFX surface mesh must remain explicitly derived and rebuildable");
  }
  if (!Array.isArray(mesh.vertices) || mesh.vertices.length === 0 || mesh.vertices.length % 9 !== 0) {
    throw new Error("VFX surface mesh vertices must contain packed triangles");
  }
  if (!Array.isArray(mesh.normals) || mesh.normals.length !== mesh.vertices.length) {
    throw new Error("VFX surface mesh normals must match vertex coordinates");
  }
  for (const value of [...mesh.vertices, ...mesh.normals]) finite(value, "VFX surface mesh value");
  const triangleCount = mesh.vertices.length / 9;
  if (triangleCount !== Number(mesh.triangleCount)) throw new Error("VFX surface mesh triangle count drifted");
  if (triangleCount > MAX_SURFACE_TRIANGLES) {
    throw new Error(`VFX surface mesh exceeds ${MAX_SURFACE_TRIANGLES}-triangle roundtrip ceiling`);
  }
  if (typeof mesh.sourceVoxelDigest !== "string" || !mesh.sourceVoxelDigest) {
    throw new Error("VFX surface mesh requires sourceVoxelDigest");
  }
  if (typeof mesh.digest !== "string" || !mesh.digest) throw new Error("VFX surface mesh requires digest");
  return triangleCount;
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export function surfaceMeshToAxmScene(surfaceMesh, options = {}) {
  const triangleCount = validateSurfaceMesh(surfaceMesh);
  const albedo = options.albedo ?? [54, 210, 240];
  if (!Array.isArray(albedo) || albedo.length !== 3) throw new Error("roundtrip albedo must be RGB");
  const rgb = albedo.map((value, index) => byte(value, `roundtrip albedo[${index}]`));

  const triangles = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 9;
    triangles.push({
      vertices: [
        surfaceMesh.vertices.slice(offset, offset + 3).map(Number),
        surfaceMesh.vertices.slice(offset + 3, offset + 6).map(Number),
        surfaceMesh.vertices.slice(offset + 6, offset + 9).map(Number),
      ],
      albedo: [...rgb],
    });
  }
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== triangleCount) throw new Error("roundtrip AXM scene triangle count changed during serialization");

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-surface-to-axm-scene/v1",
      source_surface_schema: surfaceMesh.schema,
      source_surface_digest: surfaceMesh.digest,
      source_voxel_digest: surfaceMesh.sourceVoxelDigest,
      source_triangle_count: triangleCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: reparsed.triangles.length,
      output_sha256: sha256(bytes),
      constant_albedo_rgb: rgb,
      normals_preserved: false,
      topology_semantics_preserved: false,
      adapter_policy: "one derived VFX surface triangle becomes one AXM_SCENE 1 triangle; normals are omitted and a declared constant albedo is assigned",
    },
  };
}

export async function observeVisualEffectVoxelSurface(root, sampleField, options = {}) {
  const pointCount = validateSampleField(sampleField);
  const resolution = integer(options.resolution ?? 18, "voxel resolution", 14, 34);
  const maxTriangles = integer(options.maxTriangles ?? MAX_SURFACE_TRIANGLES, "surface maxTriangles", 2_000, MAX_SURFACE_TRIANGLES);
  const kernel = finite(options.kernel ?? 1.9, "voxel kernel");
  const iso = finite(options.iso ?? 0.16, "voxel iso");
  if (kernel < 1 || kernel > 2.8) throw new Error("voxel kernel must be in [1,2.8]");
  if (iso < 0.06 || iso > 0.42) throw new Error("voxel iso must be in [0.06,0.42]");

  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    stream: resolve(rootPath, "hand-lab/src/holographic-state-stream.mjs"),
    projector: resolve(rootPath, "hand-lab/src/holographic-state-projector.mjs"),
    voxel: resolve(rootPath, "hand-lab/src/holographic-state-voxel-surface.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const modules = {};
  for (const [name, path] of Object.entries(paths)) {
    modules[name] = await import(`${pathToFileURL(path).href}?sha=${sources[name].sha256}`);
  }
  const { runtime, stream, projector, voxel } = modules;
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (typeof stream.admitSampleFieldHand?.execute !== "function" || typeof stream.makeDirectSampleState !== "function") {
    throw new Error("VFX donor direct-sample admission surface is unavailable");
  }
  const hands = [
    stream.admitSampleFieldHand,
    projector.creativeFieldHand,
    voxel.voxelDensityHand,
    voxel.voxelSurfaceMeshHand,
    voxel.voxelSurfaceWebglHand,
  ];
  if (hands.some((hand) => !hand?.id || typeof hand.execute !== "function")) {
    throw new Error("VFX donor does not expose the required voxel-surface Hands");
  }

  const graph = {
    schema: "axm.hand-graph/v0.1",
    id: "axm.creative-render.direct-sample-voxel-surface",
    version: "0.1.0",
    stages: [
      { id: "admit-samples", hand: stream.admitSampleFieldHand.id, params: {} },
      { id: "creative-field", hand: projector.creativeFieldHand.id, params: {} },
      { id: "voxel-density", hand: voxel.voxelDensityHand.id, params: { resolution, kernel, iso } },
      { id: "surface-mesh", hand: voxel.voxelSurfaceMeshHand.id, params: { maxTriangles } },
      { id: "realize-surface", hand: voxel.voxelSurfaceWebglHand.id, params: {} },
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
  if (first.finalStateHash !== second.finalStateHash) throw new Error("VFX voxel-surface repeat verification failed");

  const finalState = object(first.finalState, "VFX voxel-surface final state");
  const voxelField = object(finalState.voxelField, "VFX voxel field");
  const surfaceMesh = object(finalState.surfaceMesh, "VFX surface mesh");
  const realization = object(finalState.realizations?.holographicVoxelSurface, "VFX voxel-surface realization");
  const workingSet = object(realization.workingSet, "VFX voxel-surface working set");
  const triangleCount = validateSurfaceMesh(surfaceMesh);

  if (finalState.form?.sourceKind !== sampleField.sourceKind || finalState.form?.sourceDigest !== sampleField.sourceDigest) {
    throw new Error("VFX voxel-surface path lost caller source identity");
  }
  if (finalState.sampleField?.pointCount !== pointCount || finalState.sampleField?.canonicalFormHash !== sampleField.sourceDigest) {
    throw new Error("VFX voxel-surface path lost direct-sample continuity");
  }
  if (voxelField.schema !== "axm.holographic-voxel-density/v0.1" || voxelField.derived !== true || voxelField.rebuildable !== true) {
    throw new Error("VFX voxel-density contract drifted");
  }
  if (surfaceMesh.sourceVoxelDigest !== voxelField.digest) throw new Error("VFX surface mesh lost voxel source identity");
  if (realization.renderer !== "axm.vfx.holographic-voxel-surface/v0.6") {
    throw new Error(`unexpected VFX voxel-surface renderer: ${String(realization.renderer)}`);
  }
  if (realization.triangleCount !== triangleCount || realization.meshDigest !== surfaceMesh.digest || realization.voxelDigest !== voxelField.digest) {
    throw new Error("VFX surface realization lost mesh/voxel continuity");
  }
  if (realization.canonicalFormHash !== sampleField.sourceDigest) throw new Error("VFX surface realization lost canonical source hash");
  if (
    workingSet.canonicalFormRetained !== true ||
    workingSet.sampleFieldRetained !== true ||
    workingSet.voxelDensityDerived !== true ||
    workingSet.triangleMeshDerived !== true ||
    workingSet.gpuTriangleBufferDisposable !== true
  ) {
    throw new Error("VFX voxel-surface working-set boundary drifted");
  }
  if (typeof realization.content !== "string" || !realization.content.includes("<canvas")) {
    throw new Error("VFX voxel-surface realization did not produce HTML canvas content");
  }

  const htmlBytes = Buffer.from(realization.content, "utf8");
  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  return {
    surfaceMesh: structuredClone(surfaceMesh),
    htmlBytes,
    stateBytes,
    observation: {
      schema: "axm.creative-render.vfx-voxel-surface-observation/v1",
      donor: "axm-visual-effect-fabric",
      graph_owner: "axm-creative-render-caller-composition",
      graph_id: graph.id,
      graph_version: graph.version,
      donor_hand_ids: hands.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      executed_stage_count: first.executedStageIds?.length ?? null,
      final_state_hash: first.finalStateHash,
      source_kind: finalState.form?.sourceKind ?? null,
      source_digest: finalState.form?.sourceDigest ?? null,
      point_count: pointCount,
      voxel: {
        schema: voxelField.schema,
        resolution: voxelField.resolution,
        cells: voxelField.density?.length ?? null,
        iso: voxelField.iso,
        digest: voxelField.digest,
        derived: voxelField.derived,
        rebuildable: voxelField.rebuildable,
      },
      surface: {
        schema: surfaceMesh.schema,
        method: surfaceMesh.method,
        triangle_count: triangleCount,
        digest: surfaceMesh.digest,
        source_voxel_digest: surfaceMesh.sourceVoxelDigest,
        derived: surfaceMesh.derived,
        rebuildable: surfaceMesh.rebuildable,
      },
      renderer: realization.renderer,
      modeled_gpu_buffer_bytes: workingSet.modeledBufferBytes,
      source_identity_retained: true,
      repeat_verification: "PASS",
      html_sha256: sha256(htmlBytes),
      state_sha256: sha256(stateBytes),
      truth_boundary: {
        donor_graph_reused: false,
        donor_hands_reused: true,
        semantic_topology_recovery_proven: false,
        surface_kind: "approximate triangle shell reconstructed from a derived sampled/voxel field",
      },
    },
  };
}
