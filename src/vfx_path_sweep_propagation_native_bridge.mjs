import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PATH_SWEEP_PROPAGATION_NATIVE_RECEIPT";
const VERSION = 1;
const HARD_MAX_TRIANGLES = (16384 - 1) * 2;

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function exactRevision(value) {
  const revision = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Visual Effect Fabric revision must be an exact lowercase 40-character SHA");
  return revision;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function boundedInteger(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer within [${min},${max}]`);
  return number;
}

function geometryHash(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
}

function weightHashPayload(set) {
  return {
    schema: set.schema,
    sweepSourceHash: set.sweepSourceHash,
    pathSourceHash: set.pathSourceHash,
    frameSetHash: set.frameSetHash,
    ribbonSetHash: set.ribbonSetHash,
    indexedStripSetHash: set.indexedStripSetHash,
    propagationSourceHash: set.propagationSourceHash,
    phase: set.phase,
    pathCount: set.pathCount,
    pointCount: set.pointCount,
    vertexCount: set.vertexCount,
    minWeight: set.minWeight,
    maxWeight: set.maxWeight,
    semantics: set.semantics,
    paths: set.paths,
    provenance: set.provenance,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
}

function point3(vertex, label) {
  return [finite(vertex?.x, `${label}.x`), finite(vertex?.y, `${label}.y`), 0];
}

export function pathSweepPropagationWeightSetToAxmScene(stripSet, weightSet, options = {}) {
  if (!stripSet || stripSet.schema !== "axm.path-sweep-indexed-strip-set/v0.1" || stripSet.derived !== true || stripSet.rebuildable !== true) {
    throw new Error("sweep propagation observer requires a derived rebuildable indexed strip set");
  }
  if (!weightSet || weightSet.schema !== "axm.path-sweep-propagation-weight-set2d/v0.1" || weightSet.derived !== true || weightSet.rebuildable !== true) {
    throw new Error("sweep propagation observer requires a derived rebuildable propagation weight set");
  }
  if (weightSet.indexedStripSetHash !== stripSet.indexedStripSetHash || weightSet.pathSourceHash !== stripSet.pathSourceHash || weightSet.sweepSourceHash !== stripSet.sweepSourceHash) {
    throw new Error("sweep propagation observer lineage mismatch");
  }
  if (weightSet.vertexCount !== stripSet.vertexCount || weightSet.pathCount !== stripSet.pathCount || weightSet.pointCount !== stripSet.pointCount) {
    throw new Error("sweep propagation observer cardinality mismatch");
  }
  const semantics = weightSet.semantics || {};
  if (semantics.attributeMeaning !== "neutral-scalar-weight" || semantics.geometryMutation !== "none" || semantics.materialAuthority !== "none" || semantics.rendererAuthority !== "none" || semantics.consumerAuthority !== "none") {
    throw new Error("sweep propagation observer neutral authority semantics drifted");
  }

  const maxTriangles = boundedInteger(options.maxTriangles ?? HARD_MAX_TRIANGLES, 1, HARD_MAX_TRIANGLES, "sweep propagation observer maxTriangles");
  if (stripSet.triangleCount > maxTriangles) throw new Error(`sweep propagation observer triangle budget exceeded: ${stripSet.triangleCount} > ${maxTriangles}`);

  const weightsByPath = new Map(weightSet.paths.map((path) => [path.id, path]));
  const triangles = [];
  for (const stripPath of stripSet.paths) {
    const weightedPath = weightsByPath.get(stripPath.id);
    if (!weightedPath || weightedPath.vertexCount !== stripPath.vertexCount || weightedPath.pointCount !== stripPath.pointCount) {
      throw new Error(`sweep propagation observer path mismatch: ${stripPath.id}`);
    }
    const weightByVertex = new Map(weightedPath.vertices.map((entry) => [entry.vertexIndex, entry]));
    for (let index = 0; index < stripPath.vertices.length; index += 1) {
      const vertex = stripPath.vertices[index];
      const weighted = weightByVertex.get(index);
      if (!weighted || weighted.pointIndex !== vertex.pointIndex || weighted.side !== vertex.side) {
        throw new Error(`sweep propagation weighted vertex mismatch: ${stripPath.id}:${index}`);
      }
      finite(weighted.normalizedDistance, `normalizedDistance ${stripPath.id}:${index}`);
      const weight = finite(weighted.weight, `weight ${stripPath.id}:${index}`);
      if (weight < 0 || weight > 1) throw new Error(`sweep propagation weight outside [0,1]: ${stripPath.id}:${index}`);
      if (index % 2 === 1) {
        const mate = weightByVertex.get(index - 1);
        if (!mate || mate.pointIndex !== weighted.pointIndex || mate.normalizedDistance !== weighted.normalizedDistance || mate.weight !== weighted.weight) {
          throw new Error(`sweep propagation paired-side policy drifted: ${stripPath.id}:${index}`);
        }
      }
    }
    for (let triangleIndex = 0; triangleIndex < stripPath.triangles.length; triangleIndex += 1) {
      const donorTriangle = stripPath.triangles[triangleIndex];
      if (!Array.isArray(donorTriangle) || donorTriangle.length !== 3) throw new Error("sweep propagation donor connectivity is not a triangle list");
      const vertices = donorTriangle.map((vertexIndex) => {
        if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= stripPath.vertices.length) throw new Error("sweep propagation donor index out of range");
        return point3(stripPath.vertices[vertexIndex], `${stripPath.id}.vertex[${vertexIndex}]`);
      });
      const mean = donorTriangle.reduce((sum, vertexIndex) => sum + weightByVertex.get(vertexIndex).weight, 0) / 3;
      const gray = Math.round(mean * 255);
      triangles.push({ vertices, albedo: [gray, gray, gray] });
    }
  }
  if (triangles.length !== stripSet.triangleCount) throw new Error("sweep propagation observer triangle cardinality drifted");
  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-path-sweep-propagation-native/v1",
      phase: weightSet.phase,
      indexed_strip_set_hash: stripSet.indexedStripSetHash,
      propagation_source_hash: weightSet.propagationSourceHash,
      propagation_weight_set_hash: weightSet.weightSetHash,
      output_triangle_count: triangles.length,
      output_sha256: sha256(bytes),
      geometry_sha256: geometryHash(scene),
      donor_connectivity_consumed_directly: true,
      donor_neutral_weights_consumed_directly: true,
      geometry_mutated_by_weight: false,
      normalized_distance_rederived_by_consumer: false,
      propagation_recomputed_by_consumer: false,
      material_authority_acquired: false,
      renderer_authority_acquired: false,
      consumer_semantics_assigned: false,
      observer_policy: "map the donor-owned neutral propagation scalar only to disposable grayscale albedo over donor-owned strip geometry; do not infer opacity, emission, visibility, reveal, damage, gameplay, UI, world, or material meaning",
    },
  };
}

function fixturePaths() {
  return [
    { id: "path-a", points: [{ x: 0.10, y: 0.22 }, { x: 0.30, y: 0.29 }, { x: 0.58, y: 0.55 }, { x: 0.88, y: 0.70 }] },
    { id: "path-b", points: [{ x: 0.12, y: 0.82 }, { x: 0.32, y: 0.72 }, { x: 0.61, y: 0.52 }, { x: 0.87, y: 0.31 }] },
  ];
}

export async function observeVisualEffectPathSweepPropagationNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision);
  const rootPath = resolve(root);
  const runtimePath = resolve(rootPath, "hand-lab/src/hand-runtime.mjs");
  const weightedPath = resolve(rootPath, "hand-lab/src/path-sweep-propagation-weights2d.mjs");
  const [runtimeBytes, weightedBytes] = await Promise.all([readFile(runtimePath), readFile(weightedPath)]);
  const runtime = await import(`${pathToFileURL(runtimePath).href}?sha=${sha256(runtimeBytes)}`);
  const weighted = await import(`${pathToFileURL(weightedPath).href}?sha=${sha256(weightedBytes)}`);
  if (weighted.PATH_SWEEP_PROPAGATION_WEIGHTS_2D_GRAPH?.id !== "fx.geometry.path-sweep-propagation-weights2d" || weighted.PATH_SWEEP_PROPAGATION_WEIGHTS_2D_GRAPH?.version !== "0.1.0") {
    throw new Error("unexpected VFX sweep propagation graph identity");
  }

  const phaseA = Number(options.phaseA ?? 0.22);
  const phaseB = Number(options.phaseB ?? 0.72);
  const initial = weighted.makePathSweepPropagationWeightState(fixturePaths(), {
    sweepId: "creative-render-sweep",
    propagationId: "creative-render-front",
    halfWidth: Number(options.halfWidth ?? 0.025),
    direction: "forward",
    frontSoftness: Number(options.frontSoftness ?? 0.2),
  });
  const initialBytes = stableBytes(initial);
  const pathsBytes = stableBytes(initial.paths);
  const sweepRequestBytes = stableBytes(initial.pathSweepFrameRequest);
  const propagationRequestBytes = stableBytes(initial.propagationFrontRequest);
  const registry = runtime.createHandRegistry(weighted.PATH_SWEEP_PROPAGATION_WEIGHTS_2D_HANDS);
  const execute = (callerKind, state = initial) => runtime.executeHandGraph({ registry, graph: weighted.PATH_SWEEP_PROPAGATION_WEIGHTS_2D_GRAPH, initialState: state, context: { callerKind } });
  const human = execute("human");
  const machine = execute("machine");
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("sweep propagation caller-neutral replay failed");
  if (stableBytes(initial).compare(initialBytes) !== 0 || stableBytes(human.finalState.paths).compare(pathsBytes) !== 0) throw new Error("sweep propagation caller state mutated");
  if (stableBytes(human.finalState.pathSweepFrameRequest).compare(sweepRequestBytes) !== 0 || stableBytes(human.finalState.propagationFrontRequest).compare(propagationRequestBytes) !== 0) throw new Error("sweep propagation request mutated");

  const state = human.finalState;
  const source = state.pathSweepFrameSource;
  const stripSet = state.pathSweepIndexedStripSets[source.id];
  const propagationSource = state.propagationFrontSource;
  const key = `${source.id}::${propagationSource.id}`;
  const buildAt = (phase, maxPoints = stripSet.pointCount, maxVertices = stripSet.vertexCount) => weighted.buildPathSweepPropagationWeightSetHand.execute(state, { phase, maxPoints, maxVertices }).state.pathSweepPropagationWeightSets[key];
  const setA = buildAt(phaseA);
  const setB = buildAt(phaseB);
  if (weighted.validatePathSweepPropagationWeightSet(state, setA, { maxPoints: 4096, maxVertices: 8192 }) !== true || weighted.validatePathSweepPropagationWeightSet(state, setB, { maxPoints: 4096, maxVertices: 8192 }) !== true) throw new Error("sweep propagation donor validation failed");
  if (setA.weightSetHash === setB.weightSetHash) throw new Error("sweep propagation selected phases did not change derived weights");

  const observedA = pathSweepPropagationWeightSetToAxmScene(stripSet, setA, { maxTriangles: stripSet.triangleCount });
  const observedB = pathSweepPropagationWeightSetToAxmScene(stripSet, setB, { maxTriangles: stripSet.triangleCount });
  if (observedA.observation.geometry_sha256 !== observedB.observation.geometry_sha256) throw new Error("sweep propagation phase changed geometry");
  if (observedA.observation.output_sha256 === observedB.observation.output_sha256) throw new Error("sweep propagation phase did not reach observation bytes");

  const roomyObserved = pathSweepPropagationWeightSetToAxmScene(stripSet, setA, { maxTriangles: HARD_MAX_TRIANGLES });
  if (roomyObserved.observation.output_sha256 !== observedA.observation.output_sha256) throw new Error("observer capacity changed output");
  let observerBudgetRejected = false;
  try { pathSweepPropagationWeightSetToAxmScene(stripSet, setA, { maxTriangles: stripSet.triangleCount - 1 }); } catch (error) { observerBudgetRejected = /triangle budget exceeded/.test(String(error)); }
  if (!observerBudgetRejected) throw new Error("observer one-below budget did not fail closed");

  const exactSet = buildAt(phaseA, stripSet.pointCount, stripSet.vertexCount);
  const roomySet = buildAt(phaseA, 4096, 8192);
  if (exactSet.weightSetHash !== roomySet.weightSetHash) throw new Error("donor capacity changed derived weight identity");
  let donorVertexBudgetRejected = false;
  try { buildAt(phaseA, stripSet.pointCount, stripSet.vertexCount - 1); } catch (error) { donorVertexBudgetRejected = /vertex budget exceeded/.test(String(error)); }
  if (!donorVertexBudgetRejected) throw new Error("donor one-below vertex budget did not fail closed");

  const zero = buildAt(-0.5);
  const one = buildAt(1.5);
  if (zero.phase !== 0 || zero.minWeight !== 0 || zero.maxWeight !== 0) throw new Error("lower phase clamp drifted");
  if (one.phase !== 1 || one.minWeight !== 1 || one.maxWeight !== 1) throw new Error("upper phase clamp drifted");

  const tampered = structuredClone(setA);
  tampered.paths[0].vertices[2].weight = tampered.paths[0].vertices[2].weight === 0 ? 0.25 : 0;
  tampered.weightSetHash = runtime.hashValue(weightHashPayload(tampered));
  let tamperRejected = false;
  try { weighted.validatePathSweepPropagationWeightSet(state, tampered, { maxPoints: 4096, maxVertices: 8192 }); } catch { tamperRejected = true; }
  if (!tamperRejected) throw new Error("self-consistent derived weight tamper was accepted");

  const forged = structuredClone(setA);
  forged.semantics.materialAuthority = "emission";
  forged.weightSetHash = runtime.hashValue(weightHashPayload(forged));
  let semanticForgeryRejected = false;
  try { weighted.validatePathSweepPropagationWeightSet(state, forged, { maxPoints: 4096, maxVertices: 8192 }); } catch { semanticForgeryRejected = true; }
  if (!semanticForgeryRejected) throw new Error("self-consistent weight semantic forgery was accepted");

  const donorStateBytes = stableBytes(state);
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      revision: vfxRevision,
      graph_id: weighted.PATH_SWEEP_PROPAGATION_WEIGHTS_2D_GRAPH.id,
      graph_version: weighted.PATH_SWEEP_PROPAGATION_WEIGHTS_2D_GRAPH.version,
      donor_graph_reused: true,
      caller_neutral_replay: "PASS",
      caller_paths_unchanged: true,
      caller_requests_unchanged: true,
      retained_path_source_hash: state.pathSourceHash,
      retained_sweep_source_hash: state.pathSweepFrameSourceHash,
      retained_propagation_source_hash: state.propagationFrontSourceHash,
      indexed_strip_set_hash: stripSet.indexedStripSetHash,
      phase_a_weight_set: setA,
      phase_b_weight_set: setB,
      source_files: {
        runtime: { sha256: sha256(runtimeBytes) },
        path_sweep_propagation_weights2d: { sha256: sha256(weightedBytes) },
      },
    },
    native_observers: { phase_a: observedA.observation, phase_b: observedB.observation },
    challenges: {
      exact_vs_roomy_donor_capacity: exactSet.weightSetHash === roomySet.weightSetHash,
      one_below_donor_vertex_capacity_rejected: donorVertexBudgetRejected,
      exact_vs_roomy_observer_capacity: roomyObserved.observation.output_sha256 === observedA.observation.output_sha256,
      one_below_observer_capacity_rejected: observerBudgetRejected,
      lower_phase_clamps_to_zero: zero.phase === 0 && zero.minWeight === 0 && zero.maxWeight === 0,
      upper_phase_clamps_to_one: one.phase === 1 && one.minWeight === 1 && one.maxWeight === 1,
      self_consistent_weight_tamper_rejected: tamperRejected,
      self_consistent_weight_semantic_forgery_rejected: semanticForgeryRejected,
      phase_difference_preserves_geometry: observedA.observation.geometry_sha256 === observedB.observation.geometry_sha256,
      phase_difference_changes_observation_bytes: observedA.observation.output_sha256 !== observedB.observation.output_sha256,
    },
    truth_boundary: {
      caller_paths_authority: "RETAINED_CALLER_SOURCE_TRUTH",
      sweep_source_authority: "RETAINED_VFX_SOURCE",
      propagation_source_authority: "RETAINED_VFX_SOURCE",
      indexed_strip_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      propagation_weight_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      selected_phase_authority: "DERIVED_SELECTION_ONLY",
      native_scene_receipt_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
      donor_weight_meaning: "NEUTRAL_SCALAR_ONLY",
      donor_material_authority: "NONE",
      donor_renderer_authority: "NONE",
      donor_consumer_authority: "NONE",
      propagation_recomputed_by_creative_render: false,
      normalized_distance_rederived_by_creative_render: false,
      geometry_mutated_by_weight: false,
      opacity_semantics_proven: false,
      emission_semantics_proven: false,
      visibility_or_reveal_semantics_proven: false,
      consumer_semantics_proven: false,
      continuous_animation_timing_proven: false,
      aesthetic_quality_proven: false,
      accessibility_proven: false,
      realtime_performance_proven: false,
      gpu_equivalence_proven: false,
      cross_machine_bitwise_determinism_proven: false,
    },
    outputs: {
      phase_a_scene: { sha256: observedA.observation.output_sha256, bytes: observedA.bytes.length },
      phase_b_scene: { sha256: observedB.observation.output_sha256, bytes: observedB.bytes.length },
      shared_geometry_sha256: observedA.observation.geometry_sha256,
      donor_state: { sha256: sha256(donorStateBytes), bytes: donorStateBytes.length },
    },
  };
  return {
    phaseASceneBytes: observedA.bytes,
    phaseBSceneBytes: observedB.bytes,
    donorStateBytes,
    receipt,
    receiptBytes: stableBytes(receipt),
    phaseAWeightSet: setA,
    phaseBWeightSet: setB,
  };
}
