import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PATH_SWEEP_INDEXED_STRIP_NATIVE_RECEIPT";
const VERSION = 1;
const HARD_MAX_POINTS = 16384;
const HARD_MAX_TRIANGLES = (HARD_MAX_POINTS - 1) * 2;

const FRAME_SEMANTICS = Object.freeze({
  algorithm: "polyline-bisector-sweep-frame2d/v0.1",
  profile: "symmetric-ribbon2d",
  framePolicy: "left-normal-bisector2d",
  reversalFallback: "outgoing-segment",
  widthMode: "constant-half-width",
});

const RIBBON_SEMANTICS = Object.freeze({
  algorithm: "frame-normal-ribbon-boundary2d/v0.1",
  profile: "symmetric-ribbon2d",
  boundaryPolicy: "center-plus-minus-normal-half-width",
  clipping: "none",
  joinAuthority: "none",
  capAuthority: "none",
  triangulation: "none",
  rendererAuthority: "none",
  meshAuthority: "none",
});

const INDEXED_STRIP_SEMANTICS = Object.freeze({
  algorithm: "ribbon-adjacent-pair-indexed-strip2d/v0.1",
  primitiveTopology: "triangle-list",
  vertexOrder: "left-right-per-path-point",
  trianglePolicy: "left_i-right_i-left_next;right_i-right_next-left_next",
  pathBridging: "forbidden",
  joinAuthority: "none",
  capAuthority: "none",
  clipping: "none",
  uvAuthority: "none",
  materialAuthority: "none",
  rendererAuthority: "none",
  frontFaceAuthority: "none",
  manifoldAuthority: "none",
  selfIntersectionResolution: "none",
  geometryValidityClaim: "connectivity-only",
});

function exactRevision(value, label) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new Error(`${label} must be an exact 40-character lowercase git SHA`);
  return text;
}

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileDigest(path) {
  return { sha256: sha256(await readFile(path)) };
}

function boundedInteger(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer within [${min},${max}]`);
  }
  return number;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function geometryDigest(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
}

function ribbonSetHashPayload(set) {
  return {
    schema: set.schema,
    sweepSourceHash: set.sweepSourceHash,
    pathSourceHash: set.pathSourceHash,
    frameSetHash: set.frameSetHash,
    pathCount: set.pathCount,
    pointCount: set.pointCount,
    semantics: set.semantics,
    paths: set.paths,
    provenance: set.provenance,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
}

function indexedStripSetHashPayload(set) {
  return {
    schema: set.schema,
    sweepSourceHash: set.sweepSourceHash,
    pathSourceHash: set.pathSourceHash,
    frameSetHash: set.frameSetHash,
    ribbonSetHash: set.ribbonSetHash,
    pathCount: set.pathCount,
    pointCount: set.pointCount,
    vertexCount: set.vertexCount,
    triangleCount: set.triangleCount,
    indexCount: set.indexCount,
    semantics: set.semantics,
    paths: set.paths,
    provenance: set.provenance,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
}

function validateSourceBoundary(paths, source, sourceHash, frameSet, ribbonSet, stripSet) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("indexed-strip observer requires retained caller paths");
  if (!source || source.schema !== "axm.path-sweep-frame-source/v0.1") {
    throw new Error("indexed-strip observer requires retained v0.1 sweep-frame source");
  }
  for (const [key, expected] of Object.entries(FRAME_SEMANTICS)) {
    if (source[key] !== expected) throw new Error(`indexed-strip retained sweep source ${key} drifted`);
  }
  if (!String(sourceHash || "").trim()) throw new Error("indexed-strip observer requires retained sweep source hash");
  if (source.provenance?.rendererAuthority !== "none" || source.provenance?.meshAuthority !== "none") {
    throw new Error("indexed-strip retained sweep source unexpectedly claims renderer or mesh authority");
  }

  if (!frameSet || frameSet.schema !== "axm.path-sweep-frame-set/v0.1" || frameSet.derived !== true || frameSet.rebuildable !== true) {
    throw new Error("indexed-strip observer requires derived rebuildable v0.1 frame set");
  }
  if (!ribbonSet || ribbonSet.schema !== "axm.path-sweep-ribbon-set/v0.1" || ribbonSet.derived !== true || ribbonSet.rebuildable !== true) {
    throw new Error("indexed-strip observer requires derived rebuildable v0.1 ribbon set");
  }
  for (const [key, expected] of Object.entries(RIBBON_SEMANTICS)) {
    if (ribbonSet.semantics?.[key] !== expected) throw new Error(`indexed-strip ribbon semantic ${key} drifted`);
  }

  if (!stripSet || stripSet.schema !== "axm.path-sweep-indexed-strip-set/v0.1" || stripSet.derived !== true || stripSet.rebuildable !== true) {
    throw new Error("indexed-strip observer accepts only derived rebuildable v0.1 indexed strip sets");
  }
  if (stripSet.sweepSourceHash !== sourceHash || stripSet.pathSourceHash !== source.pathSource?.sourceHash) {
    throw new Error("indexed-strip retained source lineage mismatch");
  }
  if (frameSet.sourceHash !== sourceHash || frameSet.pathSourceHash !== stripSet.pathSourceHash) {
    throw new Error("indexed-strip frame lineage mismatch");
  }
  if (ribbonSet.sweepSourceHash !== sourceHash || ribbonSet.pathSourceHash !== stripSet.pathSourceHash || ribbonSet.frameSetHash !== frameSet.frameSetHash) {
    throw new Error("indexed-strip ribbon lineage mismatch");
  }
  if (stripSet.frameSetHash !== frameSet.frameSetHash || stripSet.ribbonSetHash !== ribbonSet.ribbonSetHash) {
    throw new Error("indexed-strip derived lineage mismatch");
  }
  for (const [key, expected] of Object.entries(INDEXED_STRIP_SEMANTICS)) {
    if (stripSet.semantics?.[key] !== expected) throw new Error(`indexed-strip topology semantic ${key} drifted`);
  }
  if (stripSet.provenance?.externalSourceReuse !== "none") throw new Error("indexed-strip provenance drifted");
  if (stripSet.pathCount !== paths.length || stripSet.pathCount !== ribbonSet.pathCount || stripSet.pathCount !== frameSet.pathCount) {
    throw new Error("indexed-strip path cardinality mismatch");
  }
  if (stripSet.pointCount !== ribbonSet.pointCount || stripSet.pointCount !== frameSet.pointCount) {
    throw new Error("indexed-strip point cardinality mismatch");
  }
}

function point3(vertex, label) {
  return [finite(vertex?.x, `${label}.x`), finite(vertex?.y, `${label}.y`), 0];
}

export function pathSweepIndexedStripSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, stripSet, options = {}) {
  validateSourceBoundary(paths, source, sourceHash, frameSet, ribbonSet, stripSet);
  const maxTriangles = boundedInteger(options.maxTriangles ?? HARD_MAX_TRIANGLES, 1, HARD_MAX_TRIANGLES, "indexed-strip observer maxTriangles");
  if (stripSet.triangleCount > maxTriangles) {
    throw new Error(`indexed-strip observer triangle budget exceeded: ${stripSet.triangleCount} > ${maxTriangles}`);
  }

  const triangles = [];
  let countedVertices = 0;
  let countedTriangles = 0;
  let countedIndices = 0;

  for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
    const retainedPath = paths[pathIndex];
    const derivedPath = stripSet.paths?.[pathIndex];
    if (!derivedPath || derivedPath.id !== retainedPath.id || derivedPath.pointCount !== retainedPath.points.length) {
      throw new Error(`indexed-strip path lineage/count mismatch at ${pathIndex}`);
    }
    if (!Array.isArray(derivedPath.vertices) || derivedPath.vertexCount !== derivedPath.vertices.length || derivedPath.vertexCount !== derivedPath.pointCount * 2) {
      throw new Error(`indexed-strip vertex cardinality mismatch for ${retainedPath.id}`);
    }
    if (!Array.isArray(derivedPath.triangles) || derivedPath.triangleCount !== derivedPath.triangles.length || derivedPath.indexCount !== derivedPath.triangleCount * 3) {
      throw new Error(`indexed-strip triangle cardinality mismatch for ${retainedPath.id}`);
    }

    for (let vertexIndex = 0; vertexIndex < derivedPath.vertices.length; vertexIndex += 1) {
      const vertex = derivedPath.vertices[vertexIndex];
      if (vertex.index !== vertexIndex) throw new Error(`indexed-strip vertex index drifted for ${retainedPath.id}:${vertexIndex}`);
      if (vertex.pointIndex !== Math.floor(vertexIndex / 2)) throw new Error(`indexed-strip point index drifted for ${retainedPath.id}:${vertexIndex}`);
      const expectedSide = vertexIndex % 2 === 0 ? "left" : "right";
      if (vertex.side !== expectedSide) throw new Error(`indexed-strip vertex side drifted for ${retainedPath.id}:${vertexIndex}`);
      point3(vertex, `${retainedPath.id}.vertex[${vertexIndex}]`);
    }

    for (let triangleIndex = 0; triangleIndex < derivedPath.triangles.length; triangleIndex += 1) {
      const donorTriangle = derivedPath.triangles[triangleIndex];
      if (!Array.isArray(donorTriangle) || donorTriangle.length !== 3) {
        throw new Error(`indexed-strip donor triangle ${retainedPath.id}:${triangleIndex} is not a triangle-list record`);
      }
      const vertices = donorTriangle.map((index, corner) => {
        if (!Number.isInteger(index) || index < 0 || index >= derivedPath.vertices.length) {
          throw new Error(`indexed-strip donor triangle index out of range at ${retainedPath.id}:${triangleIndex}:${corner}`);
        }
        return point3(derivedPath.vertices[index], `${retainedPath.id}.triangle[${triangleIndex}][${corner}]`);
      });
      const gray = 176;
      triangles.push({ vertices, albedo: [gray, gray, gray] });
    }

    countedVertices += derivedPath.vertexCount;
    countedTriangles += derivedPath.triangleCount;
    countedIndices += derivedPath.indexCount;
  }

  if (countedVertices !== stripSet.vertexCount || countedTriangles !== stripSet.triangleCount || countedIndices !== stripSet.indexCount) {
    throw new Error("indexed-strip observer aggregate cardinality drifted");
  }

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-path-sweep-indexed-strip-to-native/v1",
      retained_path_source_hash: stripSet.pathSourceHash,
      retained_sweep_source_hash: sourceHash,
      derived_frame_set_hash: frameSet.frameSetHash,
      derived_ribbon_set_hash: ribbonSet.ribbonSetHash,
      derived_indexed_strip_set_hash: stripSet.indexedStripSetHash,
      input_path_count: stripSet.pathCount,
      input_point_count: stripSet.pointCount,
      input_vertex_count: stripSet.vertexCount,
      input_triangle_count: stripSet.triangleCount,
      output_triangle_count: triangles.length,
      output_contract: "AXM_SCENE 1",
      output_sha256: sha256(bytes),
      geometry_sha256: geometryDigest(scene),
      donor_triangle_connectivity_consumed_directly: true,
      triangulation_rederived_by_consumer: false,
      boundary_offsets_rederived_by_consumer: false,
      path_bridging_introduced_by_consumer: false,
      canonical_mesh_authority_acquired: false,
      renderer_authority_acquired: false,
      material_authority_acquired: false,
      consumer_semantics_assigned: false,
      observer_policy: "map donor-owned per-path local vertices and triangle-list connectivity directly into disposable AXM_SCENE triangles with fixed neutral albedo; do not infer joins, caps, UVs, material, front-face/manifold validity, collision, physics, game, UI, world, or product meaning",
    },
  };
}

function fixturePaths() {
  return [
    {
      id: "neutral-path-a",
      points: [
        { x: 0.12, y: 0.24 },
        { x: 0.31, y: 0.36 },
        { x: 0.55, y: 0.58 },
        { x: 0.84, y: 0.7 },
      ],
      callerMetadata: { role: "unspecified", retained: true },
    },
    {
      id: "neutral-path-b",
      points: [
        { x: 0.14, y: 0.78 },
        { x: 0.34, y: 0.68 },
        { x: 0.61, y: 0.5 },
        { x: 0.86, y: 0.3 },
      ],
      callerMetadata: { role: "unspecified", retained: true },
    },
  ];
}

export async function observeVisualEffectPathSweepIndexedStripNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const donorPaths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    frame: resolve(rootPath, "hand-lab/src/path-sweep-frame2d.mjs"),
    ribbon: resolve(rootPath, "hand-lab/src/path-sweep-ribbon2d.mjs"),
    indexed: resolve(rootPath, "hand-lab/src/path-sweep-indexed-strip2d.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(donorPaths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(donorPaths.runtime).href}?sha=${sources.runtime.sha256}`);
  const frame = await import(`${pathToFileURL(donorPaths.frame).href}?sha=${sources.frame.sha256}`);
  const ribbon = await import(`${pathToFileURL(donorPaths.ribbon).href}?sha=${sources.ribbon.sha256}`);
  const indexed = await import(`${pathToFileURL(donorPaths.indexed).href}?sha=${sources.indexed.sha256}`);

  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (typeof frame.makePathSweepFrameState !== "function" || typeof frame.validatePathSweepFrameSet !== "function" ||
      typeof ribbon.validatePathSweepRibbonSet !== "function" || !Array.isArray(indexed.PATH_SWEEP_INDEXED_STRIP_2D_HANDS) ||
      !indexed.PATH_SWEEP_INDEXED_STRIP_2D_GRAPH || typeof indexed.validatePathSweepIndexedStripSet !== "function" ||
      typeof indexed.buildPathSweepIndexedStripSetHand?.execute !== "function") {
    throw new Error("VFX donor indexed-strip boundary is unavailable");
  }
  if (indexed.PATH_SWEEP_INDEXED_STRIP_2D_GRAPH.id !== "fx.geometry.path-sweep-indexed-strip2d" || indexed.PATH_SWEEP_INDEXED_STRIP_2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX path-sweep-indexed-strip2d graph identity");
  }

  const callerPaths = fixturePaths();
  const initial = frame.makePathSweepFrameState(callerPaths, {
    id: "creative-render-neutral-indexed-strip",
    halfWidth: Number(options.halfWidth ?? 0.025),
  });
  initial.consumerMetadata = { owner: "creative-render-observer", untouched: true };
  const initialBytes = stableBytes(initial);
  const requestBytes = stableBytes(initial.pathSweepFrameRequest);
  const pathsBytes = stableBytes(initial.paths);

  const registry = runtime.createHandRegistry(indexed.PATH_SWEEP_INDEXED_STRIP_2D_HANDS);
  const execute = (callerKind, state = initial) => runtime.executeHandGraph({
    registry,
    graph: indexed.PATH_SWEEP_INDEXED_STRIP_2D_GRAPH,
    initialState: state,
    context: { callerKind },
  });

  const human = execute("human");
  const machine = execute("machine");
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("VFX indexed-strip caller-neutral replay failed");
  if (stableBytes(initial).compare(initialBytes) !== 0) throw new Error("VFX indexed-strip initial state mutated during replay");
  if (stableBytes(human.finalState.pathSweepFrameRequest).compare(requestBytes) !== 0 || stableBytes(machine.finalState.pathSweepFrameRequest).compare(requestBytes) !== 0) {
    throw new Error("VFX indexed-strip caller request mutated");
  }
  if (stableBytes(human.finalState.paths).compare(pathsBytes) !== 0 || stableBytes(machine.finalState.paths).compare(pathsBytes) !== 0) {
    throw new Error("VFX indexed-strip retained caller paths were rewritten");
  }

  const finalState = human.finalState;
  const source = finalState.pathSweepFrameSource;
  const sourceHash = finalState.pathSweepFrameSourceHash;
  const frameSet = finalState.pathSweepFrameSets?.[source?.id];
  const ribbonSet = finalState.pathSweepRibbonSets?.[source?.id];
  const stripSet = finalState.pathSweepIndexedStripSets?.[source?.id];
  if (frame.validatePathSweepFrameSet(finalState, frameSet, { maxPoints: 4096 }) !== true ||
      ribbon.validatePathSweepRibbonSet(finalState, ribbonSet, { maxPoints: 4096 }) !== true ||
      indexed.validatePathSweepIndexedStripSet(finalState, stripSet, { maxPoints: 4096 }) !== true) {
    throw new Error("VFX indexed-strip donor validation failed");
  }

  const exactObserved = pathSweepIndexedStripSetToAxmScene(finalState.paths, source, sourceHash, frameSet, ribbonSet, stripSet, { maxTriangles: stripSet.triangleCount });
  const roomyObserved = pathSweepIndexedStripSetToAxmScene(finalState.paths, source, sourceHash, frameSet, ribbonSet, stripSet, { maxTriangles: HARD_MAX_TRIANGLES });
  if (exactObserved.observation.output_sha256 !== roomyObserved.observation.output_sha256) {
    throw new Error("indexed-strip observer capacity changed observation bytes");
  }
  let observerBudgetRejected = false;
  try {
    pathSweepIndexedStripSetToAxmScene(finalState.paths, source, sourceHash, frameSet, ribbonSet, stripSet, { maxTriangles: stripSet.triangleCount - 1 });
  } catch (error) {
    observerBudgetRejected = /triangle budget exceeded/.test(String(error));
  }
  if (!observerBudgetRejected) throw new Error("indexed-strip observer one-below capacity did not fail closed");

  const exactDonorState = indexed.buildPathSweepIndexedStripSetHand.execute(finalState, { maxPoints: stripSet.pointCount }, {}).state;
  const roomyDonorState = indexed.buildPathSweepIndexedStripSetHand.execute(finalState, { maxPoints: 4096 }, {}).state;
  const exactStrip = exactDonorState.pathSweepIndexedStripSets[source.id];
  const roomyStrip = roomyDonorState.pathSweepIndexedStripSets[source.id];
  if (exactStrip.indexedStripSetHash !== roomyStrip.indexedStripSetHash || exactStrip.indexedStripSetHash !== stripSet.indexedStripSetHash) {
    throw new Error("VFX indexed-strip donor capacity changed derived connectivity identity");
  }
  let donorBudgetRejected = false;
  try {
    indexed.buildPathSweepIndexedStripSetHand.execute(finalState, { maxPoints: stripSet.pointCount - 1 }, {});
  } catch (error) {
    donorBudgetRejected = /point budget exceeded/.test(String(error));
  }
  if (!donorBudgetRejected) throw new Error("VFX indexed-strip donor one-below capacity did not fail closed");

  const oversizedPoints = Array.from({ length: 4097 }, (_, index) => ({ x: index / 4096, y: 0.5 }));
  let graphBudgetRejected = false;
  try {
    const oversized = frame.makePathSweepFrameState([{ id: "oversized", points: oversizedPoints }], { id: "oversized", halfWidth: source.halfWidth });
    execute("machine", oversized);
  } catch (error) {
    graphBudgetRejected = /point budget exceeded: 4097 > 4096/.test(String(error));
  }
  if (!graphBudgetRejected) throw new Error("VFX indexed-strip graph default capacity did not fail closed");

  const pathsIsolated = stripSet.paths.every((path) => path.triangles.every((triangle) => triangle.every((indexValue) =>
    Number.isInteger(indexValue) && indexValue >= 0 && indexValue < path.vertices.length)));
  if (!pathsIsolated) throw new Error("VFX indexed-strip path-local connectivity isolation failed");

  const tamperedStrip = structuredClone(stripSet);
  tamperedStrip.paths[0].triangles[0] = [...tamperedStrip.paths[0].triangles[0]].reverse();
  tamperedStrip.indexedStripSetHash = runtime.hashValue(indexedStripSetHashPayload(tamperedStrip));
  let stripTamperRejected = false;
  try {
    indexed.validatePathSweepIndexedStripSet(finalState, tamperedStrip, { maxPoints: 4096 });
  } catch {
    stripTamperRejected = true;
  }
  if (!stripTamperRejected) throw new Error("self-consistent indexed-strip connectivity tamper was accepted");

  const forgedSemantics = structuredClone(stripSet);
  forgedSemantics.semantics.rendererAuthority = "vfx";
  forgedSemantics.indexedStripSetHash = runtime.hashValue(indexedStripSetHashPayload(forgedSemantics));
  let semanticForgeryRejected = false;
  try {
    indexed.validatePathSweepIndexedStripSet(finalState, forgedSemantics, { maxPoints: 4096 });
  } catch {
    semanticForgeryRejected = true;
  }
  if (!semanticForgeryRejected) throw new Error("self-consistent indexed-strip semantic forgery was accepted");

  const tamperedRibbonState = structuredClone(finalState);
  const tamperedRibbon = tamperedRibbonState.pathSweepRibbonSets[source.id];
  tamperedRibbon.paths[0].points[1].left.x = Number((tamperedRibbon.paths[0].points[1].left.x + 0.1).toFixed(6));
  tamperedRibbon.ribbonSetHash = runtime.hashValue(ribbonSetHashPayload(tamperedRibbon));
  const launderingStrip = structuredClone(stripSet);
  launderingStrip.ribbonSetHash = tamperedRibbon.ribbonSetHash;
  launderingStrip.indexedStripSetHash = runtime.hashValue(indexedStripSetHashPayload(launderingStrip));
  let ribbonTamperRejected = false;
  try {
    indexed.validatePathSweepIndexedStripSet(tamperedRibbonState, launderingStrip, { maxPoints: 4096 });
  } catch {
    ribbonTamperRejected = true;
  }
  if (!ribbonTamperRejected) throw new Error("self-consistent ribbon tamper was laundered into indexed-strip lineage");

  const donorStateBytes = stableBytes(finalState);
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      revision: vfxRevision,
      graph_id: indexed.PATH_SWEEP_INDEXED_STRIP_2D_GRAPH.id,
      graph_version: indexed.PATH_SWEEP_INDEXED_STRIP_2D_GRAPH.version,
      hand_ids: indexed.PATH_SWEEP_INDEXED_STRIP_2D_HANDS.map((hand) => hand.id),
      donor_graph_reused: true,
      source_files: sources,
      caller_neutral_replay: "PASS",
      caller_request_unchanged: true,
      caller_paths_unchanged: true,
      retained_sweep_source: {
        schema: source.schema,
        source_hash: sourceHash,
        path_source_hash: source.pathSource.sourceHash,
        path_count: source.pathSource.pathCount,
        point_count: source.pathSource.pointCount,
        algorithm: source.algorithm,
        profile: source.profile,
        frame_policy: source.framePolicy,
        reversal_fallback: source.reversalFallback,
        width_mode: source.widthMode,
        half_width: source.halfWidth,
      },
      selected_frame_set: frameSet,
      selected_ribbon_set: ribbonSet,
      selected_indexed_strip_set: stripSet,
    },
    native_observer: exactObserved.observation,
    challenges: {
      exact_vs_roomy_donor_capacity: exactStrip.indexedStripSetHash === roomyStrip.indexedStripSetHash,
      one_below_donor_capacity_rejected: donorBudgetRejected,
      exact_vs_roomy_observer_capacity: exactObserved.observation.output_sha256 === roomyObserved.observation.output_sha256,
      one_below_observer_capacity_rejected: observerBudgetRejected,
      graph_default_4096_point_budget_rejected_4097: graphBudgetRejected,
      path_local_connectivity_isolated: pathsIsolated,
      self_consistent_indexed_strip_tamper_rejected: stripTamperRejected,
      self_consistent_semantic_forgery_rejected: semanticForgeryRejected,
      self_consistent_ribbon_tamper_cannot_be_laundered: ribbonTamperRejected,
    },
    truth_boundary: {
      caller_paths_authority: "RETAINED_CALLER_SOURCE_TRUTH",
      sweep_source_authority: "RETAINED_VFX_SOURCE",
      frame_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      ribbon_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      indexed_strip_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      native_scene_receipt_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
      donor_geometry_validity_claim: "CONNECTIVITY_ONLY",
      donor_join_authority: "NONE",
      donor_cap_authority: "NONE",
      donor_uv_authority: "NONE",
      donor_material_authority: "NONE",
      donor_renderer_authority: "NONE",
      donor_front_face_authority: "NONE",
      donor_manifold_authority: "NONE",
      donor_self_intersection_resolution: "NONE",
      triangulation_rederived_by_creative_render: false,
      boundary_offsets_rederived_by_creative_render: false,
      canonical_mesh_authority_acquired: false,
      consumer_semantics_proven: false,
      general_surface_validity_proven: false,
      winding_validity_proven: false,
      self_intersection_safety_proven: false,
      aesthetic_quality_proven: false,
      accessibility_proven: false,
      realtime_performance_proven: false,
      gpu_equivalence_proven: false,
      cross_machine_bitwise_determinism_proven: false,
    },
    outputs: {
      scene: { sha256: exactObserved.observation.output_sha256, bytes: exactObserved.bytes.length },
      donor_state: { sha256: sha256(donorStateBytes), bytes: donorStateBytes.length },
    },
  };
  const receiptBytes = stableBytes(receipt);
  return {
    scene: exactObserved.scene,
    sceneBytes: exactObserved.bytes,
    donorStateBytes,
    receipt,
    receiptBytes,
    source,
    frameSet,
    ribbonSet,
    stripSet,
    retained: { paths: finalState.paths, sourceHash },
  };
}
