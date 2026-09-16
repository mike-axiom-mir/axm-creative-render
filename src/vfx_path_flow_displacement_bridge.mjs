import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PATH_FLOW_DISPLACEMENT_RECEIPT";
const VERSION = 1;
const MAX_PATHS = 256;
const MAX_POINTS = 4_096;
const MAX_SEGMENTS = 4_096;
const FIXED_ALBEDO = [72, 190, 220];

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

function withoutCoordinates(point) {
  const copy = structuredClone(point);
  delete copy.x;
  delete copy.y;
  return copy;
}

function withoutPoints(path) {
  const copy = structuredClone(path);
  delete copy.points;
  return copy;
}

function sourcePaths() {
  return [
    {
      id: "caller-path-a",
      kind: "neutral-path",
      userData: { lane: "a", meaning: "caller-owned-untyped" },
      points: [
        { x: 0.10, y: 0.20, userData: { index: 0 } },
        { x: 0.30, y: 0.34, userData: { index: 1 } },
        { x: 0.50, y: 0.43, userData: { index: 2 } },
        { x: 0.70, y: 0.56, userData: { index: 3 } },
        { x: 0.90, y: 0.70, userData: { index: 4 } },
      ],
    },
    {
      id: "caller-path-b",
      kind: "neutral-path",
      userData: { lane: "b", meaning: "caller-owned-untyped" },
      points: [
        { x: 0.12, y: 0.79, userData: { index: 0 } },
        { x: 0.32, y: 0.71, userData: { index: 1 } },
        { x: 0.52, y: 0.62, userData: { index: 2 } },
        { x: 0.72, y: 0.50, userData: { index: 3 } },
        { x: 0.90, y: 0.36, userData: { index: 4 } },
      ],
    },
  ];
}

function validatePathSet(pathSet) {
  object(pathSet, "flow-guided path set");
  if (pathSet.schema !== "axm.flow-guided-path-set/v0.1") throw new Error(`unexpected flow-guided path-set schema: ${String(pathSet.schema)}`);
  if (pathSet.derived !== true || pathSet.rebuildable !== true) throw new Error("flow-guided path set must remain explicitly derived and rebuildable");
  if (!Array.isArray(pathSet.paths) || pathSet.paths.length < 1 || pathSet.paths.length > MAX_PATHS) {
    throw new Error(`flow-guided path set requires 1..${MAX_PATHS} paths`);
  }
  if (pathSet.pathCount !== pathSet.paths.length) throw new Error("flow-guided path-set pathCount drifted from paths length");
  for (const key of ["displacementSourceHash", "pathSourceHash", "flowSourceHash", "scalarSourceHash", "pathSetHash"]) {
    if (typeof pathSet[key] !== "string" || !pathSet[key]) throw new Error(`flow-guided path set requires ${key}`);
  }
  const maxDisplacement = finite(pathSet.maxDisplacement, "flow-guided maxDisplacement");
  if (maxDisplacement < 0) throw new Error("flow-guided maxDisplacement must be non-negative");

  let pointCount = 0;
  let segmentCount = 0;
  const ids = new Set();
  for (const [pathIndex, path] of pathSet.paths.entries()) {
    object(path, `flow-guided path[${pathIndex}]`);
    const id = String(path.id ?? "").trim();
    if (!id || ids.has(id)) throw new Error(`flow-guided path id must be non-empty and unique: ${id}`);
    ids.add(id);
    if (!Array.isArray(path.points) || path.points.length < 2) throw new Error(`flow-guided path ${id} requires at least two points`);
    pointCount += path.points.length;
    segmentCount += path.points.length - 1;
    for (const [pointIndex, point] of path.points.entries()) {
      object(point, `flow-guided path ${id} point ${pointIndex}`);
      normalized(point.x, `flow-guided path ${id} point ${pointIndex}.x`);
      normalized(point.y, `flow-guided path ${id} point ${pointIndex}.y`);
    }
  }
  if (pointCount !== pathSet.pointCount) throw new Error("flow-guided path-set pointCount drifted from path points");
  if (pointCount > MAX_POINTS) throw new Error(`flow-guided path set exceeds ${MAX_POINTS}-point adapter ceiling`);
  if (segmentCount > MAX_SEGMENTS) throw new Error(`flow-guided path set exceeds ${MAX_SEGMENTS}-segment adapter ceiling`);
  return { pathCount: pathSet.paths.length, pointCount, segmentCount, maxDisplacement };
}

function scenePoint(point) {
  return {
    x: -0.8 + normalized(point.x, "path point x") * 1.6,
    y: -0.8 + normalized(point.y, "path point y") * 1.6,
  };
}

export function flowGuidedPathSetToAxmScene(pathSet) {
  const shape = validatePathSet(pathSet);
  const triangles = [];
  const halfWidth = 0.018;
  for (const path of pathSet.paths) {
    for (let index = 0; index < path.points.length - 1; index += 1) {
      const a = scenePoint(path.points[index]);
      const b = scenePoint(path.points[index + 1]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (!(length > 1e-9)) throw new Error(`flow-guided path ${path.id} contains a degenerate segment at ${index}`);
      const nx = (-dy / length) * halfWidth;
      const ny = (dx / length) * halfWidth;
      const aLeft = [a.x + nx, a.y + ny, 0];
      const aRight = [a.x - nx, a.y - ny, 0];
      const bLeft = [b.x + nx, b.y + ny, 0];
      const bRight = [b.x - nx, b.y - ny, 0];
      triangles.push(
        { vertices: [aLeft, aRight, bRight], albedo: [...FIXED_ALBEDO] },
        { vertices: [aLeft, bRight, bLeft], albedo: [...FIXED_ALBEDO] },
      );
    }
  }

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  const reparsed = parseScene(bytes.toString("utf8"));
  if (reparsed.triangles.length !== shape.segmentCount * 2) throw new Error("path-flow scene triangle count changed during serialization");
  if (reparsed.triangles.some((triangle) => JSON.stringify(triangle.albedo) !== JSON.stringify(FIXED_ALBEDO))) {
    throw new Error("path-flow scene constant-albedo boundary drifted during serialization");
  }

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-path-flow-to-axm-scene/v1",
      source_path_set_schema: pathSet.schema,
      source_path_set_hash: pathSet.pathSetHash,
      source_path_hash: pathSet.pathSourceHash,
      source_flow_hash: pathSet.flowSourceHash,
      source_scalar_hash: pathSet.scalarSourceHash,
      path_count: shape.pathCount,
      point_count: shape.pointCount,
      segment_count: shape.segmentCount,
      max_displacement: shape.maxDisplacement,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: reparsed.triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_derived_path_coordinates: true,
      albedo_is_constant_observation_style: true,
      consumer_semantics_preserved: false,
      adapter_policy: "each consecutive derived 2D path-point pair becomes one fixed-width two-triangle strip segment; coordinates alone carry the derived path displacement and a constant RGB albedo is observation styling only",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function verifyStructure(source, candidate, { exactCoordinates = false, pinnedEndpoints = false } = {}) {
  if (source.length !== candidate.length) throw new Error("flow-guided path count changed");
  let changedInteriorPoints = 0;
  source.forEach((sourcePath, pathIndex) => {
    const candidatePath = candidate[pathIndex];
    if (JSON.stringify(withoutPoints(sourcePath)) !== JSON.stringify(withoutPoints(candidatePath))) {
      throw new Error(`flow-guided path metadata changed for ${sourcePath.id}`);
    }
    if (!Array.isArray(candidatePath.points) || sourcePath.points.length !== candidatePath.points.length) {
      throw new Error(`flow-guided point count changed for ${sourcePath.id}`);
    }
    sourcePath.points.forEach((sourcePoint, pointIndex) => {
      const candidatePoint = candidatePath.points[pointIndex];
      if (JSON.stringify(withoutCoordinates(sourcePoint)) !== JSON.stringify(withoutCoordinates(candidatePoint))) {
        throw new Error(`flow-guided point metadata changed for ${sourcePath.id}:${pointIndex}`);
      }
      const sameCoordinates = sourcePoint.x === candidatePoint.x && sourcePoint.y === candidatePoint.y;
      if (exactCoordinates && !sameCoordinates) throw new Error(`zero-amplitude path-flow changed ${sourcePath.id}:${pointIndex}`);
      if (pinnedEndpoints && (pointIndex === 0 || pointIndex === sourcePath.points.length - 1) && !sameCoordinates) {
        throw new Error(`endpoint envelope failed to pin ${sourcePath.id}:${pointIndex}`);
      }
      if (!sameCoordinates && pointIndex > 0 && pointIndex < sourcePath.points.length - 1) changedInteriorPoints += 1;
    });
  });
  return { changedInteriorPoints };
}

export async function observeVisualEffectPathFlowDisplacement(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    flow: resolve(rootPath, "hand-lab/src/field-flow-operators.mjs"),
    pathFlow: resolve(rootPath, "hand-lab/src/path-flow-displacement.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const modules = {};
  for (const [name, path] of Object.entries(paths)) modules[name] = await import(`${pathToFileURL(path).href}?sha=${sources[name].sha256}`);

  const runtime = modules.runtime;
  const pathFlow = modules.pathFlow;
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(pathFlow.PATH_FLOW_DISPLACEMENT_HANDS) || !pathFlow.PATH_FLOW_DISPLACEMENT_GRAPH || typeof pathFlow.makePathFlowDisplacementState !== "function") {
    throw new Error("VFX donor path-flow displacement graph is unavailable");
  }
  if (pathFlow.PATH_FLOW_DISPLACEMENT_GRAPH.id !== "fx.path.flow-displace2d" || pathFlow.PATH_FLOW_DISPLACEMENT_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX path-flow graph identity");
  }
  const expectedHands = ["fx.path.flow-displacement-source-normalize", "fx.path.flow-displacement-build"];
  if (JSON.stringify(pathFlow.PATH_FLOW_DISPLACEMENT_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX path-flow Hand boundary");
  }

  const callerPaths = sourcePaths();
  const shared = {
    id: "creative-render-flow-guided-paths",
    endpointEnvelope: true,
    field: { id: "creative-render-path-flow-field", seed: 5011, frequency: 4.5, octaves: 5, lacunarity: 2, gain: 0.5, offset: [0.15, -0.2] },
    flow: { id: "creative-render-path-flow", mode: "tangent", sampleStep: 0.015625, strength: 1.25 },
  };
  const activeAmplitude = finite(options.activeAmplitude ?? 0.18, "active path-flow amplitude");
  if (activeAmplitude <= 0 || activeAmplitude > 0.5) throw new Error("active path-flow amplitude must be within (0, 0.5]");

  const execute = (amplitude, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(pathFlow.PATH_FLOW_DISPLACEMENT_HANDS),
    graph: pathFlow.PATH_FLOW_DISPLACEMENT_GRAPH,
    initialState: pathFlow.makePathFlowDisplacementState(callerPaths, { ...shared, amplitude }),
    context: { callerKind },
  });
  const zeroHuman = execute(0, "human");
  const zeroMachine = execute(0, "machine");
  const activeHuman = execute(activeAmplitude, "human");
  const activeMachine = execute(activeAmplitude, "machine");
  if (zeroHuman.finalStateHash !== zeroMachine.finalStateHash || activeHuman.finalStateHash !== activeMachine.finalStateHash) {
    throw new Error("VFX path-flow caller-neutral repeat verification failed");
  }

  const zeroState = object(zeroHuman.finalState, "zero path-flow final state");
  const activeState = object(activeHuman.finalState, "active path-flow final state");
  const sourceHash = runtime.hashValue(callerPaths);
  for (const state of [zeroState, activeState]) {
    if (runtime.hashValue(state.paths) !== sourceHash || state.pathSourceHash !== sourceHash) throw new Error("VFX path-flow retained caller path identity drifted");
    if (runtime.hashValue(state.fieldSource) !== state.fieldSourceHash) throw new Error("VFX path-flow scalar source hash drifted");
    if (runtime.hashValue(state.flowSource) !== state.flowSourceHash) throw new Error("VFX path-flow vector source hash drifted");
    if (runtime.hashValue(state.pathFlowSource) !== state.pathFlowSourceHash) throw new Error("VFX path-flow displacement source hash drifted");
  }
  if (zeroState.fieldSourceHash !== activeState.fieldSourceHash || zeroState.flowSourceHash !== activeState.flowSourceHash || zeroState.pathSourceHash !== activeState.pathSourceHash) {
    throw new Error("VFX path-flow retained source identities changed across amplitude challenge");
  }
  if (zeroState.pathFlowSourceHash === activeState.pathFlowSourceHash) throw new Error("VFX path-flow amplitude challenge did not change displacement-source identity");

  const zeroSet = object(zeroState.flowGuidedPathSets?.[shared.id], "zero flow-guided path set");
  const activeSet = object(activeState.flowGuidedPathSets?.[shared.id], "active flow-guided path set");
  validatePathSet(zeroSet);
  validatePathSet(activeSet);
  for (const [state, set] of [[zeroState, zeroSet], [activeState, activeSet]]) {
    if (set.pathSourceHash !== state.pathSourceHash || set.flowSourceHash !== state.flowSourceHash || set.scalarSourceHash !== state.fieldSourceHash || set.displacementSourceHash !== state.pathFlowSourceHash) {
      throw new Error("VFX path-flow derived set lost donor lineage");
    }
  }

  const zeroStructure = verifyStructure(callerPaths, zeroSet.paths, { exactCoordinates: true, pinnedEndpoints: true });
  const activeStructure = verifyStructure(callerPaths, activeSet.paths, { pinnedEndpoints: true });
  if (zeroSet.maxDisplacement !== 0) throw new Error("VFX path-flow zero amplitude did not remain exact derived no-op");
  if (!(activeSet.maxDisplacement > 0) || activeStructure.changedInteriorPoints < 1) throw new Error("VFX path-flow active amplitude did not displace any interior path point");
  if (zeroSet.pathSetHash === activeSet.pathSetHash) throw new Error("VFX path-flow zero/active derived path-set identities unexpectedly match");

  const zeroScene = flowGuidedPathSetToAxmScene(zeroSet);
  const activeScene = flowGuidedPathSetToAxmScene(activeSet);
  if (sha256(zeroScene.bytes) === sha256(activeScene.bytes)) throw new Error("VFX path-flow active geometry did not produce distinct derived scene bytes");

  const sourcePathsBytes = stableBytes(callerPaths);
  const zeroStateBytes = stableBytes(zeroState);
  const activeStateBytes = stableBytes(activeState);
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graph_id: pathFlow.PATH_FLOW_DISPLACEMENT_GRAPH.id,
      graph_version: pathFlow.PATH_FLOW_DISPLACEMENT_GRAPH.version,
      hand_ids: expectedHands,
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
    },
    caller_authority: {
      source_paths_sha256: sha256(sourcePathsBytes),
      source_path_hash: sourceHash,
      source_paths_mutated: false,
      path_metadata_preserved: true,
      point_metadata_preserved: true,
      consumer_meaning_assigned: false,
    },
    shared_retained_sources: {
      path_source_hash: zeroState.pathSourceHash,
      scalar_source_hash: zeroState.fieldSourceHash,
      flow_source_hash: zeroState.flowSourceHash,
    },
    zero_amplitude: {
      amplitude: zeroState.pathFlowSource.amplitude,
      displacement_source_hash: zeroState.pathFlowSourceHash,
      path_set_hash: zeroSet.pathSetHash,
      max_displacement: zeroSet.maxDisplacement,
      exact_derived_noop_verified: true,
      endpoint_preservation_verified: true,
      changed_interior_points: zeroStructure.changedInteriorPoints,
      caller_neutral_repeat_verification: "PASS",
      path_set: { schema: zeroSet.schema, path_count: zeroSet.pathCount, point_count: zeroSet.pointCount, derived: zeroSet.derived, rebuildable: zeroSet.rebuildable },
      scene_adapter: zeroScene.observation,
    },
    active_flow: {
      amplitude: activeState.pathFlowSource.amplitude,
      displacement_source_hash: activeState.pathFlowSourceHash,
      path_set_hash: activeSet.pathSetHash,
      max_displacement: activeSet.maxDisplacement,
      endpoint_preservation_verified: true,
      changed_interior_points: activeStructure.changedInteriorPoints,
      caller_neutral_repeat_verification: "PASS",
      path_set: { schema: activeSet.schema, path_count: activeSet.pathCount, point_count: activeSet.pointCount, derived: activeSet.derived, rebuildable: activeSet.rebuildable },
      scene_adapter: activeScene.observation,
    },
    outputs: {
      source_paths: { sha256: sha256(sourcePathsBytes), authority: "CALLER_CANONICAL_PATH_SOURCE" },
      zero_state: { sha256: sha256(zeroStateBytes), authority: "DERIVED_DONOR_EXECUTION_STATE" },
      active_state: { sha256: sha256(activeStateBytes), authority: "DERIVED_DONOR_EXECUTION_STATE" },
      zero_scene: { sha256: sha256(zeroScene.bytes), authority: "DERIVED_REPLACEABLE_VISUALIZATION" },
      active_scene: { sha256: sha256(activeScene.bytes), authority: "DERIVED_REPLACEABLE_VISUALIZATION" },
    },
    truth_boundary: {
      proves: "the pinned current VFX renderer-neutral path-flow graph preserves caller path topology/metadata and retained scalar/vector source identities across an explicit zero-to-active amplitude choice, keeps zero amplitude as an exact derived no-op, pins endpoints when requested, creates a distinct bounded derived path set for active flow, and exposes that derived coordinate change through one constant-style AXM_SCENE geometry adapter",
      does_not_prove: "electrical, crack, root, vein, river, trail, particle, brush, game, UI or world semantics; physical flow accuracy; animation or temporal continuity; visual or aesthetic quality; target-device performance; GPU/browser equivalence; or cross-machine bitwise determinism",
      canonical_authority: "caller-owned retained path topology plus VFX scalar/vector/displacement source contracts",
      derived_replaceable: ["flow-guided path sets", "donor execution states", "AXM_SCENE 1 visualizations", "render requests", "render receipts", "pixels"],
    },
  };

  return {
    sourcePathsBytes,
    zeroStateBytes,
    activeStateBytes,
    zeroSceneBytes: zeroScene.bytes,
    activeSceneBytes: activeScene.bytes,
    receipt,
  };
}
