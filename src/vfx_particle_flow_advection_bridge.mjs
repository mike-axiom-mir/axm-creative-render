import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PARTICLE_FLOW_ADVECTION_RECEIPT";
const VERSION = 1;
const MAX_PARTICLES = 256;
const FIXED_ALBEDO = [236, 174, 76];
const HALF_SIZE = 0.018;

function revision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function normalized(value, label) {
  const number = finite(value, label);
  if (number < 0 || number > 1) throw new Error(`${label} must be within 0..1`);
  return number;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function withoutCoordinates(particle) {
  const copy = structuredClone(particle);
  delete copy.x;
  delete copy.y;
  return copy;
}

function sourceParticles() {
  return [
    { id: "seed-a0", x: 0.16, y: 0.22, userData: { group: "a", ordinal: 0, meaning: "caller-owned-untyped" } },
    { id: "seed-a1", x: 0.31, y: 0.28, userData: { group: "a", ordinal: 1, meaning: "caller-owned-untyped" } },
    { id: "seed-a2", x: 0.47, y: 0.24, userData: { group: "a", ordinal: 2, meaning: "caller-owned-untyped" } },
    { id: "seed-a3", x: 0.65, y: 0.30, userData: { group: "a", ordinal: 3, meaning: "caller-owned-untyped" } },
    { id: "seed-b0", x: 0.20, y: 0.52, userData: { group: "b", ordinal: 0, meaning: "caller-owned-untyped" } },
    { id: "seed-b1", x: 0.37, y: 0.57, userData: { group: "b", ordinal: 1, meaning: "caller-owned-untyped" } },
    { id: "seed-b2", x: 0.55, y: 0.50, userData: { group: "b", ordinal: 2, meaning: "caller-owned-untyped" } },
    { id: "seed-b3", x: 0.76, y: 0.58, userData: { group: "b", ordinal: 3, meaning: "caller-owned-untyped" } },
    { id: "seed-c0", x: 0.18, y: 0.79, userData: { group: "c", ordinal: 0, meaning: "caller-owned-untyped" } },
    { id: "seed-c1", x: 0.36, y: 0.73, userData: { group: "c", ordinal: 1, meaning: "caller-owned-untyped" } },
    { id: "seed-c2", x: 0.58, y: 0.80, userData: { group: "c", ordinal: 2, meaning: "caller-owned-untyped" } },
    { id: "seed-c3", x: 0.82, y: 0.72, userData: { group: "c", ordinal: 3, meaning: "caller-owned-untyped" } },
  ];
}

function validateParticleSet(particleSet) {
  object(particleSet, "flow-advected particle set");
  if (particleSet.schema !== "axm.flow-advected-particle-set/v0.1") {
    throw new Error(`unexpected flow-advected particle-set schema: ${String(particleSet.schema)}`);
  }
  if (particleSet.derived !== true || particleSet.rebuildable !== true) {
    throw new Error("flow-advected particle set must remain explicitly derived and rebuildable");
  }
  for (const key of ["advectionSourceHash", "particleSourceHash", "flowSourceHash", "scalarSourceHash", "particleSetHash"]) {
    if (typeof particleSet[key] !== "string" || !particleSet[key]) throw new Error(`flow-advected particle set requires ${key}`);
  }
  if (!Array.isArray(particleSet.particles) || particleSet.particles.length < 1 || particleSet.particles.length > MAX_PARTICLES) {
    throw new Error(`flow-advected particle set requires 1..${MAX_PARTICLES} particles for this observation adapter`);
  }
  if (particleSet.particleCount !== particleSet.particles.length) throw new Error("particleCount drifted from particle array length");
  if (!Array.isArray(particleSet.trajectories) || particleSet.trajectories.length !== particleSet.particles.length) {
    throw new Error("particle trajectories must align one-to-one with particles");
  }
  const ids = new Set();
  for (const [index, particle] of particleSet.particles.entries()) {
    object(particle, `flow-advected particle[${index}]`);
    const id = String(particle.id ?? "").trim();
    if (!id || ids.has(id)) throw new Error(`flow-advected particle id must be non-empty and unique: ${id}`);
    ids.add(id);
    normalized(particle.x, `flow-advected particle ${id}.x`);
    normalized(particle.y, `flow-advected particle ${id}.y`);
    const trajectory = particleSet.trajectories[index];
    if (!trajectory || trajectory.id !== id || !Array.isArray(trajectory.points) || trajectory.points.length < 2) {
      throw new Error(`flow-advected trajectory must align with particle ${id}`);
    }
    for (const [pointIndex, point] of trajectory.points.entries()) {
      normalized(point.x, `flow-advected trajectory ${id}:${pointIndex}.x`);
      normalized(point.y, `flow-advected trajectory ${id}:${pointIndex}.y`);
    }
  }
  if (particleSet.sampleCount !== particleSet.trajectories.reduce((sum, trajectory) => sum + trajectory.points.length, 0)) {
    throw new Error("particle sampleCount drifted from retained trajectories");
  }
  if (finite(particleSet.maxStepDistance, "particle maxStepDistance") < 0) throw new Error("particle maxStepDistance must be non-negative");
  if (!Number.isInteger(particleSet.movedParticleCount) || particleSet.movedParticleCount < 0 || particleSet.movedParticleCount > particleSet.particleCount) {
    throw new Error("particle movedParticleCount is outside retained cardinality");
  }
  return { particleCount: particleSet.particleCount, sampleCount: particleSet.sampleCount };
}

function scenePoint(particle) {
  return {
    x: -0.8 + normalized(particle.x, "particle x") * 1.6,
    y: -0.8 + normalized(particle.y, "particle y") * 1.6,
  };
}

export function flowAdvectedParticleSetToAxmScene(particleSet) {
  const shape = validateParticleSet(particleSet);
  const triangles = [];
  for (const particle of particleSet.particles) {
    const center = scenePoint(particle);
    const left = center.x - HALF_SIZE;
    const right = center.x + HALF_SIZE;
    const bottom = center.y - HALF_SIZE;
    const top = center.y + HALF_SIZE;
    triangles.push(
      { vertices: [[left, bottom, 0], [right, bottom, 0], [right, top, 0]], albedo: [...FIXED_ALBEDO] },
      { vertices: [[left, bottom, 0], [right, top, 0], [left, top, 0]], albedo: [...FIXED_ALBEDO] },
    );
  }

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== shape.particleCount * 2) throw new Error("particle-flow scene triangle count changed during serialization");
  if (reparsed.triangles.some((triangle) => JSON.stringify(triangle.albedo) !== JSON.stringify(FIXED_ALBEDO))) {
    throw new Error("particle-flow scene constant-albedo boundary drifted during serialization");
  }

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-particle-flow-to-axm-scene/v1",
      source_particle_set_schema: particleSet.schema,
      source_particle_set_hash: particleSet.particleSetHash,
      source_particle_hash: particleSet.particleSourceHash,
      source_flow_hash: particleSet.flowSourceHash,
      source_scalar_hash: particleSet.scalarSourceHash,
      particle_count: shape.particleCount,
      retained_trajectory_sample_count: shape.sampleCount,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: reparsed.triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_final_derived_particle_positions: true,
      trajectories_remain_evidence_only: true,
      albedo_is_constant_observation_style: true,
      consumer_semantics_preserved: false,
      adapter_policy: "each derived final normalized particle position becomes one fixed-size two-triangle marker; retained trajectories are not promoted into geometry and constant RGB albedo is observation styling only",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function verifyParticleAuthority(source, candidate, { exactCoordinates = false } = {}) {
  if (source.length !== candidate.length) throw new Error("flow-advected particle count changed");
  let movedParticleCount = 0;
  source.forEach((sourceParticle, index) => {
    const candidateParticle = candidate[index];
    if (sourceParticle.id !== candidateParticle.id) throw new Error(`flow-advected particle ordering/identity changed at ${index}`);
    if (JSON.stringify(withoutCoordinates(sourceParticle)) !== JSON.stringify(withoutCoordinates(candidateParticle))) {
      throw new Error(`flow-advected particle metadata changed for ${sourceParticle.id}`);
    }
    const sameCoordinates = sourceParticle.x === candidateParticle.x && sourceParticle.y === candidateParticle.y;
    if (exactCoordinates && !sameCoordinates) throw new Error(`zero-step-size advection changed ${sourceParticle.id}`);
    if (!sameCoordinates) movedParticleCount += 1;
  });
  return { movedParticleCount };
}

function verifyTrajectoryStarts(source, trajectories) {
  source.forEach((particle, index) => {
    const trajectory = trajectories[index];
    if (!trajectory || trajectory.id !== particle.id) throw new Error(`trajectory identity drifted for ${particle.id}`);
    const first = trajectory.points[0];
    if (first.x !== particle.x || first.y !== particle.y) throw new Error(`trajectory start drifted from canonical seed ${particle.id}`);
  });
}

export async function observeVisualEffectParticleFlowAdvection(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    flow: resolve(rootPath, "hand-lab/src/field-flow-operators.mjs"),
    particleFlow: resolve(rootPath, "hand-lab/src/particle-flow-advection.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const modules = {};
  for (const [name, path] of Object.entries(paths)) modules[name] = await import(`${pathToFileURL(path).href}?sha=${sources[name].sha256}`);

  const runtime = modules.runtime;
  const particleFlow = modules.particleFlow;
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(particleFlow.PARTICLE_FLOW_ADVECTION_HANDS) || !particleFlow.PARTICLE_FLOW_ADVECTION_GRAPH || typeof particleFlow.makeParticleFlowAdvectionState !== "function") {
    throw new Error("VFX donor particle-flow advection graph is unavailable");
  }
  if (particleFlow.PARTICLE_FLOW_ADVECTION_GRAPH.id !== "fx.particle.flow-advect2d" || particleFlow.PARTICLE_FLOW_ADVECTION_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX particle-flow graph identity");
  }
  const expectedHands = ["fx.particle.flow-advection-source-normalize", "fx.particle.flow-advection-build"];
  if (JSON.stringify(particleFlow.PARTICLE_FLOW_ADVECTION_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX particle-flow Hand boundary");
  }

  const callerParticles = sourceParticles();
  const callerParticleBytes = stableBytes(callerParticles);
  const shared = {
    id: "creative-render-flow-advected-particles",
    steps: 12,
    field: { id: "creative-render-particle-flow-field", seed: 7013, frequency: 4.25, octaves: 5, lacunarity: 2, gain: 0.5, offset: [0.17, -0.11] },
    flow: { id: "creative-render-particle-flow", mode: "tangent", sampleStep: 0.015625, strength: 1.15 },
  };
  const activeStepSize = finite(options.activeStepSize ?? 0.035, "active particle-flow step size");
  if (activeStepSize <= 0 || activeStepSize > 0.25) throw new Error("active particle-flow step size must be within (0, 0.25]");

  const execute = (stepSize, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(particleFlow.PARTICLE_FLOW_ADVECTION_HANDS),
    graph: particleFlow.PARTICLE_FLOW_ADVECTION_GRAPH,
    initialState: particleFlow.makeParticleFlowAdvectionState(callerParticles, { ...shared, stepSize }),
    context: { callerKind },
  });

  const zeroHuman = execute(0, "human");
  const zeroMachine = execute(0, "machine");
  const activeHuman = execute(activeStepSize, "human");
  const activeMachine = execute(activeStepSize, "machine");
  if (zeroHuman.finalStateHash !== zeroMachine.finalStateHash || activeHuman.finalStateHash !== activeMachine.finalStateHash) {
    throw new Error("VFX particle-flow caller-neutral repeat verification failed");
  }

  const zeroState = object(zeroHuman.finalState, "zero particle-flow final state");
  const activeState = object(activeHuman.finalState, "active particle-flow final state");
  const sourceHash = runtime.hashValue(callerParticles);
  for (const state of [zeroState, activeState]) {
    if (runtime.hashValue(state.particles) !== sourceHash || state.particleSourceHash !== sourceHash) throw new Error("VFX particle-flow retained canonical particle identity drifted");
    if (runtime.hashValue(state.fieldSource) !== state.fieldSourceHash) throw new Error("VFX particle-flow scalar source hash drifted");
    if (runtime.hashValue(state.flowSource) !== state.flowSourceHash) throw new Error("VFX particle-flow vector source hash drifted");
    if (runtime.hashValue(state.particleFlowSource) !== state.particleFlowSourceHash) throw new Error("VFX particle-flow advection source hash drifted");
  }
  if (zeroState.fieldSourceHash !== activeState.fieldSourceHash || zeroState.flowSourceHash !== activeState.flowSourceHash || zeroState.particleSourceHash !== activeState.particleSourceHash) {
    throw new Error("VFX particle-flow retained source identities changed across step-size challenge");
  }
  if (zeroState.particleFlowSourceHash === activeState.particleFlowSourceHash) throw new Error("particle-flow step-size challenge did not change advection-source identity");

  const zeroSet = object(zeroState.flowAdvectedParticleSets?.[shared.id], "zero flow-advected particle set");
  const activeSet = object(activeState.flowAdvectedParticleSets?.[shared.id], "active flow-advected particle set");
  const zeroShape = validateParticleSet(zeroSet);
  const activeShape = validateParticleSet(activeSet);
  if (zeroShape.particleCount !== callerParticles.length || activeShape.particleCount !== callerParticles.length) throw new Error("bounded particle fixture cardinality drifted");
  if (zeroSet.particleSourceHash !== sourceHash || activeSet.particleSourceHash !== sourceHash) throw new Error("derived particle-set lineage lost canonical particle source");
  if (zeroSet.flowSourceHash !== activeSet.flowSourceHash || zeroSet.scalarSourceHash !== activeSet.scalarSourceHash) throw new Error("derived particle-set retained source lineage changed across challenge");

  const zeroAuthority = verifyParticleAuthority(callerParticles, zeroSet.particles, { exactCoordinates: true });
  const activeAuthority = verifyParticleAuthority(callerParticles, activeSet.particles);
  verifyTrajectoryStarts(callerParticles, zeroSet.trajectories);
  verifyTrajectoryStarts(callerParticles, activeSet.trajectories);
  if (zeroAuthority.movedParticleCount !== 0 || zeroSet.movedParticleCount !== 0 || zeroSet.maxStepDistance !== 0 || zeroSet.clampedStepCount !== 0) {
    throw new Error("zero-step-size particle flow did not remain an exact derived no-op");
  }
  if (!(activeAuthority.movedParticleCount > 0) || activeSet.movedParticleCount !== activeAuthority.movedParticleCount || !(activeSet.maxStepDistance > 0)) {
    throw new Error("active particle flow did not move bounded derived particles");
  }

  const zeroScene = flowAdvectedParticleSetToAxmScene(zeroSet);
  const activeScene = flowAdvectedParticleSetToAxmScene(activeSet);
  if (zeroScene.observation.output_triangle_count !== activeScene.observation.output_triangle_count) throw new Error("particle-flow adapter topology changed across challenge");
  const zeroStateBytes = stableBytes(zeroState);
  const activeStateBytes = stableBytes(activeState);

  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      revision: vfxRevision,
      graph_id: particleFlow.PARTICLE_FLOW_ADVECTION_GRAPH.id,
      graph_version: particleFlow.PARTICLE_FLOW_ADVECTION_GRAPH.version,
      hand_ids: expectedHands,
      source_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
    },
    caller_authority: {
      source_particles_mutated: false,
      particle_metadata_preserved: true,
      consumer_meaning_assigned: false,
      canonical_particles_remain_authoritative: true,
    },
    shared_retained_sources: {
      particle_source_hash: sourceHash,
      scalar_source_hash: zeroState.fieldSourceHash,
      flow_source_hash: zeroState.flowSourceHash,
    },
    zero_step_size: {
      step_size: 0,
      steps: shared.steps,
      caller_neutral_repeat_verification: "PASS",
      exact_derived_noop_verified: true,
      advection_source_hash: zeroState.particleFlowSourceHash,
      particle_set_hash: zeroSet.particleSetHash,
      particle_set: { schema: zeroSet.schema, derived: zeroSet.derived, rebuildable: zeroSet.rebuildable, particle_count: zeroSet.particleCount, sample_count: zeroSet.sampleCount },
      moved_particle_count: zeroSet.movedParticleCount,
      max_step_distance: zeroSet.maxStepDistance,
      clamped_step_count: zeroSet.clampedStepCount,
      scene_adapter: zeroScene.observation,
    },
    active_flow: {
      step_size: activeStepSize,
      steps: shared.steps,
      caller_neutral_repeat_verification: "PASS",
      advection_source_hash: activeState.particleFlowSourceHash,
      particle_set_hash: activeSet.particleSetHash,
      particle_set: { schema: activeSet.schema, derived: activeSet.derived, rebuildable: activeSet.rebuildable, particle_count: activeSet.particleCount, sample_count: activeSet.sampleCount },
      moved_particle_count: activeSet.movedParticleCount,
      max_step_distance: activeSet.maxStepDistance,
      clamped_step_count: activeSet.clampedStepCount,
      scene_adapter: activeScene.observation,
    },
    outputs: {
      source_particles: { sha256: sha256(callerParticleBytes), bytes: callerParticleBytes.length },
      zero_state: { sha256: sha256(zeroStateBytes), bytes: zeroStateBytes.length },
      active_state: { sha256: sha256(activeStateBytes), bytes: activeStateBytes.length },
      zero_scene: { sha256: sha256(zeroScene.bytes), bytes: zeroScene.bytes.length },
      active_scene: { sha256: sha256(activeScene.bytes), bytes: activeScene.bytes.length },
    },
    authority: {
      caller_particles: "CALLER_CANONICAL_PARTICLE_SOURCE",
      vfx_sources: "RETAINED_VFX_SCALAR_VECTOR_AND_ADVECTION_SOURCES",
      particle_sets: "DERIVED_REBUILDABLE_VFX_WORKING_SETS",
      scenes: "DERIVED_REPLACEABLE_VISUALIZATIONS",
      pixels: "DERIVED_RENDER_FABRIC_OUTPUT",
    },
    truth_boundary: {
      proves: "the current VFX renderer-neutral particle-flow graph preserves caller-owned particle identity and metadata plus retained scalar/vector source identity across an explicit zero-to-active step-size choice, keeps zero step size as an exact derived no-op, records bounded deterministic trajectories and final positions in a derived/rebuildable particle set, and exposes those final positions through one constant-style replaceable AXM_SCENE observation adapter",
      does_not_prove: "fluid simulation, physical transport, collisions, lifetime/emission policy, trajectory-as-renderer geometry, particle visual hierarchy, apparent-motion quality, gameplay/world semantics, real-time/device performance, GPU/browser parity or cross-machine bitwise determinism",
    },
  };

  return {
    sourceParticlesBytes: callerParticleBytes,
    zeroStateBytes,
    activeStateBytes,
    zeroSceneBytes: zeroScene.bytes,
    activeSceneBytes: activeScene.bytes,
    receipt,
  };
}
