import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseScene, serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PATH_BREAK_FRAGMENTATION_RECEIPT";
const VERSION = 1;
const MAX_PATHS = 256;
const MAX_POINTS = 65_536;
const MAX_SEGMENTS = 65_536;
const FIXED_ALBEDO = [232, 170, 74];

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

function validateBrokenPathSet(pathSet) {
  object(pathSet, "broken path set");
  if (pathSet.schema !== "axm.broken-path-set/v0.1") throw new Error(`unexpected broken path-set schema: ${String(pathSet.schema)}`);
  if (pathSet.derived !== true || pathSet.rebuildable !== true) throw new Error("broken path set must remain explicitly derived and rebuildable");
  for (const key of ["breakSourceHash", "pathSourceHash", "pathSetHash"]) {
    if (typeof pathSet[key] !== "string" || !pathSet[key]) throw new Error(`broken path set requires ${key}`);
  }
  if (!Array.isArray(pathSet.paths) || pathSet.paths.length < 1 || pathSet.paths.length > MAX_PATHS) {
    throw new Error(`broken path set requires 1..${MAX_PATHS} paths/fragments`);
  }
  if (!Number.isInteger(pathSet.fragmentCount) || pathSet.fragmentCount !== pathSet.paths.length) {
    throw new Error("broken path-set fragmentCount drifted from paths length");
  }
  if (!Number.isInteger(pathSet.sourcePathCount) || pathSet.sourcePathCount < 1 || pathSet.sourcePathCount > pathSet.fragmentCount) {
    throw new Error("broken path-set sourcePathCount is invalid");
  }
  if (!Number.isInteger(pathSet.sourcePointCount) || pathSet.sourcePointCount < pathSet.sourcePathCount) {
    throw new Error("broken path-set sourcePointCount is invalid");
  }
  const removedNormalizedLengthPerPath = finite(pathSet.removedNormalizedLengthPerPath, "removed normalized length per path");
  if (removedNormalizedLengthPerPath < 0 || removedNormalizedLengthPerPath > 1) {
    throw new Error("removed normalized length per path must be within 0..1");
  }

  let pointCount = 0;
  let segmentCount = 0;
  const ids = new Set();
  for (const [pathIndex, path] of pathSet.paths.entries()) {
    object(path, `broken path[${pathIndex}]`);
    const id = String(path.id ?? "").trim();
    if (!id || ids.has(id)) throw new Error(`broken path id must be non-empty and unique: ${id}`);
    ids.add(id);
    if (!Array.isArray(path.points) || path.points.length < 2) throw new Error(`broken path ${id} requires at least two points`);
    pointCount += path.points.length;
    segmentCount += path.points.length - 1;
    for (const [pointIndex, point] of path.points.entries()) {
      object(point, `broken path ${id} point ${pointIndex}`);
      normalized(point.x, `broken path ${id} point ${pointIndex}.x`);
      normalized(point.y, `broken path ${id} point ${pointIndex}.y`);
    }
  }
  if (pointCount !== pathSet.pointCount) throw new Error("broken path-set pointCount drifted from fragment points");
  if (pointCount > MAX_POINTS) throw new Error(`broken path set exceeds ${MAX_POINTS}-point adapter ceiling`);
  if (segmentCount > MAX_SEGMENTS) throw new Error(`broken path set exceeds ${MAX_SEGMENTS}-segment adapter ceiling`);
  return {
    sourcePathCount: pathSet.sourcePathCount,
    sourcePointCount: pathSet.sourcePointCount,
    fragmentCount: pathSet.fragmentCount,
    pointCount,
    segmentCount,
    removedNormalizedLengthPerPath,
  };
}

function scenePoint(point) {
  return {
    x: -0.8 + normalized(point.x, "path point x") * 1.6,
    y: -0.8 + normalized(point.y, "path point y") * 1.6,
  };
}

export function brokenPathSetToAxmScene(pathSet) {
  const shape = validateBrokenPathSet(pathSet);
  const triangles = [];
  const halfWidth = 0.018;
  for (const path of pathSet.paths) {
    for (let index = 0; index < path.points.length - 1; index += 1) {
      const a = scenePoint(path.points[index]);
      const b = scenePoint(path.points[index + 1]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (!(length > 1e-9)) throw new Error(`broken path ${path.id} contains a degenerate segment at ${index}`);
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
  if (reparsed.triangles.length !== shape.segmentCount * 2) throw new Error("path-break scene triangle count changed during serialization");
  if (reparsed.triangles.some((triangle) => JSON.stringify(triangle.albedo) !== JSON.stringify(FIXED_ALBEDO))) {
    throw new Error("path-break scene constant-albedo boundary drifted during serialization");
  }

  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-path-break-to-axm-scene/v1",
      source_path_set_schema: pathSet.schema,
      source_path_set_hash: pathSet.pathSetHash,
      source_path_hash: pathSet.pathSourceHash,
      source_break_hash: pathSet.breakSourceHash,
      source_path_count: shape.sourcePathCount,
      source_point_count: shape.sourcePointCount,
      fragment_count: shape.fragmentCount,
      derived_point_count: shape.pointCount,
      segment_count: shape.segmentCount,
      removed_normalized_length_per_path: shape.removedNormalizedLengthPerPath,
      output_contract: "AXM_SCENE 1",
      output_triangle_count: reparsed.triangles.length,
      output_sha256: sha256(bytes),
      geometry_encodes_derived_fragment_topology: true,
      albedo_is_constant_observation_style: true,
      consumer_semantics_preserved: false,
      adapter_policy: "each consecutive point pair inside each donor-derived visible fragment becomes one fixed-width two-triangle strip; no geometry bridges donor-declared gaps and constant RGB albedo is observation styling only",
    },
  };
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return { bytes, sha256: sha256(bytes) };
}

function verifyZeroNoop(source, set) {
  if (JSON.stringify(set.paths) !== JSON.stringify(source)) throw new Error("zero-break derived path set is not an exact source geometry/metadata no-op");
  if (set.fragmentCount !== source.length || set.pointCount !== source.reduce((sum, path) => sum + path.points.length, 0)) {
    throw new Error("zero-break derived cardinality changed");
  }
  if (set.removedNormalizedLengthPerPath !== 0) throw new Error("zero-break derived set removed path length");
}

function verifyActiveFragments(source, set, breakCount) {
  const sourceById = new Map(source.map((path) => [path.id, path]));
  const bySource = new Map();
  for (const fragment of set.paths) {
    const sourcePath = sourceById.get(fragment.sourcePathId);
    if (!sourcePath) throw new Error(`fragment ${fragment.id} lost sourcePathId lineage`);
    if (fragment.kind !== sourcePath.kind || JSON.stringify(fragment.userData) !== JSON.stringify(sourcePath.userData)) {
      throw new Error(`fragment ${fragment.id} failed to copy retained source path metadata`);
    }
    if (!Number.isInteger(fragment.fragmentIndex) || fragment.fragmentIndex < 0 || fragment.fragmentIndex > breakCount) {
      throw new Error(`fragment ${fragment.id} has invalid fragmentIndex`);
    }
    object(fragment.normalizedArcRange, `fragment ${fragment.id} normalizedArcRange`);
    const start = normalized(fragment.normalizedArcRange.start, `fragment ${fragment.id} range start`);
    const end = normalized(fragment.normalizedArcRange.end, `fragment ${fragment.id} range end`);
    if (!(end > start)) throw new Error(`fragment ${fragment.id} has empty normalized arc range`);
    const rows = bySource.get(fragment.sourcePathId) ?? [];
    rows.push({ index: fragment.fragmentIndex, start, end });
    bySource.set(fragment.sourcePathId, rows);
  }

  let observedGaps = 0;
  for (const sourcePath of source) {
    const rows = (bySource.get(sourcePath.id) ?? []).sort((a, b) => a.index - b.index);
    if (rows.length !== breakCount + 1) throw new Error(`source path ${sourcePath.id} did not produce ${breakCount + 1} fragments`);
    if (rows[0].start !== 0 || rows.at(-1).end !== 1) throw new Error(`source path ${sourcePath.id} lost endpoint fragments`);
    for (let index = 1; index < rows.length; index += 1) {
      if (!(rows[index].start > rows[index - 1].end)) throw new Error(`source path ${sourcePath.id} did not retain a positive normalized gap`);
      observedGaps += 1;
    }
  }
  return { observedGaps };
}

export async function observeVisualEffectPathBreakFragmentation(root, options = {}) {
  const vfxRevision = revision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const paths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    pathBreak: resolve(rootPath, "hand-lab/src/path-break-fragmentation.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const modules = {};
  for (const [name, path] of Object.entries(paths)) modules[name] = await import(`${pathToFileURL(path).href}?sha=${sources[name].sha256}`);

  const runtime = modules.runtime;
  const pathBreak = modules.pathBreak;
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (!Array.isArray(pathBreak.PATH_BREAK_FRAGMENTATION_HANDS) || !pathBreak.PATH_BREAK_FRAGMENTATION_GRAPH || typeof pathBreak.makePathBreakFragmentationState !== "function") {
    throw new Error("VFX donor path-break fragmentation graph is unavailable");
  }
  if (typeof pathBreak.normalizePathBreakFragmentationHand?.execute !== "function" || typeof pathBreak.buildBrokenPathSetHand?.execute !== "function") {
    throw new Error("VFX donor path-break proof Hands are unavailable");
  }
  if (pathBreak.PATH_BREAK_FRAGMENTATION_GRAPH.id !== "fx.path.break-fragment2d" || pathBreak.PATH_BREAK_FRAGMENTATION_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX path-break graph identity");
  }
  const expectedHands = ["fx.path.break-fragment-source-normalize", "fx.path.break-fragment-build"];
  if (JSON.stringify(pathBreak.PATH_BREAK_FRAGMENTATION_HANDS.map((hand) => hand.id)) !== JSON.stringify(expectedHands)) {
    throw new Error("unexpected VFX path-break Hand boundary");
  }

  const callerPaths = sourcePaths();
  const active = {
    id: "creative-render-broken-paths",
    breakCount: 2,
    gapWidth: 0.08,
    phase: 0.5,
  };
  const zero = { ...active, breakCount: 0, gapWidth: 0 };
  const execute = (treatment, callerKind) => runtime.executeHandGraph({
    registry: runtime.createHandRegistry(pathBreak.PATH_BREAK_FRAGMENTATION_HANDS),
    graph: pathBreak.PATH_BREAK_FRAGMENTATION_GRAPH,
    initialState: pathBreak.makePathBreakFragmentationState(callerPaths, treatment),
    context: { callerKind },
  });

  const zeroHuman = execute(zero, "human");
  const zeroMachine = execute(zero, "machine");
  const activeHuman = execute(active, "human");
  const activeMachine = execute(active, "machine");
  if (zeroHuman.finalStateHash !== zeroMachine.finalStateHash || activeHuman.finalStateHash !== activeMachine.finalStateHash) {
    throw new Error("VFX path-break caller-neutral repeat verification failed");
  }

  const zeroState = object(zeroHuman.finalState, "zero path-break final state");
  const activeState = object(activeHuman.finalState, "active path-break final state");
  const sourceHash = runtime.hashValue(callerPaths);
  for (const state of [zeroState, activeState]) {
    if (runtime.hashValue(state.paths) !== sourceHash || state.pathSourceHash !== sourceHash) throw new Error("VFX path-break retained caller path identity drifted");
    if (runtime.hashValue(state.pathBreakSource) !== state.pathBreakSourceHash) throw new Error("VFX path-break source hash drifted");
  }
  if (zeroState.pathSourceHash !== activeState.pathSourceHash) throw new Error("VFX path-break retained path identity changed across break challenge");
  if (JSON.stringify(zeroState.paths) !== JSON.stringify(callerPaths) || JSON.stringify(activeState.paths) !== JSON.stringify(callerPaths)) {
    throw new Error("VFX path-break donor rewrote retained caller paths");
  }

  const zeroSet = object(zeroState.brokenPathSets?.[active.id], "zero broken path set");
  const activeSet = object(activeState.brokenPathSets?.[active.id], "active broken path set");
  validateBrokenPathSet(zeroSet);
  validateBrokenPathSet(activeSet);
  for (const [state, set] of [[zeroState, zeroSet], [activeState, activeSet]]) {
    if (set.pathSourceHash !== state.pathSourceHash || set.breakSourceHash !== state.pathBreakSourceHash) {
      throw new Error("VFX path-break derived set lost donor lineage");
    }
  }
  verifyZeroNoop(callerPaths, zeroSet);
  const activeStructure = verifyActiveFragments(callerPaths, activeSet, active.breakCount);
  if (activeSet.fragmentCount !== 6) throw new Error(`expected 6 active fragments, got ${activeSet.fragmentCount}`);
  if (activeSet.removedNormalizedLengthPerPath !== 0.16) throw new Error("active path-break removed-length evidence drifted");
  if (activeStructure.observedGaps !== 4) throw new Error("active path-break did not expose two gaps per source path");
  if (zeroSet.pathSetHash === activeSet.pathSetHash) throw new Error("zero/active path-break derived identities unexpectedly match");

  const normalized = pathBreak.normalizePathBreakFragmentationHand.execute(
    pathBreak.makePathBreakFragmentationState(callerPaths, active),
  ).state;
  const exactBounds = { maxSourcePoints: 10, maxFragments: 6, maxDerivedPoints: 18 };
  const roomyBounds = { maxSourcePoints: 4096, maxFragments: 8192, maxDerivedPoints: 16384 };
  const exactBuild = pathBreak.buildBrokenPathSetHand.execute(normalized, exactBounds);
  const roomyBuild = pathBreak.buildBrokenPathSetHand.execute(normalized, roomyBounds);
  const exactSet = object(exactBuild.state.brokenPathSets?.[active.id], "exact-budget broken path set");
  const roomySet = object(roomyBuild.state.brokenPathSets?.[active.id], "roomy-budget broken path set");
  if (exactSet.pathSetHash !== activeSet.pathSetHash || roomySet.pathSetHash !== activeSet.pathSetHash) {
    throw new Error("VFX path-break sufficient working-set budgets changed derived identity");
  }

  async function expectBudgetFailure(params, pattern) {
    let message = "";
    try {
      pathBreak.buildBrokenPathSetHand.execute(normalized, params);
    } catch (error) {
      message = String(error?.message || error);
    }
    if (!pattern.test(message)) throw new Error(`VFX path-break budget did not fail closed: ${message}`);
    return message;
  }
  const insufficientSourceError = await expectBudgetFailure(
    { ...exactBounds, maxSourcePoints: 9 },
    /pathBreak source point budget exceeded: 10 > 9/,
  );
  const insufficientFragmentError = await expectBudgetFailure(
    { ...exactBounds, maxFragments: 5 },
    /pathBreak fragment budget exceeded: 6 > 5/,
  );
  const insufficientDerivedPointError = await expectBudgetFailure(
    { ...exactBounds, maxDerivedPoints: 17 },
    /pathBreak derived point budget exceeded: 18 > 17/,
  );

  const tampered = structuredClone(normalized);
  tampered.pathBreakSource.algorithm = "forged-self-consistent-break-algorithm";
  tampered.pathBreakSourceHash = runtime.hashValue(tampered.pathBreakSource);
  let semanticTamperError = "";
  try {
    pathBreak.buildBrokenPathSetHand.execute(tampered, exactBounds);
  } catch (error) {
    semanticTamperError = String(error?.message || error);
  }
  if (!/path break algorithm mismatch/.test(semanticTamperError)) {
    throw new Error(`VFX path-break self-consistent semantic tamper was not rejected: ${semanticTamperError}`);
  }
  if (runtime.hashValue(normalized.paths) !== sourceHash || runtime.hashValue(normalized.pathBreakSource) !== normalized.pathBreakSourceHash) {
    throw new Error("VFX path-break failed challenges mutated retained source state");
  }

  const zeroScene = brokenPathSetToAxmScene(zeroSet);
  const activeScene = brokenPathSetToAxmScene(activeSet);
  if (sha256(zeroScene.bytes) === sha256(activeScene.bytes)) throw new Error("VFX path-break active topology did not produce distinct derived scene bytes");

  const sourcePathsBytes = stableBytes(callerPaths);
  const zeroStateBytes = stableBytes(zeroState);
  const activeStateBytes = stableBytes(activeState);
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    donor: {
      repository: "mike-axiom-mir/axm-visual-effect-fabric",
      revision: vfxRevision,
      graph_id: pathBreak.PATH_BREAK_FRAGMENTATION_GRAPH.id,
      graph_version: pathBreak.PATH_BREAK_FRAGMENTATION_GRAPH.version,
      hand_ids: expectedHands,
      module_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.sha256])),
    },
    caller_authority: {
      source_paths_sha256: sha256(sourcePathsBytes),
      source_path_hash: sourceHash,
      source_paths_mutated: false,
      canonical_topology_replaced: false,
      consumer_meaning_assigned: false,
    },
    zero_break: {
      break_count: zeroState.pathBreakSource.breakCount,
      gap_width: zeroState.pathBreakSource.gapWidth,
      phase: zeroState.pathBreakSource.phase,
      break_source_hash: zeroState.pathBreakSourceHash,
      path_set_hash: zeroSet.pathSetHash,
      exact_derived_noop_verified: true,
      caller_neutral_repeat_verification: "PASS",
      path_set: {
        schema: zeroSet.schema,
        source_path_count: zeroSet.sourcePathCount,
        source_point_count: zeroSet.sourcePointCount,
        fragment_count: zeroSet.fragmentCount,
        point_count: zeroSet.pointCount,
        removed_normalized_length_per_path: zeroSet.removedNormalizedLengthPerPath,
        derived: zeroSet.derived,
        rebuildable: zeroSet.rebuildable,
      },
      scene_adapter: zeroScene.observation,
    },
    active_break: {
      break_count: activeState.pathBreakSource.breakCount,
      gap_width: activeState.pathBreakSource.gapWidth,
      phase: activeState.pathBreakSource.phase,
      algorithm: activeState.pathBreakSource.algorithm,
      arc_parameterization: activeState.pathBreakSource.arcParameterization,
      placement_mode: activeState.pathBreakSource.placementMode,
      gap_mode: activeState.pathBreakSource.gapMode,
      break_source_hash: activeState.pathBreakSourceHash,
      path_set_hash: activeSet.pathSetHash,
      caller_neutral_repeat_verification: "PASS",
      positive_gap_count_verified: activeStructure.observedGaps,
      source_path_metadata_copied_to_fragments: true,
      path_set: {
        schema: activeSet.schema,
        source_path_count: activeSet.sourcePathCount,
        source_point_count: activeSet.sourcePointCount,
        fragment_count: activeSet.fragmentCount,
        point_count: activeSet.pointCount,
        removed_normalized_length_per_path: activeSet.removedNormalizedLengthPerPath,
        derived: activeSet.derived,
        rebuildable: activeSet.rebuildable,
      },
      scene_adapter: activeScene.observation,
    },
    execution_bounds: {
      exact: exactBounds,
      roomy: roomyBounds,
      sufficient_budget_identity_preserved: true,
      insufficient_source_points: 9,
      insufficient_source_error: insufficientSourceError,
      insufficient_fragments: 5,
      insufficient_fragment_error: insufficientFragmentError,
      insufficient_derived_points: 17,
      insufficient_derived_point_error: insufficientDerivedPointError,
      failed_budget_mutated_retained_source: false,
    },
    semantic_tamper_challenge: {
      changed_field: "pathBreakSource.algorithm",
      recomputed_source_hash: true,
      rejected: true,
      error: semanticTamperError,
      failed_challenge_mutated_retained_source: false,
    },
    outputs: {
      source_paths: { sha256: sha256(sourcePathsBytes), authority: "CALLER_CANONICAL_PATH_SOURCE" },
      zero_state: { sha256: sha256(zeroStateBytes), authority: "DERIVED_DONOR_EXECUTION_STATE" },
      active_state: { sha256: sha256(activeStateBytes), authority: "DERIVED_DONOR_EXECUTION_STATE" },
      zero_scene: { sha256: sha256(zeroScene.bytes), authority: "DERIVED_REPLACEABLE_VISUALIZATION" },
      active_scene: { sha256: sha256(activeScene.bytes), authority: "DERIVED_REPLACEABLE_VISUALIZATION" },
    },
    truth_boundary: {
      proves: "the pinned current VFX renderer-neutral path-break graph preserves caller-owned canonical path state, keeps zero breaks as an exact derived no-op, derives explicit normalized arc-length gaps and separate rebuildable visible fragments for an explicit break treatment, keeps sufficient source/fragment/derived-point budgets non-creative, fails closed on insufficient bounds, rejects a self-consistently re-hashed semantic-source forgery, and exposes only donor-derived fragment topology through one constant-style AXM_SCENE geometry observer",
      does_not_prove: "crack, wound, river, UI dash, trail, destruction, gameplay, product, world or material meaning; physical fracture correctness; animation behavior; visual or aesthetic quality; target-device performance; GPU/browser equivalence; or cross-machine bitwise determinism",
      canonical_authority: "caller-owned retained path topology plus the normalized VFX path-break treatment source",
      derived_replaceable: ["broken path sets", "donor execution states", "AXM_SCENE 1 visualizations", "render requests", "render receipts", "pixels"],
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
