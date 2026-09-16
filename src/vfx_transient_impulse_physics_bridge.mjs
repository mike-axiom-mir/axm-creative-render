import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { precisionMeshToAxmScene } from "./donor_bridge.mjs";
import { serializeScene, sha256 } from "./creative_scene_operator.mjs";
import { precisionMeshToPhysicsProxy } from "./vfx_uc_physics_proxy_bridge.mjs";

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

function validatePrecisionMesh(mesh) {
  object(mesh, "precision mesh");
  if (mesh.schema !== "axm.precision-mesh/v1") throw new Error("transient impulse physics requires axm.precision-mesh/v1");
  if (!Array.isArray(mesh.positions) || mesh.positions.length < 9 || mesh.positions.length % 3 !== 0) {
    throw new Error("transient impulse physics requires XYZ precision-mesh positions");
  }
  if (!Array.isArray(mesh.indices) || mesh.indices.length < 3 || mesh.indices.length % 3 !== 0) {
    throw new Error("transient impulse physics requires triangle precision-mesh indices");
  }
  for (const value of mesh.positions) finite(value, "precision mesh position");
  return mesh.indices.length / 3;
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

export function transientImpulseEventToPhysicsAction(event, options = {}) {
  object(event, "VFX transient impulse event");
  if (event.schema !== "axm.transient-impulse-event/v0.1" || event.kind !== "transient-impulse") {
    throw new Error("physics adapter requires normalized axm.transient-impulse-event/v0.1");
  }
  if (!Array.isArray(event.direction) || event.direction.length !== 2) {
    throw new Error("normalized transient impulse direction must contain exactly two components");
  }
  const direction = event.direction.map((value, index) => finite(value, `event.direction[${index}]`));
  const length = Math.hypot(...direction);
  if (Math.abs(length - 1) > 1e-4) throw new Error("transient impulse direction must already be normalized by the VFX donor");
  const energy = bounded(event.energy, "event energy", 0.05, 2, 1);
  const impulseScale = bounded(options.impulseScale, "consumer impulse scale", 0.05, 4, 0.7);
  const impulse = {
    x: direction[0] * energy * impulseScale,
    y: direction[1] * energy * impulseScale,
  };
  return {
    action: {
      id: String(options.actionId ?? "vfx-transient-impulse"),
      kind: "apply-impulse",
      bodyId: String(options.bodyId ?? "surface-proxy"),
      impulse,
      atStep: integer(options.atStep, "impulse action step", 1, 60, 1),
    },
    observation: {
      schema: "axm.creative-render.vfx-transient-event-to-uc-physics-action/v1",
      source_event_schema: event.schema,
      source_event_kind: event.kind,
      source_event_id: String(event.id ?? ""),
      source_direction: [...direction],
      source_energy: energy,
      consumer_impulse_scale: impulseScale,
      output_action_kind: "apply-impulse",
      output_impulse: { ...impulse },
      mapping_policy: "Creative Render, as the consumer, maps only normalized VFX event direction and energy into a bounded UC Physics Fabric apply-impulse action; VFX does not declare physics meaning",
      vfx_declares_physics_semantics: false,
      derived_field_geometry_used_as_collision_or_force_data: false,
      consumer_owns_mapping: true,
    },
  };
}

export async function observeVisualEffectTransientImpulse(root, options = {}) {
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    impulse: resolve(rootPath, "hand-lab/src/transient-impulse-hands.mjs"),
  };
  const sources = Object.fromEntries(await Promise.all(
    Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)]),
  ));
  const runtime = await import(`${pathToFileURL(paths.runtime).href}?sha=${sources.runtime.sha256}`);
  const impulse = await import(`${pathToFileURL(paths.impulse).href}?sha=${sources.impulse.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function") {
    throw new Error("VFX Hand runtime unavailable for transient impulse");
  }
  if (typeof impulse.makeTransientImpulseState !== "function" || !impulse.TRANSIENT_IMPULSE_GRAPH || !Array.isArray(impulse.TRANSIENT_IMPULSE_HANDS)) {
    throw new Error("VFX transient impulse public Hand graph unavailable");
  }

  const initialState = impulse.makeTransientImpulseState({
    id: options.id ?? "creative-render-physics-impulse",
    seed: options.seed ?? 20260916,
    origin: options.origin ?? [0.5, 0.5],
    direction: options.direction ?? [1, 0.28],
    energy: options.energy ?? 0.9,
    radius: options.radius ?? 0.28,
    duration: options.duration ?? 0.8,
    tint: options.tint ?? [0.18, 0.9, 1],
    accent: options.accent ?? [1, 0.52, 0.18],
    controls: options.controls ?? {
      symmetry: 0.2,
      directionality: 0.92,
      fragmentation: 0.62,
      ringWeight: 0.72,
      spokeWeight: 1.08,
    },
  });
  const execute = () => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(impulse.TRANSIENT_IMPULSE_HANDS),
    graph: impulse.TRANSIENT_IMPULSE_GRAPH,
    initialState: structuredClone(initialState),
    context: { callerKind: "axm-creative-render" },
  });
  const first = execute();
  const second = execute();
  if (first.finalStateHash !== second.finalStateHash) throw new Error("VFX transient impulse repeat verification failed");

  const finalState = object(first.finalState, "VFX transient impulse final state");
  const event = object(finalState.event, "VFX transient impulse canonical event");
  const field = object(finalState.impulseField, "VFX transient impulse derived field");
  const envelope = object(finalState.impulseEnvelope, "VFX transient impulse derived envelope");
  const realization = object(finalState.realizations?.transientImpulseSvg, "VFX transient impulse SVG realization");
  if (event.schema !== "axm.transient-impulse-event/v0.1" || event.kind !== "transient-impulse") {
    throw new Error("VFX transient impulse canonical event contract drifted");
  }
  if (field.schema !== "axm.transient-impulse-field/v0.1" || field.derived !== true || field.rebuildable !== true) {
    throw new Error("VFX transient impulse field must remain explicitly derived and rebuildable");
  }
  if (envelope.schema !== "axm.transient-envelope/v0.1" || envelope.derived !== true) {
    throw new Error("VFX transient impulse envelope must remain explicitly derived");
  }
  if (field.canonicalEventHash !== finalState.eventCanonicalHash || realization.canonicalEventHash !== finalState.eventCanonicalHash) {
    throw new Error("VFX transient impulse realization lost canonical event identity");
  }
  if (realization.fieldGeometryHash !== field.geometryHash || realization.renderer !== "axm.vfx.transient-impulse-svg/v0.1") {
    throw new Error("VFX transient impulse realization lost field identity or renderer contract");
  }
  if (typeof realization.content !== "string" || !realization.content.includes("<svg")) {
    throw new Error("VFX transient impulse did not produce inspectable derived SVG evidence");
  }

  const stateBytes = Buffer.from(`${JSON.stringify(finalState, null, 2)}\n`, "utf8");
  const svgBytes = Buffer.from(realization.content, "utf8");
  return {
    event: structuredClone(event),
    stateBytes,
    svgBytes,
    observation: {
      schema: "axm.creative-render.vfx-transient-impulse-observation/v1",
      donor: "axm-visual-effect-fabric",
      donor_graph_id: impulse.TRANSIENT_IMPULSE_GRAPH.id,
      donor_graph_version: impulse.TRANSIENT_IMPULSE_GRAPH.version,
      donor_hand_ids: impulse.TRANSIENT_IMPULSE_HANDS.map((hand) => hand.id),
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
      final_state_hash: first.finalStateHash,
      canonical_event_hash: finalState.eventCanonicalHash,
      event: structuredClone(event),
      field: {
        schema: field.schema,
        geometry_hash: field.geometryHash,
        counts: structuredClone(field.counts),
        derived: field.derived,
        rebuildable: field.rebuildable,
      },
      envelope: {
        schema: envelope.schema,
        duration: envelope.duration,
        sample_count: Array.isArray(envelope.samples) ? envelope.samples.length : null,
        derived: envelope.derived,
      },
      realization: {
        renderer: realization.renderer,
        media_type: realization.mediaType,
        state_hash: realization.derivedFromStateHash,
        svg_sha256: sha256(svgBytes),
      },
      repeat_verification: "PASS",
      state_sha256: sha256(stateBytes),
      truth_boundary: {
        event_is_vfx_canonical_input: true,
        field_envelope_and_svg_are_derived_rebuildable_bodies: true,
        event_has_gameplay_or_physics_semantics: false,
        aesthetic_quality_proven: false,
      },
    },
  };
}

export async function runUniversalCreationTransientImpulsePhysics(root, precisionMesh, transientEvent, lineage = {}, options = {}) {
  const triangleCount = validatePrecisionMesh(precisionMesh);
  const admitted = precisionMeshToPhysicsProxy(precisionMesh, options);
  const mapped = transientImpulseEventToPhysicsAction(transientEvent, options);
  const steps = integer(options.steps, "physics steps", 2, 600, 90);
  const sampleEvery = integer(options.sampleEvery, "physics sample interval", 1, steps, 30);
  const dt = bounded(options.dt, "physics dt", 1 / 1000, 0.1, 1 / 60);

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
  const physicsAdapter = object(Fabric.adapter(), "UC physics adapter");
  if (!Array.isArray(physicsAdapter.capabilities) || !physicsAdapter.capabilities.includes("simulate-fabric")) {
    throw new Error("UC physics adapter does not expose simulate-fabric");
  }

  const seedFabric = () => Fabric.createFabric({
    world: { gravity: { x: 0, y: 0 }, bounds: false },
    materials: [{ id: "surface-proxy-material", density: 1, friction: 0.5, restitution: 0, linearDamping: 0.08 }],
    bodies: [{
      id: "surface-proxy",
      material: "surface-proxy-material",
      shape: structuredClone(admitted.proxy.shape),
      position: { x: 0, y: 0 },
    }],
    actions: [structuredClone(mapped.action)],
    metadata: {
      caller: "axm-creative-render",
      source_mesh_sha256: admitted.observation.source_mesh_sha256,
      source_vfx_event_id: String(transientEvent.id ?? ""),
      source_vfx_event_hash: String(lineage.vfx_event_hash ?? ""),
      mapping_schema: mapped.observation.schema,
    },
  });

  const first = object(Fabric.simulateFabric(seedFabric(), steps, dt, sampleEvery), "UC transient-impulse physics trace");
  const second = object(Fabric.simulateFabric(seedFabric(), steps, dt, sampleEvery), "UC repeated transient-impulse physics trace");
  if (first.ok !== true || second.ok !== true || !first.finalChecksum || first.finalChecksum !== second.finalChecksum) {
    throw new Error("UC transient-impulse physics same-runtime repeat verification failed");
  }
  const finalBody = first.fabric?.world?.bodies?.find((body) => body.id === "surface-proxy");
  const repeatedBody = second.fabric?.world?.bodies?.find((body) => body.id === "surface-proxy");
  if (!finalBody || !repeatedBody) throw new Error("UC transient-impulse physics trace lost surface proxy body");
  const displacement = {
    x: finite(finalBody.position?.x, "final proxy x"),
    y: finite(finalBody.position?.y, "final proxy y"),
  };
  if (Math.abs(displacement.x - finite(repeatedBody.position?.x, "repeated proxy x")) > 1e-12 ||
      Math.abs(displacement.y - finite(repeatedBody.position?.y, "repeated proxy y")) > 1e-12) {
    throw new Error("UC transient-impulse final position did not repeat");
  }
  const displacementMagnitude = Math.hypot(displacement.x, displacement.y);
  if (displacementMagnitude < 0.01 || displacementMagnitude > 2) {
    throw new Error(`UC transient-impulse displacement outside bounded proof window: ${displacementMagnitude}`);
  }
  const impulseMagnitude = Math.hypot(mapped.action.impulse.x, mapped.action.impulse.y);
  const alignment = (displacement.x * mapped.action.impulse.x + displacement.y * mapped.action.impulse.y) /
    Math.max(1e-12, displacementMagnitude * impulseMagnitude);
  if (alignment < 0.999) throw new Error(`UC transient-impulse displacement lost mapped impulse direction: ${alignment}`);

  const platform = require(creativePath);
  const flow = platform?.creativeFlow;
  if (!flow || typeof flow.run !== "function") throw new Error("Universal Creation Creative Flow unavailable for impulse displacement application");
  const request = {
    mode: "execute",
    goal: "apply only the explicit displacement from a consumer-mapped VFX transient event physics action to the supplied derived mesh",
    state: {
      impulse_input_mesh: structuredClone(precisionMesh),
      impulse_lineage: {
        ...structuredClone(lineage),
        source_mesh_sha256: admitted.observation.source_mesh_sha256,
        physics_final_checksum: first.finalChecksum,
        mapped_impulse: structuredClone(mapped.action.impulse),
        physics_displacement_xy: structuredClone(displacement),
      },
    },
    steps: [
      {
        id: "impulse-translate",
        hand_id: "creative.mesh-transform.translate",
        args: { mesh: { $state: "impulse_input_mesh" }, vector: [displacement.x, displacement.y, 0] },
        save_as: "impulse_moved_mesh",
      },
      {
        id: "bounds",
        hand_id: "creative.mesh-analysis.bounds",
        args: { mesh: { $state: "impulse_moved_mesh" } },
        save_as: "bounds",
      },
    ],
    expose: { bounds: { $state: "bounds" } },
  };
  const sourceStateBefore = JSON.stringify(request.state);
  const flowFirst = object(flow.run(request), "UC impulse displacement Creative Flow");
  const flowSecond = object(flow.run(request), "UC repeated impulse displacement Creative Flow");
  if (flowFirst.status !== "PASS" || flowFirst.candidate_ready !== true || flowFirst.source_state_mutated !== false) {
    throw new Error(`UC impulse displacement flow did not pass cleanly: ${String(flowFirst.status)}`);
  }
  if (flowSecond.status !== "PASS" || flowSecond.digest !== flowFirst.digest) throw new Error("UC impulse displacement flow did not repeat");
  if (JSON.stringify(request.state) !== sourceStateBefore) throw new Error("UC impulse displacement flow mutated caller source state");
  const movedMesh = object(flowFirst.final_state?.impulse_moved_mesh, "UC impulse-moved precision mesh");
  if (movedMesh.schema !== "axm.precision-mesh/v1" || movedMesh.indices.length !== precisionMesh.indices.length) {
    throw new Error("UC impulse displacement changed precision-mesh topology unexpectedly");
  }
  if (movedMesh.digest === precisionMesh.digest) throw new Error("UC impulse displacement produced identical mesh digest");

  const albedo = options.albedo ?? [72, 220, 180];
  const beforeSceneBytes = Buffer.from(serializeScene(precisionMeshToAxmScene(precisionMesh, { scale: 1, albedo })), "utf8");
  const impulseSceneBytes = Buffer.from(serializeScene(precisionMeshToAxmScene(movedMesh, { scale: 1, albedo })), "utf8");
  if (sha256(beforeSceneBytes) === sha256(impulseSceneBytes)) throw new Error("UC transient-impulse physics produced identical renderer scene bytes");

  const traceEvidence = {
    schema: "axm.creative-render.vfx-transient-uc-physics-trace/v1",
    source_mesh_sha256: admitted.observation.source_mesh_sha256,
    vfx_event_lineage: structuredClone(lineage),
    event_to_action: mapped.observation,
    proxy: admitted.proxy,
    physics: {
      adapter: { id: physicsAdapter.id, version: physicsAdapter.version, coreVersion: physicsAdapter.coreVersion, capabilities: physicsAdapter.capabilities },
      steps,
      dt,
      sample_every: sampleEvery,
      gravity: { x: 0, y: 0 },
      action: structuredClone(mapped.action),
      final_checksum: first.finalChecksum,
      frames: first.frames,
      final_proxy_position: { x: finalBody.position.x, y: finalBody.position.y },
      final_proxy_velocity: structuredClone(finalBody.velocity),
      repeat_verification: "PASS",
      impulse_displacement_alignment: alignment,
    },
  };
  const traceBytes = Buffer.from(`${JSON.stringify(traceEvidence, null, 2)}\n`, "utf8");

  return {
    inputPrecisionMesh: structuredClone(precisionMesh),
    impulseMovedPrecisionMesh: structuredClone(movedMesh),
    beforeSceneBytes,
    impulseSceneBytes,
    traceBytes,
    observation: {
      schema: "axm.creative-render.vfx-transient-uc-physics-observation/v1",
      donor: "axm-universal-creation",
      physics_entry_sha256: physicsEntry.sha256,
      creative_entry_sha256: creativeEntry.sha256,
      physics_adapter: { id: physicsAdapter.id, version: physicsAdapter.version, core_version: physicsAdapter.coreVersion },
      proxy_adapter: admitted.observation,
      event_to_action: mapped.observation,
      steps,
      dt,
      sample_every: sampleEvery,
      final_checksum: first.finalChecksum,
      repeat_verification: "PASS",
      mapped_impulse: structuredClone(mapped.action.impulse),
      displacement_xy: structuredClone(displacement),
      displacement_magnitude: displacementMagnitude,
      impulse_displacement_alignment: alignment,
      creative_flow_status: flowFirst.status,
      creative_flow_digest: flowFirst.digest ?? null,
      creative_flow_operations: flowFirst.receipts.map((row) => row.operation_id ?? row.hand_id ?? null),
      source_state_mutated: flowFirst.source_state_mutated,
      candidate_ready: flowFirst.candidate_ready,
      input_mesh_sha256: sha256(stableMeshBytes(precisionMesh)),
      impulse_moved_mesh_digest: movedMesh.digest,
      input_triangle_count: triangleCount,
      output_triangle_count: movedMesh.indices.length / 3,
      before_scene_sha256: sha256(beforeSceneBytes),
      impulse_scene_sha256: sha256(impulseSceneBytes),
      trace_sha256: sha256(traceBytes),
      truth_boundary: {
        vfx_event_is_physics_authority: false,
        creative_render_consumer_adapter_owns_event_to_impulse_mapping: true,
        vfx_derived_field_used_as_physics_collision_or_force_field: false,
        physics_dimension: "2D",
        proxy_kind: "axis-aligned X/Y bounds box",
        triangle_mesh_collision_proven: false,
        z_axis_physics_proven: false,
        rigid_rotation_proven: false,
        scientific_validation_proven: false,
        gameplay_meaning_proven: false,
        caller_source_mesh_overwritten: false,
        impulse_moved_mesh_promoted_to_canonical_world_truth: false,
        cross_engine_bitwise_determinism_proven: false,
      },
    },
  };
}
