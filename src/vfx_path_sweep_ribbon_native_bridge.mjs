import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { serializeScene, sha256 } from "./creative_scene_operator.mjs";

const CONTRACT = "AXM_CREATIVE_VFX_PATH_SWEEP_RIBBON_NATIVE_RECEIPT";
const VERSION = 1;
const HARD_MAX_POINTS = 16384;
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

function near(a, b, epsilon = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}

function geometryDigest(scene) {
  return sha256(Buffer.from(JSON.stringify(scene.triangles.map((triangle) => triangle.vertices)), "utf8"));
}

function frameSetHashPayload(set) {
  return {
    schema: set.schema,
    sourceHash: set.sourceHash,
    pathSourceHash: set.pathSourceHash,
    pathCount: set.pathCount,
    pointCount: set.pointCount,
    paths: set.paths,
    derived: set.derived,
    rebuildable: set.rebuildable,
  };
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

function validateFrameSource(source, sourceHash, frameSet) {
  if (!source || source.schema !== "axm.path-sweep-frame-source/v0.1") {
    throw new Error("path-sweep ribbon observer requires retained v0.1 sweep-frame source");
  }
  for (const [key, expected] of Object.entries(FRAME_SEMANTICS)) {
    if (source[key] !== expected) throw new Error(`path-sweep frame source ${key} drifted`);
  }
  if (!String(sourceHash || "").trim()) throw new Error("path-sweep ribbon observer requires retained sweep source hash");
  if (!frameSet || frameSet.schema !== "axm.path-sweep-frame-set/v0.1" || frameSet.derived !== true || frameSet.rebuildable !== true) {
    throw new Error("path-sweep ribbon observer requires derived rebuildable v0.1 frame set lineage");
  }
  if (frameSet.sourceHash !== sourceHash) throw new Error("path-sweep ribbon observer frame/sweep lineage mismatch");
  if (source.pathSource?.sourceHash !== frameSet.pathSourceHash) throw new Error("path-sweep ribbon observer frame/path lineage mismatch");
  if (source.provenance?.rendererAuthority !== "none" || source.provenance?.meshAuthority !== "none") {
    throw new Error("path-sweep retained source unexpectedly claims renderer or mesh authority");
  }
}

function validateRibbonSet(paths, sourceHash, frameSet, ribbonSet) {
  if (!ribbonSet || ribbonSet.schema !== "axm.path-sweep-ribbon-set/v0.1" || ribbonSet.derived !== true || ribbonSet.rebuildable !== true) {
    throw new Error("path-sweep ribbon observer accepts only derived rebuildable v0.1 ribbon sets");
  }
  if (ribbonSet.sweepSourceHash !== sourceHash || ribbonSet.pathSourceHash !== frameSet.pathSourceHash || ribbonSet.frameSetHash !== frameSet.frameSetHash) {
    throw new Error("path-sweep ribbon observer derived lineage mismatch");
  }
  if (ribbonSet.pathCount !== paths.length || ribbonSet.pathCount !== frameSet.pathCount || ribbonSet.paths?.length !== paths.length) {
    throw new Error("path-sweep ribbon observer path cardinality mismatch");
  }
  if (ribbonSet.pointCount !== frameSet.pointCount) throw new Error("path-sweep ribbon observer point cardinality mismatch");
  for (const [key, expected] of Object.entries(RIBBON_SEMANTICS)) {
    if (ribbonSet.semantics?.[key] !== expected) throw new Error(`path-sweep ribbon semantic ${key} drifted`);
  }
  if (ribbonSet.provenance?.externalSourceReuse !== "none") throw new Error("path-sweep ribbon provenance drifted");
}

function vertex(point, label) {
  return [finite(point?.x, `${label}.x`), finite(point?.y, `${label}.y`), 0];
}

export function pathSweepRibbonSetToAxmScene(paths, source, sourceHash, frameSet, ribbonSet, options = {}) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("path-sweep ribbon observer requires retained caller paths");
  validateFrameSource(source, sourceHash, frameSet);
  validateRibbonSet(paths, sourceHash, frameSet, ribbonSet);

  const maxPoints = boundedInteger(options.maxPoints ?? 4096, 2, HARD_MAX_POINTS, "path-sweep ribbon observer maxPoints");
  if (ribbonSet.pointCount > maxPoints) {
    throw new Error(`path-sweep ribbon observer point budget exceeded: ${ribbonSet.pointCount} > ${maxPoints}`);
  }

  let counted = 0;
  const triangles = [];
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
    const retainedPath = paths[pathIndex];
    const derivedPath = ribbonSet.paths[pathIndex];
    if (!derivedPath || derivedPath.id !== retainedPath.id || derivedPath.pointCount !== retainedPath.points.length) {
      throw new Error(`path-sweep ribbon observer path lineage/count mismatch at ${pathIndex}`);
    }
    if (!Array.isArray(derivedPath.points) || derivedPath.points.length !== retainedPath.points.length) {
      throw new Error(`path-sweep ribbon observer boundary cardinality mismatch for ${retainedPath.id}`);
    }

    for (let index = 0; index < derivedPath.points.length; index += 1) {
      const sample = derivedPath.points[index];
      const retained = retainedPath.points[index];
      counted += 1;
      if (sample.index !== index || !near(sample.center?.x, retained.x) || !near(sample.center?.y, retained.y)) {
        throw new Error(`path-sweep ribbon observer center/canonical point mismatch at ${retainedPath.id}:${index}`);
      }
      vertex(sample.left, `path-sweep ribbon ${retainedPath.id}:${index}.left`);
      vertex(sample.right, `path-sweep ribbon ${retainedPath.id}:${index}.right`);
    }

    for (let index = 0; index < derivedPath.points.length - 1; index += 1) {
      const a = derivedPath.points[index];
      const b = derivedPath.points[index + 1];
      const aLeft = vertex(a.left, `${retainedPath.id}:${index}.left`);
      const aRight = vertex(a.right, `${retainedPath.id}:${index}.right`);
      const bLeft = vertex(b.left, `${retainedPath.id}:${index + 1}.left`);
      const bRight = vertex(b.right, `${retainedPath.id}:${index + 1}.right`);
      const gray = 176;
      triangles.push(
        { vertices: [aLeft, aRight, bRight], albedo: [gray, gray, gray] },
        { vertices: [aLeft, bRight, bLeft], albedo: [gray, gray, gray] },
      );
    }
  }
  if (counted !== ribbonSet.pointCount) throw new Error("path-sweep ribbon observer total point count drifted");

  const scene = { version: 1, triangles };
  const bytes = Buffer.from(serializeScene(scene), "utf8");
  return {
    scene,
    bytes,
    observation: {
      schema: "axm.creative-render.vfx-path-sweep-ribbon-to-native-strip/v1",
      retained_path_source_hash: ribbonSet.pathSourceHash,
      retained_sweep_source_hash: sourceHash,
      derived_frame_set_hash: frameSet.frameSetHash,
      derived_ribbon_set_hash: ribbonSet.ribbonSetHash,
      input_path_count: ribbonSet.pathCount,
      input_point_count: ribbonSet.pointCount,
      output_triangle_count: triangles.length,
      output_contract: "AXM_SCENE 1",
      output_sha256: sha256(bytes),
      geometry_sha256: geometryDigest(scene),
      geometry_uses_only_donor_derived_ribbon_boundaries: true,
      boundary_offsets_rederived_by_consumer: false,
      consumer_triangulation_policy_applied: true,
      triangulation_authority_scope: "DERIVED_REPLACEABLE_OBSERVER_ONLY",
      canonical_mesh_authority_acquired: false,
      renderer_authority_acquired: false,
      consumer_semantics_assigned: false,
      albedo_encodes_geometry_semantics: false,
      observer_policy: "triangulate consecutive donor-derived ribbon boundary pairs only as a disposable native observation; never rederive sweep offsets and do not infer stroke, road, border, seam, crease, material, physics, gameplay, UI, or world meaning",
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

export async function observeVisualEffectPathSweepRibbonNative(root, options = {}) {
  const vfxRevision = exactRevision(options.vfxRevision, "Visual Effect Fabric revision");
  const rootPath = resolve(root);
  const donorPaths = {
    runtime: resolve(rootPath, "hand-lab/src/hand-runtime.mjs"),
    frame: resolve(rootPath, "hand-lab/src/path-sweep-frame2d.mjs"),
    ribbon: resolve(rootPath, "hand-lab/src/path-sweep-ribbon2d.mjs"),
  };
  const sources = Object.fromEntries(
    await Promise.all(Object.entries(donorPaths).map(async ([name, path]) => [name, await fileDigest(path)])),
  );
  const runtime = await import(`${pathToFileURL(donorPaths.runtime).href}?sha=${sources.runtime.sha256}`);
  const frame = await import(`${pathToFileURL(donorPaths.frame).href}?sha=${sources.frame.sha256}`);
  const ribbon = await import(`${pathToFileURL(donorPaths.ribbon).href}?sha=${sources.ribbon.sha256}`);
  if (typeof runtime.createHandRegistry !== "function" || typeof runtime.executeHandGraph !== "function" || typeof runtime.hashValue !== "function") {
    throw new Error("VFX donor Hand runtime is unavailable");
  }
  if (typeof frame.makePathSweepFrameState !== "function" || typeof frame.validatePathSweepFrameSet !== "function" ||
      !Array.isArray(ribbon.PATH_SWEEP_RIBBON_2D_HANDS) || !ribbon.PATH_SWEEP_RIBBON_2D_GRAPH ||
      typeof ribbon.validatePathSweepRibbonSet !== "function" || typeof ribbon.buildPathSweepRibbonSetHand?.execute !== "function") {
    throw new Error("VFX donor path-sweep-ribbon2d boundary is unavailable");
  }
  if (ribbon.PATH_SWEEP_RIBBON_2D_GRAPH.id !== "fx.geometry.path-sweep-ribbon2d" || ribbon.PATH_SWEEP_RIBBON_2D_GRAPH.version !== "0.1.0") {
    throw new Error("unexpected VFX path-sweep-ribbon2d graph identity");
  }

  const callerPaths = fixturePaths();
  const initial = frame.makePathSweepFrameState(callerPaths, {
    id: "creative-render-neutral-path-sweep",
    halfWidth: Number(options.halfWidth ?? 0.025),
  });
  initial.consumerMetadata = { owner: "creative-render-observer", untouched: true };
  const initialBytes = stableBytes(initial);
  const requestBytes = stableBytes(initial.pathSweepFrameRequest);
  const pathsBytes = stableBytes(initial.paths);
  const registry = runtime.createHandRegistry(ribbon.PATH_SWEEP_RIBBON_2D_HANDS);
  const execute = (callerKind, state = initial) => runtime.executeHandGraph({
    registry,
    graph: ribbon.PATH_SWEEP_RIBBON_2D_GRAPH,
    initialState: state,
    context: { callerKind },
  });
  const human = execute("human");
  const machine = execute("machine");
  if (human.finalStateHash !== machine.finalStateHash) throw new Error("VFX path-sweep ribbon caller-neutral replay failed");
  if (stableBytes(initial).compare(initialBytes) !== 0) throw new Error("VFX path-sweep ribbon initial state mutated during replay");
  if (stableBytes(human.finalState.pathSweepFrameRequest).compare(requestBytes) !== 0 ||
      stableBytes(machine.finalState.pathSweepFrameRequest).compare(requestBytes) !== 0) {
    throw new Error("VFX path-sweep ribbon caller request mutated");
  }
  if (stableBytes(human.finalState.paths).compare(pathsBytes) !== 0 || stableBytes(machine.finalState.paths).compare(pathsBytes) !== 0) {
    throw new Error("VFX path-sweep ribbon retained caller paths were rewritten");
  }

  const finalState = human.finalState;
  const source = finalState.pathSweepFrameSource;
  const sourceHash = finalState.pathSweepFrameSourceHash;
  const frameSet = finalState.pathSweepFrameSets?.[source?.id];
  const ribbonSet = finalState.pathSweepRibbonSets?.[source?.id];
  if (frame.validatePathSweepFrameSet(finalState, frameSet, { maxPoints: 4096 }) !== true ||
      ribbon.validatePathSweepRibbonSet(finalState, ribbonSet, { maxPoints: 4096 }) !== true) {
    throw new Error("VFX path-sweep ribbon donor validation failed");
  }

  const exactObserved = pathSweepRibbonSetToAxmScene(finalState.paths, source, sourceHash, frameSet, ribbonSet, { maxPoints: ribbonSet.pointCount });
  const roomyObserved = pathSweepRibbonSetToAxmScene(finalState.paths, source, sourceHash, frameSet, ribbonSet, { maxPoints: 4096 });
  if (exactObserved.observation.output_sha256 !== roomyObserved.observation.output_sha256) {
    throw new Error("path-sweep ribbon observer capacity changed derived observation bytes");
  }
  let observerBudgetRejected = false;
  try { pathSweepRibbonSetToAxmScene(finalState.paths, source, sourceHash, frameSet, ribbonSet, { maxPoints: ribbonSet.pointCount - 1 }); }
  catch (error) { observerBudgetRejected = /point budget exceeded/.test(String(error)); }
  if (!observerBudgetRejected) throw new Error("path-sweep ribbon observer one-below capacity did not fail closed");

  const exactRibbonState = ribbon.buildPathSweepRibbonSetHand.execute(finalState, { maxPoints: ribbonSet.pointCount }, {}).state;
  const roomyRibbonState = ribbon.buildPathSweepRibbonSetHand.execute(finalState, { maxPoints: 4096 }, {}).state;
  const exactRibbon = exactRibbonState.pathSweepRibbonSets[source.id];
  const roomyRibbon = roomyRibbonState.pathSweepRibbonSets[source.id];
  if (exactRibbon.ribbonSetHash !== roomyRibbon.ribbonSetHash || exactRibbon.ribbonSetHash !== ribbonSet.ribbonSetHash) {
    throw new Error("VFX path-sweep ribbon donor capacity changed derived ribbon identity");
  }
  let donorBudgetRejected = false;
  try { ribbon.buildPathSweepRibbonSetHand.execute(finalState, { maxPoints: ribbonSet.pointCount - 1 }, {}); }
  catch (error) { donorBudgetRejected = /point budget exceeded/.test(String(error)); }
  if (!donorBudgetRejected) throw new Error("VFX path-sweep ribbon donor one-below capacity did not fail closed");

  const zeroWidthInitial = frame.makePathSweepFrameState(callerPaths, { id: "creative-render-zero-width", halfWidth: 0 });
  const zeroWidthFinal = execute("machine", zeroWidthInitial).finalState;
  const zeroWidthRibbon = zeroWidthFinal.pathSweepRibbonSets?.[zeroWidthFinal.pathSweepFrameSource?.id];
  if (ribbon.validatePathSweepRibbonSet(zeroWidthFinal, zeroWidthRibbon, { maxPoints: 4096 }) !== true) {
    throw new Error("VFX path-sweep zero-width ribbon failed donor validation");
  }
  const zeroWidthCollapsed = zeroWidthRibbon.paths.every((path) => path.points.every((point) =>
    point.left.x === point.center.x && point.left.y === point.center.y &&
    point.right.x === point.center.x && point.right.y === point.center.y));
  if (!zeroWidthCollapsed) throw new Error("VFX path-sweep zero-width ribbon did not collapse exactly to retained centers");

  const oversizedPoints = Array.from({ length: 4097 }, (_, index) => ({ x: index / 4096, y: 0.5 }));
  let graphBudgetRejected = false;
  try {
    const oversized = frame.makePathSweepFrameState([{ id: "oversized", points: oversizedPoints }], { id: "oversized", halfWidth: source.halfWidth });
    execute("machine", oversized);
  } catch (error) { graphBudgetRejected = /point budget exceeded: 4097 > 4096/.test(String(error)); }
  if (!graphBudgetRejected) throw new Error("VFX path-sweep ribbon graph default capacity did not fail closed");

  const tamperedRibbon = structuredClone(ribbonSet);
  tamperedRibbon.paths[0].points[1].left.x = Number((tamperedRibbon.paths[0].points[1].left.x + 0.1).toFixed(6));
  tamperedRibbon.ribbonSetHash = runtime.hashValue(ribbonSetHashPayload(tamperedRibbon));
  let ribbonTamperRejected = false;
  try { ribbon.validatePathSweepRibbonSet(finalState, tamperedRibbon, { maxPoints: 4096 }); }
  catch (error) { ribbonTamperRejected = /does not rebuild from verified frame truth/.test(String(error)); }
  if (!ribbonTamperRejected) throw new Error("self-consistent derived ribbon tamper was accepted");

  const tamperedFrameState = structuredClone(finalState);
  const tamperedFrame = tamperedFrameState.pathSweepFrameSets[source.id];
  tamperedFrame.paths[0].frames[1].normal.x = Number((tamperedFrame.paths[0].frames[1].normal.x + 0.125).toFixed(6));
  tamperedFrame.frameSetHash = runtime.hashValue(frameSetHashPayload(tamperedFrame));
  const launderingRibbon = structuredClone(ribbonSet);
  launderingRibbon.frameSetHash = tamperedFrame.frameSetHash;
  launderingRibbon.ribbonSetHash = runtime.hashValue(ribbonSetHashPayload(launderingRibbon));
  let frameTamperRejected = false;
  try { ribbon.validatePathSweepRibbonSet(tamperedFrameState, launderingRibbon, { maxPoints: 4096 }); }
  catch (error) { frameTamperRejected = /frame set does not rebuild from retained truth/.test(String(error)); }
  if (!frameTamperRejected) throw new Error("self-consistent derived frame tamper was laundered through ribbon lineage");

  const forgedState = structuredClone(finalState);
  forgedState.pathSweepFrameSource.algorithm = "invented-sweep-algorithm/v9";
  forgedState.pathSweepFrameSourceHash = runtime.hashValue(forgedState.pathSweepFrameSource);
  const forgedFrame = forgedState.pathSweepFrameSets[source.id];
  forgedFrame.sourceHash = forgedState.pathSweepFrameSourceHash;
  forgedFrame.frameSetHash = runtime.hashValue(frameSetHashPayload(forgedFrame));
  const forgedRibbon = structuredClone(ribbonSet);
  forgedRibbon.sweepSourceHash = forgedState.pathSweepFrameSourceHash;
  forgedRibbon.frameSetHash = forgedFrame.frameSetHash;
  forgedRibbon.ribbonSetHash = runtime.hashValue(ribbonSetHashPayload(forgedRibbon));
  let sourceForgeryRejected = false;
  try { ribbon.validatePathSweepRibbonSet(forgedState, forgedRibbon, { maxPoints: 4096 }); }
  catch (error) { sourceForgeryRejected = /source algorithm is invalid/.test(String(error)); }
  if (!sourceForgeryRejected) throw new Error("self-consistent retained path-sweep semantic forgery was accepted");

  const donorStateBytes = stableBytes(finalState);
  const receipt = {
    contract: CONTRACT,
    version: VERSION,
    visual_effect_fabric: {
      revision: vfxRevision,
      graph_id: ribbon.PATH_SWEEP_RIBBON_2D_GRAPH.id,
      graph_version: ribbon.PATH_SWEEP_RIBBON_2D_GRAPH.version,
      hand_ids: ribbon.PATH_SWEEP_RIBBON_2D_HANDS.map((hand) => hand.id),
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
    },
    native_observer: exactObserved.observation,
    challenges: {
      exact_vs_roomy_donor_capacity: exactRibbon.ribbonSetHash === roomyRibbon.ribbonSetHash,
      one_below_donor_capacity_rejected: donorBudgetRejected,
      exact_vs_roomy_observer_capacity: exactObserved.observation.output_sha256 === roomyObserved.observation.output_sha256,
      one_below_observer_capacity_rejected: observerBudgetRejected,
      zero_width_collapses_to_centers: zeroWidthCollapsed,
      graph_default_4096_point_budget_rejected_4097: graphBudgetRejected,
      self_consistent_ribbon_tamper_rejected: ribbonTamperRejected,
      self_consistent_frame_tamper_cannot_be_laundered: frameTamperRejected,
      self_consistent_retained_semantic_forgery_rejected: sourceForgeryRejected,
    },
    truth_boundary: {
      caller_paths_authority: "RETAINED_CALLER_SOURCE_TRUTH",
      sweep_source_authority: "RETAINED_VFX_SOURCE",
      frame_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      ribbon_set_authority: "DERIVED_REBUILDABLE_VFX_BODY",
      native_scene_receipt_pixels_authority: "DERIVED_REPLACEABLE_OBSERVER_BODIES",
      donor_join_authority: "NONE",
      donor_cap_authority: "NONE",
      donor_triangulation_authority: "NONE",
      donor_renderer_authority: "NONE",
      donor_mesh_authority: "NONE",
      creative_render_triangulation_scope: "DERIVED_REPLACEABLE_OBSERVER_ONLY",
      canonical_mesh_authority_acquired: false,
      boundary_offsets_rederived_by_creative_render: false,
      consumer_semantics_proven: false,
      general_strip_validity_proven: false,
      corner_join_quality_proven: false,
      self_intersection_safety_proven: false,
      physical_sweep_proven: false,
      aesthetic_quality_proven: false,
      accessibility_proven: false,
      realtime_performance_proven: false,
      gpu_equivalence_proven: false,
      cross_machine_bitwise_determinism_proven: false,
    },
    outputs: {
      scene: { sha256: sha256(exactObserved.bytes), bytes: exactObserved.bytes.length },
      donor_state: { sha256: sha256(donorStateBytes), bytes: donorStateBytes.length },
    },
  };
  const receiptBytes = stableBytes(receipt);
  return {
    sceneBytes: exactObserved.bytes,
    donorStateBytes,
    receiptBytes,
    receipt,
    frameSet,
    ribbonSet,
    retained: { source, sourceHash, paths: finalState.paths },
  };
}
