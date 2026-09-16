import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { precisionMeshToAxmScene } from "./donor_bridge.mjs";
import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

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

function bounded(value, label, min, max, fallback) {
  const number = value == null ? fallback : finite(value, label);
  if (number < min || number > max) throw new Error(`${label} must be in ${min}..${max}`);
  return number;
}

function integer(value, label, min, max, fallback) {
  const number = Math.round(value == null ? fallback : finite(value, label));
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return number;
}

function validatePrecisionMesh(mesh) {
  object(mesh, "precision mesh");
  if (mesh.schema !== "axm.precision-mesh/v1") throw new Error("physics proxy requires axm.precision-mesh/v1");
  if (!Array.isArray(mesh.positions) || mesh.positions.length < 9 || mesh.positions.length % 3 !== 0) {
    throw new Error("physics proxy requires XYZ precision-mesh positions");
  }
  if (!Array.isArray(mesh.indices) || mesh.indices.length < 3 || mesh.indices.length % 3 !== 0) {
    throw new Error("physics proxy requires triangle precision-mesh indices");
  }
  for (const value of mesh.positions) finite(value, "precision mesh position");
  return mesh.indices.length / 3;
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

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export function precisionMeshToPhysicsProxy(mesh, options = {}) {
  const triangleCount = validatePrecisionMesh(mesh);
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index], y = mesh.positions[index + 1];
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y);
  }
  const rawHalfWidth = (max[0] - min[0]) / 2;
  const rawHalfHeight = (max[1] - min[1]) / 2;
  const minHalfExtent = bounded(options.minHalfExtent, "minimum proxy half extent", 0.001, 1, 0.01);
  const halfWidth = Math.max(rawHalfWidth, minHalfExtent);
  const halfHeight = Math.max(rawHalfHeight, minHalfExtent);
  const center = { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2 };
  const sourceMeshSha256 = sha256(stableMeshBytes(mesh));
  const proxy = {
    schema: "axm.creative-render.physics-proxy-2d/v1",
    source_mesh_sha256: sourceMeshSha256,
    projection: "precision-mesh-x-y-axis-aligned-bounds",
    shape: { kind: "box", halfWidth, halfHeight },
    source_bounds_xy: { min: { x: min[0], y: min[1] }, max: { x: max[0], y: max[1] }, center },
    padding_applied: { x: halfWidth !== rawHalfWidth, y: halfHeight !== rawHalfHeight },
  };
  return {
    proxy,
    observation: {
      schema: "axm.creative-render.precision-mesh-to-physics-proxy/v1",
      source_mesh_sha256: sourceMeshSha256,
      source_triangle_count: triangleCount,
      projection: proxy.projection,
      output_shape: structuredClone(proxy.shape),
      source_bounds_xy: structuredClone(proxy.source_bounds_xy),
      padding_applied: structuredClone(proxy.padding_applied),
      mesh_collision_preserved: false,
      z_axis_represented: false,
      adapter_policy: "derive one explicit 2D axis-aligned box proxy from the caller mesh X/Y bounds; do not claim triangle collision or 3D physics",
    },
  };
}

export async function runUniversalCreationPhysicsProxy(root, precisionMesh, lineage = {}, options = {}) {
  validatePrecisionMesh(precisionMesh);
  const dropDistance = bounded(options.dropDistance, "drop distance", 0.1, 2, 0.55);
  const gravityY = bounded(options.gravityY, "gravity y", 0.1, 50, 9.81);
  const steps = integer(options.steps, "physics steps", 1, 600, 120);
  const sampleEvery = integer(options.sampleEvery, "sampleEvery", 1, steps, 30);
  const dt = bounded(options.dt, "physics dt", 1 / 1000, 0.1, 1 / 60);
  const floorHalfHeight = 0.08;

  const admitted = precisionMeshToPhysicsProxy(precisionMesh, options);
  const rootPath = resolve(root);
  const physicsPath = resolve(rootPath, "capabilities/physics-core/index.js");
  const creativePath = resolve(rootPath, "capabilities/platform-hands/index.js");
  const [physicsEntry, creativeEntry] = await Promise.all([fileDigest(physicsPath), fileDigest(creativePath)]);
  const require = createRequire(import.meta.url);
  const Physics = require(physicsPath);
  const Fabric = Physics?.fabric;
  if (!Fabric || typeof Fabric.createFabric !== "function" || typeof Fabric.simulateFabric !== "function" || typeof Fabric.adapter !== "function") {
    throw new Error("Universal Creation Physics Fabric public surface unavailable");
  }
  const adapter = object(Fabric.adapter(), "UC physics adapter");
  if (!Array.isArray(adapter.capabilities) || !adapter.capabilities.includes("simulate-fabric")) {
    throw new Error("UC physics adapter does not expose simulate-fabric");
  }

  const shape = admitted.proxy.shape;
  const floorCenterY = shape.halfHeight + dropDistance + floorHalfHeight;
  const floorHalfWidth = Math.max(2, shape.halfWidth * 4);
  const seedFabric = () => Fabric.createFabric({
    world: { gravity: { x: 0, y: gravityY }, bounds: false },
    materials: [{ id: "surface-proxy-material", density: 1, friction: 0.65, restitution: 0.05, linearDamping: 0.02 }],
    bodies: [
      {
        id: "surface-proxy",
        material: "surface-proxy-material",
        shape: structuredClone(shape),
        position: { x: 0, y: 0 },
      },
      {
        id: "floor",
        type: "static",
        shape: { kind: "box", halfWidth: floorHalfWidth, halfHeight: floorHalfHeight },
        position: { x: 0, y: floorCenterY },
        friction: 0.8,
        restitution: 0,
      },
    ],
    metadata: {
      caller: "axm-creative-render",
      source_mesh_sha256: admitted.observation.source_mesh_sha256,
      proxy_schema: admitted.proxy.schema,
    },
  });

  const first = object(Fabric.simulateFabric(seedFabric(), steps, dt, sampleEvery), "UC physics trace");
  const second = object(Fabric.simulateFabric(seedFabric(), steps, dt, sampleEvery), "UC repeated physics trace");
  if (first.ok !== true || second.ok !== true || !first.finalChecksum || first.finalChecksum !== second.finalChecksum) {
    throw new Error("UC physics same-runtime repeat verification failed");
  }
  const finalBody = first.fabric?.world?.bodies?.find((body) => body.id === "surface-proxy");
  const repeatedBody = second.fabric?.world?.bodies?.find((body) => body.id === "surface-proxy");
  if (!finalBody || !repeatedBody) throw new Error("UC physics trace lost surface proxy body");
  const displacement = {
    x: finite(finalBody.position?.x, "final proxy x"),
    y: finite(finalBody.position?.y, "final proxy y"),
  };
  if (Math.abs(displacement.x - finite(repeatedBody.position?.x, "repeated proxy x")) > 1e-12 ||
      Math.abs(displacement.y - finite(repeatedBody.position?.y, "repeated proxy y")) > 1e-12) {
    throw new Error("UC physics proxy final position did not repeat");
  }
  if (displacement.y <= 0.05 || displacement.y > dropDistance + 0.5) {
    throw new Error(`UC physics proxy displacement outside bounded proof window: ${displacement.y}`);
  }

  const platform = require(creativePath);
  const flow = platform?.creativeFlow;
  if (!flow || typeof flow.run !== "function" || typeof flow.summary !== "function") {
    throw new Error("Universal Creation Creative Flow unavailable for physics displacement application");
  }
  const request = {
    mode: "execute",
    goal: "apply only the explicit displacement produced by the caller-owned 2D physics proxy to the supplied derived mesh",
    state: {
      physics_input_mesh: structuredClone(precisionMesh),
      physics_proxy_lineage: {
        ...structuredClone(lineage),
        source_mesh_sha256: admitted.observation.source_mesh_sha256,
        physics_final_checksum: first.finalChecksum,
        physics_displacement_xy: structuredClone(displacement),
      },
    },
    steps: [
      {
        id: "physics-translate",
        hand_id: "creative.mesh-transform.translate",
        args: { mesh: { $state: "physics_input_mesh" }, vector: [displacement.x, displacement.y, 0] },
        save_as: "physics_moved_mesh",
      },
      {
        id: "bounds",
        hand_id: "creative.mesh-analysis.bounds",
        args: { mesh: { $state: "physics_moved_mesh" } },
        save_as: "bounds",
      },
    ],
    expose: { bounds: { $state: "bounds" } },
  };
  const sourceStateBefore = JSON.stringify(request.state);
  const flowFirst = object(flow.run(request), "UC physics displacement Creative Flow");
  const flowSecond = object(flow.run(request), "UC repeated physics displacement Creative Flow");
  if (flowFirst.status !== "PASS" || flowFirst.candidate_ready !== true || flowFirst.source_state_mutated !== false) {
    throw new Error(`UC physics displacement flow did not pass cleanly: ${String(flowFirst.status)}`);
  }
  if (flowSecond.status !== "PASS" || flowSecond.digest !== flowFirst.digest) throw new Error("UC physics displacement flow did not repeat");
  if (JSON.stringify(request.state) !== sourceStateBefore) throw new Error("UC physics displacement flow mutated caller source state");
  if (!Array.isArray(flowFirst.receipts) || flowFirst.receipts.length !== 2 || flowFirst.receipts.some((row) => row.status !== "PASS")) {
    throw new Error("UC physics displacement Creative Flow receipt set drifted");
  }
  const movedMesh = object(flowFirst.final_state?.physics_moved_mesh, "UC physics-moved mesh");
  if (movedMesh.schema !== "axm.precision-mesh/v1" || movedMesh.indices.length !== precisionMesh.indices.length) {
    throw new Error("UC physics displacement changed precision-mesh topology unexpectedly");
  }
  if (movedMesh.digest === precisionMesh.digest) throw new Error("UC physics displacement produced identical mesh digest");

  const albedo = options.albedo ?? [72, 220, 180];
  const beforeSceneBytes = Buffer.from(serializeScene(precisionMeshToAxmScene(precisionMesh, { scale: 1, albedo })), "utf8");
  const physicsSceneBytes = Buffer.from(serializeScene(precisionMeshToAxmScene(movedMesh, { scale: 1, albedo })), "utf8");
  if (sha256(beforeSceneBytes) === sha256(physicsSceneBytes)) throw new Error("UC physics proxy produced identical renderer scene bytes");

  const traceEvidence = {
    schema: "axm.creative-render.uc-physics-proxy-trace/v1",
    source_mesh_sha256: admitted.observation.source_mesh_sha256,
    proxy: admitted.proxy,
    physics: {
      adapter: { id: adapter.id, version: adapter.version, coreVersion: adapter.coreVersion, capabilities: adapter.capabilities },
      steps,
      dt,
      sample_every: sampleEvery,
      gravity: { x: 0, y: gravityY },
      floor: { center: { x: 0, y: floorCenterY }, halfWidth: floorHalfWidth, halfHeight: floorHalfHeight },
      final_checksum: first.finalChecksum,
      frames: first.frames,
      final_proxy_position: { x: finalBody.position.x, y: finalBody.position.y },
      final_proxy_velocity: structuredClone(finalBody.velocity),
      final_proxy_sleeping: !!finalBody.sleeping,
      repeat_verification: "PASS",
    },
  };
  const traceBytes = Buffer.from(`${JSON.stringify(traceEvidence, null, 2)}\n`, "utf8");

  return {
    inputPrecisionMesh: structuredClone(precisionMesh),
    physicsMovedPrecisionMesh: structuredClone(movedMesh),
    beforeSceneBytes,
    physicsSceneBytes,
    traceBytes,
    observation: {
      schema: "axm.creative-render.uc-physics-proxy-observation/v1",
      donor: "axm-universal-creation",
      physics_entry_sha256: physicsEntry.sha256,
      creative_entry_sha256: creativeEntry.sha256,
      physics_adapter: { id: adapter.id, version: adapter.version, core_version: adapter.coreVersion },
      proxy_adapter: admitted.observation,
      steps,
      dt,
      sample_every: sampleEvery,
      gravity: { x: 0, y: gravityY },
      final_checksum: first.finalChecksum,
      repeat_verification: "PASS",
      displacement_xy: structuredClone(displacement),
      creative_flow_status: flowFirst.status,
      creative_flow_digest: flowFirst.digest ?? null,
      creative_flow_operations: flowFirst.receipts.map((row) => row.operation_id ?? row.hand_id ?? null),
      source_state_mutated: flowFirst.source_state_mutated,
      candidate_ready: flowFirst.candidate_ready,
      input_mesh_sha256: admitted.observation.source_mesh_sha256,
      physics_moved_mesh_digest: movedMesh.digest,
      input_triangle_count: precisionMesh.indices.length / 3,
      output_triangle_count: movedMesh.indices.length / 3,
      before_scene_sha256: sha256(beforeSceneBytes),
      physics_scene_sha256: sha256(physicsSceneBytes),
      trace_sha256: sha256(traceBytes),
      truth_boundary: {
        physics_dimension: "2D",
        proxy_kind: "axis-aligned X/Y bounds box",
        triangle_mesh_collision_proven: false,
        z_axis_physics_proven: false,
        rigid_rotation_proven: false,
        scientific_validation_proven: false,
        cross_engine_bitwise_determinism_proven: false,
        caller_source_mesh_overwritten: false,
        physics_moved_mesh_promoted_to_canonical_world_truth: false,
      },
    },
  };
}
